// Read and edit board files in the Obsidian Kanban plugin's Markdown format:
//
//   ---
//   kanban-plugin: board
//   ---
//   ## To do
//   - [ ] A card @{2026-10-20} #tag
//   ## Done
//   **Complete**
//   - [x] Finished card
//   %% kanban:settings ... %%
//
// Pure functions (no Obsidian imports) so they can be unit-tested. Every edit takes the
// current file content and returns new content, locating cards by lane, position and text.

export interface BoardCard {
	lane: number;
	index: number;
	/** First line of the card (0-based) and the line after its last continuation line. */
	start: number;
	end: number;
	checked: boolean;
	/** Card text on its first line (after the checkbox). */
	text: string;
}

export interface BoardLane {
	title: string;
	heading: number;
	/** Lanes marked **Complete** check cards moved into them. */
	complete: boolean;
	completeLine: number | null;
	/** Line where the next lane (or the footer) begins. */
	end: number;
	cards: BoardCard[];
}

export interface Board {
	lanes: BoardLane[];
	/** First footer line (`***` archive divider or `%% kanban:settings`), or lines.length. */
	footer: number;
}

export interface CardRef {
	lane: number;
	index: number;
	text: string;
}

const CARD = /^- \[(.)\] ?(.*)$/;
const HEADING = /^## (.*)$/;
const FOOTER = /^(\*\*\*\s*|%% kanban:settings.*)$/;

function split(content: string): { lines: string[]; eol: string } {
	return { lines: content.split(/\r?\n/), eol: content.includes("\r\n") ? "\r\n" : "\n" };
}

export function parseBoard(content: string): Board {
	const { lines } = split(content);
	let i = 0;
	if (lines[0]?.trim() === "---") {
		const close = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
		i = close > 0 ? close + 1 : 0;
	}
	let footer = lines.length;
	for (let j = i; j < lines.length; j++) if (FOOTER.test(lines[j])) { footer = j; break; }

	const lanes: BoardLane[] = [];
	for (let j = i; j < footer; j++) {
		const h = lines[j].match(HEADING);
		if (h) lanes.push({ title: h[1].trim(), heading: j, complete: false, completeLine: null, end: footer, cards: [] });
	}
	lanes.forEach((lane, li) => {
		lane.end = lanes[li + 1]?.heading ?? footer;
		for (let j = lane.heading + 1; j < lane.end; j++) {
			const line = lines[j];
			if (line.trim() === "**Complete**") { lane.complete = true; lane.completeLine = j; continue; }
			const m = line.match(CARD);
			if (!m) continue;
			let end = j + 1;
			while (end < lane.end && /^\s+\S/.test(lines[end])) end++;
			lane.cards.push({ lane: li, index: lane.cards.length, start: j, end, checked: m[1] !== " ", text: m[2] });
			j = end - 1;
		}
	});
	return { lanes, footer };
}

export function isBoardFrontmatter(fm: Record<string, unknown> | undefined): boolean {
	return !!fm && fm["kanban-plugin"] !== undefined;
}

/** Find a card: exact lane/index/text first, then the same text anywhere on the board. */
export function findCard(board: Board, ref: CardRef): BoardCard | null {
	const exact = board.lanes[ref.lane]?.cards[ref.index];
	if (exact && exact.text === ref.text) return exact;
	for (const lane of board.lanes) for (const c of lane.cards) if (c.text === ref.text) return c;
	return null;
}

/** Index of the line where a new card goes at position `index` of a lane (end if omitted). */
function insertionLine(lines: string[], lane: BoardLane, index?: number): number {
	if (index !== undefined && index < lane.cards.length) return lane.cards[index].start;
	const last = lane.cards[lane.cards.length - 1];
	if (last) return last.end;
	// Empty lane: after the heading (and the **Complete** marker), skipping one blank line.
	let at = (lane.completeLine ?? lane.heading) + 1;
	if (lines[at] !== undefined && lines[at].trim() === "" && at < lane.end) at++;
	return at;
}

function join(lines: string[], eol: string): string {
	return lines.join(eol);
}

export function addCard(content: string, laneIdx: number, text: string): string {
	const { lines, eol } = split(content);
	const board = parseBoard(content);
	const lane = board.lanes[laneIdx];
	if (!lane) throw new Error("That list no longer exists.");
	const clean = text.replace(/\r?\n/g, " ").trim();
	lines.splice(insertionLine(lines, lane), 0, `- [${lane.complete ? "x" : " "}] ${clean}`);
	return join(lines, eol);
}

export function moveCard(content: string, ref: CardRef, toLane: number, toIndex: number): string {
	const { lines, eol } = split(content);
	const card = findCard(parseBoard(content), ref);
	if (!card) throw new Error("That card changed in the board file.");
	const block = lines.splice(card.start, card.end - card.start);
	// Re-parse without the card so positions in the target lane are current.
	const rest = parseBoard(join(lines, eol));
	const lane = rest.lanes[toLane];
	if (!lane) throw new Error("That list no longer exists.");
	const sameLane = card.lane === toLane;
	const index = sameLane && card.index < toIndex ? toIndex - 1 : toIndex;
	const from = parseBoard(content).lanes[card.lane];
	if (lane.complete && !from.complete) block[0] = block[0].replace(/^- \[.\]/, "- [x]");
	if (!lane.complete && from.complete) block[0] = block[0].replace(/^- \[.\]/, "- [ ]");
	lines.splice(insertionLine(lines, lane, index), 0, ...block);
	return join(lines, eol);
}

export function setChecked(content: string, ref: CardRef, checked: boolean): string {
	const { lines, eol } = split(content);
	const card = findCard(parseBoard(content), ref);
	if (!card) throw new Error("That card changed in the board file.");
	lines[card.start] = lines[card.start].replace(/^- \[.\]/, `- [${checked ? "x" : " "}]`);
	return join(lines, eol);
}

export function editCard(content: string, ref: CardRef, text: string): string {
	const { lines, eol } = split(content);
	const card = findCard(parseBoard(content), ref);
	if (!card) throw new Error("That card changed in the board file.");
	lines[card.start] = `- [${card.checked ? "x" : " "}] ${text.replace(/\r?\n/g, " ").trim()}`;
	return join(lines, eol);
}

export function deleteCard(content: string, ref: CardRef): string {
	const { lines, eol } = split(content);
	const card = findCard(parseBoard(content), ref);
	if (!card) throw new Error("That card changed in the board file.");
	lines.splice(card.start, card.end - card.start);
	return join(lines, eol);
}

/** Kanban plugin date syntax: @{YYYY-MM-DD}. */
export function setCardDate(content: string, ref: CardRef, date: string | null): string {
	const card = findCard(parseBoard(content), ref);
	if (!card) throw new Error("That card changed in the board file.");
	let text = card.text.replace(/\s*@\{[^}]*\}/g, "").trim();
	if (date) text = `${text} @{${date}}`;
	return editCard(content, ref, text);
}

export function addLane(content: string, title: string): string {
	const { lines, eol } = split(content);
	const board = parseBoard(content);
	const at = board.footer;
	const block = [`## ${title.trim()}`, "", ""];
	if (at > 0 && lines[at - 1].trim() !== "") block.unshift("");
	lines.splice(at, 0, ...block);
	return join(lines, eol);
}

export function renameLane(content: string, laneIdx: number, title: string): string {
	const { lines, eol } = split(content);
	const lane = parseBoard(content).lanes[laneIdx];
	if (!lane) throw new Error("That list no longer exists.");
	lines[lane.heading] = `## ${title.trim()}`;
	return join(lines, eol);
}

export function deleteLane(content: string, laneIdx: number): string {
	const { lines, eol } = split(content);
	const lane = parseBoard(content).lanes[laneIdx];
	if (!lane) throw new Error("That list no longer exists.");
	if (lane.cards.length) throw new Error("Move or delete this list's cards first.");
	lines.splice(lane.heading, lane.end - lane.heading);
	return join(lines, eol);
}

export function moveLane(content: string, laneIdx: number, dir: -1 | 1): string {
	const { lines, eol } = split(content);
	const lanes = parseBoard(content).lanes;
	const a = lanes[Math.min(laneIdx, laneIdx + dir)];
	const b = lanes[Math.max(laneIdx, laneIdx + dir)];
	if (!a || !b) return content;
	const blockA = lines.slice(a.heading, a.end);
	const blockB = lines.slice(b.heading, b.end);
	lines.splice(a.heading, b.end - a.heading, ...blockB, ...blockA);
	return join(lines, eol);
}

export function newBoardContent(lanes: { title: string; complete?: boolean }[]): string {
	const body = lanes.map((l) => `## ${l.title}\n\n${l.complete ? "**Complete**\n" : ""}\n`).join("\n");
	const settings = JSON.stringify({ "kanban-plugin": "board", "list-collapse": lanes.map(() => false) });
	return `---\n\nkanban-plugin: board\n\n---\n\n${body}\n\n%% kanban:settings\n\`\`\`\n${settings}\n\`\`\`\n%%`;
}

/** Display parts of a card: text without dates/tags, plus its date, time and tags. */
export function cardDisplay(text: string): { title: string; date?: string; time?: string; tags: string[] } {
	const date = text.match(/@\{(\d{4}-\d{2}-\d{2})\}/)?.[1] ?? text.match(/📅\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
	const time = text.match(/@@\{(\d{1,2}:\d{2})\}/)?.[1];
	const tags = [...text.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]+)/gu)].map((m) => m[2].toLowerCase());
	const title = text
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/@@?\{[^}]*\}/g, "")
		.replace(/📅\s*\d{4}-\d{2}-\d{2}/gu, "")
		.replace(/(^|\s)#[\p{L}\p{N}_\-/]+/gu, "$1")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
	return { title, date, time, tags };
}
