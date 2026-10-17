import { Menu, moment, setIcon } from "obsidian";
import { CAL_LAYERS, calendarItems, monthGrid, weekDays, type CalItem, type CalKind } from "../data/calendar";
import { getDailyConfig, getOrCreateDaily } from "../data/daily";
import { addDays } from "../data/trackerTypes";
import { CaptureModal } from "./CaptureModal";
import { emptyState, priorityBadge, renderTask, type DashboardContext } from "./components";

export interface CalendarState {
	mode: "month" | "week" | "timeline";
	/** Any date inside the period being shown. */
	anchor: string;
	selected?: string;
	layers: CalKind[];
}

export const DEFAULT_CAL_LAYERS: CalKind[] = ["due", "scheduled", "done", "project", "deadline", "event", "daily"];

const KIND_ICON = Object.fromEntries(CAL_LAYERS.map((l) => [l.kind, l.icon])) as Record<CalKind, string>;
const KIND_LABEL = Object.fromEntries(CAL_LAYERS.map((l) => [l.kind, l.label])) as Record<CalKind, string>;

export function renderCalendarTab(el: HTMLElement, ctx: DashboardContext, st: CalendarState, update: (patch: Partial<CalendarState>) => void): void {
	const s = ctx.plugin.settings;
	const anchor = st.anchor || ctx.today;
	const toolbar = el.createDiv({ cls: "sbd-toolbar sbd-cal-toolbar" });

	const nav = toolbar.createDiv({ cls: "sbd-cal-nav" });
	const step = (dir: number) => {
		const unit = st.mode === "month" ? "month" : st.mode === "week" ? "week" : "week";
		const n = st.mode === "timeline" ? dir * 2 : dir;
		update({ anchor: moment(anchor).add(n, unit).format("YYYY-MM-DD") });
	};
	const prev = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Previous" } });
	setIcon(prev, "chevron-left");
	prev.onclick = () => step(-1);
	const todayBtn = nav.createEl("button", { text: "today" });
	todayBtn.onclick = () => update({ anchor: ctx.today, selected: ctx.today });
	const next = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Next" } });
	setIcon(next, "chevron-right");
	next.onclick = () => step(1);

	const days = weekDays(anchor, s.weekStartsMonday);
	const title = st.mode === "month" ? moment(anchor).format("MMMM YYYY")
		: st.mode === "week" ? `${moment(days[0]).format("MMM D")} – ${moment(days[6]).format("MMM D, YYYY")}`
			: `timeline · ${moment(anchor).format("MMMM YYYY")}`;
	toolbar.createDiv({ cls: "sbd-cal-title", text: title });

	const seg = toolbar.createDiv({ cls: "sbd-segmented" });
	(["month", "week", "timeline"] as const).forEach((m) => {
		const b = seg.createEl("button", { cls: st.mode === m ? "is-active" : "" });
		setIcon(b.createSpan({ cls: "sbd-icon" }), m === "month" ? "calendar" : m === "week" ? "columns-3" : "list-tree");
		b.createSpan({ text: m });
		b.onclick = () => update({ mode: m });
	});

	const layers = new Set(st.layers);
	const layerBtn = toolbar.createEl("button", { cls: "sbd-layers-btn" });
	setIcon(layerBtn.createSpan({ cls: "sbd-icon" }), "layers");
	layerBtn.createSpan({ text: `layers · ${layers.size}` });
	layerBtn.onclick = (e) => {
		const menu = new Menu();
		for (const l of CAL_LAYERS) {
			menu.addItem((i) => i.setTitle(l.label).setIcon(l.icon).setChecked(layers.has(l.kind)).onClick(() => {
				if (layers.has(l.kind)) layers.delete(l.kind); else layers.add(l.kind);
				update({ layers: [...layers] });
			}));
		}
		menu.showAtMouseEvent(e);
	};

	const body = el.createDiv({ cls: `sbd-cal sbd-cal-${st.mode}` });
	if (st.mode === "month") renderMonth(body, ctx, st, anchor, layers, update);
	else if (st.mode === "week") renderWeek(body, ctx, days, layers);
	else renderTimeline(body, ctx, anchor, layers);
}

function itemsFor(ctx: DashboardContext, start: string, end: string, layers: Set<CalKind>): Map<string, CalItem[]> {
	const idx = ctx.plugin.index;
	return calendarItems(idx.tasks, [...idx.notes.values()], [...idx.projects.values()], start, end, layers);
}

function openItem(ctx: DashboardContext, it: CalItem, e?: MouseEvent): void {
	if (it.kind === "project" && it.projectKey) ctx.openProject(it.projectKey);
	else ctx.openPath(it.path, it.line, !!e && (e.ctrlKey || e.metaKey));
}

function chip(parent: HTMLElement, ctx: DashboardContext, it: CalItem): HTMLElement {
	const c = parent.createDiv({ cls: `sbd-cal-chip sbd-k-${it.kind}` });
	setIcon(c.createSpan({ cls: "sbd-icon" }), KIND_ICON[it.kind]);
	if (it.time) c.createSpan({ cls: "sbd-cal-time", text: it.time });
	c.createSpan({ cls: "sbd-cal-chip-text", text: it.title });
	c.setAttr("aria-label", `${KIND_LABEL[it.kind]}: ${it.title}`);
	c.onclick = (e) => { e.stopPropagation(); openItem(ctx, it, e); };
	if (it.task && (it.kind === "due" || it.kind === "scheduled")) {
		c.draggable = true;
		c.ondragstart = (e) => { e.dataTransfer?.setData("text/sbd-task", it.task!.id); };
	}
	return c;
}

/** Dropping a task on a day sets its due date. */
function dropTarget(el: HTMLElement, ctx: DashboardContext, date: string): void {
	el.ondragover = (e) => { e.preventDefault(); el.addClass("is-drop-target"); };
	el.ondragleave = () => el.removeClass("is-drop-target");
	el.ondrop = (e) => {
		e.preventDefault();
		el.removeClass("is-drop-target");
		const id = e.dataTransfer?.getData("text/sbd-task");
		const task = ctx.plugin.index.tasks.find((t) => t.id === id);
		if (task && task.due !== date) void ctx.plugin.writer.setDue(task, date);
	};
}

function renderMonth(el: HTMLElement, ctx: DashboardContext, st: CalendarState, anchor: string, layers: Set<CalKind>, update: (p: Partial<CalendarState>) => void): void {
	const s = ctx.plugin.settings;
	const m = moment(anchor);
	const weeks = monthGrid(m.year(), m.month(), s.weekStartsMonday);
	const items = itemsFor(ctx, weeks[0][0], weeks[weeks.length - 1][6], layers);
	const selected = st.selected ?? ctx.today;

	const grid = el.createDiv({ cls: "sbd-month" });
	const dow = s.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
	for (const d of dow) grid.createDiv({ cls: "sbd-month-dow", text: moment().day(d).format("ddd").toLowerCase() });

	for (const week of weeks) {
		for (const date of week) {
			const cell = grid.createDiv({ cls: "sbd-month-cell" });
			if (date.slice(0, 7) !== m.format("YYYY-MM")) cell.addClass("is-out");
			if (date === ctx.today) cell.addClass("is-today");
			if (date === selected) cell.addClass("is-selected");
			if (date < ctx.today) cell.addClass("is-past");
			const head = cell.createDiv({ cls: "sbd-month-cell-head" });
			head.createSpan({ cls: "sbd-month-num", text: String(Number(date.slice(8))) });
			const list = items.get(date) ?? [];
			const daily = list.find((i) => i.kind === "daily");
			if (daily) {
				const d = head.createSpan({ cls: "sbd-month-daily", attr: { "aria-label": "Open daily note" } });
				setIcon(d, "notebook-pen");
				d.onclick = (e) => { e.stopPropagation(); ctx.openPath(daily.path); };
			}
			const shown = list.filter((i) => i.kind !== "daily");
			for (const it of shown.slice(0, 3)) chip(cell, ctx, it);
			if (shown.length > 3) cell.createDiv({ cls: "sbd-month-more", text: `+${shown.length - 3} more` });
			cell.onclick = () => { st.selected = date; ctx.openCalendarDay(date); };
			dropTarget(cell, ctx, date);
		}
	}
}

export function renderDayPanel(el: HTMLElement, ctx: DashboardContext, date: string, items: CalItem[]): void {
	const head = el.createDiv({ cls: "sbd-day-head" });
	head.createDiv({ cls: "sbd-day-title", text: moment(date).format("dddd") .toLowerCase() });
	head.createDiv({ cls: "sbd-day-sub", text: moment(date).format("MMMM D, YYYY") });

	const actions = el.createDiv({ cls: "sbd-day-actions" });
	const daily = items.find((i) => i.kind === "daily");
	const dailyBtn = actions.createEl("button", { text: daily ? "open daily note" : "create daily note" });
	dailyBtn.onclick = async () => {
		const f = await getOrCreateDaily(ctx.app, getDailyConfig(ctx.app, ctx.plugin.settings), moment(date));
		ctx.openPath(f.path);
	};
	const add = actions.createEl("button", { cls: "mod-cta", text: "+ task" });
	add.onclick = () => new CaptureModal(ctx.app, ctx.plugin, { due: date }).open();
	dropTarget(el, ctx, date);

	const groups: { title: string; kinds: CalKind[] }[] = [
		{ title: "deadlines", kinds: ["project", "deadline"] },
		{ title: "schedule", kinds: ["event"] },
		{ title: "tasks due", kinds: ["due", "scheduled"] },
		{ title: "completed", kinds: ["done"] },
		{ title: "notes created", kinds: ["created"] },
		{ title: "notes edited", kinds: ["edited"] },
	];
	let any = false;
	for (const g of groups) {
		const list = items.filter((i) => g.kinds.includes(i.kind));
		if (!list.length) continue;
		any = true;
		el.createDiv({ cls: "sbd-day-group", text: `${g.title} · ${list.length}` });
		for (const it of list.slice(0, 25)) {
			if (it.task) { renderTask(el, it.task, ctx); continue; }
			const row = el.createDiv({ cls: "sbd-note-row" });
			setIcon(row.createSpan({ cls: "sbd-icon" }), KIND_ICON[it.kind]);
			if (it.time) row.createSpan({ cls: "sbd-cal-time", text: it.time });
			row.createSpan({ cls: "sbd-note-name", text: it.title });
			row.onclick = (e) => openItem(ctx, it, e);
		}
	}
	if (!any) emptyState(el, "Nothing on this day. Drag a task here to schedule it.");
}

function renderWeek(el: HTMLElement, ctx: DashboardContext, days: string[], layers: Set<CalKind>): void {
	const items = itemsFor(ctx, days[0], days[6], layers);
	const grid = el.createDiv({ cls: "sbd-week" });
	for (const date of days) {
		const col = grid.createDiv({ cls: "sbd-week-col" });
		if (date === ctx.today) col.addClass("is-today");
		const head = col.createDiv({ cls: "sbd-week-head", attr: { "aria-label": "Open day" } });
		head.onclick = () => ctx.openCalendarDay(date);
		head.createDiv({ cls: "sbd-week-dow", text: moment(date).format("ddd").toLowerCase() });
		head.createDiv({ cls: "sbd-week-date", text: moment(date).format("D") });
		const list = items.get(date) ?? [];
		const daily = list.find((i) => i.kind === "daily");
		if (daily) {
			const d = head.createDiv({ cls: "sbd-month-daily", attr: { "aria-label": "Open daily note" } });
			setIcon(d, "notebook-pen");
			d.onclick = () => ctx.openPath(daily.path);
		}
		const body = col.createDiv({ cls: "sbd-week-body" });
		const shown = list.filter((i) => i.kind !== "daily");
		if (!shown.length) body.createDiv({ cls: "sbd-empty", text: "—" });
		for (const it of shown) {
			const c = chip(body, ctx, it);
			if (it.priority && it.priority !== 3) priorityBadge(c, it.priority);
		}
		dropTarget(col, ctx, date);
		col.ondblclick = () => new CaptureModal(ctx.app, ctx.plugin, { due: date }).open();
	}
}

function renderTimeline(el: HTMLElement, ctx: DashboardContext, anchor: string, layers: Set<CalKind>): void {
	const start = addDays(anchor, -30);
	const end = addDays(anchor, 14);
	const items = itemsFor(ctx, start, end, new Set([...layers, "created", "edited"]));
	const dates = [...items.keys()].sort().reverse();
	if (!dates.length) { emptyState(el, "Nothing in this window."); return; }
	const feed = el.createDiv({ cls: "sbd-timeline" });
	let marker = false;
	for (const date of dates) {
		if (!marker && date <= ctx.today) {
			feed.createDiv({ cls: "sbd-timeline-now", text: "today" });
			marker = true;
		}
		const day = feed.createDiv({ cls: `sbd-timeline-day ${date > ctx.today ? "is-future" : ""}` });
		const head = day.createDiv({ cls: "sbd-timeline-date" });
		head.createDiv({ cls: "sbd-timeline-dnum", text: moment(date).format("DD") });
		head.createDiv({ cls: "sbd-timeline-dmeta", text: moment(date).format("ddd · MMM YYYY").toLowerCase() });
		const list = day.createDiv({ cls: "sbd-timeline-items" });
		const dayItems = items.get(date)!;
		const edited = dayItems.filter((i) => i.kind === "edited");
		for (const it of dayItems.filter((i) => i.kind !== "edited")) {
			const row = list.createDiv({ cls: `sbd-timeline-item sbd-k-${it.kind}` });
			setIcon(row.createSpan({ cls: "sbd-icon" }), KIND_ICON[it.kind]);
			row.createSpan({ cls: "sbd-timeline-kind", text: KIND_LABEL[it.kind].toLowerCase() });
			row.createSpan({ cls: "sbd-note-name", text: it.title });
			row.onclick = (e) => openItem(ctx, it, e);
		}
		if (edited.length) {
			const row = list.createDiv({ cls: "sbd-timeline-item sbd-k-edited" });
			setIcon(row.createSpan({ cls: "sbd-icon" }), KIND_ICON.edited);
			row.createSpan({ cls: "sbd-timeline-kind", text: "edited" });
			const names = row.createSpan({ cls: "sbd-note-name" });
			edited.slice(0, 8).forEach((it, i) => {
				if (i) names.appendText(", ");
				const a = names.createSpan({ cls: "sbd-link", text: it.title });
				a.onclick = (e) => openItem(ctx, it, e);
			});
			if (edited.length > 8) names.appendText(` +${edited.length - 8}`);
		}
	}
}
