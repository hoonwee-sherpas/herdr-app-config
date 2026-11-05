// Linear issue search: a popup (like the Terminals picker) that searches every
// Linear issue as you type. With nothing typed it lists your open assigned
// issues. ↑/↓ pick, Enter shows the issue in the Linear detail view (the
// main-linear layout's block, else the floating Linear window), ⌘Enter opens
// it in Linear, ⌘G goes to its space (or makes a worktree for its branch),
// ⌘⇧C copies its identifier, Esc leaves. Uses linear-issues' API helper, so
// the key comes from the same keychain entry ("linear-api-key").

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, spaces, layout, theme, props, closeOverlay, openOverlay, shared, setShared, exec, home } from "herdr";
import { gql, errorText, DETAIL_KEY, startedSteps, stateIcon, spacesFor, openUrl,
  MINE_KEY, STATES_KEY, STATES_TTL, ISSUE_FIELDS, MINE_QUERY, STATES_QUERY, fresh } from "./common.js";

const ROW = 34;
const VISIBLE = 12;
const DEBOUNCE_MS = 220;
const LIMIT = 40;
const DETAIL_BLOCK = "linear-detail";
const REPO = () => `${home()}/Sherpas/basecamp`;
const SEARCH = `query($term: String!) { searchIssues(term: $term, first: ${LIMIT}) { nodes { ${ISSUE_FIELDS} } } }`;
// The cached list is shown at once; it's refetched when older than this.
const MINE_TTL = 60 * 1000;
const CLOSED = new Set(["completed", "canceled", "duplicate"]);

// The nodes from the root down to the block with this id, or null.
function pathTo(node, id) {
  if (!node) return null;
  if (node.id === id) return [node];
  for (const c of node.children ?? []) { const p = pathTo(c, id); if (p) return [node, ...p]; }
  return null;
}

// Makes a block visible: shows every hidden node on the way to it, and picks
// its branch in any stack (main-linear: the "panel" column, the "linear" child
// of the "panel-body" stack, then the "linear-detail" block).
function reveal(id) {
  const path = pathTo(layout(), id);
  if (!path) return false;
  path.forEach((n, i) => {
    if (n.type === "stack" && path[i + 1]) run("layout.select", { stack: n.id, child: path[i + 1].id });
    if (n.hidden) run("layout.show", { id: n.id });
  });
  return true;
}

export default class LinearSearch extends View {
  init(_props, cx) {
    this.term = "";
    this.results = [];
    this.mine = [];
    this.minedAt = null;
    this.refreshing = false;
    this.at = 0;
    this.loading = false;
    this.error = null;
    this.seq = 0;
    this.done = false;
    this.steps = new Map();
    this.note = null;
    this.handle = cx.focus_handle();
    this.top = 0;
    this.wheel = 0;
    this.input = InputState.new({ placeholder: "Search Linear issues… (title, text or PRD-1234)" });
    this.input.on("change", (_e, cx) => {
      this.term = this.input.value().trim();
      this.note = null;
      this.schedule(cx);
    });
    this.input.on("submit", () => this.act("detail"));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    // Draw the shared cache (the Linear panel's list, or this popup's last
    // fetch) at once, then refresh what's stale in the background.
    const mine = shared(MINE_KEY);
    if (mine?.issues) { this.mine = mine.issues; this.minedAt = mine.at; this.results = mine.issues; }
    const states = shared(STATES_KEY);
    if (states?.nodes) this.steps = startedSteps(states.nodes);
    if (!fresh(states, STATES_TTL)) {
      cx.spawn(async (cx) => {
        try {
          const nodes = (await gql(STATES_QUERY)).workflowStates.nodes;
          setShared(STATES_KEY, { at: Date.now(), nodes });
          this.steps = startedSteps(nodes);
          cx.notify();
        } catch {}
      });
    }
    if (!fresh(mine, MINE_TTL)) this.loadMine(cx);
  }

  close() {
    this.done = true;
    closeOverlay(props().overlay);
  }

  // Your open assigned issues (the Linear panel's list) matching every word typed.
  local(term) {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    return this.mine.filter((i) => {
      const text = [i.identifier, i.title, i.project?.name, i.branchName].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }

  show(list) {
    this.results = list;
    this.at = 0;
    this.top = 0;
  }

  // Typing filters your issues at once; Linear's search over every issue
  // follows after a pause and adds what the local list doesn't have.
  schedule(cx) {
    const seq = ++this.seq;
    this.show(this.term ? this.local(this.term) : this.mine);
    this.loading = Boolean(this.term);
    cx.notify();
    if (this.term) cx.timer.after(DEBOUNCE_MS, (cx) => { if (seq === this.seq) this.search(cx); });
  }

  // Swaps in a new list, keeping the selection on the same issue if it's there.
  keep(list) {
    const picked = this.results[this.at]?.identifier;
    this.results = list;
    const at = list.findIndex((i) => i.identifier === picked);
    this.at = at >= 0 ? at : 0;
    if (this.at < this.top || this.at >= this.top + VISIBLE) this.top = Math.max(0, this.at - VISIBLE + 1);
  }

  loadMine(cx) {
    this.refreshing = true;
    cx.spawn(async (cx) => {
      try {
        const issues = (await gql(MINE_QUERY)).viewer.assignedIssues.nodes;
        this.minedAt = Date.now();
        setShared(MINE_KEY, { at: this.minedAt, issues });
        this.mine = issues;
        this.error = null;
        // While a search is typed, the next search merges the new list in.
        if (!this.term) this.keep(issues);
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.refreshing = false;
        cx.notify();
      }
    });
  }

  search(cx) {
    const seq = ++this.seq;
    const term = this.term;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const nodes = (await gql(SEARCH, { term })).searchIssues.nodes;
        if (seq !== this.seq) return;
        const local = this.local(term);
        const have = new Set(local.map((i) => i.identifier));
        // Linear's relevance order, open issues before closed ones.
        const more = nodes.filter((n) => !have.has(n.identifier)).map((n, i) => [n, i])
          .sort(([a, i], [b, j]) => CLOSED.has(a.state.type) - CLOSED.has(b.state.type) || i - j)
          .map(([n]) => n);
        this.keep([...local, ...more]);
        this.error = null;
      } catch (e) {
        if (seq === this.seq) this.error = errorText(e);
      } finally {
        if (seq === this.seq) { this.loading = false; cx.notify(); }
      }
    });
  }

  move(by) {
    const n = this.results.length;
    if (!n) return;
    this.at = (this.at + by + n) % n;
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + VISIBLE) this.top = this.at - VISIBLE + 1;
  }

  act(what, issue = this.results[this.at]) {
    if (!issue || this.done) return;
    if (what === "copy") {
      exec("sh", ["-c", 'printf %s "$1" | pbcopy', "copy", issue.identifier]).catch(() => {});
      this.note = `Copied ${issue.identifier}`;
      return;
    }
    this.close();
    if (what === "web") return openUrl(issue.url);
    if (what === "go") {
      const matched = spacesFor(issue.identifier, spaces());
      if (matched.length) return run("space.select", { id: matched[0].id });
      if (issue.branchName) {
        return openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260,
          props: { folder: REPO(), action: "new", branch: issue.branchName } });
      }
      return openUrl(issue.url);
    }
    // detail: the layout's detail block when there is one, else the Linear window
    // (its lower half follows the same shared key).
    setShared(DETAIL_KEY, issue.identifier);
    if (!reveal(DETAIL_BLOCK)) openOverlay({ mod: "linear-issues", kind: "window", key: "linear-issues", keep: true, width: 480, height: 0.8 });
  }

  icon(t, state) {
    if (!CLOSED.has(state.type)) return stateIcon(state, this.steps);
    return h_flex().size(14).flex_none().rounded(7).bg(state.color).items_center().justify_center()
      .text_size(9).font_bold().text_color("#ffffff").child(state.type === "completed" ? "✓" : "✕");
  }

  row(t, issue, i) {
    const on = i === this.at;
    const closed = CLOSED.has(issue.state.type);
    const matched = spacesFor(issue.identifier, spaces()).length > 0;
    const meta = [issue.project?.name, issue.assignee?.name].filter(Boolean).join(" · ");
    return h_flex().w_full().h(ROW).px(4).child(h_flex().id(`ls-${issue.identifier}`).w_full().h_full().px(10).gap(9).items_center().rounded(7)
      .cursor_pointer().when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => {
        this.at = i;
        this.act(e.modifiers.platform ? "web" : "detail", issue);
        cx.notify();
      })
      .child(this.icon(t, issue.state))
      .child(div().w(78).flex_none().text_size(11).text_color(t.muted).child(issue.identifier))
      .child(div().flex_1().min_w(0).truncate().text_color(closed ? t.dim : t.foreground).child(issue.title))
      .when(matched, (el) => el.child(svg("mods/workspace-chrome/branch.svg").size(11).flex_none().text_color(t.accent)))
      .child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.dim).child(meta || issue.state.name)));
  }

  hint(t, keys, label) {
    return h_flex().gap(4).items_center()
      .child(div().px(4).rounded(3).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(keys))
      .child(div().text_size(11).text_color(t.dim).child(label));
  }

  render() {
    const t = theme();
    const n = this.results.length;
    const listH = Math.min(VISIBLE, Math.max(n, 1)) * ROW;
    const status = this.error ? `Couldn't search: ${this.error}`
      : this.loading ? "searching…"
      : this.term ? `${n} result${n === 1 ? "" : "s"}`
      : this.refreshing ? (this.minedAt ? "your open issues · refreshing…" : "loading…")
      : `your open issues${this.minedAt ? ` · ${Math.max(0, Math.round((Date.now() - this.minedAt) / 60000))}m ago` : ""}`;
    return v_flex().id("linear-search").track_focus(this.handle).w_full().min_h(0).p(16).gap(10)
      .bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.keystroke;
        if (k === "escape") return this.close();
        if (k === "down" || k === "ctrl-n") this.move(1);
        else if (k === "up" || k === "ctrl-p") this.move(-1);
        else if (k === "enter") this.act("detail");
        else if (k === "cmd-enter") this.act("web");
        else if (k === "cmd-g") this.act("go");
        else if (k === "cmd-shift-c") this.act("copy");
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/linear-issues/linear.svg").size(15).flex_none().text_color(t.foreground))
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Linear issues"))
        .child(div().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(this.note ?? status)))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("ls-list").relative().w_full().h(listH).flex_none().overflow_hidden()
        .when(n === 0, (el) => el.child(div().p(10).text_color(t.dim)
          .child(this.loading ? "Searching…" : this.refreshing && !this.term ? "Loading…" : this.error ? "" : this.term ? "No issues match." : "No open issues assigned to you.")))
        .when(n > 0, (el) => el
          .on_scroll_wheel((e, cx) => {
            // Wheel/trackpad pixels move the window a row at a time.
            this.wheel -= e.delta.y;
            const rows = Math.trunc(this.wheel / ROW);
            if (!rows) return;
            this.wheel -= rows * ROW;
            this.top = Math.max(0, Math.min(this.top + rows, n - VISIBLE));
            this.at = Math.max(this.top, Math.min(this.at, this.top + VISIBLE - 1));
            cx.notify();
          })
          .children(this.results.slice(this.top, this.top + VISIBLE).map((issue, k) => this.row(t, issue, this.top + k)))
          .when(n > VISIBLE, (el) => el.child(div().absolute().right(0).w(3).rounded(2).bg(t.border)
            .top(listH * this.top / n).h(Math.max(16, listH * VISIBLE / n))))))
      .child(h_flex().flex_none().gap(14).pt(8).border_t(1).border_color(t.border)
        .child(this.hint(t, "↵", "details"))
        .child(this.hint(t, "⌘↵", "open in Linear"))
        .child(this.hint(t, "⌘G", "go to space / worktree"))
        .child(this.hint(t, "⌘⇧C", "copy ID"))
        .child(div().flex_1())
        .child(this.hint(t, "esc", "close")));
  }
}
