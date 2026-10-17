import { App, moment, normalizePath, TFile } from "obsidian";
import type { DashboardSettings } from "../settings";

export interface DailyConfig {
	folder: string;
	format: string;
	template?: string;
}

interface CoreDailyNotes {
	enabled: boolean;
	instance?: { options?: { folder?: string; format?: string; template?: string } };
}

export function getDailyConfig(app: App, settings: DashboardSettings): DailyConfig {
	if (settings.useCoreDailyNotes) {
		// internalPlugins is not part of the public API, so guard every step.
		const internal = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => CoreDailyNotes | undefined } }).internalPlugins;
		const dn = internal?.getPluginById?.("daily-notes");
		if (dn?.enabled) {
			const opts = dn.instance?.options ?? {};
			let folder = (opts.folder ?? "").replace(/^\/|\/$/g, "");
			// Core plugin left at its default (vault root) but the configured daily folder exists: use it.
			const fallback = settings.dailyFolder.replace(/^\/|\/$/g, "");
			if (!folder && fallback && app.vault.getAbstractFileByPath(fallback)) folder = fallback;
			return {
				folder,
				format: opts.format || "YYYY-MM-DD",
				template: opts.template || undefined,
			};
		}
	}
	return { folder: settings.dailyFolder.replace(/^\/|\/$/g, ""), format: settings.dailyFormat || "YYYY-MM-DD" };
}

/** Returns the note's date (YYYY-MM-DD) if the path is a daily note under this config. */
export function dailyDate(path: string, cfg: DailyConfig): string | null {
	if (!path.endsWith(".md")) return null;
	let rel = path.slice(0, -3);
	if (cfg.folder) {
		if (!rel.startsWith(cfg.folder + "/")) return null;
		rel = rel.slice(cfg.folder.length + 1);
	}
	const m = moment(rel, cfg.format, true);
	return m.isValid() ? m.format("YYYY-MM-DD") : null;
}

export function dailyPath(date: moment.Moment, cfg: DailyConfig): string {
	const name = `${date.format(cfg.format)}.md`;
	return normalizePath(cfg.folder ? `${cfg.folder}/${name}` : name);
}

export async function getOrCreateDaily(app: App, cfg: DailyConfig, date = moment()): Promise<TFile> {
	const path = dailyPath(date, cfg);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	await ensureFolder(app, path);
	let content = "";
	if (cfg.template) {
		const tPath = normalizePath(cfg.template.endsWith(".md") ? cfg.template : `${cfg.template}.md`);
		const tFile = app.vault.getAbstractFileByPath(tPath);
		if (tFile instanceof TFile) {
			content = (await app.vault.read(tFile))
				.replace(/{{\s*date\s*}}/g, date.format(cfg.format))
				.replace(/{{\s*title\s*}}/g, date.format(cfg.format))
				.replace(/{{\s*date:([^}]+)}}/g, (_m, f: string) => date.format(f.trim()));
		}
	}
	return app.vault.create(path, content);
}

export async function ensureFolder(app: App, filePath: string): Promise<void> {
	const parts = normalizePath(filePath).split("/");
	parts.pop();
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
	}
}

/** Append text to a file, creating it if needed, keeping a newline boundary. */
export async function appendToFile(app: App, path: string, text: string): Promise<TFile> {
	const norm = normalizePath(path);
	let file = app.vault.getAbstractFileByPath(norm);
	if (!(file instanceof TFile)) {
		await ensureFolder(app, norm);
		file = await app.vault.create(norm, "");
	}
	const f = file as TFile;
	await app.vault.process(f, (data) => {
		if (!data) return `${text}\n`;
		return data.endsWith("\n") ? `${data}${text}\n` : `${data}\n${text}\n`;
	});
	return f;
}
