import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import process from "process";
import builtins from "builtin-modules";

// Usage:
//   node esbuild.config.mjs production            one-off production build
//   node esbuild.config.mjs                       watch mode
//   node esbuild.config.mjs "C:/path/to/Vault"    watch mode + copy into the vault after every build
//                                                 (the plugin reloads itself when "Auto-reload on update" is on)
const arg = process.argv[2];
const prod = arg === "production";
const vault = !prod && arg ? arg : process.env.OBSIDIAN_VAULT;
const pluginDir = vault ? path.join(vault, ".obsidian", "plugins", "second-brain-dashboard") : null;

function copyToVault(files) {
	if (!pluginDir) return;
	fs.mkdirSync(pluginDir, { recursive: true });
	for (const f of files) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(pluginDir, f));
	console.log(`[deploy] ${files.join(", ")} → ${pluginDir}`);
}

const deployPlugin = {
	name: "deploy-to-vault",
	setup(build) {
		build.onEnd((result) => {
			if (!result.errors.length) copyToVault(["main.js", "manifest.json", "styles.css"]);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian", "electron",
		"@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
		"@codemirror/language", "@codemirror/lint", "@codemirror/search",
		"@codemirror/state", "@codemirror/view",
		"@lezer/common", "@lezer/highlight", "@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	plugins: pluginDir ? [deployPlugin] : [],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
	// styles.css isn't part of the JS bundle, so watch it separately.
	if (pluginDir) {
		let t;
		fs.watch("styles.css", () => { clearTimeout(t); t = setTimeout(() => copyToVault(["styles.css"]), 150); });
		console.log(`[dev] watching src/ and styles.css → ${pluginDir}`);
	}
}
