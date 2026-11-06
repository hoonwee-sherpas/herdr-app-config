import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, tabTitle, leadPanes } from "../../mods/spaces-agents/main.js";

test("duration rounds down to minutes, hours, days", () => {
  assert.equal(duration(30 * 1000), "<1m");
  assert.equal(duration(5 * 60000), "5m");
  assert.equal(duration(3 * 3600000), "3h");
  assert.equal(duration(50 * 3600000), "2d");
});

const claude = { name: "Claude Code", key: "claude-code", agent: true };

test("tabTitle: a tab someone named wins", () => {
  assert.equal(tabTitle({ name: "deploy", named: true }, { title: "Fixing tests", program: claude }), "deploy");
});

test("tabTitle: an unnamed tab shows what the agent says it's doing", () => {
  assert.equal(tabTitle({ name: "1", named: false }, { title: "✳ Fixing tests", program: claude }), "Fixing tests");
});

test("tabTitle: titles that are paths, user@host or the program's name say nothing", () => {
  for (const title of ["~/src/app", "/usr/bin", "me@host: ~", "Claude Code", "claude-code"]) {
    assert.equal(tabTitle({ name: "1", named: false }, { title, program: claude }), "1", title);
  }
});

test("leadPanes picks each tab's agent over its shell, ignoring mod panes", () => {
  const shell = { tab: "t", terminal: "a", program: { shell: true }, focused: true };
  const agent = { tab: "t", terminal: "b", program: claude };
  const modPane = { tab: "u", terminal: null, mod: "Sketch" };
  const leads = leadPanes([shell, agent, modPane]);
  assert.equal(leads.get("t"), agent);
  assert.equal(leads.has("u"), false);
});
