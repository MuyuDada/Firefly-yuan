// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/tilt/VisualizerTilt.tsx, layout helpers).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// Modifications: @chenglou/pretext 的文字测量改为共享的 canvas measureText（见 NOTICE.md）。

import type { Line } from "@/utils/lyrics";
import {
	buildWordGraphemeTimings,
	SentenceLayout,
	splitLyricGraphemes,
} from "@/utils/lyrics";
import { measureGlowWordWidth } from "../../glowWordOverlap";
import type { FoliaTheme } from "../../types";

export type TiltColorScheme = "default" | "swap" | "accentAll" | "primaryAll";

export interface TiltTuning {
	splitProbability: number;
	tiltStyleProbability: number;
	colorScheme?: TiltColorScheme;
}

// tilt 调参（folia 的 DEFAULT_TILT_TUNING；调参 UI 暂未开放，取默认值）。
export const DEFAULT_TILT_TUNING: TiltTuning = {
	splitProbability: 0.75,
	tiltStyleProbability: 0.35,
	colorScheme: "default",
};

export const CHAR_REF_LENGTH = 20;
export const LOG_OFFSET = 4;
const LINE_THRESHOLDS = [0.45, 1.05, 1.7];

const REM_PX = 16;
const RESPLIT_THRESHOLD = 1.6;
const SCALE_FLOOR_NORMAL = 0.55;
const SCALE_FLOOR_TILT = 0.5;

const seededRandom = (seed: number, offset: number): number => {
	const x = Math.sin(seed * 1000 + offset) * 10000;
	return x - Math.floor(x);
};

export const determineLineCount = (
	charCount: number,
	seed: number,
	splitProbability: number,
): number => {
	const normalized =
		Math.log(charCount + LOG_OFFSET) / Math.log(CHAR_REF_LENGTH + LOG_OFFSET);
	const jitter = seededRandom(seed, 1) * 0.6 + 0.7;
	const score = normalized * jitter * splitProbability;
	if (score < LINE_THRESHOLDS[0]) return 1;
	if (score < LINE_THRESHOLDS[1]) return 2;
	if (score < LINE_THRESHOLDS[2]) return 3;
	return 4;
};

export interface TiltSegment {
	text: string;
	isTilt: boolean;
	isShortLastLine: boolean;
	charOffset: number;
}

export interface TiltLayout {
	segments: TiltSegment[];
	scaleMultiplier: number;
}

const getAvailableWidth = (): number => {
	if (typeof window === "undefined") return 1200;
	return Math.max(320, window.innerWidth) * 0.85;
};

/** folia 用 pretext 的首行测量；这里用共享 canvas measureText 等效（宽度对排版决策足够）。 */
const measureAtSize = (
	text: string,
	pxSize: number,
	fontStack: string,
	fontWeight: number,
): number => {
	return measureGlowWordWidth(text, pxSize, fontStack, fontWeight);
};

export const findSegmentWordRange = (
	charOffset: number,
	segmentText: string,
	fullText: string,
	words: Array<{ text: string; startTime: number; endTime: number }>,
): { startWordIndex: number; endWordIndex: number } => {
	const segmentStart = charOffset;
	if (segmentStart < 0 || segmentStart >= fullText.length)
		return { startWordIndex: 0, endWordIndex: words.length };

	const segmentEnd = segmentStart + segmentText.length;

	let fullTextPos = 0;
	let startWordIndex = 0;
	let endWordIndex = words.length;

	for (let wi = 0; wi < words.length; wi++) {
		const wordText = words[wi].text;
		const wordFullStart = fullText.indexOf(wordText, fullTextPos);

		if (wordFullStart === -1) {
			fullTextPos += wordText.length;
			continue;
		}

		const wordFullEnd = wordFullStart + wordText.length;

		if (wordFullStart <= segmentStart && wordFullEnd > segmentStart) {
			startWordIndex = wi;
		}

		if (wordFullStart < segmentEnd && wordFullEnd >= segmentEnd) {
			endWordIndex = wi + 1;
			break;
		}

		fullTextPos = wordFullEnd;
	}

	return { startWordIndex, endWordIndex };
};

export interface CharTiming {
	charIndex: number;
	startTime: number;
	endTime: number;
}

const SPACE_RE = /^\s+$/;

export const buildCharTimings = (
	charOffset: number,
	segmentText: string,
	segmentStartTime: number,
	segmentEndTime: number,
	activeLine: Line | null,
): CharTiming[] => {
	const graphemes = splitLyricGraphemes(segmentText);
	if (!activeLine || graphemes.length === 0) return [];

	const nonSpaceGraphemes = graphemes.filter((g) => !SPACE_RE.test(g));
	if (nonSpaceGraphemes.length === 0) return [];

	const totalDuration = Math.max(segmentEndTime - segmentStartTime, 0.3);
	const { startWordIndex, endWordIndex } = findSegmentWordRange(
		charOffset,
		segmentText,
		activeLine.fullText,
		activeLine.words,
	);
	const segmentWords = activeLine.words.slice(startWordIndex, endWordIndex);

	let currentCharIndex = 0;
	const timings: CharTiming[] = [];

	if (segmentWords.length > 0) {
		for (const word of segmentWords) {
			if (word.syllables?.length) {
				const wordTimings = buildWordGraphemeTimings(word).filter(
					(timing) => !SPACE_RE.test(timing.char),
				);
				for (const timing of wordTimings) {
					if (currentCharIndex >= nonSpaceGraphemes.length) break;

					timings.push({
						charIndex: currentCharIndex,
						startTime: timing.startTime,
						endTime: timing.endTime,
					});

					currentCharIndex++;
				}
				continue;
			}

			const wordGraphemes = splitLyricGraphemes(word.text);
			const wordNonSpaceCount = wordGraphemes.filter(
				(g) => !SPACE_RE.test(g),
			).length;
			if (wordNonSpaceCount === 0) continue;

			const wordDuration = Math.max(word.endTime - word.startTime, 0.05);
			const charDuration = wordDuration / wordNonSpaceCount;
			let nonSpaceCi = 0;

			for (const grapheme of wordGraphemes) {
				if (currentCharIndex >= nonSpaceGraphemes.length) break;
				if (SPACE_RE.test(grapheme)) continue;

				timings.push({
					charIndex: currentCharIndex,
					startTime: word.startTime + nonSpaceCi * charDuration,
					endTime: word.startTime + (nonSpaceCi + 1) * charDuration,
				});

				currentCharIndex++;
				nonSpaceCi++;
			}
		}
	}

	if (timings.length === 0 || timings.length !== nonSpaceGraphemes.length) {
		const avgCharDuration = totalDuration / nonSpaceGraphemes.length;
		timings.length = 0;
		currentCharIndex = 0;

		for (let i = 0; i < graphemes.length; i++) {
			const isSpace = SPACE_RE.test(graphemes[i]);
			if (isSpace) continue;

			timings.push({
				charIndex: currentCharIndex,
				startTime: segmentStartTime + currentCharIndex * avgCharDuration,
				endTime: segmentStartTime + (currentCharIndex + 1) * avgCharDuration,
			});
			currentCharIndex++;
		}
	}

	return timings;
};

export const getCharPulseIntensity = (
	currentTime: number,
	charTiming: CharTiming,
): number => {
	const { startTime, endTime } = charTiming;
	const rawDuration = Math.max(endTime - startTime, 0.05);
	const duration = Math.min(Math.max(rawDuration, 0.2), 0.9);
	const elapsed = currentTime - startTime;

	if (elapsed < 0) return 0;

	if (elapsed <= duration) {
		const progress = elapsed / duration;
		return Math.sin(progress * Math.PI);
	}

	const afterElapsed = elapsed - duration;
	const afterglowRamp = duration * 1.2;
	if (afterElapsed >= afterglowRamp) return 0.25;

	return 0.25 * (afterElapsed / afterglowRamp);
};

export const buildTiltLayout = (
	fullText: string,
	lineSeed: number,
	tuning: TiltTuning,
	theme: FoliaTheme,
	fontScale: number,
): TiltLayout => {
	const fontStack = theme.fontFamily;
	// folia 经 resolveThemeFontStack/Weight 解析主题字体；Firefly 无主题字重配置，
	// 按 folia 的 fallback 值取 400（正文）/ 300（斜体）。
	const normalWeight = 400;
	const tiltWeight = 300;
	const viewportWidth =
		typeof window !== "undefined" ? window.innerWidth : 1200;
	const measureMaxPx = Math.max(
		viewportWidth * 0.06875,
		5.625 * REM_PX * fontScale,
	);
	const normalBasePx = measureMaxPx;
	const tiltBasePx = measureMaxPx;
	const availableWidth = getAvailableWidth();

	const charCount = fullText.trim().length;
	const isEllipsisOnly = /^[\s.…·。]+$/.test(fullText.trim());
	let mergedSegments: string[];

	if (isEllipsisOnly) {
		mergedSegments = [fullText];
	} else {
		const numLines = determineLineCount(
			charCount,
			lineSeed,
			tuning.splitProbability,
		);
		const layoutUnits = SentenceLayout.splitIntoSentences(
			fullText,
			numLines,
			lineSeed,
		);
		mergedSegments = layoutUnits.map((u) => u.text);
	}

	const candidates: number[] = [];
	mergedSegments.forEach((_, i) => {
		const lineRoll = seededRandom(lineSeed, 100 + i);
		if (lineRoll < tuning.tiltStyleProbability) candidates.push(i);
	});

	let finalTiltIndex = -1;
	if (candidates.length > 0) {
		finalTiltIndex =
			candidates[Math.floor(seededRandom(lineSeed, 200) * candidates.length)];
	}

	let offsetAccum = 0;
	const segments: TiltSegment[] = mergedSegments.map((text, i) => {
		const trimmed = text.trimStart().trimEnd();
		const leadingSpaces = text.length - text.trimStart().length;
		const seg: TiltSegment = {
			text: trimmed,
			isTilt: i === finalTiltIndex,
			isShortLastLine: false,
			charOffset: offsetAccum + leadingSpaces,
		};
		offsetAccum += text.length;
		return seg;
	});

	let scaleMultiplier = 1;
	const tiltWithWidth = segments
		.filter((s) => s.isTilt)
		.map((s) => ({
			text: s.text,
			width: measureAtSize(
				s.text,
				tiltBasePx,
				`${fontStack} italic`,
				tiltWeight,
			),
		}));
	const normalWithWidth = segments
		.filter((s) => !s.isTilt)
		.map((s) => ({
			text: s.text,
			width: measureAtSize(s.text, normalBasePx, fontStack, normalWeight),
		}));

	const widestTiltEntry = [...tiltWithWidth].sort(
		(a, b) => b.width - a.width,
	)[0];
	const widestNormalEntry = [...normalWithWidth].sort(
		(a, b) => b.width - a.width,
	)[0];

	const tiltWidth = widestTiltEntry?.width ?? 0;
	const normalWidth = widestNormalEntry?.width ?? 0;

	const tiltOverflow = tiltWidth > 0 ? tiltWidth / availableWidth : 0;
	const normalOverflow = normalWidth > 0 ? normalWidth / availableWidth : 0;
	const maxOverflow = Math.max(tiltOverflow, normalOverflow);

	const markShortLastLine = (segs: TiltSegment[]): TiltSegment[] => {
		if (segs.length < 2) return segs;
		const last = segs[segs.length - 1];
		if (last.isTilt || last.text.trim().length > 2) return segs;
		const prev = segs[segs.length - 2];
		if (last.text.trim().length * 2 <= prev.text.length) {
			segs[segs.length - 1] = { ...last, isShortLastLine: true };
		}
		return segs;
	};

	if (maxOverflow > 1) {
		if (maxOverflow >= RESPLIT_THRESHOLD) {
			const targetWidth = availableWidth * (RESPLIT_THRESHOLD - 0.15);
			const totalEstWidth = measureAtSize(
				fullText,
				normalBasePx,
				fontStack,
				normalWeight,
			);
			const extraSplitsNeeded = Math.min(
				4,
				Math.max(segments.length + 1, Math.ceil(totalEstWidth / targetWidth)),
			);
			if (extraSplitsNeeded > segments.length) {
				const reSplitUnits = SentenceLayout.splitIntoSentences(
					fullText,
					extraSplitsNeeded,
					lineSeed,
				);
				let reSplitOffset = 0;
				const newSegments: TiltSegment[] = reSplitUnits.map((u) => {
					const trimmed = u.text.trimStart().trimEnd();
					const leadingSpaces = u.text.length - u.text.trimStart().length;
					const seg: TiltSegment = {
						text: trimmed,
						isTilt: false,
						isShortLastLine: false,
						charOffset: reSplitOffset + leadingSpaces,
					};
					reSplitOffset += u.text.length;
					return seg;
				});
				if (newSegments.length > 0) {
					const resplitTiltRoll = seededRandom(lineSeed, 300);
					if (resplitTiltRoll < tuning.tiltStyleProbability) {
						const picked = Math.floor(
							seededRandom(lineSeed, 301) * newSegments.length,
						);
						newSegments[picked].isTilt = true;
					}
				}

				const postWidestTilt = newSegments.filter((s) => s.isTilt)[0];
				const postNormalWithWidth = newSegments
					.filter((s) => !s.isTilt)
					.map((s) => ({
						text: s.text,
						width: measureAtSize(s.text, normalBasePx, fontStack, normalWeight),
					}));
				const postWidestNormal = [...postNormalWithWidth].sort(
					(a, b) => b.width - a.width,
				)[0];

				let postScale = 1;
				if (postWidestTilt) {
					const w = measureAtSize(
						postWidestTilt.text,
						tiltBasePx,
						`${fontStack} italic`,
						tiltWeight,
					);
					if (w > availableWidth)
						postScale = Math.max(SCALE_FLOOR_TILT, availableWidth / w);
				} else if (postWidestNormal) {
					const w = measureAtSize(
						postWidestNormal.text,
						normalBasePx,
						fontStack,
						normalWeight,
					);
					if (w > availableWidth)
						postScale = Math.max(SCALE_FLOOR_NORMAL, availableWidth / w);
				}

				return {
					segments: markShortLastLine(newSegments),
					scaleMultiplier: postScale,
				};
			}
		}

		if (tiltOverflow >= normalOverflow && widestTiltEntry) {
			scaleMultiplier = Math.max(SCALE_FLOOR_TILT, availableWidth / tiltWidth);
		} else if (widestNormalEntry) {
			scaleMultiplier = Math.max(
				SCALE_FLOOR_NORMAL,
				availableWidth / normalWidth,
			);
		}
	}

	return { segments: markShortLastLine(segments), scaleMultiplier };
};
