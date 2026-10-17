import assert from "node:assert/strict";
import { calendarItems, monthGrid, weekDays } from "../src/data/calendar";
import {
	boolStats, countByPeriod, funnel, goalProgress, numericStats, parseInlineFields, parseTables, periodEnd, periodStart,
	ratingDistribution, statusCounts, toBool, toMinutes, toNumber, type TrackerEntry, type TrackerField,
} from "../src/data/trackerTypes";
import type { NoteInfo, Task } from "../src/types";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const e = (date: string | undefined, values: Record<string, unknown>): TrackerEntry => ({ date, path: "x.md", name: "x", values });

t("coercion", () => {
	assert.equal(toBool("yes"), true);
	assert.equal(toBool("✅"), true);
	assert.equal(toBool("no"), false);
	assert.equal(toBool("maybe"), null);
	assert.equal(toMinutes("1h30m"), 90);
	assert.equal(toMinutes("1:15"), 75);
	assert.equal(toMinutes("1.5h"), 90);
	assert.equal(toNumber("$1,250.50", "money"), 1250.5);
	assert.equal(toNumber("⭐⭐⭐⭐", "rating"), 4);
});

t("period bounds", () => {
	assert.equal(periodStart("2026-10-18", "week", true), "2026-10-12");
	assert.equal(periodStart("2026-10-18", "week", false), "2026-10-18");
	assert.equal(periodEnd("2026-10-12", "week"), "2026-10-18");
	assert.equal(periodEnd("2026-02-01", "month"), "2026-02-28");
	assert.equal(periodStart("2026-10-18", "year"), "2026-01-01");
});

const gym: TrackerField = { key: "gym", label: "Gym", type: "boolean", goal: { target: 4, period: "week", agg: "count" } };
const habit = [
	e("2026-10-10", { gym: true }), e("2026-10-11", { gym: true }), e("2026-10-12", { gym: true }),
	e("2026-10-14", { gym: "yes" }), e("2026-10-15", { gym: true }), e("2026-10-16", { gym: false }),
	e("2026-10-17", { gym: true }), e("2026-10-18", { gym: true }),
];

t("boolean streaks", () => {
	const b = boolStats(habit, gym, "2026-10-12", "2026-10-18", "2026-10-18");
	assert.equal(b.currentStreak, 2);
	assert.equal(b.longestStreak, 3);
	assert.equal(b.trueDays, 5);
	assert.equal(b.days, 7);
	// Today not logged yet: streak counts back from yesterday.
	assert.equal(boolStats(habit.slice(0, -1), gym, "2026-10-12", "2026-10-18", "2026-10-18").currentStreak, 1);
});

t("goal progress (count/week)", () => {
	const g = goalProgress(habit, gym, "2026-10-18", true)!;
	assert.equal(g.value, 5);
	assert.equal(g.target, 4);
	assert.ok(g.onTrack);
	assert.equal(g.ratio, 1);
	const mid = goalProgress(habit, gym, "2026-10-14", true)!; // Wed: 2 done (12, 14), pace 4*3/7≈1.7
	assert.equal(mid.value, 2);
	assert.ok(mid.onTrack);
});

t("numeric stats + trend", () => {
	const f: TrackerField = { key: "pages", label: "Pages", type: "number" };
	const entries = [e("2026-10-01", { pages: 10 }), e("2026-10-02", { pages: 30 }), e("2026-10-08", { pages: 20 }), e("2026-10-09", { pages: "40" })];
	const s = numericStats(entries, f, "2026-10-08", "2026-10-14");
	assert.equal(s.total, 60);
	assert.equal(s.avg, 30);
	assert.equal(s.min, 20);
	assert.equal(s.max, 40);
	assert.equal(s.trend, 0.5);
	const avgGoal = goalProgress(entries, { ...f, goal: { target: 25, period: "week", agg: "avg" } }, "2026-10-09")!; // week of Oct 5–11
	assert.equal(avgGoal.value, 30);
	assert.ok(avgGoal.onTrack);
});

t("status counts + funnel", () => {
	const f: TrackerField = { key: "status", label: "Status", type: "status", options: ["applied", "interview", "offer"] };
	const entries = [e(undefined, { status: "applied" }), e(undefined, { status: "Applied" }), e(undefined, { status: "interview" }), e(undefined, { status: "offer" }), e(undefined, { status: "ghosted" })];
	const c = statusCounts(entries, f);
	assert.deepEqual(c.map((x) => [x.value, x.count]), [["applied", 2], ["interview", 1], ["offer", 1], ["ghosted", 1]]);
	const fn = funnel(c, f.options!);
	assert.deepEqual(fn.map((x) => x.reached), [4, 2, 1]);
	assert.equal(fn[1].conversion, 0.5);
	assert.equal(fn[0].conversion, null);
});

t("rating distribution", () => {
	const r = ratingDistribution([e(undefined, { r: 5 }), e(undefined, { r: "4" }), e(undefined, { r: 4 })], { key: "r", label: "R", type: "rating" });
	assert.deepEqual(r.dist, [0, 0, 0, 2, 1]);
	assert.equal(r.avg.toFixed(2), "4.33");
});

t("countByPeriod", () => {
	const b = countByPeriod([e("2026-09-03", {}), e("2026-10-01", {}), e("2026-10-20", {})], "2026-09-01", "2026-10-31", "month");
	assert.deepEqual(b.map((x) => x.count), [1, 2]);
});

t("table + inline field parsing", () => {
	const rows = parseTables("# Log\n\n| Date | Weight (kg) | Notes |\n|---|---|---|\n| 2026-10-17 | 80 | ok |\n| 2026-10-18 | 79.5 | |\n\nAfter");
	assert.equal(rows.length, 2);
	assert.equal(rows[1]["weight-kg"], "79.5");
	assert.equal(rows[0].date, "2026-10-17");
	const f = parseInlineFields("Sleep:: 7.5\n- mood:: 4\nText [gym:: true] more");
	assert.deepEqual(f, { sleep: "7.5", mood: "4", gym: "true" });
});

t("month grid + week days", () => {
	const g = monthGrid(2026, 9, true); // Oct 2026 starts Thursday
	assert.equal(g[0][0], "2026-09-28");
	assert.equal(g[0][3], "2026-10-01");
	assert.equal(g[g.length - 1][6] >= "2026-10-31", true);
	assert.equal(g.length, 5);
	assert.deepEqual(weekDays("2026-10-18", true).slice(0, 2), ["2026-10-12", "2026-10-13"]);
});

t("calendar items", () => {
	const task = { id: "a", path: "a.md", line: 0, raw: "", text: "Ship", status: "todo", statusChar: " ", priority: 1, labels: [], links: [], fileMtime: 0, due: "2026-10-20" } as Task;
	const done = { ...task, id: "b", status: "done", due: undefined, doneDate: "2026-10-18" } as Task;
	const note: NoteInfo = { path: "m.md", name: "Standup", kind: "note", mtime: Date.parse("2026-10-18T10:00:00"), ctime: Date.parse("2026-10-18T09:00:00"), tags: [], date: "2026-10-19", time: "09:30", folder: "" };
	const m = calendarItems([task, done], [note], [{ key: "p.md", name: "Launch", deadline: "2026-10-25" }], "2026-10-01", "2026-10-31", new Set(["due", "done", "event", "project", "created"]));
	assert.equal(m.get("2026-10-20")![0].kind, "due");
	assert.equal(m.get("2026-10-18")!.map((i) => i.kind).join(), "done,created");
	assert.equal(m.get("2026-10-19")![0].time, "09:30");
	assert.equal(m.get("2026-10-25")![0].kind, "project");
});

console.log(`\n${n} passed`);
