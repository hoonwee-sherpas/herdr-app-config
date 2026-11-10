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

// ---- Linear families: spaces whose issues share a top issue sit together under it
const P9992 = { identifier: "PRD-9992", title: "직원 안내", parent: null };
const P9961 = { identifier: "PRD-9961", title: "Policy DM", parent: P9992 };
const lin = (n, title, parent) => ({ identifier: `PRD-${n}`, title, state: { type: "started", name: "In Progress" }, parent });
const FAMILY_ISSUES = [
  lin(9961, "Policy DM", P9992), lin(10421, "Host API", P9961), lin(10423, "Notify socket", P9961),
  lin(9827, "License alert", P9992), lin(10399, "Perf", { identifier: "PRD-10397", title: "성능 문의", parent: null }),
  lin(10139, "Linux", null),
];
const fam = (id, name, branch, folder = `/w/${branch}`) => ({ id, name, branch, folder, tabs: [{ id: `t-${id}`, name: "1", named: false }] });
const rowIds = (root) => [...walk(root)].map((e) => e.props.id).filter((id) => /^(space|family)-/.test(String(id)) && id !== "space-new");
function families() {
  host.spaces = [
    { id: "s1", name: "basecamp", folder: "/r/main", active: true, tabs: [{ id: "t1", name: "1", named: false }] },
    fam("s2", "Get plan", "prd-9527"), fam("s3", "Host API", "prd-10421"), fam("s4", "License alert", "prd-9827"),
    fam("s5", "Policy DM", "prd-9961"), fam("s6", "Notify socket", "feature/prd-10423"), fam("s7", "Perf", "prd-10399"),
    fam("s8", "Linux", "prd-10139"),
  ];
  host.panes = [
    { pane: "p3", tab: "t-s3", terminal: "a3", cwd: "/w/prd-10421", program: claude, title: "✳ API" },
    { pane: "p6", tab: "t-s6", terminal: "a6", cwd: "/w/feature/prd-10423", program: claude, title: "✳ Socket" },
  ];
  host.agents = [
    { address: "a3", pane: "p3", space: "s3", tab: "t-s3", status: "working", program: claude },
    { address: "a6", pane: "p6", space: "s6", tab: "t-s6", status: "blocked", program: claude },
  ];
  host.shared["linear.mine"] = { at: Date.now(), issues: FAMILY_ISSUES };
}

test("spaces of one Linear family sit together under a header naming its top issue, nested by issue level", async () => {
  families();
  const { v } = await mount();
  const root = v.render();
  assert.deepEqual(rowIds(root), ["space-s1", "space-s2",
    "family-PRD-9992", "space-s4", "space-s5", "space-s3", "space-s6",
    "family-PRD-10397", "space-s7",
    "space-s8"]);
  assert.match(text(byId(root, "family-PRD-9992")), /PRD-9992.*직원 안내/);
  const pl = (id) => [...walk(byId(root, `space-${id}`))].find((e) => e.props.pl != null)?.props.pl ?? 0;
  assert.equal(pl("s4"), pl("s5"), "children of the top issue: one level");
  assert.ok(pl("s3") > pl("s5"), "PRD-10421 is under PRD-9961's space");
  assert.ok(pl("s5") > pl("s2"), "family members sit in from the plain spaces");
});

test("a family's spaces and their agents carry the family's rail", async () => {
  families();
  const { v } = await mount();
  const root = v.render();
  for (const id of ["rail-s3", "rail-s4", "rail-s5", "rail-s6", "rail-s7", "rail-ag-a3", "rail-ag-a6"]) assert.ok(byId(root, id), id);
  assert.equal(byId(root, "rail-s2"), null, "not on spaces outside a family");
  assert.equal(byId(root, "rail-s3").props.bg, byId(root, "rail-s6").props.bg, "one color per family");
  assert.notEqual(byId(root, "rail-s3").props.bg, byId(root, "rail-s7").props.bg, "another family, another color");
});

test("the family header sums up its agents: how many work and how many wait on you", async () => {
  families();
  const { v } = await mount();
  const head = byId(v.render(), "family-PRD-9992");
  assert.ok([...walk(head)].some((e) => e.kind === "svg" && /spinner/.test(e.arg)), "a working agent");
  assert.match(text(head), /1.*1/);
  assert.match(text(byId(v.render(), "family-PRD-10397")), /PRD-10397/);
});

test("clicking a family header folds it (spaces and agents), and the fold is remembered", async () => {
  families();
  const { v, cx } = await mount();
  byId(v.render(), "family-PRD-9992").handlers.on_click({}, cx);
  const root = v.render();
  assert.deepEqual(rowIds(root), ["space-s1", "space-s2", "family-PRD-9992", "family-PRD-10397", "space-s7", "space-s8"]);
  assert.equal(byId(root, "ag-a3"), null);
  const again = await mount();
  assert.ok(!rowIds(again.v.render()).includes("space-s3"), "still folded after a reload");
});

test("a lone space whose issue is a top issue stays a plain row; without Linear's issues nothing is grouped", async () => {
  families();
  delete host.shared["linear.mine"];
  const { v } = await mount();
  assert.deepEqual(rowIds(v.render()), ["space-s1", "space-s2", "space-s3", "space-s4", "space-s5", "space-s6", "space-s7", "space-s8"]);
});

test("Herdr's own space order follows the families, so agent.next goes down the list as shown", async () => {
  families();
  const { v } = await mount();
  v.render();
  const moves = host.ran("space.move");
  assert.ok(moves.length > 0);
  assert.deepEqual(host.agentOrder, ["a3", "a6"]);
});

test("worktree spaces group into families under their checkout", async () => {
  families();
  host.spaces = host.spaces.filter((s) => ["s1", "s3", "s5"].includes(s.id));
  host.exec = async (cmd, args, { cwd }) => {
    if (args.includes("status")) return { code: 0, stdout: `# branch.head ${cwd === "/r/main" ? "main" : cwd.split("/").pop()}\n`, stderr: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${cwd}\n`, stderr: "" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/r/main/.git\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const { v, cx } = await mount();
  await cx.tick();
  await cx.settle();
  const root = v.render();
  assert.deepEqual(rowIds(root), ["space-s1", "family-PRD-9992", "space-s5", "space-s3"]);
  const headPl = byId(root, "family-PRD-9992").props.pl;
  assert.ok(headPl > 8, "the header sits at the worktrees' level");
});

test("a family's top issue is found through the cache when the issue's own chain stops short", async () => {
  families();
  // Linear sends two levels up; deeper ones come from the cached parent.
  host.shared["linear.mine"].issues = [
    lin(9961, "Policy DM", P9992),
    lin(10421, "Host API", { identifier: "PRD-9961", title: "Policy DM" }),
  ];
  host.spaces = host.spaces.filter((s) => ["s1", "s3"].includes(s.id));
  const { v } = await mount();
  assert.deepEqual(rowIds(v.render()), ["space-s1", "family-PRD-9992", "space-s3"]);
});

test("a space is matched to its issue by its git branch too, when the folder and name don't say", async () => {
  families();
  host.spaces = [host.spaces[0], fam("s7", "Agent Perf Check", null, "/r/how-to-prove-agent-is-not-slow")];
  host.spaces[1].branch = undefined;
  host.exec = async (cmd, args, { cwd }) => {
    if (args.includes("status")) return { code: 0, stdout: `# branch.head ${cwd === "/r/main" ? "main" : "prd-10399"}\n`, stderr: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${cwd}\n`, stderr: "" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/r/main/.git\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const { v, cx } = await mount();
  await cx.tick();
  await cx.settle();
  assert.deepEqual(rowIds(v.render()), ["space-s1", "family-PRD-10397", "space-s7"]);
});

// Linear answers a lookup of issues by team and number (no real keychain or network).
function linearAnswers(nodes) {
  const asked = [];
  host.exec = async (cmd, args) => {
    const script = args.join(" ");
    if (cmd !== "sh" || !script.includes("api.linear.app")) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    const body = JSON.parse(args.at(-1));
    asked.push(body);
    const data = Object.fromEntries(Object.entries(body.variables).map(([f, v]) => [`t${f.slice(1)}`,
      { nodes: nodes.filter((n) => n.identifier.startsWith(`${v.team.key.eq}-`) && v.number.in.includes(Number(n.identifier.split("-")[1]))) }]));
    return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
  };
  return asked;
}

test("a worktree whose issue is done (so not in my open issues) is looked up in Linear and joins its family", async () => {
  families();
  host.spaces = [host.spaces[0], fam("s5", "Policy DM", "prd-9961"), fam("s9", "Relay skeleton", "prd-10422")];
  const asked = linearAnswers([{ ...lin(10422, "Relay skeleton", P9961), state: { type: "completed" } }]);
  const { v, cx } = await mount();
  await cx.settle();
  assert.deepEqual(rowIds(v.render()), ["space-s1", "family-PRD-9992", "space-s5", "space-s9"]);
  assert.ok(byId(v.render(), "rail-s9"), "s9 is in the family, on its rail");
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].variables, { f0: { team: { key: { eq: "PRD" } }, number: { in: [10422] } } }, "only the issue the cache lacks");
  const script = host.execs.find((e) => e[0] === "sh")[1][1];
  assert.match(script, /security find-generic-password -s linear-api-key -w \| sed[^|]*\| curl [^|]*-H @-/, "the key goes through a pipe");
  assert.ok(host.shared["linear.spaces"].issues["PRD-10422"], "kept for next time");
});

test("issues are looked up once, again only after a while, and not at all when a cache has them fresh", async (t) => {
  families();
  host.spaces = [host.spaces[0], fam("s9", "Relay skeleton", "prd-10422"), fam("s10", "Gone", "prd-77")];
  const asked = linearAnswers([lin(10422, "Relay skeleton", P9961)]);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { cx } = await mount();
  await cx.tick();
  await cx.settle();
  assert.equal(asked.length, 1, "the 5-second check doesn't ask again");
  now += 11 * 60_000;
  await cx.tick();
  await cx.settle();
  assert.deepEqual(asked.map((a) => a.variables.f0.number.in), [[10422, 77], [77]], "after 10 minutes only the unanswered one");
  now += 50 * 60_000;
  await cx.tick();
  await cx.settle();
  assert.deepEqual(asked.at(-1).variables.f0.number.in, [10422, 77], "an hour on, the found one is refreshed too");
  // A fresh start with the found one cached asks only for the other.
  asked.length = 0;
  await mount();
  assert.deepEqual(asked.map((a) => a.variables.f0.number.in), [[77]]);
});

test("a failed Linear lookup (no key, offline) leaves those spaces as plain rows", async () => {
  families();
  host.spaces = [host.spaces[0], fam("s5", "Policy DM", "prd-9961"), fam("s9", "Relay skeleton", "prd-10422")];
  host.exec = async () => ({ code: 1, stdout: "", stderr: "security: The specified item could not be found in the keychain." });
  const { v, cx } = await mount();
  await cx.settle();
  assert.deepEqual(rowIds(v.render()), ["space-s1", "family-PRD-9992", "space-s5", "space-s9"], "PRD-10422 unknown: s9 stays outside");
  assert.equal(byId(v.render(), "rail-s9"), null);
});

test("a worktree named only by its git branch is looked up too", async () => {
  families();
  host.spaces = [host.spaces[0], fam("s5", "Policy DM", "prd-9961"), fam("s9", "Relay", null, "/r/relay")];
  host.spaces[2].branch = undefined;
  const linear = linearAnswers([lin(10422, "Relay skeleton", P9961)]);
  const git = host.exec;
  host.exec = async (cmd, args, opts) => {
    if (cmd === "sh") return git(cmd, args, opts);
    if (args.includes("status")) return { code: 0, stdout: `# branch.head ${opts.cwd === "/r/relay" ? "prd-10422" : "main"}\n`, stderr: "" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${opts.cwd}\n`, stderr: "" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: `${opts.cwd}/.git\n`, stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  const { v, cx } = await mount();
  await cx.tick(); // git answers
  await cx.settle();
  await cx.tick(); // the next lookup sees the branch
  await cx.settle();
  assert.deepEqual(linear.flatMap((a) => a.variables.f0.number.in), [10422]);
  assert.ok(byId(v.render(), "rail-s9"));
});

test("a worktree whose issue is closed in Linear carries the state, for cleanup; open ones don't", async () => {
  families();
  host.spaces = [host.spaces[0], fam("s5", "Policy DM", "prd-9961"), fam("s9", "Relay skeleton", "prd-10422"), fam("s10", "Dropped", "prd-10500")];
  linearAnswers([
    { ...lin(10422, "Relay skeleton", P9961), state: { type: "completed", name: "Done", color: "#5e6ad2" } },
    { ...lin(10500, "Dropped", null), state: { type: "canceled", name: "Canceled", color: "#95a2b3" } },
  ]);
  const { v, cx } = await mount();
  await cx.settle();
  const root = v.render();
  assert.equal(byId(root, "closed-s5"), null, "PRD-9961 is open");
  const done = byId(root, "closed-s9");
  assert.match(text(done), /Done/);
  assert.equal(done.props.text_color, "#5e6ad2", "in the state's own color");
  assert.match(done.props.tooltip ?? "", /PRD-10422 is Done in Linear/);
  assert.ok([...walk(done)].some((e) => /state-completed\.svg/.test(e.kind === "svg" && e.arg)), "Linear's state icon");
  assert.match(text(byId(root, "closed-s10")), /Canceled/);
  const name = (id, label) => [...walk(byId(root, `space-${id}`))].find((e) => e.kind === "div" && e.kids.length === 1 && e.kids[0] === label);
  assert.equal(name("s9", "Relay skeleton").props.text_color, host.theme.muted, "its name is dimmed");
  assert.equal(name("s5", "Policy DM").props.text_color, host.theme.foreground);
});
