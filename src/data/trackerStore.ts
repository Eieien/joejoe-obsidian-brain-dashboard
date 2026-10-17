import { App, moment, normalizePath, TFile } from "obsidian";
import type SecondBrainPlugin from "../main";
import { dailyDate, ensureFolder, getDailyConfig, getOrCreateDaily } from "./daily";
import { fmt, parseInlineFields, parseTables, slugKey, toBool, toDateStr, type TrackerDef, type TrackerEntry, type TrackerField } from "./trackerTypes";

interface ParsedContent {
	mtime: number;
	inline: Record<string, string>;
	tables: Record<string, string>[];
}

/**
 * Loads tracker entries from the vault and writes new ones.
 * Parsed file contents are cached by mtime; entry lists are cached per tracker
 * until the index reports a change.
 */
export class TrackerStore {
	private contentCache = new Map<string, ParsedContent>();
	private entryCache = new Map<string, Promise<TrackerEntry[]>>();

	constructor(private app: App, private plugin: SecondBrainPlugin) {}

	invalidate(): void {
		this.entryCache.clear();
	}

	entries(def: TrackerDef): Promise<TrackerEntry[]> {
		const key = JSON.stringify(def);
		let p = this.entryCache.get(key);
		if (!p) {
			p = this.load(def).catch((e) => { console.error("joejoe's second brain: tracker", def.name, e); return []; });
			this.entryCache.set(key, p);
		}
		return p;
	}

	private async parse(file: TFile): Promise<ParsedContent> {
		const hit = this.contentCache.get(file.path);
		if (hit && hit.mtime === file.stat.mtime) return hit;
		const content = await this.app.vault.cachedRead(file);
		const parsed = { mtime: file.stat.mtime, inline: parseInlineFields(content), tables: parseTables(content) };
		this.contentCache.set(file.path, parsed);
		return parsed;
	}

	private frontmatter(file: TFile): Record<string, unknown> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(fm)) if (k !== "position") out[slugKey(k)] = v;
		return out;
	}

	private async load(def: TrackerDef): Promise<TrackerEntry[]> {
		const vault = this.app.vault;
		switch (def.source) {
			case "daily": {
				const cfg = getDailyConfig(this.app, this.plugin.settings);
				const out: TrackerEntry[] = [];
				for (const file of vault.getMarkdownFiles()) {
					const date = dailyDate(file.path, cfg);
					if (!date) continue;
					const { inline } = await this.parse(file);
					out.push({ date, path: file.path, name: file.basename, values: { ...inline, ...this.frontmatter(file) } });
				}
				return out;
			}
			case "notes": {
				const folder = (def.folder ?? "").replace(/^\/|\/$/g, "");
				const tag = (def.tag ?? "").replace(/^#/, "").toLowerCase();
				if (!folder && !tag) return [];
				const out: TrackerEntry[] = [];
				for (const file of vault.getMarkdownFiles()) {
					if (folder && !file.path.startsWith(folder + "/")) continue;
					if (tag) {
						const note = this.plugin.index.notes.get(file.path);
						if (!note?.tags.some((t) => t === tag || t.startsWith(tag + "/"))) continue;
					}
					const fm = this.frontmatter(file);
					const { inline } = await this.parse(file);
					const values = { ...inline, ...fm };
					const dateKey = slugKey(def.dateField || "date");
					const date = toDateStr(values[dateKey]) ?? (def.dateField ? undefined : fmt(new Date(file.stat.ctime)));
					out.push({ date, path: file.path, name: file.basename, values });
				}
				return out;
			}
			case "table": {
				const file = def.notePath ? vault.getAbstractFileByPath(normalizePath(def.notePath)) : null;
				if (!(file instanceof TFile)) return [];
				const { tables } = await this.parse(file);
				const dateKey = slugKey(def.dateField || "date");
				return tables.map((row, i) => ({
					date: toDateStr(row[dateKey]),
					path: file.path,
					name: Object.values(row)[0] || `Row ${i + 1}`,
					values: row,
				}));
			}
		}
	}

	/** The synthetic daily-notes tracker behind the habit checkboxes. */
	habitDef(): TrackerDef {
		return {
			id: "__habits", name: "Habits", icon: "check-square", source: "daily",
			fields: this.plugin.settings.habits.map((h): TrackerField => ({
				key: h.key, label: h.label, type: "boolean", goal: { target: h.target, period: "week", agg: "count" },
			})),
		};
	}

	habitEntries(): Promise<TrackerEntry[]> {
		return this.entries(this.habitDef());
	}

	/** Flip one habit for one day in that day's daily note (created if needed). Returns the new value. */
	async toggleHabit(date: string, key: string, value?: boolean): Promise<boolean> {
		const cfg = getDailyConfig(this.app, this.plugin.settings);
		const file = await getOrCreateDaily(this.app, cfg, moment(date));
		let next = false;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			next = value ?? toBool(fm[key]) !== true;
			fm[key] = next;
		});
		this.invalidate();
		return next;
	}

	/** Write a new entry. `date` defaults to today; `name` is used for one-note-per-item trackers. */
	async addEntry(def: TrackerDef, values: Record<string, unknown>, opts: { date?: string; name?: string } = {}): Promise<string> {
		const date = opts.date || moment().format("YYYY-MM-DD");
		const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined && v !== null));
		switch (def.source) {
			case "daily": {
				const cfg = getDailyConfig(this.app, this.plugin.settings);
				const file = await getOrCreateDaily(this.app, cfg, moment(date));
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => Object.assign(fm, clean));
				return file.path;
			}
			case "notes": {
				const folder = (def.folder || def.name).replace(/^\/|\/$/g, "");
				const base = (opts.name || `${def.name} ${date}`).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
				let path = normalizePath(`${folder}/${base}.md`);
				for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${base} ${i}.md`);
				await ensureFolder(this.app, path);
				const file = await this.app.vault.create(path, "");
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					Object.assign(fm, clean);
					// Only stamp a date when one was given: e.g. a "to-read" book has no `finished` date yet.
					if (opts.date) fm[def.dateField || "date"] = opts.date;
					if (def.tag) fm.tags = [def.tag.replace(/^#/, "")];
				});
				return file.path;
			}
			case "table": {
				const notePath = normalizePath(def.notePath || `${def.name}.md`);
				const dateKey = def.dateField || "date";
				const cols = [dateKey, ...def.fields.map((f) => f.key).filter((k) => k !== dateKey)];
				const row = `| ${cols.map((c) => (c === dateKey ? date : String(clean[c] ?? "")).replace(/\|/g, "\\|")).join(" | ")} |`;
				let file = this.app.vault.getAbstractFileByPath(notePath);
				if (!(file instanceof TFile)) {
					await ensureFolder(this.app, notePath);
					file = await this.app.vault.create(notePath, `# ${def.name}\n\n| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`);
				}
				await this.app.vault.process(file as TFile, (data) => {
					const lines = data.split("\n");
					let last = -1;
					lines.forEach((l, i) => { if (l.trim().startsWith("|")) last = i; });
					if (last < 0) return `${data.replace(/\s*$/, "")}\n\n| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n${row}\n`;
					lines.splice(last + 1, 0, row);
					return lines.join("\n");
				});
				return notePath;
			}
		}
	}
}
