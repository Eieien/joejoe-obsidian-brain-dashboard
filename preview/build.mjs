// Builds preview/out/index.html: the real dashboard rendered against demo-vault in a browser.
// Usage: npm run preview   (then open preview/out/index.html, e.g. #home, #tasks, #calendar, #trackers&tracker=habits)
import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const VAULT = "demo-vault";
const OUT = "preview/out";
const NOW = Date.now();

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function walk(dir, acc = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, acc);
		else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) {
			acc.push({ path: path.relative(VAULT, full).split(path.sep).join("/"), content: "", mtime: NOW, ctime: NOW });
		}
		else if (entry.name.endsWith(".md")) {
			const rel = path.relative(VAULT, full).split(path.sep).join("/");
			const content = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
			// Plausible timestamps: daily notes at noon of their day, other notes spread over ~2 months.
			const day = rel.match(/^Daily\/(\d{4}-\d{2}-\d{2})\.md$/);
			const mtime = day ? Date.parse(`${day[1]}T12:00:00`) + (day[1] === new Date(NOW).toISOString().slice(0, 10) ? 0 : 0)
				: NOW - (hash(rel) % (60 * 24)) * 60_000 * (rel.startsWith("Projects") || rel.startsWith("Meetings") ? 1 : 40);
			acc.push({ path: rel, content, mtime: Math.min(mtime, NOW), ctime: Math.min(mtime, NOW) - (hash(rel + "c") % 20) * 86_400_000 });
		}
	}
	return acc;
}

const vault = walk(VAULT);
const dataPath = path.join(VAULT, ".obsidian/plugins/second-brain-dashboard/data.json");
const data = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, "utf8") : "null";

fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({
	entryPoints: ["preview/main.ts"],
	bundle: true,
	format: "iife",
	target: "es2020",
	outfile: `${OUT}/preview.js`,
	alias: { obsidian: "./preview/obsidian-shim.ts" },
	define: { __VAULT__: JSON.stringify(vault) },
	logLevel: "warning",
});

const themeVars = `
body { margin: 0; height: 100vh; display: flex; }
body, .theme-dark { --font-interface: Inter, "Segoe UI", system-ui, sans-serif; --font-monospace: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  --font-ui-smaller: 12px; --font-ui-small: 13px; --font-ui-medium: 15px; --shadow-s: 0 1px 2px rgba(0,0,0,.28); }
.theme-dark { color-scheme: dark; --background-primary: #191919; --background-primary-alt: #202020; --background-secondary: #202020;
  --background-modifier-border: #2f2f2f; --background-modifier-border-hover: #3f3f3f; --background-modifier-hover: rgba(255,255,255,.06);
  --text-normal: #d4d4d4; --text-muted: #9b9b9b; --text-faint: #5f5f5f; --text-accent: #a88bfa; --interactive-accent: #7f6df2;
  --color-red: #fb464c; --color-red-rgb: 251,70,76; --color-orange: #e9973f; --color-orange-rgb: 233,151,63; --color-yellow: #e0de71;
  --color-green: #44cf6e; --color-blue: #4a9eff; background: #191919; color: #d4d4d4; }
.theme-light { color-scheme: light; --background-primary: #ffffff; --background-primary-alt: #f6f6f6; --background-secondary: #f6f6f6;
  --background-modifier-border: #e3e3e3; --background-modifier-border-hover: #d0d0d0; --background-modifier-hover: rgba(0,0,0,.05);
  --text-normal: #222222; --text-muted: #6f6f6f; --text-faint: #ababab; --text-accent: #7b5cf0; --interactive-accent: #7b5cf0;
  --color-red: #e93147; --color-red-rgb: 233,49,71; --color-orange: #ec7500; --color-orange-rgb: 236,117,0; --color-yellow: #c99b00;
  --color-green: #08b94e; --color-blue: #086ddd; background: #fff; color: #222; }
body { font-family: var(--font-interface); font-size: 15px; }
#leaf { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; }
.view-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
button { font: inherit; font-size: 13px; color: var(--text-normal); background: var(--background-modifier-hover); border: none; border-radius: 5px; padding: 5px 12px; cursor: pointer; box-shadow: var(--shadow-s); }
button.mod-cta { background: var(--interactive-accent); color: #fff; }
input[type=text], input[type=search], select { font: inherit; font-size: 13px; color: var(--text-normal); background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 5px; padding: 4px 8px; }
.clickable-icon { color: var(--text-muted); }
svg.svg-icon { stroke-width: 1.75; }
.modal-container { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-bg { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.modal { position: relative; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 20px; max-height: 90vh; overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.modal-close-button { position: absolute; top: 12px; right: 12px; width: 20px; height: 20px; opacity: .5; }
.modal-close-button::before { content: "✕"; }
.modal-title:empty { display: none; }
`;

fs.writeFileSync(`${OUT}/index.html`, `<!doctype html>
<html><head><meta charset="utf-8"><title>joejoe's second brain · preview</title>
<style>${themeVars}</style>
<style>${fs.readFileSync("styles.css", "utf8")}</style>
</head><body><div id="leaf"></div>
<script>window.__SBD_DATA__ = ${data};</script>
<script src="preview.js"></script>
</body></html>`);
console.log(`Preview built: ${OUT}/index.html (${vault.length} notes)`);
