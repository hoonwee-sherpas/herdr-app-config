#!/usr/bin/env node
// Which Herdr Sketch board belongs to this worktree, and is it valid.
//
//   sketch-board.mjs [folder]          JSON: { root, branch, board, images, exists }
//   sketch-board.mjs check [folder]    checks that board; exit 1 with the problems
//
// The folder defaults to the current one. The board is the one a Sketch pane
// opens for that worktree (same folder name: mods/Sketch/slug.js). This makes
// its folder and notes it in data/sketch/boards.json, as the pane does.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { boardSlug } from "../../../mods/Sketch/slug.js";

const app = process.env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app");
const TYPES = new Set(["rect", "ellipse", "diamond", "text", "arrow", "line", "pen", "image"]);
const BOXY = new Set(["rect", "ellipse", "diamond", "text", "image"]);

function git(args, cwd) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function locate(folder) {
  const dir = resolve(folder);
  const top = git(["rev-parse", "--show-toplevel"], dir);
  const root = top || dir.replace(/\/+$/, "");
  if (root === homedir().replace(/\/+$/, "")) {
    const d = join(app, "data/sketch");
    return { root: null, branch: null, dir: d };
  }
  const rel = `data/sketch/boards/${boardSlug(root, null)}`;
  return { root, branch: (top && git(["branch", "--show-current"], root)) || null, rel, dir: join(app, rel) };
}

function index(w) {
  const path = join(app, "data/sketch/boards.json");
  let all = {};
  try { all = JSON.parse(readFileSync(path, "utf8")); } catch { all = {}; }
  const entry = { board: `${w.rel}/board.json`, branch: w.branch, machine: null };
  if (JSON.stringify(all[w.root]) === JSON.stringify(entry)) return;
  all[w.root] = entry;
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`);
  renameSync(tmp, path);
}

function where(folder) {
  const w = locate(folder);
  mkdirSync(w.dir, { recursive: true });
  if (w.root) index(w);
  const board = join(w.dir, "board.json");
  return { root: w.root, branch: w.branch, board, images: join(w.dir, "images"), exists: existsSync(board) };
}

const num = (v) => typeof v === "number" && Number.isFinite(v);
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every(num);

function problems(text, dir) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return [[`not JSON: ${e.message}`], 0]; }
  const list = Array.isArray(d) ? d : d?.shapes;
  if (!Array.isArray(list)) return [['no "shapes" list'], 0];
  const out = [], seen = new Set(), byId = new Map();
  for (const s of list) if (s && typeof s.id === "string") byId.set(s.id, s);
  list.forEach((s, i) => {
    const name = s?.id != null ? `"${s.id}"` : `#${i}`;
    if (!s || typeof s !== "object") return out.push(`${name}: not an object`);
    if (s.id != null) { if (seen.has(s.id)) out.push(`duplicate id "${s.id}"`); seen.add(s.id); }
    if (!TYPES.has(s.type)) return out.push(`${name}: unknown type "${s.type}" (one of ${[...TYPES].join(", ")})`);
    const need = s.type === "text" ? ["x", "y"] : BOXY.has(s.type) ? ["x", "y", "w", "h"] : [];
    const missing = need.filter((k) => !num(s[k]));
    if (missing.length) out.push(`${name}: needs numbers ${missing.join(", ")}`);
    if (s.type === "text" && typeof s.text !== "string") out.push(`${name}: needs "text"`);
    if (s.type === "image") {
      if (typeof s.src !== "string") out.push(`${name}: needs "src"`);
      else if (!existsSync(join(dir, s.src))) out.push(`${name}: picture ${s.src} isn't in ${dir}`);
    }
    if (s.type === "pen" && !(Array.isArray(s.points) && s.points.length >= 2 && s.points.every(pt))) out.push(`${name}: needs "points", two or more [x, y]`);
    if (s.type === "arrow" || s.type === "line") {
      let ends = 0;
      for (const k of ["from", "to"]) {
        if (s[k] == null) continue;
        const t = byId.get(s[k]);
        if (!t) out.push(`${name}: ${k} "${s[k]}" isn't a shape on the board`);
        else if (!BOXY.has(t.type)) out.push(`${name}: ${k} "${s[k]}" is a ${t.type}; ends attach to boxes, ellipses, diamonds, text or pictures`);
        else ends++;
      }
      const pts = Array.isArray(s.points) ? s.points : [];
      if (!pts.every(pt)) out.push(`${name}: "points" must be [x, y] pairs`);
      else if (pts.length < 2 - ends) out.push(`${name}: needs "from"/"to" or "points" for ${ends ? "its loose end" : "both ends"}`);
    }
  });
  return [out, list.length];
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "check") {
  const w = where(arg ?? ".");
  if (!w.exists) { console.log(`no board yet: ${w.board}`); process.exit(1); }
  const [bad, n] = problems(readFileSync(w.board, "utf8"), join(w.board, ".."));
  if (bad.length) { console.log(`${w.board}:\n${bad.map((p) => `  - ${p}`).join("\n")}`); process.exit(1); }
  console.log(`ok: ${n} shapes in ${w.board}`);
} else if (cmd === undefined || (!["-h", "--help"].includes(cmd) && existsSync(cmd))) {
  console.log(JSON.stringify(where(cmd ?? "."), null, 2));
} else {
  console.error("usage: sketch-board.mjs [folder]   |   sketch-board.mjs check [folder]");
  process.exit(cmd === "-h" || cmd === "--help" ? 0 : 2);
}
