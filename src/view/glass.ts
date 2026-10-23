// Glass mode: Obsidian has no see-through window on every platform, so we fake it:
// a wallpaper behind the whole app, with every pane frosted on top of it.

import type SecondBrainPlugin from "../main";
import { imageSrc } from "./pickers";
import { landscapeCover } from "./cover";

export interface GlassSettings {
	enabled: boolean;
	/** Vault image path or URL; empty = the dashboard cover, else a drawn landscape. */
	wallpaper: string;
	/** Frost strength in px. */
	blur: number;
	/** How solid the panes are, 0–100. */
	opacity: number;
	/** Darken (dark mode) / lighten (light mode) the wallpaper, 0–100. */
	dim: number;
	/** Colour of the frost: neutral lets the wallpaper through. */
	tint: "neutral" | "cool" | "warm";
	/** How solid cards / popups are, 0–100. */
	cardOpacity: number;
}

export const DEFAULT_GLASS: GlassSettings = { enabled: false, wallpaper: "", blur: 24, opacity: 30, dim: 25, tint: "neutral", cardOpacity: 40 };

/** Frost colour per tint, for dark and light mode (r, g, b). */
const TINTS: Record<GlassSettings["tint"], { dark: string; light: string }> = {
	neutral: { dark: "14, 14, 16", light: "252, 250, 246" },
	cool: { dark: "12, 17, 26", light: "238, 244, 255" },
	warm: { dark: "34, 30, 25", light: "252, 247, 238" },
};

const VARS = ["--sbd-wallpaper", "--sbd-glass-blur", "--sbd-glass-alpha", "--sbd-glass-dim", "--sbd-glass-card-alpha", "--sbd-glass-dark-rgb", "--sbd-glass-light-rgb"];

export function applyGlass(plugin: SecondBrainPlugin): void {
	const body = document.body;
	const g = plugin.settings.appearance.glass ?? DEFAULT_GLASS;
	if (!g.enabled) { clearGlass(); return; }
	const pick = g.wallpaper || plugin.settings.appearance.banner;
	const src = (pick && imageSrc(plugin.app, pick)) || landscapeCover();
	body.addClass("sbd-glass");
	body.style.setProperty("--sbd-wallpaper", `url("${src}")`);
	body.style.setProperty("--sbd-glass-blur", `${Math.max(0, g.blur)}px`);
	body.style.setProperty("--sbd-glass-alpha", String(Math.min(100, Math.max(0, g.opacity)) / 100));
	body.style.setProperty("--sbd-glass-card-alpha", String(Math.min(100, Math.max(0, g.cardOpacity ?? 40)) / 100));
	const tint = TINTS[g.tint ?? "neutral"] ?? TINTS.neutral;
	body.style.setProperty("--sbd-glass-dark-rgb", tint.dark);
	body.style.setProperty("--sbd-glass-light-rgb", tint.light);
	body.style.setProperty("--sbd-glass-dim", String(Math.min(90, Math.max(0, g.dim)) / 100));
}

export function clearGlass(): void {
	document.body.removeClass("sbd-glass");
	for (const v of VARS) document.body.style.removeProperty(v);
}
