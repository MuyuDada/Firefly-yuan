// Ported from folia-web <https://github.com/folia-ce/folia-web>
//   (src/components/visualizer/cappella/{cappellaTypes,cappellaConstants,cappellaIntensity,cappellaMessageSenders}.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see src/utils/lyrics/NOTICE.md.
// Modifications: folia 的内置表情/头像图库不移植（Firefly 无该资产），
// emo 消息以空图池禁用，头像走主题色渐变占位；类型与逻辑保持原样。

import type { Line } from "@/utils/lyrics";

// ── 类型（cappellaTypes.ts） ─────────────────────────────────

export type ChatSide = "left" | "right";

export interface CappellaLineMessage {
	id: string;
	kind: "lyric";
	line: Line;
	lineIndex: number;
	side: ChatSide;
	avatarIndex: number;
}

export interface CappellaEmoMessage {
	id: string;
	kind: "emo";
	line: Line;
	lineIndex: number;
	side: ChatSide;
	avatarIndex: number;
	emoImageUrl: string;
	activationStartTime: number;
	activationEndTime: number;
}

export interface CappellaTitleMessage {
	id: string;
	kind: "title";
	text: string;
	side: ChatSide;
	avatarIndex: number;
}

export type CappellaMessage =
	| CappellaTitleMessage
	| CappellaLineMessage
	| CappellaEmoMessage;

export type CappellaTimedMessage = CappellaLineMessage | CappellaEmoMessage;

export const isTimedMessage = (m: CappellaMessage): m is CappellaTimedMessage =>
	m.kind === "lyric" || m.kind === "emo";

export interface BubbleSize {
	width: number;
	height: number;
}

export interface CappellaIntensityConfig {
	sequencing: {
		forceRightEveryLines: number;
		shortLineCarryChance: number;
		sideSequence: ChatSide[];
		sideFlipChance: number;
		randomEmoChance: number;
		minLinesBetweenRandomEmos: number;
		maxRandomEmoRatio: number;
	};
	motion: {
		rowEnterY: number;
		rowEnterScale: number;
		rowEnterDuration: number;
		rowExitY: number;
		rowExitScale: number;
		rowExitDuration: number;
		avatarSpring: { stiffness: number; damping: number; mass: number };
		activeScale: number;
		passedScale: number;
		passedOpacity: number;
		activeFontMultiplier: number;
		inactiveFontMultiplier: number;
		activePaddingX: number;
		activePaddingY: number;
		inactivePaddingX: number;
		inactivePaddingY: number;
		activeMinHeight: number;
		inactiveMinHeight: number;
		glowOpacity: number;
		glowDuration: number;
		glowRightAlpha: number;
		glowLeftAlpha: number;
		activeShadowAlpha: number;
		emoActiveSize: number;
		emoInactiveSize: number;
		emoEnterScale: number;
		emoSizeTransitionDuration: number;
	};
}

export interface PreparedBubbleMetrics {
	/** fullText 按 grapheme 拆出的显示字符，sizes 的下标与它的数量对应 */
	characters: string[];
	/** sizes[n] 表示显示前 n 个字符时气泡应该拥有的 width/height */
	sizes: BubbleSize[];
	/** 每个字符真实开始显示的时间，用来驱动文字 reveal */
	revealTimes: number[];
	/** revealTimes 整体提前一段时间，用来驱动气泡提前横向扩展 */
	bubbleTargetTimes: number[];
	/** 歌词最后一个字符完成淡入的时间，用来控制时间戳出现时机 */
	timestampReadyTime: number;
}

export interface CharacterRevealPlan {
	characters: string[];
	fadeDurationsMs: number[];
}

// ── 常量（cappellaConstants.ts） ─────────────────────────────

export const SHORT_LINE_CHAR_LIMIT = 12;
export const MAX_VISIBLE_MESSAGES = 20;
export const AVATAR_GRID_SIZE = 3;
export const LEFT_AVATAR_INDICES: readonly number[] = [0, 3, 6, 1, 4];
export const RIGHT_AVATAR_INDEX = 8;
export const CAPPELLA_PREHEAT_WINDOW = { minLead: 0.18, maxLead: 1.1 };
export const CAPPELLA_LAYOUT_CACHE_LIMIT = 32;
// 气泡宽度动画约 0.2s。气泡尺寸使用提前后的时间轴，
// 让横向扩展先于字符出现启动，避免临界换行时字符短暂掉到下一行。
export const CAPPELLA_WIDTH_LOOKAHEAD_SECONDS = 0.2;
export const CAPPELLA_BUBBLE_FONT_WEIGHT = 400;
export const INTERLUDE_TEXT = "......";
export const DEFAULT_CHAR_FADE_MS = 220;
export const MIN_CHAR_FADE_MS = 40;

// cappella 调参（folia 的 DEFAULT_CAPPELLA_TUNING 等效；Firefly 无表情/头像图库）。
export const DEFAULT_CAPPELLA_TUNING = {
	showEmoMessages: false,
	avatarSource: "color" as const,
};

export type CappellaTuning = typeof DEFAULT_CAPPELLA_TUNING;

// ── 强度配置（cappellaIntensity.ts） ─────────────────────────

export const getCappellaIntensityConfig = (
	animationIntensity: "calm" | "normal" | "chaotic",
): CappellaIntensityConfig => {
	if (animationIntensity === "calm") {
		return {
			sequencing: {
				forceRightEveryLines: 7,
				shortLineCarryChance: 0.92,
				sideSequence: ["left", "left", "right", "left", "right"],
				sideFlipChance: 0.08,
				randomEmoChance: 0,
				minLinesBetweenRandomEmos: 6,
				maxRandomEmoRatio: 0,
			},
			motion: {
				rowEnterY: 14,
				rowEnterScale: 0.992,
				rowEnterDuration: 0.28,
				rowExitY: -10,
				rowExitScale: 0.985,
				rowExitDuration: 0.22,
				avatarSpring: { stiffness: 280, damping: 30, mass: 0.78 },
				activeScale: 1.07,
				passedScale: 0.96,
				passedOpacity: 0.88,
				activeFontMultiplier: 1.22,
				inactiveFontMultiplier: 0.96,
				activePaddingX: 18,
				activePaddingY: 14,
				inactivePaddingX: 16,
				inactivePaddingY: 12,
				activeMinHeight: 58,
				inactiveMinHeight: 44,
				glowOpacity: 0.26,
				glowDuration: 2.2,
				glowRightAlpha: 0.26,
				glowLeftAlpha: 0.14,
				activeShadowAlpha: 0.24,
				emoActiveSize: 132,
				emoInactiveSize: 96,
				emoEnterScale: 0.74,
				emoSizeTransitionDuration: 0.22,
			},
		};
	}

	if (animationIntensity === "chaotic") {
		return {
			sequencing: {
				forceRightEveryLines: 3,
				shortLineCarryChance: 0.36,
				sideSequence: ["left", "right", "right", "left", "right", "left"],
				sideFlipChance: 0.42,
				randomEmoChance: 0.22,
				minLinesBetweenRandomEmos: 2,
				maxRandomEmoRatio: 1 / 6,
			},
			motion: {
				rowEnterY: 30,
				rowEnterScale: 0.968,
				rowEnterDuration: 0.38,
				rowExitY: -26,
				rowExitScale: 0.94,
				rowExitDuration: 0.28,
				avatarSpring: { stiffness: 360, damping: 24, mass: 0.68 },
				activeScale: 1.18,
				passedScale: 0.88,
				passedOpacity: 0.76,
				activeFontMultiplier: 1.4,
				inactiveFontMultiplier: 0.92,
				activePaddingX: 22,
				activePaddingY: 17,
				inactivePaddingX: 15,
				inactivePaddingY: 11,
				activeMinHeight: 68,
				inactiveMinHeight: 42,
				glowOpacity: 0.52,
				glowDuration: 1.35,
				glowRightAlpha: 0.42,
				glowLeftAlpha: 0.24,
				activeShadowAlpha: 0.42,
				emoActiveSize: 178,
				emoInactiveSize: 122,
				emoEnterScale: 0.54,
				emoSizeTransitionDuration: 0.28,
			},
		};
	}

	return {
		sequencing: {
			forceRightEveryLines: 5,
			shortLineCarryChance: 0.68,
			sideSequence: ["left", "right", "left", "right", "right"],
			sideFlipChance: 0.18,
			randomEmoChance: 0.1,
			minLinesBetweenRandomEmos: 3,
			maxRandomEmoRatio: 1 / 8,
		},
		motion: {
			rowEnterY: 22,
			rowEnterScale: 0.98,
			rowEnterDuration: 0.32,
			rowExitY: -18,
			rowExitScale: 0.965,
			rowExitDuration: 0.24,
			avatarSpring: { stiffness: 340, damping: 28, mass: 0.72 },
			activeScale: 1.12,
			passedScale: 0.92,
			passedOpacity: 0.82,
			activeFontMultiplier: 1.34,
			inactiveFontMultiplier: 0.94,
			activePaddingX: 20,
			activePaddingY: 16,
			inactivePaddingX: 16,
			inactivePaddingY: 12,
			activeMinHeight: 64,
			inactiveMinHeight: 44,
			glowOpacity: 0.4,
			glowDuration: 1.8,
			glowRightAlpha: 0.34,
			glowLeftAlpha: 0.18,
			activeShadowAlpha: 0.34,
			emoActiveSize: 160,
			emoInactiveSize: 110,
			emoEnterScale: 0.6,
			emoSizeTransitionDuration: 0.25,
		},
	};
};

// ── 发送者解析（cappellaMessageSenders.ts） ──────────────────

export interface CappellaMessageSender {
	side: ChatSide;
	avatarIndex: number;
}

const normalizeAgentId = (agentId: string | undefined): string | null => {
	const trimmed = agentId?.trim();
	return trimmed ? trimmed : null;
};

const collectDistinctAgentIds = (
	lines: Array<Pick<Line, "agentId">>,
): string[] => {
	const ids: string[] = [];
	const seen = new Set<string>();

	lines.forEach((line) => {
		const agentId = normalizeAgentId(line.agentId);
		if (!agentId || seen.has(agentId)) {
			return;
		}

		seen.add(agentId);
		ids.push(agentId);
	});

	return ids;
};

export interface CappellaAgentSenderResolver {
	resolve: (line: Pick<Line, "agentId">) => CappellaMessageSender | null;
}

export const createCappellaAgentSenderResolver = (
	lines: Array<Pick<Line, "agentId">>,
	options: { rightAvatarIndex: number; leftAvatarCount: number },
): CappellaAgentSenderResolver | null => {
	const agentIds = collectDistinctAgentIds(lines);
	if (agentIds.length < 2) {
		return null;
	}

	const rightAgentId = agentIds[0];
	const leftAvatarCount = Math.max(1, options.leftAvatarCount);
	const senderByAgentId = new Map<string, CappellaMessageSender>();

	agentIds.forEach((agentId, index) => {
		senderByAgentId.set(
			agentId,
			agentId === rightAgentId
				? { side: "right", avatarIndex: options.rightAvatarIndex }
				: { side: "left", avatarIndex: (index - 1) % leftAvatarCount },
		);
	});

	return {
		resolve: (line) => {
			const agentId = normalizeAgentId(line.agentId);
			return agentId ? (senderByAgentId.get(agentId) ?? null) : null;
		},
	};
};
