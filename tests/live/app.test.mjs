// Smoke tests against the running Herdr app. They open and close a pane in
// your current tab, so they only run when asked: HERDR_LIVE=1 npm run test:live
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const live = process.env.HERDR_LIVE === "1";
const herdr = (...args) => JSON.parse(execFileSync("herdr-app", args, { encoding: "utf8" }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the app reports no errors", { skip: !live && "set HERDR_LIVE=1" }, () => {
  assert.deepEqual(herdr("status").errors, []);
});

test("a Sketch pane opens and closes without errors", { skip: !live && "set HERDR_LIVE=1" }, async () => {
  const { pane } = herdr("do", "pane.split", JSON.stringify({ direction: "right", mod: "Sketch" }));
  assert.match(pane, /^p/);
  try {
    await sleep(1500);
    assert.deepEqual(herdr("status").errors, []);
  } finally {
    herdr("do", "pane.close", JSON.stringify({ pane }));
  }
});
