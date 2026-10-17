import { setIcon } from "obsidian";
import { DUE_BUCKET_ORDER, daysUntil, dueBucket, isDueToday, isOpen, isOverdue, isUrgent, sortTasks } from "../data/queries";
import { PRIORITY_LABELS, STATUS_LABELS, type Priority, type Task, type TaskStatus } from "../types";
import { CaptureModal } from "./CaptureModal";
import { renderKanban } from "./kanban";
import { emptyState, renderTask, statusIcon, type DashboardContext } from "./components";

export interface TaskFilters {
	view: "kanban" | "list";
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
		if (f.project && f.project !== "__none" && t.project !== f.project) return false;
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
	(["kanban", "list"] as const).forEach((v) => {
		const b = seg.createEl("button", { cls: f.view === v ? "is-active" : "" });
		setIcon(b.createSpan({ cls: "sbd-icon" }), v === "kanban" ? "columns-3" : "list");
		b.createSpan({ text: v === "kanban" ? "Kanban" : "List" });
		b.onclick = () => update({ view: v });
	});

	const search = toolbar.createEl("input", { type: "search", cls: "sbd-search", attr: { placeholder: "Filter tasks…", "data-sbd-focus": "task-search" } });
	search.value = f.search;
	let t: number | undefined;
	search.oninput = () => { window.clearTimeout(t); t = window.setTimeout(() => update({ search: search.value }), 200); };

	const projects = [...index.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
	select(toolbar, "Project", f.project, [["", "All projects"], ["__none", "No project"], ...projects.map((p) => [p.key, p.name] as [string, string])], (v) => update({ project: v }));
	select(toolbar, "Due", f.due, [["any", "Any date"], ["urgent", "Urgent"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["none", "No date"]], (v) => update({ due: v as TaskFilters["due"] }));
	select(toolbar, "Priority", f.priority, [["", "Any priority"], ...([1, 2, 3, 4] as Priority[]).map((p) => [String(p), PRIORITY_LABELS[p]] as [string, string])], (v) => update({ priority: v as TaskFilters["priority"] }));
	const allLabels = new Set([...ctx.plugin.settings.labels.map((l) => l.name), ...index.tasks.flatMap((t) => t.labels)]);
	select(toolbar, "Label", f.label, [["", "Any label"], ...[...allLabels].sort().map((l) => [l, `#${l}`] as [string, string])], (v) => update({ label: v }));

	if (f.view === "list") {
		select(toolbar, "Sort", f.sort, [["smart", "Sort: Smart"], ["due", "Sort: Due date"], ["priority", "Sort: Priority"], ["recent", "Sort: Recently edited"]], (v) => update({ sort: v as TaskFilters["sort"] }));
		select(toolbar, "Group", f.group, [["none", "No grouping"], ["due", "Group: Due"], ["status", "Group: Status"], ["priority", "Group: Priority"], ["project", "Group: Project"]], (v) => update({ group: v as TaskFilters["group"] }));
	}

	const doneToggle = toolbar.createEl("label", { cls: "sbd-toggle" });
	const cb = doneToggle.createEl("input", { type: "checkbox" });
	cb.checked = f.showDone;
	cb.onchange = () => update({ showDone: cb.checked });
	doneToggle.appendText(f.view === "kanban" ? "All done" : "Show done");

	const addBtn = toolbar.createEl("button", { cls: "mod-cta sbd-add" });
	setIcon(addBtn.createSpan({ cls: "sbd-icon" }), "plus");
	addBtn.createSpan({ text: "Task" });
	addBtn.onclick = () => new CaptureModal(ctx.app, ctx.plugin, { project: f.project && f.project !== "__none" ? f.project : undefined }).open();

	const tasks = filterTasks(index.tasks, f, ctx);
	if (f.view === "kanban") renderKanban(el, tasks, ctx, f);
	else renderList(el, tasks, ctx, f);
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
			case "project": return t.project ? ctx.plugin.index.projects.get(t.project)?.name ?? "No project" : "No project";
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
