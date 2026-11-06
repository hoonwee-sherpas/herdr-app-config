import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, textSize, edge, points, bbox, hits, distSeg, center } from "../../mods/Sketch/main.js";

const box = (id, x, y, w, h, type = "rect") => ({ id, type, x, y, w, h });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("norm turns a box drawn up-left into positive width and height", () => {
  assert.deepEqual(norm({ x: 100, y: 50, w: -40, h: -20 }), { x: 60, y: 30, w: 40, h: 20 });
});

test("textSize counts wide (Korean) characters wider than ASCII", () => {
  const ascii = textSize({ text: "abcd", fontSize: 20 });
  const wide = textSize({ text: "가나다라", fontSize: 20 });
  assert.ok(wide.w > ascii.w);
  assert.equal(textSize({ text: "a\nb", fontSize: 20 }).h, 2 * 20 * 1.3);
});

test("edge leaves a rectangle on its side, 6px out", () => {
  const r = box("r", 0, 0, 100, 50);
  assert.deepEqual(edge(r, [500, 25]), [106, 25]);
  assert.deepEqual(edge(r, [50, -500]), [50, -6]);
});

test("edge on a diamond sits inside the bounding box on a diagonal", () => {
  const d = box("d", 0, 0, 100, 100, "diamond");
  const [x, y] = edge(d, [1000, 1000]);
  close(x - 50, y - 50);
  assert.ok(x < 100 + 6 && x > 50);
});

test("edge on an ellipse is on the ellipse (plus the gap)", () => {
  const e = box("e", 0, 0, 200, 100, "ellipse");
  const [x, y] = edge(e, [300, 200]);
  const [cx, cy] = [100, 50];
  close(((x - cx) / 106) ** 2 + ((y - cy) / 56) ** 2, 1);
});

test("points: an arrow attached at both ends runs edge to edge", () => {
  const a = box("a", 0, 0, 100, 50), b = box("b", 0, 200, 100, 50);
  const arrow = { id: "x", type: "arrow", from: "a", to: "b" };
  const byId = new Map([[a.id, a], [b.id, b]]);
  assert.deepEqual(points(arrow, byId), [[50, 56], [50, 194]]);
});

test("points: an unattached arrow keeps its own points; a missing target falls back to them", () => {
  const pts = [[0, 0], [10, 10]];
  assert.deepEqual(points({ type: "arrow", points: pts }, new Map()), pts);
  assert.deepEqual(points({ type: "arrow", to: "gone", points: pts }, new Map()), pts);
});

test("points: an arrow can't attach to another arrow or a pen stroke", () => {
  const pen = { id: "p", type: "pen", points: [[0, 0], [5, 5]] };
  const pts = [[0, 0], [10, 10]];
  assert.deepEqual(points({ type: "arrow", from: "p", points: pts }, new Map([["p", pen]])), pts);
});

test("bbox of an attached arrow follows the shapes", () => {
  const a = box("a", 0, 0, 100, 50), b = box("b", 300, 0, 100, 50);
  const byId = new Map([[a.id, a], [b.id, b]]);
  const bb = bbox({ type: "arrow", from: "a", to: "b" }, byId);
  assert.deepEqual(bb, { x: 106, y: 25, w: 188, h: 0 });
});

test("hits: inside a box (with tolerance), near an arrow, not beside it", () => {
  const r = box("r", 0, 0, 100, 50);
  assert.ok(hits(r, [99, 49], null, 0));
  assert.ok(hits(r, [104, 25], null, 6));
  assert.ok(!hits(r, [120, 25], null, 6));
  const line = { type: "line", points: [[0, 0], [100, 0]] };
  assert.ok(hits(line, [50, 4], new Map(), 6));
  assert.ok(!hits(line, [50, 10], new Map(), 6));
});

test("distSeg measures to the segment, not the infinite line", () => {
  assert.equal(distSeg([5, 3], [0, 0], [10, 0]), 3);
  assert.equal(distSeg([13, 4], [0, 0], [10, 0]), 5);
  assert.equal(distSeg([1, 1], [0, 0], [0, 0]), Math.SQRT2);
});

test("center of a box", () => {
  assert.deepEqual(center({ x: 10, y: 20, w: 100, h: 50 }), [60, 45]);
});
