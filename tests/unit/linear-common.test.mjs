import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { host } from "herdr";
import { gql, errorText, fresh, startedSteps, spacesFor } from "../../mods/linear-issues/common.js";

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
    { id: "a1", position: 1, team: { id: "A" } },
    { id: "a2", position: 2, team: { id: "A" } },
    { id: "a3", position: 3, team: { id: "A" } },
    { id: "b1", position: 5, team: { id: "B" } },
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
