// Pure parsing/mutation helpers for Markdown task lines. No Obsidian imports,
// so this module can be unit-tested in plain Node.
//
// Supported syntax (compatible with the Tasks plugin and Dataview):
//   - [ ] Send invoice #urgent #needs-to-be-done [[Project A]] ⏫ 📅 2026-10-20
//   - [/] Draft spec [due:: 2026-10-22] [priority:: high]
//   - [x] Done thing ✅ 2026-10-17

import type { Priority, TaskStatus } from "../types";

export const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/;

const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const DATE_FIELDS: Record<"due" | "scheduled" | "start" | "done" | "created", { emoji: string[]; field: string[] }> = {
	due: { emoji: ["📅", "📆", "🗓️", "🗓"], field: ["due", "deadline"] },
	scheduled: { emoji: ["⏳", "⌛"], field: ["scheduled"] },
	start: { emoji: ["🛫"], field: ["start"] },
	done: { emoji: ["✅"], field: ["completion", "done"] },
	created: { emoji: ["➕"], field: ["created"] },
};

const PRIORITY_EMOJI: Record<string, Priority> = {
	"🔺": 1,
	"⏫": 2,
	"🔼": 3,
	"🔽": 4,
	"⏬": 4,
};
const PRIORITY_WRITE: Record<Priority, string> = { 1: "🔺", 2: "⏫", 3: "", 4: "🔽" };
const PRIORITY_WORDS: Record<string, Priority> = {
	highest: 1, urgent: 1, p1: 1, "1": 1,
	high: 2, p2: 2, "2": 2,
	medium: 3, normal: 3, p3: 3, "3": 3,
	low: 4, lowest: 4, p4: 4, "4": 4,
};

/** Emoji that start the trailing metadata block of a Tasks-plugin line. */
const SIGNIFIERS = ["📅", "📆", "🗓", "⏳", "⌛", "🛫", "✅", "➕", "🔁", "❌", "🔺", "⏫", "🔼", "🔽", "⏬", "🆔", "⛔"];

const TAG = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const MDLINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const INLINE_FIELD = /\[([\w-]+)::\s*([^\]]*)\]|\(([\w-]+)::\s*([^)]*)\)/g;
const BLOCK_ID = /\s\^[\w-]+\s*$/;

export interface ParsedTask {
	statusChar: string;
	body: string;
	text: string;
	priority: Priority;
	labels: string[];
	links: string[];
	due?: string;
	scheduled?: string;
	start?: string;
	doneDate?: string;
}

export function isTaskLine(line: string): boolean {
	return TASK_LINE.test(line);
}

function findDate(body: string, key: keyof typeof DATE_FIELDS): string | undefined {
	const def = DATE_FIELDS[key];
	for (const e of def.emoji) {
		const m = body.match(new RegExp(`${escapeRe(e)}\\uFE0F?\\s*${DATE}`, "u"));
		if (m) return m[1];
	}
	for (const f of def.field) {
		const m = body.match(new RegExp(`[\\[(]${f}::\\s*${DATE}[\\])]`, "i"));
		if (m) return m[1];
	}
	// Kanban plugin cards: @{YYYY-MM-DD}
	if (key === "due") {
		const k = body.match(new RegExp(`@\\{${DATE}\\}`));
		if (k) return k[1];
	}
	return undefined;
}

export function parseTaskLine(line: string): ParsedTask | null {
	const m = line.match(TASK_LINE);
	if (!m) return null;
	const statusChar = m[2];
	const body = m[4];

	let priority: Priority = 3;
	let explicit = false;
	for (const [emoji, p] of Object.entries(PRIORITY_EMOJI)) {
		if (body.includes(emoji)) { priority = p; explicit = true; break; }
	}
	if (!explicit) {
		const f = body.match(/[\[(]priority::\s*([\w]+)[\])]/i);
		if (f && PRIORITY_WORDS[f[1].toLowerCase()]) { priority = PRIORITY_WORDS[f[1].toLowerCase()]; explicit = true; }
	}

	const labels: string[] = [];
	for (const t of body.matchAll(TAG)) labels.push(t[2].toLowerCase());
	if (!explicit) {
		const pTag = labels.find((l) => /^p[1-4]$/.test(l));
		if (pTag) priority = Number(pTag[1]) as Priority;
	}

	const links: string[] = [];
	for (const l of body.matchAll(WIKILINK)) links.push(l[1].trim());

	return {
		statusChar,
		body,
		text: cleanText(body),
		priority,
		labels: labels.filter((l) => !/^p[1-4]$/.test(l)),
		links,
		due: findDate(body, "due"),
		scheduled: findDate(body, "scheduled"),
		start: findDate(body, "start"),
		doneDate: findDate(body, "done"),
	};
}

/** Human-readable description: strip tags, dates, priority, fields and block ids; render links as text. */
export function cleanText(body: string): string {
	let t = body;
	t = t.replace(BLOCK_ID, "");
	t = t.replace(INLINE_FIELD, "");
	t = t.replace(/@@?\{[^}]*\}/g, "");
	// Recurrence rule runs until the next signifier.
	t = t.replace(/🔁[^📅📆🗓⏳⌛🛫✅➕❌🔺⏫🔼🔽⏬🆔⛔]*/gu, "");
	for (const def of Object.values(DATE_FIELDS)) {
		for (const e of def.emoji) t = t.replace(new RegExp(`${escapeRe(e)}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, "gu"), "");
	}
	t = t.replace(/[🔺⏫🔼🔽⏬]/gu, "");
	t = t.replace(/(🆔|⛔)\s*[\w,-]+/gu, "");
	t = t.replace(TAG, "$1");
	t = t.replace(WIKILINK, (_m, target: string, alias?: string) => alias ?? target.split("/").pop() ?? target);
	t = t.replace(MDLINK, "$1");
	return t.replace(/\s{2,}/g, " ").trim();
}

export function statusFromChar(ch: string, chars: Record<TaskStatus, string>): TaskStatus {
	if (ch === "X") return "done";
	for (const [status, c] of Object.entries(chars) as [TaskStatus, string][]) {
		if (c === ch) return status;
	}
	// Common alternates from other plugins/themes.
	if (ch === ">" || ch === "<") return "waiting";
	if (ch === "!") return "todo";
	return "todo";
}

// ---------- Mutations (each takes a full line and returns the new line) ----------

export function setStatusChar(line: string, ch: string): string {
	return line.replace(TASK_LINE, (_m, a: string, _c: string, b: string, rest: string) => `${a}${ch}${b}${rest}`);
}

export function setDoneDate(line: string, date: string | null): string {
	let out = line.replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/u, "");
	if (date) out = appendMeta(out, `✅ ${date}`);
	return out;
}

export function setPriority(line: string, p: Priority): string {
	let out = line.replace(/\s*[🔺⏫🔼🔽⏬]/gu, "");
	out = out.replace(/\s*[\[(]priority::\s*[\w]*[\])]/gi, "");
	out = out.replace(/(^|\s)#p[1-4](?=\s|$)/gi, "$1").replace(/[ \t]{2,}/g, " ");
	const emoji = PRIORITY_WRITE[p];
	return emoji ? insertBeforeSignifiers(out, emoji) : out.replace(/\s+$/, "");
}

export function setDue(line: string, date: string | null): string {
	let out = line.replace(/\s*(?:📅|📆|🗓️|🗓)️?\s*\d{4}-\d{2}-\d{2}/gu, "");
	out = out.replace(/\s*[\[(](?:due|deadline)::\s*\d{4}-\d{2}-\d{2}[\])]/gi, "");
	out = out.replace(/\s*@\{\d{4}-\d{2}-\d{2}\}/g, "");
	if (date) out = appendMeta(out, `📅 ${date}`);
	return out.replace(/\s+$/, "");
}

export function addLabel(line: string, label: string): string {
	const tag = `#${label}`;
	if (new RegExp(`(^|\\s)${escapeRe(tag)}(?=\\s|$)`, "i").test(line)) return line;
	return insertBeforeSignifiers(line, tag);
}

export function removeLabel(line: string, label: string): string {
	return line
		.replace(new RegExp(`(^|\\s)#${escapeRe(label)}(?=\\s|$)`, "gi"), "$1")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\s+$/, "");
}

/** Insert a token before the trailing metadata block (or block id), keeping metadata at the end. */
export function insertBeforeSignifiers(line: string, token: string): string {
	const m = line.match(TASK_LINE);
	if (!m) return `${line} ${token}`;
	const prefix = m[1] + m[2] + m[3];
	let body = m[4];
	let blockId = "";
	const b = body.match(BLOCK_ID);
	if (b) { blockId = b[0]; body = body.slice(0, b.index); }
	let idx = body.length;
	for (const s of SIGNIFIERS) {
		const i = body.indexOf(s);
		if (i >= 0 && i < idx) idx = i;
	}
	const head = body.slice(0, idx).replace(/\s+$/, "");
	const tail = body.slice(idx);
	return `${prefix}${head} ${token}${tail ? " " + tail.trim() : ""}${blockId}`;
}

/** Append a metadata token at the end of the line (before any block id). */
function appendMeta(line: string, token: string): string {
	const b = line.match(BLOCK_ID);
	if (b && b.index !== undefined) {
		return `${line.slice(0, b.index).replace(/\s+$/, "")} ${token}${b[0]}`;
	}
	return `${line.replace(/\s+$/, "")} ${token}`;
}

export function buildTaskLine(opts: {
	text: string;
	priority: Priority;
	labels: string[];
	due?: string;
	projectLink?: string;
	statusChar?: string;
}): string {
	const parts = [`- [${opts.statusChar ?? " "}]`, opts.text.trim()];
	if (opts.projectLink) parts.push(`[[${opts.projectLink}]]`);
	for (const l of opts.labels) parts.push(`#${l}`);
	if (PRIORITY_WRITE[opts.priority]) parts.push(PRIORITY_WRITE[opts.priority]);
	if (opts.due) parts.push(`📅 ${opts.due}`);
	return parts.join(" ");
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
