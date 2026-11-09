import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { host } from "herdr";
import {
  parseRemote, checkState, prState, runState, linearIds, cleanBody, ago, took,
  spacesForBranch, filterPrs, alerts, gh, repoOf, PAGE, pageCount, closedQuery, fromRestRun,
  CACHE_KEY, CACHE_MAX, cached, remember, fresh,
} from "../../mods/github/common.js";

beforeEach(() => host.reset());

test("parseRemote reads owner/repo from GitHub https and ssh remotes, nothing else", () => {
  assert.equal(parseRemote("https://github.com/sherpas-team/basecamp.git"), "sherpas-team/basecamp");
  assert.equal(parseRemote("https://github.com/sherpas-team/basecamp\n"), "sherpas-team/basecamp");
  assert.equal(parseRemote("git@github.com:hoonwee-sherpas/herdr-app-config.git"), "hoonwee-sherpas/herdr-app-config");
  assert.equal(parseRemote("ssh://git@github.com/a/b.git"), "a/b");
  assert.equal(parseRemote("https://gitlab.com/a/b.git"), null);
  assert.equal(parseRemote(""), null);
});

const run = (status, conclusion, extra = {}) => ({ __typename: "CheckRun", status, conclusion, ...extra });
test("checkState: any failure fails, else anything unfinished is pending, else success", () => {
  assert.equal(checkState([run("COMPLETED", "SUCCESS"), run("COMPLETED", "FAILURE")]), "failure");
  assert.equal(checkState([run("COMPLETED", "SUCCESS"), run("IN_PROGRESS", "")]), "pending");
  assert.equal(checkState([run("COMPLETED", "SUCCESS"), run("COMPLETED", "SKIPPED"), run("COMPLETED", "NEUTRAL")]), "success");
  assert.equal(checkState([{ __typename: "StatusContext", state: "ERROR" }]), "failure");
  assert.equal(checkState([{ __typename: "StatusContext", state: "PENDING" }]), "pending");
  assert.equal(checkState([run("COMPLETED", "TIMED_OUT")]), "failure");
  assert.equal(checkState([run("COMPLETED", "CANCELLED")]), "failure");
  assert.equal(checkState([]), null);
  assert.equal(checkState(undefined), null);
});

test("prState tells draft, open, merged and closed apart", () => {
  assert.equal(prState({ state: "OPEN", isDraft: true }), "draft");
  assert.equal(prState({ state: "OPEN", isDraft: false }), "open");
  assert.equal(prState({ state: "MERGED" }), "merged");
  assert.equal(prState({ state: "CLOSED", mergedAt: "2026-11-01T00:00:00Z" }), "merged");
  assert.equal(prState({ state: "CLOSED", mergedAt: null }), "closed");
});

test("runState reads gh's lower-case status and conclusion", () => {
  assert.equal(runState({ status: "completed", conclusion: "success" }), "success");
  assert.equal(runState({ status: "completed", conclusion: "failure" }), "failure");
  assert.equal(runState({ status: "completed", conclusion: "startup_failure" }), "failure");
  assert.equal(runState({ status: "completed", conclusion: "cancelled" }), "cancelled");
  assert.equal(runState({ status: "completed", conclusion: "skipped" }), "skipped");
  assert.equal(runState({ status: "in_progress", conclusion: "" }), "running");
  assert.equal(runState({ status: "queued", conclusion: "" }), "queued");
  assert.equal(runState({ status: "waiting", conclusion: "" }), "queued");
});

test("linearIds finds the team's issue ids in a branch or title, once each, upper case", () => {
  assert.deepEqual(linearIds("feature/prd-10378", ["PRD"]), ["PRD-10378"]);
  assert.deepEqual(linearIds("fix: 복구 (PRD-10378) and PRD-10378, OPS-12", ["PRD", "OPS"]), ["PRD-10378", "OPS-12"]);
  assert.deepEqual(linearIds("bump SHA-256 and UTF-8", ["PRD"]), [], "only the teams' keys");
  assert.deepEqual(linearIds("feature/prd-10254x", ["PRD"]), [], "a whole id, not a prefix");
  assert.deepEqual(linearIds(undefined, ["PRD"]), []);
});

test("cleanBody turns the HTML bots write into markdown and drops comments", () => {
  const body = `<!-- linear-linkback -->\n<details>\n<summary><a href="https://linear.app/x/PRD-1">PRD-1 Fix</a></summary>\n<p>\n\nText **bold**\n</p>\n</details>`;
  const out = cleanBody(body);
  assert.ok(!out.includes("<"), out);
  assert.ok(!out.includes("linear-linkback"));
  assert.match(out, /\[PRD-1 Fix\]\(https:\/\/linear\.app\/x\/PRD-1\)/);
  assert.match(out, /Text \*\*bold\*\*/);
  assert.equal(cleanBody("a < b and c > d"), "a < b and c > d", "comparisons aren't tags");
  assert.equal(cleanBody(""), "");
  assert.equal(cleanBody(null), "");
});

test("ago and took say how long, briefly", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  assert.equal(ago("2026-11-06T11:59:40Z", now), "now");
  assert.equal(ago("2026-11-06T11:55:00Z", now), "5m");
  assert.equal(ago("2026-11-06T09:00:00Z", now), "3h");
  assert.equal(ago("2026-11-03T12:00:00Z", now), "3d");
  assert.equal(ago(null, now), "");
  assert.equal(took("2026-11-06T11:00:00Z", "2026-11-06T11:01:20Z"), "1m 20s");
  assert.equal(took("2026-11-06T11:00:00Z", "2026-11-06T11:00:09Z"), "9s");
  assert.equal(took("2026-11-06T10:00:00Z", "2026-11-06T11:30:00Z"), "1h 30m");
  assert.equal(took("2026-11-06T11:00:00Z", "0001-01-01T00:00:00Z"), "", "not finished");
});

test("spacesForBranch matches a space on exactly that branch", () => {
  const all = [{ id: 1, branch: "feature/prd-1" }, { id: 2, branch: "feature/prd-10" }, { id: 3, branch: null }];
  assert.deepEqual(spacesForBranch("feature/prd-1", all).map((s) => s.id), [1]);
  assert.deepEqual(spacesForBranch(null, all), []);
});

const pr = (number, login, extra = {}) => ({ number, title: `PR ${number}`, headRefName: `feature/prd-${number}`,
  author: { login }, reviewRequests: [], latestReviews: [], statusCheckRollup: [], ...extra });

test("filterPrs: mine, review requested of me, and a search over number, title and branch", () => {
  const prs = [pr(1, "me"), pr(2, "kim", { reviewRequests: [{ __typename: "User", login: "me" }] }), pr(3, "lee", { title: "로그인 수정" })];
  assert.deepEqual(filterPrs(prs, { filter: "all", term: "", me: "me" }).map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(filterPrs(prs, { filter: "mine", term: "", me: "me" }).map((p) => p.number), [1]);
  assert.deepEqual(filterPrs(prs, { filter: "review", term: "", me: "me" }).map((p) => p.number), [2]);
  assert.deepEqual(filterPrs(prs, { filter: "all", term: "로그인", me: "me" }).map((p) => p.number), [3]);
  assert.deepEqual(filterPrs(prs, { filter: "all", term: "#2", me: "me" }).map((p) => p.number), [2]);
  assert.deepEqual(filterPrs(prs, { filter: "all", term: "prd-1", me: "me" }).map((p) => p.number), [1]);
});

test("alerts: CI turning red on my PR, a new review on my PR, a new review request for me", () => {
  const ok = [run("COMPLETED", "SUCCESS")], bad = [run("COMPLETED", "FAILURE")];
  const review = { author: { login: "kim" }, state: "APPROVED", submittedAt: "2026-11-06T10:00:00Z" };
  const prev = [pr(1, "me", { statusCheckRollup: ok }), pr(2, "kim"), pr(3, "me")];
  const next = [pr(1, "me", { statusCheckRollup: bad }), pr(2, "kim", { reviewRequests: [{ login: "me" }] }), pr(3, "me", { latestReviews: [review] })];
  const got = alerts(prev, next, "me");
  assert.deepEqual(got.map((a) => [a.number, a.level, a.title]), [
    [1, "error", "CI failed on #1"],
    [2, "info", "kim asked you to review #2"],
    [3, "success", "kim approved #3"],
  ]);
});

test("alerts stay quiet on the first look, on others' PRs, on my own reviews, and on what was already so", () => {
  const bad = [run("COMPLETED", "FAILURE")];
  const mine = { author: { login: "me" }, state: "COMMENTED", submittedAt: "2026-11-06T10:00:00Z" };
  assert.deepEqual(alerts(null, [pr(1, "me", { statusCheckRollup: bad })], "me"), []);
  assert.deepEqual(alerts([pr(1, "kim")], [pr(1, "kim", { statusCheckRollup: bad })], "me"), []);
  assert.deepEqual(alerts([pr(1, "me")], [pr(1, "me", { latestReviews: [mine] })], "me"), []);
  assert.deepEqual(alerts([pr(1, "me", { statusCheckRollup: bad })], [pr(1, "me", { statusCheckRollup: bad })], "me"), []);
  assert.deepEqual(alerts([], [pr(9, "me", { statusCheckRollup: bad })], "me"), [], "a PR new to the list isn't news yet");
});

test("gh runs the gh program and parses its JSON; failures carry gh's message", async () => {
  host.exec = async (cmd, args) => (args[0] === "--version" ? { code: 0, stdout: "gh version 2", stderr: "" }
    : { code: 0, stdout: '[{"number":1}]', stderr: "" });
  assert.deepEqual(await gh(["pr", "list"]), [{ number: 1 }]);
  assert.ok(host.execs.some(([cmd, args]) => cmd.endsWith("gh") && args[0] === "pr"));
  host.exec = async () => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials\nmore" });
  await assert.rejects(gh(["pr", "list"]), /Bad credentials/);
});

test("repoOf asks git for the space's origin, on the space's machine", async () => {
  host.exec = async (cmd, args, opts) => {
    if (cmd === "git" && args.join(" ") === "remote get-url origin" && opts.cwd === "/r/x") return { code: 0, stdout: "git@github.com:a/b.git\n", stderr: "" };
    return { code: 128, stdout: "", stderr: "fatal" };
  };
  assert.equal(await repoOf({ folder: "/r/x", machine: null }), "a/b");
  assert.equal(await repoOf({ folder: "/nowhere", machine: null }), null);
  assert.equal(await repoOf(null), null);
});

test("pages: 25 closed PRs and 30 runs to a page, at most 1000 results (GitHub's cap)", () => {
  assert.deepEqual(PAGE, { closed: 25, runs: 30 });
  assert.equal(pageCount(60, 25), 3);
  assert.equal(pageCount(75, 25), 3);
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(7976, 25), 40);
  assert.equal(pageCount(40000, 30), 34);
});

test("closedQuery searches the repo's closed PRs, newest first, with the filter and the words typed", () => {
  const base = "repo:a/b is:pr is:closed sort:updated-desc";
  assert.equal(closedQuery("a/b", "all", ""), base);
  assert.equal(closedQuery("a/b", "mine", ""), `${base} author:@me`);
  assert.equal(closedQuery("a/b", "review", ""), `${base} reviewed-by:@me`);
  assert.equal(closedQuery("a/b", "all", "  #8278 "), `${base} 8278`);
  assert.equal(closedQuery("a/b", "all", 'login "redirect'), `${base} login redirect`, "quotes can't break the query");
});

test("fromRestRun reads the REST API's run like gh run list's", () => {
  const r = fromRestRun({ id: 42, run_number: 7, name: "(CI) Lint", display_title: "Fix", status: "completed", conclusion: "failure",
    head_branch: "feature/prd-1", event: "pull_request", created_at: "2026-11-06T01:00:00Z", run_started_at: "2026-11-06T01:00:05Z",
    updated_at: "2026-11-06T01:02:00Z", html_url: "https://github.com/a/b/actions/runs/42" });
  assert.deepEqual(r, { databaseId: 42, number: 7, workflowName: "(CI) Lint", displayTitle: "Fix", status: "completed", conclusion: "failure",
    headBranch: "feature/prd-1", event: "pull_request", createdAt: "2026-11-06T01:00:00Z", startedAt: "2026-11-06T01:00:05Z",
    updatedAt: "2026-11-06T01:02:00Z", url: "https://github.com/a/b/actions/runs/42" });
});

test("remember keeps answers in the shared cache, and cached reads them back with their time", () => {
  remember("runs|a/b|*|1", { runs: [1], total: 1 });
  const hit = cached("runs|a/b|*|1");
  assert.deepEqual(hit.data, { runs: [1], total: 1 });
  assert.ok(Date.now() - hit.at < 1000);
  assert.ok(host.shared[CACHE_KEY], "in herdr's shared store, so it outlives a restart");
  assert.equal(cached("runs|a/b|*|2"), null);
});

test("fresh: an entry younger than the limit", () => {
  assert.equal(fresh({ at: Date.now() - 1000 }, 60000), true);
  assert.equal(fresh({ at: Date.now() - 61000 }, 60000), false);
  assert.equal(fresh(null, 60000), false);
});

test("the cache keeps only the most recently stored entries", () => {
  for (let i = 0; i < CACHE_MAX + 5; i++) {
    host.shared[CACHE_KEY] = { ...(host.shared[CACHE_KEY] ?? {}) };
    remember(`k${i}`, i);
    host.shared[CACHE_KEY][`k${i}`].at = 1000 + i; // stored in this order
  }
  const keys = Object.keys(host.shared[CACHE_KEY]);
  assert.equal(keys.length, CACHE_MAX);
  assert.equal(cached("k0"), null, "the oldest went first");
  assert.ok(cached(`k${CACHE_MAX + 4}`));
});

test("remember and cached can use another store with its own size", () => {
  for (let i = 0; i < 4; i++) { remember(`d${i}`, i, "github.details", 3); host.shared["github.details"][`d${i}`].at = 1000 + i; }
  assert.equal(Object.keys(host.shared["github.details"]).length, 3);
  assert.equal(cached("d0", "github.details"), null);
  assert.equal(cached("d3", "github.details").data, 3);
  assert.equal(cached("d3"), null, "separate from the main cache");
});
