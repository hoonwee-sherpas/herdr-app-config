import { test } from "node:test";
import assert from "node:assert/strict";
import { ICONS, ICON_TYPES, partPoints, arc } from "../../mods/Sketch/icons.js";
import { rng, roughCurve, strokePoints } from "../../mods/Sketch/rough.js";
import { hits, edge } from "../../mods/Sketch/main.js";

const SYSTEM = ["person", "database", "server", "cloud", "browser", "phone", "document", "queue", "frame"];
const NOTES = ["note", "bubble", "bulb", "question", "alert", "gear", "clock", "lock", "envelope", "folder"];

test("the picture shapes are the ones the toolbar offers: system parts, then notes and markers", () => {
  assert.deepEqual(ICON_TYPES, [...SYSTEM, ...NOTES]);
  assert.ok(SYSTEM.every((t) => ICONS[t].section === "system"));
  assert.ok(NOTES.every((t) => ICONS[t].section === "notes"));
});

test("every picture shape stays inside its box, at its own size and squashed or stretched", () => {
  for (const type of ICON_TYPES) {
    for (const [w, h] of [ICONS[type].size, [40, 200], [300, 30]]) {
      const d = ICONS[type].draw(10, 20, w, h);
      for (const p of [...d.parts, ...d.fill]) for (const [x, y] of partPoints(p)) {
        assert.ok(x >= 10 - 1e-6 && x <= 10 + w + 1e-6 && y >= 20 - 1e-6 && y <= 20 + h + 1e-6, `${type} ${w}×${h}: ${x},${y}`);
      }
    }
  }
});

test("a cloud fills its box from edge to edge", () => {
  const xs = [], ys = [];
  for (const p of ICONS.cloud.draw(0, 0, 200, 100).parts) for (const [x, y] of partPoints(p)) { xs.push(x); ys.push(y); }
  assert.ok(Math.abs(Math.min(...xs)) < 1e-6 && Math.abs(Math.max(...xs) - 200) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys)) < 1e-6 && Math.abs(Math.max(...ys) - 100) < 1e-6);
});

test("small pictures are labeled under them, a frame at its top left, containers inside", () => {
  const where = Object.fromEntries(ICON_TYPES.map((t) => [t, ICONS[t].draw(0, 0, 200, 120).label]));
  for (const t of ["person", "server", "phone", "bulb", "question", "alert", "gear", "clock", "lock", "envelope"]) assert.equal(where[t], "below", t);
  assert.equal(where.frame, "title");
  for (const t of ["database", "cloud", "browser", "document", "queue", "note", "bubble", "folder"]) {
    const l = where[t];
    assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= 200 && l.y + l.h <= 120 && l.w > 0 && l.h > 0, `${t}: ${JSON.stringify(l)}`);
  }
  assert.ok(where.database.y >= ICONS.database.draw(0, 0, 200, 120).parts[0].h, "a database's label sits below its lid");
});

test("what a fill goes in is closed", () => {
  for (const t of ICON_TYPES) for (const f of ICONS[t].draw(0, 0, 120, 120).fill) assert.ok(f.k === "ellipse" || f.closed, t);
});

test("arc runs from one angle to the other on the ellipse", () => {
  const pts = arc(0, 0, 10, 5, 0, Math.PI, 4);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0].map((v) => Math.round(v * 1e9) / 1e9), [10, 0]);
  assert.deepEqual(pts[4].map((v) => Math.round(v * 1e9) / 1e9), [-10, 0]);
  assert.deepEqual(pts[2].map((v) => Math.round(v * 1e9) / 1e9), [0, 5]);
});

test("roughCurve draws a curve twice, each pass close to its points", () => {
  const pts = arc(50, 50, 40, 20, Math.PI, 2 * Math.PI);
  const strokes = roughCurve(pts, rng("c"));
  assert.equal(strokes.length, 2);
  assert.notDeepEqual(strokes[0], strokes[1]);
  const near = (p) => Math.min(...pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  for (const s of strokes) {
    for (const p of strokePoints(s)) assert.ok(near(p) < 6, `${p}`);
    assert.ok(Math.hypot(s.from[0] - 10, s.from[1] - 50) < 3, "starts at the first point");
    assert.ok(Math.hypot(s.curves.at(-1)[2] - 90, s.curves.at(-1)[3] - 50) < 3, "ends at the last");
  }
});

test("a closed roughCurve comes back around past where it began", () => {
  const pts = arc(0, 0, 30, 30, 0, 2 * Math.PI, 12).slice(0, -1);
  for (const s of roughCurve(pts, rng("o"), true)) {
    const end = s.curves.at(-1).slice(2);
    assert.ok(Math.hypot(end[0] - s.from[0], end[1] - s.from[1]) < 20, "its ends meet");
    assert.ok(s.curves.length >= pts.length, "goes all the way round");
  }
});

test("a frame is picked by its border or title strip, not its middle", () => {
  const f = { id: "f", type: "frame", x: 0, y: 0, w: 300, h: 200 };
  assert.ok(hits(f, [150, 1], null, 4), "top border");
  assert.ok(hits(f, [299, 100], null, 4), "right border");
  assert.ok(hits(f, [40, 15], null, 4), "title strip");
  assert.ok(!hits(f, [150, 100], null, 4), "middle");
  assert.ok(!hits(f, [150, 100], null, 0));
});

test("other picture shapes are picked anywhere in their box", () => {
  for (const type of ["person", "database", "server", "cloud"]) assert.ok(hits({ type, x: 0, y: 0, w: 100, h: 100 }, [50, 50], null, 0), type);
});

test("an arrow meets round pictures (gear, clock, question) on their circle", () => {
  for (const type of ["gear", "clock", "question"]) {
    const [x, y] = edge({ type, x: 0, y: 0, w: 100, h: 100 }, [400, 400]);
    assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - 56) < 1e-6, `${type}: ${x},${y}`);
  }
});

test("a speech bubble's tail hangs below its body, where its label isn't", () => {
  const d = ICONS.bubble.draw(0, 0, 200, 120);
  const ys = d.parts[0].pts.map((p) => p[1]);
  assert.ok(Math.max(...ys) > d.label.y + d.label.h + 10, "the tail goes past the label's box");
});

test("an arrow meets a cloud on its rounded outline, a database on its box", () => {
  const cloud = { type: "cloud", x: 0, y: 0, w: 200, h: 100 }, db = { type: "database", x: 0, y: 0, w: 200, h: 100 };
  const corner = [400, 300];
  const c = edge(cloud, corner), d = edge(db, corner);
  assert.ok(Math.hypot(c[0] - 100, c[1] - 50) < Math.hypot(d[0] - 100, d[1] - 50), "the cloud's point is nearer its middle");
  assert.ok(Math.abs(d[1] - 106) < 1e-9, "the database's on its box's bottom, 6px out");
});
