import { test } from "node:test";
import assert from "node:assert/strict";
import { rng, roughLine, roughPolygon, roughEllipse, strokePoints } from "../../mods/Sketch/rough.js";

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
// Distance from p to the line through a and b.
const off = (p, a, b) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / dist(a, b);

test("rng is repeatable per seed, differs between seeds, and stays in [0, 1)", () => {
  const a = rng("box-1"), b = rng("box-1"), c = rng("box-2");
  const xs = Array.from({ length: 50 }, a), ys = Array.from({ length: 50 }, b), zs = Array.from({ length: 50 }, c);
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("roughLine draws two different passes that stay close to the line", () => {
  const a = [0, 0], b = [200, 0];
  const strokes = roughLine(a, b, rng("l"));
  assert.equal(strokes.length, 2);
  assert.notDeepEqual(strokes[0], strokes[1]);
  for (const s of strokes) {
    assert.ok(dist(s.from, a) < 4, `starts near a: ${s.from}`);
    assert.ok(dist(s.curves.at(-1).slice(2), b) < 4, "ends near b");
    for (const p of strokePoints(s)) assert.ok(off(p, a, b) <= 5, `${p} bows at most 5px`);
  }
});

test("a short line wobbles only a little", () => {
  const a = [0, 0], b = [6, 0];
  for (const s of roughLine(a, b, rng("short"))) for (const p of strokePoints(s)) assert.ok(off(p, a, b) <= 1, `${p}`);
});

test("roughPolygon draws every edge twice, within the shape plus a small overshoot", () => {
  const rect = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const strokes = roughPolygon(rect, rng("r"));
  assert.equal(strokes.length, 8);
  for (const s of strokes) for (const [x, y] of strokePoints(s)) assert.ok(x > -6 && x < 106 && y > -6 && y < 66, `${x},${y}`);
});

test("roughEllipse loops around the ellipse twice, near its outline", () => {
  const strokes = roughEllipse(0, 0, 200, 100, rng("e"));
  assert.equal(strokes.length, 2);
  for (const s of strokes) {
    assert.ok(s.curves.length >= 8);
    for (const c of s.curves) {
      const [x, y] = c.slice(2);
      const r = Math.hypot((x - 100) / 100, (y - 50) / 50);
      assert.ok(r > 0.85 && r < 1.12, `anchor ${x},${y} at radius ${r}`);
    }
  }
});

test("the same seed draws the same shape", () => {
  assert.deepEqual(roughEllipse(0, 0, 80, 40, rng("x")), roughEllipse(0, 0, 80, 40, rng("x")));
  assert.deepEqual(roughPolygon([[0, 0], [10, 10], [0, 20]], rng("y")), roughPolygon([[0, 0], [10, 10], [0, 20]], rng("y")));
});
