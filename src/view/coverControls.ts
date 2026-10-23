// One toolbar for every cover style: layout switch (blended / panels / single),
// image, reposition. Every change can be undone from the notice it shows.

import { Notice, setIcon } from "obsidian";
import type { CoverStyle } from "../settings";
import type { DashboardContext } from "./components";
import { ImagePickerModal } from "./pickers";

interface CoverState { banner: string; bannerPosition: number; bannerX: number; bannerRotate: number; bannerZoom: number; coverStyle: CoverStyle }

/** How the image sits in its frame. y: vertical focus 0–100 · x: sideways offset −60…60 (% of width) · rotate: −45…45° · zoom: 1–2.5. */
export interface CoverView { x: number; y: number; rotate: number; zoom: number }

export function coverView(a: Partial<CoverState>): CoverView {
	return { x: a.bannerX ?? 0, y: a.bannerPosition ?? 50, rotate: a.bannerRotate ?? 0, zoom: a.bannerZoom ?? 1 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Apply a view to the element carrying the image. Rotation scales up just enough that no corner shows empty. */
export function applyCoverView(layer: HTMLElement, v: CoverView, mode: "object" | "background"): void {
	const pos = `50% ${v.y}%`;
	if (mode === "object") layer.style.objectPosition = pos; else layer.style.backgroundPosition = pos;
	if (!v.x && !v.rotate && v.zoom === 1) { layer.style.transform = ""; return; }
	const w = layer.clientWidth || 1, h = layer.clientHeight || 1;
	const t = (v.rotate * Math.PI) / 180, c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
	const fill = Math.max((w * c + h * sn) / w, (w * sn + h * c) / h);
	layer.style.transform = `translateX(${v.x}%) rotate(${v.rotate}deg) scale(${(v.zoom * fill).toFixed(4)})`;
}

const LAYOUTS: { id: CoverStyle; label: string; icon: string; hint: string }[] = [
	{ id: "editorial", label: "Editorial", icon: "newspaper", hint: "Big title over an image band, date and today's facts" },
	{ id: "hero", label: "Blended", icon: "sparkles", hint: "Image melts into the page, title beside it" },
	{ id: "panels", label: "Panels", icon: "columns-3", hint: "Split into black-and-white panels" },
	{ id: "full", label: "Single", icon: "rectangle-horizontal", hint: "One image across the top" },
];

function snapshot(ctx: DashboardContext): CoverState {
	const a = ctx.plugin.settings.appearance;
	return { banner: a.banner, bannerPosition: a.bannerPosition ?? 50, bannerX: a.bannerX ?? 0, bannerRotate: a.bannerRotate ?? 0, bannerZoom: a.bannerZoom ?? 1, coverStyle: a.coverStyle ?? "panels" };
}

async function commit(ctx: DashboardContext): Promise<void> {
	await ctx.plugin.persist();
	ctx.rerender();
}

/** Apply a cover change, re-render, and offer Undo. */
export function changeCover(ctx: DashboardContext, message: string, mutate: (a: CoverState) => void): void {
	const before = snapshot(ctx);
	const a = ctx.plugin.settings.appearance as unknown as CoverState;
	mutate(a);
	void commit(ctx);
	const frag = document.createDocumentFragment();
	frag.append(`${message} `);
	const undo = document.createElement("a");
	undo.className = "sbd-undo-link";
	undo.textContent = "Undo";
	frag.append(undo);
	const n = new Notice(frag, 6000);
	undo.addEventListener("click", () => {
		Object.assign(ctx.plugin.settings.appearance, before);
		void commit(ctx);
		(n as { hide?: () => void }).hide?.();
	});
}

function toolButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, opts: { active?: boolean; title?: string; cls?: string } = {}): HTMLButtonElement {
	const b = parent.createEl("button", { cls: `sbd-cover-btn ${opts.cls ?? ""}${opts.active ? " is-active" : ""}`, attr: { "aria-label": opts.title ?? label, type: "button" } });
	if (opts.active) b.setAttr("aria-pressed", "true");
	setIcon(b.createSpan({ cls: "sbd-icon" }), icon);
	if (label) b.createSpan({ text: label });
	b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
	return b;
}

export interface CoverTarget {
	/** Element the reposition drag happens on. */
	surface: HTMLElement;
	/** Element carrying the image (an <img>, or a div with a background image). */
	layer: HTMLElement;
	mode: "object" | "background";
}

/**
 * The toolbar shown on hover over any cover. `target` is omitted when there is
 * nothing to reposition (e.g. no image yet).
 */
export function coverToolbar(parent: HTMLElement, ctx: DashboardContext, target?: CoverTarget): HTMLElement {
	const a = ctx.plugin.settings.appearance;
	const current = a.coverStyle ?? "panels";
	const bar = parent.createDiv({ cls: "sbd-banner-controls sbd-cover-bar" });

	const seg = bar.createDiv({ cls: "sbd-cover-seg", attr: { role: "group", "aria-label": "Cover layout" } });
	for (const l of LAYOUTS) {
		toolButton(seg, l.icon, l.label, () => {
			if (l.id === current) return;
			changeCover(ctx, `Cover: ${l.label.toLowerCase()}.`, (s) => { s.coverStyle = l.id; });
		}, { active: l.id === current, title: l.hint });
	}

	toolButton(bar, "image", a.banner ? "Change image" : "Add image", () => new ImagePickerModal(ctx.app, {
		title: "Cover image",
		onPick: (src) => changeCover(ctx, "Cover image changed.", (s) => { s.banner = src; s.bannerPosition = 50; s.bannerX = 0; s.bannerRotate = 0; s.bannerZoom = 1; }),
		onRemove: a.banner ? () => changeCover(ctx, "Cover image removed.", (s) => { s.banner = ""; }) : undefined,
	}).open());
	if (target) toolButton(bar, "move", "Reposition", () => startReposition(parent, bar, ctx, target));
	if (a.banner) toolButton(bar, "trash-2", "", () => changeCover(ctx, "Cover image removed.", (s) => { s.banner = ""; }), { title: "Remove image" });
	return bar;
}

/**
 * Reposition mode: drag to move the image (any direction), sliders or keys to
 * rotate and zoom, then Save (Enter) or Cancel (Esc). Cancel restores exactly
 * what was there.
 */
function startReposition(host: HTMLElement, bar: HTMLElement, ctx: DashboardContext, target: CoverTarget): void {
	const a = ctx.plugin.settings.appearance;
	const start = coverView(a);
	const v: CoverView = { ...start };
	const { surface, layer, mode } = target;

	host.addClass("is-repositioning");
	bar.hide();
	const panel = host.createDiv({ cls: "sbd-repo-panel" });
	panel.createSpan({ cls: "sbd-repo-hint", text: "Drag to move" });

	const slider = (icon: string, label: string, min: number, max: number, step: number, get: () => number, set: (n: number) => void, fmt: (n: number) => string) => {
		const wrap = panel.createDiv({ cls: "sbd-repo-slider", attr: { title: label } });
		setIcon(wrap.createSpan({ cls: "sbd-icon" }), icon);
		const input = wrap.createEl("input", { attr: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
		const out = wrap.createSpan({ cls: "sbd-repo-val" });
		const sync = () => { input.value = String(get()); out.setText(fmt(get())); };
		input.addEventListener("input", () => { set(Number(input.value)); render(); });
		input.addEventListener("pointerdown", (e) => e.stopPropagation());
		return sync;
	};
	const syncRotate = slider("rotate-cw", "Rotate", -45, 45, 1, () => v.rotate, (n) => { v.rotate = n; }, (n) => `${n > 0 ? "+" : ""}${Math.round(n)}°`);
	const syncZoom = slider("zoom-in", "Zoom", 100, 250, 5, () => Math.round(v.zoom * 100), (n) => { v.zoom = n / 100; }, (n) => `${Math.round(n)}%`);
	const reset = panel.createEl("button", { cls: "sbd-cover-btn", attr: { type: "button", "aria-label": "Reset framing" } });
	setIcon(reset.createSpan({ cls: "sbd-icon" }), "rotate-ccw");
	reset.createSpan({ text: "Reset" });
	const cancel = panel.createEl("button", { cls: "sbd-cover-btn", text: "Cancel", attr: { type: "button" } });
	const save = panel.createEl("button", { cls: "sbd-cover-btn mod-cta", text: "Save", attr: { type: "button" } });

	const render = () => {
		v.x = clamp(v.x, -60, 60); v.y = clamp(v.y, 0, 100);
		v.rotate = clamp(v.rotate, -45, 45); v.zoom = clamp(v.zoom, 1, 2.5);
		applyCoverView(layer, v, mode);
		syncRotate(); syncZoom();
	};
	render();

	const onDown = (down: PointerEvent) => {
		if ((down.target as HTMLElement).closest(".sbd-repo-panel")) return;
		down.preventDefault();
		try { surface.setPointerCapture(down.pointerId); } catch { /* synthetic or already-released pointer */ }
		surface.addClass("is-dragging");
		const sx = down.clientX, sy = down.clientY, x0 = v.x, y0 = v.y;
		const w = Math.max(layer.clientWidth, 1), h = Math.max(surface.clientHeight, 1);
		const move = (e: PointerEvent) => {
			v.x = x0 + ((e.clientX - sx) / w) * 100;
			v.y = y0 - ((e.clientY - sy) / h) * 100;
			render();
		};
		const up = () => {
			surface.removeClass("is-dragging");
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	};
	const onWheel = (e: WheelEvent) => { e.preventDefault(); v.zoom -= e.deltaY * 0.0015; render(); };
	const onKey = (e: KeyboardEvent) => {
		if ((e.target as HTMLElement)?.tagName === "INPUT" && !["Escape", "Enter"].includes(e.key)) return;
		const big = e.shiftKey ? 5 : 1;
		const keys: Record<string, () => void> = {
			Escape: () => finish(false), Enter: () => finish(true),
			ArrowUp: () => { v.y -= 2 * big; }, ArrowDown: () => { v.y += 2 * big; },
			ArrowLeft: () => { v.x -= 1 * big; }, ArrowRight: () => { v.x += 1 * big; },
			"[": () => { v.rotate -= big; }, "]": () => { v.rotate += big; },
			"+": () => { v.zoom += 0.05 * big; }, "=": () => { v.zoom += 0.05 * big; }, "-": () => { v.zoom -= 0.05 * big; },
			"0": () => Object.assign(v, { x: 0, y: 50, rotate: 0, zoom: 1 }),
		};
		const fn = keys[e.key];
		if (!fn) return;
		e.preventDefault(); e.stopPropagation();
		fn();
		if (e.key !== "Escape" && e.key !== "Enter") render();
	};
	surface.addEventListener("pointerdown", onDown);
	surface.addEventListener("wheel", onWheel, { passive: false });
	document.addEventListener("keydown", onKey, true);

	const finish = (keep: boolean) => {
		surface.removeEventListener("pointerdown", onDown);
		surface.removeEventListener("wheel", onWheel);
		document.removeEventListener("keydown", onKey, true);
		host.removeClass("is-repositioning");
		panel.remove();
		bar.show();
		const changed = Math.round(v.y) !== start.y || Math.round(v.x * 10) !== Math.round(start.x * 10) || Math.round(v.rotate) !== start.rotate || Math.abs(v.zoom - start.zoom) > 0.004;
		if (keep && changed) changeCover(ctx, "Cover framing saved.", (s) => {
			s.bannerPosition = Math.round(v.y); s.bannerX = Math.round(v.x * 10) / 10;
			s.bannerRotate = Math.round(v.rotate); s.bannerZoom = Math.round(v.zoom * 100) / 100;
		});
		else applyCoverView(layer, start, mode);
	};
	reset.addEventListener("click", (e) => { e.stopPropagation(); Object.assign(v, { x: 0, y: 50, rotate: 0, zoom: 1 }); render(); });
	cancel.addEventListener("click", (e) => { e.stopPropagation(); finish(false); });
	save.addEventListener("click", (e) => { e.stopPropagation(); finish(true); });
	save.focus({ preventScroll: true });
}
