// The GitHub detail block: the PR or workflow run picked in the list (the
// shared DETAIL_KEY, { repo, kind, id }), fetched with gh. A PR: its state,
// branches, reviews, checks, changes, labels, Linear issues, description and
// comments. A run: its jobs (each opening to its steps), the failed log's tail,
// and re-run or cancel.

import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, shared, theme, run, exec } from "herdr";
import { details, keepDetail, fresh, PRS_TTL } from "./common.js";
import { gh, errorText, DETAIL_KEY, oneCheck, prState, runState, since, took, cleanBody, linearIds,
  linearKeys, openLinear, spacesForBranch, makeWorktree, prIcon, stateIcon, iconButton, COLOR } from "./common.js";

const PR_FIELDS = "number,title,body,author,state,isDraft,headRefName,baseRefName,url,createdAt,updatedAt,mergedAt,closedAt,"
  + "additions,deletions,changedFiles,files,labels,latestReviews,reviewRequests,reviewDecision,statusCheckRollup,comments,isCrossRepository";
const RUN_FIELDS = "databaseId,attempt,conclusion,createdAt,displayTitle,event,headBranch,jobs,name,startedAt,status,updatedAt,url,workflowName";
const LOG_LINES = 60;
const PEEK = 3; // checks and files shown before "Show more", so the description stays near the top
const STATE_WORDS = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };
const REVIEW_WORDS = { APPROVED: ["approved", "#2da44e"], CHANGES_REQUESTED: ["changes requested", "#e5534b"],
  COMMENTED: ["commented", null], DISMISSED: ["dismissed", null] };

// gh's --log-failed lines are "job<TAB>step<TAB>time message", with terminal colors.
export function logTail(text, lines = LOG_LINES) {
  return String(text ?? "").split("\n")
    .map((l) => l.split("\t").pop().replace(/\u001b\[[0-9;]*m/g, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""))
    .filter((l, i, all) => l || i < all.length - 1)
    .slice(-lines);
}

export class Detail {
  constructor(cx, onClose) {
    this.onClose = onClose;
    this.key = null;   // JSON of what's shown
    this.want = null;
    this.item = null;
    this.error = null;
    this.note = null;
    this.loading = false;
    this.openJobs = new Set();
    this.unfolded = new Set(); // "checks" | "files" opened past the first PEEK
    this.log = null;   // the failed log's tail, once asked for
    const check = (cx) => {
      const want = shared(DETAIL_KEY) ?? null;
      const key = want ? JSON.stringify(want) : null;
      if (key && key !== this.key) this.load(want, cx);
    };
    check(cx);
    cx.timer.every(400, check);
  }

  // Shows a PR or run: from the cache at once when it's there; asked from
  // GitHub when it isn't, is over a minute old, is a run still going, or `force` (↻).
  load(want, cx, force = false) {
    const key = JSON.stringify(want);
    const cacheKey = `${want.kind}|${want.repo}|${want.id}`;
    const hit = details.get(cacheKey) ?? null;
    if (key !== this.key) { this.item = hit?.data ?? null; this.openJobs.clear(); this.unfolded.clear(); this.log = null; this.note = null; }
    this.key = key;
    this.want = want;
    this.error = null;
    const going = want.kind === "run" && hit && ["running", "queued"].includes(runState(hit.data));
    if (!force && fresh(hit, PRS_TTL) && !going) { this.loading = false; cx.notify(); return; }
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const item = want.kind === "pr"
          ? await gh(["pr", "view", String(want.id), "-R", want.repo, "--json", PR_FIELDS])
          : await gh(["run", "view", String(want.id), "-R", want.repo, "--json", RUN_FIELDS]);
        keepDetail(cacheKey, item);
        if (this.key === key) this.item = item;
      } catch (e) {
        if (this.key === key) this.error = errorText(e);
      } finally {
        if (this.key === key) { this.loading = false; cx.notify(); }
      }
    });
  }

  reload(cx) { if (this.want) this.load(this.want, cx, true); }

  // A write to GitHub (re-run, cancel), then a fresh look.
  act(args, done, cx) {
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        await gh(args, { raw: true });
        this.note = done;
        this.reload(cx);
      } catch (e) {
        this.error = errorText(e);
      }
      cx.notify();
    });
  }

  showLog(cx) {
    const { repo, id } = this.want;
    this.log = ["Loading the failed log…"];
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const text = await gh(["run", "view", String(id), "-R", repo, "--log-failed"], { raw: true });
        this.log = logTail(text);
        if (!this.log.length) this.log = ["No failed steps with logs."];
      } catch (e) {
        this.log = [`Couldn't load the log: ${errorText(e)}`];
      }
      cx.notify();
    });
  }

  // ---- pieces

  field(t, label, value) {
    return h_flex().min_h(24).gap(10).items_center()
      .child(div().w(76).flex_none().text_size(12).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().flex_wrap().child(value));
  }

  section(t, title, body) {
    return v_flex().gap(6)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title))
      .child(body);
  }

  frame(t) {
    return v_flex().id("github-detail").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13);
  }

  header(t, icon, label, buttons) {
    return h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(icon)
      .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(label))
      .child(div().flex_1())
      .when(this.loading, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("loading…")))
      .children(buttons)
      .child(iconButton(t, "ghd-web", "Open ↗", () => exec("open", [this.item.url]).catch(() => {})))
      .child(iconButton(t, "ghd-reload", "↻", (cx) => this.reload(cx)))
      .child(iconButton(t, "ghd-close", "✕", () => this.onClose()));
  }

  // A list folded to its first PEEK rows, with a row that shows the rest or folds it again.
  folded(t, id, rows) {
    const open = this.unfolded.has(id);
    return v_flex().id(`ghd-${id}`).gap(1)
      .children(open ? rows : rows.slice(0, PEEK))
      .when(rows.length > PEEK, (el) => el.child(div().id(`ghd-${id}-more`).h(22).px(6).flex().items_center().rounded(5)
        .text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { open ? this.unfolded.delete(id) : this.unfolded.add(id); cx.notify(); })
        .child(open ? "Show less" : `Show ${rows.length - PEEK} more`)));
  }

  // ---- a pull request

  renderPr(t, p) {
    const state = prState(p);
    const matched = spacesForBranch(p.headRefName, spaces());
    const active = spaces().find((s) => s.active);
    const linear = linearIds(`${p.title} ${p.headRefName}`, linearKeys());
    const checks = p.statusCheckRollup ?? [];
    const failing = checks.filter((c) => oneCheck(c) === "failure").length;
    const comments = [...(p.comments ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const buttons = [];
    if (matched.length) buttons.push(iconButton(t, "ghd-space", "Go to space", () => run("space.select", { id: matched[0].id })));
    else if (!p.isCrossRepository && (state === "open" || state === "draft")) {
      buttons.push(iconButton(t, "ghd-worktree", "+ Worktree", () => makeWorktree(active, p.headRefName)));
    }
    const reviewed = new Set((p.latestReviews ?? []).map((r) => r.author?.login));
    const reviewers = [
      ...(p.latestReviews ?? []).map((r) => [r.author?.login, ...(REVIEW_WORDS[r.state] ?? [r.state.toLowerCase(), null])]),
      ...(p.reviewRequests ?? []).filter((r) => !reviewed.has(r.login ?? r.name)).map((r) => [r.login ?? r.name, "pending", null]),
    ];
    return this.frame(t)
      .child(this.header(t, prIcon(state), `#${p.number}`, buttons))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("ghd-body").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14).gap(16)
        .child(div().text_size(17).font_semibold().child(p.title))
        .child(v_flex().gap(2)
          .child(this.field(t, "State", h_flex().gap(6).items_center().child(prIcon(state, 13))
            .child(div().text_color(COLOR[state]).child(STATE_WORDS[state]))
            .child(div().text_size(12).text_color(t.muted).child(`by ${p.author?.login ?? "?"} · opened ${since(p.createdAt)}${p.mergedAt ? ` · merged ${since(p.mergedAt)}` : ""}`))))
          .child(this.field(t, "Branch", div().text_size(12).text_color(t.muted).child(`${p.headRefName} → ${p.baseRefName}`)))
          .when(reviewers.length > 0, (el) => el.child(this.field(t, "Reviews", h_flex().gap(10).flex_wrap()
            .children(reviewers.map(([who, word, color]) => h_flex().gap(4).items_center()
              .child(div().child(who ?? "?"))
              .child(div().text_size(11).text_color(color ?? t.dim).child(word)))))))
          .child(this.field(t, "Changes", h_flex().gap(6).items_center().text_size(12)
            .child(div().text_color(COLOR.success).child(`+${p.additions}`))
            .child(div().text_color(COLOR.failure).child(`−${p.deletions}`))
            .child(div().text_color(t.muted).child(`· ${p.changedFiles} files`))))
          .when((p.labels ?? []).length > 0, (el) => el.child(this.field(t, "Labels", h_flex().gap(6).flex_wrap()
            .children(p.labels.map((l) => h_flex().gap(4).items_center().px(6).py(1).rounded(10).border_1().border_color(t.border)
              .child(div().size(7).rounded(4).bg(`#${l.color}`)).child(div().text_size(11).child(l.name)))))))
          .when(linear.length > 0, (el) => el.child(this.field(t, "Linear", h_flex().gap(6).flex_wrap()
            .children(linear.map((id) => div().id(`ghd-linear-${id}`).px(6).py(1).rounded(5).border_1().border_color(t.border)
              .text_size(11).cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); openLinear(id); })
              .child(id)))))))
        .when(checks.length > 0, (el) => el.child(this.section(t, `Checks ${checks.length}${failing ? ` · ${failing} failing` : ""}`,
          this.folded(t, "checks", [...checks].sort((a, b) => (oneCheck(a) === "failure" ? 0 : 1) - (oneCheck(b) === "failure" ? 0 : 1))
            .map((c, n) => h_flex().id(`ghd-check-${n}`).h(24).px(6).gap(8).items_center().rounded(5)
              .when(Boolean(c.detailsUrl ?? c.targetUrl), (row) => row.cursor_pointer().hover((s) => s.bg(t.hover))
                .on_click(() => exec("open", [c.detailsUrl ?? c.targetUrl]).catch(() => {})))
              .child(stateIcon(oneCheck(c) ?? "queued"))
              .child(div().flex_1().min_w(0).truncate().child(c.name ?? c.context ?? "check"))
              .child(div().flex_none().max_w(180).truncate().text_size(11).text_color(t.dim).child(c.workflowName ?? "")))))))
        .when((p.files ?? []).length > 0, (el) => el.child(this.section(t, `Files ${p.changedFiles}`,
          this.folded(t, "files", p.files.map((f, n) => h_flex().id(`ghd-file-${n}`).h(22).px(6).gap(8).items_center().text_size(12)
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))
            .child(div().flex_none().text_size(11).text_color(COLOR.success).child(`+${f.additions}`))
            .child(div().flex_none().text_size(11).text_color(COLOR.failure).child(`−${f.deletions}`)))))))
        .child(this.section(t, "Description", p.body?.trim()
          ? TextView.markdown(`ghd-desc-${p.number}`, cleanBody(p.body)).selectable()
          : div().text_color(t.dim).child("No description.")))
        .when(comments.length > 0, (el) => el.child(this.section(t, `Comments ${comments.length}`,
          v_flex().gap(10).children(comments.map((c, n) => v_flex().gap(4).p(10).rounded(8).border_1().border_color(t.border)
            .child(div().text_size(11).text_color(t.dim).child(`${c.author?.login ?? "?"} · ${since(c.createdAt)}`))
            .child(TextView.markdown(`ghd-c-${p.number}-${n}`, cleanBody(c.body)).selectable())))))));
  }

  // ---- a workflow run

  renderRun(t, r) {
    const state = runState(r);
    const { repo, id } = this.want;
    const buttons = [];
    if (state === "failure" || state === "cancelled") {
      buttons.push(iconButton(t, "ghd-rerun", "Re-run failed", (cx) => this.act(["run", "rerun", String(id), "--failed", "-R", repo], "Re-run requested.", cx)));
    }
    if (state === "running" || state === "queued") {
      buttons.push(iconButton(t, "ghd-cancel", "Cancel", (cx) => this.act(["run", "cancel", String(id), "-R", repo], "Cancel requested.", cx)));
    }
    return this.frame(t)
      .child(this.header(t, stateIcon(state, 14), r.workflowName, buttons))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(12).text_color(t.ansi1).child(this.error)))
      .when(Boolean(this.note), (el) => el.child(div().px(14).py(6).text_size(12).text_color(t.muted).child(this.note)))
      .child(v_flex().id("ghd-body").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14).gap(16)
        .child(div().text_size(17).font_semibold().child(r.displayTitle))
        .child(v_flex().gap(2)
          .child(this.field(t, "Status", h_flex().gap(6).items_center().child(stateIcon(state))
            .child(div().text_color(COLOR[state]).child(state))))
          .child(this.field(t, "Branch", div().text_size(12).text_color(t.muted).child(r.headBranch ?? "—")))
          .child(this.field(t, "Trigger", div().text_size(12).text_color(t.muted).child(`${r.event} · ${since(r.createdAt)}`)))
          .when(Boolean(took(r.startedAt, r.updatedAt)) && state !== "running", (el) => el.child(this.field(t, "Took",
            div().text_size(12).text_color(t.muted).child(took(r.startedAt, r.updatedAt)))))
          .when(r.attempt > 1, (el) => el.child(this.field(t, "Attempt", div().text_size(12).text_color(t.muted).child(String(r.attempt))))))
        .child(this.section(t, `Jobs ${(r.jobs ?? []).length}`, v_flex().gap(1).children((r.jobs ?? []).flatMap((j) => {
          const open = this.openJobs.has(j.databaseId);
          const row = h_flex().id(`ghd-job-${j.databaseId}`).h(26).px(6).gap(8).items_center().rounded(5).cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { open ? this.openJobs.delete(j.databaseId) : this.openJobs.add(j.databaseId); cx.notify(); })
            .child(stateIcon(runState(j)))
            .child(div().flex_1().min_w(0).truncate().child(j.name))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(took(j.startedAt, j.completedAt)));
          if (!open) return [row];
          return [row, ...(j.steps ?? []).map((s) => h_flex().h(22).pl(28).pr(6).gap(8).items_center().text_size(12)
            .child(stateIcon(runState(s), 11))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.name)))];
        }))))
        .when(state === "failure", (el) => el.child(this.section(t, "Failed log",
          this.log
            ? v_flex().id("ghd-log-text").p(10).rounded(8).bg(t.surface ?? t.background).border_1().border_color(t.border)
              .font_family("Menlo").text_size(11).text_color(t.foreground)
              .children(this.log.map((l) => div().child(l || " ")))
            : div().id("ghd-log").w_full().px(8).py(4).rounded(6).border_1().border_color(t.border).text_size(12)
              .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => this.showLog(cx))
              .child(`Show the last ${LOG_LINES} lines of the failed steps' logs`)))));
  }

  render() {
    const t = theme();
    const it = this.item;
    if (!it) {
      const note = this.error ? `Couldn't load: ${this.error}` : this.want ? "Loading…" : "Pick a pull request or a run in the list.";
      return this.frame(t).child(h_flex().px(14).py(10).gap(8).items_center()
        .child(div().flex_1().text_color(this.error ? t.ansi1 : t.dim).child(note))
        .child(iconButton(t, "ghd-close", "✕", () => this.onClose())));
    }
    return this.want.kind === "pr" ? this.renderPr(t, it) : this.renderRun(t, it);
  }
}
