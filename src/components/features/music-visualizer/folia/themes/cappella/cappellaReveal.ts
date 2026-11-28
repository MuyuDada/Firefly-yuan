// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/cappella/cappellaReveal.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// 逐字出现的时间表：每个字素的出现时刻、淡入时长与时间戳就绪时刻。

import {
	buildLineGraphemeTimeline,
	buildWordGraphemeTimings,
	type Line,
	splitLyricGraphemes,
} from "@/utils/lyrics";
import type { CharacterRevealPlan } from "./cappellaCore";
import { DEFAULT_CHAR_FADE_MS, MIN_CHAR_FADE_MS } from "./cappellaCore";

export const getLineCharacters = (line: Line): string[] =>
	splitLyricGraphemes(line.fullText);

const getWordTextRanges = (line: Line) => {
	const ranges: Array<{ start: number; end: number } | null> = [];
	let searchCursor = 0;

	line.words.forEach((word) => {
		const start = line.fullText.indexOf(word.text, searchCursor);
		if (start < 0) {
			ranges.push(null);
			return;
		}

		const end = start + word.text.length;
		ranges.push({ start, end });
		searchCursor = end;
	});

	return ranges;
};

// Builds a per-character reveal timeline from parser word timings.
export const buildCharacterRevealTimes = (
	line: Line,
	characters: string[],
): number[] => {
	const revealTimes = characters.map(() => Number.POSITIVE_INFINITY);
	const lineTimeline = buildLineGraphemeTimeline(line);
	if (lineTimeline.length === characters.length) {
		lineTimeline.forEach((timing, index) => {
			revealTimes[index] = timing.startTime;
		});
		return revealTimes;
	}

	const ranges = getWordTextRanges(line);
	let previousWordEndCharacterIndex = 0;
	let lastResolvedRevealTime = line.startTime;
	let hasResolvedRevealTime = false;

	line.words.forEach((word, index) => {
		const range = ranges[index];
		if (!range) {
			return;
		}

		const startCharacterIndex = splitLyricGraphemes(
			line.fullText.slice(0, range.start),
		).length;
		const endCharacterIndex = splitLyricGraphemes(
			line.fullText.slice(0, range.end),
		).length;
		const wordTimings = buildWordGraphemeTimings(word);

		// Characters between two timed words are usually spaces or sticky punctuation.
		// Reveal them with the next word so the visible text remains contiguous.
		for (
			let characterIndex = previousWordEndCharacterIndex;
			characterIndex < startCharacterIndex;
			characterIndex += 1
		) {
			revealTimes[characterIndex] = word.startTime;
		}

		wordTimings.forEach((timing, characterIndex) => {
			const targetIndex = startCharacterIndex + characterIndex;
			if (targetIndex >= revealTimes.length) {
				return;
			}

			revealTimes[targetIndex] = timing.startTime;
			lastResolvedRevealTime = Math.max(
				lastResolvedRevealTime,
				revealTimes[targetIndex],
			);
			hasResolvedRevealTime = true;
		});

		previousWordEndCharacterIndex = endCharacterIndex;
	});

	// Any unmatched trailing characters still belong to this line visually.
	const trailingRevealTime = hasResolvedRevealTime
		? lastResolvedRevealTime
		: line.endTime;
	for (
		let characterIndex = previousWordEndCharacterIndex;
		characterIndex < revealTimes.length;
		characterIndex += 1
	) {
		revealTimes[characterIndex] = trailingRevealTime;
	}

	return revealTimes;
};

// revealTimes is monotonic, so playback can resolve the visible count with O(log n).
export const getCharacterCountAtTime = (
	revealTimes: number[],
	currentTime: number,
): number => {
	let low = 0;
	let high = revealTimes.length;

	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (revealTimes[mid] <= currentTime) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
};

export const getBubbleTargetCharacterCount = (
	metrics: { bubbleTargetTimes: number[] },
	currentTime: number,
): number => getCharacterCountAtTime(metrics.bubbleTargetTimes, currentTime);

export const getTimestampReadyTime = (
	metrics: { timestampReadyTime: number } | null,
	line: Line,
): number => metrics?.timestampReadyTime ?? line.endTime;

// Builds the CSS fade duration for each character. The timestamp uses the same
// values so it appears after the last visible character has finished fading in.
export const buildCharacterFadeDurationsMs = (
	line: Line,
	characters: string[],
): number[] => {
	const fadeDurationsMs = characters.map(() => DEFAULT_CHAR_FADE_MS);
	const lineTimeline = buildLineGraphemeTimeline(line);
	if (lineTimeline.length === characters.length) {
		lineTimeline.forEach((timing, index) => {
			fadeDurationsMs[index] = Math.max(
				(timing.endTime - timing.startTime) * 1000,
				MIN_CHAR_FADE_MS,
			);
		});
		return fadeDurationsMs;
	}

	const ranges = getWordTextRanges(line);

	line.words.forEach((word, index) => {
		const range = ranges[index];
		if (!range) {
			return;
		}

		const startCharacterIndex = splitLyricGraphemes(
			line.fullText.slice(0, range.start),
		).length;
		const wordTimings = buildWordGraphemeTimings(word);

		for (
			let characterIndex = 0;
			characterIndex < wordTimings.length;
			characterIndex += 1
		) {
			const targetIndex = startCharacterIndex + characterIndex;
			if (targetIndex >= fadeDurationsMs.length) {
				break;
			}

			const timing = wordTimings[characterIndex];
			fadeDurationsMs[targetIndex] = timing
				? Math.max((timing.endTime - timing.startTime) * 1000, MIN_CHAR_FADE_MS)
				: DEFAULT_CHAR_FADE_MS;
		}
	});

	return fadeDurationsMs;
};

export const getTimestampReadyTimeFromMetrics = (
	line: Line,
	revealTimes: number[],
	fadeDurationsMs: number[],
): number => {
	if (revealTimes.length === 0) {
		return line.endTime;
	}

	return revealTimes.reduce((latest, time, index) => {
		if (!Number.isFinite(time)) {
			return latest;
		}

		return Math.max(
			latest,
			time + (fadeDurationsMs[index] ?? DEFAULT_CHAR_FADE_MS) / 1000,
		);
	}, line.startTime);
};

// Builds per-character fade durations while keeping the existing reveal order and entry timing.
export const getCharacterRevealPlan = (line: Line): CharacterRevealPlan => {
	const characters = Array.from(line.fullText);
	const fadeDurationsMs = buildCharacterFadeDurationsMs(line, characters);

	return { characters, fadeDurationsMs };
};
