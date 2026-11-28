// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/glowWordTiming.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// classic / partita 共用的逐词时序：把歌词管线给的 renderHints 整理成逐帧好用的 profile，
// 再算出每个词的 active 结束时刻、显示时长，以及整行容器的入场 / 离场参数。

import type { Line, Word } from "@/utils/lyrics";
import { getLineRenderEndTime, getLineRenderHints } from "@/utils/lyrics";

export interface GlowWordRenderProfile {
	renderHints: NonNullable<Line["renderHints"]> | null;
	lineRenderEndTime: number;
	lineTransitionMode: "normal" | "fast" | "none";
	wordRevealMode: "normal" | "fast" | "instant";
	wordLookahead: number;
}

export const resolveGlowWordRenderProfile = (
	line: Line | null | undefined,
): GlowWordRenderProfile | null => {
	if (!line) {
		return null;
	}

	// Render hints come from the lyric pipeline, not from the visualizer itself.
	// This function is just repackaging them into something easier to consume frame-by-frame.
	const renderHints = getLineRenderHints(line);
	const wordRevealMode = renderHints?.wordRevealMode ?? "normal";

	return {
		renderHints,
		lineRenderEndTime: getLineRenderEndTime(line),
		lineTransitionMode: renderHints?.lineTransitionMode ?? "normal",
		wordRevealMode,
		wordLookahead:
			wordRevealMode === "instant"
				? 0.03
				: wordRevealMode === "fast"
					? 0.08
					: 0.15,
	};
};

export const getGlowWordActiveEndTime = (
	word: Word,
	renderProfile: GlowWordRenderProfile,
): number => {
	if (renderProfile.wordRevealMode === "instant") {
		return renderProfile.lineRenderEndTime;
	}

	if (renderProfile.wordRevealMode === "fast") {
		return Math.min(
			renderProfile.lineRenderEndTime,
			Math.max(word.endTime, word.startTime + 0.12),
		);
	}

	return word.endTime;
};

export const getGlowWordDisplayDuration = (
	word: Word,
	renderProfile: GlowWordRenderProfile,
): number => {
	const activeEndTime = getGlowWordActiveEndTime(word, renderProfile);
	const minDuration =
		renderProfile.wordRevealMode === "instant"
			? 0.08
			: renderProfile.wordRevealMode === "fast"
				? 0.12
				: 0.1;

	return Math.max(activeEndTime - word.startTime, minDuration);
};

export interface FoliaLineContainerMotion {
	/** 入场初始态：opacity / scale / blur px。 */
	initial: { opacity: number; scale: number; blur: number };
	/** 入场动画时长（秒）。 */
	enterDuration: number;
	/** 离场终态与时长（秒）。 */
	exit: { opacity: number; scale: number; blur: number; duration: number };
}

export const getGlowWordLineContainerMotion = (
	renderProfile: GlowWordRenderProfile | null,
): FoliaLineContainerMotion => {
	if (renderProfile?.lineTransitionMode === "none") {
		return {
			initial: { opacity: 1, scale: 1, blur: 0 },
			enterDuration: 0,
			exit: { opacity: 0, scale: 1.02, blur: 6, duration: 0.12 },
		};
	}

	if (renderProfile?.lineTransitionMode === "fast") {
		return {
			initial: { opacity: 0.35, scale: 0.96, blur: 4 },
			enterDuration: 0.16,
			exit: { opacity: 0, scale: 1.04, blur: 10, duration: 0.16 },
		};
	}

	return {
		initial: { opacity: 0, scale: 0.9, blur: 10 },
		enterDuration: 0.3,
		exit: { opacity: 0, scale: 1.1, blur: 20, duration: 0.3 },
	};
};
