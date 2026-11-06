// Fake "gpui-base" for tests.
import { el } from "./element.mjs";

export const h_flex = () => el("h_flex");
export const v_flex = () => el("v_flex");
export const TextView = (...args) => el("text_view", args);

// An input's retained state. Tests type with `state.type("abc", cx)` and press
// Enter with `state.submit(cx)`.
export const InputState = {
  new(options = {}) {
    let value = options.value ?? "";
    const on = {};
    return {
      placeholder: options.placeholder,
      focused: false,
      value: () => value,
      set_value(v) { value = String(v); },
      replace(v) { value = String(v); },
      on(event, fn) { on[event] = fn; return true; },
      focus() { this.focused = true; },
      release() { return true; },
      set_step() {}, set_min() {}, set_max() {}, set_masked() {}, set_loading() {},
      type(text, cx) { value = text; on.change?.({}, cx); },
      submit(cx) { on.submit?.({}, cx); },
    };
  },
};
export const Input = { new: (state) => el("input", state) };
export const NumberInput = { new: (state) => el("number_input", state) };
