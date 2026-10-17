import { App, Menu, Modal, Notice, setIcon, Setting } from "obsidian";
import type SecondBrainPlugin from "../main";

const SUGGESTED_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#ad7f58", "#8b8d98"];

/** Create a label (name + color) and add it to settings. */
export class NewLabelModal extends Modal {
	private name = "";
	private color = SUGGESTED_COLORS[Math.floor(Math.random() * SUGGESTED_COLORS.length)];

	constructor(app: App, private plugin: SecondBrainPlugin, private onCreate: (name: string) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("New label");
		const { contentEl } = this;
		new Setting(contentEl).setName("Name").setDesc("Used as a tag: #name").addText((t) => {
			t.setPlaceholder("e.g. client-a").onChange((v) => { this.name = v; });
			t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.save(); });
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		const colorSetting = new Setting(contentEl).setName("Color");
		const swatches = colorSetting.controlEl.createDiv({ cls: "sbd-swatches" });
		const draw = () => Array.from(swatches.children).forEach((c) => c.toggleClass("is-active", (c as HTMLElement).dataset.color === this.color));
		for (const c of SUGGESTED_COLORS) {
			const sw = swatches.createSpan({ cls: "sbd-swatch", attr: { "data-color": c, "aria-label": c } });
			sw.style.background = c;
			sw.onclick = () => { this.color = c; draw(); };
		}
		colorSetting.addColorPicker((cp) => cp.setValue(this.color).onChange((v) => { this.color = v; draw(); }));
		draw();
		new Setting(contentEl).addButton((b) => b.setButtonText("Create label").setCta().onClick(() => void this.save()));
	}

	private async save(): Promise<void> {
		const name = this.name.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-");
		if (!name || !/^[\p{L}\p{N}_\-/]+$/u.test(name)) { new Notice("Use letters, numbers, - or _ for the label name."); return; }
		const labels = this.plugin.settings.labels;
		if (!labels.some((l) => l.name === name)) {
			labels.push({ name, color: this.color });
			await this.plugin.persist();
		}
		this.onCreate(name);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Label field: selected labels as removable chips plus an "add label" dropdown
 * listing every label, with "New label…" at the bottom.
 */
export function labelDropdown(container: HTMLElement, app: App, plugin: SecondBrainPlugin, selected: Set<string>, onChange?: () => void): void {
	const wrap = container.createDiv({ cls: "sbd-label-field" });
	const draw = () => {
		wrap.empty();
		for (const name of selected) {
			const chip = wrap.createSpan({ cls: "sbd-label sbd-label-chip", text: `#${name}` });
			const color = plugin.settings.labels.find((l) => l.name === name)?.color;
			if (color) chip.style.setProperty("--sbd-label-color", color);
			const x = chip.createSpan({ cls: "sbd-label-x", attr: { "aria-label": "Remove" } });
			setIcon(x, "x");
			x.onclick = () => { selected.delete(name); draw(); onChange?.(); };
		}
		const btn = wrap.createEl("button", { cls: "sbd-label-add" });
		setIcon(btn.createSpan({ cls: "sbd-icon" }), "tag");
		btn.createSpan({ text: selected.size ? "add" : "add label" });
		setIcon(btn.createSpan({ cls: "sbd-icon" }), "chevron-down");
		btn.onclick = (e) => {
			const menu = new Menu();
			for (const l of plugin.settings.labels) {
				menu.addItem((i) => i.setTitle(`#${l.name}`).setChecked(selected.has(l.name)).onClick(() => {
					if (selected.has(l.name)) selected.delete(l.name); else selected.add(l.name);
					draw();
					onChange?.();
				}));
			}
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("New label…").setIcon("plus").onClick(() => {
				new NewLabelModal(app, plugin, (name) => { selected.add(name); draw(); onChange?.(); }).open();
			}));
			menu.showAtMouseEvent(e);
		};
	};
	draw();
}
