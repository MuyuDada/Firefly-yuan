<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/fume/VisualizerFume.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// fume（浮名）：聚焦模式——只渲染当前行 ±1 行，字号固定可读，相机微漂移；
// 已唱文字留在画面上渐淡（文章感），当前字素打字机式点亮。
// 简化移植：跳过多栏排版 / geometric background / 相机 step / live raster。
import { getLineRenderEndTime } from "@/utils/lyrics";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { i18n } from "@/i18n/translation";
import I18nKey from "@/i18n/i18nKey";
import type { FoliaVisualizerProps } from "../../types";
import { clamp } from "./fumeCore";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

let viewportEl: HTMLDivElement | undefined = $state();
let canvasEl: HTMLCanvasElement | undefined = $state();
let viewport = $state({ width: 0, height: 0 });

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
	const element = viewportEl;
	if (!element) return;
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (!entry) return;
		viewport = {
			width: entry.contentRect.width,
			height: entry.contentRect.height,
		};
	});
	observer.observe(element);
	return () => observer.disconnect();
});

let driftPhase = 0;

$effect(() => {
	const canvas = canvasEl;
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	let frameId = 0;
	let lastTime: number | null = null;
	const fadeState = new Map<number, number>();

	const draw = () => {
		const now = performance.now();
		const dt =
			lastTime === null
				? 1 / 60
				: clamp((now - lastTime) / 1000, 1 / 240, 0.05);
		lastTime = now;
		const width = Math.max(Math.floor(viewport.width), 1);
		const height = Math.max(Math.floor(viewport.height), 1);
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

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = "rgba(10, 10, 18, 0.92)";
		ctx.fillRect(0, 0, width, height);

		const paper = ctx.createRadialGradient(
			width / 2,
			height * 0.4,
			10,
			width / 2,
			height * 0.4,
			width * 0.6,
		);
		paper.addColorStop(0, "rgba(255, 252, 240, 0.03)");
		paper.addColorStop(1, "rgba(255, 252, 240, 0)");
		ctx.fillStyle = paper;
		ctx.fillRect(0, 0, width, height);

		const time = clock.value;
		driftPhase += dt * 0.15;
		const driftX = Math.sin(driftPhase) * 14;
		const driftY = Math.cos(driftPhase * 0.7) * 8;

		const fontSize = Math.min(width * 0.052, 44 * lyricsFontScale);
		const lineHeight = fontSize * 1.4;
		const focusY = height * 0.44;

		for (let offset = -1; offset <= 1; offset++) {
			const idx = currentLineIndex + offset;
			const line = lines[idx];
			if (!line || line.fullText === "......") continue;

			const isActive = offset === 0;
			const yBase = focusY + offset * lineHeight * 1.6 + driftY;

			let alpha = 1;
			if (!isActive) {
				const key = idx;
				const prevAlpha = fadeState.get(key) ?? 0.18;
				const lineEnd = getLineRenderEndTime(line);
				const isPast = time > lineEnd;
				if (isPast) {
					alpha = Math.max(0.04, prevAlpha - dt * 0.3);
				} else {
					alpha = Math.min(0.18, prevAlpha + dt * 0.3);
				}
				fadeState.set(key, alpha);
				if (alpha < 0.05) continue;
			}

			ctx.globalAlpha = alpha;
			ctx.font = `${isActive ? 600 : 400} ${isActive ? fontSize : fontSize * 0.7}px ${theme.fontFamily}`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";

			const chars = Array.from(line.fullText);
			const charWidths: number[] = [];
			for (const char of chars) {
				charWidths.push(ctx.measureText(char).width);
			}
			const totalW = charWidths.reduce((sum, w) => sum + w, 0);
			const startX = width / 2 - totalW / 2 + driftX;
			const duration = Math.max(
				getLineRenderEndTime(line) - line.startTime,
				0.4,
			);

			let cursorX = startX;
			for (let ci = 0; ci < chars.length; ci++) {
				const char = chars[ci];
				const charTime =
					line.startTime + (ci / Math.max(chars.length, 1)) * duration;
				const charGlow = clamp((time - charTime) / 0.3, 0, 1);

				if (isActive) {
					const lit = time >= charTime;
					if (lit) {
						ctx.fillStyle = theme.primaryColor;
						ctx.shadowColor = theme.accentColor;
						ctx.shadowBlur = 16 * charGlow;
					} else {
						ctx.globalAlpha = alpha * 0.08;
						ctx.fillStyle = theme.primaryColor;
						ctx.shadowBlur = 0;
					}
				} else {
					ctx.fillStyle = theme.primaryColor;
					ctx.shadowBlur = 0;
				}

				ctx.fillText(char, cursorX + charWidths[ci] / 2, yBase);
				cursorX += charWidths[ci];
				ctx.shadowBlur = 0;
				ctx.globalAlpha = alpha;
			}
			ctx.globalAlpha = 1;
		}

		if (fadeState.size > 6) {
			for (const key of Array.from(fadeState.keys())) {
				if (Math.abs(key - currentLineIndex) > 3) fadeState.delete(key);
			}
		}

		frameId = window.requestAnimationFrame(draw);
	};

	draw();
	return () => {
		window.cancelAnimationFrame(frameId);
	};
});
</script>

<div class="folia-theme folia-fume" data-folia-theme="fume" bind:this={viewportEl}>
	<canvas bind:this={canvasEl} class="folia-fume-canvas"></canvas>

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
