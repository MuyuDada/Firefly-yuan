<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/cadenza/VisualizerCadenza.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// cadenza（残响）：重排版模式。行先经过测量换行 → 切片段 → 落点求解，
// 再镜像到 DOM 叠层（词本体 + 逐字 glow）与 canvas 层（副歌涟漪）。
// framer 的自绘 rAF 循环保留（组件挂载期间运行）；时间源换成共享时钟；
// 音频能量来自 getBands().bass（folia 的 audioPower）。

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	getLineRenderEndTime,
	type Line,
	splitLyricGraphemes,
} from "@/utils/lyrics";
import { colorWithAlpha, mixColors } from "../../colorMix";
import {
	getRecentCompletedLine,
	getSubtitleNextLines,
	getUpcomingLine,
} from "../../runtime";
import SubtitleOverlay from "../../SubtitleOverlay.svelte";
import type { FoliaVisualizerProps } from "../../types";
import {
	ACTIVE_PULSE_FREQUENCY,
	buildDomTextShadow,
	clamp,
	getClassicBodyMix,
	getClassicCharGlow,
	getClassicGlowEnvelope,
	getClassicLineEnvelope,
	getClassicPassedDrift,
	getWordProgress,
	getWordStatus,
	isCJK,
	mix,
	resolveLineRenderTiming,
} from "./cadenzaEnvelopes";
import {
	clearOverlayWordNodes,
	createOverlayWordNodes,
	syncOverlayGlyphSpans,
	writeOverlayGlyphShadow,
	writeOverlayWord,
} from "./cadenzaOverlayNodes";
import { buildPreparedState } from "./cadenzaPreparedState";
import type {
	AnimatedPlacementState,
	OverlayWordNodes,
	PreparedState,
	WordPlacement,
} from "./cadenzaTypes";

// cadenza 调参（folia 的 DEFAULT_CADENZA_TUNING；render 挡位 / beamIntensity 未移植）。
const TUNING = {
	fontScale: 1.12,
	widthRatio: 0.72,
	motionAmount: 1,
	glowIntensity: 1,
} as const;

/** Words are drawn waiting first and active last, so the word being sung sits on top. */
const STATUS_DRAW_ORDER = ["waiting", "passed", "active"] as const;
type WordStatus = (typeof STATUS_DRAW_ORDER)[number];

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
	getBands,
}: FoliaVisualizerProps = $props();

let viewport = $state({ width: 0, height: 0 });
let containerEl: HTMLDivElement | undefined = $state();
let lineLayerEl: HTMLDivElement | undefined = $state();
let overlayEl: HTMLDivElement | undefined = $state();
let textCanvasEl: HTMLCanvasElement | undefined = $state();

const overlayNodes = new Map<string, OverlayWordNodes>();
const animatedPlacements = new Map<string, AnimatedPlacementState>();
const preparedStateCache = new Map<string, PreparedState>();
let preparedStateContextKeyCache = "";

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

const emptyFontSize = `clamp(${(1.5 * lyricsFontScale).toFixed(3)}rem, ${(3.5 * lyricsFontScale).toFixed(3)}vw, ${(2.25 * lyricsFontScale).toFixed(3)}rem)`;
const subtitleSizes = {
	translationFontSize: "clamp(1.125rem, 2.6vw, 1.25rem)",
	upcomingFontSize: "clamp(0.875rem, 2vw, 1rem)",
};

const preparedStateContextKey = $derived.by(() => {
	const wordColorSignature = (theme.wordColors ?? [])
		.map((entry) => `${entry?.word ?? ""}:${entry?.color ?? ""}`)
		.join("||");
	return [
		showText ? "1" : "0",
		viewport.width,
		viewport.height,
		theme.fontFamily,
		theme.fontWeight,
		theme.animationIntensity,
		theme.accentColor,
		TUNING.fontScale,
		TUNING.widthRatio,
		wordColorSignature,
	].join("|");
});

const getPreparedStateCacheKey = (line: Line) =>
	[line.startTime, line.endTime, line.fullText, line.words.length].join("|");

$effect(() => {
	if (preparedStateContextKey !== preparedStateContextKeyCache) {
		preparedStateCache.clear();
		preparedStateContextKeyCache = preparedStateContextKey;
	}
});

const preparedState = $derived.by<PreparedState | null>(() => {
	const getOrPrepareState = (
		line: Line | null | undefined,
	): PreparedState | null => {
		if (!line) {
			return null;
		}

		const cacheKey = getPreparedStateCacheKey(line);
		const cached = preparedStateCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const nextState = buildPreparedState(line, {
			showText,
			viewport,
			theme,
			tuning: { fontScale: TUNING.fontScale, widthRatio: TUNING.widthRatio },
		});
		if (nextState) {
			preparedStateCache.set(cacheKey, nextState);
		}
		return nextState;
	};

	if (!showText || viewport.width <= 0 || viewport.height <= 0) {
		getOrPrepareState(upcomingLine);
		return null;
	}

	// prepare the active line; always warm the upcoming line as a side effect.
	const currentState = getOrPrepareState(activeLine);
	getOrPrepareState(upcomingLine);
	return currentState;
});

$effect(() => {
	const textCanvas = textCanvasEl;
	const lineLayer = lineLayerEl;
	const overlay = overlayEl;
	if (
		!textCanvas ||
		!lineLayer ||
		!overlay ||
		viewport.width <= 0 ||
		viewport.height <= 0
	)
		return;

	const textContext = textCanvas.getContext("2d");
	if (!textContext) return;

	const prepared: PreparedState | null = preparedState;
	const line: Line | null = activeLine;

	// Everything below is fixed for this prepared line.
	const placementIds = new Set(
		prepared?.placements.map((placement) => placement.id),
	);
	animatedPlacements.forEach((_value, key) => {
		if (!placementIds.has(key)) {
			animatedPlacements.delete(key);
		}
	});
	const placementGlyphs = new Map<
		WordPlacement,
		{ glyphs: string[]; cjk: boolean; ascent?: number }
	>();
	const glyphsOf = (placement: WordPlacement) => {
		let entry = placementGlyphs.get(placement);
		if (!entry) {
			entry = {
				glyphs: splitLyricGraphemes(placement.text),
				cjk: isCJK(placement.text),
			};
			placementGlyphs.set(placement, entry);
		}
		return entry;
	};
	// A web font that finishes loading mid-line changes the ascent; measure again next frame.
	const fontSet = typeof document !== "undefined" ? document.fonts : undefined;
	const forgetAscents = () =>
		placementGlyphs.forEach((entry) => {
			entry.ascent = undefined;
		});
	fontSet?.addEventListener("loadingdone", forgetAscents);
	const byStatus: Record<WordStatus, WordPlacement[]> = {
		waiting: [],
		passed: [],
		active: [],
	};
	let frameNumber = 0;
	let lastFrameTime: number | null = null;
	let frameId = 0;

	const draw = () => {
		const now = performance.now();
		const dt =
			lastFrameTime === null
				? 1 / 60
				: clamp((now - lastFrameTime) / 1000, 1 / 240, 0.05);
		lastFrameTime = now;
		const width = Math.max(Math.floor(viewport.width), 1);
		const height = Math.max(Math.floor(viewport.height), 1);
		const dpr = Math.min(window.devicePixelRatio || 1, 2);

		if (
			textCanvas.width !== Math.floor(width * dpr) ||
			textCanvas.height !== Math.floor(height * dpr)
		) {
			textCanvas.width = Math.floor(width * dpr);
			textCanvas.height = Math.floor(height * dpr);
			textCanvas.style.width = `${width}px`;
			textCanvas.style.height = `${height}px`;
		}

		textContext.setTransform(dpr, 0, 0, dpr, 0, 0);
		textContext.clearRect(0, 0, width, height);

		if (!showText || !prepared || !line) {
			lineLayer.style.opacity = "0";
			lineLayer.style.filter = "none";
			lineLayer.style.transform = "scale(1)";
			lineLayer.style.perspective = "1000px";
			clearOverlayWordNodes(overlayNodes);
			frameId = window.requestAnimationFrame(draw);
			return;
		}

		const time = clock.value;
		const lineTiming = resolveLineRenderTiming(line);
		const lineEnvelope = getClassicLineEnvelope(time, line, lineTiming);
		const wordRevealMode = lineTiming.wordRevealMode;
		const isInstantWordReveal = wordRevealMode === "instant";
		const lineSeed = Math.abs(Math.sin(line.startTime * 997.1));
		const linePerspective =
			theme.animationIntensity === "chaotic"
				? 500 + Math.round(lineSeed * 500)
				: 1000;
		const bands = getBands?.();
		const energy = clamp(bands ? bands.bass : 0, 0, 1);
		const motionEnergy = energy * TUNING.motionAmount;
		const verticalLift = Math.sin(time * 2.3) * (3 + motionEnergy * 8);
		const focusY = height * 0.42 + verticalLift;

		lineLayer.style.opacity = lineEnvelope.opacity.toString();
		lineLayer.style.filter =
			lineEnvelope.blur > 0.05
				? `blur(${lineEnvelope.blur.toFixed(2)}px)`
				: "none";
		lineLayer.style.transform = `scale(${lineEnvelope.scale})`;
		lineLayer.style.perspective = `${linePerspective}px`;

		textContext.font = prepared.font;
		textContext.textBaseline = "alphabetic";
		textContext.lineJoin = "round";
		textContext.lineCap = "round";

		byStatus.waiting.length = 0;
		byStatus.passed.length = 0;
		byStatus.active.length = 0;
		for (const placement of prepared.placements) {
			byStatus[getWordStatus(time, lineTiming, placement.word)].push(placement);
		}
		frameNumber += 1;

		let placementIndex = -1;
		for (const status of STATUS_DRAW_ORDER) {
			for (const placement of byStatus[status]) {
				placementIndex += 1;
				const progress = getWordProgress(time, wordRevealMode, placement.word);
				const passedAlpha = isInstantWordReveal
					? 0
					: theme.animationIntensity === "chaotic"
						? 0.9
						: 0.82;
				const pulse =
					status === "active" && !isInstantWordReveal
						? 1 +
							Math.sin(
								time * ACTIVE_PULSE_FREQUENCY + placement.word.startTime * 5,
							) *
								0.04 *
								TUNING.motionAmount
						: 1;
				const passedDriftProgress = isInstantWordReveal
					? 0
					: getClassicPassedDrift(time, placement.word);
				const targetScale =
					status === "waiting"
						? isInstantWordReveal
							? placement.scale
							: Math.max(placement.scale * 0.5, 0.5)
						: status === "active"
							? isInstantWordReveal
								? placement.scale
								: placement.scale * 1.3 * pulse
							: placement.scale;
				const targetRotation =
					status === "waiting"
						? isInstantWordReveal
							? placement.rotate
							: placement.rotate + 20
						: status === "passed"
							? isInstantWordReveal
								? placement.rotate
								: placement.rotate +
									placement.passedRotate * passedDriftProgress
							: placement.rotate;
				const localFloatX =
					Math.sin(time * 1.2 + placementIndex * 0.6) * motionEnergy * 4;
				const localFloatY =
					Math.cos(time * 1.5 + placementIndex * 0.4) * motionEnergy * 2.5;
				const passedDriftX =
					status === "passed"
						? placement.passedDriftX * passedDriftProgress
						: 0;
				const passedDriftY =
					status === "passed"
						? placement.passedDriftY * passedDriftProgress
						: 0;
				const targetX = width / 2 + placement.x + localFloatX + passedDriftX;
				const targetY = focusY + placement.y + localFloatY + passedDriftY;
				const targetBodyAlpha =
					status === "waiting" ? 0 : status === "active" ? 1 : passedAlpha;
				const targetBlur =
					status === "waiting" && !isInstantWordReveal ? 10 : 0;
				const targetActiveMix = getClassicBodyMix(
					time,
					lineTiming,
					placement.word,
				);
				const targetGlowAlpha = getClassicGlowEnvelope(
					time,
					lineTiming,
					placement.word,
				);
				const transformTransitionAmount = 1 - Math.exp(-11 * dt);
				const visualTransitionAmount = 1 - Math.exp(-14 * dt);
				const existingState = animatedPlacements.get(placement.id);
				const shouldInitializeAsActive =
					isInstantWordReveal && time >= placement.word.startTime;
				const animatedState = existingState ?? {
					x: width / 2 + placement.x,
					y: focusY + placement.y,
					rotation: shouldInitializeAsActive
						? targetRotation
						: targetRotation + 16,
					scale: shouldInitializeAsActive
						? targetScale
						: Math.max(placement.scale * 0.5, 0.5),
					bodyAlpha: shouldInitializeAsActive ? targetBodyAlpha : 0,
					blur: shouldInitializeAsActive ? targetBlur : 10,
					activeMix: shouldInitializeAsActive ? targetActiveMix : 0,
					glowAlpha: shouldInitializeAsActive ? targetGlowAlpha : 0,
				};

				animatedState.x = mix(
					animatedState.x,
					targetX,
					transformTransitionAmount,
				);
				animatedState.y = mix(
					animatedState.y,
					targetY,
					transformTransitionAmount,
				);
				animatedState.rotation = mix(
					animatedState.rotation,
					targetRotation,
					transformTransitionAmount,
				);
				animatedState.scale = mix(
					animatedState.scale,
					targetScale,
					transformTransitionAmount,
				);
				animatedState.bodyAlpha = mix(
					animatedState.bodyAlpha,
					targetBodyAlpha,
					visualTransitionAmount,
				);
				animatedState.blur = mix(
					animatedState.blur,
					targetBlur,
					visualTransitionAmount,
				);
				animatedState.activeMix = mix(
					animatedState.activeMix,
					targetActiveMix,
					visualTransitionAmount,
				);
				animatedState.glowAlpha = mix(
					animatedState.glowAlpha,
					targetGlowAlpha,
					1 - Math.exp(-16 * dt),
				);
				animatedPlacements.set(placement.id, animatedState);

				if (
					animatedState.bodyAlpha < 0.015 &&
					animatedState.glowAlpha < 0.015
				) {
					continue;
				}

				const drawX = animatedState.x;
				const drawBaselineY = animatedState.y;
				const visualWidth = placement.width * animatedState.scale;
				const visualHeight = placement.height * animatedState.scale;
				const scaledLeft = drawX - (visualWidth - placement.width) / 2;
				if (status === "active" && !placement.isInterlude) {
					if (line.isChorus) {
						const rippleRadius =
							Math.max(visualWidth, visualHeight) * (0.55 + progress * 0.45);
						textContext.strokeStyle = colorWithAlpha(
							placement.color,
							0.45 * (1 - progress) * animatedState.bodyAlpha,
						);
						textContext.lineWidth = 1.2;
						textContext.beginPath();
						textContext.arc(
							scaledLeft + visualWidth / 2,
							drawBaselineY - visualHeight * 0.42,
							rippleRadius,
							0,
							Math.PI * 2,
						);
						textContext.stroke();
					}
				}

				const textX = -placement.width / 2;
				const textY = placement.height * 0.42;
				const textColor = mixColors(
					theme.primaryColor,
					placement.color,
					animatedState.activeMix,
				);

				const overlayAnchorX = drawX + placement.width / 2;
				const overlayAnchorY = drawBaselineY - placement.height * 0.42;
				const overlayOffsetX = textX;
				const placementText = glyphsOf(placement);
				placementText.ascent ??= textContext.measureText(
					placement.text,
				).actualBoundingBoxAscent;
				const measuredAscent = placementText.ascent || prepared.fontPx * 0.78;
				const overlayOffsetY = textY - measuredAscent;
				const glyphs = placementText.glyphs;
				const shouldSplitGlow =
					wordRevealMode === "normal" &&
					!placementText.cjk &&
					glyphs.length > 1;
				let overlayWord = overlayNodes.get(placement.id);
				if (!overlayWord) {
					overlayWord = createOverlayWordNodes();
					overlayNodes.set(placement.id, overlayWord);
					overlay.appendChild(overlayWord.outer);
				}
				overlayWord.frame = frameNumber;

				writeOverlayWord(overlayWord, {
					outerTransform: `translate3d(${overlayAnchorX.toFixed(2)}px, ${overlayAnchorY.toFixed(2)}px, 0) rotate(${animatedState.rotation.toFixed(2)}deg) scale(${animatedState.scale.toFixed(3)})`,
					// Own compositing layer: otherwise every new scale re-rasterizes the word and its glow.
					willChange: "transform",
					font: prepared.font,
					innerTransform: `translate3d(${overlayOffsetX.toFixed(2)}px, ${overlayOffsetY.toFixed(2)}px, 0)`,
					text: placement.text,
					color: textColor,
					opacity: animatedState.bodyAlpha.toString(),
					filter:
						animatedState.blur > 0.05
							? `blur(${animatedState.blur.toFixed(2)}px)`
							: "none",
				});

				const glowTexts = shouldSplitGlow ? glyphs : [placement.text];
				syncOverlayGlyphSpans(overlayWord, glowTexts);

				if (shouldSplitGlow) {
					for (
						let glyphIndex = 0;
						glyphIndex < overlayWord.glyphSpans.length;
						glyphIndex += 1
					) {
						const absoluteIndex = placement.fragmentStartInWord + glyphIndex;
						const intensity =
							getClassicCharGlow(
								time,
								placement.word,
								absoluteIndex,
								Math.max(placement.wordGraphemeCount, glyphs.length),
								placement.wordGraphemeTimings,
							) *
							clamp(animatedState.glowAlpha, 0, 1) *
							Math.max(TUNING.glowIntensity, 0);

						writeOverlayGlyphShadow(
							overlayWord,
							glyphIndex,
							buildDomTextShadow(placement.color, intensity),
						);
					}
				} else if (overlayWord.glyphSpans[0]) {
					const intensity =
						getClassicGlowEnvelope(time, lineTiming, placement.word) *
						clamp(animatedState.glowAlpha, 0, 1) *
						Math.max(TUNING.glowIntensity, 0);
					writeOverlayGlyphShadow(
						overlayWord,
						0,
						buildDomTextShadow(placement.color, intensity),
					);
				}
			}
		}

		overlayNodes.forEach((nodes, key) => {
			if (nodes.frame !== frameNumber) {
				nodes.outer.remove();
				overlayNodes.delete(key);
			}
		});

		frameId = window.requestAnimationFrame(draw);
	};

	draw();
	return () => {
		window.cancelAnimationFrame(frameId);
		fontSet?.removeEventListener("loadingdone", forgetAscents);
		clearOverlayWordNodes(overlayNodes);
	};
});

// 视口尺寸跟随容器。
$effect(() => {
	const element = containerEl;
	if (!element) return;
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (!entry) return;
		viewport = {
			width: entry.contentRect.width,
			height: entry.contentRect.height,
		};
	});
	observer.observe(element);
	return () => observer.disconnect();
});
</script>

<div class="folia-theme folia-cadenza" data-folia-theme="cadenza" bind:this={containerEl}>
	<div
		class="folia-cadenza-layer"
		bind:this={lineLayerEl}
		style="transform-origin:50% 42%;perspective:1000px;opacity:0;"
	>
		<div bind:this={overlayEl} class="folia-cadenza-overlay"></div>
		<canvas bind:this={textCanvasEl} class="folia-cadenza-canvas"></canvas>
	</div>

	{#if showText && !activeLine}
		<div class="folia-empty" style={`color:${theme.secondaryColor};font-size:${emptyFontSize};`}>
			{i18n(I18nKey.musicNoPlaying)}
		</div>
	{/if}

	{#if showText}
		<SubtitleOverlay
			activeLine={activeLine}
			recentCompletedLine={recentCompletedLine}
			nextLines={nextLines}
			{theme}
			translationFontSize={subtitleSizes.translationFontSize}
			upcomingFontSize={subtitleSizes.upcomingFontSize}
		/>
	{/if}
</div>
