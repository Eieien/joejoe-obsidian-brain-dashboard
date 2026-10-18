import { App, debounce, Events, getAllTags, TFile, TFolder } from "obsidian";
import type { DashboardSettings } from "../settings";
import type { NoteInfo, ProjectInfo, Task } from "../types";
import { dailyDate, getDailyConfig } from "./daily";
import { parseTaskLine, statusFromChar } from "./taskParser";

/**
 * In-memory index of the vault: tasks, projects and notes.
 * Rebuilt once on load and updated per file as the metadata cache changes.
 * Emits "updated" (debounced) whenever anything changes.
 */
export class VaultIndex extends Events {
	private tasksByFile = new Map<string, Task[]>();
	projects = new Map<string, ProjectInfo>();
	notes = new Map<string, NoteInfo>();
	ready = false;

	private emitUpdated = debounce(() => {
		this.rebuildProjects();
		this.trigger("updated");
	}, 250, true);

	constructor(private app: App, private getSettings: () => DashboardSettings) {
		super();
	}

	get tasks(): Task[] {
		const all: Task[] = [];
		for (const list of this.tasksByFile.values()) all.push(...list);
		return all;
	}

	tasksForProject(key: string): Task[] {
		return this.tasks.filter((t) => t.project === key);
	}

	/** The date of the daily note at `path`, if it is one. */
	noteDate(path: string): string | undefined {
		const n = this.notes.get(path);
		return n?.kind === "daily" ? n.date : undefined;
	}

	notesForProject(key: string): NoteInfo[] {
		return [...this.notes.values()].filter((n) => n.project === key && n.kind !== "project");
	}

	async build(): Promise<void> {
		this.tasksByFile.clear();
		this.rebuildProjects();
		const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f.path));
		await Promise.all(files.map((f) => this.indexFileTasks(f)));
		this.rebuildProjects();
		this.ready = true;
		this.trigger("updated");
	}

	/** Wire vault/metadata events. Call from the plugin so listeners are cleaned up on unload. */
	registerEvents(register: (ref: ReturnType<Events["on"]>) => void): void {
		const mc = this.app.metadataCache;
		register(mc.on("changed", (file) => {
			if (!this.ready) return;
			void this.indexFileTasks(file).then(() => this.emitUpdated());
		}));
		register(this.app.vault.on("delete", (file) => {
			this.tasksByFile.delete(file.path);
			this.emitUpdated();
		}));
		register(this.app.vault.on("rename", (file, oldPath) => {
			this.tasksByFile.delete(oldPath);
			if (file instanceof TFile) void this.indexFileTasks(file).then(() => this.emitUpdated());
			else this.emitUpdated();
		}));
	}

	isExcluded(path: string): boolean {
		return this.getSettings().excludeFolders.some((f) => f && (path === f || path.startsWith(f.replace(/\/$/, "") + "/")));
	}

	private async indexFileTasks(file: TFile): Promise<void> {
		if (file.extension !== "md" || this.isExcluded(file.path)) {
			this.tasksByFile.delete(file.path);
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		const items = cache?.listItems?.filter((li) => li.task !== undefined) ?? [];
		if (!items.length) {
			this.tasksByFile.delete(file.path);
			return;
		}
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const chars = this.getSettings().statusChars;
		const tasks: Task[] = [];
		for (const li of items) {
			const lineNo = li.position.start.line;
			const raw = (lines[lineNo] ?? "").replace(/\r$/, "");
			const p = parseTaskLine(raw);
			if (!p) continue;
			tasks.push({
				id: `${file.path}:${lineNo}`,
				path: file.path,
				line: lineNo,
				raw,
				text: p.text,
				status: statusFromChar(p.statusChar, chars),
				statusChar: p.statusChar,
				priority: p.priority,
				labels: p.labels,
				due: p.due,
				scheduled: p.scheduled,
				start: p.start,
				doneDate: p.doneDate,
				links: p.links,
				fileMtime: file.stat.mtime,
			});
		}
		this.tasksByFile.set(file.path, tasks);
	}

	/** Recompute projects + notes from metadata (cheap), then re-resolve task → project. */
	private rebuildProjects(): void {
		const s = this.getSettings();
		const dailyCfg = getDailyConfig(this.app, s);
		const projectFolder = s.projectFolder.replace(/^\/|\/$/g, "");
		const projects = new Map<string, ProjectInfo>();
		const notes = new Map<string, NoteInfo>();

		const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f.path));
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter ?? {};
			const tags = (cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, "").toLowerCase());
			const parent = file.parent;
			const inProjectFolder = !!projectFolder && parent?.path === projectFolder;
			const isFolderNote = !!projectFolder && parent?.parent?.path === projectFolder && parent?.name === file.basename;
			const isProject =
				(!!s.projectTypeField && String(fm[s.projectTypeField] ?? "").toLowerCase() === s.projectTypeValue.toLowerCase()) ||
				(!!s.projectTag && tags.includes(s.projectTag.toLowerCase())) ||
				inProjectFolder || isFolderNote;

			if (isProject) {
				projects.set(file.path, {
					key: file.path,
					name: (fm.title as string) || file.basename,
					notePath: file.path,
					folderPath: isFolderNote ? parent?.path : undefined,
					status: fm.status ? String(fm.status) : undefined,
					deadline: toDate(fm.deadline ?? fm.due),
					area: fm.area ? stripLink(String(fm.area)) : undefined,
					description: typeof fm.description === "string" ? fm.description : undefined,
				});
			}

			const date = dailyDate(file.path, dailyCfg);
			notes.set(file.path, {
				path: file.path,
				name: file.basename,
				kind: isProject ? "project" : date ? "daily" : "note",
				mtime: file.stat.mtime,
				ctime: file.stat.ctime,
				tags,
				deadline: isProject ? undefined : toDate(fm.deadline ?? fm.due),
				type: fm.type ? String(fm.type).toLowerCase() : undefined,
				area: fm.area ? stripLink(String(fm.area)) : undefined,
				date: date ?? toDate(fm.date),
				time: date ? undefined : toTime(fm.time ?? fm.start ?? fm.date),
				folder: file.path.includes("/") ? file.path.split("/")[0] : "",
			});
		}

		// Subfolders of the project folder without a folder note become projects too.
		const root = projectFolder ? this.app.vault.getAbstractFileByPath(projectFolder) : null;
		if (root instanceof TFolder) {
			const claimed = new Set([...projects.values()].map((p) => p.folderPath).filter(Boolean));
			for (const child of root.children) {
				if (child instanceof TFolder && !claimed.has(child.path) && !this.isExcluded(child.path)) {
					projects.set(child.path, { key: child.path, name: child.name, folderPath: child.path });
				}
			}
		}

		this.projects = projects;
		this.notes = notes;

		for (const note of notes.values()) {
			note.project = note.kind === "project" ? note.path : this.resolveProject(note.path, []);
		}
		for (const list of this.tasksByFile.values()) {
			for (const t of list) t.project = this.resolveProject(t.path, t.links);
		}
	}

	private resolveProject(path: string, links: string[]): string | undefined {
		const mc = this.app.metadataCache;
		for (const link of links) {
			const dest = mc.getFirstLinkpathDest(link, path);
			if (dest && this.projects.has(dest.path)) return dest.path;
		}
		if (this.projects.has(path)) return path;

		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const fmProject = mc.getFileCache(file)?.frontmatter?.project;
			const values: unknown[] = Array.isArray(fmProject) ? fmProject : fmProject ? [fmProject] : [];
			for (const v of values) {
				const name = stripLink(String(v));
				const dest = mc.getFirstLinkpathDest(name, path);
				if (dest && this.projects.has(dest.path)) return dest.path;
				const byName = [...this.projects.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
				if (byName) return byName.key;
			}
		}

		// Inside a project's folder (folder-note projects or folder-only projects).
		for (const p of this.projects.values()) {
			if (p.folderPath && path.startsWith(p.folderPath + "/")) return p.key;
		}
		return undefined;
	}
}

function stripLink(v: string): string {
	return v.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
}

function toTime(v: unknown): string | undefined {
	if (!v) return undefined;
	const m = String(v).match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
	return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
}

function toDate(v: unknown): string | undefined {
	if (!v) return undefined;
	const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
	return m ? m[0] : undefined;
}
