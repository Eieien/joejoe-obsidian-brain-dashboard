import { App, moment, Notice, TFile } from "obsidian";
import type { DashboardSettings } from "../settings";
import type { Priority, Task, TaskStatus } from "../types";
import { appendToFile } from "./daily";
import { addLabel, removeLabel, setDoneDate, setDue, setPriority, setStatusChar } from "./taskParser";

export interface TaskChange {
	status?: TaskStatus;
	addLabels?: string[];
	removeLabels?: string[];
}

/**
 * Writes task changes back to the source note. Every write re-reads the file and
 * checks the line still matches what the dashboard showed, so edits made in the
 * editor in the meantime are never clobbered.
 */
export class TaskWriter {
	constructor(private app: App, private getSettings: () => DashboardSettings) {}

	async setStatus(task: Task, status: TaskStatus): Promise<void> {
		const ch = this.getSettings().statusChars[status];
		const today = moment().format("YYYY-MM-DD");
		await this.edit(task, (line) => {
			let out = setStatusChar(line, ch);
			out = setDoneDate(out, status === "done" ? today : null);
			return out;
		});
	}

	async toggleDone(task: Task): Promise<void> {
		await this.setStatus(task, task.status === "done" ? "todo" : "done");
	}

	/** Several changes in one write (e.g. moving a card between Kanban sections). */
	async change(task: Task, c: TaskChange): Promise<void> {
		const chars = this.getSettings().statusChars;
		const today = moment().format("YYYY-MM-DD");
		await this.edit(task, (line) => {
			let out = line;
			for (const l of c.removeLabels ?? []) out = removeLabel(out, l);
			for (const l of c.addLabels ?? []) out = addLabel(out, l);
			if (c.status && c.status !== task.status) {
				out = setStatusChar(out, chars[c.status]);
				out = setDoneDate(out, c.status === "done" ? today : null);
			}
			return out;
		});
	}

	async setPriority(task: Task, p: Priority): Promise<void> {
		await this.edit(task, (line) => setPriority(line, p));
	}

	async setDue(task: Task, date: string | null): Promise<void> {
		await this.edit(task, (line) => setDue(line, date));
	}

	async toggleLabel(task: Task, label: string): Promise<void> {
		const has = task.labels.includes(label.toLowerCase());
		await this.edit(task, (line) => (has ? removeLabel(line, label) : addLabel(line, label)));
	}

	/** Move a task line to the end of another note (removed from its current note first). */
	async moveTo(task: Task, targetPath: string, transform: (line: string) => string = (l) => l): Promise<boolean> {
		let moved: string | null = null;
		await this.edit(task, (line) => { moved = line; return null; });
		if (moved === null) return false;
		await appendToFile(this.app, targetPath, transform((moved as string).replace(/^\s+/, "")));
		return true;
	}

	/** Delete a task line. */
	async remove(task: Task): Promise<void> {
		await this.edit(task, () => null);
	}

	/** Rewrite one task line; returning null from `mutate` deletes the line. */
	private async edit(task: Task, mutate: (line: string) => string | null): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(`Second brain: ${task.path} no longer exists.`);
			return;
		}
		let ok = true;
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			let idx = task.line;
			const strip = (l: string | undefined) => (l ?? "").replace(/\r$/, "");
			if (strip(lines[idx]) !== task.raw) {
				// The line moved; find it by content (nearest match to the old position).
				const candidates = lines.map((l, i) => (strip(l) === task.raw ? i : -1)).filter((i) => i >= 0);
				if (!candidates.length) { ok = false; return data; }
				idx = candidates.reduce((a, b) => (Math.abs(b - task.line) < Math.abs(a - task.line) ? b : a));
			}
			const cr = lines[idx].endsWith("\r") ? "\r" : "";
			const next = mutate(strip(lines[idx]));
			if (next === null) lines.splice(idx, 1);
			else lines[idx] = next + cr;
			return lines.join("\n");
		});
		if (!ok) new Notice("Second brain: that task changed in the note since the dashboard loaded. Refreshing.");
	}
}
