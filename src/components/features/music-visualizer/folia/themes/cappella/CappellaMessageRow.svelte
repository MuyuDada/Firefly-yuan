<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/cappella/{CappellaMessageRow,CappellaBubbleParts}.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 单条聊天消息行：订阅播放时间算出当前字数与状态，组合头像、气泡与时间戳。
// framer 的行入场/离场 → Svelte in/out；气泡尺寸动画 → CSS width/height 过渡；
// 头像缩放 → CSS scale 过渡（底部原点）；无内置头像/表情图库，头像为渐变占位。
import { fade } from "svelte/transition";
import type { Line } from "@/utils/lyrics";
import { mixColors } from "../../colorMix";
import type { LyricClock } from "../../lyricClock";
import type { FoliaTheme } from "../../types";
import {
	type CappellaIntensityConfig,
	type CappellaMessage,
	DEFAULT_CHAR_FADE_MS,
	isTimedMessage,
} from "./cappellaCore";
import {
	formatTimestamp,
	getBubbleColors,
	getOrBuildBubbleMetrics,
	getTimedMessageState,
} from "./cappellaMetrics";
import {
	getBubbleTargetCharacterCount,
	getCharacterCountAtTime,
	getTimestampReadyTime,
} from "./cappellaReveal";

let {
	message,
	clock,
	currentLineIndex,
	theme,
	baseFontSize,
	maxTextWidth,
	metricsCache,
	intensityConfig,
}: {
	message: CappellaMessage;
	clock: LyricClock;
	currentLineIndex: number;
	theme: FoliaTheme;
	baseFontSize: number;
	maxTextWidth: number;
	metricsCache: Map<string, import("./cappellaCore").PreparedBubbleMetrics>;
	intensityConfig: CappellaIntensityConfig;
} = $props();

const motionConfig = intensityConfig.motion;
const isRight = message.side === "right";
const timedData = isTimedMessage(message) ? message : null;
const isEmoMessage = message.kind === "emo";

const timedState = $derived(
	timedData
		? getTimedMessageState(timedData, clock.value, currentLineIndex)
		: null,
);
const isActiveMessage = $derived(timedState?.isActive ?? false);
const isPassedMessage = $derived(timedState?.isPassed ?? false);

const bubbleFontSize = $derived(
	isActiveMessage
		? baseFontSize * motionConfig.activeFontMultiplier
		: message.kind === "title"
			? baseFontSize
			: baseFontSize * motionConfig.inactiveFontMultiplier,
);
const bubblePaddingX = $derived(
	isActiveMessage ? motionConfig.activePaddingX : motionConfig.inactivePaddingX,
);
const bubblePaddingY = $derived(
	isActiveMessage ? motionConfig.activePaddingY : motionConfig.inactivePaddingY,
);
const bubbleColors = $derived(getBubbleColors(message, theme));
const lineHeightPx = $derived(bubbleFontSize * 1.45);

const preparedMetrics = $derived.by(() => {
	if (message.kind !== "lyric" || !isActiveMessage) return null;
	return getOrBuildBubbleMetrics(metricsCache, {
		line: message.line,
		theme,
		fontSize: bubbleFontSize,
		lineHeightPx,
		maxTextWidth,
		paddingX: bubblePaddingX,
		paddingY: bubblePaddingY,
	});
});

let visibleCharacterCount = $state(0);
let isTimestampVisible = $state(false);

$effect(() => {
	const unsubscribe = clock.subscribe((latest) => {
		if (message.kind === "lyric") {
			const nextVisibleCount = preparedMetrics
				? getCharacterCountAtTime(preparedMetrics.revealTimes, latest)
				: 0;
			if (nextVisibleCount !== visibleCharacterCount) {
				visibleCharacterCount = nextVisibleCount;
			}
		}
		const nextTimestampVisible =
			message.kind === "emo"
				? latest >= message.activationEndTime
				: isPassedMessage ||
					latest >= getTimestampReadyTime(preparedMetrics, message.line);
		if (nextTimestampVisible !== isTimestampVisible) {
			isTimestampVisible = nextTimestampVisible;
		}
	});
	return unsubscribe;
});

// 气泡目标尺寸：active 用逐前缀尺寸表；非 active 用完整文本的显式尺寸，
// 使 active→passed 过渡时 width/height 连续动画。
const targetSize = $derived.by(() => {
	if (isEmoMessage) {
		const size = isActiveMessage
			? motionConfig.emoActiveSize
			: motionConfig.emoInactiveSize;
		return { width: size, height: size };
	}

	if (message.kind !== "lyric") {
		return null;
	}

	const metrics = getOrBuildBubbleMetrics(metricsCache, {
		line: message.line,
		theme,
		fontSize: bubbleFontSize,
		lineHeightPx,
		maxTextWidth,
		paddingX: bubblePaddingX,
		paddingY: bubblePaddingY,
	});

	if (isActiveMessage) {
		const clampedTargetCount = Math.max(
			0,
			Math.min(
				getBubbleTargetCharacterCount(metrics, clock.value),
				metrics.sizes.length - 1,
			),
		);
		return metrics.sizes[clampedTargetCount];
	}

	return metrics.sizes[metrics.sizes.length - 1];
});

// scale(origin=bottom) 的视觉上溢量，作为同元素的 marginTop 补偿。
const scaleOverflow = $derived(
	isActiveMessage && motionConfig.activeScale > 1
		? Math.ceil(
				Math.max(
					isEmoMessage
						? isActiveMessage
							? motionConfig.emoActiveSize
							: motionConfig.emoInactiveSize
						: message.kind === "lyric" && preparedMetrics
							? (preparedMetrics.sizes[preparedMetrics.sizes.length - 1]
									?.height ?? motionConfig.activeMinHeight)
							: motionConfig.activeMinHeight,
					40,
				) *
					(motionConfig.activeScale - 1),
			)
		: 0,
);

const bubbleStyle = $derived.by(() => {
	const shadowAlpha = motionConfig.activeShadowAlpha;
	return [
		"position:relative;",
		"border-radius:24px;",
		isRight
			? "border-bottom-right-radius:6px;"
			: "border-bottom-left-radius:6px;",
		`background-color:${bubbleColors.backgroundColor};`,
		`border:1px solid ${bubbleColors.borderColor};`,
		`color:${bubbleColors.textColor};`,
		`font-size:${bubbleFontSize}px;`,
		"font-weight:400;",
		"line-height:1.45;",
		`max-width:${maxTextWidth + bubblePaddingX * 2 + 2}px;`,
		`min-height:${Math.max(isActiveMessage ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight, bubbleFontSize * 1.45 + bubblePaddingY * 2)}px;`,
		isActiveMessage ? "min-width:72px;" : "",
		`padding:${bubblePaddingY}px ${bubblePaddingX}px;`,
		isActiveMessage
			? `box-shadow:0 18px 48px ${mixColors(theme.backgroundColor, theme.accentColor, 0.2, shadowAlpha)};`
			: "",
		"white-space:pre-wrap;",
		"overflow-wrap:anywhere;",
		"height:100%;",
		"overflow:hidden;",
	].join("");
});

const glowAlpha = isRight
	? motionConfig.glowRightAlpha
	: motionConfig.glowLeftAlpha;
const glowColor = `rgba(255,255,255,${glowAlpha})`;

// 行入场/离场（framer 的 initial/animate/exit 等效）。
const rowIn = (_dom: Element) => ({
	duration: motionConfig.rowEnterDuration * 1000,
	css: (t: number, u: number) =>
		`opacity:${t};transform:translateY(${motionConfig.rowEnterY * u}px) scale(${motionConfig.rowEnterScale + (1 - motionConfig.rowEnterScale) * t});`,
});
const rowOut = (_dom: Element) => ({
	duration: motionConfig.rowExitDuration * 1000,
	easing: "ease-in",
	css: (t: number, u: number) =>
		`opacity:${t};transform:translateY(${motionConfig.rowExitY * u}px) scale(${1 + (motionConfig.rowExitScale - 1) * t});`,
});

// 逐字淡入的 reveal 计划（用于 active 气泡的正文）。
const revealPlan = $derived.by(() => {
	if (message.kind !== "lyric")
		return { characters: [] as string[], fadeDurationsMs: [] as number[] };
	const line = message.line;
	const characters = Array.from(line.fullText);
	const timeline = buildLineGraphemeTimeline(line);
	const fadeDurationsMs =
		timeline.length === characters.length
			? timeline.map((timing) =>
					Math.max(
						(timing.endTime - timing.startTime) * 1000,
						DEFAULT_CHAR_FADE_MS * 0.18,
					),
				)
			: characters.map(() => DEFAULT_CHAR_FADE_MS);
	return { characters, fadeDurationsMs };
});
</script>

<div
	class="folia-cappella-row"
	class:is-right={isRight}
	class:is-emo={isEmoMessage}
	in:rowIn
	out:rowOut
>
	<div
		class="folia-cappella-inner"
		class:is-right={isRight}
		class:is-active={isActiveMessage}
		class:is-passed={isPassedMessage}
		style={`margin-top:${scaleOverflow}px;transform-origin:${isRight ? "100% 100%" : "0% 100%"};`}
	>
		<!-- 头像：无内置图库，用主题色渐变占位 -->
		<div
			class="folia-cappella-avatar"
			style={`background-image:linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor});`}
		></div>

		{#if isEmoMessage}
			<div
				class="folia-cappella-emo"
				style={`width:${isActiveMessage ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize}px;height:${isActiveMessage ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize}px;`}
			>
				{#if timedData && isTimestampVisible}
					<span
						class="folia-cappella-timestamp"
						style={`color:${theme.secondaryColor};${isRight ? "right" : "left"}:calc(100% + 8px);bottom:-2px;`}
					>
						{formatTimestamp(timedData.line.endTime)}
					</span>
				{/if}
			</div>
		{:else}
			<div
				class="folia-cappella-bubble-wrap"
				style={targetSize
					? `width:${targetSize.width}px;height:${targetSize.height}px;`
					: "width:fit-content;height:auto;"}
			>
				<div class="folia-cappella-bubble" class:is-active={isActiveMessage} style={bubbleStyle}>
					<div class="folia-cappella-bubble-glow-clip" aria-hidden="true">
						{#if isActiveMessage}
							<div
								class="folia-cappella-bubble-glow"
								style={`width:200%;opacity:${motionConfig.glowOpacity};background:linear-gradient(105deg, transparent 0%, ${glowColor} 23%, transparent 34%, transparent 50%, transparent 50%, ${glowColor} 73%, transparent 84%, transparent 100%);animation:cappella-bubble-glow-pan ${motionConfig.glowDuration}s linear infinite;`}
							></div>
						{/if}
					</div>
					<span class="folia-cappella-text">
						{#if message.kind === "title"}
							{message.text}
						{:else if message.kind === "lyric" && isActiveMessage && preparedMetrics}
							{#each revealPlan.characters.slice(0, visibleCharacterCount) as character, index (index)}
								<span
									style={`animation-name:cappella-char-fade;animation-duration:${revealPlan.fadeDurationsMs[index] ?? DEFAULT_CHAR_FADE_MS}ms;animation-timing-function:ease-out;`}
								>
									{character}
								</span>
							{/each}
						{:else if message.kind === "lyric"}
							{message.line.fullText}
						{/if}
					</span>
				</div>
				{#if timedData && isTimestampVisible}
					<span
						class="folia-cappella-timestamp"
						style={`color:${theme.secondaryColor};${isRight ? "right" : "left"}:calc(100% + 8px);bottom:4px;`}
					>
						{formatTimestamp(timedData.line.endTime)}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
