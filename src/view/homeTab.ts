import { moment, setIcon } from "obsidian";
import { appendToFile, dailyDate, getDailyConfig, getOrCreateDaily } from "../data/daily";
import { deadlines, isClosedStatus, isDueToday, isOpen, isOverdue, isUrgent, projectStats, sortTasks, startOfWeek } from "../data/queries";
import { buildTaskLine } from "../data/taskParser";
import type { NoteInfo } from "../types";
import { CaptureModal } from "./CaptureModal";
import { dueChip, emptyState, pill, priorityBadge, renderTask, section, whenLoaded, type DashboardContext } from "./components";
import { renderHabitToday, renderHabitWeek } from "./habits";
import { notebookRow } from "./libraryTab";
import type { TaskFilters } from "./tasksTab";
import { countdown, flipClock, imageTiles, miniCalendar, pageHeader, quickLinks, timeProgress } from "./widgets";

export interface HomeState {
	notebook: "recent" | "due" | "review";
	notebookLimit: number;
	projects: "active" | "all";
	lab: "areas" | "tags" | "folders";
	habits: "today" | "week";
}

export const defaultHome = (): HomeState => ({ notebook: "recent", notebookLimit: 10, projects: "active", lab: "areas", habits: "today" });

export function renderHomeTab(el: HTMLElement, ctx: DashboardContext, st: HomeState, update: (p: Partial<HomeState>) => void, goToTasks: (patch: Partial<TaskFilters>) => void): void {
	pageHeader(el, ctx);
	const page = el.createDiv({ cls: "sbd-page" });
	for (const item of ctx.plugin.settings.appearance.layout) {
		if (item.hidden) continue;
		switch (item.id) {
			case "quicklinks": quickLinks(page, ctx); break;
			case "todo": renderTodo(page, ctx, goToTasks); break;
			case "habits": renderHabitsSection(page, ctx, st, update); break;
			case "widgets": renderWidgets(page, ctx); break;
			case "notebook": renderNotebookSplit(page, ctx, st, update); break;
			case "lab": renderLabSection(page, ctx, st, update); break;
		}
	}
}

/** Stats + quick add + things to do (urgent / due first), with upcoming deadlines beside it. */
function renderTodo(page: HTMLElement, ctx: DashboardContext, goToTasks: (patch: Partial<TaskFilters>) => void): void {
	const { index, settings } = ctx.plugin;
	const tasks = index.tasks;
	const open = tasks.filter(isOpen);
	const today = ctx.today;
	const notes = [...index.notes.values()];

	const weekStart = startOfWeek(today);
	const stats: { label: string; value: number; cls?: string; filter?: Partial<TaskFilters> }[] = [
		{ label: "open", value: open.length, filter: { due: "any" } },
		{ label: "urgent", value: open.filter((t) => isUrgent(t, today, settings)).length, cls: "is-urgent", filter: { due: "urgent" } },
		{ label: "overdue", value: open.filter((t) => isOverdue(t, today)).length, cls: "is-overdue", filter: { due: "overdue" } },
		{ label: "due today", value: open.filter((t) => isDueToday(t, today)).length, cls: "is-today", filter: { due: "today" } },
		{ label: "done this week", value: tasks.filter((t) => t.status === "done" && !!t.doneDate && t.doneDate >= weekStart).length, cls: "is-done" },
	];
	const strip = page.createDiv({ cls: "sbd-stats" });
	for (const s of stats) {
		const tile = strip.createDiv({ cls: `sbd-stat ${s.cls ?? ""} ${s.filter ? "is-clickable" : ""}` });
		tile.createDiv({ cls: "sbd-stat-value", text: String(s.value) });
		tile.createDiv({ cls: "sbd-stat-label", text: s.label });
		if (s.filter) tile.onclick = () => goToTasks({ project: "", priority: "", label: "", search: "", ...s.filter });
	}

	const split = page.createDiv({ cls: "sbd-split" });
	const focus = sortTasks(open.filter((t) => isUrgent(t, today, settings) || isDueToday(t, today) || t.status === "in-progress" || t.labels.includes("needs-to-be-done")), "smart", today, settings);
	const fb = section(split, { title: "things to do", icon: "list-checks", action: { label: "All tasks", icon: "arrow-right", onClick: () => goToTasks({ due: "urgent" }) } });

	const quick = fb.createDiv({ cls: "sbd-quick" });
	setIcon(quick.createSpan({ cls: "sbd-icon" }), "plus");
	const qInput = quick.createEl("input", { type: "text", cls: "sbd-quick-input", attr: { placeholder: "add a task… (enter to save)", "data-sbd-focus": "quick-add" } });
	qInput.onkeydown = async (e) => {
		if (e.key !== "Enter" || !qInput.value.trim()) return;
		const line = buildTaskLine({ text: qInput.value.trim(), priority: 3, labels: [] });
		const path = settings.captureTarget === "inbox" ? settings.inboxFile : (await getOrCreateDaily(ctx.app, getDailyConfig(ctx.app, settings))).path;
		qInput.value = "";
		await appendToFile(ctx.app, path, line);
	};
	const more = quick.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Add with priority, labels, due date…" } });
	setIcon(more, "sliders-horizontal");
	more.onclick = () => new CaptureModal(ctx.app, ctx.plugin).open();

	if (!focus.length) emptyState(fb, "Nothing urgent or due. Pick something from your projects.");
	for (const t of focus.slice(0, 8)) renderTask(fb, t, ctx);
	if (focus.length > 8) fb.createDiv({ cls: "sbd-load-more", text: `+ ${focus.length - 8} more` }).onclick = () => goToTasks({ due: "urgent" });

	const side = section(split, { title: "upcoming", icon: "calendar-clock", cls: "sbd-side-col" });
	const dl = deadlines(tasks, [...index.projects.values()], notes, today, settings.deadlineWindowDays).filter((d) => d.date >= today);
	if (!dl.length) emptyState(side, `No deadlines in the next ${settings.deadlineWindowDays} days.`);
	for (const d of dl.slice(0, 7)) {
		const row = side.createDiv({ cls: "sbd-dl-item" });
		dueChip(row, d.date, today);
		row.createSpan({ cls: "sbd-dl-title", text: d.title });
		if (d.priority && d.priority !== 3) priorityBadge(row, d.priority);
		row.onclick = () => (d.kind === "project" ? ctx.openProject(d.path) : ctx.openPath(d.path, d.line));
	}
	miniCalendar(side, ctx);
	const cfg = getDailyConfig(ctx.app, settings);
	const hasToday = notes.some((n) => n.kind === "daily" && dailyDate(n.path, cfg) === today);
	const dailyBtn = side.createEl("button", { cls: "sbd-daily-btn" });
	setIcon(dailyBtn.createSpan({ cls: "sbd-icon" }), "notebook-pen");
	dailyBtn.createSpan({ text: hasToday ? "open today's note" : "create today's note" });
	dailyBtn.onclick = async () => ctx.openPath((await getOrCreateDaily(ctx.app, cfg)).path);
}

function renderHabitsSection(page: HTMLElement, ctx: DashboardContext, st: HomeState, update: (p: Partial<HomeState>) => void): void {
	const body = section(page, {
		title: "habits", icon: "check-square",
		tabs: [{ id: "today", label: "today", icon: "sun" }, { id: "week", label: "this week", icon: "calendar-range" }],
		active: st.habits, onTab: (id) => update({ habits: id as HomeState["habits"] }),
		action: { label: "Habit stats", icon: "bar-chart-3", onClick: () => ctx.openTrackers() },
	});
	whenLoaded(body, ctx.plugin.trackers.habitEntries(), (entries) => {
		if (st.habits === "week") renderHabitWeek(body, ctx, entries, ctx.today);
		else renderHabitToday(body, ctx, entries);
	});
}

function renderWidgets(page: HTMLElement, ctx: DashboardContext): void {
	const a = ctx.plugin.settings.appearance;
	const w = page.createDiv({ cls: "sbd-widgets" });
	if (a.showCountdown) countdown(w, ctx);
	if (a.showTimeProgress) timeProgress(w, ctx);
	if (a.showClock) flipClock(w, ctx);
	imageTiles(w, ctx);
}

function renderNotebookSplit(page: HTMLElement, ctx: DashboardContext, st: HomeState, update: (p: Partial<HomeState>) => void): void {
	const { index, settings } = ctx.plugin;
	const notes = [...index.notes.values()];
	const split = page.createDiv({ cls: "sbd-split" });
	const nb = section(split, {
		title: "notebook", icon: "notebook",
		tabs: [{ id: "recent", label: "recently", icon: "history" }, { id: "due", label: "due soon", icon: "calendar-clock" }, { id: "review", label: "check again", icon: "rotate-ccw" }],
		active: st.notebook, onTab: (id) => update({ notebook: id as HomeState["notebook"], notebookLimit: 10 }),
	});
	renderNotebook(nb, ctx, st, update, notes);

	const pr = section(split, {
		title: "projects", icon: "folder-open",
		tabs: [{ id: "active", label: "active", icon: "zap" }, { id: "all", label: "all", icon: "table-2" }],
		active: st.projects, onTab: (id) => update({ projects: id as HomeState["projects"] }), cls: "sbd-side-col",
	});
	const projects = [...index.projects.values()].filter((p) => st.projects === "all" || !isClosedStatus(p.status))
		.map((p) => ({ p, s: projectStats(index.tasksForProject(p.key), ctx.today, settings) }))
		.sort((x, y) => y.s.urgent - x.s.urgent || y.s.overdue - x.s.overdue || (x.s.nextDue ?? "9999").localeCompare(y.s.nextDue ?? "9999"));
	if (!projects.length) emptyState(pr, `No projects yet — notes in "${settings.projectFolder}/" or tagged #${settings.projectTag} show here.`);
	for (const { p, s } of projects.slice(0, 8)) {
		const c = pr.createDiv({ cls: "sbd-proj-card" });
		const name = c.createDiv({ cls: "sbd-proj-card-name" });
		name.createSpan({ cls: `sbd-dot ${s.overdue ? "is-overdue" : s.urgent ? "is-urgent" : ""}` });
		name.createSpan({ text: p.name });
		const tags = c.createDiv({ cls: "sbd-proj-card-tags" });
		if (p.area) pill(tags, p.area.toLowerCase());
		if (p.status) pill(tags, p.status.toLowerCase(), "gray");
		const meta = c.createDiv({ cls: "sbd-proj-card-meta" });
		meta.createSpan({ text: `↳ ${s.open} open` });
		if (s.overdue) meta.createSpan({ cls: "is-overdue", text: `· ${s.overdue} overdue` });
		if (s.nextDue) { meta.createSpan({ text: "·" }); dueChip(meta, s.nextDue, ctx.today); }
		const bar = c.createDiv({ cls: "sbd-progress" });
		bar.createDiv({ cls: "sbd-progress-fill" }).style.width = `${Math.round(s.progress * 100)}%`;
		c.onclick = () => ctx.openProject(p.key);
	}
}

function renderLabSection(page: HTMLElement, ctx: DashboardContext, st: HomeState, update: (p: Partial<HomeState>) => void): void {
	const lab = section(page, {
		title: "knowledge lab", icon: "network",
		tabs: [{ id: "areas", label: "areas", icon: "layers" }, { id: "tags", label: "tags", icon: "hash" }, { id: "folders", label: "folders", icon: "folder" }],
		active: st.lab, onTab: (id) => update({ lab: id as HomeState["lab"] }),
	});
	renderLab(lab, ctx, st.lab, [...ctx.plugin.index.notes.values()]);
}

function renderNotebook(el: HTMLElement, ctx: DashboardContext, st: HomeState, update: (p: Partial<HomeState>) => void, notes: NoteInfo[]): void {
	const { index, settings } = ctx.plugin;
	if (st.notebook === "due") {
		const dl = deadlines(index.tasks, [...index.projects.values()], notes, ctx.today, settings.deadlineWindowDays);
		if (!dl.length) emptyState(el, "Nothing due soon.");
		for (const d of dl.slice(0, st.notebookLimit)) {
			const row = el.createDiv({ cls: "sbd-nb-row" });
			setIcon(row.createSpan({ cls: "sbd-icon" }), d.kind === "task" ? "square" : d.kind === "project" ? "folder-kanban" : "file-text");
			row.createSpan({ cls: "sbd-nb-name", text: d.title });
			row.createSpan({ cls: `sbd-nb-date ${d.date < ctx.today ? "is-overdue" : ""}`, text: moment(d.date).format("MMMM D, YYYY") });
			pill(row, d.kind);
			row.onclick = () => (d.kind === "project" ? ctx.openProject(d.path) : ctx.openPath(d.path, d.line));
		}
		loadMore(el, dl.length, st, update);
		return;
	}
	let list: NoteInfo[];
	if (st.notebook === "review") {
		// Explicitly flagged notes first, then a stable daily sample of notes untouched for 30+ days.
		const flagged = notes.filter((n) => n.tags.some((t) => t === "review" || t === "check-again") || n.type === "review");
		const stale = notes.filter((n) => n.kind === "note" && Date.now() - n.mtime > 30 * 86_400_000 && !flagged.includes(n));
		const seed = Math.floor(Date.parse(ctx.today) / 86_400_000);
		stale.sort((x, y) => hash(x.path + seed) - hash(y.path + seed));
		list = [...flagged, ...stale];
		if (!list.length) { emptyState(el, "Nothing to revisit. Tag a note #review to surface it here."); return; }
	} else {
		list = [...notes].sort((x, y) => y.mtime - x.mtime);
	}
	for (const n of list.slice(0, st.notebookLimit)) notebookRow(el, ctx, n);
	loadMore(el, list.length, st, update);
}

function loadMore(el: HTMLElement, total: number, st: HomeState, update: (p: Partial<HomeState>) => void): void {
	if (total <= st.notebookLimit) return;
	const more = el.createDiv({ cls: "sbd-load-more" });
	setIcon(more.createSpan({ cls: "sbd-icon" }), "arrow-down");
	more.createSpan({ text: "load more ···" });
	more.onclick = () => update({ notebookLimit: st.notebookLimit + 15 });
}

function renderLab(el: HTMLElement, ctx: DashboardContext, mode: HomeState["lab"], notes: NoteInfo[]): void {
	const counts = new Map<string, { notes: number; projects: number }>();
	const bump = (k: string, isProject: boolean) => {
		const c = counts.get(k) ?? { notes: 0, projects: 0 };
		if (isProject) c.projects++; else c.notes++;
		counts.set(k, c);
	};
	for (const n of notes) {
		if (mode === "areas" && n.area) bump(n.area.toLowerCase(), n.kind === "project");
		if (mode === "tags") for (const t of n.tags) if (!t.includes("/")) bump(t, n.kind === "project");
		if (mode === "folders" && n.folder) bump(n.folder, n.kind === "project");
	}
	const entries = [...counts.entries()].sort((x, y) => (y[1].notes + y[1].projects) - (x[1].notes + x[1].projects)).slice(0, 16);
	if (!entries.length) {
		emptyState(el, mode === "areas" ? "Add `area: Work` (or any area) to note frontmatter to group your knowledge here." : `No ${mode} yet.`);
		return;
	}
	const grid = el.createDiv({ cls: "sbd-lab-grid" });
	for (const [name, c] of entries) {
		const card = grid.createDiv({ cls: "sbd-lab-card" });
		const head = card.createDiv({ cls: "sbd-lab-name" });
		setIcon(head.createSpan({ cls: "sbd-icon" }), mode === "tags" ? "hash" : mode === "folders" ? "folder" : "sparkle");
		head.createSpan({ text: mode === "folders" ? name.toLowerCase() : name });
		const parts = [`${c.notes} note${c.notes === 1 ? "" : "s"}`];
		if (c.projects) parts.push(`${c.projects} project${c.projects === 1 ? "" : "s"}`);
		card.createDiv({ cls: "sbd-lab-meta", text: `‣ ${parts.join(" · ")}` });
		card.onclick = () => ctx.openLibrary(mode === "areas" ? { area: name } : mode === "tags" ? { tag: name } : { folder: name });
	}
}

function hash(s: string): number {
	let h = 0;
	for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return h;
}

export function progressBar(parent: HTMLElement, value: number): void {
	const bar = parent.createDiv({ cls: "sbd-progress" });
	const fill = bar.createDiv({ cls: "sbd-progress-fill" });
	fill.style.width = `${Math.round(value * 100)}%`;
	if (value >= 1) fill.addClass("is-complete");
}
