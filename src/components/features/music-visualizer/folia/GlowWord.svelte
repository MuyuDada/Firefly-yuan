<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/GlowWord.tsx + wordGlow.ts + glowWordVariants.ts).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// classic / partita 共用的单词组件：每个词只持有 waiting / active / passed 三态，
// 状态变化才写 $state。framer-motion variants 以 CSS transition + WAAPI 等效：
//   - 外层容器负责 x/y/scale/opacity（active 用 CSS linear() 弹簧曲线，见 spring.ts）；
//   - 旋转拆到内层包裹 span，让 passed 态的 5 秒缓转与 0.5 秒的位移/缩放各走各的 transition；
//   - 发光层用「透明文字 + 预置 text-shadow 光晕」，激活时用 WAAPI 只动 opacity
//     （与 folia 相同的光栅优化：shadow 字符串恒定，动画全程不重绘字形）；
//   - 正文层负责颜色渐变与 blur 清理。
import { buildWordGraphemeTimings } from "@/utils/lyrics";
import { GLOW_WORD_LINE_HEIGHT } from "./glowWordOverlap";
import {
	type GlowWordRenderProfile,
	getGlowWordActiveEndTime,
	getGlowWordDisplayDuration,
} from "./glowWordTiming";
import type { LyricClock } from "./lyricClock";
import { FOLIA_SPRING_EASING } from "./spring";

type Status = "waiting" | "active" | "passed";

export interface GlowWordConfig {
	id: string;
	x: number;
	y: number;
	rotate: number;
	scale: number;
	marginRight: string;
	alignSelf: string;
	passedRotate: number;
}

let {
	word,
	config,
	clock,
	baseColor,
	activeColor,
	renderProfile,
	isChorus = false,
	fontSize,
	fontWeight = 700,
	animationIntensity = "normal",
}: {
	word: { text: string; startTime: number; endTime: number };
	config: GlowWordConfig;
	clock: LyricClock;
	baseColor: string;
	activeColor: string;
	/** 换行间隙（退场过渡中）可能为 null，订阅回调内做空值跳过。 */
	renderProfile: GlowWordRenderProfile | null;
	isChorus?: boolean;
	fontSize: string;
	fontWeight?: number;
	animationIntensity?: "calm" | "normal" | "chaotic";
} = $props();

let status = $state<Status>("waiting");

// 合唱涟漪半径按词实例固定（folia 用 useMemo + Math.random）。
const rippleScale = 1.5 + Math.random() * 2;

// ── 发光层（wordGlow.ts 的 text-shadow 光晕） ─────────────────
// folia 在 Linux 上有 drop-shadow 降级路径（glyph-cache fd 泄漏规避）；
// Firefly 目标环境以桌面 Chromium 为主，只保留 text-shadow 原始路径。
const glowRadii = (
	mode: GlowWordRenderProfile["wordRevealMode"],
): [number, number] =>
	mode === "instant" ? [14, 24] : mode === "fast" ? [18, 32] : [20, 40];

const textShadowAt = (color: string, inner: number, outer: number) =>
	`0 0 ${inner}px ${color}, 0 0 ${outer}px ${color}`;

const activeEndTime = $derived(
	renderProfile ? getGlowWordActiveEndTime(word, renderProfile) : word.endTime,
);
const duration = $derived(
	renderProfile ? getGlowWordDisplayDuration(word, renderProfile) : 0.2,
);
const graphemeTimings = $derived(buildWordGraphemeTimings(word));

const glowShadow = $derived(
	textShadowAt(
		activeColor,
		...glowRadii(renderProfile?.wordRevealMode ?? "normal"),
	),
);

$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		// 退场过渡期间 renderProfile 可能已随 activeLine 变为 null，
		// 空值跳过即可；抛错会污染共享时钟循环的日志。
		const profile = renderProfile;
		if (!profile) return;
		let next: Status = "waiting";
		if (
			latest >= word.startTime - profile.wordLookahead &&
			latest <= activeEndTime
		) {
			next = "active";
		} else if (latest > activeEndTime) {
			next = "passed";
		}
		if (next !== status) status = next;
	});
	return unsubscribe;
});

let glowEls: HTMLSpanElement[] = $state([]);
let glowAnimations: Animation[] = [];

const stopGlowAnimations = () => {
	for (const animation of glowAnimations) animation.cancel();
	glowAnimations = [];
};

// 激活时按 framer 的 keyframes 逐 span 播放发光 ramp。
$effect(() => {
	if (status !== "active" || !renderProfile) {
		stopGlowAnimations();
		return;
	}

	const mode = renderProfile.wordRevealMode;
	const targets = glowEls;
	if (targets.length === 0) return;

	const multiChar = graphemeTimings.length > 1;

	const play = (
		el: HTMLSpanElement,
		charDuration: number,
		charDelay: number,
	) => {
		let keyframes: Keyframe[];
		let timing: EffectTiming;

		if (mode === "instant") {
			keyframes = [
				{ opacity: 0 },
				{ opacity: 1, offset: 0.35 },
				{ opacity: 0 },
			];
			timing = {
				duration: Math.min(duration || 0.08, 0.12) * 1000,
				easing: "ease-out",
				fill: "both",
			};
		} else if (mode === "fast") {
			keyframes = [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }];
			timing = {
				duration: Math.min(Math.max(duration || 0.12, 0.12), 0.2) * 1000,
				easing: "ease-in-out",
				fill: "both",
			};
		} else if (multiChar) {
			// Letter-level sweep glow: peak early, fade stretches over a few letters.
			keyframes = [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }];
			timing = {
				duration: charDuration * 6 * 1000,
				delay: charDelay * 1000,
				easing: "ease-in-out",
				fill: "both",
			};
		} else {
			// Single char / CJK: sustained glow for the word duration.
			keyframes = [{ opacity: 0 }, { opacity: 1, offset: 0.9 }, { opacity: 1 }];
			timing = {
				duration: (duration || 0.1) * 1000,
				easing: "ease-in-out",
				fill: "both",
			};
		}

		glowAnimations.push(el.animate(keyframes, timing));
	};

	if (multiChar) {
		graphemeTimings.forEach((timing, index) => {
			const el = targets[index];
			if (!el) return;
			const charDuration = Math.max(timing.endTime - timing.startTime, 0.001);
			const charDelay = Math.max(0, timing.startTime - word.startTime);
			play(el, charDuration, charDelay);
		});
	} else if (targets[0]) {
		play(targets[0], duration, 0);
	}

	return () => stopGlowAnimations();
});

// ── 各层样式（glowWordVariants.ts 的三态） ─────────────────────
const containerStyle = $derived.by(() => {
	const base = `font-size:${fontSize};font-weight:${fontWeight};line-height:${GLOW_WORD_LINE_HEIGHT};`;
	const margin = config.marginRight || "0.8rem";
	const align =
		config.alignSelf && config.alignSelf !== "auto"
			? `align-self:${config.alignSelf};`
			: "";

	if (status === "waiting") {
		const jitterX = config.x + Math.sin(config.y) * 100;
		const jitterY = config.y + Math.cos(config.x) * 50;
		return `${base}${align}margin-inline-end:${margin};opacity:0;transform:translate(${jitterX}px, ${jitterY}px) scale(0.5);transition:transform 0.4s ease, opacity 0.4s ease;`;
	}

	if (status === "active") {
		const scale = Number.isNaN(config.scale) ? 1.5 : config.scale * 1.4;
		return `${base}${align}margin-inline-end:${margin};opacity:1;transform:translate(${config.x}px, ${config.y}px) scale(${scale});transition:transform 1.1s ${FOLIA_SPRING_EASING}, opacity 0.1s ease;`;
	}

	// passed：位移/缩放 0.5s，缓转交给内层旋转包裹层（5s linear）。
	const opacity = animationIntensity === "chaotic" ? 0.9 : 0.82;
	return `${base}${align}margin-inline-end:${margin};opacity:${opacity};transform:translate(${config.x}px, ${config.y}px) scale(${config.scale || 1});transition:transform 0.5s ease, opacity 0.5s ease;`;
});

const rotateStyle = $derived.by(() => {
	if (status === "waiting") {
		return `transform:rotate(${config.rotate + 20}deg);transition:transform 0.4s ease;`;
	}
	if (status === "active") {
		return `transform:rotate(${config.rotate}deg);transition:transform 1.1s ${FOLIA_SPRING_EASING};`;
	}
	return `transform:rotate(${config.rotate + config.passedRotate}deg);transition:transform 5s linear;`;
});

const bodyStyle = $derived.by(() => {
	const mode = renderProfile?.wordRevealMode ?? "normal";
	if (status === "waiting") {
		return `color:${baseColor};filter:blur(10px);transition:color 0.4s ease, filter 0.4s ease;`;
	}
	if (status === "active") {
		const blurDuration =
			mode === "instant" ? 0.08 : mode === "fast" ? 0.12 : 0.2;
		return `color:${activeColor};filter:none;transition:color ${duration || 0.2}s linear, filter ${blurDuration}s ease;`;
	}
	const colorDuration =
		mode === "instant" ? 0.12 : mode === "fast" ? 0.24 : 0.8;
	const blurDuration = mode === "instant" ? 0.12 : mode === "fast" ? 0.2 : 0.5;
	return `color:${baseColor};filter:blur(0px);transition:color ${colorDuration}s ease-in-out, filter ${blurDuration}s ease;`;
});

// 发光层容器：waiting/passed 时 opacity 归零（active 由 WAAPI keyframes 接管）。
const glowStyle = $derived.by(() => {
	if (status === "active") {
		return `color:transparent;text-shadow:${glowShadow};will-change:opacity;`;
	}
	if (status === "passed") {
		const revealMode = renderProfile?.wordRevealMode ?? "normal";
		const fadeDuration =
			revealMode === "instant" ? 0.12 : revealMode === "fast" ? 0.22 : 0.9;
		return `color:transparent;text-shadow:${glowShadow};opacity:0;transition:opacity ${fadeDuration}s ease-out;`;
	}
	return `color:transparent;text-shadow:${glowShadow};opacity:0;`;
});
</script>

<div
	class="folia-glow-word"
	style={containerStyle}
	data-word-id={config.id}
>
	<span class="folia-glow-word-rotate" style={rotateStyle}>
		<!-- 发光层：绝对定位垫底，透明文字 + text-shadow 光晕 -->
		<span class="folia-glow-word-glow" aria-hidden="true" style={glowStyle}>
			{#if graphemeTimings.length > 1}
				{#each graphemeTimings as timing, index (index)}
					<span bind:this={glowEls[index]} class="folia-glow-char">{timing.char}</span>
				{/each}
			{:else}
				<span bind:this={glowEls[0]} class="folia-glow-char">{word.text}</span>
			{/if}
		</span>

		<!-- 正文层：颜色渐变 + blur 清理 -->
		<span class="folia-glow-word-body" style={bodyStyle}>{word.text}</span>

		<!-- 合唱涟漪 -->
		{#if isChorus && status === 'active'}
			<span
				class="folia-chorus-ripple"
				style={`--folia-ripple-scale:${rippleScale};border-color:${activeColor};`}
				aria-hidden="true"
			></span>
		{/if}
	</span>
</div>
