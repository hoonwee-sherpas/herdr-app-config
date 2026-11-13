// Hand-drawn strokes for Sketch, after the idea behind rough.js (the library
// Excalidraw draws with), not its code. Each line is drawn twice, each pass a
// slightly bowed curve whose ends wander a little and overshoot the corners;
// an ellipse is a loose loop whose ends overlap.
//
// Everything is in world coordinates and depends only on the shape's own
// geometry and a seed (the shape's id), so a shape looks the same on every
// frame, moves without changing, and zooms with the drawing.
//
// A stroke is { from: [x, y], curves: [[cx, cy, x, y], ...] }: quadratic
// curves, each with its control point and the point it ends at.

/** A repeatable random number generator: the same seed, the same numbers. */
export function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  // mulberry32
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand, lo, hi) => lo + (hi - lo) * rand();

/** Every point a stroke goes through or bends toward. */
export function strokePoints(s) {
  return [s.from, ...s.curves.flatMap((c) => [[c[0], c[1]], [c[2], c[3]]])];
}

// One pass along a → b. Short lines wobble less: every amount is capped by a
// share of the length.
function pass(a, b, rand) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const side = Math.min(1.5, len * 0.06);  // ends wander sideways
  const over = Math.min(2.5, len * 0.04);  // and past the corner
  const bow = Math.min(4, len * 0.1);      // the middle bows out
  const s0 = between(rand, 0, over), s1 = between(rand, -0.3 * over, over);
  const j0 = between(rand, -side, side), j1 = between(rand, -side, side);
  const t = between(rand, 0.4, 0.6), k = between(rand, -bow, bow);
  return {
    from: [a[0] - ux * s0 + px * j0, a[1] - uy * s0 + py * j0],
    curves: [[a[0] + dx * t + px * k, a[1] + dy * t + py * k, b[0] + ux * s1 + px * j1, b[1] + uy * s1 + py * j1]],
  };
}

/** A line from a to b, drawn twice. */
export function roughLine(a, b, rand) {
  return [pass(a, b, rand), pass(a, b, rand)];
}

/** A closed polygon (box, diamond), each edge drawn twice. */
export function roughPolygon(points, rand) {
  return points.flatMap((p, i) => roughLine(p, points[(i + 1) % points.length], rand));
}

/** An open polyline (arrow, line), each segment drawn twice. */
export function roughPolyline(points, rand) {
  return points.slice(1).flatMap((p, i) => roughLine(points[i], p, rand));
}

/** The ellipse inside the box (x, y, w, h), as two loose loops. */
export function roughEllipse(x, y, w, h, rand) {
  const cx = x + w / 2, cy = y + h / 2;
  const n = Math.max(10, Math.min(24, Math.round((w + h) / 24)));
  const loop = () => {
    const rx = (w / 2) * between(rand, 0.98, 1.02), ry = (h / 2) * between(rand, 0.98, 1.02);
    const start = between(rand, 0, Math.PI * 2), step = (Math.PI * 2) / n;
    // A little past one turn, so the ends overlap like a pen's.
    const extra = 1 + Math.round(between(rand, 1, 2));
    const pts = [];
    for (let i = 0; i <= n + extra; i++) {
      const a = start + i * step, r = between(rand, 0.97, 1.03);
      pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const curves = [];
    for (let i = 1; i < pts.length - 1; i++) curves.push([...pts[i], ...mid(pts[i], pts[i + 1])]);
    return { from: mid(pts[0], pts[1]), curves };
  };
  return [loop(), loop()];
}

/**
 * A smooth line through `points` (an arc, a cloud's outline), drawn twice: each
 * pass goes through slightly moved points. `closed` comes back round to the start.
 */
export function roughCurve(points, rand, closed = false) {
  if (points.length < 2) return [];
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const j = Math.min(1.2, (len / points.length) * 0.15);
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const pass = () => {
    const pts = points.map(([x, y]) => [x + between(rand, -j, j), y + between(rand, -j, j)]);
    if (closed) {
      // Round past the start a little, like the ellipse's loop.
      const loop = [...pts, pts[0], pts[1]];
      const curves = [];
      for (let i = 1; i < loop.length - 1; i++) curves.push([...loop[i], ...mid(loop[i], loop[i + 1])]);
      return { from: mid(loop[0], loop[1]), curves };
    }
    const curves = [];
    for (let i = 1; i < pts.length - 1; i++) curves.push([...pts[i], ...mid(pts[i], pts[i + 1])]);
    const last = pts[pts.length - 1];
    curves.push([...last, ...last]);
    return { from: pts[0], curves };
  };
  return [pass(), pass()];
}
