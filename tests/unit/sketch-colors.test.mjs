import { test } from "node:test";
import assert from "node:assert/strict";
import { hsl, hex, inkFor, fillFor, COLORS } from "../../mods/Sketch/main.js";

const lightness = (c) => hsl(c)[2];

test("hsl and hex round-trip the palette", () => {
  for (const [ink, fill] of COLORS) {
    assert.equal(hex(hsl(ink)), ink);
    assert.equal(hex(hsl(fill)), fill);
  }
});

test("light themes draw the stored colors unchanged", () => {
  for (const [ink, fill] of COLORS) {
    assert.equal(inkFor(ink, false), ink);
    assert.equal(fillFor(fill, false), fill);
  }
});

test("dark themes lighten dark inks and leave light ones", () => {
  assert.ok(lightness(inkFor("#1e1e1e", true)) > 0.85);
  assert.ok(lightness(inkFor("#1971c2", true)) > lightness("#1971c2"));
  assert.equal(inkFor("#ffc078", true), "#ffc078");
});

test("dark themes turn pastel fills into dark tints of the same hue", () => {
  for (const [, fill] of COLORS) {
    const out = fillFor(fill, true);
    assert.ok(lightness(out) < 0.3, `${fill} -> ${out}`);
    if (hsl(fill)[1] > 0.1) assert.ok(Math.abs(hsl(out)[0] - hsl(fill)[0]) < 0.02, `hue kept for ${fill}`);
  }
});

test("colors that aren't #rrggbb pass through", () => {
  assert.equal(inkFor("red", true), "red");
  assert.equal(fillFor(undefined, true), undefined);
});
