// Film-grain texture for the animated background noise: a small random tile,
// generated once and reused as a repeating background image.

let tile: string | null = null;

export function noiseTile(): string {
	if (tile) return tile;
	const size = 160;
	const c = document.createElement("canvas");
	c.width = c.height = size;
	const g = c.getContext("2d");
	if (!g) return "";
	const img = g.createImageData(size, size);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const v = Math.random() * 255;
		d[i] = d[i + 1] = d[i + 2] = v;
		d[i + 3] = Math.random() * 255;
	}
	g.putImageData(img, 0, 0);
	tile = c.toDataURL("image/png");
	return tile;
}
