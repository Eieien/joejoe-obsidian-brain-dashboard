// Run: npm test
import assert from "node:assert/strict";
import { buildTaskLine, cleanText, parseTaskLine, removeLabel, addLabel, setDoneDate, setDue, setPriority, setStatusChar, statusFromChar } from "../src/data/taskParser";
import { dueBucket, isUrgent, score, startOfWeek } from "../src/data/queries";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { Task } from "../src/types";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

t("parses tasks-plugin line", () => {
	const p = parseTaskLine("- [ ] Send invoice #urgent #needs-to-be-done [[Projects/Client A|Client A]] ⏫ 📅 2026-10-20")!;
	assert.equal(p.text, "Send invoice Client A");
	assert.equal(p.priority, 2);
	assert.deepEqual(p.labels, ["urgent", "needs-to-be-done"]);
	assert.deepEqual(p.links, ["Projects/Client A"]);
	assert.equal(p.due, "2026-10-20");
});
t("parses dataview fields + #p1", () => {
	const p = parseTaskLine("  * [/] Draft spec [due:: 2026-10-22] #p1 ^abc123")!;
	assert.equal(p.statusChar, "/");
	assert.equal(p.priority, 1);
	assert.equal(p.due, "2026-10-22");
	assert.deepEqual(p.labels, []);
	assert.equal(p.text, "Draft spec");
});
t("priority:: words", () => assert.equal(parseTaskLine("- [ ] x [priority:: low]")!.priority, 4));
t("non-task returns null", () => assert.equal(parseTaskLine("- plain bullet"), null));
t("done date + recurrence stripped", () => {
	const p = parseTaskLine("- [x] Water plants 🔁 every week 📅 2026-10-10 ✅ 2026-10-11")!;
	assert.equal(p.doneDate, "2026-10-11");
	assert.equal(p.text, "Water plants");
});
t("status chars", () => {
	const c = DEFAULT_SETTINGS.statusChars;
	assert.equal(statusFromChar("x", c), "done");
	assert.equal(statusFromChar("X", c), "done");
	assert.equal(statusFromChar("/", c), "in-progress");
	assert.equal(statusFromChar("?", c), "waiting");
	assert.equal(statusFromChar("-", c), "cancelled");
	assert.equal(statusFromChar(" ", c), "todo");
});
t("setPriority replaces and keeps metadata at end", () => {
	const l = "- [ ] Call bank #call ⏫ 📅 2026-10-20 ^id1";
	assert.equal(setPriority(l, 1), "- [ ] Call bank #call 🔺 📅 2026-10-20 ^id1");
	assert.equal(setPriority(l, 3), "- [ ] Call bank #call 📅 2026-10-20 ^id1");
	assert.equal(setPriority("- [ ] a #p2 b", 4), "- [ ] a b 🔽");
});
t("setDue add / replace / clear", () => {
	assert.equal(setDue("- [ ] a", "2026-11-01"), "- [ ] a 📅 2026-11-01");
	assert.equal(setDue("- [ ] a 📅 2026-10-01 ^x", "2026-11-01"), "- [ ] a 📅 2026-11-01 ^x");
	assert.equal(setDue("- [ ] a [due:: 2026-10-01]", null), "- [ ] a");
});
t("labels add/remove", () => {
	assert.equal(addLabel("- [ ] a ⏫ 📅 2026-10-20", "quick-win"), "- [ ] a #quick-win ⏫ 📅 2026-10-20");
	assert.equal(addLabel("- [ ] a #urgent", "urgent"), "- [ ] a #urgent");
	assert.equal(removeLabel("- [ ] a #urgent b", "urgent"), "- [ ] a b");
});
t("status + done date", () => {
	let l = setStatusChar("- [ ] a 📅 2026-10-20", "x");
	l = setDoneDate(l, "2026-10-18");
	assert.equal(l, "- [x] a 📅 2026-10-20 ✅ 2026-10-18");
	l = setDoneDate(setStatusChar(l, " "), null);
	assert.equal(l, "- [ ] a 📅 2026-10-20");
});
t("buildTaskLine roundtrip", () => {
	const l = buildTaskLine({ text: "Ship v1", priority: 1, labels: ["urgent"], due: "2026-10-19", projectLink: "Launch" });
	assert.equal(l, "- [ ] Ship v1 [[Launch]] #urgent 🔺 📅 2026-10-19");
	const p = parseTaskLine(l)!;
	assert.equal(p.priority, 1);
	assert.equal(p.due, "2026-10-19");
	assert.deepEqual(p.links, ["Launch"]);
});
t("cleanText md links", () => assert.equal(cleanText("Read [docs](https://x.y) now"), "Read docs now"));

const mk = (o: Partial<Task>): Task => ({ id: "a", path: "a.md", line: 0, raw: "", text: "", status: "todo", statusChar: " ", priority: 3, labels: [], links: [], fileMtime: 0, ...o });
t("urgency + scoring", () => {
	const s = DEFAULT_SETTINGS;
	const today = "2026-10-18";
	assert.ok(isUrgent(mk({ due: "2026-10-19" }), today, s));
	assert.ok(!isUrgent(mk({ due: "2026-10-25" }), today, s));
	assert.ok(isUrgent(mk({ labels: ["urgent"] }), today, s));
	assert.ok(score(mk({ due: "2026-10-10" }), today, s) > score(mk({ priority: 2 }), today, s));
	assert.equal(dueBucket(mk({ due: "2026-10-17" }), today), "Overdue");
});
t("startOfWeek is local Monday", () => {
	assert.equal(startOfWeek("2026-10-18"), "2026-10-12");
	assert.equal(startOfWeek("2026-10-19"), "2026-10-19");
});

console.log(`\n${n} passed`);
