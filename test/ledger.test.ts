import assert from "node:assert/strict";
import { dailyByCategory, topExpenses, weekdayAverages, addTx, DEFAULT_MONEY_CATEGORIES as C, editTx, newLedgerContent, parseLedger, parseQuick, peso, shiftMonth, summarize } from "../src/data/ledger";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

t("new ledger has a table and parses empty", () => {
	const c = newLedgerContent("2026-10");
	assert.match(c, /# October 2026/);
	assert.deepEqual(parseLedger(c), []);
});

t("add keeps date order and parses back", () => {
	let c = newLedgerContent("2026-10");
	c = addTx(c, { date: "2026-10-05", type: "expense", amount: 250, category: "Food", note: "lunch" });
	c = addTx(c, { date: "2026-10-01", type: "income", amount: 52000, category: "Salary", note: "" });
	c = addTx(c, { date: "2026-10-03", type: "expense", amount: 99.5, category: "Transport", note: "grab | home" });
	const rows = parseLedger(c);
	assert.deepEqual(rows.map((r) => r.date), ["2026-10-01", "2026-10-03", "2026-10-05"]);
	assert.equal(rows[1].note, "grab / home"); // pipes can't break the table
	assert.equal(rows[1].amount, 99.5);
});

t("add creates a table in a note without one", () => {
	const c = addTx("# Notes\n\nsome text", { date: "2026-10-02", type: "expense", amount: 10, category: "Other", note: "" });
	assert.equal(parseLedger(c).length, 1);
	assert.match(c, /some text/);
});

t("edit and delete find the row, even if it moved", () => {
	let c = newLedgerContent("2026-10");
	c = addTx(c, { date: "2026-10-05", type: "expense", amount: 250, category: "Food", note: "lunch" });
	const [row] = parseLedger(c);
	c = "extra line\n" + c; // line numbers shift
	c = editTx(c, row, { ...row, amount: 300, date: "2026-10-04" });
	assert.equal(parseLedger(c)[0].amount, 300);
	const [r2] = parseLedger(c);
	c = editTx(c, r2, null);
	assert.equal(parseLedger(c).length, 0);
	assert.throws(() => editTx(c, r2, null), /changed/);
});

t("quick entry parses amount, category, note and income", () => {
	assert.deepEqual(parseQuick("250 food lunch with Mika", C), { amount: 250, type: "expense", category: "Food", note: "lunch with Mika" });
	assert.deepEqual(parseQuick("+52,000 salary october", C), { amount: 52000, type: "income", category: "Salary", note: "october" });
	assert.deepEqual(parseQuick("1.2k trans grab", C), { amount: 1200, type: "expense", category: "Transport", note: "grab" });
	assert.equal(parseQuick("3000 freelance logo", C)?.type, "income"); // income category implies income
	assert.equal(parseQuick("80 kwek-kwek", C)?.category, "Other");
	assert.equal(parseQuick("lunch", C), null);
});

t("month summary: totals, budget, cumulative, categories", () => {
	const cats = C.map((c) => (c.name === "Food" ? { ...c, budget: 5000 } : c.name === "Fun" ? { ...c, budget: 1000 } : c));
	let c = newLedgerContent("2026-10");
	c = addTx(c, { date: "2026-10-01", type: "income", amount: 52000, category: "Salary", note: "" });
	c = addTx(c, { date: "2026-10-02", type: "expense", amount: 300, category: "Food", note: "" });
	c = addTx(c, { date: "2026-10-04", type: "expense", amount: 700, category: "Food", note: "" });
	c = addTx(c, { date: "2026-10-04", type: "expense", amount: 1200, category: "Bills", note: "" });
	const s = summarize(parseLedger(c), "2026-10", "2026-10-10", cats, 20000);
	assert.equal(s.income, 52000); assert.equal(s.spent, 2200); assert.equal(s.net, 49800);
	assert.equal(s.left, 17800); assert.equal(s.elapsed, 10); assert.equal(s.perDay, 220);
	assert.equal(s.cumSpent[0], 0); assert.equal(s.cumSpent[1], 300); assert.equal(s.cumSpent[3], 2200); assert.equal(s.cumSpent.length, 31);
	assert.deepEqual(s.categories.map((x) => x.name), ["Bills", "Food", "Fun"]); // largest first, unused budgeted kept
	assert.equal(s.categories[1].budget, 5000);
	// no monthly budget → sum of category budgets
	assert.equal(summarize(parseLedger(c), "2026-10", "2026-10-10", cats, 0).budget, 6000);
});

t("months shift across years; pesos format", () => {
	assert.equal(shiftMonth("2026-12", 1), "2027-01");
	assert.equal(shiftMonth("2026-01", -1), "2025-12");
	assert.equal(peso(1234).replace(/\s/g, ""), "₱1,234");
	assert.equal(peso(-99.5).replace(/\s/g, ""), "−₱99.50");
	assert.equal(peso(500, { sign: true }).replace(/\s/g, ""), "+₱500");
});

t("analytics: daily by category, weekday averages, top expenses", () => {
	let c = newLedgerContent("2026-10");
	c = addTx(c, { date: "2026-10-05", type: "expense", amount: 200, category: "Food", note: "" }); // Monday
	c = addTx(c, { date: "2026-10-05", type: "expense", amount: 100, category: "Transport", note: "" });
	c = addTx(c, { date: "2026-10-12", type: "expense", amount: 500, category: "Food", note: "big" }); // Monday
	c = addTx(c, { date: "2026-10-12", type: "income", amount: 9999, category: "Salary", note: "" });
	const txs = parseLedger(c);
	const daily = dailyByCategory(txs, "2026-10");
	assert.deepEqual(daily[4], { Food: 200, Transport: 100 });
	assert.deepEqual(daily[11], { Food: 500 });
	const wd = weekdayAverages(txs, "2026-10", 14); // Oct 1–14 has two Mondays
	assert.equal(wd[1], 400);
	assert.equal(wd[0], 0);
	assert.deepEqual(topExpenses(txs, "2026-10", 2).map((x) => x.amount), [500, 200]);
});

console.log(`\n${n} passed`);
