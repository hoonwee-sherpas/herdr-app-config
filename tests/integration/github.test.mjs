// The GitHub pane against a fake host and a fake gh: the active space's repo,
// its pull requests and workflow runs, the detail view, links to spaces and
// Linear, run actions, and alerts.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx, mouse } from "../fakes/cx.mjs";
import { byId, all, text } from "../fakes/element.mjs";
import GitHub from "../../mods/github/main.js";
import { DETAIL_KEY, details } from "../../mods/github/common.js";

const REPO = "sherpas-team/basecamp";
const ok = (data) => ({ code: 0, stdout: typeof data === "string" ? data : JSON.stringify(data), stderr: "" });
const check = (conclusion, status = "COMPLETED") => ({ __typename: "CheckRun", name: "test", workflowName: "CI", status, conclusion });
const pr = (number, title, extra = {}) => ({
  number, title, state: "OPEN", isDraft: false, author: { login: "kim" }, headRefName: `feature/prd-${number}`, baseRefName: "main",
  reviewDecision: "", statusCheckRollup: [check("SUCCESS")], updatedAt: "2026-11-06T07:00:00Z", url: `https://github.com/${REPO}/pull/${number}`,
  reviewRequests: [], latestReviews: [], isCrossRepository: false, mergedAt: null, closedAt: null, ...extra,
});
const wr = (id, workflowName, createdAt, extra = {}) => ({
  databaseId: id, number: id, workflowName, displayTitle: `${workflowName} run ${id}`, status: "completed", conclusion: "success",
  headBranch: "main", event: "push", createdAt, startedAt: createdAt, updatedAt: createdAt, url: `https://github.com/${REPO}/actions/runs/${id}`, ...extra,
});

// A run as the REST API returns it.
const rest = (r) => ({ id: r.databaseId, run_number: r.number, name: r.workflowName, display_title: r.displayTitle, status: r.status,
  conclusion: r.conclusion || null, head_branch: r.headBranch, event: r.event, created_at: r.createdAt, run_started_at: r.startedAt,
  updated_at: r.updatedAt, html_url: r.url });

// gh's answers; a test changes them before acting. `calls` is every gh argument list.
let gh, calls;
beforeEach(() => {
  host.reset();
  localStorage.clear();
  details.clear();
  host.spaces = [
    { id: "s1", name: "basecamp", folder: "/r/basecamp", machine: null, branch: "main", active: true, tabs: [] },
    { id: "s2", name: "login fix", folder: "/w/prd-2", machine: null, branch: "feature/prd-2", tabs: [] },
    { id: "s3", name: "home", folder: "/Users/me", machine: null, branch: null, tabs: [] },
  ];
  host.layout = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", type: "stack", active: "files", children: [
    { id: "files" },
    { id: "github", children: [{ id: "github-list" }, { id: "github-detail", hidden: true }] },
    { id: "linear", children: [{ id: "linear-list" }, { id: "linear-detail", hidden: true }] }] }] }] };
  calls = [];
  gh = {
    me: "me",
    open: [pr(1, "Fix login redirect", { author: { login: "me" } }), pr(2, "로그인 페이지 문구", { reviewRequests: [{ login: "me" }] }),
      pr(3, "Draft: agent installer", { isDraft: true, statusCheckRollup: [check("FAILURE")] })],
    closed: [pr(4, "Old fix", { state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" }), pr(5, "Abandoned", { state: "CLOSED" })],
    runs: [wr(10, "CI", "2026-11-06T01:00:00Z"), wr(11, "Deploy", "2026-11-06T03:00:00Z", { status: "in_progress", conclusion: "" }),
      wr(12, "CI", "2026-11-06T02:00:00Z", { conclusion: "failure", headBranch: "feature/prd-1", event: "pull_request" }),
      ...[13, 14, 15, 16].map((id) => wr(id, "CI", `2026-11-05T0${id - 10}:00:00Z`))],
    other: { "sherpas-team/website": [pr(77, "Website PR")] },
    workflows: [{ id: 3, name: "Lint", state: "active" }, { id: 1, name: "CI", state: "active" },
      { id: 9, name: "Old", state: "disabled_manually" }, { id: 2, name: "Deploy", state: "active" }],
  };
  host.exec = async (cmd, args, opts) => {
    if (cmd === "git" && args.join(" ") === "remote get-url origin") {
      const url = { "/r/basecamp": `https://github.com/${REPO}.git`, "/w/prd-2": `git@github.com:${REPO}.git`, "/w/site": "https://github.com/sherpas-team/website" }[opts?.cwd];
      return url ? ok(`${url}\n`) : { code: 2, stdout: "", stderr: "error: No such remote 'origin'" };
    }
    if (cmd === "git") return ok("");
    if (!cmd.endsWith("gh")) return ok("");
    if (args[0] === "--version") return ok("gh version 2.103.0");
    calls.push(args);
    if (gh.fail) return { code: 1, stdout: "", stderr: gh.fail };
    const repo = args[args.indexOf("-R") + 1];
    const a = args.join(" ");
    if (a.startsWith("api user")) return ok(`${gh.me}\n`);
    if (a.startsWith("pr list")) return ok(gh.other[repo] ?? gh.open);
    // Closed PRs: GitHub's search, cursor pages ("c<offset>"); the fake honors author:@me.
    if (a.startsWith("api graphql")) {
      const v = Object.fromEntries(args.filter((x) => /^(q|n|after)=/.test(x)).map((x) => [x.split("=")[0], x.slice(x.indexOf("=") + 1)]));
      const from = v.after ? Number(v.after.slice(1)) : 0, n = Number(v.n);
      const hits = gh.closed.filter((p) => !v.q.includes("author:@me") || p.author.login === "me");
      const nodes = hits.slice(from, from + n);
      return ok({ data: { search: { issueCount: gh.closedTotal ?? hits.length, nodes,
        pageInfo: { hasNextPage: from + n < hits.length, endCursor: `c${from + nodes.length}` } } } });
    }
    if (/^api repos\/\S+\/actions\/workflows\?per_page=100$/.test(a)) return ok({ total_count: gh.workflows.length, workflows: gh.workflows });
    const wfPage = a.match(/^api repos\/\S+\/actions\/workflows\/(\d+)\/runs\?per_page=(\d+)&page=(\d+)$/);
    if (wfPage) {
      const [, id, per, page] = wfPage.map(Number);
      const name = gh.workflows.find((w) => w.id === id)?.name;
      const sorted = gh.runs.filter((r) => r.workflowName === name).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return ok({ total_count: sorted.length, workflow_runs: sorted.slice((page - 1) * per, page * per).map(rest) });
    }
    // Runs: the REST API, pages by number, newest first.
    const runsPage = a.match(/^api repos\/(\S+)\/actions\/runs\?per_page=(\d+)&page=(\d+)$/);
    if (runsPage) {
      const [, , per, page] = runsPage.map((x, i) => (i > 1 ? Number(x) : x));
      const sorted = [...gh.runs].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return ok({ total_count: gh.runsTotal ?? sorted.length, workflow_runs: sorted.slice((page - 1) * per, page * per).map(rest) });
    }
    if (a.startsWith("pr view")) return ok(gh.view ?? {});
    if (a.startsWith("run view") && a.includes("--log-failed")) return ok(gh.log ?? "");
    if (a.startsWith("run view")) return ok(gh.run ?? {});
    return ok("");
  };
});

async function mount(props = {}) {
  host.props = props;
  const cx = makeCx();
  const v = new GitHub();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}
const ran = (prefix) => calls.filter((a) => a.join(" ").startsWith(prefix));
const prIds = (v) => all(v.render(), (e) => /^gh-pr-\d+$/.test(String(e.props.id))).map((e) => Number(e.props.id.slice(6)));
const click = (v, cx, id) => { const el = byId(v.render(), id); assert.ok(el, `no ${id}`); el.handlers.on_click({}, cx); };

// ---- the list

test("shows the active space's repo and its open pull requests", async () => {
  const { v } = await mount();
  assert.deepEqual(prIds(v), [1, 2, 3]);
  const root = v.render();
  assert.match(text(root), /sherpas-team\/basecamp/);
  assert.match(text(byId(root, "gh-pr-2")), /로그인 페이지 문구/);
  assert.match(text(byId(root, "gh-pr-2")), /#2.*kim.*feature\/prd-2/);
  const [list] = ran("pr list");
  assert.deepEqual(list.slice(list.indexOf("-R"), list.indexOf("-R") + 2), ["-R", REPO]);
});

test("each PR shows its state and its checks", async () => {
  const { v } = await mount();
  const icons = (id) => all(byId(v.render(), id), (e) => e.kind === "svg").map((e) => e.arg);
  assert.ok(icons("gh-pr-1").includes("mods/github/pr-open.svg"));
  assert.ok(icons("gh-pr-1").includes("mods/github/check-success.svg"));
  assert.ok(icons("gh-pr-3").includes("mods/github/pr-draft.svg"));
  assert.ok(icons("gh-pr-3").includes("mods/github/check-failure.svg"));
});

test("Closed shows merged and closed PRs, each marked", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.deepEqual(prIds(v), [4, 5]);
  const icons = (id) => all(byId(v.render(), id), (e) => e.kind === "svg").map((e) => e.arg);
  assert.ok(icons("gh-pr-4").includes("mods/github/pr-merged.svg"));
  assert.ok(icons("gh-pr-5").includes("mods/github/pr-closed.svg"));
});

test("Mine, Review requested and the search narrow the list", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-mine");
  assert.deepEqual(prIds(v), [1]);
  click(v, cx, "gh-review");
  assert.deepEqual(prIds(v), [2]);
  click(v, cx, "gh-all");
  v.input.type("installer", cx);
  assert.deepEqual(prIds(v), [3]);
});

test("the view choices are remembered", async () => {
  const first = await mount();
  click(first.v, first.cx, "gh-review");
  click(first.v, first.cx, "gh-closed");
  const { v } = await mount();
  assert.equal(byId(v.render(), "gh-review").props.bg, host.theme.selected);
  assert.equal(byId(v.render(), "gh-closed").props.bg, host.theme.selected);
});

test("clicking a PR shows it in the detail block", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-pr-2");
  assert.deepEqual(host.shared[DETAIL_KEY], { repo: REPO, kind: "pr", id: 2 });
  assert.deepEqual(host.ran("layout.show"), [{ id: "github-detail" }]);
});

test("a PR whose branch has a space links to it; one without offers a worktree", async () => {
  host.agents = [{ address: "a2", pane: "p2", space: "s2", status: "working", program: { name: "Claude Code" } }];
  const { v, cx } = await mount();
  assert.match(text(byId(v.render(), "gh-space-2")), /working/);
  click(v, cx, "gh-space-2");
  assert.deepEqual(host.ran("space.select"), [{ id: "s2" }]);
  assert.equal(host.shared[DETAIL_KEY], undefined, "the chip doesn't open the PR");
  click(v, cx, "gh-wt-1");
  await cx.settle();
  assert.ok(host.execs.some(([cmd, args, o]) => cmd === "git" && args.join(" ") === "fetch origin feature/prd-1:feature/prd-1" && o.cwd === "/r/basecamp"),
    "the PR's branch is fetched first, so the worktree gets its commits");
  assert.deepEqual(host.overlays.at(-1).props, { folder: "/r/basecamp", action: "new", branch: "feature/prd-1" });
});

test("a PR from a fork offers no worktree (its branch isn't on origin)", async () => {
  gh.open = [pr(9, "From a fork", { isCrossRepository: true })];
  const { v } = await mount();
  assert.equal(byId(v.render(), "gh-wt-9"), null);
});

test("switching to a space on another repo shows that repo's PRs", async () => {
  host.spaces.push({ id: "s4", name: "site", folder: "/w/site", machine: null, branch: "main", tabs: [] });
  const { v, cx } = await mount();
  host.spaces[0].active = false;
  host.spaces[3].active = true;
  await cx.tick();
  await cx.settle();
  assert.deepEqual(prIds(v), [77]);
  assert.match(text(v.render()), /sherpas-team\/website/);
});

test("a space that isn't a GitHub repo says so, and asks gh nothing", async () => {
  host.spaces[0].active = false;
  host.spaces[2].active = true;
  const { v } = await mount();
  assert.match(text(v.render()), /isn't a GitHub repo/);
  assert.equal(ran("pr list").length, 0);
});

test("gh's error is shown, not thrown", async () => {
  gh.fail = "HTTP 401: Bad credentials (https://api.github.com/graphql)";
  const { v } = await mount();
  assert.match(text(v.render()), /Couldn't load: HTTP 401: Bad credentials/);
});

// ---- Actions

const navIds = (v) => all(v.render(), (e) => /^gh-nav-/.test(String(e.props.id))).map((e) => e.props.id);
const runIds = (v) => all(v.render(), (e) => /^gh-run-\d+$/.test(String(e.props.id))).map((e) => Number(e.props.id.slice(7)));
const lastRunsCall = () => ran("api repos/").filter((a) => a[1].includes("/runs?")).at(-1)?.[1];
async function actions() {
  const m = await mount();
  click(m.v, m.cx, "gh-actions");
  await m.cx.settle();
  return m;
}

test("Actions: a side nav lists All and the repo's active workflows by name", async () => {
  const { v } = await actions();
  assert.deepEqual(navIds(v), ["gh-nav-*", "gh-nav-1", "gh-nav-2", "gh-nav-3"], "All, CI, Deploy, Lint; not the disabled one");
  assert.match(text(byId(v.render(), "gh-nav-1")), /CI/);
  assert.equal(byId(v.render(), "gh-nav-*").props.bg, host.theme.selected);
});

test("All shows every run on the page, newest first, each naming its workflow", async () => {
  const { v } = await actions();
  assert.deepEqual(runIds(v), [11, 12, 10, 16, 15, 14, 13]);
  assert.match(text(byId(v.render(), "gh-run-12")), /CI.*feature\/prd-1.*pull_request/);
  const icons = (id) => all(byId(v.render(), id), (e) => e.kind === "svg").map((e) => e.arg);
  assert.ok(icons("gh-run-12").includes("mods/github/check-failure.svg"));
  assert.ok(icons("gh-run-11").includes("mods/workspace-chrome/spinner.svg"), "running spins");
});

test("picking a workflow asks GitHub for that workflow's runs, and is remembered for the repo", async () => {
  const first = await actions();
  click(first.v, first.cx, "gh-nav-1");
  await first.cx.settle();
  assert.equal(lastRunsCall(), `repos/${REPO}/actions/workflows/1/runs?per_page=30&page=1`);
  assert.deepEqual(runIds(first.v), [12, 10, 16, 15, 14, 13]);
  const { v } = await actions();
  assert.equal(lastRunsCall(), `repos/${REPO}/actions/workflows/1/runs?per_page=30&page=1`);
  assert.equal(byId(v.render(), "gh-nav-1").props.bg, host.theme.selected);
});

test("a workflow pages through its own runs, and another workflow starts at page 1", async () => {
  gh.runs = Array.from({ length: 75 }, (_, i) => wr(900 - i, "CI", new Date(Date.UTC(2026, 10, 6, 12) - i * 60000).toISOString()));
  const { v, cx } = await actions();
  click(v, cx, "gh-nav-1");
  await cx.settle();
  assert.equal(pager(v), "Page 1 of 3");
  click(v, cx, "gh-page-next");
  await cx.settle();
  assert.equal(lastRunsCall(), `repos/${REPO}/actions/workflows/1/runs?per_page=30&page=2`);
  click(v, cx, "gh-nav-2");
  await cx.settle();
  assert.equal(lastRunsCall(), `repos/${REPO}/actions/workflows/2/runs?per_page=30&page=1`);
});

test("the search on top narrows the nav's workflows and the page's runs", async () => {
  const { v, cx } = await actions();
  v.runSearch.type("dep", cx);
  assert.deepEqual(navIds(v), ["gh-nav-*", "gh-nav-2"]);
  assert.deepEqual(runIds(v), [11]);
  v.runSearch.type("#12", cx);
  assert.deepEqual(runIds(v), [12]);
  v.runSearch.type("prd-1", cx);
  assert.deepEqual(runIds(v), [12], "branches match");
  v.runSearch.type("zzz", cx);
  assert.match(text(v.render()), /Nothing on this page matches/);
});

test("a remembered workflow that's gone falls back to All", async () => {
  localStorage.setItem("workflow", JSON.stringify({ [REPO]: 404 }));
  const { v } = await actions();
  assert.equal(lastRunsCall(), `repos/${REPO}/actions/runs?per_page=30&page=1`);
  assert.equal(byId(v.render(), "gh-nav-*").props.bg, host.theme.selected);
});

test("clicking a run shows it in the detail block", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-actions");
  await cx.settle();
  click(v, cx, "gh-run-12");
  assert.deepEqual(host.shared[DETAIL_KEY], { repo: REPO, kind: "run", id: 12 });
});

// ---- alerts

test("a refresh that finds CI failed on my PR, or a review, posts a toast that opens the PR", async () => {
  const { v, cx } = await mount();
  gh.open = gh.open.map((p) => (p.number === 1 ? { ...p, statusCheckRollup: [check("FAILURE")],
    latestReviews: [{ author: { login: "lee" }, state: "APPROVED", submittedAt: "2026-11-06T08:00:00Z" }] } : p));
  await cx.tick();
  await cx.settle();
  assert.deepEqual(host.notices.map((n) => [n.title, n.level]), [["CI failed on #1", "error"], ["lee approved #1", "success"]]);
  assert.deepEqual(host.notices[0].action, { name: "github.pr:1" });
  host.command("pr:1");
  await cx.settle();
  assert.deepEqual(host.shared[DETAIL_KEY], { repo: REPO, kind: "pr", id: 1 });
  assert.ok(host.ran("layout.show").some((a) => a.id === "github-detail"));
  assert.ok(host.ran("layout.select").some((a) => a.child === "github"), "the GitHub panel comes forward");
  assert.ok(v);
});

test("the first look at a repo posts nothing", async () => {
  gh.open = [pr(1, "Red already", { author: { login: "me" }, statusCheckRollup: [check("FAILURE")] })];
  await mount();
  assert.deepEqual(host.notices, []);
});

// ---- the detail view (this mod with props { view: "detail" })

const view = (extra = {}) => ({
  ...pr(1, "Fix login redirect (PRD-10378)", { author: { login: "me" } }),
  body: "<!-- linear-linkback -->\n<p>Fixes the <b>redirect</b>.</p>",
  createdAt: "2026-11-05T07:00:00Z", additions: 120, deletions: 8, changedFiles: 3,
  files: [{ path: "src/login.ts", additions: 100, deletions: 8 }, { path: "src/a.ts", additions: 10, deletions: 0 }, { path: "src/b.ts", additions: 10, deletions: 0 }],
  labels: [{ name: "FE", color: "E8B171" }],
  latestReviews: [{ author: { login: "lee" }, state: "APPROVED", submittedAt: "2026-11-06T08:00:00Z" }],
  reviewRequests: [{ login: "park" }],
  statusCheckRollup: [check("SUCCESS"), { ...check("FAILURE"), name: "lint" }],
  comments: [{ author: { login: "lee" }, body: "LGTM", createdAt: new Date(Date.now() - 20000).toISOString() }], // 20s ago: "just now"
  ...extra,
});
async function detail(shown) {
  host.shared[DETAIL_KEY] = shown;
  const m = await mount({ view: "detail" });
  await m.cx.tick();
  await m.cx.settle();
  return m;
}

test("a PR's detail: title, state, branches, reviews, checks, changes, labels, the body as markdown, comments", async () => {
  gh.view = view();
  const { v } = await detail({ repo: REPO, kind: "pr", id: 1 });
  const all_ = text(v.render());
  for (const want of [/Fix login redirect/, /feature\/prd-1 → main/, /lee.*approved/i, /park.*pending/i, /\+120.*−8.*3 files/, /FE/, /lint/, /lee · just now/]) {
    assert.match(all_, want);
  }
  const md = all(v.render(), (e) => e.kind === "text_view").map((e) => e.arg[1]);
  assert.deepEqual(md, ["Fixes the redirect.", "LGTM"], "the body (HTML from bots cleaned) and the comment, as markdown");
  assert.doesNotMatch(all_, /now ago/);
  const [call] = ran("pr view");
  assert.deepEqual(call.slice(0, 4), ["pr", "view", "1", "-R"]);
});

test("the Linear issue in a PR's title opens in the Linear panel", async () => {
  gh.view = view();
  host.shared["linear.workflowStates"] = { at: 1, nodes: [{ team: { key: "PRD" } }] };
  const { v, cx } = await detail({ repo: REPO, kind: "pr", id: 1 });
  click(v, cx, "ghd-linear-PRD-10378");
  assert.equal(host.shared["linear.detail"], "PRD-10378");
  assert.ok(host.ran("layout.select").some((a) => a.child === "linear"));
  assert.ok(host.ran("layout.show").some((a) => a.id === "linear-detail"));
});

test("the detail goes to the PR's space, or makes a worktree for it", async () => {
  gh.view = view({ number: 2, headRefName: "feature/prd-2" });
  let m = await detail({ repo: REPO, kind: "pr", id: 2 });
  click(m.v, m.cx, "ghd-space");
  assert.deepEqual(host.ran("space.select"), [{ id: "s2" }]);
  gh.view = view();
  m = await detail({ repo: REPO, kind: "pr", id: 1 });
  click(m.v, m.cx, "ghd-worktree");
  await m.cx.settle();
  assert.deepEqual(host.overlays.at(-1).props, { folder: "/r/basecamp", action: "new", branch: "feature/prd-1" });
});

const runView = (extra = {}) => ({
  databaseId: 12, workflowName: "CI", displayTitle: "Fix login", status: "completed", conclusion: "failure", event: "pull_request",
  headBranch: "feature/prd-1", attempt: 1, url: `https://github.com/${REPO}/actions/runs/12`,
  createdAt: "2026-11-06T02:00:00Z", startedAt: "2026-11-06T02:00:00Z", updatedAt: "2026-11-06T02:03:20Z",
  jobs: [
    { databaseId: 1, name: "build", status: "completed", conclusion: "success", startedAt: "2026-11-06T02:00:00Z", completedAt: "2026-11-06T02:01:00Z",
      steps: [{ number: 1, name: "Checkout", status: "completed", conclusion: "success" }] },
    { databaseId: 2, name: "test", status: "completed", conclusion: "failure", startedAt: "2026-11-06T02:01:00Z", completedAt: "2026-11-06T02:03:20Z",
      steps: [{ number: 1, name: "Run tests", status: "completed", conclusion: "failure" }] },
  ],
  ...extra,
});

test("a run's detail: its jobs, each opening to its steps", async () => {
  gh.run = runView();
  const { v, cx } = await detail({ repo: REPO, kind: "run", id: 12 });
  const root = v.render();
  assert.match(text(root), /CI.*Fix login/);
  assert.match(text(byId(root, "ghd-job-2")), /test.*2m 20s/);
  assert.doesNotMatch(text(root), /Run tests/);
  click(v, cx, "ghd-job-2");
  assert.match(text(v.render()), /Run tests/);
});

test("a failed run shows its failed log's tail, without gh's column prefixes or colors", async () => {
  gh.run = runView();
  gh.log = Array.from({ length: 200 }, (_, i) => `test\tRun tests\t2026-11-06T02:02:00Z \u001b[31mline ${i}\u001b[0m`).join("\n");
  const { v, cx } = await detail({ repo: REPO, kind: "run", id: 12 });
  click(v, cx, "ghd-log");
  await cx.settle();
  const log = text(byId(v.render(), "ghd-log-text"));
  assert.match(log, /line 199/);
  assert.doesNotMatch(log, /line 50\b/, "only the tail");
  assert.doesNotMatch(log, /\u001b|Run tests\t/);
  assert.deepEqual(ran("run view 12").at(-1).filter((a) => a === "--log-failed"), ["--log-failed"]);
});

test("Re-run failed jobs asks gh to rerun them; a running run can be canceled", async () => {
  gh.run = runView();
  let m = await detail({ repo: REPO, kind: "run", id: 12 });
  click(m.v, m.cx, "ghd-rerun");
  await m.cx.settle();
  assert.deepEqual(ran("run rerun").at(-1), ["run", "rerun", "12", "--failed", "-R", REPO]);
  assert.equal(byId(m.v.render(), "ghd-cancel"), null, "a finished run can't be canceled");
  gh.run = runView({ status: "in_progress", conclusion: "" });
  details.get(`run|${REPO}|12`).at -= 2 * 60 * 1000; // a while later
  m = await detail({ repo: REPO, kind: "run", id: 12 });
  assert.equal(byId(m.v.render(), "ghd-rerun"), null);
  click(m.v, m.cx, "ghd-cancel");
  await m.cx.settle();
  assert.deepEqual(ran("run cancel").at(-1), ["run", "cancel", "12", "-R", REPO]);
});

test("the detail follows what's picked, and ✕ hides it", async () => {
  gh.view = view();
  const { v, cx } = await detail({ repo: REPO, kind: "pr", id: 1 });
  gh.run = runView();
  host.shared[DETAIL_KEY] = { repo: REPO, kind: "run", id: 12 };
  await cx.tick();
  await cx.settle();
  assert.match(text(v.render()), /Run tests|test/);
  click(v, cx, "ghd-close");
  assert.equal(host.shared[DETAIL_KEY], null);
  assert.deepEqual(host.ran("layout.hide"), [{ id: "github-detail" }]);
});

test("a slow answer for the previous repo doesn't replace the new repo's list", async () => {
  host.spaces.push({ id: "s4", name: "site", folder: "/w/site", machine: null, branch: "main", tabs: [] });
  let release;
  const held = new Promise((r) => { release = r; });
  const answer = host.exec;
  host.exec = async (cmd, args, opts) => {
    if (cmd.endsWith("gh") && args[0] === "pr" && args.includes(REPO)) await held; // basecamp's PRs come late
    return answer(cmd, args, opts);
  };
  const { v, cx } = await mount();
  host.spaces[0].active = false;
  host.spaces[3].active = true;
  await cx.tick();
  await cx.settle();
  assert.deepEqual(prIds(v), [77]);
  release();
  await cx.settle();
  assert.deepEqual(prIds(v), [77], "basecamp's late answer is dropped");
  assert.match(text(v.render()), /sherpas-team\/website/);
});

test("a PR with no checks at all still draws (no check icon)", async () => {
  gh.open = [pr(8, "No CI here", { statusCheckRollup: [] })];
  const { v } = await mount();
  assert.deepEqual(prIds(v), [8]);
  assert.ok(!all(byId(v.render(), "gh-pr-8"), (e) => e.kind === "svg").some((e) => /check-/.test(e.arg)));
});

// ---- pages: closed PRs (25 a page, cursors) and runs (30 a page, numbers)

const many = (n, from = 1000) => Array.from({ length: n }, (_, i) => pr(from - i, `Closed ${from - i}`, { state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" }));
const pager = (v) => text(byId(v.render(), "gh-page-label"));
const searches = () => ran("api graphql").map((a) => Object.fromEntries(a.filter((x) => /^(q|after)=/.test(x)).map((x) => x.split(/=(.*)/s).slice(0, 2))));

test("Closed shows 25 PRs a page; Older and Newer walk the pages", async () => {
  gh.closed = many(60);
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.deepEqual(prIds(v).slice(0, 2), [1000, 999]);
  assert.equal(prIds(v).length, 25);
  assert.equal(pager(v), "Page 1 of 3");
  assert.equal(byId(v.render(), "gh-page-prev").handlers.on_click, undefined, "no newer page than the first");
  click(v, cx, "gh-page-next");
  await cx.settle();
  assert.deepEqual(prIds(v).slice(0, 1), [975]);
  assert.equal(pager(v), "Page 2 of 3");
  assert.equal(searches().at(-1).after, "c25", "the next page starts after the last cursor");
  click(v, cx, "gh-page-next");
  await cx.settle();
  assert.equal(prIds(v).length, 10);
  assert.equal(byId(v.render(), "gh-page-next").handlers.on_click, undefined, "no older page than the last");
  click(v, cx, "gh-page-prev");
  await cx.settle();
  assert.deepEqual(prIds(v).slice(0, 1), [975]);
  assert.equal(pager(v), "Page 2 of 3");
});

test("Closed's filter and search run on GitHub (every page), and start again from page 1", async () => {
  gh.closed = [...many(30), pr(1, "Mine, closed", { state: "CLOSED", author: { login: "me" } })];
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  click(v, cx, "gh-page-next");
  await cx.settle();
  click(v, cx, "gh-mine");
  await cx.settle();
  assert.match(searches().at(-1).q, /author:@me/);
  assert.equal(searches().at(-1).after, undefined, "back to the first page");
  assert.deepEqual(prIds(v), [1]);
  assert.equal(pager(v), "Page 1 of 1");
  v.input.type("redirect", cx);
  await cx.flush();
  assert.match(searches().at(-1).q, /author:@me redirect$/);
});

test("on Closed, the review filter is the PRs you reviewed", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.match(text(byId(v.render(), "gh-review")), /Reviewed by me/);
  click(v, cx, "gh-review");
  await cx.settle();
  assert.match(searches().at(-1).q, /reviewed-by:@me/);
  click(v, cx, "gh-open");
  assert.match(text(byId(v.render(), "gh-review")), /Review requested/);
});

test("Closed counts at most GitHub's 1000 search results", async () => {
  gh.closed = many(30);
  gh.closedTotal = 7976;
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.equal(pager(v), "Page 1 of 40");
});

const runsAt = (n) => Array.from({ length: n }, (_, i) => wr(500 - i, ["CI", "Lint", "Deploy"][i % 3], new Date(Date.UTC(2026, 10, 6, 12) - i * 60000).toISOString()));
const runPages = () => ran("api repos/").filter((a) => a[1].includes("/runs?")).map((a) => Number(a[1].match(/page=(\d+)$/)[1]));

test("Actions shows 30 runs a page, and pages by number", async () => {
  gh.runs = runsAt(75);
  const { v, cx } = await mount();
  click(v, cx, "gh-actions");
  await cx.settle();
  assert.match(ran("api repos/").filter((a) => a[1].includes("/runs?"))[0][1], /^repos\/sherpas-team\/basecamp\/actions\/runs\?per_page=30&page=1$/);
  assert.equal(pager(v), "Page 1 of 3");
  click(v, cx, "gh-page-next");
  await cx.settle();
  assert.deepEqual(runPages().slice(-1), [2]);
  assert.equal(pager(v), "Page 2 of 3");
  // Page 2's newest run is the 31st: run 470.
  assert.ok(byId(v.render(), "gh-run-470"));
  assert.equal(byId(v.render(), "gh-run-500"), null);
});

test("a run list as long as basecamp's counts at most 1000 runs", async () => {
  gh.runs = runsAt(30);
  gh.runsTotal = 40000;
  const { v, cx } = await mount();
  click(v, cx, "gh-actions");
  await cx.settle();
  assert.equal(pager(v), "Page 1 of 34");
});

test("a refresh fetches the page being looked at, and another space's repo starts on page 1", async () => {
  gh.runs = runsAt(75);
  host.spaces.push({ id: "s4", name: "site", folder: "/w/site", machine: null, branch: "main", tabs: [] });
  const { v, cx } = await mount();
  click(v, cx, "gh-actions");
  await cx.settle();
  click(v, cx, "gh-page-next");
  await cx.settle();
  click(v, cx, "gh-refresh");
  await cx.settle();
  assert.deepEqual(runPages().slice(-1), [2]);
  host.spaces[0].active = false;
  host.spaces[3].active = true;
  await cx.tick();
  await cx.settle();
  assert.deepEqual(runPages().slice(-1), [1]);
});

test("pressing Older again while a page loads moves on from the page that's coming", async () => {
  gh.runs = runsAt(95);
  const { v, cx } = await mount();
  click(v, cx, "gh-actions");
  await cx.settle();
  // Page 2 is slow: page 3 arrives first, then page 2 must not replace it.
  let release;
  const held = new Promise((r) => { release = r; });
  const answer = host.exec;
  host.exec = async (cmd, args, opts) => {
    if (String(args[1]).endsWith("page=2")) await held;
    return answer(cmd, args, opts);
  };
  click(v, cx, "gh-page-next");
  click(v, cx, "gh-page-next");
  await cx.settle();
  release();
  await cx.settle();
  assert.deepEqual(runPages().sort(), [1, 2, 3], "each click asks for its own page (page 2's call is logged when it's answered)");
  assert.equal(pager(v), "Page 3 of 4");
  assert.ok(byId(v.render(), "gh-run-440"), "page 3's runs, not page 2's arriving late");
});

test("a filter or search set on Open applies when you switch to Closed", async () => {
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  click(v, cx, "gh-open");
  click(v, cx, "gh-mine");
  v.input.type("redirect", cx);
  await cx.flush();
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.match(searches().at(-1).q, /author:@me redirect$/);
});

test("while searching, the picked workflow stays in the nav, marked", async () => {
  const { v, cx } = await actions();
  click(v, cx, "gh-nav-1");
  await cx.settle();
  v.runSearch.type("dep", cx);
  assert.deepEqual(navIds(v), ["gh-nav-*", "gh-nav-1", "gh-nav-2"]);
  assert.equal(byId(v.render(), "gh-nav-1").props.bg, host.theme.selected);
});

test("the workflow nav is resizable by its edge, and keeps its width", async () => {
  const first = await actions();
  const w = () => byId(first.v.render(), "gh-nav").props.w;
  const start = w();
  byId(first.v.render(), "gh-nav/resize").handlers["on_mouse_down:left"](mouse(400, 50), first.cx);
  byId(first.v.render(), "gh-nav/pane").handlers.on_mouse_move(mouse(440, 50), first.cx);
  byId(first.v.render(), "gh-nav/pane").handlers["on_mouse_up:left"](mouse(440, 50), first.cx);
  assert.equal(w(), start + 40);
  const { v } = await actions();
  assert.equal(byId(v.render(), "gh-nav").props.w, start + 40);
});

// ---- the Actions cache: a page seen in the last minute shows without asking GitHub
const runsCalls = () => ran("api repos/").filter((a) => a[1].includes("/runs?")).length;
const age = (key, ms) => { host.shared["github.cache"][key].at -= ms; };

test("going back to a workflow seen a moment ago shows it at once, without asking GitHub", async () => {
  const { v, cx } = await actions();
  click(v, cx, "gh-nav-1");
  await cx.settle();
  const asked = runsCalls();
  click(v, cx, "gh-nav-*");
  assert.deepEqual(runIds(v), [11, 12, 10, 16, 15, 14, 13], "All, straight from the cache");
  click(v, cx, "gh-nav-1");
  assert.deepEqual(runIds(v), [12, 10, 16, 15, 14, 13]);
  await cx.settle();
  assert.equal(runsCalls(), asked, "no new requests");
});

test("a cached page older than a minute shows at once, then refreshes", async () => {
  const { v, cx } = await actions();
  click(v, cx, "gh-nav-1");
  await cx.settle();
  age(`runs|${REPO}|1|1`, 2 * 60 * 1000);
  gh.runs = [wr(99, "CI", "2026-11-06T09:00:00Z"), ...gh.runs];
  const asked = runsCalls();
  click(v, cx, "gh-nav-*");
  await cx.settle();
  click(v, cx, "gh-nav-1");
  assert.deepEqual(runIds(v), [12, 10, 16, 15, 14, 13], "the old answer first");
  await cx.settle();
  assert.equal(runsCalls(), asked + 1, "only the stale page is asked again");
  assert.deepEqual(runIds(v).slice(0, 1), [99]);
});

test("paging back to a page seen a moment ago doesn't ask GitHub", async () => {
  gh.runs = runsAt(75);
  const { v, cx } = await actions();
  click(v, cx, "gh-page-next");
  await cx.settle();
  const asked = runsCalls();
  click(v, cx, "gh-page-prev");
  assert.equal(pager(v), "Page 1 of 3");
  assert.ok(byId(v.render(), "gh-run-500"));
  await cx.settle();
  assert.equal(runsCalls(), asked);
});

test("↻ asks GitHub again even when the page is fresh", async () => {
  const { v, cx } = await actions();
  const asked = runsCalls();
  click(v, cx, "gh-refresh");
  await cx.settle();
  assert.equal(runsCalls(), asked + 1);
});

test("a slow answer for the workflow left behind doesn't replace one shown from the cache", async () => {
  const { v, cx } = await actions();
  click(v, cx, "gh-nav-2");
  await cx.settle();
  age(`runs|${REPO}|*|1`, 2 * 60 * 1000); // so going to All asks GitHub (slowly)
  let release;
  const held = new Promise((r) => { release = r; });
  const answer = host.exec;
  host.exec = async (cmd, args, opts) => {
    if (String(args[1]).includes("/actions/runs?")) await held;
    return answer(cmd, args, opts);
  };
  click(v, cx, "gh-nav-*");
  click(v, cx, "gh-nav-2"); // fresh in the cache
  release();
  await cx.settle();
  assert.deepEqual(runIds(v), [11], "Deploy's runs, not All's");
  assert.equal(byId(v.render(), "gh-nav-2").props.bg, host.theme.selected);
});

test("the cache outlives the panel: opened again, Actions shows at once and the workflow list isn't asked for", async () => {
  await actions();
  const workflowsAsked = ran("api repos/").filter((a) => a[1].includes("/workflows?")).length;
  const asked = runsCalls();
  const { v } = await actions();
  assert.deepEqual(navIds(v), ["gh-nav-*", "gh-nav-1", "gh-nav-2", "gh-nav-3"]);
  assert.deepEqual(runIds(v).slice(0, 1), [11]);
  assert.equal(ran("api repos/").filter((a) => a[1].includes("/workflows?")).length, workflowsAsked);
  assert.equal(runsCalls(), asked);
});

// ---- more of the cache: open PRs per repo, your login, closed pages, details
const prListCalls = () => ran("pr list").length;
const userCalls = () => ran("api user").length;
const closedCalls = () => ran("api graphql").length;

test("switching back to a repo seen a moment ago shows its open PRs at once, without asking", async () => {
  host.spaces.push({ id: "s4", name: "site", folder: "/w/site", machine: null, branch: "main", tabs: [] });
  const { v, cx } = await mount();
  // Only the 1-second check for a space switch (cx.tick would run the poll too, which always asks).
  const go = async (i) => {
    host.spaces.forEach((s, n) => { s.active = n === i; });
    cx.timers.find((t) => t.every && t.ms === 1000).fn(cx);
    await cx.settle();
  };
  await go(3);
  await cx.settle();
  const asked = prListCalls();
  await go(0);
  assert.deepEqual(prIds(v), [1, 2, 3], "basecamp's PRs, straight away");
  await cx.settle();
  assert.equal(prListCalls(), asked);
});

test("open PRs cached over a minute ago show at once, then refresh; the poll always asks", async () => {
  const first = await mount();
  host.shared["github.cache"][`open|${REPO}`].at -= 2 * 60 * 1000;
  gh.open = [pr(50, "Newer PR")];
  const asked = prListCalls();
  const { v, cx } = await mount();
  assert.equal(prListCalls(), asked + 1);
  assert.deepEqual(prIds(v), [50]);
  await cx.tick(); // the poll
  await cx.settle();
  assert.equal(prListCalls(), asked + 2);
  assert.ok(first);
});

test("a PR list from the cache isn't news: no toasts on opening the panel", async () => {
  gh.open = [pr(1, "Mine", { author: { login: "me" } })];
  await mount();
  host.shared["github.cache"][`open|${REPO}`].at -= 2 * 60 * 1000;
  gh.open = [pr(1, "Mine", { author: { login: "me" }, statusCheckRollup: [check("FAILURE")] })];
  await mount();
  assert.deepEqual(host.notices, []);
});

test("your GitHub login is asked once a day, not every time the panel opens", async () => {
  await mount();
  host.shared["github.cache"][`open|${REPO}`].at -= 2 * 60 * 1000; // so the PRs are fetched again, login and all
  const asked = prListCalls();
  await mount();
  assert.equal(prListCalls(), asked + 1);
  assert.equal(userCalls(), 1);
});

test("reopened on Closed, a stale page 2 is fetched from page 1's cached cursor", async () => {
  gh.closed = many(60);
  const first = await mount();
  click(first.v, first.cx, "gh-closed");
  await first.cx.settle();
  click(first.v, first.cx, "gh-page-next");
  await first.cx.settle();
  const page2 = Object.keys(host.shared["github.cache"]).find((k) => k.startsWith("closed|") && k.endsWith("|1"));
  host.shared["github.cache"][page2].at -= 2 * 60 * 1000;
  const { v, cx } = await mount(); // Closed is remembered; page 1 comes from the cache
  click(v, cx, "gh-page-next");
  await cx.settle();
  assert.equal(searches().at(-1).after, "c25");
  assert.deepEqual(prIds(v).slice(0, 1), [975]);
});

test("going back a page of closed PRs, or back to Closed, shows it at once", async () => {
  gh.closed = many(60);
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  click(v, cx, "gh-page-next");
  await cx.settle();
  const asked = closedCalls();
  click(v, cx, "gh-page-prev");
  assert.deepEqual(prIds(v).slice(0, 1), [1000]);
  click(v, cx, "gh-page-next");
  assert.deepEqual(prIds(v).slice(0, 1), [975], "page 2 too, cursor and all");
  click(v, cx, "gh-open");
  click(v, cx, "gh-closed");
  await cx.settle();
  assert.equal(closedCalls(), asked);
  assert.equal(pager(v), "Page 2 of 3");
});

test("a new closed-PR search isn't served from another search's cache", async () => {
  gh.closed = [...many(3), pr(1, "Mine, closed", { state: "CLOSED", author: { login: "me" } })];
  const { v, cx } = await mount();
  click(v, cx, "gh-closed");
  await cx.settle();
  click(v, cx, "gh-mine");
  await cx.settle();
  assert.deepEqual(prIds(v), [1]);
  click(v, cx, "gh-all");
  await cx.settle();
  assert.equal(prIds(v).length, 4);
});

test("a PR's detail seen a moment ago shows at once without asking; ↻ asks again", async () => {
  gh.view = view();
  await detail({ repo: REPO, kind: "pr", id: 1 });
  const asked = ran("pr view").length;
  const { v, cx } = await detail({ repo: REPO, kind: "pr", id: 1 });
  assert.match(text(v.render()), /Fix login redirect/);
  assert.equal(ran("pr view").length, asked);
  click(v, cx, "ghd-reload");
  await cx.settle();
  assert.equal(ran("pr view").length, asked + 1);
});

test("a run still going is always asked again; a finished one comes from the cache", async () => {
  gh.run = runView({ status: "in_progress", conclusion: "" });
  await detail({ repo: REPO, kind: "run", id: 12 });
  await detail({ repo: REPO, kind: "run", id: 12 });
  assert.equal(ran("run view 12").length, 2);
  gh.run = runView();
  await detail({ repo: REPO, kind: "run", id: 12 });
  await detail({ repo: REPO, kind: "run", id: 12 });
  assert.equal(ran("run view 12").length, 3);
});

test("the cached PR list is slim: each PR's checks summed up, not every check", async () => {
  gh.open = [pr(1, "Many checks", { statusCheckRollup: Array.from({ length: 40 }, () => check("SUCCESS")).concat([check("FAILURE")]) })];
  await mount();
  const [cachedPr] = host.shared["github.cache"][`open|${REPO}`].data;
  assert.equal(cachedPr.statusCheckRollup, undefined);
  assert.equal(cachedPr.checks, "failure");
  const { v } = await mount(); // drawn from the cache
  const icons = all(byId(v.render(), "gh-pr-1"), (e) => e.kind === "svg").map((e) => e.arg);
  assert.ok(icons.includes("mods/github/check-failure.svg"));
});

test("details stay out of shared.json (they're big): kept in memory", async () => {
  gh.view = view();
  await detail({ repo: REPO, kind: "pr", id: 1 });
  assert.equal(host.shared["github.details"], undefined);
  assert.ok(details.get(`pr|${REPO}|1`));
});

// ---- a PR's checks and files are folded to three, so the description is near the top
const manyChecks = () => [...Array.from({ length: 38 }, (_, i) => ({ ...check("SUCCESS"), name: `ok-${i}` })),
  { ...check("FAILURE"), name: "lint" }, { ...check("FAILURE"), name: "e2e" }];
const manyFiles = () => Array.from({ length: 15 }, (_, i) => ({ path: `src/f${i}.ts`, additions: 1, deletions: 0 }));
const checkRows = (v) => all(v.render(), (e) => /^ghd-check-\d+$/.test(String(e.props.id))).length;
const fileRows = (v) => all(v.render(), (e) => /^ghd-file-\d+$/.test(String(e.props.id))).length;

test("a PR's checks and files show three each until Show more", async () => {
  gh.view = view({ statusCheckRollup: manyChecks(), files: manyFiles(), changedFiles: 15 });
  const { v, cx } = await detail({ repo: REPO, kind: "pr", id: 1 });
  assert.equal(checkRows(v), 3);
  assert.equal(fileRows(v), 3);
  const shown = text(byId(v.render(), "ghd-checks"));
  assert.match(shown, /lint.*e2e/, "failing checks come first, so they're in view");
  assert.match(text(byId(v.render(), "ghd-checks-more")), /Show 37 more/);
  assert.match(text(byId(v.render(), "ghd-files-more")), /Show 12 more/);
  click(v, cx, "ghd-checks-more");
  assert.equal(checkRows(v), 40);
  assert.equal(fileRows(v), 3, "each opens on its own");
  assert.match(text(byId(v.render(), "ghd-checks-more")), /Show less/);
  click(v, cx, "ghd-checks-more");
  assert.equal(checkRows(v), 3);
  click(v, cx, "ghd-files-more");
  assert.equal(fileRows(v), 15);
});

test("three or fewer checks or files need no Show more", async () => {
  gh.view = view();
  const { v } = await detail({ repo: REPO, kind: "pr", id: 1 });
  assert.equal(checkRows(v), 2);
  assert.equal(byId(v.render(), "ghd-checks-more"), null);
  assert.equal(byId(v.render(), "ghd-files-more"), null);
});

test("another PR opens folded again", async () => {
  gh.view = view({ statusCheckRollup: manyChecks(), files: manyFiles(), changedFiles: 15 });
  const { v, cx } = await detail({ repo: REPO, kind: "pr", id: 1 });
  click(v, cx, "ghd-files-more");
  gh.view = view({ number: 2, statusCheckRollup: manyChecks(), files: manyFiles(), changedFiles: 15 });
  host.shared[DETAIL_KEY] = { repo: REPO, kind: "pr", id: 2 };
  await cx.tick();
  await cx.settle();
  assert.equal(fileRows(v), 3);
});
