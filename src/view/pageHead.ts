// Editorial page header for every tab but Home: a caption, an image band with the
// title overlapping its edge, an italic tagline, then an outlined date and a
// slash-separated list of live facts for the page.

import { moment, setIcon } from "obsidian";
import { isOpen, isOverdue, isDueToday } from "../data/queries";
import { inboxItems } from "./inboxTab";
import { imageSrc, ImagePickerModal } from "./pickers";
import type { DashboardContext } from "./components";

export interface PageHeadInfo { tab: string; title: string; sub: string; tagline: string; color: string; icon: string }

export interface PageHeadOptions {
	/** Use this image (vault path / URL) instead of the per-page header image. */
	image?: string;
	/** Vertical focus of the image (0–100). */
	imagePosition?: number;
	/** Draw your own controls on the band (Home uses the cover toolbar). */
	controls?: (band: HTMLElement, head: HTMLElement) => void;
	/** Facts that arrive later (e.g. money left today). */
	asyncFacts?: Promise<string | null>[];
}

/** Live numbers for the slash list under the header. */
function facts(tab: string, ctx: DashboardContext): string[] {
	const idx = ctx.plugin.index;
	const open = idx.tasks.filter(isOpen);
	const today = ctx.today;
	switch (tab) {
		case "inbox": { const n = inboxItems(ctx).length; return [n ? `${n} to process` : "inbox zero", `${open.filter((t) => !t.project).length} unfiled tasks`]; }
		case "tasks": return [`${open.length} open`, `${open.filter((t) => isOverdue(t, today)).length} overdue`, `${open.filter((t) => isDueToday(t, today)).length} due today`];
		case "calendar": {
			const end = moment(today).add(6, "days").format("YYYY-MM-DD");
			return [`${open.filter((t) => t.due && t.due >= today && t.due <= end).length} due this week`, `week ${moment(today).isoWeek()}`, moment(today).format("MMMM")];
		}
		case "projects": {
			const ps = idx.projectList();
			return [`${ps.length} projects`, `${ps.reduce((n, p) => n + idx.tasksForProject(p.key).filter(isOpen).length, 0)} open tasks`];
		}
		case "courses": {
			const cs = idx.courseList();
			const active = cs.filter((c) => c.active !== false);
			return [ctx.plugin.settings.currentTerm || "this semester", `${active.length} active`, `${active.reduce((n, c) => n + idx.tasksForProject(c.key).filter(isOpen).length, 0)} open tasks`];
		}
		case "notes": {
			const notes = [...idx.notes.values()].filter((n) => n.kind === "note");
			const weekAgo = moment(today).subtract(7, "days").valueOf();
			return [`${notes.length} notes`, `${notes.filter((n) => n.ctime >= weekAgo).length} new this week`];
		}
		case "trackers": return [`${ctx.plugin.settings.habits.length} habits`, "money", `${ctx.plugin.settings.trackers.length} other trackers`];
		case "review": return [`week ${moment(today).isoWeek()}`, `${idx.tasks.filter((t) => t.status === "done" && t.doneDate && t.doneDate >= moment(today).startOf("isoWeek").format("YYYY-MM-DD")).length} done so far`];
		case "home": {
			const due = open.filter((t) => isDueToday(t, today)).length;
			const late = open.filter((t) => isOverdue(t, today)).length;
			return [`${due} due today`, ...(late ? [`${late} overdue`] : []), `${open.length} open`];
		}
		case "library": {
			const all = [...idx.notes.values()];
			return [`${all.length} notes`, `${new Set(all.map((n) => n.folder).filter(Boolean)).size} folders`];
		}
	}
	return [];
}

export function renderPageHead(parent: HTMLElement, ctx: DashboardContext, info: PageHeadInfo, opts: PageHeadOptions = {}): HTMLElement {
	const a = ctx.plugin.settings.appearance;
	const images = (a.pageImages ??= {});
	const head = parent.createDiv({ cls: `sbd-ph sbd-c-${info.color}` });

	head.createDiv({ cls: "sbd-ph-caption", text: info.sub });

	const band = head.createDiv({ cls: "sbd-ph-band" });
	const chosen = opts.image ?? images[info.tab];
	const src = chosen ? imageSrc(ctx.app, chosen) : null;
	if (src) {
		band.addClass("has-image");
		band.style.backgroundImage = `url("${src}")`;
		if (opts.imagePosition !== undefined) band.style.backgroundPosition = `center ${opts.imagePosition}%`;
	}
	setIcon(band.createDiv({ cls: "sbd-ph-band-icon", attr: { "aria-hidden": "true" } }), info.icon);
	band.createDiv({ cls: "sbd-ph-tagline", text: info.tagline });
	band.createDiv({ cls: "sbd-ph-brand", text: a.title || "second brain" });
	if (opts.controls) opts.controls(band, head);
	else {
	const pick = band.createEl("button", { cls: "sbd-ph-pick", attr: { "aria-label": src ? "Change header image" : "Add a header image" } });
	setIcon(pick.createSpan({ cls: "sbd-icon" }), "image");
	pick.createSpan({ text: src ? "Change image" : "Add image" });
	pick.onclick = () => new ImagePickerModal(ctx.app, {
		title: `${info.title} header image`,
		onPick: async (s) => { images[info.tab] = s; await ctx.plugin.persist(); ctx.rerender(); },
		onRemove: src ? async () => { delete images[info.tab]; await ctx.plugin.persist(); ctx.rerender(); } : undefined,
	}).open();
	}

	head.createEl("h1", { cls: "sbd-ph-title", text: info.title });

	const bottom = head.createDiv({ cls: "sbd-ph-bottom" });
	const when = bottom.createDiv({ cls: "sbd-ph-when" });
	when.createSpan({ cls: "sbd-ph-when-label", text: "Today" });
	when.createSpan({ cls: "sbd-ph-date", text: moment(ctx.today).format("M.DD") });
	when.createSpan({ cls: "sbd-ph-dow", text: moment(ctx.today).format("ddd") });
	const list = bottom.createDiv({ cls: "sbd-ph-facts" });
	const f = facts(info.tab, ctx);
	const draw = () => { if (f.length) list.setText(`/ ${f.join(" / ")} /`); };
	draw();
	for (const p of opts.asyncFacts ?? []) void p.then((x) => { if (x) { f.push(x); draw(); } });
	return head;
}
