<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/VisualizerSubtitleOverlay.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 共享底部字幕浮层：当前行的译文 + 后续两句预览。裁剪掉 folia 的排布配置
// （SubtitleOverlayLayout / 罗马音轨 / 播放页底栏联动），固定为「译文 + 下一句 ×2」。

import type { Line } from "@/utils/lyrics";
import { colorWithAlpha } from "./colorMix";
import type { FoliaTheme } from "./types";

// 与 folia 的 subtitleTrackStyle.ts 相同的次行视觉（译文堆叠的第二行更安静）。
const SECONDARY_TRACK_SIZE_FACTOR = 0.88;
const SECONDARY_TRACK_OPACITY = 0.82;
const SECONDARY_TRACK_FONT_WEIGHT_FALLBACK = 400;
const SECONDARY_TRACK_GAP_EM = 0.25;

// 纯标记行（"//"、"●●●"、划线等）不是展示文本：至少要含一个字母或数字才显示。
const hasReadableText = (text?: string | null): boolean =>
	!!text && /[\p{L}\p{N}]/u.test(text);

let {
	activeLine,
	recentCompletedLine,
	nextLines,
	theme,
	translationFontSize,
	upcomingFontSize,
	opacity = 0.6,
	subtitleFontScale = 1,
}: {
	activeLine: Line | null;
	recentCompletedLine: Line | null;
	nextLines: Line[];
	theme: FoliaTheme;
	translationFontSize: string;
	upcomingFontSize: string;
	opacity?: number;
	subtitleFontScale?: number;
} = $props();

const line = $derived(activeLine ?? recentCompletedLine);
const previewLines = $derived(
	nextLines.filter((next) => hasReadableText(next.fullText)),
);
const translationText = $derived(
	line?.translation && hasReadableText(line.translation)
		? line.translation.trim()
		: null,
);

const scaleFontSize = (fontSize: string, factor = 1) =>
	fontSize.replace(
		/(-?\d*\.?\d+)(rem|vw|px)/g,
		(_match, value, unit) =>
			`${(Number(value) * subtitleFontScale * factor).toFixed(3)}${unit}`,
	);

const textShadow = $derived(`0 1px 2px ${colorWithAlpha("#0a0a15", 0.24)}`);
const glowBackground = $derived(
	`radial-gradient(ellipse 115% 130% at center, ${colorWithAlpha("#0a0a15", 0.96)} 0%, ${colorWithAlpha("#0a0a15", 0.78)} 62%, transparent 100%)`,
);
</script>

{#if line && (translationText || previewLines.length > 0)}
	<div class="folia-subtitle" style={`--folia-subtitle-opacity:${opacity};`}>
		<div class="folia-subtitle-inner">
			{#if translationText}
				<div class="folia-subtitle-backing" style={`background:${glowBackground};`} aria-hidden="true"></div>
				<div class="folia-subtitle-rows">
					<div
						class="folia-subtitle-row"
						style={`color:${theme.secondaryColor};font-size:${scaleFontSize(translationFontSize)};font-weight:500;text-shadow:${textShadow};`}
					>
						{translationText}
					</div>
					{#each previewLines as next, index (next.startTime)}
						<div
							class="folia-subtitle-row folia-subtitle-row--upcoming"
							style={`color:${theme.secondaryColor};font-size:${scaleFontSize(translationFontSize, SECONDARY_TRACK_SIZE_FACTOR)};font-weight:${SECONDARY_TRACK_FONT_WEIGHT_FALLBACK};opacity:${SECONDARY_TRACK_OPACITY};margin-top:${SECONDARY_TRACK_GAP_EM}em;text-shadow:${textShadow};`}
						>
							{next.fullText}
						</div>
					{/each}
				</div>
			{:else}
				<div class="folia-subtitle-backing" style={`background:${glowBackground};`} aria-hidden="true"></div>
				<div class="folia-subtitle-rows">
					{#each previewLines as next (next.startTime)}
						<p
							class="folia-subtitle-row folia-subtitle-row--upcoming"
							style={`color:${theme.secondaryColor};font-size:${scaleFontSize(upcomingFontSize)};font-weight:400;text-shadow:${textShadow};`}
						>
							{next.fullText}
						</p>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
