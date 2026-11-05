// Shared by the issue list (main.js) and the issue detail pane (detail.js).

import { div, svg } from "gpui-kit";
import { exec } from "herdr";

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
//   STATES_KEY: { at, nodes }   started workflow states, for the state icons
export const MINE_KEY = "linear.mine";
export const STATES_KEY = "linear.states";
export const STATES_TTL = 24 * 60 * 60 * 1000;
export const ISSUE_FIELDS = `identifier title url branchName priority
  state { id name type position color } project { name } team { key } assignee { name }`;
export const MINE_QUERY = `{ viewer { assignedIssues(first: 250, orderBy: updatedAt,
  filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }) { nodes { ${ISSUE_FIELDS} } } } }`;
export const STATES_QUERY = `{ workflowStates(first: 250, filter: { type: { eq: "started" } }) { nodes { id position team { id } } } }`;
export const fresh = (entry, ms) => Boolean(entry?.at && Date.now() - entry.at < ms);

// Linear's started icon fills with the state's place among its team's started
// states: the i-th of n is (i+1)/(n+1) full, drawn in quarters.
export function startedSteps(states) {
  const teams = new Map();
  for (const s of states) teams.set(s.team.id, [...(teams.get(s.team.id) ?? []), s]);
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
