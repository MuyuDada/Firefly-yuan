<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/classic/Visualizer.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// classic（经典）：全屏歌词的基线主题。只渲染当前行，逐词三态动画（GlowWord），
// 词的姿态由行起始时间做确定性伪随机，整行带呼吸浮动，底部字幕显示译文与后续两句。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	buildDisplayWordsFromLayoutUnits,
	buildPostLyricLayoutUnits,
	getLineRenderEndTime,
	resolveLyricTextDirection,
	type Word,
} from "@/utils/lyrics";
import GlowWord, { type GlowWordConfig } from "../../GlowWord.svelte";
import {
	type GlowWordPlacement,
	measureGlowWordWidth,
} from "../../glowWordOverlap";
import {
	getGlowWordLineContainerMotion,
	resolveGlowWordRenderProfile,
} from "../../glowWordTiming";
import { getRecentCompletedLine, getSubtitleNextLines } from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";
import { resolveWordColor } from "../../wordColoring";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

// classic 调参（folia 的 DEFAULT_CLASSIC_TUNING；调参 UI 暂未开放，取默认值）。
const TUNING = {
	enableWordRotation: true,
	breathingFloatMultiplier: 1,
	useLegacyLayout: false,
	wordSpacing: 0.7,
	avoidOverlap: false,
} as const;

interface LineLayoutConfig {
	justifyContent: string;
	alignItems: string;
	perspective: number;
}

let viewportWidth = $state(
	typeof window === "undefined" ? 1200 : window.innerWidth,
);

$effect(() => {
	const handleResize = () => {
		viewportWidth = window.innerWidth;
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

const displayWords = $derived.by(() => {
	if (!activeLine) return [] as Word[];
	if (TUNING.useLegacyLayout) {
		return activeLine.words;
	}
	const layoutUnits = buildPostLyricLayoutUnits(activeLine, {
		semantic: true,
		sticky: true,
	});
	return buildDisplayWordsFromLayoutUnits(layoutUnits);
});

// 词宽测量用的像素字号（与 clamp 的中间值一致）。
const pxFontSize = $derived.by(() => {
	const rem = 16;
	const minPx = 2.25 * lyricsFontScale * rem;
	const valPx = (6 * lyricsFontScale * viewportWidth) / 100;
	const maxPx = 4.5 * lyricsFontScale * rem;
	return Math.max(minPx, Math.min(valPx, maxPx));
});
const mainFontSize = $derived(
	`clamp(${(2.25 * lyricsFontScale).toFixed(3)}rem, ${(6 * lyricsFontScale).toFixed(3)}vw, ${(4.5 * lyricsFontScale).toFixed(3)}rem)`,
);
const emptyFontSize = $derived(
	`clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`,
);
const subtitleSizes = $derived(resolveSubtitleFontSizes(lyricsFontScale));

// 当前行的确定性布局：同一句词永远摆出同一副姿态。
const layout = $derived.by(() => {
	if (!activeLine) {
		return {
			wordConfigs: [] as GlowWordConfig[],
			lineConfig: {
				justifyContent: "center",
				alignItems: "center",
				perspective: 1000,
			} satisfies LineLayoutConfig,
		};
	}

	const seed = activeLine.startTime;
	const intensity = theme.animationIntensity;

	const isChaotic = intensity === "chaotic";
	const isCalm = intensity === "calm";

	// 整行的水平/垂直对齐按种子从候选里挑（calm 档固定居中）。
	const justifyOptions = isCalm
		? ["center"]
		: ["flex-start", "center", "flex-end", "space-around", "space-between"];
	const alignOptions = isCalm
		? ["center"]
		: ["flex-start", "center", "flex-end"];

	const isInterlude = activeLine.fullText === "......";

	const lineConfig: LineLayoutConfig = {
		justifyContent: isInterlude
			? "center"
			: justifyOptions[Math.floor(seed % justifyOptions.length)],
		alignItems: alignOptions[Math.floor((seed * 2) % alignOptions.length)],
		perspective: isChaotic ? 500 + (seed % 500) : 1000,
	};

	const { fontFamily, fontWeight } = theme;
	const wordWidths = displayWords.map((w) =>
		measureGlowWordWidth(w.text, pxFontSize, fontFamily, fontWeight),
	);

	const baseSpread = isChaotic ? 60 : isCalm ? 0 : 20;
	const baseRotate = isChaotic ? 30 : isCalm ? 0 : 5;

	// RTL 行的下一个词坐在左边，物理 x 偏移的收紧方向相反。
	const rtl = resolveLyricTextDirection(activeLine.fullText) === "rtl";

	const placementOf = (i: number): Required<GlowWordPlacement> => {
		const random = (offset: number) => {
			const x = Math.sin(seed + i + offset) * 10000;
			return x - Math.floor(x);
		};
		return {
			width: wordWidths[i] ?? 0,
			pose: {
				scale: isChaotic ? 0.8 + random(4) * 0.6 : 1.1 + random(4) * 0.2,
				rotate: TUNING.enableWordRotation
					? (random(3) - 0.5) * baseRotate * 2
					: 0,
				passedRotate: TUNING.enableWordRotation ? (random(8) - 0.5) * 45 : 0,
			},
			offset: {
				x: (random(1) - 0.5) * baseSpread * 2,
				y: (random(2) - 0.5) * baseSpread * 2,
			},
		};
	};

	const wordConfigs: GlowWordConfig[] = displayWords.map((w, i) => {
		const wordSeed = seed + i;
		const random = (offset: number) => {
			const x = Math.sin(wordSeed + offset) * 10000;
			return x - Math.floor(x);
		};

		if (isInterlude) {
			return {
				id: `${w.text}-${i}-${seed}`,
				x: 0,
				y: (random(2) - 0.5) * 15,
				rotate: 0,
				scale: 1.5,
				marginRight: "3rem",
				alignSelf: "center",
				passedRotate: 0,
			};
		}

		const placement = placementOf(i);
		const wordConfigScale = placement.pose.scale;
		const xVal = placement.offset.x;
		const yVal = placement.offset.y;

		let marginRight = isChaotic ? `${random(5) * 1.5}rem` : "0.8rem";

		if (!TUNING.useLegacyLayout) {
			// 精确计算右边距，避免放大 + 平移时视觉重叠。
			const wI = wordWidths[i] ?? 0;
			const sI = wordConfigScale * 1.4;

			let wNext = 0;
			let sNext = 1.0;
			let xNext = 0;

			if (i + 1 < displayWords.length) {
				const next = placementOf(i + 1);
				sNext = next.pose.scale * 1.4;
				xNext = next.offset.x;
				wNext = next.width;
			}

			const spacingMultiplier = TUNING.wordSpacing ?? 0.7;
			const gap = 0.05 * pxFontSize;
			const halfOverflowI = (wI * (sI - 1)) / 2;
			const halfOverflowNext = (wNext * (sNext - 1)) / 2;
			const xOffsetDiff = rtl ? xNext - xVal : xVal - xNext;

			const calculatedMargin =
				(halfOverflowI + halfOverflowNext + xOffsetDiff + gap) *
				spacingMultiplier;
			const minMargin =
				(isChaotic ? 0.08 * pxFontSize : 0.12 * pxFontSize) * spacingMultiplier;
			const finalMargin = Math.max(minMargin, calculatedMargin);

			marginRight = `${finalMargin.toFixed(1)}px`;
		}

		return {
			id: `${w.text}-${i}-${seed}`,
			x: xVal,
			y: yVal,
			rotate: placement.pose.rotate,
			scale: wordConfigScale,
			marginRight,
			alignSelf:
				isChaotic && random(6) > 0.7
					? random(7) > 0.5
						? "flex-start"
						: "flex-end"
					: "auto",
			passedRotate: placement.pose.passedRotate,
		};
	});

	return { wordConfigs, lineConfig };
});

// 整行呼吸浮动（framer 的 repeat Infinity keyframes → CSS 动画 + 变量）。
const floatStyle = $derived.by(() => {
	const multiplier = TUNING.breathingFloatMultiplier;
	if (multiplier <= 0) return "";

	const configByIntensity = {
		calm: { distance: 10, duration: 8.5 },
		normal: { distance: 14, duration: 7 },
		chaotic: { distance: 18, duration: 5.8 },
	} as const;
	const { distance, duration } = configByIntensity[theme.animationIntensity];
	const scaledDistance = distance * multiplier;
	const scaleAmp = 0.01 * multiplier;

	return `--folia-float-dist:${scaledDistance}px;--folia-float-scale:${scaleAmp};animation:folia-breathe ${duration}s ease-in-out infinite;`;
});

// 换行的入场/离场（getGlowWordLineContainerMotion → Svelte css 过渡）。
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
	// 旧行的退场压缩到 160ms 并加重模糊：换行时旧行几乎立即消失，
	// 避免新旧两行的动画叠在一起（folia 原版 0.3s 交叉淡化观感上偏长）。
	return (_dom: Element) => ({
		duration: 160,
		css: (t: number) =>
			`opacity:${1 - t};transform:scale(${1 + (exit.scale - 1) * t});filter:blur(${exit.blur * t}px);`,
	});
});
</script>

<div class="folia-theme folia-classic" data-folia-theme="classic">
	<div class="folia-classic-area" style={floatStyle}>
		{#if showText && activeLine}
			{#key activeLine.startTime}
				<div
					class="folia-classic-line"
					in:lineIn
					out:lineOut
					dir={resolveLyricTextDirection(activeLine.fullText)}
					style={`perspective:${layout.lineConfig.perspective}px;justify-content:${layout.lineConfig.justifyContent};align-items:${layout.lineConfig.alignItems};`}
				>
					{#each displayWords as word, idx (word.text + '-' + idx + '-' + activeLine.startTime)}
						<GlowWord
							word={word}
							config={layout.wordConfigs[idx] ?? {
								id: `fallback-${idx}`,
								x: 0,
								y: 0,
								rotate: 0,
								scale: 1,
								marginRight: '0.5rem',
								alignSelf: 'auto',
								passedRotate: 0,
							}}
							{clock}
							baseColor={theme.primaryColor}
							activeColor={resolveWordColor(word.text, theme.wordColors, theme.accentColor)}
							renderProfile={activeLineRenderProfile}
							isChorus={activeLine.isChorus}
							fontSize={mainFontSize}
							fontWeight={theme.fontWeight}
							animationIntensity={theme.animationIntensity}
						/>
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
