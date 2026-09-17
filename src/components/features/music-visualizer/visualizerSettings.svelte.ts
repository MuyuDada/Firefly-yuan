// 音乐页可视化的用户设置：律动强度 / 主题颜色 / 多彩循环。
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

export const DEFAULT_PRESET_ID = VIZ_COLOR_PRESETS[0].id;

// 律动强度：1 为默认（与原效果一致），范围 0–2.5
export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 2.5;

const STORAGE_KEY = "firefly-mv-settings";

function loadPersisted(): { intensity: number; presetId: string; rainbow: boolean } | null {
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
	return VIZ_COLOR_PRESETS.some((p) => p.id === v) ? (v as string) : DEFAULT_PRESET_ID;
}

export const vizSettings = $state({
	intensity: clampIntensity(persisted?.intensity),
	presetId: normalizePresetId(persisted?.presetId),
	rainbow: persisted?.rainbow === true,
});

export function persistVizSettings() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				intensity: vizSettings.intensity,
				presetId: vizSettings.presetId,
				rainbow: vizSettings.rainbow,
			}),
		);
	} catch {
		/* localStorage 不可用时静默忽略 */
	}
}

export function getColorPreset(id: string): VizColorPreset {
	return VIZ_COLOR_PRESETS.find((p) => p.id === id) ?? VIZ_COLOR_PRESETS[0];
}
