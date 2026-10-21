// Link-graph helpers for the Zettelkasten tools. Pure: pass in notes and Obsidian's
// resolvedLinks map ({ source: { target: count } }).

import type { NoteInfo } from "../types";

export type Links = Record<string, Record<string, number>>;

export interface LinkCounts {
	out: Map<string, number>;
	inc: Map<string, number>;
}

/** Incoming/outgoing link counts between Markdown notes (attachments ignored). */
export function linkCounts(resolved: Links): LinkCounts {
	const out = new Map<string, number>();
	const inc = new Map<string, number>();
	for (const [src, dests] of Object.entries(resolved)) {
		for (const dest of Object.keys(dests)) {
			if (!dest.endsWith(".md") || dest === src) continue;
			out.set(src, (out.get(src) ?? 0) + 1);
			inc.set(dest, (inc.get(dest) ?? 0) + 1);
		}
	}
	return { out, inc };
}

/** Notes with no links in or out (daily notes and projects excluded). */
export function orphans(notes: NoteInfo[], resolved: Links): NoteInfo[] {
	const { out, inc } = linkCounts(resolved);
	return notes
		.filter((n) => n.kind === "note" && !out.get(n.path) && !inc.get(n.path))
		.sort((a, b) => b.mtime - a.mtime);
}

const STOP = new Set("a an and are as at be by for from how i in is it of on or the to what why with you your this that into about notes note".split(" "));

export function titleWords(name: string): Set<string> {
	return new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)));
}

export interface Suggestion {
	note: NoteInfo;
	score: number;
	reasons: string[];
}

/**
 * Notes worth linking to `note`: shared tags (×3), shared title words (×2) and shared
 * neighbours (×1). Notes already linked either way are skipped.
 */
export function suggestLinks(note: NoteInfo, notes: NoteInfo[], resolved: Links, limit = 5): Suggestion[] {
	const linked = new Set([...Object.keys(resolved[note.path] ?? {})]);
	for (const [src, dests] of Object.entries(resolved)) if (dests[note.path]) linked.add(src);
	const myWords = titleWords(note.name);
	const myTags = new Set(note.tags);
	const myNeighbours = new Set(Object.keys(resolved[note.path] ?? {}));
	const out: Suggestion[] = [];
	for (const other of notes) {
		if (other.path === note.path || linked.has(other.path) || other.kind === "daily") continue;
		const reasons: string[] = [];
		let score = 0;
		const tags = other.tags.filter((t) => myTags.has(t));
		if (tags.length) { score += tags.length * 3; reasons.push(tags.map((t) => `#${t}`).join(" ")); }
		const words = [...titleWords(other.name)].filter((w) => myWords.has(w));
		if (words.length) { score += words.length * 2; reasons.push(`“${words.join(", ")}”`); }
		const shared = Object.keys(resolved[other.path] ?? {}).filter((d) => myNeighbours.has(d)).length;
		if (shared) { score += shared; reasons.push(`${shared} shared link${shared > 1 ? "s" : ""}`); }
		if (other.area && other.area === note.area) { score += 1; reasons.push(other.area.toLowerCase()); }
		if (score > 1) out.push({ note: other, score, reasons });
	}
	return out.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime).slice(0, limit);
}

function hash(s: string): number {
	let h = 2166136261;
	for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
	return h;
}

/** A stable daily pick of older notes to revisit. */
export function resurface(notes: NoteInfo[], today: string, count = 5, minAgeDays = 30, reviewed: (n: NoteInfo) => string | undefined = () => undefined): NoteInfo[] {
	const cutoff = Date.parse(today) - minAgeDays * 86_400_000;
	return notes
		.filter((n) => n.kind === "note" && n.mtime < cutoff && reviewed(n) !== today)
		.sort((a, b) => hash(today + a.path) - hash(today + b.path))
		.slice(0, count);
}

/** Split Markdown into sections at `## ` headings (text before the first heading is the intro). */
export function splitSections(content: string): { intro: string; sections: { title: string; body: string }[] } {
	const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	const parts = body.split(/^## +/m);
	const intro = parts.shift() ?? "";
	return {
		intro: intro.trim(),
		sections: parts.map((p) => {
			const nl = p.indexOf("\n");
			return { title: (nl < 0 ? p : p.slice(0, nl)).trim(), body: (nl < 0 ? "" : p.slice(nl + 1)).trim() };
		}).filter((s) => s.title),
	};
}
