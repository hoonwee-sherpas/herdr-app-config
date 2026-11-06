// Shared by the issue list (main.js) and the issue detail pane (detail.js).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { exec, shared, setShared } from "herdr";

// The API key lives in the macOS keychain (service "linear-api-key") and goes
// to curl through a pipe, so it is never in these files or in process arguments.
const FETCH = `security find-generic-password -s linear-api-key -w | sed 's/^/Authorization: /' \
  | curl -sS --max-time 20 https://api.linear.app/graphql -H @- -H 'Content-Type: application/json' -d "$1"`;

export async function gql(query, variables) {
  const r = await exec("sh", ["-c", FETCH, "linear", JSON.stringify({ query, variables })]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  const d = JSON.parse(r.stdout);
  if (d.errors?.length) throw new Error(d.errors[0].message);
  return d.data;
}

export const errorText = (e) => String(e?.message ?? e).split("\n")[0];

// The issue shown in the detail pane, by identifier (every copy sees it).
export const DETAIL_KEY = "linear.detail";

// A cache both Linear mods share (shared.json, so it outlives restarts). Whoever
// fetches writes it; the other draws it at once and refreshes when it's stale.
//   MINE_KEY:   { at, issues }  open issues assigned to me (ISSUE_FIELDS)
//   STATES_KEY: { at, nodes }   every team's workflow states (STATE_FIELDS), for
//                               the state icons and the status picker
export const MINE_KEY = "linear.mine";
export const STATES_KEY = "linear.workflowStates";
export const STATES_TTL = 24 * 60 * 60 * 1000;
export const STATE_FIELDS = "id name type position color team { id key }";
export const ISSUE_FIELDS = `id identifier title url branchName priority
  state { id name type position color } project { name } team { key } assignee { name }`;
export const MINE_QUERY = `{ viewer { assignedIssues(first: 250, orderBy: updatedAt,
  filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }) { nodes { ${ISSUE_FIELDS} } } } }`;
export const STATES_QUERY = `{ workflowStates(first: 250) { nodes { ${STATE_FIELDS} } } }`;
export const fresh = (entry, ms) => Boolean(entry?.at && Date.now() - entry.at < ms);

// Linear's started icon fills with the state's place among its team's started
// states: the i-th of n is (i+1)/(n+1) full, drawn in quarters.
export function startedSteps(states) {
  const teams = new Map();
  for (const s of states.filter((s) => s.type === "started")) teams.set(s.team.id, [...(teams.get(s.team.id) ?? []), s]);
  const steps = new Map();
  for (const list of teams.values()) {
    list.sort((a, b) => a.position - b.position);
    list.forEach((s, i) => steps.set(s.id, Math.min(3, Math.max(1, Math.round((4 * (i + 1)) / (list.length + 1))))));
  }
  return steps;
}

// A workflow state as Linear draws it, in the state's own color.
export function stateIcon(state, steps, size = 14) {
  const file = state.type === "started" ? `started-${steps.get(state.id) ?? 2}` : state.type;
  return svg(`mods/linear-issues/state-${file}.svg`).size(size).flex_none().text_color(state.color);
}

// The order Linear lists a team's states in.
const PICK_RANK = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 5, duplicate: 6 };

/** A team's workflow states (by team key), in Linear's order. */
export function teamStates(nodes, teamKey) {
  return (nodes ?? []).filter((s) => s.team?.key === teamKey)
    .sort((a, b) => (PICK_RANK[a.type] ?? 9) - (PICK_RANK[b.type] ?? 9) || a.position - b.position);
}

const UPDATE = `mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { state { id name type position color } } } }`;

/** Moves the issue to `state` in Linear; resolves to the state Linear reports. */
export async function setIssueState(issue, state) {
  const d = await gql(UPDATE, { id: issue.id ?? issue.identifier, stateId: state.id });
  if (!d.issueUpdate?.success) throw new Error("Linear didn't change the status");
  return d.issueUpdate.issue?.state ?? state;
}

/** Puts an issue's new state into the shared cache, so every copy shows it. */
export function shareState(identifier, state) {
  const mine = shared(MINE_KEY);
  if (!mine?.issues) return;
  setShared(MINE_KEY, { at: Math.max(Date.now(), mine.at + 1),
    issues: mine.issues.map((i) => (i.identifier === identifier ? { ...i, state } : i)) });
}

// A state icon (and optional label) that opens a menu of the team's states.
// Controlled: `open` comes from the caller, which hears changes via onOpen and
// the choice via onPick. The press stops here, so a row under it doesn't open.
export function statePicker(t, { id, state, steps, states, open, onOpen, onPick, size = 14, label = null }) {
  const trigger = h_flex().id(`${id}-trigger`).flex_none().gap(6).items_center().rounded(4).cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => cx.stop_propagation())
    .child(stateIcon(state, steps, size))
    .when(label != null, (el) => el.child(label));
  const menu = v_flex().id(`${id}-menu`).min_w(190).p(4).gap(1).rounded(8).border_1().border_color(t.border)
    .bg(t.popover).shadow_lg().text_size(13).text_color(t.foreground)
    .when(states.length === 0, (el) => el.child(div().px(8).py(4).text_size(12).text_color(t.dim).child("No states loaded yet.")))
    .children(states.map((s) => h_flex().id(`${id}-opt-${s.id}`).h(28).px(8).gap(8).items_center().rounded(5).cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); onPick(s, cx); })
      .child(stateIcon(s, steps, 13))
      .child(div().flex_1().child(s.name))
      .when(s.id === state.id, (el) => el.child(div().text_size(12).text_color(t.dim).child("✓")))));
  return Popover.new(id).anchor("top_left").open(open)
    .on_open_change((o, cx) => onOpen(o, cx))
    .trigger(trigger).content(menu);
}

// Spaces whose branch, folder or name carries the identifier (not prd-102 in prd-1025).
export function spacesFor(identifier, all) {
  const re = new RegExp(`(^|[^a-z0-9])${identifier.toLowerCase()}($|[^0-9])`);
  return all.filter((s) => [s.branch, s.folder, s.name].some((v) => v && re.test(v.toLowerCase())));
}

export const openUrl = (url) => exec("open", [url]).catch(() => {});

export function iconButton(t, id, label, onClick) {
  return div().id(id).flex_none().px(5).rounded(4).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}
