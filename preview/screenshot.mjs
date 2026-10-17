// Headless screenshots of the preview: node preview/screenshot.mjs <outDir> <name>=<hash>[@WxH] ...
// e.g. node preview/screenshot.mjs shots home=home tasks=tasks cal=calendar@1360x1100
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const candidates = [
	process.env.CHROME_PATH,
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
].filter(Boolean);
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) { console.error("No Chrome/Edge found; set CHROME_PATH."); process.exit(1); }

const [outDir, ...shots] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const page = pathToFileURL(path.resolve("preview/out/index.html")).href;

for (const spec of shots) {
	const eq = spec.indexOf("=");
	const name = spec.slice(0, eq), rest = spec.slice(eq + 1);
	const [hash, size = "1360x2400"] = rest.split("@");
	const out = path.resolve(outDir, `${name}.png`);
	execFileSync(browser, [
		"--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
		`--window-size=${size.replace("x", ",")}`, "--virtual-time-budget=3000",
		`--screenshot=${out}`, `${page}#${hash}`,
	], { stdio: "ignore" });
	console.log(`${name}: ${out}`);
}
