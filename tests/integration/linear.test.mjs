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

// Changing an issue's status from its icon, in the list and in the detail pane.
const ws = (name, type, position) => ({ id: `ws-${name}`, name, type, position, color: "#888888", team: { id: "t-prd", key: "PRD" } });
const TODO = ws("Todo", "unstarted", 0), DOING = ws("Doing", "started", 1), DONE = ws("Done", "completed", 2);
const OTHER = { ...ws("Elsewhere", "started", 0), team: { id: "t-ops", key: "OPS" } };
const mineWith = (...issues) => {
  host.shared[MINE_KEY] = { at: Date.now(), issues };
  host.shared[STATES_KEY] = { at: Date.now(), nodes: [DONE, OTHER, DOING, TODO] };
};
// Linear answers issueUpdate with whatever state was asked for; `updates` records them.
let updates;
function linearMoves({ fail } = {}) {
  updates = [];
  const before = host.exec;
  host.exec = async (cmd, args) => {
    const { query, variables } = JSON.parse(args[3] ?? "{}");
    if (!query?.includes("issueUpdate")) return before(cmd, args);
    updates.push(variables);
    if (fail) return { code: 0, stdout: JSON.stringify({ errors: [{ message: "Not allowed" }] }), stderr: "" };
    const state = [TODO, DOING, DONE].find((s) => s.id === variables.stateId);
    return ok({ issueUpdate: { success: true, issue: { state } } });
  };
}
const todoIssue = () => issue(7, "Write the docs", "unstarted", { id: "uuid-7", state: TODO });
const optionNames = (pop) => text(pop.props.content).split(" ").filter((w) => w !== "✓");

test("panel: pressing an issue's status icon opens its team's states, without opening the issue", async () => {
  mineWith(todoIssue());
  const { v, cx } = await mount(LinearIssues);
  const pop = byId(v.render(), "li-state-PRD-7");
  assert.ok(pop, "the icon is a status picker");
  pop.handlers.on_open_change(true, cx);
  const open = byId(v.render(), "li-state-PRD-7");
  assert.equal(open.props.open, true);
  assert.deepEqual(optionNames(open), ["Todo", "Doing", "Done"], "only the issue's team, in Linear's order");
  assert.match(text(open.props.content), /Todo ✓/, "the current state is checked");
  const trigger = open.props.trigger;
  const before = cx.stopped;
  trigger.handlers.on_click({}, cx);
  assert.equal(cx.stopped, before + 1, "the press doesn't reach the row");
  assert.equal(host.shared[DETAIL_KEY], undefined);
});

test("panel: picking a state moves the issue in Linear, shows it at once and shares it", async () => {
  mineWith(todoIssue());
  linearMoves();
  const { v, cx } = await mount(LinearIssues);
  byId(v.render(), "li-state-PRD-7").handlers.on_open_change(true, cx);
  byId(v.render(), "li-state-PRD-7-opt-ws-Doing").handlers.on_click({}, cx);
  assert.equal(v.issues[0].state.name, "Doing", "shown before Linear answers");
  assert.equal(byId(v.render(), "li-state-PRD-7").props.open, false, "the menu closes");
  await cx.settle();
  assert.deepEqual(updates, [{ id: "uuid-7", stateId: "ws-Doing" }]);
  assert.equal(host.shared[MINE_KEY].issues[0].state.name, "Doing", "the search popup and detail see it");
});

test("panel: when Linear refuses, the old state comes back and the reason shows", async () => {
  mineWith(todoIssue());
  linearMoves({ fail: true });
  const { v, cx } = await mount(LinearIssues);
  byId(v.render(), "li-state-PRD-7").handlers.on_open_change(true, cx);
  byId(v.render(), "li-state-PRD-7-opt-ws-Done").handlers.on_click({}, cx);
  await cx.settle();
  assert.equal(v.issues[0].state.name, "Todo");
  assert.match(text(v.render()), /Couldn't change PRD-7: Not allowed/);
  assert.equal(host.shared[MINE_KEY].issues[0].state.name, "Todo");
});

// The detail pane: this mod with props { view: "detail" }, loading the issue by identifier.
async function mountDetail(extra = {}) {
  host.props = { view: "detail" };
  host.shared[DETAIL_KEY] = "PRD-7";
  const full = { ...todoIssue(), priorityLabel: "High", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z",
    description: "", creator: null, labels: { nodes: [] }, parent: null, children: { nodes: [] }, attachments: { nodes: [] },
    comments: { nodes: [] }, team: { key: "PRD", states: { nodes: [DONE, DOING, TODO] } }, ...extra };
  const before = host.exec;
  host.exec = async (cmd, args) => {
    const { query } = JSON.parse(args[3] ?? "{}");
    return query?.includes("issue(id:") ? ok({ issue: full }) : before(cmd, args);
  };
  const { v, cx } = await mount(LinearIssues);
  await cx.tick();
  return { v, cx };
}

test("detail: the Status field is a picker too, and picking moves the issue", async () => {
  mineWith(todoIssue());
  linearMoves();
  const { v, cx } = await mountDetail();
  const pop = byId(v.render(), "ld-state");
  assert.ok(pop, "the Status field is a status picker");
  pop.handlers.on_open_change(true, cx);
  assert.deepEqual(optionNames(byId(v.render(), "ld-state")), ["Todo", "Doing", "Done"]);
  byId(v.render(), "ld-state-opt-ws-Done").handlers.on_click({}, cx);
  assert.match(text(byId(v.render(), "ld-state").props.trigger), /Done/);
  await cx.settle();
  assert.deepEqual(updates, [{ id: "uuid-7", stateId: "ws-Done" }]);
  assert.equal(host.shared[MINE_KEY].issues[0].state.name, "Done", "the list sees it");
});

test("detail: the header's status icon opens the same picker", async () => {
  mineWith(todoIssue());
  const { v, cx } = await mountDetail();
  const pop = byId(v.render(), "ld-head-state");
  assert.ok(pop);
  pop.handlers.on_open_change(true, cx);
  assert.equal(byId(v.render(), "ld-head-state").props.open, true);
});

test("detail: a status changed in the list shows in the open detail", async () => {
  mineWith(todoIssue());
  const { v, cx } = await mountDetail();
  assert.match(text(byId(v.render(), "ld-state").props.trigger), /Todo/);
  await new Promise((r) => setTimeout(r, 2));
  host.shared[MINE_KEY] = { at: Date.now(), issues: [{ ...todoIssue(), state: DOING }] };
  await cx.tick();
  assert.match(text(byId(v.render(), "ld-state").props.trigger), /Doing/);
});
