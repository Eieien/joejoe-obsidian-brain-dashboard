// Weekly review: what got done, what slipped, habits, notes and projects for one week,
// plus a checklist and reflections, saved per week and written out as a review note.

import { debounce, moment, normalizePath, Notice, setIcon } from "obsidian";
import { ensureFolder } from "../data/daily";
import { orphans } from "../data/graph";
import { isOpen } from "../data/queries";
import { addDays, periodStart } from "../data/trackerTypes";
import type { Task } from "../types";
import { card, emptyState, renderTask, whenLoaded, type DashboardContext } from "./components";
import { renderHabitWeek } from "./habits";
import { inboxItems } from "./inboxTab";
import { progressBar } from "./homeTab";

export interface ReviewState {
	/** Week start (YYYY-MM-DD); empty = this week. */
	week: string;
}

export function renderReviewTab(el: HTMLElement, ctx: DashboardContext, st: ReviewState, update: (p: Partial<ReviewState>) => void): void {
	const s = ctx.plugin.settings;
	const idx = ctx.plugin.index;
	const start = st.week || periodStart(ctx.today, "week", s.weekStartsMonday);
	const end = addDays(start, 6);
	const isThisWeek = ctx.today >= start && ctx.today <= end;
	const cutoff = isThisWeek ? ctx.today : end;

	// ---- Header ----
	const head = el.createDiv({ cls: "sbd-review-head" });
	const nav = head.createDiv({ cls: "sbd-cal-nav" });
	const prev = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Previous week" } });
	setIcon(prev, "chevron-left");
	prev.onclick = () => update({ week: addDays(start, -7) });
	const next = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Next week" } });
	setIcon(next, "chevron-right");
	next.onclick = () => update({ week: addDays(start, 7) });
	if (!isThisWeek) {
		const now = nav.createEl("button", { text: "this week" });
		now.onclick = () => update({ week: "" });
	}
	const title = head.createDiv({ cls: "sbd-review-title" });
	title.createDiv({ cls: "sbd-cal-title", text: `week ${moment(start).isoWeek()} · ${moment(start).format("MMM D")} – ${moment(end).format("MMM D")}` });
	title.createDiv({ cls: "sbd-muted", text: isThisWeek ? "this week so far" : moment(start).fromNow() });

	// ---- Data for the week ----
	const tasks = idx.tasks;
	const done = tasks.filter((t) => t.status === "done" && t.doneDate && t.doneDate >= start && t.doneDate <= end)
		.sort((a, b) => (a.doneDate ?? "").localeCompare(b.doneDate ?? ""));
	const slipped = tasks.filter((t) => isOpen(t) && t.due && t.due >= start && t.due <= end && t.due < cutoff);
	const notes = [...idx.notes.values()];
	const created = notes.filter((n) => n.kind !== "daily" && moment(n.ctime).format("YYYY-MM-DD") >= start && moment(n.ctime).format("YYYY-MM-DD") <= end)
		.sort((a, b) => a.ctime - b.ctime);
	const inbox = inboxItems(ctx).length;
	const lonely = orphans(notes, ctx.app.metadataCache.resolvedLinks).length;

	const tiles = el.createDiv({ cls: "sbd-stats" });
	const tile = (value: string | number, label: string, cls = "") => {
		const t = tiles.createDiv({ cls: `sbd-stat ${cls}` });
		t.createDiv({ cls: "sbd-stat-value", text: String(value) });
		t.createDiv({ cls: "sbd-stat-label", text: label });
	};
	tile(done.length, "tasks done", "is-done");
	tile(slipped.length, "slipped", slipped.length ? "is-overdue" : "");
	tile(created.length, "notes written");
	tile(inbox, "in inbox", inbox ? "is-today" : "");
	tile(lonely, "orphan notes");

	const grid = el.createDiv({ cls: "sbd-review-grid" });
	const main = grid.createDiv({ cls: "sbd-hub-main" });
	const side = grid.createDiv({ cls: "sbd-hub-side" });

	// ---- Done ----
	const doneBody = card(main, "Done this week", { icon: "check-circle-2", count: done.length });
	if (!done.length) emptyState(doneBody, "Nothing ticked off this week yet.");
	let lastDay = "";
	for (const t of done.slice(0, 40)) {
		if (t.doneDate !== lastDay) {
			lastDay = t.doneDate!;
			doneBody.createDiv({ cls: "sbd-day-group", text: moment(lastDay).format("dddd, MMM D").toLowerCase() });
		}
		renderTask(doneBody, t, ctx);
	}

	// ---- Slipped ----
	const slipBody = card(main, "Slipped — reschedule or drop", { icon: "alert-triangle", count: slipped.length });
	if (!slipped.length) emptyState(slipBody, "Nothing slipped. 🎯");
	else {
		const bulk = slipBody.createEl("button", { cls: "sbd-ghost-btn" });
		setIcon(bulk.createSpan({ cls: "sbd-icon" }), "calendar-plus");
		bulk.createSpan({ text: "move all to tomorrow" });
		bulk.onclick = async () => {
			bulk.disabled = true;
			const tomorrow = moment(ctx.today).add(1, "day").format("YYYY-MM-DD");
			for (const t of slipped) await ctx.plugin.writer.setDue(t, tomorrow);
		};
	}
	for (const t of slipped) renderTask(slipBody, t, ctx);

	// ---- Projects ----
	const projBody = card(main, "Projects", { icon: "folder-kanban" });
	const projects = [...idx.projects.values()].filter((p) => p.kind !== "course" || p.active !== false).map((p) => {
		const pt = idx.tasksForProject(p.key).filter((t) => t.status !== "cancelled");
		const doneWeek = pt.filter((t) => t.status === "done" && t.doneDate && t.doneDate >= start && t.doneDate <= end).length;
		const doneAll = pt.filter((t) => t.status === "done").length;
		return { p, doneWeek, progress: pt.length ? doneAll / pt.length : 0, open: pt.filter(isOpen).length };
	}).filter((x) => x.doneWeek || x.open).sort((a, b) => b.doneWeek - a.doneWeek);
	if (!projects.length) emptyState(projBody, "No active projects.");
	for (const x of projects.slice(0, 10)) {
		const row = projBody.createDiv({ cls: "sbd-proj-row" });
		row.onclick = () => ctx.openProject(x.p.key);
		const top = row.createDiv({ cls: "sbd-proj-row-top" });
		top.createSpan({ cls: "sbd-proj-name", text: x.p.name });
		top.createSpan({ cls: "sbd-muted", text: `${x.doneWeek ? `+${x.doneWeek} this week · ` : ""}${x.open} open` });
		progressBar(row, x.progress);
	}

	// ---- Habits ----
	const habitBody = card(side, "Habits", { icon: "check-square" });
	whenLoaded(habitBody, ctx.plugin.trackers.habitEntries(), (entries) => renderHabitWeek(habitBody, ctx, entries, start));

	// ---- Notes written ----
	const notesBody = card(side, "Notes written", { icon: "file-plus", count: created.length });
	if (!created.length) emptyState(notesBody, "No new notes this week.");
	for (const n of created.slice(0, 15)) {
		const row = notesBody.createDiv({ cls: "sbd-note-row" });
		setIcon(row.createSpan({ cls: "sbd-icon" }), "file-text");
		row.createSpan({ cls: "sbd-note-name", text: n.name });
		row.createSpan({ cls: "sbd-muted", text: moment(n.ctime).format("ddd") });
		row.onclick = () => ctx.openPath(n.path);
	}

	// ---- Checklist + reflections (saved per week) ----
	const review = (s.reviews[start] ??= { checked: [], notes: "" });
	const save = debounce(() => void ctx.plugin.persist(), 600, true);
	const checkBody = card(side, "Checklist", { icon: "list-checks" });
	for (const item of s.reviewChecklist) {
		const row = checkBody.createEl("label", { cls: "sbd-review-check" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = review.checked.includes(item);
		row.createSpan({ text: item });
		cb.onchange = () => {
			review.checked = cb.checked ? [...review.checked, item] : review.checked.filter((x) => x !== item);
			save();
		};
	}
	const reflect = card(side, "Reflections", { icon: "pen-line" });
	const ta = reflect.createEl("textarea", { cls: "sbd-desc-input", attr: { rows: "6", placeholder: "What went well? What got in the way? What matters most next week?", "data-sbd-focus": `review-${start}` } });
	ta.value = review.notes;
	ta.oninput = () => { review.notes = ta.value; save(); };

	const write = reflect.createEl("button", { cls: "mod-cta sbd-review-write" });
	setIcon(write.createSpan({ cls: "sbd-icon" }), "file-pen");
	write.createSpan({ text: "Write review note" });
	write.onclick = async () => {
		const path = normalizePath(`${s.reviewFolder ? `${s.reviewFolder}/` : ""}${moment(start).format("GGGG-[W]WW")}.md`);
		if (ctx.app.vault.getAbstractFileByPath(path)) { ctx.openPath(path); return; }
		const line = (t: Task) => `- [x] ${t.text}`;
		const body = [
			`# Week ${moment(start).isoWeek()} review`,
			`${moment(start).format("MMM D")} – ${moment(end).format("MMM D, YYYY")}`,
			"",
			`**${done.length}** done · **${slipped.length}** slipped · **${created.length}** notes written`,
			"",
			"## Done",
			...(done.length ? done.map(line) : ["- nothing this week"]),
			"",
			"## Slipped",
			...(slipped.length ? slipped.map((t) => `- [ ] ${t.text}`) : ["- nothing slipped"]),
			"",
			"## Notes written",
			...(created.length ? created.map((n) => `- [[${n.name}]]`) : ["- none"]),
			"",
			"## Checklist",
			...s.reviewChecklist.map((i) => `- [${review.checked.includes(i) ? "x" : " "}] ${i}`),
			"",
			"## Reflections",
			review.notes || "",
			"",
		].join("\n");
		await ensureFolder(ctx.app, path);
		const f = await ctx.app.vault.create(path, body);
		await ctx.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => { fm.type = "review"; fm.week = moment(start).format("GGGG-[W]WW"); });
		new Notice(`Review saved to ${path.replace(/\.md$/, "")}`);
		ctx.openPath(path, undefined, true);
	};
}
