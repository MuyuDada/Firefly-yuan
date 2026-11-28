// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/cadenza/cadenzaTypes.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Modifications: pretext 类型换成 folia/pretextShim 的等效类型。

import type { GraphemeTiming, Line, Word } from "@/utils/lyrics";
import type { LineTransitionTiming } from "@/utils/lyrics/renderHints";
import type {
	ShimLayout,
	ShimLayoutLine,
	ShimPrepared,
} from "../../pretextShim";

// Cadenza 的布局 / 动画中间结构：分段元信息、词范围、跨行片段、落点，以及运行时缓存的准备态。

export interface SegmentMeta {
	graphemeStart: number;
	graphemeEnd: number;
	graphemeCount: number;
}

export interface WordRange {
	wordIndex: number;
	word: Word;
	start: number;
	end: number;
	color: string;
	graphemeTimings: GraphemeTiming[];
}

export interface WordFragment {
	wordIndex: number;
	lineIndex: number;
	word: Word;
	text: string;
	color: string;
	startX: number;
	endX: number;
	fragmentStartInWord: number;
	fragmentEndInWord: number;
	wordGraphemeCount: number;
	wordGraphemeTimings: GraphemeTiming[];
	fragmentIndexInWord: number;
	fragmentCountInWord: number;
	isPrimaryFragment: boolean;
	isSplitAcrossLines: boolean;
}

export interface WordPlacement {
	id: string;
	wordIndex: number;
	word: Word;
	text: string;
	color: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotate: number;
	scale: number;
	passedRotate: number;
	passedDriftX: number;
	passedDriftY: number;
	entryOffsetX: number;
	entryOffsetY: number;
	fragmentStartInWord: number;
	fragmentEndInWord: number;
	wordGraphemeCount: number;
	wordGraphemeTimings: GraphemeTiming[];
	emphasis: number;
	isInterlude: boolean;
}

export interface AnimatedPlacementState {
	x: number;
	y: number;
	rotation: number;
	scale: number;
	bodyAlpha: number;
	blur: number;
	activeMix: number;
	glowAlpha: number;
}

export interface OverlayWordNodes {
	outer: HTMLDivElement;
	inner: HTMLDivElement;
	body: HTMLSpanElement;
	glow: HTMLSpanElement;
	glyphSpans: HTMLSpanElement[];
	glyphSignature: string;
	/** What the nodes currently show, so a frame only touches what changed; null before the first write. */
	written: OverlayWordFrame | null;
	/** The text-shadow each glyph span currently has, index-aligned with `glyphSpans`. */
	glyphShadows: string[];
	/** The draw-loop frame that last used these nodes; older ones are removed at the end of a frame. */
	frame: number;
}

/** One word's DOM state for a frame, as strings ready to assign. */
export interface OverlayWordFrame {
	outerTransform: string;
	willChange: string;
	font: string;
	innerTransform: string;
	text: string;
	color: string;
	opacity: string;
	filter: string;
}

export interface PreparedState {
	prepared: ShimPrepared;
	text: string;
	font: string;
	fontPx: number;
	lineHeight: number;
	maxWidth: number;
	layout: ShimLayout;
	segmentMetas: SegmentMeta[];
	graphemes: string[];
	placements: WordPlacement[];
}

export interface PreparedStateCacheContext {
	showText: boolean;
	viewport: { width: number; height: number };
	theme: {
		fontFamily: string;
		fontWeight: number;
		animationIntensity: string;
		accentColor: string;
		wordColors: { word: string; color: string }[];
	};
	tuning: { fontScale: number; widthRatio: number };
}

export interface ResolvedLineRenderTiming {
	renderHints: NonNullable<Line["renderHints"]> | null;
	lineRenderEndTime: number;
	wordRevealMode: "normal" | "fast" | "instant";
	lastWordEndTime: number;
	linePassHold: number;
	transitionTiming: LineTransitionTiming;
}

export type { ShimLayoutLine };
