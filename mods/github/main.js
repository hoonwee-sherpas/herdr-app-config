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
import { gh, errorText, repoOf, DETAIL_KEY, checkState, prState, runState, groupRuns, ago, took,
  spacesForBranch, filterPrs, alerts, reveal, makeWorktree, prIcon, stateIcon, iconButton, chip,
  PAGE, pageCount, CLOSED_SEARCH, closedQuery, fromRestRun } from "./common.js";
import { Detail } from "./detail.js";

const POLL_MS = 2 * 60 * 1000;
const PR_FIELDS = "number,title,author,isDraft,state,headRefName,baseRefName,reviewDecision,statusCheckRollup,"
  + "updatedAt,url,reviewRequests,latestReviews,isCrossRepository,mergedAt,closedAt";
const SHOWN_RUNS = 3; // per workflow, until "more"
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
    this.folded = new Set(load("folded", []));
    this.more = new Set();
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
        this.open = this.closed = this.runs = null;
        this.closedPage = 0; this.cursors = [null]; this.closedTotal = 0; this.closedNext = false;
        this.runsPage = 1; this.runsTotal = 0;
        this.error = null;
        this.fetchedAt = null;
        this.busy.clear();
        this.refresh(cx);
      }
      cx.notify();
    });
  }

  // Fetches the open PRs (and alerts from them), and the closed PRs and runs
  // when they're shown or were fetched before.
  refresh(cx) {
    this.fetch("open", cx);
    if (this.state === "closed" || this.closed) this.fetch("closed", cx);
    if (this.tab === "actions" || this.runs) this.fetch("runs", cx);
  }

  // Fetches what the current view needs and doesn't have yet.
  ensure(cx) {
    // Closed: also when the filter or search changed since its last page came.
    if (this.tab === "prs" && this.state === "closed" && this.closedQ !== closedQuery(this.repo, this.filter, this.term)) this.firstClosed(cx);
    if (this.tab === "actions" && !this.runs) this.fetch("runs", cx);
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
      const page = this.runsPage;
      const d = await gh(["api", `repos/${repo}/actions/runs?per_page=${PAGE.runs}&page=${page}`]);
      return () => { this.runs = (d.workflow_runs ?? []).map(fromRestRun); this.runsTotal = d.total_count ?? 0; };
    }
    if (what === "closed") {
      const page = this.closedPage, after = this.cursors[page];
      this.closedQ = closedQuery(repo, this.filter, this.term);
      const d = await gh(["api", "graphql", "-f", `query=${CLOSED_SEARCH}`, "-f", `q=${closedQuery(repo, this.filter, this.term)}`,
        "-F", `n=${PAGE.closed}`, ...(after ? ["-f", `after=${after}`] : [])]);
      const found = d.data.search;
      return () => {
        this.closed = found.nodes.filter((p) => p?.number);
        this.closedTotal = found.issueCount;
        this.closedNext = found.pageInfo.hasNextPage;
        this.cursors[page + 1] = found.pageInfo.endCursor;
      };
    }
    if (!this.me) this.me = (await gh(["api", "user", "--jq", ".login"], { raw: true })).trim();
    const prs = await gh(["pr", "list", "-R", repo, "--state", "open", "--limit", "100", "--json", PR_FIELDS]);
    return () => {
      for (const a of alerts(this.seen?.repo === repo ? this.seen.prs : null, prs, this.me)) {
        notify({ title: a.title, body: a.body, level: a.level, action: { name: `github.pr:${a.number}` } });
      }
      this.seen = { repo, prs };
      this.open = prs;
    };
  }

  // Closed PRs from their first page (the filter or search changed).
  firstClosed(cx) {
    this.closedPage = 0;
    this.cursors = [null];
    this.fetch("closed", cx);
  }

  // Newer (-1) or older (+1) page of what's shown.
  turn(step, cx) {
    if (this.tab === "actions") this.runsPage += step;
    else this.closedPage += step;
    this.fetch(this.tab === "actions" ? "runs" : "closed", cx);
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

  toggle(name) {
    this.folded.has(name) ? this.folded.delete(name) : this.folded.add(name);
    save("folded", [...this.folded]);
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
      .when(Boolean(checkState(p.statusCheckRollup)), (el) => el.child(stateIcon(checkState(p.statusCheckRollup))))
      .when(matched.length > 0, (el) => el.child(this.spaceChip(t, p, matched)))
      .when(canWorktree, (el) => el.child(iconButton(t, `gh-wt-${p.number}`, "+", () => makeWorktree(this.space, p.headRefName))));
  }

  runRow(t, r) {
    const picked = shared(DETAIL_KEY);
    const time = took(r.startedAt, r.updatedAt);
    return h_flex().id(`gh-run-${r.databaseId}`).w_full().h(40).flex_none().pl(24).pr(8).gap(9).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(picked?.kind === "run" && picked.id === r.databaseId && picked.repo === this.repo, (el) => el.bg(t.selected))
      .on_click(() => this.show("run", r.databaseId))
      .child(stateIcon(runState(r)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).text_color(t.foreground).child(r.displayTitle))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child([`#${r.number}`, r.headBranch, r.event, ago(r.createdAt), runState(r) === "running" ? "" : time].filter(Boolean).join(" · "))));
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

  actions(t) {
    return v_flex().flex_1().min_h(0)
      .child(this.runList(t))
      .when(Boolean(this.runs), (el) => el.child(this.pager(t)));
  }

  runList(t) {
    const groups = groupRuns(this.runs ?? []);
    return v_flex().id("gh-run-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
      .when(Boolean(this.runs) && groups.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No workflow runs.")))
      .children(groups.flatMap((g) => {
        const folded = this.folded.has(g.name);
        const all = this.more.has(g.name);
        const head = h_flex().id(`gh-wf-${g.name}`).h(28).flex_none().px(8).gap(7).items_center().rounded(6)
          .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12).font_semibold()
          .on_click((_e, cx) => { this.toggle(g.name); cx.notify(); })
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
          .child(stateIcon(runState(g.runs[0])))
          .child(div().flex_1().min_w(0).truncate().child(g.name))
          .child(div().flex_none().text_size(10).font_normal().text_color(t.dim).child(String(g.runs.length)));
        if (folded) return [head];
        const rows = (all ? g.runs : g.runs.slice(0, SHOWN_RUNS)).map((r) => this.runRow(t, r));
        const rest = g.runs.length - SHOWN_RUNS;
        if (!all && rest > 0) {
          rows.push(div().id(`gh-wf-more-${g.name}`).h(24).flex_none().pl(46).flex().items_center().rounded(6).text_size(11)
            .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.more.add(g.name); cx.notify(); })
            .child(`${rest} more`));
        }
        return [head, ...rows];
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
