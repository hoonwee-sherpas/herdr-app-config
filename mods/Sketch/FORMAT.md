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
| `person`, `database`, `server`, `cloud`, `browser`, `phone`, `document`, `queue`, `note`, `bubble`, `bulb`, `question`, `alert`, `gear`, `clock`, `lock`, `envelope`, `folder` | picture shapes: `x`, `y`, `w`, `h`, optional `text`, `fill`, like `rect` (see below) |
| `frame` | `x`, `y`, `w`, `h`, optional `text` (its name, top left), `fill`: a boundary around other shapes |

Picture shapes draw a simple picture of the thing, scaled to their box; arrows attach
to them like boxes. Use them instead of a labeled box when the thing has one:

| type | for | usual size | label |
|---|---|---|---|
| `person` | a user, admin, team, customer | 64×84 | under it |
| `database` | a database, cache, any data store (a cylinder) | 110×120 | inside |
| `server` | a backend, API, worker host (a rack) | 96×110 | under it |
| `cloud` | the internet, a third party, an external service | 190×115 | inside |
| `browser` | a web app or frontend (a window) | 230×150 | inside |
| `phone` | a mobile app | 76×136 | under it |
| `document` | a file, spec, report, config (folded corner) | 110×140 | inside |
| `queue` | a message queue, event bus, stream (a sideways cylinder) | 210×70 | inside |
| `frame` | a boundary: "Backend", "VPC", "Team A" | any | its name, top left |
| `note` | a sticky note: a thought, a to-do (yellow unless `fill` says otherwise) | 150×130 | inside |
| `bubble` | what someone says or thinks (tail at the bottom left) | 180×110 | inside |
| `bulb` | an idea | 60×84 | under it |
| `question` | an open question (a ? in a circle) | 56×56 | under it |
| `alert` | a risk or warning (a ! in a triangle) | 64×56 | under it |
| `gear` | a job, a process, settings | 64×64 | under it |
| `clock` | a schedule, cron, a timeout | 64×64 | under it |
| `lock` | auth, permissions, a secret | 60×76 | under it |
| `envelope` | email, a notification, a message | 96×64 | under it |
| `folder` | a folder, file storage, a bucket | 140×105 | inside |

The small markers (`bulb`, `question`, `alert`, `gear`, `clock`, `lock`, `envelope`)
work beside a box or on an arrow's path: a `clock` next to a job says it's scheduled,
a `question` next to a step says it's undecided. A `note` should say "fill": "#fff3bf"
to look like the toolbar's.

Name the actual thing in `text` ("Postgres", "Admin", "Stripe"); there are no
vendor logos. Put frames first in `shapes`, so they're drawn behind what they
hold, and give them `"dashed": true` as the toolbar does. A frame is picked by
its border or name, so pressing inside it still reaches the shapes and the canvas.

Optional on every shape: `color` (ink, default `#1e1e1e`), `width` (stroke, default 2),
`dashed: true`, `fontSize` (label size, default 16), `rough: false` (draw this shape with
clean lines even when the hand-drawn look is on; the person toggles that look with H).
`group`: any string shared by shapes that belong together; pressing one selects them all
(the person groups with ⌘G and ungroups with ⌘⇧G). One level only: a shape is in one group at most.

Palette used by the toolbar (ink / fill): `#1e1e1e` / `#e9ecef`, `#e03131` / `#ffc9c9`,
`#2f9e44` / `#b2f2bb`, `#1971c2` / `#a5d8ff`, `#f08c00` / `#ffd8a8`, `#9c36b5` / `#eebefa`.

Layout tips: boxes about 180×70 with 60–90 px gaps (under a shape labeled under it, leave about 22 px per label line plus 10); give every shape a readable `id`
and attach arrows with `from`/`to` instead of coordinates.
