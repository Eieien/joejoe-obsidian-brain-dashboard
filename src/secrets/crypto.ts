// Encryption for the secrets vault. Web Crypto only (works in Obsidian and in Node tests):
//   key  = PBKDF2-SHA256(master password, random 16-byte salt, 600k iterations) → AES-256-GCM
//   file = JSON envelope { v, kdf, iv, ct } — only ciphertext is ever written.
// Pure module: no Obsidian imports, never logs secret material.

export const KDF_ITERATIONS = 600_000;

export interface Envelope {
	v: 1;
	kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
	cipher: "AES-256-GCM";
	iv: string;
	ct: string;
}

export type EntryType = "api-key" | "token" | "login" | "note";

export interface SecretField {
	label: string;
	value: string;
	/** Masked until revealed or copied. */
	secret: boolean;
}

export interface SecretEntry {
	id: string;
	name: string;
	type: EntryType;
	url: string;
	tags: string[];
	fields: SecretField[];
	notes: string;
	updated: string;
}

export interface VaultData {
	version: 1;
	entries: SecretEntry[];
}

/** Bytes backed by a plain ArrayBuffer (what Web Crypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
	return btoa(s);
}

function unb64(s: string): Bytes {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function randomBytes(n: number): Bytes {
	const out = new Uint8Array(n);
	globalThis.crypto.getRandomValues(out);
	return out;
}

/** Derive a non-extractable AES-GCM key from the master password. */
export async function deriveKey(password: string, salt: Bytes, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
	const base = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
	return subtle().deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** Encrypt vault data with an already-derived key (fresh 12-byte nonce every time). */
export async function seal(data: VaultData, key: CryptoKey, salt: Bytes, iterations = KDF_ITERATIONS): Promise<Envelope> {
	const iv = randomBytes(12);
	const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
	return { v: 1, kdf: { name: "PBKDF2-SHA256", iterations, salt: b64(salt) }, cipher: "AES-256-GCM", iv: b64(iv), ct: b64(ct) };
}

export class WrongPasswordError extends Error {
	constructor() { super("Wrong master password, or the secrets file is damaged."); }
}

/** Decrypt an envelope with a password. Throws WrongPasswordError if authentication fails. */
export async function open(envelope: Envelope, password: string): Promise<{ data: VaultData; key: CryptoKey; salt: Bytes; iterations: number }> {
	if (envelope?.v !== 1 || envelope.cipher !== "AES-256-GCM") throw new Error("Unsupported secrets file format.");
	const salt = unb64(envelope.kdf.salt);
	const iterations = envelope.kdf.iterations;
	const key = await deriveKey(password, salt, iterations);
	let plain: ArrayBuffer;
	try {
		plain = await subtle().decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ct));
	} catch {
		throw new WrongPasswordError();
	}
	const data = JSON.parse(dec.decode(plain)) as VaultData;
	if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error("Unsupported secrets data.");
	return { data, key, salt, iterations };
}

/** Rough password strength: 0 (weak) … 4 (strong), with a short hint. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; hint: string } {
	if (!pw) return { score: 0, hint: "Enter a master password" };
	let pool = 0;
	if (/[a-z]/.test(pw)) pool += 26;
	if (/[A-Z]/.test(pw)) pool += 26;
	if (/[0-9]/.test(pw)) pool += 10;
	if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
	const unique = new Set(pw).size;
	const bits = Math.log2(Math.max(pool, 2)) * Math.min(pw.length, unique * 2);
	const score = (bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 100 ? 3 : 4) as 0 | 1 | 2 | 3 | 4;
	const hints = ["Too easy to guess", "Weak — make it longer", "Okay — longer is better", "Strong", "Very strong"];
	return { score, hint: pw.length < 12 && score < 3 ? "Use at least 12 characters — a few random words works well" : hints[score] };
}

export function newEntry(type: EntryType = "api-key"): SecretEntry {
	const fields: Record<EntryType, SecretField[]> = {
		"api-key": [{ label: "Key", value: "", secret: true }],
		token: [{ label: "Token", value: "", secret: true }, { label: "Expires", value: "", secret: false }],
		login: [{ label: "Username", value: "", secret: false }, { label: "Password", value: "", secret: true }],
		note: [{ label: "Secret note", value: "", secret: true }],
	};
	return { id: b64(randomBytes(9)).replace(/[+/=]/g, ""), name: "", type, url: "", tags: [], fields: fields[type], notes: "", updated: new Date().toISOString() };
}

/** The field copied by Enter: the first secret field, else the first field. */
export function primaryField(e: SecretEntry): SecretField | undefined {
	return e.fields.find((f) => f.secret && f.value) ?? e.fields.find((f) => f.value);
}

export function matches(e: SecretEntry, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	// Search names, tags, URLs and non-secret field values only — never secret values.
	return [e.name, e.url, e.type, ...e.tags, ...e.fields.filter((f) => !f.secret).map((f) => `${f.label} ${f.value}`)]
		.some((s) => s.toLowerCase().includes(q));
}
