import { App, Modal, moment, Notice, setIcon } from "obsidian";
import type SecondBrainPlugin from "../main";
import { styleClasses } from "../settings";
import { appendToFile, getDailyConfig, getOrCreateDaily } from "../data/daily";
import { buildTaskLine } from "../data/taskParser";
import { slugKey } from "../data/trackerTypes";
import type { Priority } from "../types";

const PRIORITIES: { p: Priority; label: string; color: string }[] = [
	{ p: 1, label: "Urgent", color: "var(--color-red)" },
	{ p: 2, label: "High", color: "var(--color-orange)" },
	{ p: 3, label: "Normal", color: "var(--text-muted)" },
	{ p: 4, label: "Low", color: "var(--text-faint)" },
];
const LABEL_COLORS = ["#6e56cf", "#0090ff", "#12a594", "#30a46c", "#f76b15", "#d6409f", "#ad7f58", "#e5484d"];

/**
 * Quick capture with every field visible: a title, then one labeled row per
 * property (type, priority, due date, labels, project, save to). No nested menus.
 * Enter in the title saves; Shift+Enter adds a line.
 */
export class CaptureModal extends Modal {
	private text = "";
	private kind: "task" | "note" = "task";
	private priority: Priority = 3;
	private labels = new Set<string>();
	private due = "";
	private project = "";
	private target: "daily" | "inbox" | "project";
	private form!: HTMLElement;
	private saveBtn!: HTMLButtonElement;

	constructor(app: App, private plugin: SecondBrainPlugin, preset: { project?: string; due?: string } = {}) {
		super(app);
		this.target = plugin.settings.captureTarget;
		if (preset.due) this.due = preset.due;
		if (preset.project) {
			this.project = preset.project;
			this.target = "project";
		}
	}

	onOpen(): void {
		this.modalEl.addClass("sbd-capture3");
		const root = this.contentEl;
		root.addClass("sbd-modal-root", ...styleClasses(this.plugin.settings.appearance));
		const dark = this.plugin.settings.appearance.darkSurface;
		if (dark && dark !== "default") this.modalEl.addClass(`sbd-dark-${dark}`);

		const input = root.createEl("textarea", { cls: "sbd-cap-title", attr: { placeholder: "What needs doing?", rows: "1", "aria-label": "Title" } });
		const grow = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
		input.addEventListener("input", () => { this.text = input.value; grow(); });
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.submit(); }
		});
		window.setTimeout(() => input.focus(), 0);

		this.form = root.createDiv({ cls: "sbd-cap-form" });
		const foot = root.createDiv({ cls: "sbd-cap-foot" });
		foot.createDiv({ cls: "sbd-cap-hint", text: "↵ save · ⇧↵ new line" });
		const cancel = foot.createEl("button", { cls: "sbd-cap-cancel", text: "Cancel" });
		cancel.onclick = () => this.close();
		this.saveBtn = foot.createEl("button", { cls: "mod-cta" });
		this.saveBtn.onclick = () => void this.submit();
		this.renderForm();
	}

	/** One labeled row: icon + name on the left, the control on the right. */
	private row(icon: string, name: string, cls = ""): HTMLElement {
		const r = this.form.createDiv({ cls: `sbd-cap-row ${cls}` });
		const l = r.createDiv({ cls: "sbd-cap-label" });
		setIcon(l.createSpan({ cls: "sbd-icon" }), icon);
		l.createSpan({ text: name });
		return r.createDiv({ cls: "sbd-cap-control" });
	}

	private segmented<T extends string>(parent: HTMLElement, options: { value: T; label: string; icon?: string; color?: string }[], current: T, onPick: (v: T) => void): void {
		const seg = parent.createDiv({ cls: "sbd-cap-options" });
		for (const o of options) {
			const b = seg.createEl("button", { cls: `sbd-cap-option ${o.value === current ? "is-active" : ""}`, attr: { "aria-pressed": String(o.value === current) } });
			if (o.icon) {
				const ic = b.createSpan({ cls: "sbd-icon" });
				setIcon(ic, o.icon);
				if (o.color) ic.style.color = o.color;
			}
			b.createSpan({ text: o.label });
			b.onclick = () => onPick(o.value);
		}
	}

	private renderForm(): void {
		const f = this.form;
		f.empty();
		this.saveBtn.setText(this.kind === "task" ? "Add task" : "Add note");

		this.segmented(this.row("shapes", "Type"), [
			{ value: "task" as const, label: "Task", icon: "square-check" },
			{ value: "note" as const, label: "Note / idea", icon: "sticky-note" },
		], this.kind, (v) => { this.kind = v; this.renderForm(); });

		if (this.kind === "task") {
			this.segmented(this.row("flag", "Priority"), PRIORITIES.map((x) => ({ value: String(x.p), label: `P${x.p} ${x.label}`, icon: "flag", color: x.color })),
				String(this.priority), (v) => { this.priority = Number(v) as Priority; this.renderForm(); });

			const due = this.row("calendar", "Due date");
			const date = due.createEl("input", { type: "date", cls: "sbd-cap-date", value: this.due });
			date.onchange = () => { this.due = date.value; this.renderForm(); };
			const quick: [string, moment.Moment][] = [
				["Today", moment()], ["Tomorrow", moment().add(1, "day")], ["Next week", moment().add(1, "week").startOf("isoWeek")],
			];
			const opts = due.createDiv({ cls: "sbd-cap-options" });
			for (const [label, m] of quick) {
				const v = m.format("YYYY-MM-DD");
				const b = opts.createEl("button", { cls: `sbd-cap-option ${this.due === v ? "is-active" : ""}`, text: label });
				b.onclick = () => { this.due = this.due === v ? "" : v; this.renderForm(); };
			}
			if (this.due) {
				const clear = opts.createEl("button", { cls: "sbd-cap-option is-quiet", attr: { "aria-label": "Clear due date" } });
				setIcon(clear, "x");
				clear.onclick = () => { this.due = ""; this.renderForm(); };
			}

			const labels = this.row("tag", "Labels", "is-wrap");
			const chips = labels.createDiv({ cls: "sbd-cap-labels" });
			for (const l of this.plugin.settings.labels) {
				const on = this.labels.has(l.name);
				const chip = chips.createEl("button", { cls: `sbd-label sbd-cap-label-chip ${on ? "is-active" : ""}`, text: `#${l.name}`, attr: { "aria-pressed": String(on) } });
				chip.style.setProperty("--sbd-label-color", l.color);
				chip.onclick = () => { if (on) this.labels.delete(l.name); else this.labels.add(l.name); this.renderForm(); };
			}
			const add = chips.createEl("input", { type: "text", cls: "sbd-cap-newlabel", attr: { placeholder: "+ new label", "aria-label": "New label" } });
			add.onkeydown = async (e) => {
				if (e.key !== "Enter") return;
				e.preventDefault();
				const name = slugKey(add.value.replace(/^#/, ""));
				if (!name) return;
				const s = this.plugin.settings;
				if (!s.labels.some((x) => x.name === name)) {
					s.labels.push({ name, color: LABEL_COLORS[s.labels.length % LABEL_COLORS.length] });
					await this.plugin.persist();
				}
				this.labels.add(name);
				this.renderForm();
				window.setTimeout(() => this.form.querySelector<HTMLInputElement>(".sbd-cap-newlabel")?.focus(), 0);
			};
		}

		const projects = this.plugin.index.projectList().sort((a, b) => a.name.localeCompare(b.name));
		const courses = this.plugin.index.courseList().filter((c) => c.active !== false || c.key === this.project);
		const pr = this.row("folder-kanban", courses.length ? "Project / course" : "Project");
		const sel = pr.createEl("select", { cls: "dropdown sbd-cap-select" });
		sel.createEl("option", { value: "", text: projects.length || courses.length ? "None" : "No projects found" });
		if (courses.length) {
			const g = sel.createEl("optgroup", { attr: { label: "Courses this semester" } });
			for (const c of courses) g.createEl("option", { value: c.key, text: `${c.code ? `${c.code} · ` : ""}${c.name}` });
		}
		const pg = courses.length ? sel.createEl("optgroup", { attr: { label: "Projects" } }) : sel;
		for (const p of projects) pg.createEl("option", { value: p.key, text: p.name });
		sel.value = this.project;
		sel.onchange = () => {
			this.project = sel.value;
			if (!this.project && this.target === "project") this.target = this.plugin.settings.captureTarget;
			this.renderForm();
		};

		const project = this.project ? this.plugin.index.projects.get(this.project) : undefined;
		const targets: { value: "daily" | "inbox" | "project"; label: string; icon: string }[] = [
			{ value: "daily", label: "Today's note", icon: "calendar-days" },
			{ value: "inbox", label: "Inbox", icon: "inbox" },
		];
		if (project?.notePath) targets.push({ value: "project", label: `${project.code ?? project.name} note`, icon: project.kind === "course" ? "graduation-cap" : "folder-kanban" });
		if (this.target === "project" && !project?.notePath) this.target = "daily";
		this.segmented(this.row("save", "Save to"), targets, this.target, (v) => { this.target = v; this.renderForm(); });
	}

	private async submit(): Promise<void> {
		const text = this.text.trim();
		if (!text) {
			this.contentEl.querySelector<HTMLTextAreaElement>(".sbd-cap-title")?.focus();
			return;
		}
		const project = this.project ? this.plugin.index.projects.get(this.project) : undefined;
		const projectFile = project?.notePath ? this.app.vault.getFileByPath(project.notePath) : null;
		const projectLink = projectFile ? this.app.metadataCache.fileToLinktext(projectFile, "", true) : undefined;

		const line = this.kind === "task"
			? buildTaskLine({ text, priority: this.priority, labels: [...this.labels], due: this.due || undefined, projectLink })
			: `- ${text}${projectLink ? ` [[${projectLink}]]` : ""}`;

		try {
			let path: string;
			if (this.target === "project" && project?.notePath) path = project.notePath;
			else if (this.target === "inbox") path = this.plugin.settings.inboxFile;
			else path = (await getOrCreateDaily(this.app, getDailyConfig(this.app, this.plugin.settings), moment())).path;
			await appendToFile(this.app, path, line);
			new Notice(`${this.kind === "task" ? "Task" : "Note"} added to ${path.replace(/\.md$/, "")}`);
			this.close();
		} catch (e) {
			console.error(e);
			new Notice("Second brain: couldn't save. See the developer console for details.");
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
