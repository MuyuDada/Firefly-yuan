<script lang="ts">
// folia 全屏歌词外壳：覆盖在可视化页之上的独立歌词层。
// 职责对应 folia-web 的 VisualizerShell + usePlaybackVisualizerBridge（裁剪）：
//   - 激活期间驱动共享歌词时钟（单 rAF 读 #firefly-music-audio 的 currentTime）；
//   - 用移植的逐句歌词库独立解析 fm:lyrics 携带的原始 LRC（raw 字段）；
//   - 每帧计算当前行下标（仅在变化时写 $state）；
//   - 按 vizSettings.foliaMode 惰性加载主题组件（各自独立 chunk）；
//   - Escape / 返回按钮退出，导航栏不受影响。

import Icon from "@iconify/svelte";
import type { Component } from "svelte";
import { fade } from "svelte/transition";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	detectTimedLyricFormat,
	findLatestActiveLineIndex,
	type LyricData,
	parseLyricsByFormat,
} from "@/utils/lyrics";
import { buildFoliaTheme } from "./folia/foliaTheme";
import { foliaClock } from "./folia/lyricClock";
import { getFoliaThemeDef } from "./folia/themes";
import type { FoliaVisualizerProps } from "./folia/types";
import { vizPalette, vizSettings } from "./visualizerSettings.svelte";

let rawLrc = $state<string | null>(null);
let lyricData = $state<LyricData | null>(null);
let currentLineIndex = $state(-1);
let themeComponent = $state<{
	default: Component<FoliaVisualizerProps>;
} | null>(null);
let themeLoading = $state(false);
let themeError = $state(false);

const open = $derived(vizSettings.foliaOpen);
const theme = $derived(
	buildFoliaTheme(vizPalette.palette, vizSettings.intensity),
);

// 音频频段（folia 的 audioBands 等效）：由 MusicVisualizer 传入（AudioAnalyzer）。
let { getBands }: { getBands?: () => { bass: number; vocal: number } } =
	$props();

// 跟随播放内核的原始歌词文本（fm:lyrics 的 raw 字段，MusicManager 提供）。
// 挂载时先从内核状态兜底读取一次，避免错过组件挂载前发出的初始歌词。
const onLyricsEvent = (event: Event) => {
	const detail = (
		event as CustomEvent<{
			lyrics?: unknown;
			status?: string;
			raw?: string | null;
		}>
	).detail;
	rawLrc = detail?.raw ?? null;
};

$effect(() => {
	const seeded = (
		window.__fireflyMusic?.getState?.() as unknown as
			| { rawLyrics?: string | null }
			| undefined
	)?.rawLyrics;
	if (seeded && !rawLrc) {
		rawLrc = seeded;
	}
	window.addEventListener("fm:lyrics", onLyricsEvent);
	return () => window.removeEventListener("fm:lyrics", onLyricsEvent);
});

// 打开期间接管时钟：rAF 读音频时间 + seeked 立即对齐 + 每帧算当前行。
$effect(() => {
	if (!open) return;

	const audio = document.getElementById(
		"firefly-music-audio",
	) as HTMLAudioElement | null;
	if (!audio) return;

	foliaClock.start(() => audio.currentTime);
	const onSeeked = () => foliaClock.set(audio.currentTime);
	audio.addEventListener("seeked", onSeeked);

	const unsubscribe = foliaClock.subscribe((time) => {
		if (!lyricData || lyricData.lines.length === 0) {
			if (currentLineIndex !== -1) currentLineIndex = -1;
			return;
		}
		const index = findLatestActiveLineIndex(lyricData.lines, time);
		if (index !== currentLineIndex) currentLineIndex = index;
	});

	return () => {
		unsubscribe();
		audio.removeEventListener("seeked", onSeeked);
		foliaClock.stop();
		currentLineIndex = -1;
	};
});

// 原始 LRC → folia 逐词歌词数据。
$effect(() => {
	if (!rawLrc) {
		lyricData = null;
		return;
	}
	try {
		const format = detectTimedLyricFormat(rawLrc);
		lyricData = parseLyricsByFormat(format, rawLrc);
	} catch {
		lyricData = null;
	}
});

// 主题组件按需加载（换主题时重新加载）。
$effect(() => {
	const def = getFoliaThemeDef(vizSettings.foliaMode);
	if (!def) {
		themeComponent = null;
		themeError = true;
		return;
	}
	let cancelled = false;
	themeLoading = true;
	themeError = false;
	def
		.load()
		.then((mod) => {
			if (cancelled) return;
			themeComponent = mod;
			themeLoading = false;
		})
		.catch(() => {
			if (cancelled) return;
			themeComponent = null;
			themeLoading = false;
			themeError = true;
		});
	return () => {
		cancelled = true;
	};
});

function closeFolia() {
	vizSettings.foliaOpen = false;
}

function onKeyDown(event: KeyboardEvent) {
	if (!open) return;
	if (event.key === "Escape") {
		event.preventDefault();
		closeFolia();
	}
}

const hasLines = $derived((lyricData?.lines.length ?? 0) > 0);
</script>

<svelte:window onkeydown={onKeyDown} />

{#if open}
	<div
		class="music-visualizer__folia"
		data-folia-theme={vizSettings.foliaMode}
		transition:fade={{ duration: 240 }}
	>
		<!-- 压暗层：给歌词留出对比度，Three 场景仍隐约可见 -->
		<div class="music-visualizer__folia-dim" aria-hidden="true"></div>

		{#if themeError}
			<div class="music-visualizer__folia-status">
				{i18n(I18nKey.musicFailedLyrics)}
			</div>
		{:else if themeComponent && hasLines}
			{#key vizSettings.foliaMode}
				<svelte:component
					this={themeComponent.default}
					clock={foliaClock}
					currentLineIndex={currentLineIndex}
					lines={lyricData?.lines ?? []}
					theme={theme}
					{getBands}
				/>
			{/key}
		{:else if themeComponent}
			<div class="music-visualizer__folia-status">
				{i18n(I18nKey.musicNoLyrics)}
			</div>
		{:else if themeLoading}
			<div class="music-visualizer__folia-status">
				<i class="music-visualizer__folia-spinner" aria-hidden="true"></i>
			</div>
		{/if}

		<button
			type="button"
			class="music-visualizer__folia-back"
			onclick={closeFolia}
			title={i18n(I18nKey.vizFoliaExit)}
			aria-label={i18n(I18nKey.vizFoliaExit)}
		>
			<Icon icon="material-symbols:close-rounded" size="md" />
		</button>
	</div>
{/if}
