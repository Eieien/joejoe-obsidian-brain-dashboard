import { getIcon, moment, Notice, setIcon, TFile, TFolder } from "obsidian";
import { calendarItems, monthGrid } from "../data/calendar";
import { deadlines } from "../data/queries";
import { PILL_COLORS, type HomeImage, type QuickLink } from "../settings";
import type { DashboardContext } from "./components";
import { HomeLayoutModal, QuickLinksModal, QuoteModal } from "./homeEdit";
import { IconPickerModal, imageSrc, ImagePickerModal, isImagePath } from "./pickers";

async function saveUi(ctx: DashboardContext): Promise<void> {
	await ctx.plugin.persist();
	ctx.rerender();
}

function hoverButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void): HTMLElement {
	const b = parent.createEl("button", { cls: "sbd-ghost-btn" });
	setIcon(b.createSpan({ cls: "sbd-icon" }), icon);
	b.createSpan({ text: label });
	b.onclick = (e) => { e.stopPropagation(); onClick(e); };
	return b;
}

// ---------- Page header (cover / icon / title / quote) ----------

export function pageHeader(parent: HTMLElement, ctx: DashboardContext): void {
	const a = ctx.plugin.settings.appearance;
	const top = parent.createDiv({ cls: "sbd-page-top" });

	if (a.banner) {
		const banner = top.createDiv({ cls: "sbd-banner" });
		const src = imageSrc(ctx.app, a.banner);
		if (src) {
			banner.style.backgroundImage = `url("${src}")`;
			banner.style.backgroundPosition = `center ${a.bannerPosition ?? 50}%`;
		} else banner.addClass("is-missing");
		const controls = banner.createDiv({ cls: "sbd-banner-controls" });
		hoverButton(controls, "image", "change cover", () => new ImagePickerModal(ctx.app, {
			title: "Cover image",
			onPick: (s) => { a.banner = s; a.bannerPosition = 50; void saveUi(ctx); },
			onRemove: () => { a.banner = ""; void saveUi(ctx); },
		}).open());
		const repo = hoverButton(controls, "move-vertical", "reposition", () => {
			if (banner.hasClass("is-repositioning")) { void saveUi(ctx); return; }
			banner.addClass("is-repositioning");
			repo.lastElementChild!.setText("save position");
			let pos = a.bannerPosition ?? 50;
			banner.onpointerdown = (down) => {
				const startY = down.clientY, startPos = pos;
				const move = (e: PointerEvent) => {
					pos = Math.max(0, Math.min(100, startPos - ((e.clientY - startY) / banner.clientHeight) * 100));
					banner.style.backgroundPosition = `center ${pos}%`;
					a.bannerPosition = Math.round(pos);
				};
				const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			};
		});
		hoverButton(controls, "trash-2", "remove", () => { a.banner = ""; void saveUi(ctx); });
	}

	const head = top.createDiv({ cls: `sbd-page-head ${a.banner ? "has-banner" : ""} ${a.icon ? "" : "no-icon"}` });
	const bar = head.createDiv({ cls: "sbd-head-controls" });
	const pickIcon = () => new IconPickerModal(ctx.app, (icon) => { a.icon = icon; void saveUi(ctx); }, a.icon ? () => { a.icon = ""; void saveUi(ctx); } : undefined).open();
	if (!a.icon) hoverButton(bar, "smile-plus", "add icon", pickIcon);
	if (!a.banner) hoverButton(bar, "image", "add cover", () => new ImagePickerModal(ctx.app, {
		title: "Cover image", onPick: (s) => { a.banner = s; a.bannerPosition = 50; void saveUi(ctx); },
	}).open());
	if (!a.showQuote) hoverButton(bar, "quote", "add quote", () => { a.showQuote = true; void saveUi(ctx); });
	hoverButton(bar, "layout-template", "customize page", () => new HomeLayoutModal(ctx.app, ctx.plugin, () => ctx.rerender()).open());

	if (a.icon) {
		const iconEl = head.createDiv({ cls: "sbd-page-icon", attr: { "aria-label": "Change icon" } });
		pageIcon(iconEl, ctx, a.icon);
		iconEl.onclick = pickIcon;
	}

	const title = head.createEl("h1", { cls: "sbd-page-title", text: a.title || "untitled", attr: { "aria-label": "Click to rename" } });
	title.onclick = () => {
		const input = createEl("input", { type: "text", cls: "sbd-page-title sbd-title-input", value: a.title });
		title.replaceWith(input);
		input.focus();
		input.select();
		const done = (commit: boolean) => {
			if (commit) a.title = input.value.trim();
			void saveUi(ctx);
		};
		input.onkeydown = (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
		input.onblur = () => done(true);
	};

	if (a.showQuote && a.quotes.length) {
		const dayIndex = Math.floor(Date.parse(ctx.today) / 86_400_000);
		const q = head.createDiv({ cls: "sbd-quote" });
		setIcon(q.createSpan({ cls: "sbd-icon" }), "quote");
		q.createSpan({ cls: "sbd-quote-text", text: a.quotes[dayIndex % a.quotes.length] });
		const edit = q.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-hover-edit", attr: { "aria-label": "Edit quotes" } });
		setIcon(edit, "pencil");
		edit.onclick = () => new QuoteModal(ctx.app, ctx.plugin, () => ctx.rerender()).open();
	}
}

function pageIcon(el: HTMLElement, ctx: DashboardContext, icon: string): void {
	if (isImagePath(icon) || /^https?:\/\//.test(icon)) {
		const src = imageSrc(ctx.app, icon);
		if (src) { el.createEl("img", { attr: { src, alt: "" } }); el.addClass("is-image"); return; }
	}
	if (getIcon(icon)) { setIcon(el, icon); el.addClass("is-lucide"); return; }
	el.setText(icon);
}

// ---------- Quick links ----------

export function generatedLinks(ctx: DashboardContext): QuickLink[] {
	const root = ctx.app.vault.getRoot();
	return root.children
		.filter((c): c is TFolder => c instanceof TFolder && !c.name.startsWith(".") && !ctx.plugin.index.isExcluded(c.path))
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 8)
		.map((f, i) => ({ label: f.name.toLowerCase(), icon: folderIcon(f.name), color: PILL_COLORS[(i + 1) % PILL_COLORS.length], target: f.path }));
}

export function quickLinks(parent: HTMLElement, ctx: DashboardContext): void {
	const configured = ctx.plugin.settings.quickLinks;
	const links = configured.length ? configured : generatedLinks(ctx);
	const row = parent.createDiv({ cls: "sbd-quicklinks" });
	for (const l of links) {
		const a = row.createDiv({ cls: `sbd-quicklink sbd-c-${l.color}` });
		const ic = a.createSpan({ cls: "sbd-icon" });
		if (getIcon(l.icon)) setIcon(ic, l.icon); else ic.setText(l.icon || "•");
		a.createSpan({ text: l.label });
		a.onclick = () => openTarget(ctx, l.target);
	}
	const edit = row.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-hover-edit", attr: { "aria-label": "Edit quick links" } });
	setIcon(edit, "pencil");
	edit.onclick = () => new QuickLinksModal(ctx.app, ctx.plugin, links, () => ctx.rerender()).open();
}

function folderIcon(name: string): string {
	const n = name.toLowerCase();
	if (/daily|journal/.test(n)) return "calendar-days";
	if (/project/.test(n)) return "folder-kanban";
	if (/book|library|read/.test(n)) return "library";
	if (/idea|zettel|note/.test(n)) return "lightbulb";
	if (/area/.test(n)) return "layers";
	if (/resource|source|ref/.test(n)) return "bookmark";
	if (/archive/.test(n)) return "archive";
	if (/meeting/.test(n)) return "users";
	if (/health|fitness/.test(n)) return "heart-pulse";
	if (/money|finance|wallet/.test(n)) return "wallet";
	if (/learn|course|uni|school/.test(n)) return "graduation-cap";
	if (/track/.test(n)) return "activity";
	return "folder";
}

export function openTarget(ctx: DashboardContext, target: string): void {
	if (!target) return;
	if (/^https?:\/\//.test(target)) { window.open(target); return; }
	if (target.startsWith("#")) { ctx.openLibrary({ tag: target.slice(1).toLowerCase() }); return; }
	const f = ctx.app.vault.getAbstractFileByPath(target) ?? ctx.app.vault.getAbstractFileByPath(`${target}.md`);
	if (f instanceof TFolder) ctx.openLibrary({ folder: f.path });
	else if (f instanceof TFile) ctx.openPath(f.path);
	else new Notice(`Second brain: "${target}" not found.`);
}

// ---------- Countdown ----------

export function countdown(parent: HTMLElement, ctx: DashboardContext): void {
	const s = ctx.plugin.settings;
	let target = s.appearance.countdownDate;
	let label = s.appearance.countdownLabel;
	if (!target) {
		const idx = ctx.plugin.index;
		const next = deadlines(idx.tasks, [...idx.projects.values()], [...idx.notes.values()], ctx.today, 3650)
			.find((d) => d.date > ctx.today && d.kind !== "task") ??
			deadlines(idx.tasks, [], [], ctx.today, 3650).find((d) => d.date > ctx.today);
		if (next) { target = next.date; label = label || next.title; }
	}
	const box = parent.createDiv({ cls: "sbd-widget sbd-countdown" });
	if (!target) {
		box.createDiv({ cls: "sbd-widget-label", text: "countdown" });
		box.createDiv({ cls: "sbd-empty", text: "Set a countdown date (customize page), or add a deadline." });
		return;
	}
	const digits = box.createDiv({ cls: "sbd-countdown-digits" });
	const units = ["days", "hours", "minutes", "seconds"].map((u) => {
		const cell = digits.createDiv({ cls: "sbd-countdown-cell" });
		const num = cell.createDiv({ cls: "sbd-countdown-num", text: "0" });
		cell.createDiv({ cls: "sbd-countdown-unit", text: u });
		return num;
	});
	box.createDiv({ cls: "sbd-widget-label", text: `until ${label || target} · ${moment(target).format("MMM D, YYYY")}` });
	const end = moment(target).startOf("day").valueOf();
	const tick = () => {
		let ms = Math.max(0, end - Date.now());
		const parts = [86_400_000, 3_600_000, 60_000, 1000].map((unit) => { const v = Math.floor(ms / unit); ms -= v * unit; return v; });
		parts.forEach((v, i) => units[i].setText(i === 0 ? String(v) : String(v).padStart(2, "0")));
	};
	tick();
	ctx.addInterval(window.setInterval(tick, 1000));
}

// ---------- Time progress ----------

export function timeProgress(parent: HTMLElement, ctx: DashboardContext): void {
	const box = parent.createDiv({ cls: "sbd-widget sbd-timeprogress" });
	const wk = ctx.plugin.settings.weekStartsMonday ? "isoWeek" : "week";
	const rows: { label: string; start: moment.Moment; end: moment.Moment }[] = [
		{ label: "year", start: moment().startOf("year"), end: moment().endOf("year") },
		{ label: "month", start: moment().startOf("month"), end: moment().endOf("month") },
		{ label: "week", start: moment().startOf(wk), end: moment().endOf(wk) },
		{ label: "day", start: moment().startOf("day"), end: moment().endOf("day") },
	];
	const fills: { fill: HTMLElement; pct: HTMLElement; label: string; start: number; end: number }[] = [];
	for (const r of rows) {
		const row = box.createDiv({ cls: "sbd-tp-row" });
		const track = row.createDiv({ cls: "sbd-tp-track" });
		fills.push({ fill: track.createDiv({ cls: "sbd-tp-fill" }), pct: row.createSpan({ cls: "sbd-tp-label" }), label: r.label, start: r.start.valueOf(), end: r.end.valueOf() });
	}
	const tick = () => {
		const now = Date.now();
		for (const f of fills) {
			const p = Math.max(0, Math.min(1, (now - f.start) / (f.end - f.start)));
			f.fill.style.width = `${(p * 100).toFixed(2)}%`;
			f.pct.setText(`${f.label}: ${Math.floor(p * 100)}%`);
		}
	};
	tick();
	ctx.addInterval(window.setInterval(tick, 60_000));
}

// ---------- Flip clock ----------

export function flipClock(parent: HTMLElement, ctx: DashboardContext): void {
	const box = parent.createDiv({ cls: "sbd-widget sbd-clock" });
	const tiles = box.createDiv({ cls: "sbd-clock-tiles" });
	const hh = tiles.createDiv({ cls: "sbd-clock-tile" });
	const mm = tiles.createDiv({ cls: "sbd-clock-tile" });
	const day = box.createDiv({ cls: "sbd-clock-day" });
	const tick = () => {
		const now = moment();
		hh.setText(now.format("HH"));
		mm.setText(now.format("mm"));
		day.setText(now.format("dddd").toLowerCase());
	};
	tick();
	ctx.addInterval(window.setInterval(tick, 10_000));
}

// ---------- Images (just for fun) ----------

export function imageTiles(parent: HTMLElement, ctx: DashboardContext): void {
	const a = ctx.plugin.settings.appearance;
	a.images.forEach((img, i) => {
		const tile = parent.createDiv({ cls: `sbd-widget sbd-image-tile ${img.fit === "contain" ? "is-contain" : ""} ${img.pixelated ? "is-pixelated" : ""}` });
		const src = imageSrc(ctx.app, img.src);
		if (src) tile.createEl("img", { attr: { src, alt: "", draggable: "false" } });
		else tile.createDiv({ cls: "sbd-empty", text: `Image not found: ${img.src}` });
		const controls = tile.createDiv({ cls: "sbd-image-controls" });
		const btn = (icon: string, label: string, fn: () => void, active = false) => {
			const b = controls.createEl("button", { cls: `sbd-icon-btn clickable-icon ${active ? "is-active" : ""}`, attr: { "aria-label": label } });
			setIcon(b, icon);
			b.onclick = (e) => { e.stopPropagation(); fn(); };
		};
		btn(img.fit === "contain" ? "maximize" : "minimize", img.fit === "contain" ? "Fill tile" : "Fit whole image", () => { img.fit = img.fit === "contain" ? "cover" : "contain"; void saveUi(ctx); });
		btn("grid-3x3", "Crisp pixels (pixel art)", () => { img.pixelated = !img.pixelated; void saveUi(ctx); }, img.pixelated);
		btn("arrow-left", "Move left", () => { if (i > 0) { a.images.splice(i - 1, 0, a.images.splice(i, 1)[0]); void saveUi(ctx); } });
		btn("replace", "Replace image", () => new ImagePickerModal(ctx.app, { title: "Replace image", onPick: (s) => { img.src = s; void saveUi(ctx); } }).open());
		btn("trash-2", "Remove image", () => { a.images.splice(i, 1); void saveUi(ctx); });
	});
	// A full dashed tile invites the first image; after that, a small hover button.
	const add = a.images.length
		? parent.createEl("button", { cls: "sbd-ghost-btn sbd-image-add-btn", attr: { "aria-label": "Add an image" } })
		: parent.createDiv({ cls: "sbd-widget sbd-image-add", attr: { "aria-label": "Add an image" } });
	setIcon(add.createSpan({ cls: "sbd-icon" }), "image-plus");
	add.createSpan({ text: "add image" });
	add.onclick = () => new ImagePickerModal(ctx.app, {
		title: "Add an image",
		onPick: (s) => { a.images.push({ src: s, fit: "cover", pixelated: /\.gif$/i.test(s) } as HomeImage); void saveUi(ctx); },
	}).open();
}

// ---------- Mini calendar ----------

export function miniCalendar(parent: HTMLElement, ctx: DashboardContext): void {
	const s = ctx.plugin.settings;
	const ui = ctx.plugin.ui;
	const month = moment(ctx.today).startOf("month").add(ui.miniMonthOffset, "month");
	const box = parent.createDiv({ cls: "sbd-widget sbd-minical" });
	const head = box.createDiv({ cls: "sbd-minical-head" });
	const prev = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Previous month" } });
	setIcon(prev, "chevron-left");
	head.createSpan({ cls: "sbd-minical-title", text: month.format("MMMM YYYY") });
	const next = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Next month" } });
	setIcon(next, "chevron-right");
	prev.onclick = () => { ui.miniMonthOffset--; ctx.rerender(); };
	next.onclick = () => { ui.miniMonthOffset++; ctx.rerender(); };

	const weeks = monthGrid(month.year(), month.month(), s.weekStartsMonday);
	const idx = ctx.plugin.index;
	const items = calendarItems(idx.tasks, [...idx.notes.values()], [...idx.projects.values()],
		weeks[0][0], weeks[weeks.length - 1][6], new Set(["due", "project", "deadline", "event"]));
	const grid = box.createDiv({ cls: "sbd-minical-grid" });
	const dow = s.weekStartsMonday ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"];
	for (const d of dow) grid.createDiv({ cls: "sbd-minical-dow", text: d });
	for (const week of weeks) {
		for (const date of week) {
			const cell = grid.createDiv({ cls: "sbd-minical-day", text: String(Number(date.slice(8))) });
			if (date.slice(0, 7) !== month.format("YYYY-MM")) cell.addClass("is-out");
			if (date === ctx.today) cell.addClass("is-today");
			const n = items.get(date)?.length ?? 0;
			if (n) { cell.addClass("has-items"); cell.setAttr("aria-label", `${n} item${n > 1 ? "s" : ""}`); }
			cell.onclick = () => ctx.openCalendarDay(date);
		}
	}
}
