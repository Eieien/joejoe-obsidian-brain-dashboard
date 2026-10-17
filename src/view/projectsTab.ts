import { moment, setIcon } from "obsidian";
import { daysUntil, isClosedStatus, isOpen, projectStats, sortTasks, startOfWeek } from "../data/queries";
import { STATUS_LABELS, type ProjectInfo } from "../types";
import { CaptureModal } from "./CaptureModal";
import { barChart } from "./charts";
import { card, dueChip, emptyState, pill, renderTask, type DashboardContext } from "./components";
import { progressBar } from "./homeTab";

export interface ProjectsState {
	selected?: string;
	show: "active" | "all";
}

export function renderProjectsTab(el: HTMLElement, ctx: DashboardContext, st: ProjectsState, update: (patch: Partial<ProjectsState>) => void): void {
	const project = st.selected ? ctx.plugin.index.projects.get(st.selected) : undefined;
	if (project) renderProjectHub(el, ctx, project, () => update({ selected: undefined }));
	else renderProjectGrid(el, ctx, st, update);
}

function renderProjectGrid(el: HTMLElement, ctx: DashboardContext, st: ProjectsState, update: (patch: Partial<ProjectsState>) => void): void {
	const { index, settings } = ctx.plugin;
	const toolbar = el.createDiv({ cls: "sbd-toolbar" });
	const seg = toolbar.createDiv({ cls: "sbd-segmented" });
	(["active", "all"] as const).forEach((v) => {
		const b = seg.createEl("button", { text: v === "active" ? "Active" : "All", cls: st.show === v ? "is-active" : "" });
		b.onclick = () => update({ show: v });
	});

	const projects = [...index.projects.values()]
		.filter((p) => st.show === "all" || !isClosedStatus(p.status))
		.map((p) => ({ p, s: projectStats(index.tasksForProject(p.key), ctx.today, settings) }))
		.sort((a, b) => b.s.urgent - a.s.urgent || b.s.overdue - a.s.overdue || a.p.name.localeCompare(b.p.name));

	if (!projects.length) {
		emptyState(el, `No projects yet. Notes in "${settings.projectFolder}/", tagged #${settings.projectTag}, or with "${settings.projectTypeField}: ${settings.projectTypeValue}" show up here.`);
		return;
	}

	const grid = el.createDiv({ cls: "sbd-project-grid" });
	for (const { p, s } of projects) {
		const c = grid.createDiv({ cls: "sbd-project-card" });
		c.onclick = () => update({ selected: p.key });
		const head = c.createDiv({ cls: "sbd-project-card-head" });
		setIcon(head.createSpan({ cls: "sbd-icon" }), "folder-kanban");
		head.createSpan({ cls: "sbd-project-card-name", text: p.name });
		if (p.status) head.createSpan({ cls: "sbd-pill", text: p.status });
		if (p.area) c.createDiv({ cls: "sbd-muted", text: p.area });

		progressBar(c, s.progress);
		const nums = c.createDiv({ cls: "sbd-project-nums" });
		nums.createSpan({ text: `${s.done}/${s.total} done` });
		if (s.open) nums.createSpan({ text: `${s.open} open` });
		if (s.urgent) nums.createSpan({ cls: "sbd-pill is-urgent", text: `${s.urgent} urgent` });
		if (s.overdue) nums.createSpan({ cls: "sbd-pill is-overdue", text: `${s.overdue} overdue` });

		const foot = c.createDiv({ cls: "sbd-project-foot" });
		if (s.nextDue) { foot.createSpan({ cls: "sbd-muted", text: "Next due " }); dueChip(foot, s.nextDue, ctx.today); }
		if (p.deadline) { foot.createSpan({ cls: "sbd-muted", text: " · Deadline " }); dueChip(foot, p.deadline, ctx.today); }
	}
}

/** Everything connected to one project: description, tasks, deadlines, notes, activity. */
function renderProjectHub(el: HTMLElement, ctx: DashboardContext, p: ProjectInfo, back: () => void): void {
	const { index, settings } = ctx.plugin;
	const tasks = index.tasksForProject(p.key);
	const s = projectStats(tasks, ctx.today, settings);

	// ---- Header ----
	const header = el.createDiv({ cls: "sbd-hub-head" });
	const backBtn = header.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "All projects" } });
	setIcon(backBtn, "arrow-left");
	backBtn.onclick = back;
	const titles = header.createDiv({ cls: "sbd-hub-titles" });
	titles.createDiv({ cls: "sbd-hub-name", text: p.name });
	const sub = titles.createDiv({ cls: "sbd-hub-sub" });
	if (p.status) pill(sub, p.status.toLowerCase(), "gray");
	if (p.area) pill(sub, p.area.toLowerCase());
	if (p.folderPath) sub.createSpan({ cls: "sbd-muted", text: p.folderPath });
	const actions = header.createDiv({ cls: "sbd-hub-actions" });
	if (p.notePath) {
		const openBtn = actions.createEl("button", { text: "Open note" });
		openBtn.onclick = () => ctx.openPath(p.notePath!);
	}
	const addBtn = actions.createEl("button", { cls: "mod-cta", text: "Add task" });
	addBtn.onclick = () => new CaptureModal(ctx.app, ctx.plugin, { project: p.key }).open();

	// ---- Stat strip ----
	const strip = el.createDiv({ cls: "sbd-hub-stats" });
	const prog = strip.createDiv({ cls: "sbd-hub-stat sbd-hub-progress" });
	prog.createDiv({ cls: "sbd-hub-stat-value", text: `${Math.round(s.progress * 100)}%` });
	prog.createDiv({ cls: "sbd-hub-stat-label", text: `${s.done} of ${s.total} tasks done` });
	progressBar(prog, s.progress);
	const stat = (value: string, label: string, cls = "") => {
		const t = strip.createDiv({ cls: `sbd-hub-stat ${cls}` });
		t.createDiv({ cls: "sbd-hub-stat-value", text: value });
		t.createDiv({ cls: "sbd-hub-stat-label", text: label });
	};
	stat(String(s.open), "open");
	stat(String(s.overdue), "overdue", s.overdue ? "is-overdue" : "");
	stat(String(s.urgent), "urgent", s.urgent ? "is-urgent" : "");
	if (p.deadline) {
		const d = daysUntil(p.deadline, ctx.today);
		stat(d < 0 ? `${-d}d late` : d === 0 ? "today" : `${d}d`, `deadline · ${moment(p.deadline).format("MMM D")}`, d < 0 ? "is-overdue" : d <= 7 ? "is-urgent" : "");
	} else if (s.nextDue) {
		stat(moment(s.nextDue).format("MMM D"), "next task due");
	}

	const layout = el.createDiv({ cls: "sbd-hub-layout" });
	const main = layout.createDiv({ cls: "sbd-hub-main" });
	const side = layout.createDiv({ cls: "sbd-hub-side" });

	// ---- Description (editable) ----
	renderDescription(main, ctx, p);

	// ---- Open tasks by status ----
	const open = sortTasks(tasks.filter(isOpen), "smart", ctx.today, settings);
	const taskBody = card(main, "Open tasks", { icon: "check-square", count: open.length, action: { icon: "plus", label: "Add task", onClick: () => new CaptureModal(ctx.app, ctx.plugin, { project: p.key }).open() } });
	if (!open.length) emptyState(taskBody, "No open tasks. Add one with +.");
	for (const status of ["in-progress", "todo", "waiting"] as const) {
		const group = open.filter((t) => t.status === status);
		if (!group.length) continue;
		taskBody.createDiv({ cls: "sbd-list-group-head", text: STATUS_LABELS[status] });
		for (const t of group) renderTask(taskBody, t, ctx, { showProject: false });
	}

	// ---- Activity: tasks completed per week ----
	const act = card(main, "Activity", { icon: "activity" });
	const weeks: { label: string; value: number; tip: string }[] = [];
	for (let w = startOfWeek(moment(ctx.today).subtract(11, "weeks").format("YYYY-MM-DD")); w <= ctx.today; w = moment(w).add(1, "week").format("YYYY-MM-DD")) {
		const end = moment(w).add(6, "days").format("YYYY-MM-DD");
		const n = tasks.filter((t) => t.status === "done" && t.doneDate && t.doneDate >= w && t.doneDate <= end).length;
		weeks.push({ label: moment(w).format("MMM D"), value: n, tip: `week of ${moment(w).format("MMM D")} · ${n} completed` });
	}
	if (weeks.some((w) => w.value)) barChart(act, weeks, { height: 100 });
	else emptyState(act, "Completed tasks will chart here, week by week.");

	// ---- Side: deadlines, notes, mentions, done ----
	const upcoming = open.filter((t) => t.due).sort((a, b) => a.due!.localeCompare(b.due!));
	const dlBody = card(side, "Deadlines", { icon: "calendar-clock", count: upcoming.length });
	if (!upcoming.length) emptyState(dlBody, "No dated tasks.");
	for (const t of upcoming.slice(0, 8)) {
		const row = dlBody.createDiv({ cls: "sbd-dl-item" });
		dueChip(row, t.due!, ctx.today);
		row.createSpan({ cls: "sbd-dl-title", text: t.text });
		row.onclick = () => ctx.openPath(t.path, t.line);
	}

	const related = new Map(index.notesForProject(p.key).map((n) => [n.path, n]));
	if (p.notePath) {
		for (const [src, dests] of Object.entries(ctx.app.metadataCache.resolvedLinks)) {
			if (dests[p.notePath] && src !== p.notePath) {
				const n = index.notes.get(src);
				if (n) related.set(src, n);
			}
		}
	}
	const notes = [...related.values()].sort((a, b) => b.mtime - a.mtime);
	const daily = notes.filter((n) => n.kind === "daily");
	const other = notes.filter((n) => n.kind !== "daily");

	const notesBody = card(side, "Linked notes", { icon: "files", count: other.length });
	if (!other.length) emptyState(notesBody, `Link to [[${p.name}]] from any note to see it here.`);
	for (const n of other.slice(0, 10)) {
		const row = notesBody.createDiv({ cls: "sbd-note-row" });
		setIcon(row.createSpan({ cls: "sbd-icon" }), "file-text");
		row.createSpan({ cls: "sbd-note-name", text: n.name });
		row.createSpan({ cls: "sbd-muted", text: moment(n.mtime).fromNow() });
		row.onclick = (e) => ctx.openPath(n.path, undefined, e.ctrlKey || e.metaKey);
	}

	const mentionsBody = card(side, "In daily notes", { icon: "calendar-days", count: daily.length });
	if (!daily.length) emptyState(mentionsBody, "Not mentioned in any daily note yet.");
	const chips = mentionsBody.createDiv({ cls: "sbd-mention-chips" });
	for (const n of daily.sort((a, b) => b.path.localeCompare(a.path)).slice(0, 18)) {
		const c = chips.createSpan({ cls: "sbd-mention-chip", text: moment(n.date ?? n.name).isValid() ? moment(n.date ?? n.name).format("MMM D") : n.name });
		c.onclick = () => ctx.openPath(n.path);
	}

	const done = tasks.filter((t) => t.status === "done")
		.sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""))
		.filter((t) => !t.doneDate || daysUntil(t.doneDate, ctx.today) >= -30);
	const doneBody = card(side, "Recently completed", { icon: "check-circle-2", count: done.length });
	if (!done.length) emptyState(doneBody, "Nothing completed in the last 30 days.");
	for (const t of done.slice(0, 8)) renderTask(doneBody, t, ctx, { showProject: false });
}

/** Project description: rendered Markdown with an inline editor. */
function renderDescription(parent: HTMLElement, ctx: DashboardContext, p: ProjectInfo): void {
	const text = p.notePath ? p.description ?? "" : ctx.plugin.settings.projectDescriptions[p.key] ?? "";
	const box = parent.createDiv({ cls: "sbd-card sbd-desc" });
	const head = box.createDiv({ cls: "sbd-card-head" });
	setIcon(head.createSpan({ cls: "sbd-icon" }), "align-left");
	head.createSpan({ cls: "sbd-card-title", text: "Description" });
	const editBtn = head.createEl("button", { cls: "sbd-ghost-btn" });
	setIcon(editBtn.createSpan({ cls: "sbd-icon" }), "pencil");
	editBtn.createSpan({ text: text ? "edit" : "add" });
	const body = box.createDiv({ cls: "sbd-desc-body" });

	const show = () => {
		body.empty();
		if (text) ctx.renderMarkdown(text, body.createDiv({ cls: "sbd-desc-md markdown-rendered" }), p.notePath ?? "");
		else {
			const empty = body.createDiv({ cls: "sbd-desc-empty", text: "What is this project, why does it matter, and what does done look like? Click to write a description." });
			empty.onclick = edit;
		}
	};
	const edit = () => {
		body.empty();
		editBtn.hide();
		const ta = body.createEl("textarea", { cls: "sbd-desc-input", attr: { rows: "6", placeholder: "Goal, scope, links, key decisions… (Markdown works)" } });
		ta.value = text;
		const row = body.createDiv({ cls: "sbd-desc-actions" });
		row.createSpan({ cls: "sbd-muted", text: p.notePath ? "Saved to the note's description property" : "Saved with the dashboard settings" });
		const cancel = row.createEl("button", { text: "Cancel" });
		const save = row.createEl("button", { cls: "mod-cta", text: "Save" });
		cancel.onclick = () => { editBtn.show(); show(); };
		save.onclick = async () => {
			const value = ta.value.trim();
			if (p.notePath) {
				const file = ctx.app.vault.getFileByPath(p.notePath);
				if (file) await ctx.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (value) fm.description = value; else delete fm.description;
				});
				p.description = value || undefined;
			} else {
				if (value) ctx.plugin.settings.projectDescriptions[p.key] = value;
				else delete ctx.plugin.settings.projectDescriptions[p.key];
				await ctx.plugin.persist();
			}
			ctx.rerender();
		};
		ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save.click(); if (e.key === "Escape") cancel.click(); };
		window.setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
	};
	editBtn.onclick = edit;
	show();
}
