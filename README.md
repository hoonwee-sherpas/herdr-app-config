# herdr-app config

My Herdr app setup: a layout with a Linear panel, Linear
issue search, a Sketch whiteboard pane, and the keys for them. Herdr reads `~/.config/herdr-app` live, so
changes show up as soon as the files are saved.

## What's here

| Path | What it is |
|---|---|
| `layouts/main-linear.json` | The `main` layout plus a right-hand panel (Files, Changes, Linear), with one Spaces list that shows each space's agents |
| `mods/spaces-agents/` | That sidebar list: a copy of Herdr's Spaces list with each space's agents (status, time in that state) listed under it; replaces the separate Agents list |
| `mods/tabs-linear/` | The tab bar for that layout, with buttons that open the panel |
| `mods/linear-issues/` | The Linear panel: issues assigned to you, grouped by project or state, matched to Herdr spaces by branch, plus an issue detail view |
| `mods/linear-search/` | ⌘I popup that searches every Linear issue |
| `mods/Sketch/` | A whiteboard pane drawn natively: boxes, ellipses, diamonds, arrows that stay attached, pen, text; follows light/dark themes. The board is `data/sketch/board.json`, which agents can edit (format in `mods/Sketch/FORMAT.md`) |
| `keys.json` | Key bindings, including the ones below |
| `tests/`, `package.json` | Unit and integration tests for the mods (`npm test`); how to write them is in `tests/AGENTS.md` |
| `CLAUDE.md` | Points agents at `tests/AGENTS.md` (Herdr rewrites the root `AGENTS.md`) |

Everything else in `~/.config/herdr-app` is written by Herdr or is personal
state, so `.gitignore` leaves it out.

## Keys

| Key | Does |
|---|---|
| ⌘I | Search Linear issues (popup) |
| ⌘⇧I | Open or close the Linear panel (floating window outside `main-linear`) |
| ⌘⇧L | Switch layout (pick `main-linear`) |
| ⌘⇧E | Open a Sketch pane to the right (also the Sketch button in the tab bar) |

In the search popup: ↵ shows details (and opens the Linear panel), ⌘↵ opens the
issue in Linear, ⌘G goes to the issue's space or makes a worktree for its branch,
⌘⇧C copies the ID, Esc closes.

## Setup

1. **Linear API key.** Create a personal key in Linear (Settings → Security &
   access → Personal API keys) and put it in the macOS keychain. The mods read it
   from there; it never goes into these files:

   ```sh
   security add-generic-password -s linear-api-key -a "$USER" -w 'lin_api_…'
   ```

2. **Get the files.** `~/.config/herdr-app` already exists once Herdr has run,
   so check the repo out into it. This replaces your `keys.json`; back it up
   first if you've changed it.

   ```sh
   cd ~/.config/herdr-app
   cp keys.json keys.json.bak 2>/dev/null
   git init -b main
   git remote add origin <this repo's URL>
   git fetch origin
   git checkout -f -t origin/main
   ```

3. **Pick the layout:** ⌘⇧L → `main-linear`.

4. **Check:** `herdr-app check ~/.config/herdr-app/mods/linear-search`
   (and the same for `linear-issues`, `tabs-linear`, `Sketch` and `spaces-agents`), then `herdr-app status`,
   which should list no errors.

## Things to know

- New worktrees for an issue are made from `~/Sherpas/basecamp`. If your
  checkout lives elsewhere, change `REPO` in `mods/linear-issues/main.js` and
  `mods/linear-search/main.js`, and the path in `mods/linear-issues/detail.js`.
- Mods can't import from each other, so `mods/linear-search/common.js` is a copy
  of `mods/linear-issues/common.js`. Change both together.
- The two Linear mods share a cache in `shared.json` (`linear.mine`,
  `linear.states`), which isn't committed.

## Tests

Node 22.15+ and nothing else:

```sh
npm test              # unit + integration (mods run against a fake Herdr; config checked by the real herdr-app)
npm run test:live     # smoke tests against the running app (opens and closes a pane)
```

Changes start with a failing test; see `tests/AGENTS.md`.
