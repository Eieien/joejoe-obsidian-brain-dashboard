// Money: income and expenses, kept in monthly ledger notes.
// Summary first (one big figure + a budget ring), then quick add, the month as a
// curve, analytical charts, categories and a day-by-day ledger.

import { App, Menu, Modal, Notice, setIcon } from "obsidian";
import type SecondBrainPlugin from "../main";
import {
	dailyByCategory, daysInMonth, monthTitle, parseQuick, periodBudgets, peso, shiftMonth, summarize, topExpenses, weekdayAverages,
	type MoneyCategory, type MonthSummary, type Tx, type TxType,
} from "../data/ledger";
import { styleClasses } from "../settings";
import { whenLoaded, type DashboardContext } from "./components";

export interface MoneyState { month?: string; filter: "all" | TxType; category?: string; query: string }

/** 18 colours; each maps to --c-<name> / --c-<name>-bg tokens in styles.css (light and dark). */
export const MONEY_COLORS = ["rose", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "brown", "gray"];

const ICONS = [
	"utensils", "coffee", "shopping-cart", "shopping-bag", "bus", "car", "fuel", "plane", "home", "receipt", "zap", "wifi",
	"smartphone", "repeat", "heart-pulse", "pill", "dumbbell", "party-popper", "film", "gamepad-2", "music", "book-open",
	"graduation-cap", "gift", "baby", "dog", "shirt", "scissors", "wrench", "piggy-bank", "briefcase", "laptop",
	"trending-up", "coins", "wallet", "banknote", "hand-coins", "tag", "circle-dashed", "plus-circle",
];

const SVG = "http://www.w3.org/2000/svg";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	parent.appendChild(el);
	return el;
}
function svgText(parent: Element, x: number, y: number, text: string, cls: string, anchor = "start"): SVGTextElement {
	const t = svg(parent, "text", { x, y, class: cls, "text-anchor": anchor });
	t.textContent = text;
	return t;
}
function tip(el: Element, text: string): void {
	const t = svg(el, "title", {});
	t.textContent = text;
}

function cat(plugin: SecondBrainPlugin, name: string): MoneyCategory | undefined {
	return plugin.settings.money.categories.find((c) => c.name === name);
}
const colorOf = (plugin: SecondBrainPlugin, name: string) => cat(plugin, name)?.color ?? "gray";

function catIcon(parent: HTMLElement, plugin: SecondBrainPlugin, name: string): HTMLElement {
	const c = cat(plugin, name);
	const el = parent.createSpan({ cls: `sbd-money-cat-icon sbd-c-${c?.color ?? "gray"}` });
	setIcon(el, c?.icon ?? "circle-dashed");
	return el;
}

const money = (plugin: SecondBrainPlugin, n: number, sign = false) => peso(n, { sign, currency: plugin.settings.money.currency });
/** Short form for chart labels: ₱1.2k, ₱52k. */
function short(n: number): string {
	const a = Math.abs(n);
	const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : a >= 1000 ? `${(a / 1000).toFixed(a >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(Math.round(a));
	return `${n < 0 ? "−" : ""}₱${s}`;
}

/** Notice with an Undo link. */
function undoNotice(message: string, undo: () => Promise<void>): void {
	const frag = document.createDocumentFragment();
	frag.append(`${message} `);
	const a = document.createElement("a");
	a.className = "sbd-undo-link"; a.textContent = "Undo";
	frag.append(a);
	const n = new Notice(frag, 6000);
	a.addEventListener("click", () => { void undo(); (n as { hide?: () => void }).hide?.(); });
}

async function deleteTx(plugin: SecondBrainPlugin, t: Tx, refresh: () => void): Promise<void> {
	await plugin.ledger.remove(t);
	refresh();
	const { line: _line, ...rest } = t;
	undoNotice(`Deleted ${money(plugin, t.amount)} · ${t.note || t.category}.`, async () => { await plugin.ledger.add(rest); refresh(); });
}

/** Right-click menu for a transaction. */
function txMenu(e: MouseEvent, ctx: DashboardContext, t: Tx): void {
	e.preventDefault();
	const p = ctx.plugin;
	const m = new Menu();
	m.addItem((i) => i.setTitle("Edit…").setIcon("pencil").onClick(() => new TxModal(ctx.app, p, { tx: t }, () => ctx.rerender()).open()));
	m.addItem((i) => i.setTitle("Duplicate for today").setIcon("copy").onClick(async () => {
		const { line: _l, ...rest } = t;
		await p.ledger.add({ ...rest, date: ctx.today });
		ctx.rerender();
		new Notice(`Added ${money(p, t.amount)} · ${t.category} for today.`);
	}));
	m.addSeparator();
	for (const c of p.settings.money.categories.filter((x) => x.kind === t.type && x.name !== t.category)) {
		m.addItem((i) => i.setTitle(`Move to ${c.name}`).setIcon(c.icon).onClick(async () => {
			const { line: _l, ...rest } = t;
			await p.ledger.update(t, { ...rest, category: c.name });
			ctx.rerender();
		}));
	}
	m.addSeparator();
	m.addItem((i) => {
		i.setTitle("Delete").setIcon("trash-2").onClick(() => void deleteTx(p, t, () => ctx.rerender()));
		(i as unknown as { setWarning?: (b: boolean) => void }).setWarning?.(true);
	});
	m.showAtMouseEvent(e);
}

// ---------------------------------------------------------------- trackers-home card

/** Card for the trackers home: this month's money at a glance. */
export function moneyCard(grid: HTMLElement, ctx: DashboardContext, open: () => void): void {
	const p = ctx.plugin;
	const month = ctx.today.slice(0, 7);
	const card = grid.createDiv({ cls: "sbd-home-card sbd-money-card", attr: { role: "button", tabindex: "0", "aria-label": "Open money" } });
	card.onclick = open;
	card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
	const head = card.createDiv({ cls: "sbd-home-card-head" });
	setIcon(head.createSpan({ cls: "sbd-home-card-icon sbd-c-emerald" }), "wallet");
	head.createSpan({ cls: "sbd-home-card-name", text: "Money" });
	const add = head.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Log expense or income" } });
	setIcon(add, "plus");
	add.onclick = (e) => { e.stopPropagation(); new TxModal(ctx.app, p, { date: ctx.today }, () => ctx.rerender()).open(); };
	const body = card.createDiv({ cls: "sbd-home-card-body" });
	whenLoaded(body, p.ledger.month(month), (txs) => {
		const s = summarize(txs, month, ctx.today, p.settings.money.categories, p.settings.money.monthlyBudget);
		const big = body.createDiv({ cls: "sbd-home-card-big" });
		big.createSpan({ text: s.budget ? money(p, Math.max(s.left, 0)) : money(p, s.net, true) });
		big.createSpan({ cls: "sbd-home-card-unit", text: s.budget ? (s.left >= 0 ? " left this month" : " over budget") : " net this month" });
		if (s.budget) budgetTrack(body, s.spent, s.budget, s.elapsed / daysInMonth(month));
		const facts = body.createDiv({ cls: "sbd-home-card-facts" });
		const fact = (label: string, value: string, cls = "") => { const f = facts.createDiv(); f.createDiv({ cls: "sbd-muted", text: label }); f.createDiv({ cls: `sbd-home-card-fact ${cls}`, text: value }); };
		fact("Spent", money(p, s.spent));
		fact("Received", money(p, s.income), "is-pos");
		fact("Net", money(p, s.net, true), s.net < 0 ? "is-neg" : "is-pos");
		const strip = body.createDiv({ cls: "sbd-home-card-strip", attr: { "aria-hidden": "true" } });
		for (const c of s.categories.slice(0, 6)) if (c.spent > 0) strip.createDiv({ cls: `sbd-c-${colorOf(p, c.name)}`, attr: { style: `flex: ${c.spent}`, title: `${c.name} ${money(p, c.spent)}` } });
	});
}

/** A budget bar with a tick for "where you should be today". */
function budgetTrack(parent: HTMLElement, spent: number, budget: number, pace?: number): HTMLElement {
	const pct = budget ? spent / budget : 0;
	const t = parent.createDiv({ cls: "sbd-money-track" + (pct > 1 ? " is-over" : pct > 0.85 ? " is-near" : ""), attr: { role: "meter", "aria-valuemin": "0", "aria-valuemax": String(budget), "aria-valuenow": String(Math.round(spent)), "aria-label": "Budget used" } });
	t.createDiv({ cls: "sbd-money-track-fill", attr: { style: `width: ${Math.min(pct, 1) * 100}%` } });
	if (pace !== undefined && pace > 0 && pace < 1) t.createDiv({ cls: "sbd-money-track-pace", attr: { style: `left: ${pace * 100}%`, title: "Where spending would be if spread evenly" } });
	return t;
}

// ---------------------------------------------------------------- full view

export function renderMoney(el: HTMLElement, ctx: DashboardContext, st: MoneyState, update: (p: Partial<MoneyState>) => void, back: () => void): void {
	const p = ctx.plugin;
	const month = st.month ?? ctx.today.slice(0, 7);
	const root = el.createDiv({ cls: "sbd-money" });

	const bar = root.createDiv({ cls: "sbd-money-bar" });
	const backBtn = bar.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "All trackers" } });
	setIcon(backBtn, "arrow-left");
	backBtn.onclick = back;
	const nav = bar.createDiv({ cls: "sbd-money-month" });
	const prev = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Previous month" } });
	setIcon(prev, "chevron-left");
	prev.onclick = () => update({ month: shiftMonth(month, -1) });
	nav.createEl("h2", { cls: "sbd-money-title", text: monthTitle(month) });
	const next = nav.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": "Next month" } });
	setIcon(next, "chevron-right");
	next.onclick = () => update({ month: shiftMonth(month, 1) });
	if (month !== ctx.today.slice(0, 7)) {
		const now = nav.createEl("button", { cls: "sbd-ghost-btn", text: "This month" });
		now.onclick = () => update({ month: undefined });
	}
	const gear = bar.createEl("button", { cls: "sbd-ghost-btn sbd-money-gear" });
	setIcon(gear.createSpan({ cls: "sbd-icon" }), "sliders-horizontal");
	gear.createSpan({ text: "Budget & categories" });
	gear.onclick = () => new MoneySettingsModal(ctx.app, p, () => ctx.rerender()).open();

	const body = root.createDiv({ cls: "sbd-money-body" });
	whenLoaded(body, Promise.all([p.ledger.month(month), p.ledger.month(shiftMonth(month, -1))]), ([txs, prevTxs]) => {
		const s = summarize(txs, month, ctx.today, p.settings.money.categories, p.settings.money.monthlyBudget);
		hero(body, ctx, s, month);
		periods(body, ctx, [...prevTxs, ...txs], s, month);
		quickAdd(body, ctx, month);
		const cols = body.createDiv({ cls: "sbd-money-cols" });
		categoriesBlock(cols.createDiv({ cls: "sbd-money-col" }), ctx, s, txs, month, st, update);
		ledgerBlock(cols.createDiv({ cls: "sbd-money-col sbd-money-col-wide" }), ctx, txs, st, update);
		curve(body.createDiv({ cls: "sbd-money-panel" }), ctx, s, month);
		insights(body, ctx, txs, s, month);
	});
}

// ---- summary band: the headline figure, a budget ring, then four facts ----
function hero(parent: HTMLElement, ctx: DashboardContext, s: MonthSummary, month: string): void {
	const p = ctx.plugin;
	const n = daysInMonth(month);
	const band = parent.createDiv({ cls: "sbd-money-hero" });
	const main = band.createDiv({ cls: "sbd-money-hero-main" });
	if (s.budget) {
		const daysLeft = Math.max(n - s.elapsed, 0);
		main.createDiv({ cls: "sbd-money-hero-label", text: s.left >= 0 ? "Left to spend" : "Over budget" });
		main.createDiv({ cls: "sbd-money-hero-value" + (s.left < 0 ? " is-neg" : ""), text: money(p, Math.abs(s.left)) });
		main.createDiv({ cls: "sbd-money-hero-note", text: s.left >= 0 && daysLeft ? `${money(p, Math.floor(s.left / daysLeft))} a day for the ${daysLeft} days left` : `of a ${money(p, s.budget)} budget` });
		budgetTrack(main, s.spent, s.budget, s.elapsed / n);
		main.createDiv({ cls: "sbd-money-hero-sub", text: `${money(p, s.spent)} of ${money(p, s.budget)} used · ${Math.round((s.spent / s.budget) * 100)}%` });
		ring(band, s.spent / s.budget, s.elapsed / n, `${Math.round((s.spent / s.budget) * 100)}%`, "of budget");
	} else {
		main.createDiv({ cls: "sbd-money-hero-label", text: "Net this month" });
		main.createDiv({ cls: "sbd-money-hero-value " + (s.net < 0 ? "is-neg" : "is-pos"), text: money(p, s.net, true) });
		main.createDiv({ cls: "sbd-money-hero-note", text: s.income ? `${Math.round((s.net / s.income) * 100)}% of what came in is still yours` : "Log income and spending to see your net." });
		const b = main.createEl("button", { cls: "sbd-ghost-btn sbd-money-setbudget" });
		setIcon(b.createSpan({ cls: "sbd-icon" }), "target");
		b.createSpan({ text: "Set a monthly budget" });
		b.onclick = () => new MoneySettingsModal(ctx.app, p, () => ctx.rerender()).open();
	}
	const facts = parent.createDiv({ cls: "sbd-money-facts" });
	const fact = (label: string, value: string, note: string, cls = "") => {
		const f = facts.createDiv({ cls: `sbd-money-fact ${cls}` });
		f.createDiv({ cls: "sbd-money-fact-label", text: label });
		f.createDiv({ cls: "sbd-money-fact-value", text: value });
		f.createDiv({ cls: "sbd-money-fact-note", text: note });
	};
	fact("Received", money(p, s.income), s.incomeCategories[0] ? `Mostly ${s.incomeCategories[0].name.toLowerCase()}` : "Nothing yet", "is-pos");
	fact("Spent", money(p, s.spent), s.elapsed ? `${money(p, Math.round(s.perDay))} a day` : "—");
	fact("Net", money(p, s.net, true), s.net >= 0 ? "Income minus spending" : "Spending more than income", s.net < 0 ? "is-neg" : "is-pos");
	fact("Saved", s.income ? `${Math.max(0, Math.round((s.net / s.income) * 100))}%` : "—", "Of this month's income");
}

/** Today / this week / this month against their budgets. */
function periods(parent: HTMLElement, ctx: DashboardContext, txs: Tx[], s: MonthSummary, month: string): void {
	const p = ctx.plugin;
	const m = p.settings.money;
	const current = month === ctx.today.slice(0, 7);
	const all = periodBudgets(txs, ctx.today, ctx.plugin.settings.weekStartsMonday, { daily: m.dailyBudget || 0, weekly: m.weeklyBudget || 0, monthly: s.budget });
	const list = current ? all : all.filter((x) => x.key === "month");
	const wrap = parent.createDiv({ cls: "sbd-money-periods" });
	const head = wrap.createDiv({ cls: "sbd-money-periods-head" });
	head.createEl("h3", { cls: "sbd-money-h", text: "Your budgets" });
	const edit = head.createEl("button", { cls: "sbd-ghost-btn" });
	setIcon(edit.createSpan({ cls: "sbd-icon" }), "pencil");
	edit.createSpan({ text: "Set budgets" });
	edit.onclick = () => new MoneySettingsModal(ctx.app, p, () => ctx.rerender()).open();
	const grid = wrap.createDiv({ cls: "sbd-money-periods-grid" });
	for (const b of list) {
		const card = grid.createDiv({ cls: `sbd-money-period is-${b.key}` });
		const top = card.createDiv({ cls: "sbd-money-period-top" });
		top.createSpan({ cls: "sbd-money-period-label", text: b.key === "month" && !current ? monthTitle(month) : b.label });
		if (b.key === "week") top.createSpan({ cls: "sbd-money-period-range", text: `${shortDate(b.from)} – ${shortDate(b.to)}` });
		if (!b.budget) {
			card.createDiv({ cls: "sbd-money-period-value", text: money(p, b.spent) });
			const set = card.createEl("button", { cls: "sbd-money-period-set", text: `Set a ${b.key === "day" ? "daily" : b.key === "week" ? "weekly" : "monthly"} budget` });
			set.onclick = () => new MoneySettingsModal(ctx.app, p, () => ctx.rerender()).open();
			continue;
		}
		const left = b.budget - b.spent;
		const val = card.createDiv({ cls: "sbd-money-period-value" + (left < 0 ? " is-neg" : "") });
		val.createSpan({ text: money(p, Math.abs(left)) });
		val.createSpan({ cls: "sbd-money-period-unit", text: left >= 0 ? " left" : " over" });
		budgetTrack(card, b.spent, b.budget, b.key === "day" ? undefined : b.elapsed);
		card.createDiv({ cls: "sbd-money-period-note", text: `${money(p, b.spent)} of ${money(p, b.budget)} · ${Math.round((b.spent / b.budget) * 100)}%` });
	}
}

function shortDate(iso: string): string {
	const d = new Date(`${iso}T00:00:00`);
	return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()}`;
}

/** A ring gauge: share of budget used, with a tick where you'd be at an even pace. */
function ring(parent: HTMLElement, used: number, pace: number, big: string, small: string): void {
	const size = 148, r = 58, c = 2 * Math.PI * r;
	const wrap = parent.createDiv({ cls: "sbd-money-ring" + (used > 1 ? " is-over" : used > 0.85 ? " is-near" : "") });
	const s = svg(wrap, "svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": `${big} ${small}` });
	svg(s, "circle", { cx: size / 2, cy: size / 2, r, class: "sbd-ring-track" });
	svg(s, "circle", { cx: size / 2, cy: size / 2, r, class: "sbd-ring-fill", "stroke-dasharray": `${Math.min(used, 1) * c} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` });
	if (pace > 0 && pace < 1) {
		const a = pace * 2 * Math.PI - Math.PI / 2;
		svg(s, "line", { x1: size / 2 + Math.cos(a) * (r - 11), y1: size / 2 + Math.sin(a) * (r - 11), x2: size / 2 + Math.cos(a) * (r + 11), y2: size / 2 + Math.sin(a) * (r + 11), class: "sbd-ring-pace" });
	}
	svgText(s, size / 2, size / 2 + 4, big, "sbd-ring-big", "middle");
	svgText(s, size / 2, size / 2 + 24, small, "sbd-ring-small", "middle");
}

// ---- quick add: reads like a sentence ----
function quickAdd(parent: HTMLElement, ctx: DashboardContext, month: string): void {
	const p = ctx.plugin;
	const form = parent.createEl("form", { cls: "sbd-money-add", attr: { "aria-label": "Add a transaction" } });
	let type: TxType = "expense";

	const seg = form.createDiv({ cls: "sbd-money-type", attr: { role: "radiogroup", "aria-label": "Type" } });
	const typeBtn = (t: TxType, label: string) => {
		const b = seg.createEl("button", { cls: t === type ? "is-active" : "", text: label, attr: { type: "button", role: "radio", "aria-checked": String(t === type) } });
		b.onclick = () => { type = t; seg.querySelectorAll("button").forEach((x) => { x.toggleClass("is-active", x === b); x.setAttr("aria-checked", String(x === b)); }); fillCats(); };
	};
	typeBtn("expense", "Spent"); typeBtn("income", "Received");

	const amtWrap = form.createEl("label", { cls: "sbd-money-amt" });
	amtWrap.createSpan({ cls: "sbd-money-cur", text: "₱" });
	const amount = amtWrap.createEl("input", { attr: { type: "text", inputmode: "decimal", placeholder: "0", "aria-label": "Amount, or type e.g. 250 food lunch", autocomplete: "off" } });
	form.createSpan({ cls: "sbd-money-word", text: "on" });
	const catSel = form.createEl("select", { cls: "dropdown sbd-money-catsel", attr: { "aria-label": "Category" } });
	const fillCats = () => {
		const keep = catSel.value;
		catSel.empty();
		for (const c of p.settings.money.categories.filter((x) => x.kind === type)) catSel.createEl("option", { value: c.name, text: c.name });
		if (Array.from(catSel.options).some((o) => o.value === keep)) catSel.value = keep;
	};
	fillCats();
	const note = form.createEl("input", { cls: "sbd-money-note", attr: { type: "text", placeholder: "What for? (optional)", "aria-label": "Note" } });
	const thisMonth = ctx.today.slice(0, 7) === month;
	const date = form.createEl("input", { cls: "sbd-money-date", attr: { type: "date", "aria-label": "Date", value: thisMonth ? ctx.today : `${month}-01` } });
	const submit = form.createEl("button", { cls: "mod-cta", text: "Add", attr: { type: "submit" } });
	const err = parent.createDiv({ cls: "sbd-money-err", attr: { role: "status", "aria-live": "polite" } });

	amount.addEventListener("blur", () => {
		if (!/[a-z]/i.test(amount.value)) return;
		const q = parseQuick(amount.value, p.settings.money.categories);
		if (!q) return;
		amount.value = String(q.amount);
		if (q.type !== type) seg.querySelectorAll<HTMLButtonElement>("button")[q.type === "expense" ? 0 : 1].click();
		catSel.value = q.category;
		if (q.note && !note.value) note.value = q.note;
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		err.setText("");
		const q = /[a-z]/i.test(amount.value) ? parseQuick(amount.value, p.settings.money.categories) : null;
		const value = q ? q.amount : Number(amount.value.replace(/[₱,\s]/g, ""));
		if (!(value > 0)) { err.setText("Enter an amount greater than zero, e.g. 250."); amount.focus(); return; }
		const tx = { date: date.value || ctx.today, type: q?.type ?? type, amount: value, category: q?.category ?? catSel.value ?? "Other", note: (q?.note && !note.value ? q.note : note.value).trim() };
		submit.disabled = true;
		try {
			await p.ledger.add(tx);
			undoNotice(`${tx.type === "income" ? "Received" : "Spent"} ${money(p, tx.amount)} · ${tx.category}.`, async () => {
				const rows = await p.ledger.month(tx.date.slice(0, 7));
				const hit = [...rows].reverse().find((r) => r.date === tx.date && r.amount === tx.amount && r.category === tx.category && r.note === tx.note);
				if (hit) { await p.ledger.remove(hit); ctx.rerender(); }
			});
			ctx.rerender();
		} catch (ex) {
			submit.disabled = false;
			err.setText(`Couldn't save: ${(ex as Error).message}`);
		}
	});
}

// ---- chart scaffolding ----
function chartCard(parent: HTMLElement, title: string, subtitle: string, cls = ""): HTMLElement {
	const card = parent.createDiv({ cls: `sbd-money-panel sbd-money-chart ${cls}` });
	const head = card.createDiv({ cls: "sbd-money-chart-head" });
	head.createEl("h3", { cls: "sbd-money-h", text: title });
	head.createDiv({ cls: "sbd-money-chart-sub", text: subtitle });
	return card;
}
const widthOf = (el: HTMLElement, fallback = 480) => Math.max(Math.round(el.clientWidth - 2 * 22 || fallback), 260);

// ---- the curve: cumulative spending vs. budget pace ----
function curve(wrap: HTMLElement, ctx: DashboardContext, s: MonthSummary, month: string): void {
	const p = ctx.plugin;
	const n = daysInMonth(month);
	const head = wrap.createDiv({ cls: "sbd-money-chart-head" });
	head.createEl("h3", { cls: "sbd-money-h", text: "The month so far" });
	head.createDiv({ cls: "sbd-money-chart-sub", text: "Running total of spending against an even pace to your budget" });
	const W = widthOf(wrap, 760), H = 240, L = 8, R = Math.min(160, W * 0.24), T = 18, B = 26;
	const proj = s.elapsed > 0 && s.elapsed < n ? s.perDay * n : s.spent;
	const top = Math.max(s.budget, s.spent, proj, 1) * 1.08;
	const x = (d: number) => L + (d / n) * (W - L - R);
	const y = (v: number) => T + (1 - v / top) * (H - T - B);
	const summaryText = `${monthTitle(month)}: ${money(p, s.spent)} spent${s.budget ? ` of a ${money(p, s.budget)} budget` : ""}${s.elapsed && s.elapsed < n ? `, on track for ${money(p, Math.round(proj))}` : ""}.`;
	const root = svg(wrap, "svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": summaryText, class: "sbd-money-svg" });
	svg(root, "line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "sbd-mc-axis" });
	for (const d of [1, 8, 15, 22, n]) svgText(root, x(d - 0.5), H - 8, String(d), "sbd-mc-tick", "middle");
	const used: number[] = [];
	const label = (yy: number, text: string, cls: string) => {
		for (const u of used) if (Math.abs(u - yy) < 16) yy = u + (yy <= u ? -16 : 16);
		used.push(yy);
		svgText(root, W - R + 10, yy + 4, text, `sbd-mc-label ${cls}`);
	};
	if (s.budget) {
		svg(root, "line", { x1: L, x2: W - R, y1: y(s.budget), y2: y(s.budget), class: "sbd-mc-budget" });
		svg(root, "line", { x1: x(0), y1: y(0), x2: x(n), y2: y(s.budget), class: "sbd-mc-pace" });
		label(y(s.budget), `Budget ${money(p, s.budget)}`, "is-budget");
	}
	const upto = s.elapsed || 0;
	if (upto > 0) {
		const pts = [`${x(0)},${y(0)}`];
		for (let d = 1; d <= upto; d++) pts.push(`${x(d)},${y(s.cumSpent[d - 1])}`);
		const line = pts.join(" ");
		svg(root, "polygon", { points: `${line} ${x(upto)},${y(0)}`, class: "sbd-mc-area" });
		svg(root, "polyline", { points: line, class: "sbd-mc-line" + (s.budget && s.spent > s.budget * (upto / n) ? " is-ahead" : "") });
		if (upto < n && s.perDay > 0) {
			svg(root, "line", { x1: x(upto), y1: y(s.spent), x2: x(n), y2: y(proj), class: "sbd-mc-proj" });
			label(y(proj), `On track for ${money(p, Math.round(proj))}`, "is-proj");
		}
		svg(root, "circle", { cx: x(upto), cy: y(s.spent), r: 4, class: "sbd-mc-dot" });
		svgText(root, x(upto), y(s.spent) - 10, money(p, s.spent), "sbd-mc-now", upto > n * 0.8 ? "end" : "middle");
		for (let d = 1; d <= upto; d++) {
			const r = svg(root, "rect", { x: x(d - 1), y: T, width: (W - L - R) / n, height: H - T - B, class: "sbd-mc-hit" });
			tip(r, `${monthTitle(month).split(" ")[0]} ${d}: ${money(p, s.cumSpent[d - 1])} so far`);
		}
	} else {
		svgText(root, (W - R) / 2, H / 2, month > ctx.today.slice(0, 7) ? "This month hasn't started yet" : "No spending logged this month", "sbd-mc-empty", "middle");
	}
}

// ---- insights: four analytical charts ----
function insights(parent: HTMLElement, ctx: DashboardContext, txs: Tx[], s: MonthSummary, month: string): void {
	const grid = parent.createDiv({ cls: "sbd-money-insights" });
	donut(chartCard(grid, "Share by category", "Where each peso went this month"), ctx, s);
	dailyBars(chartCard(grid, "Day by day", "Spending each day, split by category"), ctx, txs, s, month);
	monthsChart(chartCard(grid, "Last six months", "Money in, money out, and what was left"), ctx, month);
	weekdays(chartCard(grid, "By weekday", "Average spending on each day of the week"), ctx, txs, s, month);
}

function donut(card: HTMLElement, ctx: DashboardContext, s: MonthSummary): void {
	const p = ctx.plugin;
	const rows = s.categories.filter((c) => c.spent > 0);
	if (!rows.length) { card.createDiv({ cls: "sbd-empty", text: "Log an expense to see the split." }); return; }
	const body = card.createDiv({ cls: "sbd-money-donut" });
	const size = 180, r = 66, sw = 26, C = 2 * Math.PI * r;
	const root = svg(body, "svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": `Spending by category: ${rows.map((c) => `${c.name} ${Math.round((c.spent / s.spent) * 100)}%`).join(", ")}` });
	let off = 0;
	for (const c of rows) {
		const len = (c.spent / s.spent) * C;
		const seg = svg(root, "circle", { cx: size / 2, cy: size / 2, r, class: `sbd-donut-seg sbd-c-${colorOf(p, c.name)}`, "stroke-width": sw, "stroke-dasharray": `${Math.max(len - 2, 0.5)} ${C}`, "stroke-dashoffset": -off, transform: `rotate(-90 ${size / 2} ${size / 2})` });
		tip(seg, `${c.name}: ${money(p, c.spent)} (${Math.round((c.spent / s.spent) * 100)}%)`);
		off += len;
	}
	svgText(root, size / 2, size / 2 - 2, short(s.spent), "sbd-donut-big", "middle");
	svgText(root, size / 2, size / 2 + 18, "spent", "sbd-donut-small", "middle");
	const legend = body.createDiv({ cls: "sbd-money-legend" });
	for (const c of rows.slice(0, 8)) {
		const l = legend.createDiv({ cls: "sbd-money-legend-row" });
		l.createSpan({ cls: `sbd-money-swatch sbd-c-${colorOf(p, c.name)}` });
		l.createSpan({ cls: "sbd-money-legend-name", text: c.name });
		l.createSpan({ cls: "sbd-money-legend-pct", text: `${Math.round((c.spent / s.spent) * 100)}%` });
	}
}

function dailyBars(card: HTMLElement, ctx: DashboardContext, txs: Tx[], s: MonthSummary, month: string): void {
	const p = ctx.plugin;
	const days = dailyByCategory(txs, month);
	const n = days.length;
	const totals = days.map((d) => Object.values(d).reduce((a, b) => a + b, 0));
	const max = Math.max(...totals, 1);
	const W = widthOf(card), H = 190, L = 4, R = 4, T = 22, B = 22;
	const bw = (W - L - R) / n;
	const y = (v: number) => T + (1 - v / max) * (H - T - B);
	const root = svg(card, "svg", { viewBox: `0 0 ${W} ${H}`, class: "sbd-money-svg", role: "img", "aria-label": `Daily spending; highest ${money(p, max)}` });
	svg(root, "line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "sbd-mc-axis" });
	const order = s.categories.map((c) => c.name);
	days.forEach((d, i) => {
		let base = 0;
		const cats = Object.keys(d).sort((a, b) => order.indexOf(a) - order.indexOf(b));
		for (const name of cats) {
			const v = d[name];
			const rect = svg(root, "rect", { x: L + i * bw + bw * 0.14, y: y(base + v), width: Math.max(bw * 0.72, 1), height: Math.max(y(base) - y(base + v), 0.5), rx: 2, class: `sbd-bar-seg sbd-c-${colorOf(p, name)}` });
			tip(rect, `${monthTitle(month).split(" ")[0]} ${i + 1} · ${name}: ${money(p, v)}`);
			base += v;
		}
	});
	if (s.elapsed) {
		const avg = s.spent / s.elapsed;
		svg(root, "line", { x1: L, x2: W - R, y1: y(avg), y2: y(avg), class: "sbd-mc-pace" });
		svgText(root, W - R, y(avg) - 6, `avg ${short(avg)}`, "sbd-mc-label", "end");
	}
	const peak = totals.indexOf(max);
	if (totals[peak] > 0) svgText(root, L + peak * bw + bw / 2, y(max) - 6, short(max), "sbd-mc-label is-proj", "middle");
	for (const d of [1, 8, 15, 22, n]) svgText(root, L + (d - 0.5) * bw, H - 6, String(d), "sbd-mc-tick", "middle");
}

function monthsChart(card: HTMLElement, ctx: DashboardContext, month: string): void {
	const p = ctx.plugin;
	const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
	const box = card.createDiv();
	whenLoaded(box, Promise.all(months.map((m) => p.ledger.month(m))), (all) => {
		const data = months.map((m, i) => {
			const inc = all[i].filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
			const out = all[i].filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);
			return { m, inc, out };
		});
		const max = Math.max(...data.flatMap((d) => [d.inc, d.out]), 1);
		const W = widthOf(card), H = 200, L = 4, R = 4, T = 26, B = 30;
		const gw = (W - L - R) / data.length;
		const y = (v: number) => T + (1 - v / max) * (H - T - B);
		const root = svg(box, "svg", { viewBox: `0 0 ${W} ${H}`, class: "sbd-money-svg", role: "img", "aria-label": data.map((d) => `${monthTitle(d.m)}: in ${money(p, d.inc)}, out ${money(p, d.out)}`).join("; ") });
		svg(root, "line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "sbd-mc-axis" });
		data.forEach((d, i) => {
			const x0 = L + i * gw, bw = gw * 0.3;
			const inR = svg(root, "rect", { x: x0 + gw * 0.18, y: y(d.inc), width: bw, height: y(0) - y(d.inc), rx: 3, class: "sbd-bar-in" });
			tip(inR, `${monthTitle(d.m)} · in ${money(p, d.inc)}`);
			const outR = svg(root, "rect", { x: x0 + gw * 0.18 + bw + 3, y: y(d.out), width: bw, height: y(0) - y(d.out), rx: 3, class: "sbd-bar-out" + (d.m === month ? " is-current" : "") });
			tip(outR, `${monthTitle(d.m)} · out ${money(p, d.out)}`);
			const net = d.inc - d.out;
			if (d.inc || d.out) svgText(root, x0 + gw / 2, Math.min(y(d.inc), y(d.out)) - 7, short(net), `sbd-mc-label ${net >= 0 ? "is-pos-fill" : "is-neg-fill"}`, "middle");
			svgText(root, x0 + gw / 2, H - 10, monthTitle(d.m).slice(0, 3), "sbd-mc-tick" + (d.m === month ? " is-current" : ""), "middle");
		});
		const legend = card.createDiv({ cls: "sbd-money-legend is-inline" });
		const item = (cls: string, text: string) => { const l = legend.createDiv({ cls: "sbd-money-legend-row" }); l.createSpan({ cls: `sbd-money-swatch ${cls}` }); l.createSpan({ text }); };
		item("is-in", "Money in"); item("is-out", "Money out"); item("is-net", "Number on top = what was left");
	});
}

function weekdays(card: HTMLElement, ctx: DashboardContext, txs: Tx[], s: MonthSummary, month: string): void {
	const p = ctx.plugin;
	const avgs = weekdayAverages(txs, month, s.elapsed);
	const max = Math.max(...avgs, 1);
	const top = avgs.indexOf(Math.max(...avgs));
	const list = card.createDiv({ cls: "sbd-money-weekdays", attr: { role: "list" } });
	for (const d of WEEKDAY_ORDER) {
		const row = list.createDiv({ cls: "sbd-money-wd" + (d === top && avgs[d] > 0 ? " is-top" : ""), attr: { role: "listitem" } });
		row.createSpan({ cls: "sbd-money-wd-name", text: WEEKDAY[d] });
		const track = row.createDiv({ cls: "sbd-money-wd-track" });
		track.createDiv({ cls: "sbd-money-wd-fill", attr: { style: `width: ${(avgs[d] / max) * 100}%` } });
		row.createSpan({ cls: "sbd-money-wd-val", text: avgs[d] ? money(p, Math.round(avgs[d])) : "—" });
	}
	if (avgs[top] > 0) card.createDiv({ cls: "sbd-money-chart-foot", text: `${WEEKDAY[top]}s cost the most — about ${money(p, Math.round(avgs[top]))} on average.` });
}

// ---- categories + biggest expenses ----
function categoriesBlock(parent: HTMLElement, ctx: DashboardContext, s: MonthSummary, txs: Tx[], month: string, st: MoneyState, update: (p: Partial<MoneyState>) => void): void {
	const p = ctx.plugin;
	parent.createEl("h3", { cls: "sbd-money-h", text: "Where it went" });
	if (!s.categories.length) parent.createDiv({ cls: "sbd-empty", text: "Spending by category shows up here once you log an expense." });
	const max = Math.max(...s.categories.map((c) => Math.max(c.spent, c.budget)), 1);
	const list = parent.createDiv({ cls: "sbd-money-cats" });
	for (const c of s.categories) {
		const color = colorOf(p, c.name);
		const row = list.createEl("button", { cls: "sbd-money-catrow" + (st.category === c.name ? " is-active" : ""), attr: { type: "button", "aria-pressed": String(st.category === c.name), title: "Show only this category · right-click for more" } });
		row.onclick = () => update({ category: st.category === c.name ? undefined : c.name, filter: "all" });
		row.oncontextmenu = (e) => {
			e.preventDefault();
			const m = new Menu();
			m.addItem((i) => i.setTitle(st.category === c.name ? "Show all categories" : `Show only ${c.name}`).setIcon("filter").onClick(() => update({ category: st.category === c.name ? undefined : c.name, filter: "all" })));
			const def = cat(p, c.name);
			if (def) m.addItem((i) => i.setTitle("Edit category…").setIcon("palette").onClick(() => new CategoryModal(ctx.app, p, def, () => ctx.rerender()).open()));
			m.addItem((i) => i.setTitle(`Log ${c.name} expense…`).setIcon("plus").onClick(() => new TxModal(ctx.app, p, { date: ctx.today, type: "expense", category: c.name }, () => ctx.rerender()).open()));
			m.showAtMouseEvent(e);
		};
		const top = row.createDiv({ cls: "sbd-money-catrow-top" });
		catIcon(top, p, c.name);
		top.createSpan({ cls: "sbd-money-catname", text: c.name });
		top.createSpan({ cls: "sbd-money-catamt", text: money(p, c.spent) });
		const track = row.createDiv({ cls: "sbd-money-cattrack" });
		const over = c.budget > 0 && c.spent > c.budget;
		track.createDiv({ cls: `sbd-money-catfill sbd-c-${color}` + (over ? " is-over" : ""), attr: { style: `width: ${(c.spent / max) * 100}%` } });
		if (c.budget > 0) track.createDiv({ cls: "sbd-money-catbudget", attr: { style: `left: ${(c.budget / max) * 100}%` } });
		const meta = row.createDiv({ cls: "sbd-money-catmeta" });
		meta.setText(c.budget > 0 ? (over ? `${money(p, c.spent - c.budget)} over the ${money(p, c.budget)} budget` : `${money(p, c.budget - c.spent)} left of ${money(p, c.budget)}`)
			: `${c.count} ${c.count === 1 ? "expense" : "expenses"}${s.spent ? ` · ${Math.round((c.spent / s.spent) * 100)}% of spending` : ""}`);
		if (over) meta.addClass("is-over");
	}
	const big = topExpenses(txs, month, 5);
	if (big.length) {
		parent.createEl("h3", { cls: "sbd-money-h", text: "Biggest expenses" });
		const ol = parent.createEl("ol", { cls: "sbd-money-top" });
		for (const t of big) {
			const li = ol.createEl("li");
			li.oncontextmenu = (e) => txMenu(e, ctx, t);
			catIcon(li, p, t.category);
			const txt = li.createDiv({ cls: "sbd-money-tx-text" });
			txt.createDiv({ cls: "sbd-money-tx-title", text: t.note || t.category });
			txt.createDiv({ cls: "sbd-money-tx-sub", text: `${t.category} · ${Number(t.date.slice(8))} ${monthTitle(month).slice(0, 3)}` });
			li.createSpan({ cls: "sbd-money-tx-amt", text: money(p, t.amount) });
		}
	}
	if (s.incomeCategories.length) {
		parent.createEl("h3", { cls: "sbd-money-h", text: "Where it came from" });
		const inc = parent.createDiv({ cls: "sbd-money-income" });
		for (const c of s.incomeCategories) {
			const r = inc.createDiv({ cls: "sbd-money-incrow" });
			catIcon(r, p, c.name);
			r.createSpan({ cls: "sbd-money-catname", text: c.name });
			r.createSpan({ cls: "sbd-money-catamt is-pos", text: money(p, c.spent, true) });
		}
	}
}

// ---- ledger: grouped by day, actions on every row ----
function ledgerBlock(parent: HTMLElement, ctx: DashboardContext, txs: Tx[], st: MoneyState, update: (p: Partial<MoneyState>) => void): void {
	const p = ctx.plugin;
	const head = parent.createDiv({ cls: "sbd-money-ledger-head" });
	head.createEl("h3", { cls: "sbd-money-h", text: "Ledger" });
	const seg = head.createDiv({ cls: "sbd-segmented sbd-money-filter", attr: { role: "group", "aria-label": "Show" } });
	for (const [id, label] of [["all", "All"], ["expense", "Spent"], ["income", "Received"]] as const) {
		const b = seg.createEl("button", { text: label, cls: st.filter === id ? "is-active" : "", attr: { "aria-pressed": String(st.filter === id) } });
		b.onclick = () => update({ filter: id });
	}
	const search = head.createEl("input", { cls: "sbd-money-search", attr: { type: "search", placeholder: "Search", "aria-label": "Search the ledger" } });
	search.value = st.query;
	search.dataset.sbdFocus = "money-search";
	search.oninput = () => update({ query: search.value });
	if (st.category) {
		const chip = parent.createEl("button", { cls: "sbd-money-chip", attr: { "aria-label": `Clear ${st.category} filter` } });
		chip.createSpan({ text: st.category });
		setIcon(chip.createSpan({ cls: "sbd-icon" }), "x");
		chip.onclick = () => update({ category: undefined });
	}
	parent.createDiv({ cls: "sbd-money-hint", text: "Click a row to edit · right-click for more" });

	const q = st.query.trim().toLowerCase();
	const rows = txs.filter((t) => (st.filter === "all" || t.type === st.filter) && (!st.category || t.category === st.category)
		&& (!q || `${t.note} ${t.category} ${t.amount}`.toLowerCase().includes(q)))
		.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
	if (!rows.length) {
		parent.createDiv({ cls: "sbd-empty", text: txs.length ? "Nothing matches these filters." : "No transactions this month. Add one above — for example 250 food lunch." });
		return;
	}
	const list = parent.createDiv({ cls: "sbd-money-ledger" });
	let day = "";
	let group: HTMLElement | null = null;
	for (const t of rows) {
		if (t.date !== day) {
			day = t.date;
			const d = new Date(`${t.date}T00:00:00`);
			const g = list.createDiv({ cls: "sbd-money-day" });
			const dh = g.createDiv({ cls: "sbd-money-dayhead" });
			dh.createSpan({ cls: "sbd-money-daynum", text: String(d.getDate()) });
			dh.createSpan({ cls: "sbd-money-dayname", text: t.date === ctx.today ? "Today" : WEEKDAY[d.getDay()] });
			const dayTotal = rows.filter((r) => r.date === t.date).reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
			dh.createSpan({ cls: "sbd-money-daytotal " + (dayTotal >= 0 ? "is-pos" : ""), text: money(p, dayTotal, true) });
			const date = t.date;
			dh.oncontextmenu = (e) => {
				e.preventDefault();
				const m = new Menu();
				m.addItem((i) => i.setTitle("Log expense on this day…").setIcon("minus-circle").onClick(() => new TxModal(ctx.app, p, { date, type: "expense" }, () => ctx.rerender()).open()));
				m.addItem((i) => i.setTitle("Log income on this day…").setIcon("plus-circle").onClick(() => new TxModal(ctx.app, p, { date, type: "income" }, () => ctx.rerender()).open()));
				m.showAtMouseEvent(e);
			};
			group = g.createDiv({ cls: "sbd-money-dayrows" });
		}
		const r = group!.createDiv({ cls: "sbd-money-tx" });
		r.oncontextmenu = (e) => txMenu(e, ctx, t);
		const main = r.createEl("button", { cls: "sbd-money-tx-main", attr: { type: "button", "aria-label": `${t.type === "income" ? "Received" : "Spent"} ${money(p, t.amount)} on ${t.category}${t.note ? `, ${t.note}` : ""}. Edit` } });
		catIcon(main, p, t.category);
		const txt = main.createDiv({ cls: "sbd-money-tx-text" });
		txt.createDiv({ cls: "sbd-money-tx-title", text: t.note || t.category });
		if (t.note) txt.createDiv({ cls: "sbd-money-tx-sub", text: t.category });
		main.createSpan({ cls: "sbd-money-tx-amt" + (t.type === "income" ? " is-pos" : ""), text: money(p, t.type === "income" ? t.amount : -t.amount, true) });
		main.onclick = () => new TxModal(ctx.app, p, { tx: t }, () => ctx.rerender()).open();
		const del = r.createEl("button", { cls: "sbd-money-tx-del", attr: { type: "button", "aria-label": `Delete ${money(p, t.amount)} ${t.note || t.category}`, title: "Delete (you can undo)" } });
		setIcon(del, "trash-2");
		del.onclick = () => void deleteTx(p, t, () => ctx.rerender());
	}
}

// ---------------------------------------------------------------- add / edit transaction

export class TxModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private opts: { tx?: Tx; date?: string; type?: TxType; category?: string }, private done: () => void) {
		super(app);
	}

	onOpen(): void {
		const p = this.plugin;
		const t = this.opts.tx;
		this.setTitle(t ? "Edit transaction" : this.opts.type === "income" ? "Log income" : "Log expense");
		this.modalEl.addClass("sbd-money-modal");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(p.settings.appearance));
		const s = { type: t?.type ?? this.opts.type ?? "expense", category: t?.category ?? this.opts.category ?? "", date: t?.date ?? this.opts.date ?? new Date().toISOString().slice(0, 10) };
		const form = this.contentEl.createEl("form", { cls: "sbd-money-form" });
		const row = (label: string) => { const r = form.createEl("label", { cls: "sbd-money-frow" }); r.createSpan({ cls: "sbd-money-flabel", text: label }); return r; };

		const seg = row("Type").createDiv({ cls: "sbd-segmented" });
		const catSel = createEl("select", { cls: "dropdown" });
		const fill = () => {
			catSel.empty();
			for (const c of p.settings.money.categories.filter((x) => x.kind === s.type)) catSel.createEl("option", { value: c.name, text: c.name });
			if (s.category && Array.from(catSel.options).some((o) => o.value === s.category)) catSel.value = s.category; else s.category = catSel.value;
		};
		for (const [id, label] of [["expense", "Spent"], ["income", "Received"]] as const) {
			const b = seg.createEl("button", { text: label, cls: s.type === id ? "is-active" : "", attr: { type: "button" } });
			b.onclick = () => { s.type = id; seg.querySelectorAll("button").forEach((x) => x.toggleClass("is-active", x === b)); fill(); };
		}
		const amtBox = row("Amount").createDiv({ cls: "sbd-money-prefixed" });
		amtBox.createSpan({ text: "₱" });
		const amt = amtBox.createEl("input", { attr: { type: "text", inputmode: "decimal", placeholder: "0" } });
		amt.value = t ? String(t.amount) : "";
		row("Category").appendChild(catSel);
		fill();
		catSel.onchange = () => { s.category = catSel.value; };
		const note = row("Note").createEl("input", { attr: { type: "text", placeholder: "Optional" } });
		note.value = t?.note ?? "";
		const date = row("Date").createEl("input", { attr: { type: "date" } });
		date.value = s.date;
		const err = form.createDiv({ cls: "sbd-money-err", attr: { role: "status", "aria-live": "polite" } });

		const foot = form.createDiv({ cls: "sbd-money-ffoot" });
		if (t) {
			const del = foot.createEl("button", { cls: "sbd-ghost-btn sbd-money-del", attr: { type: "button" } });
			setIcon(del.createSpan({ cls: "sbd-icon" }), "trash-2");
			del.createSpan({ text: "Delete" });
			del.onclick = async () => { this.close(); await deleteTx(p, t, this.done); };
		}
		foot.createEl("button", { text: "Cancel", attr: { type: "button" } }).onclick = () => this.close();
		foot.createEl("button", { cls: "mod-cta", text: t ? "Save changes" : "Add", attr: { type: "submit" } });

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const value = Number(amt.value.replace(/[₱,\s]/g, ""));
			if (!(value > 0)) { err.setText("Enter an amount greater than zero."); amt.focus(); return; }
			const next = { type: s.type, amount: value, category: catSel.value || "Other", note: note.value.trim(), date: date.value || s.date };
			try {
				if (t) await p.ledger.update(t, next); else await p.ledger.add(next);
				this.close();
				this.done();
				new Notice(t ? "Saved." : `${next.type === "income" ? "Received" : "Spent"} ${money(p, next.amount)} · ${next.category}.`);
			} catch (ex) { err.setText(`Couldn't save: ${(ex as Error).message}`); }
		});
		window.setTimeout(() => amt.focus(), 0);
	}

	onClose(): void { this.contentEl.empty(); }
}

// ---------------------------------------------------------------- one category: name, colour, icon, budget

export class CategoryModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private c: MoneyCategory, private done: () => void, private isNew = false) {
		super(app);
	}

	onOpen(): void {
		const c = this.c;
		this.setTitle(this.isNew ? (c.kind === "expense" ? "New category" : "New income source") : `Edit ${c.name}`);
		this.modalEl.addClass("sbd-money-modal", "sbd-money-catmodal");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(this.plugin.settings.appearance));
		const el = this.contentEl;
		const draft = { ...c };

		const preview = el.createDiv({ cls: "sbd-money-catpreview" });
		const drawPreview = () => {
			preview.empty();
			const ic = preview.createSpan({ cls: `sbd-money-cat-icon is-large sbd-c-${draft.color}` });
			setIcon(ic, draft.icon);
			preview.createSpan({ cls: "sbd-money-catpreview-name", text: draft.name || "Untitled" });
		};

		const nameRow = el.createEl("label", { cls: "sbd-money-frow" });
		nameRow.createSpan({ cls: "sbd-money-flabel", text: "Name" });
		const name = nameRow.createEl("input", { attr: { type: "text" } });
		name.value = draft.name;
		name.oninput = () => { draft.name = name.value; drawPreview(); };
		if (draft.kind === "expense") {
			const bRow = el.createEl("label", { cls: "sbd-money-frow" });
			bRow.createSpan({ cls: "sbd-money-flabel", text: "Monthly budget" });
			const box = bRow.createDiv({ cls: "sbd-money-prefixed" });
			box.createSpan({ text: "₱" });
			const b = box.createEl("input", { attr: { type: "text", inputmode: "decimal", placeholder: "No budget" } });
			b.value = draft.budget ? String(draft.budget) : "";
			b.oninput = () => { draft.budget = Math.max(0, Number(b.value.replace(/[₱,\s]/g, "")) || 0); };
		}

		el.createDiv({ cls: "sbd-money-flabel sbd-money-pickerlabel", text: "Colour" });
		const colors = el.createDiv({ cls: "sbd-money-swatches", attr: { role: "radiogroup", "aria-label": "Colour" } });
		el.createDiv({ cls: "sbd-money-flabel sbd-money-pickerlabel", text: "Icon" });
		const icons = el.createDiv({ cls: `sbd-money-icons sbd-c-${draft.color}`, attr: { role: "radiogroup", "aria-label": "Icon" } });
		for (const col of MONEY_COLORS) {
			const sw = colors.createEl("button", { cls: `sbd-money-swatchbtn sbd-c-${col}` + (draft.color === col ? " is-active" : ""), attr: { type: "button", role: "radio", "aria-checked": String(draft.color === col), "aria-label": col, title: col } });
			sw.onclick = () => {
				draft.color = col;
				colors.querySelectorAll("button").forEach((x) => { x.toggleClass("is-active", x === sw); x.setAttr("aria-checked", String(x === sw)); });
				icons.className = `sbd-money-icons sbd-c-${col}`;
				drawPreview();
			};
		}
		for (const ic of ICONS) {
			const b = icons.createEl("button", { cls: "sbd-money-iconbtn" + (draft.icon === ic ? " is-active" : ""), attr: { type: "button", role: "radio", "aria-checked": String(draft.icon === ic), "aria-label": ic, title: ic } });
			setIcon(b, ic);
			b.onclick = () => { draft.icon = ic; icons.querySelectorAll("button").forEach((x) => { x.toggleClass("is-active", x === b); x.setAttr("aria-checked", String(x === b)); }); drawPreview(); };
		}
		drawPreview();
		el.prepend(preview);

		const foot = el.createDiv({ cls: "sbd-money-ffoot" });
		foot.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		foot.createEl("button", { cls: "mod-cta", text: this.isNew ? "Add" : "Save" }).onclick = async () => {
			if (!draft.name.trim()) { name.focus(); return; }
			Object.assign(c, { ...draft, name: draft.name.trim() });
			const list = this.plugin.settings.money.categories;
			if (this.isNew && !list.includes(c)) list.push(c);
			await this.plugin.persist();
			this.close();
			this.done();
		};
		window.setTimeout(() => name.focus(), 0);
	}

	onClose(): void { this.contentEl.empty(); }
}

// ---------------------------------------------------------------- budget & categories

export class MoneySettingsModal extends Modal {
	private tab: TxType = "expense";

	constructor(app: App, private plugin: SecondBrainPlugin, private done: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Budget & categories");
		this.modalEl.addClass("sbd-money-modal", "sbd-money-settings");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(this.plugin.settings.appearance));
		this.render();
	}

	private render(): void {
		const p = this.plugin;
		const m = p.settings.money;
		const el = this.contentEl;
		el.empty();

		// Budgets — the numbers that matter most — sit on top: daily, weekly, monthly.
		const budget = el.createDiv({ cls: "sbd-money-budgetbox" });
		budget.createDiv({ cls: "sbd-money-flabel sbd-money-budgettitle", text: "Spending budgets" });
		const fields = budget.createDiv({ cls: "sbd-money-budgetgrid" });
		const field = (label: string, key: "dailyBudget" | "weeklyBudget" | "monthlyBudget", hint: () => string) => {
			const f = fields.createEl("label", { cls: "sbd-money-budgetfield" });
			f.createSpan({ cls: "sbd-money-flabel", text: label });
			const box = f.createDiv({ cls: "sbd-money-prefixed is-large" });
			box.createSpan({ text: "₱" });
			const input = box.createEl("input", { attr: { type: "text", inputmode: "decimal", placeholder: hint(), "aria-label": `${label} budget` } });
			input.value = m[key] ? m[key].toLocaleString("en-PH") : "";
			input.onchange = async () => { m[key] = Math.max(0, Number(input.value.replace(/[₱,\s]/g, "")) || 0); await p.persist(); this.render(); };
		};
		const fmt = (n: number) => (n > 0 ? Math.round(n).toLocaleString("en-PH") : "None");
		field("Daily", "dailyBudget", () => fmt(m.weeklyBudget ? m.weeklyBudget / 7 : m.monthlyBudget ? m.monthlyBudget / 30 : 0));
		field("Weekly", "weeklyBudget", () => fmt(m.dailyBudget ? m.dailyBudget * 7 : m.monthlyBudget ? (m.monthlyBudget * 7) / 30 : 0));
		field("Monthly", "monthlyBudget", () => fmt(m.categories.filter((c) => c.kind === "expense").reduce((s, c) => s + (c.budget || 0), 0)));
		const catTotal = m.categories.filter((c) => c.kind === "expense").reduce((s, c) => s + (c.budget || 0), 0);
		budget.createDiv({ cls: "sbd-money-help", text: `Grey numbers are suggestions from your other budgets. Each one you set gets its own meter at the top of the Money page.${catTotal ? ` Category budgets add up to ${money(p, catTotal)} a month (used when Monthly is empty).` : ""}` });

		const tabs = el.createDiv({ cls: "sbd-segmented sbd-money-tabs", attr: { role: "tablist" } });
		for (const [id, label] of [["expense", "Spending categories"], ["income", "Income sources"]] as const) {
			const t = tabs.createEl("button", { text: label, cls: this.tab === id ? "is-active" : "", attr: { role: "tab", "aria-selected": String(this.tab === id) } });
			t.onclick = () => { this.tab = id; this.render(); };
		}

		const list = el.createDiv({ cls: "sbd-money-catlist", attr: { role: "list" } });
		for (const c of m.categories.filter((x) => x.kind === this.tab)) {
			const r = list.createDiv({ cls: "sbd-money-catline", attr: { role: "listitem" } });
			const sw = r.createEl("button", { cls: `sbd-money-cat-icon sbd-c-${c.color}`, attr: { type: "button", "aria-label": `Colour and icon for ${c.name}`, title: "Change colour and icon" } });
			setIcon(sw, c.icon);
			sw.onclick = () => new CategoryModal(this.app, p, c, () => this.render()).open();
			const name = r.createEl("input", { cls: "sbd-money-catline-name", attr: { type: "text", "aria-label": "Name" } });
			name.value = c.name;
			name.onchange = async () => { const v = name.value.trim(); if (v) { c.name = v; await p.persist(); } else name.value = c.name; };
			if (this.tab === "expense") {
				const bb = r.createDiv({ cls: "sbd-money-prefixed is-compact" });
				bb.createSpan({ text: "₱" });
				const bud = bb.createEl("input", { attr: { type: "text", inputmode: "decimal", placeholder: "No budget", "aria-label": `Monthly budget for ${c.name}` } });
				bud.value = c.budget ? c.budget.toLocaleString("en-PH") : "";
				bud.onchange = async () => { c.budget = Math.max(0, Number(bud.value.replace(/[₱,\s]/g, "")) || 0); await p.persist(); this.render(); };
			}
			const del = r.createEl("button", { cls: "sbd-icon-btn clickable-icon sbd-money-catline-del", attr: { type: "button", "aria-label": `Remove ${c.name}` } });
			setIcon(del, "trash-2");
			del.onclick = async () => {
				const i = m.categories.indexOf(c);
				m.categories.splice(i, 1);
				await p.persist();
				this.render();
				undoNotice(`Removed ${c.name}.`, async () => { m.categories.splice(i, 0, c); await p.persist(); this.render(); });
			};
		}
		const add = el.createEl("button", { cls: "sbd-money-addcat", attr: { type: "button" } });
		setIcon(add.createSpan({ cls: "sbd-icon" }), "plus");
		add.createSpan({ text: this.tab === "expense" ? "Add a category" : "Add an income source" });
		add.onclick = () => {
			const used = new Set(m.categories.map((c) => c.color));
			const fresh: MoneyCategory = { name: "", icon: this.tab === "expense" ? "tag" : "coins", color: MONEY_COLORS.find((c) => !used.has(c)) ?? "gray", kind: this.tab, budget: 0 };
			new CategoryModal(this.app, p, fresh, () => this.render(), true).open();
		};

		const foot = el.createDiv({ cls: "sbd-money-ffoot is-split" });
		foot.createDiv({ cls: "sbd-money-help", text: `Stored in ${m.folder}/ as one table per month. Renaming a category doesn't change past entries.` });
		foot.createEl("button", { cls: "mod-cta", text: "Done" }).onclick = () => this.close();
	}

	onClose(): void { this.contentEl.empty(); this.done(); }
}
