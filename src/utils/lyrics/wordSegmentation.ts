// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/utils/lyrics/wordSegmentation.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see NOTICE.md in this directory.

import { splitLyricGraphemes } from "./graphemeTiming";
import type { Line } from "./lyricData";

// The single word-granularity segmenter for lyrics.
// Callers that have a Line should use `segmentLyricWords`, which honours `line.wordSegments` (the
// user's saved segmentation) and then `line.autoWordSegments` (an automatic baked split).
// `segmentTextWords` is the plain Intl.Segmenter path for text that has neither.

export interface LyricWordSegment {
	segment: string;
	/** Offset of this segment inside the source text, in code units. */
	index: number;
	isWordLike: boolean;
}

const PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u;

const isWordLikeText = (text: string) => !PUNCTUATION_ONLY.test(text);

/**
 * Rebuilds full segment records from a bare boundary list. Used both for the user's saved
 * segmentation and for anything that stores boundaries as plain strings.
 */
export const segmentsFromBoundaries = (
	boundaries: string[],
): LyricWordSegment[] => {
	let cursor = 0;
	return boundaries.map((segment) => {
		const part = {
			segment,
			index: cursor,
			isWordLike: isWordLikeText(segment),
		};
		cursor += segment.length;
		return part;
	});
};

/**
 * Intl.Segmenter word split, falling back to graphemes when the runtime has no Segmenter. The
 * fallback preserves every code unit, so offsets stay valid and line timing is never lost.
 */
export const segmentTextWords = (text: string): LyricWordSegment[] => {
	if (!text) {
		return [];
	}

	const Segmenter = typeof Intl !== "undefined" ? Intl.Segmenter : undefined;
	if (Segmenter) {
		try {
			return Array.from(
				new Segmenter(undefined, { granularity: "word" }).segment(text),
				(part) => ({
					segment: part.segment,
					index: part.index,
					isWordLike: part.isWordLike ?? isWordLikeText(part.segment),
				}),
			);
		} catch {
			// The grapheme fallback below preserves every code unit and the line timing.
		}
	}

	return segmentsFromBoundaries(splitLyricGraphemes(text));
};

/**
 * True when the boundaries reconstruct the text exactly. A saved segmentation that fails this is
 * stale (the lyric source changed under it) and must be ignored rather than applied at an offset.
 */
export const isValidWordSegmentation = (
	text: string,
	boundaries: string[] | undefined,
): boundaries is string[] =>
	Array.isArray(boundaries) &&
	boundaries.length > 0 &&
	boundaries.every((segment) => typeof segment === "string") &&
	boundaries.join("") === text;

const EDGE_WHITESPACE = /^(\s*)(.*?)(\s*)$/su;

/**
 * Lifts the whitespace at a saved boundary's edges out into segments of its own, so a saved split
 * reaches the consumers in the same shape Intl.Segmenter would have produced.
 *
 * Intl.Segmenter always emits a whitespace run as a segment in its own right, and every consumer is
 * written against that. The saved format is the other way round: a space belongs to the segment
 * before it. Whitespace INSIDE a segment is deliberately left alone (a multi-word phrase kept
 * together on purpose); punctuation stays attached for the sticky passes to re-attach.
 */
const splitEdgeWhitespace = (boundaries: string[]): string[] =>
	boundaries.flatMap((boundary) => {
		const [, lead, core, trail] = EDGE_WHITESPACE.exec(boundary) ?? [];
		// No core means the boundary is whitespace only, which is already the shape we want.
		return core
			? [lead, core, trail].filter(Boolean)
			: [boundary].filter(Boolean);
	});

/**
 * Word segments for a line: the user's saved split when it is valid, else the baked split,
 * else Intl.Segmenter.
 */
export const segmentLyricWords = (
	line: Pick<Line, "fullText" | "wordSegments" | "autoWordSegments">,
): LyricWordSegment[] => {
	const { wordSegments, autoWordSegments } = line;
	if (isValidWordSegmentation(line.fullText, wordSegments)) {
		return segmentsFromBoundaries(splitEdgeWhitespace(wordSegments));
	}

	if (isValidWordSegmentation(line.fullText, autoWordSegments)) {
		return segmentsFromBoundaries(autoWordSegments);
	}

	return segmentTextWords(line.fullText);
};

/**
 * Fingerprint of a line's split, for layout cache keys and memo dependencies.
 * Boundary LENGTHS rather than the segment text: the boundaries always join back to the line's own
 * `fullText`. Empty string when the line is on plain Intl.Segmenter.
 */
export const getWordSegmentationKey = (
	line: Pick<Line, "wordSegments" | "autoWordSegments">,
): string => {
	if (line.wordSegments) {
		return line.wordSegments.map((segment) => segment.length).join(",");
	}
	return line.autoWordSegments
		? `a${line.autoWordSegments.map((segment) => segment.length).join(",")}`
		: "";
};

/**
 * Whether this line will render with a user-supplied split rather than the default one. The baked
 * split is the default, not an override, so it does not count here.
 */
export const hasWordSegmentationOverride = (
	line: Pick<Line, "fullText" | "wordSegments">,
): boolean => isValidWordSegmentation(line.fullText, line.wordSegments);
