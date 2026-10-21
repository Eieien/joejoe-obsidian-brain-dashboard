// The Tasks board is a Kanban plugin board file: lanes are its "## Lists", cards are its
// "- [ ]" items. Everything you do here edits that file in the Kanban plugin's format, so
// the same board opens in the Kanban plugin. Tasks elsewhere in your notes are not shown.

import { App, Menu, Modal, moment, normalizePath, Notice, setIcon, Setting, TFile } from "obsidian";
import { ensureFolder } from "../data/daily";
import {
	addCard, addLane, cardDisplay, deleteCard, deleteLane, editCard, isBoardFrontmatter, moveCard, moveLane,
	newBoardContent, parseBoard, renameLane, setCardDate, setChecked, type BoardCard, type CardRef,
} from "../data/kanbanBoard";
import { DateModal, dueChip, labelChip, whenLoaded, type DashboardContext } from "./components";

/** All board files in the vault (notes with `kanban-plugin` frontmatter). */
export function listBoards(app: App): TFile[] {
	return app.vault.getMarkdownFiles()
		.filter((f) => isBoardFrontmatter(app.metadataCache.getFileCache(f)?.frontmatter))
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** Apply an edit to the board file; the dashboard re-renders when the file changes. */
async function edit(ctx: DashboardContext, file: TFile, fn: (content: string) => string): Promise<void> {
	try {
		await ctx.app.vault.process(file, fn);
	} catch (e) {
		new Notice(`Second brain: ${(e as Error).message}`);
		ctx.rerender();
	}
}

export function renderBoardView(el: HTMLElement, ctx: DashboardContext, toolbar: HTMLElement): void {
	const s = ctx.plugin.settings;
	const boards = listBoards(ctx.app);
	const file = s.kanbanBoard ? ctx.app.vault.getFileByPath(s.kanbanBoard) : null;
	if (!file) { renderSetup(el, ctx, boards); return; }

	const pick = toolbar.createEl("select", { cls: "dropdown sbd-select sbd-board-select", attr: { "aria-label": "Board" } });
	for (const b of boards) pick.createEl("option", { value: b.path, text: b.path.replace(/\.md$/, "") });
	if (!boards.some((b) => b.path === file.path)) pick.createEl("option", { value: file.path, text: file.path.replace(/\.md$/, "") });
	pick.createEl("option", { value: "__new", text: "+ New board…" });
	pick.value = file.path;
	pick.onchange = async () => {
		if (pick.value === "__new") { new NewBoardModal(ctx, () => ctx.rerender()).open(); pick.value = file.path; return; }
		s.kanbanBoard = pick.value;
		await ctx.plugin.persist();
		ctx.rerender();
	};
	const open = toolbar.createEl("button", { cls: "sbd-ghost-btn sbd-board-open" });
	setIcon(open.createSpan({ cls: "sbd-icon" }), "external-link");
	open.createSpan({ text: "open in Kanban plugin" });
	open.onclick = () => ctx.openPath(file.path);

	const host = el.createDiv();
	whenLoaded(host, ctx.app.vault.cachedRead(file), (content) => renderBoard(host, ctx, file, content));
}

function renderSetup(el: HTMLElement, ctx: DashboardContext, boards: TFile[]): void {
	const box = el.createDiv({ cls: "sbd-board-setup" });
	box.createDiv({ cls: "sbd-board-setup-title", text: "Choose a board for your tasks" });
	box.createDiv({ cls: "sbd-muted", text: "This page shows one Kanban plugin board. Cards you add, move or tick here are saved to that board file, and it opens in the Kanban plugin too." });
	if (boards.length) {
		const list = box.createDiv({ cls: "sbd-board-list" });
		for (const b of boards) {
			const row = list.createDiv({ cls: "sbd-board-choice" });
			setIcon(row.createSpan({ cls: "sbd-icon" }), "square-kanban");
			row.createSpan({ cls: "sbd-note-name", text: b.basename });
			row.createSpan({ cls: "sbd-muted", text: b.parent?.path && b.parent.path !== "/" ? b.parent.path : "/" });
			row.onclick = async () => {
				ctx.plugin.settings.kanbanBoard = b.path;
				await ctx.plugin.persist();
				ctx.rerender();
			};
		}
	} else {
		box.createDiv({ cls: "sbd-empty", text: "No Kanban boards found in this vault yet." });
	}
	const create = box.createEl("button", { cls: "mod-cta" });
	setIcon(create.createSpan({ cls: "sbd-icon" }), "plus");
	create.createSpan({ text: "Create a new board" });
	create.onclick = () => new NewBoardModal(ctx, () => ctx.rerender()).open();
}

function renderBoard(el: HTMLElement, ctx: DashboardContext, file: TFile, content: string): void {
	const board = parseBoard(content);
	const wrap = el.createDiv({ cls: "sbd-kanban" });
	if (!board.lanes.length) {
		wrap.createDiv({ cls: "sbd-empty", text: "This board has no lists yet. Add one →" });
	}

	board.lanes.forEach((lane, li) => {
		const col = wrap.createDiv({ cls: `sbd-lane ${lane.complete ? "sbd-lane-done" : ""}`, attr: { "data-lane": String(li) } });
		const head = col.createDiv({ cls: "sbd-lane-head" });
		setIcon(head.createSpan({ cls: "sbd-icon" }), lane.complete ? "check-circle-2" : "circle");
		head.createSpan({ cls: "sbd-lane-title", text: lane.title });
		head.createSpan({ cls: "sbd-count", text: String(lane.cards.length) });
		const more = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "List options" } });
		setIcon(more, "more-horizontal");
		more.onclick = (e) => {
			const m = new Menu();
			m.addItem((i) => i.setTitle("Rename list").setIcon("pencil").onClick(() =>
				new TextPromptModal(ctx.app, "Rename list", lane.title, (t) => void edit(ctx, file, (c) => renameLane(c, li, t))).open()));
			m.addItem((i) => i.setTitle("Move left").setIcon("arrow-left").setDisabled(li === 0).onClick(() => void edit(ctx, file, (c) => moveLane(c, li, -1))));
			m.addItem((i) => i.setTitle("Move right").setIcon("arrow-right").setDisabled(li === board.lanes.length - 1).onClick(() => void edit(ctx, file, (c) => moveLane(c, li, 1))));
			m.addSeparator();
			m.addItem((i) => i.setTitle(lane.cards.length ? "Delete list (empty it first)" : "Delete list").setIcon("trash-2").setWarning(true)
				.setDisabled(lane.cards.length > 0).onClick(() => void edit(ctx, file, (c) => deleteLane(c, li))));
			m.showAtMouseEvent(e);
		};

		const list = col.createDiv({ cls: "sbd-lane-items" });
		for (const card of lane.cards) renderCard(list, ctx, file, card, board.lanes.map((l) => l.title));
		if (!lane.cards.length) list.createDiv({ cls: "sbd-lane-empty", text: "Drop cards here" });
		addCardFooter(col, ctx, file, li);
	});

	// "+ Add list"
	const addCol = wrap.createDiv({ cls: "sbd-lane-add" });
	const btn = addCol.createDiv({ cls: "sbd-add-card sbd-add-section" });
	setIcon(btn.createSpan({ cls: "sbd-icon" }), "plus");
	btn.createSpan({ text: "Add list" });
	btn.onclick = () => {
		btn.remove();
		const input = addCol.createEl("input", { type: "text", cls: "sbd-add-section-input", attr: { placeholder: "List name", "data-sbd-focus": "add-list" } });
		let done = false;
		const submit = () => {
			if (done) return;
			done = true;
			const name = input.value.trim();
			if (name) void edit(ctx, file, (c) => addLane(c, name)); else ctx.rerender();
		};
		input.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) submit(); if (e.key === "Escape") { done = true; ctx.rerender(); } };
		input.onblur = submit;
		window.setTimeout(() => input.focus(), 0);
	};

	enableDragAndDrop(wrap, (cardEl, laneEl) => {
		const ref: CardRef = { lane: Number(cardEl.dataset.lane), index: Number(cardEl.dataset.index), text: cardEl.dataset.text ?? "" };
		const toLane = Number(laneEl.dataset.lane);
		const siblings = Array.from(laneEl.querySelectorAll<HTMLElement>(".sbd-kcard"));
		const toIndex = siblings.indexOf(cardEl);
		// Index among the lane's cards as they were before the move (the card itself counts if same lane).
		void edit(ctx, file, (c) => moveCard(c, ref, toLane, ref.lane === toLane && toIndex > ref.index ? toIndex + 1 : toIndex));
	});
}

function renderCard(parent: HTMLElement, ctx: DashboardContext, file: TFile, card: BoardCard, laneTitles: string[]): void {
	const ref: CardRef = { lane: card.lane, index: card.index, text: card.text };
	const d = cardDisplay(card.text);
	const el = parent.createDiv({
		cls: `sbd-kcard sbd-task ${card.checked ? "sbd-status-done" : ""}`,
		attr: { "data-lane": String(card.lane), "data-index": String(card.index), "data-text": card.text },
	});
	if (d.date && !card.checked && d.date < ctx.today) el.addClass("is-overdue");

	const cb = el.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox sbd-check" });
	cb.checked = card.checked;
	cb.onclick = (e) => {
		e.stopPropagation();
		if (!card.checked) el.addClass("is-completing");
		void edit(ctx, file, (c) => setChecked(c, ref, !card.checked));
	};

	const main = el.createDiv({ cls: "sbd-task-main" });
	const title = main.createDiv({ cls: "sbd-task-text", text: d.title || "(empty card)", attr: { "aria-label": "Double-click to edit" } });
	const meta = main.createDiv({ cls: "sbd-task-meta" });
	if (d.date) dueChip(meta, d.date, ctx.today);
	if (d.time) meta.createSpan({ cls: "sbd-muted", text: d.time });
	for (const t of d.tags) labelChip(meta, ctx, t);

	const startEdit = () => {
		const ta = createEl("textarea", { cls: "sbd-card-edit" });
		ta.value = card.text;
		title.replaceWith(ta);
		meta.hide();
		ta.focus();
		ta.setSelectionRange(ta.value.length, ta.value.length);
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			const v = ta.value.trim();
			if (save && v && v !== card.text) void edit(ctx, file, (c) => editCard(c, ref, v));
			else ctx.rerender();
		};
		ta.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
			if (e.key === "Escape") finish(false);
		};
		ta.onblur = () => finish(true);
	};
	title.ondblclick = startEdit;

	const more = el.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-task-more", attr: { "aria-label": "Card options" } });
	setIcon(more, "more-horizontal");
	const menu = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const m = new Menu();
		m.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(startEdit));
		m.addItem((i) => i.setTitle(card.checked ? "Mark incomplete" : "Mark complete").setIcon("check").onClick(() => void edit(ctx, file, (c) => setChecked(c, ref, !card.checked))));
		const setDate = (date: string | null) => void edit(ctx, file, (c) => setCardDate(c, ref, date));
		m.addItem((i) => i.setTitle("Due today").setIcon("calendar").setSection("date").onClick(() => setDate(ctx.today)));
		m.addItem((i) => i.setTitle("Due tomorrow").setIcon("calendar-plus").setSection("date").onClick(() => setDate(moment(ctx.today).add(1, "day").format("YYYY-MM-DD"))));
		m.addItem((i) => i.setTitle("Pick a date…").setIcon("calendar-search").setSection("date").onClick(() => new DateModal(ctx.app, d.date, (v) => setDate(v)).open()));
		if (d.date) m.addItem((i) => i.setTitle("Clear date").setIcon("calendar-x").setSection("date").onClick(() => setDate(null)));
		laneTitles.forEach((t, li) => {
			if (li === card.lane) return;
			m.addItem((i) => i.setTitle(`Move to ${t}`).setIcon("arrow-right-left").setSection("move").onClick(() =>
				void edit(ctx, file, (c) => moveCard(c, ref, li, Number.MAX_SAFE_INTEGER))));
		});
		m.addItem((i) => i.setTitle("Show in board file").setIcon("file-text").setSection("open").onClick(() => ctx.openPath(file.path, card.start)));
		m.addItem((i) => i.setTitle("Delete card").setIcon("trash-2").setSection("danger").setWarning(true).onClick(() => void edit(ctx, file, (c) => deleteCard(c, ref))));
		m.showAtMouseEvent(e);
	};
	more.onclick = menu;
	el.oncontextmenu = menu;
}

/** "+ Add a card": saves exactly once per submit (guards double Enter / Enter + click). */
function addCardFooter(col: HTMLElement, ctx: DashboardContext, file: TFile, laneIdx: number): void {
	const foot = col.createDiv({ cls: "sbd-lane-foot" });
	const open = () => {
		foot.empty();
		const ta = foot.createEl("textarea", { cls: "sbd-add-card-input", attr: { rows: "2", placeholder: "Card title… (#tags, @{2026-10-20} dates ok)" } });
		const row = foot.createDiv({ cls: "sbd-add-card-row" });
		const save = row.createEl("button", { cls: "mod-cta", text: "Add card" });
		const cancel = row.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Cancel" } });
		setIcon(cancel, "x");
		let busy = false;
		const submit = async () => {
			const text = ta.value.trim();
			if (!text || busy) return;
			busy = true;
			ta.value = "";
			try {
				await ctx.app.vault.process(file, (c) => addCard(c, laneIdx, text));
			} catch (e) {
				new Notice(`Second brain: ${(e as Error).message}`);
			} finally {
				busy = false;
			}
		};
		save.onclick = () => void submit();
		cancel.onclick = () => reset();
		ta.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !e.repeat) { e.preventDefault(); void submit(); }
			else if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
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
function enableDragAndDrop(board: HTMLElement, onDrop: (card: HTMLElement, lane: HTMLElement) => void): void {
	board.addEventListener("pointerdown", (down: PointerEvent) => {
		if (down.button !== 0) return;
		const target = down.target as HTMLElement;
		const card = target.closest<HTMLElement>(".sbd-kcard");
		if (!card || target.closest("input, button, textarea, select")) return;

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
			if (last.x < br.left + 60) board.scrollLeft -= 14;
			else if (last.x > br.right - 60) board.scrollLeft += 14;
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
				if (touch && !armed) { if (dist > 8) cleanup(); return; }
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

		const onCancel = () => { cleanup(); placeholder?.remove(); finish(); };

		const onUp = () => {
			cleanup();
			if (!ghost || !placeholder) return;
			const lane = placeholder.closest<HTMLElement>(".sbd-lane");
			const moved = placeholder.previousElementSibling !== card || placeholder.parentElement !== card.parentElement;
			placeholder.replaceWith(card);
			finish();
			card.classList.add("is-dropped");
			const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
			doc.addEventListener("click", swallow, true);
			win.setTimeout(() => doc.removeEventListener("click", swallow, true), 0);
			if (lane && moved) onDrop(card, lane);
		};

		win.addEventListener("pointermove", onMove, { passive: false });
		win.addEventListener("pointerup", onUp);
		win.addEventListener("pointercancel", onCancel);
	});
}

/** Create a board in the Kanban plugin's format and select it. */
class NewBoardModal extends Modal {
	constructor(private ctx: DashboardContext, private onDone: () => void) {
		super(ctx.app);
	}

	onOpen(): void {
		this.setTitle("New board");
		let name = "Tasks board";
		let folder = "";
		let lanes = "To do, In progress, Waiting, Done";
		new Setting(this.contentEl).setName("Name").addText((t) => t.setValue(name).onChange((v) => { name = v; }));
		new Setting(this.contentEl).setName("Folder").setDesc("Leave empty for the vault root.")
			.addText((t) => t.setPlaceholder("e.g. 400 Kanban").onChange((v) => { folder = v.trim().replace(/^\/|\/$/g, ""); }));
		new Setting(this.contentEl).setName("Lists").setDesc("Comma-separated. The last list marks cards complete.")
			.addText((t) => t.setValue(lanes).onChange((v) => { lanes = v; }));
		new Setting(this.contentEl).addButton((b) => b.setButtonText("Create board").setCta().onClick(async () => {
			const titles = lanes.split(",").map((x) => x.trim()).filter(Boolean);
			if (!name.trim() || !titles.length) return;
			let path = normalizePath(`${folder ? `${folder}/` : ""}${name.trim()}.md`);
			for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder ? `${folder}/` : ""}${name.trim()} ${i}.md`);
			await ensureFolder(this.app, path);
			await this.app.vault.create(path, newBoardContent(titles.map((t, i) => ({ title: t, complete: i === titles.length - 1 }))));
			this.ctx.plugin.settings.kanbanBoard = path;
			await this.ctx.plugin.persist();
			this.close();
			this.onDone();
		}));
	}

	onClose(): void { this.contentEl.empty(); }
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
