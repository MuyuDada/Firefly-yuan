<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/pendolo).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// pendolo（时计）：机械摆钟——摆臂按低音摆动，钟摆两侧悬挂当前句的逐字铭牌，
// 字素按时间点亮。Firefly 简化移植：canvas 2D 签名观感，跳过 WebGL 路径与 htdemucs 拍点。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getLineRenderEndTime } from "@/utils/lyrics";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";
import {
	type CanvasStageHandle,
	glyphGlow,
	prepareCanvasFrame,
} from "../canvasStage";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
	getBands,
}: FoliaVisualizerProps = $props();

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
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	let frameId = 0;
	let lastTime: number | null = null;
	let swingPhase = 0;

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
		const bass = Math.max(0, Math.min(1, bands ? bands.bass : 0));
		const line = lines[currentLineIndex] ?? null;

		// 摆臂相位：随低音加速。
		swingPhase += dt * (0.9 + bass * 1.6);
		const swing = Math.sin(swingPhase * Math.PI) * (0.12 + bass * 0.1);

		// 背景。
		ctx.fillStyle = "rgba(6, 6, 12, 0.42)";
		ctx.fillRect(0, 0, width, height);

		const centerX = width / 2;
		const pivotY = height * 0.08;
		const armLength = Math.min(height * 0.34, 260);

		// 悬挂机构。
		ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(centerX - 90, pivotY);
		ctx.lineTo(centerX + 90, pivotY);
		ctx.stroke();

		// 摆臂（旋转）。
		ctx.save();
		ctx.translate(centerX, pivotY);
		ctx.rotate(swing);
		ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(0, armLength);
		ctx.stroke();

		// 摆锤。
		const bobRadius = 16 + bass * 8;
		const bobGradient = ctx.createRadialGradient(
			0,
			armLength,
			2,
			0,
			armLength,
			bobRadius * 1.8,
		);
		bobGradient.addColorStop(0, theme.accentColor);
		bobGradient.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = bobGradient;
		ctx.beginPath();
		ctx.arc(0, armLength, bobRadius * 1.8, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = theme.accentColor;
		ctx.beginPath();
		ctx.arc(0, armLength, bobRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		// 当前句：挂在摆臂两侧的铭牌字。
		if (line) {
			const fontSize = Math.min(width * 0.055, 44 * lyricsFontScale);
			ctx.font = `${theme.fontWeight} ${fontSize}px ${theme.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const chars = Array.from(line.fullText);
			const spread = Math.min(width * 0.62, chars.length * fontSize * 0.82);
			const startX = centerX - spread / 2;
			const step = chars.length > 1 ? spread / (chars.length - 1) : 0;
			const y = pivotY + armLength + fontSize * 1.4;

			chars.forEach((char, index) => {
				const x = startX + index * step;
				// 逐字时间近似：线性分布（pendolo 铭牌以行级点亮为主）。
				const charProgress =
					time >= line.endTime
						? 1
						: time >= line.startTime
							? (time - line.startTime) /
								Math.max(0.001, line.endTime - line.startTime)
							: 0;
				const charLit = index / Math.max(chars.length - 1, 1) <= charProgress;
				const distanceFromPivot =
					Math.abs(x - centerX) / Math.max(width * 0.4, 1);
				const swingShift = Math.sin(swing) * (pivotY + armLength - y) * -0.3;
				const glow = charLit ? 1 : 0.16;

				ctx.save();
				ctx.translate(x + swingShift, y + Math.sin(index * 0.7) * 4);
				ctx.rotate(Math.sin(swing) * distanceFromPivot * 0.5);
				ctx.globalAlpha = 0.28 + glow * 0.7;
				ctx.fillStyle = charLit ? theme.accentColor : theme.primaryColor;
				if (charLit) {
					ctx.shadowColor = theme.accentColor;
					ctx.shadowBlur = 18 * glow;
				}
				ctx.fillText(char, 0, 0);
				ctx.restore();
			});
		} else {
			ctx.globalAlpha = 0.5;
			ctx.fillStyle = theme.secondaryColor;
			ctx.font = `400 ${Math.min(width * 0.03, 26)}px ${theme.fontFamily}`;
			ctx.textAlign = "center";
			ctx.fillText(i18n(I18nKey.musicNoPlaying), centerX, height * 0.5);
			ctx.globalAlpha = 1;
		}

		frameId = window.requestAnimationFrame(draw);
	};

	draw();
	return () => {
		window.cancelAnimationFrame(frameId);
	};
});
</script>

<div class="folia-theme folia-pendolo" data-folia-theme="pendolo">
	<canvas bind:this={canvasEl} class="folia-pendolo-canvas"></canvas>

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
