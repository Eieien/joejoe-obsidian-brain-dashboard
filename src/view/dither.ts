// Ordered (Bayer 8×8) dithering effects, rendered into tiny canvases and scaled up with
// nearest-neighbour so every pixel stays crisp:
//   - ditherImage: an image as dithered pixels, with a pointer "reveal" that dissolves
//     the dither to show the original underneath
//   - pixelField: an animated dithered plasma; the pointer is a light, clicks make ripples
//   - dissolveIn: a one-shot pixel dissolve over a container (tab transitions)

import { App, TFile } from "obsidian";

export type DitherPalette = "theme" | "gameboy" | "amber" | "ice" | "rose";

export const DITHER_PALETTES: { value: DitherPalette; label: string }[] = [
	{ value: "theme", label: "Theme (ink on background)" },
	{ value: "gameboy", label: "Game Boy" },
	{ value: "amber", label: "Amber terminal" },
	{ value: "ice", label: "Ice" },
	{ value: "rose", label: "Rose" },
];

type RGB = [number, number, number];

const FIXED: Record<Exclude<DitherPalette, "theme">, RGB[]> = {
	gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
	amber: [[20, 12, 0], [255, 176, 0]],
	ice: [[8, 16, 28], [64, 120, 170], [190, 230, 255]],
	rose: [[26, 10, 18], [190, 70, 110], [255, 200, 215]],
};

// Bayer 8×8 thresholds in [0, 1).
const BAYER8 = (() => {
	const m = [[0, 2], [3, 1]];
	let cur = m;
	for (let size = 2; size < 8; size *= 2) {
		const next: number[][] = Array.from({ length: size * 2 }, () => Array(size * 2).fill(0));
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
			const v = cur[y][x] * 4;
			next[y][x] = v;
			next[y][x + size] = v + 2;
			next[y + size][x] = v + 3;
			next[y + size][x + size] = v + 1;
		}
		cur = next;
	}
	return Float32Array.from(cur.flat().map((v) => (v + 0.5) / 64));
})();

export const bayer = (x: number, y: number): number => BAYER8[((y & 7) << 3) | (x & 7)];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Resolve any CSS color (including var() and color-mix()) to RGB via a probe + canvas. */
function resolveColor(host: HTMLElement, css: string): RGB {
	const probe = host.createDiv();
	probe.style.cssText = `position:absolute;width:0;height:0;color:${css}`;
	const computed = getComputedStyle(probe).color;
	probe.remove();
	const c = document.createElement("canvas").getContext("2d")!;
	c.fillStyle = computed;
	c.fillRect(0, 0, 1, 1);
	const d = c.getImageData(0, 0, 1, 1).data;
	return [d[0], d[1], d[2]];
}

export function paletteColors(p: DitherPalette, host: HTMLElement): RGB[] {
	if (p !== "theme") return FIXED[p];
	return [resolveColor(host, "var(--sbd-surface, var(--background-primary))"), resolveColor(host, "var(--sbd-ink, var(--text-normal))")];
}

/** Ordered dithering of a 0..1 value into one of `n` palette steps. */
function quantize(v: number, x: number, y: number, n: number): number {
	const scaled = Math.max(0, Math.min(1, v)) * (n - 1);
	const base = Math.floor(scaled);
	return Math.min(n - 1, base + (scaled - base > bayer(x, y) ? 1 : 0));
}

function makeCanvas(parent: HTMLElement, cls: string): HTMLCanvasElement {
	const canvas = parent.createEl("canvas", { cls: `sbd-dither-canvas ${cls}` });
	canvas.setAttr("aria-hidden", "true");
	return canvas;
}

/** Load an image as a same-origin bitmap (vault files are read as bytes so the canvas isn't tainted). */
async function loadBitmap(app: App, src: string): Promise<ImageBitmap | null> {
	try {
		if (/^https?:\/\//.test(src)) {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.src = src;
			await img.decode();
			return await createImageBitmap(img);
		}
		const f = app.vault.getAbstractFileByPath(src);
		if (!(f instanceof TFile)) return null;
		const bytes = await app.vault.readBinary(f);
		return await createImageBitmap(new Blob([bytes]));
	} catch {
		return null;
	}
}

export interface DitherImageOptions {
	palette: DitherPalette;
	/** Screen pixels per dither pixel. */
	pixel: number;
	/** Vertical focus for object-fit: cover, 0–100. */
	position?: number;
	/** Show the original image through a dissolving hole around the pointer. */
	reveal?: boolean;
	/** Element that receives pointer events (defaults to the host). */
	hoverTarget?: HTMLElement;
}

/**
 * Render `src` dithered into `host` (which should be position: relative and sized).
 * Returns a cleanup function.
 */
export function ditherImage(app: App, host: HTMLElement, src: string, opts: DitherImageOptions): () => void {
	const canvas = makeCanvas(host, "sbd-dither-image");
	const ctx = canvas.getContext("2d")!;
	let lum: Float32Array | null = null;
	let w = 0, h = 0;
	let colors: RGB[] = [];
	let pointer: { x: number; y: number } | null = null;
	let reveal = 0; // eased 0..1 strength of the hole
	let raf = 0;
	let bitmap: ImageBitmap | null = null;
	let disposed = false;

	const sample = () => {
		if (!bitmap) return;
		const px = Math.max(1, opts.pixel);
		w = Math.max(1, Math.ceil(host.clientWidth / px));
		h = Math.max(1, Math.ceil(host.clientHeight / px));
		canvas.width = w;
		canvas.height = h;
		const off = new OffscreenCanvas(w, h).getContext("2d")!;
		// object-fit: cover with a vertical focus point
		const scale = Math.max(w / bitmap.width, h / bitmap.height);
		const dw = bitmap.width * scale, dh = bitmap.height * scale;
		const dx = (w - dw) / 2, dy = (h - dh) * ((opts.position ?? 50) / 100);
		off.drawImage(bitmap, dx, dy, dw, dh);
		const data = off.getImageData(0, 0, w, h).data;
		lum = new Float32Array(w * h);
		for (let i = 0; i < w * h; i++) lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
		colors = paletteColors(opts.palette, host);
		draw();
	};

	const draw = () => {
		if (!lum) return;
		const img = ctx.createImageData(w, h);
		const out = img.data;
		const n = colors.length;
		const radius = Math.max(w, h) * 0.12;
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
			const i = y * w + x;
			let hole = 0;
			if (pointer && reveal > 0) {
				const d = Math.hypot(x - pointer.x, (y - pointer.y) * 1.1) / radius;
				hole = Math.max(0, Math.min(1, 1.25 - d)) * reveal;
			}
			if (hole > bayer(x + 3, y + 5)) continue; // transparent: the original shows through
			const c = colors[quantize(lum[i], x, y, n)];
			out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
	};

	// Ease the reveal in/out so the hole grows and closes in pixel steps.
	const animate = () => {
		raf = 0;
		const target = pointer ? 1 : 0;
		reveal += (target - reveal) * 0.25;
		if (Math.abs(target - reveal) < 0.02) reveal = target;
		draw();
		if (reveal !== target) raf = requestAnimationFrame(animate);
	};
	const kick = () => { if (!raf) raf = requestAnimationFrame(animate); };

	const target = opts.hoverTarget ?? host;
	const onMove = (e: PointerEvent) => {
		const r = canvas.getBoundingClientRect();
		pointer = { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
		if (reveal < 1) kick(); else draw();
	};
	const onLeave = () => { pointer = null; kick(); };
	if (opts.reveal) {
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerleave", onLeave);
	}
	const ro = new ResizeObserver(() => sample());
	ro.observe(host);

	void loadBitmap(app, src).then((b) => {
		if (disposed) return;
		if (!b) { canvas.remove(); return; } // fall back to the plain image
		bitmap = b;
		host.addClass("has-dither");
		sample();
	});

	return () => {
		disposed = true;
		ro.disconnect();
		cancelAnimationFrame(raf);
		target.removeEventListener("pointermove", onMove);
		target.removeEventListener("pointerleave", onLeave);
		bitmap?.close();
		canvas.remove();
		host.removeClass("has-dither");
	};
}

export interface PixelFieldOptions {
	palette: DitherPalette;
	pixel: number;
}

/** Animated dithered plasma. The pointer is a light; clicks send out ripples. Returns cleanup. */
export function pixelField(host: HTMLElement, opts: PixelFieldOptions): () => void {
	const canvas = makeCanvas(host, "sbd-pixel-field-canvas");
	const ctx = canvas.getContext("2d")!;
	let w = 0, h = 0;
	let colors: RGB[] = [];
	let pointer: { x: number; y: number } | null = null;
	const ripples: { x: number; y: number; t0: number }[] = [];
	let raf = 0;
	let disposed = false;
	const start = performance.now();

	const resize = () => {
		const px = Math.max(1, opts.pixel);
		w = Math.max(1, Math.ceil(host.clientWidth / px));
		h = Math.max(1, Math.ceil(host.clientHeight / px));
		canvas.width = w;
		canvas.height = h;
		colors = paletteColors(opts.palette, host);
	};

	const frame = (now: number) => {
		raf = 0;
		if (disposed || !host.isConnected) return;
		const t = (now - start) / 1000;
		const img = ctx.createImageData(w, h);
		const out = img.data;
		const n = colors.length;
		const scale = 7 / Math.max(w, h);
		for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].t0 > 3) ripples.splice(i, 1);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
			const u = x * scale, v = y * scale;
			// Layered sines → slow plasma in -1..1, then a contrast curve:
			// mostly dark, with brighter blobs drifting through.
			const p = (Math.sin(u * 1.3 + t * 0.6)
				+ Math.sin(v * 1.7 - t * 0.45)
				+ Math.sin((u + v) * 0.9 + t * 0.35)
				+ Math.sin(Math.hypot(u - 3.5, v - 2) * 1.6 - t * 0.8)) / 4;
			// Two-colour palettes need a steeper curve or mid-tones read as a flat checkerboard.
			let val = Math.pow(Math.max(0, (p + 1) / 2), n === 2 ? 3 : 2.2) * 0.95;
			if (pointer) {
				const d = Math.hypot(x - pointer.x, y - pointer.y) / Math.max(w, h);
				val += 0.9 * Math.exp(-(d * d) / 0.015);
			}
			for (const r of ripples) {
				const age = t - r.t0;
				const d = Math.hypot(x - r.x, y - r.y) / Math.max(w, h);
				const ring = d - age * 0.35;
				val += 0.55 * Math.exp(-(ring * ring) / 0.0009) * Math.max(0, 1 - age / 3);
			}
			const c = colors[quantize(val, x, y, n)];
			const i = (y * w + x) * 4;
			out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
		if (!reducedMotion() && !document.hidden) raf = requestAnimationFrame(frame);
	};
	const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

	const toCell = (e: PointerEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
	};
	const onMove = (e: PointerEvent) => { pointer = toCell(e); kick(); };
	const onLeave = () => { pointer = null; kick(); };
	const onDown = (e: PointerEvent) => { ripples.push({ ...toCell(e), t0: (performance.now() - start) / 1000 }); kick(); };
	const onVisible = () => kick();
	host.addEventListener("pointermove", onMove);
	host.addEventListener("pointerleave", onLeave);
	host.addEventListener("pointerdown", onDown);
	document.addEventListener("visibilitychange", onVisible);
	const ro = new ResizeObserver(() => { resize(); kick(); });
	ro.observe(host);
	resize();
	kick();

	return () => {
		disposed = true;
		cancelAnimationFrame(raf);
		ro.disconnect();
		host.removeEventListener("pointermove", onMove);
		host.removeEventListener("pointerleave", onLeave);
		host.removeEventListener("pointerdown", onDown);
		document.removeEventListener("visibilitychange", onVisible);
		canvas.remove();
	};
}

/**
 * One-shot pixel dissolve: covers the visible part of a scroll container with the page
 * color, then removes it cell by cell in Bayer order.
 */
export function dissolveIn(container: HTMLElement, pixel: number, durationMs = 380): void {
	if (reducedMotion()) return;
	const height = container.clientHeight, width = container.clientWidth;
	if (!height || !width) return;
	const canvas = createEl("canvas", { cls: "sbd-dissolve" });
	canvas.style.height = `${height}px`;
	canvas.style.marginBottom = `-${height}px`;
	container.prepend(canvas);
	const px = Math.max(2, pixel + 1);
	const w = Math.ceil(width / px), h = Math.ceil(height / px);
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d")!;
	const [r, g, b] = resolveColor(container, "var(--sbd-surface, var(--background-primary))");
	const t0 = performance.now();
	const frame = (now: number) => {
		const p = Math.min(1, (now - t0) / durationMs);
		const eased = 1 - Math.pow(1 - p, 2);
		const img = ctx.createImageData(w, h);
		const out = img.data;
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
			// Sweep slightly from the top so the dissolve has a direction.
			const bias = (y / h) * 0.25;
			if (bayer(x, y) * 0.75 + bias < eased) continue;
			const i = (y * w + x) * 4;
			out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
		if (p < 1 && canvas.isConnected) requestAnimationFrame(frame);
		else canvas.remove();
	};
	requestAnimationFrame(frame);
}

/** Parse a `dither` code block: `key: value` lines. */
export function parseDitherBlock(source: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of source.split(/\r?\n/)) {
		const m = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/);
		if (m) out[m[1].toLowerCase()] = m[2].replace(/^\[\[|\]\]$/g, "").replace(/^["']|["']$/g, "");
	}
	return out;
}
