// folia 全屏歌词主题的共享类型。
// 对应 folia-web 的 Theme + VisualizerSharedProps，裁剪成 Firefly 实际传递的字段。

import type { Line } from "@/utils/lyrics";
import type { LyricClock } from "./lyricClock";

export type FoliaAnimationIntensity = "calm" | "normal" | "chaotic";

/** 从 vizPalette 推导出的主题色，替代 folia 的 Theme。 */
export interface FoliaTheme {
	name: string;
	backgroundColor: string;
	/** 歌词正文的基础色（通常近白）。 */
	primaryColor: string;
	/** 激活词 / 发光 / 涟漪的强调色。 */
	accentColor: string;
	/** 字幕、空状态等次要文字的颜色。 */
	secondaryColor: string;
	animationIntensity: FoliaAnimationIntensity;
	wordColors: { word: string; color: string }[];
	/** 字体粗细（folia 的主题字重，Firefly 固定 700 起步）。 */
	fontWeight: number;
	/** 字体栈（跟随博客全局字体）。 */
	fontFamily: string;
}

/** 每个主题组件接收的共享 props（folia 的 VisualizerSharedProps 精简版）。 */
export interface FoliaVisualizerProps {
	clock: LyricClock;
	/** 当前生效行下标（-1 = 间奏/无行），由外壳按时钟更新。 */
	currentLineIndex: number;
	lines: Line[];
	theme: FoliaTheme;
	/** 出场文字是否可见（窗口覆盖模式用；Firefly 恒为 true，保留以对齐 folia 契约）。 */
	showText?: boolean;
	/** 主题词高亮倍率（folia 歌词字号倍率，设置面板可调时由外壳传入）。 */
	lyricsFontScale?: number;
	/** 音频频段读取（folia 的 audioBands）：低音 / 人声中频，0..1。需要音频脉冲的主题使用。 */
	getBands?: () => { bass: number; vocal: number };
}
