// Print the preview's console output and errors: node preview/console.mjs "<hash>"
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const browser = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((p) => fs.existsSync(p));
const page = `${pathToFileURL(path.resolve("preview/out/index.html")).href}#${process.argv[2] ?? "home"}`;
const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--enable-logging=stderr", "--v=0", "--virtual-time-budget=3000", "--dump-dom", page], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lines = (r.stderr || "").split(/\r?\n/).filter((l) => /CONSOLE|Uncaught|SyntaxError|TypeError|ReferenceError/i.test(l));
console.log(lines.length ? lines.join("\n") : "(no console errors)");
const leaf = /<div id="leaf">([\s\S]{0,200})/.exec(r.stdout || "");
console.log("leaf:", leaf ? leaf[1].slice(0, 120) : "not found");
