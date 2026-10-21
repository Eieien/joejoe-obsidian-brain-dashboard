import assert from "node:assert/strict";
import { deriveKey, matches, newEntry, open, passwordStrength, primaryField, randomBytes, seal, WrongPasswordError, type VaultData } from "../src/secrets/crypto";

let n = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log("ok -", name); };
const FAST = 1000; // low iteration count keeps tests quick; real vaults use KDF_ITERATIONS

async function run(): Promise<void> {
	const entry = { ...newEntry("api-key"), name: "OpenAI", tags: ["ai"], url: "https://platform.openai.com" };
	entry.fields[0].value = "sk-live-SECRET-123";
	const data: VaultData = { version: 1, entries: [entry] };

	await t("seal → open round-trips", async () => {
		const salt = randomBytes(16);
		const key = await deriveKey("correct horse battery staple", salt, FAST);
		const env = await seal(data, key, salt, FAST);
		const back = await open(env, "correct horse battery staple");
		assert.deepEqual(back.data, data);
		assert.equal(back.iterations, FAST);
	});

	await t("ciphertext never contains the secret or the password", async () => {
		const salt = randomBytes(16);
		const env = await seal(data, await deriveKey("pw-12345678", salt, FAST), salt, FAST);
		const raw = JSON.stringify(env);
		assert.ok(!raw.includes("sk-live-SECRET-123"));
		assert.ok(!raw.includes("pw-12345678"));
		assert.ok(!raw.includes("OpenAI"));
	});

	await t("fresh nonce every save", async () => {
		const salt = randomBytes(16);
		const key = await deriveKey("pw", salt, FAST);
		const a = await seal(data, key, salt, FAST), b = await seal(data, key, salt, FAST);
		assert.notEqual(a.iv, b.iv);
		assert.notEqual(a.ct, b.ct);
	});

	await t("wrong password is rejected", async () => {
		const salt = randomBytes(16);
		const env = await seal(data, await deriveKey("right", salt, FAST), salt, FAST);
		await assert.rejects(() => open(env, "wrong"), WrongPasswordError);
	});

	await t("tampered ciphertext is rejected", async () => {
		const salt = randomBytes(16);
		const env = await seal(data, await deriveKey("right", salt, FAST), salt, FAST);
		const bytes = atob(env.ct).split("");
		bytes[5] = String.fromCharCode(bytes[5].charCodeAt(0) ^ 1);
		await assert.rejects(() => open({ ...env, ct: btoa(bytes.join("")) }, "right"), WrongPasswordError);
	});

	await t("search never matches secret values", () => {
		assert.ok(matches(entry, "openai"));
		assert.ok(matches(entry, "ai"));
		assert.ok(!matches(entry, "SECRET-123"));
	});

	await t("primary field is the first secret", () => {
		const login = newEntry("login");
		login.fields[0].value = "me@example.com";
		login.fields[1].value = "hunter2";
		assert.equal(primaryField(login)?.label, "Password");
	});

	await t("password strength", () => {
		assert.equal(passwordStrength("").score, 0);
		assert.ok(passwordStrength("abc").score <= 1);
		assert.ok(passwordStrength("correct horse battery staple 42!").score >= 3);
	});

	console.log(`\n${n} passed`);
}

run().catch((e) => { console.error(e); process.exit(1); });
