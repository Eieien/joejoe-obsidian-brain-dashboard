// Preview entry: boots the real plugin + dashboard view against demo-vault in a browser.
// URL: index.html#<tab>[&theme=light][&mode=week|timeline][&tracker=habits][&view=list]
import { App, moment } from "obsidian";
import SecondBrainPlugin from "../src/main";
import { CaptureModal } from "../src/view/CaptureModal";
import { DashboardView } from "../src/view/DashboardView";

declare const __VAULT__: { path: string; content: string; mtime: number; ctime: number }[];

async function boot(): Promise<void> {
	const params = new URLSearchParams(location.hash.slice(1).replace(/^([a-z]+)/, "tab=$1"));
	const theme = params.get("theme") ?? "dark";
	document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");

	const app = new App(__VAULT__);
	const plugin = new SecondBrainPlugin(app as never, {} as never);
	await plugin.onload();

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
	if (params.get("capture")) {
		new CaptureModal(app as never, plugin, { due: params.get("capture") === "due" ? moment().format("YYYY-MM-DD") : undefined }).open();
	}
	if (params.get("day")) window.setTimeout(() => document.querySelector<HTMLElement>(".sbd-month-cell.is-today")?.click(), 50);
	// Let async tracker loads settle, then signal ready for screenshots.
	window.setTimeout(() => document.body.setAttribute("data-ready", "1"), 300);
}

void boot();

/** Pick up the first "to do" card and hover it over the second slot of "in progress" (no drop). */
function simulateDrag(): void {
	const card = document.querySelector<HTMLElement>(".sbd-lane-todo .sbd-kcard");
	const lane = document.querySelector<HTMLElement>(".sbd-lane-in-progress .sbd-lane-items");
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
