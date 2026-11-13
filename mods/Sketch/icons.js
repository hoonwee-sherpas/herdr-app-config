// Picture shapes for Sketch. System parts: a person, a database, a server, a
// cloud, a browser window, a phone, a document, a queue and a frame. Notes and
// markers: a sticky note, a speech bubble, a light bulb, a question, an alert,
// a gear, a clock, a lock, an envelope and a folder. Each is drawn from
// a few strokes inside its box, so it resizes, takes ink and fill colors, and
// gets the hand-drawn look like a plain box.
//
// draw(x, y, w, h) gives, in world coordinates:
// - parts: the strokes. { k: "poly", pts, closed } straight segments,
//   { k: "curve", pts, closed } a smooth line through the points (arcs),
//   { k: "ellipse", x, y, w, h, solid } (solid: a dot filled with ink).
// - fill: the outlines a fill color goes in (polys, curves or ellipses).
// - label: where the text goes, a box { x, y, w, h }, or "below" the shape,
//   or "title" (the frame's name, top left).

/** Points along an ellipse's arc, from angle a0 to a1 (radians, y down). */
export function arc(cx, cy, rx, ry, a0, a1, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const PI = Math.PI;
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// A cloud: the outline of a few overlapping circles on a flat bottom, seen from
// a point inside (the farthest any ray from there stays in one of them), then
// scaled to fill the box. Unit coordinates; each circle ends on the bottom line.
const LOBES = [[0.2, 0.56, 0.2], [0.42, 0.4, 0.26], [0.67, 0.38, 0.21], [0.84, 0.6, 0.16]];
const BASE = [0.2, 0.5, 0.84, 0.76]; // the flat-bottomed middle: x0, y0, x1, y1
function cloudPoints(x, y, w, h) {
  const ox = 0.5, oy = 0.6, pts = [];
  for (let i = 0; i < 120; i++) {
    const a = (2 * PI * i) / 120, dx = Math.cos(a), dy = Math.sin(a);
    let t = Math.min(dx > 0 ? (BASE[2] - ox) / dx : dx < 0 ? (BASE[0] - ox) / dx : Infinity,
      dy > 0 ? (BASE[3] - oy) / dy : dy < 0 ? (BASE[1] - oy) / dy : Infinity);
    for (const [cx, cy, r] of LOBES) {
      const b = dx * (cx - ox) + dy * (cy - oy), c = (cx - ox) ** 2 + (cy - oy) ** 2 - r * r;
      if (b * b - c >= 0) t = Math.max(t, b + Math.sqrt(b * b - c));
    }
    pts.push([ox + dx * t, oy + dy * t]);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), sx = w / (Math.max(...xs) - x0), sy = h / (Math.max(...ys) - y0);
  return pts.map(([px, py]) => [x + (px - x0) * sx, y + (py - y0) * sy]);
}

export const ICONS = {
  person: {
    section: "system", label: "Person", size: [64, 84], hint: "a user, admin, team or customer",
    draw(x, y, w, h) {
      const d = Math.min(w * 0.5, h * 0.42), cx = x + w / 2;
      const head = { k: "ellipse", x: cx - d / 2, y, w: d, h: d };
      // Shoulders: half an ellipse standing on the bottom edge.
      const top = y + d * 1.12;
      const body = { k: "curve", pts: [...arc(cx, y + h, w / 2, y + h - top, PI, 2 * PI), [x, y + h]], closed: true };
      return { parts: [head, body], fill: [head, body], label: "below" };
    },
  },
  database: {
    section: "system", label: "Database", size: [110, 120], hint: "a database, cache or any data store",
    draw(x, y, w, h) {
      const ry = Math.min(h * 0.16, w * 0.2), cx = x + w / 2, rx = w / 2;
      const top = { k: "ellipse", x, y, w, h: 2 * ry };
      const side = { k: "curve", pts: [[x, y + ry], ...arc(cx, y + h - ry, rx, ry, PI, 0), [x + w, y + ry]] };
      const outline = { k: "curve", pts: [...arc(cx, y + ry, rx, ry, PI, 2 * PI), ...arc(cx, y + h - ry, rx, ry, 0, PI)], closed: true };
      return { parts: [top, side], fill: [outline], label: { x, y: y + 2 * ry, w, h: h - 3 * ry } };
    },
  },
  server: {
    section: "system", label: "Server", size: [96, 110], hint: "a backend, API or worker host",
    draw(x, y, w, h) {
      const parts = [{ k: "poly", pts: box(x, y, w, h), closed: true }];
      const unit = h / 3, dot = Math.min(unit * 0.22, w * 0.1);
      for (let i = 0; i < 3; i++) {
        const cy = y + unit * (i + 0.5);
        if (i) parts.push({ k: "poly", pts: [[x, y + unit * i], [x + w, y + unit * i]] });
        parts.push({ k: "ellipse", x: x + w * 0.14, y: cy - dot / 2, w: dot, h: dot, solid: true });
        parts.push({ k: "poly", pts: [[x + w * 0.45, cy], [x + w * 0.84, cy]] });
      }
      return { parts, fill: [parts[0]], label: "below" };
    },
  },
  cloud: {
    section: "system", label: "Cloud", size: [190, 115], hint: "the internet, a third party or an external service",
    draw(x, y, w, h) {
      const c = { k: "curve", pts: cloudPoints(x, y, w, h), closed: true };
      return { parts: [c], fill: [c], label: { x: x + w * 0.18, y: y + h * 0.3, w: w * 0.64, h: h * 0.5 } };
    },
  },
  browser: {
    section: "system", label: "Browser", size: [230, 150], hint: "a web app or frontend",
    draw(x, y, w, h) {
      const bar = Math.min(26, h * 0.22), dot = Math.min(bar * 0.34, w * 0.05);
      const parts = [{ k: "poly", pts: box(x, y, w, h), closed: true }, { k: "poly", pts: [[x, y + bar], [x + w, y + bar]] }];
      for (let i = 0; i < 3; i++) parts.push({ k: "ellipse", x: x + bar * 0.4 + i * dot * 1.7, y: y + (bar - dot) / 2, w: dot, h: dot });
      const ax = x + bar * 0.4 + 3 * dot * 1.7 + dot;
      if (x + w - bar * 0.4 - ax > 20) parts.push({ k: "poly", pts: box(ax, y + bar * 0.25, x + w - bar * 0.4 - ax, bar * 0.5), closed: true });
      return { parts, fill: [parts[0]], label: { x, y: y + bar, w, h: h - bar } };
    },
  },
  phone: {
    section: "system", label: "Phone", size: [76, 136], hint: "a mobile app",
    draw(x, y, w, h) {
      const cx = x + w / 2, top = Math.min(h * 0.12, 22), dot = Math.min(top * 0.55, w * 0.2);
      const parts = [
        { k: "poly", pts: box(x, y, w, h), closed: true },
        { k: "poly", pts: [[cx - w * 0.16, y + top / 2], [cx + w * 0.16, y + top / 2]] },
        { k: "poly", pts: [[x, y + top], [x + w, y + top]] },
        { k: "poly", pts: [[x, y + h - top], [x + w, y + h - top]] },
        { k: "ellipse", x: cx - dot / 2, y: y + h - top / 2 - dot / 2, w: dot, h: dot },
      ];
      return { parts, fill: [parts[0]], label: "below" };
    },
  },
  document: {
    section: "system", label: "Document", size: [110, 140], hint: "a file, spec, report or config",
    draw(x, y, w, h) {
      const f = Math.min(w, h) * 0.24;
      const page = { k: "poly", pts: [[x, y], [x + w - f, y], [x + w, y + f], [x + w, y + h], [x, y + h]], closed: true };
      const fold = { k: "poly", pts: [[x + w - f, y], [x + w - f, y + f], [x + w, y + f]] };
      return { parts: [page, fold], fill: [page], label: { x, y: y + f, w, h: h - f } };
    },
  },
  queue: {
    section: "system", label: "Queue", size: [210, 70], hint: "a message queue, event bus or stream",
    draw(x, y, w, h) {
      const rx = Math.min(w * 0.12, h * 0.3), ry = h / 2, cy = y + ry;
      const end = { k: "ellipse", x: x + w - 2 * rx, y, w: 2 * rx, h };
      const body = { k: "curve", pts: [[x + w - rx, y], ...arc(x + rx, cy, rx, ry, -PI / 2, -3 * PI / 2), [x + w - rx, y + h]] };
      const outline = { k: "curve", pts: [...arc(x + w - rx, cy, rx, ry, -PI / 2, PI / 2), ...arc(x + rx, cy, rx, ry, PI / 2, 3 * PI / 2)], closed: true };
      return { parts: [end, body], fill: [outline], label: { x: x + rx, y, w: w - 3 * rx, h } };
    },
  },
  frame: {
    section: "system", label: "Frame", size: [380, 250], hint: "a boundary around shapes: Backend, VPC, Team A",
    draw(x, y, w, h) {
      const r = { k: "poly", pts: box(x, y, w, h), closed: true };
      return { parts: [r], fill: [r], label: "title" };
    },
  },
  // ---- notes and markers

  note: {
    section: "notes", label: "Note", size: [150, 130], hint: "a sticky note: a thought, a to-do", fill: "#fff3bf",
    draw(x, y, w, h) {
      const f = Math.min(w, h) * 0.18;
      const page = { k: "poly", pts: [[x, y], [x + w, y], [x + w, y + h - f], [x + w - f, y + h], [x, y + h]], closed: true };
      const curl = { k: "poly", pts: [[x + w - f, y + h], [x + w - f, y + h - f], [x + w, y + h - f]] };
      return { parts: [page, curl], fill: [page], label: { x, y, w, h: h - f } };
    },
  },
  bubble: {
    section: "notes", label: "Bubble", size: [180, 110], hint: "what someone says or thinks",
    draw(x, y, w, h) {
      const bh = h * 0.76, r = Math.min(14, bh * 0.3, w * 0.15);
      const corner = (cx, cy, a0) => arc(cx, cy, r, r, a0, a0 + PI / 2, 4);
      // Clockwise from the top left, the tail at the bottom, a quarter of the way along.
      const pts = [...corner(x + r, y + r, PI), ...corner(x + w - r, y + r, -PI / 2), ...corner(x + w - r, y + bh - r, 0),
        [x + w * 0.4, y + bh], [x + w * 0.2, y + h], [x + w * 0.24, y + bh], ...corner(x + r, y + bh - r, PI / 2)];
      const body = { k: "poly", pts, closed: true };
      return { parts: [body], fill: [body], label: { x, y, w, h: bh } };
    },
  },
  bulb: {
    section: "notes", label: "Idea", size: [60, 84], hint: "an idea",
    draw(x, y, w, h) {
      const cx = x + w / 2, ry = h * 0.34, cy = y + ry, open = 0.72;
      const neck = y + h * 0.74, n = w * 0.17;
      const glass = { k: "curve", pts: [[cx - n, neck], ...arc(cx, cy, w / 2, ry, PI / 2 + open, PI / 2 - open + 2 * PI, 20), [cx + n, neck]], closed: true };
      const base = [0.83, 0.92].map((k, i) => ({ k: "poly", pts: [[cx - n * (1 - i * 0.15), y + h * k], [cx + n * (1 - i * 0.15), y + h * k]] }));
      const tip = { k: "poly", pts: [[cx - n * 0.45, y + h], [cx + n * 0.45, y + h]] };
      return { parts: [glass, ...base, tip], fill: [glass], label: "below" };
    },
  },
  question: {
    section: "notes", label: "Question", size: [56, 56], hint: "an open question",
    draw(x, y, w, h) {
      const cx = x + w / 2, cy = y + h / 2, ring = { k: "ellipse", x, y, w, h };
      const hook = { k: "curve", pts: [...arc(cx, cy - h * 0.13, w * 0.14, h * 0.13, PI * 1.1, PI * 2.35, 10), [cx, cy + h * 0.06], [cx, cy + h * 0.13]] };
      const d = Math.min(w, h) * 0.09;
      const dot = { k: "ellipse", x: cx - d / 2, y: cy + h * 0.24 - d / 2, w: d, h: d, solid: true };
      return { parts: [ring, hook, dot], fill: [ring], label: "below" };
    },
  },
  alert: {
    section: "notes", label: "Alert", size: [64, 56], hint: "a risk, a warning",
    draw(x, y, w, h) {
      const cx = x + w / 2, tri = { k: "poly", pts: [[cx, y], [x + w, y + h], [x, y + h]], closed: true };
      const bar = { k: "poly", pts: [[cx, y + h * 0.36], [cx, y + h * 0.68]] };
      const d = Math.min(w, h) * 0.09;
      const dot = { k: "ellipse", x: cx - d / 2, y: y + h * 0.82 - d / 2, w: d, h: d, solid: true };
      return { parts: [tri, bar, dot], fill: [tri], label: "below" };
    },
  },
  gear: {
    section: "notes", label: "Gear", size: [64, 64], hint: "a job, a process, settings",
    draw(x, y, w, h) {
      const cx = x + w / 2, cy = y + h / 2, teeth = 8, pts = [];
      const at = (a, r) => [cx + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h / 2) * r];
      for (let i = 0; i < teeth; i++) {
        const a = (2 * PI * i) / teeth;
        pts.push(at(a - 0.3, 0.74), at(a - 0.17, 1), at(a + 0.17, 1), at(a + 0.3, 0.74));
      }
      const body = { k: "poly", pts, closed: true };
      const hole = { k: "ellipse", x: cx - w * 0.15, y: cy - h * 0.15, w: w * 0.3, h: h * 0.3 };
      return { parts: [body, hole], fill: [body], label: "below" };
    },
  },
  clock: {
    section: "notes", label: "Clock", size: [64, 64], hint: "a schedule, cron, a timeout",
    draw(x, y, w, h) {
      const cx = x + w / 2, cy = y + h / 2, face = { k: "ellipse", x, y, w, h };
      const hands = { k: "poly", pts: [[cx, cy - h * 0.32], [cx, cy], [cx + w * 0.24, cy]] };
      return { parts: [face, hands], fill: [face], label: "below" };
    },
  },
  lock: {
    section: "notes", label: "Lock", size: [60, 76], hint: "auth, permissions, a secret",
    draw(x, y, w, h) {
      const cx = x + w / 2, top = y + h * 0.42, sw = w * 0.3, sh = h * 0.3;
      const body = { k: "poly", pts: [[x, top], [x + w, top], [x + w, y + h], [x, y + h]], closed: true };
      const shackle = { k: "curve", pts: [[cx - sw, top], ...arc(cx, y + sh, sw, sh, PI, 2 * PI, 12), [cx + sw, top]] };
      const d = Math.min(w, h) * 0.14, ky = top + (y + h - top) * 0.42;
      const hole = { k: "ellipse", x: cx - d / 2, y: ky - d / 2, w: d, h: d, solid: true };
      const slot = { k: "poly", pts: [[cx, ky], [cx, ky + (y + h - top) * 0.3]] };
      return { parts: [body, shackle, hole, slot], fill: [body], label: "below" };
    },
  },
  envelope: {
    section: "notes", label: "Envelope", size: [96, 64], hint: "email, a notification, a message",
    draw(x, y, w, h) {
      const body = { k: "poly", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true };
      const flap = { k: "poly", pts: [[x, y], [x + w / 2, y + h * 0.55], [x + w, y]] };
      return { parts: [body, flap], fill: [body], label: "below" };
    },
  },
  folder: {
    section: "notes", label: "Folder", size: [140, 105], hint: "a folder, file storage, a bucket",
    draw(x, y, w, h) {
      const t = Math.min(h * 0.18, 18);
      const body = { k: "poly", pts: [[x, y], [x + w * 0.36, y], [x + w * 0.44, y + t], [x + w, y + t], [x + w, y + h], [x, y + h]], closed: true };
      const tab = { k: "poly", pts: [[x, y + t], [x + w * 0.44, y + t]] };
      return { parts: [body, tab], fill: [body], label: { x, y: y + t, w, h: h - t } };
    },
  },
};

export const ICON_TYPES = Object.keys(ICONS);

/** The palette's sections, in order: [key, heading]. */
export const SECTIONS = [["system", "System"], ["notes", "Notes and markers"]];

/** Shapes an arrow meets on their circle rather than their box. */
export const ROUND = new Set(["cloud", "gear", "clock", "question"]);

/** Every point a part goes through (an ellipse: its box's corners). */
export function partPoints(p) {
  return p.k === "ellipse" ? box(p.x, p.y, p.w, p.h) : p.pts;
}

// The frame's title strip, world px: a press there (or on its border) takes it.
export const FRAME_TITLE = 26;
