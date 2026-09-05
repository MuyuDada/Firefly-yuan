<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { musicPlayerConfig } from "@/config/musicConfig";
import { AudioAnalyzer } from "./AudioAnalyzer";
import LyricsOverlay from "./LyricsOverlay.svelte";
import ThreeScene from "./ThreeScene.svelte";
import VisualizerControls from "./VisualizerControls.svelte";

const audioAnalyzer = new AudioAnalyzer();
let sceneReady = $state(false);
let backgroundColor = $state(
	musicPlayerConfig.visualizer?.background?.dark ?? "#0a0a15",
);

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

	const handleFirstClick = () => {
		audioAnalyzer.resume();
		document.removeEventListener("click", handleFirstClick);
	};
	document.addEventListener("click", handleFirstClick);

	return () => {
		document.removeEventListener("click", handleFirstClick);
	};
});

onDestroy(() => {
	audioAnalyzer.disconnect();
});
</script>

<div class="music-visualizer" style={`background: ${backgroundColor};`}>
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
