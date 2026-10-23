// Default cover for the split-panel header (when no image is set): a mountain landscape,
// drawn once on a canvas (deterministic) and cached as a data URL.

const CACHE_KEY = "sbd-landscape-v1";
let cached: string | null = null;

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Smooth 1-D noise from a few sines, enough for ridge lines. */
function ridge(x: number, seed: number, amp: number[]): number {
	let y = 0;
	amp.forEach((a, i) => { y += a * Math.sin(x * (0.004 * (i + 1) ** 1.7) + seed * (i + 3.1)); });
	return y;
}

export function landscapeCover(): string {
	if (cached) return cached;
	try { cached = window.localStorage.getItem(CACHE_KEY); } catch { /* storage unavailable */ }
	if (cached) return cached;
	// Drawn in 1600×520 coordinates onto a 75%-size canvas (lighter, still crisp in the panels).
	const W = 1600, H = 520, SCALE = 0.75;
	const c = document.createElement("canvas");
	c.width = W * SCALE; c.height = H * SCALE;
	const g = c.getContext("2d");
	if (!g) return "";
	const r = rng(20261022);
	g.scale(SCALE, SCALE);

	// Sky
	const sky = g.createLinearGradient(0, 0, 0, H * 0.65);
	sky.addColorStop(0, "#9c9c9c");
	sky.addColorStop(0.55, "#d6d6d6");
	sky.addColorStop(1, "#bdbdbd");
	g.fillStyle = sky;
	g.fillRect(0, 0, W, H);

	// Clouds: soft blobs
	for (let i = 0; i < 26; i++) {
		const x = r() * W, y = r() * H * 0.32, rad = 60 + r() * 160;
		const cg = g.createRadialGradient(x, y, 0, x, y, rad);
		cg.addColorStop(0, `rgba(250,250,250,${0.35 + r() * 0.3})`);
		cg.addColorStop(1, "rgba(250,250,250,0)");
		g.fillStyle = cg;
		g.beginPath(); g.ellipse(x, y, rad * 1.8, rad * 0.6, 0, 0, Math.PI * 2); g.fill();
	}

	// The mountain: concave cone with a snow cap
	const px = W * 0.47, py = H * 0.17, base = H * 0.66, half = W * 0.46;
	const slope = (t: number) => py + (base - py) * (1 - (1 - t) ** 2.1); // t: 0 at peak → 1 at base
	g.beginPath();
	g.moveTo(px - half, base);
	for (let i = 0; i <= 60; i++) { const t = 1 - i / 60; g.lineTo(px - half * t - 18 * (1 - t), slope(t)); }
	g.lineTo(px + 18, py);
	for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(px + 18 + half * t, slope(t)); }
	g.closePath();
	const mg = g.createLinearGradient(0, py, 0, base);
	mg.addColorStop(0, "#7a7a7a"); mg.addColorStop(1, "#5a5a5a");
	g.fillStyle = mg; g.fill();

	// Snow: white above a jagged line
	g.save();
	g.clip();
	const snowY = py + (base - py) * 0.26;
	g.beginPath();
	g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, snowY);
	for (let x = W; x >= 0; x -= 14) g.lineTo(x, snowY + (r() - 0.3) * 34 + Math.abs(x - px) * 0.05);
	g.closePath();
	const sg = g.createLinearGradient(px - 200, 0, px + 200, 0);
	sg.addColorStop(0, "#d0d0d0"); sg.addColorStop(0.5, "#f7f7f7"); sg.addColorStop(1, "#e2e2e2");
	g.fillStyle = sg; g.fill();
	// shadow streaks down the slope
	g.strokeStyle = "rgba(60,60,60,0.25)";
	for (let i = 0; i < 40; i++) {
		const x0 = px + (r() - 0.5) * 120;
		g.lineWidth = 1 + r() * 2;
		g.beginPath(); g.moveTo(x0, py + 10); g.lineTo(x0 + (x0 - px) * 3.5, snowY + 60 + r() * 50); g.stroke();
	}
	g.restore();

	// Mist band over the base
	const mist = g.createLinearGradient(0, H * 0.5, 0, H * 0.72);
	mist.addColorStop(0, "rgba(220,220,220,0)"); mist.addColorStop(1, "rgba(220,220,220,0.75)");
	g.fillStyle = mist; g.fillRect(0, H * 0.5, W, H * 0.22);

	// Ridges, far → near
	const layers = [
		{ y: 0.66, amp: [18, 10, 5], col: "#8a8a8a" },
		{ y: 0.74, amp: [26, 14, 8], col: "#5c5c5c" },
		{ y: 0.84, amp: [30, 18, 9], col: "#333" },
	];
	layers.forEach((L, li) => {
		g.beginPath(); g.moveTo(0, H);
		for (let x = 0; x <= W; x += 8) g.lineTo(x, H * L.y + ridge(x, li + 1, L.amp));
		g.lineTo(W, H); g.closePath();
		g.fillStyle = L.col; g.fill();
		// tree texture
		const n = 900 + li * 600;
		for (let i = 0; i < n; i++) {
			const x = r() * W, top = H * L.y + ridge(x, li + 1, L.amp);
			const y = top + r() * (H - top);
			const s = (1.5 + r() * 3) * (li + 1);
			g.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.22)";
			g.beginPath(); g.ellipse(x, y, s, s * 0.8, 0, 0, Math.PI * 2); g.fill();
		}
	});

	// A pagoda roofline on the right, like a temple in the foreground
	g.fillStyle = "#151515";
	const bx = W * 0.86, by = H * 0.52;
	const roof = (y: number, w: number, h: number) => {
		g.beginPath();
		g.moveTo(bx - w, y + h);
		g.quadraticCurveTo(bx - w * 0.55, y + h * 0.35, bx - w * 0.22, y);
		g.lineTo(bx + w * 0.22, y);
		g.quadraticCurveTo(bx + w * 0.55, y + h * 0.35, bx + w, y + h);
		g.closePath(); g.fill();
	};
	g.fillRect(bx - 70, by, 140, H - by);
	roof(by - 30, 150, 34);
	g.fillRect(bx - 52, by - 92, 104, 64);
	roof(by - 120, 120, 30);
	g.fillRect(bx - 36, by - 170, 72, 52);
	roof(by - 196, 92, 28);
	g.fillRect(bx - 3, by - 240, 6, 46);

	// Film grain
	const img = g.getImageData(0, 0, c.width, c.height);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const n = (r() - 0.5) * 22;
		const v = Math.max(0, Math.min(255, (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) + n));
		d[i] = d[i + 1] = d[i + 2] = v;
	}
	g.putImageData(img, 0, 0);

	cached = c.toDataURL("image/jpeg", 0.85);
	try { window.localStorage.setItem(CACHE_KEY, cached); } catch { /* quota exceeded: fine, redraw next time */ }
	return cached;
}
