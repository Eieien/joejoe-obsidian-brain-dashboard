// A small browser stand-in for the Obsidian API: just enough to render the dashboard
// against an in-memory copy of demo-vault for visual checks. Not shipped with the plugin.
import yaml from "js-yaml";
import * as lucide from "lucide";
import momentLib from "moment";

export const moment = momentLib;

// ---------- Obsidian's DOM helpers ----------
type Info = { cls?: string | string[]; text?: string; attr?: Record<string, unknown>; type?: string; value?: string; placeholder?: string } | string;
function apply(el: HTMLElement, o?: Info): void {
	if (!o) return;
	if (typeof o === "string") { el.className = o; return; }
	if (o.cls) el.className = (Array.isArray(o.cls) ? o.cls.join(" ") : o.cls).trim().replace(/\s+/g, " ");
	if (o.text !== undefined) el.textContent = o.text;
	if (o.type) el.setAttribute("type", o.type);
	if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
	if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
	for (const [k, v] of Object.entries(o.attr ?? {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
}
const P = Element.prototype as unknown as Record<string, unknown>;
P.createEl = function (this: Element, tag: string, o?: Info, cb?: (el: HTMLElement) => void) { const el = document.createElement(tag); apply(el, o); this.appendChild(el); cb?.(el); return el; };
P.createDiv = function (this: Element, o?: Info) { return (this as unknown as { createEl: (t: string, o?: Info) => HTMLElement }).createEl("div", o); };
P.createSpan = function (this: Element, o?: Info) { return (this as unknown as { createEl: (t: string, o?: Info) => HTMLElement }).createEl("span", o); };
P.empty = function (this: Element) { while (this.firstChild) this.removeChild(this.firstChild); };
P.addClass = function (this: Element, ...c: string[]) { this.classList.add(...c.flatMap((x) => x.split(" ")).filter(Boolean)); };
P.removeClass = function (this: Element, ...c: string[]) { this.classList.remove(...c); };
P.toggleClass = function (this: Element, c: string, v?: boolean) { this.classList.toggle(c, v); };
P.hasClass = function (this: Element, c: string) { return this.classList.contains(c); };
P.setText = function (this: Element, t: string) { this.textContent = t; };
P.appendText = function (this: Element, t: string) { this.appendChild(document.createTextNode(t)); };
P.setAttr = function (this: Element, k: string, v: string) { this.setAttribute(k, v); };
P.detach = function (this: Element) { this.remove(); };
P.hide = function (this: HTMLElement) { this.style.display = "none"; };
P.show = function (this: HTMLElement) { this.style.display = ""; };
(window as unknown as Record<string, unknown>).createEl = (tag: string, o?: Info) => { const el = document.createElement(tag); apply(el, o); return el; };

// ---------- Icons ----------
const toPascal = (n: string) => n.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
const ALIASES: Record<string, string> = { "more-horizontal": "ellipsis", "check-circle-2": "circle-check", "x-circle": "circle-x", "pause-circle": "circle-pause", "alert-triangle": "triangle-alert", "play-circle": "circle-play", "sliders-horizontal": "sliders-horizontal", "edit": "pencil", "home": "house", "layout-grid": "layout-grid", "file-pen": "file-pen-line", "loader": "loader" };
function iconNode(name: string): unknown {
	const icons = (lucide as unknown as { icons: Record<string, unknown> }).icons;
	return icons[toPascal(ALIASES[name] ?? name)];
}
export function getIcon(name: string): SVGSVGElement | null {
	const node = iconNode(name);
	if (!node) return null;
	return (lucide as unknown as { createElement: (n: unknown) => SVGSVGElement }).createElement(node);
}
export function getIconIds(): string[] {
	return Object.keys((lucide as unknown as { icons: Record<string, unknown> }).icons).map((k) => k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])([0-9])/g, "$1-$2").toLowerCase());
}
export function setIcon(el: HTMLElement, name: string): void {
	el.empty();
	const svg = getIcon(name);
	if (svg) { svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.classList.add("svg-icon"); el.appendChild(svg); }
}

// ---------- Utilities ----------
export function normalizePath(p: string): string { return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""); }
export function debounce<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
	let t: number | undefined;
	return (...a: T) => { window.clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
}
export class Notice { constructor(msg: string | DocumentFragment, _t?: number) { console.log("[Notice]", typeof msg === "string" ? msg : msg.textContent); } hide() {} }

export class Events {
	private handlers = new Map<string, ((...a: unknown[]) => void)[]>();
	on(name: string, cb: (...a: unknown[]) => void) { const l = this.handlers.get(name) ?? []; l.push(cb); this.handlers.set(name, l); return { name, cb }; }
	off() {}
	trigger(name: string, ...a: unknown[]) { for (const cb of this.handlers.get(name) ?? []) cb(...a); }
}

// ---------- Vault model ----------
export class TAbstractFile { constructor(public path: string, public name: string, public parent: TFolder | null) {} }
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; isRoot() { return this.path === ""; } }
export class TFile extends TAbstractFile {
	basename: string; extension: string;
	stat: { mtime: number; ctime: number; size: number };
	constructor(path: string, parent: TFolder | null, public content: string, mtime: number, ctime: number) {
		super(path, path.split("/").pop()!, parent);
		this.extension = path.split(".").pop()!;
		this.basename = this.name.replace(/\.[^.]+$/, "");
		this.stat = { mtime, ctime, size: content.length };
	}
}

interface Cache {
	frontmatter?: Record<string, unknown>;
	listItems?: { task?: string; position: { start: { line: number } } }[];
	tags?: { tag: string }[];
	links?: { link: string }[];
}

function parseCache(content: string): Cache {
	const lines = content.split("\n");
	const cache: Cache = { listItems: [], tags: [], links: [] };
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) {
			try { cache.frontmatter = (yaml.load(lines.slice(1, end).join("\n"), { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) ?? {}; } catch { /* ignore */ }
			start = end + 1;
		}
	}
	for (let i = start; i < lines.length; i++) {
		const m = lines[i].match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[(.)\])?/);
		if (m) cache.listItems!.push({ task: m[1], position: { start: { line: i } } });
		for (const t of lines[i].matchAll(/(^|\s)(#[\p{L}\p{N}_\-/]+)/gu)) cache.tags!.push({ tag: t[2] });
		for (const l of lines[i].matchAll(/\[\[([^\]|#]+)/g)) cache.links!.push({ link: l[1] });
	}
	return cache;
}

export class MarkdownRenderChild { constructor(public containerEl: HTMLElement) {} onunload() {} }
export function getAllTags(cache: Cache): string[] {
	const fmTags = cache.frontmatter?.tags;
	const fm = (Array.isArray(fmTags) ? fmTags : fmTags ? [fmTags] : []).map((t) => `#${String(t).replace(/^#/, "")}`);
	return [...fm, ...(cache.tags ?? []).map((t) => t.tag)];
}

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	workspace = { getLeaf: () => ({ openFile: async (f: TFile) => console.log("open", f.path) }), requestSaveLayout() {}, getLastOpenFiles: () => ["Notes/Spaced repetition.md"], onLayoutReady(cb: () => void) { cb(); }, getLeavesOfType: () => [], revealLeaf: async () => {} };
	fileManager = { processFrontMatter: async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => fn({}), getAvailablePathForAttachment: async (n: string) => `Attachments/${n}` };
	internalPlugins = { getPluginById: (id: string) => (id === "daily-notes" ? { enabled: true, instance: { options: { folder: "Daily", format: "YYYY-MM-DD" } } } : undefined) };
	constructor(files: { path: string; content: string; mtime: number; ctime: number }[]) {
		this.vault = new Vault(files);
		this.metadataCache = new MetadataCache(this.vault);
	}
}

class Vault extends Events {
	root = new TFolder("", "", null);
	private map = new Map<string, TAbstractFile>([["", this.root]]);
	constructor(files: { path: string; content: string; mtime: number; ctime: number }[]) {
		super();
		for (const f of files) this.addFile(f.path, f.content, f.mtime, f.ctime);
	}
	private folder(path: string): TFolder {
		if (!path) return this.root;
		const hit = this.map.get(path);
		if (hit instanceof TFolder) return hit;
		const parent = this.folder(path.split("/").slice(0, -1).join("/"));
		const f = new TFolder(path, path.split("/").pop()!, parent);
		parent.children.push(f);
		this.map.set(path, f);
		return f;
	}
	addFile(path: string, content: string, mtime = Date.now(), ctime = Date.now()): TFile {
		const parent = this.folder(path.split("/").slice(0, -1).join("/"));
		const f = new TFile(path, parent, content, mtime, ctime);
		parent.children.push(f);
		this.map.set(path, f);
		return f;
	}
	getRoot() { return this.root; }
	getAbstractFileByPath(p: string) { return this.map.get(normalizePath(p)) ?? null; }
	getFileByPath(p: string) { const f = this.map.get(p); return f instanceof TFile ? f : null; }
	getFiles() { return [...this.map.values()].filter((f): f is TFile => f instanceof TFile); }
	getAllLoadedFiles() { return [...this.map.values()]; }
	async createBinary(p: string) { return this.addFile(p, ""); }
	async readBinary(f: TFile) {
		const bin = atob(f.content);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out.buffer;
	}
	getMarkdownFiles() { return [...this.map.values()].filter((f): f is TFile => f instanceof TFile && f.extension === "md"); }
	async cachedRead(f: TFile) { return f.content; }
	async read(f: TFile) { return f.content; }
	async process(f: TFile, fn: (d: string) => string) { f.content = fn(f.content); return f.content; }
	async create(p: string, c: string) { return this.addFile(p, c); }
	async createFolder(p: string) { this.folder(p); }
	getResourcePath(f: TFile) {
		const ext = f.extension.toLowerCase();
		return f.extension === "md" ? `../../demo-vault/${f.path}` : `data:image/${ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext};base64,${f.content}`;
	}
}

class MetadataCache extends Events {
	private caches = new Map<string, Cache>();
	resolvedLinks: Record<string, Record<string, number>> = {};
	constructor(private vault: Vault) {
		super();
		for (const f of vault.getMarkdownFiles()) this.caches.set(f.path, parseCache(f.content));
		for (const f of vault.getMarkdownFiles()) {
			const out: Record<string, number> = {};
			for (const l of this.caches.get(f.path)?.links ?? []) {
				const dest = this.getFirstLinkpathDest(l.link, f.path);
				if (dest) out[dest.path] = (out[dest.path] ?? 0) + 1;
			}
			this.resolvedLinks[f.path] = out;
		}
	}
	getFileCache(f: TFile) { return this.caches.get(f.path) ?? null; }
	getFirstLinkpathDest(link: string, _src: string): TFile | null {
		const files = this.vault.getMarkdownFiles();
		return files.find((f) => f.path === `${link}.md` || f.path === link) ?? files.find((f) => f.basename.toLowerCase() === link.split("/").pop()!.toLowerCase()) ?? null;
	}
	fileToLinktext(f: TFile) { return f.basename; }
}

// ---------- Views / plugins / UI ----------
export class Component { registerEvent() {} registerInterval(id: number) { return id; } register() {} }
export class ItemView extends Component {
	contentEl: HTMLElement; containerEl: HTMLElement; app: App;
	constructor(public leaf: { app: App; containerEl: HTMLElement }) {
		super();
		this.app = leaf.app;
		this.containerEl = leaf.containerEl;
		this.contentEl = leaf.containerEl.createDiv({ cls: "view-content" });
	}
	getState() { return {}; }
	async setState() {}
}
export class Plugin extends Component {
	constructor(public app: App, public manifest: unknown) { super(); }
	async loadData() { return (window as unknown as { __SBD_DATA__: unknown }).__SBD_DATA__ ?? null; }
	async saveData() {}
	addCommand() {} addRibbonIcon() {} addSettingTab() {} registerView() {} registerMarkdownCodeBlockProcessor() {}
}
export class PluginSettingTab { containerEl = document.createElement("div"); constructor(public app: App, public plugin: unknown) {} }
export class Modal {
	containerEl = document.createElement("div");
	modalEl = document.createElement("div");
	titleEl = document.createElement("div");
	contentEl = document.createElement("div");
	constructor(public app: App) {
		this.containerEl.className = "modal-container";
		this.containerEl.createDiv({ cls: "modal-bg" });
		this.modalEl.className = "modal";
		this.containerEl.appendChild(this.modalEl);
		this.modalEl.createDiv({ cls: "modal-close-button" });
		this.titleEl.className = "modal-title";
		this.modalEl.appendChild(this.titleEl);
		this.contentEl.className = "modal-content";
		this.modalEl.appendChild(this.contentEl);
	}
	open() { document.body.appendChild(this.containerEl); (this as unknown as { onOpen?: () => void }).onOpen?.(); }
	close() { (this as unknown as { onClose?: () => void }).onClose?.(); this.containerEl.remove(); }
	setTitle(t: string) { this.titleEl.textContent = t; return this; }
}
export class Menu { addItem() { return this; } showAtMouseEvent() {} }
export class Setting { setDisabled() { return this; } setTooltip() { return this; } controlEl = document.createElement("div"); constructor(_el: HTMLElement) {} setName() { return this; } setDesc() { return this; } setHeading() { return this; } addText() { return this; } addToggle() { return this; } addDropdown() { return this; } addButton() { return this; } addExtraButton() { return this; } addSlider() { return this; } addColorPicker() { return this; } addTextArea() { return this; } }
export const MarkdownRenderer = {
	async render(_app: unknown, md: string, el: HTMLElement) {
		for (const block of md.split(/\n{2,}/)) {
			const lines = block.split("\n");
			if (lines.every((l) => /^\s*[-*] /.test(l))) {
				const ul = el.createEl("ul");
				for (const l of lines) ul.createEl("li", { text: l.replace(/^\s*[-*] /, "") });
			} else if (/^#+ /.test(block)) el.createEl("h4", { text: block.replace(/^#+ /, "") });
			else el.createEl("p", { text: block.replace(/\*\*/g, "") });
		}
	},
};
export type ViewStateResult = unknown;
export type WorkspaceLeaf = unknown;
export type TextComponent = unknown;

export const Platform = { isDesktopApp: true };
export class FileSystemAdapter { getBasePath() { return ""; } }
