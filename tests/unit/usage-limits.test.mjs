import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeLimits, codexLimits, planLabel, hasFiveHour, resetText, level } from "../../mods/usage-limits/main.js";

// Trimmed from a real /api/oauth/usage answer (Max 20x, early in the week).
const CLAUDE = {
  five_hour: null,
  seven_day: { utilization: 5.0, resets_at: "2026-11-15T08:00:00.350373+00:00" },
  seven_day_opus: null,
  limits: [
    { kind: "weekly_all", group: "weekly", percent: 5, severity: "normal", resets_at: "2026-11-15T08:00:00.350373+00:00", scope: null, is_active: true },
    { kind: "weekly_scoped", group: "weekly", percent: 0, severity: "normal", resets_at: "2026-11-15T08:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false },
  ],
};

test("Claude's limits: only those the server reports (no 5-hour one here), the week first, then per-model weeks", () => {
  const l = claudeLimits(CLAUDE);
  assert.deepEqual(l.map((x) => x.label), ["Week", "Fable week"]);
  assert.equal(l[0].percent, 5);
  assert.equal(l[0].resetsAt, Date.parse("2026-11-15T08:00:00.350373+00:00"));
  assert.equal(l[1].active, false);
});

test("a 5-hour window, when the server reports one, comes first with its use and reset", () => {
  const l = claudeLimits({ ...CLAUDE, five_hour: { utilization: 42.4, resets_at: "2026-11-10T06:00:00+00:00" } });
  assert.equal(l[0].label, "5h");
  assert.equal(l[0].percent, 42.4);
  assert.equal(l[0].resetsAt, Date.parse("2026-11-10T06:00:00+00:00"));
});

test("a session limit in the limits list is used as is, not doubled", () => {
  const limits = [{ kind: "session", percent: 61, severity: "warning", resets_at: "2026-11-10T06:00:00Z", is_active: true }, ...CLAUDE.limits];
  const l = claudeLimits({ ...CLAUDE, five_hour: { utilization: 61, resets_at: "2026-11-10T06:00:00Z" }, limits });
  assert.deepEqual(l.map((x) => x.label), ["5h", "Week", "Fable week"]);
  assert.equal(l[0].severity, "warning");
});

test("an answer without the limits list falls back to the windows", () => {
  const l = claudeLimits({ five_hour: { utilization: 10, resets_at: "2026-11-10T06:00:00Z" }, seven_day: { utilization: 20, resets_at: "2026-11-15T08:00:00Z" }, seven_day_opus: { utilization: 30, resets_at: "2026-11-15T08:00:00Z" } });
  assert.deepEqual(l.map((x) => [x.label, x.percent]), [["5h", 10], ["Week", 20], ["Opus week", 30]]);
});

// A token_count event as Codex writes it to ~/.codex/sessions/…/rollout-*.jsonl.
const at = Date.parse("2026-11-10T01:00:00Z");
const codexLine = (extra = {}) => JSON.stringify({
  timestamp: "2026-11-10T01:00:00.000Z", type: "event_msg",
  payload: { type: "token_count", info: null, rate_limits: {
    primary: { used_percent: 12.5, window_minutes: 300, resets_at: at / 1000 + 3600 },
    secondary: { used_percent: 40, window_minutes: 10080, resets_at: at / 1000 + 3 * 86400 },
    plan_type: "plus", ...extra } },
});

test("Codex's limits come from the last token_count event in its session log", () => {
  const c = codexLimits(codexLine(), at + 60_000);
  assert.equal(c.plan, "Plus");
  assert.equal(c.asOf, at);
  assert.deepEqual(c.limits.map((x) => [x.label, x.percent, x.resetsAt]), [["5h", 12.5, at + 3600_000], ["Week", 40, at + 3 * 86400_000]]);
});

test("a Codex window that has reset since the log was written shows as empty", () => {
  const c = codexLimits(codexLine(), at + 2 * 3600_000);
  assert.equal(c.limits[0].percent, 0);
  assert.equal(c.limits[1].percent, 40);
});

test("older Codex logs give resets_in_seconds, counted from the event", () => {
  const line = codexLine({ primary: { used_percent: 5, window_minutes: 300, resets_in_seconds: 600 }, secondary: null });
  const c = codexLimits(line, at);
  assert.deepEqual(c.limits.map((x) => [x.label, x.resetsAt]), [["5h", at + 600_000]]);
});

test("no Codex log, or junk, means no Codex section", () => {
  assert.equal(codexLimits("", at), null);
  assert.equal(codexLimits("{nope", at), null);
  assert.equal(codexLimits(JSON.stringify({ payload: { type: "token_count", rate_limits: null } }), at), null);
});

test("plan names read the way the plans are sold", () => {
  assert.equal(planLabel("max", "default_claude_max_20x"), "Ultra", "Max 20x is the Ultra plan");
  assert.equal(planLabel("max", "default_claude_max_5x"), "Max 5x");
  assert.equal(planLabel("pro", "default_claude_ai"), "Pro");
  assert.equal(planLabel(null, null), null);
});

test("reset times: minutes and hours when close, a weekday and time when days away", () => {
  const now = new Date(2026, 10, 10, 9, 0).getTime(); // Tue 09:00 local
  assert.equal(resetText(now + 42 * 60_000, now), "in 42m");
  assert.equal(resetText(now + (3 * 60 + 12) * 60_000, now), "in 3h 12m");
  assert.equal(resetText(new Date(2026, 10, 15, 17, 0).getTime(), now), "Sun 17:00");
  assert.equal(resetText(now - 1000, now), "now");
  assert.equal(resetText(null, now), "");
});

test("meters turn amber from 70% and red from 90%, or when the service says so", () => {
  assert.equal(level({ percent: 69 }), "ok");
  assert.equal(level({ percent: 70 }), "warn");
  assert.equal(level({ percent: 90 }), "full");
  assert.equal(level({ percent: 10, severity: "warning" }), "warn");
  assert.equal(level({ percent: 10, severity: "critical" }), "full");
  assert.equal(level({ percent: null }), "ok");
});

test("the Ultra plan (also sold as Max 20x) has no 5-hour limit; other plans do", () => {
  assert.equal(hasFiveHour("ultra", "default_claude_ultra"), false);
  assert.equal(hasFiveHour("max", "default_claude_ultra"), false);
  assert.equal(hasFiveHour("max", "default_claude_max_20x"), false);
  assert.equal(hasFiveHour("max", "default_claude_max_5x"), true);
  assert.equal(hasFiveHour("pro", "default_claude_ai"), true);
  assert.equal(hasFiveHour(null, null), true, "unknown plan: go by what the server reports");
  assert.equal(planLabel("ultra", "default_claude_ultra"), "Ultra");
});

test("without a 5-hour limit, a reported 5-hour window is left out", () => {
  const body = { ...CLAUDE, five_hour: { utilization: 3, resets_at: "2026-11-10T06:00:00Z" },
    limits: [{ kind: "session", percent: 3, resets_at: "2026-11-10T06:00:00Z" }, ...CLAUDE.limits] };
  assert.deepEqual(claudeLimits(body, { fiveHour: false }).map((x) => x.label), ["Week", "Fable week"]);
  assert.deepEqual(claudeLimits(body).map((x) => x.label), ["5h", "Week", "Fable week"]);
});
