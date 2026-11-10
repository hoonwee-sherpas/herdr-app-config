// The usage meters in the status bar and their popup, against a fake host: the
// Claude usage endpoint (through a canned curl), the keychain's plan fields and
// Codex's session log. Never the real keychain or network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import { makeCx } from "../fakes/cx.mjs";
import { byId, text } from "../fakes/element.mjs";
import Usage, { SHARED_KEY } from "../../mods/usage-limits/main.js";

const USAGE = {
  five_hour: { utilization: 42, resets_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
  seven_day: { utilization: 5, resets_at: new Date(Date.now() + 5 * 86400_000).toISOString() },
  limits: [
    { kind: "weekly_all", percent: 5, severity: "normal", resets_at: new Date(Date.now() + 5 * 86400_000).toISOString(), scope: null, is_active: true },
    { kind: "weekly_scoped", percent: 0, severity: "normal", resets_at: new Date(Date.now() + 5 * 86400_000).toISOString(), scope: { model: { display_name: "Fable" } }, is_active: false },
  ],
};
const codexEvent = () => JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "token_count", rate_limits: {
  primary: { used_percent: 73, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 },
  secondary: { used_percent: 20, window_minutes: 10080, resets_at: Math.floor(Date.now() / 1000) + 86400 }, plan_type: "pro" } } });

// What each script answers; a test changes these before acting.
let answer;
const which = (args) => {
  const script = args.join(" ");
  if (script.includes("api/oauth/usage")) return "usage";
  if (script.includes("subscriptionType")) return "plan";
  if (script.includes("rollout-")) return "codex";
  return "other";
};
beforeEach(() => {
  host.reset();
  answer = {
    usage: { code: 0, stdout: `${JSON.stringify(USAGE)}\n200`, stderr: "" },
    plan: { code: 0, stdout: '"subscriptionType":"max"\n"rateLimitTier":"default_claude_max_5x"\n', stderr: "" },
    codex: { code: 0, stdout: "", stderr: "" },
  };
  host.exec = async (_cmd, args) => answer[which(args)] ?? { code: 1, stdout: "", stderr: "" };
});

async function bar() {
  const cx = makeCx(), view = new Usage();
  view.init({}, cx);
  await cx.settle();
  return { view, cx };
}

test("the bar shows Claude's session and week use", async () => {
  const { view } = await bar();
  const s = text(view.render());
  assert.match(s, /Claude/);
  assert.match(s, /5h\s*42%/);
  assert.match(s, /Week\s*5%/);
  assert.doesNotMatch(s, /Codex/, "no Codex log, no Codex");
});

test("the token goes from the keychain to curl through a pipe, never through arguments or the mod", async () => {
  await bar();
  const fetch = host.execs.find((e) => which(e[1]) === "usage");
  const script = fetch[1].join(" ");
  assert.match(script, /security find-generic-password -s "Claude Code-credentials" -w/);
  assert.match(script, /\| curl [^|]*-H @-/);
  assert.doesNotMatch(script, /Bearer [A-Za-z0-9]/);
  // The plan lookup prints only the plan fields.
  const plan = host.execs.find((e) => which(e[1]) === "plan")[1].join(" ");
  assert.match(plan, /grep -oE/);
  assert.doesNotMatch(plan, /accessToken/);
});

test("it never refreshes the login itself: an expired one asks to open Claude Code", async () => {
  answer.usage = { code: 0, stdout: '{"error":{"type":"authentication_error"}}\n401', stderr: "" };
  const { view } = await bar();
  assert.match(text(view.render()), /Claude.*sign in/i);
  assert.ok(!host.execs.some((e) => /oauth\/token|refresh/.test(e[1].join(" "))));
  assert.match(host.shared[SHARED_KEY].claude.error, /run claude/i);
});

test("a failed fetch keeps the last numbers, marked stale", async () => {
  const { view, cx } = await bar();
  answer.usage = { code: 6, stdout: "", stderr: "curl: (6) Could not resolve host" };
  await cx.tick();
  const s = text(view.render());
  assert.match(s, /5h\s*42%/);
  assert.match(host.shared[SHARED_KEY].claude.error, /resolve host/);
});

test("Codex shows once it has a session log, from its last rate limits", async () => {
  answer.codex = { code: 0, stdout: `${codexEvent()}\n`, stderr: "" };
  Object.assign(host.theme, { accent: "#1971c2", working: "#f08c00", blocked: "#e03131" });
  const { view } = await bar();
  const s = text(view.render());
  assert.match(s, /Codex/);
  assert.match(s, /5h\s*73%/);
  const meter = byId(view.render(), "usage-codex-5h-fill");
  assert.equal(meter.props.bg, host.theme.working, "73% is amber");
});

test("it polls every few minutes, and redraws in between so reset times stay current", async () => {
  const { cx } = await bar();
  const before = host.execs.filter((e) => which(e[1]) === "usage").length;
  answer.usage = { code: 0, stdout: `${JSON.stringify({ ...USAGE, five_hour: { ...USAGE.five_hour, utilization: 50 } })}\n200`, stderr: "" };
  await cx.tick();
  assert.equal(host.execs.filter((e) => which(e[1]) === "usage").length, before + 1);
  assert.equal(host.shared[SHARED_KEY].claude.limits[0].percent, 50);
});

test("clicking the bar opens the details popup", async () => {
  const { view, cx } = await bar();
  byId(view.render(), "usage-bar").handlers.on_click({}, cx);
  const o = host.overlays.at(-1);
  assert.equal(o.mod, "usage-limits");
  assert.equal(o.kind, "popup");
  assert.equal(o.props.detail, true);
});

test("the popup lists every limit with its reset, the plan, and refreshes on demand", async () => {
  answer.codex = { code: 0, stdout: `${codexEvent()}\n`, stderr: "" };
  await bar(); // the bar fetched and shared it
  const fetches = () => host.execs.filter((e) => which(e[1]) === "usage").length;
  const n = fetches();
  host.props = { detail: true, overlay: "o1" };
  const cx = makeCx(), pop = new Usage();
  pop.init({}, cx);
  await cx.settle();
  assert.equal(fetches(), n, "fresh shared numbers: no fetch on open");
  const s = text(pop.render());
  for (const m of [/Claude/, /Max 5x/, /5h/, /42%/, /in 1h 59m|in 2h/, /Week/, /Fable week/, /Codex/, /Pro/]) assert.match(s, m);
  byId(pop.render(), "usage-refresh").handlers.on_click({}, cx);
  await cx.settle();
  assert.equal(fetches(), n + 1);
});

test("opened as an overlay (mod.open) it's the popup; with no 5-hour limit reported there's no 5h row", async () => {
  answer.usage = { code: 0, stdout: `${JSON.stringify({ ...USAGE, five_hour: null })}\n200`, stderr: "" };
  host.props = { overlay: "o9" };
  const cx = makeCx(), pop = new Usage();
  pop.init({}, cx);
  await cx.settle();
  const s = text(pop.render());
  assert.doesNotMatch(s, /5h/);
  assert.match(s, /Week/);
  assert.ok(byId(pop.render(), "usage-refresh"), "the popup, not the bar");
  assert.equal(byId(pop.render(), "usage-bar"), null);
});

test("the status bar keeps Herdr's own contents, with the meters right after the agent count", async () => {
  host.spaces = [{ id: "s1", name: "basecamp", folder: "/r/basecamp", machine: null, branch: "prd-9961", active: true, tabs: [] }];
  host.agents = [{ id: "a1", status: "working" }, { id: "a2", status: "blocked" }];
  host.keys = [{ section: "global", action: "app.palette", keys: "cmd-shift-p" }];
  const { view, cx } = await bar();
  const s = text(view.render());
  for (const m of [/This computer/, /prd-9961/, /2 agents/, /1 needs you/, /⌘⇧P\s*commands/]) assert.match(s, m);
  assert.ok(s.indexOf("2 agents") < s.indexOf("Claude"), "after the agents");
  assert.ok(s.indexOf("Claude") < s.indexOf("commands"), "before the commands hint on the right");
  byId(view.render(), "palette").handlers.on_click({}, cx);
  assert.equal(host.ran("app.palette").length, 1);
});

test("with no 5-hour limit reported, the bar shows the week alone", async () => {
  answer.usage = { code: 0, stdout: `${JSON.stringify({ ...USAGE, five_hour: null })}\n200`, stderr: "" };
  const { view } = await bar();
  const s = text(view.render());
  assert.doesNotMatch(s, /5h/);
  assert.match(s, /Claude\s*Week\s*5%/);
});

test("on the Ultra plan (Max 20x) the bar and popup never show a 5-hour limit, even if one is reported", async () => {
  answer.plan = { code: 0, stdout: '"subscriptionType":"max"\n"rateLimitTier":"default_claude_max_20x"\n', stderr: "" };
  const { view } = await bar();
  assert.doesNotMatch(text(view.render()), /5h/);
  assert.match(text(view.render()), /Week\s*5%/);
  host.props = { detail: true };
  const cx = makeCx(), pop = new Usage();
  pop.init({}, cx);
  await cx.settle();
  const s = text(pop.render());
  assert.match(s, /Ultra/);
  assert.doesNotMatch(s, /5h/);
});
