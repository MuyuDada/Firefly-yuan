// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/runtime.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Shared runtime helpers for all visualizers.
// 只回答「现在该关心哪一行」与「要不要预热下一行」，布局自由度留给各主题。
// React hook 版（useVisualizerRuntime）改为纯函数，Svelte 侧用 $derived 调用。

import type { Line } from "@/utils/lyrics";

export interface VisualizerPreheatWindow {
	minLead: number;
	maxLead: number;
}

interface GetRecentCompletedLineOptions {
	lines: Line[];
	currentLineIndex: number;
	currentTime: number;
	getLineEndTime?: (line: Line) => number;
}

// This only matters when there is no active line.
// It is mainly here so subtitle overlays can keep showing the last translation during small gaps.
export const getRecentCompletedLine = ({
	lines,
	currentLineIndex,
	currentTime,
	getLineEndTime = (line: Line) => line.endTime,
}: GetRecentCompletedLineOptions): Line | null => {
	if (currentLineIndex !== -1 || lines.length === 0) {
		return null;
	}

	for (let i = lines.length - 1; i >= 0; i--) {
		if (currentTime > getLineEndTime(lines[i])) {
			return lines[i];
		}
	}

	return null;
};

// If a line is active, upcoming is just the next line in the array.
// If nothing is active yet, upcoming means "the first line whose startTime is still ahead of us".
export const getUpcomingLine = (
	lines: Line[],
	currentLineIndex: number,
	currentTime: number,
): Line | null => {
	const activeLine = lines[currentLineIndex];
	if (activeLine) {
		return lines[currentLineIndex + 1] ?? null;
	}

	for (const line of lines) {
		if (line.startTime > currentTime) {
			return line;
		}
	}

	return null;
};

// Most modes only need 1-2 lines of lookahead for subtitles or preheat, so keep this cheap and explicit.
export const getUpcomingLines = (
	lines: Line[],
	currentLineIndex: number,
	count = 2,
): Line[] => {
	if (currentLineIndex < 0) {
		return [];
	}

	return lines.slice(currentLineIndex + 1, currentLineIndex + 1 + count);
};

// The lines after the one the bottom subtitle shows: the active line, or in a gap the line just sung
// (the subtitle keeps that one up), so a "next" row does not drop out between two lines.
export const getSubtitleNextLines = (
	lines: Line[],
	currentLineIndex: number,
	recentCompletedLine: Line | null,
	count = 2,
): Line[] =>
	getUpcomingLines(
		lines,
		currentLineIndex >= 0 || !recentCompletedLine
			? currentLineIndex
			: lines.indexOf(recentCompletedLine),
		count,
	);

// Preheat windows are deliberately defined in lead time, not absolute timestamps.
// That makes them easier to tune per visualizer without coupling to line duration.
export const shouldPreheatLine = (
	line: Line | null | undefined,
	currentTime: number,
	window: VisualizerPreheatWindow,
): boolean => {
	if (!line) {
		return false;
	}

	const leadTime = line.startTime - currentTime;
	return leadTime >= window.minLead && leadTime <= window.maxLead;
};
