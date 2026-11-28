// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/monet/{monetLyricsModel,monetLyricMotion,monetRailLayout,monetRailMasks}.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Modifications: pretext/rich-inline 的富文本测量以 canvas 等效实现（逐 token 原子宽度 +
// 贪心断行）；副字幕轨仅支持 translation（Firefly 数据无罗马音轨）；歌曲交接（AutoMix）、
// 拖拽编辑与设置面板不移植。海报布局的字号/间距/色调数学保持原样。

import {
	buildLineGraphemeTimeline,
	buildTimedWords,
	buildWordGraphemeTimings,
	type GraphemeTiming,
	getLineRenderEndTime,
	type Line,
	splitLyricGraphemes,
	type Word,
} from "@/utils/lyrics";
import { colorWithAlpha } from "../../colorMix";
import { rememberBounded } from "../../textMeasureCache";
import { resolveWordColor } from "../../wordColoring";

// ── 运动常量（monetLyricMotion.ts） ──────────────────────────

export const MONET_SCROLL_SPRING = { stiffness: 142, damping: 28, mass: 0.82 };
export const MONET_SCALE_SPRING = { stiffness: 150, damping: 30, mass: 0.78 };
export const clampMonetProgress = (value: number): number =>
	Math.min(1, Math.max(0, value));

export function resolveMonetGlow(
	time: number,
	start: number,
	end: number,
	lineEnd: number,
): number {
	if (time <= start) return 0;
	const rise = Math.max(0.001, end - start) * 1.18;
	const peak = start + rise;
	const tail = Math.max(lineEnd, end + 1.05);
	if (time <= peak) {
		const progress = clampMonetProgress((time - start) / rise);
		return progress * progress * (3 - 2 * progress);
	}
	const remaining =
		1 - clampMonetProgress((time - peak) / Math.max(0.18, tail - peak));
	return remaining * remaining * (3 - 2 * remaining);
}

/** Interpolates measured glyph positions, including a proportional fallback for untimed graphemes. */
export function resolveMonetFillWidth(
	time: number,
	start: number,
	end: number,
	offsets: number[],
	timings: GraphemeTiming[],
): number {
	const width = offsets.at(-1) ?? 0;
	if (time <= start) return 0;
	if (time >= end) return width;
	const count = Math.min(timings.length, offsets.length - 1);
	if (count > 0) {
		for (let i = 0; i < count; i++) {
			const timing = timings[i];
			const timingStart = Math.max(start, timing.startTime);
			const timingEnd = Math.max(timingStart, timing.endTime);
			if (time < timingStart) return offsets[i];
			if (time <= timingEnd) {
				const progress =
					(time - timingStart) / Math.max(0.001, timingEnd - timingStart);
				return offsets[i] + (offsets[i + 1] - offsets[i]) * progress;
			}
		}
		return offsets[count] ?? width;
	}
	const index =
		clampMonetProgress((time - start) / Math.max(0.001, end - start)) *
		(offsets.length - 1);
	const whole = Math.floor(index);
	return (
		(offsets[whole] ?? width) +
		((offsets[whole + 1] ?? width) - (offsets[whole] ?? width)) *
			(index - whole)
	);
}

export function resolveMonetTone(
	status: "active" | "waiting" | "passed",
	offset: number,
): { alpha: number; scale: number; blur: number; baseAlpha: number } {
	if (status === "active")
		return { alpha: 1, scale: 1, blur: 0, baseAlpha: 0.34 };
	const distance = Math.max(Math.abs(offset), 1);
	const waiting = status === "waiting";
	return {
		alpha: waiting
			? Math.max(0.36, 0.72 - (distance - 1) * 0.18)
			: Math.max(0.28, 0.52 - (distance - 1) * 0.12),
		scale: Math.max(0.68, 0.72 * 0.9 ** (distance - 1)),
		blur: waiting
			? distance === 1
				? 0.7
				: 1.8 + (distance - 2) * 0.8
			: 1.1 + (distance - 1) * 0.7,
		baseAlpha: waiting ? 0.46 : 0.36,
	};
}

// ── 模型（monetLyricsModel.ts） ──────────────────────────────

export type MonetLineStatus = "waiting" | "active" | "passed";

export interface MonetDisplayToken {
	text: string;
	startTime: number | null;
	endTime: number | null;
	key: string;
	timed: boolean;
	startOffset: number;
	endOffset: number;
	graphemeTimings: GraphemeTiming[];
}

export interface MonetVisibleLineEntry {
	key: string;
	line: Line;
	index: number;
	offset: number;
	status: MonetLineStatus;
}

export interface MonetSubtitleTrackLayout {
	role: "translation";
	text: string;
	fontPx: number;
	fontWeight: number;
	lineCount: number;
	lineHeightPx: number;
	contentHeightPx: number;
	paddingTopPx: number;
	paddingBottomPx: number;
	heightPx: number;
	isClipped: boolean;
}

export interface MonetMeasuredLineLayout {
	textLineCount: number;
	visibleTextLineCount: number;
	textHeightPx: number;
	textContentHeightPx: number;
	textPaddingTopPx: number;
	textPaddingBottomPx: number;
	subtitleTracks: MonetSubtitleTrackLayout[];
	translationLineCount: number;
	translationHeightPx: number;
	translationContentHeightPx: number;
	translationPaddingTopPx: number;
	translationPaddingBottomPx: number;
	visualHeightPx: number;
	lineHeightPx: number;
	translationLineHeightPx: number;
	isTextClipped: boolean;
	isTextOverflowingWidth: boolean;
	isTranslationClipped: boolean;
}

const ROOT_FONT_PX = 16;
const VIEWPORT_WIDTH_FALLBACK_PX = 1280;
const MONET_ACTIVE_TEXT_LINE_LIMIT = 14;
const MONET_INACTIVE_TEXT_LINE_LIMIT = 2;
const MONET_TRANSLATION_LINE_LIMIT = 2;
const MONET_MIN_MEASURE_WIDTH_PX = 180;
const MONET_GRAPHEME_OFFSETS_CACHE_LIMIT = 420;
const MONET_VERTICAL_METRICS_CACHE_LIMIT = 420;
const MONET_GLYPH_VERTICAL_SAFETY_PX = 2;
const MONET_LARGE_SCREEN_MIN_PX = 1536;
const MONET_LARGE_SCREEN_FULL_PX = 2200;
const MONET_LARGE_SCREEN_MAX_SCALE = 1.16;
export const MONET_RAIL_BASE_MAX_WIDTH_PX = 780;
export const MONET_RAIL_BASE_MAX_HEIGHT_PX = 520;
export const MONET_ROW_BASE_MAX_WIDTH_PX = 1520;
export const MONET_PORTRAIT_BASE_MAX_PX = 430;
export const MONET_PORTRAIT_INNER_BASE_MAX_PX = 380;

// 副字幕样式常量（folia 的 subtitleTrackStyle.ts）。
export const SECONDARY_TRACK_SIZE_FACTOR = 0.88;
export const SECONDARY_TRACK_OPACITY = 0.82;
export const SECONDARY_TRACK_GAP_EM = 0.25;

const monetGraphemeOffsetsCache = new Map<string, number[]>();
const monetVerticalMetricsCache = new Map<string, number>();
let monetMeasureContext: CanvasRenderingContext2D | null = null;

const graphemeSegmenter =
	typeof Intl !== "undefined"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

export const splitMonetGraphemes = (text: string): string[] => {
	if (!text) {
		return [];
	}
	if (graphemeSegmenter) {
		return Array.from(
			graphemeSegmenter.segment(text),
			({ segment }) => segment,
		);
	}
	return Array.from(text);
};

export const resolveMonetLargeScreenScale = (
	containerWidthPx?: number,
): number => {
	const referenceWidth =
		containerWidthPx && containerWidthPx > 0
			? containerWidthPx
			: typeof window !== "undefined"
				? window.innerWidth
				: VIEWPORT_WIDTH_FALLBACK_PX;
	if (referenceWidth <= MONET_LARGE_SCREEN_MIN_PX) {
		return 1;
	}

	const progress = Math.min(
		1,
		(referenceWidth - MONET_LARGE_SCREEN_MIN_PX) /
			(MONET_LARGE_SCREEN_FULL_PX - MONET_LARGE_SCREEN_MIN_PX),
	);
	return 1 + (MONET_LARGE_SCREEN_MAX_SCALE - 1) * progress;
};

export const resolveClampFontPx = (
	minRem: number,
	preferredVw: number,
	maxRem: number,
): number => {
	const viewportWidth =
		typeof window !== "undefined"
			? window.innerWidth
			: VIEWPORT_WIDTH_FALLBACK_PX;
	return Math.min(
		maxRem * ROOT_FONT_PX,
		Math.max(minRem * ROOT_FONT_PX, viewportWidth * (preferredVw / 100)),
	);
};

const getMonetMeasureContext = (): CanvasRenderingContext2D | null => {
	if (monetMeasureContext) return monetMeasureContext;
	if (typeof document !== "undefined") {
		monetMeasureContext = document.createElement("canvas").getContext("2d");
	}
	return monetMeasureContext;
};

const measureMonetTextWidth = (text: string, fontSpec: string): number => {
	if (!text) return 0;
	const context = getMonetMeasureContext();
	if (!context) return text.length * 8;
	context.font = fontSpec;
	return context.measureText(text).width;
};

/**
 * 富文本行统计的 canvas 等效：timed token 是原子框（不可内部断行），静态 token 可断。
 * 贪心装箱算出行数与最宽行，与 DOM 中 inline-block 词的换行行为对齐。
 */
const measureLyricLineStats = (
	line: Line,
	fontSpec: string,
	maxWidthPx: number,
): { lineCount: number; maxLineWidthPx: number } => {
	const tokens = buildMonetDisplayTokens(line);
	if (tokens.length === 0) {
		return { lineCount: 1, maxLineWidthPx: 0 };
	}

	const widths = tokens.map((token) =>
		measureMonetTextWidth(token.text, fontSpec),
	);
	const safeMax = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
	let lineCount = 1;
	let maxLineWidth = 0;
	let currentWidth = 0;

	tokens.forEach((_token, index) => {
		const width = widths[index];
		if (currentWidth > 0 && currentWidth + width > safeMax) {
			maxLineWidth = Math.max(maxLineWidth, currentWidth);
			lineCount += 1;
			currentWidth = width;
		} else {
			currentWidth += width;
		}
	});
	maxLineWidth = Math.max(maxLineWidth, currentWidth);

	return { lineCount: Math.max(lineCount, 1), maxLineWidthPx: maxLineWidth };
};

const measureTextLineCount = (
	text: string,
	fontSpec: string,
	maxWidthPx: number,
): number => {
	const tokens = text.split(/(\s+)/).filter((part) => part.length > 0);
	const safeMax = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
	let lineCount = 1;
	let currentWidth = 0;
	for (const token of tokens) {
		const width = measureMonetTextWidth(token, fontSpec);
		if (
			currentWidth > 0 &&
			currentWidth + width > safeMax &&
			!/^\s+$/.test(token)
		) {
			lineCount += 1;
			currentWidth = width;
		} else {
			currentWidth += width;
		}
	}
	return Math.max(lineCount, 1);
};

/** Measures the tallest painted glyph bounds so descenders remain inside Monet's clipped line box. */
const measureMonetLineHeight = (
	text: string,
	fontSpec: string,
	_fontPx: number,
	defaultLineHeightPx: number,
): number => {
	const cacheKey = `${fontSpec}|${text}`;
	const cached = monetVerticalMetricsCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const context = getMonetMeasureContext();
	if (!context) {
		return defaultLineHeightPx;
	}

	context.font = fontSpec;
	const metrics = context.measureText(text || "Hg");
	const glyphHeightPx =
		metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
	const measuredLineHeightPx =
		glyphHeightPx > 0
			? Math.max(
					defaultLineHeightPx,
					Math.ceil(glyphHeightPx + MONET_GLYPH_VERTICAL_SAFETY_PX),
				)
			: defaultLineHeightPx;

	return rememberBounded(
		monetVerticalMetricsCache,
		cacheKey,
		measuredLineHeightPx,
		MONET_VERTICAL_METRICS_CACHE_LIMIT,
	);
};

export const clearMonetMeasurementCaches = (): void => {
	monetVerticalMetricsCache.clear();
	monetGraphemeOffsetsCache.clear();
};

/** Builds cumulative grapheme offsets so the lyric fill edge can sweep through glyphs. */
export const measureMonetGraphemeOffsets = (
	text: string,
	_fontPx: number,
	fontSpec: string,
): number[] => {
	const cacheKey = `${fontSpec}|${text}`;
	const cached = monetGraphemeOffsetsCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const glyphs = splitMonetGraphemes(text);
	const offsets = new Array<number>(glyphs.length + 1).fill(0);
	for (let count = 1; count <= glyphs.length; count += 1) {
		offsets[count] = measureMonetTextWidth(
			glyphs.slice(0, count).join(""),
			fontSpec,
		);
	}
	return rememberBounded(
		monetGraphemeOffsetsCache,
		cacheKey,
		offsets,
		MONET_GRAPHEME_OFFSETS_CACHE_LIMIT,
	);
};

/** Keeps the sweep narrow enough for short CJK lyric tokens to hand off continuously. */
export const resolveMonetSweepEdgeSoftness = (fontPx: number): number =>
	Math.max(Math.min(fontPx * 0.45, 16), 6);

/** Extends the mask front so its soft trailing edge has fully cleared the word at its end time. */
export const resolveMonetSweepEnd = (
	filledWidthPx: number,
	fullWidthPx: number,
	edgeSoftnessPx: number,
): number => {
	if (fullWidthPx <= 0) {
		return 0;
	}
	const progress = Math.min(1, Math.max(0, filledWidthPx / fullWidthPx));
	return filledWidthPx + edgeSoftnessPx * progress;
};

export const resolveMonetLineStatus = (
	line: Line,
	index: number,
	activeIndex: number,
	currentTime: number,
): MonetLineStatus => {
	if (
		index === activeIndex ||
		(activeIndex < 0 &&
			currentTime >= line.startTime &&
			currentTime <= line.endTime)
	) {
		return "active";
	}
	if (currentTime > line.endTime || (activeIndex >= 0 && index < activeIndex)) {
		return "passed";
	}
	return "waiting";
};

export const resolveMonetWordStatus = (
	currentTime: number,
	startTime: number,
	endTime: number,
): MonetLineStatus => {
	if (currentTime < startTime) {
		return "waiting";
	}
	if (currentTime <= endTime) {
		return "active";
	}
	return "passed";
};

const resolveMonetSweepWords = (line: Line): Word[] => {
	if (line.words.length === 0) {
		return buildTimedWords(
			line.fullText,
			line.startTime,
			getLineRenderEndTime(line),
		);
	}

	const [onlyWord] = line.words;
	if (
		line.words.length === 1 &&
		!onlyWord.syllables?.length &&
		onlyWord.text.trim() === line.fullText.trim()
	) {
		const estimated = buildTimedWords(
			onlyWord.text,
			onlyWord.startTime,
			onlyWord.endTime,
		);
		const estimatedSpan =
			(estimated.at(-1)?.endTime ?? onlyWord.startTime) - onlyWord.startTime;
		if (estimated.length > 1 && estimatedSpan > 0) {
			const scale = (onlyWord.endTime - onlyWord.startTime) / estimatedSpan;
			return estimated.map((word) => ({
				text: word.text,
				startTime:
					onlyWord.startTime + (word.startTime - onlyWord.startTime) * scale,
				endTime:
					onlyWord.startTime + (word.endTime - onlyWord.startTime) * scale,
			}));
		}
	}

	return line.words;
};

/** Builds a stable display-token list so fullText punctuation and spaces survive around timed words. */
export const buildMonetDisplayTokens = (line: Line): MonetDisplayToken[] => {
	const words = resolveMonetSweepWords(line);

	const tokens: MonetDisplayToken[] = [];
	let cursor = 0;
	words.forEach((word, index) => {
		const matchIndex = line.fullText.indexOf(word.text, cursor);
		if (matchIndex < 0) {
			return;
		}

		if (matchIndex > cursor) {
			tokens.push({
				text: line.fullText.slice(cursor, matchIndex),
				startTime: null,
				endTime: null,
				key: `${line.startTime}-static-${cursor}`,
				timed: false,
				startOffset: cursor,
				endOffset: matchIndex,
				graphemeTimings: [],
			});
		}

		const endOffset = matchIndex + word.text.length;
		tokens.push({
			text: word.text,
			startTime: word.startTime,
			endTime: word.endTime,
			key: `${line.startTime}-${index}-${word.startTime}`,
			timed: true,
			startOffset: matchIndex,
			endOffset,
			graphemeTimings: buildWordGraphemeTimings(word),
		});

		cursor = endOffset;
	});

	if (cursor < line.fullText.length) {
		tokens.push({
			text: line.fullText.slice(cursor),
			startTime: null,
			endTime: null,
			key: `${line.startTime}-tail-${cursor}`,
			timed: false,
			startOffset: cursor,
			endOffset: line.fullText.length,
			graphemeTimings: [],
		});
	}

	return tokens.length > 0
		? tokens
		: [
				{
					text: line.fullText,
					startTime: line.startTime,
					endTime: getLineRenderEndTime(line),
					key: `${line.startTime}-fallback-full`,
					timed: true,
					startOffset: 0,
					endOffset: line.fullText.length,
					graphemeTimings: buildLineGraphemeTimeline(line),
				},
			];
};

export const resolveMonetLyricContext = (
	lines: Line[],
	currentLineIndex: number,
	activeLine: Line | null,
	recentCompletedLine: Line | null,
	nextLine: Line | null,
): {
	previousLine: Line | null;
	activeLine: Line | null;
	nextLine: Line | null;
} => {
	if (!activeLine) {
		return { previousLine: recentCompletedLine, activeLine: null, nextLine };
	}

	return {
		previousLine:
			currentLineIndex > 0 ? (lines[currentLineIndex - 1] ?? null) : null,
		activeLine,
		nextLine: lines[currentLineIndex + 1] ?? nextLine,
	};
};

const findLineIndex = (lines: Line[], target: Line | null): number => {
	if (!target) {
		return -1;
	}
	const directIndex = lines.indexOf(target);
	if (directIndex >= 0) {
		return directIndex;
	}
	return lines.findIndex(
		(line) =>
			line.startTime === target.startTime && line.fullText === target.fullText,
	);
};

export const buildMonetVisibleLineEntries = ({
	lines,
	currentLineIndex,
	activeLine,
	recentCompletedLine,
	upcomingLine,
	currentTime,
	before = 2,
	after = 2,
}: {
	lines: Line[];
	currentLineIndex: number;
	activeLine: Line | null;
	recentCompletedLine: Line | null;
	upcomingLine: Line | null;
	currentTime: number;
	before?: number;
	after?: number;
}): MonetVisibleLineEntry[] => {
	if (lines.length === 0) {
		return [];
	}

	const activeIndex = activeLine
		? currentLineIndex >= 0
			? currentLineIndex
			: findLineIndex(lines, activeLine)
		: -1;
	const upcomingIndex = findLineIndex(lines, upcomingLine);
	const recentIndex = findLineIndex(lines, recentCompletedLine);
	const anchorIndex =
		activeIndex >= 0
			? activeIndex
			: upcomingIndex >= 0
				? upcomingIndex
				: recentIndex;

	if (anchorIndex < 0) {
		return [];
	}

	const startIndex = Math.max(0, anchorIndex - before);
	const endIndex = Math.min(lines.length - 1, anchorIndex + after);
	const entries: MonetVisibleLineEntry[] = [];

	for (let index = startIndex; index <= endIndex; index += 1) {
		const line = lines[index];
		entries.push({
			key: `${index}-${line.startTime}-${line.fullText}`,
			line,
			index,
			offset: index - anchorIndex,
			status: resolveMonetLineStatus(line, index, activeIndex, currentTime),
		});
	}

	return entries;
};

// ── 副字幕轨（translation-only 简化） ────────────────────────

const isReadableSubtitleText = (text: string): boolean =>
	/[\p{L}\p{N}]/u.test(text);

export interface MonetSubtitleTrackInput {
	role: "translation";
	text: string;
}

export const resolveMonetSubtitleTracks = (
	line: Line,
): MonetSubtitleTrackInput[] => {
	const text = line.translation?.trim() ?? "";
	if (!text || !isReadableSubtitleText(text)) {
		return [];
	}
	return [{ role: "translation", text }];
};

interface MonetLineLayoutInputs {
	fontPx: number;
	translationFontPx: number;
	fontStack: string;
	fontWeight: number;
	translationFontWeight: number;
	maxWidthPx: number;
}

const measureMonetSubtitleTrack = (
	track: MonetSubtitleTrackInput,
	inputs: MonetLineLayoutInputs,
): MonetSubtitleTrackLayout => {
	const fontPx = inputs.translationFontPx;
	const fontWeight = inputs.translationFontWeight;
	const fontSpec = `${fontWeight} ${fontPx}px ${inputs.fontStack}`;
	const lineHeightPx = measureMonetLineHeight(
		track.text,
		fontSpec,
		fontPx,
		fontPx * 1.28,
	);
	const paddingTopPx = Math.max(fontPx * 0.45, 7);
	const paddingBottomPx = Math.max(fontPx * 0.18, 5);
	const rawLineCount = measureTextLineCount(
		track.text,
		fontSpec,
		inputs.maxWidthPx,
	);
	const lineCount = Math.min(rawLineCount, MONET_TRANSLATION_LINE_LIMIT);
	const contentHeightPx = lineCount * lineHeightPx;

	return {
		role: track.role,
		text: track.text,
		fontPx,
		fontWeight,
		lineCount,
		lineHeightPx,
		contentHeightPx,
		paddingTopPx,
		paddingBottomPx,
		heightPx: contentHeightPx + paddingTopPx + paddingBottomPx,
		isClipped: rawLineCount > lineCount,
	};
};

export const measureMonetLineLayout = ({
	line,
	status,
	fontPx,
	translationFontPx,
	fontStack,
	fontWeight = 600,
	translationFontWeight = 500,
	maxWidthPx,
}: {
	line: Line;
	status: MonetLineStatus;
	fontPx: number;
	translationFontPx: number;
	fontStack: string;
	fontWeight?: number;
	translationFontWeight?: number;
	maxWidthPx: number;
}): MonetMeasuredLineLayout => {
	const fontSpec = `${fontWeight} ${fontPx}px ${fontStack}`;
	const lineHeightPx = measureMonetLineHeight(
		line.fullText,
		fontSpec,
		fontPx,
		fontPx * 1.18,
	);
	const textPaddingTopPx = Math.max(fontPx * 0.16, 8);
	const textPaddingBottomPx = Math.max(fontPx * 0.34, 14);
	const { lineCount: textLineCount, maxLineWidthPx } = measureLyricLineStats(
		line,
		fontSpec,
		maxWidthPx,
	);
	const textLimit =
		status === "active"
			? MONET_ACTIVE_TEXT_LINE_LIMIT
			: MONET_INACTIVE_TEXT_LINE_LIMIT;
	const visibleTextLineCount = Math.min(textLineCount, textLimit);
	const textContentHeightPx = visibleTextLineCount * lineHeightPx;
	const textHeightPx =
		textContentHeightPx + textPaddingTopPx + textPaddingBottomPx;

	const trackInputs: MonetLineLayoutInputs = {
		fontPx,
		translationFontPx,
		fontStack,
		fontWeight,
		translationFontWeight,
		maxWidthPx,
	};
	const subtitleTracks =
		status === "active"
			? resolveMonetSubtitleTracks(line).map((track) =>
					measureMonetSubtitleTrack(track, trackInputs),
				)
			: [];
	const firstTrack = subtitleTracks[0];
	const lastTrack = subtitleTracks[subtitleTracks.length - 1];
	const translationHeightPx = subtitleTracks.reduce(
		(total, track) => total + track.heightPx,
		0,
	);

	return {
		textLineCount,
		visibleTextLineCount,
		textHeightPx,
		textContentHeightPx,
		textPaddingTopPx,
		textPaddingBottomPx,
		subtitleTracks,
		translationLineCount: subtitleTracks.reduce(
			(total, track) => total + track.lineCount,
			0,
		),
		translationHeightPx,
		translationContentHeightPx: subtitleTracks.reduce(
			(total, track) => total + track.contentHeightPx,
			0,
		),
		translationPaddingTopPx:
			firstTrack?.paddingTopPx ?? Math.max(translationFontPx * 0.45, 7),
		translationPaddingBottomPx:
			lastTrack?.paddingBottomPx ?? Math.max(translationFontPx * 0.18, 5),
		visualHeightPx: textHeightPx + translationHeightPx,
		lineHeightPx,
		translationLineHeightPx:
			firstTrack?.lineHeightPx ??
			measureMonetLineHeight(
				"",
				`${translationFontWeight} ${translationFontPx}px ${fontStack}`,
				translationFontPx,
				translationFontPx * 1.28,
			),
		isTextClipped: textLineCount > visibleTextLineCount,
		isTextOverflowingWidth: maxLineWidthPx > maxWidthPx,
		isTranslationClipped: subtitleTracks.some((track) => track.isClipped),
	};
};

// ── 栏布局（monetRailLayout.ts） ─────────────────────────────

export interface MonetRailSize {
	width: number;
	height: number;
}

export interface MonetLineTone {
	opacity: number;
	scale: number;
	blurPx: number;
	baseColor: string;
	fontWeight: number;
	zIndex: number;
}

export interface PositionedMonetLineEntry extends MonetVisibleLineEntry {
	y: number;
	tone: MonetLineTone;
	layout: MonetMeasuredLineLayout;
	scaledHeight: number;
}

export type MonetLayoutCache = Map<string, MonetMeasuredLineLayout>;

const MONET_RAIL_WIDTH_FALLBACK_PX = 680;
const MONET_RAIL_HEIGHT_FALLBACK_PX = 340;
export const MONET_SUBTITLE_TRACK_STAGGER_S = 0.04;
const MONET_ACTIVE_GAP_PX = 18;
const MONET_INACTIVE_GAP_PX = 14;
export const MONET_RAIL_MIN_ROWS = 7;
const MONET_ACTIVE_GAP_RATIO = 0.49;
const MONET_INACTIVE_GAP_RATIO = 0.38;
const MONET_LAYOUT_CACHE_LIMIT = 240;

const monetClamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export const resolveMonetWordColor = (
	wordText: string,
	theme: { wordColors: { word: string; color: string }[] },
	fallbackColor: string,
	keywordColoringEnabled = true,
): string => {
	return resolveWordColor(wordText, theme.wordColors, fallbackColor, {
		keywordColoringEnabled,
		cjkMatchMode: "exact",
	});
};

const resolveLineTone = (
	entry: MonetVisibleLineEntry,
	theme: { primaryColor: string },
	inactiveScale: number,
): MonetLineTone => {
	if (entry.status === "active") {
		return {
			opacity: 1,
			scale: 1,
			blurPx: 0,
			baseColor: colorWithAlpha(theme.primaryColor, 0.34),
			fontWeight: 600,
			zIndex: 4,
		};
	}

	const distance = Math.max(Math.abs(entry.offset), 1);
	const isWaiting = entry.status === "waiting";
	const scale = monetClamp(inactiveScale * 0.9 ** (distance - 1), 0.68, 0.92);

	return {
		opacity: isWaiting
			? monetClamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
			: monetClamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
		scale,
		blurPx: isWaiting
			? distance === 1
				? 0.7
				: 1.8 + (distance - 2) * 0.8
			: 1.1 + (distance - 1) * 0.7,
		baseColor: colorWithAlpha(theme.primaryColor, isWaiting ? 0.46 : 0.36),
		fontWeight: 500,
		zIndex: isWaiting ? 3 - distance : 2 - distance,
	};
};

const resolveLineGap = (
	previous: PositionedMonetLineEntry,
	next: PositionedMonetLineEntry,
	lyricFontPx: number,
): number =>
	previous.status === "active" || next.status === "active"
		? Math.max(MONET_ACTIVE_GAP_PX, lyricFontPx * MONET_ACTIVE_GAP_RATIO)
		: Math.max(MONET_INACTIVE_GAP_PX, lyricFontPx * MONET_INACTIVE_GAP_RATIO);

const resolveRailLineStatus = (
	lineIndex: number,
	activeLineIndex: number,
): MonetLineStatus => {
	if (lineIndex === activeLineIndex) {
		return "active";
	}
	if (activeLineIndex >= 0 && lineIndex < activeLineIndex) {
		return "passed";
	}
	return "waiting";
};

export const buildScrollableRailEntries = (
	lines: Line[],
	anchorIndex: number,
	activeLineIndex: number,
): MonetVisibleLineEntry[] => {
	if (lines.length === 0) {
		return [];
	}

	const safeAnchorIndex = Math.round(
		monetClamp(anchorIndex, 0, lines.length - 1),
	);
	const startIndex = Math.max(0, safeAnchorIndex - 4);
	const endIndex = Math.min(lines.length - 1, safeAnchorIndex + 4);
	const nextEntries: MonetVisibleLineEntry[] = [];

	for (let index = startIndex; index <= endIndex; index += 1) {
		const line = lines[index];
		nextEntries.push({
			key: `${index}-${line.startTime}-${line.fullText}`,
			line,
			index,
			offset: index - safeAnchorIndex,
			status: resolveRailLineStatus(index, activeLineIndex),
		});
	}

	return nextEntries;
};

const getOrMeasureMonetLineLayout = (
	cache: MonetLayoutCache,
	entry: MonetVisibleLineEntry,
	inputs: MonetLineLayoutInputs,
): MonetMeasuredLineLayout => {
	const cacheKey = [
		entry.index,
		entry.line.startTime,
		entry.line.endTime,
		entry.line.fullText,
		resolveMonetSubtitleTracks(entry.line)
			.map((track) => `${track.role}:${track.text}`)
			.join(""),
		entry.status,
		inputs.fontPx,
		inputs.translationFontPx,
		inputs.fontStack,
		inputs.fontWeight,
		inputs.translationFontWeight,
		inputs.maxWidthPx,
	].join("");
	const cached = cache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const layout = measureMonetLineLayout({
		line: entry.line,
		status: entry.status,
		...inputs,
	});
	return rememberBounded(cache, cacheKey, layout, MONET_LAYOUT_CACHE_LIMIT);
};

export const buildPositionedEntries = (
	entries: MonetVisibleLineEntry[],
	railSize: MonetRailSize,
	theme: { primaryColor: string },
	lyricFontPx: number,
	inactiveFontPx: number,
	layoutInputs: Omit<MonetLineLayoutInputs, "fontPx" | "maxWidthPx">,
	glowBufferPx: number,
	layoutCache: MonetLayoutCache,
): PositionedMonetLineEntry[] => {
	const railWidth = railSize.width || MONET_RAIL_WIDTH_FALLBACK_PX;
	const railHeight = railSize.height || MONET_RAIL_HEIGHT_FALLBACK_PX;
	const inactiveScale = monetClamp(
		inactiveFontPx / Math.max(lyricFontPx, 1),
		0.72,
		0.92,
	);
	const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0);
	const measureInputs: MonetLineLayoutInputs = {
		...layoutInputs,
		fontPx: lyricFontPx,
		maxWidthPx: contentWidthPx - 8,
	};

	const measuredEntries: PositionedMonetLineEntry[] = entries.map((entry) => {
		const tone = {
			...resolveLineTone(entry, theme, inactiveScale),
			fontWeight: layoutInputs.fontWeight,
		};
		const layout = getOrMeasureMonetLineLayout(
			layoutCache,
			entry,
			measureInputs,
		);

		return {
			...entry,
			y: 0,
			tone,
			layout,
			scaledHeight: layout.visualHeightPx * tone.scale,
		};
	});

	if (measuredEntries.length === 0) {
		return [];
	}

	const anchorIndex = Math.max(
		0,
		measuredEntries.findIndex((entry) => entry.offset === 0),
	);
	const focusCenterY = railHeight * 0.46;
	measuredEntries[anchorIndex].y =
		focusCenterY - measuredEntries[anchorIndex].scaledHeight / 2;

	for (
		let index = anchorIndex + 1;
		index < measuredEntries.length;
		index += 1
	) {
		const previous = measuredEntries[index - 1];
		const current = measuredEntries[index];
		current.y =
			previous.y +
			previous.scaledHeight +
			resolveLineGap(previous, current, lyricFontPx);
	}

	for (let index = anchorIndex - 1; index >= 0; index -= 1) {
		const current = measuredEntries[index];
		const next = measuredEntries[index + 1];
		current.y =
			next.y -
			current.scaledHeight -
			resolveLineGap(current, next, lyricFontPx);
	}

	return measuredEntries;
};

// ── 遮罩（monetRailMasks.ts） ────────────────────────────────

export const getLineMask = (
	isClipped: boolean,
	fadePx: number,
): string | undefined =>
	isClipped
		? `linear-gradient(180deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
		: undefined;

export const getClippedTextMask = (
	isClipped: boolean,
	contentBottomPx: number,
	fadePx: number,
): string | undefined => {
	if (!isClipped) {
		return undefined;
	}

	const solidEndPx = Math.max(contentBottomPx - fadePx, 0);
	return `linear-gradient(180deg, black 0px, black ${solidEndPx}px, transparent ${contentBottomPx}px)`;
};

export const getEdgeFadeMask = (
	isOverflowing: boolean,
	fadePx: number,
	rtl = false,
): string | undefined =>
	isOverflowing
		? `linear-gradient(${rtl ? 270 : 90}deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
		: undefined;

export const composeLineMasks = (
	...masks: (string | undefined)[]
): Record<string, string> | undefined => {
	const layers = masks.filter((mask): mask is string => Boolean(mask));
	if (layers.length === 0) {
		return undefined;
	}

	const style: Record<string, string> = {
		WebkitMaskImage: layers.join(", "),
		maskImage: layers.join(", "),
		WebkitMaskRepeat: "no-repeat",
		maskRepeat: "no-repeat",
		WebkitMaskSize: "100% 100%",
		maskSize: "100% 100%",
	};
	if (layers.length > 1) {
		style.WebkitMaskComposite = "source-in";
		style.maskComposite = "intersect";
	}
	return style;
};

// 遮罩样式对象转行内样式字符串（Svelte 侧直接用 style 文本）。
export const maskStyleToString = (
	mask: Record<string, string> | undefined,
): string => {
	if (!mask) return "";
	return Object.entries(mask)
		.map(
			([key, value]) =>
				`${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value};`,
		)
		.join("");
};

void splitLyricGraphemes;
