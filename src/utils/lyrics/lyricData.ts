// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/types.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see NOTICE.md in this directory.
// Modifications: trimmed to the lyric fields Firefly's fullscreen lyrics use;
// TTML agent/background-vocal structures removed. Times are seconds.

import type { LineRenderHints } from "./renderHints";

// 歌词数据模型。时间源是 Line.words 的逐词时间轴（秒），
// fullText 只用于排版/搜索，永远不要拿它做时间推导。

export interface LyricSyllable {
	text: string;
	startTime: number;
	endTime: number;
}

export interface Word {
	text: string;
	startTime: number;
	endTime: number;
	syllables?: LyricSyllable[];
}

export interface Line {
	words: Word[];
	startTime: number;
	endTime: number;
	fullText: string;
	translation?: string;
	romanization?: string;
	id?: string;
	agentId?: string;
	songPart?: string;
	blockIndex?: number;
	renderHints?: LineRenderHints;
	isChorus?: boolean;
	chorusEffect?: "bars" | "circles" | "beams";
	// 用户保存的 fullText 细分词边界（词段 join('') 必须等于 fullText）。
	// 存在时优先于一切自动分词。
	wordSegments?: string[];
	// 自动分词结果（词边界），没有 wordSegments 时使用。
	autoWordSegments?: string[];
}

export interface LyricData {
	lines: Line[];
	title?: string;
	artist?: string;
	isWordByWord?: boolean;
}
