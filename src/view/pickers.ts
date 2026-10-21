import { App, getIcon, getIconIds, Modal, Notice, setIcon, Setting, TFile } from "obsidian";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

export function isImagePath(s: string): boolean {
	return IMAGE_EXT.has(s.split(".").pop()?.toLowerCase() ?? "");
}

/** Resolve a vault path or URL to something an <img> / CSS url() can load. */
export function imageSrc(app: App, src: string): string | null {
	if (!src) return null;
	if (/^(https?:|data:|app:)/.test(src)) return src;
	const f = app.vault.getAbstractFileByPath(src);
	return f instanceof TFile ? app.vault.getResourcePath(f) : null;
}

/** Pick an image or GIF: search the vault, paste a link or an image, drop a file, or upload (saved as an attachment). */
export class ImagePickerModal extends Modal {
	private query = "";
	private onlyGifs = false;

	constructor(app: App, private opts: { title: string; onPick: (src: string) => void; onRemove?: () => void }) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.opts.title);
		this.modalEl.addClass("sbd-picker-modal");
		const { contentEl } = this;

		const actions = contentEl.createDiv({ cls: "sbd-picker-actions" });
		const upload = actions.createEl("button", { cls: "mod-cta" });
		setIcon(upload.createSpan({ cls: "sbd-icon" }), "upload");
		upload.createSpan({ text: "Upload image or GIF" });
		const file = actions.createEl("input", { type: "file", attr: { accept: "image/*,.gif", hidden: "true" } });
		upload.onclick = () => file.click();
		file.onchange = () => { const f = file.files?.[0]; if (f) void this.importFile(f); };

		// Drop a file anywhere on the picker, or paste an image / link (Ctrl+V)
		const drop = contentEl.createDiv({ cls: "sbd-picker-drop", text: "Drop an image or GIF here · or paste one with Ctrl+V" });
		this.modalEl.addEventListener("dragover", (e) => { e.preventDefault(); drop.addClass("is-over"); });
		this.modalEl.addEventListener("dragleave", (e) => { if (!this.modalEl.contains(e.relatedTarget as Node)) drop.removeClass("is-over"); });
		this.modalEl.addEventListener("drop", (e) => {
			e.preventDefault();
			drop.removeClass("is-over");
			const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.type.startsWith("image/"));
			if (f) return void this.importFile(f);
			const link = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
			if (link && /^https?:\/\//.test(link.trim())) this.pick(link.trim());
		});
		this.modalEl.addEventListener("paste", (e) => {
			const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
			const f = item?.getAsFile();
			if (f) { e.preventDefault(); return void this.importFile(f); }
			const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
			if (/^https?:\/\/\S+$/.test(text) && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); this.pick(text); }
		});
		if (this.opts.onRemove) {
			const remove = actions.createEl("button");
			setIcon(remove.createSpan({ cls: "sbd-icon" }), "trash-2");
			remove.createSpan({ text: "Remove" });
			remove.onclick = () => { this.opts.onRemove!(); this.close(); };
		}

		let url = "";
		new Setting(contentEl).setName("Image or GIF link").setDesc("A direct link ending in .gif / .png / .jpg (on Giphy or Tenor, right-click the GIF → Copy image address).")
			.addText((t) => t.setPlaceholder("https://…/image.gif").onChange((v) => { url = v.trim(); }))
			.addButton((b) => b.setButtonText("Use link").onClick(() => { if (/^https?:\/\//.test(url)) this.pick(url); }));

		const row = contentEl.createDiv({ cls: "sbd-picker-row" });
		const search = row.createEl("input", { type: "search", cls: "sbd-picker-search", attr: { placeholder: "Search images in your vault…" } });
		const gifChip = row.createEl("button", { cls: "sbd-picker-chip", text: "GIFs", attr: { "aria-pressed": "false", type: "button" } });
		gifChip.onclick = () => { this.onlyGifs = !this.onlyGifs; gifChip.toggleClass("is-active", this.onlyGifs); gifChip.setAttr("aria-pressed", String(this.onlyGifs)); draw(); };
		const grid = contentEl.createDiv({ cls: "sbd-picker-grid" });
		const draw = () => {
			grid.empty();
			const q = this.query.toLowerCase();
			const images = this.app.vault.getFiles().filter((f) => isImagePath(f.path) && f.path.toLowerCase().includes(q) && (!this.onlyGifs || f.extension.toLowerCase() === "gif"))
				.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 60);
			if (!images.length) grid.createDiv({ cls: "sbd-empty", text: q || this.onlyGifs ? `No ${this.onlyGifs ? "GIFs" : "images"} match.` : "No images in this vault yet — upload one above." });
			for (const img of images) {
				const cell = grid.createDiv({ cls: "sbd-picker-cell", attr: { "aria-label": img.path } });
				cell.createEl("img", { attr: { src: this.app.vault.getResourcePath(img), loading: "lazy", alt: img.name } });
				cell.createDiv({ cls: "sbd-picker-name", text: img.name });
				if (img.extension.toLowerCase() === "gif") cell.createSpan({ cls: "sbd-picker-badge", text: "GIF" });
				cell.onclick = () => this.pick(img.path);
			}
		};
		search.oninput = () => { this.query = search.value; draw(); };
		draw();
	}

	/** Save a dropped / pasted / uploaded file into the vault as an attachment, then use it. */
	private async importFile(f: File): Promise<void> {
		try {
			const ext = f.type === "image/gif" ? "gif" : (f.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
			const base = f.name && f.name !== "image.png" ? f.name : `Pasted image ${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.${ext}`;
			const path = await this.app.fileManager.getAvailablePathForAttachment(base.replace(/[\\/:*?"<>|#^[\]]/g, "-"));
			await this.app.vault.createBinary(path, await f.arrayBuffer());
			this.pick(path);
		} catch (e) {
			console.error(e);
			new Notice("Couldn't save that image to the vault. Check the console for details.");
		}
	}

	private pick(src: string): void {
		this.opts.onPick(src);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const EMOJI = "🧠 🌱 🌿 🍀 🌸 🌙 ⭐ ✨ 🔥 💡 📚 📖 📝 ✏️ 🗂️ 📌 📎 🎯 🚀 💼 🏠 🧭 🗺️ ⏳ ⌛ 🕰️ ☕ 🍵 🎧 🎨 🎮 📷 🎬 🧩 🪴 🌊 🏔️ 🌄 🐈 🐟 🦊 🐻 🐼 🐸 🦋 🍄 🌻 🍓 💻 🖥️ 🛠️ ⚙️ 🔬 🧪 💰 📈 ❤️ 💪 🧘 🏃 🎓 ✅".split(" ");

/** Choose a page icon: an emoji, a Lucide icon, or an image. */
export class IconPickerModal extends Modal {
	private tab: "emoji" | "icons" = "emoji";
	private query = "";

	constructor(app: App, private onPick: (icon: string) => void, private onRemove?: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Page icon");
		this.modalEl.addClass("sbd-picker-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const tabs = contentEl.createDiv({ cls: "sbd-segmented sbd-picker-tabs" });
		(["emoji", "icons"] as const).forEach((t) => {
			const b = tabs.createEl("button", { text: t, cls: this.tab === t ? "is-active" : "" });
			b.onclick = () => { this.tab = t; this.query = ""; this.render(); };
		});
		const image = tabs.createEl("button", { text: "image" });
		image.onclick = () => {
			this.close();
			new ImagePickerModal(this.app, { title: "Icon image", onPick: (src) => this.onPick(src) }).open();
		};
		if (this.onRemove) {
			const rm = contentEl.createEl("button", { cls: "sbd-picker-remove", text: "Remove icon" });
			rm.onclick = () => { this.onRemove!(); this.close(); };
		}

		if (this.tab === "emoji") {
			let custom = "";
			new Setting(contentEl).setName("Any emoji").setDesc("Type or paste (Win + . opens the emoji panel).")
				.addText((t) => t.setPlaceholder("🙂").onChange((v) => { custom = v.trim(); }))
				.addButton((b) => b.setButtonText("Use").onClick(() => { if (custom) this.pick(custom); }));
			const grid = contentEl.createDiv({ cls: "sbd-emoji-grid" });
			for (const e of EMOJI) {
				const c = grid.createDiv({ cls: "sbd-emoji", text: e });
				c.onclick = () => this.pick(e);
			}
			return;
		}

		const search = contentEl.createEl("input", { type: "search", cls: "sbd-picker-search", attr: { placeholder: "Search icons (e.g. leaf, book, star)…" } });
		search.value = this.query;
		const grid = contentEl.createDiv({ cls: "sbd-icon-grid" });
		const draw = () => {
			grid.empty();
			const q = this.query.toLowerCase().trim();
			const ids = getIconIds().map((id) => id.replace(/^lucide-/, "")).filter((id, i, a) => a.indexOf(id) === i && (!q || id.includes(q))).slice(0, 160);
			for (const id of ids) {
				if (!getIcon(id)) continue;
				const c = grid.createDiv({ cls: "sbd-icon-cell", attr: { "aria-label": id } });
				setIcon(c, id);
				c.onclick = () => this.pick(id);
			}
		};
		search.oninput = () => { this.query = search.value; draw(); };
		draw();
		window.setTimeout(() => search.focus(), 0);
	}

	private pick(icon: string): void {
		this.onPick(icon);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
