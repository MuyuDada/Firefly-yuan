// Firefly 全屏歌词的逐句歌词库入口。
// 解析器本体移植自 folia-web（AGPL-3.0），见各文件头与 NOTICE.md。

import type { LyricData } from "./lyricData";

export {
	applyStickyPunctuationLayoutUnits,
	type BuildPostLyricLayoutUnitsOptions,
	buildCjkSemanticLayoutUnits,
	buildDisplayWordsFromLayoutUnits,
	buildPostLyricLayoutUnits,
	createSingleWordLayoutUnits,
	type LyricLayoutUnit,
	type SegmentableLine,
} from "./cjkSemanticLayout";
export {
	buildTimedWords,
	estimateLrcLineEndTime,
} from "./estimatedLineTiming";
export {
	detectTimedLyricFormat,
	resolveExplicitFileTimedLyricFormat,
} from "./formatDetection";
export {
	buildLineGraphemeTimeline,
	buildWordGraphemeTimings,
	type GraphemeTiming,
	splitLyricGraphemes,
} from "./graphemeTiming";
export type {
	Line,
	LyricData,
	LyricSyllable,
	Word,
} from "./lyricData";
export { NO_LYRIC_LINES } from "./noLyricLines";
export type { LyricParseFormat, TimedTextEntry } from "./parserCore";
export {
	attachInterludes,
	finalizeParsedLyricLines,
	findTranslationsForSortedStartTimes,
	INTERLUDE_FULL_TEXT,
	isInterludeLine,
	parseAwlrc,
	parseEnhancedLRC,
	parseKRC,
	parseLRC,
	parseLyricsByFormat,
	parseQRC,
	parseVTT,
	parseYRC,
} from "./parserCore";
export {
	annotateLyricLines,
	buildLineRenderHints,
	getLineRenderEndTime,
	getLineRenderHints,
	getLineTransitionTiming,
	type LineRenderHints,
	type LineTransitionMode,
	type WordRevealMode,
} from "./renderHints";
export { SentenceLayout } from "./sentenceLayout";
export {
	type LyricTextDirection,
	resolveLyricTextDirection,
} from "./textDirection";
export type { LyricProcessingOptions } from "./types";
export {
	getWordSegmentationKey,
	hasWordSegmentationOverride,
	isValidWordSegmentation,
	type LyricWordSegment,
	segmentLyricWords,
	segmentsFromBoundaries,
	segmentTextWords,
} from "./wordSegmentation";

/**
 * 当前生效歌词行的下标：取「已开始且仍在渲染窗口内」的最后一行。
 * 移植自 folia-web 的 appPlaybackHelpers（AGPL-3.0）。
 */
export const findLatestActiveLineIndex = (
	lines: LyricData["lines"],
	time: number,
): number => {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line || time < line.startTime) {
			continue;
		}
		if (time <= (line.renderHints?.renderEndTime ?? line.endTime)) {
			return index;
		}
	}
	return -1;
};
