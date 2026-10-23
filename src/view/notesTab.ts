// Zettelkasten tools: create fleeting / literature / permanent notes, find orphans,
// suggest links, resurface older notes, and split long notes into atomic ones.

import { App, Modal, moment, normalizePath, Notice, setIcon, Setting, TFile } from "obsidian";
import type SecondBrainPlugin from "../main";
import { ensureFolder } from "../data/daily";
import { linkCounts, orphans, resurface, splitSections, suggestLinks } from "../data/graph";
import type { NoteInfo } from "../types";
import { emptyState, pill, section, type DashboardContext } from "./components";

export interface NotesState {
	/** Orphan whose suggestions are expanded. */
	expanded?: string;
}

type NoteKind = "fleeting" | "literature" | "permanent";

const inFolder = (path: string, folder: string) => !!folder && path.startsWith(folder.replace(/\/$/, "") + "/");

export function noteKind(n: NoteInfo, plugin: SecondBrainPlugin): NoteKind | null {
	const s = plugin.settings;
	if (n.type === "zettel" || n.type === "permanent" || inFolder(n.path, s.zettelFolder)) return "permanent";
	if (n.type === "literature" || n.type === "source" || inFolder(n.path, s.sourcesFolder)) return "literature";
	if (n.type === "fleeting" || inFolder(n.path, s.inboxFolder)) return "fleeting";
	return null;
}

/** Add `[[target]]` under a "## Related" heading in `fromPath` (created if missing). */
export async function addRelatedLink(app: App, fromPath: string, targetPath: string): Promise<void> {
	const from = app.vault.getFileByPath(fromPath);
	const target = app.vault.getFileByPath(targetPath);
	if (!from || !target) return;
	const link = `- [[${app.metadataCache.fileToLinktext(target, fromPath, true)}]]`;
	await app.vault.process(from, (data) => {
		const lines = data.split("\n");
		const h = lines.findIndex((l) => /^##\s+related\s*$/i.test(l.trim()));
		if (h < 0) return `${data.replace(/\s*$/, "")}\n\n## Related\n${link}\n`;
		let end = h + 1;
		while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
		while (end > h + 1 && lines[end - 1].trim() === "") end--;
		lines.splice(end, 0, link);
		return lines.join("\n");
	});
	new Notice(`Linked to ${target.basename}`);
}

export function renderNotesTab(el: HTMLElement, ctx: DashboardContext, st: NotesState, update: (p: Partial<NotesState>) => void): void {
	const plugin = ctx.plugin;
	const notes = [...plugin.index.notes.values()];
	const resolved = ctx.app.metadataCache.resolvedLinks;
	const kinds = new Map(notes.map((n) => [n.path, noteKind(n, plugin)]));
	const count = (k: NoteKind) => notes.filter((n) => kinds.get(n.path) === k).length;
	const lonely = orphans(notes, resolved);

	// ---- Create ----
	const create = el.createDiv({ cls: "sbd-notes-create" });
	const btn = (kind: NoteKind, icon: string, label: string, hint: string) => {
		const b = create.createDiv({ cls: `sbd-create-card sbd-create-${kind}`, attr: { role: "button" } });
		setIcon(b.createSpan({ cls: "sbd-icon" }), icon);
		const t = b.createDiv();
		t.createDiv({ cls: "sbd-create-title", text: label });
		t.createDiv({ cls: "sbd-muted", text: hint });
		b.onclick = () => new NewNoteModal(ctx.app, plugin, kind, (path) => ctx.openPath(path, undefined, true)).open();
	};
	btn("fleeting", "zap", "Fleeting note", "A quick thought to process later in the Inbox");
	btn("literature", "book-open", "Literature note", "What a book, article or video says, in your words");
	btn("permanent", "gem", "Permanent note", "One idea, in your own words, linked to others");

	// ---- Stats ----
	const { out } = linkCounts(resolved);
	const linkTotal = [...out.values()].reduce((a, b) => a + b, 0);
	const tiles = el.createDiv({ cls: "sbd-stats" });
	for (const [label, value] of [
		["permanent", count("permanent")], ["literature", count("literature")], ["fleeting", count("fleeting")],
		["orphans", lonely.length], ["links per note", notes.length ? (linkTotal / notes.length).toFixed(1) : "0"],
	] as const) {
		const t = tiles.createDiv({ cls: `sbd-stat ${label === "orphans" && lonely.length ? "is-today" : ""}` });
		t.createDiv({ cls: "sbd-stat-value", text: String(value) });
		t.createDiv({ cls: "sbd-stat-label", text: label });
	}

	const split = el.createDiv({ cls: "sbd-split" });

	// ---- Orphans with suggestions ----
	const orphanBody = section(split, { title: "orphans", icon: "unlink" });
	orphanBody.createDiv({ cls: "sbd-muted sbd-section-hint", text: "Notes with no links in or out. Connect each to at least one other note." });
	if (!lonely.length) emptyState(orphanBody, "Every note is connected. Nice.");
	for (const n of lonely.slice(0, 25)) {
		const row = orphanBody.createDiv({ cls: "sbd-orphan" });
		const head = row.createDiv({ cls: "sbd-orphan-head" });
		const caret = head.createSpan({ cls: "sbd-icon" });
		setIcon(caret, st.expanded === n.path ? "chevron-down" : "chevron-right");
		head.createSpan({ cls: "sbd-note-name", text: n.name });
		const k = kinds.get(n.path);
		if (k) pill(head, k, "gray");
		head.createSpan({ cls: "sbd-muted", text: moment(n.mtime).fromNow() });
		head.onclick = () => update({ expanded: st.expanded === n.path ? undefined : n.path });
		const open = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Open note" } });
		setIcon(open, "file-text");
		open.onclick = (e) => { e.stopPropagation(); ctx.openPath(n.path); };
		if (st.expanded === n.path) suggestionList(row.createDiv({ cls: "sbd-orphan-body" }), ctx, n, notes);
	}
	if (lonely.length > 25) orphanBody.createDiv({ cls: "sbd-muted", text: `+ ${lonely.length - 25} more` });

	const side = split.createDiv({ cls: "sbd-side-col sbd-notes-side" });

	// ---- Current note: suggestions + split ----
	const lastPath = ctx.app.workspace.getLastOpenFiles().find((p) => p.endsWith(".md") && plugin.index.notes.has(p));
	const current = lastPath ? plugin.index.notes.get(lastPath) : undefined;
	const cur = section(side, { title: "last opened note", icon: "file-search" });
	if (!current) emptyState(cur, "Open a note, then come back here for link ideas.");
	else {
		const h = cur.createDiv({ cls: "sbd-orphan-head" });
		h.createSpan({ cls: "sbd-note-name sbd-current-note", text: current.name });
		h.onclick = () => ctx.openPath(current.path);
		suggestionList(cur, ctx, current, notes);
		const splitBtn = cur.createEl("button", { cls: "sbd-ghost-btn sbd-split-btn" });
		setIcon(splitBtn.createSpan({ cls: "sbd-icon" }), "scissors");
		splitBtn.createSpan({ text: "split into atomic notes" });
		splitBtn.onclick = () => {
			const f = ctx.app.vault.getFileByPath(current.path);
			if (f) new SplitModal(ctx.app, plugin, f).open();
		};
	}

	// ---- Resurface ----
	const res = section(side, { title: "resurface", icon: "sparkles" });
	const reviewedOf = (n: NoteInfo) => {
		const f = ctx.app.vault.getFileByPath(n.path);
		const v = f ? ctx.app.metadataCache.getFileCache(f)?.frontmatter?.reviewed : undefined;
		return v ? String(v).slice(0, 10) : undefined;
	};
	const picks = resurface(notes, ctx.today, 5, 30, reviewedOf);
	res.createDiv({ cls: "sbd-muted sbd-section-hint", text: "Older notes to re-read today. New connections often show up here." });
	if (!picks.length) emptyState(res, "Nothing older than a month to resurface yet.");
	for (const n of picks) {
		const row = res.createDiv({ cls: "sbd-note-row" });
		setIcon(row.createSpan({ cls: "sbd-icon" }), "history");
		row.createSpan({ cls: "sbd-note-name", text: n.name });
		row.createSpan({ cls: "sbd-muted", text: moment(n.mtime).format("MMM YYYY") });
		row.onclick = () => ctx.openPath(n.path);
		const ok = row.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Mark reviewed today" } });
		setIcon(ok, "check");
		ok.onclick = async (e) => {
			e.stopPropagation();
			const f = ctx.app.vault.getFileByPath(n.path);
			if (f) await ctx.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => { fm.reviewed = ctx.today; });
		};
	}
}

function suggestionList(el: HTMLElement, ctx: DashboardContext, note: NoteInfo, notes: NoteInfo[]): void {
	const sugg = suggestLinks(note, notes, ctx.app.metadataCache.resolvedLinks, 5);
	if (!sugg.length) { el.createDiv({ cls: "sbd-muted", text: "No obvious matches. Try tagging it or giving it a more specific title." }); return; }
	for (const s of sugg) {
		const row = el.createDiv({ cls: "sbd-suggest" });
		row.createSpan({ cls: "sbd-note-name", text: s.note.name });
		row.createSpan({ cls: "sbd-muted sbd-suggest-why", text: s.reasons.join(" · ") });
		const add = row.createEl("button", { cls: "sbd-ghost-btn", attr: { "aria-label": `Link ${note.name} → ${s.note.name}` } });
		setIcon(add.createSpan({ cls: "sbd-icon" }), "link");
		add.createSpan({ text: "link" });
		add.onclick = async () => { add.disabled = true; await addRelatedLink(ctx.app, note.path, s.note.path); };
	}
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();

/** Create a fleeting, literature or permanent note from a template. */
export class NewNoteModal extends Modal {
	private title = "";
	private author = "";
	private url = "";
	private source: "book" | "article" | "video" | "podcast" = "book";

	constructor(app: App, private plugin: SecondBrainPlugin, private kind: NoteKind, private onCreated: (path: string) => void) {
		super(app);
	}

	onOpen(): void {
		const names = { fleeting: "New fleeting note", literature: "New literature note", permanent: "New permanent note" };
		this.setTitle(names[this.kind]);
		const { contentEl } = this;
		new Setting(contentEl).setName(this.kind === "literature" ? "Source title" : "Title")
			.setDesc(this.kind === "permanent" ? "State the idea as a claim, e.g. “Spaced repetition beats cramming”." : "")
			.addText((t) => {
				t.onChange((v) => { this.title = v; });
				t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) void this.create(); });
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		if (this.kind === "literature") {
			new Setting(contentEl).setName("Type").addDropdown((d) => d.addOption("book", "Book").addOption("article", "Article").addOption("video", "Video").addOption("podcast", "Podcast")
				.setValue(this.source).onChange((v) => { this.source = v as typeof this.source; }));
			new Setting(contentEl).setName("Author").addText((t) => t.onChange((v) => { this.author = v.trim(); }));
			new Setting(contentEl).setName("Link").addText((t) => t.setPlaceholder("https://…").onChange((v) => { this.url = v.trim(); }));
		}
		new Setting(contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(() => void this.create()));
	}

	private async create(): Promise<void> {
		const title = this.title.trim();
		if (!title) { new Notice("Give it a title."); return; }
		const s = this.plugin.settings;
		const folder = this.kind === "fleeting" ? s.inboxFolder : this.kind === "literature" ? s.sourcesFolder : s.zettelFolder;
		const id = this.kind === "permanent" && s.zettelIds ? `${moment().format("YYYYMMDDHHmm")} ` : "";
		let path = normalizePath(`${folder ? `${folder}/` : ""}${id}${safeName(title)}.md`);
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder ? `${folder}/` : ""}${id}${safeName(title)} ${i}.md`);
		const body = this.kind === "literature"
			? `# ${title}\n\n## Summary\n\n\n## Key ideas\n- \n\n## Quotes\n> \n\n## My thoughts\n\n`
			: this.kind === "permanent"
				? `# ${title}\n\n\n\n## Related\n`
				: `${title}\n`;
		await ensureFolder(this.app, path);
		const custom = await this.templateBody(title);
		const file = await this.app.vault.create(path, custom ?? body);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm.type = this.kind === "permanent" ? "zettel" : this.kind;
			fm.created = moment().format("YYYY-MM-DD");
			if (this.kind === "literature") {
				fm.source = this.source;
				if (this.author) fm.author = this.author;
				if (this.url) fm.url = this.url;
			}
		});
		this.close();
		this.onCreated(path);
	}

	/**
	 * Use "<templates folder>/<Fleeting|Literature|Permanent> note.md" when it exists.
	 * Supports {{title}}, {{date}}, {{time}} and {{date:FORMAT}}.
	 */
	private async templateBody(title: string): Promise<string | null> {
		const internal = (this.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { instance?: { options?: { folder?: string } } } | undefined } }).internalPlugins;
		const folder = (internal?.getPluginById?.("templates")?.instance?.options?.folder || "Templates").replace(/^\/|\/$/g, "");
		const name = { fleeting: "Fleeting note", literature: "Literature note", permanent: "Permanent note" }[this.kind];
		const file = this.app.vault.getFileByPath(normalizePath(`${folder}/${name}.md`));
		if (!file) return null;
		const now = moment();
		return (await this.app.vault.read(file))
			.replace(/{{\s*title\s*}}/g, title)
			.replace(/{{\s*date:([^}]+)}}/g, (_m, f: string) => now.format(f.trim()))
			.replace(/{{\s*date\s*}}/g, now.format("YYYY-MM-DD"))
			.replace(/{{\s*time\s*}}/g, now.format("HH:mm"));
	}

	onClose(): void { this.contentEl.empty(); }
}

/** Turn each "## " section of a note into its own permanent note; the original keeps links to them. */
class SplitModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private file: TFile) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.setTitle(`Split “${this.file.basename}”`);
		const { contentEl } = this;
		const { intro, sections } = splitSections(await this.app.vault.read(this.file));
		if (!sections.length) {
			contentEl.createDiv({ cls: "sbd-muted", text: "This note has no “## ” headings to split on. Add a heading above each idea first." });
			return;
		}
		contentEl.createDiv({ cls: "sbd-modal-help", text: `Each section becomes a permanent note in ${this.plugin.settings.zettelFolder}/. This note keeps its intro and gets a list of links in place of the sections.` });
		const chosen = new Set(sections.map((_, i) => i));
		sections.forEach((sec, i) => {
			new Setting(contentEl).setName(sec.title).setDesc(sec.body.slice(0, 90) + (sec.body.length > 90 ? "…" : ""))
				.addToggle((t) => t.setValue(true).onChange((v) => { if (v) chosen.add(i); else chosen.delete(i); }));
		});
		new Setting(contentEl).addButton((b) => b.setButtonText("Split").setCta().onClick(async () => {
			const s = this.plugin.settings;
			const links: string[] = [];
			const kept: string[] = [];
			for (const [i, sec] of sections.entries()) {
				if (!chosen.has(i)) { kept.push(`## ${sec.title}\n${sec.body}`); continue; }
				const id = s.zettelIds ? `${moment().add(i, "minute").format("YYYYMMDDHHmm")} ` : "";
				let path = normalizePath(`${s.zettelFolder}/${id}${safeName(sec.title)}.md`);
				for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${s.zettelFolder}/${id}${safeName(sec.title)} ${n}.md`);
				await ensureFolder(this.app, path);
				const f = await this.app.vault.create(path, `# ${sec.title}\n\n${sec.body}\n\n## Related\n- [[${this.file.basename}]]\n`);
				await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => { fm.type = "zettel"; fm.created = moment().format("YYYY-MM-DD"); });
				links.push(`- [[${f.basename}]]`);
			}
			await this.app.vault.process(this.file, (data) => {
				const fm = data.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] ?? "";
				return `${fm}${intro ? `${intro}\n\n` : ""}${kept.length ? `${kept.join("\n\n")}\n\n` : ""}## Atomic notes\n${links.join("\n")}\n`;
			});
			new Notice(`Split into ${links.length} note${links.length === 1 ? "" : "s"}.`);
			this.close();
		}));
	}

	onClose(): void { this.contentEl.empty(); }
}
