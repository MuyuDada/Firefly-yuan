// 把 Firefly 音乐页的 vizPalette / vizSettings 推导成 folia 主题色。
// folia 的 Theme 由用户选的主题决定；这里改为跟随音乐页现有的封面取色 / 博客主题色 /
// 多彩循环三种取色来源（见 MusicVisualizer 的调色板解析），全屏歌词与地形场景保持同源配色。

import type { VizPalette } from "../colorUtils";
import { colorWithAlpha, mixColors } from "./colorMix";
import type { FoliaAnimationIntensity, FoliaTheme } from "./types";

/** 律动强度（0–2.5）映射到 folia 的三档动画强度档位。 */
const resolveIntensity = (intensity: number): FoliaAnimationIntensity => {
	if (intensity <= 0.6) return "calm";
	if (intensity <= 1.6) return "normal";
	return "chaotic";
};

const DEFAULT_FONT_FAMILY =
	"'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

export const buildFoliaTheme = (
	palette: VizPalette,
	intensity: number,
): FoliaTheme => {
	const accent = palette.accent;
	return {
		name: "firefly",
		backgroundColor: "transparent",
		// 正文近白微透，激活词走主题强调色，与 folia 默认主题的白字彩光观感一致。
		primaryColor: "rgba(255, 255, 255, 0.92)",
		accentColor: accent,
		secondaryColor: colorWithAlpha(mixColors(accent, "#ffffff", 0.45), 0.78),
		animationIntensity: resolveIntensity(intensity),
		wordColors: [],
		fontWeight: 700,
		fontFamily: DEFAULT_FONT_FAMILY,
	};
};
