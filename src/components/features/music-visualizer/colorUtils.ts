// 音乐页配色工具：颜色空间转换、从基础色/色相推导整套可视化调色板，
// 以及用 canvas 从专辑封面提取主色。
//
// 封面取色依赖图片允许跨域：Meting 的 pic 端点与网易 CDN 都会返回
// Access-Control-Allow-Origin，因此用 crossOrigin="anonymous" 加载后
// 可以安全地读像素；一旦任一环节失败（CORS、图片 404、canvas 被污染），
// 统一返回 null，由调用方回退到主题色。

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface Hsl {
	/** 色相，0–1 */
	h: number;
	/** 饱和度，0–1 */
	s: number;
	/** 亮度，0–1 */
	l: number;
}

// 可视化用的一整套颜色。与 ThreeScene 的 uniform 一一对应。
export interface VizPalette {
	/** UI 强调色：进度条、滑块、描边、按钮激活态 */
	accent: string;
	coolCore: string;
	coolEdge: string;
	warmCore: string;
	warmEdge: string;
	rippleCool: string;
	rippleWarm: string;
}

// 兜底调色板：青蓝，等同原先的 Ocean 预设。
export const FALLBACK_PALETTE: VizPalette = {
	accent: "#27e2ff",
	coolCore: "#16b8c9",
	coolEdge: "#69dce7",
	warmCore: "#8be8ee",
	warmEdge: "#d9ffff",
	rippleCool: "#3bcbd9",
	rippleWarm: "#d9ffff",
};

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/** 解析 #rgb / #rrggbb，非法输入返回 null。 */
export function parseHex(hex: string): Rgb | null {
	if (typeof hex !== "string") return null;
	const value = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) return null;
	const full =
		value.length === 3
			? value
					.split("")
					.map((c) => c + c)
					.join("")
			: value;
	const num = Number.parseInt(full, 16);
	return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function hexToRgb(hex: string): Rgb {
	return parseHex(hex) ?? { r: 39, g: 226, b: 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
	const to = (v: number) =>
		clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return { h: 0, s: 0, l };
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
	else if (max === gn) h = ((bn - rn) / d + 2) / 6;
	else h = ((rn - gn) / d + 4) / 6;
	return { h, s, l };
}

/** h/s/l 均为 0–1，返回 0–255 的 rgb。 */
export function hslToRgb(h: number, s: number, l: number): Rgb {
	const hh = ((h % 1) + 1) % 1;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + hh * 12) % 12;
		return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
	};
	return {
		r: Math.round(f(0) * 255),
		g: Math.round(f(8) * 255),
		b: Math.round(f(4) * 255),
	};
}

export function hslToHex(h: number, s: number, l: number): string {
	return rgbToHex(hslToRgb(h, s, l));
}

export function css(rgb: Rgb, alpha: number): string {
	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// 把任意基础色规范化成「足够鲜艳」的色相/饱和度/亮度，再铺开成整套调色板。
// 封面提取出来的主色常常偏灰或偏暗，直接拿来当强调色会显得脏，
// 所以这里对 s / l 做一次抬升与夹紧。
export function paletteFromBase(baseHex: string): VizPalette {
	const { h, s, l } = rgbToHsl(hexToRgb(baseHex));
	const sat = clamp(s < 0.12 ? 0.62 : s, 0.5, 0.95);
	const light = clamp(l, 0.48, 0.66);

	const accent = hslToHex(h, sat, light);
	const warmCore = hslToHex(h + 0.08, sat * 0.95, clamp(light * 0.98, 0.42, 0.62));
	const warmEdge = hslToHex(h + 0.14, sat * 0.85, clamp(light + 0.22, 0.68, 0.88));

	return {
		accent,
		coolCore: accent,
		coolEdge: hslToHex(h, sat * 0.9, clamp(light + 0.2, 0.66, 0.86)),
		warmCore,
		warmEdge,
		rippleCool: accent,
		rippleWarm: warmEdge,
	};
}

// 由博客全局主题色相（--hue，0–360）推导调色板。
// 音乐页背景是纯黑，所以取比博客正文更高的亮度，保证对比度。
export function paletteFromHue(hueDeg: number): VizPalette {
	const h = (((Number.isFinite(hueDeg) ? hueDeg : 250) % 360) + 360) % 360 / 360;
	const accent = hslToHex(h, 0.8, 0.62);
	return {
		accent,
		coolCore: accent,
		coolEdge: hslToHex(h, 0.75, 0.78),
		warmCore: hslToHex(h + 0.08, 0.78, 0.6),
		warmEdge: hslToHex(h + 0.14, 0.7, 0.82),
		rippleCool: accent,
		rippleWarm: hslToHex(h + 0.14, 0.7, 0.82),
	};
}

// 从像素里挑主色：按色相分桶，用「饱和度 × 中间亮度权重」累加，
// 跳过接近灰阶与死黑死白的像素，最后取权重最高的桶做加权平均。
function dominantFromPixels(data: Uint8ClampedArray): string | null {
	const BUCKETS = 36;
	const buckets = Array.from({ length: BUCKETS }, () => ({
		w: 0,
		r: 0,
		g: 0,
		b: 0,
	}));

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 200) continue;
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const { h, s, l } = rgbToHsl({ r, g, b });
		if (s < 0.18) continue;
		if (l < 0.12 || l > 0.92) continue;
		// 亮度离 0.55 越远权重越低，避免高光与阴影主导结果
		const w = s * (1 - Math.abs(l - 0.55) * 1.4);
		if (w <= 0) continue;
		const idx = clamp(Math.floor(h * BUCKETS), 0, BUCKETS - 1);
		const bk = buckets[idx];
		bk.w += w;
		bk.r += r * w;
		bk.g += g * w;
		bk.b += b * w;
	}

	let best: (typeof buckets)[number] | null = null;
	for (const bk of buckets) {
		if (bk.w > 0 && (!best || bk.w > best.w)) best = bk;
	}
	if (!best) return null;
	return rgbToHex({
		r: best.r / best.w,
		g: best.g / best.w,
		b: best.b / best.w,
	});
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		// 必须带这个属性，否则 canvas 会被跨域图片污染，getImageData 抛错
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`cover load failed: ${url}`));
		img.src = url;
	});
}

/**
 * 从封面图提取主色。任何一步失败都返回 null（调用方回退到主题色）。
 * 图片先缩到 48×48 再统计，既快又能自然平滑掉噪点。
 */
export async function extractCoverColor(
	url: string | null | undefined,
): Promise<string | null> {
	if (!url || typeof document === "undefined") return null;
	try {
		const img = await loadImage(url);
		const size = 48;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0, size, size);
		const { data } = ctx.getImageData(0, 0, size, size);
		return dominantFromPixels(data);
	} catch {
		// 跨域被拒 / 图片加载失败 / 解码失败，一律静默回退
		return null;
	}
}
