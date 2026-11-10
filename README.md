# herdr-app config

My Herdr app setup: a layout with Linear and GitHub panels, Linear
issue search, a Sketch whiteboard pane, and the keys for them. Herdr reads `~/.config/herdr-app` live, so
changes show up as soon as the files are saved.

## What's here

| Path | What it is |
|---|---|
| `layouts/main-linear.json` | The `main` layout plus a right-hand panel (Files, Changes, GitHub, Linear), with one Spaces list that shows each space's agents |
| `mods/spaces-agents/` | That sidebar list: a copy of Herdr's Spaces list with each space's agents (status, time in that state) listed under it; replaces the separate Agents list |
| `mods/tabs-linear/` | The tab bar for that layout, with buttons that open the panel |
| `mods/linear-issues/` | The Linear panel: issues assigned to you, with a search, by project (a resizable side nav of projects) or by state, matched to Herdr spaces by branch, plus an issue detail view |
| `mods/linear-search/` | ⌘I popup that searches every Linear issue |
| `mods/github/` | The GitHub panel for the active space's repo (through `gh`): open pull requests (All / Mine / Review requested, search), closed ones 25 a page (All / Mine / Reviewed by me and the search run on GitHub, so they cover every page), Actions runs 30 a page with a resizable side nav of workflows, and a detail view (a PR's reviews, checks, files, description and comments; a run's jobs, steps and failed log, with re-run and cancel). PRs link to their space or offer a worktree, and to their Linear issue. Toasts when CI fails on your PR, it gets a review, or your review is requested |
| `mods/Sketch/` | A whiteboard pane drawn natively: boxes, ellipses, diamonds, arrows that stay attached, pen, text and pictures; ⌘C/⌘X/⌘V copy, cut and paste shapes (between boards too), ⌘D duplicates, ⌘G/⌘⇧G group and ungroup, right-click opens a menu of everything, drag a corner handle or anywhere along an edge of the selection outline to resize (text by its font size), and each tool goes back to select after one use; follows light/dark themes. Each git worktree has its own board under `data/sketch/boards/` (`data/sketch/boards.json` says whose is whose), which agents can edit (format in `mods/Sketch/FORMAT.md`); the home folder keeps the old shared `data/sketch/board.json` |
| `skills/herdr-sketch/` | An Agent Skill for Claude Code and Codex: an agent in any worktree finds that worktree's Sketch board (`scripts/sketch-board.mjs`), draws on it, and checks it (`… check`) |
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
| ⌘⇧G | Open or close the GitHub panel (`main-linear`) |
| ⌘⇧E | Open a Sketch pane to the right (also the Sketch button in the tab bar) |
| ⌘D (in a Sketch board) | Duplicate the selection, instead of splitting the pane (`mod:Sketch` in `keys.json`) |
| ⌘⇧G (in a Sketch board) | Ungroup, instead of toggling the GitHub panel |

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

3. **GitHub CLI.** The GitHub panel uses `gh`, logged in: `gh auth login`
   (it needs the `repo` and `workflow` scopes; re-run and cancel use the latter).

4. **Pick the layout:** ⌘⇧L → `main-linear`.

5. **Agent skill.** Link the Sketch skill where Claude Code and Codex look for skills:

   ```sh
   ln -s ~/.config/herdr-app/skills/herdr-sketch ~/.claude/skills/herdr-sketch
   mkdir -p ~/.agents/skills && ln -s ~/.config/herdr-app/skills/herdr-sketch ~/.agents/skills/herdr-sketch
   ```

   Then "draw the login flow on the board" in any worktree's agent lands on that worktree's board.

6. **Check:** `herdr-app check ~/.config/herdr-app/mods/linear-search`
   (and the same for `linear-issues`, `tabs-linear`, `Sketch`, `spaces-agents` and `github`), then `herdr-app status`,
   which should list no errors.

## Things to know

- New worktrees for an issue are made from `~/Sherpas/basecamp`. If your
  checkout lives elsewhere, change `REPO` in `mods/linear-issues/main.js` and
  `mods/linear-search/main.js`, and the path in `mods/linear-issues/detail.js`.
- Mods can't import from each other, so `mods/linear-search/common.js` is a copy
  of `mods/linear-issues/common.js`. Change both together.
- The two Linear mods share a cache in `shared.json` (`linear.mine`,
  `linear.workflowStates`), which isn't committed.
- The GitHub panel caches in `shared.json` too (`github.cache`: open PRs,
  closed and Actions pages, workflows, your login; at most 40 entries). A page
  under a minute old shows without asking GitHub; the poll and ↻ always ask.
  PR, run and Linear issue details are cached in memory only (they're big).
- The GitHub panel follows the active space: its folder's `origin` picks the
  repo. A space whose folder isn't a GitHub checkout shows a note instead.
  Alerts only cover the repo the panel is showing.
- The first time Herdr sees a new mod folder it docks a copy into the shown
  layout unless the mod has a `mod.json` with `"place": "none"`. Add that file
  before `main.js`; a test checks `main-linear`'s root holds only the sidebar
  and the work area.

## Tests

Node 22.15+ and nothing else:

```sh
npm test              # unit + integration (mods run against a fake Herdr; config checked by the real herdr-app)
npm run test:live     # smoke tests against the running app (opens and closes a pane)
```

Changes start with a failing test; see `tests/AGENTS.md`.
