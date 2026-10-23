// Tracker definitions and the pure statistics engine. No Obsidian imports.

export type FieldType = "number" | "boolean" | "rating" | "status" | "date" | "duration" | "money" | "text";
export type GoalPeriod = "day" | "week" | "month" | "year";
export type GoalAgg = "count" | "sum" | "avg";

export interface TrackerGoal {
	target: number;
	period: GoalPeriod;
	/** count = entries where the field is truthy/present; sum/avg over numeric values. */
	agg: GoalAgg;
}

export interface TrackerField {
	key: string;
	label: string;
	type: FieldType;
	/** Ordered options for `status` fields (also the funnel order). */
	options?: string[];
	unit?: string;
	goal?: TrackerGoal;
	/** Status fields: options are ordered stages, so show a conversion funnel. */
	funnel?: boolean;
}

export type TrackerSource = "daily" | "notes" | "table";

export interface TrackerDef {
	id: string;
	name: string;
	icon: string;
	/**
	 * daily: values come from daily notes (frontmatter or `key:: value`).
	 * notes: one note per item, in a folder and/or with a tag.
	 * table: rows of a Markdown table in one note.
	 */
	source: TrackerSource;
	folder?: string;
	tag?: string;
	notePath?: string;
	/** For notes/table: the field holding the entry date (default `date`). */
	dateField?: string;
	fields: TrackerField[];
}

export interface TrackerEntry {
	/** YYYY-MM-DD, if the entry has one. */
	date?: string;
	path: string;
	name: string;
	values: Record<string, unknown>;
}

/** No numeric trackers by default; habits live in settings.habits. */
export const DEFAULT_TRACKERS: TrackerDef[] = [];

// ---------- Value coercion ----------

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "x", "✓", "✔", "✅", "done"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "", "-", "✗", "❌"]);

export function toBool(v: unknown): boolean | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v > 0;
	const s = String(v).trim().toLowerCase();
	if (TRUE_WORDS.has(s)) return true;
	if (FALSE_WORDS.has(s)) return false;
	return null;
}

/** Minutes from "1h30m", "90m", "1:30", "1.5h" or a bare number (minutes). */
export function toMinutes(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	if (typeof v === "number") return v;
	const s = String(v).trim().toLowerCase();
	const hm = s.match(/^(\d+):(\d{2})$/);
	if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
	const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)/g)];
	if (parts.length) return parts.reduce((acc, p) => acc + Number(p[1]) * (p[2].startsWith("h") ? 60 : 1), 0);
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

export function toNumber(v: unknown, type: FieldType = "number"): number | null {
	if (v === null || v === undefined || v === "") return null;
	if (type === "duration") return toMinutes(v);
	if (type === "boolean") { const b = toBool(v); return b === null ? null : b ? 1 : 0; }
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	let s = String(v).trim();
	if (type === "rating" && /^[⭐★]+$/u.test(s)) return [...s].length;
	if (type === "money") s = s.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "");
	const n = Number(s.replace(/,/g, "."));
	return Number.isFinite(n) ? n : null;
}

export function toDateStr(v: unknown): string | undefined {
	if (!v) return undefined;
	const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
	return m ? m[0] : undefined;
}

// ---------- Date helpers (local-time safe; dates are YYYY-MM-DD strings) ----------

export function addDays(date: string, n: number): string {
	const d = new Date(date + "T00:00:00");
	d.setDate(d.getDate() + n);
	return fmt(d);
}

export function fmt(d: Date): string {
	const pad = (x: number) => String(x).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function diffDays(a: string, b: string): number {
	return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function periodStart(today: string, period: GoalPeriod, weekStartsMonday = true): string {
	const d = new Date(today + "T00:00:00");
	switch (period) {
		case "day": return today;
		case "week": {
			const shift = weekStartsMonday ? (d.getDay() + 6) % 7 : d.getDay();
			d.setDate(d.getDate() - shift);
			return fmt(d);
		}
		case "month": return `${today.slice(0, 7)}-01`;
		case "year": return `${today.slice(0, 4)}-01-01`;
	}
}

export function periodEnd(start: string, period: GoalPeriod): string {
	const d = new Date(start + "T00:00:00");
	switch (period) {
		case "day": return start;
		case "week": d.setDate(d.getDate() + 6); return fmt(d);
		case "month": return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
		case "year": return `${start.slice(0, 4)}-12-31`;
	}
}

// ---------- Statistics ----------

export type RangeKey = "week" | "month" | "quarter" | "year" | "all";

export function rangeBounds(range: RangeKey, today: string, entries: TrackerEntry[]): { start: string; end: string } {
	switch (range) {
		case "week": return { start: addDays(today, -6), end: today };
		case "month": return { start: addDays(today, -29), end: today };
		case "quarter": return { start: addDays(today, -89), end: today };
		case "year": return { start: addDays(today, -364), end: today };
		case "all": {
			const dates = entries.map((e) => e.date).filter((d): d is string => !!d).sort();
			return { start: dates[0] ?? today, end: today };
		}
	}
}

export function inRange(e: TrackerEntry, start: string, end: string): boolean {
	return !!e.date && e.date >= start && e.date <= end;
}

export interface NumericStats {
	count: number;
	total: number;
	avg: number;
	min: number;
	max: number;
	/** Fractional change of the total vs the previous period of equal length (null if no baseline). */
	trend: number | null;
}

export function numericStats(entries: TrackerEntry[], field: TrackerField, start: string, end: string): NumericStats {
	const vals = (s: string, e: string) => entries.filter((x) => inRange(x, s, e))
		.map((x) => toNumber(x.values[field.key], field.type)).filter((n): n is number => n !== null);
	const cur = vals(start, end);
	const len = diffDays(end, start) + 1;
	const prev = vals(addDays(start, -len), addDays(start, -1));
	const total = cur.reduce((a, b) => a + b, 0);
	const prevTotal = prev.reduce((a, b) => a + b, 0);
	return {
		count: cur.length,
		total,
		avg: cur.length ? total / cur.length : 0,
		min: cur.length ? Math.min(...cur) : 0,
		max: cur.length ? Math.max(...cur) : 0,
		trend: prev.length && prevTotal !== 0 ? (total - prevTotal) / Math.abs(prevTotal) : null,
	};
}

export interface BoolStats {
	currentStreak: number;
	longestStreak: number;
	/** Days marked true / days in range. */
	rate: number;
	trueDays: number;
	days: number;
}

/** Streaks over calendar days: a day without an entry counts as "not done". */
export function boolStats(entries: TrackerEntry[], field: TrackerField, start: string, end: string, today: string): BoolStats {
	const done = new Set(entries.filter((e) => e.date && toBool(e.values[field.key]) === true).map((e) => e.date!));
	const days = diffDays(end, start) + 1;
	let trueDays = 0;
	for (let d = start; d <= end; d = addDays(d, 1)) if (done.has(d)) trueDays++;

	// Current streak: today counts if done; if not yet, start from yesterday.
	let cursor = done.has(today) ? today : addDays(today, -1);
	let currentStreak = 0;
	while (done.has(cursor)) { currentStreak++; cursor = addDays(cursor, -1); }

	let longestStreak = 0;
	let run = 0;
	let prev: string | null = null;
	for (const d of [...done].sort()) {
		run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
		longestStreak = Math.max(longestStreak, run);
		prev = d;
	}
	return { currentStreak, longestStreak, rate: days ? trueDays / days : 0, trueDays, days };
}

export interface CategoryCount { value: string; count: number }

export function statusCounts(entries: TrackerEntry[], field: TrackerField): CategoryCount[] {
	const counts = new Map<string, number>();
	for (const e of entries) {
		const v = e.values[field.key];
		if (v === null || v === undefined || v === "") continue;
		const key = String(v).trim().toLowerCase();
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const order = (field.options ?? []).map((o) => o.toLowerCase());
	const known = order.map((o) => ({ value: o, count: counts.get(o) ?? 0 }));
	const extra = [...counts.entries()].filter(([k]) => !order.includes(k))
		.map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
	return [...known, ...extra];
}

/** Funnel over ordered options: items that reached stage i or beyond. */
export function funnel(counts: CategoryCount[], options: string[]): { stage: string; reached: number; conversion: number | null }[] {
	const order = options.map((o) => o.toLowerCase());
	const byStage = order.map((o) => counts.find((c) => c.value === o)?.count ?? 0);
	return order.map((stage, i) => {
		const reached = byStage.slice(i).reduce((a, b) => a + b, 0);
		const prevReached = i === 0 ? null : byStage.slice(i - 1).reduce((a, b) => a + b, 0);
		return { stage, reached, conversion: prevReached ? reached / prevReached : null };
	});
}

export function ratingDistribution(entries: TrackerEntry[], field: TrackerField, max = 5): { avg: number; count: number; dist: number[] } {
	const vals = entries.map((e) => toNumber(e.values[field.key], "rating")).filter((n): n is number => n !== null);
	const dist = Array.from({ length: max }, (_, i) => vals.filter((v) => Math.round(v) === i + 1).length);
	return { avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, count: vals.length, dist };
}

export interface GoalProgress {
	value: number;
	target: number;
	/** value / target, clamped 0..1 for the bar. */
	ratio: number;
	/** Where you should be by now (linear pace). */
	expected: number;
	onTrack: boolean;
	periodStart: string;
	periodEnd: string;
}

export function goalProgress(entries: TrackerEntry[], field: TrackerField, today: string, weekStartsMonday = true): GoalProgress | null {
	const g = field.goal;
	if (!g || !g.target) return null;
	const start = periodStart(today, g.period, weekStartsMonday);
	const end = periodEnd(start, g.period);
	const inPeriod = entries.filter((e) => inRange(e, start, today));
	let value: number;
	if (g.agg === "count") {
		value = inPeriod.filter((e) => {
			const v = e.values[field.key];
			if (field.type === "boolean") return toBool(v) === true;
			return v !== null && v !== undefined && v !== "";
		}).length;
	} else {
		const nums = inPeriod.map((e) => toNumber(e.values[field.key], field.type)).filter((n): n is number => n !== null);
		value = g.agg === "sum" ? nums.reduce((a, b) => a + b, 0) : nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
	}
	const totalDays = diffDays(end, start) + 1;
	const elapsed = diffDays(today, start) + 1;
	const expected = g.agg === "avg" ? g.target : g.target * (elapsed / totalDays);
	return {
		value,
		target: g.target,
		ratio: Math.max(0, Math.min(1, value / g.target)),
		expected,
		onTrack: value >= expected - 1e-9,
		periodStart: start,
		periodEnd: end,
	};
}

/** Per-day series (one point per calendar day; missing days = null). */
export function dailySeries(entries: TrackerEntry[], field: TrackerField, start: string, end: string): { date: string; value: number | null }[] {
	const byDate = new Map<string, number>();
	for (const e of entries) {
		if (!inRange(e, start, end)) continue;
		const n = toNumber(e.values[field.key], field.type);
		if (n === null) continue;
		byDate.set(e.date!, field.type === "boolean" ? Math.max(byDate.get(e.date!) ?? 0, n) : (byDate.get(e.date!) ?? 0) + n);
	}
	const out: { date: string; value: number | null }[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, value: byDate.has(d) ? byDate.get(d)! : null });
	return out;
}

/** Entries counted per week or month (for collection trackers: "items per month"). */
export function countByPeriod(entries: TrackerEntry[], start: string, end: string, period: "week" | "month", weekStartsMonday = true): { label: string; start: string; count: number }[] {
	const buckets: { label: string; start: string; count: number }[] = [];
	let cursor = periodStart(start, period, weekStartsMonday);
	while (cursor <= end) {
		const bEnd = periodEnd(cursor, period);
		buckets.push({
			label: cursor,
			start: cursor,
			count: entries.filter((e) => inRange(e, cursor, bEnd)).length,
		});
		cursor = addDays(bEnd, 1);
	}
	return buckets;
}

export function slugKey(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "");
}

/** Parse Markdown tables in a note into rows keyed by slugged header. */
export function parseTables(content: string): Record<string, string>[] {
	const rows: Record<string, string>[] = [];
	const lines = content.split(/\r?\n/);
	let headers: string[] | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line.startsWith("|")) { headers = null; continue; }
		const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
		if (!headers) {
			const next = (lines[i + 1] ?? "").trim();
			if (/^\|?\s*:?-{2,}/.test(next)) { headers = cells.map(slugKey); i++; }
			continue;
		}
		const row: Record<string, string> = {};
		headers.forEach((h, j) => { row[h] = cells[j] ?? ""; });
		rows.push(row);
	}
	return rows;
}

/** Inline `key:: value` fields (whole-line and bracketed). Keys are slugged. */
export function parseInlineFields(content: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of content.matchAll(/^\s*(?:[-*]\s+)?([\p{L}\p{N}_ -]+?)::\s*(.*?)\s*$/gmu)) out[slugKey(m[1])] = m[2];
	for (const m of content.matchAll(/[[(]([\p{L}\p{N}_ -]+?)::\s*([^\])]*)[\])]/gu)) out[slugKey(m[1])] = m[2].trim();
	return out;
}
