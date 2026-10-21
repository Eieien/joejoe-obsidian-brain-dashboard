// Secrets vault session: reads/writes the encrypted file (desktop only, via Node fs),
// holds the decrypted entries in memory while unlocked, and forgets them on lock.
// Nothing here is written to data.json, logged, or indexed.

import { Platform } from "obsidian";
import { deriveKey, KDF_ITERATIONS, open, randomBytes, seal, type Bytes, type Envelope, type SecretEntry, type VaultData } from "./crypto";

/* eslint-disable @typescript-eslint/no-var-requires */
type Fs = typeof import("fs");
type PathMod = typeof import("path");
const node = (): { fs: Fs; path: PathMod; os: typeof import("os") } => ({
	fs: require("fs") as Fs,
	path: require("path") as PathMod,
	os: require("os") as typeof import("os"),
});

export interface SecretsSettings {
	/** Encrypted file location; empty = the default outside the vault. */
	path: string;
	autoLockMinutes: number;
	clipboardSeconds: number;
}

export const DEFAULT_SECRETS: SecretsSettings = { path: "", autoLockMinutes: 5, clipboardSeconds: 30 };

export function secretsSupported(): boolean {
	return Platform.isDesktopApp;
}

export function defaultSecretsPath(): string {
	const { path, os } = node();
	const base = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"));
	return path.join(base, "joejoe-secrets", "vault.enc");
}

/** The git repository root containing `file`, if any. */
export function gitRootOf(file: string): string | null {
	const { fs, path } = node();
	let dir = path.dirname(path.resolve(file));
	for (;;) {
		if (fs.existsSync(path.join(dir, ".git"))) return dir;
		const up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

export function isInside(file: string, folder: string | null): boolean {
	if (!folder) return false;
	const { path } = node();
	const rel = path.relative(path.resolve(folder), path.resolve(file));
	return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Add the file to its repo's .gitignore (no-op if already listed). Returns true if added. */
export function ensureGitignored(file: string): boolean {
	const root = gitRootOf(file);
	if (!root) return false;
	const { fs, path } = node();
	const rel = "/" + path.relative(root, path.resolve(file)).split(path.sep).join("/");
	const gi = path.join(root, ".gitignore");
	const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
	const lines = cur.split(/\r?\n/).map((l) => l.trim());
	if (lines.includes(rel) || lines.includes(rel.slice(1)) || lines.includes("*.enc")) return false;
	fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}# joejoe's second brain — encrypted secrets\n${rel}\n`);
	return true;
}

export class SecretsStore {
	private key: CryptoKey | null = null;
	private salt: Bytes | null = null;
	private iterations = KDF_ITERATIONS;
	private data: VaultData | null = null;
	private lockTimer: number | null = null;
	private clipTimer: number | null = null;
	private listeners = new Set<() => void>();

	constructor(private settings: () => SecretsSettings, private vaultBase: () => string | null) {}

	get file(): string {
		return this.settings().path.trim() || defaultSecretsPath();
	}

	get unlocked(): boolean {
		return !!this.key && !!this.data;
	}

	get entries(): SecretEntry[] {
		return this.data?.entries ?? [];
	}

	exists(): boolean {
		return node().fs.existsSync(this.file);
	}

	/** Warnings about where the file lives (inside the vault / inside a git repo). */
	locationWarnings(): string[] {
		const out: string[] = [];
		const f = this.file;
		if (isInside(f, this.vaultBase())) out.push("The secrets file is inside your vault. It stays encrypted, but it will sync wherever your vault syncs.");
		const repo = gitRootOf(f);
		if (repo) out.push(`The secrets file is inside a git repository (${repo}). It is added to that repo's .gitignore, but double-check it is never committed.`);
		return out;
	}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}

	async create(password: string): Promise<void> {
		if (this.exists()) throw new Error("A secrets file already exists at this location.");
		this.salt = randomBytes(16);
		this.iterations = KDF_ITERATIONS;
		this.key = await deriveKey(password, this.salt, this.iterations);
		this.data = { version: 1, entries: [] };
		await this.write();
		ensureGitignored(this.file);
		this.touch();
		this.emit();
	}

	async unlock(password: string): Promise<void> {
		const raw = node().fs.readFileSync(this.file, "utf8");
		const env = JSON.parse(raw) as Envelope;
		const res = await open(env, password);
		this.key = res.key;
		this.salt = res.salt;
		this.iterations = res.iterations;
		this.data = res.data;
		this.touch();
		this.emit();
	}

	lock(): void {
		const was = this.unlocked;
		this.key = null;
		this.salt = null;
		this.data = null;
		if (this.lockTimer !== null) window.clearTimeout(this.lockTimer);
		this.lockTimer = null;
		if (was) this.emit();
	}

	/** Reset the idle auto-lock timer. Call on any user activity in the secrets UI. */
	touch(): void {
		if (this.lockTimer !== null) window.clearTimeout(this.lockTimer);
		const mins = this.settings().autoLockMinutes;
		if (mins > 0 && this.unlocked) this.lockTimer = window.setTimeout(() => this.lock(), mins * 60_000);
	}

	async upsert(entry: SecretEntry): Promise<void> {
		if (!this.data) throw new Error("Locked");
		entry.updated = new Date().toISOString();
		const i = this.data.entries.findIndex((e) => e.id === entry.id);
		if (i >= 0) this.data.entries[i] = entry;
		else this.data.entries.push(entry);
		await this.write();
		this.touch();
		this.emit();
	}

	async remove(id: string): Promise<void> {
		if (!this.data) throw new Error("Locked");
		this.data.entries = this.data.entries.filter((e) => e.id !== id);
		await this.write();
		this.touch();
		this.emit();
	}

	/** Re-encrypt everything under a new password (new salt). Requires the current one. */
	async changePassword(current: string, next: string): Promise<void> {
		if (!this.data) throw new Error("Locked");
		const env = JSON.parse(node().fs.readFileSync(this.file, "utf8")) as Envelope;
		await open(env, current); // throws WrongPasswordError
		this.salt = randomBytes(16);
		this.iterations = KDF_ITERATIONS;
		this.key = await deriveKey(next, this.salt, this.iterations);
		await this.write();
		this.touch();
	}

	/** Copy to the clipboard, then clear it after N seconds if it still holds the value. */
	async copy(value: string): Promise<number> {
		await navigator.clipboard.writeText(value);
		this.touch();
		const secs = this.settings().clipboardSeconds;
		if (this.clipTimer !== null) window.clearTimeout(this.clipTimer);
		if (secs > 0) {
			this.clipTimer = window.setTimeout(async () => {
				this.clipTimer = null;
				try {
					if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText("");
				} catch {
					await navigator.clipboard.writeText("").catch(() => undefined);
				}
			}, secs * 1000);
		}
		return secs;
	}

	/** Atomic write: encrypt → temp file → rename over the old one (previous kept as .bak). */
	private async write(): Promise<void> {
		if (!this.key || !this.salt || !this.data) throw new Error("Locked");
		const { fs, path } = node();
		const env = await seal(this.data, this.key, this.salt, this.iterations);
		const file = this.file;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 });
		if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
		fs.renameSync(tmp, file);
	}

	destroy(): void {
		this.lock();
		this.listeners.clear();
	}
}
