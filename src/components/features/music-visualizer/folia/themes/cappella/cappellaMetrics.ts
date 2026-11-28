// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/cappella/{cappellaBubbleMetrics,cappellaMessageLayout,cappellaMessages}.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Modifications: pretext 测量换用 folia/pretextShim；表情图库不移植（池恒为空）。

import type { Line } from "@/utils/lyrics";
import { getLineRenderEndTime, getLineRenderHints } from "@/utils/lyrics";
import { mixColors } from "../../colorMix";
import { layoutWithLines, prepareWithSegments } from "../../pretextShim";
import { rememberBounded } from "../../textMeasureCache";
import type { BubbleSize, PreparedBubbleMetrics } from "./cappellaCore";
import {
	AVATAR_GRID_SIZE,
	CAPPELLA_BUBBLE_FONT_WEIGHT,
	CAPPELLA_LAYOUT_CACHE_LIMIT,
	CAPPELLA_WIDTH_LOOKAHEAD_SECONDS,
	type CappellaIntensityConfig,
	type CappellaMessage,
	type CappellaTimedMessage,
	type CappellaTuning,
	createCappellaAgentSenderResolver,
	INTERLUDE_TEXT,
	isTimedMessage,
	LEFT_AVATAR_INDICES,
	MAX_VISIBLE_MESSAGES,
	RIGHT_AVATAR_INDEX,
	SHORT_LINE_CHAR_LIMIT,
} from "./cappellaCore";
import {
	buildCharacterFadeDurationsMs,
	buildCharacterRevealTimes,
	getLineCharacters,
	getTimestampReadyTimeFromMetrics,
} from "./cappellaReveal";

export interface BubbleTheme {
	name: string;
	fontFamily: string;
	fontWeight: number;
	backgroundColor: string;
	primaryColor: string;
	accentColor: string;
	secondaryColor: string;
}

// ── 气泡测量（cappellaBubbleMetrics.ts） ─────────────────────

export const measureBubbleText = ({
	text,
	theme,
	fontSize,
	lineHeightPx,
	maxTextWidth,
	paddingX,
	paddingY,
}: {
	text: string;
	theme: BubbleTheme;
	fontSize: number;
	lineHeightPx: number;
	maxTextWidth: number;
	paddingX: number;
	paddingY: number;
}): BubbleSize => {
	const bubbleBorderWidth = 1;
	const safeText = text || " ";
	const prepared = prepareWithSegments(
		safeText,
		`${theme.fontWeight || CAPPELLA_BUBBLE_FONT_WEIGHT} ${fontSize}px ${theme.fontFamily}`,
	);
	const layout = layoutWithLines(
		prepared,
		Math.max(1, maxTextWidth),
		Math.round(lineHeightPx),
	);
	const textWidth = Math.max(
		...layout.lines.map((line) => line.width),
		fontSize,
	);
	const textHeight = Math.max(layout.lines.length, 1) * lineHeightPx;

	return {
		width: Math.ceil(
			Math.min(textWidth, maxTextWidth) + paddingX * 2 + bubbleBorderWidth * 2,
		),
		height: Math.ceil(textHeight + paddingY * 2 + bubbleBorderWidth * 2),
	};
};

const getBubbleMetricsCacheKey = ({
	line,
	theme,
	fontSize,
	lineHeightPx,
	maxTextWidth,
	paddingX,
	paddingY,
}: {
	line: Line;
	theme: BubbleTheme;
	fontSize: number;
	lineHeightPx: number;
	maxTextWidth: number;
	paddingX: number;
	paddingY: number;
}): string =>
	[
		line.startTime,
		line.endTime,
		line.words.length,
		theme.name,
		theme.fontFamily,
		theme.fontWeight || CAPPELLA_BUBBLE_FONT_WEIGHT,
		fontSize.toFixed(3),
		lineHeightPx.toFixed(3),
		maxTextWidth,
		paddingX,
		paddingY,
	].join("|");

// Precompute all bubble sizes for a line so playback only does O(1) lookups.
export const getOrBuildBubbleMetrics = (
	cache: Map<string, PreparedBubbleMetrics>,
	{
		line,
		theme,
		fontSize,
		lineHeightPx,
		maxTextWidth,
		paddingX,
		paddingY,
	}: {
		line: Line;
		theme: BubbleTheme;
		fontSize: number;
		lineHeightPx: number;
		maxTextWidth: number;
		paddingX: number;
		paddingY: number;
	},
): PreparedBubbleMetrics => {
	const cacheKey = getBubbleMetricsCacheKey({
		line,
		theme,
		fontSize,
		lineHeightPx,
		maxTextWidth,
		paddingX,
		paddingY,
	});
	const cached = cache.get(cacheKey);

	if (cached) {
		cache.delete(cacheKey);
		cache.set(cacheKey, cached);
		return cached;
	}

	const characters = getLineCharacters(line);
	const revealTimes = buildCharacterRevealTimes(line, characters);
	const fadeDurationsMs = buildCharacterFadeDurationsMs(line, characters);
	const timestampReadyTime = getTimestampReadyTimeFromMetrics(
		line,
		revealTimes,
		fadeDurationsMs,
	);
	// Measure each prefix exactly once. Text reveal and bubble width use the same
	// sizes table; they only differ in which timeline resolves the prefix count.
	const bubbleTargetTimes = revealTimes.map(
		(time) => time - CAPPELLA_WIDTH_LOOKAHEAD_SECONDS,
	);
	const sizes: BubbleSize[] = [];

	for (
		let visibleCount = 0;
		visibleCount <= characters.length;
		visibleCount += 1
	) {
		const measuredText = characters.slice(0, visibleCount).join("");
		sizes.push(
			measureBubbleText({
				text: measuredText,
				theme,
				fontSize,
				lineHeightPx,
				maxTextWidth,
				paddingX,
				paddingY,
			}),
		);
	}

	const prepared = {
		characters,
		sizes,
		revealTimes,
		bubbleTargetTimes,
		timestampReadyTime,
	};
	return rememberBounded(
		cache,
		cacheKey,
		prepared,
		CAPPELLA_LAYOUT_CACHE_LIMIT,
	);
};

// ── 视口取舍与展示派生（cappellaMessageLayout.ts） ───────────

export const getAvatarPosition = (avatarIndex: number) => {
	const safeIndex = ((avatarIndex % 9) + 9) % 9;
	const col = safeIndex % AVATAR_GRID_SIZE;
	const row = Math.floor(safeIndex / AVATAR_GRID_SIZE);

	return {
		backgroundPosition: `${col * 50}% ${row * 50}%`,
		backgroundSize: `${AVATAR_GRID_SIZE * 100}% ${AVATAR_GRID_SIZE * 100}%`,
	};
};

const getEstimatedMessageHeight = (
	message: CappellaMessage,
	isActive: boolean,
	motionConfig: CappellaIntensityConfig["motion"],
	theme: BubbleTheme,
	baseFontSize: number,
	maxTextWidth: number,
): number => {
	if (message.kind === "emo") {
		const imageSize = isActive
			? motionConfig.emoActiveSize
			: motionConfig.emoInactiveSize;
		const scaleOverflow =
			isActive && motionConfig.activeScale > 1
				? Math.ceil(imageSize * (motionConfig.activeScale - 1))
				: 0;
		return imageSize + scaleOverflow + 48 + 12;
	}

	const fontSize =
		message.kind === "title"
			? baseFontSize
			: baseFontSize *
				(isActive
					? motionConfig.activeFontMultiplier
					: motionConfig.inactiveFontMultiplier);
	const paddingX = isActive
		? motionConfig.activePaddingX
		: motionConfig.inactivePaddingX;
	const paddingY = isActive
		? motionConfig.activePaddingY
		: motionConfig.inactivePaddingY;
	const lineHeightPx = fontSize * 1.45;
	const measuredHeight = measureBubbleText({
		text: message.kind === "title" ? message.text : message.line.fullText,
		theme,
		fontSize,
		lineHeightPx,
		maxTextWidth,
		paddingX,
		paddingY,
	}).height;
	const minHeight = Math.max(
		isActive ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight,
		lineHeightPx + paddingY * 2,
	);
	const renderedHeight = Math.max(measuredHeight, minHeight);
	const scaleOverflow =
		isActive && motionConfig.activeScale > 1
			? Math.ceil(renderedHeight * (motionConfig.activeScale - 1))
			: 0;

	return renderedHeight + scaleOverflow + 12;
};

export const getVisibleMessages = (
	messages: CappellaMessage[],
	visibleLineIndex: number,
	viewportHeight: number,
	currentLineIndex: number,
	currentTime: number,
	motionConfig: CappellaIntensityConfig["motion"],
	theme: BubbleTheme,
	baseFontSize: number,
	maxTextWidth: number,
): CappellaMessage[] => {
	const visible = messages.filter((message) => {
		if (message.kind === "title") {
			return true;
		}

		if (message.kind === "emo") {
			return currentTime >= message.activationStartTime;
		}

		return message.lineIndex <= visibleLineIndex;
	});

	// 计算气泡展示区域的可用高度：总高度减去底部播放控制条区域 (~160px) 和顶部间距 (~80px)
	const usableHeight = Math.max(200, viewportHeight - 240);
	let accumulatedHeight = 0;
	const result: CappellaMessage[] = [];

	for (let i = visible.length - 1; i >= 0; i--) {
		const message = visible[i];
		const timedData = isTimedMessage(message) ? message : null;
		const isActive = timedData
			? getTimedMessageState(timedData, currentTime, currentLineIndex).isActive
			: false;
		const estHeight = getEstimatedMessageHeight(
			message,
			isActive,
			motionConfig,
			theme,
			baseFontSize,
			maxTextWidth,
		);

		if (accumulatedHeight + estHeight > usableHeight && result.length >= 2) {
			break;
		}

		accumulatedHeight += estHeight;
		result.unshift(message);

		if (result.length >= MAX_VISIBLE_MESSAGES) {
			break;
		}
	}

	return result;
};

export const getVisibleLineIndexAtTime = (
	lines: Line[],
	currentTime: number,
): number => {
	for (let index = lines.length - 1; index >= 0; index--) {
		if (currentTime >= lines[index].startTime) {
			return index;
		}
	}

	return -1;
};

export const getTimedMessageState = (
	message: CappellaTimedMessage,
	currentTime: number,
	currentLineIndex: number,
): { isActive: boolean; isPassed: boolean } => {
	if (message.kind === "emo") {
		return {
			isActive:
				currentTime >= message.activationStartTime &&
				currentTime < message.activationEndTime,
			isPassed: currentTime >= message.activationEndTime,
		};
	}

	return {
		isActive: message.lineIndex === currentLineIndex,
		isPassed: message.lineIndex < currentLineIndex,
	};
};

export const getBubbleColors = (
	message: CappellaMessage,
	theme: BubbleTheme,
): { backgroundColor: string; borderColor: string; textColor: string } => {
	if (message.side === "right") {
		return {
			backgroundColor: mixColors(
				theme.accentColor,
				theme.primaryColor,
				0.18,
				0.94,
			),
			borderColor: mixColors(theme.accentColor, theme.primaryColor, 0.34, 0.3),
			textColor: theme.backgroundColor,
		};
	}

	const avatarTone =
		(message.avatarIndex % (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE)) /
		(AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1);
	const accentMix = 0.18 + avatarTone * 0.62;

	return {
		backgroundColor: mixColors(
			theme.secondaryColor,
			theme.accentColor,
			accentMix,
			1,
		),
		borderColor: mixColors(
			theme.secondaryColor,
			theme.accentColor,
			Math.min(accentMix + 0.18, 1),
			0.26,
		),
		textColor: theme.primaryColor,
	};
};

export const formatTimestamp = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "0:00";
	}

	const totalSeconds = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;

	return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

// ── 消息编排（cappellaMessages.ts） ──────────────────────────

const countCompactChars = (text: string) =>
	Array.from(text.replace(/\s/g, "")).length;

const hashString = (input: string) => {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

const seededUnit = (...parts: Array<string | number>) =>
	hashString(parts.join("|")) / 0xffffffff;

const pickStableEmoImage = (
	imagePool: Array<{ url: string }>,
	...seedParts: Array<string | number>
): { url: string } | null => {
	if (imagePool.length === 0) {
		return null;
	}

	const index =
		Math.floor(seededUnit(...seedParts) * imagePool.length) % imagePool.length;
	return imagePool[index] ?? imagePool[0];
};

const getEffectiveRenderEndTime = (line: Line, nextLine?: Line): number =>
	Math.min(
		getLineRenderEndTime(line),
		nextLine?.startTime ?? Number.POSITIVE_INFINITY,
	);

// Assigns stable chat senders and reaction emojis so the conversation stays deterministic per song.
export const buildCappellaMessages = (
	lines: Line[],
	titleText: string,
	config: CappellaIntensityConfig,
	tuning: CappellaTuning,
	emoImagePool: Array<{ url: string }>,
	_forcePreviewEmo = false,
): CappellaMessage[] => {
	const messages: CappellaMessage[] = [
		{
			id: "title",
			kind: "title",
			text: titleText,
			side: "right",
			avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
		},
	];

	const showEmoMessages = tuning.showEmoMessages && emoImagePool.length > 0;

	if (lines.length === 0) {
		return messages;
	}

	let sideSequenceCursor = 0;
	let nextLeftAvatarCursor = 0;
	let lastLyricSender: { side: "left" | "right"; avatarIndex: number } | null =
		null;
	let lyricMessagesSinceRandomEmo = Number.POSITIVE_INFINITY;
	let randomEmoCount = 0;
	const randomEmoCap = Math.floor(
		lines.length * config.sequencing.maxRandomEmoRatio,
	);
	const agentSenderResolver = createCappellaAgentSenderResolver(lines, {
		rightAvatarIndex: RIGHT_AVATAR_INDEX,
		leftAvatarCount: LEFT_AVATAR_INDICES.length,
	});

	lines.forEach((line, lineIndex) => {
		const nextLine = lines[lineIndex + 1];
		const isShortLine =
			countCompactChars(line.fullText) <= SHORT_LINE_CHAR_LIMIT;
		const agentSender = agentSenderResolver?.resolve(line) ?? null;
		const shouldForceRight =
			!agentSender &&
			(lineIndex + 1) % config.sequencing.forceRightEveryLines === 0;
		const shouldCarrySender = Boolean(
			!agentSender &&
				isShortLine &&
				lastLyricSender &&
				seededUnit("carry", line.startTime, lineIndex) <=
					config.sequencing.shortLineCarryChance,
		);
		const baseSide =
			config.sequencing.sideSequence[
				sideSequenceCursor % config.sequencing.sideSequence.length
			];
		const shouldFlipSide =
			!shouldForceRight &&
			seededUnit("flip", line.startTime, lineIndex) <
				config.sequencing.sideFlipChance;
		const resolvedSide = shouldFlipSide
			? baseSide === "left"
				? "right"
				: "left"
			: baseSide;
		let sender: { side: "left" | "right"; avatarIndex: number };
		if (agentSender) {
			sender = agentSender;
		} else if (shouldForceRight) {
			sender = { side: "right", avatarIndex: RIGHT_AVATAR_INDEX };
		} else if (shouldCarrySender && lastLyricSender) {
			sender = lastLyricSender;
		} else {
			sender = {
				side: resolvedSide,
				avatarIndex:
					resolvedSide === "left" ? nextLeftAvatarCursor : RIGHT_AVATAR_INDEX,
			};
		}

		const isInterlude = line.fullText === INTERLUDE_TEXT;
		const emoImage =
			isInterlude && showEmoMessages
				? pickStableEmoImage(
						emoImagePool,
						"interlude",
						line.startTime,
						lineIndex,
					)
				: null;
		const effectiveRenderEndTime = getEffectiveRenderEndTime(line, nextLine);
		if (isInterlude && emoImage && showEmoMessages) {
			messages.push({
				id: `emo-${line.startTime}-${lineIndex}`,
				kind: "emo",
				line,
				lineIndex,
				side: sender.side,
				avatarIndex: sender.avatarIndex,
				emoImageUrl: emoImage.url,
				activationStartTime: line.startTime,
				activationEndTime: Math.max(
					line.startTime + 0.12,
					effectiveRenderEndTime,
				),
			});
		} else {
			messages.push({
				id: `line-${line.startTime}-${lineIndex}`,
				kind: "lyric",
				line,
				lineIndex,
				side: sender.side,
				avatarIndex: sender.avatarIndex,
			});
		}
		lyricMessagesSinceRandomEmo += 1;

		const renderHints = getLineRenderHints(line);
		const canAppendRandomEmo =
			!isInterlude &&
			showEmoMessages &&
			config.sequencing.randomEmoChance > 0 &&
			randomEmoCount < randomEmoCap &&
			lyricMessagesSinceRandomEmo >=
				config.sequencing.minLinesBetweenRandomEmos &&
			renderHints?.timingClass === "normal";

		if (canAppendRandomEmo) {
			const score = seededUnit(
				"random-emo",
				line.startTime,
				line.endTime,
				lineIndex,
				config.sequencing.randomEmoChance,
			);
			if (score < config.sequencing.randomEmoChance) {
				const reactionImage = pickStableEmoImage(
					emoImagePool,
					"reaction",
					line.startTime,
					line.endTime,
					lineIndex,
					sender.side,
				);
				if (reactionImage) {
					messages.push({
						id: `emo-reaction-${line.startTime}-${lineIndex}`,
						kind: "emo",
						line,
						lineIndex,
						side: sender.side,
						avatarIndex: sender.avatarIndex,
						emoImageUrl: reactionImage.url,
						activationStartTime: line.endTime,
						activationEndTime: Math.max(
							line.endTime + 0.08,
							effectiveRenderEndTime,
						),
					});
					randomEmoCount += 1;
					lyricMessagesSinceRandomEmo = 0;
				}
			}
		}

		if (agentSender) {
			lastLyricSender = sender;
		} else if (shouldForceRight) {
			sideSequenceCursor = 0;
			lastLyricSender = null;
		} else if (!shouldCarrySender) {
			if (sender.side === "left") {
				nextLeftAvatarCursor += 1;
			}
			sideSequenceCursor += 1;
			lastLyricSender = sender;
		} else {
			lastLyricSender = sender;
		}
	});

	return messages;
};
