// GitHub panel: the pull requests and Actions runs of the active space's repo
// (its folder's origin), through the gh CLI. Pull requests: Open or Closed,
// All / Mine / Review requested, and a search. Actions: runs grouped by
// workflow. Clicking one shows it in the detail block below (detail.js: this
// mod again, props { view: "detail" }). A PR whose branch has a space links to
// it; one without offers a worktree. Polling posts a toast when CI fails on
// your PR, someone reviews it, or someone asks for your review.
//
// Open PRs are one fetch (alerts need them all). Closed PRs (GitHub's search,
// 25 a page, filter and search on the server) and runs (the REST API, 30 a
// page) are paged: Newer / Older under the list.
//
// Commands (herdr-app do github.<command>): refresh, pr:<number>, run:<id>.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, layout, run, shared, setShared, theme, props, notify, nextCommand } from "herdr";
import { gh, errorText, repoOf, DETAIL_KEY, checkState, prState, runState, ago, took,
  spacesForBranch, filterPrs, alerts, reveal, makeWorktree, prIcon, stateIcon, iconButton, chip,
  PAGE, pageCount, CLOSED_SEARCH, closedQuery, fromRestRun, cached, remember, fresh, RUNS_TTL, WORKFLOWS_TTL, PRS_TTL, ME_TTL, slimPr } from "./common.js";
import { Detail } from "./detail.js";
import { searchBar, sideNav, navState } from "./sidenav.js";

const POLL_MS = 2 * 60 * 1000;
const PR_FIELDS = "number,title,author,isDraft,state,headRefName,baseRefName,reviewDecision,statusCheckRollup,"
  + "updatedAt,url,reviewRequests,latestReviews,isCrossRepository,mergedAt,closedAt";
const DETAIL_BLOCK = "github-detail";
const STATUS_WORDS = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}
const activeSpace = () => spaces().find((s) => s.active) ?? null;

export default class GitHubPanel extends View {
  init(_props, cx) {
    if (props()?.view === "detail") {
      this.detail = new Detail(cx, () => { setShared(DETAIL_KEY, null); run("layout.hide", { id: DETAIL_BLOCK }); });
      return;
    }
    this.where = undefined;  // the active space's folder@machine, to notice a switch
    this.space = null;
    this.repo = null;        // owner/repo, or null when the space isn't a GitHub repo
    this.resolving = false;
    this.me = null;
    this.open = null; this.closed = null; this.runs = null;
    this.busy = new Set();   // what's being fetched: "open" | "closed" | "runs"
    this.seq = {};           // per kind, the latest fetch: only its answer is used
    // Pages. Closed PRs page by cursor (cursors[i] starts page i), runs by number.
    this.closedPage = 0; this.cursors = [null]; this.closedTotal = 0; this.closedNext = false;
    this.runsPage = 1; this.runsTotal = 0;
    this.termSeq = 0;
    this.error = null;
    this.fetchedAt = null;
    this.seen = null;        // the last open PRs looked at, for alerts: { repo, prs }
    // View choices, kept across reloads.
    this.tab = load("tab", "prs");          // "prs" | "actions"
    this.state = load("state", "open");     // "open" | "closed"
    this.filter = load("filter", "all");    // "all" | "mine" | "review"
    // Actions: the repo's active workflows (by name), the one picked in the side
    // nav per repo ({ repo: id }; none: All), and the search over the page's runs.
    this.workflows = null;
    this.workflowPick = load("workflow", {});
    this.nav = navState(load("navWidth", 170));
    this.runTerm = "";
    this.runSearch = InputState.new({ placeholder: "Search workflows, and this page's runs" });
    this.runSearch.on("change", (_e, cx) => { this.runTerm = this.runSearch.value(); cx.notify(); });
    this.term = "";
    this.input = InputState.new({ placeholder: "Search #, title or branch" });
    this.input.on("change", (_e, cx) => {
      this.term = this.input.value();
      // Open PRs filter here at once; closed ones ask GitHub, after a pause in typing.
      if (this.state === "closed") {
        const n = ++this.termSeq;
        cx.timer.after(400, (cx) => { if (n === this.termSeq) this.firstClosed(cx); });
      }
      cx.notify();
    });

    this.follow(cx);
    cx.timer.every(1000, (cx) => this.follow(cx));
    cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand());
        const [name, arg] = c.split(":");
        if (name === "refresh") this.refresh(cx);
        else if ((name === "pr" || name === "run") && this.repo && arg) this.reveal(name, Number(arg));
        cx.notify();
      }
    });
  }

  // Notices the active space changing, and with it maybe the repo.
  follow(cx) {
    const s = activeSpace();
    const where = s ? `${s.folder}@${s.machine ?? ""}` : null;
    if (where === this.where) return;
    this.where = where;
    this.space = s;
    this.resolving = true;
    cx.spawn(async (cx) => {
      const repo = await repoOf(s);
      if (this.where !== where) return;
      this.resolving = false;
      if (repo !== this.repo) {
        this.repo = repo;
        this.open = this.closed = this.runs = this.workflows = null;
        this.closedPage = 0; this.cursors = [null]; this.closedTotal = 0; this.closedNext = false;
        this.runsPage = 1; this.runsTotal = 0;
        this.error = null;
        this.fetchedAt = null;
        this.busy.clear();
        this.refresh(cx, false); // the runs may be in the cache
      }
      cx.notify();
    });
  }

  // Fetches the open PRs (and alerts from them), and the closed PRs and runs
  // when they're shown or were fetched before. The poll and ↻ force the runs
  // past the cache; a repo switch takes what's cached.
  refresh(cx, force = true) {
    this.loadOpen(cx, force);
    if (this.state === "closed" || this.closed) this.loadClosed(cx, force);
    if (this.tab === "actions" || this.runs) this.loadRuns(cx, force);
  }

  // Open PRs: the cached list at once, asked again when it's over a minute old
  // (or `force`: the poll, ↻). Alerts only compare lists fetched while open.
  loadOpen(cx, force = false) {
    if (!this.repo) return;
    const hit = cached(`open|${this.repo}`);
    if (hit && !this.open) { this.open = hit.data; this.fetchedAt = hit.at; }
    if (force || !fresh(hit, PRS_TTL)) this.fetch("open", cx);
  }

  // The cache key for a page of closed PRs: the repo, the search, the page.
  closedKey(page = this.closedPage) {
    return `closed|${this.repo}|${closedQuery(this.repo, this.filter, this.term)}|${page}`;
  }

  // A page of closed PRs, like loadRuns: from the cache at once (with the
  // cursor to the next page), from GitHub when missing, stale or `force`.
  loadClosed(cx, force = false) {
    if (!this.repo) return;
    const hit = cached(this.closedKey());
    if (hit) {
      const { prs, total, next, cursor } = hit.data;
      this.closed = prs; this.closedTotal = total; this.closedNext = next;
      this.cursors[this.closedPage + 1] = cursor;
      this.closedQ = closedQuery(this.repo, this.filter, this.term);
    }
    if (force || !fresh(hit, PRS_TTL)) this.fetch("closed", cx);
    else { this.seq.closed = (this.seq.closed ?? 0) + 1; this.busy.delete("closed"); }
    cx.notify();
  }

  // The cache key for a page of runs: the repo, the workflow (or * for All), the page.
  runsKey(page = this.runsPage) {
    return `runs|${this.repo}|${this.pickedWorkflow()}|${page}`;
  }

  // Shows the runs page that's picked: from the cache at once when it's there,
  // and from GitHub when it isn't, or is over a minute old, or `force`.
  loadRuns(cx, force = false) {
    if (!this.repo) return;
    if (!this.workflows) {
      const w = cached(`workflows|${this.repo}`);
      if (fresh(w, WORKFLOWS_TTL)) this.workflows = w.data;
    }
    const hit = this.workflows ? cached(this.runsKey()) : null;
    if (hit) { this.runs = hit.data.runs; this.runsTotal = hit.data.total; }
    if (force || !fresh(hit, RUNS_TTL)) this.fetch("runs", cx);
    else {
      // Served from the cache: an answer still on its way for what was shown before must not replace it.
      this.seq.runs = (this.seq.runs ?? 0) + 1;
      this.busy.delete("runs");
    }
    cx.notify();
  }

  // Fetches what the current view needs and doesn't have yet.
  ensure(cx) {
    // Closed: also when the filter or search changed since its last page came.
    if (this.tab === "prs" && this.state === "closed" && this.closedQ !== closedQuery(this.repo, this.filter, this.term)) this.firstClosed(cx);
    if (this.tab === "actions" && !this.runs) this.loadRuns(cx);
  }

  // Fetches one kind; only the latest fetch of a kind is used, so a page that
  // arrives after the next was asked for is dropped.
  fetch(what, cx) {
    const repo = this.repo;
    if (!repo) return;
    const seq = (this.seq[what] = (this.seq[what] ?? 0) + 1);
    const current = () => this.repo === repo && this.seq[what] === seq;
    this.busy.add(what);
    cx.notify();
    // Asked now, while the page is the one just picked (get reads it before its first await).
    const pending = this.get(what, repo);
    pending.catch(() => {}); // handled below
    cx.spawn(async (cx) => {
      try {
        const apply = await pending;
        if (!current()) return;
        apply();
        this.error = null;
        this.fetchedAt = Date.now();
      } catch (e) {
        if (current()) this.error = errorText(e);
      } finally {
        if (current()) this.busy.delete(what);
        cx.notify();
      }
    });
  }

  // Asks gh for one kind; resolves to a function that puts the answer in place.
  // Reads the page and filter at once, before its first await.
  async get(what, repo) {
    if (what === "runs") {
      const page = this.runsPage, want = this.workflowPick[repo];
      // The workflows come first: a remembered pick only counts if it's still there.
      if (!this.workflows) {
        const d = await gh(["api", `repos/${repo}/actions/workflows?per_page=100`]);
        const flows = (d.workflows ?? []).filter((w) => w.state === "active").sort((a, b) => a.name.localeCompare(b.name))
          .map(({ id, name, state }) => ({ id, name, state }));
        remember(`workflows|${repo}`, flows);
        if (this.repo === repo) this.workflows = flows;
      }
      const wf = this.workflows?.some((w) => w.id === want) ? want : null;
      const d = await gh(["api", wf ? `repos/${repo}/actions/workflows/${wf}/runs?per_page=${PAGE.runs}&page=${page}`
        : `repos/${repo}/actions/runs?per_page=${PAGE.runs}&page=${page}`]);
      const runs = (d.workflow_runs ?? []).map(fromRestRun), total = d.total_count ?? 0;
      // Cached whether or not it's still what's shown: it's right for its key.
      remember(`runs|${repo}|${wf ?? "*"}|${page}`, { runs, total });
      return () => { this.runs = runs; this.runsTotal = total; };
    }
    if (what === "closed") {
      const page = this.closedPage, after = this.cursors[page];
      this.closedQ = closedQuery(repo, this.filter, this.term);
      const d = await gh(["api", "graphql", "-f", `query=${CLOSED_SEARCH}`, "-f", `q=${closedQuery(repo, this.filter, this.term)}`,
        "-F", `n=${PAGE.closed}`, ...(after ? ["-f", `after=${after}`] : [])]);
      const found = d.data.search;
      remember(`closed|${repo}|${this.closedQ}|${page}`, { prs: found.nodes.filter((p) => p?.number), total: found.issueCount,
        next: found.pageInfo.hasNextPage, cursor: found.pageInfo.endCursor });
      return () => {
        this.closed = found.nodes.filter((p) => p?.number);
        this.closedTotal = found.issueCount;
        this.closedNext = found.pageInfo.hasNextPage;
        this.cursors[page + 1] = found.pageInfo.endCursor;
      };
    }
    if (!this.me) {
      const me = cached("me");
      if (fresh(me, ME_TTL)) this.me = me.data;
      else { this.me = (await gh(["api", "user", "--jq", ".login"], { raw: true })).trim(); remember("me", this.me); }
    }
    const prs = await gh(["pr", "list", "-R", repo, "--state", "open", "--limit", "100", "--json", PR_FIELDS]);
    const slim = prs.map(slimPr);
    remember(`open|${repo}`, slim);
    return () => {
      for (const a of alerts(this.seen?.repo === repo ? this.seen.prs : null, prs, this.me)) {
        notify({ title: a.title, body: a.body, level: a.level, action: { name: `github.pr:${a.number}` } });
      }
      this.seen = { repo, prs }; // in full: alerts compare checks and reviews
      this.open = slim;
    };
  }

  // Closed PRs from their first page (the filter or search changed).
  firstClosed(cx) {
    this.closedPage = 0;
    this.cursors = [null];
    this.loadClosed(cx);
  }

  // Newer (-1) or older (+1) page of what's shown.
  turn(step, cx) {
    if (this.tab === "actions") { this.runsPage += step; this.loadRuns(cx); return; }
    this.closedPage += step;
    this.loadClosed(cx);
  }

  pager(t) {
    const runs = this.tab === "actions";
    const page = runs ? this.runsPage : this.closedPage + 1;
    const pages = runs ? pageCount(this.runsTotal, PAGE.runs) : pageCount(this.closedTotal, PAGE.closed);
    // A closed page's cursor is known once the page before it has arrived.
    const older = runs ? page < pages : this.closedNext && !this.busy.has("closed");
    const button = (id, label, on, step) => div().id(id).flex_none().px(8).py(2).rounded(5).text_size(11)
      .text_color(on ? t.muted : t.border)
      .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.turn(step, cx); cx.notify(); }))
      .child(label);
    return h_flex().h(32).flex_none().px(10).gap(6).items_center().border_t(1).border_color(t.border)
      .child(button("gh-page-prev", "‹ Newer", page > 1, -1))
      .child(div().id("gh-page-label").flex_1().text_center().text_size(11).text_color(t.dim).child(`Page ${page} of ${pages}`))
      .child(button("gh-page-next", "Older ›", older, 1));
  }

  // Shows a PR or run below the list. From a toast or a command the panel may be
  // closed or on another tab, so bring it all forward.
  show(kind, id) {
    setShared(DETAIL_KEY, { repo: this.repo, kind, id });
    if (find(layout(), DETAIL_BLOCK)) run("layout.show", { id: DETAIL_BLOCK });
  }

  reveal(kind, id) {
    setShared(DETAIL_KEY, { repo: this.repo, kind, id });
    reveal(DETAIL_BLOCK);
  }

  set(field, value, cx) {
    this[field] = value;
    save(field, value);
    this.ensure(cx);
  }

  // The workflow picked in the side nav, if it's still one of the repo's: its id, else "*" (All).
  pickedWorkflow() {
    const id = this.workflowPick[this.repo];
    return this.workflows?.some((w) => w.id === id) ? id : "*";
  }

  pickWorkflow(key, cx) {
    if (key === "*") delete this.workflowPick[this.repo];
    else this.workflowPick[this.repo] = Number(key);
    save("workflow", this.workflowPick);
    this.runsPage = 1;
    this.loadRuns(cx);
  }

  // ---- rows

  // A PR's space, with its agent's status; click goes there.
  spaceChip(t, p, matched) {
    const ids = new Set(matched.map((s) => s.id));
    const a = agents().filter((x) => ids.has(x.space)).sort((x, y) => URGENCY[x.status] - URGENCY[y.status])[0];
    const color = a && a.status !== "idle" ? t[a.status] ?? t.dim : t.dim;
    return h_flex().id(`gh-space-${p.number}`).flex_none().h(20).px(6).gap(4).items_center().rounded(5)
      .border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: matched[0].id }); })
      .child(a?.status === "working"
        ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(color).spin(900)
        : svg("mods/workspace-chrome/branch.svg").size(11).flex_none().text_color(color))
      .child(div().text_size(10).text_color(color).child(a ? STATUS_WORDS[a.status] ?? a.status : "space"));
  }

  prRow(t, p, all) {
    const state = prState(p);
    const checks = p.checks !== undefined ? p.checks : checkState(p.statusCheckRollup);
    const matched = spacesForBranch(p.headRefName, all);
    const picked = shared(DETAIL_KEY);
    const canWorktree = !matched.length && !p.isCrossRepository && (state === "open" || state === "draft");
    const review = p.reviewDecision === "APPROVED" ? ["✓", "#2da44e"] : p.reviewDecision === "CHANGES_REQUESTED" ? ["±", "#e5534b"] : null;
    return h_flex().id(`gh-pr-${p.number}`).w_full().h(44).flex_none().px(8).gap(9).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(picked?.kind === "pr" && picked.id === p.number && picked.repo === this.repo, (el) => el.bg(t.selected))
      .on_click(() => this.show("pr", p.number))
      .child(prIcon(state))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_color(t.foreground).child(p.title))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child(`#${p.number} · ${p.author?.login ?? "?"} · ${p.headRefName} · ${ago(p.updatedAt)}`)))
      .when(Boolean(review), (el) => el.child(div().flex_none().text_size(12).font_bold().text_color(review[1]).child(review[0])))
      .when(Boolean(checks), (el) => el.child(stateIcon(checks)))
      .when(matched.length > 0, (el) => el.child(this.spaceChip(t, p, matched)))
      .when(canWorktree, (el) => el.child(iconButton(t, `gh-wt-${p.number}`, "+", () => makeWorktree(this.space, p.headRefName))));
  }

  runRow(t, r, named) {
    const picked = shared(DETAIL_KEY);
    const time = took(r.startedAt, r.updatedAt);
    return h_flex().id(`gh-run-${r.databaseId}`).w_full().h(40).flex_none().pl(8).pr(8).gap(9).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(picked?.kind === "run" && picked.id === r.databaseId && picked.repo === this.repo, (el) => el.bg(t.selected))
      .on_click(() => this.show("run", r.databaseId))
      .child(stateIcon(runState(r)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).text_color(t.foreground).child(r.displayTitle))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child([`#${r.number}`, named ? r.workflowName : "", r.headBranch, r.event, ago(r.createdAt), runState(r) === "running" ? "" : time].filter(Boolean).join(" · "))));
  }

  // ---- views

  prs(t) {
    const closed = this.state === "closed";
    const list = closed ? this.closed : this.open;
    // Open PRs are filtered here; closed ones come filtered from GitHub.
    const shown = closed ? list ?? [] : filterPrs(list ?? [], { filter: this.filter, term: this.term, me: this.me });
    const narrowed = this.filter !== "all" || this.term.trim() !== "";
    const all = spaces();
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(32).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border)
        .child(chip(t, "gh-open", `Open${this.open ? ` ${this.open.length}` : ""}`, this.state === "open", (cx) => this.set("state", "open", cx)))
        .child(chip(t, "gh-closed", "Closed", this.state === "closed", (cx) => this.set("state", "closed", cx)))
        .child(div().flex_1())
        .child(chip(t, "gh-all", "All", this.filter === "all", (cx) => this.set("filter", "all", cx)))
        .child(chip(t, "gh-mine", "Mine", this.filter === "mine", (cx) => this.set("filter", "mine", cx)))
        .child(chip(t, "gh-review", closed ? "Reviewed by me" : "Review requested", this.filter === "review", (cx) => this.set("filter", "review", cx))))
      .child(h_flex().h(32).flex_none().mx(10).my(6).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.input ?? t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(v_flex().id("gh-pr-list").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(6).gap(1)
        .when(Boolean(list) && shown.length === 0, (el) => el.child(div().p(10).text_color(t.dim)
          .child((closed ? narrowed : list.length) ? "Nothing matches." : closed ? "No closed pull requests." : "No open pull requests.")))
        .children(shown.map((p) => this.prRow(t, p, all))))
      .when(closed && Boolean(this.closed), (el) => el.child(this.pager(t)));
  }

  // Actions: a search on top, then a side nav (All, then each workflow) beside
  // the picked one's runs, a page at a time.
  actions(t) {
    const q = this.runTerm.trim().toLowerCase().replace(/^#/, "");
    const picked = this.pickedWorkflow();
    const runs = (this.runs ?? []).filter((r) => !q || String(r.number) === q
      || [r.displayTitle, r.headBranch, r.workflowName, r.event].some((x) => (x ?? "").toLowerCase().includes(q)));
    const flows = (this.workflows ?? []).filter((w) => !q || w.name.toLowerCase().includes(q) || w.id === picked);
    const body = v_flex().size_full().min_h(0)
      .child(v_flex().id("gh-run-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .when(Boolean(this.runs) && runs.length === 0, (el) => el.child(div().p(10).text_color(t.dim)
          .child(q ? "Nothing on this page matches." : "No workflow runs.")))
        .children(runs.map((r) => this.runRow(t, r, picked === "*"))))
      .when(Boolean(this.runs), (el) => el.child(this.pager(t)));
    return v_flex().flex_1().min_h(0)
      .child(searchBar(t, this.runSearch))
      .child(sideNav(t, {
        id: "gh-nav", picked: String(picked), body, state: this.nav, onResized: (w) => save("navWidth", w),
        entries: [{ key: "*", label: "All", count: null }, ...flows.map((w) => ({ key: String(w.id), label: w.name, count: null }))],
        onPick: (key, cx) => this.pickWorkflow(key, cx),
      }));
  }

  render(cx) {
    if (this.detail) return this.detail.render(cx);
    const t = theme();
    const loading = this.busy.size > 0 || this.resolving;
    const since = this.fetchedAt ? `${Math.max(0, Math.round((Date.now() - this.fetchedAt) / 60000))}m ago` : "";
    const frame = v_flex().id("github").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("GitHub"))
        .when(Boolean(this.repo), (el) => el.child(div().min_w(0).truncate().px(5).py(1).rounded(4).border_1().border_color(t.border)
          .text_size(10).text_color(t.muted).child(this.repo)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(loading ? "loading…" : since))
        .child(iconButton(t, "gh-refresh", "↻", (cx) => this.refresh(cx))));
    if (!this.repo) {
      return frame.child(div().p(14).text_color(t.dim).child(this.resolving ? "Looking for the repo…"
        : this.space ? "This space's folder isn't a GitHub repo (no github.com origin)." : "No space is open."));
    }
    return frame
      .child(h_flex().h(34).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border)
        .child(chip(t, "gh-prs", "Pull requests", this.tab === "prs", (cx) => this.set("tab", "prs", cx)))
        .child(chip(t, "gh-actions", "Actions", this.tab === "actions", (cx) => this.set("tab", "actions", cx))))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(8).text_size(12).text_color(t.ansi1).child(`Couldn't load: ${this.error}`)))
      .child(this.tab === "prs" ? this.prs(t) : this.actions(t));
  }
}
