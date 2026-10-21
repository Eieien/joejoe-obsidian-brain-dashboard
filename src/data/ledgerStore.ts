import { normalizePath, TFile, type App } from "obsidian";
import { ensureFolder } from "./daily";
import { addTx, editTx, newLedgerContent, parseLedger, type MoneyCategory, type Tx } from "./ledger";

export interface MoneySettings {
	/** Folder holding one ledger note per month (YYYY-MM.md). */
	folder: string;
	currency: string;
	/** Overall monthly spending budget (0 = use the sum of category budgets). */
	monthlyBudget: number;
	categories: MoneyCategory[];
}

/** Reads and writes the monthly ledger notes. Cached per month; edits in the vault invalidate. */
export class LedgerStore {
	private cache = new Map<string, Promise<Tx[]>>();

	constructor(private app: App, private settings: () => MoneySettings) {}

	path(month: string): string {
		return normalizePath(`${this.settings().folder || "Finance/Ledger"}/${month}.md`);
	}

	/** Forget cached months (call when a file in the ledger folder changes). */
	invalidate(path?: string): void {
		if (!path) { this.cache.clear(); return; }
		const folder = normalizePath(this.settings().folder || "Finance/Ledger");
		if (path.startsWith(folder + "/")) this.cache.delete(path.slice(folder.length + 1).replace(/\.md$/, ""));
	}

	month(month: string): Promise<Tx[]> {
		let p = this.cache.get(month);
		if (!p) {
			const f = this.app.vault.getAbstractFileByPath(this.path(month));
			p = f instanceof TFile ? this.app.vault.cachedRead(f).then(parseLedger) : Promise.resolve([]);
			this.cache.set(month, p);
		}
		return p;
	}

	private async file(month: string): Promise<TFile> {
		const path = this.path(month);
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return f;
		await ensureFolder(this.app, path);
		return this.app.vault.create(path, newLedgerContent(month));
	}

	async add(t: Omit<Tx, "line">): Promise<void> {
		const month = t.date.slice(0, 7);
		const f = await this.file(month);
		await this.app.vault.process(f, (c) => addTx(c, t));
		this.cache.delete(month);
	}

	async update(old: Tx, next: Omit<Tx, "line">): Promise<void> {
		const from = old.date.slice(0, 7), to = next.date.slice(0, 7);
		if (from === to) {
			await this.app.vault.process(await this.file(from), (c) => editTx(c, old, next));
		} else {
			await this.app.vault.process(await this.file(from), (c) => editTx(c, old, null));
			await this.app.vault.process(await this.file(to), (c) => addTx(c, next));
		}
		this.cache.delete(from); this.cache.delete(to);
	}

	async remove(t: Tx): Promise<void> {
		const month = t.date.slice(0, 7);
		await this.app.vault.process(await this.file(month), (c) => editTx(c, t, null));
		this.cache.delete(month);
	}
}
