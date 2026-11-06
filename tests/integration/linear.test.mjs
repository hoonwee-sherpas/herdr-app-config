// The Linear search popup and panel against a fake host and a fake Linear API
// (exec answers the curl call with canned GraphQL responses).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx, key } from "../fakes/cx.mjs";
import { byId, text } from "../fakes/element.mjs";
import LinearSearch from "../../mods/linear-search/main.js";
import LinearIssues from "../../mods/linear-issues/main.js";
import { MINE_KEY, STATES_KEY, DETAIL_KEY } from "../../mods/linear-issues/common.js";

const issue = (n, title, type = "started", extra = {}) => ({
  identifier: `PRD-${n}`, title, url: `https://linear.app/i/PRD-${n}`, branchName: `feature/prd-${n}`, priority: 2,
  state: { id: `st-${type}`, name: type, type, position: 1, color: "#888888" }, project: { name: "상시" }, team: { key: "PRD" }, assignee: { name: "me" }, ...extra,
});
const A = issue(1, "Fix login redirect"), B = issue(2, "Agent installer");
const C = issue(3, "Old login bug", "completed"), D = issue(4, "Login page copy", "unstarted");

let api; // query text -> data
beforeEach(() => {
  host.reset();
  localStorage.clear();
  api = [];
  host.exec = async (cmd, args) => {
    if (cmd !== "sh") return { code: 0, stdout: "", stderr: "" };
    const { query } = JSON.parse(args[3]);
    api.push(query);
    if (query.includes("searchIssues")) return ok({ searchIssues: { nodes: [C, A, D] } });
    if (query.includes("assignedIssues") && query.includes("workflowStates")) return ok({ viewer: { assignedIssues: { nodes: [A, B] } }, workflowStates: { nodes: [] } });
    if (query.includes("assignedIssues")) return ok({ viewer: { assignedIssues: { nodes: [A, B] } } });
    if (query.includes("workflowStates")) return ok({ workflowStates: { nodes: [] } });
    return ok({});
  };
});
const ok = (data) => ({ code: 0, stdout: JSON.stringify({ data }), stderr: "" });
const cache = (at = Date.now()) => { host.shared[MINE_KEY] = { at, issues: [A, B] }; host.shared[STATES_KEY] = { at, nodes: [] }; };

async function mount(View) {
  const cx = makeCx();
  const v = new View();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}

test("search: a fresh shared cache is shown without asking Linear", async () => {
  cache();
  const { v } = await mount(LinearSearch);
  assert.equal(api.length, 0);
  assert.deepEqual(v.results.map((i) => i.identifier), ["PRD-1", "PRD-2"]);
});

test("search: a stale cache is shown at once, then refreshed into the shared cache", async () => {
  cache(Date.now() - 10 * 60000);
  host.shared[MINE_KEY].issues = [B];
  const { v } = await mount(LinearSearch);
  assert.ok(api.some((q) => q.includes("assignedIssues")));
  assert.deepEqual(host.shared[MINE_KEY].issues.map((i) => i.identifier), ["PRD-1", "PRD-2"]);
  assert.deepEqual(v.results.map((i) => i.identifier), ["PRD-1", "PRD-2"]);
});

test("search: typing filters your issues at once, then adds Linear's matches (open before closed)", async () => {
  cache();
  const { v, cx } = await mount(LinearSearch);
  v.input.type("login", cx);
  assert.deepEqual(v.results.map((i) => i.identifier), ["PRD-1"], "local first, before any request");
  assert.equal(api.length, 0);
  await cx.flush();
  assert.equal(api.filter((q) => q.includes("searchIssues")).length, 1);
  assert.deepEqual(v.results.map((i) => i.identifier), ["PRD-1", "PRD-4", "PRD-3"]);
  assert.match(text(v.render()), /3 results/);
});

test("search: only the last of several quick keystrokes asks Linear", async () => {
  cache();
  const { v, cx } = await mount(LinearSearch);
  v.input.type("l", cx);
  v.input.type("lo", cx);
  v.input.type("login", cx);
  await cx.flush();
  assert.equal(api.filter((q) => q.includes("searchIssues")).length, 1);
});

test("search: Enter shows the issue in the layout's detail block, opening the panel", async () => {
  cache();
  host.layout = { id: "root", children: [
    { id: "panel", hidden: true, children: [{ id: "panel-body", type: "stack", active: "files", children: [
      { id: "files" }, { id: "linear", children: [{ id: "linear-detail", hidden: true }] }] }] }] };
  const { v, cx } = await mount(LinearSearch);
  v.input.submit(cx);
  assert.equal(host.shared[DETAIL_KEY], "PRD-1");
  assert.deepEqual(host.ran("layout.select"), [{ stack: "panel-body", child: "linear" }]);
  assert.deepEqual(host.ran("layout.show").map((a) => a.id), ["panel", "linear-detail"]);
});

test("search: without a detail block, Enter opens the floating Linear window", async () => {
  cache();
  const { v, cx } = await mount(LinearSearch);
  v.input.submit(cx);
  assert.equal(host.overlays.at(-1).mod, "linear-issues");
});

test("search: ⌘G goes to the issue's space when one has its branch", async () => {
  cache();
  host.spaces = [{ id: "sp", name: "x", branch: "feature/prd-1" }];
  const { v, cx } = await mount(LinearSearch);
  v.render().handlers.on_key_down(key("cmd-g"), cx);
  assert.deepEqual(host.ran("space.select"), [{ id: "sp" }]);
});

test("search: a Linear error is shown, not thrown", async () => {
  cache();
  const { v, cx } = await mount(LinearSearch);
  host.exec = async () => ({ code: 6, stdout: "", stderr: "Could not resolve host" });
  v.input.type("login", cx);
  await cx.flush();
  assert.match(v.error, /Could not resolve host/);
  assert.match(text(v.render()), /Couldn't search/);
});

test("panel: a stale cache is refetched and shared with the popup", async () => {
  const { v } = await mount(LinearIssues);
  assert.equal(api.length, 1);
  assert.deepEqual(v.issues.map((i) => i.identifier), ["PRD-1", "PRD-2"]);
  assert.ok(host.shared[MINE_KEY].at > 0);
  assert.ok(host.shared[STATES_KEY]);
});

test("panel: a fresh cache is used without a request", async () => {
  cache();
  const { v } = await mount(LinearIssues);
  assert.equal(api.length, 0);
  assert.deepEqual(v.issues.map((i) => i.identifier), ["PRD-1", "PRD-2"]);
});

test("panel: the detail:<ID> command shows that issue", async () => {
  cache();
  host.layout = { id: "root", children: [{ id: "linear-detail", hidden: true }] };
  const { cx } = await mount(LinearIssues);
  host.command("detail:prd-2");
  await cx.settle();
  assert.equal(host.shared[DETAIL_KEY], "PRD-2");
  assert.deepEqual(host.ran("layout.show"), [{ id: "linear-detail" }]);
});
