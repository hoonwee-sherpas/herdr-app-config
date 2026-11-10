// The Linear search popup and panel against a fake host and a fake Linear API
// (exec answers the curl call with canned GraphQL responses).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx, key, mouse } from "../fakes/cx.mjs";
import { byId, all, text } from "../fakes/element.mjs";
import LinearSearch from "../../mods/linear-search/main.js";
import LinearIssues from "../../mods/linear-issues/main.js";
import { MINE_KEY, STATES_KEY, DETAIL_KEY } from "../../mods/linear-issues/common.js";
import { details } from "../../mods/linear-issues/detail.js";

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
  details.clear();
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

// ---- by project: a side nav (All, then each project) beside the picked one's issues, a search on top
const inProject = (n, project, title = `Issue ${n}`) => issue(n, title, "started", { project: project ? { name: project } : null });
const navIds = (root) => all(root, (e) => /^li-nav-/.test(String(e.props.id))).map((e) => e.props.id);
const rowIds = (root) => all(root, (e) => /^li-PRD-\d+$/.test(String(e.props.id))).map((e) => e.props.id.slice(3));
function mine(...issues) {
  host.shared[MINE_KEY] = { at: Date.now(), issues };
  host.shared[STATES_KEY] = { at: Date.now(), nodes: [] };
}

test("panel: by project, a side nav lists All and each project with its count", async () => {
  mine(inProject(1, "상시"), inProject(2, "Agent"), inProject(3, "상시"), inProject(4, null));
  const { v } = await mount(LinearIssues);
  const root = v.render();
  assert.deepEqual(navIds(root), ["li-nav-*", "li-nav-상시", "li-nav-Agent", "li-nav-No project"]);
  assert.match(text(byId(root, "li-nav-*")), /All\s*4/);
  assert.match(text(byId(root, "li-nav-상시")), /상시\s*2/);
  assert.equal(byId(root, "li-nav-*").props.bg, host.theme.selected, "All is picked at first");
  assert.deepEqual(rowIds(root), ["PRD-1", "PRD-3", "PRD-2", "PRD-4"], "All: every issue, by project");
});

test("panel: picking a project shows only its issues, and is remembered", async () => {
  mine(inProject(1, "상시"), inProject(2, "Agent"), inProject(3, "상시"));
  const first = await mount(LinearIssues);
  byId(first.v.render(), "li-nav-Agent").handlers.on_click({}, first.cx);
  assert.deepEqual(rowIds(first.v.render()), ["PRD-2"]);
  const { v } = await mount(LinearIssues);
  assert.deepEqual(rowIds(v.render()), ["PRD-2"]);
  assert.equal(byId(v.render(), "li-nav-Agent").props.bg, host.theme.selected);
});

test("panel: a remembered project that's gone falls back to All", async () => {
  localStorage.setItem("project", JSON.stringify("Old project"));
  mine(inProject(1, "상시"));
  const { v } = await mount(LinearIssues);
  assert.deepEqual(rowIds(v.render()), ["PRD-1"]);
  assert.equal(byId(v.render(), "li-nav-*").props.bg, host.theme.selected);
});

test("panel: the search on top narrows the issues and the nav's projects", async () => {
  mine(inProject(1, "상시", "로그인 수정"), inProject(2, "Agent", "Installer"), inProject(3, "상시", "Docs"));
  const { v, cx } = await mount(LinearIssues);
  v.search.type("로그인", cx);
  let root = v.render();
  assert.deepEqual(rowIds(root), ["PRD-1"]);
  assert.deepEqual(navIds(root), ["li-nav-*", "li-nav-상시"], "projects with no match drop out");
  assert.match(text(byId(root, "li-nav-*")), /All\s*1/);
  v.search.type("prd-2", cx);
  assert.deepEqual(rowIds(v.render()), ["PRD-2"], "identifiers match too");
  byId(v.render(), "li-nav-Agent").handlers.on_click({}, cx);
  v.search.type("zzz", cx);
  assert.match(text(v.render()), /Nothing matches/);
});

test("panel: by state there's no side nav, and the search still works", async () => {
  mine(inProject(1, "상시", "로그인 수정"), inProject(2, "Agent", "Installer"));
  const { v, cx } = await mount(LinearIssues);
  byId(v.render(), "li-by-state").handlers.on_click({}, cx);
  assert.deepEqual(navIds(v.render()), []);
  v.search.type("install", cx);
  assert.deepEqual(rowIds(v.render()), ["PRD-2"]);
});

// ---- the side nav is resizable: drag its edge; the width is remembered
const navWidth = (v) => byId(v.render(), "li-nav").props.w;
const pane = (v) => byId(v.render(), "li-nav/pane");
function dragEdge(v, cx, from, to) {
  byId(v.render(), "li-nav/resize").handlers["on_mouse_down:left"](mouse(from, 100), cx);
  pane(v).handlers.on_mouse_move(mouse(to, 100), cx);
  pane(v).handlers["on_mouse_up:left"](mouse(to, 100), cx);
}

test("panel: dragging the nav's edge resizes it, and the width is remembered", async () => {
  mine(inProject(1, "상시"));
  const first = await mount(LinearIssues);
  const start = navWidth(first.v);
  dragEdge(first.v, first.cx, 300, 360);
  assert.equal(navWidth(first.v), start + 60);
  const { v } = await mount(LinearIssues);
  assert.equal(navWidth(v), start + 60);
});

test("panel: with herdr zoomed (1.1), the edge follows the pointer", async () => {
  host.settings.zoom = 1.1;
  mine(inProject(1, "상시"));
  const { v, cx } = await mount(LinearIssues);
  const start = navWidth(v);
  dragEdge(v, cx, 330, 396); // 66 screen points = 60 px
  assert.equal(navWidth(v), start + 60);
});

test("panel: the nav keeps between 100 and 360 px wide", async () => {
  mine(inProject(1, "상시"));
  const { v, cx } = await mount(LinearIssues);
  dragEdge(v, cx, 300, -500);
  assert.equal(navWidth(v), 100);
  dragEdge(v, cx, 300, 2000);
  assert.equal(navWidth(v), 360);
});

test("panel: after the button's let go, moving doesn't resize; a lost release ends at the next press", async () => {
  mine(inProject(1, "상시"));
  const { v, cx } = await mount(LinearIssues);
  dragEdge(v, cx, 300, 340);
  const w = navWidth(v);
  pane(v).handlers.on_mouse_move(mouse(500, 100), cx);
  assert.equal(navWidth(v), w);
  // Released outside the panel: no up arrives. The next press anywhere ends it.
  byId(v.render(), "li-nav/resize").handlers["on_mouse_down:left"](mouse(300, 100), cx);
  pane(v).handlers.on_mouse_move(mouse(320, 100), cx);
  pane(v).handlers["on_mouse_down:left"](mouse(320, 100), cx);
  pane(v).handlers.on_mouse_move(mouse(600, 100), cx);
  assert.equal(navWidth(v), w + 20);
});

// ---- the detail's cache: an issue seen in the last minute shows without asking Linear
const detailAsks = () => host.execs.filter(([, args]) => String(args?.[3] ?? "").includes("issue(id:")).length;

test("detail: an issue seen a moment ago shows at once, without asking Linear", async () => {
  mine(todoIssue());
  await mountDetail();
  const asked = detailAsks();
  const { v } = await mountDetail();
  assert.match(text(v.render()), /Write the docs/);
  assert.equal(detailAsks(), asked);
});

test("detail: one seen over a minute ago shows at once, then is asked again", async () => {
  mine(todoIssue());
  await mountDetail();
  details.get("PRD-7").at -= 2 * 60 * 1000;
  const asked = detailAsks();
  const { v } = await mountDetail({ title: "Write the docs (renamed)" });
  assert.equal(detailAsks(), asked + 1);
  assert.match(text(v.render()), /renamed/);
});

test("detail: ↻ asks Linear again", async () => {
  mine(todoIssue());
  const { v, cx } = await mountDetail();
  const asked = detailAsks();
  byId(v.render(), "ld-reload").handlers.on_click({}, cx);
  await cx.settle();
  assert.equal(detailAsks(), asked + 1);
});

test("detail: a status picked there is in the cached copy too", async () => {
  mine(todoIssue());
  linearMoves();
  const { v, cx } = await mountDetail();
  byId(v.render(), "ld-state").handlers.on_open_change(true, cx);
  byId(v.render(), "ld-state-opt-ws-Done").handlers.on_click({}, cx);
  await cx.settle();
  assert.equal(details.get("PRD-7").data.state.name, "Done");
  assert.equal(host.shared["linear.details"], undefined, "in memory, not shared.json");
});

// ---- parents and sub-issues
const sub = (n, parent, title = `Issue ${n}`) =>
  ({ ...inProject(n, "상시", title), parent: parent ? { identifier: `PRD-${parent}`, title: `Parent ${parent}` } : null });
const tooltip = (el) => el.calls.find(([n]) => n === "tooltip")?.[1][0];

test("panel: the query asks for each issue's parent and its parent", async () => {
  await mount(LinearIssues);
  assert.match(api[0], /parent \{ identifier title parent \{ identifier title \} \}/);
});

test("panel: sub-issues sit under their parent, nested by level, when it's in the same group", async () => {
  mine(sub(11, 10), sub(13, null), sub(12, 10), sub(14, 11), sub(10, null));
  const { v } = await mount(LinearIssues);
  const root = v.render();
  assert.deepEqual(rowIds(root), ["PRD-13", "PRD-10", "PRD-11", "PRD-14", "PRD-12"], "the top level keeps its order");
  const pl = (id) => byId(root, `li-${id}`).props.pl;
  assert.equal(pl("PRD-10"), pl("PRD-13"));
  assert.ok(pl("PRD-11") > pl("PRD-10"), "a sub-issue is indented");
  assert.ok(pl("PRD-14") > pl("PRD-11"), "a sub-sub-issue further");
  assert.equal(pl("PRD-11"), pl("PRD-12"));
});

test("panel: nesting also holds by state, within each state", async () => {
  mine(sub(11, 10), sub(10, null));
  const { v, cx } = await mount(LinearIssues);
  byId(v.render(), "li-by-state").handlers.on_click({}, cx);
  assert.deepEqual(rowIds(v.render()), ["PRD-10", "PRD-11"]);
});

test("panel: a sub-issue whose parent isn't listed names it, and the tag opens the parent", async () => {
  host.layout = { id: "root", children: [{ id: "linear-detail", hidden: true }] };
  mine(sub(21, 9961, "Host verify API"), sub(22, null));
  const { v, cx } = await mount(LinearIssues);
  const root = v.render();
  assert.match(text(byId(root, "li-PRD-21")), /↑\s*PRD-9961/);
  assert.equal(tooltip(byId(root, "li-parent-PRD-21")), "PRD-9961 Parent 9961");
  assert.doesNotMatch(text(byId(root, "li-PRD-22")), /↑/);
  byId(root, "li-parent-PRD-21").handlers.on_click({}, cx);
  assert.equal(host.shared[DETAIL_KEY], "PRD-9961");
});

test("panel: a listed parent isn't tagged on its sub-issues", async () => {
  mine(sub(11, 10), sub(10, null));
  const { v } = await mount(LinearIssues);
  assert.doesNotMatch(text(byId(v.render(), "li-PRD-11")), /↑/);
});
