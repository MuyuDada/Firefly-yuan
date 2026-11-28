// folia 主题共享的 canvas 2D 舞台助手。
// 重度 GPU 主题（pendolo / nebbia / diorama / metaphor / machi / sonnet /
// tempera / lumiere / hanabi / prompt）在 Firefly 以 canvas 2D 签名观感实现，
// 不引入 three.js 全场景 / pixi.js 依赖；AGPL 来源见 src/utils/lyrics/NOTICE.md。

import type { Line } from "@/utils/lyrics";
import type { FoliaTheme } from "../types";

export interface CanvasStageHandle {
	width: number;
	height: number;
	ctx: CanvasRenderingContext2D;
}

/** 每帧对齐画布尺寸与 DPR，返回 2D 上下文（需先 clear）。 */
export const prepareCanvasFrame = (
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
): CanvasStageHandle | null => {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	if (
		canvas.width !== Math.floor(width * dpr) ||
		canvas.height !== Math.floor(height * dpr)
	) {
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return { width, height, ctx };
};

/** 词级别的逐字素时间轴（无词时间轴时退回线性分布）。 */
export const getLineGlyphTimes = (
	line: Line,
): Array<{ char: string; startTime: number; endTime: number }> => {
	const times: Array<{ char: string; startTime: number; endTime: number }> = [];
	const fallbackDuration = Math.max(line.endTime - line.startTime, 0.4);
	if (line.words.length === 0) {
		const chars = Array.from(line.fullText);
		const unit = fallbackDuration / Math.max(chars.length, 1);
		chars.forEach((char, index) => {
			times.push({
				char,
				startTime: line.startTime + index * unit,
				endTime: line.startTime + (index + 1) * unit,
			});
		});
		return times;
	}

	let searchCursor = 0;
	line.words.forEach((word) => {
		const rangeStart = line.fullText.indexOf(word.text, searchCursor);
		if (rangeStart < 0) return;
		const rangeEnd = rangeStart + word.text.length;
		searchCursor = rangeEnd;

		const chars = Array.from(word.text);
		const perChar =
			Math.max(word.endTime - word.startTime, 0.05) / Math.max(chars.length, 1);
		chars.forEach((char, index) => {
			times.push({
				char,
				startTime: word.startTime + index * perChar,
				endTime: word.startTime + (index + 1) * perChar,
			});
		});
	});

	// 补齐词间隙字符（空格/标点）：沿用上一个词的结束时间。
	const all = Array.from(line.fullText);
	if (times.length < all.length) {
		const aligned: Array<{ char: string; startTime: number; endTime: number }> =
			[];
		let timeIndex = 0;
		for (const char of all) {
			const timing = times[timeIndex];
			if (timing && timing.char === char) {
				aligned.push(timing);
				timeIndex += 1;
			} else {
				const previous = aligned[aligned.length - 1];
				const next = times[timeIndex];
				aligned.push({
					char,
					startTime: previous?.endTime ?? line.startTime,
					endTime: next?.startTime ?? line.endTime,
				});
			}
		}
		return aligned;
	}

	return times;
};

/** 确定性伪随机（与 folia 的 seeded 惯例一致）。 */
export const seededRandom = (seed: number, offset: number): number => {
	const x = Math.sin(seed * 1000 + offset) * 10000;
	return x - Math.floor(x);
};

/** 进度 -> 发光包络（0..1，快速上升 + 缓慢衰减）。 */
export const glyphGlow = (
	time: number,
	startTime: number,
	endTime: number,
): number => {
	if (time <= startTime) return 0;
	const rise = Math.max(0.06, (endTime - startTime) * 0.4);
	const elapsed = time - startTime;
	if (elapsed <= rise) {
		const progress = elapsed / rise;
		return progress * progress * (3 - 2 * progress);
	}
	const tail = Math.max(0.5, (endTime - startTime) * 1.2);
	const progress = Math.min(1, (elapsed - rise) / tail);
	return (1 - progress) ** 2;
};

/** 当前行的下一行编号（供「下一句」预览类主题）。 */
export const nextLineIndexOf = (
	lines: Line[],
	currentLineIndex: number,
): number => (currentLineIndex >= 0 ? currentLineIndex + 1 : -1);

// 精简主题绘制场景（CompactCanvasTheme 传给 drawFrame 的参数）。
export interface CompactScene {
	time: number;
	dt: number;
	width: number;
	height: number;
	ctx: CanvasRenderingContext2D;
	line: Line | null;
	lineStart: number;
	lineProgress: number;
	bass: number;
	vocal: number;
	theme: FoliaTheme;
	lines: Line[];
	currentLineIndex: number;
	/** 主题自行缓存的静态背景画布（绘制前 blit 到主画布）。 */
	bgCache: HTMLCanvasElement | null;
	/** bgCache 需重绘（首帧或尺寸变化）。 */
	bgDirty: boolean;
}
