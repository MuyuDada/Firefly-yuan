<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/tilt/VisualizerTilt.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// tilt：把一行歌词按概率拆成 1-4 行，两套排版（普通横排 / 大号斜体错落），
// 段落按时间顺序逐段显现，字符带上下交替偏移与逐字脉动。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getLineRenderEndTime } from "@/utils/lyrics";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";
import TiltLine from "./TiltLine.svelte";
import {
	buildTiltLayout,
	DEFAULT_TILT_TUNING,
	findSegmentWordRange,
	type TiltLayout,
} from "./tiltLayout";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

let visibleSegmentIndex = $state(-1);

const activeLine = $derived(lines[currentLineIndex] ?? null);

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

const layout = $derived.by<TiltLayout | null>(() => {
	if (!activeLine?.fullText) return null;
	return buildTiltLayout(
		activeLine.fullText,
		activeLine.startTime,
		DEFAULT_TILT_TUNING,
		theme,
		lyricsFontScale,
	);
});

const segmentTimings = $derived.by(() => {
	if (!activeLine || !layout) return null;

	return layout.segments.map((seg) => {
		const { startWordIndex, endWordIndex } = findSegmentWordRange(
			seg.charOffset,
			seg.text,
			activeLine.fullText,
			activeLine.words,
		);
		const segWords = activeLine.words.slice(startWordIndex, endWordIndex);

		if (segWords.length > 0) {
			return {
				start: segWords[0].startTime,
				end: segWords[segWords.length - 1].endTime,
			};
		}

		return {
			start: activeLine.startTime,
			end: getLineRenderEndTime(activeLine),
		};
	});
});

// 段落显隐：时钟驱动，仅在目标段变化时写状态。
$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		if (!segmentTimings || !activeLine) {
			visibleSegmentIndex = -1;
			return;
		}

		let targetIndex = -1;
		for (let i = 0; i < segmentTimings.length; i++) {
			if (latest >= segmentTimings[i].start - 0.25) {
				targetIndex = i;
			}
		}

		if (
			latest < activeLine.startTime - 0.1 ||
			latest > getLineRenderEndTime(activeLine)
		) {
			targetIndex = -1;
		}

		if (visibleSegmentIndex !== targetIndex) visibleSegmentIndex = targetIndex;
	});
	return unsubscribe;
});

const subtitleSizes = $derived(resolveSubtitleFontSizes(lyricsFontScale));

// 换行淡入/淡出（folia tilt：入场 opacity、离场压缩到 220ms，避免新旧行重叠）。
const lineIn = (_dom: Element) => ({
	duration: 300,
	css: (t: number) => `opacity:${t};`,
});
const lineOut = (_dom: Element) => ({
	duration: 220,
	css: (t: number) => `opacity:${1 - t};`,
});
</script>

<div class="folia-theme folia-tilt" data-folia-theme="tilt">
	<div class="folia-classic-area">
		{#if showText && activeLine && layout}
			{#key activeLine.startTime}
				<div
					class="folia-tilt-lines"
					in:lineIn
					out:lineOut
				>
					{#each layout.segments as segment, si (`seg-${si}-${segment.text}`)}
						<TiltLine
							{segment}
							{theme}
							fontScale={lyricsFontScale}
							scaleMultiplier={layout.scaleMultiplier}
							visible={si <= visibleSegmentIndex}
							colorScheme={DEFAULT_TILT_TUNING.colorScheme}
							{clock}
							segmentStartTime={segmentTimings?.[si]?.start ?? 0}
							segmentEndTime={segmentTimings?.[si]?.end ?? 0}
							{activeLine}
						/>
					{/each}
				</div>
			{/key}
		{:else if showText}
			<div class="folia-empty" style={`color:${theme.secondaryColor};`}>
				{i18n(I18nKey.musicNoPlaying)}
			</div>
		{/if}
	</div>

	<SubtitleOverlay
		activeLine={activeLine}
		recentCompletedLine={recentCompletedLine}
		nextLines={nextLines}
		{theme}
		translationFontSize={subtitleSizes.translationFontSize}
		upcomingFontSize={subtitleSizes.upcomingFontSize}
	/>
</div>
