# herdr-app config

My Herdr app setup for working on many Linear issues at
once, each in its own git worktree with its own agents. It adds:

- **A sidebar** where spaces, their agents and their Linear issues come together.
- **Linear and GitHub panels** beside the terminals.
- **A Sketch whiteboard pane**, one board per worktree, that agents can draw on.
- **Claude and Codex plan usage** in the status bar.

Herdr reads `~/.config/herdr-app` live, so changes show up as soon as the files are saved.

## What it does

**Sidebar (Spaces + agents).** One list instead of Herdr's separate Spaces and Agents lists.
- Each space's agents sit under it, with their status and how long they've been in it.
- Worktrees sit under their main checkout, with branch and ahead/behind.
- Sorted by activity by default: spaces with an agent working or waiting on you first, then by when anything last happened (an agent's turn, or you leaving the space), in bands of the last hour, today, this week and older. Spaces keep their order within a band, so the list doesn't reshuffle on every agent turn, and stale ones sink. The Recent / Manual switch in the header goes back to your own dragged order.
- Spaces whose Linear issues share a top issue group under a header naming it. The header is colored, can be folded, and sums up its agents (working, waiting on you). Spaces nest by issue level on a rail in the family's color.
- A space is matched to its issue by folder, name or git branch.
- A worktree whose issue is closed in Linear shows the state (Done, Released, Canceled…), so it's easy to spot for cleanup.
- A cleanup button in the header (with a count) appears when worktrees look finished: their issue is closed, or nothing happened in them for 5 days (no Linear issue) or a week (an open one). It opens a dialog that checks each with git (uncommitted changes, commits on no remote, submodule commits on no remote) and ticks only the closed, safe ones. Removing does what Herdr's own Remove worktree does: closes the space and its agents, then `git worktree remove`; the branch stays.

**Linear.**
- A panel with your assigned issues, by project or by state. Sub-issues sit under their parent.
- An issue detail view, where you can change the status from the issue's icon.
- Each issue links to its Herdr space, or offers to make a worktree for it.
- ⌘I opens a popup that searches every Linear issue.

**GitHub** (through `gh`), for the active space's repo:
- Open and closed pull requests, and Actions runs.
- A detail view: a PR's reviews, checks, files and comments; a run's jobs, steps and failed log, with re-run and cancel.
- Toasts when CI fails on your PR, it gets a review, or your review is requested.

**Sketch.** A native whiteboard pane:
- Boxes, ellipses, diamonds, arrows that stay attached, pen, text and pictures.
- Picture shapes (K): person, database, server, cloud, browser, phone, document, queue, and a frame to group them; and for notes, a sticky note, speech bubble, idea, question, alert, gear, clock, lock, envelope and folder.
- Copy and paste, groups, and resizing from any side. It follows light and dark themes.
- Each git worktree has its own board. The `herdr-sketch` Agent Skill lets Claude Code or Codex in that worktree draw on it or read it.

**Usage in the status bar.**
- Claude's and Codex's plan usage, right after the agent count: the week, and the 5-hour window when the plan has one.
- Click it for every limit and when each resets.

## What's here

| Path | What it is |
|---|---|
| `layouts/main-linear.json` | The `main` layout plus a right-hand panel (Files, Changes, GitHub, Linear), the sidebar list and the status bar below |
| `mods/spaces-agents/` | The sidebar list (a copy of Herdr's Spaces list with the agents folded in, Linear families, closed-issue tags) |
| `mods/worktree-cleanup/` | The cleanup dialog the sidebar opens |
| `mods/tabs-linear/` | The tab bar for that layout, with buttons that open the panels and Sketch |
| `mods/linear-issues/` | The Linear panel: list, side nav of projects, issue detail |
| `mods/linear-search/` | The ⌘I Linear search popup |
| `mods/github/` | The GitHub panel: pull requests, Actions, detail, alerts |
| `mods/Sketch/` | The whiteboard pane; the board format agents write is in `FORMAT.md` |
| `skills/herdr-sketch/` | Agent Skill: find this worktree's board (`scripts/sketch-board.mjs`), draw, and check it (`… check`) |
| `mods/usage-limits/` | The status bar: Herdr's own (a copy of `workspace-status`) with the usage meters and their popup |
| `keys.json` | Key bindings, including the ones below |
| `tests/`, `package.json` | Unit and integration tests for the mods (`npm test`); how to write them is in `tests/AGENTS.md` |
| `CLAUDE.md` | Points agents at `tests/AGENTS.md` (Herdr rewrites the root `AGENTS.md`) |

Everything else in `~/.config/herdr-app` is written by Herdr or is personal
state (the Sketch boards in `data/`, `shared.json`), so `.gitignore` leaves it out.

## Keys

| Key | Does |
|---|---|
| ⌘I | Search Linear issues (popup) |
| ⌘⇧I | Open or close the Linear panel (a floating window outside `main-linear`) |
| ⌘⇧G | Open or close the GitHub panel (`main-linear`) |
| ⌘⇧E | Open Sketch (a pane to the right; the panel's Sketch button in `main-linear`) |
| ⌘⇧L | Switch layout (pick `main-linear`) |
| ⌘D (in a Sketch board) | Duplicate the selection, instead of splitting the pane |
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

4. **Claude and Codex.** Nothing to set up: the usage meters use Claude Code's
   own login and Codex's session logs, and show once each has been used.

5. **Pick the layout:** ⌘⇧L → `main-linear`.

6. **Agent skill.** Link the Sketch skill where Claude Code and Codex look for skills:

   ```sh
   ln -s ~/.config/herdr-app/skills/herdr-sketch ~/.claude/skills/herdr-sketch
   mkdir -p ~/.agents/skills && ln -s ~/.config/herdr-app/skills/herdr-sketch ~/.agents/skills/herdr-sketch
   ```

   Then "draw the login flow on the board" in any worktree's agent lands on that worktree's board.

7. **Check:** `herdr-app check ~/.config/herdr-app/mods/<mod>` for each mod in
   the table, then `herdr-app status`, which should list no errors.

## Things to know

- **Credentials stay where they are.** The Linear key and Claude Code's login
  go from the keychain to `curl` through a pipe, never in files or process
  arguments; GitHub goes through `gh`. The usage meter never refreshes Claude
  Code's login: an expired one asks you to run `claude`.
- **Where new worktrees come from.** New worktrees for an issue are made from `~/Sherpas/basecamp`. If your
  checkout lives elsewhere, change `REPO` in `mods/linear-issues/main.js` and
  `mods/linear-search/main.js`, and the path in `mods/linear-issues/detail.js`.
- **Two copies of `common.js`.** Mods can't import from each other, so `mods/linear-search/common.js` is a copy
  of `mods/linear-issues/common.js`. Change both together; a test keeps them the same.
- **Caches in `shared.json`.** The mods cache in `shared.json`, which isn't committed:
  - `linear.mine`: your open issues, shared by both Linear mods and the sidebar.
  - `linear.workflowStates`: each team's workflow states.
  - `linear.spaces`: issues that spaces name but that aren't among your open ones (done, canceled, someone else's). The sidebar looks these up so those worktrees still join their family. It retries an issue it couldn't find after 10 minutes and refreshes found ones after an hour.
  - `github.cache`: at most 40 entries. A page under a minute old shows without asking GitHub.
  - `usage.limits`: polled every 5 minutes.
- **The GitHub panel follows the active space.** Its folder's `origin` picks the repo,
  and alerts only cover that repo.
- **New mods need `mod.json` first.** The first time Herdr sees a new mod folder it docks a copy into the shown
  layout, unless the mod has a `mod.json` with `"place": "none"`. Add that file
  before `main.js`. A test checks that `main-linear`'s root holds only the sidebar
  and the work area.

## Tests

Node 22.15+ and nothing else:

```sh
npm test              # unit + integration (mods run against a fake Herdr; config checked by the real herdr-app)
npm run test:live     # smoke tests against the running app (opens and closes a pane)
```

Changes start with a failing test; see `tests/AGENTS.md`.
