import { App, Modal, moment, Notice, setIcon, Setting } from "obsidian";
import type SecondBrainPlugin from "../main";
import { slugKey, type FieldType, type GoalAgg, type GoalPeriod, type TrackerDef, type TrackerField } from "../data/trackerTypes";

const FIELD_TYPES: FieldType[] = ["boolean", "number", "rating", "status", "duration", "money", "date", "text"];

/** Create or edit a tracker definition. */
export class TrackerEditModal extends Modal {
	private def: TrackerDef;

	constructor(app: App, private plugin: SecondBrainPlugin, existing?: TrackerDef) {
		super(app);
		this.def = existing
			? structuredClone(existing)
			: { id: `t${Date.now().toString(36)}`, name: "", icon: "activity", source: "daily", fields: [{ key: "", label: "", type: "boolean" }] };
	}

	onOpen(): void {
		this.setTitle(this.def.name ? `Edit tracker · ${this.def.name}` : "New tracker");
		this.modalEl.addClass("sbd-tracker-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const d = this.def;
		contentEl.empty();

		new Setting(contentEl).setName("Name").addText((t) => t.setPlaceholder("e.g. Habits, Books, Job applications").setValue(d.name).onChange((v) => { d.name = v; }));
		new Setting(contentEl).setName("Icon").setDesc("Lucide icon name.").addText((t) => t.setValue(d.icon).onChange((v) => { d.icon = v.trim() || "activity"; }));
		new Setting(contentEl).setName("Data source").addDropdown((dd) => dd
			.addOption("daily", "Daily notes (one value per day)")
			.addOption("notes", "One note per item (folder / tag)")
			.addOption("table", "Table in a note")
			.setValue(d.source)
			.onChange((v) => { d.source = v as TrackerDef["source"]; this.render(); }));

		const help = contentEl.createDiv({ cls: "sbd-modal-help" });
		if (d.source === "daily") {
			help.setText("Values are read from each daily note's frontmatter (gym: true) or inline fields (gym:: true). The field key must match.");
		} else if (d.source === "notes") {
			help.setText("Each note in the folder (and/or with the tag) is one item; fields come from its frontmatter.");
			new Setting(contentEl).setName("Folder").addText((t) => t.setPlaceholder("Books").setValue(d.folder ?? "").onChange((v) => { d.folder = v.trim(); }));
			new Setting(contentEl).setName("Tag").setDesc("Optional, without #.").addText((t) => t.setValue(d.tag ?? "").onChange((v) => { d.tag = v.replace(/^#/, "").trim(); }));
			new Setting(contentEl).setName("Date field").setDesc("Frontmatter field with the item's date. Empty = date, falling back to the note's creation date.")
				.addText((t) => t.setPlaceholder("date").setValue(d.dateField ?? "").onChange((v) => { d.dateField = v.trim(); }));
		} else {
			help.setText("Rows of a Markdown table in one note. Column headers are the field keys; a 'date' column dates each row.");
			new Setting(contentEl).setName("Note path").addText((t) => t.setPlaceholder("Trackers/Workouts.md").setValue(d.notePath ?? "").onChange((v) => { d.notePath = v.trim(); }));
			new Setting(contentEl).setName("Date column").addText((t) => t.setPlaceholder("date").setValue(d.dateField ?? "").onChange((v) => { d.dateField = v.trim(); }));
		}

		new Setting(contentEl).setName("Fields").setHeading();
		d.fields.forEach((f, i) => this.renderField(contentEl, f, i));
		new Setting(contentEl).addButton((b) => b.setButtonText("+ field").onClick(() => { d.fields.push({ key: "", label: "", type: "number" }); this.render(); }));

		const footer = new Setting(contentEl);
		if (this.plugin.settings.trackers.some((t) => t.id === d.id)) {
			footer.addButton((b) => b.setButtonText("Delete tracker").setWarning().onClick(async () => {
				this.plugin.settings.trackers = this.plugin.settings.trackers.filter((t) => t.id !== d.id);
				await this.plugin.saveSettings();
				this.close();
			}));
		}
		footer.addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.save()));
	}

	private renderField(parent: HTMLElement, f: TrackerField, i: number): void {
		const box = parent.createDiv({ cls: "sbd-field-box" });
		new Setting(box)
			.setName(`Field ${i + 1}`)
			.addText((t) => t.setPlaceholder("label (e.g. Gym)").setValue(f.label).onChange((v) => {
				const autoKey = !f.key || f.key === slugKey(f.label);
				f.label = v;
				if (autoKey) { f.key = slugKey(v); keyInput.setValue(f.key); }
			}))
			.addDropdown((dd) => {
				FIELD_TYPES.forEach((ft) => dd.addOption(ft, ft));
				dd.setValue(f.type).onChange((v) => { f.type = v as FieldType; this.render(); });
			})
			.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove field").onClick(() => { this.def.fields.splice(i, 1); this.render(); }));
		let keyInput!: import("obsidian").TextComponent;
		new Setting(box).setName("Key").setDesc("The frontmatter / column name to read.")
			.addText((t) => { keyInput = t; t.setValue(f.key).onChange((v) => { f.key = slugKey(v); }); });
		if (f.type === "status") {
			new Setting(box).setName("Options").setDesc("Comma-separated, in order (also the funnel order).")
				.addText((t) => t.setPlaceholder("applied, interview, offer").setValue((f.options ?? []).join(", "))
					.onChange((v) => { f.options = v.split(",").map((x) => x.trim()).filter(Boolean); }));
			new Setting(box).setName("Ordered stages").setDesc("Show a conversion funnel (e.g. applied → interview → offer).")
				.addToggle((t) => t.setValue(!!f.funnel).onChange((v) => { f.funnel = v; }));
		}
		if (["number", "money", "duration"].includes(f.type)) {
			new Setting(box).setName("Unit").addText((t) => t.setPlaceholder(f.type === "duration" ? "min" : "e.g. pages, $").setValue(f.unit ?? "").onChange((v) => { f.unit = v.trim() || undefined; }));
		}
		if (f.type !== "text" && f.type !== "date") {
			const g = f.goal ?? { target: 0, period: "week" as GoalPeriod, agg: (f.type === "boolean" || f.type === "status" ? "count" : "sum") as GoalAgg };
			new Setting(box).setName("Goal").setDesc("Optional target per period. 0 = no goal.")
				.addText((t) => { t.inputEl.type = "number"; t.setValue(String(g.target || "")).onChange((v) => { g.target = Number(v) || 0; f.goal = g.target ? g : undefined; }); })
				.addDropdown((dd) => dd.addOption("count", "count").addOption("sum", "sum").addOption("avg", "average")
					.setValue(g.agg).onChange((v) => { g.agg = v as GoalAgg; if (g.target) f.goal = g; }))
				.addDropdown((dd) => dd.addOption("day", "per day").addOption("week", "per week").addOption("month", "per month").addOption("year", "per year")
					.setValue(g.period).onChange((v) => { g.period = v as GoalPeriod; if (g.target) f.goal = g; }));
		}
	}

	private async save(): Promise<void> {
		const d = this.def;
		d.name = d.name.trim();
		d.fields = d.fields.filter((f) => f.key || f.label).map((f) => ({ ...f, key: f.key || slugKey(f.label), label: f.label || f.key }));
		if (!d.name) { new Notice("Give the tracker a name."); return; }
		if (!d.fields.length) { new Notice("Add at least one field."); return; }
		if (d.source === "notes" && !d.folder && !d.tag) { new Notice("Set a folder or a tag for this tracker."); return; }
		if (d.source === "table" && !d.notePath) d.notePath = `Trackers/${d.name}.md`;
		const list = this.plugin.settings.trackers;
		const i = list.findIndex((t) => t.id === d.id);
		if (i >= 0) list[i] = d; else list.push(d);
		await this.plugin.saveSettings();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Log one entry for a tracker. */
export class EntryModal extends Modal {
	private values: Record<string, unknown> = {};
	private date: string;
	private name = "";

	constructor(app: App, private plugin: SecondBrainPlugin, private def: TrackerDef) {
		super(app);
		this.date = def.source === "notes" && def.dateField ? "" : moment().format("YYYY-MM-DD");
	}

	onOpen(): void {
		const d = this.def;
		this.setTitle(`Log · ${d.name}`);
		this.modalEl.addClass("sbd-entry-modal");
		const { contentEl } = this;

		if (d.source === "notes") {
			new Setting(contentEl).setName("Name").setDesc("Becomes the note title.").addText((t) => {
				t.onChange((v) => { this.name = v; });
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		}
		new Setting(contentEl)
			.setName(d.source === "notes" && d.dateField ? d.dateField : "Date")
			.setDesc(d.source === "notes" && d.dateField ? "Leave empty if not reached yet." : "")
			.addText((t) => { t.inputEl.type = "date"; t.setValue(this.date).onChange((v) => { this.date = v; }); });

		for (const f of d.fields) {
			const s = new Setting(contentEl).setName(f.label + (f.unit ? ` (${f.unit})` : ""));
			switch (f.type) {
				case "boolean":
					s.addToggle((t) => t.onChange((v) => { this.values[f.key] = v; }));
					break;
				case "rating": {
					const stars = s.controlEl.createDiv({ cls: "sbd-stars" });
					const draw = (n: number) => Array.from(stars.children).forEach((c, i) => c.toggleClass("is-on", i < n));
					for (let i = 1; i <= 5; i++) {
						const star = stars.createSpan({ cls: "sbd-star" });
						setIcon(star, "star");
						star.onclick = () => { this.values[f.key] = i; draw(i); };
					}
					break;
				}
				case "status":
					s.addDropdown((dd) => {
						dd.addOption("", "-");
						(f.options ?? []).forEach((o) => dd.addOption(o, o));
						dd.onChange((v) => { this.values[f.key] = v; });
					});
					break;
				case "date":
					s.addText((t) => { t.inputEl.type = "date"; t.onChange((v) => { this.values[f.key] = v; }); });
					break;
				case "text":
					s.addText((t) => t.onChange((v) => { this.values[f.key] = v; }));
					break;
				default:
					s.addText((t) => {
						t.inputEl.type = f.type === "duration" ? "text" : "number";
						t.setPlaceholder(f.type === "duration" ? "e.g. 45 or 1h30m" : "0");
						t.onChange((v) => { this.values[f.key] = f.type === "duration" ? v : v === "" ? "" : Number(v); });
					});
			}
		}
		new Setting(contentEl).addButton((b) => b.setButtonText("Save entry").setCta().onClick(() => void this.save()));
	}

	private async save(): Promise<void> {
		if (this.def.source === "notes" && !this.name.trim()) { new Notice("Give the item a name."); return; }
		try {
			const path = await this.plugin.trackers.addEntry(this.def, this.values, { date: this.date || undefined, name: this.name.trim() || undefined });
			new Notice(`Logged to ${path.replace(/\.md$/, "")}`);
			this.close();
		} catch (e) {
			console.error(e);
			new Notice("Second brain: could not save the entry. See console.");
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
