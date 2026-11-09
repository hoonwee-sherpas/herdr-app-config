import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { host } from "herdr";
import { gql, errorText, fresh, startedSteps, spacesFor, teamStates, setIssueState, shareState, stateIcon, MINE_KEY } from "../../mods/linear-issues/common.js";

beforeEach(() => host.reset());

test("fresh: only entries younger than the limit", () => {
  assert.equal(fresh({ at: Date.now() - 1000 }, 5000), true);
  assert.equal(fresh({ at: Date.now() - 10000 }, 5000), false);
  assert.equal(fresh(undefined, 5000), false);
  assert.equal(fresh({}, 5000), false);
});

test("errorText keeps the first line", () => {
  assert.equal(errorText(new Error("boom\nstack")), "boom");
  assert.equal(errorText("plain"), "plain");
});

test("startedSteps spreads each team's started states over quarters", () => {
  const states = [
    { id: "a1", type: "started", position: 1, team: { id: "A" } },
    { id: "a2", type: "started", position: 2, team: { id: "A" } },
    { id: "a3", type: "started", position: 3, team: { id: "A" } },
    { id: "b1", type: "started", position: 5, team: { id: "B" } },
  ];
  const steps = startedSteps(states);
  assert.deepEqual([steps.get("a1"), steps.get("a2"), steps.get("a3")], [1, 2, 3]);
  assert.equal(steps.get("b1"), 2);
});

test("spacesFor matches the identifier as a whole word in branch, folder or name", () => {
  const all = [
    { id: 1, branch: "feature/prd-102" },
    { id: 2, branch: "feature/prd-1025" },
    { id: 3, folder: "/w/PRD-102-fix" },
    { id: 4, name: "prd-102" },
    { id: 5, name: "other" },
  ];
  assert.deepEqual(spacesFor("PRD-102", all).map((s) => s.id), [1, 3, 4]);
});

test("gql sends the query through curl with the key read from the keychain", async () => {
  host.exec = async () => ({ code: 0, stdout: JSON.stringify({ data: { ok: 1 } }), stderr: "" });
  assert.deepEqual(await gql("{ ok }", { a: 1 }), { ok: 1 });
  const [cmd, args] = host.execs[0];
  assert.equal(cmd, "sh");
  assert.match(args[1], /security find-generic-password -s linear-api-key -w/);
  assert.deepEqual(JSON.parse(args[3]), { query: "{ ok }", variables: { a: 1 } });
  assert.ok(!args.join(" ").includes("lin_api"), "no key in the arguments");
});

test("gql reports curl failures and GraphQL errors", async () => {
  host.exec = async () => ({ code: 6, stdout: "", stderr: "Could not resolve host\nmore" });
  await assert.rejects(gql("{ x }"), /Could not resolve host/);
  host.exec = async () => ({ code: 0, stdout: JSON.stringify({ errors: [{ message: "Query too complex" }] }), stderr: "" });
  await assert.rejects(gql("{ x }"), /Query too complex/);
});

test("linear-search's copy of common.js matches linear-issues' (mods can't import each other)", () => {
  const body = (p) => readFileSync(new URL(p, import.meta.url), "utf8").split("\n").filter((l) => !l.startsWith("// Copied from")).join("\n").trim();
  assert.equal(body("../../mods/linear-search/common.js"), body("../../mods/linear-issues/common.js"));
});

// Workflow states as Linear returns them (STATE_FIELDS).
const st = (id, type, position, team = "PRD") => ({ id, name: id, type, position, color: "#888888", team: { id: `t-${team}`, key: team } });

test("startedSteps ignores states that aren't started", () => {
  const steps = startedSteps([st("todo", "unstarted", 0), st("a", "started", 1), st("b", "started", 2), st("done", "completed", 3)]);
  assert.deepEqual([...steps.keys()], ["a", "b"]);
});

test("teamStates lists the team's states in Linear's order: backlog, todo, started, done, canceled", () => {
  const nodes = [st("Done", "completed", 1), st("Review", "started", 3), st("Other", "started", 0, "OPS"),
    st("Canceled", "canceled", 0), st("Todo", "unstarted", 0), st("Doing", "started", 2), st("Backlog", "backlog", 0)];
  assert.deepEqual(teamStates(nodes, "PRD").map((s) => s.name), ["Backlog", "Todo", "Doing", "Review", "Done", "Canceled"]);
  assert.deepEqual(teamStates(nodes, "NOPE"), []);
  assert.deepEqual(teamStates(undefined, "PRD"), []);
});

test("setIssueState asks Linear to move the issue (by its id) and returns the state Linear reports", async () => {
  const review = st("Review", "started", 3);
  host.exec = async () => ({ code: 0, stdout: JSON.stringify({ data: { issueUpdate: { success: true, issue: { state: review } } } }), stderr: "" });
  assert.deepEqual(await setIssueState({ id: "uuid-1", identifier: "PRD-1" }, review), review);
  const { query, variables } = JSON.parse(host.execs[0][1][3]);
  assert.match(query, /issueUpdate\(id: \$id, input: \{ stateId: \$stateId \}\)/);
  assert.deepEqual(variables, { id: "uuid-1", stateId: "Review" });
});

test("setIssueState falls back to the identifier, and fails when Linear says no", async () => {
  host.exec = async () => ({ code: 0, stdout: JSON.stringify({ data: { issueUpdate: { success: false } } }), stderr: "" });
  await assert.rejects(setIssueState({ identifier: "PRD-1" }, st("Done", "completed", 1)), /didn't change/);
  assert.equal(JSON.parse(host.execs[0][1][3]).variables.id, "PRD-1");
});

test("shareState puts the new state into the shared cache, newer than before", () => {
  host.shared[MINE_KEY] = { at: 1, issues: [{ identifier: "PRD-1", state: st("Todo", "unstarted", 0) }, { identifier: "PRD-2", state: st("Todo", "unstarted", 0) }] };
  shareState("PRD-1", st("Done", "completed", 1));
  assert.equal(host.shared[MINE_KEY].issues[0].state.name, "Done");
  assert.equal(host.shared[MINE_KEY].issues[1].state.name, "Todo");
  assert.ok(host.shared[MINE_KEY].at > 1);
  host.shared[MINE_KEY] = undefined;
  shareState("PRD-1", st("Done", "completed", 1)); // no cache yet: nothing to do
  assert.equal(host.shared[MINE_KEY], undefined);
});

test("stateIcon has an icon file for every workflow state type", () => {
  const home = new URL("../../", import.meta.url).pathname;
  for (const type of ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"]) {
    const icon = stateIcon({ id: "x", type, color: "#888888" }, new Map());
    assert.ok(existsSync(home + icon.arg), `${type}: ${icon.arg}`);
  }
});

test("github's copy of sidenav.js matches linear-issues' (mods can't import each other)", () => {
  const body = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/^\/\/ Copied from.*\n/, "");
  assert.equal(body("../../mods/github/sidenav.js"), body("../../mods/linear-issues/sidenav.js"));
});
