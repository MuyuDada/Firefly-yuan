// Color Style / Color Spec / Background Texture 运行时工具
// 移植自 Shirone（https://shirone.mysqil.com/）的主题设置，配色算法直接使用
// Google 官方 @material/material-color-utilities，保证与参考站结果一致。
//
// 与 Shirone 的差异（适配 Firefly）：
// - Shirone 把 M3 角色写进 --mc-* 变量并让全站样式消费这些变量；
//   Firefly 的样式体系建立在 --hue + oklch() 之上，因此这里除了输出 --mc-* 角色变量，
//   还额外把关键角色映射到 Firefly 的语义变量（--primary / --page-bg / --card-bg 等），
//   这样 Color Style / Color Spec 才能真正改变站点观感。
// - 纹理预设的 background 使用 Firefly 既有的 --primary/--secondary/--tertiary，
//   由本模块在应用配色时一并写入这三个别名变量。

import type { Platform } from "@material/material-color-utilities";
import {
	Hct,
	hexFromArgb,
	MaterialDynamicColors,
	SchemeContent,
	SchemeExpressive,
	SchemeFidelity,
	SchemeFruitSalad,
	SchemeMonochrome,
	SchemeNeutral,
	SchemeRainbow,
	SchemeTonalSpot,
	SchemeVibrant,
} from "@material/material-color-utilities";

import { colorSchemeConfig, textureConfig } from "@/config";
import type {
	ColorSchemeConfig,
	ColorSpec,
	ColorStyle,
	TexturePreset,
} from "@/types/colorSchemeConfig";

// ── localStorage key（与 Shirone 保持一致，便于对照调试）──────────────
export const COLOR_STYLE_KEY = "mc-style";
export const COLOR_SPEC_KEY = "mc-spec";
export const TEXTURE_PRESET_KEY = "texture-preset";
export const TEXTURE_OPACITY_KEY = "texture-opacity";
// 已生成的配色缓存：Layout 首帧内联脚本读它，避免刷新时闪一下 Firefly 原生配色。
// 内联脚本无法 import 本模块，所以签名的拼接格式必须与 colorSchemeSignature() 保持一致。
export const SCHEME_CACHE_KEY = "mc-scheme-cache";

/**
 * 配色缓存签名：色相 / 风格 / 规范 / 明暗 任一变化都会让它失效。
 * ⚠️ Layout.astro 的首帧内联脚本里有一份等价的字符串拼接，改动此处需同步修改。
 */
export function colorSchemeSignature(
	style: ColorStyle,
	spec: ColorSpec,
	dark: boolean,
	hue: number,
): string {
	return `${style}|${spec}|${dark ? "dark" : "light"}|${hue}`;
}

type SchemeCache = { sig: string; vars: Record<string, string> };

/** 把生成结果写进 localStorage，供首帧内联脚本直接回放 */
function writeSchemeCache(sig: string, vars: Record<string, string>): void {
	if (!isBrowser() || !window.localStorage) return;
	try {
		localStorage.setItem(
			SCHEME_CACHE_KEY,
			JSON.stringify({ sig, vars } satisfies SchemeCache),
		);
	} catch {
		// 隐私模式 / 超出配额：缓存只是首帧优化，失败不影响功能
	}
}

// Color Style 的展示顺序，与 Shirone 的 3 列网格一致
export const COLOR_STYLE_ORDER: ColorStyle[] = [
	"tonalSpot",
	"vibrant",
	"content",
	"expressive",
	"rainbow",
	"fruitSalad",
	"monochrome",
	"neutral",
	"fidelity",
];

export const COLOR_SPEC_ORDER: ColorSpec[] = ["2021", "2025"];

export const TEXTURE_PRESET_ORDER: TexturePreset[] = [
	"none",
	"starlight",
	"cyber-dots",
	"topography",
	"geometric",
	"sakura",
];

// M3 角色 → CSS 变量名映射，与 Shirone 的 rt 映射表 1:1 对齐（51 项）
const ROLE_TO_VAR: Record<string, string> = {
	primary: "--mc-primary",
	onPrimary: "--mc-on-primary",
	primaryContainer: "--mc-primary-container",
	onPrimaryContainer: "--mc-on-primary-container",
	inversePrimary: "--mc-inverse-primary",
	primaryFixed: "--mc-primary-fixed",
	primaryFixedDim: "--mc-primary-fixed-dim",
	onPrimaryFixed: "--mc-on-primary-fixed",
	onPrimaryFixedVariant: "--mc-on-primary-fixed-variant",
	secondary: "--mc-secondary",
	onSecondary: "--mc-on-secondary",
	secondaryContainer: "--mc-secondary-container",
	onSecondaryContainer: "--mc-on-secondary-container",
	secondaryFixed: "--mc-secondary-fixed",
	secondaryFixedDim: "--mc-secondary-fixed-dim",
	onSecondaryFixed: "--mc-on-secondary-fixed",
	onSecondaryFixedVariant: "--mc-on-secondary-fixed-variant",
	tertiary: "--mc-tertiary",
	onTertiary: "--mc-on-tertiary",
	tertiaryContainer: "--mc-tertiary-container",
	onTertiaryContainer: "--mc-on-tertiary-container",
	tertiaryFixed: "--mc-tertiary-fixed",
	tertiaryFixedDim: "--mc-tertiary-fixed-dim",
	onTertiaryFixed: "--mc-on-tertiary-fixed",
	onTertiaryFixedVariant: "--mc-on-tertiary-fixed-variant",
	error: "--mc-error",
	onError: "--mc-on-error",
	errorContainer: "--mc-error-container",
	onErrorContainer: "--mc-on-error-container",
	surface: "--mc-surface",
	surfaceDim: "--mc-surface-dim",
	surfaceBright: "--mc-surface-bright",
	surfaceContainerLowest: "--mc-surface-container-lowest",
	surfaceContainerLow: "--mc-surface-container-low",
	surfaceContainer: "--mc-surface-container",
	surfaceContainerHigh: "--mc-surface-container-high",
	surfaceContainerHighest: "--mc-surface-container-highest",
	onSurface: "--mc-on-surface",
	surfaceVariant: "--mc-surface-variant",
	onSurfaceVariant: "--mc-on-surface-variant",
	outline: "--mc-outline",
	outlineVariant: "--mc-outline-variant",
	inverseSurface: "--mc-inverse-surface",
	inverseOnSurface: "--mc-inverse-on-surface",
	shadow: "--mc-shadow",
	scrim: "--mc-scrim",
	surfaceTint: "--mc-surface-tint",
	primaryDim: "--mc-primary-dim",
	secondaryDim: "--mc-secondary-dim",
	tertiaryDim: "--mc-tertiary-dim",
	errorDim: "--mc-error-dim",
};

// 9 种 variant → Scheme 类，与 Shirone 的 Zr() 分支顺序一致
const SCHEME_BY_STYLE: Record<
	ColorStyle,
	new (
		sourceColorHct: Hct,
		isDark: boolean,
		contrastLevel: number,
		specVersion?: ColorSpec,
		platform?: Platform,
	) => InstanceType<typeof SchemeTonalSpot>
> = {
	tonalSpot: SchemeTonalSpot,
	vibrant: SchemeVibrant,
	content: SchemeContent,
	expressive: SchemeExpressive,
	rainbow: SchemeRainbow,
	fruitSalad: SchemeFruitSalad,
	monochrome: SchemeMonochrome,
	neutral: SchemeNeutral,
	fidelity: SchemeFidelity,
};

type SchemeLike = {
	isDark: boolean;
	// MCU 的 DynamicScheme 内部结构；这里只做整体透传，不深究内部字段
};

function isBrowser(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

// ── 读取配置（带兜底，避免环境变量/配置缺失）────────────────────────
function readColorConfig(): ColorSchemeConfig {
	return colorSchemeConfig;
}

export function getDefaultColorStyle(): ColorStyle {
	const fallback = "tonalSpot";
	const style = readColorConfig()?.defaultStyle;
	return style && COLOR_STYLE_ORDER.includes(style) ? style : fallback;
}

export function getDefaultColorSpec(): ColorSpec {
	const fallback: ColorSpec = "2025";
	const spec = readColorConfig()?.defaultSpec;
	return spec && COLOR_SPEC_ORDER.includes(spec) ? spec : fallback;
}

export function getDefaultTexturePreset(): TexturePreset {
	const preset = textureConfig?.defaultPreset;
	return preset && TEXTURE_PRESET_ORDER.includes(preset) ? preset : "none";
}

export function getDefaultTextureOpacity(): number {
	const value = textureConfig?.defaultOpacity;
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: 0.12;
}

// ── localStorage 读写 ───────────────────────────────────────────────
function readStoredString(key: string): string | null {
	if (!isBrowser() || !window.localStorage) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function getColorStyle(): ColorStyle {
	const stored = readStoredString(COLOR_STYLE_KEY);
	return stored && COLOR_STYLE_ORDER.includes(stored as ColorStyle)
		? (stored as ColorStyle)
		: getDefaultColorStyle();
}

export function getColorSpec(): ColorSpec {
	const stored = readStoredString(COLOR_SPEC_KEY);
	return stored && COLOR_SPEC_ORDER.includes(stored as ColorSpec)
		? (stored as ColorSpec)
		: getDefaultColorSpec();
}

export function getTexturePreset(): TexturePreset {
	const stored = readStoredString(TEXTURE_PRESET_KEY);
	return stored && TEXTURE_PRESET_ORDER.includes(stored as TexturePreset)
		? (stored as TexturePreset)
		: getDefaultTexturePreset();
}

export function getTextureOpacity(): number {
	const stored = readStoredString(TEXTURE_OPACITY_KEY);
	if (stored === null) return getDefaultTextureOpacity();
	const parsed = Number.parseFloat(stored);
	return Number.isFinite(parsed)
		? Math.min(1, Math.max(0, parsed))
		: getDefaultTextureOpacity();
}

// ── 主题色相读取 ────────────────────────────────────────────────────
// Firefly 把色相存在 --hue 变量（:root inline style）与 localStorage 的 "hue"
function readCurrentHue(): number {
	// 优先读已应用的 CSS 变量，保证与当前渲染一致
	if (isBrowser()) {
		const inline = document.documentElement.style.getPropertyValue("--hue");
		const parsed = Number.parseFloat(inline);
		if (Number.isFinite(parsed)) return parsed;
		const computed = getComputedStyle(document.documentElement)
			.getPropertyValue("--hue")
			.trim();
		const computedParsed = Number.parseFloat(computed);
		if (Number.isFinite(computedParsed)) return computedParsed;
	}
	const stored = readStoredString("hue");
	const storedParsed = Number.parseFloat(stored ?? "");
	return Number.isFinite(storedParsed) ? storedParsed : 250;
}

function isDarkMode(): boolean {
	return isBrowser() && document.documentElement.classList.contains("dark");
}

// ── 核心：生成 M3 scheme 并写入 CSS 变量 ───────────────────────────
type ThemeVarMap = Record<string, string>;

/**
 * 按指定参数生成 M3 配色方案（纯函数，不读 DOM，供 SSR / 预览色板复用）。
 * @returns 角色名 → hex 颜色的映射
 */
export function buildSchemeVarsFor(
	style: ColorStyle,
	spec: ColorSpec,
	dark: boolean,
	hue: number,
): ThemeVarMap {
	const config = readColorConfig();
	const source = Hct.from(hue, config.sourceChroma, config.sourceTone);
	const SchemeClass = SCHEME_BY_STYLE[style] ?? SchemeTonalSpot;
	const scheme = new SchemeClass(source, dark, 0, spec);

	const result: ThemeVarMap = {};
	for (const [role, varName] of Object.entries(ROLE_TO_VAR)) {
		const dynamicColor = (
			MaterialDynamicColors as unknown as Record<
				string,
				{ getArgb: (s: SchemeLike) => number } | undefined
			>
		)[role];
		if (!dynamicColor) continue;
		const argb = dynamicColor.getArgb(scheme as unknown as SchemeLike);
		result[varName] = hexFromArgb(argb);
	}
	return result;
}

/**
 * 只为设置面板的色板预览生成 3 个代表色（primary / secondary / tertiary）。
 * 比 buildSchemeVarsFor 轻得多：9 种风格 × 3 色，避免面板渲染时算 9×51 个角色。
 */
export function buildSchemePreview(
	style: ColorStyle,
	spec: ColorSpec,
	dark: boolean,
	hue: number,
): { primary: string; secondary: string; tertiary: string } {
	const config = readColorConfig();
	const source = Hct.from(hue, config.sourceChroma, config.sourceTone);
	const SchemeClass = SCHEME_BY_STYLE[style] ?? SchemeTonalSpot;
	const scheme = new SchemeClass(
		source,
		dark,
		0,
		spec,
	) as unknown as SchemeLike;
	const pick = (name: string): string => {
		const dynamicColor = (
			MaterialDynamicColors as unknown as Record<
				string,
				{ getArgb: (s: SchemeLike) => number } | undefined
			>
		)[name];
		return dynamicColor
			? hexFromArgb(dynamicColor.getArgb(scheme))
			: "transparent";
	};
	return {
		primary: pick("primary"),
		secondary: pick("secondary"),
		tertiary: pick("tertiary"),
	};
}

/**
 * 按当前色相 / 明暗 / Color Style / Color Spec 生成 M3 配色方案。
 * @returns 角色名 → hex 颜色的映射
 */
export function buildColorScheme(): ThemeVarMap {
	return buildSchemeVarsFor(
		getColorStyle(),
		getColorSpec(),
		isDarkMode(),
		readCurrentHue(),
	);
}

/**
 * 把 M3 角色色映射到 Firefly 的语义变量，让配色真正作用于站点观感。
 * 只映射「改变配色风格时应随之变化」的变量，其余保持 Firefly 原始定义。
 */
function buildFireflyOverrides(
	map: ThemeVarMap,
	dark: boolean,
): Record<string, string> {
	const v = (name: string): string => map[`--mc-${name}`] ?? "";
	const overrides: Record<string, string> = {};

	// 主题色别名：纹理预设的渐变背景依赖这三个变量
	overrides["--primary"] = v("primary");
	overrides["--secondary"] = v("secondary");
	overrides["--tertiary"] = v("tertiary");

	// 页面与卡片底色
	overrides["--page-bg"] = v("surface");
	overrides["--card-bg"] = v("surface-container-low");
	overrides["--float-panel-bg"] = v("surface-container");

	// 按钮体系
	overrides["--btn-content"] = v("primary");
	overrides["--btn-regular-bg"] = v("secondary-container");
	overrides["--btn-regular-bg-hover"] = v("surface-container-high");
	overrides["--btn-regular-bg-active"] = v("surface-container-highest");
	overrides["--btn-plain-bg-hover"] = v("surface-container-high");
	overrides["--btn-plain-bg-active"] = v("surface-container-highest");
	overrides["--btn-card-bg-hover"] = v("surface-container-low");
	overrides["--btn-card-bg-active"] = v("surface-container-high");

	// 文本与分隔线
	overrides["--deep-text"] = v("on-surface");
	overrides["--title-active"] = v("primary");
	overrides["--muted"] = v("surface-container");
	overrides["--selection-bg"] = v("primary-container");
	overrides["--content-meta"] = v("on-surface-variant");
	overrides["--line-divider"] = v("outline-variant");
	overrides["--line-color"] = v("outline-variant");

	// 链接
	overrides["--link-underline"] = v("primary-container");
	overrides["--link-hover"] = v("secondary-container");
	overrides["--link-active"] = v("primary-container");

	// TOC
	overrides["--toc-badge-bg"] = v("secondary-container");
	overrides["--toc-btn-hover"] = v("surface-container-high");
	overrides["--toc-btn-active"] = v("surface-container-highest");
	overrides["--toc-indicator-bg"] = v("surface-container-high");
	overrides["--toc-item-active"] = v("primary");

	// 代码块（保持深色底，仅随风格微调）
	overrides["--codeblock-bg"] = dark ? v("surface-container-lowest") : "";
	overrides["--codeblock-topbar-bg"] = dark ? v("surface-container") : "";

	// 透明度类变量需要 rgb 通道值，M3 给的是 hex，这里转成 rgb(...) 形式
	const panelSurface = map["--mc-surface"] ?? "";
	const rgb = hexToRgbChannels(panelSurface);
	if (rgb) {
		overrides["--card-bg-transparent"] =
			`rgb(${rgb} / var(--card-transparent-opacity, 0.6))`;
	}

	return overrides;
}

function hexToRgbChannels(hex: string): string | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	const value = Number.parseInt(match[1], 16);
	const r = (value >> 16) & 255;
	const g = (value >> 8) & 255;
	const b = value & 255;
	return `${r} ${g} ${b}`;
}

/**
 * 应用 M3 配色：写入 --mc-* 角色变量，并（按配置）覆盖 Firefly 语义变量。
 * 幂等，可安全重复调用（主题切换 / 色相变化 / 风格切换时都需要重算）。
 */
export function applyColorScheme(): void {
	if (!isBrowser()) return;
	// 功能关闭时回到 Firefly 原生 oklch 配色（并清掉首帧缓存，避免下次刷新又被回放）
	if (colorSchemeConfig?.enable === false) {
		clearColorScheme();
		try {
			localStorage.removeItem(SCHEME_CACHE_KEY);
		} catch {
			// 隐私模式忽略
		}
		return;
	}
	const root = document.documentElement;
	const map = buildColorScheme();
	const applied: Record<string, string> = { ...map };

	if (readColorConfig()?.applyToTheme) {
		const dark = isDarkMode();
		for (const [varName, value] of Object.entries(
			buildFireflyOverrides(map, dark),
		)) {
			if (!value) continue;
			applied[varName] = value;
		}
	}

	for (const [varName, value] of Object.entries(applied)) {
		root.style.setProperty(varName, value);
	}

	// 缓存本次结果，供下次刷新的首帧内联脚本回放（见 Layout.astro）
	writeSchemeCache(
		colorSchemeSignature(
			getColorStyle(),
			getColorSpec(),
			isDarkMode(),
			readCurrentHue(),
		),
		applied,
	);
}

/**
 * 清除本模块写入的所有内联变量，回到 Firefly 原生 oklch 配色。
 * 用于关闭 Color Style 功能时还原站点外观。
 */
export function clearColorScheme(): void {
	if (!isBrowser()) return;
	const root = document.documentElement;
	for (const varName of Object.values(ROLE_TO_VAR)) {
		root.style.removeProperty(varName);
	}
	const fireflyVars = [
		"--primary",
		"--secondary",
		"--tertiary",
		"--page-bg",
		"--card-bg",
		"--card-bg-transparent",
		"--float-panel-bg",
		"--btn-content",
		"--btn-regular-bg",
		"--btn-regular-bg-hover",
		"--btn-regular-bg-active",
		"--btn-plain-bg-hover",
		"--btn-plain-bg-active",
		"--btn-card-bg-hover",
		"--btn-card-bg-active",
		"--deep-text",
		"--title-active",
		"--muted",
		"--selection-bg",
		"--content-meta",
		"--line-divider",
		"--line-color",
		"--link-underline",
		"--link-hover",
		"--link-active",
		"--toc-badge-bg",
		"--toc-btn-hover",
		"--toc-btn-active",
		"--toc-indicator-bg",
		"--toc-item-active",
		"--codeblock-bg",
		"--codeblock-topbar-bg",
	];
	for (const varName of fireflyVars) {
		root.style.removeProperty(varName);
	}
}

export function setColorStyle(style: ColorStyle): void {
	if (isBrowser() && window.localStorage) {
		try {
			localStorage.setItem(COLOR_STYLE_KEY, style);
		} catch {
			// 隐私模式下 localStorage 可能不可写，忽略
		}
	}
	// applyColorScheme 会重写 :root 的内联变量，
	// WavesEffect 等组件的 MutationObserver(style) 据此自动重新取色，无需额外派发事件
	applyColorScheme();
}

export function setColorSpec(spec: ColorSpec): void {
	if (isBrowser() && window.localStorage) {
		try {
			localStorage.setItem(COLOR_SPEC_KEY, spec);
		} catch {
			// 同上
		}
	}
	applyColorScheme();
}

/**
 * 重新计算并应用配色。用于色相变化 / 明暗切换后刷新 M3 方案。
 * 功能关闭时也会调用，以便及时清除已写入的内联变量。
 */
export function refreshColorScheme(): void {
	if (!isBrowser()) return;
	applyColorScheme();
}

// ── Background Texture ─────────────────────────────────────────────
/**
 * 应用纹理预设：写 html 的 data-texture-preset 与 --texture-opacity。
 * 具体纹理样式由 src/styles/texture.css 中的属性选择器接管。
 */
export function applyTexture(): void {
	if (!isBrowser()) return;
	const root = document.documentElement;
	const preset = textureConfig?.enable === false ? "none" : getTexturePreset();
	root.dataset.texturePreset = preset;
	root.style.setProperty("--texture-opacity", String(getTextureOpacity()));
}

export function setTexturePreset(preset: TexturePreset): void {
	if (isBrowser() && window.localStorage) {
		try {
			localStorage.setItem(TEXTURE_PRESET_KEY, preset);
		} catch {
			// 同上
		}
	}
	applyTexture();
}

export function setTextureOpacity(opacity: number): void {
	const clamped = Math.min(1, Math.max(0, opacity));
	if (isBrowser() && window.localStorage) {
		try {
			localStorage.setItem(TEXTURE_OPACITY_KEY, String(clamped));
		} catch {
			// 同上
		}
	}
	if (isBrowser()) {
		document.documentElement.style.setProperty(
			"--texture-opacity",
			String(clamped),
		);
	}
}

/**
 * 一次性应用配色与纹理。供 Layout 首屏脚本与设置面板调用。
 */
export function applyColorAndTexture(): void {
	applyColorScheme();
	applyTexture();
}
