// Builds calendar/timeline items from the index. Pure: no Obsidian imports.

import type { NoteInfo, Priority, ProjectInfo, Task } from "../types";
import { isClosedStatus, isOpen } from "./queries";
import { fmt } from "./trackerTypes";

export type CalKind = "due" | "scheduled" | "done" | "project" | "deadline" | "event" | "daily" | "created" | "edited";

export const CAL_LAYERS: { kind: CalKind; label: string; icon: string }[] = [
	{ kind: "due", label: "Tasks due", icon: "circle-dot" },
	{ kind: "scheduled", label: "Scheduled", icon: "clock" },
	{ kind: "done", label: "Completed", icon: "check-circle-2" },
	{ kind: "project", label: "Project deadlines", icon: "flag" },
	{ kind: "deadline", label: "Note deadlines", icon: "calendar-clock" },
	{ kind: "event", label: "Dated notes / meetings", icon: "calendar-days" },
	{ kind: "daily", label: "Daily notes", icon: "notebook-pen" },
	{ kind: "created", label: "Notes created", icon: "file-plus" },
	{ kind: "edited", label: "Notes edited", icon: "file-pen" },
];

const KIND_ORDER: Record<CalKind, number> = {
	project: 0, deadline: 1, event: 2, due: 3, scheduled: 4, daily: 5, done: 6, created: 7, edited: 8,
};

export interface CalItem {
	date: string;
	kind: CalKind;
	title: string;
	path: string;
	line?: number;
	task?: Task;
	time?: string;
	priority?: Priority;
	projectKey?: string;
}

export function calendarItems(
	tasks: Task[], notes: NoteInfo[], projects: ProjectInfo[], start: string, end: string, layers: Set<CalKind>,
): Map<string, CalItem[]> {
	const map = new Map<string, CalItem[]>();
	const add = (item: CalItem) => {
		if (!layers.has(item.kind) || item.date < start || item.date > end) return;
		if (!map.has(item.date)) map.set(item.date, []);
		map.get(item.date)!.push(item);
	};

	const dailyByPath = new Map(notes.filter((n) => n.kind === "daily" && n.date).map((n) => [n.path, n.date!]));
	for (const t of tasks) {
		const noteDay = dailyByPath.get(t.path);
		if (isOpen(t) && !t.due && !t.scheduled && noteDay) add({ date: noteDay, kind: "scheduled", title: t.text, path: t.path, line: t.line, task: t, priority: t.priority });
		if (isOpen(t) && t.due) add({ date: t.due, kind: "due", title: t.text, path: t.path, line: t.line, task: t, priority: t.priority });
		if (isOpen(t) && t.scheduled && t.scheduled !== t.due) add({ date: t.scheduled, kind: "scheduled", title: t.text, path: t.path, line: t.line, task: t, priority: t.priority });
		if (t.status === "done" && t.doneDate) add({ date: t.doneDate, kind: "done", title: t.text, path: t.path, line: t.line, task: t });
	}
	for (const p of projects) {
		if (p.deadline && !isClosedStatus(p.status)) add({ date: p.deadline, kind: "project", title: p.name, path: p.notePath ?? p.key, projectKey: p.key });
	}
	for (const n of notes) {
		if (n.kind === "daily" && n.date) add({ date: n.date, kind: "daily", title: n.name, path: n.path });
		if (n.kind !== "daily" && n.deadline) add({ date: n.deadline, kind: "deadline", title: n.name, path: n.path });
		if (n.kind !== "daily" && n.date) add({ date: n.date, kind: "event", title: n.name, path: n.path, time: n.time });
		const created = fmt(new Date(n.ctime));
		const edited = fmt(new Date(n.mtime));
		if (n.kind !== "daily") add({ date: created, kind: "created", title: n.name, path: n.path });
		if (n.kind !== "daily" && edited !== created) add({ date: edited, kind: "edited", title: n.name, path: n.path });
	}

	for (const items of map.values()) {
		items.sort((a, b) =>
			(a.time ?? "99").localeCompare(b.time ?? "99") ||
			KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
			(a.priority ?? 3) - (b.priority ?? 3) ||
			a.title.localeCompare(b.title));
	}
	return map;
}

/** The weeks (arrays of 7 YYYY-MM-DD) covering a month, padded to whole weeks. */
export function monthGrid(year: number, month: number, weekStartsMonday: boolean): string[][] {
	const first = new Date(year, month, 1);
	const shift = weekStartsMonday ? (first.getDay() + 6) % 7 : first.getDay();
	const cursor = new Date(year, month, 1 - shift);
	const weeks: string[][] = [];
	do {
		const week: string[] = [];
		for (let i = 0; i < 7; i++) {
			week.push(fmt(cursor));
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push(week);
	} while (cursor.getMonth() === month);
	return weeks;
}

export function weekDays(anchor: string, weekStartsMonday: boolean): string[] {
	const d = new Date(anchor + "T00:00:00");
	const shift = weekStartsMonday ? (d.getDay() + 6) % 7 : d.getDay();
	d.setDate(d.getDate() - shift);
	return Array.from({ length: 7 }, () => {
		const s = fmt(d);
		d.setDate(d.getDate() + 1);
		return s;
	});
}
