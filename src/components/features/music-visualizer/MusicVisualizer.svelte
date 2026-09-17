<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { musicPlayerConfig } from "@/config/musicConfig";
import { AudioAnalyzer } from "./AudioAnalyzer";
import LyricsOverlay from "./LyricsOverlay.svelte";
import ThreeScene from "./ThreeScene.svelte";
import VisualizerControls from "./VisualizerControls.svelte";
import { getColorPreset, vizSettings } from "./visualizerSettings.svelte";

const audioAnalyzer = new AudioAnalyzer();
let sceneReady = $state(false);
let backgroundColor = $state(
	musicPlayerConfig.visualizer?.background?.dark ?? "#0a0a15",
);

let rootEl: HTMLDivElement | undefined;
let accentRaf = 0;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
	const value = hex.replace("#", "");
	const num = Number.parseInt(value.length === 3 ? value.replace(/./g, "$&$&") : value, 16);
	if (Number.isNaN(num)) return [39, 226, 255];
	return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h * 12) % 12;
		return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
	};
	return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function css(rgb: Rgb, alpha: number) {
	return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// 把主题强调色同步到 CSS 变量，进度条 / 滑块 / 描边等 UI 跟随主题色。
// 多彩循环时每帧更新（只写这一个元素的行内样式，不走 Svelte 重渲染）。
function applyAccentVars(rgb: Rgb) {
	if (!rootEl) return;
	rootEl.style.setProperty("--mv-accent", css(rgb, 1));
	rootEl.style.setProperty("--mv-accent-dim", css(rgb, 0.36));
	rootEl.style.setProperty("--mv-accent-glow", css(rgb, 0.52));
}

$effect(() => {
	const preset = getColorPreset(vizSettings.presetId);
	if (!vizSettings.rainbow) {
		cancelAnimationFrame(accentRaf);
		accentRaf = 0;
		applyAccentVars(hexToRgb(preset.accent));
		return;
	}
	const start = performance.now();
	const tick = () => {
		const hue = (((performance.now() - start) / 1000) * 0.04) % 1;
		applyAccentVars(hslToRgb(hue, 0.85, 0.6));
		accentRaf = requestAnimationFrame(tick);
	};
	accentRaf = requestAnimationFrame(tick);
	return () => {
		cancelAnimationFrame(accentRaf);
		accentRaf = 0;
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
