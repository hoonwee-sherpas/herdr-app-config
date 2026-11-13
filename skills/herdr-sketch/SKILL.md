---
name: herdr-sketch
description: Draw on, read or change the Herdr Sketch whiteboard for the git worktree you're working in. Use when the person asks you to sketch, draw, diagram or whiteboard something "on the board" or "in Sketch", or to read or describe what is on the board they've drawn. Each worktree has its own board, so it finds the one for your folder before anything else.
---

# Herdr Sketch board

Herdr's Sketch pane is a whiteboard backed by one JSON file per git worktree.
The pane reloads the moment that file changes, so you draw by editing it. The
person opens the pane with ⌘⇧E (or the Sketch button in the tab bar).

## 1. Find your board, never guess it

```sh
node ~/.config/herdr-app/skills/herdr-sketch/scripts/sketch-board.mjs
```

Run it from your working folder, or pass a folder. It prints:

```json
{ "root": "/Users/me/.herdr/worktrees/app/prd-123", "branch": "prd-123",
  "board": "/Users/me/.config/herdr-app/data/sketch/boards/app-prd-123-1a2b3c4d/board.json",
  "images": ".../images", "exists": true }
```

`board` is the only file you edit. It's the board the person sees in this
worktree's space, whichever subfolder you're in. Don't touch other worktrees'
boards or `boards.json`. If `root` is null, you're in the home folder, which
shares one board across all such spaces; say so before you draw there.

## 2. Learn the format

Read `~/.config/herdr-app/mods/Sketch/FORMAT.md` before writing. It lists the
shape types, their fields, the palette and layout tips.

## 3. Edit

- Read the file right before you change it. The person may have drawn since
  you last looked, and their shapes stay unless they ask you to remove them.
- If `exists` is false, start from `{ "version": 1, "shapes": [] }`.
- Write the whole file in one go: one write, not several small edits. The pane
  reloads on every change.
- Place new drawings beside what's already there, not on top of it. Find the
  existing shapes' extent and start 120 px to the right or below.
- Use picture shapes for things that have one (the table in FORMAT.md), and
  plain boxes for steps and logic. See "Picture shapes" below.
- Give shapes readable ids (`api`, `db`, `api-db`). Attach arrows with
  `from`/`to` so they follow when the person moves the boxes. Put shapes
  that belong together in a `group`.
- For pictures, copy the file into the `images` folder printed in step 1
  (create it if needed) and set `src` to `images/<name>`.

## Picture shapes

A labeled box says what a thing is in words; a picture says it at a glance.
FORMAT.md lists every type, its usual size and where its label goes.

**Which shape:**
- Who: `person` (a user, admin, operator, customer). One per role, labeled
  with the role.
- Where things run or live: `server` (a backend, API, worker), `database`
  (a DB, cache, registry), `queue` (a queue, event bus, stream), `cloud`
  (the internet, a third party), `browser` (a web app, an admin tool), `phone`
  (a mobile app), `document` (a file, spec, config), `folder` (storage).
- What happens: plain `rect` boxes for steps, `diamond` for decisions,
  `ellipse` for start and end. Don't turn every step into a picture.
- Boundaries: a `frame` around an environment, service or team, named in its
  `text` ("smilegate 환경", "Backend").
- Remarks: a `note` for a thought or caveat, a `bubble` for what someone
  says or asks. Markers beside a step: `question` (undecided), `alert`
  (a risk), `clock` (scheduled), `lock` (auth), `envelope` (sends mail),
  `gear` (a background job), `bulb` (an idea).

Name the real thing in `text` ("Postgres", "Stripe", "운영자"). There are no
logos.

**Layout, so nothing overlaps:**
- Keep pictures near their usual size and shape. A rack stretched to
  300×80 still reads as a server, but a person stretched wide doesn't
  read as a person. Long text goes in the label, broken into short lines with `\n`,
  not into a bigger picture.
- Shapes labeled under them (`person`, `server`, `phone` and the markers)
  need room below: about 22 px per label line plus 10, before the next shape
  or a frame's edge. Their label can be up to 160 px wide, wider than the shape.
- A frame's name takes its top 26 px. Start what it holds at least 40 px
  below its top and 20 px in from its sides. Put frames first in `shapes`,
  with `"dashed": true` and a `color`. Leave 15 px or more between two frames.
- Arrows run between shape centers. If one would cross a frame's name or
  another shape's label, move the shapes; don't bend the arrow around them.
- Put a marker 10 px off its step's top-right corner and in the step's
  `group`, so they move together.
- Give a sticky note `"fill": "#fff3bf"`.

**Redrawing an existing diagram:** keep every id and change `type`, `x`,
`y`, `w`, `h`, so the arrows stay attached and the person's text stays as
they wrote it. Say what you changed.

## 4. Check

```sh
node ~/.config/herdr-app/skills/herdr-sketch/scripts/sketch-board.mjs check
```

It exits 0 with `ok: N shapes`, or lists each problem: a bad type, a missing
field, an arrow pointing at a missing id, a picture that isn't there. Fix
them and check again.

Then look at it, if the pane is open: `herdr-app shot /tmp/board.png` saves
the Herdr window as it's drawn now. Read the picture and look for overlaps:
arrows through a frame's name or a label, labels running into the next shape.
The pane reloads a moment after you write, so take the shot again if it
still shows the old board. Only the part the person has scrolled to is
visible, so don't report on what isn't in the picture.

Tell the person it's on the board (⌘⇧E if the pane isn't open).

## Reading the board

When asked what's on the board, run step 1, read `board`, and describe it from
the shapes: labels (`text`), what the arrows connect (`from` → `to`), the
groups, and the rough layout (left to right, top to bottom by `x`/`y`).
