import { App, Menu, Modal, moment, setIcon, Setting } from "obsidian";
import type SecondBrainPlugin from "../main";
import { PILL_COLORS } from "../settings";
import { NewLabelModal } from "./labels";
import { daysUntil, isAutoUrgent, isOverdue } from "../data/queries";
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER, type Priority, type Task, type TaskStatus } from "../types";

/** Everything a tab renderer needs. Built fresh on each render. */
export interface DashboardContext {
	app: App;
	plugin: SecondBrainPlugin;
	today: string;
	openPath: (path: string, line?: number, newLeaf?: boolean) => void;
	openProject: (key: string) => void;
	openLibrary: (filter: { folder?: string; tag?: string; area?: string; kind?: string }) => void;
	openCalendarDay: (date: string) => void;
	openTrackers: () => void;
	/** Render Markdown with Obsidian's renderer (links, embeds, callouts). */
	renderMarkdown: (md: string, el: HTMLElement, sourcePath: string) => void;
	rerender: () => void;
	/** Intervals are cleared automatically before the next render. */
	addInterval: (id: number) => void;
	/** Run when the view re-renders or closes (stop animations, observers…). */
	addCleanup: (fn: () => void) => void;
}

/** Stable color per name (color follows the entity, not its position). */
export function pillColor(name: string): string {
	let h = 0;
	for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return PILL_COLORS[1 + (h % (PILL_COLORS.length - 1))];
}

export function pill(parent: HTMLElement, text: string, color = pillColor(text)): HTMLElement {
	return parent.createSpan({ cls: `sbd-tag sbd-c-${color}`, text });
}

/** Section with underlined sub-tabs and a heading, like a Notion linked-database block. */
export function section(parent: HTMLElement, opts: { title: string; icon: string; tabs?: { id: string; label: string; icon: string }[]; active?: string; onTab?: (id: string) => void; cls?: string; action?: { label: string; icon: string; onClick: () => void } }): HTMLElement {
	const el = parent.createDiv({ cls: `sbd-section ${opts.cls ?? ""}` });
	if (opts.tabs?.length) {
		const tabs = el.createDiv({ cls: "sbd-subtabs" });
		for (const t of opts.tabs) {
			const b = tabs.createDiv({ cls: `sbd-subtab ${opts.active === t.id ? "is-active" : ""}` });
			setIcon(b.createSpan({ cls: "sbd-icon" }), t.icon);
			b.createSpan({ text: t.label });
			b.onclick = () => opts.onTab?.(t.id);
		}
	}
	const h = el.createDiv({ cls: "sbd-section-title" });
	setIcon(h.createSpan({ cls: "sbd-icon" }), opts.icon);
	h.createSpan({ text: opts.title });
	if (opts.action) {
		const a = opts.action;
		const btn = h.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-section-action", attr: { "aria-label": a.label } });
		setIcon(btn, a.icon);
		btn.onclick = a.onClick;
	}
	return el.createDiv({ cls: "sbd-section-body" });
}

export function labelColor(ctx: DashboardContext, name: string): string | undefined {
	return ctx.plugin.settings.labels.find((l) => l.name === name)?.color;
}

export function priorityBadge(parent: HTMLElement, p: Priority): HTMLElement {
	return parent.createSpan({ cls: `sbd-prio sbd-prio-${p}`, text: `P${p}`, attr: { "aria-label": PRIORITY_LABELS[p] } });
}

export function labelChip(parent: HTMLElement, ctx: DashboardContext, name: string): HTMLElement {
	const chip = parent.createSpan({ cls: "sbd-label", text: `#${name}` });
	const color = labelColor(ctx, name);
	if (color) chip.style.setProperty("--sbd-label-color", color);
	return chip;
}

export function dueChip(parent: HTMLElement, due: string, today: string): HTMLElement {
	const d = daysUntil(due, today);
	const text = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday"
		: d < 0 ? `${-d}d overdue` : d < 7 ? moment(due).format("ddd") : moment(due).format("MMM D");
	const chip = parent.createSpan({ cls: "sbd-due", attr: { "aria-label": due } });
	setIcon(chip.createSpan({ cls: "sbd-icon" }), "calendar");
	chip.createSpan({ text });
	if (d < 0) chip.addClass("is-overdue");
	else if (d === 0) chip.addClass("is-today");
	else if (d <= 2) chip.addClass("is-soon");
	return chip;
}

export function emptyState(parent: HTMLElement, text: string): void {
	parent.createDiv({ cls: "sbd-empty", text });
}

/** A section card with a title, optional count and action button. Returns the body element. */
export function card(parent: HTMLElement, title: string, opts: { icon?: string; count?: number; cls?: string; action?: { icon: string; label: string; onClick: () => void } } = {}): HTMLElement {
	const el = parent.createDiv({ cls: `sbd-card ${opts.cls ?? ""}` });
	const head = el.createDiv({ cls: "sbd-card-head" });
	if (opts.icon) setIcon(head.createSpan({ cls: "sbd-icon" }), opts.icon);
	head.createSpan({ cls: "sbd-card-title", text: title });
	if (opts.count !== undefined) head.createSpan({ cls: "sbd-count", text: String(opts.count) });
	if (opts.action) {
		const a = opts.action;
		const btn = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": a.label } });
		setIcon(btn, a.icon);
		btn.onclick = a.onClick;
	}
	return el.createDiv({ cls: "sbd-card-body" });
}

/** One task: checkbox, text, metadata chips. Click opens the note; right-click or ⋯ for the menu. */
/** Remove a project/course name (or its note's file name) from task text, e.g. a trailing [[link]]. */
export function withoutName(text: string, p: { name: string; notePath?: string }): string {
	const names = [p.name, p.notePath?.split("/").pop()?.replace(/\.md$/, "")].filter((n): n is string => !!n);
	let out = text;
	for (const n of names) {
		const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`\\s*[|·–—-]?\\s*${esc}\\s*$`, "i"), "").replace(new RegExp(`\\s+${esc}(?=\\s)`, "i"), "");
	}
	return out.trim();
}

export function renderTask(parent: HTMLElement, task: Task, ctx: DashboardContext, opts: { showProject?: boolean; draggable?: boolean; showStatus?: boolean } = {}): HTMLElement {
	const writer = ctx.plugin.writer;
	const row = parent.createDiv({ cls: `sbd-task sbd-status-${task.status}` });
	if (isOverdue(task, ctx.today)) row.addClass("is-overdue");
	row.dataset.taskId = task.id;

	const cb = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox sbd-check" });
	cb.checked = task.status === "done";
	cb.onclick = (e) => {
		e.stopPropagation();
		if (task.status !== "done") row.addClass("is-completing");
		void writer.toggleDone(task);
	};

	const main = row.createDiv({ cls: "sbd-task-main" });
	// The project / course link is shown separately, so drop its name from the title text.
	const proj = task.project ? ctx.plugin.index.projects.get(task.project) : undefined;
	const title = (proj ? withoutName(task.text, proj) : task.text) || task.text || "(empty task)";
	const text = main.createDiv({ cls: "sbd-task-text" });
	text.createSpan({ cls: "sbd-task-title", text: title });
	if (proj?.kind === "course" && opts.showProject !== false) {
		text.createSpan({ cls: "sbd-task-sep", text: "|", attr: { "aria-hidden": "true" } });
		const cn = text.createSpan({ cls: `sbd-task-course sbd-c-${proj.color ?? "indigo"}`, text: proj.name, attr: { title: `Open ${proj.name}${proj.active === false ? " (inactive)" : ""}` } });
		cn.onclick = (e) => { e.stopPropagation(); ctx.openProject(proj.key); };
	}
	text.onclick = (e) => ctx.openPath(task.path, task.line, e.ctrlKey || e.metaKey);

	const meta = main.createDiv({ cls: "sbd-task-meta" });
	if (task.priority !== 3) priorityBadge(meta, task.priority);
	if (opts.showStatus && task.status !== "todo") meta.createSpan({ cls: "sbd-status-chip", text: STATUS_LABELS[task.status] });
	if (task.due) dueChip(meta, task.due, ctx.today);
	if (isAutoUrgent(task, ctx.today, ctx.plugin.settings)) meta.createSpan({ cls: "sbd-auto-urgent", text: "auto-urgent", attr: { "aria-label": "Due soon — escalated automatically" } });
	for (const l of task.labels) labelChip(meta, ctx, l);
	if (opts.showProject !== false && task.project) {
		const p = ctx.plugin.index.projects.get(task.project);
		if (p?.kind === "course") {
			// Shown in the title as "task | Course name".
		} else if (p) {
			const chip = meta.createSpan({ cls: "sbd-project-chip", text: p.name });
			chip.onclick = (e) => { e.stopPropagation(); ctx.openProject(p.key); };
		}
	}
	if (!task.project) {
		meta.createSpan({ cls: "sbd-file-chip", text: task.path.split("/").pop()?.replace(/\.md$/, "") ?? "" });
	}

	const more = row.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-task-more", attr: { "aria-label": "Task options" } });
	setIcon(more, "more-horizontal");
	more.onclick = (e) => { e.stopPropagation(); taskMenu(e, task, ctx); };
	row.oncontextmenu = (e) => { e.preventDefault(); taskMenu(e, task, ctx); };

	if (opts.draggable) {
		row.draggable = true;
		row.ondragstart = (e) => {
			e.dataTransfer?.setData("text/sbd-task", task.id);
			row.addClass("is-dragging");
		};
		row.ondragend = () => row.removeClass("is-dragging");
	}
	return row;
}

export function taskMenu(evt: MouseEvent, task: Task, ctx: DashboardContext): void {
	const w = ctx.plugin.writer;
	const menu = new Menu();

	for (const st of STATUS_ORDER) {
		menu.addItem((i) => i.setTitle(STATUS_LABELS[st]).setSection("status").setChecked(task.status === st)
			.onClick(() => void w.setStatus(task, st)));
	}
	([1, 2, 3, 4] as Priority[]).forEach((p) => {
		menu.addItem((i) => i.setTitle(PRIORITY_LABELS[p]).setSection("priority").setChecked(task.priority === p)
			.onClick(() => void w.setPriority(task, p)));
	});

	const day = (n: number) => moment(ctx.today).add(n, "day").format("YYYY-MM-DD");
	menu.addItem((i) => i.setTitle("Due today").setIcon("calendar").setSection("due").onClick(() => void w.setDue(task, ctx.today)));
	menu.addItem((i) => i.setTitle("Due tomorrow").setIcon("calendar-plus").setSection("due").onClick(() => void w.setDue(task, day(1))));
	menu.addItem((i) => i.setTitle("Due next week").setIcon("calendar-range").setSection("due").onClick(() => void w.setDue(task, moment(ctx.today).add(1, "week").startOf("isoWeek").format("YYYY-MM-DD"))));
	menu.addItem((i) => i.setTitle("Pick due date…").setIcon("calendar-search").setSection("due").onClick(() => {
		new DateModal(ctx.app, task.due, (d) => void w.setDue(task, d)).open();
	}));
	if (task.due) menu.addItem((i) => i.setTitle("Clear due date").setIcon("calendar-x").setSection("due").onClick(() => void w.setDue(task, null)));

	const labelNames = new Set([...ctx.plugin.settings.labels.map((l) => l.name), ...task.labels]);
	for (const l of labelNames) {
		menu.addItem((i) => i.setTitle(`#${l}`).setSection("labels").setChecked(task.labels.includes(l))
			.onClick(() => void w.toggleLabel(task, l)));
	}
	menu.addItem((i) => i.setTitle("New label…").setIcon("tag").setSection("labels").onClick(() => {
		new NewLabelModal(ctx.app, ctx.plugin, (name) => void w.toggleLabel(task, name)).open();
	}));

	menu.addItem((i) => i.setTitle("Open in note").setIcon("file-text").setSection("open").onClick(() => ctx.openPath(task.path, task.line)));
	menu.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => ctx.openPath(task.path, task.line, true)));
	menu.showAtMouseEvent(evt);
}

export class DateModal extends Modal {
	constructor(app: App, private initial: string | undefined, private onPick: (date: string) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Due date");
		let value = this.initial ?? moment().format("YYYY-MM-DD");
		new Setting(this.contentEl).setName("Date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(value).onChange((v) => { value = v; });
			t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(value); });
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText("Set").setCta().onClick(() => this.submit(value)));
	}

	private submit(value: string): void {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			this.onPick(value);
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function statusIcon(st: TaskStatus): string {
	return { "todo": "circle", "in-progress": "loader", "waiting": "pause-circle", "done": "check-circle-2", "cancelled": "x-circle" }[st];
}

/** Render into `el` once data loads, unless the view re-rendered in the meantime. */
export function whenLoaded<T>(el: HTMLElement, p: Promise<T>, fn: (data: T) => void): void {
	const loading = el.createDiv({ cls: "sbd-empty", text: "loading…" });
	void p.then((data) => {
		if (!el.isConnected) return;
		loading.remove();
		fn(data);
	});
}
