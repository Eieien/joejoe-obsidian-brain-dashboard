import { App, Modal, moment, setIcon, type EventRef } from "obsidian";
import { calendarItems, monthGrid, type CalItem, type CalKind } from "../data/calendar";
import { appendToFile, getDailyConfig, getOrCreateDaily } from "../data/daily";
import { isOpen } from "../data/queries";
import { buildTaskLine } from "../data/taskParser";
import { addDays } from "../data/trackerTypes";
import { CaptureModal } from "./CaptureModal";
import { emptyState, renderTask, type DashboardContext } from "./components";

type Filter = "all" | "tasks" | "deadlines" | "events";

const FILTER_KINDS: Record<Filter, CalKind[]> = {
	all: ["due", "scheduled", "done", "project", "deadline", "event"],
	tasks: ["due", "scheduled", "done"],
	deadlines: ["project", "deadline"],
	events: ["event"],
};

/**
 * Day popup: a month grid on the left, the selected day's agenda plus what's coming
 * up on the right, and that day's notes and to-dos underneath. Updates live.
 */
export class DayModal extends Modal {
	private date: string;
	private month: string;
	private filter: Filter = "all";
	private ref: EventRef | null = null;
	private local: DashboardContext;

	constructor(app: App, private ctx: DashboardContext, date: string) {
		super(app);
		this.date = date;
		this.month = date.slice(0, 7);
		// Opening something from the popup closes it first.
		this.local = {
			...ctx,
			openPath: (p, line, newLeaf) => { this.close(); ctx.openPath(p, line, newLeaf); },
			openProject: (k) => { this.close(); ctx.openProject(k); },
			rerender: () => this.render(),
		};
	}

	onOpen(): void {
		this.modalEl.addClass("sbd-day-modal");
		this.contentEl.addClass("sbd-modal-root");
		if (this.ctx.plugin.settings.appearance.style === "mono") this.contentEl.addClass("sbd-style-mono");
		this.ref = this.ctx.plugin.index.on("updated", () => this.render());
		this.render();
	}

	onClose(): void {
		if (this.ref) this.ctx.plugin.index.offref(this.ref);
		this.contentEl.empty();
	}

	private items(start: string, end: string, kinds: CalKind[]): Map<string, CalItem[]> {
		const idx = this.ctx.plugin.index;
		return calendarItems(idx.tasks, [...idx.notes.values()], [...idx.projects.values()], start, end, new Set(kinds));
	}

	private render(): void {
		const root = this.contentEl;
		const scrollTop = root.querySelector(".sbd-dm-list")?.scrollTop ?? 0;
		root.empty();
		const top = root.createDiv({ cls: "sbd-dm-top" });
		this.renderMonth(top.createDiv({ cls: "sbd-dm-cal" }));
		this.renderAgenda(top.createDiv({ cls: "sbd-dm-agenda" }));
		const bottom = root.createDiv({ cls: "sbd-dm-bottom" });
		this.renderNotes(bottom.createDiv({ cls: "sbd-dm-panel" }));
		this.renderTodos(bottom.createDiv({ cls: "sbd-dm-panel" }));
		const list = root.querySelector(".sbd-dm-list");
		if (list) list.scrollTop = scrollTop;
	}

	private renderMonth(el: HTMLElement): void {
		const s = this.ctx.plugin.settings;
		const m = moment(`${this.month}-01`);
		const head = el.createDiv({ cls: "sbd-dm-head" });
		const title = head.createDiv({ cls: "sbd-dm-title" });
		title.createSpan({ text: m.format("MMMM") });
		title.createSpan({ cls: "sbd-dm-year", text: ` ${m.format("YYYY")}` });
		const nav = head.createDiv({ cls: "sbd-dm-nav" });
		const btn = (icon: string, label: string, fn: () => void) => {
			const b = nav.createEl("button", { cls: "sbd-dm-round", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.onclick = fn;
		};
		btn("chevron-left", "Previous month", () => { this.month = m.clone().subtract(1, "month").format("YYYY-MM"); this.render(); });
		const today = nav.createEl("button", { cls: "sbd-dm-pill", text: "today" });
		today.onclick = () => { this.date = this.ctx.today; this.month = this.ctx.today.slice(0, 7); this.render(); };
		btn("chevron-right", "Next month", () => { this.month = m.clone().add(1, "month").format("YYYY-MM"); this.render(); });

		const weeks = monthGrid(m.year(), m.month(), s.weekStartsMonday);
		const busy = this.items(weeks[0][0], weeks[weeks.length - 1][6], ["due", "project", "deadline", "event"]);
		const grid = el.createDiv({ cls: "sbd-dm-grid" });
		const dow = s.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
		const selectedDow = moment(this.date).day();
		for (const d of dow) grid.createDiv({ cls: `sbd-dm-dow ${d === selectedDow ? "is-active" : ""}`, text: moment().day(d).format("ddd").toLowerCase() });
		for (const week of weeks) {
			for (const date of week) {
				const cell = grid.createEl("button", { cls: "sbd-dm-day", attr: { "aria-label": moment(date).format("dddd, MMMM D") } });
				if (date.slice(0, 7) !== this.month) cell.addClass("is-out");
				if (date === this.ctx.today) cell.addClass("is-today");
				if (date === this.date) cell.addClass("is-selected");
				const n = busy.get(date)?.length ?? 0;
				cell.createSpan({ cls: `sbd-dm-dot ${n ? "" : "is-empty"}` });
				cell.createSpan({ cls: "sbd-dm-num", text: String(Number(date.slice(8))) });
				cell.onclick = () => { this.date = date; this.month = date.slice(0, 7); this.render(); };
			}
		}
	}

	private renderAgenda(el: HTMLElement): void {
		const head = el.createDiv({ cls: "sbd-dm-head" });
		head.createDiv({ cls: "sbd-dm-title", text: "agenda" });
		const tools = head.createDiv({ cls: "sbd-dm-nav" });
		const sel = tools.createEl("select", { cls: "dropdown sbd-dm-filter", attr: { "aria-label": "Show" } });
		for (const [v, t] of [["all", "All"], ["tasks", "Tasks"], ["deadlines", "Deadlines"], ["events", "Meetings"]] as const) sel.createEl("option", { value: v, text: t });
		sel.value = this.filter;
		sel.onchange = () => { this.filter = sel.value as Filter; this.render(); };
		const add = tools.createEl("button", { cls: "sbd-dm-cta", text: "Add new" });
		add.onclick = () => new CaptureModal(this.app, this.ctx.plugin, { due: this.date }).open();

		const end = addDays(this.date, 21);
		const items = this.items(this.date, end, FILTER_KINDS[this.filter]);
		const list = el.createDiv({ cls: "sbd-dm-list" });
		const dates = [...items.keys()].sort();
		if (!dates.length) {
			const empty = list.createDiv({ cls: "sbd-dm-empty" });
			empty.createDiv({ text: `Nothing planned from ${moment(this.date).format("MMM D")} to ${moment(end).format("MMM D")}.` });
			const a = empty.createEl("button", { cls: "sbd-dm-pill", text: "Add a task for this day" });
			a.onclick = () => new CaptureModal(this.app, this.ctx.plugin, { due: this.date }).open();
			return;
		}
		for (const date of dates) {
			for (const it of items.get(date)!) this.eventRow(list, it);
		}
	}

	private eventRow(parent: HTMLElement, it: CalItem): void {
		const row = parent.createDiv({ cls: `sbd-dm-event ${it.date === this.date ? "is-selected-day" : ""}` });
		const block = row.createDiv({ cls: "sbd-dm-dateblock" });
		block.createDiv({ cls: "sbd-dm-dnum", text: moment(it.date).format("DD") });
		block.createDiv({ cls: "sbd-dm-dname", text: moment(it.date).format("ddd").toLowerCase() });
		const body = row.createDiv({ cls: "sbd-dm-event-body" });
		body.createDiv({ cls: "sbd-dm-event-title", text: it.title });
		const meta = body.createDiv({ cls: "sbd-dm-event-meta" });
		const [label, color] = this.status(it);
		meta.createSpan({ cls: `sbd-tag sbd-c-${color}`, text: label });
		const when = meta.createSpan({ cls: "sbd-dm-chip" });
		setIcon(when.createSpan({ cls: "sbd-icon" }), it.time ? "clock" : "calendar");
		when.createSpan({ text: `${moment(it.date).format("MMM D")}${it.time ? ` at ${moment(it.time, "HH:mm").format("h:mm a")}` : ""}` });
		const projectKey = it.task?.project;
		const project = projectKey ? this.ctx.plugin.index.projects.get(projectKey) : undefined;
		if (project) {
			const p = meta.createSpan({ cls: "sbd-dm-chip" });
			setIcon(p.createSpan({ cls: "sbd-icon" }), "folder-kanban");
			p.createSpan({ text: project.name });
		}
		row.onclick = (e) => (it.kind === "project" && it.projectKey ? this.local.openProject(it.projectKey) : this.local.openPath(it.path, it.line, e.ctrlKey || e.metaKey));
	}

	private status(it: CalItem): [string, string] {
		const today = this.ctx.today;
		switch (it.kind) {
			case "done": return ["completed", "green"];
			case "project": return ["project deadline", "red"];
			case "deadline": return ["deadline", "red"];
			case "event": return [it.date < today ? "past" : "meeting", it.date < today ? "gray" : "blue"];
			case "scheduled": return ["scheduled", "purple"];
			default: return it.date < today ? ["overdue", "red"] : it.date === today ? ["today", "orange"] : ["upcoming", "blue"];
		}
	}

	private renderNotes(el: HTMLElement): void {
		const head = el.createDiv({ cls: "sbd-dm-head" });
		head.createDiv({ cls: "sbd-dm-title", text: moment(this.date).format("dddd, MMM D").toLowerCase() });
		const items = this.items(this.date, this.date, ["daily", "created", "edited", "event"]).get(this.date) ?? [];
		const daily = items.find((i) => i.kind === "daily");
		const btn = head.createEl("button", { cls: "sbd-dm-cta", text: daily ? "Open daily note" : "Create daily note" });
		btn.onclick = async () => {
			const f = await getOrCreateDaily(this.app, getDailyConfig(this.app, this.ctx.plugin.settings), moment(this.date));
			this.local.openPath(f.path);
		};
		const notes = items.filter((i) => i.kind === "created" || i.kind === "edited");
		if (!notes.length) { emptyState(el, "No notes were created or edited this day."); return; }
		for (const it of notes.slice(0, 12)) {
			const row = el.createDiv({ cls: "sbd-note-row" });
			setIcon(row.createSpan({ cls: "sbd-icon" }), it.kind === "created" ? "file-plus" : "file-pen");
			row.createSpan({ cls: "sbd-note-name", text: it.title });
			row.createSpan({ cls: "sbd-muted", text: it.kind });
			row.onclick = (e) => this.local.openPath(it.path, undefined, e.ctrlKey || e.metaKey);
		}
	}

	private renderTodos(el: HTMLElement): void {
		const head = el.createDiv({ cls: "sbd-dm-head" });
		head.createDiv({ cls: "sbd-dm-title", text: "todo list" });
		const tasks = this.ctx.plugin.index.tasks.filter((t) =>
			(isOpen(t) && (t.due === this.date || t.scheduled === this.date || (this.date === this.ctx.today && !!t.due && t.due < this.date))) ||
			(t.status === "done" && t.doneDate === this.date));
		tasks.sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.priority - b.priority);
		const quick = el.createDiv({ cls: "sbd-quick" });
		setIcon(quick.createSpan({ cls: "sbd-icon" }), "plus");
		const input = quick.createEl("input", { type: "text", cls: "sbd-quick-input", attr: { placeholder: `add a task for ${moment(this.date).format("MMM D")}…` } });
		input.onkeydown = async (e) => {
			if (e.key !== "Enter" || !input.value.trim()) return;
			const s = this.ctx.plugin.settings;
			const line = buildTaskLine({ text: input.value.trim(), priority: 3, labels: [], due: this.date });
			const path = s.captureTarget === "inbox" ? s.inboxFile : (await getOrCreateDaily(this.app, getDailyConfig(this.app, s))).path;
			input.value = "";
			await appendToFile(this.app, path, line);
		};
		if (!tasks.length) { emptyState(el, "No tasks due this day."); return; }
		for (const t of tasks.slice(0, 20)) renderTask(el, t, this.local);
	}
}
