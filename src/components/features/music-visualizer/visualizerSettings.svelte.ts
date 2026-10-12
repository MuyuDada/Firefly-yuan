// 音乐页可视化的用户设置：律动强度 / 主题色模式 / 歌词动画。
// 以 Svelte 5 runes 模块实现全局共享状态，VisualizerControls（菜单 UI）与
// ThreeScene（渲染）都从这里读写；改动持久化到 localStorage。
//
// 主题色不再是一组固定预设，而是三种「取色来源」：
//   cover   自动从当前专辑封面提取主色
//   theme   跟随博客全局主题色（:root 的 --hue）
//   rainbow 色相随时间循环流动
// 具体解析在 MusicVisualizer 里完成，结果写进下面的 vizPalette，
// ThreeScene 只负责消费。

import { FALLBACK_PALETTE, type VizPalette } from "./colorUtils";

export type ColorMode = "cover" | "theme" | "rainbow";

export const COLOR_MODES: ColorMode[] = ["cover", "theme", "rainbow"];

export const DEFAULT_COLOR_MODE: ColorMode = "cover";

// 律动强度：1 为默认（与原效果一致），范围 0–2.5
export const INTENSITY_MIN: number = 0;
export const INTENSITY_MAX: number = 2.5;

// 歌词动画模式：五种观感，共用同一份 LRC 数据与 DOM 结构，
// 只切换容器上的 data-lyric-mode，由 CSS 决定逐字动效的表现形式。
// sonnet（商籁）是唯一的「排版向」模式：除逐字动效外还会重排当前行，
// 挑出关键词放大，并给整行叠上色差与重影，接近文字 PV 的观感。
export type LyricMode = "scan" | "flow" | "breathe" | "cascade" | "sonnet";

export interface LyricModeOption {
	id: LyricMode;
	label: string;
}

export const LYRIC_MODES: LyricModeOption[] = [
	{ id: "scan", label: "Scan" },
	{ id: "flow", label: "Flow" },
	{ id: "breathe", label: "Breathe" },
	{ id: "cascade", label: "Cascade" },
	{ id: "sonnet", label: "Sonnet" },
];

// 商籁的段落切分阈值：相邻两行间隔超过这个秒数就视为换段，
// 用来给段落交界处补一次「转场」动画（模糊 + 错位抖动）。
export const SONNET_PARAGRAPH_GAP: number = 2.4;

export const DEFAULT_LYRIC_MODE: LyricMode = "scan";

const STORAGE_KEY = "firefly-mv-settings";

function loadPersisted(): Record<string, unknown> | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

const persisted = loadPersisted();

function clampIntensity(v: unknown): number {
	const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
	return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, n));
}

function normalizeLyricMode(v: unknown): LyricMode {
	return LYRIC_MODES.some((m) => m.id === v)
		? (v as LyricMode)
		: DEFAULT_LYRIC_MODE;
}

// 兼容旧版本存储：以前存的是 presetId + rainbow 布尔。
// 开了多彩循环的迁移到 rainbow，其余一律走新的默认值（封面取色）。
function normalizeColorMode(v: unknown, legacy: Record<string, unknown> | null): ColorMode {
	if (COLOR_MODES.includes(v as ColorMode)) return v as ColorMode;
	if (legacy?.rainbow === true) return "rainbow";
	return DEFAULT_COLOR_MODE;
}

export const vizSettings: {
	intensity: number;
	colorMode: ColorMode;
	lyricMode: LyricMode;
} = $state({
	intensity: clampIntensity(persisted?.intensity),
	colorMode: normalizeColorMode(persisted?.colorMode, persisted),
	lyricMode: normalizeLyricMode(persisted?.lyricMode),
});

// 当前生效的调色板。由 MusicVisualizer 的解析器写入，ThreeScene 读取。
// rainbow 为 true 时忽略 palette，改由渲染循环按时间旋转色相。
export const vizPalette: { palette: VizPalette; rainbow: boolean } = $state({
	palette: FALLBACK_PALETTE,
	rainbow: false,
});

export function persistVizSettings(): void {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				intensity: vizSettings.intensity,
				colorMode: vizSettings.colorMode,
				lyricMode: vizSettings.lyricMode,
			}),
		);
	} catch {
		/* localStorage 不可用时静默忽略 */
	}
}
