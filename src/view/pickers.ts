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

/** Pick an image: search vault images, paste a URL, or upload from the computer (saved as an attachment). */
export class ImagePickerModal extends Modal {
	private query = "";

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
		upload.createSpan({ text: "Upload from computer" });
		const file = actions.createEl("input", { type: "file", attr: { accept: "image/*", hidden: "true" } });
		upload.onclick = () => file.click();
		file.onchange = async () => {
			const f = file.files?.[0];
			if (!f) return;
			try {
				const path = await this.app.fileManager.getAvailablePathForAttachment(f.name.replace(/[\\/:*?"<>|#^[\]]/g, "-"));
				await this.app.vault.createBinary(path, await f.arrayBuffer());
				this.pick(path);
			} catch (e) {
				console.error(e);
				new Notice("Second brain: upload failed — see console.");
			}
		};
		if (this.opts.onRemove) {
			const remove = actions.createEl("button");
			setIcon(remove.createSpan({ cls: "sbd-icon" }), "trash-2");
			remove.createSpan({ text: "Remove" });
			remove.onclick = () => { this.opts.onRemove!(); this.close(); };
		}

		let url = "";
		new Setting(contentEl).setName("Image link").addText((t) => t.setPlaceholder("https://…").onChange((v) => { url = v.trim(); }))
			.addButton((b) => b.setButtonText("Use link").onClick(() => { if (/^https?:\/\//.test(url)) this.pick(url); }));

		const search = contentEl.createEl("input", { type: "search", cls: "sbd-picker-search", attr: { placeholder: "Search images in your vault…" } });
		const grid = contentEl.createDiv({ cls: "sbd-picker-grid" });
		const draw = () => {
			grid.empty();
			const q = this.query.toLowerCase();
			const images = this.app.vault.getFiles().filter((f) => isImagePath(f.path) && f.path.toLowerCase().includes(q))
				.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 60);
			if (!images.length) grid.createDiv({ cls: "sbd-empty", text: q ? "No images match." : "No images in this vault yet — upload one above." });
			for (const img of images) {
				const cell = grid.createDiv({ cls: "sbd-picker-cell", attr: { "aria-label": img.path } });
				cell.createEl("img", { attr: { src: this.app.vault.getResourcePath(img), loading: "lazy", alt: img.name } });
				cell.createDiv({ cls: "sbd-picker-name", text: img.name });
				cell.onclick = () => this.pick(img.path);
			}
		};
		search.oninput = () => { this.query = search.value; draw(); };
		draw();
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
