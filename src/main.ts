import { debounce, FileSystemAdapter, MarkdownRenderChild, Plugin, type WorkspaceLeaf } from "obsidian";
import { VaultIndex } from "./data/indexer";
import { TrackerStore } from "./data/trackerStore";
import { TaskWriter } from "./data/taskWriter";
import { DashboardSettingTab, DEFAULT_SETTINGS, HOME_SECTIONS, type DashboardSettings, type HabitDef } from "./settings";
import { CaptureModal } from "./view/CaptureModal";
import { DashboardView, VIEW_TYPE_DASHBOARD, type TabId } from "./view/DashboardView";
import { ditherImage, parseDitherBlock, pixelField, type DitherPalette } from "./view/dither";
import { imageSrc } from "./view/pickers";
import { NewNoteModal } from "./view/notesTab";
import { watchForUpdates } from "./devReload";
import { SecretsStore } from "./secrets/store";
import { SecretsModal } from "./secrets/SecretsModal";
import { LedgerStore } from "./data/ledgerStore";
import { TxModal } from "./view/moneyView";
import { applyGlass, clearGlass } from "./view/glass";

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
	secrets!: SecretsStore;
	ledger!: LedgerStore;
	private rebuildSoon = debounce(() => void this.index.build(), 800, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new VaultIndex(this.app, () => this.settings);
		this.writer = new TaskWriter(this.app, () => this.settings);
		this.trackers = new TrackerStore(this.app, this);
		this.ui = { miniMonthOffset: 0 };
		const adapter = this.app.vault.adapter;
		this.secrets = new SecretsStore(() => this.settings.secrets, () => (adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null));
		this.register(() => this.secrets.destroy());
		applyGlass(this);
		this.register(clearGlass);
		// Tracker entries are recomputed lazily after any vault change.
		this.ledger = new LedgerStore(this.app, () => this.settings.money);
		this.registerEvent(this.index.on("updated", () => { this.trackers.invalidate(); this.ledger.invalidate(); }));

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
		this.addSettingTab(new DashboardSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Open joejoe's second brain", () => void this.activateView());
		this.addRibbonIcon("key-round", "Open secrets vault", () => new SecretsModal(this.app, this).open());

		this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateView() });
		this.addCommand({ id: "open-tasks", name: "Open tasks board", callback: () => void this.activateView("tasks") });
		this.addCommand({ id: "open-calendar", name: "Open calendar", callback: () => void this.activateView("calendar") });
		this.addCommand({ id: "open-projects", name: "Open projects", callback: () => void this.activateView("projects") });
		this.addCommand({ id: "open-trackers", name: "Open trackers", callback: () => void this.activateView("trackers") });
		this.addCommand({ id: "open-library", name: "Open library (A–Z)", callback: () => void this.activateView("library") });
		this.addCommand({ id: "open-inbox", name: "Open inbox (triage)", callback: () => void this.activateView("inbox") });
		this.addCommand({ id: "open-notes", name: "Open notes (Zettelkasten)", callback: () => void this.activateView("notes") });
		this.addCommand({ id: "open-review", name: "Open weekly review", callback: () => void this.activateView("review") });
		for (const kind of ["fleeting", "literature", "permanent"] as const) {
			this.addCommand({ id: `new-${kind}-note`, name: `New ${kind} note`, callback: () => new NewNoteModal(this.app, this, kind, (p) => void this.app.workspace.openLinkText(p, "", true)).open() });
		}
		this.addCommand({ id: "quick-capture", name: "Quick capture", callback: () => new CaptureModal(this.app, this).open() });
		this.addCommand({ id: "create-task", name: "Create task", hotkeys: [{ modifiers: ["Mod", "Alt"], key: "n" }], callback: () => new CaptureModal(this.app, this).open() });
		this.addRibbonIcon("square-check-big", "Create task", () => new CaptureModal(this.app, this).open());
		this.registerDitherBlock();
		this.addCommand({ id: "log-expense", name: "Log expense", callback: () => new TxModal(this.app, this, { type: "expense" }, () => this.refreshViews()).open() });
		this.addCommand({ id: "log-income", name: "Log income", callback: () => new TxModal(this.app, this, { type: "income" }, () => this.refreshViews()).open() });
		this.addCommand({ id: "open-money", name: "Open money", callback: () => void this.activateView("trackers").then(() => this.openMoney()) });
		this.addCommand({ id: "open-secrets", name: "Open secrets vault", callback: () => new SecretsModal(this.app, this).open() });
		this.addCommand({ id: "lock-secrets", name: "Lock secrets vault", callback: () => this.secrets.lock() });
		this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => void this.index.build() });

		watchForUpdates(this);

		this.app.workspace.onLayoutReady(async () => {
			await this.index.build();
			this.index.registerEvents((ref) => this.registerEvent(ref));
			if (this.settings.openOnStartup) await this.activateView();
		});
	}

	/** Re-render open dashboards (after a change made outside them, e.g. from a command). */
	refreshViews(): void {
		this.ledger.invalidate();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) (leaf.view as unknown as { queueRender?: () => void }).queueRender?.();
	}

	private openMoney(): void {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
		(leaf?.view as DashboardView | undefined)?.navigate("trackers", { trackers: { selected: "__money" } } as never);
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
			appearance: { ...d.appearance, ...(data?.appearance ?? {}), pixel: { ...d.appearance.pixel, ...(data?.appearance?.pixel ?? {}) } },
			labels: data?.labels ?? d.labels,
			trackers: data?.trackers ?? d.trackers,
			quickLinks: data?.quickLinks ?? d.quickLinks,
			habits: data?.habits ?? d.habits,
			kanbanBoard: data?.kanbanBoard ?? "",
			projectDescriptions: data?.projectDescriptions ?? {},
			settingsVersion: 3,
			reviewChecklist: data?.reviewChecklist ?? d.reviewChecklist,
			reviews: data?.reviews ?? {},
			savedViews: data?.savedViews ?? [],
			secrets: { ...d.secrets, ...(data?.secrets ?? {}) },
			money: { ...d.money, ...(data?.money ?? {}), categories: data?.money?.categories ?? structuredClone(d.money.categories) },
		};
		for (const k of ["pomodoro", "taskOrder", "kanbanLanes"]) delete (s as unknown as Record<string, unknown>)[k];
		delete (s.appearance as { showPomodoro?: unknown }).showPomodoro;
		delete (s.appearance.pixel as { cover?: unknown }).cover;

		// v2: notebook & projects moved directly below "things to do".
		if ((data?.settingsVersion ?? 1) < 2 && data?.appearance?.layout) {
			const layout = s.appearance.layout;
			const nb = layout.findIndex((l) => l.id === "notebook");
			if (nb >= 0) {
				const [item] = layout.splice(nb, 1);
				layout.splice(layout.findIndex((l) => l.id === "todo") + 1, 0, item);
			}
		}

		// v3: the Money section sits right below "things to do".
		if ((data?.settingsVersion ?? 1) < 3 && data?.appearance?.layout && !s.appearance.layout.some((l) => l.id === "money")) {
			const layout = s.appearance.layout;
			layout.splice(layout.findIndex((l) => l.id === "todo") + 1, 0, { id: "money", hidden: false });
		}
		s.appearance.glance = { ...d.appearance.glance, ...(data?.appearance?.glance ?? {}) };
		s.appearance.glass = { ...d.appearance.glass, ...(data?.appearance?.glass ?? {}) };
		s.appearance.noiseOptions = { ...d.appearance.noiseOptions, ...(data?.appearance?.noiseOptions ?? {}) };

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

	/**
	 * ```dither
	 * src: Attachments/photo.png   (omit for an animated pixel field)
	 * palette: gameboy             (theme, gameboy, amber, ice, rose)
	 * pixel: 3
	 * height: 240
	 * ```
	 */
	private registerDitherBlock(): void {
		this.registerMarkdownCodeBlockProcessor("dither", (source, el, mdCtx) => {
			const o = parseDitherBlock(source);
			const px = this.settings.appearance.pixel;
			const palette = (o.palette ?? px.palette) as DitherPalette;
			const pixel = Math.max(1, Math.min(12, Number(o.pixel) || px.size));
			const host = el.createDiv({ cls: `sbd-dither-block ${o.src ? "" : "is-field"}` });
			host.style.height = `${Math.max(60, Math.min(800, Number(o.height) || 220))}px`;
			let cleanup: () => void;
			if (o.src) {
				const file = this.app.metadataCache.getFirstLinkpathDest(o.src, mdCtx.sourcePath);
				const path = file?.path ?? o.src;
				const url = imageSrc(this.app, path);
				if (url) host.style.backgroundImage = `url("${url}")`;
				cleanup = ditherImage(this.app, host, path, { palette, pixel, reveal: o.reveal !== "false" });
			} else {
				cleanup = pixelField(host, { palette, pixel });
			}
			const child = new MarkdownRenderChild(el);
			child.onunload = cleanup;
			mdCtx.addChild(child);
		});
	}

	/** Save without re-indexing, for UI-only state like card order. */
	async persist(): Promise<void> {
		await this.saveData(this.settings);
		applyGlass(this);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		applyGlass(this);
		this.trackers?.invalidate();
		if (this.index?.ready) this.rebuildSoon();
	}
}
