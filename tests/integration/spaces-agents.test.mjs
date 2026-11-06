// The merged sidebar list against a fake host: agents under their spaces,
// worktrees under their checkout, clicks, navigation order, carried-over times.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx } from "../fakes/cx.mjs";
import { walk, byId, text } from "../fakes/element.mjs";
import Spaces from "../../mods/spaces-agents/main.js";

const claude = { name: "Claude Code", key: "claude-code", agent: true, icon: "icons/claude.svg", tint: true };
const ids = (root) => [...walk(root)].map((e) => e.props.id).filter((id) => /^(space|ag)-/.test(String(id)) && id !== "space-new");

beforeEach(() => {
  host.reset();
  localStorage.clear();
  host.layout = { id: "root", children: [{ id: "sidebar", size: { px: 268 } }] };
  host.spaces = [
    { id: "s1", name: "basecamp", folder: "/r/main", active: true, tabs: [{ id: "t1", name: "1", named: false }] },
    { id: "s2", name: "sotong", folder: "/x", tabs: [{ id: "t2", name: "plan", named: true }] },
  ];
  host.panes = [
    { pane: "p1", tab: "t1", terminal: "a1", cwd: "/r/main", program: claude, title: "✳ Fixing login", focused: true },
    { pane: "p2", tab: "t2", terminal: "a2", cwd: "/x", program: claude, title: "Claude Code" },
  ];
  host.agents = [
    { address: "a1", pane: "p1", space: "s1", space_name: "basecamp", tab: "t1", status: "working", program: claude, focused: true },
    { address: "a2", pane: "p2", space: "s2", space_name: "sotong", tab: "t2", status: "blocked", program: claude },
  ];
  // No repos unless a test says so.
  host.exec = async () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
});

async function mount() {
  const cx = makeCx();
  const v = new Spaces();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}

test("each space is followed by its own agents", async () => {
  const { v } = await mount();
  const root = v.render();
  assert.deepEqual(ids(root), ["space-s1", "ag-a1", "space-s2", "ag-a2"]);
  assert.match(text(byId(root, "ag-a1")), /Fixing login/);
  assert.match(text(byId(root, "ag-a2")), /plan.*Needs you/);
});

test("clicking an agent goes to its pane", async () => {
  const { v, cx } = await mount();
  byId(v.render(), "ag-a2").handlers.on_click({}, cx);
  assert.deepEqual(host.ran("pane.focus"), [{ pane: "p2" }]);
});

test("agent.next / agent.prev follow the list's order", async () => {
  host.agents.reverse();
  const { v } = await mount();
  v.render();
  assert.deepEqual(host.agentOrder, ["a1", "a2"]);
});

test("times carry over from the old agents list", async () => {
  host.agents[0].status = "idle";
  host.files.set("/app/data/agents/store.json", JSON.stringify({ changed: JSON.stringify({ a1: { s: "idle", at: Date.now() - 2 * 3600000 } }) }));
  const { v } = await mount();
  assert.match(text(byId(v.render(), "ag-a1")), /2h/);
});

test("a worktree space sits under its checkout, with its agents indented further", async () => {
  host.spaces.splice(1, 0, { id: "s3", name: "feature-x", folder: "/r/wt", tabs: [{ id: "t3", name: "1", named: false }] });
  host.panes.push({ pane: "p3", tab: "t3", terminal: "a3", cwd: "/r/wt", program: claude, title: "" });
  host.agents.splice(1, 0, { address: "a3", pane: "p3", space: "s3", space_name: "feature-x", tab: "t3", status: "idle", program: claude });
  host.exec = async (cmd, args, { cwd }) => {
    if (args.includes("status")) return { code: 0, stdout: `# branch.head ${cwd === "/r/wt" ? "feature-x" : "main"}\n`, stderr: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${cwd}\n`, stderr: "" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/r/main/.git\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const { v, cx } = await mount();
  await cx.tick(); // the 250ms check that starts the git lookups
  await cx.settle();
  const root = v.render();
  assert.deepEqual(ids(root), ["space-s1", "ag-a1", "space-s3", "ag-a3", "space-s2", "ag-a2"]);
  assert.ok([...walk(byId(root, "space-s3"))].some((e) => e.kind === "svg" && /branch\.svg/.test(e.arg)));
  assert.equal(byId(root, "ag-a3").props.pl, 52);
  assert.equal(byId(root, "ag-a1").props.pl, 35);
});

test("the narrow sidebar shows spaces only, with the expand button", async () => {
  host.layout.children[0].size.px = 76;
  const { v } = await mount();
  const root = v.render();
  assert.deepEqual(ids(root).filter((id) => id.startsWith("ag-")), []);
  assert.ok(byId(root, "collapse"));
});

test("the focused agent is the only highlighted row, not its space too", async () => {
  const { v } = await mount();
  const root = v.render();
  assert.equal(byId(root, "ag-a1").props.bg, host.theme.selected);
  assert.equal(byId(root, "space-s1").props.bg, undefined, "the active space isn't highlighted while its agent is");
});

test("the active space stays highlighted when none of its agents is focused", async () => {
  host.agents[0].focused = false;
  host.panes[0].focused = false;
  const { v } = await mount();
  const root = v.render();
  assert.equal(byId(root, "space-s1").props.bg, host.theme.selected);
  assert.equal(byId(root, "ag-a1").props.bg, undefined);
});
