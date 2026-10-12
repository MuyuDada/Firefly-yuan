<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { musicPlayerConfig } from "@/config/musicConfig";
import { AudioAnalyzer } from "./AudioAnalyzer";
import {
	css,
	extractCoverColor,
	hexToRgb,
	hslToRgb,
	paletteFromBase,
	paletteFromHue,
	type Rgb,
	type VizPalette,
} from "./colorUtils";
import LyricsOverlay from "./LyricsOverlay.svelte";
import ThreeScene from "./ThreeScene.svelte";
import VisualizerControls from "./VisualizerControls.svelte";
import { vizPalette, vizSettings } from "./visualizerSettings.svelte";

const audioAnalyzer = new AudioAnalyzer();
let sceneReady = $state(false);
let backgroundColor = $state(
	musicPlayerConfig.visualizer?.background?.dark ?? "#0a0a15",
);

let rootEl: HTMLDivElement | undefined;
let accentRaf = 0;

// 当前曲目封面，cover 取色模式的输入
let coverUrl = $state<string | null>(null);

// 把主题强调色同步到 CSS 变量，进度条 / 滑块 / 描边等 UI 跟随主题色。
// 多彩循环时每帧更新（只写这一个元素的行内样式，不走 Svelte 重渲染）。
function applyAccentVars(rgb: Rgb) {
	if (!rootEl) return;
	rootEl.style.setProperty("--mv-accent", css(rgb, 1));
	rootEl.style.setProperty("--mv-accent-dim", css(rgb, 0.36));
	rootEl.style.setProperty("--mv-accent-glow", css(rgb, 0.52));
}

// 统一出口：更新共享调色板（ThreeScene 消费）+ 同步 CSS 变量
function applyPalette(palette: VizPalette) {
	vizPalette.palette = palette;
	applyAccentVars(hexToRgb(palette.accent));
}

// 读取博客全局主题色相（Layout.astro / setting-utils 写在 :root 上）
function readGlobalHue(): number {
	if (typeof document === "undefined") return 250;
	const raw = getComputedStyle(document.documentElement).getPropertyValue(
		"--hue",
	);
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) ? n : 250;
}

function startRainbowAccent() {
	if (accentRaf) return;
	const start = performance.now();
	const tick = () => {
		const hue = (((performance.now() - start) / 1000) * 0.04) % 1;
		applyAccentVars(hslToRgb(hue, 0.85, 0.6));
		accentRaf = requestAnimationFrame(tick);
	};
	accentRaf = requestAnimationFrame(tick);
}

function stopRainbowAccent() {
	if (!accentRaf) return;
	cancelAnimationFrame(accentRaf);
	accentRaf = 0;
}

// ── 调色板解析器 ────────────────────────────────────────────────
// 三种模式统一在这里收敛成一份调色板：
//   rainbow 交给 rAF 逐帧改 CSS 变量，同时把 rainbow 标志交给 ThreeScene
//   theme   直接由 --hue 推导
//   cover   异步从封面取色；取不到就退回主题色，保证永远有可用配色
$effect(() => {
	const mode = vizSettings.colorMode;
	const cover = coverUrl;

	if (mode === "rainbow") {
		vizPalette.rainbow = true;
		startRainbowAccent();
		return () => stopRainbowAccent();
	}

	vizPalette.rainbow = false;
	stopRainbowAccent();

	if (mode === "theme") {
		applyPalette(paletteFromHue(readGlobalHue()));
		return;
	}

	// cover：没有封面时先用主题色顶上，避免等待期间闪默认青蓝
	if (!cover) {
		applyPalette(paletteFromHue(readGlobalHue()));
		return;
	}

	let cancelled = false;
	void extractCoverColor(cover).then((hex) => {
		if (cancelled) return;
		applyPalette(
			hex ? paletteFromBase(hex) : paletteFromHue(readGlobalHue()),
		);
	});
	return () => {
		cancelled = true;
	};
});

function connectAudio() {
	const audio = document.getElementById(
		"firefly-music-audio",
	) as HTMLAudioElement | null;
	if (!audio) {
		setTimeout(connectAudio, 200);
		return;
	}
	audio.crossOrigin = "anonymous";
	audioAnalyzer.connect(audio);

	if (!audioAnalyzer.isConnected()) {
		setTimeout(connectAudio, 200);
		return;
	}

	if (audioCtxState() === "suspended") {
		audioAnalyzer.resume();
	}
}

function audioCtxState() {
	return audioAnalyzer.audioCtx?.state || "running";
}

function resumeAudioContext() {
	void audioAnalyzer.resume();
}

onMount(() => {
	const mgr = window.__fireflyMusic;
	if (!mgr) {
		const waitForMgr = () => {
			if (window.__fireflyMusic) {
				connectAudio();
			} else {
				setTimeout(waitForMgr, 100);
			}
		};
		waitForMgr();
	} else {
		if (!mgr.getState().initialized) {
			mgr.init();
		}
		connectAudio();
	}

	// 跟踪当前封面，喂给 cover 取色模式
	const syncTrack = () => {
		coverUrl = window.__fireflyMusic?.getState().track?.pic ?? null;
	};
	syncTrack();
	window.addEventListener("fm:init", syncTrack);
	window.addEventListener("fm:track", syncTrack);

	// 主题色相写在 :root 的行内样式上，用户改主题色时重新推导。
	// applyPalette 只写 .music-visualizer 的行内样式，不会触发这里的回环。
	const themeObserver = new MutationObserver(() => {
		if (vizSettings.colorMode === "theme") {
			applyPalette(paletteFromHue(readGlobalHue()));
		}
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["style", "class"],
	});

	const handleAudioGesture = () => {
		resumeAudioContext();
	};
	const audio = document.getElementById("firefly-music-audio");
	document.addEventListener("click", handleAudioGesture, { passive: true });
	document.addEventListener("pointerdown", handleAudioGesture, {
		passive: true,
	});
	document.addEventListener("touchstart", handleAudioGesture, {
		passive: true,
	});
	audio?.addEventListener("playing", resumeAudioContext);

	return () => {
		document.removeEventListener("click", handleAudioGesture);
		document.removeEventListener("pointerdown", handleAudioGesture);
		document.removeEventListener("touchstart", handleAudioGesture);
		audio?.removeEventListener("playing", resumeAudioContext);
		window.removeEventListener("fm:init", syncTrack);
		window.removeEventListener("fm:track", syncTrack);
		themeObserver.disconnect();
		stopRainbowAccent();
	};
});

onDestroy(() => {
	audioAnalyzer.disconnect();
});
</script>

<div class="music-visualizer" bind:this={rootEl} style={`background: ${backgroundColor};`}>
	{#if sceneReady}
		<div class="music-visualizer__desktop-layout">
			<VisualizerControls />
			<LyricsOverlay />
		</div>
	{/if}
	<ThreeScene
		{audioAnalyzer}
		{backgroundColor}
		onSceneReady={() => (sceneReady = true)}
	/>
</div>
