// Print the preview's DOM after scripts run: node preview/dump.mjs "<hash>"
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const browser = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((p) => fs.existsSync(p));
const page = pathToFileURL(path.resolve("preview/out/index.html")).href;
process.stdout.write(execFileSync(browser, ["--headless=new", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", `${page}#${process.argv[2] ?? "home"}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
