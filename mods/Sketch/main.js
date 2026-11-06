// Sketch: a whiteboard pane (⌘⇧E splits one open) drawn natively (no browser). Boxes, ellipses,
// diamonds, arrows that stay attached to shapes, lines, a pen and text.
// The board is a JSON file (data/sketch/board.json, format in FORMAT.md), saved
// as you draw and reloaded when something else (an AI agent) changes it.
//
// Keys: V select · R box · O ellipse · D diamond · A arrow · L line · P pen ·
// T text · 1–6 color · F fill · S dashed · ⌫ delete · ↵ / double-click edit
// text · ⌘Z / ⌘⇧Z undo/redo · ⇧1 fit · Esc deselect.
// Mouse: drag empty space (or middle button) to pan, scroll to pan, ⌘ or
// ctrl + scroll to zoom. Drag the bottom-right handle to resize.

import { View, div, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, readTextFile, writeTextFile, watchFolder, exec, theme, settings } from "herdr";

const DIR = () => `${appHome()}/data/sketch`;
const FILE = () => `${DIR()}/board.json`;

const INK = "#1e1e1e";
const SELECT = "#4c6ef5";
// Ink colors and the pastel fill that goes with each.
export const COLORS = [
  [INK, "#e9ecef"], ["#e03131", "#ffc9c9"], ["#2f9e44", "#b2f2bb"],
  ["#1971c2", "#a5d8ff"], ["#f08c00", "#ffd8a8"], ["#9c36b5", "#eebefa"],
];
const TOOLS = [
  ["select", "v", "Select"], ["rect", "r", "Box"], ["ellipse", "o", "Ellipse"], ["diamond", "d", "Diamond"],
  ["arrow", "a", "Arrow"], ["line", "l", "Line"], ["pen", "p", "Pen"], ["text", "t", "Text"],
];
export const BOXY = new Set(["rect", "ellipse", "diamond", "text"]);
const GAP = 6;          // between an attached arrow and its shape
const HANDLE = 9;       // resize handle, screen px
const FONT = 20;        // default text size

// ---- colors: the board stores light-mode colors; on a dark theme inks are
// lightened and fills darkened (same hue) when drawn.

export function hsl(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hex([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const valid = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}/.test(c);
export const inkFor = (c, dark) => {
  if (!dark || !valid(c)) return c;
  const [h, s, l] = hsl(c);
  return l < 0.5 ? hex([h, s, 1 - l * 0.6]) : c;
};
export const fillFor = (c, dark) => {
  if (!dark || !valid(c)) return c;
  const [h, s, l] = hsl(c);
  return hex([h, s * 0.6, 0.14 + (1 - l) * 0.4]);
};

const newId = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- geometry (world coordinates)

export function textSize(s) {
  const fs = s.fontSize ?? FONT;
  const lines = String(s.text ?? "").split("\n");
  let w = 0;
  for (const l of lines) {
    let lw = 0;
    for (const ch of l) lw += ch.charCodeAt(0) < 128 ? fs * 0.56 : fs;
    w = Math.max(w, lw);
  }
  return { w: Math.max(w, fs), h: lines.length * fs * 1.3 };
}

export function norm(s) {
  const w = s.w ?? 0, h = s.h ?? 0;
  return { x: Math.min(s.x, s.x + w), y: Math.min(s.y, s.y + h), w: Math.abs(w), h: Math.abs(h) };
}

export const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

// Where the line from a shape's center toward `aim` leaves the shape.
export function edge(s, aim) {
  const b = bbox(s);
  const c = center(b);
  const dx = aim[0] - c[0], dy = aim[1] - c[1];
  if (!dx && !dy) return c;
  const hw = b.w / 2 + GAP, hh = b.h / 2 + GAP;
  const k = s.type === "ellipse" ? 1 / Math.hypot(dx / hw, dy / hh)
    : s.type === "diamond" ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * k, c[1] + dy * k];
}

// An arrow or line's points; an end attached to a shape (from/to) sits on its edge.
export function points(s, byId) {
  const pts = Array.isArray(s.points) ? s.points : [];
  const A = s.from ? byId.get(s.from) : null, B = s.to ? byId.get(s.to) : null;
  const a = A && BOXY.has(A.type) ? A : null, b = B && BOXY.has(B.type) ? B : null;
  if (!a && !b) return pts;
  const p0 = pts[0], p1 = pts[pts.length - 1];
  const aim0 = b ? center(bbox(b)) : p1, aim1 = a ? center(bbox(a)) : p0;
  if (!aim0 || !aim1) return pts;
  return [a ? edge(a, aim0) : p0, b ? edge(b, aim1) : p1];
}

export function bbox(s, byId) {
  if (s.type === "text") { const t = textSize(s); return { x: s.x, y: s.y, w: t.w, h: t.h }; }
  if (BOXY.has(s.type)) return norm(s);
  const pts = points(s, byId ?? new Map());
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function hits(s, p, byId, tol) {
  if (BOXY.has(s.type)) {
    const b = bbox(s);
    return p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol;
  }
  const pts = points(s, byId);
  for (let i = 1; i < pts.length; i++) if (distSeg(p, pts[i - 1], pts[i]) <= tol) return true;
  return false;
}

// ---- paths (screen coordinates)

export function roundRect(pb, x, y, w, h, r) {
  if (r < 0.5) return pb.add_polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  return pb.move_to(x + r, y).line_to(x + w - r, y).arc_to(r, r, 0, false, true, x + w, y + r)
    .line_to(x + w, y + h - r).arc_to(r, r, 0, false, true, x + w - r, y + h)
    .line_to(x + r, y + h).arc_to(r, r, 0, false, true, x, y + h - r)
    .line_to(x, y + r).arc_to(r, r, 0, false, true, x + r, y).close();
}

function ellipse(pb, x, y, w, h) {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return pb.move_to(cx + rx, cy).arc_to(rx, ry, 0, false, true, cx - rx, cy)
    .arc_to(rx, ry, 0, false, true, cx + rx, cy).close();
}

function diamond(pb, x, y, w, h) {
  return pb.add_polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], true);
}

const SHAPE_PATH = { rect: roundRect, ellipse, diamond };

export function serialize(shapes) {
  return `{\n  "version": 1,\n  "shapes": [\n${shapes.map((s) => `    ${JSON.stringify(s)}`).join(",\n")}\n  ]\n}\n`;
}

export function parse(text) {
  const d = JSON.parse(text);
  const list = Array.isArray(d) ? d : d?.shapes;
  if (!Array.isArray(list)) throw new Error("no \"shapes\" list");
  return list.filter((s) => s && typeof s.type === "string").map((s) => ({ ...s, id: s.id ?? newId() }));
}

export default class Sketch extends View {
  init(_props, cx) {
    this.shapes = [];
    this.tool = "select";
    this.color = 0;
    this.fill = false;
    this.dashed = false;
    this.sel = null;
    this.drag = null;
    this.pan = { x: 40, y: 40 };
    this.zoom = 1;
    this.size = { width: 1000, height: 700 };
    this.undo = [];
    this.redo = [];
    this.editing = null;
    this.fileText = null;
    this.writing = null;
    this.saveSeq = 0;
    this.error = null;
    this.done = false;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Text" });
    this.input.on("submit", (_e, cx) => { this.finishEdit(cx); cx.notify(); });
    cx.timer.after(300, () => this.handle.focus());
    cx.spawn(async (cx) => {
      try {
        await exec("mkdir", ["-p", DIR()]);
        const text = await readTextFile(FILE());
        this.fileText = text;
        if (text) this.shapes = parse(text);
      } catch (e) {
        this.error = `board.json: ${e?.message ?? e}`;
      }
      cx.notify();
      // Reload when the file changes from outside (an agent edited it).
      for (;;) {
        await watchFolder(DIR());
        if (this.done) return;
        const text = await readTextFile(FILE());
        if (text == null || text === this.fileText || text === this.writing) continue;
        this.fileText = text;
        try {
          const next = parse(text);
          this.remember();
          this.shapes = next;
          if (this.sel && !next.some((s) => s.id === this.sel)) this.sel = null;
          this.error = null;
        } catch (e) {
          this.error = `board.json: ${e?.message ?? e}`;
        }
        cx.notify();
      }
    });
  }

  // ---- state

  byId() { return new Map(this.shapes.map((s) => [s.id, s])); }
  selected() { return this.shapes.find((s) => s.id === this.sel) ?? null; }
  // Mouse events come in screen points; the canvas lays out in herdr's zoomed
  // pixels (settings.zoom), so convert before comparing with shapes.
  scale() { return Number(settings()?.zoom) || 1; }
  local(e) { const p = e.local_position; if (!p) return null; const z = this.scale(); return { x: p.x / z, y: p.y / z }; }
  measure(e) { if (e.bounds) { const z = this.scale(); this.size = { width: e.bounds.width / z, height: e.bounds.height / z }; } }

  world(p) { return [(p.x - this.pan.x) / this.zoom, (p.y - this.pan.y) / this.zoom]; }
  screen(p) { return [p[0] * this.zoom + this.pan.x, p[1] * this.zoom + this.pan.y]; }

  remember() {
    this.undo.push(JSON.stringify(this.shapes));
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  }

  restore(from, to, cx) {
    if (!from.length) return;
    to.push(JSON.stringify(this.shapes));
    this.shapes = JSON.parse(from.pop());
    if (!this.selected()) this.sel = null;
    this.save(cx);
  }

  save(cx) {
    const seq = ++this.saveSeq;
    cx.timer.after(300, (cx) => {
      if (seq !== this.saveSeq) return;
      const text = serialize(this.shapes);
      if (text === this.fileText) return;
      this.writing = text;
      cx.spawn(async (cx) => {
        try {
          await writeTextFile(FILE(), text, this.fileText);
        } catch {
          // The file changed under us; ours is newer, so replace it.
          try { await writeTextFile(FILE(), text, await readTextFile(FILE())); } catch (e) { this.error = `save: ${e?.message ?? e}`; }
        }
        this.fileText = text;
        cx.notify();
      });
    });
  }

  hitAt(p) {
    const byId = this.byId();
    const tol = 6 / this.zoom;
    for (let i = this.shapes.length - 1; i >= 0; i--) if (hits(this.shapes[i], p, byId, tol)) return this.shapes[i];
    return null;
  }

  boxAt(p, not) {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (s.id !== not && BOXY.has(s.type) && hits(s, p, null, 0)) return s;
    }
    return null;
  }

  startEdit(s) {
    this.editing = s.id;
    this.sel = s.id;
    this.input.set_value(s.text ?? "");
    this.input.focus();
  }

  finishEdit(cx) {
    const s = this.shapes.find((x) => x.id === this.editing);
    this.editing = null;
    this.handle.focus();
    if (!s) return;
    const text = this.input.value();
    if ((s.text ?? "") === text && text) return;
    this.remember();
    if (text) s.text = text; else delete s.text;
    if (s.type === "text" && !text) { this.shapes = this.shapes.filter((x) => x !== s); this.sel = null; }
    this.save(cx);
  }

  toggleFill(cx) {
    const s = this.selected();
    this.fill = s ? !s.fill : !this.fill;
    if (s && BOXY.has(s.type) && s.type !== "text") this.style(cx, { fill: this.fill ? COLORS[this.color][1] : null });
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== "select") this.sel = null;
  }

  // Applies a style change to the selection too.
  style(cx, patch) {
    const s = this.selected();
    if (!s) return;
    this.remember();
    Object.assign(s, patch);
    for (const k of Object.keys(patch)) if (patch[k] == null) delete s[k];
    this.save(cx);
  }

  fit() {
    if (!this.shapes.length) { this.pan = { x: 40, y: 40 }; this.zoom = 1; return; }
    const byId = this.byId();
    const bs = this.shapes.map((s) => bbox(s, byId));
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    const pad = 40;
    this.zoom = clamp(Math.min((this.size.width - 2 * pad) / Math.max(x1 - x0, 1), (this.size.height - 2 * pad) / Math.max(y1 - y0, 1)), 0.1, 2);
    this.pan = { x: (this.size.width - (x1 - x0) * this.zoom) / 2 - x0 * this.zoom, y: (this.size.height - (y1 - y0) * this.zoom) / 2 - y0 * this.zoom };
  }

  // ---- mouse

  down(e, cx) {
    cx.stop_propagation();
    this.measure(e);
    if (this.editing) this.finishEdit(cx);
    this.handle.focus();
    const local = this.local(e);
    if (!local) return;
    const p = this.world(local);
    const ink = COLORS[this.color][0];
    const style = { ...(this.color ? { color: ink } : {}), ...(this.dashed ? { dashed: true } : {}) };

    if (this.tool === "select") {
      const sel = this.selected();
      if (sel && BOXY.has(sel.type) && sel.type !== "text") {
        const b = norm(sel);
        const [hx, hy] = this.screen([b.x + b.w, b.y + b.h]);
        if (Math.abs(local.x - hx) <= HANDLE && Math.abs(local.y - hy) <= HANDLE) {
          this.drag = { kind: "resize", before: JSON.stringify(this.shapes), s: sel, b };
          return;
        }
      }
      const s = this.hitAt(p);
      if (s && e.click_count >= 2 && BOXY.has(s.type)) { this.startEdit(s); return; }
      if (s) {
        this.sel = s.id;
        this.drag = { kind: "move", before: JSON.stringify(this.shapes), s, start: p, orig: JSON.parse(JSON.stringify(s)) };
      } else {
        this.sel = null;
        this.drag = { kind: "pan", start: local, pan: { ...this.pan } };
      }
      return;
    }

    this.remember();
    let s;
    if (this.tool === "text") {
      s = { id: newId(), type: "text", x: p[0], y: p[1] - FONT * 0.65, ...style };
      this.shapes.push(s);
      this.startEdit(s);
      return;
    }
    if (this.tool === "pen") s = { id: newId(), type: "pen", points: [p], ...style };
    else if (this.tool === "arrow" || this.tool === "line") s = { id: newId(), type: this.tool, points: [p, p], ...style };
    else s = { id: newId(), type: this.tool, x: p[0], y: p[1], w: 0, h: 0, ...style, ...(this.fill ? { fill: COLORS[this.color][1] } : {}) };
    this.shapes.push(s);
    this.drag = { kind: "draw", s, start: p };
  }

  move(e, cx) {
    this.measure(e);
    const d = this.drag;
    if (!d) return;
    const l = this.local(e);
    if (!l) return;
    const p = this.world(l);
    if (d.kind === "pan") {
      this.pan = { x: d.pan.x + l.x - d.start.x, y: d.pan.y + l.y - d.start.y };
    } else if (d.kind === "move") {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if ("x" in d.orig) { d.s.x = d.orig.x + dx; d.s.y = d.orig.y + dy; }
      if (d.orig.points) {
        d.s.points = d.orig.points.map((q) => [q[0] + dx, q[1] + dy]);
        // Moving an arrow by hand detaches it.
        delete d.s.from; delete d.s.to;
      }
    } else if (d.kind === "resize") {
      d.s.x = d.b.x; d.s.y = d.b.y;
      d.s.w = Math.max(8, p[0] - d.b.x); d.s.h = Math.max(8, p[1] - d.b.y);
    } else if (d.kind === "draw") {
      const s = d.s;
      if (s.type === "pen") {
        const last = s.points[s.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.zoom >= 2) s.points.push(p);
      } else if (s.points) {
        let q = p;
        if (e.modifiers.shift) { // snap to 45°
          const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
          q = [d.start[0] + Math.cos(a) * l, d.start[1] + Math.sin(a) * l];
        }
        s.points = [d.start, q];
      } else {
        let w = p[0] - d.start[0], h = p[1] - d.start[1];
        if (e.modifiers.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        s.w = w; s.h = h;
      }
    }
    cx.notify();
  }

  up(_e, cx) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "pan") return;
    if (d.kind === "move" || d.kind === "resize") {
      if (JSON.stringify(this.shapes) !== d.before) {
        this.undo.push(d.before);
        this.redo = [];
        this.save(cx);
      }
      return;
    }
    const s = d.s;
    if (s.type === "pen") {
      if (s.points.length < 2) s.points.push([s.points[0][0] + 0.5, s.points[0][1] + 0.5]);
    } else if (s.points) {
      const [a, b] = s.points;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) * this.zoom < 4) { this.shapes.pop(); this.undo.pop(); return; }
      const A = this.boxAt(a, s.id), B = this.boxAt(b, s.id);
      if (A) s.from = A.id;
      if (B && B !== A) s.to = B.id;
      this.tool = "select";
      this.sel = s.id;
    } else {
      Object.assign(s, norm(s));
      // A click without a drag makes a default-size shape.
      if (s.w * this.zoom < 4 && s.h * this.zoom < 4) { s.w = 160; s.h = 72; s.x -= 80; s.y -= 36; }
      this.tool = "select";
      this.sel = s.id;
    }
    this.save(cx);
  }

  wheel(e, cx) {
    this.measure(e);
    cx.stop_propagation();
    if (e.modifiers.platform || e.modifiers.control) {
      const l = this.local(e) ?? { x: this.size.width / 2, y: this.size.height / 2 };
      const z = clamp(this.zoom * Math.exp(e.delta.y * 0.01), 0.1, 6);
      this.pan = { x: l.x - (l.x - this.pan.x) * (z / this.zoom), y: l.y - (l.y - this.pan.y) * (z / this.zoom) };
      this.zoom = z;
    } else {
      this.pan = { x: this.pan.x + e.delta.x / this.scale(), y: this.pan.y + e.delta.y / this.scale() };
    }
    cx.notify();
  }

  // ---- keys

  key(e, cx) {
    const k = e.keystroke;
    if (this.editing) {
      if (k === "escape") { this.finishEdit(cx); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const tool = TOOLS.find((t) => t[1] === k);
    const digit = /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
    const s = this.selected();
    if (tool) this.setTool(tool[0]);
    else if (digit >= 0) {
      this.color = digit;
      if (s) this.style(cx, { color: digit ? COLORS[digit][0] : null, ...(s.fill ? { fill: COLORS[digit][1] } : {}) });
    } else if (k === "f") this.toggleFill(cx);
    else if (k === "s") {
      this.dashed = s ? !s.dashed : !this.dashed;
      if (s) this.style(cx, { dashed: this.dashed || null });
    } else if ((k === "backspace" || k === "delete") && s) {
      this.remember();
      this.shapes = this.shapes.filter((x) => x !== s);
      for (const x of this.shapes) { if (x.from === s.id) delete x.from; if (x.to === s.id) delete x.to; }
      this.sel = null;
      this.save(cx);
    } else if (k === "enter" && s && BOXY.has(s.type)) this.startEdit(s);
    else if (k === "cmd-z") this.restore(this.undo, this.redo, cx);
    else if (k === "cmd-shift-z") this.restore(this.redo, this.undo, cx);
    else if (k === "shift-1" || k === "!" || e.key_char === "!") this.fit();
    else if (k === "escape") {
      if (this.sel) this.sel = null;
      else if (this.tool !== "select") this.tool = "select";
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- drawing

  paint(s, byId, out) {
    const z = this.zoom;
    const ink = inkFor(s.color ?? INK, this.dark);
    const width = Math.max(1, (s.width ?? 2) * z);
    const dash = (pb) => (s.dashed ? pb.dash_array([8 * z, 6 * z]) : pb);
    const layer = (pb, bg) => out.push(window.paint_path(pb.build(), bg).absolute().top(0).left(0).size_full());

    if (SHAPE_PATH[s.type]) {
      const b = norm(s);
      if (b.w < 1 || b.h < 1) return;
      const [x, y] = this.screen([b.x, b.y]);
      const w = b.w * z, h = b.h * z;
      const make = (pb) => (s.type === "rect" ? roundRect(pb, x, y, w, h, Math.min(10 * z, w / 4, h / 4)) : SHAPE_PATH[s.type](pb, x, y, w, h));
      if (s.fill) layer(make(PathBuilder.fill()), Background.solid(fillFor(s.fill, this.dark)));
      layer(dash(make(PathBuilder.stroke(width))), ink);
      if (s.text) {
        out.push(div().absolute().left(x).top(y).w(w).h(h).flex().items_center().justify_center().px(6 * z)
          .text_size((s.fontSize ?? 16) * z).text_color(ink).text_center().overflow_hidden()
          .child(this.editing === s.id ? "" : s.text));
      }
      return;
    }
    if (s.type === "text") {
      const [x, y] = this.screen([s.x, s.y]);
      if (this.editing !== s.id) {
        out.push(div().absolute().left(x).top(y).text_size((s.fontSize ?? FONT) * z)
          .text_color(ink).whitespace_nowrap().child(String(s.text ?? "")));
      }
      return;
    }
    const pts = (s.type === "pen" ? s.points ?? [] : points(s, byId)).map((p) => this.screen(p));
    if (pts.length < 2) return;
    let pb = PathBuilder.stroke(width).move_to(pts[0][0], pts[0][1]);
    if (s.type === "pen") {
      for (let i = 1; i < pts.length - 1; i++) {
        pb = pb.curve_to((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, pts[i][0], pts[i][1]);
      }
      pb = pb.line_to(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    } else {
      for (const p of pts.slice(1)) pb = pb.line_to(p[0], p[1]);
    }
    layer(dash(pb), ink);
    if (s.type === "arrow") {
      const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
      const a = Math.atan2(by - ay, bx - ax), l = Math.min(14 * z, Math.hypot(bx - ax, by - ay) / 2);
      const head = PathBuilder.stroke(width).move_to(bx - l * Math.cos(a - 0.45), by - l * Math.sin(a - 0.45))
        .line_to(bx, by).line_to(bx - l * Math.cos(a + 0.45), by - l * Math.sin(a + 0.45));
      layer(head, ink);
    }
    if (s.text) {
      const mid = pts[Math.floor(pts.length / 2) - (pts.length % 2 ? 0 : 1)], end = pts[Math.floor(pts.length / 2)];
      const mx = (mid[0] + end[0]) / 2, my = (mid[1] + end[1]) / 2;
      out.push(div().absolute().left(mx - 80 * z).top(my - 11 * z).w(160 * z).flex().justify_center()
        .child(div().px(4 * z).bg(this.t.background).text_size(13 * z).text_color(ink).child(this.editing === s.id ? "" : s.text)));
    }
  }

  selection(byId, out) {
    const s = this.selected();
    if (!s) return;
    const b = bbox(s, byId);
    const [x, y] = this.screen([b.x, b.y]);
    const w = b.w * this.zoom, h = b.h * this.zoom;
    out.push(window.paint_path(PathBuilder.stroke(1).dash_array([4, 3]).add_polygon(
      [[x - 5, y - 5], [x + w + 5, y - 5], [x + w + 5, y + h + 5], [x - 5, y + h + 5]], true).build(), SELECT)
      .absolute().top(0).left(0).size_full());
    if (BOXY.has(s.type) && s.type !== "text") {
      out.push(div().absolute().left(x + w - HANDLE / 2).top(y + h - HANDLE / 2).size(HANDLE)
        .bg(this.t.background).border_1().border_color(SELECT).rounded(2));
    }
  }

  editor(out) {
    const s = this.shapes.find((x) => x.id === this.editing);
    if (!s) return;
    const byId = this.byId();
    const b = bbox(s, byId);
    let [x, y] = this.screen([b.x, b.y]);
    let w = Math.max(180, b.w * this.zoom);
    if (s.type !== "text") { x += (b.w * this.zoom - w) / 2; y += (b.h * this.zoom) / 2 - 16; }
    out.push(div().absolute().left(x).top(y).w(w).h(32).px(6).rounded(6).border_1().border_color(SELECT).bg(this.t.popover)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(this.input).size_full().text_size(14).text_color(this.t.foreground)));
  }

  button(id, label, active, onClick) {
    return div().id(id).h(26).px(8).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .text_color(active ? "#ffffff" : this.t.foreground).bg(active ? SELECT : "#00000000").hover((el) => (active ? el : el.bg(this.t.hover)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { onClick(cx); this.handle.focus(); cx.notify(); })
      .child(label);
  }

  render() {
    const t = theme();
    this.t = t;
    // A dark theme: the terminals' background is darker than mid-gray.
    this.dark = valid(t.background) ? hsl(t.background)[2] < 0.5 : false;
    const byId = this.byId();
    const layers = [];
    for (const s of this.shapes) this.paint(s, byId, layers);
    this.selection(byId, layers);
    this.editor(layers);
    const s = this.selected();
    const cursor = this.tool === "select" ? (this.drag?.kind === "pan" ? "grabbing" : "default") : "crosshair";

    const toolbar = h_flex().flex_none().flex_wrap().min_h(40).py(6).px(10).gap(2).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .children(TOOLS.map(([name, key, label]) => this.button(`tool-${name}`, `${label} ${key.toUpperCase()}`, this.tool === name, () => this.setTool(name))))
      .child(div().w(12))
      .children(COLORS.map(([ink], i) => div().id(`color-${i}`).size(18).rounded(9).bg(inkFor(ink, this.dark)).cursor_pointer()
        .border_2().border_color(this.color === i ? SELECT : t.chrome)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          this.color = i;
          const s = this.selected();
          if (s) this.style(cx, { color: i ? ink : null, ...(s.fill ? { fill: COLORS[i][1] } : {}) });
          this.handle.focus();
          cx.notify();
        })))
      .child(div().w(8))
      .child(this.button("fill", "Fill F", s ? Boolean(s.fill) : this.fill, (cx) => this.toggleFill(cx)))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child(this.error ?? `${Math.round(this.zoom * 100)}%`))
      .child(this.button("fit", "Fit ⇧1", false, () => this.fit()));

    const canvas = div().id("sketch-canvas").relative().flex_1().min_h(0).overflow_hidden().bg(t.background)
      .when(cursor === "crosshair", (el) => el.cursor_crosshair())
      .when(cursor === "grabbing", (el) => el.cursor_grabbing())
      .on_mouse_down("left", (e, cx) => { this.down(e, cx); cx.notify(); })
      .on_mouse_down("middle", (e, cx) => {
        cx.stop_propagation();
        const l = this.local(e);
        if (l) this.drag = { kind: "pan", start: l, pan: { ...this.pan } };
      })
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (e, cx) => { this.up(e, cx); cx.notify(); })
      .on_mouse_up("middle", (_e, cx) => { this.drag = null; cx.notify(); })
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      .children(layers)
      .when(!this.shapes.length, (el) => el.child(div().absolute().top(0).left(0).size_full().flex().items_center().justify_center()
        .text_color(t.dim).text_size(14).child("Pick a tool (R box, A arrow, P pen, T text) and drag here.")));

    return v_flex().id("sketch").track_focus(this.handle).size_full().bg(t.background).overflow_hidden()
      .on_key_down((e, cx) => this.key(e, cx))
      .child(toolbar)
      .child(canvas)
      .child(h_flex().flex_none().h(24).px(10).items_center().gap(12).border_t(1).border_color(t.border).bg(t.chrome)
        .text_size(11).text_color(t.dim)
        .child("drag empty space to pan · ⌘ scroll to zoom · double-click to add text · ⇧ snaps · S dashed · ⌫ delete · ⌘Z undo")
        .child(div().flex_1())
        .child("data/sketch/board.json"));
  }
}
