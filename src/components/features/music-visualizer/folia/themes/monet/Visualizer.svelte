<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/monet/VisualizerMonet.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// Monet：海报式布局——左侧封面「肖像」+ 右侧标题/作者与测量滚动的歌词栏。
// folia 特有的肖像上传/拖拽挂架、音频覆盖条、浮动装饰、AutoMix 交接与设置面板不移植；
// 肖像用当前曲目封面（folia 默认 portraitSource 也是 'cover'）。
import { getLineRenderEndTime } from "@/utils/lyrics";
import { colorWithAlpha } from "../../colorMix";
import {
	getRecentCompletedLine,
	getSubtitleNextLines,
	getUpcomingLine,
} from "../../runtime";
import type { FoliaVisualizerProps } from "../../types";
import MonetRailLine from "./MonetRailLine.svelte";
import {
	buildMonetVisibleLineEntries,
	buildPositionedEntries,
	clearMonetMeasurementCaches,
	MONET_PORTRAIT_BASE_MAX_PX,
	MONET_PORTRAIT_INNER_BASE_MAX_PX,
	MONET_RAIL_BASE_MAX_HEIGHT_PX,
	MONET_RAIL_BASE_MAX_WIDTH_PX,
	MONET_RAIL_MIN_ROWS,
	MONET_ROW_BASE_MAX_WIDTH_PX,
	type MonetLayoutCache,
	type MonetLineLayoutInputs,
	measureMonetLineLayout,
	type PositionedMonetLineEntry,
	resolveClampFontPx,
	resolveMonetLargeScreenScale,
} from "./monetCore";

// Monet 调参（folia 的 DEFAULT_MONET_TUNING 精简；仅保留渲染相关的键）。
const TUNING = {
	keywordColoringEnabled: true,
	fontScale: 1.2,
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

let shellEl: HTMLDivElement | undefined = $state();
let railEl: HTMLDivElement | undefined = $state();
let shellWidth = $state(0);
let railSize = $state({ width: 0, height: 0 });

const recentCompletedLine = $derived(
	getRecentCompletedLine({
		lines,
		currentLineIndex,
		currentTime: clock.value,
		getLineEndTime: getLineRenderEndTime,
	}),
);
const upcomingLine = $derived(
	getUpcomingLine(lines, currentLineIndex, clock.value),
);
const nextLines = $derived(
	getSubtitleNextLines(lines, currentLineIndex, recentCompletedLine),
);
const activeLine = $derived(lines[currentLineIndex] ?? null);

const trackInfo = $derived(window.__fireflyMusic?.getState().track ?? null);
const songTitle = $derived(trackInfo?.name?.trim() || "Monet");
const songArtist = $derived(trackInfo?.artist?.trim() || "");
const coverUrl = $derived(trackInfo?.pic || null);

const largeScreenScale = $derived(resolveMonetLargeScreenScale(shellWidth));
const fontScale = TUNING.fontScale * lyricsFontScale;
const lyricFontPx = $derived(
	resolveClampFontPx(1.34, 2.75, 2.28) * fontScale * largeScreenScale,
);
const inactiveFontPx = $derived(
	resolveClampFontPx(1.08, 2, 1.48) * fontScale * largeScreenScale,
);
const translationFontPx = $derived(
	resolveClampFontPx(0.94, 1.28, 1.14) * largeScreenScale,
);
const rowMaxWidthPx = $derived(
	Math.round(MONET_ROW_BASE_MAX_WIDTH_PX * largeScreenScale),
);
const portraitMaxPx = $derived(
	Math.round(MONET_PORTRAIT_BASE_MAX_PX * largeScreenScale),
);
const portraitInnerMaxPx = $derived(
	Math.round(MONET_PORTRAIT_INNER_BASE_MAX_PX * largeScreenScale),
);
const titleMaxRem = (2.8 * largeScreenScale).toFixed(3);
const artistMaxRem = (1.8 * largeScreenScale).toFixed(3);

const visibleLineEntries = $derived(
	buildMonetVisibleLineEntries({
		lines,
		currentLineIndex,
		activeLine,
		recentCompletedLine,
		upcomingLine,
		currentTime: clock.value,
	}),
);

const layoutCache: MonetLayoutCache = new Map();
const glowBufferPx = $derived(Math.round(lyricFontPx * 1.2));
const vGlowBufferPx = $derived(Math.round(lyricFontPx * 1.2));
const railMaxWidthPx = $derived(
	Math.round(MONET_RAIL_BASE_MAX_WIDTH_PX * largeScreenScale),
);
const railMaxHeightPx = $derived(
	Math.round(
		Math.max(
			MONET_RAIL_BASE_MAX_HEIGHT_PX * largeScreenScale,
			lyricFontPx * 1.18 * MONET_RAIL_MIN_ROWS,
		),
	),
);
const lyricFontWeight = theme.fontWeight;
const translationFontWeight = 500;

// 排布依赖视口尺寸与可见行，二者变化时重算（结果写 $state，模板只读）。
let positionedEntries = $state<PositionedMonetLineEntry[]>([]);

$effect(() => {
	const entries = visibleLineEntries;
	const size = railSize;
	if (!railEl) {
		positionedEntries = [];
		return;
	}
	const layoutInputs: Omit<MonetLineLayoutInputs, "fontPx" | "maxWidthPx"> = {
		translationFontPx,
		fontStack: theme.fontFamily,
		fontWeight: lyricFontWeight,
		translationFontWeight,
	};
	positionedEntries = buildPositionedEntries(
		entries,
		size,
		theme,
		lyricFontPx,
		inactiveFontPx,
		layoutInputs,
		glowBufferPx,
		layoutCache,
	);
});

// 尺寸观察：shell 宽度驱动大屏缩放，rail 尺寸驱动排布。
$effect(() => {
	const element = shellEl;
	if (!element) return;
	const update = () => {
		shellWidth = element.clientWidth;
	};
	update();
	const observer = new ResizeObserver(update);
	observer.observe(element);
	return () => observer.disconnect();
});

$effect(() => {
	const element = railEl;
	if (!element) return;
	const update = () => {
		railSize = { width: element.clientWidth, height: element.clientHeight };
	};
	update();
	const observer = new ResizeObserver(update);
	observer.observe(element);
	return () => observer.disconnect();
});

void getBands;
</script>

<div class="folia-theme folia-monet" data-folia-theme="monet">
	<div class="folia-monet-shell" bind:this={shellEl}>
		<div class="folia-monet-row" style={`max-width:${rowMaxWidthPx}px;`}>
			{#if showText}
				<div class="folia-monet-textcol">
					<div class="folia-monet-header">
						<div
							class="folia-monet-artist"
							style={`color:${colorWithAlpha(theme.primaryColor, 0.96)};font-size:clamp(1rem, 1.8vw, ${artistMaxRem}rem);`}
						>
							{songArtist}
						</div>
						<div
							class="folia-monet-divider"
							style={`background:linear-gradient(180deg, ${colorWithAlpha(theme.primaryColor, 0.72)}, transparent);`}
						></div>
					</div>
					<div class="folia-monet-titlewrap" style={`max-width:${railMaxWidthPx}px;`}>
						<div
							class="folia-monet-title"
							style={`color:${theme.primaryColor};font-size:clamp(1.45rem, 3.3vw, ${titleMaxRem}rem);text-shadow:0 14px 36px ${colorWithAlpha(theme.backgroundColor, 0.28)};`}
						>
							{songTitle}
						</div>
						<div class="folia-monet-album" style={`color:${colorWithAlpha(theme.secondaryColor, 0.84)};`}>
							{songArtist ? "" : ""}
						</div>
					</div>
					<div class="folia-monet-railwrap">
						<div
							bind:this={railEl}
							class="folia-monet-rail"
							style={`height:clamp(280px, 52vh, ${railMaxHeightPx}px);max-width:${railMaxWidthPx}px;margin-left:-${glowBufferPx}px;margin-right:-${glowBufferPx}px;padding-left:${glowBufferPx}px;padding-right:${glowBufferPx}px;`}
						>
							{#if positionedEntries.length > 0}
								{#each positionedEntries as entry (entry.key)}
									<MonetRailLine
										{entry}
										{clock}
										{theme}
										{lyricFontPx}
										fontStack={theme.fontFamily}
										{glowBufferPx}
										{vGlowBufferPx}
									/>
								{/each}
							{/if}
						</div>
					</div>
				</div>
			{/if}

			{#if showText}
				<div class="folia-monet-portraitcol" style={`flex:0 0 clamp(220px, 28vw, ${portraitMaxPx}px);`}>
					<div class="folia-monet-portraitbox" style={`max-width:clamp(210px, 26vw, ${portraitInnerMaxPx}px);`}>
						<div
							class="folia-monet-portrait"
							style={coverUrl ? `background-image:url("${coverUrl}");` : `background-image:linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor});`}
						></div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
