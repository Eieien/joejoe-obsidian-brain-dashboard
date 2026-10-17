// Kanban board in the style of the Obsidian Kanban plugin: lanes of cards, pointer-based
// drag & drop with a floating card and an animated drop gap, manual ordering,
// "+ Add a card", and custom sections ("+ Add section") backed by labels.

import { App, Menu, Modal, moment, setIcon, Setting } from "obsidian";
import { appendToFile, getDailyConfig, getOrCreateDaily } from "../data/daily";
import { daysUntil, sortTasks } from "../data/queries";
import { buildTaskLine } from "../data/taskParser";
import { slugKey } from "../data/trackerTypes";
import { DEFAULT_LANES, type KanbanLane } from "../settings";
import type { Task, TaskStatus } from "../types";
import { renderTask, statusIcon, type DashboardContext } from "./components";
import type { TaskFilters } from "./tasksTab";

const DONE_RECENT_DAYS = 14;
const LABEL_COLORS = ["#6e56cf", "#0090ff", "#12a594", "#30a46c", "#f76b15", "#d6409f", "#ad7f58"];

/** Identity that survives line moves, label edits and status changes (used for manual order). */
export function taskKey(t: Task): string {
	return `${t.path}::${t.text}`;
}

function lanes(ctx: DashboardContext): KanbanLane[] {
	const l = ctx.plugin.settings.kanbanLanes;
	return l.length ? l : DEFAULT_LANES;
}

/** Which lane a task belongs to. Open to-do tasks go to the first matching label section. */
export function laneFor(t: Task, all: KanbanLane[]): KanbanLane | undefined {
	const visible = all.filter((l) => !l.hidden);
	if (t.status === "todo") {
		const section = visible.find((l) => l.kind === "label" && l.label && t.labels.includes(l.label));
		if (section) return section;
	}
	return visible.find((l) => l.kind === "status" && l.status === t.status);
}

function laneOrder(tasks: Task[], laneId: string, ctx: DashboardContext): Task[] {
	const order = ctx.plugin.settings.taskOrder[laneId] ?? [];
	const pos = new Map(order.map((k, i) => [k, i]));
	const placed = tasks.filter((t) => pos.has(taskKey(t))).sort((a, b) => pos.get(taskKey(a))! - pos.get(taskKey(b))!);
	const rest = tasks.filter((t) => !pos.has(taskKey(t)));
	return [...placed, ...sortTasks(rest, "smart", ctx.today, ctx.plugin.settings)];
}

async function saveLanes(ctx: DashboardContext, next: KanbanLane[]): Promise<void> {
	ctx.plugin.settings.kanbanLanes = next;
	await ctx.plugin.persist();
	ctx.rerender();
}

export function renderKanban(el: HTMLElement, tasks: Task[], ctx: DashboardContext, f: TaskFilters): void {
	const board = el.createDiv({ cls: "sbd-kanban" });
	const all = lanes(ctx);
	const shown: KanbanLane[] = all.filter((l) => !l.hidden);
	if (f.showDone) shown.push({ id: "cancelled", name: "cancelled", kind: "status", status: "cancelled" });

	const byLane = new Map<string, Task[]>();
	for (const t of tasks) {
		const lane = t.status === "cancelled" ? (f.showDone ? shown[shown.length - 1] : undefined) : laneFor(t, all);
		if (!lane) continue;
		if (!byLane.has(lane.id)) byLane.set(lane.id, []);
		byLane.get(lane.id)!.push(t);
	}

	shown.forEach((lane) => {
		let items = byLane.get(lane.id) ?? [];
		const isDone = lane.kind === "status" && lane.status === "done";
		if (isDone && !f.showDone) items = items.filter((t) => !t.doneDate || daysUntil(t.doneDate, ctx.today) >= -DONE_RECENT_DAYS);
		items = laneOrder(items, lane.id, ctx);
		if (isDone && !f.showDone) items = items.slice(0, 40);

		const col = board.createDiv({ cls: `sbd-lane sbd-lane-${lane.kind === "status" ? lane.status : "section"}`, attr: { "data-lane": lane.id } });
		const head = col.createDiv({ cls: "sbd-lane-head" });
		setIcon(head.createSpan({ cls: "sbd-icon" }), lane.kind === "status" ? statusIcon(lane.status!) : "circle-dashed");
		head.createSpan({ cls: "sbd-lane-title", text: lane.name });
		if (lane.kind === "label") head.createSpan({ cls: "sbd-lane-tag", text: `#${lane.label}` });
		head.createSpan({ cls: "sbd-count", text: String(items.length) });
		if (lane.id !== "cancelled") {
			const more = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Section options" } });
			setIcon(more, "more-horizontal");
			more.onclick = (e) => laneMenu(e, lane, ctx);
		}

		const list = col.createDiv({ cls: "sbd-lane-items" });
		for (const t of items) renderTask(list, t, ctx).addClass("sbd-kcard");
		if (!items.length) list.createDiv({ cls: "sbd-lane-empty", text: lane.kind === "label" ? `Drop cards here to tag them #${lane.label}` : "Drop cards here" });
		if (isDone && !f.showDone) col.createDiv({ cls: "sbd-lane-note", text: `showing the last ${DONE_RECENT_DAYS} days` });
		if (lane.id !== "cancelled") addCardFooter(col, lane, ctx, f);
	});

	addSectionColumn(board, ctx);
	enableDragAndDrop(board, ctx);
}

function laneMenu(e: MouseEvent, lane: KanbanLane, ctx: DashboardContext): void {
	const all = lanes(ctx).map((l) => ({ ...l }));
	const i = all.findIndex((l) => l.id === lane.id);
	const menu = new Menu();
	menu.addItem((it) => it.setTitle("Rename").setIcon("pencil").onClick(() => {
		new TextPromptModal(ctx.app, "Rename section", lane.name, (name) => { all[i].name = name; void saveLanes(ctx, all); }).open();
	}));
	menu.addItem((it) => it.setTitle("Move left").setIcon("arrow-left").setDisabled(i === 0).onClick(() => {
		[all[i - 1], all[i]] = [all[i], all[i - 1]];
		void saveLanes(ctx, all);
	}));
	menu.addItem((it) => it.setTitle("Move right").setIcon("arrow-right").setDisabled(i === all.length - 1).onClick(() => {
		[all[i + 1], all[i]] = [all[i], all[i + 1]];
		void saveLanes(ctx, all);
	}));
	menu.addItem((it) => it.setTitle("Sort by urgency").setIcon("arrow-down-wide-narrow").onClick(async () => {
		delete ctx.plugin.settings.taskOrder[lane.id];
		await ctx.plugin.persist();
		ctx.rerender();
	}));
	menu.addSeparator();
	menu.addItem((it) => it.setTitle("Hide section").setIcon("eye-off").onClick(() => { all[i].hidden = true; void saveLanes(ctx, all); }));
	if (lane.kind === "label") {
		menu.addItem((it) => it.setTitle("Delete section (cards keep their label)").setIcon("trash-2").setWarning(true).onClick(() => {
			all.splice(i, 1);
			void saveLanes(ctx, all);
		}));
	}
	menu.showAtMouseEvent(e);
}

/** "+ Add section" at the end of the board, plus a way back to hidden sections. */
function addSectionColumn(board: HTMLElement, ctx: DashboardContext): void {
	const col = board.createDiv({ cls: "sbd-lane-add" });
	const btn = col.createDiv({ cls: "sbd-add-card sbd-add-section" });
	setIcon(btn.createSpan({ cls: "sbd-icon" }), "plus");
	btn.createSpan({ text: "Add section" });
	btn.onclick = () => {
		btn.remove();
		const input = col.createEl("input", { type: "text", cls: "sbd-add-section-input", attr: { placeholder: "Section name (e.g. Review)", "data-sbd-focus": "add-section" } });
		col.createDiv({ cls: "sbd-muted", text: "Cards dropped here get a matching #label." });
		const submit = async () => {
			const name = input.value.trim();
			if (!name) { ctx.rerender(); return; }
			const label = slugKey(name);
			const s = ctx.plugin.settings;
			if (!s.labels.some((l) => l.name === label)) s.labels.push({ name: label, color: LABEL_COLORS[s.labels.length % LABEL_COLORS.length] });
			const all = lanes(ctx).map((l) => ({ ...l }));
			const doneIdx = all.findIndex((l) => l.kind === "status" && l.status === "done");
			const lane: KanbanLane = { id: `label-${label}-${Date.now().toString(36)}`, name: name.toLowerCase(), kind: "label", label };
			all.splice(doneIdx >= 0 ? doneIdx : all.length, 0, lane);
			await saveLanes(ctx, all);
		};
		input.onkeydown = (e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") ctx.rerender(); };
		input.onblur = () => void submit();
		window.setTimeout(() => input.focus(), 0);
	};
	const hidden = lanes(ctx).filter((l) => l.hidden);
	if (hidden.length) {
		const box = col.createDiv({ cls: "sbd-hidden-lanes" });
		box.createDiv({ cls: "sbd-muted", text: "Hidden" });
		for (const l of hidden) {
			const chip = box.createDiv({ cls: "sbd-hidden-lane", attr: { "aria-label": "Show section" } });
			setIcon(chip.createSpan({ cls: "sbd-icon" }), "eye");
			chip.createSpan({ text: l.name });
			chip.onclick = () => void saveLanes(ctx, lanes(ctx).map((x) => (x.id === l.id ? { ...x, hidden: false } : x)));
		}
	}
}

/** "+ Add a card" → inline textarea; Enter saves a task into this section. */
function addCardFooter(col: HTMLElement, lane: KanbanLane, ctx: DashboardContext, f: TaskFilters): void {
	const foot = col.createDiv({ cls: "sbd-lane-foot" });
	const open = () => {
		foot.empty();
		const ta = foot.createEl("textarea", { cls: "sbd-add-card-input", attr: { rows: "2", placeholder: "Card title…", "data-sbd-focus": `add-card-${lane.id}` } });
		const row = foot.createDiv({ cls: "sbd-add-card-row" });
		const save = row.createEl("button", { cls: "mod-cta", text: "Add card" });
		const cancel = row.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Cancel" } });
		setIcon(cancel, "x");
		const submit = async () => {
			const text = ta.value.trim();
			if (!text) return;
			const s = ctx.plugin.settings;
			const status: TaskStatus = lane.kind === "status" ? lane.status! : "todo";
			const project = f.project && f.project !== "__none" ? ctx.plugin.index.projects.get(f.project) : undefined;
			let line = buildTaskLine({
				text, priority: 3, labels: lane.kind === "label" && lane.label ? [lane.label] : [],
				statusChar: s.statusChars[status], projectLink: project?.notePath ? project.name : undefined,
			});
			if (status === "done") line += ` ✅ ${moment().format("YYYY-MM-DD")}`;
			const path = project?.notePath ?? (s.captureTarget === "inbox" ? s.inboxFile : (await getOrCreateDaily(ctx.app, getDailyConfig(ctx.app, s))).path);
			ta.value = "";
			await appendToFile(ctx.app, path, line);
		};
		save.onclick = () => void submit();
		cancel.onclick = () => reset();
		ta.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
			if (e.key === "Escape") reset();
		};
		window.setTimeout(() => ta.focus(), 0);
	};
	const reset = () => {
		foot.empty();
		const btn = foot.createDiv({ cls: "sbd-add-card" });
		setIcon(btn.createSpan({ cls: "sbd-icon" }), "plus");
		btn.createSpan({ text: "Add a card" });
		btn.onclick = open;
	};
	reset();
}

/** FLIP: animate siblings from their old positions after a DOM change. */
function flip(container: HTMLElement, mutate: () => void): void {
	const items = Array.from(container.querySelectorAll<HTMLElement>(".sbd-kcard:not(.is-drag-source)"));
	const before = new Map(items.map((el) => [el, el.getBoundingClientRect().top]));
	mutate();
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	for (const el of items) {
		const dy = (before.get(el) ?? 0) - el.getBoundingClientRect().top;
		if (!dy) continue;
		el.style.transition = "none";
		el.style.transform = `translateY(${dy}px)`;
		requestAnimationFrame(() => {
			el.style.transition = "transform 160ms cubic-bezier(.2,.7,.3,1)";
			el.style.transform = "";
		});
	}
}

/**
 * Pointer-based drag & drop (mouse, pen, touch). A floating copy of the card follows the
 * pointer while a placeholder opens a gap where it will land. Touch needs a short press.
 */
function enableDragAndDrop(board: HTMLElement, ctx: DashboardContext): void {
	board.addEventListener("pointerdown", (down: PointerEvent) => {
		if (down.button !== 0) return;
		const target = down.target as HTMLElement;
		const card = target.closest<HTMLElement>(".sbd-kcard");
		if (!card || target.closest("input, button, textarea, select, .sbd-project-chip")) return;

		const doc = card.ownerDocument;
		const win = doc.defaultView ?? window;
		const sx = down.clientX, sy = down.clientY;
		const touch = down.pointerType === "touch";
		let armed = !touch;
		let ghost: HTMLElement | null = null;
		let placeholder: HTMLElement | null = null;
		let offX = 0, offY = 0;
		let scrollTimer = 0;
		let last = { x: sx, y: sy };

		const begin = () => {
			if (ghost) return;
			const r = card.getBoundingClientRect();
			offX = last.x - r.left;
			offY = last.y - r.top;
			placeholder = doc.createElement("div");
			placeholder.className = "sbd-kcard-placeholder";
			placeholder.style.height = `${r.height}px`;
			card.after(placeholder);
			ghost = card.cloneNode(true) as HTMLElement;
			ghost.classList.add("sbd-kcard-ghost");
			ghost.style.width = `${r.width}px`;
			// Inherit the dashboard's theme variables while floating outside it.
			const host = board.closest(".sbd-root") as HTMLElement | null;
			const layer = doc.createElement("div");
			layer.className = `sbd-drag-layer ${host?.className ?? ""}`;
			layer.appendChild(ghost);
			doc.body.appendChild(layer);
			card.classList.add("is-drag-source");
			doc.body.classList.add("sbd-is-dragging");
			moveGhost();
			scrollTimer = win.setInterval(autoScroll, 16);
		};
		const holdTimer = touch ? win.setTimeout(() => { armed = true; begin(); }, 280) : 0;

		const moveGhost = () => {
			if (ghost) ghost.style.transform = `translate(${last.x - offX}px, ${last.y - offY}px) rotate(2deg)`;
		};

		const place = () => {
			if (!placeholder) return;
			const el = doc.elementFromPoint(last.x, last.y) as HTMLElement | null;
			const lane = el?.closest<HTMLElement>(".sbd-lane");
			if (!lane || !board.contains(lane)) return;
			const list = lane.querySelector<HTMLElement>(".sbd-lane-items");
			if (!list) return;
			const cards = Array.from(list.querySelectorAll<HTMLElement>(".sbd-kcard:not(.is-drag-source)"));
			const before = cards.find((c) => {
				const r = c.getBoundingClientRect();
				return last.y < r.top + r.height / 2;
			});
			const ph = placeholder;
			if (before) { if (ph.nextElementSibling !== before) flip(list, () => list.insertBefore(ph, before)); }
			else if (list.lastElementChild !== ph) flip(list, () => list.appendChild(ph));
		};

		const autoScroll = () => {
			const br = board.getBoundingClientRect();
			const edge = 60;
			if (last.x < br.left + edge) board.scrollLeft -= 14;
			else if (last.x > br.right - edge) board.scrollLeft += 14;
			const list = (doc.elementFromPoint(last.x, last.y) as HTMLElement | null)?.closest<HTMLElement>(".sbd-lane-items");
			if (list) {
				const lr = list.getBoundingClientRect();
				if (last.y < lr.top + 40) list.scrollTop -= 10;
				else if (last.y > lr.bottom - 40) list.scrollTop += 10;
			}
			place();
		};

		const onMove = (e: PointerEvent) => {
			last = { x: e.clientX, y: e.clientY };
			const dist = Math.hypot(e.clientX - sx, e.clientY - sy);
			if (!ghost) {
				if (touch && !armed) { if (dist > 8) cleanup(); return; } // a scroll, not a drag
				if (dist < 5) return;
				begin();
			}
			e.preventDefault();
			moveGhost();
			place();
		};

		const cleanup = () => {
			win.clearTimeout(holdTimer);
			win.clearInterval(scrollTimer);
			win.removeEventListener("pointermove", onMove);
			win.removeEventListener("pointerup", onUp);
			win.removeEventListener("pointercancel", onCancel);
		};

		const finish = () => {
			ghost?.parentElement?.remove();
			doc.body.classList.remove("sbd-is-dragging");
			card.classList.remove("is-drag-source");
		};

		const onCancel = () => {
			cleanup();
			placeholder?.remove();
			finish();
		};

		const onUp = () => {
			cleanup();
			if (!ghost || !placeholder) return;
			const lane = placeholder.closest<HTMLElement>(".sbd-lane");
			placeholder.replaceWith(card);
			finish();
			card.classList.add("is-dropped");
			// Swallow the click that follows a drag so the note doesn't open.
			const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
			doc.addEventListener("click", swallow, true);
			win.setTimeout(() => doc.removeEventListener("click", swallow, true), 0);
			if (lane) void commit(card, lane, ctx);
		};

		win.addEventListener("pointermove", onMove, { passive: false });
		win.addEventListener("pointerup", onUp);
		win.addEventListener("pointercancel", onCancel);
	});
}

async function commit(card: HTMLElement, laneEl: HTMLElement, ctx: DashboardContext): Promise<void> {
	const all = lanes(ctx);
	const laneId = laneEl.dataset.lane ?? "";
	const target = laneId === "cancelled" ? { id: "cancelled", name: "cancelled", kind: "status" as const, status: "cancelled" as TaskStatus } : all.find((l) => l.id === laneId);
	const byId = new Map(ctx.plugin.index.tasks.map((t) => [t.id, t]));
	const task = byId.get(card.dataset.taskId ?? "");
	if (!task || !target) return;
	const s = ctx.plugin.settings;
	const key = taskKey(task);
	const from = laneFor(task, all);

	// Save the target lane's order as shown; drop the card from its old lane's order.
	s.taskOrder[target.id] = Array.from(laneEl.querySelectorAll<HTMLElement>(".sbd-kcard"))
		.map((c) => byId.get(c.dataset.taskId ?? ""))
		.filter((t): t is Task => !!t)
		.map(taskKey);
	if (from && from.id !== target.id && s.taskOrder[from.id]) s.taskOrder[from.id] = s.taskOrder[from.id].filter((k) => k !== key);
	await ctx.plugin.persist();

	if (from?.id === target.id) return;
	const sectionLabels = all.filter((l) => l.kind === "label" && l.label).map((l) => l.label!);
	if (target.kind === "label") {
		await ctx.plugin.writer.change(task, {
			status: "todo",
			removeLabels: sectionLabels.filter((l) => l !== target.label && task.labels.includes(l)),
			addLabels: [target.label!],
		});
	} else {
		await ctx.plugin.writer.change(task, {
			status: target.status,
			removeLabels: sectionLabels.filter((l) => task.labels.includes(l)),
		});
	}
}

/** Small one-field prompt. */
export class TextPromptModal extends Modal {
	constructor(app: App, private title: string, private initial: string, private onSubmit: (value: string) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		let value = this.initial;
		new Setting(this.contentEl).addText((t) => {
			t.setValue(value).onChange((v) => { value = v; });
			t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(value); });
			window.setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 0);
		}).addButton((b) => b.setButtonText("Save").setCta().onClick(() => this.submit(value)));
	}

	private submit(value: string): void {
		if (!value.trim()) return;
		this.onSubmit(value.trim());
		this.close();
	}

	onClose(): void { this.contentEl.empty(); }
}
