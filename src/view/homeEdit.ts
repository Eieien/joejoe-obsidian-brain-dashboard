import { App, getIcon, Modal, setIcon, Setting, TFolder } from "obsidian";
import type SecondBrainPlugin from "../main";
import { DARK_SURFACES, HOME_SECTIONS, PILL_COLORS, type DarkSurface, type PillColor, type QuickLink } from "../settings";
import { IconPickerModal } from "./pickers";

/** Edit the rotating quotes (one per line). */
export class QuoteModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private onDone: () => void) {
		super(app);
	}

	onOpen(): void {
		const a = this.plugin.settings.appearance;
		this.setTitle("Quotes");
		let text = a.quotes.join("\n");
		new Setting(this.contentEl).setName("One quote per line").setDesc("A different one is shown each day.")
			.addTextArea((t) => { t.inputEl.rows = 8; t.inputEl.addClass("sbd-wide-textarea"); t.setValue(text).onChange((v) => { text = v; }); });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Hide quote").onClick(async () => { a.showQuote = false; await this.done(); }))
			.addButton((b) => b.setButtonText("Save").setCta().onClick(async () => {
				a.quotes = text.split("\n").map((x) => x.trim()).filter(Boolean);
				a.showQuote = a.quotes.length > 0;
				await this.done();
			}));
	}

	private async done(): Promise<void> {
		await this.plugin.persist();
		this.close();
		this.onDone();
	}

	onClose(): void { this.contentEl.empty(); }
}

/** Edit the quick-link row: label, icon, color, target; reorder; add/remove. */
export class QuickLinksModal extends Modal {
	private links: QuickLink[];

	constructor(app: App, private plugin: SecondBrainPlugin, current: QuickLink[], private onDone: () => void) {
		super(app);
		this.links = current.map((l) => ({ ...l }));
	}

	onOpen(): void {
		this.setTitle("Quick links");
		this.modalEl.addClass("sbd-links-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({ cls: "sbd-modal-help", text: "Target: a folder or note path, a #tag, or a web link." });

		// Folder/note suggestions for the target field.
		const listId = "sbd-link-targets";
		const datalist = contentEl.createEl("datalist", { attr: { id: listId } });
		const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !!f.path).map((f) => f.path);
		for (const f of folders.slice(0, 200)) datalist.createEl("option", { value: f });

		this.links.forEach((l, i) => {
			const row = contentEl.createDiv({ cls: "sbd-link-row" });
			const iconBtn = row.createEl("button", { cls: `sbd-link-icon sbd-c-${l.color}`, attr: { "aria-label": "Choose icon" } });
			if (getIcon(l.icon)) setIcon(iconBtn, l.icon); else iconBtn.setText(l.icon || "•");
			iconBtn.onclick = () => new IconPickerModal(this.app, (icon) => { l.icon = icon; this.render(); }).open();

			const label = row.createEl("input", { type: "text", cls: "sbd-link-label", value: l.label, attr: { placeholder: "label" } });
			label.oninput = () => { l.label = label.value; };
			const color = row.createEl("select", { cls: "dropdown sbd-link-color" });
			for (const c of PILL_COLORS) color.createEl("option", { value: c, text: c });
			color.value = l.color;
			color.onchange = () => { l.color = color.value as PillColor; this.render(); };
			const target = row.createEl("input", { type: "text", cls: "sbd-link-target", value: l.target, attr: { placeholder: "Folder, note, #tag or https://…", list: listId } });
			target.oninput = () => { l.target = target.value.trim(); };

			const move = (d: number) => {
				const j = i + d;
				if (j < 0 || j >= this.links.length) return;
				[this.links[i], this.links[j]] = [this.links[j], this.links[i]];
				this.render();
			};
			for (const [icon, label2, fn] of [["arrow-up", "Move up", () => move(-1)], ["arrow-down", "Move down", () => move(1)], ["trash-2", "Remove", () => { this.links.splice(i, 1); this.render(); }]] as const) {
				const b = row.createEl("button", { cls: "sbd-icon-btn clickable-icon", attr: { "aria-label": label2 } });
				setIcon(b, icon);
				b.onclick = fn;
			}
		});

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("+ link").onClick(() => {
				this.links.push({ label: "new link", icon: "link", color: PILL_COLORS[this.links.length % PILL_COLORS.length], target: "" });
				this.render();
			}))
			.addButton((b) => b.setButtonText("Use my folders").setTooltip("Clear custom links and show top-level folders automatically").onClick(async () => {
				this.plugin.settings.quickLinks = [];
				await this.done();
			}))
			.addButton((b) => b.setButtonText("Save").setCta().onClick(async () => {
				this.plugin.settings.quickLinks = this.links.filter((l) => l.label.trim());
				await this.done();
			}));
	}

	private async done(): Promise<void> {
		await this.plugin.persist();
		this.close();
		this.onDone();
	}

	onClose(): void { this.contentEl.empty(); }
}

/** Reorder / hide home sections and toggle widgets. */
export class HomeLayoutModal extends Modal {
	constructor(app: App, private plugin: SecondBrainPlugin, private onDone: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Customize page");
		this.modalEl.addClass("sbd-layout-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const a = this.plugin.settings.appearance;
		contentEl.empty();

		new Setting(contentEl).setName("Sections").setHeading();
		contentEl.createDiv({ cls: "sbd-modal-help", text: "Drag order with the arrows; toggle to show or hide." });
		a.layout.forEach((item, i) => {
			const meta = HOME_SECTIONS.find((h) => h.id === item.id);
			const s = new Setting(contentEl).setName(meta?.label ?? item.id);
			s.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => {
				[a.layout[i - 1], a.layout[i]] = [a.layout[i], a.layout[i - 1]];
				this.render();
			}));
			s.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === a.layout.length - 1).onClick(() => {
				[a.layout[i + 1], a.layout[i]] = [a.layout[i], a.layout[i + 1]];
				this.render();
			}));
			s.addToggle((t) => t.setValue(!item.hidden).onChange((v) => { item.hidden = !v; }));
		});

		new Setting(contentEl).setName("Widgets").setHeading();
		new Setting(contentEl).setName("Countdown").addToggle((t) => t.setValue(a.showCountdown).onChange((v) => { a.showCountdown = v; }));
		new Setting(contentEl).setName("Countdown target").setDesc("Empty date = next deadline.")
			.addText((t) => { t.inputEl.type = "date"; t.setValue(a.countdownDate).onChange((v) => { a.countdownDate = v; }); })
			.addText((t) => t.setPlaceholder("label").setValue(a.countdownLabel).onChange((v) => { a.countdownLabel = v; }));
		new Setting(contentEl).setName("Year / month / week progress").addToggle((t) => t.setValue(a.showTimeProgress).onChange((v) => { a.showTimeProgress = v; }));
		new Setting(contentEl).setName("Clock").addToggle((t) => t.setValue(a.showClock).onChange((v) => { a.showClock = v; }));
		new Setting(contentEl).setName("Quote").addToggle((t) => t.setValue(a.showQuote).onChange((v) => { a.showQuote = v; }));

		new Setting(contentEl).setName("Look").setHeading();
		new Setting(contentEl).setName("Style").addDropdown((d) => d.addOption("mono", "Mono page").addOption("theme", "Theme native")
			.setValue(a.style).onChange((v) => { a.style = v as "mono" | "theme"; }));
		new Setting(contentEl).setName("Dark mode surfaces").setDesc("Only affects dark mode.").addDropdown((d) => {
			DARK_SURFACES.forEach((o) => d.addOption(o.value, o.label));
			d.setValue(a.darkSurface ?? "default").onChange((v) => { a.darkSurface = v as DarkSurface; });
		});

		new Setting(contentEl).addButton((b) => b.setButtonText("Done").setCta().onClick(async () => {
			await this.plugin.persist();
			this.close();
			this.onDone();
		}));
	}

	onClose(): void { this.contentEl.empty(); }
}
