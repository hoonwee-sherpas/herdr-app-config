// The worktree cleanup dialog against a fake host and a fake git: what it
// checks, what starts ticked, and what removing does. Never a real repo.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx } from "../fakes/cx.mjs";
import { byId, text } from "../fakes/element.mjs";
import Cleanup, { safe } from "../../mods/worktree-cleanup/main.js";

// Each worktree's git state, by folder; tests change these.
let repo;
const gitCalls = () => host.execs.filter((e) => e[0] === "git").map((e) => [e[2]?.cwd, e[1].join(" ")]);
beforeEach(() => {
  host.reset();
  repo = {
    "/w/done": {},
    "/w/dirty": { dirty: true },
    "/w/ahead": { unpushed: 2 },
    "/w/detached": { unpushed: 1, detached: true },
    "/w/sub": { sub: "lib", subUnpushed: true },
    "/w/quiet": {},
  };
  host.exec = async (cmd, args, { cwd }) => {
    const a = args.join(" "), ok = (stdout = "") => ({ code: 0, stdout: `${stdout}\n`, stderr: "" }), no = { code: 1, stdout: "", stderr: "" };
    if (a.startsWith("worktree remove")) return ok();
    const at = Object.keys(repo).find((k) => cwd === k || cwd?.startsWith(`/r/main/.git/worktrees${k.slice(2)}`));
    const r = repo[at];
    if (!r) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    if (a === "rev-parse --show-toplevel") return ok(at);
    if (a.includes("--git-common-dir")) return ok("/r/main/.git");
    if (a.startsWith("--no-optional-locks")) return ok(r.dirty ? " M src/app.js" : "");
    if (a === "rev-list --count HEAD --not --remotes") return ok(String(r.unpushed ?? 0));
    if (a.startsWith("symbolic-ref")) return r.detached ? no : ok("feature/x");
    if (a === "rev-parse --absolute-git-dir") return ok(`/r/main/.git/worktrees${at.slice(2)}`);
    if (a.startsWith("config --file")) return r.sub ? ok(`submodule.${r.sub}.path ${r.sub}`) : no;
    if (a.endsWith("rev-parse --git-dir")) return ok("x");
    if (a.endsWith("rev-parse HEAD")) return ok("abc");
    if (a.includes("rev-list -n1 --all")) return ok(r.subUnpushed ? "def" : "");
    return no;
  };
});

const cand = (id, reason = "closed", extra = {}) => ({
  id, name: `Space ${id}`, folder: `/w/${id}`, machine: null, reason, last: Date.now() - 3 * 86400_000,
  issue: reason === "closed" ? { identifier: "PRD-1", title: "Thing", state: { type: "completed", name: "Released", color: "#4cb782" } } : null, ...extra,
});

async function open(candidates) {
  host.props = { candidates, overlay: "o1" };
  const cx = makeCx(), v = new Cleanup();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}

test("only finished worktrees with nothing to lose start ticked; each says what removing would cost", async () => {
  const { v } = await open([cand("done"), cand("dirty"), cand("ahead"), cand("detached"), cand("sub"), cand("quiet", "quiet")]);
  assert.deepEqual([...v.picked], ["done"]);
  const say = (id) => text(byId(v.render(), `clean-${id}`));
  assert.match(say("done"), /Released.*Clean: nothing to lose/s);
  assert.match(say("dirty"), /Uncommitted changes: they'd be lost/);
  assert.match(say("ahead"), /2 commits on no remote: they'd stay on the branch only/);
  assert.match(say("detached"), /1 commit on no remote: no branch holds them, they'd be lost/);
  assert.match(say("sub"), /Submodule lib has commits on no remote/);
  assert.match(say("quiet"), /quiet 3d.*No Linear issue/s);
  assert.match(text(byId(v.render(), "remove")), /Remove 1/);
});

test("removing closes the space, then removes the worktree from the main checkout; the branch stays", async () => {
  const { v, cx } = await open([cand("done"), cand("quiet", "quiet")]);
  byId(v.render(), "clean-quiet").handlers.on_click({}, cx); // tick the quiet one too
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(host.ran("space.close"), [{ id: "done", confirmed: true }, { id: "quiet", confirmed: true }]);
  const removes = gitCalls().filter(([, a]) => a.startsWith("worktree remove"));
  assert.deepEqual(removes, [["/r/main", "worktree remove /w/done"], ["/r/main", "worktree remove /w/quiet"]]);
  assert.ok(!gitCalls().some(([, a]) => /branch -[dD]/.test(a)), "no branch is deleted");
  assert.match(text(v.render()), /Removed 2 of 2/);
});

test("a worktree with submodules is removed with --force, as Herdr does (git refuses otherwise)", async () => {
  repo["/w/sub"].subUnpushed = false;
  const { v, cx } = await open([cand("sub")]);
  assert.deepEqual([...v.picked], ["sub"], "its submodules have nothing unpushed");
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(gitCalls().filter(([, a]) => a.startsWith("worktree remove")), [["/r/main", "worktree remove --force /w/sub"]]);
});

test("something new at risk since the dialog opened leaves that worktree in place", async () => {
  const { v, cx } = await open([cand("done")]);
  repo["/w/done"].dirty = true; // an edit since
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(host.ran("space.close"), []);
  assert.ok(!gitCalls().some(([, a]) => a.startsWith("worktree remove")));
  assert.match(text(byId(v.render(), "clean-done")), /Changed since this opened: left in place/);
});

test("risky ones can still be ticked by hand: uncommitted changes go with --force", async () => {
  const { v, cx } = await open([cand("dirty")]);
  assert.equal(v.picked.size, 0);
  byId(v.render(), "clean-dirty").handlers.on_click({}, cx);
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(gitCalls().filter(([, a]) => a.startsWith("worktree remove")), [["/r/main", "worktree remove --force /w/dirty"]]);
});

test("a folder that's no longer a worktree, or is the main checkout, isn't removed", async () => {
  repo["/r/main"] = {};
  const { v, cx } = await open([cand("gone"), { ...cand("main"), folder: "/r/main" }]);
  assert.match(text(byId(v.render(), "clean-gone")), /Not a git checkout any more/);
  assert.match(text(byId(v.render(), "clean-main")), /main checkout, not a worktree/);
  v.picked = new Set(["gone", "main"]);
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(host.ran("space.close"), []);
  assert.match(text(v.render()), /Removed 0 of 2/, "finished, each reporting why");
  assert.equal(safe({ error: "x" }), false);
});

test("Esc closes the dialog; with nothing ticked Remove does nothing", async () => {
  const { v, cx } = await open([cand("dirty")]);
  byId(v.render(), "remove").handlers.on_click({}, cx);
  await cx.settle();
  assert.deepEqual(host.ran("space.close"), []);
  assert.ok(byId(v.render(), "remove"), "still waiting for a choice");
  byId(v.render(), "cleanup").handlers.on_key_down({ key: "escape" }, { stop_propagation() {} });
  assert.deepEqual(host.closedOverlays, ["o1"]);
});
