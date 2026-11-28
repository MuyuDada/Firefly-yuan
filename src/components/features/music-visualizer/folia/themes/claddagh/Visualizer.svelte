<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/claddagh/VisualizerCladdagh.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// claddagh（克拉达）：歌词一行行挂在与屏幕对角线对齐的 3D 椭圆环上，
// 换行时圆环 spring 自转半圈，逐字沿环排布、按深度做缩放/模糊/发光。
// framer 的 useSpring/animate 以 ringMotion.ts 的手写积分等效；轴线脉冲直接
// 写样式；音频频段来自 AudioAnalyzer（getBands）。
import { buildLineGraphemeTimeline } from "@/utils/lyrics";
import { colorWithAlpha, mixColors } from "../../colorMix";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import type { FoliaVisualizerProps } from "../../types";
import { buildMeasuredSpacingInfo } from "./claddaghLayout";
import { adjustCladdaghTimeline } from "./claddaghTimeline";
import RingLine from "./RingLine.svelte";
import { claddaghRing } from "./ringMotion";

// claddagh 调参（folia 的 DEFAULT_CLADDAGH_TUNING；调参 UI 暂未开放，取默认值）。
const TUNING = {
	focusScaleRatio: 0.65,
	radiusScale: 1.0,
	ellipseTiltDeg: 45,
	showAxisLine: true,
	letterSpacingOffset: 0,
	positionX: 0,
	positionY: 0,
	showTranslation: false,
	translationScale: 1,
	translationLetterSpacingOffset: 0,
} as const;

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
	getBands,
}: FoliaVisualizerProps = $props();

const positionX = TUNING.positionX ?? 0;
const positionY = TUNING.positionY ?? 0;
const showRingTranslation = TUNING.showTranslation === true;
const centerNormalTiltDeg = 90 - TUNING.ellipseTiltDeg;

const recentCompletedLine = $derived(
	getRecentCompletedLine({
		lines,
		currentLineIndex,
		currentTime: clock.value,
	}),
);
const nextLines = $derived(
	getSubtitleNextLines(lines, currentLineIndex, recentCompletedLine),
);

const isChorus = $derived(lines[currentLineIndex]?.isChorus ?? false);

// Determine the focus line index
const focusIndex = $derived(
	currentLineIndex !== -1
		? currentLineIndex
		: recentCompletedLine
			? lines.indexOf(recentCompletedLine)
			: -1,
);
const centerLineIndex = $derived(Math.max(-1, focusIndex));

// 圆环自转目标：跨多行跳变直接落位，相邻行走 spring（folia 的 lineOffset animate）。
let lastCenterIndex = $state(-1);
let renderBaseIndex = $state(-1);

$effect(() => {
	const curr = centerLineIndex;
	if (curr < 0) return;
	const prev = lastCenterIndex;
	lastCenterIndex = curr;

	if (Math.abs(curr - prev) > 1) {
		claddaghRing.snapTo(curr * Math.PI);
	} else {
		claddaghRing.target = curr * Math.PI;
	}
	if (curr !== renderBaseIndex) {
		renderBaseIndex = curr;
	}
});

// Keep the transition pair + one preceding line rendered so the outgoing
// line remains visible during the spring rotation.
const lineIndicesToRender = $derived.by(() => {
	const indices: number[] = [];
	if (lines.length === 0) return indices;
	for (let i = renderBaseIndex - 1; i <= renderBaseIndex + 2; i++) {
		if (i >= 0 && i < lines.length) {
			indices.push(i);
		}
	}
	if (indices.length === 0) {
		indices.push(Math.max(0, Math.min(centerLineIndex, lines.length - 1)));
	}
	return indices;
});

// 当前行（圆环焦点行）的字素间距信息，供 back-follow 计算。
const activeSpacingInfo = $derived.by(() => {
	const line = lines[renderBaseIndex];
	if (!line) return [];
	const timeline = adjustCladdaghTimeline(
		buildLineGraphemeTimeline(line),
		line,
	);
	return buildMeasuredSpacingInfo(
		timeline,
		`${theme.fontWeight} ${72 * lyricsFontScale}px ${theme.fontFamily}`,
		72 * lyricsFontScale,
		Rx,
		(1 + TUNING.focusScaleRatio) / (1 + 0.65),
		TUNING.letterSpacingOffset,
	);
});

// Radial configuration (increased to prevent long sentence overlaps)
let dimensions = $state({ width: 800, height: 600 });
let containerEl: HTMLDivElement | undefined = $state();

$effect(() => {
	const container = containerEl;
	if (!container) return;
	const rect = container.getBoundingClientRect();
	if (rect.width > 0 && rect.height > 0) {
		dimensions = { width: rect.width, height: rect.height };
	}
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry) {
			const { width, height } = entry.contentRect;
			if (width > 0 && height > 0) {
				dimensions = { width, height };
			}
		}
	});
	observer.observe(container);
	return () => observer.disconnect();
});

const Rx = $derived(
	(dimensions.width > 0 ? Math.min(dimensions.width * 0.44, 560) : 360) *
		TUNING.radiusScale,
);
const Ry = $derived(Rx > 0 ? Rx * Math.SQRT1_2 : 254); // 45-degree angle projection ratio

// 轴线脉冲：直接写背景渐变与变换（folia 的独立 rAF 循环并入共享时钟）。
let axisEl: HTMLDivElement | undefined = $state();
let glowIntensity = 0;

$effect(() => {
	if (!axisEl) return;
	const unsubscribe = clock.subscribe(() => {
		claddaghRing.step(performance.now());
		const bassPower = Math.max(0, Math.min(1, claddaghRing.bass));
		const vocalPower = Math.max(0, Math.min(1, claddaghRing.vocal));
		const fromColor = theme.primaryColor || "#ffffff";
		let toColor = theme.accentColor || "#ffffff";
		// If primary and accent are the same, try secondary
		if (toColor === fromColor && theme.secondaryColor) {
			toColor = theme.secondaryColor;
		}
		// If still the same, mix with white to guarantee visual color change on beats
		if (toColor === fromColor) {
			toColor = "#ffffff";
		}

		// Color response (using maximum of bass and vocal energy for high responsiveness)
		const colorPower = Math.max(bassPower, vocalPower);
		const colorDelta = Math.max(0, colorPower - 0.02);
		const colorRatio = Math.min(1.0, colorDelta / 0.58);

		// Mix between fromColor and toColor, pulsing alpha from 0.2 to 0.95 (vivid color beat)
		const mixed = mixColors(
			fromColor,
			toColor,
			colorRatio,
			0.2 + 0.75 * colorRatio,
		);

		// Linear-gradient fades out the line at its endpoints (20% and 80%).
		const gradientString = `linear-gradient(90deg, transparent, ${mixed} 20%, ${mixed} 80%, transparent)`;
		axisEl.style.background = gradientString;
		axisEl.style.backgroundImage = gradientString;

		// Square the bass power to expand the dynamic range
		const bassSqr = bassPower * bassPower;

		// Dynamic length scaling via scaleX and subtle thickness via scaleY
		const scaleX = 1.0 + bassSqr * 1.5;
		const scaleY = 1.0 + bassSqr * 0.5;
		axisEl.style.transform = `translate(-50%, -50%) rotate(${centerNormalTiltDeg}deg) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;

		// Smoothly transition glow intensity
		const targetIntensity = isChorus ? 1.0 : 0.0;
		const diff = targetIntensity - glowIntensity;
		if (Math.abs(diff) > 0.01) {
			glowIntensity += Math.sign(diff) * 0.05;
			glowIntensity = Math.max(0, Math.min(1, glowIntensity));
		} else {
			glowIntensity = targetIntensity;
		}

		if (glowIntensity > 0.001) {
			const glowSize = (4 + bassPower * 12) * glowIntensity;
			const glowColor = colorWithAlpha(mixed, glowIntensity);
			axisEl.style.filter = `drop-shadow(0 0 ${glowSize.toFixed(1)}px ${glowColor})`;
		} else {
			axisEl.style.filter = "none";
		}
	});
	return unsubscribe;
});

const subtitleSizes = {
	translationFontSize: "clamp(1.1rem, 2.2vw, 1.45rem)",
	upcomingFontSize: "clamp(0.95rem, 1.8vw, 1.2rem)",
};
</script>

<div class="folia-theme folia-claddagh" data-folia-theme="claddagh">
	<div
		class="folia-claddagh-stage"
		bind:this={containerEl}
		style={`transform:${positionX !== 0 || positionY !== 0 ? `translate(${positionX}%, ${positionY}%)` : "none"};`}
	>
		{#if TUNING.showAxisLine}
			<div
				bind:this={axisEl}
				class="folia-claddagh-axis"
				style={`left:${50 + positionX}%;top:${50 + positionY}%;transform:translate(-50%, -50%) rotate(${centerNormalTiltDeg}deg) scale(1, 1);`}
			></div>
		{/if}

		{#if showText && Rx > 0 && Ry > 0}
			{#each lineIndicesToRender as idx (idx)}
				<RingLine
					line={lines[idx]}
					lineIndex={idx}
					{clock}
					{theme}
					{lyricsFontScale}
					{Rx}
					{Ry}
					{getBands}
					containerWidth={dimensions.width}
					containerHeight={dimensions.height}
					{activeSpacingInfo}
					{renderBaseIndex}
					{lines}
					{centerLineIndex}
					focusScaleRatio={TUNING.focusScaleRatio}
					ellipseTiltDeg={TUNING.ellipseTiltDeg}
					textSpacingScale={(1 + TUNING.focusScaleRatio) / (1 + 0.65)}
					letterSpacingOffset={TUNING.letterSpacingOffset}
					translation={showRingTranslation ? lines[idx]?.translation : undefined}
					translationFontWeight={theme.fontWeight}
					translationScale={TUNING.translationScale}
					translationLetterSpacingOffset={TUNING.translationLetterSpacingOffset}
				/>
			{/each}
		{/if}
	</div>

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
