import { moment, setIcon } from "obsidian";
import {
	addDays, boolStats, countByPeriod, dailySeries, diffDays, funnel, goalProgress, numericStats, periodStart,
	rangeBounds, ratingDistribution, statusCounts, toBool, toNumber,
	type RangeKey, type TrackerDef, type TrackerEntry, type TrackerField,
} from "../data/trackerTypes";
import { barChart, formatNum, hbars, heatmap, lineChart, sparkline } from "./charts";
import { emptyState, pill, section, whenLoaded, type DashboardContext } from "./components";
import { HabitsModal, renderHabitStats, renderHabitSummary, renderHabitWeek } from "./habits";
import { EntryModal, TrackerEditModal } from "./trackerModals";
import { moneyCard, renderMoney, type MoneyState } from "./moneyView";
import { pageGlyph } from "./pageIcons";

export interface TrackersState {
	/** A custom (non-habit) tracker opened in detail. */
	selected?: string;
	range: RangeKey;
	/** Habit keys hidden from the statistics board. */
	hidden: string[];
	/** Habit shown in the focus view. */
	focus?: string;
	/** Week shown in the habit grid, relative to this week. */
	weekOffset: number;
	/** Money view state (month, filters). */
	money?: MoneyState;
}

const RANGES: { id: RangeKey; label: string }[] = [
	{ id: "week", label: "7d" }, { id: "month", label: "30d" }, { id: "quarter", label: "90d" }, { id: "year", label: "1y" }, { id: "all", label: "all" },
];

/** Sums make sense for amounts (pages, money, time); measurements (weight, sleep) show latest + average. */
function isSumField(f: TrackerField): boolean {
	return f.goal?.agg === "sum" || f.type === "duration" || f.type === "money";
}

function latest(entries: TrackerEntry[], f: TrackerField, end: string): number | null {
	const withVal = entries.filter((e) => e.date && e.date <= end && toNumber(e.values[f.key], f.type) !== null)
		.sort((a, b) => b.date!.localeCompare(a.date!));
	return withVal.length ? toNumber(withVal[0].values[f.key], f.type) : null;
}

function rangeToggle(parent: HTMLElement, st: TrackersState, update: (p: Partial<TrackersState>) => void): void {
	const seg = parent.createDiv({ cls: "sbd-segmented" });
	for (const r of RANGES) {
		const b = seg.createEl("button", { text: r.label, cls: st.range === r.id ? "is-active" : "" });
		b.onclick = () => update({ range: r.id });
	}
}

export function renderTrackersTab(el: HTMLElement, ctx: DashboardContext, st: TrackersState, update: (p: Partial<TrackersState>) => void): void {
	const defs = ctx.plugin.settings.trackers;
	if (st.selected === "__money") {
		const ms: MoneyState = { filter: "all", query: "", ...(st.money ?? {}) };
		renderMoney(el, ctx, ms, (p) => update({ money: { ...ms, ...p } }), () => update({ selected: undefined }));
		return;
	}
	if (st.selected === "__habits") {
		renderHabitsPage(el, ctx, st, update);
		return;
	}
	const selected = st.selected ? defs.find((d) => d.id === st.selected) : undefined;

	if (selected) {
		const toolbar = el.createDiv({ cls: "sbd-toolbar" });
		const back = toolbar.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "All trackers" } });
		setIcon(back, "arrow-left");
		back.onclick = () => update({ selected: undefined });
		rangeToggle(toolbar, st, update);
		renderDetail(el, ctx, selected, st.range);
		return;
	}

	// ---- Trackers home: one card per tracker ----
	const home = section(el, {
		title: "trackers", icon: "activity",
		action: { label: "New tracker", icon: "plus", onClick: () => new TrackerEditModal(ctx.app, ctx.plugin).open() },
	});
	const grid = home.createDiv({ cls: "sbd-home-grid" });
	habitsCard(grid, ctx, () => update({ selected: "__habits" }));
	moneyCard(grid, ctx, () => update({ selected: "__money" }));
	if (defs.length) {
		const other = section(el, { title: "other trackers", icon: "bar-chart-3" });
		const bar = other.createDiv({ cls: "sbd-toolbar" });
		rangeToggle(bar, st, update);
		renderOverview(other, ctx, defs, st.range, (id) => update({ selected: id }));
	} else {
		home.createDiv({ cls: "sbd-empty sbd-home-hint", text: "Track anything else with numbers or stages (workouts, weight, job applications) from daily notes, one note per item, or a table. Use + to add one." });
	}
}

/** Card for the trackers home: today's habits and the last seven days. */
function habitsCard(grid: HTMLElement, ctx: DashboardContext, open: () => void): void {
	const habitsDefs = ctx.plugin.settings.habits;
	const card = grid.createDiv({ cls: "sbd-home-card sbd-habits-card", attr: { role: "button", tabindex: "0", "aria-label": "Open habits" } });
	card.onclick = open;
	card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
	const head = card.createDiv({ cls: "sbd-home-card-head" });
	const hIcon = head.createSpan({ cls: "sbd-home-card-icon sbd-c-violet" });
	if (!pageGlyph(hIcon, "habits")) setIcon(hIcon, "check-square");
	head.createSpan({ cls: "sbd-home-card-name", text: "Habits" });
	const manage = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Manage habits" } });
	setIcon(manage, "settings-2");
	manage.onclick = (e) => { e.stopPropagation(); new HabitsModal(ctx.app, ctx.plugin, () => ctx.rerender()).open(); };
	const body = card.createDiv({ cls: "sbd-home-card-body" });
	if (!habitsDefs.length) { body.createDiv({ cls: "sbd-empty", text: "No habits yet. Use the gear to add some." }); return; }
	whenLoaded(body, ctx.plugin.trackers.habitEntries(), (entries) => {
		const byDate = new Map(entries.filter((e) => e.date).map((e) => [e.date!, e]));
		const doneOn = (date: string) => habitsDefs.filter((h) => toBool(byDate.get(date)?.values[h.key]) === true).length;
		const today = doneOn(ctx.today);
		const big = body.createDiv({ cls: "sbd-home-card-big" });
		big.createSpan({ text: `${today}/${habitsDefs.length}` });
		big.createSpan({ cls: "sbd-home-card-unit", text: today === habitsDefs.length ? " all done today" : " done today" });
		const week = body.createDiv({ cls: "sbd-habits-week", attr: { "aria-label": "Last seven days" } });
		let streak = 0, counting = true;
		for (let i = 6; i >= 0; i--) {
			const date = addDays(ctx.today, -i);
			const n = doneOn(date);
			const col = week.createDiv({ cls: "sbd-habits-day" + (date === ctx.today ? " is-today" : ""), attr: { title: `${date}: ${n}/${habitsDefs.length}` } });
			const bar = col.createDiv({ cls: "sbd-habits-bar" });
			bar.createDiv({ cls: "sbd-habits-fill", attr: { style: `height: ${(n / habitsDefs.length) * 100}%` } });
			col.createSpan({ cls: "sbd-habits-dow", text: moment(date).format("dd").slice(0, 2) });
		}
		for (let i = 0; i < 365 && counting; i++) {
			const n = doneOn(addDays(ctx.today, -i - (today < habitsDefs.length ? 1 : 0)));
			if (n === habitsDefs.length) streak++; else counting = false;
		}
		const facts = body.createDiv({ cls: "sbd-home-card-facts" });
		const fact = (label: string, value: string) => { const f = facts.createDiv(); f.createDiv({ cls: "sbd-muted", text: label }); f.createDiv({ cls: "sbd-home-card-fact", text: value }); };
		const last7 = Array.from({ length: 7 }, (_, i) => doneOn(addDays(ctx.today, -i))).reduce((a, b) => a + b, 0);
		fact("This week", `${Math.round((last7 / (habitsDefs.length * 7)) * 100)}%`);
		fact("Perfect streak", `${streak} ${streak === 1 ? "day" : "days"}`);
		fact("Habits", String(habitsDefs.length));
	});
}

/** The full habits page: checkboxes for the week, a summary, and statistics. */
function renderHabitsPage(el: HTMLElement, ctx: DashboardContext, st: TrackersState, update: (p: Partial<TrackersState>) => void): void {
	const toolbar = el.createDiv({ cls: "sbd-toolbar" });
	const back = toolbar.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "All trackers" } });
	setIcon(back, "arrow-left");
	back.onclick = () => update({ selected: undefined });
	toolbar.createEl("h2", { cls: "sbd-page-subtitle", text: "Habits" });
	const habits = ctx.plugin.trackers.habitEntries();
	const manage = () => new HabitsModal(ctx.app, ctx.plugin, () => ctx.rerender()).open();

	// ---- Habit checkboxes (any day) beside a summary of the week ----
	const top = el.createDiv({ cls: "sbd-habit-top" });
	const week = section(top, { title: "habits", icon: "check-square", action: { label: "Manage habits", icon: "settings-2", onClick: manage } });
	const anchor = addDays(ctx.today, st.weekOffset * 7);
	whenLoaded(week, habits, (entries) => renderHabitWeek(week, ctx, entries, anchor, (d) => update({ weekOffset: d === 0 ? 0 : st.weekOffset + d })));
	const summary = section(top, { title: "at a glance", icon: "gauge", cls: "sbd-habit-summary-col" });
	whenLoaded(summary, habits, (entries) => renderHabitSummary(summary, ctx, entries, { range: st.range, hidden: st.hidden }));

	// ---- Statistics over every habit ----
	const stats = section(el, { title: "statistics", icon: "bar-chart-3" });
	const bar = stats.createDiv({ cls: "sbd-toolbar" });
	rangeToggle(bar, st, update);
	whenLoaded(stats, habits, (entries) => renderHabitStats(stats, ctx, entries, { range: st.range, hidden: st.hidden, focus: st.focus }, (p) => update(p)));
}

function trackerHead(parent: HTMLElement, ctx: DashboardContext, def: TrackerDef, big = false): void {
	const head = parent.createDiv({ cls: big ? "sbd-hub-head" : "sbd-tracker-head" });
	setIcon(head.createSpan({ cls: "sbd-icon" }), def.icon || "activity");
	head.createSpan({ cls: big ? "sbd-hub-name" : "sbd-tracker-name", text: def.name });
	{
		pill(head, def.source === "daily" ? "daily notes" : def.source === "notes" ? (def.folder || `#${def.tag}`) : "table", "gray");
		const log = head.createEl("button", { cls: big ? "mod-cta" : "sbd-icon-btn clickable-icon", attr: { "aria-label": "Log entry" } });
		if (big) log.setText("+ log entry"); else setIcon(log, "plus");
		log.onclick = (e) => { e.stopPropagation(); new EntryModal(ctx.app, ctx.plugin, def).open(); };
		const edit = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Edit tracker" } });
		setIcon(edit, "settings-2");
		edit.onclick = (e) => { e.stopPropagation(); new TrackerEditModal(ctx.app, ctx.plugin, def).open(); };
	}
}

function renderOverview(el: HTMLElement, ctx: DashboardContext, defs: TrackerDef[], range: RangeKey, open: (id: string) => void): void {
	const grid = el.createDiv({ cls: "sbd-tracker-grid" });
	for (const def of defs) {
		const card = grid.createDiv({ cls: "sbd-tracker-card" });
		card.onclick = () => open(def.id);
		trackerHead(card, ctx, def);
		const body = card.createDiv({ cls: "sbd-tracker-fields" });
		whenLoaded(body, ctx.plugin.trackers.entries(def), (entries) => {
			const { start, end } = rangeBounds(range, ctx.today, entries);
			if (!entries.length) emptyState(body, def.source === "daily" ? `No values yet. Add e.g. "${def.fields[0]?.key}: …" to a daily note's frontmatter, or log an entry.` : "No entries yet.");
			else for (const f of def.fields) fieldSummary(body, ctx, f, entries, start, end);
		});
	}
}

/** One compact line per field: label · headline · sparkline · goal bar. */
function fieldSummary(parent: HTMLElement, ctx: DashboardContext, f: TrackerField, entries: TrackerEntry[], start: string, end: string): void {
	const row = parent.createDiv({ cls: "sbd-field-row" });
	row.createSpan({ cls: "sbd-field-label", text: f.label });
	const headline = row.createSpan({ cls: "sbd-field-headline" });
	const spark = row.createSpan({ cls: "sbd-field-spark" });
	const sparkStart = diffDays(end, start) > 60 ? addDays(end, -59) : start;
	switch (f.type) {
		case "boolean": {
			const b = boolStats(entries, f, start, end, ctx.today);
			headline.setText(`🔥 ${b.currentStreak}d · ${Math.round(b.rate * 100)}%`);
			sparkline(spark, dailySeries(entries, f, sparkStart, end).map((p) => p.value ?? 0));
			break;
		}
		case "status": {
			const c = statusCounts(entries, f);
			headline.setText(c.filter((x) => x.count).slice(0, 3).map((x) => `${x.value} ${x.count}`).join(" · ") || "-");
			break;
		}
		case "rating": {
			const r = ratingDistribution(entries.filter((e) => !e.date || (e.date >= start && e.date <= end)), f);
			headline.setText(r.count ? `★ ${r.avg.toFixed(1)} · ${r.count}` : "-");
			sparkline(spark, dailySeries(entries, f, sparkStart, end).map((p) => p.value), "line");
			break;
		}
		case "text": case "date":
			headline.setText(`${entries.filter((e) => e.values[f.key]).length} entries`);
			break;
		default: {
			const n = numericStats(entries, f, start, end);
			const last = latest(entries, f, end);
			headline.setText(!n.count ? "-" : isSumField(f) ? `${formatNum(n.total, f.unit)} · avg ${formatNum(n.avg)}` : `${formatNum(last ?? n.avg, f.unit)} · avg ${formatNum(n.avg)}`);
			const series = dailySeries(entries, f, sparkStart, end).map((p) => p.value);
			sparkline(spark, series, isSumField(f) ? "bar" : "line");
		}
	}
	const g = goalProgress(entries, f, ctx.today, ctx.plugin.settings.weekStartsMonday);
	if (g) goalBar(parent, f, g);
}

function goalBar(parent: HTMLElement, f: TrackerField, g: NonNullable<ReturnType<typeof goalProgress>>): void {
	const box = parent.createDiv({ cls: "sbd-goal" });
	const track = box.createDiv({ cls: "sbd-goal-track" });
	track.createDiv({ cls: "sbd-goal-fill" }).style.width = `${g.ratio * 100}%`;
	if (f.goal!.agg !== "avg") track.createDiv({ cls: "sbd-goal-pace", attr: { "aria-label": "Expected by today" } }).style.left = `${Math.min(1, g.expected / g.target) * 100}%`;
	const status = box.createSpan({ cls: `sbd-goal-status ${g.onTrack ? "is-good" : "is-behind"}` });
	setIcon(status.createSpan({ cls: "sbd-icon" }), g.onTrack ? "check" : "alert-triangle");
	const per = { day: "today", week: "this week", month: "this month", year: "this year" }[f.goal!.period];
	status.createSpan({ text: `${formatNum(g.value)} / ${formatNum(g.target)} ${f.goal!.agg === "avg" ? "avg " : ""}${per} · ${g.onTrack ? "on track" : "behind"}` });
}

function renderDetail(el: HTMLElement, ctx: DashboardContext, def: TrackerDef, range: RangeKey): void {
	trackerHead(el, ctx, def, true);
	const body = el.createDiv();
	whenLoaded(body, ctx.plugin.trackers.entries(def), (entries) => {
		const { start, end } = rangeBounds(range, ctx.today, entries);
		if (!entries.length) { emptyState(body, "No entries yet. Use “+ log entry” or add values to your notes."); return; }
		const grid = body.createDiv({ cls: "sbd-grid" });
		for (const f of def.fields) fieldDetail(grid, ctx, f, entries, start, end);
		entriesTable(body, ctx, def, entries, start, end);
	});
}

function tiles(parent: HTMLElement, items: [string, string][]): void {
	const row = parent.createDiv({ cls: "sbd-mini-stats" });
	for (const [label, value] of items) {
		const t = row.createDiv({ cls: "sbd-mini-stat" });
		t.createDiv({ cls: "sbd-mini-stat-value", text: value });
		t.createDiv({ cls: "sbd-mini-stat-label", text: label });
	}
}

function fieldDetail(grid: HTMLElement, ctx: DashboardContext, f: TrackerField, entries: TrackerEntry[], start: string, end: string): void {
	const card = grid.createDiv({ cls: `sbd-card sbd-field-card ${f.type === "boolean" ? "sbd-span-2" : ""}` });
	const head = card.createDiv({ cls: "sbd-card-head" });
	head.createSpan({ cls: "sbd-card-title", text: f.label });
	head.createSpan({ cls: "sbd-muted", text: f.type + (f.unit ? ` · ${f.unit}` : "") });
	const s = ctx.plugin.settings;
	const days = diffDays(end, start) + 1;
	const short = (d: string) => moment(d).format(days > 120 ? "MMM" : "MMM D");

	switch (f.type) {
		case "boolean": {
			const b = boolStats(entries, f, start, end, ctx.today);
			tiles(card, [["current streak", `${b.currentStreak}d`], ["longest streak", `${b.longestStreak}d`], ["completion", `${Math.round(b.rate * 100)}%`], ["days done", `${b.trueDays}/${b.days}`]]);
			const hmStart = days < 84 ? addDays(end, -83) : start;
			const vals = new Map(entries.filter((e) => e.date && toBool(e.values[f.key]) === true).map((e) => [e.date!, 1]));
			heatmap(card, vals, hmStart, end, { weekStartsMonday: s.weekStartsMonday, tip: (d, v) => `${moment(d).format("ddd, MMM D")} · ${v ? "done" : "-"}` });
			break;
		}
		case "status": {
			const counts = statusCounts(entries, f);
			tiles(card, [["items", String(counts.reduce((a, c) => a + c.count, 0))], ...counts.filter((c) => c.count).slice(0, 3).map((c) => [c.value, String(c.count)] as [string, string])]);
			hbars(card, counts.map((c) => ({ label: c.value, value: c.count })));
			if (f.funnel && (f.options?.length ?? 0) >= 2) {
				card.createDiv({ cls: "sbd-day-group", text: "funnel" });
				hbars(card, funnel(counts, f.options!).map((st) => ({ label: st.stage, value: st.reached, note: st.conversion === null ? undefined : `${Math.round(st.conversion * 100)}%` })));
			}
			break;
		}
		case "rating": {
			const inR = entries.filter((e) => !e.date || (e.date >= start && e.date <= end));
			const r = ratingDistribution(inR, f);
			tiles(card, [["average", r.count ? r.avg.toFixed(2) : "-"], ["ratings", String(r.count)]]);
			hbars(card, r.dist.map((n, i) => ({ label: "★".repeat(i + 1), value: n })).reverse());
			const series = dailySeries(entries, f, start, end);
			if (series.filter((p) => p.value !== null).length >= 3) lineChart(card, series.map((p) => ({ ...p, label: short(p.date) })), { height: 110 });
			break;
		}
		case "date": {
			const dated = entries.filter((e) => e.values[f.key]).map((e) => ({ ...e, date: String(e.values[f.key]).slice(0, 10) }));
			const buckets = countByPeriod(dated, start, end, days > 62 ? "month" : "week", s.weekStartsMonday);
			tiles(card, [["in range", String(buckets.reduce((a, b) => a + b.count, 0))]]);
			barChart(card, buckets.map((b) => ({ label: short(b.start), value: b.count, tip: `${b.start} · ${b.count}` })), { height: 120 });
			break;
		}
		case "text": {
			const recent = entries.filter((e) => e.values[f.key]).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8);
			tiles(card, [["entries", String(entries.filter((e) => e.values[f.key]).length)]]);
			for (const e of recent) {
				const row = card.createDiv({ cls: "sbd-note-row" });
				row.createSpan({ cls: "sbd-muted", text: e.date ?? "" });
				row.createSpan({ cls: "sbd-note-name", text: String(e.values[f.key]) });
				if (e.path) row.onclick = () => ctx.openPath(e.path);
			}
			break;
		}
		default: {
			const n = numericStats(entries, f, start, end);
			const trend = n.trend === null ? "-" : `${n.trend >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(n.trend * 100))}%`;
			const last = latest(entries, f, end);
			tiles(card, [
				isSumField(f) ? ["total", formatNum(n.total, f.unit)] : ["latest", last === null ? "-" : formatNum(last, f.unit)],
				["average", formatNum(n.avg)], ["min / max", `${formatNum(n.min)} / ${formatNum(n.max)}`],
				[isSumField(f) ? "vs prev." : "entries", isSumField(f) ? trend : String(n.count)],
			]);
			const g = f.goal;
			if (days > 62) {
				// Weekly totals for long ranges.
				const weeks: { label: string; value: number; tip: string }[] = [];
				for (let w = periodStart(start, "week", s.weekStartsMonday); w <= end; w = addDays(w, 7)) {
					const v = entries.filter((e) => e.date && e.date >= w && e.date <= addDays(w, 6))
						.reduce((a, e) => a + (toNumber(e.values[f.key], f.type) ?? 0), 0);
					weeks.push({ label: short(w), value: v, tip: `week of ${moment(w).format("MMM D")} · ${formatNum(v, f.unit)}` });
				}
				barChart(card, weeks, { height: 130, goal: g?.period === "week" && g.agg === "sum" ? g.target : undefined });
			} else if (!isSumField(f)) {
				// Measurements: a line on a fitted scale shows change; bars from zero would look flat.
				const series = dailySeries(entries, f, start, end);
				if (series.filter((p) => p.value !== null).length >= 3) lineChart(card, series.map((p) => ({ ...p, label: short(p.date) })), { height: 130, unit: f.unit, zero: false, goal: g?.agg === "avg" ? g.target : undefined });
			} else {
				const series = dailySeries(entries, f, start, end);
				const goalLine = g?.period === "day" ? g.target : undefined;
				barChart(card, series.map((p) => ({ label: short(p.date), value: p.value, tip: `${moment(p.date).format("ddd, MMM D")} · ${p.value === null ? "no entry" : formatNum(p.value, f.unit)}` })), { height: 130, goal: goalLine });
			}
		}
	}
	const gp = goalProgress(entries, f, ctx.today, s.weekStartsMonday);
	if (gp) goalBar(card, f, gp);
}

/** Table view of entries: the accessible, exact-values companion to the charts. */
function entriesTable(parent: HTMLElement, ctx: DashboardContext, def: TrackerDef, entries: TrackerEntry[], start: string, end: string): void {
	const rows = entries.filter((e) => !e.date || (e.date >= start && e.date <= end))
		.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name)).slice(0, 60);
	const wrap = parent.createDiv({ cls: "sbd-card sbd-entries" });
	const head = wrap.createDiv({ cls: "sbd-card-head" });
	head.createSpan({ cls: "sbd-card-title", text: "entries" });
	head.createSpan({ cls: "sbd-count", text: String(rows.length) });
	const scroller = wrap.createDiv({ cls: "sbd-table-wrap" });
	const table = scroller.createEl("table", { cls: "sbd-table" });
	const tr = table.createEl("thead").createEl("tr");
	tr.createEl("th", { text: "date" });
	const showName = def.source === "notes";
	if (showName) tr.createEl("th", { text: "name" });
	for (const f of def.fields) tr.createEl("th", { text: f.label });
	const tbody = table.createEl("tbody");
	for (const e of rows) {
		const r = tbody.createEl("tr");
		r.createEl("td", { text: e.date ?? "-" });
		if (showName) r.createEl("td", { text: e.name });
		for (const f of def.fields) {
			const v = e.values[f.key];
			const text = v === undefined || v === null || v === "" ? "" : f.type === "boolean" ? (toBool(v) ? "✓" : "✗") : Array.isArray(v) ? v.join(", ") : String(v);
			r.createEl("td", { text });
		}
		if (e.path) { r.addClass("is-clickable"); r.onclick = () => ctx.openPath(e.path); }
	}
}
