import { moment, setIcon, TFolder } from "obsidian";
import type { NoteInfo } from "../types";
import { emptyState, pill, type DashboardContext } from "./components";

export interface LibraryState {
	search: string;
	/** "all" = everything except daily notes; "everything" includes them. */
	kind: "all" | "everything" | "note" | "project" | "daily";
	folder?: string;
	tag?: string;
	area?: string;
	view: "big" | "list" | "grid";
	sort: "az" | "recent";
	limit: number;
}

export const defaultLibrary = (): LibraryState => ({ search: "", kind: "all", view: "big", sort: "az", limit: 300 });

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

function letterOf(name: string): string {
	const c = name.trim().charAt(0).toUpperCase();
	return c >= "A" && c <= "Z" ? c : "#";
}

export function filterNotes(notes: NoteInfo[], st: LibraryState): NoteInfo[] {
	const q = st.search.trim().toLowerCase();
	const out = notes.filter((n) => {
		if (st.kind === "all" ? n.kind === "daily" : st.kind !== "everything" && n.kind !== st.kind) return false;
		if (st.folder && !(n.path.startsWith(st.folder + "/"))) return false;
		if (st.tag && !n.tags.some((t) => t === st.tag || t.startsWith(st.tag + "/"))) return false;
		if (st.area && n.area?.toLowerCase() !== st.area.toLowerCase()) return false;
		if (q && !(n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)) || (n.type ?? "").includes(q))) return false;
		return true;
	});
	return st.sort === "az"
		? out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
		: out.sort((a, b) => b.mtime - a.mtime);
}

export function renderLibraryTab(el: HTMLElement, ctx: DashboardContext, st: LibraryState, update: (p: Partial<LibraryState>) => void): void {
	const all = [...ctx.plugin.index.notes.values()];
	const notes = filterNotes(all, st);

	const layout = el.createDiv({ cls: "sbd-library" });
	const rail = layout.createDiv({ cls: "sbd-letter-rail" });
	const main = layout.createDiv({ cls: "sbd-library-main" });
	const side = layout.createDiv({ cls: "sbd-library-side" });

	// ---- Search + folder filter ----
	const top = main.createDiv({ cls: "sbd-library-top" });
	const search = top.createEl("input", { type: "search", cls: "sbd-library-search", attr: { placeholder: "search…", "data-sbd-focus": "library-search" } });
	search.value = st.search;
	let t: number | undefined;
	search.oninput = () => { window.clearTimeout(t); t = window.setTimeout(() => update({ search: search.value, limit: 300 }), 180); };

	const filters = main.createDiv({ cls: "sbd-library-filters" });
	const folderSel = filters.createEl("select", { cls: `dropdown sbd-select ${st.folder ? "is-set" : ""}`, attr: { "aria-label": "Folder" } });
	folderSel.createEl("option", { value: "", text: "All folders" });
	const folders = ctx.app.vault.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && !!f.path && !f.path.startsWith(".") && !ctx.plugin.index.isExcluded(f.path))
		.map((f) => f.path).sort((x, y) => x.localeCompare(y));
	for (const f of folders) {
		const depth = f.split("/").length - 1;
		folderSel.createEl("option", { value: f, text: `${"  ".repeat(depth)}${f.split("/").pop()}` });
	}
	folderSel.value = st.folder ?? "";
	folderSel.onchange = () => update({ folder: folderSel.value || undefined, limit: 300 });

	const kinds = filters.createDiv({ cls: "sbd-segmented" });
	const kindLabels = { all: "all", note: "notes", project: "projects", daily: "daily", everything: "everything" } as const;
	(["all", "note", "project", "daily", "everything"] as const).forEach((k) => {
		const b = kinds.createEl("button", { text: kindLabels[k], cls: st.kind === k ? "is-active" : "" });
		b.onclick = () => update({ kind: k, limit: 300 });
	});
	const chip = (label: string, clear: Partial<LibraryState>) => {
		const c = filters.createSpan({ cls: "sbd-filter-chip", text: label });
		setIcon(c.createSpan({ cls: "sbd-icon" }), "x");
		c.onclick = () => update(clear);
	};
	if (st.tag) chip(`#${st.tag}`, { tag: undefined });
	if (st.area) chip(`area: ${st.area}`, { area: undefined });
	filters.createSpan({ cls: "sbd-muted sbd-library-count", text: `${notes.length} of ${all.length}` });

	// ---- Results, grouped by first letter (A–Z) or by month (recent) ----
	const results = main.createDiv({ cls: `sbd-library-results is-${st.view}` });
	if (!notes.length) emptyState(results, "No notes match. Clear a filter or try another search.");
	const present = new Set<string>();
	let groupKey = "";
	let groupBody: HTMLElement | null = null;
	const shown = notes.slice(0, st.limit);
	const counts = new Map<string, number>();
	const keyOf = (n: NoteInfo) => (st.sort === "az" ? letterOf(n.name) : moment(n.mtime).format("MMMM YYYY"));
	for (const n of notes) counts.set(keyOf(n), (counts.get(keyOf(n)) ?? 0) + 1);
	for (const n of shown) {
		const key = keyOf(n);
		if (key !== groupKey || !groupBody) {
			groupKey = key;
			present.add(key);
			const head = results.createDiv({ cls: "sbd-lib-group", attr: { "data-letter": key } });
			head.createSpan({ cls: "sbd-lib-group-key", text: key.toLowerCase() === key ? key : st.sort === "az" ? key : key.toLowerCase() });
			head.createSpan({ cls: "sbd-lib-group-rule" });
			head.createSpan({ cls: "sbd-lib-group-count", text: String(counts.get(key) ?? 0) });
			groupBody = results.createDiv({ cls: "sbd-lib-group-body" });
		}
		renderNote(groupBody, ctx, n, st.view);
	}
	if (notes.length > st.limit) {
		const more = results.createDiv({ cls: "sbd-load-more" });
		setIcon(more.createSpan({ cls: "sbd-icon" }), "arrow-down");
		more.createSpan({ text: `load more · ${notes.length - st.limit} remaining` });
		more.onclick = () => update({ limit: st.limit + 300 });
	}

	// ---- Letter rail (jump within A–Z) ----
	for (const L of LETTERS) {
		const b = rail.createDiv({ cls: `sbd-letter ${st.sort === "az" && present.has(L) ? "" : "is-empty"}`, text: L });
		b.onclick = () => {
			if (st.sort !== "az") { update({ sort: "az" }); return; }
			results.querySelector(`[data-letter="${L}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
		};
	}

	// ---- Side: view toggles, sort, top-level folders ----
	const views = side.createDiv({ cls: "sbd-view-toggles" });
	([["big", "align-justify", "Large index"], ["list", "list", "Notebook list"], ["grid", "layout-grid", "Cards"]] as const).forEach(([v, icon, label]) => {
		const b = views.createEl("button", { cls: `sbd-icon-btn clickable-icon ${st.view === v ? "is-active" : ""}`, attr: { "aria-label": label } });
		setIcon(b, icon);
		b.onclick = () => update({ view: v });
	});
	const opt = (label: string, active: boolean, onClick: () => void, icon?: string) => {
		const o = side.createDiv({ cls: `sbd-side-opt ${active ? "is-active" : ""}` });
		if (icon) setIcon(o.createSpan({ cls: "sbd-icon" }), icon);
		o.createSpan({ text: label });
		o.onclick = onClick;
	};
	side.createDiv({ cls: "sbd-side-head", text: "sort" });
	opt("a – z", st.sort === "az", () => update({ sort: "az" }));
	opt("recently edited", st.sort === "recent", () => update({ sort: "recent" }));
	const topFolders = [...new Set(all.map((n) => n.folder).filter(Boolean))].sort();
	if (topFolders.length) {
		side.createDiv({ cls: "sbd-side-head", text: "folders" });
		opt("all folders", !st.folder, () => update({ folder: undefined, limit: 300 }), "folders");
		for (const f of topFolders.slice(0, 16)) {
			const n = all.filter((x) => x.path.startsWith(f + "/")).length;
			opt(`${f.toLowerCase()} · ${n}`, st.folder === f, () => update({ folder: st.folder === f ? undefined : f, limit: 300 }), "folder");
		}
	}
}

function renderNote(parent: HTMLElement, ctx: DashboardContext, n: NoteInfo, view: LibraryState["view"]): HTMLElement {
	const open = (e: MouseEvent) => (n.kind === "project" ? ctx.openProject(n.path) : ctx.openPath(n.path, undefined, e.ctrlKey || e.metaKey));
	if (view === "big") {
		const row = parent.createDiv({ cls: "sbd-index-row" });
		row.createSpan({ cls: "sbd-index-name", text: n.name });
		const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "/";
		row.createSpan({ cls: "sbd-index-folder", text: folder.toLowerCase() });
		pill(row.createSpan({ cls: "sbd-index-type" }), n.type ?? n.kind);
		row.createSpan({ cls: "sbd-index-date", text: moment(n.mtime).format("MMM D, YYYY") });
		row.onclick = open;
		return row;
	}
	if (view === "list") return notebookRow(parent, ctx, n);
	const card = parent.createDiv({ cls: "sbd-note-card" });
	card.createDiv({ cls: "sbd-note-card-name", text: n.name });
	card.createDiv({ cls: "sbd-muted", text: n.folder ? n.folder.toLowerCase() : "/" });
	const tags = card.createDiv({ cls: "sbd-note-card-tags" });
	pill(tags, n.type ?? n.kind);
	for (const tg of n.tags.slice(0, 3)) pill(tags, `#${tg}`, "gray");
	card.createDiv({ cls: "sbd-muted sbd-note-card-date", text: moment(n.mtime).format("MMM D, YYYY") });
	card.onclick = open;
	return card;
}

/** One line in a "notebook" list: icon · name · date · type pill (image 1 style). */
export function notebookRow(parent: HTMLElement, ctx: DashboardContext, n: NoteInfo, opts: { date?: number; pillText?: string } = {}): HTMLElement {
	const row = parent.createDiv({ cls: "sbd-nb-row" });
	setIcon(row.createSpan({ cls: "sbd-icon" }), n.kind === "daily" ? "calendar-days" : n.kind === "project" ? "folder-kanban" : typeIcon(n.type));
	row.createSpan({ cls: "sbd-nb-name", text: n.name });
	row.createSpan({ cls: "sbd-nb-date", text: moment(opts.date ?? n.mtime).format("MMMM D, YYYY h:mm A") });
	pill(row, opts.pillText ?? n.type ?? n.kind);
	row.onclick = (e) => (n.kind === "project" ? ctx.openProject(n.path) : ctx.openPath(n.path, undefined, e.ctrlKey || e.metaKey));
	return row;
}

function typeIcon(type?: string): string {
	switch (type) {
		case "article": return "newspaper";
		case "book": return "book-open";
		case "meeting": return "users";
		case "video": return "play-circle";
		case "photo": case "photograph": return "image";
		case "idea": return "lightbulb";
		case "person": return "user";
		default: return "bookmark";
	}
}
