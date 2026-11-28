<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/partita/PartitaChunk.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 云阶的一个 chunk：chunk 自身订阅粗粒度三态（引导线与容器动效用），
// 词仍是 GlowWord 的逐词三态。chunk 是结构壳，不直接管歌词时间。

import type { Word } from "@/utils/lyrics";
import { resolveLyricTextDirection } from "@/utils/lyrics";
import GlowWord, { type GlowWordConfig } from "../../GlowWord.svelte";
import {
	type GlowWordRenderProfile,
	getGlowWordActiveEndTime,
} from "../../glowWordTiming";
import type { LyricClock } from "../../lyricClock";
import { FOLIA_SPRING_EASING } from "../../spring";
import type { FoliaTheme } from "../../types";
import {
	buildPartitaWordConfigs,
	getActiveColor,
	type WordLayoutConfig,
} from "./partitaLayout";

let {
	chunkWords,
	displayWords,
	config,
	guideIndex,
	clock,
	theme,
	baseColor,
	renderProfile,
	isChorus = false,
	showGuideLines,
	fontSize,
}: {
	chunkWords: Word[];
	displayWords: Word[];
	config: WordLayoutConfig;
	guideIndex: number;
	clock: LyricClock;
	theme: FoliaTheme;
	baseColor: string;
	/** 换行间隙（退场过渡中）可能为 null，订阅回调内做空值跳过。 */
	renderProfile: GlowWordRenderProfile | null;
	isChorus?: boolean;
	showGuideLines: boolean;
	fontSize: string;
} = $props();

type ChunkStatus = "waiting" | "active" | "passed";
let chunkStatus = $state<ChunkStatus>("waiting");

const chunkStartTime = $derived(chunkWords[0].startTime);
const chunkEndTime = $derived.by(() => {
	if (!renderProfile) {
		return chunkWords[chunkWords.length - 1]?.endTime ?? chunkStartTime;
	}
	return getGlowWordActiveEndTime(
		chunkWords[chunkWords.length - 1],
		renderProfile,
	);
});

$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		// 退场过渡期间 renderProfile 可能为 null，空值跳过（同 GlowWord）。
		const profile = renderProfile;
		if (!profile) return;
		let next: ChunkStatus = "waiting";
		if (
			latest >= chunkStartTime - profile.wordLookahead &&
			latest <= chunkEndTime
		) {
			next = "active";
		} else if (latest > chunkEndTime) {
			next = "passed";
		}
		if (next !== chunkStatus) chunkStatus = next;
	});
	return unsubscribe;
});

const activeColor = $derived(
	getActiveColor(displayWords.map((w) => w.text).join(" "), theme),
);
const guidePosition = $derived(guideIndex % 2 === 0 ? "left" : "right");
const direction = $derived(
	resolveLyricTextDirection(displayWords.map((w) => w.text).join(" ")),
);

// Per-word random offset only (chunk position is on the container).
const wordConfigs = $derived(
	buildPartitaWordConfigs(displayWords, config, theme.animationIntensity),
);

// chunk 容器动效：active 用弹簧，waiting/passed 用 0.4s easeOut。
const chunkStyle = $derived.by(() => {
	const base = `margin-bottom:${config.marginBottom};align-self:${config.alignSelf};`;
	if (chunkStatus === "waiting") {
		const offsetX = config.x + (guidePosition === "left" ? -40 : 40);
		return `${base}opacity:0;transform:translate(${offsetX}px, ${config.y}px) scale(0.85) rotate(${config.rotate}deg);transition:transform 0.4s ease-out, opacity 0.4s ease-out;`;
	}
	const transition =
		chunkStatus === "active"
			? `transform 1.1s ${FOLIA_SPRING_EASING}, opacity 0.1s ease`
			: "transform 0.4s ease-out, opacity 0.4s ease-out";
	return `${base}opacity:1;transform:translate(${config.x}px, ${config.y}px) scale(1) rotate(${config.rotate}deg);transition:${transition};`;
});

// 引导线颜色（active 亮 / passed 微亮 / waiting 极暗）+ 伸缩状态。
const guideLineColor = $derived(
	chunkStatus === "active"
		? activeColor
		: chunkStatus === "passed"
			? "rgba(255,255,255,0.22)"
			: "rgba(255,255,255,0.14)",
);
const guideBoxShadow = $derived(
	chunkStatus === "active" ? `0 0 10px ${activeColor}45` : "none",
);
const guideHidden = $derived(chunkStatus === "waiting");
</script>

<div
	class="folia-partita-chunk"
	dir={direction}
	style={chunkStyle}
>
	{#if showGuideLines}
		<span
			class="folia-partita-guide folia-partita-guide--v"
			class:is-hidden={guideHidden}
			class:is-right={guidePosition === 'right'}
			style={`background-color:${guideLineColor};box-shadow:${guideBoxShadow};`}
			aria-hidden="true"
		></span>
		<span
			class="folia-partita-guide folia-partita-guide--h"
			class:is-hidden={guideHidden}
			class:is-right={guidePosition === 'right'}
			style={`background-color:${guideLineColor};box-shadow:${chunkStatus === 'active' ? `0 0 10px ${activeColor}35` : 'none'};`}
			aria-hidden="true"
		></span>
	{/if}

	{#each displayWords as w, idx (`${w.text}-${idx}`)}
		<GlowWord
			word={w}
			config={wordConfigs[idx] ?? config}
			{clock}
			baseColor={baseColor}
			activeColor={getActiveColor(w.text, theme)}
			{renderProfile}
			{isChorus}
			{fontSize}
			fontWeight={theme.fontWeight}
			animationIntensity={theme.animationIntensity}
		/>
	{/each}
</div>
