import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newEntry, WrongPasswordError } from "../src/secrets/crypto";
import { ensureGitignored, isInside, SecretsStore, type SecretsSettings } from "../src/secrets/store";

// The store uses window timers (Obsidian renderer); Node has the same functions globally.
(globalThis as unknown as { window: typeof globalThis }).window ??= globalThis;

let n = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log("ok -", name); };

async function run(): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbd-secrets-"));
	const file = path.join(dir, "nested", "vault.enc");
	const settings: SecretsSettings = { path: file, autoLockMinutes: 0, clipboardSeconds: 0 };
	const store = new SecretsStore(() => settings, () => null);

	try {
		await t("create writes only ciphertext, then unlock reads it back", async () => {
			await store.create("correct horse battery staple");
			assert.ok(store.exists() && store.unlocked);
			const e = { ...newEntry("token"), name: "GitHub PAT" };
			e.fields[0].value = "ghp_VERYSECRET";
			await store.upsert(e);
			const raw = fs.readFileSync(file, "utf8");
			assert.ok(!raw.includes("ghp_VERYSECRET") && !raw.includes("GitHub PAT"));
			store.lock();
			assert.equal(store.unlocked, false);
			assert.equal(store.entries.length, 0);
			await store.unlock("correct horse battery staple");
			assert.equal(store.entries[0].fields[0].value, "ghp_VERYSECRET");
		});

		await t("wrong password keeps it locked", async () => {
			store.lock();
			await assert.rejects(() => store.unlock("nope"), WrongPasswordError);
			assert.equal(store.unlocked, false);
		});

		await t("saves are atomic and keep a .bak", async () => {
			await store.unlock("correct horse battery staple");
			await store.remove(store.entries[0].id);
			assert.ok(fs.existsSync(`${file}.bak`));
			assert.ok(!fs.existsSync(`${file}.tmp`));
			assert.equal(store.entries.length, 0);
		});

		await t("change password re-encrypts", async () => {
			await store.changePassword("correct horse battery staple", "new long passphrase 2026");
			store.lock();
			await assert.rejects(() => store.unlock("correct horse battery staple"), WrongPasswordError);
			await store.unlock("new long passphrase 2026");
		});

		await t("create refuses to overwrite an existing vault", async () => {
			store.lock();
			await assert.rejects(() => store.create("x"), /already exists/);
		});

		await t("gitignore entry is added inside a git repo", () => {
			const repo = path.join(dir, "repo");
			fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
			const f = path.join(repo, "secrets", "vault.enc");
			assert.equal(ensureGitignored(f), true);
			assert.match(fs.readFileSync(path.join(repo, ".gitignore"), "utf8"), /^\/secrets\/vault\.enc$/m);
			assert.equal(ensureGitignored(f), false); // already listed
			assert.ok(isInside(f, repo));
			assert.ok(!isInside(file, repo));
		});
	} finally {
		store.destroy();
		fs.rmSync(dir, { recursive: true, force: true });
	}
	console.log(`\n${n} passed`);
}

run().catch((e) => { console.error(e); process.exit(1); });
