# herdr-app config

Herdr rewrites `AGENTS.md` in this folder on every start. It explains the app
and how mods work, so read it, but don't edit it. This repo's own rules are in
`tests/AGENTS.md`:

@tests/AGENTS.md

**IMPORTANT: test first.** Every change to a mod starts with a failing test in
`tests/`. `npm test` and `herdr-app check mods/<name>` must pass before you're
done.
