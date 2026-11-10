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
- Give shapes readable ids (`api`, `db`, `api-db`). Attach arrows with
  `from`/`to` so they follow when the person moves the boxes. Put shapes
  that belong together in a `group`.
- For pictures, copy the file into the `images` folder printed in step 1
  (create it if needed) and set `src` to `images/<name>`.

## 4. Check

```sh
node ~/.config/herdr-app/skills/herdr-sketch/scripts/sketch-board.mjs check
```

It exits 0 with `ok: N shapes`, or lists each problem: a bad type, a missing
field, an arrow pointing at a missing id, a picture that isn't there. Fix
them and check again. Then tell the person it's on the board (⌘⇧E if the
pane isn't open).

## Reading the board

When asked what's on the board, run step 1, read `board`, and describe it from
the shapes: labels (`text`), what the arrows connect (`from` → `to`), the
groups, and the rough layout (left to right, top to bottom by `x`/`y`).
