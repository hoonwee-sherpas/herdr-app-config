# Sketch board format

Each git worktree has its own board. The Sketch pane (⌘⇧E) shows the one for
its space's worktree and reloads it the moment it changes, so an agent draws by
editing that file. To find yours, run
`node ~/.config/herdr-app/skills/herdr-sketch/scripts/sketch-board.mjs` in the worktree
(it prints the board's path; `… check` validates the board after you edit it), or look up
the worktree's root (`git rev-parse --show-toplevel`) in `~/.config/herdr-app/data/sketch/boards.json`:

```json
{ "/Users/me/code/app-wt": { "board": "data/sketch/boards/code-app-wt-1a2b3c4d/board.json", "branch": "feat/login", "machine": null } }
```

`board` is relative to `~/.config/herdr-app`; on another machine the key is
`<machine>:<root>`. A worktree gets an entry once a Sketch pane has shown it or the script has run there.
The home folder (and anything outside a space) keeps the old shared board,
`data/sketch/board.json`.

```json
{ "version": 1, "shapes": [ { "id": "api", "type": "rect", ... }, ... ] }
```

Later shapes are drawn on top. Coordinates are world pixels; y grows downward.

| type | fields |
|---|---|
| `rect`, `ellipse`, `diamond` | `x`, `y`, `w`, `h`, optional `text` (centered label, `\n` for new lines), `fill` |
| `text` | `x`, `y` (top left), `text`, optional `fontSize` (default 20) |
| `arrow`, `line` | `from` / `to`: ids of shapes to attach to (the ends follow those shapes), or `points`: `[[x, y], ...]`; optional `text` (label at the middle) |
| `pen` | `points`: `[[x, y], ...]` (freehand) |
| `image` | `x`, `y`, `w`, `h`, `src`: a picture's path relative to the board's folder (put it in that folder's `images/`, e.g. `images/flow.png`) |

Optional on every shape: `color` (ink, default `#1e1e1e`), `width` (stroke, default 2),
`dashed: true`, `fontSize` (label size, default 16), `rough: false` (draw this shape with
clean lines even when the hand-drawn look is on; the person toggles that look with H).
`group`: any string shared by shapes that belong together; pressing one selects them all
(the person groups with ⌘G and ungroups with ⌘⇧G). One level only: a shape is in one group at most.

Palette used by the toolbar (ink / fill): `#1e1e1e` / `#e9ecef`, `#e03131` / `#ffc9c9`,
`#2f9e44` / `#b2f2bb`, `#1971c2` / `#a5d8ff`, `#f08c00` / `#ffd8a8`, `#9c36b5` / `#eebefa`.

Layout tips: boxes about 180×70 with 60–90 px gaps; give every shape a readable `id`
and attach arrows with `from`/`to` instead of coordinates.
