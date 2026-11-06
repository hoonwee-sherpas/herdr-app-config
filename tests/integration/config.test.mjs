// The config as herdr will read it: the real files, and the real herdr-app
// loading every mod this repo tracks (`herdr-app check`, no window needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const home = new URL("../../", import.meta.url).pathname;
const read = (p) => readFileSync(home + p, "utf8");
const modExists = (name) => existsSync(`${home}mods/${name}/main.js`);

// The mods this repo tracks: the "!/mods/<name>/" lines in .gitignore.
const tracked = [...read(".gitignore").matchAll(/^!\/mods\/([^/]+)\/$/gm)].map((m) => m[1]);

const herdrApp = (() => {
  try { execFileSync("herdr-app", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

test("the repo tracks at least the mods it ships", () => {
  for (const m of ["linear-issues", "linear-search", "tabs-linear", "Sketch", "spaces-agents", "github"]) assert.ok(tracked.includes(m), m);
});

for (const mod of tracked) {
  test(`herdr-app check passes: ${mod}`, { skip: !herdrApp && "herdr-app isn't installed" }, () => {
    const out = execFileSync("herdr-app", ["check", `${home}mods/${mod}`], { encoding: "utf8" });
    assert.match(out, /check passed/);
  });

  test(`every icon ${mod} draws exists`, () => {
    const code = ["main.js", "common.js", "detail.js"].filter((f) => existsSync(`${home}mods/${mod}/${f}`)).map((f) => read(`mods/${mod}/${f}`)).join("\n");
    for (const [, path] of code.matchAll(/["`](mods\/[^"`$]+\.svg)["`]/g)) assert.ok(existsSync(home + path), path);
  });
}

test("keys.json is valid and every mod it opens exists", () => {
  const keys = JSON.parse(read("keys.json"));
  const mods = [];
  for (const section of Object.values(keys)) {
    for (const action of Object.values(section)) {
      if (typeof action === "string" && action.startsWith("mod.open:")) mods.push(action.slice(9));
      if (action?.args?.mod) mods.push(action.args.mod);
    }
  }
  assert.ok(mods.includes("Sketch") && mods.includes("linear-search"));
  for (const m of mods) assert.ok(modExists(m), `keys.json opens missing mod "${m}"`);
});

test("main-linear's root holds only the sidebar and the work area (no mod herdr docked there on its own)", () => {
  const root = JSON.parse(read("layouts/main-linear.json"));
  assert.deepEqual((root.root ?? root).children.map((c) => c.id), ["sidebar", "work"]);
});

test("⌘⇧G toggles the GitHub panel in main-linear", () => {
  assert.equal(JSON.parse(read("keys.json"))["layout:main-linear"]["cmd-shift-g"], "tabs-linear.github");
});

test("main-linear.json is valid, its ids are unique, and every mod it shows exists", () => {
  const root = JSON.parse(read("layouts/main-linear.json"));
  const ids = [], mods = [];
  (function walk(n) {
    if (n.id) ids.push(n.id);
    if (n.content?.mod) mods.push(n.content.mod);
    for (const c of [...(n.children ?? []), ...(n.floating ?? [])]) walk(c);
  })(root);
  assert.equal(new Set(ids).size, ids.length, "duplicate node ids");
  for (const m of mods) assert.ok(modExists(m), `layout shows missing mod "${m}"`);
  assert.ok(mods.includes("spaces-agents") && !mods.includes("agents"), "the sidebar uses the merged list");
  assert.ok(ids.includes("github-list") && ids.includes("github-detail"), "the GitHub panel and its detail block");
});

test("no tracked file holds a Linear API key", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: home, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of files) assert.doesNotMatch(read(f), /lin_api_[A-Za-z0-9]{20,}/, f);
});
