import { App, PluginSettingTab, Setting } from "obsidian";
import type SecondBrainPlugin from "./main";
import type { TaskStatus } from "./types";
import { DEFAULT_TRACKERS, type TrackerDef } from "./data/trackerTypes";

export interface LabelDef {
	name: string;
	color: string;
}

/** Notion-style tag colors; actual values live in styles.css per theme. */
export const PILL_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type PillColor = typeof PILL_COLORS[number];

export interface QuickLink {
	label: string;
	/** Lucide icon name. */
	icon: string;
	color: PillColor;
	/** A note path, a folder path, a #tag, or an http(s) URL. */
	target: string;
}

export type HomeSectionId = "quicklinks" | "todo" | "habits" | "widgets" | "notebook" | "lab";

export const HOME_SECTIONS: { id: HomeSectionId; label: string }[] = [
	{ id: "quicklinks", label: "Quick links" },
	{ id: "todo", label: "Things to do, stats & upcoming" },
	{ id: "habits", label: "Habits" },
	{ id: "widgets", label: "Widgets & images" },
	{ id: "notebook", label: "Notebook & projects" },
	{ id: "lab", label: "Knowledge lab" },
];

export interface HomeImage {
	/** Vault path or URL. */
	src: string;
	fit: "cover" | "contain";
	/** Nearest-neighbour scaling for pixel art. */
	pixelated: boolean;
}

export interface HabitDef {
	/** Frontmatter key in daily notes (e.g. gym → `gym: true`). */
	key: string;
	label: string;
	icon: string;
	/** Target days per week. */
	target: number;
}

export type DarkSurface = "default" | "darker" | "plain" | "black";

export const DARK_SURFACES: { value: DarkSurface; label: string }[] = [
	{ value: "default", label: "Theme default" },
	{ value: "darker", label: "Darker" },
	{ value: "plain", label: "Plain (cards match the background)" },
	{ value: "black", label: "Black" },
];

/** CSS classes for the dashboard root and its popups, from the appearance settings. */
export function styleClasses(a: AppearanceSettings): string[] {
	const out: string[] = [];
	if (a.style === "mono") out.push("sbd-style-mono");
	if (a.darkSurface && a.darkSurface !== "default") out.push(`sbd-dark-${a.darkSurface}`);
	return out;
}

export interface AppearanceSettings {
	title: string;
	/** An emoji, a Lucide icon name, or a vault image path. */
	icon: string;
	/** Vault image path or URL; empty for no banner. */
	banner: string;
	/** Vertical focus of the cover image, 0–100 (%). */
	bannerPosition: number;
	style: "mono" | "theme";
	/** How grey surfaces look in dark mode. */
	darkSurface: DarkSurface;
	quotes: string[];
	showQuote: boolean;
	showCountdown: boolean;
	/** Empty = count down to the next deadline. */
	countdownDate: string;
	countdownLabel: string;
	showTimeProgress: boolean;
	showClock: boolean;
	images: HomeImage[];
	/** Home sections in display order; `hidden` ones are skipped. */
	layout: { id: HomeSectionId; hidden: boolean }[];
}

export interface DashboardSettings {
	projectFolder: string;
	projectTag: string;
	projectTypeField: string;
	projectTypeValue: string;
	/** Use the core Daily Notes plugin's folder/format when it is enabled. */
	useCoreDailyNotes: boolean;
	dailyFolder: string;
	dailyFormat: string;
	inboxFile: string;
	captureTarget: "daily" | "inbox";
	labels: LabelDef[];
	statusChars: Record<TaskStatus, string>;
	/** Open tasks due within this many days are treated as urgent. */
	urgentEscalationDays: number;
	deadlineWindowDays: number;
	excludeFolders: string[];
	defaultTaskView: "kanban" | "list";
	openOnStartup: boolean;
	weekStartsMonday: boolean;
	appearance: AppearanceSettings;
	/** Empty = generated from top-level folders. */
	quickLinks: QuickLink[];
	habits: HabitDef[];
	trackers: TrackerDef[];
	/** Kanban plugin board file shown on the Tasks page. */
	kanbanBoard: string;
	/** Descriptions for folder-only projects (projects with a note store it in frontmatter). */
	projectDescriptions: Record<string, string>;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	projectFolder: "Projects",
	projectTag: "project",
	projectTypeField: "type",
	projectTypeValue: "project",
	useCoreDailyNotes: true,
	dailyFolder: "Daily",
	dailyFormat: "YYYY-MM-DD",
	inboxFile: "Inbox.md",
	captureTarget: "daily",
	labels: [
		{ name: "urgent", color: "#e5484d" },
		{ name: "needs-to-be-done", color: "#f76b15" },
		{ name: "quick-win", color: "#30a46c" },
		{ name: "deep-work", color: "#6e56cf" },
		{ name: "waiting-on-someone", color: "#0090ff" },
		{ name: "errand", color: "#ad7f58" },
		{ name: "call", color: "#12a594" },
	],
	statusChars: {
		"todo": " ",
		"in-progress": "/",
		"waiting": "?",
		"done": "x",
		"cancelled": "-",
	},
	urgentEscalationDays: 2,
	deadlineWindowDays: 14,
	excludeFolders: ["Templates", "_templates"],
	defaultTaskView: "kanban",
	openOnStartup: false,
	weekStartsMonday: true,
	appearance: {
		title: "second brain",
		icon: "brain",
		banner: "",
		bannerPosition: 50,
		style: "mono",
		darkSurface: "default",
		quotes: [
			"Discipline will take you places where motivation can't.",
			"Your mind is for having ideas, not holding them.",
			"Small steps every day.",
		],
		showQuote: true,
		showCountdown: true,
		countdownDate: "",
		countdownLabel: "",
		showTimeProgress: true,
		showClock: true,
		images: [],
		layout: HOME_SECTIONS.map((x) => ({ id: x.id, hidden: false })),
	},
	quickLinks: [],
	habits: [
		{ key: "gym", label: "Workout", icon: "dumbbell", target: 4 },
		{ key: "read", label: "Read", icon: "book-open", target: 5 },
		{ key: "meditate", label: "Meditate", icon: "brain", target: 5 },
		{ key: "journal", label: "Journal", icon: "notebook-pen", target: 7 },
	],
	trackers: DEFAULT_TRACKERS,
	kanbanBoard: "",
	projectDescriptions: {},
};

export class DashboardSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SecondBrainPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
		};

		new Setting(containerEl).setName("General").setHeading();

		new Setting(containerEl)
			.setName("Open dashboard on startup")
			.addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => { s.openOnStartup = v; await save(); }));

		new Setting(containerEl)
			.setName("Default task view")
			.addDropdown((d) => d
				.addOption("kanban", "Kanban")
				.addOption("list", "List")
				.setValue(s.defaultTaskView)
				.onChange(async (v) => { s.defaultTaskView = v as "kanban" | "list"; await save(); }));

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated. Notes and tasks in these folders are ignored.")
			.addText((t) => t.setValue(s.excludeFolders.join(", ")).onChange(async (v) => {
				s.excludeFolders = v.split(",").map((x) => x.trim()).filter(Boolean);
				await save();
			}));

		new Setting(containerEl)
			.setName("Week starts on Monday")
			.addToggle((t) => t.setValue(s.weekStartsMonday).onChange(async (v) => { s.weekStartsMonday = v; await save(); }));

		this.renderAppearance(containerEl, save);
		this.renderQuickLinks(containerEl, save);

		new Setting(containerEl).setName("Projects").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "A note counts as a project if it matches any of these. Subfolders of the project folder also become projects.",
		});

		new Setting(containerEl)
			.setName("Project folder")
			.addText((t) => t.setPlaceholder("Projects").setValue(s.projectFolder).onChange(async (v) => { s.projectFolder = v.trim(); await save(); }));
		new Setting(containerEl)
			.setName("Project tag")
			.setDesc("Without #.")
			.addText((t) => t.setPlaceholder("project").setValue(s.projectTag).onChange(async (v) => { s.projectTag = v.replace(/^#/, "").trim(); await save(); }));
		new Setting(containerEl)
			.setName("Project frontmatter")
			.setDesc("Field and value, e.g. type: project.")
			.addText((t) => t.setPlaceholder("type").setValue(s.projectTypeField).onChange(async (v) => { s.projectTypeField = v.trim(); await save(); }))
			.addText((t) => t.setPlaceholder("project").setValue(s.projectTypeValue).onChange(async (v) => { s.projectTypeValue = v.trim(); await save(); }));

		new Setting(containerEl).setName("Daily notes & capture").setHeading();

		new Setting(containerEl)
			.setName("Use core Daily Notes settings")
			.setDesc("When the core Daily Notes plugin is on, use its folder and date format.")
			.addToggle((t) => t.setValue(s.useCoreDailyNotes).onChange(async (v) => { s.useCoreDailyNotes = v; await save(); }));
		new Setting(containerEl)
			.setName("Daily note folder")
			.addText((t) => t.setValue(s.dailyFolder).onChange(async (v) => { s.dailyFolder = v.trim(); await save(); }));
		new Setting(containerEl)
			.setName("Daily note date format")
			.setDesc("Moment.js format.")
			.addText((t) => t.setValue(s.dailyFormat).onChange(async (v) => { s.dailyFormat = v.trim() || "YYYY-MM-DD"; await save(); }));
		new Setting(containerEl)
			.setName("Inbox file")
			.addText((t) => t.setValue(s.inboxFile).onChange(async (v) => { s.inboxFile = v.trim() || "Inbox.md"; await save(); }));
		new Setting(containerEl)
			.setName("Quick capture goes to")
			.addDropdown((d) => d
				.addOption("daily", "Today's daily note")
				.addOption("inbox", "Inbox file")
				.setValue(s.captureTarget)
				.onChange(async (v) => { s.captureTarget = v as "daily" | "inbox"; await save(); }));

		new Setting(containerEl).setName("Tasks").setHeading();

		new Setting(containerEl)
			.setName("Auto-urgent window (days)")
			.setDesc("Open tasks due within this many days are flagged urgent on the dashboard.")
			.addSlider((sl) => sl.setLimits(0, 14, 1).setValue(s.urgentEscalationDays).setDynamicTooltip()
				.onChange(async (v) => { s.urgentEscalationDays = v; await save(); }));
		new Setting(containerEl)
			.setName("Deadline window (days)")
			.addSlider((sl) => sl.setLimits(3, 60, 1).setValue(s.deadlineWindowDays).setDynamicTooltip()
				.onChange(async (v) => { s.deadlineWindowDays = v; await save(); }));

		const statusSetting = new Setting(containerEl)
			.setName("Status checkbox characters")
			.setDesc("Character inside [ ] for: in progress, waiting, cancelled.");
		(["in-progress", "waiting", "cancelled"] as TaskStatus[]).forEach((st) => {
			statusSetting.addText((t) => t
				.setPlaceholder(st)
				.setValue(s.statusChars[st])
				.onChange(async (v) => { if (v.length === 1) { s.statusChars[st] = v; await save(); } }));
		});

		new Setting(containerEl).setName("Labels").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Labels are tags on a task, e.g. #urgent. These get colors and appear in pickers; any other tag still works as a label.",
		});

		s.labels.forEach((label, i) => {
			new Setting(containerEl)
				.addText((t) => t.setValue(label.name).onChange(async (v) => {
					label.name = v.replace(/^#/, "").trim().toLowerCase();
					await save();
				}))
				.addColorPicker((c) => c.setValue(label.color).onChange(async (v) => { label.color = v; await save(); }))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					s.labels.splice(i, 1);
					await save();
					this.display();
				}));
		});
		new Setting(containerEl).addButton((b) => b.setButtonText("Add label").onClick(async () => {
			s.labels.push({ name: "new-label", color: "#888888" });
			await save();
			this.display();
		}));

		new Setting(containerEl).setName("Habits & trackers").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: `${s.habits.length} habit(s), ${s.trackers.length} other tracker(s). Manage them from the Trackers tab of the dashboard; habit checks are saved in each daily note's frontmatter.`,
		});
	}

	private renderAppearance(containerEl: HTMLElement, save: () => Promise<void>): void {
		const a = this.plugin.settings.appearance;
		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Style")
			.setDesc("Mono: monospace, Notion-like page. Theme: follows your theme's fonts.")
			.addDropdown((d) => d.addOption("mono", "Mono page").addOption("theme", "Theme native")
				.setValue(a.style).onChange(async (v) => { a.style = v as "mono" | "theme"; await save(); }));
		new Setting(containerEl)
			.setName("Dark mode surfaces")
			.setDesc("How the grey cards and panels look in dark mode. Plain and Black use outlines instead of grey fills, like light mode.")
			.addDropdown((d) => {
				DARK_SURFACES.forEach((o) => d.addOption(o.value, o.label));
				d.setValue(a.darkSurface ?? "default").onChange(async (v) => { a.darkSurface = v as DarkSurface; await save(); });
			});
		new Setting(containerEl)
			.setName("Page title")
			.addText((t) => t.setValue(a.title).onChange(async (v) => { a.title = v; await save(); }));
		new Setting(containerEl)
			.setName("Page icon")
			.setDesc("An emoji, a Lucide icon name (e.g. brain, sprout), or an image path in your vault.")
			.addText((t) => t.setValue(a.icon).onChange(async (v) => { a.icon = v.trim(); await save(); }));
		new Setting(containerEl)
			.setName("Banner image")
			.setDesc("Image path in your vault or a URL. Leave empty for none.")
			.addText((t) => t.setPlaceholder("Attachments/banner.jpg").setValue(a.banner).onChange(async (v) => { a.banner = v.trim(); await save(); }));
		new Setting(containerEl)
			.setName("Quotes")
			.setDesc("One per line; one is shown per day.")
			.addTextArea((t) => {
				t.inputEl.rows = 4;
				t.setValue(a.quotes.join("\n")).onChange(async (v) => { a.quotes = v.split("\n").map((x) => x.trim()).filter(Boolean); await save(); });
			});

		const widgets: [WidgetKey, string][] = [
			["showQuote", "quote"], ["showCountdown", "countdown"], ["showTimeProgress", "year / month / week progress"],
			["showClock", "clock"],
		];
		for (const [key, name] of widgets) {
			new Setting(containerEl).setName(`Show ${name}`)
				.addToggle((t) => t.setValue(a[key]).onChange(async (v) => { a[key] = v; await save(); }));
		}
		new Setting(containerEl)
			.setName("Countdown target")
			.setDesc("Date and label. Leave the date empty to count down to your next deadline.")
			.addText((t) => { t.inputEl.type = "date"; t.setValue(a.countdownDate).onChange(async (v) => { a.countdownDate = v; await save(); }); })
			.addText((t) => t.setPlaceholder("e.g. Launch day").setValue(a.countdownLabel).onChange(async (v) => { a.countdownLabel = v; await save(); }));
	}

	private renderQuickLinks(containerEl: HTMLElement, save: () => Promise<void>): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName("Quick links").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "The colored link row under the title. Target: a note path, folder, #tag, or URL. With no links, your top-level folders are shown.",
		});
		s.quickLinks.forEach((link, i) => {
			new Setting(containerEl)
				.addText((t) => t.setPlaceholder("label").setValue(link.label).onChange(async (v) => { link.label = v; await save(); }))
				.addText((t) => t.setPlaceholder("icon").setValue(link.icon).onChange(async (v) => { link.icon = v.trim(); await save(); }))
				.addDropdown((d) => {
					PILL_COLORS.forEach((c) => d.addOption(c, c));
					d.setValue(link.color).onChange(async (v) => { link.color = v as PillColor; await save(); });
				})
				.addText((t) => t.setPlaceholder("target").setValue(link.target).onChange(async (v) => { link.target = v.trim(); await save(); }))
				.addExtraButton((b) => b.setIcon("trash").onClick(async () => { s.quickLinks.splice(i, 1); await save(); this.display(); }));
		});
		new Setting(containerEl).addButton((b) => b.setButtonText("Add quick link").onClick(async () => {
			s.quickLinks.push({ label: "library", icon: "library", color: PILL_COLORS[s.quickLinks.length % PILL_COLORS.length], target: "" });
			await save();
			this.display();
		}));
	}
}

type WidgetKey = "showQuote" | "showCountdown" | "showTimeProgress" | "showClock";
