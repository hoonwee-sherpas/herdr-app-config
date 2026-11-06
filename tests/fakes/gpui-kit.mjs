// Fake "gpui-kit" for tests (see tests/AGENTS.md).
import { el } from "./element.mjs";

export class View {}
export const div = () => el("div");
export const svg = (path) => el("svg", path);
export const image = (path) => el("image", path);
export const uniform_list = (...args) => el("uniform_list", args);

// Paths record their operations; build() returns them as plain data.
function builder(mode, width) {
  const b = { mode, width, ops: [], dash: null };
  const api = {};
  for (const op of ["move_to", "line_to", "curve_to", "cubic_bezier_to", "arc_to", "add_polygon", "close"]) {
    api[op] = (...args) => { b.ops.push([op, ...args]); return api; };
  }
  api.dash_array = (v) => { b.dash = v; return api; };
  api.build = () => ({ ...b, ops: [...b.ops] });
  return api;
}
export const PathBuilder = { fill: () => builder("fill"), stroke: (w) => builder("stroke", w) };

const bg = (o) => ({ ...o, opacity: (f) => bg({ ...o, opacity: f }), color_space: () => bg(o) });
export const Background = {
  solid: (color) => bg({ solid: color }),
  stop: (color, percentage) => ({ color, percentage }),
  linear_gradient: (angle, from, to) => bg({ gradient: [angle, from, to] }),
  pattern_slash: (color) => bg({ pattern: color }),
  checkerboard: (color, size) => bg({ checkerboard: [color, size] }),
};
