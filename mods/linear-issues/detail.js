// The issue detail pane: a copy of this mod opened with props { view: "detail" }
// beside the terminal (pane.split). It follows the shared DETAIL_KEY, so one
// pane shows whichever issue was picked last in the list.

import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { run, spaces, shared, setShared, theme, openOverlay, home } from "herdr";
import { gql, errorText, DETAIL_KEY, MINE_KEY, STATE_FIELDS, startedSteps, stateIcon, spacesFor, openUrl, iconButton,
  statePicker, teamStates, setIssueState, shareState } from "./common.js";

const STATE = "state { id name type position color }";
const QUERY = `query($id: String!) { issue(id: $id) {
  identifier title url branchName priorityLabel createdAt updatedAt description
  ${STATE} project { name } assignee { name } creator { name }
  labels { nodes { name color } }
  parent { identifier title ${STATE} }
  children { nodes { identifier title ${STATE} } }
  attachments { nodes { title subtitle url } }
  comments(first: 50) { nodes { body createdAt user { name } } }
  team { key states { nodes { ${STATE_FIELDS} } } } } }`;

const day = (iso) => (iso ? iso.slice(0, 10) : "");

export class Detail {
  // onClose: hides this view (the layout block, or the window's lower half).
  constructor(cx, onClose) {
    this.onClose = onClose;
    this.id = null;
    this.issue = null;
    this.steps = new Map();
    this.error = null;
    this.loading = false;
    // The team's states, which status menu is open ("ld-state" | "ld-head-state"),
    // and when this copy last knew the issue's state (to follow the list's changes).
    this.states = [];
    this.picking = null;
    this.knownAt = 0;
    // Follow the picked issue; a cheap check, the fetch only runs on a change.
    cx.timer.every(400, (cx) => {
      const want = shared(DETAIL_KEY) ?? null;
      if (want && want !== this.id) return this.load(want, cx);
      this.follow(cx);
    });
  }

  // A status changed elsewhere (the list) since this copy last knew it.
  follow(cx) {
    const mine = shared(MINE_KEY);
    if (!this.issue || !mine?.issues || mine.at <= this.knownAt) return;
    this.knownAt = mine.at;
    const there = mine.issues.find((i) => i.identifier === this.issue.identifier);
    if (there && there.state.id !== this.issue.state.id) { this.issue = { ...this.issue, state: there.state }; cx.notify(); }
  }

  pickState(state, cx) {
    this.picking = null;
    const issue = this.issue, before = issue.state;
    if (state.id === before.id) return cx.notify();
    this.error = null;
    this.issue = { ...issue, state };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const now = await setIssueState(issue, state);
        if (this.issue?.identifier === issue.identifier) this.issue = { ...this.issue, state: now };
        shareState(issue.identifier, now);
        this.knownAt = shared(MINE_KEY)?.at ?? Date.now();
      } catch (e) {
        if (this.issue?.identifier === issue.identifier) this.issue = { ...this.issue, state: before };
        this.error = `Couldn't change the status: ${errorText(e)}`;
      } finally {
        cx.notify();
      }
    });
  }

  picker(t, id, size, label) {
    return statePicker(t, { id, state: this.issue.state, steps: this.steps, states: this.states, size, label,
      open: this.picking === id,
      onOpen: (o, cx) => { this.picking = o ? id : null; cx.notify(); },
      onPick: (s, cx) => this.pickState(s, cx) });
  }

  load(id, cx) {
    this.id = id;
    this.loading = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const d = await gql(QUERY, { id });
        if (this.id !== id) return; // another issue was picked meanwhile
        this.issue = d.issue;
        this.steps = startedSteps(d.issue.team.states.nodes);
        this.states = teamStates(d.issue.team.states.nodes, d.issue.team.key);
        this.knownAt = Date.now();
      } catch (e) {
        if (this.id === id) this.error = errorText(e);
      } finally {
        if (this.id === id) { this.loading = false; cx.notify(); }
      }
    });
  }

  field(t, label, value) {
    return h_flex().min_h(24).gap(10).items_center()
      .child(div().w(76).flex_none().text_size(12).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().flex_wrap().child(value));
  }

  // A parent or sub-issue: picking it shows it here.
  related(t, i) {
    return h_flex().id(`ld-rel-${i.identifier}`).h(26).px(6).gap(7).items_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => setShared(DETAIL_KEY, i.identifier))
      .child(stateIcon(i.state, this.steps, 13))
      .child(div().w(70).flex_none().text_size(11).text_color(t.muted).child(i.identifier))
      .child(div().flex_1().min_w(0).truncate().child(i.title));
  }

  section(t, title, body) {
    return v_flex().gap(6)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title))
      .child(body);
  }

  render(cx) {
    const t = theme();
    const i = this.issue;
    const frame = v_flex().id("linear-detail").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13);
    if (!i) {
      const note = this.error ? `Couldn't load: ${this.error}` : this.id ? "Loading…" : "Pick an issue in the Linear list.";
      return frame.child(div().p(16).text_color(this.error ? t.ansi1 : t.dim).child(note));
    }
    const matched = spacesFor(i.identifier, spaces());
    const comments = [...i.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return frame
      .child(h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(this.picker(t, "ld-head-state", 14))
        .child(div().text_size(12).text_color(t.muted).child(i.identifier))
        .child(div().flex_1())
        .when(this.loading, (el) => el.child(div().text_size(11).text_color(t.dim).child("loading…")))
        .when(matched.length > 0, (el) => el.child(iconButton(t, "ld-space", "Go to space", () => run("space.select", { id: matched[0].id }))))
        .when(matched.length === 0 && Boolean(i.branchName), (el) => el.child(iconButton(t, "ld-worktree", "+ Worktree", () =>
          openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260,
            props: { folder: `${home()}/Sherpas/basecamp`, action: "new", branch: i.branchName } }))))
        .child(iconButton(t, "ld-web", "Open in Linear ↗", () => openUrl(i.url)))
        .child(iconButton(t, "ld-reload", "↻", (cx) => this.load(i.identifier, cx)))
        .child(iconButton(t, "ld-close", "✕", () => this.onClose())))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("ld-body").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14).gap(16)
        .child(div().text_size(17).font_semibold().child(i.title))
        .child(v_flex().gap(2)
          .child(this.field(t, "Status", div().px(2).child(this.picker(t, "ld-state", 13, i.state.name))))
          .child(this.field(t, "Priority", div().child(i.priorityLabel)))
          .child(this.field(t, "Project", div().child(i.project?.name ?? "—")))
          .child(this.field(t, "Assignee", div().child(i.assignee?.name ?? "—")))
          .when(i.labels.nodes.length > 0, (el) => el.child(this.field(t, "Labels", h_flex().gap(6).flex_wrap()
            .children(i.labels.nodes.map((l) => h_flex().gap(4).items_center().px(6).py(1).rounded(10).border_1().border_color(t.border)
              .child(div().size(7).rounded(4).bg(l.color)).child(div().text_size(11).child(l.name)))))))
          .when(Boolean(i.branchName), (el) => el.child(this.field(t, "Branch", div().text_size(12).text_color(t.muted).child(i.branchName))))
          .child(this.field(t, "Created", div().text_size(12).text_color(t.muted)
            .child(`${day(i.createdAt)}${i.creator ? ` · ${i.creator.name}` : ""} · updated ${day(i.updatedAt)}`))))
        .when(Boolean(i.parent), (el) => el.child(this.section(t, "Parent", this.related(t, i.parent))))
        .when(i.children.nodes.length > 0, (el) => el.child(this.section(t, `Sub-issues ${i.children.nodes.length}`,
          v_flex().gap(1).children(i.children.nodes.map((c) => this.related(t, c))))))
        .when(i.attachments.nodes.length > 0, (el) => el.child(this.section(t, "Links",
          v_flex().gap(1).children(i.attachments.nodes.map((a, n) => h_flex().id(`ld-link-${n}`).h(26).px(6).gap(8).items_center()
            .rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(a.url))
            .child(div().flex_1().min_w(0).truncate().child(a.title || a.url))
            .when(Boolean(a.subtitle), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(11).text_color(t.dim).child(a.subtitle))))))))
        .child(this.section(t, "Description", i.description
          ? TextView.markdown(`ld-desc-${i.identifier}`, i.description).selectable()
          : div().text_color(t.dim).child("No description.")))
        .when(comments.length > 0, (el) => el.child(this.section(t, `Comments ${comments.length}`,
          v_flex().gap(10).children(comments.map((c, n) => v_flex().gap(4).p(10).rounded(8).border_1().border_color(t.border)
            .child(div().text_size(11).text_color(t.dim).child(`${c.user?.name ?? "—"} · ${day(c.createdAt)}`))
            .child(TextView.markdown(`ld-c-${i.identifier}-${n}`, c.body).selectable())))))));
  }
}
