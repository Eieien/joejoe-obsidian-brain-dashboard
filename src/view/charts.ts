// Small, dependency-free SVG/HTML charts. One ink (the theme's text color), a recessive
// baseline, thin marks with 4px rounded data-ends, selective direct labels, and a hover
// tooltip on every mark. Sequential data (heatmap) uses one hue in 4 opacity steps.

const NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
	const el = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	parent?.appendChild(el);
	return el;
}

export function formatNum(n: number, unit?: string): string {
	const abs = Math.abs(n);
	const s = abs >= 10_000 ? `${(n / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`
		: Number.isInteger(n) ? String(n) : n.toFixed(abs < 10 ? 1 : 0);
	return unit ? `${s} ${unit}` : s;
}

/** A shared tooltip for one chart container. */
function tooltip(wrap: HTMLElement): { show: (html: string, x: number, y: number) => void; hide: () => void } {
	const tip = wrap.createDiv({ cls: "sbd-tooltip" });
	return {
		show(text, x, y) {
			tip.setText(text);
			tip.addClass("is-visible");
			const w = wrap.clientWidth;
			const tw = tip.offsetWidth;
			tip.style.left = `${Math.max(0, Math.min(w - tw, x - tw / 2))}px`;
			tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
		},
		hide() { tip.removeClass("is-visible"); },
	};
}

/** Path for a bar with 4px rounded top corners, anchored flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
	const r = Math.min(4, w / 2, h);
	if (h <= 0) return "";
	return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface BarDatum { label: string; value: number | null; tip: string }

export function barChart(parent: HTMLElement, data: BarDatum[], opts: { height?: number; unit?: string; goal?: number; tickEvery?: number } = {}): void {
	const wrap = parent.createDiv({ cls: "sbd-chart" });
	const H = opts.height ?? 140;
	const W = Math.max(240, parent.clientWidth || 560);
	const padB = 18, padT = 16;
	const max = Math.max(opts.goal ?? 0, ...data.map((d) => d.value ?? 0), 1);
	const plotH = H - padB - padT;
	const slot = W / Math.max(data.length, 1);
	const gap = Math.min(2 + slot * 0.25, 8);
	const bw = Math.max(1, slot - gap);

	const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, preserveAspectRatio: "none", role: "img" }, wrap);
	svgEl("line", { x1: 0, x2: W, y1: H - padB, y2: H - padB, class: "sbd-axis" }, svg);
	if (opts.goal) {
		const gy = padT + plotH - (opts.goal / max) * plotH;
		svgEl("line", { x1: 0, x2: W, y1: gy, y2: gy, class: "sbd-goal-line" }, svg);
	}
	const tip = tooltip(wrap);
	const lastIdx = data.length - 1;
	const maxIdx = data.reduce((m, d, i) => ((d.value ?? -Infinity) > (data[m].value ?? -Infinity) ? i : m), 0);

	data.forEach((d, i) => {
		const x = i * slot + gap / 2;
		const v = d.value ?? 0;
		const h = (v / max) * plotH;
		const y = padT + plotH - h;
		if (h > 0) svgEl("path", { d: barPath(x, y, bw, h), class: `sbd-bar ${i === lastIdx ? "is-last" : ""}` }, svg);
		// Hit target: the whole column, bigger than the mark.
		const hit = svgEl("rect", { x: i * slot, y: 0, width: slot, height: H, class: "sbd-hit" }, svg);
		hit.addEventListener("mouseenter", () => tip.show(d.tip, ((x + bw / 2) / W) * wrap.clientWidth, (y / H) * H));
		hit.addEventListener("mouseleave", () => tip.hide());
		if ((i === lastIdx || i === maxIdx) && d.value) {
			svgEl("text", { x: x + bw / 2, y: y - 4, class: "sbd-chart-label", "text-anchor": "middle" }, svg).textContent = formatNum(d.value);
		}
		const every = opts.tickEvery ?? Math.ceil(data.length / 8);
		if ((i % every === 0 && lastIdx - i >= every * 0.6) || i === lastIdx) {
			svgEl("text", { x: x + bw / 2, y: H - 4, class: "sbd-chart-tick", "text-anchor": "middle" }, svg).textContent = d.label;
		}
	});
}

export function lineChart(parent: HTMLElement, data: { date: string; value: number | null; label: string }[], opts: { height?: number; unit?: string; goal?: number; zero?: boolean } = {}): void {
	const wrap = parent.createDiv({ cls: "sbd-chart" });
	const H = opts.height ?? 140;
	const W = Math.max(240, parent.clientWidth || 560);
	const padB = 18, padT = 16, padX = 6;
	const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
	// zero=false (measurements like weight): fit the domain to the data with a little headroom.
	const fit = opts.zero === false && vals.length > 0;
	const dataMax = Math.max(...vals, opts.goal ?? -Infinity), dataMin = Math.min(...vals, opts.goal ?? Infinity);
	const pad = fit ? (dataMax - dataMin || Math.abs(dataMax) * 0.05 || 1) * 0.15 : 0;
	const max = fit ? dataMax + pad : Math.max(opts.goal ?? 0, ...vals, 1);
	const min = fit ? dataMin - pad : Math.min(0, ...vals);
	const plotH = H - padB - padT;
	const xAt = (i: number) => padX + (i / Math.max(data.length - 1, 1)) * (W - padX * 2);
	const yAt = (v: number) => padT + plotH - ((v - min) / (max - min || 1)) * plotH;

	const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, preserveAspectRatio: "none", role: "img" }, wrap);
	svgEl("line", { x1: 0, x2: W, y1: H - padB, y2: H - padB, class: "sbd-axis" }, svg);
	if (opts.goal) svgEl("line", { x1: 0, x2: W, y1: yAt(opts.goal), y2: yAt(opts.goal), class: "sbd-goal-line" }, svg);

	// Daily logs break at missing days; measurements (fit domain) are continuous, so join across gaps.
	let d = "";
	let pen = false;
	data.forEach((p, i) => {
		if (p.value === null) { if (!fit) pen = false; return; }
		d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`;
		pen = true;
	});
	svgEl("path", { d, class: "sbd-line", "vector-effect": "non-scaling-stroke" }, svg);
	// Lone points (no neighbours) would be invisible as a path; draw them as dots.
	data.forEach((p, i) => {
		if (p.value === null) return;
		const prev = data[i - 1]?.value ?? null, next = data[i + 1]?.value ?? null;
		if (fit || (prev === null && next === null)) svgEl("circle", { cx: xAt(i), cy: yAt(p.value), r: 2.5, class: "sbd-dot" }, svg);
	});

	const lastIdx = data.map((p) => p.value !== null).lastIndexOf(true);
	if (lastIdx >= 0) {
		const v = data[lastIdx].value!;
		svgEl("text", { x: xAt(lastIdx), y: yAt(v) - 6, class: "sbd-chart-label", "text-anchor": lastIdx > data.length * 0.8 ? "end" : "middle" }, svg).textContent = formatNum(v);
	}
	const every = Math.ceil(data.length / 7);
	data.forEach((p, i) => {
		if (i % every === 0 && data.length - 1 - i >= every * 0.6) svgEl("text", { x: xAt(i), y: H - 4, class: "sbd-chart-tick", "text-anchor": i === 0 ? "start" : "middle" }, svg).textContent = p.label;
	});

	// Crosshair + tooltip.
	const tip = tooltip(wrap);
	const cross = svgEl("line", { x1: 0, x2: 0, y1: padT, y2: H - padB, class: "sbd-crosshair" }, svg);
	const marker = svgEl("circle", { cx: 0, cy: 0, r: 4, class: "sbd-marker" }, svg);
	const overlay = svgEl("rect", { x: 0, y: 0, width: W, height: H, class: "sbd-hit" }, svg);
	overlay.addEventListener("mousemove", (e: MouseEvent) => {
		const rect = svg.getBoundingClientRect();
		const rel = ((e.clientX - rect.left) / rect.width) * W;
		const i = Math.max(0, Math.min(data.length - 1, Math.round(((rel - padX) / (W - padX * 2)) * (data.length - 1))));
		const p = data[i];
		cross.setAttribute("x1", String(xAt(i)));
		cross.setAttribute("x2", String(xAt(i)));
		cross.classList.add("is-visible");
		if (p.value !== null) {
			marker.setAttribute("cx", String(xAt(i)));
			marker.setAttribute("cy", String(yAt(p.value)));
			marker.classList.add("is-visible");
		} else marker.classList.remove("is-visible");
		tip.show(`${p.date} · ${p.value === null ? "no entry" : formatNum(p.value, opts.unit)}`, (xAt(i) / W) * rect.width, ((p.value === null ? padT : yAt(p.value)) / H) * H);
	});
	overlay.addEventListener("mouseleave", () => { tip.hide(); cross.classList.remove("is-visible"); marker.classList.remove("is-visible"); });
}

/** GitHub-style calendar heatmap. `value` per date; 0/absent = empty cell. */
export function heatmap(parent: HTMLElement, values: Map<string, number>, start: string, end: string, opts: { weekStartsMonday: boolean; tip: (date: string, v: number | undefined) => string }): void {
	const wrap = parent.createDiv({ cls: "sbd-chart sbd-heatmap-wrap" });
	const cell = 13, gap = 3;
	const s = new Date(start + "T00:00:00");
	const shift = opts.weekStartsMonday ? (s.getDay() + 6) % 7 : s.getDay();
	s.setDate(s.getDate() - shift);
	const days: string[] = [];
	const pad = (x: number) => String(x).padStart(2, "0");
	for (const d = new Date(s); ; d.setDate(d.getDate() + 1)) {
		const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		if (iso > end) break;
		days.push(iso);
	}
	const weeks = Math.ceil(days.length / 7);
	const W = weeks * (cell + gap), H = 7 * (cell + gap) + 14;
	const max = Math.max(1, ...values.values());
	const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" }, wrap);
	const tip = tooltip(wrap);
	let lastMonth = "";
	days.forEach((date, i) => {
		const col = Math.floor(i / 7), row = i % 7;
		const x = col * (cell + gap), y = 14 + row * (cell + gap);
		if (row === 0 && date.slice(5, 7) !== lastMonth) {
			lastMonth = date.slice(5, 7);
			svgEl("text", { x, y: 10, class: "sbd-chart-tick" }, svg).textContent = new Date(date + "T00:00:00").toLocaleString(undefined, { month: "short" });
		}
		const v = date < start ? undefined : values.get(date);
		const step = !v ? 0 : Math.min(4, Math.ceil((v / max) * 4));
		const r = svgEl("rect", { x, y, width: cell, height: cell, rx: 2, class: `sbd-heat sbd-heat-${step} ${date < start ? "is-out" : ""}` }, svg);
		r.addEventListener("mouseenter", () => tip.show(opts.tip(date, v), x + cell / 2, y));
		r.addEventListener("mouseleave", () => tip.hide());
	});
	const legend = wrap.createDiv({ cls: "sbd-heat-legend" });
	legend.createSpan({ text: "less" });
	for (let i = 0; i <= 4; i++) legend.createSpan({ cls: `sbd-heat-swatch sbd-heat-${i}` });
	legend.createSpan({ text: "more" });
}

/** Horizontal bars in HTML: labels and values in text ink, the bar carries magnitude. */
export function hbars(parent: HTMLElement, rows: { label: string; value: number; note?: string }[], opts: { unit?: string } = {}): void {
	const wrap = parent.createDiv({ cls: "sbd-hbars" });
	const max = Math.max(1, ...rows.map((r) => r.value));
	for (const r of rows) {
		const row = wrap.createDiv({ cls: "sbd-hbar-row", attr: { "aria-label": `${r.label}: ${formatNum(r.value, opts.unit)}` } });
		row.createSpan({ cls: "sbd-hbar-label", text: r.label });
		const track = row.createDiv({ cls: "sbd-hbar-track" });
		const fill = track.createDiv({ cls: "sbd-hbar-fill" });
		fill.style.width = `${(r.value / max) * 100}%`;
		row.createSpan({ cls: "sbd-hbar-value", text: formatNum(r.value, opts.unit) + (r.note ? ` · ${r.note}` : "") });
	}
}

export function sparkline(parent: HTMLElement, values: (number | null)[], kind: "line" | "bar" = "bar"): void {
	const W = 120, H = 28;
	const max = Math.max(1, ...values.map((v) => v ?? 0));
	const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "sbd-spark", preserveAspectRatio: "none" }, parent);
	if (kind === "bar") {
		const slot = W / Math.max(values.length, 1);
		values.forEach((v, i) => {
			const h = ((v ?? 0) / max) * (H - 2);
			if (h > 0) svgEl("path", { d: barPath(i * slot + 1, H - h, Math.max(1, slot - 2), h), class: "sbd-bar" }, svg);
		});
	} else {
		// Lines scale min..max so small changes in a measurement (weight, sleep) stay visible.
		const vals = values.filter((v): v is number => v !== null);
		const lo = Math.min(...vals), hi = Math.max(...vals);
		const span = hi - lo || 1;
		// A sparkline is a gist: connect across missing days so sparse logs still draw a line.
		let d = "";
		values.forEach((v, i) => {
			if (v === null) return;
			d += `${d ? "L" : "M"}${(i / Math.max(values.length - 1, 1)) * W},${H - 2 - ((v - lo) / span) * (H - 4)}`;
		});
		svgEl("path", { d, class: "sbd-line", "vector-effect": "non-scaling-stroke" }, svg);
	}
}
