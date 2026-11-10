// A worktree's board folder name. No host imports, so the agent skill's
// script (skills/herdr-sketch/scripts/sketch-board.mjs) computes the same one.

/** A worktree's board folder name: its last two folders (and machine), readable, plus a hash of the whole path. */
export function boardSlug(root, machine) {
  const safe = (x) => x.replace(/[^\w.-]+/g, "_");
  let h = 5381;
  for (const ch of `${machine ?? ""}:${root}`) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0;
  const parts = String(root).split("/").filter(Boolean).slice(-2).map(safe);
  return [...(machine ? [safe(machine)] : []), ...parts, h.toString(16).padStart(8, "0")].join("-");
}
