// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/fume/*).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Modifications: 精简 canvas 渲染管线——保留文章式排版（blocks / 多栏 / hero 变体）、
// 相机缓移与逐字素打字机高亮；跳过 geometric background 场景、live raster、
// 分片式布局调度与完整相机 step 语义。pretext 换用 folia/pretextShim。

import {
	buildWordGraphemeTimings,
	type GraphemeTiming,
	getLineRenderEndTime,
	type Line,
	type Word,
} from "@/utils/lyrics";
import { layoutWithLines, prepareWithSegments } from "../../pretextShim";
import { resolveWordColor } from "../../wordColoring";

export const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));
export const mix = (from: number, to: number, amount: number): number =>
	from + (to - from) * amount;
export const isCJKText = (text: string): boolean =>
	/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);

const graphemeSegmenter =
	typeof Intl !== "undefined"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

export const splitGraphemes = (text: string): string[] => {
	if (!text) return [];
	if (graphemeSegmenter) {
		return Array.from(
			graphemeSegmenter.segment(text),
			({ segment }) => segment,
		);
	}
	return Array.from(text);
};

const hashString = (input: string): number => {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

export const seeded =
	(seed: string) =>
	(offset: number): number => {
		const x = Math.sin(hashString(seed) + offset * 12.9898) * 43758.5453;
		return x - Math.floor(x);
	};

// fume 调参（folia 的 DEFAULT_FUME_TUNING 精简；render 挡位未移植）。
export const DEFAULT_FUME_TUNING = {
	textHoldRatio: 1,
	cameraTrackingMode: "smooth" as "smooth" | "stepped",
	cameraSpeed: 1,
	glowIntensity: 1,
	heroScale: 1,
};

export interface FumeGlyph {
	char: string;
	x: number;
	y: number;
	/** 该字素的开始时间（来自词/行时间轴）。 */
	startTime: number;
	endTime: number;
	isWordGlyph: boolean;
}

export interface FumeRenderLine {
	id: string;
	text: string;
	glyphs: FumeGlyph[];
	x: number;
	y: number;
	width: number;
}

export interface FumeBlock {
	id: string;
	sourceLineIndex: number;
	line: Line;
	variant: "body" | "hero";
	x: number;
	y: number;
	width: number;
	height: number;
	fontPx: number;
	renderLines: FumeRenderLine[];
	/** 第一个字素开始 / 最后一个字素结束时间。 */
	firstStart: number;
	lastEnd: number;
}

export interface FumeArticleLayout {
	width: number;
	height: number;
	paperBounds: { left: number; top: number; right: number; bottom: number };
	blocks: FumeBlock[];
	blockBySourceLineIndex: Map<number, FumeBlock>;
}

export interface FumeLineWordRange {
	word: Word;
	start: number;
	end: number;
	graphemeTimings: GraphemeTiming[];
}

const buildWordRanges = (
	line: Line,
	graphemes: string[],
	theme: FumeThemeLike,
): FumeLineWordRange[] => {
	const ranges: FumeLineWordRange[] = [];
	let cursor = 0;
	for (const word of line.words) {
		const target = splitGraphemes(word.text);
		let start = -1;
		for (let i = cursor; i <= graphemes.length - target.length; i++) {
			let isMatch = true;
			for (let j = 0; j < target.length; j++) {
				if (graphemes[i + j] !== target[j]) {
					isMatch = false;
					break;
				}
			}
			if (isMatch) {
				start = i;
				break;
			}
		}
		if (start === -1) start = clamp(cursor, 0, graphemes.length);
		const end = clamp(start + target.length, start, graphemes.length);
		ranges.push({
			word,
			start,
			end,
			graphemeTimings: buildWordGraphemeTimings(word),
		});
		cursor = end;
	}
	void theme;
	return ranges;
};

export interface FumeThemeLike {
	fontFamily: string;
	fontWeight: number;
	accentColor: string;
	primaryColor: string;
	wordColors: { word: string; color: string }[];
	animationIntensity: "calm" | "normal" | "chaotic";
}

/**
 * 把一行歌词排成一个 block：shim 预分段换行、逐字素 advance、词时间轴映射到字素。
 * variant: body 为正文块，hero 为强调块（字号更大、单独居中）。
 */
const buildBlock = (
	line: Line,
	sourceLineIndex: number,
	variant: "body" | "hero",
	x: number,
	y: number,
	width: number,
	theme: FumeThemeLike,
	densityScale: number,
): FumeBlock | null => {
	const graphemeList = splitGraphemes(line.fullText);
	if (graphemeList.length === 0) return null;

	const weight = variant === "hero" ? 600 : 400;
	const fontPx = Math.round((variant === "hero" ? 52 : 30) * densityScale);
	const lineHeight = Math.round(
		fontPx * (isCJKText(line.fullText) ? 1.32 : 1.16),
	);
	const font = `${weight} ${fontPx}px ${theme.fontFamily}`;

	const prepared = prepareWithSegments(line.fullText, font);
	const layout = layoutWithLines(prepared, width, lineHeight);

	// 词范围 → 字素区间（时间轴来源）。
	const wordRanges = buildWordRanges(line, graphemeList, theme);
	const glyphTimingByIndex = new Array<number>(graphemeList.length).fill(-1);
	const glyphTimingEndByIndex = new Array<number>(graphemeList.length).fill(-1);
	const glyphIsWord = new Array<boolean>(graphemeList.length).fill(false);
	wordRanges.forEach((range) => {
		const timings = range.graphemeTimings;
		for (let i = range.start; i < range.end; i += 1) {
			const local = i - range.start;
			const timing = timings[local];
			if (timing) {
				glyphTimingByIndex[i] = timing.startTime;
				glyphTimingEndByIndex[i] = timing.endTime;
				glyphIsWord[i] = true;
			}
		}
	});

	// 渲染行：沿 layout.lines 用段宽累积 x，并写每字素坐标。
	const renderLines: FumeRenderLine[] = [];
	const segMetas: Array<{ graphemeStart: number; graphemeEnd: number }> = [];
	let graphemeCursor = 0;
	for (const segment of prepared.segments) {
		const glyphs = splitGraphemes(segment);
		segMetas.push({
			graphemeStart: graphemeCursor,
			graphemeEnd: graphemeCursor + glyphs.length,
		});
		graphemeCursor += glyphs.length;
	}

	let firstStart = Number.POSITIVE_INFINITY;
	let lastEnd = 0;

	layout.lines.forEach((layoutLine, lineIndex) => {
		const startMeta = segMetas[layoutLine.start.segmentIndex];
		const endMeta =
			segMetas[Math.min(layoutLine.end.segmentIndex, segMetas.length - 1)];
		if (!startMeta || !endMeta) return;
		const globalStart =
			startMeta.graphemeStart + layoutLine.start.graphemeIndex;
		const globalEnd = Math.min(
			endMeta.graphemeStart + layoutLine.end.graphemeIndex,
			graphemeList.length,
		);
		if (globalEnd <= globalStart) return;

		const lineText = graphemeList.slice(globalStart, globalEnd).join("");
		// 段宽累计出这一行内每个字素的 x。
		const glyphs: FumeGlyph[] = [];
		let cursorX = 0;
		for (let i = globalStart; i < globalEnd; i += 1) {
			const advance = measureGraphemeAdvance(
				prepared,
				layoutLine.start.segmentIndex,
				i - globalStart,
				lineText,
				font,
				fontPx,
			);
			const timingStart =
				glyphTimingByIndex[i] >= 0 ? glyphTimingByIndex[i] : line.startTime;
			const timingEnd =
				glyphTimingEndByIndex[i] >= 0
					? glyphTimingEndByIndex[i]
					: timingStart + 0.2;
			glyphs.push({
				char: graphemeList[i],
				x: cursorX,
				y: lineIndex * lineHeight,
				startTime: timingStart,
				endTime: timingEnd,
				isWordGlyph: glyphIsWord[i],
			});
			firstStart = Math.min(firstStart, timingStart);
			lastEnd = Math.max(lastEnd, timingEnd);
			cursorX += advance;
		}

		renderLines.push({
			id: `${line.startTime}-${lineIndex}-${globalStart}`,
			text: lineText,
			glyphs,
			x: 0,
			y: lineIndex * lineHeight,
			width: cursorX,
		});
	});

	if (renderLines.length === 0) return null;

	// 词色（激活色）：按词位置给字素着色缓存。
	void resolveWordColor;

	const contentHeight = renderLines.length * lineHeight;
	const blockWidth = Math.max(...renderLines.map((line) => line.width));

	return {
		id: `${line.startTime}-${sourceLineIndex}`,
		sourceLineIndex,
		line,
		variant,
		x,
		y,
		width: blockWidth,
		height: contentHeight,
		fontPx,
		renderLines,
		firstStart: Number.isFinite(firstStart) ? firstStart : line.startTime,
		lastEnd: lastEnd > 0 ? lastEnd : getLineRenderEndTime(line),
	};
};

const advanceCache = new Map<string, number>();

const measureGraphemeAdvance = (
	_prepared: unknown,
	_segmentIndex: number,
	_localIndex: number,
	text: string,
	font: string,
	fontPx: number,
): number => {
	void _prepared;
	void _segmentIndex;
	void _localIndex;
	const key = `${font}|${fontPx}|${text}`;
	const cached = advanceCache.get(key);
	if (cached !== undefined) return cached;
	// 逐字素 advance 用整行宽 / 字素数近似（shim 的段级测量足够排版，省一次 canvas 调用）。
	if (typeof document === "undefined") return fontPx;
	if (!advanceCtx)
		advanceCtx = document.createElement("canvas").getContext("2d");
	if (!advanceCtx) return fontPx;
	advanceCtx.font = font;
	const width = advanceCtx.measureText(text).width;
	const per = width / Math.max(splitGraphemes(text).length, 1);
	advanceCache.set(key, per);
	return per;
};

let advanceCtx: CanvasRenderingContext2D | null = null;

export interface FumeArticleOptions {
	paperWidth: number;
	viewportHeight: number;
	theme: FumeThemeLike;
	heroScale: number;
}

/** 文章布局：行序排块，长行 body / 短行按种子选 hero，双栏在宽纸面上交错。 */
export const buildFumeArticle = (
	lines: Line[],
	options: FumeArticleOptions,
): FumeArticleLayout | null => {
	const { paperWidth, viewportHeight, theme, heroScale } = options;
	const densityScale = clamp(paperWidth / 900, 0.75, 1.6);
	const columns = paperWidth > 1100 ? 2 : 1;
	const gap = Math.round(paperWidth * 0.06);
	const columnWidth = Math.floor(
		(paperWidth - gap * (columns - 1) - 64) / columns,
	);

	const blocks: FumeBlock[] = [];
	let x = 32;
	let column = 0;
	let columnBottom = 0;
	const columnTops = [40, 40];

	lines.forEach((line, index) => {
		if (line.fullText === "......") return;
		const rand = seeded(`${line.startTime}`)(1);
		const isHero =
			line.fullText.length <= 14 && rand < 0.32 && line.words.length > 1;
		const variant: "body" | "hero" = isHero ? "hero" : "body";
		const targetWidth = Math.round(
			columnWidth * (variant === "hero" ? 0.86 : 0.94),
		);
		const blockX = x;
		const blockY = columnTops[column];
		const block = buildBlock(
			line,
			index,
			variant,
			blockX,
			blockY,
			targetWidth,
			theme,
			densityScale * (variant === "hero" ? heroScale : 1),
		);
		if (!block) return;

		// hero 块整体居中于所在栏。
		if (variant === "hero") {
			block.x = blockX + Math.max(0, (columnWidth - block.width) / 2);
		}

		blocks.push(block);
		columnTops[column] = blockY + block.height + Math.round(34 * densityScale);
		if (columns > 1) {
			columnBottom = Math.max(columnBottom, columnTops[column]);
			if (columnTops[column] > viewportHeight * 1.15) {
				// 栏高超出视口一段后换到下一栏。
				column = Math.min(column + 1, columns - 1);
			}
			x = column === 0 ? 32 : 32 + columnWidth + gap;
		} else {
			columnBottom = Math.max(columnBottom, columnTops[column]);
		}
	});

	if (blocks.length === 0) return null;

	const blockBySourceLineIndex = new Map<number, FumeBlock>();
	for (const block of blocks) {
		blockBySourceLineIndex.set(block.sourceLineIndex, block);
	}

	let right = 0;
	let bottom = 0;
	blocks.forEach((block) => {
		right = Math.max(right, block.x + block.width);
		bottom = Math.max(bottom, block.y + block.height);
	});

	return {
		width: Math.max(right + 48, paperWidth),
		height: bottom + 80,
		paperBounds: {
			left: 0,
			top: 0,
			right: Math.max(right + 48, paperWidth),
			bottom: bottom + 80,
		},
		blocks,
		blockBySourceLineIndex,
	};
};

/** 相机目标：聚焦当前行 block 的中心，缩放使行宽适配视口。 */
export const resolveFumeCameraTarget = (
	article: FumeArticleLayout,
	lineIndex: number,
	viewportWidth: number,
	viewportHeight: number,
): { x: number; y: number; scale: number } | null => {
	const block = article.blockBySourceLineIndex.get(lineIndex);
	if (!block) return null;
	const centerX = block.x + Math.min(block.width, viewportWidth / 0.9) / 2;
	const centerY = block.y + block.height / 2;
	const scale = clamp(
		Math.min(
			(viewportWidth * 0.92) / Math.max(block.width, 120),
			(viewportHeight * 0.6) / Math.max(block.height, 80),
		),
		0.45,
		1.15,
	);
	return { x: centerX, y: centerY, scale };
};
