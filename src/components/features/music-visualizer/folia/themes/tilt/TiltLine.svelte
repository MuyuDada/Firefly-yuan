<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/tilt/VisualizerTilt.tsx, TiltLine).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 一段（1-4 行之一）：普通行水平排版，tilt 行斜体错落。逐字符脉动
// 沿用 folia 的 MotionValue 思路——订阅共享时钟直接写 span 的 scale
// 样式（CSS scale 属性与 transform 互不干扰），不走组件重渲染。
import { type Line, splitLyricGraphemes } from "@/utils/lyrics";
import type { LyricClock } from "../../lyricClock";
import type { FoliaTheme } from "../../types";
import {
	buildCharTimings,
	getCharPulseIntensity,
	type TiltColorScheme,
	type TiltSegment,
} from "./tiltLayout";

let {
	segment,
	theme,
	fontScale,
	scaleMultiplier,
	visible,
	colorScheme = "default",
	clock,
	segmentStartTime = 0,
	segmentEndTime = 0,
	activeLine = null,
}: {
	segment: TiltSegment;
	theme: FoliaTheme;
	fontScale: number;
	scaleMultiplier: number;
	visible: boolean;
	colorScheme?: TiltColorScheme;
	clock: LyricClock;
	segmentStartTime?: number;
	segmentEndTime?: number;
	activeLine?: Line | null;
} = $props();

const REM_PX = 16;

const baseFontScale = $derived(fontScale * scaleMultiplier);
const shortLastBoost = $derived(segment.isShortLastLine ? 1.18 : 1);

let viewportWidth = $state(
	typeof window === "undefined" ? 1200 : window.innerWidth,
);
$effect(() => {
	const onResize = () => (viewportWidth = window.innerWidth);
	window.addEventListener("resize", onResize);
	return () => window.removeEventListener("resize", onResize);
});

const tiltFontPx = $derived(
	Math.min(
		viewportWidth * 0.06875 * baseFontScale,
		5.625 * REM_PX * baseFontScale,
	),
);
const yOffset = $derived(tiltFontPx / 6);
const normalFontSize = $derived(
	`clamp(${(3.125 * baseFontScale * shortLastBoost).toFixed(3)}rem, ${(6.875 * baseFontScale * shortLastBoost).toFixed(3)}vw, ${(5.625 * baseFontScale * shortLastBoost).toFixed(3)}rem)`,
);
const tiltFontSize = $derived(
	`clamp(${(3.125 * baseFontScale).toFixed(3)}rem, ${(6.875 * baseFontScale).toFixed(3)}vw, ${(5.625 * baseFontScale).toFixed(3)}rem)`,
);

const colors = $derived.by(() => {
	switch (colorScheme) {
		case "swap":
			return {
				normal: theme.accentColor || theme.primaryColor,
				tilt: theme.primaryColor,
			};
		case "accentAll":
			return {
				normal: theme.accentColor || theme.primaryColor,
				tilt: theme.accentColor || theme.primaryColor,
			};
		case "primaryAll":
			return { normal: theme.primaryColor, tilt: theme.primaryColor };
		default:
			return {
				normal: theme.primaryColor,
				tilt: theme.accentColor || theme.primaryColor,
			};
	}
});

const graphemes = $derived(splitLyricGraphemes(segment.text));

const charTimings = $derived(
	activeLine
		? buildCharTimings(
				segment.charOffset,
				segment.text,
				segmentStartTime,
				segmentEndTime,
				activeLine,
			)
		: [],
);

const charIndexMap = $derived.by(() => {
	let idx = 0;
	return graphemes.map((seg) => {
		const isSpace = /^\s+$/.test(seg);
		if (!isSpace) idx++;
		return idx - 1;
	});
});

const SPACE_RE = /^\s+$/;

// 每个字符的直接 DOM 引用：时钟驱动下逐帧写 scale，等价 folia 的 MotionValue。
let charEls: HTMLSpanElement[] = $state([]);

$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		if (!visible) return;
		if (charEls.length !== graphemes.length) return;
		if (!charTimings || charTimings.length === 0) {
			for (const el of charEls) el.style.scale = "1";
			return;
		}

		for (let ti = 0; ti < graphemes.length; ti++) {
			const el = charEls[ti];
			if (!el) continue;
			const seg = graphemes[ti];
			if (SPACE_RE.test(seg)) {
				el.style.scale = "1";
				continue;
			}
			const ci = charIndexMap[ti];
			const charTiming = charTimings[ci];
			if (!charTiming) {
				el.style.scale = "1";
				continue;
			}
			const intensity = getCharPulseIntensity(latest, charTiming);
			el.style.scale = `${1 + intensity * (segment.isTilt ? 0.18 : 0.15)}`;
		}
	});
	return unsubscribe;
});
</script>

{#if !segment.isTilt}
	<div
		class="folia-tilt-line"
		class:is-visible={visible}
		style={`font-size:${normalFontSize};color:${colors.normal};line-height:1.35;font-weight:400;letter-spacing:0.08em;`}
	>
		{#each graphemes as seg, ti (ti)}
			<span
				bind:this={charEls[ti]}
				class="folia-tilt-char"
				class:is-visible={visible}
				class:is-space={SPACE_RE.test(seg)}
				style={`transition-delay:${visible && !SPACE_RE.test(seg) ? graphemes.slice(0, ti).filter((g) => !SPACE_RE.test(g)).length * 0.04 : 0}s;${SPACE_RE.test(seg) ? "min-width:0.25em;" : ""}`}
			>
				{SPACE_RE.test(seg) ? " " : seg}
			</span>
		{/each}
	</div>
{:else}
	<div
		class="folia-tilt-line folia-tilt-line--tilt"
		class:is-visible={visible}
		style={`font-size:${tiltFontSize};color:${colors.tilt};line-height:1.25;font-weight:300;letter-spacing:0.15em;--folia-tilt-y:${yOffset}px;`}
	>
		{#each graphemes as seg, ti (ti)}
			<span
				bind:this={charEls[ti]}
				class="folia-tilt-char folia-tilt-char--stagger"
				class:is-visible={visible}
				class:is-space={SPACE_RE.test(seg)}
				class:is-even={graphemes.slice(0, ti).filter((g) => !SPACE_RE.test(g)).length % 2 === 0}
				style={`transition-delay:${visible && !SPACE_RE.test(seg) ? graphemes.slice(0, ti).filter((g) => !SPACE_RE.test(g)).length * 0.05 : 0}s;${SPACE_RE.test(seg) ? "min-width:0.35em;" : ""}`}
			>
				{SPACE_RE.test(seg) ? " " : seg}
			</span>
		{/each}
	</div>
{/if}
