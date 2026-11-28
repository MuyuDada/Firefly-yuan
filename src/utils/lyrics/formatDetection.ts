// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/utils/lyrics/formatDetection.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see NOTICE.md in this directory.
// Modifications: TTML detection removed (Firefly does not port the TTML parser).

export type TimedLyricFormat = "lrc" | "enhanced-lrc" | "vtt";
export type ExplicitFileTimedLyricFormat =
	| Exclude<TimedLyricFormat, "lrc" | "enhanced-lrc">
	| "yrc"
	| "qrc"
	| "krc";

const VTT_TIMING_LINE_REGEX =
	/(?:^|\n)\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}/m;
const ENHANCED_LRC_ANGLE_REGEX = /<\d{2}:\d{2}[.:]\d{2,3}>/;
const ENHANCED_LRC_INLINE_BRACKET_REGEX =
	/(?:^|\n)\s*\[\d{2}:\d{2}[.:]\d{2,3}\][^[\]\n]+(?:\[\d{2}:\d{2}[.:]\d{2,3}\][^[\]\n]*)+/m;
const EXPLICIT_FILE_FORMATS: Record<string, ExplicitFileTimedLyricFormat> = {
	vtt: "vtt",
	qrc: "qrc",
	yrc: "yrc",
	krc: "krc",
};

export function detectTimedLyricFormat(content?: string): TimedLyricFormat {
	const normalized = content?.replace(/^\uFEFF/, "").trim() || "";

	// A bare `-->` is not enough: lyric text can contain one (`go --> there`), and parseVTT only
	// understands cues whose timing line matches VTT_TIMING_LINE_REGEX, so anything the regex
	// misses would have parsed to zero lines as VTT anyway.
	if (
		normalized.startsWith("WEBVTT") ||
		VTT_TIMING_LINE_REGEX.test(normalized)
	) {
		return "vtt";
	}

	if (
		ENHANCED_LRC_ANGLE_REGEX.test(normalized) ||
		ENHANCED_LRC_INLINE_BRACKET_REGEX.test(normalized)
	) {
		return "enhanced-lrc";
	}

	return "lrc";
}

export function resolveExplicitFileTimedLyricFormat(
	fileName?: string,
): ExplicitFileTimedLyricFormat | undefined {
	const extension = fileName?.toLowerCase().match(/\.([^.]+)$/)?.[1];
	return extension ? EXPLICIT_FILE_FORMATS[extension] : undefined;
}
