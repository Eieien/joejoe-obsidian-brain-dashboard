// Auto-reload: when this plugin's own files change on disk (after `npm run deploy` or
// `npm run dev`), reload the plugin so the new version runs without restarting Obsidian.

import { debounce, Notice, type Plugin } from "obsidian";

const WATCHED = ["main.js", "styles.css", "manifest.json"];

interface PluginsApi {
	disablePlugin(id: string): Promise<void>;
	enablePlugin(id: string): Promise<void>;
}

export function watchForUpdates(plugin: Plugin & { settings: { autoReload: boolean } }): void {
	const dir = plugin.manifest.dir;
	if (!dir) return;
	const adapter = plugin.app.vault.adapter;
	let baseline: string | null = null;

	const fingerprint = async (): Promise<string> => {
		const parts: string[] = [];
		for (const f of WATCHED) {
			const st = await adapter.stat(`${dir}/${f}`).catch(() => null);
			parts.push(st ? `${st.mtime}:${st.size}` : "-");
		}
		return parts.join("|");
	};

	const reload = debounce(async () => {
		// The plugins manager isn't part of the public API; guard it.
		const plugins = (plugin.app as unknown as { plugins?: PluginsApi }).plugins;
		if (!plugins) return;
		new Notice(`${plugin.manifest.name} updated — reloading`, 2500);
		const id = plugin.manifest.id;
		await plugins.disablePlugin(id);
		await plugins.enablePlugin(id);
	}, 400, true);

	void fingerprint().then((f) => { baseline = f; });
	plugin.registerInterval(window.setInterval(async () => {
		if (!plugin.settings.autoReload || baseline === null) return;
		const now = await fingerprint();
		if (now !== baseline) {
			baseline = now;
			reload();
		}
	}, 1500));
}
