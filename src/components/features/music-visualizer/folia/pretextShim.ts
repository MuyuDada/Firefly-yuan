// Firefly 的 pretext（@chenglou/pretext）canvas 等效垫片。
// folia 的 cadenza / fume 用 pretext 做「分段 → 测宽 → 换行布局」；这里用
// Intl.Segmenter + canvas measureText 等效实现同样的数据形状，避免引入依赖。
// 与 pretext 的差异（已足够这些模式的布局决策）：
//   - 段 = Intl.Segmenter 词级分段；CJK 词再拆成逐字素段（CJK 可任意断行）；
//   - breakableFitAdvances = 段内逐字素 advance（逐字素 measureText 累计近似）；
//   - 换行为贪心断行；baseline = lineHeight * (index + 0.82)。

export interface ShimLayoutCursor {
	segmentIndex: number;
	graphemeIndex: number;
}

export interface ShimLayoutLine {
	start: ShimLayoutCursor;
	end: ShimLayoutCursor;
	width: number;
	baseline: number;
}

export interface ShimLayout {
	lines: ShimLayoutLine[];
	lineHeight: number;
	maxWidth: number;
}

export interface ShimPrepared {
	text: string;
	/** 分段（最小可断行单元）：词级段 + 空白段，CJK 词逐字素拆段。 */
	segments: string[];
	/** 每段的宽度。 */
	widths: number[];
	/** 每段内逐字素的 advance（pretext 的 breakableFitAdvances 等效）。 */
	breakableFitAdvances: number[][];
	/** 全部字素的扁平列表（跨段）。 */
	graphemes: string[];
	font: string;
}

const graphemeSegmenter =
	typeof Intl !== "undefined"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

const wordSegmenter =
	typeof Intl !== "undefined"
		? new Intl.Segmenter(undefined, { granularity: "word" })
		: null;

const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

const splitGraphemes = (text: string): string[] => {
	if (!text) return [];
	if (graphemeSegmenter) {
		return Array.from(
			graphemeSegmenter.segment(text),
			({ segment }) => segment,
		);
	}
	return Array.from(text);
};

let measureCanvas: HTMLCanvasElement | null = null;

const measureWidth = (
	text: string,
	font: string,
	letterSpacingPx: number,
): number => {
	if (!text) return 0;
	if (typeof document === "undefined") return text.length * 8;
	if (!measureCanvas) measureCanvas = document.createElement("canvas");
	const ctx = measureCanvas.getContext("2d");
	if (!ctx) return text.length * 8;
	ctx.font = font;
	if ("letterSpacing" in ctx) {
		(
			ctx as CanvasRenderingContext2D & { letterSpacing: string }
		).letterSpacing = `${letterSpacingPx}px`;
	}
	return ctx.measureText(text).width;
};

/** pretext prepareWithSegments 的等效：分段并测出每段宽度与逐字素 advance。 */
export function prepareWithSegments(text: string, font: string): ShimPrepared {
	const segments: string[] = [];
	const widths: number[] = [];
	const breakableFitAdvances: number[][] = [];
	const graphemes: string[] = [];

	const pushSegment = (segment: string) => {
		if (!segment) return;
		const glyphs = splitGraphemes(segment);
		segments.push(segment);
		widths.push(measureWidth(segment, font, 0));
		const advances: number[] = [];
		for (const glyph of glyphs) {
			advances.push(measureWidth(glyph, font, 0));
		}
		breakableFitAdvances.push(advances);
		graphemes.push(...glyphs);
	};

	if (wordSegmenter) {
		try {
			for (const part of wordSegmenter.segment(text)) {
				const segment = part.segment;
				if (!segment) continue;
				// CJK 词（无空格脚本）逐字素拆段，允许任意断行；其他词保持整词。
				if (part.isWordLike && CJK_REGEX.test(segment) && segment.length > 1) {
					for (const glyph of splitGraphemes(segment)) {
						pushSegment(glyph);
					}
				} else {
					pushSegment(segment);
				}
			}
		} catch {
			pushSegment(text);
		}
	} else {
		for (const token of text.split(/(\s+)/)) {
			pushSegment(token);
		}
	}

	return { text, segments, widths, breakableFitAdvances, graphemes, font };
}

/** pretext layoutWithLines 的等效：贪心断行 + 游标换算。 */
export function layoutWithLines(
	prepared: ShimPrepared,
	maxWidth: number,
	lineHeight: number,
): ShimLayout {
	const lines: ShimLayoutLine[] = [];
	const { segments, widths } = prepared;

	let currentWidth = 0;
	let startSegment = 0;
	let startGrapheme = 0;

	const flushLine = (endSegmentExclusive: number, endGrapheme: number) => {
		let width = 0;
		for (let i = startSegment; i < endSegmentExclusive; i++) {
			width += widths[i] ?? 0;
		}
		lines.push({
			start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
			end: { segmentIndex: endSegmentExclusive, graphemeIndex: endGrapheme },
			width,
			baseline: lineHeight * (lines.length + 0.82),
		});
		startSegment = endSegmentExclusive;
		startGrapheme = endGrapheme;
		currentWidth = 0;
	};

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const width = widths[i] ?? 0;
		const isWhitespace = /^\s+$/.test(segment);

		if (currentWidth > 0 && currentWidth + width > maxWidth && !isWhitespace) {
			// 断行：空白段粘在前一行行尾。
			flushLine(i, 0);
		}

		currentWidth += width;
		if (isWhitespace && currentWidth > maxWidth && currentWidth > width) {
			// 单个空白超宽的极端情况：换行。
			flushLine(i + 1, 0);
		}
	}

	if (startSegment < segments.length || lines.length === 0) {
		flushLine(segments.length, 0);
	}

	return { lines, lineHeight, maxWidth };
}

/** 游标对应的扁平字素下标（供片段切分用）。 */
export function cursorToGraphemeIndex(
	prepared: ShimPrepared,
	cursor: ShimLayoutCursor,
): number {
	const { segments, breakableFitAdvances } = prepared;
	let index = 0;
	for (let i = 0; i < cursor.segmentIndex && i < segments.length; i++) {
		index +=
			breakableFitAdvances[i]?.length ?? splitGraphemes(segments[i]).length;
	}
	return index + cursor.graphemeIndex;
}
