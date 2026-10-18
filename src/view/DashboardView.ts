import { ItemView, MarkdownRenderer, moment, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type SecondBrainPlugin from "../main";
import { styleClasses } from "../settings";
import { CaptureModal } from "./CaptureModal";
import { DayModal } from "./dayModal";
import { DEFAULT_CAL_LAYERS, renderCalendarTab, type CalendarState } from "./calendarTab";
import type { DashboardContext } from "./components";
import { defaultHome, renderHomeTab, type HomeState } from "./homeTab";
import { defaultLibrary, renderLibraryTab, type LibraryState } from "./libraryTab";
import { renderProjectsTab, type ProjectsState } from "./projectsTab";
import { defaultTaskFilters, renderTasksTab, type TaskFilters } from "./tasksTab";
import { renderTrackersTab, type TrackersState } from "./trackersTab";

export const VIEW_TYPE_DASHBOARD = "second-brain-dashboard";

export type TabId = "home" | "tasks" | "calendar" | "projects" | "trackers" | "library";

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: "home", label: "home", icon: "home" },
	{ id: "tasks", label: "tasks", icon: "check-square" },
	{ id: "calendar", label: "calendar", icon: "calendar" },
	{ id: "projects", label: "projects", icon: "folder-kanban" },
	{ id: "trackers", label: "trackers", icon: "activity" },
	{ id: "library", label: "library", icon: "library" },
];

interface DashboardState {
	tab: TabId;
	home: HomeState;
	tasks: TaskFilters;
	calendar: CalendarState;
	projects: ProjectsState;
	trackers: TrackersState;
	library: LibraryState;
}

type Patch = { [K in Exclude<keyof DashboardState, "tab">]?: Partial<DashboardState[K]> };

export class DashboardView extends ItemView {
	private state: DashboardState;
	private renderQueued = false;
	private intervals: number[] = [];
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
			trackers: { range: "month", hidden: [], weekOffset: 0 },
			library: defaultLibrary(),
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
				trackers: { ...cur.trackers, ...(s.trackers ?? {}) },
				library: { ...cur.library, ...(s.library ?? {}) },
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
		this.lastWidth = root.clientWidth;

		const ctx: DashboardContext = {
			app: this.app,
			plugin: this.plugin,
			today: moment().format("YYYY-MM-DD"),
			openPath: (path, line, newLeaf) => void this.openPath(path, line, newLeaf),
			openProject: (key) => this.navigate("projects", { projects: { selected: key } }),
			openLibrary: (filter) => this.navigate("library", { library: { folder: undefined, tag: undefined, area: undefined, kind: "all", search: "", ...filter } as Partial<LibraryState> }),
			openCalendarDay: (date) => new DayModal(this.app, ctx, date).open(),
			renderMarkdown: (md, el, sourcePath) => void MarkdownRenderer.render(this.app, md, el, sourcePath, this),
			openTrackers: () => this.navigate("trackers", { trackers: { selected: undefined, focus: undefined } }),
			rerender: () => this.render(),
			addInterval: (id) => this.intervals.push(id),
		};

		// ---- Header: tabs + actions ----
		const header = root.createDiv({ cls: "sbd-header" });
		const tabs = header.createDiv({ cls: "sbd-tabs" });
		for (const t of TABS) {
			const b = tabs.createEl("button", { cls: `sbd-tab ${this.state.tab === t.id ? "is-active" : ""}` });
			setIcon(b.createSpan({ cls: "sbd-icon" }), t.icon);
			b.createSpan({ text: t.label });
			b.onclick = () => this.navigate(t.id, t.id === "projects" ? { projects: { selected: undefined } } : t.id === "trackers" ? { trackers: { selected: undefined } } : {});
		}
		const actions = header.createDiv({ cls: "sbd-header-actions" });
		const capture = actions.createEl("button", { cls: "sbd-capture-btn" });
		setIcon(capture.createSpan({ cls: "sbd-icon" }), "plus");
		capture.createSpan({ text: "capture" });
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
		if (this.lastTab !== this.state.tab) inner.addClass("sbd-enter");
		this.lastTab = this.state.tab;

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
			case "projects":
				renderProjectsTab(inner, ctx, this.state.projects, (p) => this.navigate("projects", { projects: p }));
				break;
			case "trackers":
				renderTrackersTab(inner, ctx, this.state.trackers, (p) => this.navigate("trackers", { trackers: p }));
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
