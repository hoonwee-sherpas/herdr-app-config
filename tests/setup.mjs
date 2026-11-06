// Loaded with `node --import ./tests/setup.mjs`: points the host modules a mod
// imports ("gpui-kit", "gpui-base", "herdr") at the fakes in tests/fakes, and
// gives each test file the globals mods expect (localStorage, window).
import { registerHooks } from "node:module";

const FAKES = {
  "gpui-kit": new URL("./fakes/gpui-kit.mjs", import.meta.url).href,
  "gpui-base": new URL("./fakes/gpui-base.mjs", import.meta.url).href,
  herdr: new URL("./fakes/herdr.mjs", import.meta.url).href,
};

registerHooks({
  resolve(specifier, context, next) {
    if (FAKES[specifier]) return { url: FAKES[specifier], shortCircuit: true, format: "module" };
    return next(specifier, context);
  },
});

const { el } = await import("./fakes/element.mjs");

// Mods' localStorage is per mod in herdr; tests reset it with localStorage.clear().
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
// gpui-kit's global window (Sketch draws through window.paint_path).
globalThis.window = { paint_path: (path, background) => el("path", { path, background }) };
