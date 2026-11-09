// One Sketch board per worktree: a pane finds its space's folder (its props,
// else the space its pane is in), goes up to the git worktree's root, and
// keeps that worktree's board under data/sketch/boards/<slug>/.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx, mouse, key } from "../fakes/cx.mjs";
import { byId, text } from "../fakes/element.mjs";
import Sketch, { boardSlug } from "../../mods/Sketch/main.js";

const LEGACY = "/app/data/sketch/board.json";
const board = (shapes) => JSON.stringify({ version: 1, shapes });
const boardOf = (root, machine = null) => `/app/data/sketch/boards/${boardSlug(root, machine)}/board.json`;

// git as the worktrees have it: folder → its root and branch (a folder that isn't in one fails).
function git(worktrees) {
  host.exec = async (cmd, args, opts) => {
    if (cmd !== "git") return { code: 0, stdout: "", stderr: "" };
    const cwd = opts?.cwd ?? "";
    const root = Object.keys(worktrees).find((r) => cwd === r || cwd.startsWith(`${r}/`));
    if (!root) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${root}\n`, stderr: "" };
    if (args.includes("--show-current")) return { code: 0, stdout: `${worktrees[root]}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

beforeEach(() => { host.reset(); localStorage.clear(); });

async function mount() {
  const cx = makeCx();
  const v = new Sketch();
  v.init({}, cx);
  await cx.settle();
  await cx.flush();
  return { v, cx };
}

const press = (v, cx, k) => v.render().handlers.on_key_down(key(k), cx);
const drawBox = (v, cx) => {
  press(v, cx, "r");
  const c = byId(v.render(), "sketch-canvas");
  c.handlers["on_mouse_down:left"](mouse(100, 100), cx);
  c.handlers.on_mouse_move(mouse(200, 160), cx);
  c.handlers["on_mouse_up:left"](mouse(200, 160), cx);
};

test("a pane opened for a worktree's folder loads and saves that worktree's board", async () => {
  git({ "/work/app-wt": "feat/login" });
  host.props = { folder: "/work/app-wt" };
  host.files.set(boardOf("/work/app-wt"), board([{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }]));
  host.files.set(LEGACY, board([{ id: "old", type: "rect", x: 0, y: 0, w: 10, h: 10 }]));
  const { v, cx } = await mount();
  assert.deepEqual(v.shapes.map((s) => s.id), ["a"]);
  drawBox(v, cx);
  await cx.flush();
  assert.equal(JSON.parse(host.files.get(boardOf("/work/app-wt"))).shapes.length, 2);
  assert.equal(JSON.parse(host.files.get(LEGACY)).shapes.length, 1, "the old shared board is left alone");
});

test("two worktrees have two boards; a folder inside one is that worktree's", async () => {
  git({ "/work/app": "main", "/work/app-wt": "feat" });
  assert.notEqual(boardOf("/work/app"), boardOf("/work/app-wt"));
  host.props = { folder: "/work/app/src/ui" };
  const { v, cx } = await mount();
  drawBox(v, cx);
  await cx.flush();
  assert.ok(host.files.get(boardOf("/work/app")));
  assert.equal(host.files.get(boardOf("/work/app-wt")), undefined);
});

test("with no props, the pane takes the space its tab is in", async () => {
  git({ "/work/b": "fix" });
  host.spaces = [
    { id: "s1", folder: "/work/a", active: true, tabs: [{ id: "t1" }] },
    { id: "s2", folder: "/work/b", active: false, tabs: [{ id: "t2" }] },
  ];
  host.panes = [{ pane: "p", mod: "Sketch", tab: "t2" }];
  host.focused = { space: "s1" };
  const { v, cx } = await mount();
  drawBox(v, cx);
  await cx.flush();
  assert.ok(host.files.get(boardOf("/work/b")));
});

test("with no props and Sketch panes in several spaces, the focused one's space", async () => {
  git({ "/work/a": "main", "/work/b": "fix" });
  host.spaces = [
    { id: "s1", folder: "/work/a", active: true, tabs: [{ id: "t1" }] },
    { id: "s2", folder: "/work/b", active: false, tabs: [{ id: "t2" }] },
  ];
  host.panes = [{ pane: "p1", mod: "Sketch", tab: "t1" }, { pane: "p2", mod: "Sketch", tab: "t2", focused: true }];
  const { v, cx } = await mount();
  drawBox(v, cx);
  await cx.flush();
  assert.ok(host.files.get(boardOf("/work/b")));
});

test("a folder that isn't a git checkout gets a board of its own", async () => {
  git({});
  host.props = { folder: "/notes" };
  const { v, cx } = await mount();
  drawBox(v, cx);
  await cx.flush();
  assert.ok(host.files.get(boardOf("/notes")));
});

test("the home folder, or no space at all, keeps the old shared board", async () => {
  git({});
  host.props = { folder: "/home/test" };
  host.files.set(LEGACY, board([{ id: "old", type: "rect", x: 0, y: 0, w: 10, h: 10 }]));
  const { v } = await mount();
  assert.deepEqual(v.shapes.map((s) => s.id), ["old"]);
  host.reset();
  host.files.set(LEGACY, board([{ id: "old", type: "rect", x: 0, y: 0, w: 10, h: 10 }]));
  const again = await mount();
  assert.deepEqual(again.v.shapes.map((s) => s.id), ["old"]);
});

test("a board on another machine is its own, and git runs there", async () => {
  git({ "/srv/app": "main" });
  host.props = { folder: "/srv/app", machine: "vps" };
  const { v, cx } = await mount();
  assert.ok(host.execs.some(([cmd, , o]) => cmd === "git" && o?.on === "vps"));
  drawBox(v, cx);
  await cx.flush();
  assert.ok(host.files.get(boardOf("/srv/app", "vps")));
  assert.notEqual(boardOf("/srv/app", "vps"), boardOf("/srv/app"));
});

test("data/sketch/boards.json says which board is whose, for agents", async () => {
  git({ "/work/app-wt": "feat/login" });
  host.props = { folder: "/work/app-wt" };
  await mount();
  const index = JSON.parse(host.files.get("/app/data/sketch/boards.json"));
  assert.deepEqual(index["/work/app-wt"], {
    board: `data/sketch/boards/${boardSlug("/work/app-wt", null)}/board.json`, branch: "feat/login", machine: null,
  });
});

test("the hint line names the worktree and its branch", async () => {
  git({ "/work/app-wt": "feat/login" });
  host.props = { folder: "/work/app-wt" };
  const { v } = await mount();
  assert.match(text(byId(v.render(), "sketch-hints")), /app-wt · feat\/login/);
});

test("pictures go in the board's own images folder and are drawn from there", async () => {
  git({ "/work/app-wt": "feat" });
  host.props = { folder: "/work/app-wt" };
  const converted = [];
  const gitExec = host.exec;
  host.exec = async (cmd, args, o) => {
    if (cmd === "osascript") { converted.push(args.at(-1)); return { code: 0, stdout: "100 50\n", stderr: "" }; }
    return gitExec(cmd, args, o);
  };
  const { v, cx } = await mount();
  press(v, cx, "cmd-v");
  await cx.settle();
  const dir = `data/sketch/boards/${boardSlug("/work/app-wt", null)}`;
  assert.match(converted[0], new RegExp(`^/app/${dir}/images/`));
  const img = v.shapes[0];
  assert.match(img.src, /^images\//);
  const drawn = [...(function* walk(e) { yield e; for (const k of e.kids ?? []) yield* walk(k); })(v.render())].find((e) => e.kind === "image");
  assert.equal(drawn.arg, `${dir}/${img.src}`);
});

test("a picture pasted from another board is copied into this one", async () => {
  git({ "/work/a": "main", "/work/b": "fix" });
  host.props = { folder: "/work/b" };
  const { v, cx } = await mount();
  const from = `data/sketch/boards/${boardSlug("/work/a", null)}`;
  cx.clipboard = JSON.stringify({ "herdr-sketch": 1, board: from, shapes: [{ id: "i", type: "image", src: "images/pic.png", x: 0, y: 0, w: 10, h: 10 }] });
  press(v, cx, "cmd-v");
  await cx.settle();
  const cp = host.execs.find(([cmd]) => cmd === "cp");
  const here = `/app/data/sketch/boards/${boardSlug("/work/b", null)}`;
  assert.equal(cp[1][0], `/app/${from}/images/pic.png`);
  assert.match(cp[1][1], new RegExp(`^${here}/images/[\\w]+\\.png$`));
  assert.equal(`${here}/${v.shapes[0].src}`, cp[1][1]);
});

test("a copy says which board it came from", async () => {
  git({ "/work/a": "main" });
  host.props = { folder: "/work/a" };
  host.files.set(boardOf("/work/a"), board([{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }]));
  const { v, cx } = await mount();
  v.sel = ["a"];
  press(v, cx, "cmd-c");
  assert.equal(JSON.parse(cx.clipboard).board, `data/sketch/boards/${boardSlug("/work/a", null)}`);
});

test("drawing before the pane knows its worktree is saved to that worktree's board, not the old one", async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  git({ "/work/app": "main" });
  const gitExec = host.exec;
  host.exec = async (cmd, args, o) => { if (cmd === "git") await slow; return gitExec(cmd, args, o); };
  host.props = { folder: "/work/app" };
  const cx = makeCx();
  const v = new Sketch();
  v.init({}, cx);
  await cx.settle();
  drawBox(v, cx);
  await cx.flush();
  assert.equal(host.files.get(LEGACY), undefined);
  release();
  await cx.settle();
  await cx.flush();
  assert.ok(host.files.get(boardOf("/work/app")));
  assert.equal(host.files.get(LEGACY), undefined);
});
