<script lang="ts">
import Icon from "@iconify/svelte";
import { onDestroy, onMount } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	VIZ_COLOR_PRESETS,
	getColorPreset,
	persistVizSettings,
	vizSettings,
} from "./visualizerSettings.svelte";

interface Track {
	name: string;
	artist: string;
	pic?: string;
}

interface MusicState {
	track: Track | null;
	playlist: Track[];
	currentIndex: number;
	isPlaying: boolean;
	volume: number;
	isMuted: boolean;
	playMode: number;
	currentTimeStr: string;
	durationStr: string;
	progress: number;
	initialized: boolean;
}

interface FireflyMusicManager {
	getState: () => MusicState;
	init: () => void;
	togglePlay: () => void;
	playNext: () => void;
	playPrev: () => void;
	cyclePlayMode: () => void;
	toggleMute: () => void;
	setVolume: (value: number) => void;
	seek: (percent: number) => void;
	playTrackByIndex: (index: number) => void;
}

declare global {
	interface Window {
		__fireflyMusic?: FireflyMusicManager;
	}
}

const MODE_LABELS = [
	i18n(I18nKey.playModeList),
	i18n(I18nKey.playModeSingle),
	i18n(I18nKey.playModeShuffle),
];

let currentTrack: Track | null = $state(null);
let playlist: Track[] = $state([]);
let currentIndex = $state(0);
let isPlaying = $state(false);
let volume = $state(0.6);
let isMuted = $state(false);
let playMode = $state(0);
let currentTimeStr = $state("0:00");
let durationStr = $state("0:00");
let progress = $state(0);
let initialized = $state(false);
let rightPanelMode = $state<"tools" | "playlist" | "settings">("tools");
let playlistListEl: HTMLDivElement;
let isDraggingProgress = $state(false);
let isDraggingVolume = $state(false);
let progressTrackHover = $state(false);
let modeHintPulse = $state(false);
let modeHintTimer: ReturnType<typeof setTimeout> | undefined;

// Clip boundary (user units) for the accent-filled portion of the wave.
const volumePercent = $derived(Math.round((isMuted ? 0 : volume) * 100));

// 未加载（未初始化 / 无曲目）或未播放时，进度条不可拖拽
const progressDisabled = $derived(!initialized || !currentTrack || !isPlaying);

function getPercentFromPointerX(track: HTMLElement, clientX: number) {
	const rect = track.getBoundingClientRect();
	return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function getPercentFromPointerY(track: HTMLElement, clientY: number) {
	const rect = track.getBoundingClientRect();
	return Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
}

// ── Progress (seek) — shared by desktop wave + mobile timeline ──
function seekFromEvent(track: HTMLElement, clientX: number) {
	const percent = getPercentFromPointerX(track, clientX);
	progress = percent * 100;
	window.__fireflyMusic?.seek(percent);
}

function onProgressPointerDown(e: PointerEvent) {
	const track = e.currentTarget as HTMLElement;
	track.setPointerCapture(e.pointerId);
	isDraggingProgress = true;
	seekFromEvent(track, e.clientX);
}

// 桌面进度条：未加载或未播放时不可拖拽
function onDesktopProgressPointerDown(e: PointerEvent) {
	if (progressDisabled) return;
	onProgressPointerDown(e);
}

function onProgressPointerMove(e: PointerEvent) {
	if (!isDraggingProgress) return;
	seekFromEvent(e.currentTarget as HTMLElement, e.clientX);
}

function onProgressPointerUp(e: PointerEvent) {
	if (!isDraggingProgress) return;
	isDraggingProgress = false;
	if (e.currentTarget instanceof HTMLElement) {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}
}

// ── Volume (horizontal) — mobile bottom dock ──
function setVolumeFromX(track: HTMLElement, clientX: number) {
	const val = getPercentFromPointerX(track, clientX);
	volume = val;
	isMuted = false;
	window.__fireflyMusic?.setVolume(val);
}

function onVolumePointerDown(e: PointerEvent) {
	const track = e.currentTarget as HTMLElement;
	track.setPointerCapture(e.pointerId);
	isDraggingVolume = true;
	setVolumeFromX(track, e.clientX);
}

function onVolumePointerMove(e: PointerEvent) {
	if (!isDraggingVolume) return;
	setVolumeFromX(e.currentTarget as HTMLElement, e.clientX);
}

function onVolumePointerUp(e: PointerEvent) {
	if (!isDraggingVolume) return;
	isDraggingVolume = false;
	if (e.currentTarget instanceof HTMLElement) {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}
}

// ── Volume (vertical) — desktop hover popover ──
function setVolumeFromY(track: HTMLElement, clientY: number) {
	const val = getPercentFromPointerY(track, clientY);
	volume = val;
	isMuted = false;
	window.__fireflyMusic?.setVolume(val);
}

function onVolumeVPointerDown(e: PointerEvent) {
	const track = e.currentTarget as HTMLElement;
	track.setPointerCapture(e.pointerId);
	isDraggingVolume = true;
	setVolumeFromY(track, e.clientY);
}

function onVolumeVPointerMove(e: PointerEvent) {
	if (!isDraggingVolume) return;
	setVolumeFromY(e.currentTarget as HTMLElement, e.clientY);
}

function onVolumeVPointerUp(e: PointerEvent) {
	if (!isDraggingVolume) return;
	isDraggingVolume = false;
	if (e.currentTarget instanceof HTMLElement) {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}
}

function syncPlaylistScroll() {
	if (!playlistListEl || rightPanelMode !== "playlist") return;

	const activeItem = playlistListEl.querySelector<HTMLElement>(
		".music-visualizer__playlist-item--active",
	);
	activeItem?.scrollIntoView({
		block: "center",
		behavior: "smooth",
	});
}

function togglePlay() {
	window.__fireflyMusic?.togglePlay();
}

function playNext() {
	window.__fireflyMusic?.playNext();
}

function playPrev() {
	window.__fireflyMusic?.playPrev();
}

function cycleMode() {
	// cyclePlayMode emits `fm:mode` synchronously, so `playMode` is already the
	// new value by the time this returns — flash the hint for what it became.
	window.__fireflyMusic?.cyclePlayMode();
	flashModeHint();
}

function flashModeHint() {
	modeHintPulse = true;
	clearTimeout(modeHintTimer);
	modeHintTimer = setTimeout(() => {
		modeHintPulse = false;
	}, 1600);
}

function toggleMute() {
	window.__fireflyMusic?.toggleMute();
}

function playTrack(index: number) {
	window.__fireflyMusic?.playTrackByIndex(index);
}

function openPlaylist() {
	rightPanelMode = "playlist";
	setTimeout(syncPlaylistScroll, 0);
}

function togglePlaylist() {
	rightPanelMode = rightPanelMode === "playlist" ? "tools" : "playlist";
	if (rightPanelMode === "playlist") {
		setTimeout(syncPlaylistScroll, 0);
	}
}

function openSettings() {
	rightPanelMode = "settings";
}

function toggleSettings() {
	rightPanelMode = rightPanelMode === "settings" ? "tools" : "settings";
}

function selectColorPreset(id: string) {
	vizSettings.presetId = id;
	persistVizSettings();
}

function onIntensityInput(e: Event) {
	const value = (e.currentTarget as HTMLInputElement).valueAsNumber;
	vizSettings.intensity = Number.isFinite(value) ? value : 1;
	persistVizSettings();
}

function toggleRainbow() {
	vizSettings.rainbow = !vizSettings.rainbow;
	persistVizSettings();
}

// 设置面板强度滑块的展示值（百分比）
const intensityPercent = $derived(Math.round(vizSettings.intensity * 100));

function syncState() {
	const mgr = window.__fireflyMusic;
	if (!mgr) return;
	const state = mgr.getState();
	currentTrack = state.track;
	playlist = state.playlist || [];
	currentIndex = state.currentIndex || 0;
	isPlaying = state.isPlaying;
	volume = state.volume;
	isMuted = state.isMuted;
	playMode = state.playMode;
	currentTimeStr = state.currentTimeStr;
	durationStr = state.durationStr;
	progress = state.progress;
	initialized = state.initialized;
	setTimeout(syncPlaylistScroll, 0);
}

function onInit() {
	syncState();
}

function onTrack(e: CustomEvent) {
	currentTrack = e.detail.track;
	currentIndex = e.detail.index;
	progress = 0;
	currentTimeStr = "0:00";
	durationStr = "0:00";
	setTimeout(syncPlaylistScroll, 0);
}

function onPlayState(e: CustomEvent) {
	isPlaying = e.detail.isPlaying;
}

function onTime(e: CustomEvent) {
	if (isDraggingProgress) return;
	currentTimeStr = e.detail.currentTimeStr;
	durationStr = e.detail.durationStr;
	progress = e.detail.progress;
}

function onVolume(e: CustomEvent) {
	if (isDraggingVolume) return;
	volume = e.detail.volume;
	isMuted = e.detail.isMuted;
}

function onMode(e: CustomEvent) {
	playMode = e.detail.playMode;
}

onMount(() => {
	const mgr = window.__fireflyMusic;
	if (mgr && !mgr.getState().initialized) {
		mgr.init();
	}

	setTimeout(syncState, 100);

	window.addEventListener("fm:init", onInit);
	window.addEventListener("fm:track", onTrack as EventListener);
	window.addEventListener("fm:play-state", onPlayState as EventListener);
	window.addEventListener("fm:time", onTime as EventListener);
	window.addEventListener("fm:volume", onVolume as EventListener);
	window.addEventListener("fm:mode", onMode as EventListener);
});

onDestroy(() => {
	clearTimeout(modeHintTimer);
	window.removeEventListener("fm:init", onInit);
	window.removeEventListener("fm:track", onTrack as EventListener);
	window.removeEventListener("fm:play-state", onPlayState as EventListener);
	window.removeEventListener("fm:time", onTime as EventListener);
	window.removeEventListener("fm:volume", onVolume as EventListener);
	window.removeEventListener("fm:mode", onMode as EventListener);
});
</script>

<div class="music-visualizer__side-panel" data-panel-mode={rightPanelMode}>
	<div class="music-visualizer__divider-meta" aria-label={i18n(I18nKey.currentTrack)}>
		<span class="music-visualizer__divider-title">
			{currentTrack?.name || i18n(I18nKey.musicNoPlaying)}
		</span>
		<span class="music-visualizer__divider-artist">
			{currentTrack?.artist || "—"}
		</span>
	</div>
	{#if rightPanelMode === "tools"}
		<section class="music-visualizer__card" aria-label={i18n(I18nKey.musicPlayerLabel)}>
			<!-- 层 1 · 胶片旋转动效（点击跳转歌单） -->
			<button
				type="button"
				class="music-visualizer__record"
				class:music-visualizer__record--playing={isPlaying}
				class:music-visualizer__record--loading={!initialized}
				onclick={openPlaylist}
				title={i18n(I18nKey.viewPlaylist)}
				aria-label={i18n(I18nKey.viewPlaylist)}
				aria-controls="music-visualizer-playlist-panel"
			>
				<span class="music-visualizer__record-disc-shell" aria-hidden="true">
					<span class="music-visualizer__record-disc">
						<span class="music-visualizer__record-grooves"></span>
						<span class="music-visualizer__record-label">
							{#if currentTrack?.pic}
								<img
									class="music-visualizer__record-image"
									src={currentTrack.pic}
									alt=""
								/>
							{:else}
								<span class="music-visualizer__record-placeholder">
									<Icon icon="material-symbols:music-note-rounded" size="2xl" />
								</span>
							{/if}
						</span>
						<span class="music-visualizer__record-hole"></span>
						<span class="music-visualizer__record-shine"></span>
					</span>
				</span>
				<span class="music-visualizer__record-cover">
					{#if currentTrack?.pic}
						<img class="music-visualizer__record-cover-image" src={currentTrack.pic} alt="" />
					{:else}
						<span class="music-visualizer__record-cover-placeholder">
							<Icon icon="material-symbols:music-note-rounded" size="2xl" />
						</span>
					{/if}
				</span>
				<span class="music-visualizer__record-overlay" aria-hidden="true">
					<Icon icon="material-symbols:queue-music-rounded" size="2xl" />
					<span class="music-visualizer__record-overlay-text">{i18n(I18nKey.musicPlaylist)}</span>
				</span>
			</button>

			<!-- 移动端保留：曲目标题（桌面隐藏） -->
			<div class="music-visualizer__mobile-track">
				<span class="music-visualizer__record-title">
					{currentTrack?.name || i18n(I18nKey.musicNoPlaying)}
				</span>
			</div>

			<!-- 层 2 · 进度条（桌面） -->
			<div class="music-visualizer__progress-block">
				<span class="music-visualizer__progress-time">{currentTimeStr}</span>
				<div
					class="music-visualizer__progress-track"
					class:is-hover={progressTrackHover}
					class:is-dragging={isDraggingProgress}
					class:is-disabled={progressDisabled}
					class:is-playing={isPlaying}
					style={`--mv-progress: ${progress}%`}
					onpointerdown={onDesktopProgressPointerDown}
					onpointermove={onProgressPointerMove}
					onpointerup={onProgressPointerUp}
					onpointercancel={onProgressPointerUp}
					onmouseenter={() => (progressTrackHover = true)}
					onmouseleave={() => (progressTrackHover = false)}
					role="slider"
					tabindex="0"
					aria-label={i18n(I18nKey.musicProgress)}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(progress)}
					aria-disabled={progressDisabled}
				>
					<div class="music-visualizer__progress-rail">
						<div class="music-visualizer__progress-aurora"></div>
					</div>
					<div
						class="music-visualizer__progress-thumb"
						style={`left: ${progress}%`}
					></div>
				</div>
				<span class="music-visualizer__progress-time">{durationStr}</span>
			</div>

			<!-- 层 3 · 工具栏（桌面） -->
			<div class="music-visualizer__toolbar" aria-label={i18n(I18nKey.playbackControls)}>
				<div class="music-visualizer__tool-wrap" role="group">
					<span
						class="music-visualizer__tool-hint"
						class:is-visible={modeHintPulse}
						aria-hidden="true"
					>
						{MODE_LABELS[playMode]}
					</span>
					<button
						type="button"
						class="music-visualizer__tool-btn"
						class:is-active={playMode !== 0}
						onclick={cycleMode}
						title={MODE_LABELS[playMode]}
						aria-label={MODE_LABELS[playMode]}
					>
						{#if playMode === 0}
							<Icon icon="material-symbols:repeat-rounded" size="lg" />
						{:else if playMode === 1}
							<Icon icon="material-symbols:repeat-one-rounded" size="lg" />
						{:else}
							<Icon icon="material-symbols:shuffle-rounded" size="lg" />
						{/if}
					</button>
				</div>

				<button
					type="button"
					class="music-visualizer__tool-btn"
					onclick={playPrev}
					title={i18n(I18nKey.musicPrev)}
					aria-label={i18n(I18nKey.musicPrev)}
				>
					<Icon icon="material-symbols:skip-previous-rounded" size="xl" />
				</button>

				<button
					type="button"
					class="music-visualizer__tool-btn music-visualizer__tool-btn--play"
					onclick={togglePlay}
					title={isPlaying ? i18n(I18nKey.musicPause) : i18n(I18nKey.musicPlay)}
					aria-label={isPlaying ? i18n(I18nKey.musicPause) : i18n(I18nKey.musicPlay)}
				>
					{#if isPlaying}
						<Icon icon="material-symbols:pause-rounded" size="2xl" />
					{:else}
						<Icon icon="material-symbols:play-arrow-rounded" size="2xl" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__tool-btn"
					onclick={playNext}
					title={i18n(I18nKey.musicNext)}
					aria-label={i18n(I18nKey.musicNext)}
				>
					<Icon icon="material-symbols:skip-next-rounded" size="xl" />
				</button>

				<div
					class="music-visualizer__tool-wrap music-visualizer__volume-wrap"
					role="group"
				>
					<div
						class="music-visualizer__volume-pop"
						class:is-visible={isDraggingVolume}
					>
						<span class="music-visualizer__volume-value">{volumePercent}</span>
						<div
							class="music-visualizer__volume-vtrack"
							class:is-dragging={isDraggingVolume}
							onpointerdown={onVolumeVPointerDown}
							onpointermove={onVolumeVPointerMove}
							onpointerup={onVolumeVPointerUp}
							onpointercancel={onVolumeVPointerUp}
							role="slider"
							tabindex="0"
							aria-label={i18n(I18nKey.musicVolume)}
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={volumePercent}
						>
							<div class="music-visualizer__volume-vrail"></div>
							<div
								class="music-visualizer__volume-vfill"
								style={`height: ${volumePercent}%`}
							></div>
							<div
								class="music-visualizer__volume-vthumb"
								style={`bottom: ${volumePercent}%`}
							></div>
						</div>
					</div>
					<button
						type="button"
						class="music-visualizer__tool-btn"
						onclick={toggleMute}
						title={i18n(I18nKey.musicVolume)}
						aria-label={i18n(I18nKey.musicVolume)}
					>
						{#if isMuted || volume === 0}
							<Icon icon="material-symbols:volume-off-rounded" size="lg" />
						{:else}
							<Icon icon="material-symbols:volume-up-rounded" size="lg" />
						{/if}
					</button>
				</div>

				<button
					type="button"
					class="music-visualizer__tool-btn"
					class:is-active={rightPanelMode === "settings"}
					onclick={toggleSettings}
					title={i18n(I18nKey.vizSettings)}
					aria-label={i18n(I18nKey.vizSettings)}
					aria-expanded={rightPanelMode === "settings"}
				>
					<Icon icon="material-symbols:tune-rounded" size="lg" />
				</button>
			</div>

			<!-- 移动端保留：紧凑工具行（桌面隐藏） -->
				<div class="music-visualizer__tool-row">
				<button
					type="button"
					class="music-visualizer__btn music-visualizer__btn--mobile-play"
					onclick={togglePlay}
					title={isPlaying ? i18n(I18nKey.musicPause) : i18n(I18nKey.musicPlay)}
					aria-label={isPlaying ? i18n(I18nKey.musicPause) : i18n(I18nKey.musicPlay)}
				>
					{#if isPlaying}
						<Icon icon="material-symbols:pause-rounded" size="lg" />
					{:else}
						<Icon icon="material-symbols:play-arrow-rounded" size="lg" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={cycleMode}
					title={i18n(I18nKey.musicPlayMode)}
					aria-label={i18n(I18nKey.musicPlayMode)}
				>
					{#if playMode === 0}
						<Icon icon="material-symbols:repeat-rounded" size="md" />
					{:else if playMode === 1}
						<Icon icon="material-symbols:repeat-one-rounded" size="md" />
					{:else}
						<Icon icon="material-symbols:shuffle-rounded" size="md" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={togglePlaylist}
					title={i18n(I18nKey.musicPlaylist)}
					aria-label={i18n(I18nKey.musicPlaylist)}
					aria-controls="music-visualizer-playlist-panel"
					aria-expanded={rightPanelMode === "playlist"}
				>
					<Icon icon="material-symbols:queue-music-rounded" size="md" />
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={toggleMute}
					title={i18n(I18nKey.musicVolume)}
					aria-label={i18n(I18nKey.musicVolume)}
				>
					{#if isMuted || volume === 0}
						<Icon icon="material-symbols:volume-off-rounded" size="md" />
					{:else}
						<Icon icon="material-symbols:volume-up-rounded" size="md" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					class:music-visualizer__btn--active={rightPanelMode === "settings"}
					onclick={openSettings}
					title={i18n(I18nKey.vizSettings)}
					aria-label={i18n(I18nKey.vizSettings)}
					aria-expanded={rightPanelMode === "settings"}
				>
					<Icon icon="material-symbols:tune-rounded" size="md" />
				</button>
				</div>
			</section>
		{:else if rightPanelMode === "settings"}
			<aside
				id="music-visualizer-settings-panel"
				class="music-visualizer__settings-view"
				aria-label={i18n(I18nKey.vizSettings)}
			>
				<div class="music-visualizer__settings-stage">
					<div class="music-visualizer__settings-header">
						<div>
							<div class="music-visualizer__settings-kicker">VISUALIZER</div>
							<div class="music-visualizer__settings-title">
								{i18n(I18nKey.vizSettings)}
							</div>
						</div>
						<button
							type="button"
							class="music-visualizer__playlist-back"
							onclick={toggleSettings}
							title={i18n(I18nKey.backToPlayer)}
							aria-label={i18n(I18nKey.backToPlayer)}
							aria-controls="music-visualizer-settings-panel"
							aria-expanded={rightPanelMode === "settings"}
						>
							<Icon icon="material-symbols:close-rounded" size="md" />
						</button>
					</div>

					<!-- 律动强度 -->
					<section class="music-visualizer__settings-group">
						<div class="music-visualizer__settings-row-head">
							<span class="music-visualizer__settings-label">
								{i18n(I18nKey.vizIntensity)}
							</span>
							<span class="music-visualizer__settings-value">{intensityPercent}%</span>
						</div>
						<input
							class="music-visualizer__settings-slider"
							type="range"
							min="0"
							max="2.5"
							step="0.05"
							value={vizSettings.intensity}
							style={`--mv-fill: ${(vizSettings.intensity / 2.5) * 100}%`}
							oninput={onIntensityInput}
							onchange={persistVizSettings}
							aria-label={i18n(I18nKey.vizIntensity)}
							aria-valuemin="0"
							aria-valuemax="250"
							aria-valuenow={intensityPercent}
						/>
					</section>

					<!-- 主题颜色 -->
					<section class="music-visualizer__settings-group">
						<div class="music-visualizer__settings-row-head">
							<span class="music-visualizer__settings-label">
								{i18n(I18nKey.vizThemeColor)}
							</span>
							<span class="music-visualizer__settings-value">
								{vizSettings.rainbow ? i18n(I18nKey.vizRainbow) : getColorPreset(vizSettings.presetId).label}
							</span>
						</div>
						<div
							class="music-visualizer__settings-swatches"
							role="radiogroup"
							aria-label={i18n(I18nKey.vizThemeColor)}
						>
							{#each VIZ_COLOR_PRESETS as preset (preset.id)}
								<button
									type="button"
									class="music-visualizer__swatch"
									class:is-selected={vizSettings.presetId === preset.id &&
										!vizSettings.rainbow}
									style={`--swatch-a: ${preset.coolCore}; --swatch-b: ${preset.accent}; --swatch-c: ${preset.warmEdge};`}
									onclick={() => selectColorPreset(preset.id)}
									role="radio"
									aria-checked={vizSettings.presetId === preset.id && !vizSettings.rainbow}
									aria-label={preset.label}
									title={preset.label}
								></button>
							{/each}
						</div>
					</section>

					<!-- 多彩循环 -->
					<section
						class="music-visualizer__settings-group music-visualizer__settings-group--row"
					>
						<div class="music-visualizer__settings-row-text">
							<div class="music-visualizer__settings-label">
								{i18n(I18nKey.vizRainbow)}
							</div>
							<div class="music-visualizer__settings-hint">
								{i18n(I18nKey.vizRainbowHint)}
							</div>
						</div>
						<button
							type="button"
							class="music-visualizer__switch"
							class:is-on={vizSettings.rainbow}
							role="switch"
							aria-checked={vizSettings.rainbow}
							aria-label={i18n(I18nKey.vizRainbow)}
							onclick={toggleRainbow}
						>
							<span class="music-visualizer__switch-thumb" aria-hidden="true"></span>
						</button>
					</section>
				</div>
			</aside>
		{:else}
		<aside
			id="music-visualizer-playlist-panel"
			class="music-visualizer__playlist-view"
			aria-label={i18n(I18nKey.playlistSwitch)}
		>
			<div class="music-visualizer__playlist-stage">
				<div class="music-visualizer__playlist-timeline"></div>
				<div class="music-visualizer__playlist-header">
					<div>
						<div class="music-visualizer__playlist-kicker">PLAYLIST</div>
						<div class="music-visualizer__playlist-title">{i18n(I18nKey.playlistSwitch)}</div>
					</div>
					<div class="music-visualizer__playlist-count">{playlist.length}</div>
					<button
						type="button"
						class="music-visualizer__playlist-back"
						onclick={togglePlaylist}
						title={i18n(I18nKey.backToPlayer)}
						aria-label={i18n(I18nKey.backToPlayer)}
						aria-controls="music-visualizer-playlist-panel"
						aria-expanded={rightPanelMode === "playlist"}
					>
						<Icon icon="material-symbols:close-rounded" size="md" />
					</button>
				</div>

				<div
					bind:this={playlistListEl}
					class="music-visualizer__playlist-list"
					role="listbox"
					aria-label={i18n(I18nKey.currentPlaylist)}
				>
					{#if playlist.length === 0}
						<div class="music-visualizer__playlist-empty">{i18n(I18nKey.playlistLoading)}</div>
					{:else}
						{#each playlist as track, i}
							<button
								type="button"
								class="music-visualizer__playlist-item"
								class:music-visualizer__playlist-item--active={i === currentIndex}
								onclick={() => playTrack(i)}
								role="option"
								aria-selected={i === currentIndex}
								title={`${track.name} - ${track.artist}`}
							>
								<div class="music-visualizer__playlist-cover">
									{#if track.pic}
										<img src={track.pic} alt="" loading="lazy" />
									{:else}
										<Icon icon="material-symbols:music-note-rounded" size="sm" />
									{/if}
								</div>
								<div class="music-visualizer__playlist-meta">
									<div class="music-visualizer__playlist-name">{track.name}</div>
									<div class="music-visualizer__playlist-artist">
										{track.artist}
									</div>
								</div>
								{#if i === currentIndex}
									<div class="music-visualizer__playlist-eq" aria-hidden="true">
										<span></span>
										<span></span>
										<span></span>
									</div>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</aside>
	{/if}
</div>

<!-- 移动端保留：底部播放控制条（桌面隐藏） -->
<div class="music-visualizer__bottom-dock" aria-label={i18n(I18nKey.playbackControls)}>
	<div class="music-visualizer__bottom-dock-inner">
		<button
			type="button"
			class="music-visualizer__transport-btn"
			onclick={playPrev}
			title={i18n(I18nKey.musicPrev)}
			aria-label={i18n(I18nKey.musicPrev)}
		>
			<Icon icon="material-symbols:skip-previous-rounded" size="xl" />
		</button>

		<div class="music-visualizer__timeline-block">
			<span class="music-visualizer__time">{currentTimeStr}</span>
			<div
				class="music-visualizer__timeline-track"
				class:is-hover={progressTrackHover}
				class:is-dragging={isDraggingProgress}
				onpointerdown={onProgressPointerDown}
				onpointermove={onProgressPointerMove}
				onpointerup={onProgressPointerUp}
				onpointercancel={onProgressPointerUp}
				role="slider"
				aria-label={i18n(I18nKey.musicProgress)}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress)}
			>
				<div class="music-visualizer__timeline-rail"></div>
				<div
					class="music-visualizer__timeline-fill"
					style={`width: ${progress}%`}
				></div>
				<div
					class="music-visualizer__timeline-thumb"
					style={`left: ${progress}%`}
				></div>
			</div>
			<span class="music-visualizer__time">{durationStr}</span>
		</div>

		<button
			type="button"
			class="music-visualizer__transport-btn"
			onclick={playNext}
			title={i18n(I18nKey.musicNext)}
			aria-label={i18n(I18nKey.musicNext)}
		>
			<Icon icon="material-symbols:skip-next-rounded" size="xl" />
		</button>
	</div>
</div>
