import { ItemView, MarkdownRenderer, moment, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type SecondBrainPlugin from "../main";
import { styleClasses } from "../settings";
import { CaptureModal } from "./CaptureModal";
import { DayModal } from "./dayModal";
import { inboxItems, renderInboxTab, type InboxState } from "./inboxTab";
import { renderNotesTab, type NotesState } from "./notesTab";
import { renderReviewTab, type ReviewState } from "./reviewTab";
import { dissolveIn } from "./dither";
import { DEFAULT_CAL_LAYERS, renderCalendarTab, type CalendarState } from "./calendarTab";
import type { DashboardContext } from "./components";
import { defaultHome, renderHomeTab, type HomeState } from "./homeTab";
import { defaultLibrary, renderLibraryTab, type LibraryState } from "./libraryTab";
import { renderProjectsTab, type ProjectsState } from "./projectsTab";
import { renderCoursesTab, type CoursesState } from "./coursesTab";
import { noiseTile } from "./noise";
import { pageGlyph } from "./pageIcons";
import { defaultTaskFilters, renderTasksTab, type TaskFilters } from "./tasksTab";
import { renderTrackersTab, type TrackersState } from "./trackersTab";

export const VIEW_TYPE_DASHBOARD = "second-brain-dashboard";

export type TabId = "home" | "inbox" | "tasks" | "calendar" | "projects" | "courses" | "notes" | "trackers" | "review" | "library";

/** Page header text for each tab (Home has its own header). */
const PAGE_INFO: Partial<Record<TabId, { title: string; sub: string; color: string; tagline: string }>> = {
	inbox: { title: "Inbox", sub: "Process what you captured, one item at a time.", color: "sky", tagline: "clear your mind" },
	tasks: { title: "Tasks", sub: "Everything to do across your vault.", color: "amber", tagline: "one thing at a time" },
	calendar: { title: "Calendar", sub: "Deadlines, scheduled tasks and notes, day by day.", color: "rose", tagline: "time, laid out" },
	projects: { title: "Projects", sub: "Ongoing work and how far along it is.", color: "emerald", tagline: "work in motion" },
	courses: { title: "Courses", sub: "Your subjects, and what each one needs from you.", color: "indigo", tagline: "learn something today" },
	notes: { title: "Notes", sub: "Capture ideas, connect them, and revisit old ones.", color: "violet", tagline: "ideas, connected" },
	trackers: { title: "Trackers", sub: "Habits, money and anything else you measure.", color: "teal", tagline: "small steps, counted" },
	review: { title: "Weekly review", sub: "Look back on the week and plan the next.", color: "orange", tagline: "look back, plan ahead" },
	library: { title: "Library", sub: "Every note in your vault, A to Z.", color: "brown", tagline: "everything you know" },
};

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: "home", label: "home", icon: "home" },
	{ id: "inbox", label: "inbox", icon: "inbox" },
	{ id: "tasks", label: "tasks", icon: "check-square" },
	{ id: "calendar", label: "calendar", icon: "calendar" },
	{ id: "projects", label: "projects", icon: "folder-kanban" },
	{ id: "courses", label: "courses", icon: "graduation-cap" },
	{ id: "notes", label: "notes", icon: "gem" },
	{ id: "trackers", label: "trackers", icon: "activity" },
	{ id: "review", label: "review", icon: "clipboard-check" },
	{ id: "library", label: "library", icon: "library" },
];

interface DashboardState {
	tab: TabId;
	home: HomeState;
	tasks: TaskFilters;
	calendar: CalendarState;
	projects: ProjectsState;
	courses: CoursesState;
	trackers: TrackersState;
	library: LibraryState;
	inbox: InboxState;
	notes: NotesState;
	review: ReviewState;
}

type Patch = { [K in Exclude<keyof DashboardState, "tab">]?: Partial<DashboardState[K]> };

export class DashboardView extends ItemView {
	private state: DashboardState;
	private renderQueued = false;
	private intervals: number[] = [];
	private cleanups: (() => void)[] = [];
	private lastWidth = 0;
	private lastTab: TabId | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: SecondBrainPlugin) {
		super(leaf);
		this.state = {
			tab: "home",
			home: defaultHome(),
			tasks: defaultTaskFilters(plugin.settings.defaultTaskView),
			calendar: { mode: "month", anchor: "", layers: [...DEFAULT_CAL_LAYERS] },
			projects: { show: "active" },
			courses: { showInactive: false },
			trackers: { range: "month", hidden: [], weekOffset: 0 },
			library: defaultLibrary(),
			inbox: {},
			notes: {},
			review: { week: "" },
		};
	}

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return "Dashboard"; }
	getIcon(): string { return "layout-dashboard"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("sbd-root");
		this.registerEvent(this.plugin.index.on("updated", () => this.queueRender()));
		// Keep "today" correct on long-running sessions.
		this.registerInterval(window.setInterval(() => this.queueRender(), 10 * 60 * 1000));
		this.render();
	}

	async onClose(): Promise<void> {
		this.clearIntervals();
	}

	onResize(): void {
		// Charts size themselves to their container; redraw when the width really changes.
		const w = this.contentEl.clientWidth;
		if (Math.abs(w - this.lastWidth) > 40) this.queueRender();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), sbd: this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state as { sbd?: Partial<DashboardState> } | undefined)?.sbd;
		if (s) {
			const cur = this.state;
			this.state = {
				tab: s.tab && TABS.some((t) => t.id === s.tab) ? s.tab : cur.tab,
				home: { ...cur.home, ...(s.home ?? {}) },
				tasks: { ...cur.tasks, ...(s.tasks ?? {}) },
				calendar: { ...cur.calendar, ...(s.calendar ?? {}) },
				projects: { ...cur.projects, ...(s.projects ?? {}) },
				courses: { ...cur.courses, ...(s.courses ?? {}) },
				trackers: { ...cur.trackers, ...(s.trackers ?? {}) },
				library: { ...cur.library, ...(s.library ?? {}) },
				inbox: { ...cur.inbox, ...(s.inbox ?? {}) },
				notes: { ...cur.notes, ...(s.notes ?? {}) },
				review: { ...cur.review, ...(s.review ?? {}) },
			};
		}
		await super.setState(state, result);
		this.render();
	}

	/** Navigate programmatically (used by commands and cross-tab links). */
	navigate(tab: TabId, patch: Patch = {}): void {
		this.state.tab = tab;
		for (const [k, v] of Object.entries(patch) as [keyof Patch, object][]) {
			(this.state[k] as object) = { ...(this.state[k] as object), ...v };
		}
		this.app.workspace.requestSaveLayout();
		this.render();
	}

	private queueRender(): void {
		if (this.renderQueued) return;
		this.renderQueued = true;
		window.requestAnimationFrame(() => {
			this.renderQueued = false;
			this.render();
		});
	}

	private clearIntervals(): void {
		for (const id of this.intervals) window.clearInterval(id);
		this.intervals = [];
		for (const fn of this.cleanups.splice(0)) {
			try { fn(); } catch (e) { console.error(e); }
		}
	}

	render(): void {
		const root = this.contentEl;
		const prevScroll = root.querySelector(".sbd-content")?.scrollTop ?? 0;
		const prevBoardScroll = root.querySelector(".sbd-kanban")?.scrollLeft ?? 0;
		const active = document.activeElement as HTMLInputElement | null;
		const focusKey = active && root.contains(active) ? active.dataset.sbdFocus : undefined;
		const caret = focusKey ? active?.selectionStart ?? null : null;

		this.clearIntervals();
		root.empty();
		root.removeClass("sbd-style-mono", "sbd-dark-darker", "sbd-dark-plain", "sbd-dark-black");
		root.addClass(...styleClasses(this.plugin.settings.appearance));
		// The whole tab (Obsidian's title bar included) takes the dashboard surface, so nothing shows a seam.
		const leaf = this.containerEl;
		leaf.removeClass("sbd-dark-darker", "sbd-dark-plain", "sbd-dark-black", "sbd-style-gallery");
		leaf.addClass("sbd-leaf", ...styleClasses(this.plugin.settings.appearance).filter((c) => c.startsWith("sbd-dark-") || c === "sbd-style-gallery"));
		this.lastWidth = root.clientWidth;

		const ctx: DashboardContext = {
			app: this.app,
			plugin: this.plugin,
			today: moment().format("YYYY-MM-DD"),
			openPath: (path, line, newLeaf) => void this.openPath(path, line, newLeaf),
			openProject: (key) => (this.plugin.index.projects.get(key)?.kind === "course" ? this.navigate("courses", { courses: { selected: key } }) : this.navigate("projects", { projects: { selected: key } })),
			openLibrary: (filter) => this.navigate("library", { library: { folder: undefined, tag: undefined, area: undefined, kind: "all", search: "", ...filter } as Partial<LibraryState> }),
			openCalendarDay: (date) => new DayModal(this.app, ctx, date).open(),
			renderMarkdown: (md, el, sourcePath) => void MarkdownRenderer.render(this.app, md, el, sourcePath, this),
			openTrackers: () => this.navigate("trackers", { trackers: { selected: undefined, focus: undefined } }),
			openMoney: () => this.navigate("trackers", { trackers: { selected: "__money" } } as never),
			openTasks: (filters) => this.navigate("tasks", { tasks: filters } as never),
			rerender: () => this.render(),
			addInterval: (id) => this.intervals.push(id),
			addCleanup: (fn) => this.cleanups.push(fn),
		};

		// ---- Sidebar navigation ----
		const a = this.plugin.settings.appearance;
		root.addClass("has-sidebar");
		root.toggleClass("is-collapsed", !!a.sidebarCollapsed);
		root.toggleClass("has-grid", a.grid === true);
		if (a.noise) {
			const n = a.noiseOptions ?? { intensity: 6, size: 160, speed: 1 };
			const grain = root.createDiv({ cls: "sbd-noise", attr: { "aria-hidden": "true" } });
			grain.style.backgroundImage = `url("${noiseTile()}")`;
			grain.style.setProperty("--sbd-noise-opacity", String(Math.max(1, n.intensity) / 100));
			grain.style.backgroundSize = `${n.size}px ${n.size}px`;
			if (n.speed > 0) grain.style.animationDuration = `${(1.6 / n.speed).toFixed(2)}s`;
			else grain.style.animation = "none";
		}
		const header = root.createDiv({ cls: "sbd-header sbd-sidebar", attr: { role: "navigation", "aria-label": "Dashboard" } });
		const brand = header.createDiv({ cls: "sbd-side-brand" });
		const collapse = brand.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-side-collapse", attr: { "aria-label": a.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar", "aria-expanded": String(!a.sidebarCollapsed) } });
		setIcon(collapse, a.sidebarCollapsed ? "panel-left-open" : "panel-left-close");
		collapse.onclick = async () => { a.sidebarCollapsed = !a.sidebarCollapsed; await this.plugin.persist(); this.render(); };
		brand.createSpan({ cls: "sbd-side-title", text: a.title || "dashboard" });
		const tabs = header.createDiv({ cls: "sbd-tabs" });
		for (const t of TABS) {
			const b = tabs.createEl("button", { cls: `sbd-tab ${this.state.tab === t.id ? "is-active" : ""}`, attr: { "aria-label": t.label, "aria-current": this.state.tab === t.id ? "page" : "false" } });
			const tabIcon = b.createSpan({ cls: `sbd-icon sbd-c-${PAGE_INFO[t.id]?.color ?? "amber"}` });
			if (!pageGlyph(tabIcon, t.id)) setIcon(tabIcon, t.icon);
			b.createSpan({ cls: "sbd-tab-label", text: t.label });
			if (t.id === "inbox" && this.plugin.index.ready) {
				const n = inboxItems(ctx).length;
				if (n) b.createSpan({ cls: "sbd-tab-badge", text: String(n) });
			}
			b.onclick = () => this.navigate(t.id, t.id === "projects" ? { projects: { selected: undefined } } : t.id === "courses" ? { courses: { selected: undefined } } : t.id === "trackers" ? { trackers: { selected: undefined } } : {});
		}
		const actions = header.createDiv({ cls: "sbd-header-actions" });
		const capture = actions.createEl("button", { cls: "sbd-capture-btn", attr: { "aria-label": "Create task (Ctrl+Alt+N)", title: "Create task · Ctrl/Cmd+Alt+N" } });
		setIcon(capture.createSpan({ cls: "sbd-icon" }), "plus");
		capture.createSpan({ cls: "sbd-tab-label", text: "new task" });
		capture.onclick = () => new CaptureModal(this.app, this.plugin).open();
		const refresh = actions.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Rebuild index" } });
		setIcon(refresh, "refresh-cw");
		refresh.onclick = () => void this.plugin.index.build();

		const content = root.createDiv({ cls: `sbd-content sbd-tab-${this.state.tab}` });
		if (!this.plugin.index.ready) {
			content.createDiv({ cls: "sbd-empty", text: "indexing your vault…" });
			return;
		}
		const inner = content.createDiv({ cls: "sbd-inner" });
		// Entrance motion only when the tab actually changes, not on live refreshes.
		if (this.lastTab !== this.state.tab) {
			inner.addClass("sbd-enter");
			const px = this.plugin.settings.appearance.pixel;
			if (px.transitions && this.lastTab !== null) dissolveIn(content, px.size);
		}
		this.lastTab = this.state.tab;

		// Every page but Home gets a header saying where you are.
		if (this.state.tab !== "home") {
			const meta = TABS.find((t) => t.id === this.state.tab);
			const info = PAGE_INFO[this.state.tab];
			const head = inner.createDiv({ cls: "sbd-pagehead" });
			const ic = head.createDiv({ cls: `sbd-pagehead-icon sbd-c-${info?.color ?? "gray"}` });
			if (!pageGlyph(ic, this.state.tab)) setIcon(ic, meta?.icon ?? "file");
			const txt = head.createDiv({ cls: "sbd-pagehead-text" });
			txt.createEl("h1", { cls: "sbd-pagehead-title", text: info?.title ?? meta?.label ?? "" });
			if (info?.sub) txt.createDiv({ cls: "sbd-pagehead-sub", text: info.sub });
		}

		switch (this.state.tab) {
			case "home":
				renderHomeTab(inner, ctx, this.state.home, (p) => this.navigate("home", { home: p }), (p) => this.navigate("tasks", { tasks: p }));
				break;
			case "tasks":
				renderTasksTab(inner, ctx, this.state.tasks, (p) => this.navigate("tasks", { tasks: p }));
				break;
			case "calendar":
				renderCalendarTab(inner, ctx, this.state.calendar, (p) => this.navigate("calendar", { calendar: p }));
				break;
			case "courses":
				renderCoursesTab(inner, ctx, this.state.courses, (p) => this.navigate("courses", { courses: p }));
				break;
			case "projects":
				renderProjectsTab(inner, ctx, this.state.projects, (p) => this.navigate("projects", { projects: p }));
				break;
			case "trackers":
				renderTrackersTab(inner, ctx, this.state.trackers, (p) => this.navigate("trackers", { trackers: p }));
				break;
			case "inbox":
				renderInboxTab(inner, ctx, this.state.inbox, (p) => this.navigate("inbox", { inbox: p }));
				break;
			case "notes":
				renderNotesTab(inner, ctx, this.state.notes, (p) => this.navigate("notes", { notes: p }));
				break;
			case "review":
				renderReviewTab(inner, ctx, this.state.review, (p) => this.navigate("review", { review: p }));
				break;
			case "library":
				renderLibraryTab(inner, ctx, this.state.library, (p) => this.navigate("library", { library: p }));
				break;
		}

		content.scrollTop = prevScroll;
		const board = content.querySelector(".sbd-kanban");
		if (board) board.scrollLeft = prevBoardScroll;
		if (focusKey) {
			const el = content.querySelector<HTMLInputElement>(`[data-sbd-focus="${focusKey}"]`);
			if (el) {
				el.focus();
				if (caret !== null) el.setSelectionRange(caret, caret);
			}
		}
	}

	private async openPath(path: string, line?: number, newLeaf?: boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		// Never replace the dashboard itself: open in another leaf.
		const current = this.app.workspace.getLeaf(false);
		const leaf = newLeaf || current === this.leaf ? this.app.workspace.getLeaf("tab") : current;
		await leaf.openFile(file, line !== undefined ? { eState: { line } } : undefined);
	}
}
