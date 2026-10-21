import assert from "node:assert/strict";
import { linkCounts, orphans, resurface, splitSections, suggestLinks, titleWords } from "../src/data/graph";
import type { NoteInfo } from "../src/types";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const note = (path: string, o: Partial<NoteInfo> = {}): NoteInfo => ({
	path, name: path.split("/").pop()!.replace(/\.md$/, ""), kind: "note", mtime: Date.parse("2026-09-01"), ctime: 0, tags: [], folder: "", ...o,
});

const notes = [
	note("Z/Spaced repetition beats cramming.md", { tags: ["memory", "learning"] }),
	note("Z/Memory palaces.md", { tags: ["memory"] }),
	note("Z/Cramming fails long term.md"),
	note("Z/Linked.md"),
	note("Z/Target.md"),
	note("Daily/2026-10-01.md", { kind: "daily" }),
	note("Projects/P.md", { kind: "project" }),
];
const resolved = { "Z/Linked.md": { "Z/Target.md": 1, "img.png": 1 }, "Daily/2026-10-01.md": {} };

t("link counts ignore attachments", () => {
	const c = linkCounts(resolved);
	assert.equal(c.out.get("Z/Linked.md"), 1);
	assert.equal(c.inc.get("Z/Target.md"), 1);
	assert.equal(c.inc.get("img.png"), undefined);
});

t("orphans exclude linked notes, dailies and projects", () => {
	assert.deepEqual(orphans(notes, resolved).map((x) => x.name).sort(), ["Cramming fails long term", "Memory palaces", "Spaced repetition beats cramming"]);
});

t("title words drop stopwords and short words", () => {
	assert.deepEqual([...titleWords("How to Take Smart Notes in 2026")].sort(), ["smart", "take"]);
});

t("suggestions rank shared tags and title words, skip linked", () => {
	const s = suggestLinks(notes[0], notes, resolved);
	assert.equal(s[0].note.name, "Memory palaces");
	assert.ok(s.some((x) => x.note.name === "Cramming fails long term"));
	assert.equal(suggestLinks(notes[3], notes, resolved).some((x) => x.note.name === "Target"), false);
});

t("resurface is stable per day and skips recent / reviewed-today notes", () => {
	const a = resurface(notes, "2026-10-22", 3);
	assert.deepEqual(a, resurface(notes, "2026-10-22", 3));
	assert.ok(a.every((x) => x.kind === "note"));
	const fresh = [note("New.md", { mtime: Date.parse("2026-10-21") })];
	assert.equal(resurface(fresh, "2026-10-22").length, 0);
	assert.equal(resurface(notes, "2026-10-22", 10, 30, (x) => (x.name === "Linked" ? "2026-10-22" : undefined)).some((x) => x.name === "Linked"), false);
});

t("split sections at ## headings", () => {
	const r = splitSections("---\ntype: note\n---\nIntro text\n\n## First idea\nBody one\n\n## Second\nBody two\n### sub\nmore");
	assert.equal(r.intro, "Intro text");
	assert.deepEqual(r.sections.map((s) => s.title), ["First idea", "Second"]);
	assert.equal(r.sections[1].body, "Body two\n### sub\nmore");
});

console.log(`\n${n} passed`);
