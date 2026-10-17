export type Priority = 1 | 2 | 3 | 4;

export type TaskStatus = "todo" | "in-progress" | "waiting" | "done" | "cancelled";

export const STATUS_ORDER: TaskStatus[] = ["todo", "in-progress", "waiting", "done", "cancelled"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
	"todo": "To do",
	"in-progress": "In progress",
	"waiting": "Waiting / Blocked",
	"done": "Done",
	"cancelled": "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
	1: "P1 Urgent",
	2: "P2 High",
	3: "P3 Normal",
	4: "P4 Low",
};

export interface Task {
	/** `${path}:${line}` — stable until lines above it change. */
	id: string;
	path: string;
	line: number;
	/** The full source line, used to verify before writing back. */
	raw: string;
	/** Description with metadata (dates, priority, tags) stripped. */
	text: string;
	status: TaskStatus;
	statusChar: string;
	priority: Priority;
	/** Tags on the task, without `#`, lowercased. */
	labels: string[];
	due?: string;
	scheduled?: string;
	start?: string;
	doneDate?: string;
	/** Project key (see ProjectInfo.key) this task belongs to, if any. */
	project?: string;
	/** Link targets mentioned in the task text. */
	links: string[];
	fileMtime: number;
}

export interface ProjectInfo {
	/** Unique key: the project note path, or the folder path for folder-only projects. */
	key: string;
	name: string;
	/** Note to open for this project (undefined for folder-only projects). */
	notePath?: string;
	folderPath?: string;
	status?: string;
	deadline?: string;
	area?: string;
	/** Frontmatter `description:` (Markdown). */
	description?: string;
}

export type NoteKind = "daily" | "project" | "note";

export interface NoteInfo {
	path: string;
	name: string;
	kind: NoteKind;
	mtime: number;
	ctime: number;
	tags: string[];
	/** Project key this note belongs to, if any. */
	project?: string;
	/** `deadline:` / `due:` frontmatter on regular notes. */
	deadline?: string;
	/** Frontmatter `type:` (e.g. article, meeting, book), if any. */
	type?: string;
	/** Frontmatter `area:` (link brackets stripped), if any. */
	area?: string;
	/** The daily note's day, or frontmatter `date:` (YYYY-MM-DD) on other notes — shown on the calendar. */
	date?: string;
	/** Time of day (HH:mm) from `time:`/`start:` or a datetime `date:`. */
	time?: string;
	/** Top-level folder ("" for vault root). */
	folder: string;
}

export interface DeadlineItem {
	date: string;
	title: string;
	kind: "task" | "project" | "note";
	path: string;
	line?: number;
	task?: Task;
	priority?: Priority;
}
