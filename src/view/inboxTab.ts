// Inbox triage: process captured tasks (Inbox file / fleeting folder) and fleeting notes
// one at a time: decide priority, date, labels and project, then move, finish or delete.

import { moment, normalizePath, Notice, setIcon } from "obsidian";
import { appendToFile, ensureFolder, getDailyConfig, getOrCreateDaily } from "../data/daily";
import { buildTaskLine } from "../data/taskParser";
import { PRIORITY_LABELS, type NoteInfo, type Priority, type Task } from "../types";
import { emptyState, labelChip, pill, type DashboardContext } from "./components";

export interface InboxState {
	current?: string;
}

type Item = { id: string; kind: "task"; task: Task } | { id: string; kind: "note"; note: NoteInfo };

const inFolder = (path: string, folder: string) => !!folder && path.startsWith(folder.replace(/\/$/, "") + "/");

export function inboxItems(ctx: DashboardContext): Item[] {
	const s = ctx.plugin.settings;
	const idx = ctx.plugin.index;
	const tasks: Item[] = idx.tasks
		.filter((t) => t.status === "todo" && (t.path === s.inboxFile || inFolder(t.path, s.inboxFolder)))
		.map((task) => ({ id: `task:${task.path}::${task.text}`, kind: "task", task }));
	const notes: Item[] = [...idx.notes.values()]
		.filter((n) => inFolder(n.path, s.inboxFolder) && n.path !== s.inboxFile)
		.sort((a, b) => a.ctime - b.ctime)
		.map((note) => ({ id: `note:${note.path}`, kind: "note", note }));
	return [...tasks, ...notes];
}

export function renderInboxTab(el: HTMLElement, ctx: DashboardContext, st: InboxState, update: (p: Partial<InboxState>) => void): void {
	const s = ctx.plugin.settings;
	const items = inboxItems(ctx);

	const head = el.createDiv({ cls: "sbd-inbox-head" });
	const title = head.createDiv({ cls: "sbd-inbox-title" });
	setIcon(title.createSpan({ cls: "sbd-icon" }), "inbox");
	title.createSpan({ text: "inbox" });
	title.createSpan({ cls: "sbd-count", text: String(items.length) });
	head.createDiv({ cls: "sbd-muted", text: items.length ? "Decide what each item is, where it goes, and when. Then move on." : "" });

	// Quick add straight into the inbox.
	const quick = el.createDiv({ cls: "sbd-quick sbd-inbox-quick" });
	setIcon(quick.createSpan({ cls: "sbd-icon" }), "plus");
	const input = quick.createEl("input", { type: "text", cls: "sbd-quick-input", attr: { placeholder: "capture something into the inbox… (enter)", "data-sbd-focus": "inbox-add" } });
	let busy = false;
	input.onkeydown = async (e) => {
		if (e.key !== "Enter" || e.isComposing || busy || !input.value.trim()) return;
		busy = true;
		const text = input.value.trim();
		input.value = "";
		try { await appendToFile(ctx.app, s.inboxFile, buildTaskLine({ text, priority: 3, labels: [] })); } finally { busy = false; }
	};

	if (!items.length) {
		const done = el.createDiv({ cls: "sbd-inbox-zero" });
		setIcon(done.createDiv({ cls: "sbd-inbox-zero-icon" }), "check-circle-2");
		done.createDiv({ cls: "sbd-inbox-zero-title", text: "Inbox zero" });
		done.createDiv({ cls: "sbd-muted", text: `New tasks in ${s.inboxFile.replace(/\.md$/, "")} and notes in ${s.inboxFolder}/ show up here.` });
		return;
	}

	const current = items.find((i) => i.id === st.current) ?? items[0];
	const layout = el.createDiv({ cls: "sbd-inbox-layout" });
	const main = layout.createDiv({ cls: "sbd-inbox-main" });
	const queue = layout.createDiv({ cls: "sbd-inbox-queue" });
	const next = () => {
		const i = items.indexOf(current);
		const after = items[i + 1] ?? items[i - 1];
		update({ current: after && after !== current ? after.id : undefined });
	};

	if (current.kind === "task") renderTaskCard(main, ctx, current.task, next);
	else renderNoteCard(main, ctx, current.note, next);

	queue.createDiv({ cls: "sbd-day-group", text: `queue · ${items.length}` });
	for (const it of items) {
		const row = queue.createDiv({ cls: `sbd-inbox-row ${it === current ? "is-current" : ""}` });
		setIcon(row.createSpan({ cls: "sbd-icon" }), it.kind === "task" ? "square" : "sticky-note");
		row.createSpan({ cls: "sbd-note-name", text: it.kind === "task" ? it.task.text || "(empty task)" : it.note.name });
		row.onclick = () => update({ current: it.id });
	}
}

function renderTaskCard(el: HTMLElement, ctx: DashboardContext, task: Task, next: () => void): void {
	const w = ctx.plugin.writer;
	const s = ctx.plugin.settings;
	const card = el.createDiv({ cls: "sbd-card sbd-triage" });
	card.createDiv({ cls: "sbd-triage-kind", text: "task" });
	card.createDiv({ cls: "sbd-triage-title", text: task.text || "(empty task)" });
	const meta = card.createDiv({ cls: "sbd-task-meta" });
	meta.createSpan({ cls: "sbd-file-chip", text: task.path.replace(/\.md$/, "") });
	for (const l of task.labels) labelChip(meta, ctx, l);

	const row = (label: string, icon: string) => {
		const r = card.createDiv({ cls: "sbd-cap-row" });
		const l = r.createDiv({ cls: "sbd-cap-label" });
		setIcon(l.createSpan({ cls: "sbd-icon" }), icon);
		l.createSpan({ text: label });
		return r.createDiv({ cls: "sbd-cap-control" });
	};
	const option = (parent: HTMLElement, text: string, active: boolean, onClick: () => void) => {
		const b = parent.createEl("button", { cls: `sbd-cap-option ${active ? "is-active" : ""}`, text });
		b.onclick = onClick;
		return b;
	};

	const pr = row("Priority", "flag").createDiv({ cls: "sbd-cap-options" });
	([1, 2, 3, 4] as Priority[]).forEach((p) => option(pr, PRIORITY_LABELS[p], task.priority === p, () => void w.setPriority(task, p)));

	const due = row("Due", "calendar").createDiv({ cls: "sbd-cap-options" });
	const day = (n: number) => moment(ctx.today).add(n, "day").format("YYYY-MM-DD");
	for (const [label, d] of [["Today", ctx.today], ["Tomorrow", day(1)], ["Next week", moment(ctx.today).add(1, "week").startOf("isoWeek").format("YYYY-MM-DD")]] as const) {
		option(due, label, task.due === d, () => void w.setDue(task, task.due === d ? null : d));
	}
	if (task.due && ![ctx.today, day(1)].includes(task.due)) pill(due, moment(task.due).format("MMM D"), "gray");

	const labels = row("Labels", "tag").createDiv({ cls: "sbd-cap-labels" });
	for (const l of s.labels) {
		const on = task.labels.includes(l.name);
		const chip = labels.createEl("button", { cls: `sbd-label sbd-cap-label-chip ${on ? "is-active" : ""}`, text: `#${l.name}` });
		chip.style.setProperty("--sbd-label-color", l.color);
		chip.onclick = () => void w.toggleLabel(task, l.name);
	}

	const projects = [...ctx.plugin.index.projects.values()].filter((p) => p.notePath).sort((a, b) => a.name.localeCompare(b.name));
	const sel = row("Project", "folder-kanban").createEl("select", { cls: "dropdown sbd-cap-select" });
	sel.createEl("option", { value: "", text: projects.length ? "Choose a project…" : "No project notes yet" });
	for (const p of projects) sel.createEl("option", { value: p.notePath!, text: p.name });

	const actions = card.createDiv({ cls: "sbd-triage-actions" });
	const act = (icon: string, text: string, fn: () => Promise<unknown> | void, cls = "") => {
		const b = actions.createEl("button", { cls });
		setIcon(b.createSpan({ cls: "sbd-icon" }), icon);
		b.createSpan({ text });
		b.onclick = async () => { b.disabled = true; await fn(); };
		return b;
	};
	const toProject = act("folder-input", "Move to project", async () => {
		if (!sel.value) return;
		await w.moveTo(task, sel.value);
		new Notice(`Moved to ${sel.value.replace(/\.md$/, "")}`);
		next();
	}, "mod-cta");
	toProject.disabled = true;
	sel.onchange = () => { toProject.disabled = !sel.value; };
	act("calendar-days", "Move to today's note", async () => {
		const f = await getOrCreateDaily(ctx.app, getDailyConfig(ctx.app, s));
		await w.moveTo(task, f.path);
		next();
	});
	act("check", "Done", async () => { await w.setStatus(task, "done"); next(); });
	act("trash-2", "Delete", async () => { await w.remove(task); next(); }, "mod-warning");
	act("arrow-right", "Skip", () => next(), "sbd-triage-skip");
}

function renderNoteCard(el: HTMLElement, ctx: DashboardContext, note: NoteInfo, next: () => void): void {
	const s = ctx.plugin.settings;
	const file = ctx.app.vault.getFileByPath(note.path);
	const card = el.createDiv({ cls: "sbd-card sbd-triage" });
	card.createDiv({ cls: "sbd-triage-kind", text: "fleeting note" });
	card.createDiv({ cls: "sbd-triage-title", text: note.name });
	card.createDiv({ cls: "sbd-muted", text: `captured ${moment(note.ctime).fromNow()} · ${note.path}` });
	const preview = card.createDiv({ cls: "sbd-triage-preview" });
	if (file) void ctx.app.vault.cachedRead(file).then((c) => {
		const text = c.replace(/^---[\s\S]*?---\s*/, "").trim();
		preview.setText(text ? (text.length > 600 ? `${text.slice(0, 600)}…` : text) : "(empty note)");
	});

	const move = async (folder: string, type?: string) => {
		if (!file) return;
		const dest = normalizePath(`${folder}/${file.name}`);
		if (ctx.app.vault.getAbstractFileByPath(dest)) { new Notice(`${dest} already exists.`); return; }
		await ensureFolder(ctx.app, dest);
		await ctx.app.fileManager.renameFile(file, dest);
		if (type) await ctx.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.type = type; });
		new Notice(`Moved to ${folder}/`);
		next();
	};

	const actions = card.createDiv({ cls: "sbd-triage-actions" });
	const act = (icon: string, text: string, fn: () => Promise<unknown> | void, cls = "") => {
		const b = actions.createEl("button", { cls });
		setIcon(b.createSpan({ cls: "sbd-icon" }), icon);
		b.createSpan({ text });
		b.onclick = async () => { b.disabled = true; await fn(); b.disabled = false; };
	};
	act("gem", "Make permanent note", () => move(s.zettelFolder, "zettel"), "mod-cta");
	act("book-open", "Make literature note", () => move(s.sourcesFolder, "literature"));
	const projects = [...ctx.plugin.index.projects.values()].filter((p) => p.folderPath).sort((a, b) => a.name.localeCompare(b.name));
	if (projects.length) {
		const sel = actions.createEl("select", { cls: "dropdown sbd-cap-select" });
		sel.createEl("option", { value: "", text: "Move to a project folder…" });
		for (const p of projects) sel.createEl("option", { value: p.folderPath!, text: p.name });
		sel.onchange = () => { if (sel.value) void move(sel.value); };
	}
	act("file-text", "Open", () => ctx.openPath(note.path));
	act("trash-2", "Delete", async () => {
		if (!file || !window.confirm(`Move "${note.name}" to the trash?`)) return;
		await ctx.app.vault.trash(file, true);
		next();
	}, "mod-warning");
	act("arrow-right", "Skip", () => next(), "sbd-triage-skip");
	if (!file) emptyState(card, "This note no longer exists.");
}

