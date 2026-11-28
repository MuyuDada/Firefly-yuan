<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/cappella/VisualizerCappella.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// cappella（合唱）：把逐字时间轴的歌词编排成确定性的群聊对话流——
// 发送者左右分布、active 气泡放大发光并逐字浮现、时间戳在唱完后出现。
// 表情/头像图库是 folia 特有资产，不移植（emo 池为空、头像为渐变占位）。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getLineRenderEndTime } from "@/utils/lyrics";
import {
	getRecentCompletedLine,
	getSubtitleNextLines,
	shouldPreheatLine,
} from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import type { FoliaVisualizerProps } from "../../types";
import CappellaMessageRow from "./CappellaMessageRow.svelte";
import {
	CAPPELLA_PREHEAT_WINDOW,
	type CappellaIntensityConfig,
	type CappellaMessage,
	getCappellaIntensityConfig,
	type PreparedBubbleMetrics,
} from "./cappellaCore";
import {
	buildCappellaMessages,
	getVisibleLineIndexAtTime,
	getVisibleMessages,
} from "./cappellaMetrics";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

let viewportSize = $state({
	width: typeof window === "undefined" ? 1280 : window.innerWidth,
	height: typeof window === "undefined" ? 900 : window.innerHeight,
});
const bubbleMetricsCache = new Map<string, PreparedBubbleMetrics>();
let visibleLineIndex = $state(-1);

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

const intensityConfig: CappellaIntensityConfig = $derived(
	getCappellaIntensityConfig(theme.animationIntensity),
);
const titleText = $derived(
	window.__fireflyMusic?.getState().track?.name?.trim() ||
		i18n(I18nKey.musicNoPlaying),
);
const messages = $derived(
	buildCappellaMessages(
		lines,
		titleText,
		intensityConfig,
		{ showEmoMessages: false, avatarSource: "color" },
		[],
		false,
	),
);
const baseFontSize = $derived(Math.max(15, Math.min(26, 18 * lyricsFontScale)));
const maxPanelWidth = $derived(
	Math.min(Math.max(viewportSize.width - 32, 1), 896),
);
const bubbleGroupRatio = $derived(viewportSize.width >= 640 ? 0.68 : 0.78);
const maxTextWidth = $derived(
	Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56)),
);

const visibleMessages = $derived.by(() => {
	return getVisibleMessages(
		messages,
		visibleLineIndex,
		viewportSize.height,
		currentLineIndex,
		clock.value,
		intensityConfig.motion,
		theme,
		baseFontSize,
		maxTextWidth,
	);
});

$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, latest);
		if (nextVisibleLineIndex !== visibleLineIndex) {
			visibleLineIndex = nextVisibleLineIndex;
		}

		const upcoming =
			currentLineIndex >= 0 ? (lines[currentLineIndex + 1] ?? null) : null;
		if (
			!upcoming ||
			!shouldPreheatLine(upcoming, latest, CAPPELLA_PREHEAT_WINDOW)
		) {
			return;
		}

		getOrBuildBubbleMetrics(bubbleMetricsCache, {
			line: upcoming,
			theme,
			fontSize: baseFontSize * intensityConfig.motion.activeFontMultiplier,
			lineHeightPx:
				baseFontSize * intensityConfig.motion.activeFontMultiplier * 1.45,
			maxTextWidth,
			paddingX: intensityConfig.motion.activePaddingX,
			paddingY: intensityConfig.motion.activePaddingY,
		});
	});
	return unsubscribe;
});

$effect(() => {
	const handleResize = () => {
		viewportSize = {
			width: window.innerWidth,
			height: window.innerHeight,
		};
	};
	window.addEventListener("resize", handleResize);
	return () => window.removeEventListener("resize", handleResize);
});

void showText;
</script>

<div class="folia-theme folia-cappella" data-folia-theme="cappella">
	{#if showText}
		<div class="folia-cappella-viewport">
			<div class="folia-cappella-panel">
				{#each visibleMessages as message (message.id)}
					<CappellaMessageRow
						{message}
						{clock}
						{currentLineIndex}
						{theme}
						{baseFontSize}
						{maxTextWidth}
						metricsCache={bubbleMetricsCache}
						{intensityConfig}
					/>
				{/each}
			</div>
		</div>
	{/if}

	{#if showText && lines.length === 0}
		<div class="folia-empty" style={`color:${theme.secondaryColor};`}>
			{i18n(I18nKey.musicNoPlaying)}
		</div>
	{/if}

	{#if showText}
		<SubtitleOverlay
			activeLine={lines[currentLineIndex] ?? null}
			recentCompletedLine={recentCompletedLine}
			nextLines={nextLines}
			{theme}
			translationFontSize={`${Math.max(14, 16 * lyricsFontScale)}px`}
			upcomingFontSize={`${Math.max(12, 14 * lyricsFontScale)}px`}
		/>
	{/if}
</div>
