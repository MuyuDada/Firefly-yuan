// Material 3 配色方案（Color Style / Color Spec）类型定义
// 移植自 Shirone 主题的设置面板，算法来自 Google 官方
// @material/material-color-utilities

// Color Style：M3 DynamicScheme 的 variant（9 种，与 Shirone 完全一致）
export type ColorStyle =
	| "tonalSpot" // 默认，Material You 在 Android 12/13 的默认风格
	| "vibrant"
	| "content"
	| "expressive"
	| "rainbow"
	| "fruitSalad"
	| "monochrome"
	| "neutral"
	| "fidelity";

// Color Spec：M3 规范版本（2021 / 2025），决定同一 variant 下的色阶约束
export type ColorSpec = "2021" | "2025";

export type ColorSchemeConfig = {
	// 是否启用 Color Style / Color Spec 两项设置
	enable: boolean;

	// 默认的配色风格（用户未在设置面板选择过时生效）
	defaultStyle: ColorStyle;

	// 默认的配色规范版本
	defaultSpec: ColorSpec;

	// 由主题色相推导 M3 源色时的色度（chroma）。
	// Shirone 固定使用 60，保证同一色相下生成的种子色一致。
	sourceChroma: number;

	// 由主题色相推导 M3 源色时的明度/色调（tone）。Shirone 固定使用 50。
	sourceTone: number;

	// 是否把生成的 M3 角色色映射到 Firefly 的语义变量
	// （--primary / --page-bg / --card-bg / --muted 等）。
	// 关闭时仅输出 --mc-* 角色变量，站点外观保持 Firefly 原有 oklch 体系。
	applyToTheme: boolean;
};

// Background Texture 类型
export type TexturePreset =
	| "none"
	| "starlight"
	| "cyber-dots"
	| "topography"
	| "geometric"
	| "sakura";

export type TextureConfig = {
	// 是否启用 Background Texture 设置
	enable: boolean;

	// 默认纹理预设
	defaultPreset: TexturePreset;

	// 默认不透明度（0–1），Shirone 为 0.12
	defaultOpacity: number;

	// 是否允许纹理浮动/流动动画（关闭或系统 reduced-motion 时静止）
	allowMotion: boolean;
};
