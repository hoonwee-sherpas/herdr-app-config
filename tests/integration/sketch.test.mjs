// The Sketch pane against a fake host: draw with the mouse and keys, then check
// the shapes, the saved board file and the reload when an agent edits it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host, DARK } from "herdr";
import { makeCx, mouse, key } from "../fakes/cx.mjs";
import { byId, all, text } from "../fakes/element.mjs";
import Sketch, { points, inkFor } from "../../mods/Sketch/main.js";

const FILE = "/app/data/sketch/board.json";
const board = (shapes) => JSON.stringify({ version: 1, shapes });

beforeEach(() => { host.reset(); localStorage.clear(); });

async function mount(shapes) {
  if (shapes) host.files.set(FILE, board(shapes));
  const cx = makeCx();
  const v = new Sketch();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}

// Mouse helpers take screen points, as herdr delivers them.
const canvas = (v) => byId(v.render(), "sketch-canvas");
const down = (v, cx, x, y, extra) => canvas(v).handlers["on_mouse_down:left"](mouse(x, y, extra), cx);
const moveTo = (v, cx, x, y) => canvas(v).handlers.on_mouse_move(mouse(x, y), cx);
const up = (v, cx, x, y) => canvas(v).handlers["on_mouse_up:left"](mouse(x, y), cx);
const drag = (v, cx, [x0, y0], [x1, y1]) => { down(v, cx, x0, y0); moveTo(v, cx, x1, y1); up(v, cx, x1, y1); };
const press = (v, cx, k) => v.render().handlers.on_key_down(key(k), cx);

test("loads the board file and draws its shapes", async () => {
  const { v } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50, text: "API" }]);
  const root = v.render();
  assert.equal(v.shapes.length, 1);
  assert.ok(all(root, (e) => e.kind === "path").length >= 1);
  assert.match(text(byId(root, "sketch-canvas")), /API/);
});

test("R then a drag draws a box where the mouse went", async () => {
  const { v, cx } = await mount();
  press(v, cx, "r");
  drag(v, cx, [100, 100], [300, 200]);
  const [s] = v.shapes;
  // The view starts panned 40px in.
  assert.deepEqual({ type: s.type, x: s.x, y: s.y, w: s.w, h: s.h }, { type: "rect", x: 60, y: 60, w: 200, h: 100 });
  assert.equal(v.tool, "select");
  assert.equal(v.sel, s.id);
});

test("with herdr zoomed (1.1), clicks land on the shape under the pointer", async () => {
  host.settings.zoom = 1.1;
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100 }]);
  // The box's bottom right: world (95, 97) is screen ((95 + 40) * 1.1, (97 + 40) * 1.1).
  // Read as unzoomed points, that's world (108.5, 110.7): outside the box.
  down(v, cx, 148.5, 150.7);
  up(v, cx, 148.5, 150.7);
  assert.equal(v.sel, "a");
  // Just below it misses.
  down(v, cx, 99, 1.1 * (40 + 108));
  assert.equal(v.sel, null);
});

test("with herdr zoomed (1.1), a box is drawn under the pointer", async () => {
  host.settings.zoom = 1.1;
  const { v, cx } = await mount();
  press(v, cx, "r");
  drag(v, cx, [110, 110], [330, 220]);
  const [s] = v.shapes;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(s.x, 60); near(s.y, 60); near(s.w, 200); near(s.h, 100);
});

test("an arrow drawn from one box to another attaches to both and follows them", async () => {
  const { v, cx } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
    { id: "b", type: "rect", x: 0, y: 200, w: 100, h: 50 },
  ]);
  press(v, cx, "a");
  drag(v, cx, [90, 65], [90, 265]);
  const arrow = v.shapes.find((s) => s.type === "arrow");
  assert.equal(arrow.from, "a");
  assert.equal(arrow.to, "b");
  // Move box b right by 200: the arrow's end goes with it.
  press(v, cx, "v");
  drag(v, cx, [90, 265], [290, 265]);
  const b = v.shapes.find((s) => s.id === "b");
  assert.equal(b.x, 200);
  const end = points(arrow, new Map(v.shapes.map((s) => [s.id, s]))).at(-1);
  assert.ok(end[0] > 150, `arrow end ${end} follows box b`);
});

test("drawing saves the board after a pause, one shape per line", async () => {
  const { v, cx } = await mount();
  press(v, cx, "o");
  drag(v, cx, [100, 100], [200, 160]);
  assert.equal(host.files.get(FILE), undefined, "not saved before the pause");
  await cx.flush();
  const saved = JSON.parse(host.files.get(FILE));
  assert.equal(saved.shapes[0].type, "ellipse");
  assert.equal(saved.shapes[0].id, v.shapes[0].id);
});

test("an agent's edit to the file shows up, and ⌘Z goes back", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }]);
  host.files.set(FILE, board([{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }, { id: "n", type: "text", x: 5, y: 5, text: "new" }]));
  host.fireWatch([FILE]);
  await cx.settle();
  assert.deepEqual(v.shapes.map((s) => s.id), ["a", "n"]);
  press(v, cx, "cmd-z");
  assert.deepEqual(v.shapes.map((s) => s.id), ["a"]);
});

test("its own save coming back from the watcher changes nothing", async () => {
  const { v, cx } = await mount();
  press(v, cx, "r");
  drag(v, cx, [100, 100], [200, 200]);
  await cx.flush();
  const undo = v.undo.length;
  host.fireWatch([FILE]);
  await cx.settle();
  assert.equal(v.undo.length, undo);
  assert.equal(v.shapes.length, 1);
});

test("a broken board file shows an error and keeps what's drawn", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }]);
  host.files.set(FILE, "{ not json");
  host.fireWatch([FILE]);
  await cx.settle();
  assert.match(v.error, /board\.json/);
  assert.equal(v.shapes.length, 1);
});

test("deleting a box detaches arrows from it", async () => {
  const { v, cx } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
    { id: "b", type: "rect", x: 0, y: 200, w: 100, h: 50 },
    { id: "x", type: "arrow", from: "a", to: "b", points: [[50, 56], [50, 194]] },
  ]);
  down(v, cx, 90, 65); up(v, cx, 90, 65);
  assert.equal(v.sel, "a");
  press(v, cx, "backspace");
  const arrow = v.shapes.find((s) => s.id === "x");
  assert.equal(v.shapes.some((s) => s.id === "a"), false);
  assert.equal(arrow.from, undefined);
  assert.equal(arrow.to, "b");
});

test("double-click a box and type to label it", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  down(v, cx, 90, 65, { click_count: 2 });
  assert.equal(v.editing, "a");
  v.input.type("Gateway", cx);
  v.input.submit(cx);
  assert.equal(v.shapes[0].text, "Gateway");
  assert.equal(v.editing, null);
});

test("in a dark theme the paper is the theme's and default ink turns light", async () => {
  host.theme = { ...DARK };
  const { v } = await mount([{ id: "a", type: "line", points: [[0, 0], [100, 0]] }]);
  const root = v.render();
  assert.equal(byId(root, "sketch-canvas").props.bg, DARK.background);
  const strokes = all(root, (e) => e.kind === "path").map((e) => e.arg.background);
  assert.ok(strokes.includes(inkFor("#1e1e1e", true)));
});
