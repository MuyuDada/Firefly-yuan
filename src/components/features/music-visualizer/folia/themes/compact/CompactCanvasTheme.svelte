<script lang="ts">
// folia 重度主题（nebbia/diorama/metaphor/machi/sonnet/tempera/lumiere/hanabi/prompt）
// 的 canvas 2D 简化移植共用外壳：主题组件提供 drawFrame(ctx, scene) 即可。
// AGPL：签名观感参考 folia-web 对应主题（见 NOTICE.md），不引入 GPU 依赖。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getLineRenderEndTime } from "@/utils/lyrics";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";
import {
	type CanvasStageHandle,
	type CompactScene,
	prepareCanvasFrame,
} from "../canvasStage";
import type { LyricClock } from "../lyricClock";

export interface CompactScene {
	time: number;
	dt: number;
	width: number;
	height: number;
	ctx: CanvasRenderingContext2D;
	line: Line | null;
	/** 当前行开始的秒数（无行时为 -1）。 */
	lineStart: number;
	/** 行内播放进度 0..1（无行时 0）。 */
	lineProgress: number;
	bass: number;
	vocal: number;
	theme: FoliaTheme;
	lines: Line[];
	currentLineIndex: number;
}

let {
	mode,
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
	getBands,
	drawFrame,
}: FoliaVisualizerProps & {
	mode: string;
	drawFrame: (scene: CompactScene) => void;
} = $props();

let canvasEl: HTMLCanvasElement | undefined = $state();

const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`;
const subtitleSizes = $derived(resolveSubtitleFontSizes(lyricsFontScale));

const recentCompletedLine = $derived(
	getRecentCompletedLine({
		lines,
		currentLineIndex,
		currentTime: clock.value,
		getLineEndTime: getLineRenderEndTime,
	}),
);
const nextLines = $derived(
	getSubtitleNextLines(lines, currentLineIndex, recentCompletedLine),
);

$effect(() => {
	const canvas = canvasEl;
	if (!canvas || !showText) return;
	const rawCtx = canvas.getContext("2d");
	if (!rawCtx) return;

	let frameId = 0;
	let lastTime: number | null = null;

	const draw = () => {
		const now = performance.now();
		const dt =
			lastTime === null ? 1 / 60 : Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;

		const width = Math.max(window.innerWidth, 1);
		const height = Math.max(window.innerHeight, 1);
		const stage: CanvasStageHandle | null = prepareCanvasFrame(
			canvas,
			width,
			height,
		);
		if (!stage) {
			frameId = window.requestAnimationFrame(draw);
			return;
		}

		const time = clock.value;
		const bands = getBands?.();
		const line = lines[currentLineIndex] ?? null;
		const lineStart = line?.startTime ?? -1;
		const lineEnd = line ? getLineRenderEndTime(line) : 0;
		const lineProgress =
			line && time >= line.startTime
				? Math.max(
						0,
						Math.min(
							1,
							(time - line.startTime) /
								Math.max(0.001, lineEnd - line.startTime),
						),
					)
				: 0;

		try {
			drawFrame({
				time,
				dt,
				width,
				height,
				ctx: stage.ctx,
				line,
				lineStart,
				lineProgress,
				bass: Math.max(0, Math.min(1, bands ? bands.bass : 0)),
				vocal: Math.max(0, Math.min(1, bands ? bands.vocal : 0)),
				theme,
				lines,
				currentLineIndex,
			});
		} catch {
			// 主题绘制异常不拖垮整个共享时钟。
		}

		frameId = window.requestAnimationFrame(draw);
	};

	draw();
	return () => {
		window.cancelAnimationFrame(frameId);
	};
});

void clock;
void currentLineIndex;
void lines;
void mode;
</script>

<div class="folia-theme folia-compact" data-folia-theme={mode}>
	<canvas bind:this={canvasEl} class="folia-compact-canvas"></canvas>

	{#if showText && lines.length === 0}
		<div class="folia-empty" style={`color:${theme.secondaryColor};font-size:${emptyFontSize};`}>
			{i18n(I18nKey.musicNoPlaying)}
		</div>
	{/if}

	{#if showText}
		<SubtitleOverlay
			activeLine={lines[currentLineIndex] ?? null}
			recentCompletedLine={recentCompletedLine}
			nextLines={nextLines}
			{theme}
			translationFontSize={subtitleSizes.translationFontSize}
			upcomingFontSize={subtitleSizes.upcomingFontSize}
		/>
	{/if}
</div>
