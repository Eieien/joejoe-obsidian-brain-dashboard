import assert from "node:assert/strict";
import {
	addCard, addLane, cardDisplay, deleteCard, deleteLane, editCard, moveCard, moveLane, newBoardContent, parseBoard,
	renameLane, setCardDate, setChecked,
} from "../src/data/kanbanBoard";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

const BOARD = [
	"---", "", "kanban-plugin: board", "", "---", "",
	"## To do", "", "- [ ] Write spec @{2026-10-20} #work", "- [ ] Call bank", "\twith account number", "",
	"## Doing", "", "", "",
	"## Done", "", "**Complete**", "- [x] Old thing", "", "",
	"%% kanban:settings", "```", "{\"kanban-plugin\":\"board\"}", "```", "%%",
].join("\n");

t("parse lanes, cards, continuation lines, complete marker", () => {
	const b = parseBoard(BOARD);
	assert.deepEqual(b.lanes.map((l) => l.title), ["To do", "Doing", "Done"]);
	assert.equal(b.lanes[0].cards.length, 2);
	assert.equal(b.lanes[0].cards[1].end - b.lanes[0].cards[1].start, 2);
	assert.equal(b.lanes[2].complete, true);
	assert.equal(b.lanes[2].cards[0].checked, true);
	assert.equal(b.lanes[1].cards.length, 0);
});

t("add card to empty lane and to complete lane", () => {
	let s = addCard(BOARD, 1, "New one");
	assert.deepEqual(parseBoard(s).lanes[1].cards.map((c) => c.text), ["New one"]);
	s = addCard(s, 2, "Shipped");
	const done = parseBoard(s).lanes[2].cards;
	assert.equal(done[1].text, "Shipped");
	assert.equal(done[1].checked, true);
	// Only one line added each time.
	assert.equal(s.split("\n").length, BOARD.split("\n").length + 2);
});

t("move card across lanes keeps continuation lines and checks in complete lane", () => {
	const s = moveCard(BOARD, { lane: 0, index: 1, text: "Call bank" }, 2, 0);
	const b = parseBoard(s);
	assert.deepEqual(b.lanes[0].cards.map((c) => c.text), ["Write spec @{2026-10-20} #work"]);
	assert.equal(b.lanes[2].cards[0].text, "Call bank");
	assert.equal(b.lanes[2].cards[0].checked, true);
	assert.equal(b.lanes[2].cards[0].end - b.lanes[2].cards[0].start, 2);
	const back = moveCard(s, { lane: 2, index: 0, text: "Call bank" }, 1, 0);
	assert.equal(parseBoard(back).lanes[1].cards[0].checked, false);
});

t("reorder within a lane", () => {
	const s = moveCard(BOARD, { lane: 0, index: 0, text: "Write spec @{2026-10-20} #work" }, 0, 2);
	assert.deepEqual(parseBoard(s).lanes[0].cards.map((c) => c.text), ["Call bank", "Write spec @{2026-10-20} #work"]);
});

t("finds a card by text when its position moved", () => {
	const s = setChecked(BOARD, { lane: 0, index: 0, text: "Call bank" }, true);
	assert.equal(parseBoard(s).lanes[0].cards[1].checked, true);
});

t("edit, date, delete", () => {
	let s = editCard(BOARD, { lane: 0, index: 1, text: "Call bank" }, "Call the bank");
	assert.equal(parseBoard(s).lanes[0].cards[1].text, "Call the bank");
	s = setCardDate(s, { lane: 0, index: 0, text: "Write spec @{2026-10-20} #work" }, "2026-11-01");
	assert.equal(parseBoard(s).lanes[0].cards[0].text, "Write spec #work @{2026-11-01}");
	s = deleteCard(s, { lane: 0, index: 1, text: "Call the bank" });
	assert.equal(parseBoard(s).lanes[0].cards.length, 1);
});

t("lanes: add, rename, move, delete empty", () => {
	let s = addLane(BOARD, "Review");
	assert.deepEqual(parseBoard(s).lanes.map((l) => l.title), ["To do", "Doing", "Done", "Review"]);
	assert.ok(s.includes("%% kanban:settings"));
	s = renameLane(s, 1, "In progress");
	s = moveLane(s, 3, -1);
	assert.deepEqual(parseBoard(s).lanes.map((l) => l.title), ["To do", "In progress", "Review", "Done"]);
	s = deleteLane(s, 2);
	assert.deepEqual(parseBoard(s).lanes.map((l) => l.title), ["To do", "In progress", "Done"]);
	assert.throws(() => deleteLane(s, 0));
});

t("new board template parses", () => {
	const b = parseBoard(newBoardContent([{ title: "To do" }, { title: "Done", complete: true }]));
	assert.deepEqual(b.lanes.map((l) => l.title), ["To do", "Done"]);
	assert.equal(b.lanes[1].complete, true);
});

t("CRLF files stay CRLF", () => {
	const crlf = BOARD.replace(/\n/g, "\r\n");
	const s = addCard(crlf, 0, "x");
	assert.ok(!/[^\r]\n/.test(s));
});

t("card display", () => {
	const d = cardDisplay("Write [[Spec|the spec]] @{2026-10-20} @@{14:00} #work <br>more");
	assert.equal(d.title, "Write the spec more");
	assert.equal(d.date, "2026-10-20");
	assert.equal(d.time, "14:00");
	assert.deepEqual(d.tags, ["work"]);
});

console.log(`\n${n} passed`);
