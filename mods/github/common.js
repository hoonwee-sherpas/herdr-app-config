// Shared by the GitHub list (main.js) and its detail view (detail.js): talking to
// gh, reading what it returns, and the small pieces both draw.

import { div, svg } from "gpui-kit";
import { exec, home, layout, run, openOverlay, setShared, shared } from "herdr";

// What the detail view shows: { repo, kind: "pr" | "run", id }.
export const DETAIL_KEY = "github.detail";

// ---- gh

// gh lives wherever the person installed it, and the app's PATH may not have it.
let bin = null;
async function ghBin() {
  if (bin) return bin;
  for (const b of ["gh", `${home()}/.nix-profile/bin/gh`, "/opt/homebrew/bin/gh", "/usr/local/bin/gh"]) {
    try { if ((await exec(b, ["--version"])).code === 0) return (bin = b); } catch { /* not there */ }
  }
  throw new Error("gh isn't installed (brew install gh), or isn't on the app's PATH");
}

/** Runs gh with `args`; resolves to its parsed JSON, or its text with { raw: true }. */
export async function gh(args, { raw = false } = {}) {
  const r = await exec(await ghBin(), args);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || `gh exited ${r.code}`);
  return raw ? r.stdout : JSON.parse(r.stdout || "null");
}

export const errorText = (e) => String(e?.message ?? e).split("\n")[0];

/** owner/repo from a GitHub remote URL (https or ssh), else null. */
export function parseRemote(url) {
  const m = String(url ?? "").trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The GitHub repo a space's folder belongs to (its origin), else null. */
export async function repoOf(space) {
  if (!space?.folder) return null;
  try {
    const r = await exec("git", ["remote", "get-url", "origin"], { cwd: space.folder, on: space.machine ?? null });
    return r.code === 0 ? parseRemote(r.stdout) : null;
  } catch { return null; }
}

// ---- pages

// One page: closed PRs are two-line rows (about a screenful at 25); runs are
// grouped by workflow, so a page needs enough of them to fill several groups.
export const PAGE = { closed: 25, runs: 30 };
// GitHub's search and run lists stop at 1000 results however many there are.
const MAX_RESULTS = 1000;
export const pageCount = (total, size) => Math.max(1, Math.ceil(Math.min(total, MAX_RESULTS) / size));

// Closed PRs come from GitHub's search, which pages with cursors and filters on
// the server, so Mine and the search cover every page, not just the shown one.
export const CLOSED_SEARCH = `query($q: String!, $n: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $n, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title state isDraft headRefName baseRefName updatedAt closedAt mergedAt url
      author { login } isCrossRepository } } } }`;

/** The search for a repo's closed PRs, newest first: "mine" are yours, "review" ones you reviewed. */
export function closedQuery(repo, filter, term) {
  const words = term.replace(/["#]/g, " ").trim().split(/\s+/).filter(Boolean);
  return [`repo:${repo} is:pr is:closed sort:updated-desc`, filter === "mine" ? "author:@me" : filter === "review" ? "reviewed-by:@me" : "", ...words]
    .filter(Boolean).join(" ");
}

/** A run from the REST API (which pages by number), shaped like gh run list's. */
export const fromRestRun = (r) => ({
  databaseId: r.id, number: r.run_number, workflowName: r.name, displayTitle: r.display_title, status: r.status,
  conclusion: r.conclusion ?? "", headBranch: r.head_branch, event: r.event, createdAt: r.created_at,
  startedAt: r.run_started_at, updatedAt: r.updated_at, url: r.html_url,
});

// ---- cache

// Answers from GitHub, kept in herdr's shared store (shared.json, so they
// outlive a restart) like the Linear mods' cache: { [key]: { at, data } }.
// Keys: "runs|<repo>|<workflow id or *>|<page>", "workflows|<repo>",
// "open|<repo>" (slim: see slimPr), "closed|<repo>|<search>|<page>", "me".
export const CACHE_KEY = "github.cache";
export const CACHE_MAX = 40; // entries (a runs page is ~9 KB in shared.json); the oldest go first
export const RUNS_TTL = 60 * 1000;
export const WORKFLOWS_TTL = 24 * 60 * 60 * 1000;
export const PRS_TTL = 60 * 1000;     // open PRs, closed pages, details
export const ME_TTL = 24 * 60 * 60 * 1000;
export const DETAILS_MAX = 20;

// Details (a PR's files, checks and comments; a run's jobs) are tens of KB
// each, too big for shared.json, so they're kept in memory: going back to one
// is instant until the app restarts. "pr|<repo>|<n>", "run|<repo>|<id>" → { at, data }.
export const details = new Map();
export function keepDetail(key, data) {
  details.delete(key);
  details.set(key, { at: Date.now(), data });
  while (details.size > DETAILS_MAX) details.delete(details.keys().next().value);
}

/** An open PR as the list needs it: its checks summed up (checks) instead of
 *  every check, and no reviews. A hundred PRs' checks are hundreds of KB. */
export function slimPr({ statusCheckRollup, latestReviews, ...rest }) {
  return { ...rest, checks: checkState(statusCheckRollup) };
}

export const cached = (key, store = CACHE_KEY) => shared(store)?.[key] ?? null;
export const fresh = (entry, ms) => Boolean(entry?.at && Date.now() - entry.at < ms);

/** Keeps `data` under `key` in a store, dropping the oldest past `max` entries. */
export function remember(key, data, store = CACHE_KEY, max = CACHE_MAX) {
  const all = { ...(shared(store) ?? {}), [key]: { at: Date.now(), data } };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(max)) delete all[k];
  setShared(store, all);
}

// ---- reading what gh returns

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
/** A PR's checks in one word: "failure", "pending", "success", or null when it has none. */
export function checkState(rollup) {
  if (!rollup?.length) return null;
  const each = rollup.map((c) => (c.__typename === "StatusContext"
    ? (c.state === "SUCCESS" ? "ok" : FAILED.has(c.state) ? "bad" : "wait")
    : c.status !== "COMPLETED" ? "wait" : FAILED.has(c.conclusion) ? "bad" : "ok"));
  return each.includes("bad") ? "failure" : each.includes("wait") ? "pending" : "success";
}

/** One check's state, the same words as checkState. */
export const oneCheck = (c) => checkState([c]);

export function prState(pr) {
  if (pr.state === "MERGED" || pr.mergedAt) return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.isDraft ? "draft" : "open";
}

/** A workflow run (or job, or step): success, failure, cancelled, skipped, running or queued. */
export function runState(r) {
  if (r.status === "completed") {
    if (r.conclusion === "success" || r.conclusion === "neutral") return "success";
    if (r.conclusion === "cancelled") return "cancelled";
    if (r.conclusion === "skipped") return "skipped";
    return "failure";
  }
  return r.status === "in_progress" ? "running" : "queued";
}

/** Linear issue ids (PRD-123) for the given team keys, in order, once each. */
export function linearIds(text, keys) {
  if (!text || !keys?.length) return [];
  const re = new RegExp(`(?:^|[^a-z0-9])((?:${keys.join("|")})-\\d+)(?![a-z0-9])`, "gi");
  return [...new Set([...String(text).matchAll(re)].map((m) => m[1].toUpperCase()))];
}

/** A PR body as markdown: comments dropped, links kept, other HTML tags removed. */
export function cleanBody(text) {
  return String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ms = (iso) => (iso && !iso.startsWith("0001") ? Date.parse(iso) : NaN);
/** How long ago, briefly: now, 5m, 3h, 2d. */
export function ago(iso, now = Date.now()) {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

/** "5m ago", or "just now". */
export const since = (iso, now = Date.now()) => { const a = ago(iso, now); return a === "now" ? "just now" : a ? `${a} ago` : ""; };

/** How long something took: 9s, 1m 20s, 1h 30m; "" when it hasn't finished. */
export function took(from, to) {
  const a = ms(from), b = ms(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const spacesForBranch = (branch, all) => (branch ? all.filter((s) => s.branch === branch) : []);

const asked = (pr, me) => (pr.reviewRequests ?? []).some((r) => r.login === me);

/** PRs for a filter ("all" | "mine" | "review") and a search over number, title and branch. */
export function filterPrs(prs, { filter, term, me }) {
  const q = term.trim().toLowerCase().replace(/^#/, "");
  return prs.filter((p) => (filter === "mine" ? p.author?.login === me : filter === "review" ? asked(p, me) : true))
    .filter((p) => !q || String(p.number) === q || p.title.toLowerCase().includes(q) || (p.headRefName ?? "").toLowerCase().includes(q));
}

const REVIEWED = { APPROVED: ["approved", "success"], CHANGES_REQUESTED: ["requested changes on", "warning"], COMMENTED: ["commented on", "info"] };
const reviewKey = (r) => `${r.author?.login}:${r.state}:${r.submittedAt}`;

/** What changed between two looks at the open PRs that's worth a toast:
 *  [{ number, title, body, level }]. The first look (prev null) and PRs new
 *  to the list say nothing. */
export function alerts(prev, next, me) {
  if (!prev || !me) return [];
  const before = new Map(prev.map((p) => [p.number, p]));
  const out = [];
  for (const p of next) {
    const was = before.get(p.number);
    if (!was) continue;
    const mine = p.author?.login === me;
    if (mine && checkState(p.statusCheckRollup) === "failure" && checkState(was.statusCheckRollup) !== "failure") {
      out.push({ number: p.number, level: "error", title: `CI failed on #${p.number}`, body: p.title });
    }
    if (!mine && asked(p, me) && !asked(was, me)) {
      out.push({ number: p.number, level: "info", title: `${p.author?.login ?? "Someone"} asked you to review #${p.number}`, body: p.title });
    }
    if (mine) {
      const seen = new Set((was.latestReviews ?? []).map(reviewKey));
      for (const r of p.latestReviews ?? []) {
        if (seen.has(reviewKey(r)) || r.author?.login === me || !REVIEWED[r.state]) continue;
        const [verb, level] = REVIEWED[r.state];
        out.push({ number: p.number, level, title: `${r.author?.login} ${verb} #${p.number}`, body: p.title });
      }
    }
  }
  return out;
}

// ---- layout

function pathTo(node, id) {
  if (!node) return null;
  if (node.id === id) return [node];
  for (const c of node.children ?? []) { const p = pathTo(c, id); if (p) return [node, ...p]; }
  return null;
}

/** Makes a layout block visible: shows every hidden node on the way to it and
 *  picks its branch in any stack. False when the layout has no such block. */
export function reveal(id) {
  const path = pathTo(layout(), id);
  if (!path) return false;
  path.forEach((n, i) => {
    if (n.type === "stack" && path[i + 1]) run("layout.select", { stack: n.id, child: path[i + 1].id });
    if (n.hidden) run("layout.show", { id: n.id });
  });
  return true;
}

// ---- spaces and Linear

/** A worktree space for a PR's branch: fetch the branch from origin first (so
 *  the checkout has its commits, not a new branch off HEAD), then the
 *  worktree dialog in the given space's checkout. */
export async function makeWorktree(space, branch) {
  if (!space?.folder || !branch) return;
  try { await exec("git", ["fetch", "origin", `${branch}:${branch}`], { cwd: space.folder, on: space.machine ?? null }); } catch { /* the dialog says what's wrong */ }
  openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260,
    props: { folder: space.folder, action: "new", branch, ...(space.machine ? { machine: space.machine } : {}) } });
}

/** The Linear team keys (PRD…) from the Linear mods' shared cache. */
export function linearKeys() {
  const keys = new Set((shared("linear.workflowStates")?.nodes ?? []).map((n) => n.team?.key).filter(Boolean));
  return keys.size ? [...keys] : ["PRD"];
}

/** Shows a Linear issue in the Linear panel's detail block. */
export function openLinear(id) {
  setShared("linear.detail", id);
  reveal("linear-detail");
}

// ---- drawing

// GitHub's state colors, readable on light and dark.
export const COLOR = { open: "#2da44e", draft: "#8b949e", merged: "#8957e5", closed: "#e5534b",
  success: "#2da44e", failure: "#e5534b", pending: "#d4a72c", running: "#d4a72c", queued: "#8b949e",
  cancelled: "#8b949e", skipped: "#8b949e" };

/** A PR's state icon (open, draft, merged, closed). */
export function prIcon(state, size = 14) {
  return svg(`mods/github/pr-${state}.svg`).size(size).flex_none().text_color(COLOR[state]);
}

/** A check, run, job or step state icon; a spinner while running. */
export function stateIcon(state, size = 12) {
  if (!state) return null;
  const el = state === "running" ? svg("mods/workspace-chrome/spinner.svg").size(size).spin(900)
    : svg(`mods/github/check-${state === "pending" ? "pending" : state}.svg`).size(size);
  return el.flex_none().text_color(COLOR[state]);
}

export function iconButton(t, id, label, onClick) {
  return div().id(id).flex_none().px(5).rounded(4).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

export function chip(t, id, label, on, onClick) {
  return div().id(id).flex_none().px(6).py(1).rounded(4).text_size(10).cursor_pointer()
    .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); })
    .child(label);
}
