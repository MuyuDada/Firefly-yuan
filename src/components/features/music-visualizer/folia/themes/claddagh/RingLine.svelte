<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/claddagh/CladdaghRingLine.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// 投影到 3D 椭圆环上的一行歌词：订阅共享时钟，直接写每个字素 span 的
// transform / opacity / color / text-shadow / filter（带 WeakMap 逐字段去重，
// 与 folia 的 writeGlyph 一致）。framer 的 MotionValue 时间源换成共享时钟 +
// claddaghRing 单例；Linux 的 drop-shadow / 帧率上限调度不移植（目标环境桌面 Chromium）。
import {
	buildLineGraphemeTimeline,
	type Line,
	splitLyricGraphemes,
} from "@/utils/lyrics";
import { colorWithAlpha, mixColors } from "../../colorMix";
import type { LyricClock } from "../../lyricClock";
import type { FoliaTheme } from "../../types";
import { buildWordColorRanges } from "../../wordColoring";
import {
	buildMeasuredSpacingInfo,
	CLADDAGH_BACK_FOLLOW_RATIO,
	CLADDAGH_BACK_ORBIT_FOLLOW_RATIO,
	CLADDAGH_LETTER_SPACING_EM,
	CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS,
	normalizeReadableAngle,
} from "./claddaghLayout";
import {
	adjustCladdaghTimeline,
	clamp,
	getLinePlaybackProgress,
	getLineWordOffset,
	getVisualLength,
	shouldHoldCladdaghFrameForPlaybackReset,
} from "./claddaghTimeline";
import { claddaghRing } from "./ringMotion";

/** The translation's default size against the lyric's. */
const CLADDAGH_TRANSLATION_FONT_RATIO = 0.5;

let {
	line,
	lineIndex,
	clock,
	theme,
	lyricsFontScale = 1.0,
	Rx,
	Ry,
	containerWidth,
	containerHeight,
	activeSpacingInfo,
	renderBaseIndex,
	lines,
	centerLineIndex,
	getBands,
	focusScaleRatio = 0.65,
	ellipseTiltDeg = 45,
	textSpacingScale = 1,
	letterSpacingOffset = 0,
	translation,
	translationFontWeight = 600,
	translationScale = 1,
	translationLetterSpacingOffset = 0,
}: {
	line: Line;
	lineIndex: number;
	clock: LyricClock;
	theme: FoliaTheme;
	lyricsFontScale?: number;
	Rx: number;
	Ry: number;
	containerWidth: number;
	containerHeight: number;
	/** 当前行（圆环焦点行）的间距信息，供 back-follow 计算。 */
	activeSpacingInfo: Array<{
		nominalAngle: number;
		startTime: number;
		endTime: number;
		scaleFactor?: number;
	}>;
	renderBaseIndex: number;
	lines: Line[];
	centerLineIndex: number;
	getBands?: () => { bass: number; vocal: number };
	focusScaleRatio?: number;
	ellipseTiltDeg?: number;
	textSpacingScale?: number;
	letterSpacingOffset?: number;
	translation?: string;
	translationFontWeight?: number;
	translationScale?: number;
	translationLetterSpacingOffset?: number;
} = $props();

const fontStack = theme.fontFamily;
const baseFontSize = 72 * lyricsFontScale;
const fontWeight = theme.fontWeight;
const fontSpec = `${fontWeight} ${baseFontSize}px ${fontStack}`;

const baseColor = $derived(colorWithAlpha(theme.primaryColor, 0.55));
const highlightColor = $derived(theme.accentColor || theme.primaryColor);

// Calculate layout positioning and angles for each character/grapheme.
const spacingInfo = $derived.by(() => {
	const timeline = adjustCladdaghTimeline(
		buildLineGraphemeTimeline(line),
		line,
	);
	const wordColorRanges = buildWordColorRanges(line.fullText, theme.wordColors);

	let codeUnitCursor = 0;
	const data = timeline.map((t) => {
		const charLength = t.char.length;
		const startOffset = codeUnitCursor;
		const endOffset = codeUnitCursor + charLength;
		codeUnitCursor = endOffset;

		// Find if this character overlaps with any wordColor range
		const matchedRange = wordColorRanges.find(
			(range) => startOffset < range.endOffset && range.startOffset < endOffset,
		);
		const charColor = matchedRange ? matchedRange.color : null;

		return { ...t, charColor };
	});

	return buildMeasuredSpacingInfo(
		data,
		fontSpec,
		baseFontSize,
		Rx,
		textSpacingScale,
		letterSpacingOffset,
	);
});

// The translation's glyphs: centred on the ring like the lyric's, at their own measured spacing.
const translationFontPx = $derived(
	baseFontSize * CLADDAGH_TRANSLATION_FONT_RATIO * translationScale,
);
const translationSpacingInfo = $derived.by(() => {
	const text = translation?.trim();
	if (!text) return [];
	const items = splitLyricGraphemes(text).map((char) => ({ char }));
	const spec = `${translationFontWeight} ${translationFontPx}px ${fontStack}`;
	return buildMeasuredSpacingInfo(
		items,
		spec,
		translationFontPx,
		Rx,
		1,
		translationLetterSpacingOffset,
	);
});

let charEls: HTMLSpanElement[] = $state([]);
let translationEls: HTMLSpanElement[] = $state([]);

// The per-frame style of one glyph span, as strings ready to assign.
interface GlyphStyle {
	transform: string;
	opacity: string;
	color: string;
	textShadow: string;
	filter: string;
}

let previousTime = 0;
let holdResetFrame = false;

$effect(() => {
	// What each glyph span currently shows. Most of these strings repeat frame to frame; comparing
	// them is far cheaper than handing the same declaration back to the style engine to parse.
	const written = new WeakMap<HTMLSpanElement, GlyphStyle>();
	const writeGlyph = (el: HTMLSpanElement, next: GlyphStyle) => {
		const previous = written.get(el);
		if (previous?.transform !== next.transform)
			el.style.transform = next.transform;
		if (previous?.opacity !== next.opacity) el.style.opacity = next.opacity;
		if (previous?.color !== next.color) el.style.color = next.color;
		if (previous?.textShadow !== next.textShadow)
			el.style.textShadow = next.textShadow;
		if (previous?.filter !== next.filter) el.style.filter = next.filter;
		written.set(el, next);
	};

	const handler = (latestTime: number) => {
		if (
			shouldHoldCladdaghFrameForPlaybackReset(
				previousTime,
				latestTime,
				centerLineIndex,
			)
		) {
			holdResetFrame = true;
		}
		previousTime = latestTime;

		// MotionValue time resets before the matching line index commits.
		// Preserve the completed frame instead of rendering the old last line at time zero.
		if (holdResetFrame && centerLineIndex > 0) {
			return;
		}
		holdResetFrame = false;

		// 推进圆环自转与频段平滑（按帧去重：多个 RingLine 同帧只整合一次）。
		const bands = getBands?.();
		if (bands) {
			claddaghRing.bassTarget = bands.bass;
			claddaghRing.vocalTarget = bands.vocal;
		}
		claddaghRing.step(performance.now());

		const mvsLength = spacingInfo.length;
		if (mvsLength === 0) return;

		const curLineOffset = claddaghRing.offset;
		const power = Math.max(0, Math.min(1, claddaghRing.bass));
		const intensity = theme.animationIntensity || "normal";
		let intensityMultiplier = 0.25;
		let maxScale = 1.25;

		if (intensity === "calm") {
			intensityMultiplier = 0.08;
			maxScale = 1.08;
		} else if (intensity === "chaotic") {
			intensityMultiplier = 0.95;
			maxScale = 1.95;
		}

		// Scale radius, bounded to avoid excessive translation
		const scaleFactor = Math.min(1 + power * intensityMultiplier, maxScale);
		const currentRx = Rx * scaleFactor;
		const currentRy = Ry * scaleFactor;

		const isUpcomingLine = lineIndex > centerLineIndex;
		const upcomingEntryProgress = isUpcomingLine
			? clamp(
					(latestTime -
						(line.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS)) /
						CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS,
					0,
					1,
				)
			: 0;
		const lineDiffFromCenter =
			Math.abs(curLineOffset - lineIndex * Math.PI) / Math.PI;

		// Calculate overlap mitigation factors based on current and next line lengths
		const currentLine = lines[centerLineIndex];
		const currentLen = currentLine ? getVisualLength(currentLine.fullText) : 0;
		const targetLine = lines[lineIndex];
		const targetLen = targetLine ? getVisualLength(targetLine.fullText) : 0;

		let lengthFadeFactor = 1.0;
		let lengthScaleFactor = 1.0;

		if (lineIndex > centerLineIndex && currentLen > 10) {
			const fadeStrength = clamp((currentLen - 10) / 8, 0, 1);
			const targetStrength = clamp((targetLen - 5) / 5, 0.4, 1);
			const combinedStrength = fadeStrength * targetStrength;

			const targetMinOpacity = 1.0 - combinedStrength;
			const targetMinScale = 1.0 - combinedStrength * 0.25;

			const transitionProgress = clamp((lineDiffFromCenter - 0.4) / 0.5, 0, 1);

			lengthFadeFactor = 1.0 - (1.0 - targetMinOpacity) * transitionProgress;
			lengthScaleFactor = 1.0 - (1.0 - targetMinScale) * transitionProgress;
		}
		const activeLine = lines[renderBaseIndex];
		const activeNextLine = lines[renderBaseIndex + 1];
		// Extend the render end time to the next line's start time (minus lead time) so the ring slowly
		// drifts continuously during instrumental gaps, while leaving time for the next line's entry.
		const activeRenderEnd = activeLine
			? Math.max(
					activeLine.renderHints?.renderEndTime ?? activeLine.endTime,
					activeNextLine
						? activeNextLine.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS
						: activeLine.endTime + 10.0,
				)
			: undefined;

		const nextLine = lines[lineIndex + 1];
		const ownRenderEnd = Math.max(
			line.renderHints?.renderEndTime ?? line.endTime,
			nextLine
				? nextLine.startTime - CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS
				: line.endTime + 10.0,
		);

		const activeWordOffset = getLineWordOffset(
			activeSpacingInfo,
			latestTime,
			activeRenderEnd,
		);
		const ownWordOffset = getLineWordOffset(
			spacingInfo,
			latestTime,
			ownRenderEnd,
		);
		const activeLineProgress = getLinePlaybackProgress(
			activeSpacingInfo,
			latestTime,
			activeRenderEnd,
		);
		const backOrbitFollow =
			Math.PI *
			CLADDAGH_BACK_ORBIT_FOLLOW_RATIO *
			(1 - (1 - activeLineProgress) ** 1.35);
		let wordOffset = ownWordOffset;
		if (lineIndex < centerLineIndex) {
			// Past lines keep their own completed word offset instead of
			// tracking the new active line, to avoid snapping back to 0.
		} else {
			// Use lineDiffFromCenter as a continuous blend factor so the
			// back-follow contribution fades out smoothly during the spring
			// rotation, instead of jumping to 0 when renderBaseIndex updates.
			const backFollowFactor =
				lineIndex > centerLineIndex ? 1 : clamp(lineDiffFromCenter, 0, 1);
			wordOffset +=
				(activeWordOffset * CLADDAGH_BACK_FOLLOW_RATIO + backOrbitFollow) *
				backFollowFactor;
		}

		const R_ref = currentRx;
		const R_major = currentRx;
		const R_minor = currentRx * 0.09; // Squashed minor axis for a slender ellipse

		for (let i = 0; i < mvsLength; i++) {
			const el = charEls[i];
			if (!el) continue;

			const item = spacingInfo[i];
			const nominalAngle = item.nominalAngle;

			const theta = lineIndex * Math.PI + nominalAngle; // Spacing by 180 degrees
			const psi = theta - curLineOffset - wordOffset;

			// deltaDist is the linear distance along the arc in pixels
			const deltaDist = psi * R_ref;

			// Angle along the major axis
			const thetaCurve = deltaDist / R_major;

			// Calculate depth factor D (1 in the front, 0 in the back) based on ellipse curve position
			const localCos = Math.cos(thetaCurve);
			const D = (localCos + 1) / 2;

			// Scale character spacing along the major axis by depth to gather back characters closer
			const spacingFactor = 0.35 + 0.65 * D ** 1.2;

			// Active character (psi = 0) is at (0, R_minor) before rotation
			const rawX = Math.sin(thetaCurve) * R_major * spacingFactor;

			let rawY = localCos * R_minor;
			if (line.isChorus) {
				// Alternating vertical stagger that pushes even/odd indices up/down, pulsing with beat power
				const staggerAmount = baseFontSize * (0.06 + power * 0.12);
				rawY += (i % 2 === 0 ? 1 : -1) * staggerAmount;
			}

			// Rotate the coordinate system so the major axis aligns with the screen's anti-diagonal.
			const thetaRot = -(ellipseTiltDeg * Math.PI) / 180;
			const cosTheta = Math.cos(thetaRot);
			const sinTheta = Math.sin(thetaRot);

			const x = rawX * cosTheta - rawY * sinTheta;
			const y = rawX * sinTheta + rawY * cosTheta;

			const tangentX = Math.cos(thetaCurve) * R_major;
			const tangentY = -Math.sin(thetaCurve) * R_minor;
			const rotatedTangentX = tangentX * cosTheta - tangentY * sinTheta;
			const rotatedTangentY = tangentX * sinTheta + tangentY * cosTheta;
			const tangentAngle = normalizeReadableAngle(
				(Math.atan2(rotatedTangentY, rotatedTangentX) * 180) / Math.PI,
			);

			// Calculate the focus factor F:
			// F ranges from 1 (active character on active line) to 0 (back side of the ring / far away)
			const lineDiffNormalized = lineDiffFromCenter;
			const activeLineFactor = Math.max(0, 1 - lineDiffNormalized);

			const maxVisibleDist = currentRx * 0.48; // Focus width for active line
			const distRatio = Math.min(1, Math.abs(deltaDist) / maxVisibleDist);
			const F = activeLineFactor * (1 - distRatio) ** 1.8;

			// Blend visual properties using depth factor D and focus factor F for a pseudo-3D look
			const distanceOpacity = 0.68 + 0.32 * D ** 1.9;
			let finalOpacity =
				(0.35 + 0.65 * D ** 1.5 * (0.35 + 0.65 * F)) * distanceOpacity;

			// Hide the next line while it is still equivalent to the outgoing line's foreground turn.
			const lineWindowFade = clamp(2 - lineDiffNormalized, 0, 1);
			finalOpacity = finalOpacity * lineWindowFade;

			// Hide past lines completely when the transition is done
			if (lineIndex < centerLineIndex) {
				const pastFade = Math.max(0, 1 - lineDiffNormalized);
				finalOpacity = finalOpacity * pastFade;
			}

			// Apply dynamic layout overlap mitigation factors based on sentence lengths
			finalOpacity = finalOpacity * lengthFadeFactor;

			if (isUpcomingLine) {
				finalOpacity = finalOpacity * (0.18 + 0.82 * upcomingEntryProgress);
			}

			// Boundary fade to keep non-focused lines strictly in the back half of the ellipse
			let boundaryFade = 1.0;
			if (lineDiffFromCenter > 0.02) {
				const progress = clamp((lineDiffFromCenter - 0.3) / 0.6, 0, 1);
				const cosThreshold = 1.0 - 1.2 * progress;
				if (localCos > cosThreshold) {
					boundaryFade = clamp(1.0 - (localCos - cosThreshold) / 0.15, 0, 1);
				}
			}
			finalOpacity = finalOpacity * boundaryFade;

			// A glyph at opacity 0 draws nothing; once written, skip until visible again.
			const opacityText = finalOpacity.toFixed(3);
			if (
				Number(opacityText) === 0 &&
				Number(written.get(el)?.opacity ?? 1) === 0
			)
				continue;

			const scaleText =
				(0.22 + 0.98 * D ** 1.5) *
				(1.0 + focusScaleRatio * F) *
				lengthScaleFactor *
				(item.scaleFactor ?? 1.0);
			const blur = 8.0 * (1 - D) * (1 - 0.5 * F);
			const tiltAngle = clamp(tangentAngle * (0.4 + 0.6 * D), -38, 38);

			const transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0px) rotate(${tiltAngle.toFixed(2)}deg) scale(${scaleText.toFixed(3)})`;
			const blurFilter = blur < 0.2 ? "" : `blur(${blur.toFixed(2)}px)`;

			// Update text color and text shadow (glow) progressively based on character playback status
			let charProgress = 0;
			if (latestTime >= item.endTime) {
				charProgress = 1;
			} else if (latestTime > item.startTime) {
				const dur = item.endTime - item.startTime;
				charProgress = dur > 0 ? (latestTime - item.startTime) / dur : 1;
			}

			// Calculate glow based on focus factor F and power.
			const baseGlow = line.isChorus
				? (36 + power * 24) * F ** 1.5
				: 24 * F ** 2.0;

			const finalHighlightColor = item.charColor || highlightColor;

			// Color and alpha with "camera flash" effect
			let targetColor = baseColor;
			let currentAlpha = 0.55;
			let flashPop = 0;

			if (charProgress >= 1) {
				targetColor = finalHighlightColor;
				currentAlpha = 1.0;
			} else if (charProgress > 0) {
				// Near-instant transition (hard cut) for the color snap
				const progressFactor = Math.min(1, charProgress * 15.0);
				currentAlpha = 0.55 + 0.45 * progressFactor;
				targetColor = mixColors(
					baseColor,
					finalHighlightColor,
					progressFactor,
					currentAlpha,
				);

				// A quick decaying pop on the radius to emphasize the flash
				if (charProgress < 0.4) {
					flashPop = (1 - charProgress / 0.4) ** 2.0 * 0.65;
				}
			}

			// Firefly 只保留 text-shadow 路径（folia 在 Linux 上的 drop-shadow 降级不移植）。
			const currentGlowRadius = baseGlow * (1.0 + flashPop);

			let textShadow = "none";

			// Smooth fade-out so the shadow doesn't pop at the 0.5px threshold.
			const shadowFade = clamp((currentGlowRadius - 0.5) / 2.0, 0, 1);

			if (currentGlowRadius > 0.5 && shadowFade > 0.01) {
				const fadedTargetColor = mixColors(
					targetColor,
					targetColor,
					0,
					currentAlpha * shadowFade,
				);

				if (line.isChorus) {
					// Blend targetColor with the theme's primary text color for a bright inner core.
					const innerGlowColor = mixColors(
						targetColor,
						theme.primaryColor || "#ffffff",
						0.65,
						shadowFade,
					);
					textShadow = `0 0 ${(currentGlowRadius * 0.35).toFixed(1)}px ${innerGlowColor}, 0 0 ${currentGlowRadius.toFixed(1)}px ${fadedTargetColor}, 0 0 ${(currentGlowRadius * 1.6).toFixed(1)}px ${fadedTargetColor}`;
				} else {
					textShadow = `0 0 ${currentGlowRadius.toFixed(1)}px ${fadedTargetColor}`;
				}
			}

			writeGlyph(el, {
				transform,
				opacity: opacityText,
				color: targetColor,
				textShadow,
				filter: [blurFilter].filter(Boolean).join(" ") || "none",
			});
		}

		// The translation: on the same ellipse and turn as the lyric, moved out along the
		// minor axis so it runs under the lyric. No per-glyph timing of its own.
		const translationLength = translationSpacingInfo.length;
		if (translationLength > 0) {
			const thetaRot = -(ellipseTiltDeg * Math.PI) / 180;
			const cosTheta = Math.cos(thetaRot);
			const sinTheta = Math.sin(thetaRot);
			const lineDiffNormalized = lineDiffFromCenter;
			const activeLineFactor = Math.max(0, 1 - lineDiffNormalized);
			const maxVisibleDist = currentRx * 0.48;
			const focusScale = focusScaleRatio;
			const gapPx =
				baseFontSize * 0.62 * (1 + focusScale * 0.5) + translationFontPx * 0.8;
			const sungGlyphs =
				getLinePlaybackProgress(spacingInfo, latestTime, ownRenderEnd) *
				translationLength;

			for (let i = 0; i < translationLength; i++) {
				const el = translationEls[i];
				if (!el) continue;

				const item = translationSpacingInfo[i];
				const psi =
					lineIndex * Math.PI + item.nominalAngle - curLineOffset - wordOffset;
				const deltaDist = psi * R_ref;
				const thetaCurve = deltaDist / R_major;
				const localCos = Math.cos(thetaCurve);
				const D = (localCos + 1) / 2;
				const depthScale = 0.22 + 0.98 * D ** 1.5;
				const spacingFactor = 0.35 + 0.65 * D ** 1.2;
				const rawX = Math.sin(thetaCurve) * R_major * spacingFactor;
				const rawY = localCos * R_minor + gapPx * depthScale;
				const x = rawX * cosTheta - rawY * sinTheta;
				const y = rawX * sinTheta + rawY * cosTheta;

				const tangentX = Math.cos(thetaCurve) * R_major;
				const tangentY = -Math.sin(thetaCurve) * R_minor;
				const tangentAngle = normalizeReadableAngle(
					(Math.atan2(
						tangentX * sinTheta + tangentY * cosTheta,
						tangentX * cosTheta - tangentY * sinTheta,
					) *
						180) /
						Math.PI,
				);

				const F =
					activeLineFactor *
					(1 - Math.min(1, Math.abs(deltaDist) / maxVisibleDist)) ** 1.8;
				let opacity =
					(0.35 + 0.65 * D ** 1.5 * (0.35 + 0.65 * F)) *
					(0.68 + 0.32 * D ** 1.9);
				opacity *= clamp(2 - lineDiffNormalized, 0, 1) * lengthFadeFactor * 0.9;
				if (lineIndex < centerLineIndex)
					opacity *= Math.max(0, 1 - lineDiffNormalized);
				if (isUpcomingLine) opacity *= 0.18 + 0.82 * upcomingEntryProgress;
				if (lineDiffFromCenter > 0.02) {
					const cosThreshold =
						1.0 - 1.2 * clamp((lineDiffFromCenter - 0.3) / 0.6, 0, 1);
					if (localCos > cosThreshold)
						opacity *= clamp(1.0 - (localCos - cosThreshold) / 0.15, 0, 1);
				}

				const opacityText = opacity.toFixed(3);
				if (
					Number(opacityText) === 0 &&
					Number(written.get(el)?.opacity ?? 1) === 0
				)
					continue;

				const scale =
					depthScale *
					(1 + focusScale * 0.35 * F) *
					lengthScaleFactor *
					item.scaleFactor;
				const blur = 8.0 * (1 - D) * (1 - 0.5 * F);
				const tiltAngle = clamp(tangentAngle * (0.4 + 0.6 * D), -38, 38);
				const sung = clamp(sungGlyphs - i, 0, 1);

				writeGlyph(el, {
					transform: `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0px) rotate(${tiltAngle.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
					opacity: opacityText,
					color:
						sung > 0
							? mixColors(baseColor, highlightColor, sung, 0.55 + 0.3 * sung)
							: baseColor,
					textShadow: "none",
					filter: blur < 0.2 ? "none" : `blur(${blur.toFixed(2)}px)`,
				});
			}
		}
	};

	const unsubscribe = clock.subscribe((latest) => {
		handler(latest);
	});
	return unsubscribe;
});
</script>

<div class="folia-claddagh-ringline">
	{#each spacingInfo as item, idx (idx)}
		<span
			bind:this={charEls[idx]}
			class="folia-claddagh-glyph"
			style={`font-family:${fontStack};font-size:${baseFontSize}px;font-weight:${fontWeight};letter-spacing:${CLADDAGH_LETTER_SPACING_EM}em;color:${baseColor};`}
		>
			{item.char}
		</span>
	{/each}
	{#each translationSpacingInfo as item, idx (`t-${idx}`)}
		<span
			bind:this={translationEls[idx]}
			class="folia-claddagh-glyph"
			style={`font-family:${fontStack};font-size:${translationFontPx}px;font-weight:${translationFontWeight};letter-spacing:${CLADDAGH_LETTER_SPACING_EM}em;color:${baseColor};`}
		>
			{item.char}
		</span>
	{/each}
</div>
