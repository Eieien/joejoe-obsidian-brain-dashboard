import { debounce, Plugin, type WorkspaceLeaf } from "obsidian";
import { VaultIndex } from "./data/indexer";
import { TrackerStore } from "./data/trackerStore";
import { TaskWriter } from "./data/taskWriter";
import { DashboardSettingTab, DEFAULT_SETTINGS, HOME_SECTIONS, type DashboardSettings, type HabitDef } from "./settings";
import { CaptureModal } from "./view/CaptureModal";
import { DashboardView, VIEW_TYPE_DASHBOARD, type TabId } from "./view/DashboardView";

/** UI state that must survive dashboard re-renders (but not app restarts). */
interface UiState {
	miniMonthOffset: number;
}

export default class SecondBrainPlugin extends Plugin {
	settings!: DashboardSettings;
	index!: VaultIndex;
	writer!: TaskWriter;
	trackers!: TrackerStore;
	ui!: UiState;
	private rebuildSoon = debounce(() => void this.index.build(), 800, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new VaultIndex(this.app, () => this.settings);
		this.writer = new TaskWriter(this.app, () => this.settings);
		this.trackers = new TrackerStore(this.app, this);
		this.ui = { miniMonthOffset: 0 };
		// Tracker entries are recomputed lazily after any vault change.
		this.registerEvent(this.index.on("updated", () => this.trackers.invalidate()));

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
		this.addSettingTab(new DashboardSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Open joejoe's second brain", () => void this.activateView());

		this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateView() });
		this.addCommand({ id: "open-tasks", name: "Open tasks board", callback: () => void this.activateView("tasks") });
		this.addCommand({ id: "open-calendar", name: "Open calendar", callback: () => void this.activateView("calendar") });
		this.addCommand({ id: "open-projects", name: "Open projects", callback: () => void this.activateView("projects") });
		this.addCommand({ id: "open-trackers", name: "Open trackers", callback: () => void this.activateView("trackers") });
		this.addCommand({ id: "open-library", name: "Open library (A–Z)", callback: () => void this.activateView("library") });
		this.addCommand({ id: "quick-capture", name: "Quick capture", callback: () => new CaptureModal(this.app, this).open() });
		this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => void this.index.build() });

		this.app.workspace.onLayoutReady(async () => {
			await this.index.build();
			this.index.registerEvents((ref) => this.registerEvent(ref));
			if (this.settings.openOnStartup) await this.activateView();
		});
	}

	async activateView(tab?: TabId): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		}
		await workspace.revealLeaf(leaf);
		if (tab && leaf.view instanceof DashboardView) leaf.view.navigate(tab);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as (Partial<DashboardSettings> & { pomodoro?: unknown }) | null;
		const d = structuredClone(DEFAULT_SETTINGS);
		const s: DashboardSettings = {
			...d,
			...(data ?? {}),
			statusChars: { ...d.statusChars, ...(data?.statusChars ?? {}) },
			appearance: { ...d.appearance, ...(data?.appearance ?? {}) },
			labels: data?.labels ?? d.labels,
			trackers: data?.trackers ?? d.trackers,
			quickLinks: data?.quickLinks ?? d.quickLinks,
			habits: data?.habits ?? d.habits,
			kanbanBoard: data?.kanbanBoard ?? "",
			projectDescriptions: data?.projectDescriptions ?? {},
		};
		for (const k of ["pomodoro", "taskOrder", "kanbanLanes"]) delete (s as unknown as Record<string, unknown>)[k];
		delete (s.appearance as { showPomodoro?: unknown }).showPomodoro;

		// Earlier versions kept habits as a "daily" tracker; move its yes/no fields into habits.
		if (!data?.habits && data?.trackers) {
			const legacy = data.trackers.find((t) => t.id === "habits" && t.source === "daily");
			if (legacy) {
				const migrated: HabitDef[] = legacy.fields.filter((f) => f.type === "boolean")
					.map((f) => ({ key: f.key, label: f.label, icon: "check", target: f.goal?.period === "week" ? f.goal.target : 7 }));
				if (migrated.length) s.habits = migrated;
				s.trackers = s.trackers.filter((t) => t !== legacy && t.id !== "books");
			}
		}

		// Keep the section layout complete if new sections were added in an update.
		const known = new Set(s.appearance.layout.map((l) => l.id));
		s.appearance.layout = s.appearance.layout.filter((l) => HOME_SECTIONS.some((h) => h.id === l.id));
		for (const h of HOME_SECTIONS) if (!known.has(h.id)) s.appearance.layout.push({ id: h.id, hidden: false });
		this.settings = s;
	}

	/** Save without re-indexing — for UI-only state like card order. */
	async persist(): Promise<void> {
		await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.trackers?.invalidate();
		if (this.index?.ready) this.rebuildSoon();
	}
}
