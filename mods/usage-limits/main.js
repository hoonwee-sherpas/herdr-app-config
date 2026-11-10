// The status bar with Claude and Codex plan usage: Herdr's own status bar
// (workspace-status, copied: shipped mods can't be changed) with compact meters
// right after the agent count, and a popup with every limit and when it resets
// (click the meters).
//
// Claude: the endpoint Claude Code's /usage reads, with Claude Code's own login.
// The token goes from the keychain to curl through a pipe, so it is never in
// this mod, a file or process arguments. An expired login is left for Claude
// Code to refresh (refreshing here would rotate its token out from under it).
// Codex: the rate limits it last logged (~/.codex/sessions), shown once it has any.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme, shared, setShared, props, openOverlay, home, spaces, agents, run, window, keys } from "herdr";

export const SHARED_KEY = "usage.limits";
const POLL_MS = 5 * 60 * 1000;
const REDRAW_MS = 30 * 1000;

const CLAUDE_USAGE = `security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
  | sed -nE 's/.*"accessToken":"([^"]+)".*/Authorization: Bearer \\1/p' \
  | curl -sS --max-time 20 -w '\\n%{http_code}' -H @- -H 'anthropic-beta: oauth-2025-04-20' \
    -H 'User-Agent: herdr-usage-limits' https://api.anthropic.com/api/oauth/usage`;
const CLAUDE_PLAN = `security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
  | grep -oE '"(subscriptionType|rateLimitTier)":"[^"]*"'`;
// The newest session log (of the last week) that holds rate limits: its last ones.
const CODEX_LAST = `d="\${CODEX_HOME:-$1/.codex}/sessions"; [ -d "$d" ] || exit 0
find "$d" -name 'rollout-*.jsonl' -mtime -8 2>/dev/null | xargs ls -t 2>/dev/null | head -n 5 | while IFS= read -r f; do
  l=$(grep -F '"rate_limits":{' "$f" | tail -n 1); if [ -n "$l" ]; then printf '%s\\n' "$l"; break; fi
done`;

// ---- reading the answers

const time = (iso) => (iso ? Date.parse(iso) : null);

/** Claude's limits as the server reports them, a 5-hour window first if there is one:
 *  [{ key, label, percent|null, resetsAt, severity, active }]. */
export function claudeLimits(body, { fiveHour = true } = {}) {
  const out = [];
  const isSession = (k) => /session|five_hour|5h/.test(k ?? "");
  const fromList = Array.isArray(body?.limits) ? body.limits : null;
  const session = fromList?.find((l) => isSession(l.kind));
  if (!fiveHour) { /* the plan has none */ }
  else if (session) out.push({ label: "5h", percent: session.percent ?? null, resetsAt: time(session.resets_at), severity: session.severity, active: session.is_active !== false });
  // No five_hour means no 5-hour limit applies now (the response headers then
  // carry only the weekly one), not an idle window: show nothing for it.
  else if (body?.five_hour) out.push({ label: "5h", percent: body.five_hour.utilization ?? null, resetsAt: time(body.five_hour.resets_at), severity: null, active: true });
  if (fromList) {
    for (const l of fromList) {
      if (isSession(l.kind)) continue;
      const label = l.kind === "weekly_all" ? "Week"
        : l.kind === "weekly_scoped" ? `${l.scope?.model?.display_name ?? l.scope?.surface ?? "Scoped"} week`
          : String(l.kind ?? "Limit").replace(/_/g, " ");
      out.push({ label, percent: l.percent ?? null, resetsAt: time(l.resets_at), severity: l.severity, active: l.is_active !== false });
    }
  } else {
    for (const [k, label] of [["seven_day", "Week"], ["seven_day_opus", "Opus week"], ["seven_day_sonnet", "Sonnet week"]]) {
      const w = body?.[k];
      if (w) out.push({ label, percent: w.utilization ?? null, resetsAt: time(w.resets_at), severity: null, active: true });
    }
  }
  return out.map((l) => ({ ...l, key: l.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
}

const windowLabel = (min) => min === 300 ? "5h" : min === 10080 ? "Week"
  : min && min % 1440 === 0 ? `${min / 1440}d` : min && min % 60 === 0 ? `${min / 60}h` : "Limit";
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : null);

/** Codex's last logged limits: { plan, asOf, limits }, or null when there are none. */
export function codexLimits(line, now = Date.now()) {
  let d;
  try { d = JSON.parse(String(line).trim().split("\n").pop()); } catch { return null; }
  const rl = d?.payload?.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const asOf = time(d.timestamp) ?? now;
  const limits = [];
  for (const w of [rl.primary, rl.secondary]) {
    if (!w) continue;
    const resetsAt = w.resets_at != null ? w.resets_at * 1000 : w.resets_in_seconds != null ? asOf + w.resets_in_seconds * 1000 : null;
    const label = windowLabel(w.window_minutes);
    // The log is as old as the last session: a window that reset since is empty.
    const percent = resetsAt != null && resetsAt <= now ? 0 : w.used_percent;
    limits.push({ key: label.toLowerCase(), label, percent, resetsAt, severity: null, active: true });
  }
  return limits.length ? { plan: cap(rl.plan_type), asOf, limits } : null;
}

// The Ultra plan: named so, or Max 20x (the same plan). It has no 5-hour limit.
const isUltra = (sub, tier) => /ultra|max_20x/i.test(`${sub ?? ""} ${tier ?? ""}`);

/** Whether the plan has a 5-hour limit: Ultra (Max 20x) doesn't. Unknown plans go by what the server reports. */
export const hasFiveHour = (sub, tier) => !isUltra(sub, tier);

/** "Max 20x", "Pro", "Ultra"…, from Claude Code's login. */
export function planLabel(sub, tier) {
  if (!sub) return null;
  if (isUltra(sub, tier)) return "Ultra";
  const x = /max_(\d+x)/.exec(tier ?? "");
  return x ? `${cap(sub)} ${x[1]}` : cap(sub);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** When a window resets: "in 42m", "in 3h 12m", or "Sun 17:00" when a day or more away. */
export function resetText(at, now = Date.now()) {
  if (at == null) return "";
  const min = Math.floor((at - now) / 60_000);
  if (at <= now) return "now";
  if (min < 60) return `in ${Math.max(1, min)}m`;
  if (min < 24 * 60) return `in ${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`;
  const d = new Date(at);
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "ok", "warn" (from 70%) or "full" (from 90%), or what the service's severity says. */
export function level(l) {
  const rank = { ok: 0, warn: 1, full: 2 };
  const bySeverity = !l.severity || l.severity === "normal" ? "ok"
    : /crit|exceed|block|reach|limit|error/i.test(l.severity) ? "full" : "warn";
  const p = l.percent ?? 0;
  const byPercent = p >= 90 ? "full" : p >= 70 ? "warn" : "ok";
  return rank[bySeverity] > rank[byPercent] ? bySeverity : byPercent;
}

const pct = (p) => (p == null ? "–" : `${Math.round(p)}%`);
const ago = (at, now = Date.now()) => {
  const m = Math.floor((now - at) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
};

// ---- the view

export default class UsageLimits extends View {
  init(_props, cx) {
    // The popup: opened by a click on the bar (detail) or as an overlay (mod.open).
    this.detail = Boolean(props()?.detail || props()?.overlay);
    const s = shared(SHARED_KEY);
    if (!(s?.claude?.at && Date.now() - s.claude.at < POLL_MS)) this.refresh(cx);
    if (!this.detail) cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
    cx.timer.every(REDRAW_MS, (cx) => cx.notify());
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const before = shared(SHARED_KEY) ?? {};
      const [usage, plan, codex] = await Promise.all([
        exec("sh", ["-c", CLAUDE_USAGE]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) })),
        exec("sh", ["-c", CLAUDE_PLAN]).catch(() => ({ code: 1, stdout: "" })),
        exec("sh", ["-c", CODEX_LAST, "usage-limits", home()]).catch(() => ({ code: 1, stdout: "" })),
      ]);
      const claude = { ...(before.claude ?? {}), at: Date.now() };
      const fields = Object.fromEntries([...plan.stdout.matchAll(/"(\w+)":"([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const fiveHour = hasFiveHour(fields.subscriptionType, fields.rateLimitTier);
      const lines = usage.stdout.trimEnd().split("\n");
      const status = Number(lines.pop());
      if (usage.code === 0 && status === 200) {
        try { claude.limits = claudeLimits(JSON.parse(lines.join("\n")), { fiveHour }); claude.error = null; claude.fetched = claude.at; }
        catch (e) { claude.error = `unreadable answer: ${e.message}`; }
      } else if (status === 401 || status === 403) {
        claude.error = "Claude Code's sign-in has expired: run claude to refresh it";
        claude.signedOut = true;
      } else {
        claude.error = (usage.stderr || "").trim().split("\n")[0] || `HTTP ${status || usage.code}`;
      }
      if (status === 200) claude.signedOut = false;
      claude.plan = planLabel(fields.subscriptionType, fields.rateLimitTier) ?? claude.plan ?? null;
      setShared(SHARED_KEY, { claude, codex: codexLimits(codex.stdout) });
      this.busy = false;
      cx.notify();
    });
  }

  meter(t, id, l, w, h) {
    const color = { ok: t.accent, warn: t.working, full: t.blocked }[level(l)];
    return div().w(w).h(h).flex_none().rounded(h / 2).bg(t.border).overflow_hidden()
      .child(div().id(id).h_full().rounded(h / 2).bg(color).w(Math.round((w * Math.min(100, Math.max(0, l.percent ?? 0))) / 100)));
  }

  render() {
    const t = theme();
    const s = shared(SHARED_KEY) ?? {};
    return this.detail ? this.popup(t, s) : this.bar(t, s);
  }

  // The palette's key, as Herdr's status bar shows it ("⌘⇧P  commands").
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = (keys() ?? []).find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // The status bar: Herdr's (machine, branch, agents, the palette hint), with
  // Claude's session and week, then Codex's, right after the agents.
  bar(t, s) {
    const space = (spaces() ?? []).find((x) => x.active);
    const list = agents() ?? [];
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const group = (name, id, data, error) => {
      const shown = (data?.limits ?? []).filter((l) => l.label === "5h" || l.label === "Week");
      return h_flex().gap(8).items_center()
        .child(div().text_color(t.muted).child(name))
        .when(!shown.length, (el) => el.child(div().text_color(t.dim).child(error ? (/sign-in/.test(error) ? "sign in" : "offline") : "…")))
        .children(shown.map((l) => h_flex().gap(4).items_center()
          .child(div().text_color(t.dim).child(l.label))
          .child(this.meter(t, `usage-${id}-${l.key}-fill`, l, 24, 4))
          .child(div().text_color(error ? t.dim : t.muted).child(pct(l.percent)))));
    };
    const tip = [s.claude?.error && `Claude: ${s.claude.error}`, "Click for details"].filter(Boolean).join("\n");
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(h_flex().id("usage-bar").gap(14).items_center().px(6).h_full().cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .tooltip(tip)
        .on_click(() => this.open(s))
        .child(group("Claude", "claude", s.claude, s.claude?.error))
        .when(Boolean(s.codex), (el) => el.child(group("Codex", "codex", s.codex, null))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }

  open(s) {
    const rows = (s.claude?.limits?.length ?? 2) + (s.codex ? s.codex.limits.length + 1.5 : 0);
    openOverlay({ mod: "usage-limits", kind: "popup", width: 320, height: Math.round(96 + rows * 42 + (s.claude?.error ? 34 : 0)), props: { detail: true } });
  }

  // The popup: every limit, its use and reset; the plan; when it was read.
  popup(t, s) {
    const now = Date.now();
    const row = (id, l) => v_flex().gap(4).opacity(l.active === false ? 0.55 : 1)
      .child(h_flex().items_center().gap(6).text_size(12)
        .child(div().text_color(t.foreground).child(l.label))
        .when(l.active === false, (el) => el.child(div().text_color(t.dim).text_size(10.5).child("not in effect")))
        .child(div().flex_1())
        .child(div().text_color(t.foreground).child(pct(l.percent)))
        .when(Boolean(l.resetsAt), (el) => el.child(div().text_color(t.dim).child(`· resets ${resetText(l.resetsAt, now)}`))))
      .child(this.meter(t, `usage-${id}-${l.key}-fill`, l, 292, 6));
    const head = (name, plan, note) => h_flex().items_center().gap(6)
      .child(div().text_size(12.5).text_color(t.foreground).child(name))
      .when(Boolean(plan), (el) => el.child(div().px(6).rounded(4).bg(t.raised ?? t.hover).text_size(10.5).text_color(t.muted).child(plan)))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(t.dim).child(note));
    const c = s.claude ?? {};
    return v_flex().size_full().p(14).gap(12).bg(t.popover ?? t.background).text_color(t.foreground)
      .child(head("Claude", c.plan, c.fetched ? `updated ${ago(c.fetched, now)}` : ""))
      .when(Boolean(c.error), (el) => el.child(div().text_size(11).text_color(c.signedOut ? t.working : t.dim).child(c.error)))
      .children((c.limits ?? []).map((l) => row("claude", l)))
      .when(Boolean(s.codex), (el) => el
        .child(div().h(1).bg(t.border))
        .child(head("Codex", s.codex.plan, `as of ${ago(s.codex.asOf, now)}`))
        .children(s.codex.limits.map((l) => row("codex", l))))
      .child(div().flex_1())
      .child(h_flex().items_center()
        .child(div().text_size(10.5).text_color(t.dim).child(s.codex ? "Codex: from its last session's log" : ""))
        .child(div().flex_1())
        .child(div().id("usage-refresh").px(8).py(2).rounded(5).cursor_pointer().text_size(11.5).text_color(t.muted)
          .hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.refresh(cx); })
          .child(this.busy ? "Refreshing…" : "Refresh")));
  }
}
