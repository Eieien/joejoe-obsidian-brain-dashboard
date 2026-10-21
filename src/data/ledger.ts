// Money ledger: one Markdown note per month holding a table of transactions.
//
//   | Date | Type | Amount | Category | Note |
//   | --- | --- | ---: | --- | --- |
//   | 2026-10-22 | expense | 250 | Food | lunch with Mika |
//
// Pure functions only (parse, edit, summarise) so they can be unit-tested.

export type TxType = "expense" | "income";

export interface Tx {
	date: string;       // YYYY-MM-DD
	type: TxType;
	amount: number;     // always positive; the type gives the sign
	category: string;
	note: string;
	/** 0-based line index in the file (for edits). */
	line: number;
}

export interface MoneyCategory {
	name: string;
	icon: string;
	color: string;
	kind: TxType;
	/** Monthly budget for expense categories (0 = none). */
	budget: number;
}

export const LEDGER_HEADER = ["| Date | Type | Amount | Category | Note |", "| --- | --- | ---: | --- | --- |"];

const ROW = /^\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(expense|income)\s*\|\s*([-\d.,]+)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|\s*$/i;

/** Escape a cell value so it can't break the table. */
function cell(s: string): string {
	return s.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

export function parseLedger(content: string): Tx[] {
	const out: Tx[] = [];
	content.split(/\r?\n/).forEach((l, line) => {
		const m = ROW.exec(l);
		if (!m) return;
		const amount = Number(m[3].replace(/,/g, ""));
		if (!Number.isFinite(amount)) return;
		out.push({ date: m[1], type: m[2].toLowerCase() as TxType, amount: Math.abs(amount), category: m[4] || "Other", note: m[5], line });
	});
	return out;
}

export function formatRow(t: Omit<Tx, "line">): string {
	const amt = Math.round(t.amount * 100) / 100;
	return `| ${t.date} | ${t.type} | ${amt} | ${cell(t.category)} | ${cell(t.note)} |`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthTitle(month: string): string {
	const [y, m] = month.split("-").map(Number);
	return `${MONTHS[m - 1]} ${y}`;
}

export function newLedgerContent(month: string): string {
	return ["---", "type: ledger", `month: ${month}`, "---", `# ${monthTitle(month)}`, "", ...LEDGER_HEADER, ""].join("\n");
}

/** Insert a row keeping the table in date order; adds the table if the note has none. */
export function addTx(content: string, t: Omit<Tx, "line">): string {
	const nl = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	let sep = lines.findIndex((l) => /^\s*\|\s*-{3,}/.test(l) && /\|\s*-{3,}:?\s*\|/.test(l));
	if (sep < 0) {
		while (lines.length && lines[lines.length - 1] === "") lines.pop();
		lines.push("", ...LEDGER_HEADER);
		sep = lines.length - 1;
	}
	let at = sep + 1;
	while (at < lines.length && /^\s*\|/.test(lines[at])) {
		const m = ROW.exec(lines[at]);
		if (m && m[1] > t.date) break;
		at++;
	}
	lines.splice(at, 0, formatRow(t));
	return lines.join(nl);
}

/** Replace (or, with null, delete) the row at `line` — only if it still matches `expect`. */
export function editTx(content: string, expect: Tx, next: Omit<Tx, "line"> | null): string {
	const nl = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const matches = (l: string | undefined) => {
		const m = l !== undefined ? ROW.exec(l) : null;
		return !!m && m[1] === expect.date && Number(m[3].replace(/,/g, "")) === expect.amount && (m[4] || "Other") === expect.category && m[5] === expect.note;
	};
	let i = matches(lines[expect.line]) ? expect.line : lines.findIndex(matches);
	if (i < 0) throw new Error("That transaction changed in the file. Reload and try again.");
	if (next === null) { lines.splice(i, 1); return lines.join(nl); }
	if (next.date === expect.date) { lines[i] = formatRow(next); return lines.join(nl); }
	lines.splice(i, 1);
	return addTx(lines.join(nl), next);
}

/**
 * Quick entry: "250 food lunch", "+52000 salary", "1.2k transport grab home".
 * A leading + (or an income category) makes it income. The category is the first
 * word that matches one (prefix match), else "Other".
 */
export function parseQuick(input: string, categories: MoneyCategory[]): { amount: number; type: TxType; category: string; note: string } | null {
	const m = /^\s*([+-]?)\s*₱?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b\s*(.*)$/i.exec(input);
	if (!m) return null;
	let amount = Number(m[2].replace(/,/g, ""));
	if (m[3]) amount *= 1000;
	if (!(amount > 0)) return null;
	let rest = m[4].trim();
	let category = "";
	const first = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
	if (first) {
		const hit = categories.find((c) => c.name.toLowerCase() === first) ?? categories.find((c) => c.name.toLowerCase().startsWith(first) && first.length >= 3);
		if (hit) { category = hit.name; rest = rest.slice(first.length).trim(); }
	}
	const cat = categories.find((c) => c.name === category);
	const type: TxType = m[1] === "+" || cat?.kind === "income" ? "income" : "expense";
	if (!category) category = type === "income" ? (categories.find((c) => c.kind === "income")?.name ?? "Other income") : "Other";
	return { amount, type, category, note: rest };
}

export function daysInMonth(month: string): number {
	const [y, m] = month.split("-").map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(month: string, by: number): string {
	const [y, m] = month.split("-").map(Number);
	const d = new Date(Date.UTC(y, m - 1 + by, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CategoryTotal { name: string; spent: number; budget: number; count: number }

export interface MonthSummary {
	income: number;
	spent: number;
	net: number;
	budget: number;
	/** Remaining budget (negative when over). */
	left: number;
	/** Average spend per elapsed day. */
	perDay: number;
	/** Cumulative spend / income at the end of each day (index 0 = day 1). */
	cumSpent: number[];
	cumIncome: number[];
	/** Expense categories, largest first (budgeted-but-unused categories included). */
	categories: CategoryTotal[];
	incomeCategories: CategoryTotal[];
	/** Days elapsed (1…n) — the whole month for past months. */
	elapsed: number;
}

export function summarize(txs: Tx[], month: string, today: string, categories: MoneyCategory[], monthlyBudget: number): MonthSummary {
	const n = daysInMonth(month);
	const inMonth = txs.filter((t) => t.date.startsWith(month));
	const dailySpent = new Array(n).fill(0), dailyIncome = new Array(n).fill(0);
	const byCat = new Map<string, CategoryTotal>();
	const byInc = new Map<string, CategoryTotal>();
	for (const c of categories) {
		if (c.kind === "expense" && c.budget > 0) byCat.set(c.name, { name: c.name, spent: 0, budget: c.budget, count: 0 });
	}
	for (const t of inMonth) {
		const d = Number(t.date.slice(8, 10)) - 1;
		if (d < 0 || d >= n) continue;
		const map = t.type === "expense" ? byCat : byInc;
		if (t.type === "expense") dailySpent[d] += t.amount; else dailyIncome[d] += t.amount;
		const row = map.get(t.category) ?? { name: t.category, spent: 0, budget: t.type === "expense" ? (categories.find((c) => c.name === t.category)?.budget ?? 0) : 0, count: 0 };
		row.spent += t.amount; row.count++;
		map.set(t.category, row);
	}
	const cum = (a: number[]) => { let s = 0; return a.map((v) => (s += v)); };
	const cumSpent = cum(dailySpent), cumIncome = cum(dailyIncome);
	const spent = cumSpent[n - 1] ?? 0, income = cumIncome[n - 1] ?? 0;
	const catBudgets = categories.filter((c) => c.kind === "expense").reduce((s, c) => s + (c.budget || 0), 0);
	const budget = monthlyBudget > 0 ? monthlyBudget : catBudgets;
	const thisMonth = today.slice(0, 7);
	const elapsed = month < thisMonth ? n : month > thisMonth ? 0 : Number(today.slice(8, 10));
	const sort = (m: Map<string, CategoryTotal>) => [...m.values()].sort((a, b) => b.spent - a.spent || b.budget - a.budget);
	return {
		income, spent, net: income - spent, budget, left: budget - spent,
		perDay: elapsed ? spent / elapsed : 0,
		cumSpent, cumIncome,
		categories: sort(byCat), incomeCategories: sort(byInc), elapsed,
	};
}

/** Add days to a YYYY-MM-DD date. */
export function addDaysISO(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** First day of the week containing `date`. */
export function weekStartOf(date: string, mondayFirst: boolean): string {
	const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
	return addDaysISO(date, -(mondayFirst ? (dow + 6) % 7 : dow));
}

/** Total spending between two dates, inclusive. */
export function spentBetween(txs: Tx[], from: string, to: string): number {
	return txs.filter((t) => t.type === "expense" && t.date >= from && t.date <= to).reduce((s, t) => s + t.amount, 0);
}

export interface PeriodBudget {
	key: "day" | "week" | "month";
	label: string;
	spent: number;
	budget: number;
	/** Share of the period already gone (0–1), for a pace marker. */
	elapsed: number;
	from: string;
	to: string;
}

/** Today / this week / this month against their budgets (0 = no budget set). */
export function periodBudgets(txs: Tx[], today: string, mondayFirst: boolean, budgets: { daily: number; weekly: number; monthly: number }): PeriodBudget[] {
	const ws = weekStartOf(today, mondayFirst);
	const month = today.slice(0, 7);
	const n = daysInMonth(month);
	const day = Number(today.slice(8, 10));
	const weekDay = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ws}T00:00:00Z`)) / 86_400_000) + 1;
	return [
		{ key: "day", label: "Today", spent: spentBetween(txs, today, today), budget: budgets.daily, elapsed: 0, from: today, to: today },
		{ key: "week", label: "This week", spent: spentBetween(txs, ws, addDaysISO(ws, 6)), budget: budgets.weekly, elapsed: weekDay / 7, from: ws, to: addDaysISO(ws, 6) },
		{ key: "month", label: "This month", spent: spentBetween(txs, `${month}-01`, `${month}-${String(n).padStart(2, "0")}`), budget: budgets.monthly, elapsed: day / n, from: `${month}-01`, to: `${month}-${n}` },
	];
}

/** Spending per day, split by category: rows[day-1] = { Food: 250, … }. */
export function dailyByCategory(txs: Tx[], month: string): Record<string, number>[] {
	const n = daysInMonth(month);
	const rows: Record<string, number>[] = Array.from({ length: n }, () => ({}));
	for (const t of txs) {
		if (t.type !== "expense" || !t.date.startsWith(month)) continue;
		const d = Number(t.date.slice(8, 10)) - 1;
		if (d >= 0 && d < n) rows[d][t.category] = (rows[d][t.category] ?? 0) + t.amount;
	}
	return rows;
}

/** Average spending per weekday (0 = Sunday) over the elapsed days of the month. */
export function weekdayAverages(txs: Tx[], month: string, elapsed: number): number[] {
	const totals = new Array(7).fill(0), counts = new Array(7).fill(0);
	const [y, m] = month.split("-").map(Number);
	for (let d = 1; d <= elapsed; d++) counts[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]++;
	for (const t of txs) {
		if (t.type !== "expense" || !t.date.startsWith(month) || Number(t.date.slice(8, 10)) > elapsed) continue;
		totals[new Date(`${t.date}T00:00:00Z`).getUTCDay()] += t.amount;
	}
	return totals.map((v, i) => (counts[i] ? v / counts[i] : 0));
}

/** Largest expenses in the month, biggest first. */
export function topExpenses(txs: Tx[], month: string, n = 5): Tx[] {
	return txs.filter((t) => t.type === "expense" && t.date.startsWith(month)).sort((a, b) => b.amount - a.amount).slice(0, n);
}

export const DEFAULT_MONEY_CATEGORIES: MoneyCategory[] = [
	{ name: "Food", icon: "utensils", color: "amber", kind: "expense", budget: 0 },
	{ name: "Transport", icon: "bus", color: "sky", kind: "expense", budget: 0 },
	{ name: "Bills", icon: "receipt", color: "rose", kind: "expense", budget: 0 },
	{ name: "Shopping", icon: "shopping-bag", color: "pink", kind: "expense", budget: 0 },
	{ name: "Subscriptions", icon: "repeat", color: "violet", kind: "expense", budget: 0 },
	{ name: "Health", icon: "heart-pulse", color: "teal", kind: "expense", budget: 0 },
	{ name: "Fun", icon: "party-popper", color: "yellow", kind: "expense", budget: 0 },
	{ name: "Other", icon: "circle-dashed", color: "gray", kind: "expense", budget: 0 },
	{ name: "Salary", icon: "briefcase", color: "emerald", kind: "income", budget: 0 },
	{ name: "Freelance", icon: "laptop", color: "indigo", kind: "income", budget: 0 },
	{ name: "Gifts", icon: "gift", color: "pink", kind: "income", budget: 0 },
	{ name: "Other income", icon: "plus-circle", color: "gray", kind: "income", budget: 0 },
];

/** ₱1,234 / ₱1,234.50 — whole pesos without decimals. */
export function peso(n: number, opts: { sign?: boolean; currency?: string } = {}): string {
	const cur = opts.currency || "PHP";
	const whole = Math.abs(n % 1) < 0.005;
	let s: string;
	try {
		s = new Intl.NumberFormat("en-PH", { style: "currency", currency: cur, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(Math.abs(n));
	} catch {
		s = `${cur} ${Math.abs(n).toFixed(whole ? 0 : 2)}`;
	}
	const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
	return sign + s;
}
