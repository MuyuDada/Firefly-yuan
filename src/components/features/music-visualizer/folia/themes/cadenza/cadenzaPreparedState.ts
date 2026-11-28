// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/cadenza/cadenzaPreparedState.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// 一行歌词的完整准备：选字号、测量换行（pretext 垫片）、切片段、算落点。整个模式最贵的一步，结果由组件缓存。

import type { Line } from "@/utils/lyrics";
import { splitLyricGraphemes } from "@/utils/lyrics";
import { layoutWithLines, prepareWithSegments } from "../../pretextShim";
import { clamp, isCJK } from "./cadenzaEnvelopes";
import {
	buildLineFragments,
	buildSegmentMetas,
	findWordRanges,
} from "./cadenzaFragments";
import { buildWordPlacements } from "./cadenzaPlacements";
import type { PreparedState, PreparedStateCacheContext } from "./cadenzaTypes";

const chooseFontPx = (width: number, line: Line): number => {
	const graphemeCount = splitLyricGraphemes(line.fullText).length || 1;
	const wordCount = line.words.length || 1;
	const widthBase = clamp(width * 0.086, 34, 94);
	const lengthPenalty =
		graphemeCount > 12 ? Math.min((graphemeCount - 12) * 1.8, 34) : 0;
	const densityPenalty =
		wordCount > 7 ? Math.min((wordCount - 7) * 1.5, 18) : 0;
	return clamp(widthBase - lengthPenalty - densityPenalty, 28, 104);
};

const buildCanvasFont = (
	theme: { fontWeight: number; fontFamily: string },
	fontPx: number,
): string => `${theme.fontWeight} ${fontPx}px ${theme.fontFamily}`;

export const buildPreparedState = (
	line: Line,
	context: PreparedStateCacheContext,
): PreparedState | null => {
	const { showText, viewport, theme, tuning } = context;

	if (!showText || viewport.width <= 0 || viewport.height <= 0) {
		return null;
	}

	const fontPx = clamp(
		chooseFontPx(viewport.width, line) * tuning.fontScale,
		24,
		132,
	);
	const font = buildCanvasFont(theme, fontPx);
	// This is the expensive part of the mode.
	// Once a line reaches here, we fully measure it, wrap it, split it, and convert it into placement-ready fragments.
	const prepared = prepareWithSegments(line.fullText, font);
	const text = prepared.segments.join("");
	const { segmentMetas, graphemes } = buildSegmentMetas(prepared);
	const lineHeight = Math.round(fontPx * (isCJK(text) ? 1.22 : 1.1));
	const availableWidth = Math.max(viewport.width - 48, 120);
	const minWidth = Math.min(220, availableWidth);
	const wrapCompression =
		graphemes.length > 12
			? clamp(0.92 - (graphemes.length - 12) * 0.018, 0.62, 0.92)
			: 0.92;
	const compactWidthRatio = tuning.widthRatio * wrapCompression;
	const maxWidth = clamp(
		Math.min(viewport.width * compactWidthRatio, 820),
		minWidth,
		availableWidth,
	);
	const layout = layoutWithLines(prepared, maxWidth, lineHeight);
	const ranges = findWordRanges(line, graphemes, theme);
	const lineFragments = buildLineFragments(
		prepared,
		segmentMetas,
		graphemes,
		layout,
		ranges,
	);
	const placements = buildWordPlacements(
		lineFragments,
		fontPx,
		lineHeight,
		maxWidth,
		theme.animationIntensity as "calm" | "normal" | "chaotic",
		line.startTime * 1000,
		line.fullText === "......",
	);

	return {
		prepared,
		text,
		font,
		fontPx,
		lineHeight,
		maxWidth,
		layout,
		segmentMetas,
		graphemes,
		placements,
	};
};
