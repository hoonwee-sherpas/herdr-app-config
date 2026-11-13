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
  await cx.flush(); // the pane takes the keyboard once it's shown
  return { v, cx };
}

// Mouse helpers take screen points, as herdr delivers them.
const canvas = (v) => byId(v.render(), "sketch-canvas");
const down = (v, cx, x, y, extra) => canvas(v).handlers["on_mouse_down:left"](mouse(x, y, extra), cx);
const moveTo = (v, cx, x, y) => canvas(v).handlers.on_mouse_move(mouse(x, y), cx);
const up = (v, cx, x, y) => canvas(v).handlers["on_mouse_up:left"](mouse(x, y), cx);
const drag = (v, cx, [x0, y0], [x1, y1]) => { down(v, cx, x0, y0); moveTo(v, cx, x1, y1); up(v, cx, x1, y1); };
const press = (v, cx, k) => v.render().handlers.on_key_down(key(k), cx);
const release = (v, cx, k) => v.render().handlers.on_key_up(key(k), cx);
// World (x, y) at zoom 1 and the starting pan (40, 40), in screen points.
const at = (x, y, zoom = 1) => [(x + 40) * zoom, (y + 40) * zoom];

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
  assert.deepEqual(v.sel, [s.id]);
});

test("with herdr zoomed (1.1), clicks land on the shape under the pointer", async () => {
  host.settings.zoom = 1.1;
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100 }]);
  // The box's bottom right: world (95, 97) is screen ((95 + 40) * 1.1, (97 + 40) * 1.1).
  // Read as unzoomed points, that's world (108.5, 110.7): outside the box.
  down(v, cx, 148.5, 150.7);
  up(v, cx, 148.5, 150.7);
  assert.deepEqual(v.sel, ["a"]);
  // Below it (past the bottom handle's reach) misses and clears the selection.
  down(v, cx, 99, 1.1 * (40 + 112));
  up(v, cx, 99, 1.1 * (40 + 112));
  assert.deepEqual(v.sel, []);
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
  assert.deepEqual(v.sel, ["a"]);
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

// ---- selecting several shapes

const three = () => [
  { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
  { id: "b", type: "rect", x: 200, y: 0, w: 100, h: 50 },
  { id: "c", type: "rect", x: 0, y: 300, w: 100, h: 50 },
  { id: "x", type: "arrow", from: "a", to: "c", points: [[50, 56], [50, 294]] },
];

test("dragging on empty space selects the shapes wholly inside the box", async () => {
  host.settings.zoom = 1.1;
  const { v, cx } = await mount(three());
  // From above-left of a to below-right of b: a and b are inside; c and the arrow (reaching c) aren't.
  drag(v, cx, at(-20, -20, 1.1), at(320, 70, 1.1));
  assert.deepEqual([...v.sel].sort(), ["a", "b"]);
  assert.deepEqual(v.pan, { x: 40, y: 40 }, "it didn't pan");
});

test("the selection box is drawn while dragging, and gone after", async () => {
  const { v, cx } = await mount(three());
  down(v, cx, ...at(-20, -20));
  moveTo(v, cx, ...at(150, 150));
  assert.ok(byId(v.render(), "marquee"), "box shown");
  up(v, cx, ...at(150, 150));
  assert.equal(byId(v.render(), "marquee"), null);
});

test("a click on empty space clears the selection", async () => {
  const { v, cx } = await mount(three());
  drag(v, cx, at(-20, -20), at(320, 70));
  down(v, cx, ...at(500, 500)); up(v, cx, ...at(500, 500));
  assert.deepEqual(v.sel, []);
});

test("⇧-click adds a shape to the selection, and takes it out again", async () => {
  const { v, cx } = await mount(three());
  const shift = { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } };
  down(v, cx, ...at(50, 25)); up(v, cx, ...at(50, 25));
  down(v, cx, ...at(250, 25), shift); up(v, cx, ...at(250, 25));
  assert.deepEqual(v.sel, ["a", "b"]);
  down(v, cx, ...at(50, 25), shift); up(v, cx, ...at(50, 25));
  assert.deepEqual(v.sel, ["b"]);
});

test("dragging one of several selected shapes moves them all, in one undo step", async () => {
  const { v, cx } = await mount(three());
  drag(v, cx, at(-20, -20), at(320, 70));
  drag(v, cx, at(50, 25), at(80, 125));
  const pos = (id) => { const s = v.shapes.find((x) => x.id === id); return [s.x, s.y]; };
  assert.deepEqual([pos("a"), pos("b"), pos("c")], [[30, 100], [230, 100], [0, 300]]);
  press(v, cx, "cmd-z");
  assert.deepEqual([pos("a"), pos("b")], [[0, 0], [200, 0]]);
});

test("⌫ deletes every selected shape and detaches arrows from them", async () => {
  const { v, cx } = await mount(three());
  drag(v, cx, at(-20, -20), at(320, 70));
  press(v, cx, "backspace");
  assert.deepEqual(v.shapes.map((s) => s.id), ["c", "x"]);
  assert.equal(v.shapes.find((s) => s.id === "x").from, undefined);
  assert.deepEqual(v.sel, []);
});

test("a color applies to every selected shape, in one undo step", async () => {
  const { v, cx } = await mount(three());
  drag(v, cx, at(-20, -20), at(320, 70));
  press(v, cx, "2");
  assert.deepEqual(v.shapes.map((s) => s.color ?? null), ["#e03131", "#e03131", null, null]);
  press(v, cx, "cmd-z");
  assert.deepEqual(v.shapes.map((s) => s.color ?? null), [null, null, null, null]);
});

test("Esc clears a selection of several", async () => {
  const { v, cx } = await mount(three());
  drag(v, cx, at(-20, -20), at(320, 70));
  press(v, cx, "escape");
  assert.deepEqual(v.sel, []);
});

test("holding Space while dragging pans instead of selecting", async () => {
  const { v, cx } = await mount(three());
  press(v, cx, "space");
  drag(v, cx, [500, 500], [530, 520]);
  release(v, cx, "space");
  assert.deepEqual(v.pan, { x: 70, y: 60 });
  assert.deepEqual(v.sel, []);
  // Released: dragging selects again (the view is now panned to 70, 60).
  drag(v, cx, [-20 + 70, -20 + 60], [320 + 70, 70 + 60]);
  assert.equal(v.sel.length, 2);
});

test("the middle button still pans", async () => {
  const { v, cx } = await mount(three());
  const c = canvas(v);
  c.handlers["on_mouse_down:middle"](mouse(500, 500, { button: "middle" }), cx);
  canvas(v).handlers.on_mouse_move(mouse(510, 530), cx);
  canvas(v).handlers["on_mouse_up:middle"](mouse(510, 530), cx);
  assert.deepEqual(v.pan, { x: 50, y: 70 });
});

test("an arrow moved with both its shapes stays attached; moved alone, it lets go where it is", async () => {
  const { v, cx } = await mount(three());
  // a, c and the arrow between them, moved together.
  drag(v, cx, at(-20, -20), at(120, 370));
  assert.deepEqual([...v.sel].sort(), ["a", "c", "x"]);
  drag(v, cx, at(50, 25), at(450, 25));
  const x = () => v.shapes.find((s) => s.id === "x");
  assert.equal(x().from, "a");
  assert.equal(x().to, "c");
  // Now the arrow on its own: it detaches, starting from where it was drawn.
  down(v, cx, ...at(450, 200)); up(v, cx, ...at(450, 200));
  assert.deepEqual(v.sel, ["x"]);
  drag(v, cx, at(450, 200), at(460, 200));
  assert.equal(x().from, undefined);
  assert.equal(x().to, undefined);
  assert.deepEqual(x().points, [[460, 56], [460, 294]]);
});

// ---- Space never sticks (its key-up can go missing)

const spaceDown = (v, cx, held = false) => v.render().handlers.on_key_down(key("space", { is_held: held }), cx);

test("Space pressed, then focus left the pane: the next drag selects, not pans", async () => {
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  v.handle.focused = false; // the keyboard went elsewhere; Space's key-up never comes here
  drag(v, cx, at(-20, -20), at(320, 70));
  assert.deepEqual(v.pan, { x: 40, y: 40 });
  assert.equal(v.sel.length, 2);
});

test("Space whose key repeats stopped was released: the drag selects", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  t.mock.timers.tick(400); spaceDown(v, cx, true); // repeats while held…
  t.mock.timers.tick(30); spaceDown(v, cx, true);
  t.mock.timers.tick(1000); // …then none for a second: it was let go
  drag(v, cx, at(-20, -20), at(320, 70));
  assert.deepEqual(v.pan, { x: 40, y: 40 });
  assert.equal(v.sel.length, 2);
});

test("Space pressed long ago with no repeats at all was released", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  t.mock.timers.tick(5000);
  drag(v, cx, at(-20, -20), at(320, 70));
  assert.equal(v.sel.length, 2);
});

test("Space held and repeating pans, however long it's held", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  for (let i = 0; i < 200; i++) { t.mock.timers.tick(30); spaceDown(v, cx, true); }
  drag(v, cx, [500, 500], [530, 520]);
  assert.deepEqual(v.pan, { x: 70, y: 60 });
});

test("Space just pressed (before any repeat) pans", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  t.mock.timers.tick(150);
  drag(v, cx, [500, 500], [530, 520]);
  assert.deepEqual(v.pan, { x: 70, y: 60 });
});

test("a pan in progress isn't cut off when Space goes stale mid-drag", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { v, cx } = await mount(three());
  spaceDown(v, cx);
  down(v, cx, 500, 500);
  t.mock.timers.tick(5000);
  moveTo(v, cx, 530, 520); up(v, cx, 530, 520);
  assert.deepEqual(v.pan, { x: 70, y: 60 });
});

// ---- hand-drawn look

const opsOf = (v, id) => {
  // The stroke paths drawn for one shape: render it alone.
  const keep = v.shapes, sel = v.sel;
  v.shapes = keep.filter((s) => s.id === id);
  v.sel = []; // the selection outline is a path too
  const paths = all(v.render(), (e) => e.kind === "path" && e.arg.path.mode === "stroke").map((e) => e.arg.path.ops);
  v.shapes = keep; v.sel = sel;
  return paths;
};
const kinds = (paths) => new Set(paths.flat().map((op) => op[0]));

test("shapes are hand-drawn by default: wobbly curves, drawn twice", async () => {
  const { v } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  const paths = opsOf(v, "a");
  assert.ok(kinds(paths).has("curve_to"));
  assert.ok(!kinds(paths).has("arc_to"));
  assert.equal(paths.flat().filter((op) => op[0] === "move_to").length, 8, "4 edges × 2 passes");
});

test("a shape's wobble is the same every frame, and moves with it", async () => {
  const { v, cx } = await mount([{ id: "a", type: "ellipse", x: 0, y: 0, w: 100, h: 50 }]);
  const before = opsOf(v, "a");
  assert.deepEqual(opsOf(v, "a"), before, "same on a redraw");
  drag(v, cx, at(50, 25), at(80, 45));
  const after = opsOf(v, "a");
  const shift = (paths) => paths.map((ops) => ops.map(([op, ...n]) => [op, ...n.map((x, i) => x - (i % 2 ? 20 : 30))]));
  const near = (a, b) => a.every((ops, i) => ops.every((op, j) => op.every((x, k) => typeof x !== "number" || Math.abs(x - b[i][j][k]) < 1e-9)));
  assert.ok(near(shift(after), before), "only moved, not redrawn differently");
});

test("two shapes of the same size wobble differently", async () => {
  const { v } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
    { id: "b", type: "rect", x: 0, y: 0, w: 100, h: 50 },
  ]);
  assert.notDeepEqual(opsOf(v, "a"), opsOf(v, "b"));
});

test("H switches to clean shapes and back, and is remembered", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  press(v, cx, "h");
  assert.ok(kinds(opsOf(v, "a")).has("arc_to"), "clean rounded box");
  const again = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  assert.ok(kinds(opsOf(again.v, "a")).has("arc_to"), "still clean after a reload");
  press(again.v, again.cx, "h");
  assert.ok(!kinds(opsOf(again.v, "a")).has("arc_to"));
});

test('"rough": false in the board keeps one shape clean', async () => {
  const { v } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50, rough: false }]);
  assert.ok(kinds(opsOf(v, "a")).has("arc_to"));
});

test("the wobble zooms with the drawing", async () => {
  const { v } = await mount([{ id: "a", type: "diamond", x: 0, y: 0, w: 100, h: 60 }]);
  const one = opsOf(v, "a");
  v.zoom = 2;
  const two = opsOf(v, "a");
  // screen = world × zoom + 40, so zoom 2 is (zoom-1 screen − 40) × 2 + 40.
  one.forEach((ops, i) => ops.forEach(([op, ...n], j) => n.forEach((x, k) => {
    if (typeof x === "number") assert.ok(Math.abs((x - 40) * 2 + 40 - two[i][j][k + 1]) < 1e-9);
  })));
});

// ---- images: ⌘V, the Image button / I (a file dialog), and files dropped on the canvas.
// osascript stands in for macOS: the converter answers "w h" (or "none"), the dialog the chosen paths.
const IMAGES = "/app/data/sketch/images/";
function mac({ clipboard = "640 480", files = [], sizes = {}, cancel = false } = {}) {
  const calls = { convert: [], dialog: 0 };
  host.exec = async (cmd, args) => {
    if (cmd !== "osascript") return { code: 0, stdout: "", stderr: "" };
    // Like the real osascript: after an inline script (-e), an argument that starts
    // with "-" is read as one of its own options (that's the bug that escaped once).
    const script = args.indexOf("-e");
    if (args.slice(script + 2).some((a) => a.startsWith("-"))) return { code: 2, stdout: "", stderr: "osascript: illegal option -- -" };
    if (args.join(" ").includes("choose file")) {
      calls.dialog++;
      return cancel ? { code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" }
        : { code: 0, stdout: files.map((f) => `${f}\n`).join(""), stderr: "" };
    }
    const [src, dest] = args.slice(-2);
    calls.convert.push([src, dest]);
    return { code: 0, stdout: `${src === "clipboard" ? clipboard : sizes[src] ?? "none"}\n`, stderr: "" };
  };
  return calls;
}
const images = (v) => v.shapes.filter((s) => s.type === "image");

test("⌘V pastes the clipboard's image in the middle of the view, selected and saved", async () => {
  const calls = mac({ clipboard: "320 200" });
  const { v, cx } = await mount();
  press(v, cx, "cmd-v");
  await cx.settle();
  const [img] = images(v);
  assert.ok(img, "an image shape");
  assert.match(img.src, /^images\/[\w-]+\.png$/);
  assert.deepEqual(calls.convert, [["clipboard", IMAGES + img.src.slice("images/".length)]]);
  // The view is 1000×700 panned (40, 40): its middle is world (460, 310).
  assert.deepEqual([img.x + img.w / 2, img.y + img.h / 2, img.w, img.h], [460, 310, 320, 200]);
  assert.deepEqual(v.sel, [img.id]);
  await cx.flush();
  assert.match(host.files.get(FILE), /"type":"image"/);
});

test("a pasted image bigger than the view is scaled down to fit, keeping its shape", async () => {
  mac({ clipboard: "4000 2000" });
  const { v, cx } = await mount();
  press(v, cx, "cmd-v");
  await cx.settle();
  const [img] = images(v);
  assert.ok(img.w <= 1000 && img.h <= 700);
  assert.equal(img.w / img.h, 2);
});

test("⌘V with no image on the clipboard adds nothing and says so", async () => {
  mac({ clipboard: "none" });
  const { v, cx } = await mount();
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal(v.shapes.length, 0);
  assert.match(text(v.render()), /No image on the clipboard/);
});

test("I opens the file dialog, and every chosen picture is added", async () => {
  const calls = mac({ files: ["/Users/me/a.jpg", "/Users/me/b.heic"], sizes: { "/Users/me/a.jpg": "100 50", "/Users/me/b.heic": "80 80" } });
  const { v, cx } = await mount();
  press(v, cx, "i");
  await cx.settle();
  assert.equal(calls.dialog, 1);
  assert.deepEqual(calls.convert.map(([src]) => src), ["/Users/me/a.jpg", "/Users/me/b.heic"]);
  assert.deepEqual(images(v).map((s) => [s.w, s.h]), [[100, 50], [80, 80]]);
  assert.equal(v.sel.length, 2, "both selected");
  assert.notEqual(images(v)[0].x, images(v)[1].x, "not stacked exactly on top of each other");
});

test("the Image button opens the dialog too, and canceling it adds nothing", async () => {
  const calls = mac({ cancel: true });
  const { v, cx } = await mount();
  byId(v.render(), "image").handlers.on_click({}, cx);
  await cx.settle();
  assert.equal(calls.dialog, 1);
  assert.equal(v.shapes.length, 0);
  assert.equal(v.error, null, "canceling isn't an error");
});

test("pictures dropped on the canvas are added; other files are skipped", async () => {
  const calls = mac({ sizes: { "/d/shot.png": "300 100" } });
  const { v, cx } = await mount();
  canvas(v).handlers.on_drop({ paths: ["/d/shot.png", "/d/notes.txt"] }, cx);
  await cx.settle();
  assert.deepEqual(images(v).map((s) => [s.w, s.h]), [[300, 100]]);
  assert.deepEqual(calls.convert.map(([src]) => src), ["/d/shot.png"], "a text file isn't sent to the converter");
});

test("an image is drawn from its file, where it sits, at herdr's zoom and the board's", async () => {
  host.settings.zoom = 1.1;
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 10, y: 20, w: 200, h: 100 }]);
  const img = all(v.render(), (e) => e.kind === "image")[0];
  assert.equal(img.arg, "data/sketch/images/pic.png");
  assert.deepEqual([img.props.left, img.props.top, img.props.w, img.props.h], [50, 60, 200, 100]);
  // Clicked at its middle (screen points, zoomed), it's selected.
  down(v, cx, 1.1 * (40 + 110), 1.1 * (40 + 70));
  up(v, cx, 1.1 * (40 + 110), 1.1 * (40 + 70));
  assert.deepEqual(v.sel, ["pic"]);
});

test("resizing an image keeps its proportions", async () => {
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 0, y: 0, w: 200, h: 100 }]);
  down(v, cx, ...at(100, 50));
  up(v, cx, ...at(100, 50));
  drag(v, cx, at(200, 100), at(400, 120));
  const [img] = v.shapes;
  assert.deepEqual([img.w, img.h], [400, 200]);
});

test("double-clicking an image doesn't start a text label", async () => {
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 0, y: 0, w: 200, h: 100 }]);
  down(v, cx, ...at(100, 50), { click_count: 2 });
  up(v, cx, ...at(100, 50));
  assert.equal(v.editing, null);
});

test("⌘Z takes a pasted image back out", async () => {
  mac();
  const { v, cx } = await mount();
  press(v, cx, "cmd-v");
  await cx.settle();
  press(v, cx, "cmd-z");
  assert.equal(v.shapes.length, 0);
});

// ---- hiding the bars: M, the toolbar's Hide button, the corner button to bring them back.
test("M hides the toolbar and the hint line, and M brings them back", async () => {
  const { v, cx } = await mount();
  assert.ok(byId(v.render(), "sketch-toolbar"));
  press(v, cx, "m");
  let root = v.render();
  assert.equal(byId(root, "sketch-toolbar"), null);
  assert.equal(byId(root, "sketch-hints"), null);
  assert.ok(byId(root, "sketch-canvas"), "the canvas stays");
  press(v, cx, "m");
  root = v.render();
  assert.ok(byId(root, "sketch-toolbar"));
  assert.ok(byId(root, "sketch-hints"));
});

test("the toolbar's Hide button hides it, and the corner button shows it again", async () => {
  const { v, cx } = await mount();
  byId(v.render(), "hide-bars").handlers.on_click({}, cx);
  assert.equal(byId(v.render(), "sketch-toolbar"), null);
  const show = byId(v.render(), "show-bars");
  assert.ok(show, "a way back while hidden");
  show.handlers.on_click({}, cx);
  assert.ok(byId(v.render(), "sketch-toolbar"));
  assert.equal(byId(v.render(), "show-bars"), null);
});

test("hidden bars stay hidden next time", async () => {
  const first = await mount();
  press(first.v, first.cx, "m");
  const { v } = await mount();
  assert.equal(byId(v.render(), "sketch-toolbar"), null);
});

test("M while typing a label types, it doesn't hide the bars", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  down(v, cx, ...at(50, 25), { click_count: 2 });
  up(v, cx, ...at(50, 25));
  press(v, cx, "m");
  assert.ok(byId(v.render(), "sketch-toolbar"));
});

// ---- copy, cut, paste and duplicate: ⌘C ⌘X ⌘V ⌘D. Copied shapes go on the
// system clipboard as text, so they paste into another Sketch pane too.
const select = (v, cx, x, y) => { down(v, cx, ...at(x, y)); up(v, cx, ...at(x, y)); };

test("⌘C then ⌘V pastes a copy beside the original, selected, in one undo step", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50, text: "API", color: "#e03131" }]);
  select(v, cx, 50, 25);
  press(v, cx, "cmd-c");
  assert.match(cx.clipboard, /"API"/);
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal(v.shapes.length, 2);
  const [a, b] = v.shapes;
  assert.notEqual(b.id, a.id);
  assert.deepEqual({ ...b, id: a.id }, { ...a, x: a.x + 20, y: a.y + 20 });
  assert.deepEqual(v.sel, [b.id]);
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.deepEqual([v.shapes[2].x, v.shapes[2].y], [40, 40], "each paste steps further along");
  press(v, cx, "cmd-z");
  assert.equal(v.shapes.length, 2);
  await cx.flush();
  assert.equal(JSON.parse(host.files.get(FILE)).shapes.length, 2);
});

test("pasting shapes doesn't touch the picture paste", async () => {
  const calls = mac();
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  press(v, cx, "cmd-c");
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal(calls.convert.length, 0);
  assert.equal(images(v).length, 0);
});

test("other text on the clipboard falls back to pasting a picture", async () => {
  const calls = mac({ clipboard: "320 200" });
  const { v, cx } = await mount();
  cx.clipboard = "/Users/me/Desktop/shot.png";
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal(calls.convert.length, 1);
  assert.equal(images(v).length, 1);
});

test("a copied arrow between copied boxes stays attached to the copies; one to a box left behind lets go", async () => {
  const { v, cx } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
    { id: "b", type: "rect", x: 0, y: 200, w: 100, h: 50 },
    { id: "c", type: "rect", x: 300, y: 0, w: 100, h: 50 },
    { id: "ab", type: "arrow", points: [[50, 50], [50, 200]], from: "a", to: "b" },
    { id: "ac", type: "arrow", points: [[100, 25], [300, 25]], from: "a", to: "c" },
  ]);
  v.sel = ["a", "b", "ab", "ac"];
  press(v, cx, "cmd-c");
  press(v, cx, "cmd-v");
  await cx.settle();
  const copies = v.shapes.slice(5);
  assert.equal(copies.length, 4);
  const [a2, b2, ab2, ac2] = copies;
  assert.deepEqual([ab2.from, ab2.to], [a2.id, b2.id]);
  assert.equal(ac2.from, a2.id);
  assert.equal(ac2.to, undefined);
  // It keeps the end it had at box c, moved along with the rest.
  assert.deepEqual(ac2.points.at(-1), [300 - 6 + 20, 25 + 20]);
});

test("⌘X cuts: the shapes go, and ⌘V brings them back", async () => {
  const { v, cx } = await mount([{ id: "a", type: "ellipse", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  press(v, cx, "cmd-x");
  assert.equal(v.shapes.length, 0);
  assert.deepEqual(v.sel, []);
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal(v.shapes.length, 1);
  assert.equal(v.shapes[0].type, "ellipse");
});

test("⌘D duplicates the selection beside it", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }, { id: "t", type: "text", x: 0, y: 80, text: "hi" }]);
  v.sel = ["a", "t"];
  press(v, cx, "cmd-d");
  assert.equal(v.shapes.length, 4);
  assert.deepEqual(v.shapes.slice(2).map((s) => [s.type, s.x, s.y]), [["rect", 20, 20], ["text", 20, 100]]);
  assert.deepEqual(v.sel, v.shapes.slice(2).map((s) => s.id));
  assert.equal(cx.clipboard, undefined, "⌘D leaves the clipboard alone");
});

test("copying with nothing selected leaves the clipboard alone", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  cx.clipboard = "something else";
  press(v, cx, "cmd-c");
  assert.equal(cx.clipboard, "something else");
});

test("shapes pasted after the view moved away land in the middle of the view", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  press(v, cx, "cmd-c");
  v.pan = { x: -3000, y: -3000 };
  press(v, cx, "cmd-v");
  await cx.settle();
  const s = v.shapes[1];
  // The view's middle: world ((500 + 3000), (350 + 3000)).
  assert.deepEqual([s.x + s.w / 2, s.y + s.h / 2], [3500, 3350]);
});

// ---- resizing from every corner and edge, and text by its font size.
// A lone selection shows eight handles; a drag moves that side (or corner) only.
// The selection outline sits 5px outside the shape: the corner handles are
// centered on its corners, and each of its edges is a grab strip.
const handles = (v) => all(v.render(), (e) => /^sketch-handle-/.test(e.props.id ?? "")).map((e) => e.props.id);
const edges = (v) => all(v.render(), (e) => /^sketch-edge-/.test(e.props.id ?? "")).map((e) => e.props.id);
const RIM = 5;
// A point on the shape's box moved out onto the outline (by direction dx, dy).
const rim = ([x, y], [dx, dy]) => [x + dx * RIM, y + dy * RIM];

test("a selected box shows four corner handles and four grabbable edges", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  assert.deepEqual(handles(v).sort(), ["ne", "nw", "se", "sw"].map((h) => `sketch-handle-${h}`));
  assert.deepEqual(edges(v).sort(), ["e", "n", "s", "w"].map((h) => `sketch-edge-${h}`));
});

test("each corner handle is centered on the selection outline's corner", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  const centre = (id) => {
    const el = byId(v.render(), id);
    const n = (name) => el.calls.find(([c]) => c === name)[1][0];
    const size = n("size");
    return [n("left") + size / 2, n("top") + size / 2];
  };
  // The box spans screen 40…140 × 40…90; its outline 35…145 × 35…95.
  assert.deepEqual(centre("sketch-handle-nw"), [35, 35]);
  assert.deepEqual(centre("sketch-handle-se"), [145, 95]);
});

test("an edge can be grabbed anywhere along it, not just in the middle", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  drag(v, cx, at(...rim([85, 50], [0, 1])), at(...rim([85, 80], [0, 1])));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 0, y: 0, w: 100, h: 80 });
});

test("a press just inside the shape's border moves it rather than resizing", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  drag(v, cx, at(85, 48), at(85, 78));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 0, y: 30, w: 100, h: 50 });
});

for (const [name, from, to, want, out] of [
  ["top-left corner", [0, 0], [-20, -30], { x: -20, y: -30, w: 120, h: 80 }, [-1, -1]],
  ["top-right corner", [100, 0], [150, 10], { x: 0, y: 10, w: 150, h: 40 }, [1, -1]],
  ["bottom-left corner", [0, 50], [30, 90], { x: 30, y: 0, w: 70, h: 90 }, [-1, 1]],
  ["bottom-right corner", [100, 50], [140, 60], { x: 0, y: 0, w: 140, h: 60 }, [1, 1]],
  ["top edge", [50, 0], [80, -50], { x: 0, y: -50, w: 100, h: 100 }, [0, -1]],
  ["bottom edge", [50, 50], [10, 70], { x: 0, y: 0, w: 100, h: 70 }, [0, 1]],
  ["left edge", [0, 25], [-40, 0], { x: -40, y: 0, w: 140, h: 50 }, [-1, 0]],
  ["right edge", [100, 25], [60, 99], { x: 0, y: 0, w: 60, h: 50 }, [1, 0]],
]) {
  test(`dragging a box's ${name} moves just that side`, async () => {
    const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
    select(v, cx, 50, 25);
    // Grabbed on the outline, which sits outside the box.
    drag(v, cx, at(...rim(from, out)), at(...rim(to, out)));
    const { x, y, w, h } = v.shapes[0];
    assert.deepEqual({ x, y, w, h }, want);
  });
}

test("a side dragged past the other stops short instead of flipping", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  drag(v, cx, at(-5, 25), at(300, 25));
  const { x, w } = v.shapes[0];
  assert.deepEqual({ x, w }, { x: 92, w: 8 });
});

test("⇧ while dragging a corner keeps the box's proportions", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  down(v, cx, ...at(100, 50));
  canvas(v).handlers.on_mouse_move(mouse(...at(300, 60), { modifiers: { shift: true } }), cx);
  up(v, cx, ...at(300, 60));
  const { w, h } = v.shapes[0];
  assert.deepEqual({ w, h }, { w: 300, h: 150 });
});

test("an image dragged by its top-left corner keeps its proportions and its bottom-right corner", async () => {
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 0, y: 0, w: 200, h: 100 }]);
  select(v, cx, 100, 50);
  // Across by half, down by 40%: the larger (60%) wins.
  drag(v, cx, at(0, 0), at(100, 40));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 80, y: 40, w: 120, h: 60 });
});

test("an image dragged by an edge grows both ways, centered", async () => {
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 0, y: 0, w: 200, h: 100 }]);
  select(v, cx, 100, 50);
  drag(v, cx, at(205, 50), at(405, 50));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 0, y: -50, w: 400, h: 200 });
});

test("a text box resizes by its font size, from its corners and edges", async () => {
  const { v, cx } = await mount([{ id: "t", type: "text", x: 0, y: 0, text: "hello" }]);
  select(v, cx, 10, 10);
  assert.equal(handles(v).length + edges(v).length, 8);
  // Its width is 5 × 20 × 0.56 = 56 at the default size of 20: doubled by the right edge.
  drag(v, cx, at(61, 13), at(117, 13));
  assert.equal(v.shapes[0].fontSize, 40);
  assert.deepEqual([v.shapes[0].x, Math.round(v.shapes[0].y * 1e9) / 1e9], [0, -13]);
  press(v, cx, "cmd-z");
  assert.equal(v.shapes[0].fontSize, undefined);
});

test("the handles show resize pointers that match their direction", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  const cursor = (id) => byId(v.render(), id).calls.find(([name]) => /^cursor_/.test(name))?.[0];
  assert.equal(cursor("sketch-handle-nw"), "cursor_nwse_resize");
  assert.equal(cursor("sketch-handle-se"), "cursor_nwse_resize");
  assert.equal(cursor("sketch-handle-ne"), "cursor_nesw_resize");
  assert.equal(cursor("sketch-edge-n"), "cursor_ns_resize");
  assert.equal(cursor("sketch-edge-w"), "cursor_ew_resize");
});

// ---- every tool is one action, then back to selecting.
for (const [k, type] of [["r", "rect"], ["o", "ellipse"], ["d", "diamond"], ["a", "arrow"], ["l", "line"], ["p", "pen"]]) {
  test(`after drawing (${type}), the tool goes back to select`, async () => {
    const { v, cx } = await mount();
    press(v, cx, k);
    drag(v, cx, [100, 100], [200, 180]);
    assert.equal(v.shapes[0].type, type);
    assert.equal(v.tool, "select");
    assert.deepEqual(v.sel, [v.shapes[0].id]);
  });
}

test("after placing text, the tool goes back to select", async () => {
  const { v, cx } = await mount();
  press(v, cx, "t");
  down(v, cx, 100, 100);
  up(v, cx, 100, 100);
  v.input.set_value("hi");
  v.finishEdit(cx);
  assert.equal(v.shapes[0].text, "hi");
  assert.equal(v.tool, "select");
});

test("the clipboard holds no link to a shape left behind, and a pasted one is dropped", async () => {
  const { v, cx } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
    { id: "ab", type: "arrow", points: [[0, 0], [0, 0]], from: "a", to: "gone" },
  ]);
  v.sel = ["ab"];
  press(v, cx, "cmd-c");
  const [copied] = JSON.parse(cx.clipboard).shapes;
  assert.equal("from" in copied || "to" in copied, false);
  // Text from somewhere else that still points at shapes not in it.
  cx.clipboard = JSON.stringify({ "herdr-sketch": 1, shapes: [{ id: "x", type: "line", points: [[0, 0], [50, 0]], from: "elsewhere" }] });
  press(v, cx, "cmd-v");
  await cx.settle();
  assert.equal("from" in v.shapes.at(-1), false);
});

for (const [where, pan, want] of [["left", { x: -3000, y: 40 }, [3500, 310]], ["below", { x: 40, y: 3000 }, [460, -2650]]]) {
  test(`shapes pasted with the view moved off to one side (${where}) land in its middle`, async () => {
    const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
    v.sel = ["a"];
    press(v, cx, "cmd-c");
    v.pan = pan;
    press(v, cx, "cmd-v");
    await cx.settle();
    const s = v.shapes[1];
    assert.deepEqual([s.x + s.w / 2, s.y + s.h / 2], want);
  });
}

test("an image narrowed by its edge shrinks both ways, centered", async () => {
  const { v, cx } = await mount([{ id: "pic", type: "image", src: "images/pic.png", x: 0, y: 0, w: 200, h: 100 }]);
  select(v, cx, 100, 50);
  drag(v, cx, at(205, 50), at(105, 50));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 0, y: 25, w: 100, h: 50 });
});

test("a click on a text box's handle without dragging changes nothing", async () => {
  const { v, cx } = await mount([{ id: "t", type: "text", x: 0, y: 0, text: "hello" }]);
  select(v, cx, 10, 10);
  const undo = v.undo.length;
  down(v, cx, ...at(61, 13));
  moveTo(v, cx, ...at(61, 13));
  up(v, cx, ...at(61, 13));
  assert.equal(v.undo.length, undo);
  assert.equal("fontSize" in v.shapes[0], false);
});

test("a handle grabbed a little off its center moves its side by the drag, not to the pointer", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  select(v, cx, 50, 25);
  drag(v, cx, at(104, 53), at(124, 63));
  const { x, y, w, h } = v.shapes[0];
  assert.deepEqual({ x, y, w, h }, { x: 0, y: 0, w: 120, h: 60 });
});

// ⌘D is herdr's split key everywhere; keys.json's "mod:Sketch" sends it here as a command.
test("the duplicate command duplicates in the focused board, and only once with its key too", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  v.sel = ["a"];
  host.command("duplicate");
  await cx.settle();
  assert.equal(v.shapes.length, 2);
  // The key and the command for one press: just one copy.
  press(v, cx, "cmd-d");
  host.command("duplicate");
  await cx.settle();
  assert.equal(v.shapes.length, 3);
  // Another board, without the keyboard, leaves it alone.
  v.handle.focused = false;
  v.ranAt = {}; // long after that press
  host.command("duplicate");
  await cx.settle();
  assert.equal(v.shapes.length, 3);
});

test("a press in line with an edge but past its end doesn't grab it", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 }]);
  for (const [from, to] of [[[300, -5], [300, -60]], [[-5, 200], [-60, 200]]]) {
    select(v, cx, 50, 25);
    drag(v, cx, at(...from), at(...to));
    const { x, y, w, h } = v.shapes[0];
    assert.deepEqual({ x, y, w, h }, { x: 0, y: 0, w: 100, h: 50 });
  }
});

// ---- groups: ⌘G / ⌘⇧G. Members share a "group" id; a press on one takes them all.
const trio = () => [
  { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 50 },
  { id: "b", type: "rect", x: 200, y: 0, w: 100, h: 50 },
  { id: "c", type: "rect", x: 0, y: 200, w: 100, h: 50 },
];

test("⌘G groups the selection, in one undo step, and saves it", async () => {
  const { v, cx } = await mount(trio());
  v.sel = ["a", "b"];
  const undo = v.undo.length;
  press(v, cx, "cmd-g");
  const [a, b, c] = v.shapes;
  assert.ok(a.group);
  assert.equal(b.group, a.group);
  assert.equal(c.group, undefined);
  assert.equal(v.undo.length, undo + 1);
  await cx.flush();
  assert.match(host.files.get(FILE), /"group":/);
});

test("a press on one member selects its whole group, and a drag moves them all", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  select(v, cx, 50, 25);
  assert.deepEqual(v.sel.sort(), ["a", "b"]);
  drag(v, cx, at(50, 25), at(70, 45));
  assert.deepEqual(v.shapes.map((s) => [s.x, s.y]), [[20, 20], [220, 20], [0, 200]]);
});

test("⇧-click adds or takes out a whole group", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  select(v, cx, 50, 225);
  down(v, cx, ...at(250, 25), { modifiers: { shift: true } });
  up(v, cx, ...at(250, 25));
  assert.deepEqual(v.sel.sort(), ["a", "b", "c"]);
  down(v, cx, ...at(50, 25), { modifiers: { shift: true } });
  up(v, cx, ...at(50, 25));
  assert.deepEqual(v.sel, ["c"]);
});

test("a selection box takes a group only when it covers all of it", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  drag(v, cx, at(-10, -10), at(110, 260));
  assert.deepEqual(v.sel, ["c"]);
  drag(v, cx, at(-10, -10), at(310, 260));
  assert.deepEqual(v.sel.sort(), ["a", "b", "c"]);
});

test("a click in a selection of several picks that shape's group, not just the shape", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  v.sel = ["a", "b", "c"];
  select(v, cx, 50, 25);
  assert.deepEqual(v.sel.sort(), ["a", "b"]);
});

test("⌘⇧G ungroups: then a press takes one shape", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  select(v, cx, 50, 25);
  press(v, cx, "cmd-shift-g");
  assert.ok(v.shapes.every((s) => !("group" in s)));
  select(v, cx, 50, 25);
  assert.deepEqual(v.sel, ["a"]);
});

test("grouping shapes from two groups makes one group of them all", async () => {
  const { v, cx } = await mount([
    { id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10, group: "g1" },
    { id: "b", type: "rect", x: 20, y: 0, w: 10, h: 10, group: "g1" },
    { id: "c", type: "rect", x: 40, y: 0, w: 10, h: 10, group: "g2" },
  ]);
  v.sel = ["a", "b", "c"];
  press(v, cx, "cmd-g");
  assert.equal(new Set(v.shapes.map((s) => s.group)).size, 1);
});

test("a pasted group is a new group of its own", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  select(v, cx, 50, 25);
  press(v, cx, "cmd-c");
  press(v, cx, "cmd-v");
  await cx.settle();
  const [a2, b2] = v.shapes.slice(3);
  assert.ok(a2.group && a2.group !== "g1");
  assert.equal(b2.group, a2.group);
  assert.deepEqual(v.sel.sort(), [a2.id, b2.id].sort());
});

test("a selected group gets an outline of its own around all of it", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  assert.equal(byId(v.render(), "sketch-group-g1"), null);
  select(v, cx, 50, 25);
  assert.ok(byId(v.render(), "sketch-group-g1"));
});

test("the ungroup command (⌘⇧G, which herdr binds elsewhere) ungroups in the focused board", async () => {
  const { v, cx } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  v.sel = ["a", "b"];
  host.command("ungroup");
  await cx.settle();
  assert.ok(v.shapes.every((s) => !("group" in s)));
});

test("⌘A selects everything", async () => {
  const { v, cx } = await mount(trio());
  press(v, cx, "cmd-a");
  assert.deepEqual(v.sel, ["a", "b", "c"]);
});

// ---- the right-click menu
const menuOf = (v) => byId(v.render(), "sketch-menu");
const menuItems = (v) => all(menuOf(v), (e) => /^sketch-menu-/.test(e.props.id ?? "")).map((e) => e.props.id.slice("sketch-menu-".length));
const rightClick = (v, cx, x, y) => { canvas(v).handlers["on_mouse_down:right"](mouse(x, y, { button: "right" }), cx); };
const pick = (v, cx, name) => byId(v.render(), `sketch-menu-${name}`).handlers.on_click({}, cx);

test("right-clicking a shape selects it and opens a menu of what it can do", async () => {
  const { v, cx } = await mount(trio());
  assert.equal(menuOf(v), null);
  rightClick(v, cx, ...at(50, 25));
  assert.deepEqual(v.sel, ["a"]);
  for (const name of ["cut", "copy", "paste", "duplicate", "delete", "front", "back", "fill", "dashed", "edit"]) {
    assert.ok(menuItems(v).includes(name), `${name} in ${menuItems(v)}`);
  }
  assert.ok(!menuItems(v).includes("group"), "one shape doesn't group");
  assert.match(text(menuOf(v)), /⌘D/);
});

test("right-clicking inside a selection keeps it, and offers Group", async () => {
  const { v, cx } = await mount(trio());
  v.sel = ["a", "b"];
  rightClick(v, cx, ...at(50, 25));
  assert.deepEqual(v.sel, ["a", "b"]);
  assert.ok(menuItems(v).includes("group"));
  assert.ok(!menuItems(v).includes("ungroup"));
  pick(v, cx, "group");
  assert.equal(menuOf(v), null, "picking closes the menu");
  assert.ok(v.shapes[0].group && v.shapes[0].group === v.shapes[1].group);
  rightClick(v, cx, ...at(50, 25));
  assert.ok(menuItems(v).includes("ungroup"));
  assert.ok(!menuItems(v).includes("group"), "already one group");
});

test("right-clicking empty space offers the board's actions", async () => {
  const { v, cx } = await mount(trio());
  v.sel = ["a"];
  rightClick(v, cx, ...at(600, 400));
  assert.deepEqual(v.sel, []);
  assert.deepEqual(menuItems(v), ["paste", "image", "select-all", "fit", "rough", "bars"]);
});

test("menu items do what their keys do", async () => {
  const { v, cx } = await mount(trio());
  rightClick(v, cx, ...at(50, 25));
  pick(v, cx, "duplicate");
  assert.equal(v.shapes.length, 4);
  rightClick(v, cx, ...at(250, 25));
  pick(v, cx, "delete");
  assert.deepEqual(v.shapes.map((s) => s.id).slice(0, 2), ["a", "c"]);
  rightClick(v, cx, ...at(600, 400));
  pick(v, cx, "select-all");
  assert.equal(v.sel.length, 3);
});

test("Bring to front and Send to back reorder the drawing, as one undo step", async () => {
  const { v, cx } = await mount(trio());
  rightClick(v, cx, ...at(50, 25));
  pick(v, cx, "front");
  assert.deepEqual(v.shapes.map((s) => s.id), ["b", "c", "a"]);
  rightClick(v, cx, ...at(50, 225));
  pick(v, cx, "back");
  assert.deepEqual(v.shapes.map((s) => s.id), ["c", "b", "a"]);
  press(v, cx, "cmd-z");
  assert.deepEqual(v.shapes.map((s) => s.id), ["b", "c", "a"]);
});

test("Paste from the menu puts the shapes where it was opened", async () => {
  const { v, cx } = await mount(trio());
  select(v, cx, 50, 25);
  press(v, cx, "cmd-c");
  rightClick(v, cx, ...at(500, 300));
  pick(v, cx, "paste");
  await cx.settle();
  const s = v.shapes.at(-1);
  assert.deepEqual([s.x, s.y], [500, 300]);
});

test("Esc or a press elsewhere closes the menu and keeps the selection", async () => {
  const { v, cx } = await mount(trio());
  rightClick(v, cx, ...at(50, 25));
  press(v, cx, "escape");
  assert.equal(menuOf(v), null);
  assert.deepEqual(v.sel, ["a"]);
  rightClick(v, cx, ...at(50, 25));
  down(v, cx, ...at(600, 400));
  up(v, cx, ...at(600, 400));
  assert.equal(menuOf(v), null);
  assert.deepEqual(v.sel, ["a"]);
});

test("the menu stays inside the board near its edges", async () => {
  const { v, cx } = await mount(trio());
  rightClick(v, cx, 995, 695);
  const n = (name) => menuOf(v).calls.find(([c]) => c === name)[1][0];
  assert.ok(n("left") + n("w") <= 1000, `left ${n("left")}`);
  assert.ok(n("top") >= 0 && n("top") < 695);
});

test("Edit text from the menu leaves the keyboard in the text field", async () => {
  const { v, cx } = await mount(trio());
  rightClick(v, cx, ...at(50, 25));
  v.handle.focused = false; // (the fake doesn't move focus between them by itself)
  pick(v, cx, "edit");
  assert.equal(v.editing, "a");
  assert.equal(v.handle.focused, false, "the board didn't take the keyboard back");
});

test("one member alone (picked to edit its text) gets no group outline", async () => {
  const { v } = await mount(trio().map((s) => (s.id === "c" ? s : { ...s, group: "g1" })));
  v.sel = ["a"];
  assert.equal(byId(v.render(), "sketch-group-g1"), null);
});

// ---- picture shapes: person, database, server, cloud, browser, phone, document, queue, frame

// The label element holding `s` (the innermost one with that text).
const labelOf = (v, s) => all(byId(v.render(), "sketch-canvas"), (e) => e.kids.includes(s))[0];

test("the Shapes button opens a palette; picking Database and dragging draws one", async () => {
  const { v, cx } = await mount();
  assert.equal(byId(v.render(), "sketch-shapes"), null);
  byId(v.render(), "tool-shapes").handlers.on_click({}, cx);
  const palette = byId(v.render(), "sketch-shapes");
  assert.match(text(palette), /Person.*Database.*Server.*Cloud.*Browser.*Phone.*Document.*Queue.*Frame/s);
  byId(v.render(), "shape-database").handlers.on_click({}, cx);
  assert.equal(byId(v.render(), "sketch-shapes"), null, "picking one closes it");
  assert.equal(v.tool, "database");
  assert.match(text(byId(v.render(), "tool-shapes")), /Database/, "the button says which is picked");
  drag(v, cx, [100, 100], [220, 230]);
  const [s] = v.shapes;
  assert.deepEqual({ type: s.type, x: s.x, y: s.y, w: s.w, h: s.h }, { type: "database", x: 60, y: 60, w: 120, h: 130 });
  assert.equal(v.tool, "select");
  await cx.flush();
  assert.match(host.files.get(FILE), /"type":"database"/);
});

test("the palette has two sections: system parts, and notes and markers", async () => {
  const { v, cx } = await mount();
  press(v, cx, "k");
  const palette = text(byId(v.render(), "sketch-shapes"));
  assert.match(palette, /System.*Person.*Frame.*Notes and markers.*Note.*Bubble.*Idea.*Question.*Alert.*Gear.*Clock.*Lock.*Envelope.*Folder/s);
  const tiles = all(byId(v.render(), "sketch-shapes"), (e) => /^shape-/.test(e.props.id ?? "")).map((e) => e.props.id);
  assert.equal(tiles.length, 19, "each shape once");
  assert.equal(new Set(tiles).size, 19);
});

test("a new sticky note is yellow; with Fill on it takes the picked color instead", async () => {
  const { v, cx } = await mount();
  v.setTool("note");
  drag(v, cx, at(0, 0), at(0, 0));
  assert.equal(v.shapes[0].fill, "#fff3bf");
  press(v, cx, "escape");
  v.fill = true; v.color = 3;
  v.setTool("note");
  drag(v, cx, at(300, 0), at(300, 0));
  assert.equal(v.shapes[1].fill, "#a5d8ff");
});

test("K opens the palette too, and Esc closes it", async () => {
  const { v, cx } = await mount();
  press(v, cx, "k");
  assert.ok(byId(v.render(), "sketch-shapes"));
  press(v, cx, "escape");
  assert.equal(byId(v.render(), "sketch-shapes"), null);
});

test("a click with a picture shape makes one its own size, centered on the click", async () => {
  const { v, cx } = await mount();
  v.setTool("person");
  drag(v, cx, at(200, 200), at(200, 200));
  const [s] = v.shapes;
  assert.deepEqual({ x: s.x, y: s.y, w: s.w, h: s.h }, { x: 168, y: 158, w: 64, h: 84 });
});

test("a person's label sits under it; a database's inside, below its lid", async () => {
  const { v } = await mount([
    { id: "u", type: "person", x: 0, y: 0, w: 64, h: 84, text: "Admin" },
    { id: "db", type: "database", x: 200, y: 0, w: 110, h: 120, text: "Postgres" },
  ]);
  const admin = labelOf(v, "Admin"), pg = labelOf(v, "Postgres");
  assert.ok(admin.props.top >= at(0, 84)[1], `under the person: ${admin.props.top}`);
  assert.ok(pg.props.top > at(0, 0)[1] && pg.props.top + pg.props.h <= at(0, 120)[1], "inside the database");
  assert.ok(pg.props.top >= at(0, 2 * Math.min(120 * 0.16, 110 * 0.2))[1], "below its lid");
});

test("a frame's name is at its top left", async () => {
  const { v } = await mount([{ id: "f", type: "frame", x: 0, y: 0, w: 400, h: 300, text: "Backend" }]);
  const l = labelOf(v, "Backend");
  assert.deepEqual([l.props.left < at(40, 0)[0], l.props.top < at(0, 40)[1]], [true, true]);
});

test("picture shapes are hand-drawn by default, clean with H, and take a fill", async () => {
  const { v, cx } = await mount([{ id: "c", type: "cloud", x: 0, y: 0, w: 200, h: 120, fill: "#a5d8ff" }]);
  const rough = opsOf(v, "c");
  assert.ok(kinds(rough).has("curve_to"), "wobbly curves");
  assert.equal(rough.flat().filter((op) => op[0] === "move_to").length, 2, "one outline, drawn twice");
  press(v, cx, "h");
  const clean = opsOf(v, "c");
  assert.equal(clean.flat().filter((op) => op[0] === "move_to").length, 1, "drawn once");
  const fills = all(v.render(), (e) => e.kind === "path" && e.arg.path.mode === "fill");
  assert.equal(fills.length, 1);
  assert.equal(fills[0].arg.background.solid, "#a5d8ff");
});

test("a server's lights are filled with its ink", async () => {
  const { v } = await mount([{ id: "s", type: "server", x: 0, y: 0, w: 96, h: 110, color: "#1971c2" }]);
  const fills = all(v.render(), (e) => e.kind === "path" && e.arg.path.mode === "fill");
  assert.equal(fills.length, 3);
  assert.ok(fills.every((f) => f.arg.background === "#1971c2"));
});

test("an arrow drawn between picture shapes attaches to both", async () => {
  const { v, cx } = await mount([
    { id: "u", type: "person", x: 0, y: 0, w: 64, h: 84 },
    { id: "api", type: "server", x: 300, y: 0, w: 96, h: 110 },
  ]);
  press(v, cx, "a");
  drag(v, cx, at(30, 40), at(340, 50));
  const arrow = v.shapes.at(-1);
  assert.deepEqual([arrow.from, arrow.to], ["u", "api"]);
});

test("a new frame goes behind what's drawn, dashed; a drag inside it selects, not moves it", async () => {
  const { v, cx } = await mount([{ id: "a", type: "rect", x: 100, y: 100, w: 80, h: 50 }]);
  v.setTool("frame");
  drag(v, cx, at(0, 0), at(400, 300));
  assert.deepEqual(v.shapes.map((s) => s.type), ["frame", "rect"]);
  assert.equal(v.shapes[0].dashed, true);
  v.sel = [];
  drag(v, cx, at(50, 60), at(250, 250));
  assert.deepEqual(v.sel, ["a"], "the drag in its middle was a selection box");
  assert.deepEqual([v.shapes[0].x, v.shapes[0].y], [0, 0], "the frame stayed");
  down(v, cx, ...at(200, 0)); up(v, cx, ...at(200, 0));
  assert.deepEqual(v.sel, [v.shapes[0].id], "its border picks it");
});

test("double-clicking a picture shape edits its label", async () => {
  const { v, cx } = await mount([{ id: "d", type: "document", x: 0, y: 0, w: 110, h: 140 }]);
  down(v, cx, ...at(50, 70), { click_count: 2 });
  assert.equal(v.editing, "d");
});
