// skills/herdr-sketch/scripts/sketch-board.mjs: how an agent in a worktree finds
// and checks its Sketch board. Runs against a scratch app home and a scratch
// git repo, never the real data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { boardSlug } from "../../mods/Sketch/main.js";

const cli = new URL("../../skills/herdr-sketch/scripts/sketch-board.mjs", import.meta.url).pathname;

function scratch() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sketch-cli-")));
  const app = join(base, "app"), home = join(base, "home"), repo = join(home, "code", "proj");
  mkdirSync(app); mkdirSync(join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "feat/x", repo]);
  return { app, home, repo };
}
const run = (s, args, cwd) => spawnSync(process.execPath, [cli, ...args], {
  cwd, encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: s.app, HOME: s.home },
});
const where = (s, cwd) => { const r = run(s, [], cwd); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

test("from anywhere in a worktree it names that worktree's board, the one the pane opens", () => {
  const s = scratch();
  const w = where(s, join(s.repo, "src"));
  const rel = `data/sketch/boards/${boardSlug(s.repo, null)}`;
  assert.equal(w.root, s.repo);
  assert.equal(w.branch, "feat/x");
  assert.equal(w.board, join(s.app, rel, "board.json"));
  assert.equal(w.images, join(s.app, rel, "images"));
  assert.equal(w.exists, false);
  assert.ok(existsSync(join(s.app, rel)), "the folder is ready to write into");
});

test("it records the board in boards.json, keeping other entries", () => {
  const s = scratch();
  mkdirSync(join(s.app, "data/sketch"), { recursive: true });
  writeFileSync(join(s.app, "data/sketch/boards.json"), JSON.stringify({ "/other": { board: "x", branch: null, machine: null } }));
  where(s, s.repo);
  const all = JSON.parse(readFileSync(join(s.app, "data/sketch/boards.json"), "utf8"));
  assert.deepEqual(all["/other"], { board: "x", branch: null, machine: null });
  assert.deepEqual(all[s.repo], { board: `data/sketch/boards/${boardSlug(s.repo, null)}/board.json`, branch: "feat/x", machine: null });
});

test("a folder outside git uses the folder itself; the home folder gets the old shared board", () => {
  const s = scratch();
  const loose = join(s.home, "notes");
  mkdirSync(loose);
  assert.equal(where(s, loose).root, loose);
  const h = where(s, s.home);
  assert.equal(h.root, null);
  assert.equal(h.board, join(s.app, "data/sketch/board.json"));
});

test("check passes a good board and reports what's wrong with a bad one", () => {
  const s = scratch();
  const { board } = where(s, s.repo);
  writeFileSync(board, JSON.stringify({ version: 1, shapes: [
    { id: "a", type: "rect", x: 0, y: 0, w: 180, h: 70, text: "API" },
    { id: "b", type: "ellipse", x: 300, y: 0, w: 180, h: 70 },
    { id: "ab", type: "arrow", from: "a", to: "b" },
  ] }));
  const ok = run(s, ["check"], s.repo);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /3 shapes/);

  writeFileSync(board, JSON.stringify({ version: 1, shapes: [
    { id: "a", type: "rect", x: 0, y: 0, w: 180, h: 70 },
    { id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 },
    { id: "c", type: "blob", x: 0, y: 0 },
    { id: "d", type: "arrow", from: "a", to: "zz" },
    { id: "e", type: "rect", x: 0, y: 0 },
    { id: "f", type: "image", x: 0, y: 0, w: 10, h: 10, src: "images/none.png" },
  ] }));
  const bad = run(s, ["check"], s.repo);
  assert.equal(bad.status, 1);
  for (const m of [/duplicate id "a"/, /"c".*unknown type "blob"/, /"d".*"zz"/, /"e".*w/, /"f".*images\/none\.png/]) assert.match(bad.stdout, m);

  writeFileSync(board, "{nope");
  assert.equal(run(s, ["check"], s.repo).status, 1);
});

test("an unknown command fails with usage", () => {
  const s = scratch();
  const r = run(s, ["frobnicate"], s.repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/i);
});
