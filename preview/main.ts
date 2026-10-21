// Preview entry: boots the real plugin + dashboard view against demo-vault in a browser.
// URL: index.html#<tab>[&theme=light][&mode=week|timeline][&tracker=habits][&view=list]
import { App, moment } from "obsidian";
import SecondBrainPlugin from "../src/main";
import { CaptureModal } from "../src/view/CaptureModal";
import { DashboardView } from "../src/view/DashboardView";
import { SecretsModal } from "../src/secrets/SecretsModal";
import { newEntry, type SecretEntry } from "../src/secrets/crypto";

declare const __VAULT__: { path: string; content: string; mtime: number; ctime: number }[];

async function boot(): Promise<void> {
	const params = new URLSearchParams(location.hash.slice(1).replace(/^([a-z]+)/, "tab=$1"));
	const theme = params.get("theme") ?? "dark";
	document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");

	const app = new App(__VAULT__);
	const plugin = new SecondBrainPlugin(app as never, {} as never);
	await plugin.onload();

	if (params.get("dark")) plugin.settings.appearance.darkSurface = params.get("dark") as never;
	if (params.get("obstheme")) document.getElementById("obs-theme")?.setAttribute("media", "all");
	if (params.get("nobanner")) plugin.settings.appearance.banner = "";
	if (params.get("banner")) plugin.settings.appearance.banner = params.get("banner")!;
	if (params.get("rot")) plugin.settings.appearance.bannerRotate = Number(params.get("rot"));
	if (params.get("bx")) plugin.settings.appearance.bannerX = Number(params.get("bx"));
	if (params.get("zoom")) plugin.settings.appearance.bannerZoom = Number(params.get("zoom"));
	if (params.get("style")) plugin.settings.appearance.style = params.get("style") as never;
	if (params.get("cover")) plugin.settings.appearance.coverStyle = params.get("cover") as never;
	if (params.get("palette")) plugin.settings.appearance.pixel.palette = params.get("palette") as never;
	const container = document.getElementById("leaf")!;
	const view = new DashboardView({ app, containerEl: container } as never, plugin);
	await view.onOpen();
	const tab = (params.get("tab") ?? "home") as never;
	const patch: Record<string, unknown> = {};
	if (params.get("mode")) patch.calendar = { mode: params.get("mode") };
	if (params.get("tracker")) patch.trackers = { selected: params.get("tracker") };
	if (params.get("view")) patch.tasks = { view: params.get("view") };
	if (params.get("lib")) patch.library = { view: params.get("lib") };
	if (params.get("project")) patch.projects = { selected: params.get("project") };
	if (params.get("focus")) patch.trackers = { focus: params.get("focus") };
	view.navigate(tab, patch as never);
	if (params.get("drag")) window.setTimeout(simulateDrag, 100);
	if (params.get("pointer")) window.setTimeout(simulatePointer, 150);
	if (params.get("boardtest")) window.setTimeout(() => void boardTest(app), 200);
	if (params.get("capture")) {
		new CaptureModal(app as never, plugin, { due: params.get("capture") === "due" ? moment().format("YYYY-MM-DD") : undefined }).open();
	}
	if (params.get("secrets")) {
		const mode = params.get("secrets")!;
		(plugin as unknown as { secrets: unknown }).secrets = fakeSecrets(mode);
		new SecretsModal(app as never, plugin).open();
		if (mode === "manage") window.setTimeout(() => document.querySelector<HTMLElement>(".sbd-sec-item")?.click(), 50);
	}
	if (params.get("coverui")) window.setTimeout(() => {
		document.querySelectorAll<HTMLElement>(".sbd-cover-bar").forEach((b) => (b.style.opacity = "1"));
		if (params.get("dragtest")) window.setTimeout(() => {
			const band = document.querySelector(".sbd-hero, .sbd-gallery-band, .sbd-banner");
			const r = band?.getBoundingClientRect();
			if (r) for (const [fx, fy] of [[0.3, 0.8], [0.6, 0.5], [0.8, 0.2]]) {
				const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
				if (fx === 0.6) {
					const opts = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, bubbles: true, button: 0 });
					const cx = r.left + r.width * 0.6, cy = r.top + r.height * 0.5;
					el?.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy)));
					band!.dispatchEvent(new PointerEvent("pointermove", opts(cx + 80, cy + 30)));
					band!.dispatchEvent(new PointerEvent("pointerup", opts(cx + 80, cy + 30)));
					const layer = band!.querySelector<HTMLElement>(".sbd-hero-img, .sbd-cover-layer");
					console.log("drag", layer?.style.transform, layer?.style.objectPosition || layer?.style.backgroundPosition);
				}
				console.log("hit", fx, fy, band!.contains(el) ? "cover" : `${el?.tagName} ${el?.closest("[class]")?.getAttribute("class")} y=${Math.round(r.top + r.height * fy)} vh=${innerHeight} x=${Math.round(r.left + r.width * fx)} vw=${innerWidth} pe=${getComputedStyle(band!).pointerEvents} L=${Math.round(r.left)} W=${Math.round(r.width)}`);
			}
		}, 200);
		if (params.get("coverui") === "repo") [...document.querySelectorAll<HTMLElement>(".sbd-cover-btn")].find((b) => b.textContent === "Reposition")?.click();
	}, 80);
	if (params.get("day")) window.setTimeout(() => document.querySelector<HTMLElement>(".sbd-month-cell.is-today")?.click(), 50);
	// Let async tracker loads settle, then signal ready for screenshots.
	window.setTimeout(() => document.body.setAttribute("data-ready", "1"), 300);
}

/** In-memory stand-in for SecretsStore (the browser has no fs). */
function fakeSecrets(mode: string) {
	const mk = (type: SecretEntry["type"], name: string, vals: string[], extra: Partial<SecretEntry> = {}): SecretEntry => {
		const e = { ...newEntry(type), name, ...extra };
		e.fields.forEach((f, i) => { f.value = vals[i] ?? ""; });
		return e;
	};
	const entries: SecretEntry[] = mode === "manage" ? [
		mk("api-key", "Anthropic API", ["sk-ant-demo-0000000000000000"], { url: "https://console.anthropic.com", tags: ["ai", "work"], notes: "Used by the report bot. Rotate every 90 days." }),
		mk("token", "GitHub PAT", ["ghp_demo000000000000000000", "2027-01-31"], { url: "https://github.com/settings/tokens", tags: ["dev"] }),
		mk("login", "Hosting dashboard", ["me@example.com", "demo-password"], { url: "https://example.com/login" }),
		mk("note", "Wi-Fi recovery codes", ["1234-5678"]),
	] : [];
	const listeners = new Set<() => void>();
	let unlocked = mode === "manage";
	return {
		file: "C:\\Users\\you\\AppData\\Roaming\\joejoe-secrets\\vault.enc",
		get unlocked() { return unlocked; },
		get entries() { return entries; },
		exists: () => mode !== "create",
		locationWarnings: () => [],
		onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
		create: async () => { unlocked = true; listeners.forEach((f) => f()); },
		unlock: async () => { unlocked = true; listeners.forEach((f) => f()); },
		lock: () => { unlocked = false; listeners.forEach((f) => f()); },
		touch: () => undefined,
		upsert: async (e: SecretEntry) => { const i = entries.findIndex((x) => x.id === e.id); if (i >= 0) entries[i] = e; else entries.push(e); listeners.forEach((f) => f()); },
		remove: async () => undefined,
		changePassword: async () => undefined,
		copy: async () => 30,
	};
}

void boot();

/** Pick up the first "to do" card and hover it over the second slot of "in progress" (no drop). */
function simulateDrag(): void {
	const card = document.querySelector<HTMLElement>(".sbd-lane .sbd-kcard");
	const lane = document.querySelectorAll<HTMLElement>(".sbd-lane .sbd-lane-items")[1];
	if (!card || !lane) return;
	const r = card.getBoundingClientRect();
	const start = { x: r.left + 40, y: r.top + 12 };
	const lr = lane.getBoundingClientRect();
	const end = { x: lr.left + 60, y: lr.top + 70 };
	card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", clientX: start.x, clientY: start.y }));
	for (let i = 1; i <= 12; i++) {
		const x = start.x + ((end.x - start.x) * i) / 12, y = start.y + ((end.y - start.y) * i) / 12;
		window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: x, clientY: y }));
	}
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** End-to-end check: add a card (Enter pressed twice + button), then drag a card to another list. */
async function boardTest(app: App): Promise<void> {
	const file = app.vault.getAbstractFileByPath("Tasks board.md") as unknown as { content: string };
	document.querySelector<HTMLElement>(".sbd-lane .sbd-add-card")?.click();
	await sleep(20);
	const ta = document.querySelector<HTMLTextAreaElement>(".sbd-add-card-input")!;
	ta.value = "Double test";
	ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	document.querySelector<HTMLButtonElement>(".sbd-add-card-row .mod-cta")?.click();
	await sleep(50);
	const card = document.querySelector<HTMLElement>(".sbd-lane .sbd-kcard")!;
	const target = document.querySelectorAll<HTMLElement>(".sbd-lane .sbd-lane-items")[1];
	const r = card.getBoundingClientRect(), tr = target.getBoundingClientRect();
	card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", clientX: r.left + 30, clientY: r.top + 10 }));
	for (let i = 1; i <= 10; i++) window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: r.left + 30 + ((tr.left + 40 - r.left - 30) * i) / 10, clientY: r.top + 10 + ((tr.top + 5 - r.top - 10) * i) / 10 }));
	window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse" }));
	await sleep(80);
	const out = document.createElement("pre");
	out.id = "boardtest-result";
	out.textContent = file.content;
	document.body.appendChild(out);
}

/** Hover the cover and the pixel field, and click the field once (for screenshots). */
function simulatePointer(): void {
	const at = (el: Element | null, fx: number, fy: number, type: string) => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }));
	};
	const banner = document.querySelector(".sbd-banner");
	at(banner, 0.62, 0.5, "pointermove");
	const field = document.querySelector(".sbd-pixel-field");
	at(field, 0.3, 0.4, "pointerdown");
	window.setTimeout(() => at(field, 0.7, 0.55, "pointermove"), 500);
}
