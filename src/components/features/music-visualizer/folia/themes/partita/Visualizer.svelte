<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/partita/VisualizerPartita.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// partita（云阶）：词驱动但需要先把行切成 chunk 排进列结构。
// 布局在换行时构建并按 key 缓存，下一句进入预热窗口就提前构建，词在结构内做三态动画。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getLineRenderEndTime } from "@/utils/lyrics";
import {
	getGlowWordLineContainerMotion,
	resolveGlowWordRenderProfile,
} from "../../glowWordTiming";
import {
	getRecentCompletedLine,
	getSubtitleNextLines,
	shouldPreheatLine,
} from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";
import PartitaChunk from "./PartitaChunk.svelte";
import {
	DEFAULT_PARTITA_TUNING,
	EMPTY_PARTITA_LAYOUT,
	getOrBuildPartitaLayout,
	PARTITA_PREHEAT_WINDOW,
	type PartitaSequentialLayout,
} from "./partitaLayout";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

let windowHeight = $state(
	typeof window === "undefined" ? 800 : window.innerHeight,
);

$effect(() => {
	const handleResize = () => {
		windowHeight = window.innerHeight;
	};
	window.addEventListener("resize", handleResize);
	return () => window.removeEventListener("resize", handleResize);
});

const activeLine = $derived(lines[currentLineIndex] ?? null);
const activeLineRenderProfile = $derived(
	resolveGlowWordRenderProfile(activeLine),
);
const containerMotion = $derived(
	getGlowWordLineContainerMotion(activeLineRenderProfile),
);

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

// 布局缓存：模块生命周期内复用（folia 的 layoutCacheRef + LRU）。
const layoutCache = new Map<string, PartitaSequentialLayout>();
const sequentialLayout = $derived.by(() => {
	if (!activeLine) {
		return EMPTY_PARTITA_LAYOUT;
	}
	return getOrBuildPartitaLayout(
		layoutCache,
		activeLine,
		theme,
		windowHeight,
		DEFAULT_PARTITA_TUNING,
	);
});

// 预热：下一句进入预热窗口就提前构建它的布局。
$effect(() => {
	const upcoming =
		currentLineIndex >= 0 ? (lines[currentLineIndex + 1] ?? null) : null;
	if (!upcoming) return;
	const unsubscribe = clock.subscribe((latest) => {
		if (!shouldPreheatLine(upcoming, latest, PARTITA_PREHEAT_WINDOW)) {
			return;
		}
		getOrBuildPartitaLayout(
			layoutCache,
			upcoming,
			theme,
			windowHeight,
			DEFAULT_PARTITA_TUNING,
		);
	});
	return unsubscribe;
});

const densityScale = $derived(
	(sequentialLayout.totalGraphemes > 40 ? 0.8 : 1) * lyricsFontScale,
);
const mainFontSize = $derived(
	`clamp(${(2.5 * densityScale).toFixed(3)}rem, ${(5.5 * densityScale).toFixed(3)}vw, ${(4.5 * densityScale).toFixed(3)}rem)`,
);
const emptyFontSize = $derived(
	`clamp(${(1.2 * lyricsFontScale).toFixed(3)}rem, ${(2.8 * lyricsFontScale).toFixed(3)}vw, ${(1.9 * lyricsFontScale).toFixed(3)}rem)`,
);
const subtitleSizes = $derived(resolveSubtitleFontSizes(lyricsFontScale));

// 整行呼吸浮动（partita 版不带倍率调节）。
const floatStyle = $derived.by(() => {
	const configByIntensity = {
		calm: { distance: 10, duration: 8.5 },
		normal: { distance: 14, duration: 7 },
		chaotic: { distance: 18, duration: 5.8 },
	} as const;
	const { distance, duration } = configByIntensity[theme.animationIntensity];
	return `--folia-float-dist:${distance}px;--folia-float-scale:0.01;animation:folia-breathe ${duration}s ease-in-out infinite;`;
});

// 换行入场/离场（与 classic 相同的容器动效）。
const lineIn = $derived.by(() => {
	const initial = containerMotion.initial;
	return (_dom: Element) => ({
		duration: Math.max(containerMotion.enterDuration, 0.001) * 1000,
		css: (t: number) =>
			`opacity:${t};transform:scale(${initial.scale + (1 - initial.scale) * t});filter:blur(${initial.blur * (1 - t)}px);`,
	});
});
const lineOut = $derived.by(() => {
	const exit = containerMotion.exit;
	// 同 classic：旧行退场压缩到 160ms，避免新旧行动画重叠。
	return (_dom: Element) => ({
		duration: 160,
		css: (t: number) =>
			`opacity:${1 - t};transform:scale(${1 + (exit.scale - 1) * t});filter:blur(${exit.blur * t}px);`,
	});
});
</script>

<div class="folia-theme folia-partita" data-folia-theme="partita">
	<div class="folia-classic-area" style={floatStyle}>
		{#if showText && activeLine && activeLineRenderProfile}
			{#key activeLine.startTime}
				<div
					class="folia-partita-line"
					in:lineIn
					out:lineOut
					style={`perspective:${sequentialLayout.lineConfig.perspective}px;gap:${sequentialLayout.lineConfig.columnGap};`}
				>
					{#each sequentialLayout.columns as column (column.id)}
						<div class="folia-partita-column">
							<div class="folia-partita-column-words">
								{#each column.words as entry (entry.config.id)}
									<PartitaChunk
										chunkWords={entry.chunkWords}
										displayWords={entry.displayWords}
										config={entry.config}
										guideIndex={entry.rowIndex}
										{clock}
										{theme}
										baseColor={theme.primaryColor}
										renderProfile={activeLineRenderProfile}
										isChorus={activeLine.isChorus}
										showGuideLines={DEFAULT_PARTITA_TUNING.showGuideLines}
										fontSize={mainFontSize}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/key}
		{:else if showText}
			<div class="folia-empty" style={`color:${theme.secondaryColor};font-size:${emptyFontSize};`}>
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
