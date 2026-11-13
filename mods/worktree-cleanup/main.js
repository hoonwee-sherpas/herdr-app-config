// Clean up worktrees: a dialog listing worktree spaces that look finished
// (their Linear issue is closed, or nothing happened in them for 5 days
// without a Linear issue, a week with an open one),
// opened from the Spaces list with props { candidates: [{ id, name, folder,
// machine, reason: "closed" | "quiet", last, issue }] }.
//
// Each is checked with git first: uncommitted changes, commits on no remote,
// submodule commits on no remote. Only finished and safe ones start ticked.
// Removing one does what Herdr's own "Remove worktree" does: closes the space
// (its terminals and agents), then `git worktree remove`; the branch stays.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, exec } from "herdr";

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The submodule repos git keeps for a checkout (nested ones too): { name, dir,
// pinned }. Copied from the shipped worktree mod (mods can't import each other).
async function modules(gitDir, config, on, out = [], parent = "") {
  const r = await git(gitDir, ["config", ...config, "--get-regexp", "^submodule\\..*\\.path$"], on);
  for (const line of r.ok ? r.out.split("\n").filter(Boolean) : []) {
    const name = line.slice("submodule.".length, line.indexOf(".path "));
    const dir = `${gitDir}/modules/${parent}${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue;
    const pinned = await git(gitDir, ["--git-dir", dir, "rev-parse", "HEAD"], on);
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
  }
  return out;
}

/** What removing this worktree would lose: { top, main, dirty, unpushed, detached, mods, modsUnpushed } or { error }. */
export async function inspect(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return { error: "Not a git checkout any more." };
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  if (main === top.out) return { error: "This is the repository's main checkout, not a worktree." };
  const status = await git(top.out, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
  if (!status.ok) return { error: status.err || "git status failed." };
  const ahead = await git(top.out, ["rev-list", "--count", "HEAD", "--not", "--remotes"], on);
  const branch = await git(top.out, ["symbolic-ref", "-q", "--short", "HEAD"], on);
  const gitDir = await git(top.out, ["rev-parse", "--absolute-git-dir"], on);
  const mods = gitDir.ok ? await modules(gitDir.out, ["--file", `${top.out}/.gitmodules`], on) : [];
  const modsUnpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (local.ok && local.out) modsUnpushed.push(m.name);
  }
  return { top: top.out, main, dirty: status.out !== "", unpushed: Number(ahead.out) || 0, detached: !branch.ok, mods: mods.length, modsUnpushed };
}

/** Nothing would be lost. */
export const safe = (c) => Boolean(c && !c.error && !c.dirty && !c.unpushed && !c.modsUnpushed.length);

export const ago = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default class Cleanup extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.list = props()?.candidates ?? [];
    this.check = {}; // id -> inspect() result
    this.picked = new Set();
    this.result = {}; // id -> "removing" | "removed" | error text
    this.busy = false;
    cx.spawn(async (cx) => {
      await Promise.all(this.list.map(async (c) => {
        try { this.check[c.id] = await inspect(c.folder, c.machine ?? undefined); } catch (e) { this.check[c.id] = { error: String(e?.message ?? e) }; }
        if (c.reason === "closed" && safe(this.check[c.id])) this.picked.add(c.id);
        cx.notify();
      }));
    });
  }

  close() { closeOverlay(props()?.overlay); }

  // One at a time, each checked again first: anything new at risk since the
  // list was drawn leaves that one in place.
  remove(cx) {
    if (this.busy || !this.picked.size) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      for (const c of this.list.filter((c) => this.picked.has(c.id))) {
        this.result[c.id] = "removing";
        cx.notify();
        const was = this.check[c.id];
        const now = await inspect(c.folder, c.machine ?? undefined);
        if (now.error) { this.result[c.id] = now.error; continue; }
        const worse = (now.dirty && !was.dirty) || now.unpushed > was.unpushed || now.modsUnpushed.some((m) => !was.modsUnpushed.includes(m));
        if (worse) { this.check[c.id] = now; this.result[c.id] = "Changed since this opened: left in place."; continue; }
        run("space.close", { id: c.id, confirmed: true }); // terminals first: a shell in the folder keeps it busy on Windows
        const force = now.dirty || now.mods > 0;
        const r = await git(now.main, ["worktree", "remove", ...(force ? ["--force"] : []), now.top], c.machine ?? undefined, 600_000);
        this.result[c.id] = r.ok ? "removed" : r.err || "git worktree remove failed.";
        this.picked.delete(c.id);
        cx.notify();
      }
      this.busy = false;
      this.done = true;
      cx.notify();
    });
  }

  toggle(id, cx) {
    if (this.busy || this.result[id] === "removed") return;
    this.picked.has(id) ? this.picked.delete(id) : this.picked.add(id);
    cx.notify();
  }

  row(c, t) {
    const chk = this.check[c.id], res = this.result[c.id];
    const on = this.picked.has(c.id);
    const removed = res === "removed";
    const s = c.issue?.state;
    const tag = c.reason === "closed" && s
      ? div().flex_none().px(5).h(17).rounded(5).flex().items_center().text_size(10.5).font_semibold()
        .bg((s.color ?? t.dim) + "22").text_color(s.color ?? t.dim).child(s.name ?? s.type)
      : div().flex_none().text_size(11).text_color(t.dim).child(c.last ? `quiet ${ago(Date.now() - c.last)}` : "no activity seen");
    const note = res && !removed && res !== "removing" ? [res, t.blocked]
      : !chk ? ["checking…", t.dim]
      : chk.error ? [chk.error, t.blocked]
      : chk.dirty ? ["Uncommitted changes: they'd be lost", t.blocked]
      : chk.unpushed ? [`${chk.unpushed} commit${chk.unpushed > 1 ? "s" : ""} on no remote: ${chk.detached ? "no branch holds them, they'd be lost" : "they'd stay on the branch only"}`, chk.detached ? t.blocked : (t.working ?? t.blocked)]
      : chk.modsUnpushed.length ? [`Submodule ${chk.modsUnpushed.join(", ")} has commits on no remote: they'd be lost`, t.blocked]
      : ["Clean: nothing to lose", t.dim];
    const sub = [c.issue ? `${c.issue.identifier} ${c.issue.title ?? ""}` : "No Linear issue", c.last && `last activity ${ago(Date.now() - c.last)} ago`].filter(Boolean).join(" · ");
    return h_flex().id(`clean-${c.id}`).flex_none().gap(10).px(10).py(7).rounded(7).items_center()
      .when(!removed && !this.busy, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)))
      .when(removed, (el) => el.opacity(0.5))
      .on_click((_e, cx) => this.toggle(c.id, cx))
      .child(removed
        ? svg("mods/workspace-chrome/circle-check.svg").size(16).flex_none().text_color(t.done ?? t.accent)
        : res === "removing"
          ? svg("mods/workspace-chrome/spinner.svg").size(16).flex_none().text_color(t.dim).spin(900)
          : h_flex().id(`pick-${c.id}`).size(16).flex_none().rounded(4).border(1.5).items_center().justify_center()
            .border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent))
            .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground ?? "#ffffff"))))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().min_w(0).truncate().text_color(t.foreground).child(c.name))
          .child(tag))
        .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)))
        .child(div().text_size(11.5).text_color(note[1]).child(removed ? "Removed" : note[0])));
  }

  render() {
    const t = theme();
    const n = this.picked.size;
    const button = (id, label, bg, fg, onClick, off = false) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(id === "cancel" ? t.input : bg).bg(bg).text_color(fg)
        .when(off, (el) => el.opacity(0.45)).when(!off, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))).on_click(onClick).child(label);
    const removed = Object.values(this.result).filter((r) => r === "removed").length;
    return v_flex()
      .id("cleanup")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) this.close();
        else if (e.key === "enter") this.done ? this.close() : this.remove(cx);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(10).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Clean up worktrees"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child("Their Linear issue is closed, or nothing happened in them for days (5 without a Linear issue, 7 with an open one). Only closed, safe ones start ticked. Removing one closes its space and agents and deletes the worktree folder; the branch stays."))
      .child(v_flex().id("cleanup-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar()
        .when(!this.list.length, (el) => el.child(div().p(10).text_color(t.dim).child("Nothing to clean up.")))
        .children(this.list.map((c) => this.row(c, t))))
      .child(h_flex().justify_end().gap(8).text_size(12).items_center()
        .when(this.done, (el) => el.child(div().flex_1().text_color(t.dim).child(`Removed ${removed} of ${Object.keys(this.result).length}`)))
        .child(button("cancel", this.done ? "Close" : "Cancel", t.raised, t.foreground, () => !this.busy && this.close()))
        .when(!this.done, (el) => el.child(button("remove", this.busy ? "Removing…" : `Remove ${n}`, t.blocked, "#ffffff", (_e, cx) => this.remove(cx), this.busy || !n))));
  }
}
