// Courses: school subjects. They work like projects (tasks, notes, deadlines all
// connect the same way) and can be marked active or inactive for the semester:
// tasks of inactive courses drop out of Home / Tasks / Calendar automatically.

import { App, Menu, Modal, normalizePath, Notice, setIcon, TFile } from "obsidian";
import type SecondBrainPlugin from "../main";
import { ensureFolder } from "../data/daily";
import { isOpen, projectStats } from "../data/queries";
import type { ProjectInfo } from "../types";
import { CaptureModal } from "./CaptureModal";
import { dueChip, type DashboardContext } from "./components";
import { progressBar } from "./homeTab";
import { MONEY_COLORS } from "./moneyView";
import { renderProjectHub } from "./projectsTab";
import { pageGlyph } from "./pageIcons";
import { styleClasses } from "../settings";

export interface CoursesState { selected?: string; showInactive: boolean }

export function renderCoursesTab(el: HTMLElement, ctx: DashboardContext, st: CoursesState, update: (p: Partial<CoursesState>) => void): void {
	const course = st.selected ? ctx.plugin.index.projects.get(st.selected) : undefined;
	if (course) renderCoursePage(el, ctx, course, () => update({ selected: undefined }));
	else renderCourseGrid(el, ctx, st, update);
}

const colorOf = (c: ProjectInfo) => (c.color && MONEY_COLORS.includes(c.color) ? c.color : "indigo");

/** Flip a course's `active` property in its note. */
export async function setCourseActive(ctx: { app: App; plugin: SecondBrainPlugin }, c: ProjectInfo, active: boolean): Promise<void> {
	if (!c.notePath) { new Notice("This course is a plain folder. Add a note named after the folder to set it inactive."); return; }
	const file = ctx.app.vault.getFileByPath(c.notePath);
	if (!file) return;
	await ctx.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.active = active; });
	c.active = active;
}

function renderCourseGrid(el: HTMLElement, ctx: DashboardContext, st: CoursesState, update: (p: Partial<CoursesState>) => void): void {
	const p = ctx.plugin;
	const s = p.settings;
	const courses = p.index.courseList();
	const active = courses.filter((c) => c.active !== false);
	const inactive = courses.filter((c) => c.active === false);

	const head = el.createDiv({ cls: "sbd-courses-head" });
	const titles = head.createDiv({ cls: "sbd-courses-titles" });
	titles.createEl("h2", { cls: "sbd-courses-title", text: s.currentTerm || "This semester" });
	const openTasks = active.reduce((n, c) => n + p.index.tasksForProject(c.key).filter(isOpen).length, 0);
	titles.createDiv({ cls: "sbd-muted", text: `${active.length} active ${active.length === 1 ? "course" : "courses"} · ${openTasks} open ${openTasks === 1 ? "task" : "tasks"}${inactive.length ? ` · ${inactive.length} inactive` : ""}` });
	const actions = head.createDiv({ cls: "sbd-courses-actions" });
	const plan = actions.createEl("button", { cls: "sbd-ghost-btn" });
	setIcon(plan.createSpan({ cls: "sbd-icon" }), "calendar-range");
	plan.createSpan({ text: "Plan semester" });
	plan.onclick = () => new SemesterModal(ctx.app, p, () => ctx.rerender()).open();
	const add = actions.createEl("button", { cls: "mod-cta sbd-add" });
	setIcon(add.createSpan({ cls: "sbd-icon" }), "plus");
	add.createSpan({ text: "New course" });
	add.onclick = () => new CourseModal(ctx.app, p, undefined, (path) => update({ selected: path })).open();

	if (!courses.length) {
		const empty = el.createDiv({ cls: "sbd-courses-empty" });
		const eIcon = empty.createDiv({ cls: "sbd-courses-empty-icon sbd-c-indigo" });
		if (!pageGlyph(eIcon, "courses")) setIcon(eIcon, "graduation-cap");
		empty.createEl("h3", { text: "Add your subjects" });
		empty.createEl("p", { cls: "sbd-muted", text: `Create a course with the button above, or turn existing notes into courses: put them in "${s.courseFolder}/", tag them #${s.courseTag}, or add "type: course" to their properties.` });
		return;
	}

	section(el, ctx, "", active, update, "Nothing active. Use Plan semester to choose this term's courses.");
	const tog = el.createEl("button", { cls: "sbd-courses-toggle" });
	setIcon(tog.createSpan({ cls: "sbd-icon" }), st.showInactive ? "chevron-down" : "chevron-right");
	tog.createSpan({ text: `Not this semester (${inactive.length})` });
	tog.onclick = () => update({ showInactive: !st.showInactive });
	if (st.showInactive) section(el, ctx, "", inactive, update, "No inactive courses.", true);
	if (s.hideInactiveCourseTasks && inactive.length) el.createDiv({ cls: "sbd-muted sbd-courses-note", text: "Tasks from inactive courses are hidden from Home, Tasks and the Calendar. Change this in settings → Courses." });
}

function section(el: HTMLElement, ctx: DashboardContext, title: string, list: ProjectInfo[], update: (p: Partial<CoursesState>) => void, emptyText: string, dim = false): void {
	if (title) el.createEl("h3", { cls: "sbd-courses-section", text: title });
	const grid = el.createDiv({ cls: "sbd-course-grid" + (dim ? " is-inactive" : "") });
	if (!list.length) { grid.createDiv({ cls: "sbd-empty", text: emptyText }); return; }
	for (const c of list) courseCard(grid, ctx, c, update);
}

function courseCard(grid: HTMLElement, ctx: DashboardContext, c: ProjectInfo, update: (p: Partial<CoursesState>) => void): void {
	const p = ctx.plugin;
	const tasks = p.index.tasksForProject(c.key);
	const s = projectStats(tasks, ctx.today, p.settings);
	const card = grid.createDiv({ cls: `sbd-course-card sbd-c-${colorOf(c)}` + (c.active === false ? " is-inactive" : ""), attr: { role: "button", tabindex: "0", "aria-label": `Open ${c.name}` } });
	card.onclick = () => update({ selected: c.key });
	card.onkeydown = (e) => { if (e.key === "Enter") update({ selected: c.key }); };
	card.oncontextmenu = (e) => courseMenu(e, ctx, c, update);

	const top = card.createDiv({ cls: "sbd-course-top" });
	if (c.code) top.createSpan({ cls: "sbd-course-code", text: c.code });
	const sw = top.createEl("button", { cls: "sbd-course-switch" + (c.active !== false ? " is-on" : ""), attr: { role: "switch", "aria-checked": String(c.active !== false), "aria-label": c.active !== false ? `${c.name} is active this semester. Click to mark inactive` : `${c.name} is inactive. Click to mark active`, title: c.active !== false ? "Active this semester" : "Not this semester" } });
	sw.createSpan({ cls: "sbd-course-switch-knob" });
	sw.onclick = async (e) => {
		e.stopPropagation();
		await setCourseActive(ctx, c, c.active === false);
		new Notice(`${c.code ?? c.name} marked ${c.active ? "active" : "inactive"} for the semester.`);
		ctx.rerender();
	};
	card.createDiv({ cls: "sbd-course-name", text: c.name });
	const meta = card.createDiv({ cls: "sbd-course-meta" });
	if (c.instructor) { setIcon(meta.createSpan({ cls: "sbd-icon" }), "user-round"); meta.createSpan({ text: c.instructor }); }
	if (c.schedule) { setIcon(meta.createSpan({ cls: "sbd-icon" }), "clock"); meta.createSpan({ text: c.schedule }); }
	if (c.room) { setIcon(meta.createSpan({ cls: "sbd-icon" }), "map-pin"); meta.createSpan({ text: c.room }); }

	progressBar(card, s.progress);
	const nums = card.createDiv({ cls: "sbd-project-nums" });
	nums.createSpan({ text: s.total ? `${s.done}/${s.total} done` : "No tasks yet" });
	if (s.open) nums.createSpan({ text: `${s.open} open` });
	if (s.urgent) nums.createSpan({ cls: "sbd-pill is-urgent", text: `${s.urgent} urgent` });
	if (s.overdue) nums.createSpan({ cls: "sbd-pill is-overdue", text: `${s.overdue} overdue` });
	const foot = card.createDiv({ cls: "sbd-project-foot" });
	if (s.nextDue) { foot.createSpan({ cls: "sbd-muted", text: "Next due " }); dueChip(foot, s.nextDue, ctx.today); }
	else if (c.term) foot.createSpan({ cls: "sbd-muted", text: c.term });
	const addTask = foot.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-course-add", attr: { "aria-label": `Add a task to ${c.name}` } });
	setIcon(addTask, "plus");
	addTask.onclick = (e) => { e.stopPropagation(); new CaptureModal(ctx.app, p, { project: c.key }).open(); };
}

function courseMenu(e: MouseEvent, ctx: DashboardContext, c: ProjectInfo, update: (p: Partial<CoursesState>) => void): void {
	e.preventDefault();
	const m = new Menu();
	m.addItem((i) => i.setTitle("Open").setIcon("arrow-up-right").onClick(() => update({ selected: c.key })));
	m.addItem((i) => i.setTitle("Add task…").setIcon("plus").onClick(() => new CaptureModal(ctx.app, ctx.plugin, { project: c.key }).open()));
	m.addItem((i) => i.setTitle(c.active === false ? "Mark active this semester" : "Mark inactive").setIcon(c.active === false ? "toggle-right" : "toggle-left")
		.onClick(async () => { await setCourseActive(ctx, c, c.active === false); ctx.rerender(); }));
	if (c.notePath) {
		m.addItem((i) => i.setTitle("Edit details…").setIcon("pencil").onClick(() => new CourseModal(ctx.app, ctx.plugin, c, () => ctx.rerender()).open()));
		m.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => ctx.openPath(c.notePath!)));
	}
	m.showAtMouseEvent(e);
}

function renderCoursePage(el: HTMLElement, ctx: DashboardContext, c: ProjectInfo, back: () => void): void {
	el.addClass(`sbd-c-${colorOf(c)}`);
	renderProjectHub(el, ctx, c, back, {
		backLabel: "All courses",
		header: (sub, actions) => {
			sub.empty();
			if (c.code) sub.createSpan({ cls: "sbd-course-code", text: c.code });
			sub.createSpan({ cls: "sbd-course-state" + (c.active === false ? "" : " is-on"), text: c.active === false ? "Not this semester" : "Active this semester" });
			for (const [icon, v] of [["user-round", c.instructor], ["clock", c.schedule], ["map-pin", c.room], ["award", c.units ? `${c.units} units` : ""], ["calendar-range", c.term]] as const) {
				if (!v) continue;
				const it = sub.createSpan({ cls: "sbd-course-detail" });
				setIcon(it.createSpan({ cls: "sbd-icon" }), icon);
				it.createSpan({ text: v });
			}
			const tog = actions.createEl("button", { text: c.active === false ? "Mark active" : "Mark inactive" });
			tog.onclick = async () => { await setCourseActive(ctx, c, c.active === false); ctx.rerender(); };
			if (c.notePath) {
				const edit = actions.createEl("button", { text: "Edit details" });
				edit.onclick = () => new CourseModal(ctx.app, ctx.plugin, c, () => ctx.rerender()).open();
			}
			actions.prepend(tog);
		},
	});
}

// ---------------------------------------------------------------- new / edit course

export class CourseModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private course: ProjectInfo | undefined, private done: (path: string) => void) {
		super(app);
	}

	onOpen(): void {
		const p = this.plugin;
		const c = this.course;
		this.setTitle(c ? `Edit ${c.name}` : "New course");
		this.modalEl.addClass("sbd-money-modal", "sbd-course-modal");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(p.settings.appearance));
		const d = {
			name: c?.name ?? "", code: c?.code ?? "", instructor: c?.instructor ?? "", schedule: c?.schedule ?? "", room: c?.room ?? "",
			units: c?.units ?? "", term: c?.term ?? p.settings.currentTerm, color: c?.color ?? MONEY_COLORS[(p.index.courseList().length * 5) % MONEY_COLORS.length], active: c?.active !== false,
		};
		const form = this.contentEl.createEl("form", { cls: "sbd-money-form" });
		const field = (label: string, key: keyof typeof d, placeholder: string, opts: { required?: boolean } = {}) => {
			const r = form.createEl("label", { cls: "sbd-money-frow" });
			r.createSpan({ cls: "sbd-money-flabel", text: label });
			const i = r.createEl("input", { attr: { type: "text", placeholder } });
			i.value = String(d[key]);
			i.oninput = () => { (d as Record<string, unknown>)[key] = i.value; };
			if (opts.required) i.required = true;
			return i;
		};
		const nameIn = field("Name", "name", "e.g. Data Structures and Algorithms", { required: true });
		field("Code", "code", "e.g. CS 201");
		field("Instructor", "instructor", "e.g. Prof. Santos");
		field("Schedule", "schedule", "e.g. MWF 10:00–11:30");
		field("Room", "room", "e.g. Rm 304 / Zoom");
		field("Units", "units", "e.g. 3");
		field("Semester", "term", p.settings.currentTerm || "e.g. 1st Sem 2026–27");

		const ar = form.createDiv({ cls: "sbd-money-frow" });
		ar.createSpan({ cls: "sbd-money-flabel", text: "This semester" });
		const sw = ar.createEl("button", { cls: "sbd-course-switch" + (d.active ? " is-on" : ""), attr: { type: "button", role: "switch", "aria-checked": String(d.active), "aria-label": "Active this semester" } });
		sw.createSpan({ cls: "sbd-course-switch-knob" });
		sw.onclick = () => { d.active = !d.active; sw.toggleClass("is-on", d.active); sw.setAttr("aria-checked", String(d.active)); };

		const colorLabel = form.createDiv({ cls: "sbd-money-flabel sbd-money-pickerlabel", text: "Colour" });
		const picked = colorLabel.createSpan({ cls: `sbd-money-picked sbd-c-${d.color}`, text: d.color });
		const colors = form.createDiv({ cls: "sbd-money-swatches", attr: { role: "radiogroup", "aria-label": "Colour" } });
		for (const col of MONEY_COLORS) {
			const b = colors.createEl("button", { cls: `sbd-money-swatchbtn sbd-c-${col}` + (d.color === col ? " is-active" : ""), attr: { type: "button", role: "radio", "aria-checked": String(d.color === col), "aria-label": col, title: col } });
			b.onclick = () => { d.color = col; picked.className = `sbd-money-picked sbd-c-${col}`; picked.setText(col); colors.querySelectorAll("button").forEach((x) => { x.toggleClass("is-active", x === b); x.setAttr("aria-checked", String(x === b)); }); };
		}
		const err = form.createDiv({ cls: "sbd-money-err", attr: { role: "status", "aria-live": "polite" } });
		const foot = form.createDiv({ cls: "sbd-money-ffoot" });
		foot.createEl("button", { text: "Cancel", attr: { type: "button" } }).onclick = () => this.close();
		foot.createEl("button", { cls: "mod-cta", text: c ? "Save" : "Create course", attr: { type: "submit" } });

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const name = d.name.trim();
			if (!name) { err.setText("Give the course a name."); nameIn.focus(); return; }
			try {
				let file: TFile | null;
				if (c?.notePath) {
					file = this.app.vault.getFileByPath(c.notePath);
				} else {
					const folder = (p.settings.courseFolder || "Courses").replace(/^\/|\/$/g, "");
					const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
					let path = normalizePath(`${folder}/${safe}.md`);
					for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${safe} ${i}.md`);
					await ensureFolder(this.app, path);
					file = await this.app.vault.create(path, `# ${name}\n\n## Tasks\n\n## Notes\n\n`);
				}
				if (!file) throw new Error("Course note not found.");
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm.type = "course";
					if (c && name !== c.name) fm.title = name;
					for (const k of ["code", "instructor", "schedule", "room", "units", "term"] as const) {
						const v = String(d[k]).trim();
						if (v) fm[k] = k === "units" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v; else delete fm[k];
					}
					fm.color = d.color;
					fm.active = d.active;
				});
				new Notice(c ? "Course updated." : `Course created: ${name}`);
				this.close();
				this.done(file.path);
			} catch (ex) {
				err.setText(`Couldn't save: ${(ex as Error).message}`);
			}
		});
		window.setTimeout(() => nameIn.focus(), 0);
	}

	onClose(): void { this.contentEl.empty(); }
}

// ---------------------------------------------------------------- plan a semester

/** Name the term and tick which courses you're taking; everything else goes inactive. */
class SemesterModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private done: () => void) {
		super(app);
	}

	onOpen(): void {
		const p = this.plugin;
		this.setTitle("Plan semester");
		this.modalEl.addClass("sbd-money-modal", "sbd-course-modal");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(p.settings.appearance));
		const el = this.contentEl;
		const termRow = el.createEl("label", { cls: "sbd-money-frow" });
		termRow.createSpan({ cls: "sbd-money-flabel", text: "Semester name" });
		const term = termRow.createEl("input", { attr: { type: "text", placeholder: "e.g. 2nd Sem 2026–27" } });
		term.value = p.settings.currentTerm;
		el.createDiv({ cls: "sbd-money-help", text: "Tick the courses you're taking this semester. Unticked courses become inactive. Their notes and tasks stay, they just stop showing up day to day." });

		const courses = p.index.courseList().filter((c) => c.notePath);
		const picked = new Set(courses.filter((c) => c.active !== false).map((c) => c.key));
		const list = el.createDiv({ cls: "sbd-semester-list" });
		for (const c of courses) {
			const row = list.createEl("label", { cls: `sbd-semester-row sbd-c-${colorOf(c)}` });
			const cb = row.createEl("input", { attr: { type: "checkbox" } });
			cb.checked = picked.has(c.key);
			cb.onchange = () => { if (cb.checked) picked.add(c.key); else picked.delete(c.key); };
			row.createSpan({ cls: "sbd-semester-dot" });
			if (c.code) row.createSpan({ cls: "sbd-course-code", text: c.code });
			row.createSpan({ cls: "sbd-semester-name", text: c.name });
			if (c.term) row.createSpan({ cls: "sbd-muted", text: c.term });
		}
		if (!courses.length) list.createDiv({ cls: "sbd-empty", text: "No course notes yet." });
		const setTerm = el.createEl("label", { cls: "sbd-semester-setterm" });
		const cbTerm = setTerm.createEl("input", { attr: { type: "checkbox" } });
		cbTerm.checked = true;
		setTerm.createSpan({ text: "Also set the semester name on the ticked courses" });

		const foot = el.createDiv({ cls: "sbd-money-ffoot" });
		foot.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		foot.createEl("button", { cls: "mod-cta", text: "Apply" }).onclick = async () => {
			p.settings.currentTerm = term.value.trim();
			await p.persist();
			for (const c of courses) {
				const file = this.app.vault.getFileByPath(c.notePath!);
				if (!file) continue;
				const on = picked.has(c.key);
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm.active = on;
					if (on && cbTerm.checked && p.settings.currentTerm) fm.term = p.settings.currentTerm;
				});
				c.active = on;
			}
			new Notice(`${picked.size} ${picked.size === 1 ? "course" : "courses"} active${p.settings.currentTerm ? ` for ${p.settings.currentTerm}` : ""}.`);
			this.close();
			this.done();
		};
	}

	onClose(): void { this.contentEl.empty(); }
}
