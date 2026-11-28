// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/subtitleFontSizes.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// 底部字幕（译文 / 下一句预览）那两组 clamp 字号的唯一来源。
// 两组都是 clamp(min, preferred, max)：下限防窄屏压扁，上限防宽屏顶边，vw 中间值跟画面缩放。

type SubtitleFontSizes = {
	translationFontSize: string;
	upcomingFontSize: string;
};

const clampSize = (
	min: number,
	preferred: number,
	max: number,
	scale: number,
): string =>
	`clamp(${(min * scale).toFixed(3)}rem, ${(preferred * scale).toFixed(3)}vw, ${(max * scale).toFixed(3)}rem)`;

/**
 * 译文 / 下一句预览的字号。`lyricsFontScale` 是宿主的歌词字号倍率，缺省 1。
 * 各主题之间这两个数必须完全一致，否则字幕会在换主题的那一下跳大小。
 */
export const resolveSubtitleFontSizes = (
	lyricsFontScale = 1,
): SubtitleFontSizes => {
	const scale =
		Number.isFinite(lyricsFontScale) && lyricsFontScale > 0
			? lyricsFontScale
			: 1;
	return {
		translationFontSize: clampSize(1.125, 2.6, 1.25, scale),
		upcomingFontSize: clampSize(0.875, 2, 1, scale),
	};
};
