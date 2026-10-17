// Copies the built plugin into a vault: npm run deploy -- "C:/path/to/Vault"
import fs from "fs";
import path from "path";

const vault = process.argv[2] || process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error('Usage: npm run deploy -- "C:/path/to/YourVault"  (or set OBSIDIAN_VAULT)');
  process.exit(1);
}
const dest = path.join(vault, ".obsidian", "plugins", "second-brain-dashboard");
fs.mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  fs.copyFileSync(f, path.join(dest, f));
}
console.log(`Deployed to ${dest}. Reload Obsidian and enable "joejoe's second brain".`);
