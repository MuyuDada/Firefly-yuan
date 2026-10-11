// 音乐页可视化的用户设置：律动强度 / 主题颜色 / 多彩循环 / 歌词动画。
// 以 Svelte 5 runes 模块实现全局共享状态，VisualizerControls（菜单 UI）与
// ThreeScene（渲染）都从这里读写；改动持久化到 localStorage。

export interface VizColorPreset {
	id: string;
	label: string;
	// UI 强调色（进度条、滑块、描边等）
	accent: string;
	coolCore: string;
	coolEdge: string;
	warmCore: string;
	warmEdge: string;
	rippleCool: string;
	rippleWarm: string;
}

export const VIZ_COLOR_PRESETS: VizColorPreset[] = [
	{
		id: "ocean",
		label: "Ocean",
		accent: "#27e2ff",
		coolCore: "#16b8c9",
		coolEdge: "#69dce7",
		warmCore: "#8be8ee",
		warmEdge: "#d9ffff",
		rippleCool: "#3bcbd9",
		rippleWarm: "#d9ffff",
	},
	{
		id: "aurora",
		label: "Aurora",
		accent: "#4ade80",
		coolCore: "#22c55e",
		coolEdge: "#86efac",
		warmCore: "#a3e635",
		warmEdge: "#ecfccb",
		rippleCool: "#4ade80",
		rippleWarm: "#d9f99d",
	},
	{
		id: "sunset",
		label: "Sunset",
		accent: "#fb923c",
		coolCore: "#f97316",
		coolEdge: "#fdba74",
		warmCore: "#f43f5e",
		warmEdge: "#fecdd3",
		rippleCool: "#fb923c",
		rippleWarm: "#fda4af",
	},
	{
		id: "violet",
		label: "Violet",
		accent: "#a78bfa",
		coolCore: "#7c3aed",
		coolEdge: "#c4b5fd",
		warmCore: "#d946ef",
		warmEdge: "#f5d0fe",
		rippleCool: "#a78bfa",
		rippleWarm: "#e879f9",
	},
	{
		id: "rose",
		label: "Rose",
		accent: "#f472b6",
		coolCore: "#ec4899",
		coolEdge: "#f9a8d4",
		warmCore: "#fb7185",
		warmEdge: "#fecdd3",
		rippleCool: "#f472b6",
		rippleWarm: "#fda4af",
	},
	{
		id: "gold",
		label: "Gold",
		accent: "#fbbf24",
		coolCore: "#d97706",
		coolEdge: "#fcd34d",
		warmCore: "#f59e0b",
		warmEdge: "#fef3c7",
		rippleCool: "#fbbf24",
		rippleWarm: "#fde68a",
	},
];

export const DEFAULT_PRESET_ID: string = VIZ_COLOR_PRESETS[0].id;

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

function loadPersisted(): {
	intensity: number;
	presetId: string;
	rainbow: boolean;
	lyricMode: string;
} | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		return parsed;
	} catch {
		return null;
	}
}

const persisted = loadPersisted();

function clampIntensity(v: unknown): number {
	const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
	return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, n));
}

function normalizePresetId(v: unknown): string {
	return VIZ_COLOR_PRESETS.some((p) => p.id === v)
		? (v as string)
		: DEFAULT_PRESET_ID;
}

function normalizeLyricMode(v: unknown): LyricMode {
	return LYRIC_MODES.some((m) => m.id === v)
		? (v as LyricMode)
		: DEFAULT_LYRIC_MODE;
}

export const vizSettings: {
	intensity: number;
	presetId: string;
	rainbow: boolean;
	lyricMode: LyricMode;
} = $state({
	intensity: clampIntensity(persisted?.intensity),
	presetId: normalizePresetId(persisted?.presetId),
	rainbow: persisted?.rainbow === true,
	lyricMode: normalizeLyricMode(persisted?.lyricMode),
});

export function persistVizSettings(): void {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				intensity: vizSettings.intensity,
				presetId: vizSettings.presetId,
				rainbow: vizSettings.rainbow,
				lyricMode: vizSettings.lyricMode,
			}),
		);
	} catch {
		/* localStorage 不可用时静默忽略 */
	}
}

export function getColorPreset(id: string): VizColorPreset {
	return VIZ_COLOR_PRESETS.find((p) => p.id === id) ?? VIZ_COLOR_PRESETS[0];
}
