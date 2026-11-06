# Sketch board format

The Sketch pane (⌘⇧E) shows `~/.config/herdr-app/data/sketch/board.json`
and reloads it the moment it changes, so an agent draws by editing that file.

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

Optional on every shape: `color` (ink, default `#1e1e1e`), `width` (stroke, default 2),
`dashed: true`, `fontSize` (label size, default 16), `rough: false` (draw this shape with
clean lines even when the hand-drawn look is on; the person toggles that look with H).

Palette used by the toolbar (ink / fill): `#1e1e1e` / `#e9ecef`, `#e03131` / `#ffc9c9`,
`#2f9e44` / `#b2f2bb`, `#1971c2` / `#a5d8ff`, `#f08c00` / `#ffd8a8`, `#9c36b5` / `#eebefa`.

Layout tips: boxes about 180×70 with 60–90 px gaps; give every shape a readable `id`
and attach arrows with `from`/`to` instead of coordinates.
