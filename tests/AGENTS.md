# Tests and how to change this config

This repo is a Herdr app config (`~/.config/herdr-app`): layouts, keys and
mods. Herdr rewrites the root `AGENTS.md` on every start, so the rules for this
repo live here, and the root `CLAUDE.md` loads this file.

## IMPORTANT: test first (TDD)

Every change to a mod's behavior starts with a failing test.

1. **Red.** Write the test for the behavior you want, or for the bug you're
   fixing, and run it. It must fail, and fail for the reason you expect. A bug
   fix's test reproduces the bug before the fix.
2. **Green.** Make the smallest change that passes it.
3. **Refactor.** Tidy up with the tests passing.
4. **Check the test can fail.** If the test went green without a code change,
   or you're unsure it tests anything, break the code on purpose (in a scratch
   copy, never the live `mods/`), confirm the test fails, then restore the
   copy. A test that can't fail is worse than none.
5. **Finish.** `npm test` passes, and `herdr-app check mods/<name>` passes for
   every mod you touched. Then try it in the app.

Don't weaken or delete a test to make it pass. If the behavior really changed,
change the test in the same commit and say why.

## Running

Node 22.15 or newer, no dependencies, no install step.

| Command | Runs |
|---|---|
| `npm test` | unit and integration tests (what to run before every commit) |
| `npm run test:unit` | `tests/unit` only: fast, pure logic |
| `npm run test:integration` | `tests/integration`: whole mods against a fake host, plus the config checked by the real `herdr-app` |
| `npm run test:live` | `tests/live`: smoke tests against the running app; they open and close a pane in your current tab |
| `node --import ./tests/setup.mjs --test --test-name-pattern "zoom" 'tests/**/*.test.mjs'` | tests whose names match |

## How mods run under test

A mod imports three host modules: `gpui-kit`, `gpui-base` and `herdr`.
`tests/setup.mjs` (loaded with `--import`) points those imports at fakes in
`tests/fakes/`, and adds the globals mods expect (`localStorage`, `window`).

- **`fakes/element.mjs`:** every element is a recorder. Builder calls are kept
  (`props`, `calls`), children in `kids`, and handlers in `handlers`, keyed by
  name plus button: `on_click`, `on_mouse_down:left`, `on_key_down`,
  `on_scroll_wheel`. `.when(cond, fn)` applies `fn` only when `cond` is true,
  as in GPUI. Query with `walk`, `byId`, `all` and `text`.
- **`fakes/herdr.mjs`:** every function reads or records `host`. Set
  `host.spaces`, `host.panes`, `host.agents`, `host.layout`, `host.theme`
  (`LIGHT`/`DARK`), `host.settings`, `host.shared` and `host.files` (a fake
  disk, with `writeTextFile`'s stale-snapshot check). Answer programs with
  `host.exec = async (cmd, args, opts) => ({ code, stdout, stderr })`.
  Inspect `host.runs` (`host.ran("pane.split")`), `host.overlays`,
  `host.execs` and `host.agentOrder`. `host.fireWatch()` wakes `watchFolder`,
  and `host.command("x")` delivers to `nextCommand`.
- **`fakes/cx.mjs`:** `makeCx()` is the GPUI context. `cx.settle()` lets
  spawned tasks and fake I/O finish. `cx.flush()` runs one-shot timers
  (debounces, delayed saves). `cx.tick()` runs repeating timers once.
  `mouse(x, y, extra)` and `key("cmd-z")` build events.

When a mod starts using a host function or element method the fakes don't have
yet, add it to the fake, following `gpui-kit.d.ts` / `herdr.d.ts`. A missing
named export fails loudly at import, which is how you'll notice.

## Unit tests (`tests/unit/`)

For logic that doesn't need a view: geometry, parsing, colors, labels, query
building.

- Export the helper from the mod as a named export (`export function edge…`).
  Herdr allows named exports next to the default view class. Don't copy the
  function into the test.
- One behavior per test, named as a sentence about that behavior: "edge leaves
  a rectangle on its side, 6px out".
- Use real values from the domain: Linear identifiers like `PRD-102`, Korean
  labels, the actual palette.
- Cover edges: empty input, a missing reference, wide characters, values that
  must pass through unchanged.

## Integration tests (`tests/integration/`)

For a whole mod: `new View()`, `init({}, cx)`, `await cx.settle()`, then drive
it the way a person or herdr would and check what it shows and does.

- **Drive through handlers:** find the element by id (`byId(view.render(),
  "sketch-canvas")`) and call its handler (`handlers["on_mouse_down:left"]`).
  Type with `view.input.type("text", cx)`, press Enter with `.submit(cx)`, and
  send keys through the root's `on_key_down`.
- **Check outcomes:** check what the person sees (`text(...)`, element order,
  props like `bg`) or what herdr is told (`host.ran(...)`, `host.files`,
  `host.shared`). Avoid private fields when an outcome says the same thing.
- **Mouse positions are screen points.** Herdr reports them unzoomed while
  mods lay out in zoomed pixels. Any test of mouse behavior also runs with
  `host.settings.zoom = 1.1`, at a point the wrong math would miss. That's the
  bug that escaped once.
- **Time:** debounces and saves happen on timers, so call `cx.flush()` before
  checking a request or a file.
- **No real I/O:** use `host.files`, never the real `data/` folder (the
  person's Sketch board lives there), and use `host.exec` canned responses,
  never the network or the keychain.
- **Fresh state:** start every file with
  `beforeEach(() => { host.reset(); localStorage.clear(); })`.

`integration/config.test.mjs` checks the real files instead:

- every tracked mod passes the real `herdr-app check`;
- every icon a mod draws exists;
- `keys.json` and `layouts/main-linear.json` only point at mods that exist;
- no tracked file holds a Linear key.

When you add a mod, add a `!/mods/<name>/` line to `.gitignore`. That makes it
tracked and checked.

## Live tests (`tests/live/`)

Only for what needs the real window (a mod loading in place, no errors in
`herdr-app status`). Keep them few and quick, and leave the app as you found
it: close what you open, in a `finally`. They skip unless `HERDR_LIVE=1`.

## Repo conventions

- **Shipped mods are read-only:** Herdr's own mods and layouts (`spaces`,
  `agents`, `main`…) are replaced on every start. To change one,
  `herdr-app do mod.clone '{"name":"spaces","as":"my-spaces"}'` and edit the
  clone.
- **Vendored code:** mods can't import each other. Shared code is copied
  (`linear-search/common.js` is a copy of `linear-issues/common.js`), and a
  test keeps the copies identical.
- **Secrets:** API keys stay in the macOS keychain, never in files or process
  arguments.
- **Commits:** commit and push only when asked. The repo is public.
