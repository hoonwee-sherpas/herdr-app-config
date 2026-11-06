// The tab bar's Sketch button against a fake host.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { host } from "herdr";
import { makeCx } from "../fakes/cx.mjs";
import { walk, byId } from "../fakes/element.mjs";
import Tabs from "../../mods/tabs-linear/main.js";

beforeEach(() => {
  host.reset();
  localStorage.clear();
  host.spaces = [{ id: "s", active: true, tabs: [{ id: "t", name: "1", active: true }] }];
  host.layout = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", type: "stack", active: "files" }] }] };
});

async function mount() {
  const cx = makeCx();
  const v = new Tabs();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}

test("the Sketch button sits right after Linear", async () => {
  const { v } = await mount();
  const order = [...walk(v.render())].map((e) => e.props.id).filter((id) => /^(panel|pane)-/.test(String(id)));
  assert.deepEqual(order.slice(-2), ["panel-linear", "pane-sketch"]);
  assert.ok(existsSync(new URL("../../mods/Sketch/sketch.svg", import.meta.url)), "its icon exists");
});

test("it opens a Sketch pane, or closes this tab's one", async () => {
  const { v, cx } = await mount();
  byId(v.render(), "pane-sketch").handlers.on_click({}, cx);
  assert.deepEqual(host.ran("pane.split"), [{ direction: "right", mod: "Sketch" }]);
  host.panes = [{ pane: "pz", mod: "Sketch", tab: "t" }];
  const button = byId(v.render(), "pane-sketch");
  assert.equal(button.props.bg, host.theme.selected, "lit while open");
  button.handlers.on_click({}, cx);
  assert.deepEqual(host.ran("pane.close"), [{ pane: "pz" }]);
});

test("a Sketch pane in another tab doesn't count", async () => {
  host.panes = [{ pane: "pz", mod: "Sketch", tab: "elsewhere" }];
  const { v, cx } = await mount();
  byId(v.render(), "pane-sketch").handlers.on_click({}, cx);
  assert.equal(host.ran("pane.split").length, 1);
});

test("a GitHub panel button sits between Changes and Linear, and opens the GitHub panel", async () => {
  const { v, cx } = await mount();
  const order = [...walk(v.render())].map((e) => e.props.id).filter((id) => /^(panel|pane)-/.test(String(id)));
  assert.deepEqual(order.slice(-3), ["panel-github", "panel-linear", "pane-sketch"]);
  assert.ok(existsSync(new URL("../../mods/github/github.svg", import.meta.url)), "its icon exists");
  byId(v.render(), "panel-github").handlers.on_click({}, cx);
  assert.deepEqual(host.ran("layout.select"), [{ stack: "panel-body", child: "github" }]);
  assert.deepEqual(host.ran("layout.show"), [{ id: "panel" }]);
});

test("the tabs-linear.github command opens the GitHub panel, and closes it when it's showing", async () => {
  const { cx } = await mount();
  host.command("github");
  await cx.settle();
  assert.deepEqual(host.ran("layout.select"), [{ stack: "panel-body", child: "github" }]);
  host.layout.children[0].hidden = false;
  host.layout.children[0].children[0].active = "github";
  host.command("github");
  await cx.settle();
  assert.deepEqual(host.ran("layout.hide"), [{ id: "panel" }]);
});
