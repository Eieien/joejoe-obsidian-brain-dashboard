// Derived views over the index. Pure functions: pass in tasks/projects and "today".

import type { DashboardSettings } from "../settings";
import type { DeadlineItem, NoteInfo, Priority, ProjectInfo, Task } from "../types";

export const isOpen = (t: Task) => t.status !== "done" && t.status !== "cancelled";

/**
 * The day a task is planned for: its due date, else its scheduled date, else the day of
 * the daily note it was written in (writing a task in today's note plans it for today).
 */
export function plannedDate(t: Task, noteDate: (path: string) => string | undefined): string | undefined {
	return t.due ?? t.scheduled ?? noteDate(t.path);
}

export function daysUntil(date: string, today: string): number {
	return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

export const isOverdue = (t: Task, today: string) => isOpen(t) && !!t.due && t.due < today;
export const isDueToday = (t: Task, today: string) => isOpen(t) && t.due === today;

/** Urgent = P1, labelled #urgent, overdue, or due within the escalation window. */
export function isUrgent(t: Task, today: string, s: DashboardSettings): boolean {
	if (!isOpen(t)) return false;
	if (t.priority === 1 || t.labels.includes("urgent")) return true;
	return !!t.due && daysUntil(t.due, today) <= s.urgentEscalationDays;
}

/** True when urgency comes only from the due date (shown as an "auto" flag). */
export function isAutoUrgent(t: Task, today: string, s: DashboardSettings): boolean {
	return isUrgent(t, today, s) && t.priority !== 1 && !t.labels.includes("urgent");
}

const PRIORITY_WEIGHT: Record<Priority, number> = { 1: 100, 2: 60, 3: 30, 4: 10 };

/** Ranking used by "Today" and the smart sort: priority + due pressure + labels + status. */
export function score(t: Task, today: string, s: DashboardSettings): number {
	let n = PRIORITY_WEIGHT[t.priority];
	if (t.due) {
		const d = daysUntil(t.due, today);
		if (d < 0) n += 80 + Math.min(-d, 14) * 5;
		else if (d === 0) n += 60;
		else if (d <= s.urgentEscalationDays) n += 40;
		else if (d <= 7) n += 20;
		else if (d <= 14) n += 5;
	}
	if (t.labels.includes("urgent")) n += 50;
	if (t.labels.includes("needs-to-be-done")) n += 20;
	if (t.status === "in-progress") n += 10;
	if (t.status === "waiting") n -= 25;
	return n;
}

export function sortTasks(tasks: Task[], mode: "smart" | "due" | "priority" | "recent", today: string, s: DashboardSettings): Task[] {
	const byDue = (a: Task, b: Task) => (a.due ?? "9999") .localeCompare(b.due ?? "9999");
	const out = [...tasks];
	switch (mode) {
		case "smart": return out.sort((a, b) => score(b, today, s) - score(a, today, s) || byDue(a, b));
		case "due": return out.sort((a, b) => byDue(a, b) || a.priority - b.priority);
		case "priority": return out.sort((a, b) => a.priority - b.priority || byDue(a, b));
		case "recent": return out.sort((a, b) => b.fileMtime - a.fileMtime);
	}
}

export function dueBucket(t: Task, today: string): string {
	if (!t.due) return "No date";
	const d = daysUntil(t.due, today);
	if (d < 0) return "Overdue";
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	if (d <= 7) return "This week";
	if (d <= 30) return "This month";
	return "Later";
}
export const DUE_BUCKET_ORDER = ["Overdue", "Today", "Tomorrow", "This week", "This month", "Later", "No date"];

export function deadlines(
	tasks: Task[], projects: ProjectInfo[], notes: NoteInfo[], today: string, windowDays: number,
): DeadlineItem[] {
	const items: DeadlineItem[] = [];
	const inWindow = (d: string) => daysUntil(d, today) <= windowDays;
	for (const t of tasks) {
		if (isOpen(t) && t.due && inWindow(t.due)) {
			items.push({ date: t.due, title: t.text, kind: "task", path: t.path, line: t.line, task: t, priority: t.priority });
		}
	}
	for (const p of projects) {
		if (p.deadline && inWindow(p.deadline) && !isClosedStatus(p.status) && (p.deadline >= today)) {
			items.push({ date: p.deadline, title: p.name, kind: "project", path: p.notePath ?? p.key });
		}
	}
	for (const n of notes) {
		if (n.deadline && n.deadline >= today && inWindow(n.deadline)) {
			items.push({ date: n.deadline, title: n.name, kind: "note", path: n.path });
		}
	}
	return items.sort((a, b) => a.date.localeCompare(b.date) || (a.priority ?? 3) - (b.priority ?? 3));
}

export function isClosedStatus(status?: string): boolean {
	return !!status && /^(done|complete|completed|archived|cancelled|canceled|closed)$/i.test(status.trim());
}

export interface ProjectStats {
	total: number;
	done: number;
	open: number;
	overdue: number;
	urgent: number;
	progress: number;
	nextDue?: string;
}

export function projectStats(tasks: Task[], today: string, s: DashboardSettings): ProjectStats {
	const counted = tasks.filter((t) => t.status !== "cancelled");
	const done = counted.filter((t) => t.status === "done").length;
	const open = counted.filter(isOpen);
	const nextDue = open.map((t) => t.due).filter((d): d is string => !!d).sort()[0];
	return {
		total: counted.length,
		done,
		open: open.length,
		overdue: open.filter((t) => isOverdue(t, today)).length,
		urgent: open.filter((t) => isUrgent(t, today, s)).length,
		progress: counted.length ? done / counted.length : 0,
		nextDue,
	};
}

export function startOfWeek(today: string): string {
	const d = new Date(today + "T00:00:00");
	const day = (d.getDay() + 6) % 7; // Monday = 0
	d.setDate(d.getDate() - day);
	// Format in local time; toISOString() would shift the date in UTC+ timezones.
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
