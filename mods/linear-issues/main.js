// Linear issues panel: issues assigned to me that aren't done or canceled,
// grouped by workflow state. Each issue is matched to Herdr spaces whose
// branch, folder or name contains its identifier (prd-10254), and shows that
// space's agent status. Clicking an issue shows it in the detail
// view below the list (detail.js): in the main-linear layout that's the panel's
// "linear-detail" block (this mod again, props { view: "detail" }); in the
// floating window, the lower half of the window. "+" makes a worktree space on
// the issue's branch from the basecamp checkout.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { run, spaces, agents, layout, shared, setShared, theme, openOverlay, closeOverlay, props, home, nextCommand } from "herdr";
import { gql, errorText, DETAIL_KEY, startedSteps, stateIcon, spacesFor, openUrl, iconButton,
  MINE_KEY, STATES_KEY, STATE_FIELDS, ISSUE_FIELDS, fresh, statePicker, teamStates, setIssueState, shareState } from "./common.js";
import { Detail } from "./detail.js";
import { searchBar, sideNav, navState } from "./sidenav.js";

const POLL_MS = 3 * 60 * 1000;
const REPO = () => `${home()}/Sherpas/basecamp`;
const QUERY = `{ viewer { assignedIssues(first: 250, orderBy: updatedAt,
  filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }) {
  nodes { ${ISSUE_FIELDS} } } }
  workflowStates(first: 250) { nodes { ${STATE_FIELDS} } } }`;
// Workflow state types, most active first.
const TYPE_RANK = { started: 0, unstarted: 1, backlog: 2, triage: 3 };
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };
const NO_PROJECT = "No project";
const stateOrder = (a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || a.position - b.position;
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const byUrgency = (a, b) => URGENCY[a.status] - URGENCY[b.status];
const DETAIL_BLOCK = "linear-detail";
const STATUS_WORDS = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// A group's issues as a tree: each sub-issue right under its parent (when the
// parent is in the same list), deeper levels further in. [{ issue, depth }], the
// top level in the given order, each parent's sub-issues in the given order too.
export function nest(items) {
  const ids = new Set(items.map((i) => i.identifier));
  const kids = new Map(), roots = [];
  for (const i of items) {
    const p = i.parent?.identifier;
    if (p && p !== i.identifier && ids.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(i); }
    else roots.push(i);
  }
  const out = [], seen = new Set();
  const visit = (i, depth) => {
    if (seen.has(i.identifier)) return;
    seen.add(i.identifier);
    out.push({ issue: i, depth });
    for (const k of kids.get(i.identifier) ?? []) visit(k, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  for (const i of items) visit(i, 0); // a parent loop: still listed once
  return out;
}

export default class LinearIssues extends View {
  init(_props, cx) {
    if (props()?.view === "detail") {
      this.detail = new Detail(cx, () => { setShared(DETAIL_KEY, null); run("layout.hide", { id: DETAIL_BLOCK }); });
      return;
    }
    // In the floating window there's no detail block: the window splits itself.
    if (props()?.overlay) this.inline = new Detail(cx, () => setShared(DETAIL_KEY, null));
    this.issues = [];
    this.error = null;
    this.loading = false;
    this.fetchedAt = null;
    // View choices, kept across reloads: grouping ("project" | "state"), whether
    // Backlog issues show (most of the list, so off by default), folded groups.
    this.steps = new Map();
    this.mode = load("mode", "project");
    this.backlog = load("backlog", false);
    this.folded = new Set(load("folded", []));
    // By project: the project picked in the side nav ("*": all of them).
    this.project = load("project", "*");
    this.nav = navState(load("navWidth", 150));
    this.term = "";
    this.search = InputState.new({ placeholder: "Search issues (title or PRD-1234)" });
    this.search.on("change", (_e, cx) => { this.term = this.search.value(); cx.notify(); });
    this.lastCommand = null;
    // The issue whose status menu is open, and why the last status change failed.
    this.picking = null;
    this.stateError = null;
    // Start from the shared cache; fetch now only if it's older than a poll.
    this.adopt();
    if (!fresh(shared(MINE_KEY), POLL_MS) || !shared(STATES_KEY)) this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
    // Commands for keys and scripts (herdr-app do linear-issues.<command>):
    // refresh, go:<ID> (its space, else Linear), detail:<ID>, web:<ID>, worktree:<ID>.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        this.lastCommand = c;
        this.command(c, cx);
        cx.notify();
      }
    });
  }

  command(c, cx) {
    if (this.detail) return;
    const [name, id] = String(c).split(":");
    if (name === "refresh") return this.refresh(cx);
    const issue = this.issues.find((i) => i.identifier.toLowerCase() === String(id ?? "").toLowerCase());
    if (!issue) return;
    if (name === "go") this.open(issue, spacesFor(issue.identifier, spaces()));
    else if (name === "detail") this.showDetail(issue);
    else if (name === "web") this.web(issue);
    else if (name === "worktree") this.newWorktree(issue);
  }

  // Moves the issue to `state`: shown at once, sent to Linear, put back if it refuses.
  pickState(issue, state, cx) {
    this.picking = null;
    const before = issue.state;
    if (state.id === before.id) return cx.notify();
    this.stateError = null;
    this.patch(issue.identifier, state);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const now = await setIssueState(issue, state);
        this.patch(issue.identifier, now);
        shareState(issue.identifier, now);
        this.fetchedAt = Math.max(this.fetchedAt ?? 0, shared(MINE_KEY)?.at ?? 0);
      } catch (e) {
        this.patch(issue.identifier, before);
        this.stateError = `Couldn't change ${issue.identifier}: ${errorText(e)}`;
      } finally {
        cx.notify();
      }
    });
  }

  patch(identifier, state) {
    this.issues = this.issues.map((i) => (i.identifier === identifier ? { ...i, state } : i));
  }

  web(issue) {
    openUrl(issue.url);
  }

  // Show the issue below the list: reveal the layout's detail block, or (in the
  // floating window) the window's own lower half.
  showDetail(issue) {
    setShared(DETAIL_KEY, issue.identifier);
    if (!this.inline && find(layout(), DETAIL_BLOCK)) run("layout.show", { id: DETAIL_BLOCK });
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const d = await gql(QUERY);
        this.issues = d.viewer.assignedIssues.nodes;
        this.steps = startedSteps(d.workflowStates.nodes);
        this.error = null;
        this.fetchedAt = Date.now();
        setShared(MINE_KEY, { at: this.fetchedAt, issues: this.issues });
        setShared(STATES_KEY, { at: this.fetchedAt, nodes: d.workflowStates.nodes });
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // Takes the shared cache when it's newer than what this copy has (another
  // copy or the search popup fetched since). Cheap: render calls it.
  adopt() {
    const mine = shared(MINE_KEY);
    if (!mine?.issues || mine.at <= (this.fetchedAt ?? 0)) return;
    this.issues = mine.issues;
    this.fetchedAt = mine.at;
    const states = shared(STATES_KEY);
    if (states?.nodes) this.steps = startedSteps(states.nodes);
  }

  // The issues shown: Backlog only when asked, and only those the search matches.
  shown() {
    const q = this.term.trim().toLowerCase();
    return this.issues.filter((i) => this.backlog || i.state.type !== "backlog")
      .filter((i) => !q || i.identifier.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));
  }

  // [{ key, name, items }]: by workflow state, or by project with each project's
  // issues in state order. Projects with more started issues come first; no project last.
  groups() {
    const by = new Map();
    for (const i of this.shown()) {
      const name = this.mode === "state" ? i.state.name : i.project?.name ?? NO_PROJECT;
      if (!by.has(name)) by.set(name, { key: `${this.mode}:${name}`, name, state: i.state, items: [] });
      by.get(name).items.push(i);
    }
    const list = [...by.values()];
    if (this.mode === "state") return list.sort((a, b) => stateOrder(a.state, b.state));
    for (const g of list) g.items.sort((a, b) => stateOrder(a.state, b.state));
    const started = (g) => g.items.filter((i) => i.state.type === "started").length;
    return list.sort((a, b) =>
      (a.name === NO_PROJECT) - (b.name === NO_PROJECT) || started(b) - started(a) || a.name.localeCompare(b.name));
  }

  toggle(key, cx) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    save("folded", [...this.folded]);
    cx.notify();
  }

  chip(t, id, label, on, onClick) {
    return div().id(id).flex_none().px(6).py(1).rounded(4).text_size(10).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); cx.notify(); })
      .child(label);
  }

  open(issue, matched) {
    if (matched.length) run("space.select", { id: matched[0].id });
    else this.web(issue);
  }

  newWorktree(issue) {
    openOverlay({
      mod: "worktree", kind: "dialog", width: 440, height: 260,
      props: { folder: REPO(), action: "new", branch: issue.branchName },
    });
  }


  // Agents in the spaces that work on this issue, most urgent first.
  agentsFor(matched) {
    const ids = new Set(matched.map((s) => s.id));
    return agents().filter((a) => ids.has(a.space)).sort(byUrgency);
  }

  // Right side, a button to the issue's space: the agent's program icon and status
  // in its status color (a spinner while it works), or a branch glyph for a space
  // with no agent. Remote spaces name their machine.
  agentChip(t, issue, matched, list) {
    if (!matched.length) return null;
    const a = list[0];
    const color = a ? t[a.status] ?? t.dim : t.dim;
    const p = a?.program;
    const remote = matched.find((s) => s.machine)?.machine;
    // The space to go to: the most urgent agent's, else the first match.
    const target = a?.space ?? matched[0].id;
    const word = a ? STATUS_WORDS[a.status] ?? a.status : "space";
    return h_flex().id(`li-agent-${issue.identifier}`).flex_none().min_w(72).h(22).gap(5).items_center().px(8).rounded(5)
      .cursor_pointer().bg(a && a.status !== "idle" ? color + "1f" : t.chrome)
      .hover((s) => s.bg(a && a.status !== "idle" ? color + "38" : t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: target }); })
      .child(a && p?.icon
        ? (p.tint ? svg(p.icon).size(12).flex_none().text_color(color) : image(p.icon).w(12).h(12).flex_none())
        : svg("mods/workspace-chrome/branch.svg").size(12).flex_none().text_color(t.dim))
      .when(a?.status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(color).spin(900)))
      .when(a?.status === "done", (el) => el.child(div().size(6).flex_none().rounded(3).bg(color)))
      .child(div().text_size(10).text_color(a && a.status !== "idle" ? color : t.dim).child(word))
      .when(list.length > 1, (el) => el.child(div().text_size(10).text_color(t.dim).child(`+${list.length - 1}`)))
      .when(Boolean(remote), (el) => el.child(div().text_size(10).text_color(t.dim).child(`@${remote}`)));
  }


  // `depth`: how far down its parent's tree (0: top). A sub-issue whose parent
  // isn't listed names it instead (↑ PRD-9961), and the name opens the parent.
  row(t, issue, all, depth = 0) {
    const matched = spacesFor(issue.identifier, all);
    const parent = depth === 0 ? issue.parent : null;
    const list = this.agentsFor(matched);
    const top = list[0]?.status ?? null;
    // A gutter mark on the row's edge: the agent's status color, faint for a space alone.
    const gutter = !matched.length ? "#00000000" : top && top !== "idle" ? t[top] ?? t.dim : t.border;
    return h_flex().id(`li-${issue.identifier}`).w_full().h(30).flex_none().pl(2 + depth * 16).pr(8).gap(7).items_center()
      .rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(shared(DETAIL_KEY) === issue.identifier, (el) => el.bg(t.selected))
      .on_click(() => this.showDetail(issue))
      .when(depth > 0, (el) => el.child(div().w(8).h(15).mt(-14).ml(-4).flex_none().border_l(1).border_b(1).border_color(t.border).rounded_bl(4)))
      .child(div().w(3).h(18).flex_none().rounded(2).bg(gutter))
      .child(statePicker(t, { id: `li-state-${issue.identifier}`, state: issue.state, steps: this.steps,
        states: this.picking === issue.identifier ? teamStates(shared(STATES_KEY)?.nodes, issue.team?.key) : [],
        open: this.picking === issue.identifier,
        onOpen: (o, cx) => { this.picking = o ? issue.identifier : null; cx.notify(); },
        onPick: (s, cx) => this.pickState(issue, s, cx) }))
      .child(div().w(70).flex_none().text_size(11).text_color(t.muted).child(issue.identifier))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(issue.title))
      .when(Boolean(parent), (el) => el.child(div().id(`li-parent-${issue.identifier}`).flex_none().px(5).rounded(4)
        .text_size(10).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`${parent.identifier} ${parent.title ?? ""}`.trim())
        .on_click((_e, cx) => { cx.stop_propagation(); this.showDetail(parent); })
        .child(`↑ ${parent.identifier}`)))
      .when(matched.length > 0, (el) => el.child(this.agentChip(t, issue, matched, list)))
      .when(matched.length === 0 && Boolean(issue.branchName), (el) =>
        el.child(iconButton(t, `li-wt-${issue.identifier}`, "+", () => this.newWorktree(issue))));
  }

  // A group header's agent summary: how many work, and how many wait on you.
  summary(t, g, all) {
    const list = g.items.flatMap((i) => this.agentsFor(spacesFor(i.identifier, all)));
    const working = list.filter((a) => a.status === "working").length;
    const blocked = list.filter((a) => a.status === "blocked").length;
    return h_flex().flex_none().gap(6).items_center().text_size(10).font_normal()
      .when(working > 0, (el) => el.child(h_flex().gap(3).items_center().text_color(t.working)
        .child(svg("mods/workspace-chrome/spinner.svg").size(10).spin(900)).child(String(working))))
      .when(blocked > 0, (el) => el.child(h_flex().gap(3).items_center().text_color(t.blocked)
        .child(div().size(6).rounded(3).bg(t.blocked)).child(String(blocked))));
  }

  render(cx) {
    if (this.detail) return this.detail.render(cx);
    this.adopt();
    const list = this.renderList();
    if (!this.inline || !shared(DETAIL_KEY)) return list;
    return v_flex().size_full().min_h(0).gap(6)
      .child(v_flex().flex_1().min_h(0).child(list))
      .child(v_flex().flex_1().min_h(0).child(this.inline.render(cx)));
  }

  renderList() {
    const t = theme();
    const all = spaces();
    const groups = this.groups();
    const ago = this.fetchedAt ? `${Math.max(0, Math.round((Date.now() - this.fetchedAt) / 60000))}m ago` : "";
    return v_flex().id("linear-issues").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Linear"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted)
          .child(`${this.shown().length} issues`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "loading…" : ago))
        .child(iconButton(t, "li-refresh", "↻", (cx) => this.refresh(cx)))
        .when(Boolean(props()?.overlay), (el) =>
          el.child(iconButton(t, "li-close", "✕", () => closeOverlay(props().overlay)))))
      .child(h_flex().h(32).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border)
        .child(this.chip(t, "li-by-project", "Project", this.mode === "project", () => { this.mode = "project"; save("mode", this.mode); }))
        .child(this.chip(t, "li-by-state", "State", this.mode === "state", () => { this.mode = "state"; save("mode", this.mode); }))
        .child(div().flex_1())
        .child(this.chip(t, "li-backlog", "Backlog", this.backlog, () => { this.backlog = !this.backlog; save("backlog", this.backlog); })))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(8).text_size(12).text_color(t.ansi1)
        .child(`Couldn't load: ${this.error}`)))
      .when(Boolean(this.stateError), (el) => el.child(h_flex().px(14).py(6).gap(8).items_center().text_size(12).text_color(t.ansi1)
        .child(div().flex_1().min_w(0).child(this.stateError))
        .child(iconButton(t, "li-state-error-close", "✕", (cx) => { this.stateError = null; cx.notify(); }))))
      .child(searchBar(t, this.search))
      .child(this.mode === "project" ? this.byProject(t, all, groups) : this.list(t, all, groups));
  }

  empty(t) {
    return div().p(10).text_color(t.dim).child(this.term.trim() ? "Nothing matches." : "No open issues assigned to you.");
  }

  // By state: a group per state, each folding.
  list(t, all, groups) {
    return v_flex().id("li-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
      .when(!this.loading && !this.error && groups.length === 0, (el) => el.child(this.empty(t)))
      .children(groups.flatMap((g) => {
        const folded = this.folded.has(g.key);
        const head = h_flex().id(`lg-${g.key}`).h(28).flex_none().px(8).gap(7).items_center().rounded(6)
          .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(11).font_semibold().text_color(t.muted)
          .on_click((_e, cx) => this.toggle(g.key, cx))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().child(g.name))
          .child(this.summary(t, g, all))
          .child(div().flex_none().text_size(10).font_normal().text_color(t.dim).child(String(g.items.length)));
        return folded ? [head] : [head, ...nest(g.items).map(({ issue, depth }) => this.row(t, issue, all, depth))];
      }));
  }

  // By project: a side nav (All, then each project) beside the picked one's
  // issues. All shows every issue under its project's name.
  byProject(t, all, groups) {
    const picked = groups.some((g) => g.name === this.project) ? this.project : "*";
    const show = picked === "*" ? groups : groups.filter((g) => g.name === picked);
    const body = v_flex().id("li-list").size_full().min_h(0).overflow_y_scrollbar().p(6).gap(2)
      .when(!this.loading && !this.error && show.length === 0, (el) => el.child(this.empty(t)))
      .children(show.flatMap((g) => [
        ...(picked === "*" ? [h_flex().id(`li-sub-${g.name}`).h(26).flex_none().px(8).gap(7).items_center()
          .text_size(11).font_semibold().text_color(t.muted)
          .child(div().flex_1().min_w(0).truncate().child(g.name))
          .child(this.summary(t, g, all))
          .child(div().flex_none().text_size(10).font_normal().text_color(t.dim).child(String(g.items.length)))] : []),
        ...nest(g.items).map(({ issue, depth }) => this.row(t, issue, all, depth)),
      ]));
    return sideNav(t, {
      id: "li-nav", picked, body, state: this.nav, onResized: (w) => save("navWidth", w),
      entries: [{ key: "*", label: "All", count: this.shown().length }, ...groups.map((g) => ({ key: g.name, label: g.name, count: g.items.length }))],
      onPick: (key) => { this.project = key; save("project", key); },
    });
  }
}
