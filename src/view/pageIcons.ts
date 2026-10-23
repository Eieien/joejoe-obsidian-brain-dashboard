// Custom page icons: thin monoline glyphs drawn for this dashboard (32×32 grid),
// ink-coloured with one accent in the page's colour (var(--c)).

const SVG = "http://www.w3.org/2000/svg";

interface Glyph {
	/** Line work in the text colour. */
	lines: string[];
	/** Accent shapes in the page colour. */
	accent: { d?: string; circle?: [number, number, number]; fill?: boolean; opacity?: number }[];
}

const GLYPHS: Record<string, Glyph> = {
	home: {
		lines: ["M5 15.5 L16 6 L27 15.5", "M8 13 V25 a1.5 1.5 0 0 0 1.5 1.5 H22.5 a1.5 1.5 0 0 0 1.5 -1.5 V13"],
		accent: [{ d: "M13.5 26.5 V20 a2.5 2.5 0 0 1 5 0 V26.5", fill: true, opacity: 0.9 }],
	},
	inbox: {
		lines: ["M5 18 L9.2 8.5 a1.5 1.5 0 0 1 1.4 -1 H21.4 a1.5 1.5 0 0 1 1.4 1 L27 18 V24.5 a2 2 0 0 1 -2 2 H7 a2 2 0 0 1 -2 -2 Z", "M5 18 H11 L13 21 H19 L21 18 H27"],
		accent: [{ d: "M16 9.5 V15.5 M13.4 13 L16 15.6 L18.6 13" }],
	},
	tasks: {
		lines: ["M9.5 6 H22.5 a3.5 3.5 0 0 1 3.5 3.5 V22.5 a3.5 3.5 0 0 1 -3.5 3.5 H9.5 a3.5 3.5 0 0 1 -3.5 -3.5 V9.5 a3.5 3.5 0 0 1 3.5 -3.5 Z"],
		accent: [{ d: "M11 16.4 L14.6 20 L21.5 12" }],
	},
	calendar: {
		lines: ["M8 8.5 H24 a2 2 0 0 1 2 2 V24.5 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 V10.5 a2 2 0 0 1 2 -2 Z", "M6 13.5 H26", "M11 5.5 V10", "M21 5.5 V10", "M10.5 18 H12.5", "M15 18 H17"],
		accent: [{ circle: [20.5, 21.5, 2.4], fill: true }],
	},
	projects: {
		lines: ["M16 5.5 L27 11 L16 16.5 L5 11 Z", "M5 16 L16 21.5 L27 16", "M5 21 L16 26.5 L27 21"],
		accent: [{ d: "M16 5.5 L27 11 L16 16.5 L5 11 Z", fill: true, opacity: 0.35 }],
	},
	courses: {
		lines: ["M16 9.5 C13 7.6 9 7.4 5 8.4 V24.4 C9 23.4 13 23.6 16 25.5 C19 23.6 23 23.4 27 24.4 V8.4 C23 7.4 19 7.6 16 9.5 Z", "M16 9.5 V25.5"],
		accent: [{ d: "M20.5 8.2 V15 L22.5 13.4 L24.5 15 V8.1", fill: true }],
	},
	notes: {
		lines: ["M11.4 11.6 L14.4 20.6", "M20.9 10.9 L17.6 20.6", "M12.4 9.4 H19.6"],
		accent: [{ circle: [9.5, 9.5, 3] }, { circle: [22.5, 9.5, 3] }, { circle: [16, 23, 3.2], fill: true }],
	},
	trackers: {
		lines: ["M6 6 V26 H27", "M9.5 21 L14 15.5 L18 18.5 L24.5 10.5"],
		accent: [{ circle: [24.5, 10.5, 2.4], fill: true }],
	},
	review: {
		lines: ["M25.5 16 A9.5 9.5 0 1 1 22.6 9.2", "M23.2 4.8 V9.6 H18.4"],
		accent: [{ d: "M12.4 16.4 L15 19 L19.8 13.6" }],
	},
	library: {
		lines: ["M7 7.5 H11 V26 H7 Z", "M12.5 9.5 H16.5 V26 H12.5 Z", "M18.6 9.6 L22.4 8.6 L26.6 25.2 L22.8 26.2 Z", "M5 26.5 H28"],
		accent: [{ d: "M12.5 9.5 H16.5 V26 H12.5 Z", fill: true, opacity: 0.4 }],
	},
};

/** Draw the custom icon for a page into `el`. Returns false if there is none (caller falls back to Lucide). */
export function pageGlyph(el: HTMLElement, page: string): boolean {
	const g = GLYPHS[page];
	if (!g) return false;
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 32 32");
	svg.setAttribute("class", "sbd-picon");
	svg.setAttribute("aria-hidden", "true");
	for (const d of g.lines) {
		const p = document.createElementNS(SVG, "path");
		p.setAttribute("d", d);
		p.setAttribute("class", "sbd-picon-line");
		svg.appendChild(p);
	}
	for (const a of g.accent) {
		const el2 = a.circle ? document.createElementNS(SVG, "circle") : document.createElementNS(SVG, "path");
		if (a.circle) { el2.setAttribute("cx", String(a.circle[0])); el2.setAttribute("cy", String(a.circle[1])); el2.setAttribute("r", String(a.circle[2])); }
		else el2.setAttribute("d", a.d ?? "");
		el2.setAttribute("class", `sbd-picon-accent${a.fill ? " is-fill" : ""}`);
		if (a.opacity !== undefined) el2.setAttribute("style", `--o: ${a.opacity}`);
		svg.appendChild(el2);
	}
	el.empty();
	el.appendChild(svg);
	return true;
}
