// A search bar and a side navigation: a column of entries (All first) with the
// picked one marked, beside whatever the caller shows for it.
//
// Used by the Linear panel (projects) and the GitHub panel (workflows). Mods
// can't import each other, so mods/github/sidenav.js is a copy of this file; a
// test keeps them the same.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { settings } from "herdr";

// How narrow and wide the nav column can be dragged, in px.
export const NAV_MIN = 100, NAV_MAX = 360;

/** The nav's width and an edge drag in progress; the caller keeps one per nav. */
export const navState = (width) => ({ width: Math.min(NAV_MAX, Math.max(NAV_MIN, Number(width) || 150)), drag: null });

/** The search field across the top of a list. */
export function searchBar(t, input) {
  return h_flex().h(32).flex_none().mx(10).my(6).px(8).items_center().rounded(6).border_1().border_color(t.border)
    .bg(t.input ?? t.background)
    .child(Input.new(input).flex_1().h_full().text_size(12).text_color(t.foreground));
}

/**
 * The nav column beside `body`. `entries`: [{ key, label, count }]; the entry
 * whose key is `picked` is marked; `onPick(key, cx)` on a click. Each entry's
 * id is `${id}-${key}`; the column's parts use `${id}/…`. Its right edge (`${id}/resize`) drags to resize it:
 * `state` (navState) holds the width, and `onResized(width)` hears the new one
 * when the drag ends.
 */
export function sideNav(t, { id, entries, picked, onPick, body, state, onResized }) {
  // Pointer positions are screen points; layout is in herdr's zoomed px.
  const zoom = () => Number(settings()?.zoom) || 1;
  const end = (cx) => {
    if (!state.drag) return;
    state.drag = null;
    onResized(state.width);
    cx.notify();
  };
  return h_flex().id(`${id}/pane`).flex_1().min_h(0).items_start()
    .when(Boolean(state.drag), (el) => el.cursor_col_resize())
    .on_mouse_move((e, cx) => {
      if (!state.drag) return;
      const w = state.drag.width + (e.position.x - state.drag.x) / zoom();
      state.width = Math.round(Math.min(NAV_MAX, Math.max(NAV_MIN, w)));
      cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => end(cx))
    // A release outside the panel never arrives; the next press ends the drag.
    .on_mouse_down("left", (_e, cx) => end(cx))
    .child(v_flex().id(id).w(state.width).flex_none().h_full().overflow_y_scrollbar().px(6).py(4).gap(1)
      .border_r(1).border_color(t.border)
      .children(entries.map((e) => {
        const on = e.key === picked;
        return h_flex().id(`${id}-${e.key}`).h(28).flex_none().pl(6).pr(6).gap(6).items_center().rounded(6).cursor_pointer()
          .bg(on ? t.selected : t.background).hover((s) => s.bg(on ? t.selected : t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); onPick(e.key, cx); cx.notify(); })
          .child(div().w(2).h(14).flex_none().rounded(1).bg(on ? t.accent : "#00000000"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(e.label))
          .when(e.count != null, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(String(e.count))));
      })))
    .child(div().id(`${id}/resize`).w(5).ml(-3).h_full().flex_none().cursor_col_resize()
      .hover((s) => s.bg(t.border))
      .when(Boolean(state.drag), (el) => el.bg(t.accent))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        state.drag = { x: e.position.x, width: state.width };
        cx.notify();
      }))
    .child(v_flex().flex_1().min_w(0).h_full().min_h(0).child(body));
}
