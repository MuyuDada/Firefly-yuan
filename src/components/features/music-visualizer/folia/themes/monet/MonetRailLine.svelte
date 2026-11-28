<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/monet/{MonetRailLine,MonetRailTokens}.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 歌词栏中的一行：每个词一个文字 span，颜色直接从 baseColor 渐变到 wordColor，
// 发光用 text-shadow（去掉了 folia 的独立 glow/sweep/fill 三层绝对定位结构，
// 避免多层文字间的亚像素对齐问题——见 git 记录）。
import {
	getLineRenderEndTime,
	resolveLyricTextDirection,
} from "@/utils/lyrics";
import { colorWithAlpha, mixColors } from "../../colorMix";
import type { FoliaTheme } from "../../types";
import type { LyricClock } from "../../lyricClock";
import {
	buildMonetDisplayTokens,
	clampMonetProgress,
	resolveMonetGlow,
	resolveMonetWordColor,
	resolveMonetWordStatus,
	type PositionedMonetLineEntry,
	SECONDARY_TRACK_OPACITY,
	MONET_SUBTITLE_TRACK_STAGGER_S,
} from "./monetCore";

/** The chorus glow's [alpha, at %] stops. */
const CHORUS_GLOW_STOPS: Array<[number, number]> = [
	[0.14, 0],
	[0.12, 15],
	[0.085, 35],
	[0.05, 55],
	[0.022, 72],
	[0.007, 87],
];

let {
	entry,
	clock,
	theme,
	lyricFontPx,
	fontStack,
	glowBufferPx,
	vGlowBufferPx,
}: {
	entry: PositionedMonetLineEntry;
	clock: LyricClock;
	theme: FoliaTheme;
	lyricFontPx: number;
	fontStack: string;
	glowBufferPx: number;
	vGlowBufferPx: number;
} = $props();

const lineRenderEndTime = $derived(getLineRenderEndTime(entry.line));
const tokens = $derived(buildMonetDisplayTokens(entry.line));
const isActiveLine = $derived(entry.status === "active");
const canRenderGlow = $derived(
	entry.status === "active" || entry.status === "passed",
);
const rtl = $derived(resolveLyricTextDirection(entry.line.fullText) === "rtl");

const textMask = $derived.by(() => {
	if (isActiveLine) return "";
	const contentBottom =
		vGlowBufferPx +
		entry.layout.textPaddingTopPx +
		entry.layout.textContentHeightPx;
	if (!entry.layout.isTextClipped) return "";
	const solidEnd = Math.max(
		contentBottom - Math.max(lyricFontPx * 0.55, 12),
		0,
	);
	return `mask-image:linear-gradient(180deg, black 0px, black ${solidEnd.toFixed(0)}px, transparent ${contentBottom.toFixed(0)}px);-webkit-mask-image:linear-gradient(180deg, black 0px, black ${solidEnd.toFixed(0)}px, transparent ${contentBottom.toFixed(0)}px);`;
});

const accentColor = $derived(colorWithAlpha(theme.primaryColor, 0.98));

// 每个词的文字 span 引用。
let textEls: (HTMLSpanElement | null)[] = $state([]);

interface WordRuntime {
	startTime: number;
	endTime: number;
	wordColor: string;
	baseColor: string;
	isChorus: boolean;
}

$effect(() => {
	if (!canRenderGlow) return;

	const runtimes: WordRuntime[] = [];
	tokens.forEach((token, index) => {
		if (!token.timed || token.startTime === null || token.endTime === null)
			return;
		runtimes.push({
			startTime: token.startTime,
			endTime: token.endTime,
			wordColor: resolveMonetWordColor(token.text, theme, accentColor, true),
			baseColor: entry.tone.baseColor,
			isChorus: entry.line.isChorus,
		});
	});

	const unsubscribe = clock.subscribe((latest) => {
		for (let i = 0; i < runtimes.length; i++) {
			const word = runtimes[i];
			const el = textEls[i];
			if (!el) continue;

			const status = resolveMonetWordStatus(
				latest,
				word.startTime,
				word.endTime,
			);
			const progress =
				latest <= word.startTime
					? 0
					: latest >= word.endTime
						? 1
						: (latest - word.startTime) /
							Math.max(0.001, word.endTime - word.startTime);

			// 词色：从 baseColor 渐变到 wordColor。
			const color =
				status === "passed"
					? word.wordColor
					: mixColors(word.baseColor, word.wordColor, Math.min(progress, 1));
			if (el.style.color !== color) el.style.color = color;

			// glow：text-shadow 强度由时间包络驱动。
			const glowOpacity =
				latest <= word.startTime
					? 0
					: Math.max(
							0,
							resolveMonetGlow(
								latest,
								word.startTime,
								word.endTime,
								lineRenderEndTime,
							),
						);
			const radiusOne = Math.round(lyricFontPx * (word.isChorus ? 0.45 : 0.28));
			const radiusTwo = Math.round(lyricFontPx * (word.isChorus ? 0.9 : 0.65));
			const glowColor = mixColors(
				word.baseColor,
				word.wordColor,
				1,
				word.isChorus ? 1.0 : 0.88,
			);
			const shadow =
				glowOpacity > 0.01
					? `0 0 ${radiusOne}px ${colorWithAlpha(glowColor, glowOpacity)}, 0 0 ${radiusTwo}px ${colorWithAlpha(glowColor, glowOpacity * 0.7)}`
					: "none";
			if (el.style.textShadow !== shadow) el.style.textShadow = shadow;
		}
	});
	return unsubscribe;
});

const textMaskStyle = $derived.by(() => {
	if (isActiveLine) return "";
	const contentBottom =
		vGlowBufferPx +
		entry.layout.textPaddingTopPx +
		entry.layout.textContentHeightPx;
	if (!entry.layout.isTextClipped) return "";
	const solidEnd = Math.max(
		contentBottom - Math.max(lyricFontPx * 0.55, 12),
		0,
	);
	return `mask-image:linear-gradient(180deg, black 0px, black ${solidEnd.toFixed(0)}px, transparent ${contentBottom.toFixed(0)}px);-webkit-mask-image:linear-gradient(180deg, black 0px, black ${solidEnd.toFixed(0)}px, transparent ${contentBottom.toFixed(0)}px);`;
});
</script>

<div
	class="folia-monet-line"
	style={`left:${glowBufferPx}px;right:${glowBufferPx}px;height:${entry.layout.visualHeightPx}px;z-index:${entry.tone.zIndex};opacity:${entry.tone.opacity};transform:translateY(${entry.y.toFixed(1)}px) scale(${entry.tone.scale});transform-origin:left top;filter:blur(${entry.tone.blurPx}px);`}
>
	{#if entry.line.isChorus}
		<div
			class="folia-monet-chorus-glow"
			style={`opacity:${entry.status === "active" ? 1 : 0};background:radial-gradient(closest-side, ${CHORUS_GLOW_STOPS.map(([alpha, at]) => `${colorWithAlpha(theme.accentColor, alpha)} ${at}%`).join(", ")}, transparent 100%);`}
		></div>
	{/if}
	<div
		dir={rtl ? "rtl" : "ltr"}
		class="folia-monet-line-text"
		style={`margin-left:-${glowBufferPx}px;margin-right:-${glowBufferPx}px;padding-left:${glowBufferPx}px;padding-right:${glowBufferPx}px;margin-top:-${vGlowBufferPx}px;margin-bottom:-${vGlowBufferPx}px;padding-top:${entry.layout.textPaddingTopPx + vGlowBufferPx}px;padding-bottom:${entry.layout.textPaddingBottomPx + vGlowBufferPx}px;${isActiveLine ? "" : `height:${entry.layout.textHeightPx + vGlowBufferPx * 2}px;`}font-family:${fontStack};font-size:${lyricFontPx}px;font-weight:${entry.tone.fontWeight};line-height:${entry.layout.lineHeightPx}px;letter-spacing:0;text-shadow:${entry.status === "active" ? `0 14px 34px ${colorWithAlpha(theme.backgroundColor, 0.22)}` : "none"};${textMaskStyle}`}
	>
		<span class="folia-monet-tokens">
			{#each tokens as token, index (token.key)}
				<span
					class="folia-monet-word"
					bind:this={textEls[index]}
					style={`color:${entry.tone.baseColor};white-space:pre-wrap;display:inline;`}
				>
					{token.text}
				</span>
			{/each}
		</span>
	</div>
	{#each entry.layout.subtitleTracks as track, trackIndex (track.role)}
		<div
			class="folia-monet-subtitle"
			style={`height:${track.heightPx}px;padding-top:${track.paddingTopPx}px;padding-bottom:${track.paddingBottomPx}px;color:${colorWithAlpha(theme.primaryColor, trackIndex > 0 ? 0.68 * SECONDARY_TRACK_OPACITY : 0.68)};font-family:${fontStack};font-size:${track.fontPx}px;font-weight:${track.fontWeight};line-height:${track.lineHeightPx}px;letter-spacing:0;animation:cappella-char-fade 0.28s ease-out ${trackIndex * MONET_SUBTITLE_TRACK_STAGGER_S}s both;`}
		>
			{track.text}
		</div>
	{/each}
</div>
