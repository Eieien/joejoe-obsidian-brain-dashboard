import { Menu, setIcon } from "obsidian";
import { DUE_BUCKET_ORDER, daysUntil, dueBucket, isDueToday, isOpen, isOverdue, isUrgent, sortTasks } from "../data/queries";
import { PRIORITY_LABELS, STATUS_LABELS, type Priority, type Task, type TaskStatus } from "../types";
import { CaptureModal } from "./CaptureModal";
import { renderBoardView, TextPromptModal } from "./kanban";
import { emptyState, renderTask, statusIcon, type DashboardContext } from "./components";

export interface TaskFilters {
	view: "kanban" | "list" | "matrix";
	search: string;
	priority: "" | `${Priority}`;
	label: string;
	/** "" = all, "__none" = tasks without a project, otherwise a project key. */
	project: string;
	due: "any" | "overdue" | "today" | "week" | "urgent" | "none";
	showDone: boolean;
	sort: "smart" | "due" | "priority" | "recent";
	group: "none" | "status" | "priority" | "project" | "due";
}

export const defaultTaskFilters = (view: "kanban" | "list"): TaskFilters => ({
	view, search: "", priority: "", label: "", project: "", due: "any", showDone: false, sort: "smart", group: "due",
});


export function filterTasks(tasks: Task[], f: TaskFilters, ctx: DashboardContext): Task[] {
	const s = ctx.plugin.settings;
	const q = f.search.trim().toLowerCase();
	return tasks.filter((t) => {
		if (q && !(t.text.toLowerCase().includes(q) || t.labels.some((l) => l.includes(q)) || t.path.toLowerCase().includes(q))) return false;
		if (f.priority && t.priority !== Number(f.priority)) return false;
		if (f.label && !t.labels.includes(f.label)) return false;
		if (f.project === "__none" && t.project) return false;
		if (f.project === "__courses") { if (!t.project || ctx.plugin.index.projects.get(t.project)?.kind !== "course") return false; }
		else if (f.project && f.project !== "__none" && t.project !== f.project) return false;
		switch (f.due) {
			case "overdue": if (!isOverdue(t, ctx.today)) return false; break;
			case "today": if (!isDueToday(t, ctx.today)) return false; break;
			case "week": if (!t.due || daysUntil(t.due, ctx.today) > 7) return false; break;
			case "urgent": if (!isUrgent(t, ctx.today, s)) return false; break;
			case "none": if (t.due) return false; break;
		}
		return true;
	});
}

export function renderTasksTab(el: HTMLElement, ctx: DashboardContext, f: TaskFilters, update: (patch: Partial<TaskFilters>) => void): void {
	const index = ctx.plugin.index;
	const toolbar = el.createDiv({ cls: "sbd-toolbar" });

	// View toggle
	const seg = toolbar.createDiv({ cls: "sbd-segmented" });
	const views = { kanban: ["Board", "square-kanban", "Your Kanban plugin board"], list: ["List", "list", "Tasks found in your notes"], matrix: ["Matrix", "grid-2x2", "Urgent / important (Eisenhower)"] } as const;
	(["kanban", "list", "matrix"] as const).forEach((v) => {
		const b = seg.createEl("button", { cls: f.view === v ? "is-active" : "", attr: { "aria-label": views[v][2] } });
		setIcon(b.createSpan({ cls: "sbd-icon" }), views[v][1]);
		b.createSpan({ text: views[v][0] });
		b.onclick = () => update({ view: v });
	});
	if (f.view === "kanban") {
		renderBoardView(el, ctx, toolbar);
		return;
	}

	const search = toolbar.createEl("input", { type: "search", cls: "sbd-search", attr: { placeholder: "Filter tasks…", "data-sbd-focus": "task-search" } });
	search.value = f.search;
	let t: number | undefined;
	search.oninput = () => { window.clearTimeout(t); t = window.setTimeout(() => update({ search: search.value }), 200); };

	const projects = index.projectList().sort((a, b) => a.name.localeCompare(b.name));
	const courses = index.courseList();
	const hideInactive = ctx.plugin.settings.hideInactiveCourseTasks;
	select(toolbar, "Project or course", f.project, [
		["", "All projects & courses"], ["__none", "No project or course"], ["__courses", "All active courses"],
		...courses.filter((c) => !hideInactive || c.active !== false || f.project === c.key).map((c) => [c.key, `Course · ${c.code ? `${c.code} — ` : ""}${c.name}${c.active === false ? " (inactive)" : ""}`] as [string, string]),
		...projects.map((p) => [p.key, `Project · ${p.name}`] as [string, string]),
	], (v) => update({ project: v }));
	if (courses.some((c) => c.active === false)) {
		const t = toolbar.createEl("button", { cls: "sbd-ghost-btn sbd-inactive-toggle" + (hideInactive ? "" : " is-active"), attr: { "aria-pressed": String(!hideInactive), title: "Tasks from courses you're not taking this semester" } });
		setIcon(t.createSpan({ cls: "sbd-icon" }), hideInactive ? "eye-off" : "eye");
		t.createSpan({ text: hideInactive ? "Inactive courses hidden" : "Showing inactive courses" });
		t.onclick = async () => { ctx.plugin.settings.hideInactiveCourseTasks = !hideInactive; await ctx.plugin.persist(); ctx.rerender(); };
	}
	select(toolbar, "Due", f.due, [["any", "Any date"], ["urgent", "Urgent"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["none", "No date"]], (v) => update({ due: v as TaskFilters["due"] }));
	select(toolbar, "Priority", f.priority, [["", "Any priority"], ...([1, 2, 3, 4] as Priority[]).map((p) => [String(p), PRIORITY_LABELS[p]] as [string, string])], (v) => update({ priority: v as TaskFilters["priority"] }));
	const allLabels = new Set([...ctx.plugin.settings.labels.map((l) => l.name), ...index.tasks.flatMap((t) => t.labels)]);
	select(toolbar, "Label", f.label, [["", "Any label"], ...[...allLabels].sort().map((l) => [l, `#${l}`] as [string, string])], (v) => update({ label: v }));

	if (f.view === "list") {
		select(toolbar, "Sort", f.sort, [["smart", "Sort: Smart"], ["due", "Sort: Due date"], ["priority", "Sort: Priority"], ["recent", "Sort: Recently edited"]], (v) => update({ sort: v as TaskFilters["sort"] }));
		select(toolbar, "Group", f.group, [["none", "No grouping"], ["due", "Group: Due"], ["status", "Group: Status"], ["priority", "Group: Priority"], ["project", "Group: Project"]], (v) => update({ group: v as TaskFilters["group"] }));
	}

	// Saved views: named filter combinations.
	const saved = ctx.plugin.settings.savedViews;
	const viewSel = toolbar.createEl("select", { cls: "dropdown sbd-select", attr: { "aria-label": "Saved views" } });
	viewSel.createEl("option", { value: "", text: saved.length ? "Saved views…" : "No saved views" });
	saved.forEach((v, i) => viewSel.createEl("option", { value: String(i), text: v.name }));
	viewSel.createEl("option", { value: "__save", text: "+ Save current view…" });
	if (saved.length) viewSel.createEl("option", { value: "__delete", text: "Delete a saved view…" });
	viewSel.onchange = () => {
		const v = viewSel.value;
		viewSel.value = "";
		if (v === "__save") {
			new TextPromptModal(ctx.app, "Save view as", "", async (name) => {
				const i = saved.findIndex((x) => x.name === name);
				const entry = { name, filters: { ...f, search: f.search } };
				if (i >= 0) saved[i] = entry; else saved.push(entry);
				await ctx.plugin.persist();
				ctx.rerender();
			}).open();
		} else if (v === "__delete") {
			const menu = new Menu();
			for (const x of saved) {
				menu.addItem((i) => i.setTitle(`Delete “${x.name}”`).setIcon("trash-2").onClick(async () => {
					ctx.plugin.settings.savedViews = saved.filter((y) => y !== x);
					await ctx.plugin.persist();
					ctx.rerender();
				}));
			}
			const r = viewSel.getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom });
		} else if (v) {
			update({ ...saved[Number(v)].filters });
		}
	};

	const doneToggle = toolbar.createEl("label", { cls: "sbd-toggle" });
	const cb = doneToggle.createEl("input", { type: "checkbox" });
	cb.checked = f.showDone;
	cb.onchange = () => update({ showDone: cb.checked });
	doneToggle.appendText("Show done");

	const addBtn = toolbar.createEl("button", { cls: "mod-cta sbd-add" });
	setIcon(addBtn.createSpan({ cls: "sbd-icon" }), "plus");
	addBtn.createSpan({ text: "Task" });
	addBtn.onclick = () => new CaptureModal(ctx.app, ctx.plugin, { project: f.project && f.project !== "__none" ? f.project : undefined }).open();

	// Picking one course shows its tasks even when it is inactive.
	const picked = f.project ? index.projects.get(f.project) : undefined;
	const filtered = filterTasks(picked?.kind === "course" ? index.allTasks : index.tasks, f, ctx);
	if (f.view === "matrix") renderMatrix(el, filtered, ctx, f);
	else renderList(el, filtered, ctx, f);
}

/**
 * Eisenhower matrix. Urgent = overdue, due soon, P1 or #urgent. Important = P1/P2,
 * #important or #needs-to-be-done, or part of a project.
 */
function renderMatrix(el: HTMLElement, tasks: Task[], ctx: DashboardContext, f: TaskFilters): void {
	const s = ctx.plugin.settings;
	const open = tasks.filter((t) => f.showDone || isOpen(t));
	const important = (t: Task) => t.priority <= 2 || t.labels.includes("important") || t.labels.includes("needs-to-be-done") || !!t.project;
	const quadrants = [
		{ key: "do", title: "Do now", hint: "urgent · important", icon: "zap", match: (t: Task) => isUrgent(t, ctx.today, s) && important(t) },
		{ key: "schedule", title: "Schedule", hint: "important · not urgent", icon: "calendar-clock", match: (t: Task) => !isUrgent(t, ctx.today, s) && important(t) },
		{ key: "delegate", title: "Delegate or batch", hint: "urgent · less important", icon: "users", match: (t: Task) => isUrgent(t, ctx.today, s) && !important(t) },
		{ key: "later", title: "Later / drop", hint: "neither", icon: "archive", match: (t: Task) => !isUrgent(t, ctx.today, s) && !important(t) },
	];
	const grid = el.createDiv({ cls: "sbd-matrix-grid" });
	for (const q of quadrants) {
		const list = sortTasks(open.filter(q.match), "smart", ctx.today, s);
		const box = grid.createDiv({ cls: `sbd-quadrant sbd-q-${q.key}` });
		const head = box.createDiv({ cls: "sbd-quadrant-head" });
		setIcon(head.createSpan({ cls: "sbd-icon" }), q.icon);
		head.createSpan({ cls: "sbd-quadrant-title", text: q.title });
		head.createSpan({ cls: "sbd-muted", text: q.hint });
		head.createSpan({ cls: "sbd-count", text: String(list.length) });
		const body = box.createDiv({ cls: "sbd-quadrant-body" });
		if (!list.length) emptyState(body, "Nothing here.");
		for (const t of list.slice(0, 30)) renderTask(body, t, ctx);
		if (list.length > 30) body.createDiv({ cls: "sbd-muted", text: `+ ${list.length - 30} more — narrow with the filters` });
	}
}

function renderList(el: HTMLElement, tasks: Task[], ctx: DashboardContext, f: TaskFilters): void {
	const s = ctx.plugin.settings;
	const visible = sortTasks(f.showDone ? tasks : tasks.filter(isOpen), f.sort, ctx.today, s);
	const list = el.createDiv({ cls: "sbd-list" });
	if (!visible.length) { emptyState(list, "No tasks match these filters."); return; }

	const groups = new Map<string, Task[]>();
	const keyOf = (t: Task): string => {
		switch (f.group) {
			case "none": return "";
			case "status": return STATUS_LABELS[t.status];
			case "priority": return PRIORITY_LABELS[t.priority];
			case "due": return isOpen(t) ? dueBucket(t, ctx.today) : "Closed";
			case "project": { const pr = t.project ? ctx.plugin.index.projects.get(t.project) : undefined; return pr ? (pr.kind === "course" ? `Course · ${pr.code ?? pr.name}` : pr.name) : "No project"; }
		}
	};
	for (const t of visible) {
		const k = keyOf(t);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k)!.push(t);
	}
	const order = (k: string): number => {
		if (f.group === "due") { const i = DUE_BUCKET_ORDER.indexOf(k); return i < 0 ? 99 : i; }
		if (f.group === "status") return Object.values(STATUS_LABELS).indexOf(k);
		if (f.group === "priority") return Object.values(PRIORITY_LABELS).indexOf(k);
		return k === "No project" ? 999 : 0;
	};
	const keys = [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

	for (const k of keys) {
		const items = groups.get(k)!;
		const section = list.createDiv({ cls: "sbd-list-group" });
		if (k) {
			const head = section.createDiv({ cls: "sbd-list-group-head" });
			head.createSpan({ text: k });
			head.createSpan({ cls: "sbd-count", text: String(items.length) });
			if (k === "Overdue") head.addClass("is-overdue");
		}
		for (const t of items) renderTask(section, t, ctx, { showStatus: f.group !== "status", showProject: f.group !== "project" });
	}
}

function select(parent: HTMLElement, label: string, value: string, options: [string, string][], onChange: (v: string) => void): void {
	const sel = parent.createEl("select", { cls: "dropdown sbd-select", attr: { "aria-label": label } });
	for (const [v, text] of options) sel.createEl("option", { value: v, text });
	sel.value = value;
	if (value && value !== "any") sel.addClass("is-set");
	sel.onchange = () => onChange(sel.value);
}
