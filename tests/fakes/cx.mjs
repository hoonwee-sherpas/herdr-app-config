// A fake GPUI context: records notify/stop_propagation, keeps timers until a
// test runs them, and starts spawned tasks at once.

export function makeCx() {
  const cx = {
    notified: 0,
    stopped: 0,
    timers: [],
    notify() { cx.notified++; },
    stop_propagation() { cx.stopped++; },
    // The system clipboard's text (undefined: it holds none, or only a picture).
    clipboard: undefined,
    read_from_clipboard() { return cx.clipboard; },
    write_to_clipboard(text) { cx.clipboard = String(text); },
    focus_handle() {
      return { focused: false, focus() { this.focused = true; }, is_focused() { return this.focused; } };
    },
    timer: {
      after: (ms, fn) => add(ms, fn, false),
      every: (ms, fn) => add(ms, fn, true),
    },
    spawn(fn) {
      Promise.resolve().then(() => fn(cx)).catch((e) => { cx.errors.push(e); });
      return { cancel() {}, is_done: () => false };
    },
    errors: [],
    /** Lets pending promises (spawned tasks, fake I/O) run. */
    async settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); },
    /** Runs every one-shot timer due (repeatedly, as timers add timers), then settles. */
    async flush() {
      for (let round = 0; round < 10; round++) {
        const due = cx.timers.filter((t) => !t.every && !t.done && !t.cancelled);
        if (!due.length) break;
        for (const t of due) { t.done = true; t.fn(cx); }
        await cx.settle();
      }
      await cx.settle();
    },
    /** Runs repeating timers once (polls, ticks). */
    async tick() { for (const t of cx.timers.filter((t) => t.every && !t.cancelled)) t.fn(cx); await cx.settle(); },
  };
  function add(ms, fn, every) {
    const t = { ms, fn, every, done: false, cancelled: false, cancel() { t.cancelled = true; }, is_done: () => t.done };
    cx.timers.push(t);
    return t;
  }
  return cx;
}

/** A mouse event as gpui-kit delivers it (positions in screen points). */
export const mouse = (x, y, extra = {}) => ({
  button: "left", click_count: 1, position: { x, y }, local_position: { x, y },
  modifiers: { shift: false, control: false, alt: false, platform: false, function: false }, ...extra,
});
export const key = (keystroke, extra = {}) => ({
  key: keystroke.split("-").at(-1), keystroke, modifiers: {}, ...extra,
});
