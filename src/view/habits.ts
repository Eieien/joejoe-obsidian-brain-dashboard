// Habit checkboxes and statistics. Each habit is a yes/no value in daily-note frontmatter
// (gym: true). Checking a box writes that day's daily note (created if needed).

import { App, getIcon, Modal, moment, Notice, setIcon, Setting } from "obsidian";
import type SecondBrainPlugin from "../main";
import type { HabitDef } from "../settings";
import {
	addDays, boolStats, diffDays, goalProgress, periodStart, rangeBounds, slugKey, toBool,
	type RangeKey, type TrackerEntry, type TrackerField,
} from "../data/trackerTypes";
import { weekDays } from "../data/calendar";
import { barChart, hbars, heatmap } from "./charts";
import { emptyState, type DashboardContext } from "./components";
import { IconPickerModal } from "./pickers";

/** date → set of habit keys done that day. */
export function doneMap(entries: TrackerEntry[]): Map<string, Set<string>> {
	const m = new Map<string, Set<string>>();
	for (const e of entries) {
		if (!e.date) continue;
		for (const [k, v] of Object.entries(e.values)) {
			if (toBool(v) === true) {
				if (!m.has(e.date)) m.set(e.date, new Set());
				m.get(e.date)!.add(k);
			}
		}
	}
	return m;
}

export function habitField(h: HabitDef): TrackerField {
	return { key: h.key, label: h.label, type: "boolean", goal: { target: h.target, period: "week", agg: "count" } };
}

function habitIcon(el: HTMLElement, h: HabitDef): void {
	if (getIcon(h.icon)) setIcon(el, h.icon); else el.setText(h.icon || "✓");
}

/** Toggle with instant feedback; the dashboard re-renders when the daily note changes. */
function toggle(ctx: DashboardContext, el: HTMLElement, date: string, key: string, done: Map<string, Set<string>>): void {
	const on = !el.hasClass("is-on");
	el.toggleClass("is-on", on);
	el.removeClass("just-toggled");
	void el.offsetWidth; // restart the pop animation
	if (on) el.addClass("just-toggled");
	if (!done.has(date)) done.set(date, new Set());
	if (on) done.get(date)!.add(key); else done.get(date)!.delete(key);
	ctx.plugin.trackers.toggleHabit(date, key, on).catch((e) => {
		console.error(e);
		el.toggleClass("is-on", !on);
		new Notice("Second brain: could not update the daily note.");
	});
}

function noHabits(el: HTMLElement, ctx: DashboardContext): void {
	const box = el.createDiv({ cls: "sbd-empty" });
	box.setText("No habits yet. ");
	const a = box.createSpan({ cls: "sbd-link", text: "Add habits" });
	a.onclick = () => new HabitsModal(ctx.app, ctx.plugin, () => ctx.rerender()).open();
}

// ---------- Today: big checkbox pills ----------

export function renderHabitToday(el: HTMLElement, ctx: DashboardContext, entries: TrackerEntry[]): void {
	const habits = ctx.plugin.settings.habits;
	if (!habits.length) { noHabits(el, ctx); return; }
	const done = doneMap(entries);
	const today = ctx.today;
	const grid = el.createDiv({ cls: "sbd-habit-today" });
	for (const h of habits) {
		const f = habitField(h);
		const b = boolStats(entries, f, today, today, today);
		const g = goalProgress(entries, f, today, ctx.plugin.settings.weekStartsMonday);
		const pill = grid.createDiv({ cls: `sbd-habit-pill ${done.get(today)?.has(h.key) ? "is-on" : ""}`, attr: { role: "checkbox", "aria-label": h.label } });
		const box = pill.createSpan({ cls: "sbd-hbox" });
		setIcon(box, "check");
		habitIcon(pill.createSpan({ cls: "sbd-icon sbd-habit-icon" }), h);
		const text = pill.createDiv({ cls: "sbd-habit-text" });
		text.createDiv({ cls: "sbd-habit-name", text: h.label });
		text.createDiv({ cls: "sbd-habit-meta", text: `${b.currentStreak ? `🔥 ${b.currentStreak}d · ` : ""}${g ? `${g.value}/${h.target} this week` : ""}` });
		pill.onclick = () => toggle(ctx, pill, today, h.key, done);
	}
}

// ---------- Week grid: every habit × 7 days ----------

export function renderHabitWeek(el: HTMLElement, ctx: DashboardContext, entries: TrackerEntry[], anchor: string, nav?: (delta: number) => void): void {
	const habits = ctx.plugin.settings.habits;
	if (!habits.length) { noHabits(el, ctx); return; }
	const done = doneMap(entries);
	const days = weekDays(anchor, ctx.plugin.settings.weekStartsMonday);

	if (nav) {
		const bar = el.createDiv({ cls: "sbd-habit-nav" });
		const prev = bar.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Previous week" } });
		setIcon(prev, "chevron-left");
		prev.onclick = () => nav(-1);
		bar.createSpan({ cls: "sbd-habit-nav-title", text: `${moment(days[0]).format("MMM D")} – ${moment(days[6]).format("MMM D")}` });
		const next = bar.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Next week" } });
		setIcon(next, "chevron-right");
		next.onclick = () => nav(1);
		if (!days.includes(ctx.today)) {
			const t = bar.createEl("button", { cls: "sbd-ghost-btn", text: "this week" });
			t.onclick = () => nav(0);
		}
	}

	const wrap = el.createDiv({ cls: "sbd-table-wrap" });
	const table = wrap.createEl("table", { cls: "sbd-habit-week" });
	const hr = table.createEl("thead").createEl("tr");
	hr.createEl("th", { cls: "sbd-hw-habit", text: "habit" });
	for (const d of days) {
		const th = hr.createEl("th", { cls: d === ctx.today ? "is-today" : "" });
		th.createDiv({ cls: "sbd-hw-dow", text: moment(d).format("dd").toLowerCase() });
		th.createDiv({ cls: "sbd-hw-date", text: moment(d).format("D") });
	}
	hr.createEl("th", { cls: "sbd-hw-total", text: "week" });

	const body = table.createEl("tbody");
	for (const h of habits) {
		const tr = body.createEl("tr");
		const name = tr.createEl("td", { cls: "sbd-hw-habit" }).createSpan({ cls: "sbd-hw-name" });
		habitIcon(name.createSpan({ cls: "sbd-icon" }), h);
		name.createSpan({ text: h.label });
		let count = 0;
		for (const d of days) {
			const td = tr.createEl("td", { cls: d === ctx.today ? "is-today" : "" });
			const on = !!done.get(d)?.has(h.key);
			if (on) count++;
			const cell = td.createDiv({ cls: `sbd-hcheck ${on ? "is-on" : ""} ${d > ctx.today ? "is-future" : ""}`, attr: { role: "checkbox", "aria-label": `${h.label} · ${moment(d).format("ddd MMM D")}` } });
			setIcon(cell, "check");
			if (d <= ctx.today) cell.onclick = () => { toggle(ctx, cell, d, h.key, done); refreshTotal(); };
		}
		const total = tr.createEl("td", { cls: "sbd-hw-total" });
		const refreshTotal = () => {
			const n = days.filter((d) => done.get(d)?.has(h.key)).length;
			total.empty();
			total.createSpan({ cls: n >= h.target ? "is-met" : "", text: `${n}/${h.target}` });
		};
		void count;
		refreshTotal();
	}
}

// ---------- Statistics board ----------

export interface HabitBoardState {
	range: RangeKey;
	hidden: string[];
	focus?: string;
}

/** Compact summary for the side panel: key numbers + completion by habit. */
export function renderHabitSummary(el: HTMLElement, ctx: DashboardContext, entries: TrackerEntry[], st: HabitBoardState): void {
	const s = ctx.plugin.settings;
	const visible = s.habits.filter((h) => !st.hidden.includes(h.key));
	if (!visible.length) { emptyState(el, "No habits selected."); return; }
	const { start, end } = rangeBounds(st.range, ctx.today, entries);
	const done = doneMap(entries);
	const days = diffDays(end, start) + 1;
	let perfect = 0, totalChecks = 0;
	for (let d = start; d <= end; d = addDays(d, 1)) {
		const set = done.get(d);
		const n = visible.filter((h) => set?.has(h.key)).length;
		totalChecks += n;
		if (n === visible.length) perfect++;
	}
	const weekDone = visible.reduce((acc, h) => acc + (goalProgress(entries, habitField(h), ctx.today, s.weekStartsMonday)?.value ?? 0), 0);
	const weekTarget = visible.reduce((acc, h) => acc + h.target, 0);
	const stats = visible.map((h) => ({ h, b: boolStats(entries, habitField(h), start, end, ctx.today) }));
	const best = [...stats].sort((a, b) => b.b.currentStreak - a.b.currentStreak)[0];

	const tiles = el.createDiv({ cls: "sbd-summary-grid" });
	const tile = (label: string, value: string, sub?: string) => {
		const t = tiles.createDiv({ cls: "sbd-summary-tile" });
		t.createDiv({ cls: "sbd-summary-value", text: value });
		t.createDiv({ cls: "sbd-summary-label", text: label });
		if (sub) t.createDiv({ cls: "sbd-summary-sub", text: sub });
	};
	tile("done today", `${visible.filter((h) => done.get(ctx.today)?.has(h.key)).length}/${visible.length}`);
	tile("weekly goal", `${weekTarget ? Math.round((weekDone / weekTarget) * 100) : 0}%`, `${weekDone} of ${weekTarget} check-ins`);
	tile("completion", `${Math.round((totalChecks / Math.max(1, days * visible.length)) * 100)}%`, `last ${days} days`);
	tile("perfect days", String(perfect), "every habit done");
	if (best) tile("best streak now", `${best.b.currentStreak}d`, best.h.label.toLowerCase());

	el.createDiv({ cls: "sbd-day-group", text: "completion by habit" });
	hbars(el, stats.map(({ h, b }) => ({ label: h.label, value: Math.round(b.rate * 100), note: `${b.trueDays}/${b.days}d` })), { unit: "%" });
}

export function renderHabitStats(el: HTMLElement, ctx: DashboardContext, entries: TrackerEntry[], st: HabitBoardState, update: (p: Partial<HabitBoardState>) => void): void {
	const s = ctx.plugin.settings;
	const all = s.habits;
	if (!all.length) { noHabits(el, ctx); return; }
	const focus = st.focus ? all.find((h) => h.key === st.focus) : undefined;
	if (focus) { renderHabitFocus(el, ctx, entries, focus, st, update); return; }

	const visible = all.filter((h) => !st.hidden.includes(h.key));
	const { start, end } = rangeBounds(st.range, ctx.today, entries);
	const done = doneMap(entries);

	// Toggle chips: which habits the board covers.
	const chips = el.createDiv({ cls: "sbd-habit-chips" });
	for (const h of all) {
		const on = !st.hidden.includes(h.key);
		const c = chips.createDiv({ cls: `sbd-habit-chip ${on ? "is-on" : ""}`, attr: { "aria-label": on ? "Hide from stats" : "Show in stats", role: "switch", "aria-checked": String(on) } });
		habitIcon(c.createSpan({ cls: "sbd-icon" }), h);
		c.createSpan({ text: h.label });
		c.onclick = () => update({ hidden: on ? [...st.hidden, h.key] : st.hidden.filter((k) => k !== h.key) });
	}
	if (st.hidden.length) chips.createDiv({ cls: "sbd-habit-chip is-ghost", text: "show all" }).onclick = () => update({ hidden: [] });
	if (!visible.length) { emptyState(el, "All habits hidden — pick one above."); return; }

	// One combined table: every habit's numbers and its heatmap strip side by side.
	const span = diffDays(end, start) + 1;
	const weekly = span > 92;
	const stripStart = weekly ? periodStart(span > 371 ? addDays(end, -364) : start, "week", s.weekStartsMonday) : start;
	const buckets: { start: string; end: string }[] = [];
	for (let d = stripStart; d <= end; d = addDays(d, weekly ? 7 : 1)) buckets.push({ start: d, end: weekly ? addDays(d, 6) : d });

	const card = el.createDiv({ cls: "sbd-card sbd-matrix-card" });
	const table = card.createDiv({ cls: "sbd-matrix", attr: { role: "table" } });
	const head = table.createDiv({ cls: "sbd-matrix-row is-head", attr: { role: "row" } });
	head.createDiv({ cls: "sbd-mx-name", text: "habit" });
	head.createDiv({ cls: "sbd-mx-num", text: "streak" });
	head.createDiv({ cls: "sbd-mx-num", text: "best" });
	head.createDiv({ cls: "sbd-mx-num", text: "rate" });
	const range = head.createDiv({ cls: "sbd-mx-strip-head" });
	range.createSpan({ text: moment(stripStart).format("MMM D") });
	range.createSpan({ text: weekly ? "each square = a week" : "each square = a day" });
	range.createSpan({ text: moment(end).format("MMM D") });
	head.createDiv({ cls: "sbd-mx-goal", text: "this week" });
	head.createDiv({ cls: "sbd-mx-act" });

	for (const h of visible) {
		const f = habitField(h);
		const b = boolStats(entries, f, start, end, ctx.today);
		const g = goalProgress(entries, f, ctx.today, s.weekStartsMonday);
		const row = table.createDiv({ cls: "sbd-matrix-row", attr: { role: "row" } });
		const name = row.createDiv({ cls: "sbd-mx-name" });
		habitIcon(name.createSpan({ cls: "sbd-icon" }), h);
		name.createSpan({ text: h.label });
		row.createDiv({ cls: "sbd-mx-num", text: b.currentStreak ? `${b.currentStreak}d` : "–" });
		row.createDiv({ cls: "sbd-mx-num", text: `${b.longestStreak}d` });
		row.createDiv({ cls: "sbd-mx-num", text: `${Math.round(b.rate * 100)}%` });
		const strip = row.createDiv({ cls: "sbd-strip" });
		strip.style.gridTemplateColumns = `repeat(${buckets.length}, minmax(0, 1fr))`;
		for (const bk of buckets) {
			let n = 0, total = 0;
			for (let d = bk.start; d <= bk.end && d <= end; d = addDays(d, 1)) { total++; if (done.get(d)?.has(h.key)) n++; }
			const level = weekly ? (n === 0 ? 0 : Math.min(4, Math.ceil((n / 7) * 4))) : n ? 4 : 0;
			strip.createDiv({
				cls: `sbd-strip-cell sbd-heat-${level} ${bk.start === ctx.today ? "is-today" : ""}`,
				attr: { title: weekly ? `week of ${moment(bk.start).format("MMM D")} · ${n}/${total} days` : `${moment(bk.start).format("ddd MMM D")} · ${n ? "done" : "—"}` },
			});
		}
		const goal = row.createDiv({ cls: "sbd-mx-goal" });
		if (g) {
			const bar = goal.createDiv({ cls: "sbd-goal-track" });
			bar.createDiv({ cls: "sbd-goal-fill" }).style.width = `${g.ratio * 100}%`;
			goal.createSpan({ cls: g.onTrack ? "is-good" : "is-behind", text: `${g.value}/${h.target}` });
		}
		const act = row.createDiv({ cls: "sbd-mx-act" });
		const fb = act.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": `Focus on ${h.label}` } });
		setIcon(fb, "maximize-2");
		fb.onclick = () => update({ focus: h.key });
	}

	// Habits done per day across the visible habits.
	const chart = el.createDiv({ cls: "sbd-card" });
	const ch = chart.createDiv({ cls: "sbd-card-head" });
	ch.createSpan({ cls: "sbd-card-title", text: "habits done per day" });
	ch.createSpan({ cls: "sbd-muted", text: `out of ${visible.length}` });
	const series: { label: string; value: number | null; tip: string }[] = [];
	const chartStart = span > 120 ? addDays(end, -119) : start;
	for (let d = chartStart; d <= end; d = addDays(d, 1)) {
		const names = visible.filter((h) => done.get(d)?.has(h.key)).map((h) => h.label);
		series.push({ label: moment(d).format("MMM D"), value: names.length, tip: `${moment(d).format("ddd MMM D")} · ${names.length}/${visible.length}${names.length ? ` — ${names.join(", ")}` : ""}` });
	}
	barChart(chart, series, { height: 110, goal: visible.length });
}

function goalLine(parent: HTMLElement, entries: TrackerEntry[], h: HabitDef, ctx: DashboardContext): void {
	const g = goalProgress(entries, habitField(h), ctx.today, ctx.plugin.settings.weekStartsMonday);
	if (!g) return;
	const box = parent.createDiv({ cls: "sbd-goal" });
	const track = box.createDiv({ cls: "sbd-goal-track" });
	track.createDiv({ cls: "sbd-goal-fill" }).style.width = `${g.ratio * 100}%`;
	track.createDiv({ cls: "sbd-goal-pace" }).style.left = `${Math.min(1, g.expected / g.target) * 100}%`;
	const status = box.createSpan({ cls: `sbd-goal-status ${g.onTrack ? "is-good" : "is-behind"}` });
	setIcon(status.createSpan({ cls: "sbd-icon" }), g.onTrack ? "check" : "alert-triangle");
	status.createSpan({ text: `${g.value} / ${g.target} days this week · ${g.onTrack ? "on track" : "behind"}` });
}

function renderHabitFocus(el: HTMLElement, ctx: DashboardContext, entries: TrackerEntry[], h: HabitDef, st: HabitBoardState, update: (p: Partial<HabitBoardState>) => void): void {
	const s = ctx.plugin.settings;
	const f = habitField(h);
	const { start, end } = rangeBounds(st.range, ctx.today, entries);
	const done = doneMap(entries);

	const head = el.createDiv({ cls: "sbd-hub-head" });
	const back = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "All habits" } });
	setIcon(back, "arrow-left");
	back.onclick = () => update({ focus: undefined });
	habitIcon(head.createSpan({ cls: "sbd-icon sbd-focus-icon" }), h);
	head.createSpan({ cls: "sbd-hub-name", text: h.label });
	// Switch focus between habits without going back.
	const sw = head.createEl("select", { cls: "dropdown" });
	for (const x of s.habits) sw.createEl("option", { value: x.key, text: x.label });
	sw.value = h.key;
	sw.onchange = () => update({ focus: sw.value });

	const b = boolStats(entries, f, start, end, ctx.today);
	const tiles = el.createDiv({ cls: "sbd-mini-stats" });
	for (const [label, value] of [["current streak", `${b.currentStreak}d`], ["longest streak", `${b.longestStreak}d`], ["completion", `${Math.round(b.rate * 100)}%`], ["days done", `${b.trueDays}/${b.days}`], ["weekly goal", `${h.target} days`]] as const) {
		const x = tiles.createDiv({ cls: "sbd-mini-stat" });
		x.createDiv({ cls: "sbd-mini-stat-value", text: value });
		x.createDiv({ cls: "sbd-mini-stat-label", text: label });
	}

	const year = el.createDiv({ cls: "sbd-card" });
	year.createDiv({ cls: "sbd-card-head" }).createSpan({ cls: "sbd-card-title", text: "last 12 months" });
	const vals = new Map([...done.entries()].filter(([, set]) => set.has(h.key)).map(([d]) => [d, 1]));
	heatmap(year, vals, addDays(ctx.today, -364), ctx.today, { weekStartsMonday: s.weekStartsMonday, tip: (d, v) => `${moment(d).format("ddd MMM D")} · ${v ? "done" : "—"}` });
	goalLine(year, entries, h, ctx);

	const weeks = el.createDiv({ cls: "sbd-card" });
	weeks.createDiv({ cls: "sbd-card-head" }).createSpan({ cls: "sbd-card-title", text: "days per week" });
	const series: { label: string; value: number; tip: string }[] = [];
	for (let w = periodStart(addDays(ctx.today, -7 * 25), "week", s.weekStartsMonday); w <= ctx.today; w = addDays(w, 7)) {
		let n = 0;
		for (let d = w; d <= addDays(w, 6); d = addDays(d, 1)) if (done.get(d)?.has(h.key)) n++;
		series.push({ label: moment(w).format("MMM D"), value: n, tip: `week of ${moment(w).format("MMM D")} · ${n}/${h.target} days` });
	}
	barChart(weeks, series, { height: 130, goal: h.target });
}

// ---------- Manage habits ----------

export class HabitsModal extends Modal {
	private rows: HabitDef[];

	constructor(app: App, private plugin: SecondBrainPlugin, private onDone: () => void) {
		super(app);
		this.rows = plugin.settings.habits.map((h) => ({ ...h }));
	}

	onOpen(): void {
		this.setTitle("Habits");
		this.modalEl.addClass("sbd-links-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ cls: "sbd-modal-help", text: "Each habit is a checkbox saved in your daily note's frontmatter (key: true). Goal = days per week." });
		const head = contentEl.createDiv({ cls: "sbd-link-row sbd-habit-row is-head" });
		for (const t of ["", "name", "frontmatter key", "days / week", ""]) head.createSpan({ text: t });
		this.rows.forEach((h, i) => {
			const row = contentEl.createDiv({ cls: "sbd-link-row sbd-habit-row" });
			const iconBtn = row.createEl("button", { cls: "sbd-link-icon", attr: { "aria-label": "Choose icon" } });
			habitIcon(iconBtn, h);
			iconBtn.onclick = () => new IconPickerModal(this.app, (icon) => { h.icon = icon; this.render(); }).open();
			const label = row.createEl("input", { type: "text", value: h.label, attr: { placeholder: "e.g. Drink water" } });
			const key = row.createEl("input", { type: "text", value: h.key, attr: { placeholder: "water" } });
			label.oninput = () => {
				const auto = !h.key || h.key === slugKey(h.label);
				h.label = label.value;
				if (auto) { h.key = slugKey(label.value); key.value = h.key; }
			};
			key.oninput = () => { h.key = slugKey(key.value); };
			const target = row.createEl("input", { type: "number", value: String(h.target), attr: { min: "1", max: "7" } });
			target.oninput = () => { h.target = Math.max(1, Math.min(7, Number(target.value) || 1)); };
			const actions = row.createDiv({ cls: "sbd-row-actions" });
			for (const [icon, tip, fn] of [
				["arrow-up", "Move up", () => { if (i > 0) { [this.rows[i - 1], this.rows[i]] = [this.rows[i], this.rows[i - 1]]; this.render(); } }],
				["arrow-down", "Move down", () => { if (i < this.rows.length - 1) { [this.rows[i + 1], this.rows[i]] = [this.rows[i], this.rows[i + 1]]; this.render(); } }],
				["trash-2", "Remove (past checks stay in your notes)", () => { this.rows.splice(i, 1); this.render(); }],
			] as const) {
				const b = actions.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": tip } });
				setIcon(b, icon);
				b.onclick = fn;
			}
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("+ habit").onClick(() => { this.rows.push({ key: "", label: "", icon: "check", target: 7 }); this.render(); }))
			.addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.save()));
	}

	private async save(): Promise<void> {
		const rows = this.rows.filter((h) => h.label.trim()).map((h) => ({ ...h, key: h.key || slugKey(h.label) }));
		const keys = rows.map((h) => h.key);
		if (new Set(keys).size !== keys.length) { new Notice("Two habits use the same key."); return; }
		this.plugin.settings.habits = rows;
		await this.plugin.persist();
		this.plugin.trackers.invalidate();
		this.close();
		this.onDone();
	}

	onClose(): void { this.contentEl.empty(); }
}
