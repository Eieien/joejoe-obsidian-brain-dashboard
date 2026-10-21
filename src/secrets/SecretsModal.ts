import { App, Menu, Modal, Notice, setIcon } from "obsidian";
import type SecondBrainPlugin from "../main";
import { styleClasses } from "../settings";
import { matches, newEntry, passwordStrength, primaryField, WrongPasswordError, type EntryType, type SecretEntry } from "./crypto";
import { secretsSupported } from "./store";

const TYPES: { id: EntryType; label: string; icon: string }[] = [
	{ id: "api-key", label: "API key", icon: "key-round" },
	{ id: "token", label: "Token / PAT", icon: "ticket" },
	{ id: "login", label: "Login", icon: "user-round" },
	{ id: "note", label: "Secure note", icon: "sticky-note" },
];
const typeInfo = (t: EntryType) => TYPES.find((x) => x.id === t) ?? TYPES[0];

/**
 * The secrets vault: a lock screen (or first-time setup), then a two-pane manager —
 * searchable list on the left, the selected entry on the right. Values stay masked
 * until revealed; copy clears the clipboard after a delay.
 */
export class SecretsModal extends Modal {
	private query = "";
	private selected: string | null = null;
	private draft: SecretEntry | null = null;
	private dirty = false;
	private revealed = new Set<number>();
	private off: (() => void) | null = null;
	private activity = () => this.plugin.secrets.touch();

	constructor(app: App, private plugin: SecondBrainPlugin) {
		super(app);
	}

	private get store() {
		return this.plugin.secrets;
	}

	onOpen(): void {
		this.modalEl.addClass("sbd-secrets");
		this.contentEl.addClass("sbd-modal-root", ...styleClasses(this.plugin.settings.appearance));
		const dark = this.plugin.settings.appearance.darkSurface;
		if (dark && dark !== "default") this.modalEl.addClass(`sbd-dark-${dark}`);
		this.modalEl.addEventListener("pointerdown", this.activity);
		this.modalEl.addEventListener("keydown", this.activity);
		// If the vault auto-locks while open, fall back to the lock screen.
		this.off = this.store.onChange(() => {
			if (!this.store.unlocked) { this.draft = null; this.selected = null; this.revealed.clear(); }
			this.render();
		});
		this.render();
	}

	onClose(): void {
		this.off?.();
		this.modalEl.removeEventListener("pointerdown", this.activity);
		this.modalEl.removeEventListener("keydown", this.activity);
		this.draft = null;
		this.contentEl.empty();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		if (!secretsSupported()) return this.renderMessage(root, "lock", "Desktop only", "The secrets vault needs file access, which is only available in the Obsidian desktop app.");
		if (!this.store.exists()) return this.renderCreate(root);
		if (!this.store.unlocked) return this.renderUnlock(root);
		this.renderManager(root);
	}

	private renderMessage(root: HTMLElement, icon: string, title: string, text: string): void {
		const box = root.createDiv({ cls: "sbd-sec-gate" });
		setIcon(box.createDiv({ cls: "sbd-sec-gate-icon" }), icon);
		box.createEl("h3", { text: title });
		box.createEl("p", { cls: "sbd-sec-muted", text });
	}

	private warnings(parent: HTMLElement): void {
		for (const w of this.store.locationWarnings()) {
			const el = parent.createDiv({ cls: "sbd-sec-warn" });
			setIcon(el.createSpan(), "alert-triangle");
			el.createSpan({ text: w });
		}
	}

	/* ---------- first-time setup ---------- */

	private renderCreate(root: HTMLElement): void {
		const box = root.createDiv({ cls: "sbd-sec-gate" });
		setIcon(box.createDiv({ cls: "sbd-sec-gate-icon" }), "shield-plus");
		box.createEl("h3", { text: "Create your secrets vault" });
		box.createEl("p", { cls: "sbd-sec-muted", text: "API keys, tokens and passwords, encrypted with AES-256 under one master password. There is no recovery — if you forget it, the vault cannot be opened." });
		const where = box.createDiv({ cls: "sbd-sec-path" });
		where.createSpan({ text: "Saved to " });
		where.createEl("code", { text: this.store.file });
		this.warnings(box);

		const pw = box.createEl("input", { cls: "sbd-sec-input", attr: { type: "password", placeholder: "Master password", autocomplete: "new-password", "aria-label": "Master password" } });
		const meter = box.createDiv({ cls: "sbd-sec-meter" });
		const bar = meter.createDiv({ cls: "sbd-sec-meter-bar" });
		const hint = box.createDiv({ cls: "sbd-sec-hint", text: passwordStrength("").hint });
		const pw2 = box.createEl("input", { cls: "sbd-sec-input", attr: { type: "password", placeholder: "Repeat master password", autocomplete: "new-password", "aria-label": "Repeat master password" } });
		const err = box.createDiv({ cls: "sbd-sec-error" });
		const btn = box.createEl("button", { cls: "mod-cta", text: "Create vault" });

		pw.addEventListener("input", () => {
			const s = passwordStrength(pw.value);
			bar.style.width = `${(s.score + 1) * 20}%`;
			meter.dataset.score = String(s.score);
			hint.setText(s.hint);
		});
		const submit = async () => {
			err.setText("");
			if (passwordStrength(pw.value).score < 2) return err.setText("Choose a stronger password — at least 12 characters, or a few random words.");
			if (pw.value !== pw2.value) return err.setText("The passwords don't match.");
			btn.disabled = true;
			btn.setText("Encrypting…");
			try {
				await this.store.create(pw.value);
				new Notice("Secrets vault created");
			} catch (e) {
				err.setText((e as Error).message);
				btn.disabled = false;
				btn.setText("Create vault");
			}
		};
		pw2.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
		btn.addEventListener("click", () => void submit());
		window.setTimeout(() => pw.focus(), 0);
	}

	/* ---------- lock screen ---------- */

	private renderUnlock(root: HTMLElement): void {
		const box = root.createDiv({ cls: "sbd-sec-gate" });
		setIcon(box.createDiv({ cls: "sbd-sec-gate-icon" }), "lock");
		box.createEl("h3", { text: "Secrets vault is locked" });
		const where = box.createDiv({ cls: "sbd-sec-path" });
		where.createEl("code", { text: this.store.file });
		this.warnings(box);
		const pw = box.createEl("input", { cls: "sbd-sec-input", attr: { type: "password", placeholder: "Master password", autocomplete: "current-password", "aria-label": "Master password" } });
		const err = box.createDiv({ cls: "sbd-sec-error" });
		const btn = box.createEl("button", { cls: "mod-cta", text: "Unlock" });
		const submit = async () => {
			if (!pw.value) return;
			err.setText("");
			btn.disabled = true;
			btn.setText("Unlocking…");
			try {
				await this.store.unlock(pw.value);
			} catch (e) {
				err.setText(e instanceof WrongPasswordError ? e.message : `Couldn't open the secrets file: ${(e as Error).message}`);
				btn.disabled = false;
				btn.setText("Unlock");
				pw.select();
			}
		};
		pw.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
		btn.addEventListener("click", () => void submit());
		window.setTimeout(() => pw.focus(), 0);
	}

	/* ---------- manager ---------- */

	private renderManager(root: HTMLElement): void {
		const head = root.createDiv({ cls: "sbd-sec-head" });
		const title = head.createDiv({ cls: "sbd-sec-title" });
		setIcon(title.createSpan(), "shield-check");
		title.createSpan({ text: "Secrets" });
		const mins = this.plugin.settings.secrets.autoLockMinutes;
		head.createDiv({ cls: "sbd-sec-muted sbd-sec-sub", text: mins > 0 ? `Locks after ${mins} min idle` : "Auto-lock off" });
		const more = head.createEl("button", { cls: "sbd-icon-btn sbd-sec-iconbtn", attr: { "aria-label": "More" } });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (e) => {
			const m = new Menu();
			m.addItem((i) => i.setTitle("Change master password").setIcon("key-round").onClick(() => new ChangePasswordModal(this.app, this.plugin).open()));
			m.addItem((i) => i.setTitle("Copy file location").setIcon("folder").onClick(() => void navigator.clipboard.writeText(this.store.file)));
			m.showAtMouseEvent(e);
		});
		const lock = head.createEl("button", { cls: "sbd-ghost-btn sbd-sec-lock", attr: { "aria-label": "Lock now" } });
		setIcon(lock.createSpan(), "lock");
		lock.createSpan({ text: "Lock" });
		lock.addEventListener("click", () => this.store.lock());

		this.warnings(root);
		const body = root.createDiv({ cls: "sbd-sec-body" });
		const list = body.createDiv({ cls: "sbd-sec-list" });
		const detail = body.createDiv({ cls: "sbd-sec-detail" });
		this.renderList(list, detail);
		this.renderDetail(detail, list);
	}

	private visible(): SecretEntry[] {
		return this.store.entries.filter((e) => matches(e, this.query)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
	}

	private renderList(list: HTMLElement, detail: HTMLElement): void {
		list.empty();
		const top = list.createDiv({ cls: "sbd-sec-search" });
		setIcon(top.createSpan({ cls: "sbd-sec-search-icon" }), "search");
		const search = top.createEl("input", { attr: { type: "search", placeholder: "Search  (↵ copies)", "aria-label": "Search secrets" } });
		search.value = this.query;
		const add = top.createEl("button", { cls: "sbd-icon-btn sbd-sec-iconbtn", attr: { "aria-label": "New secret" } });
		setIcon(add, "plus");
		add.addEventListener("click", (e) => {
			const m = new Menu();
			for (const t of TYPES) m.addItem((i) => i.setTitle(t.label).setIcon(t.icon).onClick(() => this.select(newEntry(t.id), list, detail, true)));
			m.showAtMouseEvent(e);
		});

		const items = list.createDiv({ cls: "sbd-sec-items" });
		const fill = () => {
			items.empty();
			const vis = this.visible();
			if (!vis.length) items.createDiv({ cls: "sbd-sec-empty", text: this.store.entries.length ? "No matches" : "No secrets yet — add one with +" });
			for (const e of vis) {
				const row = items.createDiv({ cls: "sbd-sec-item" + (e.id === this.selected ? " is-active" : "") });
				setIcon(row.createSpan({ cls: "sbd-sec-item-icon" }), typeInfo(e.type).icon);
				const txt = row.createDiv({ cls: "sbd-sec-item-text" });
				txt.createDiv({ cls: "sbd-sec-item-name", text: e.name || "Untitled" });
				const sub = e.fields.find((f) => !f.secret && f.value)?.value || e.url.replace(/^https?:\/\//, "") || typeInfo(e.type).label;
				txt.createDiv({ cls: "sbd-sec-item-sub", text: sub });
				const copy = row.createEl("button", { cls: "sbd-icon-btn sbd-sec-iconbtn", attr: { "aria-label": "Copy" } });
				setIcon(copy, "copy");
				copy.addEventListener("click", (ev) => { ev.stopPropagation(); void this.copyPrimary(e); });
				row.addEventListener("click", () => this.select(structuredClone(e), list, detail));
			}
		};
		fill();
		search.addEventListener("input", () => { this.query = search.value; fill(); });
		search.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				const first = this.visible()[0];
				if (first) void this.copyPrimary(first);
			}
		});
		if (!this.draft) window.setTimeout(() => search.focus(), 0);
	}

	private select(entry: SecretEntry, list: HTMLElement, detail: HTMLElement, isNew = false): void {
		if (this.dirty && !window.confirm("Discard unsaved changes?")) return;
		this.draft = entry;
		this.selected = isNew ? null : entry.id;
		this.dirty = isNew;
		this.revealed.clear();
		this.renderList(list, detail);
		this.renderDetail(detail, list);
	}

	private async copyPrimary(e: SecretEntry): Promise<void> {
		const f = primaryField(e);
		if (!f) return void new Notice("Nothing to copy");
		const secs = await this.store.copy(f.value);
		new Notice(`Copied ${e.name || "secret"} · ${f.label}${secs ? ` — clears in ${secs}s` : ""}`);
	}

	private renderDetail(detail: HTMLElement, list: HTMLElement): void {
		detail.empty();
		const d = this.draft;
		if (!d) {
			const empty = detail.createDiv({ cls: "sbd-sec-placeholder" });
			setIcon(empty.createDiv(), "key-square");
			empty.createDiv({ text: "Select a secret, or add one with +" });
			return;
		}
		const mark = () => { this.dirty = true; save.disabled = false; };

		const name = detail.createEl("input", { cls: "sbd-sec-name", attr: { placeholder: "Name — e.g. OpenAI, GitHub PAT", "aria-label": "Name" } });
		name.value = d.name;
		name.addEventListener("input", () => { d.name = name.value; mark(); });
		if (!d.name) window.setTimeout(() => name.focus(), 0);

		const grid = detail.createDiv({ cls: "sbd-sec-grid" });
		const row = (label: string) => {
			grid.createDiv({ cls: "sbd-sec-label", text: label });
			return grid.createDiv({ cls: "sbd-sec-cell" });
		};

		const typeSel = row("Type").createEl("select", { cls: "dropdown" });
		for (const t of TYPES) typeSel.createEl("option", { value: t.id, text: t.label });
		typeSel.value = d.type;
		typeSel.addEventListener("change", () => { d.type = typeSel.value as EntryType; mark(); });

		const url = row("Website").createEl("input", { attr: { type: "text", placeholder: "https://…" } });
		url.value = d.url;
		url.addEventListener("input", () => { d.url = url.value; mark(); });

		const tags = row("Tags").createEl("input", { attr: { type: "text", placeholder: "work, ai" } });
		tags.value = d.tags.join(", ");
		tags.addEventListener("input", () => { d.tags = tags.value.split(",").map((t) => t.trim()).filter(Boolean); mark(); });

		d.fields.forEach((f, i) => {
			const labelEl = grid.createEl("input", { cls: "sbd-sec-label sbd-sec-label-edit", attr: { "aria-label": "Field name" } });
			labelEl.value = f.label;
			labelEl.addEventListener("input", () => { f.label = labelEl.value; mark(); });
			const cell = grid.createDiv({ cls: "sbd-sec-cell sbd-sec-field" });
			const shown = !f.secret || this.revealed.has(i);
			const input = cell.createEl("input", { cls: f.secret ? "sbd-sec-secret" : "", attr: { type: shown ? "text" : "password", autocomplete: "off", spellcheck: "false" } });
			input.value = f.value;
			input.addEventListener("input", () => { f.value = input.value; mark(); });
			const btn = (icon: string, label: string, fn: () => void) => {
				const b = cell.createEl("button", { cls: "sbd-icon-btn sbd-sec-iconbtn", attr: { "aria-label": label } });
				setIcon(b, icon);
				b.addEventListener("click", fn);
				return b;
			};
			if (f.secret) {
				const eye = btn(shown ? "eye-off" : "eye", shown ? "Hide" : "Reveal", () => {
					if (this.revealed.has(i)) this.revealed.delete(i); else this.revealed.add(i);
					const now = this.revealed.has(i);
					input.type = now ? "text" : "password";
					setIcon(eye, now ? "eye-off" : "eye");
					eye.setAttr("aria-label", now ? "Hide" : "Reveal");
				});
			}
			btn("copy", "Copy", async () => {
				if (!f.value) return;
				const secs = await this.store.copy(f.value);
				new Notice(`Copied ${f.label}${secs ? ` — clears in ${secs}s` : ""}`);
			});
			btn("more-vertical", "Field options", () => {
				const m = new Menu();
				m.addItem((it) => it.setTitle(f.secret ? "Show as plain text" : "Treat as secret").setIcon(f.secret ? "eye" : "eye-off").onClick(() => { f.secret = !f.secret; mark(); this.renderDetail(detail, list); }));
				m.addItem((it) => it.setTitle("Remove field").setIcon("trash-2").onClick(() => { d.fields.splice(i, 1); this.revealed.clear(); mark(); this.renderDetail(detail, list); }));
				m.showAtPosition({ x: cell.getBoundingClientRect().right - 40, y: cell.getBoundingClientRect().bottom });
			});
		});

		const addField = detail.createEl("button", { cls: "sbd-ghost-btn sbd-sec-addfield" });
		setIcon(addField.createSpan(), "plus");
		addField.createSpan({ text: "Add field" });
		addField.addEventListener("click", () => { d.fields.push({ label: "Field", value: "", secret: true }); mark(); this.renderDetail(detail, list); });

		const notes = detail.createEl("textarea", { cls: "sbd-sec-notes", attr: { placeholder: "Notes (encrypted too) — scopes, where it's used, how to rotate…", rows: "3" } });
		notes.value = d.notes;
		notes.addEventListener("input", () => { d.notes = notes.value; mark(); });

		const foot = detail.createDiv({ cls: "sbd-sec-foot" });
		const isNew = !this.store.entries.some((e) => e.id === d.id);
		if (!isNew) {
			foot.createDiv({ cls: "sbd-sec-muted", text: `Updated ${new Date(d.updated).toLocaleString()}` });
			const del = foot.createEl("button", { cls: "sbd-ghost-btn sbd-sec-delete", text: "Delete" });
			del.addEventListener("click", async () => {
				if (!window.confirm(`Delete "${d.name || "this secret"}"? This can't be undone.`)) return;
				await this.store.remove(d.id);
				this.draft = null; this.selected = null; this.dirty = false;
				this.render();
			});
		}
		const cancel = foot.createEl("button", { cls: "sbd-ghost-btn", text: isNew ? "Cancel" : "Revert" });
		cancel.addEventListener("click", () => {
			this.dirty = false;
			const orig = this.store.entries.find((e) => e.id === d.id);
			this.draft = orig ? structuredClone(orig) : null;
			this.selected = orig?.id ?? null;
			this.render();
		});
		const save = foot.createEl("button", { cls: "mod-cta", text: "Save" });
		save.disabled = !this.dirty;
		save.addEventListener("click", async () => {
			if (!d.name.trim()) { name.focus(); return void new Notice("Give it a name first"); }
			save.disabled = true;
			try {
				await this.store.upsert(structuredClone(d));
				this.dirty = false;
				this.selected = d.id;
				new Notice("Saved");
				this.render();
			} catch (e) {
				save.disabled = false;
				new Notice(`Couldn't save: ${(e as Error).message}`);
			}
		});
		detail.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save.click(); }
		});
	}
}

class ChangePasswordModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Change master password");
		this.modalEl.addClass("sbd-secrets-small");
		const root = this.contentEl.createDiv({ cls: "sbd-sec-gate sbd-sec-gate-tight" });
		const field = (ph: string, ac: string) => root.createEl("input", { cls: "sbd-sec-input", attr: { type: "password", placeholder: ph, autocomplete: ac } });
		const cur = field("Current password", "current-password");
		const next = field("New password", "new-password");
		const hint = root.createDiv({ cls: "sbd-sec-hint" });
		const next2 = field("Repeat new password", "new-password");
		const err = root.createDiv({ cls: "sbd-sec-error" });
		const btn = root.createEl("button", { cls: "mod-cta", text: "Change password" });
		next.addEventListener("input", () => hint.setText(passwordStrength(next.value).hint));
		btn.addEventListener("click", async () => {
			err.setText("");
			if (passwordStrength(next.value).score < 2) return err.setText("Choose a stronger password.");
			if (next.value !== next2.value) return err.setText("The new passwords don't match.");
			btn.disabled = true;
			try {
				await this.plugin.secrets.changePassword(cur.value, next.value);
				new Notice("Master password changed");
				this.close();
			} catch (e) {
				err.setText(e instanceof WrongPasswordError ? "Current password is wrong." : (e as Error).message);
				btn.disabled = false;
			}
		});
		window.setTimeout(() => cur.focus(), 0);
	}

	onClose(): void { this.contentEl.empty(); }
}
