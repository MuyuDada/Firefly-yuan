<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { SONNET_PARAGRAPH_GAP, vizSettings } from "./visualizerSettings.svelte";

interface LyricLine {
	time: number;
	text: string;
}

type LyricStatus = "loading" | "loaded" | "none" | "failed";

let containerEl: HTMLDivElement;
let trackEl: HTMLDivElement;
let lyrics: LyricLine[] = $state([]);
let currentIndex = $state(-1);
let lyricsStatus = $state<LyricStatus>("loading");
let offsetY = $state(0);
let statusLabels = $state({
	loading: i18n(I18nKey.musicLoadingLyrics),
	none: i18n(I18nKey.musicNoLyrics),
	failed: i18n(I18nKey.musicFailedLyrics),
});

const statusText = $derived(
	lyricsStatus === "failed"
		? statusLabels.failed
		: lyricsStatus === "none"
			? statusLabels.none
			: statusLabels.loading,
);
const hasLyrics = $derived(lyrics.length > 0);
const isPlaybackActive = $derived(currentIndex >= 0);
const visibleLyrics = $derived(lyrics.map((line, index) => ({ line, index })));

// 商籁模式才需要重排当前行。其余模式直接用整行文本，避免无谓的切词开销。
const isSonnet = $derived(vizSettings.lyricMode === "sonnet");

// 当前行的词级排版：只在 sonnet 且正在播放时计算，行不变就不重算。
const sonnetLayoutForActive = $derived.by(() => {
	if (!isSonnet || currentIndex < 0) return null;
	const line = lyrics[currentIndex];
	if (!line) return null;
	const next = lyrics[currentIndex + 1];
	const duration = next && next.time > line.time ? next.time - line.time : 2.4;
	return sonnetLayout(line.text, duration, 3.6);
});

// 段落转场：当前行与上一行间隔超过阈值时，视为换段，给这一行补一次
// 模糊 + 错位的入场（对应 Folia 的 transitionBlurScale / transitionGlitchScale）。
const isParagraphTurn = $derived.by(() => {
	if (!isSonnet || currentIndex <= 0) return false;
	const prev = lyrics[currentIndex - 1];
	const current = lyrics[currentIndex];
	if (!prev || !current) return false;
	return current.time - prev.time > SONNET_PARAGRAPH_GAP;
});

// 将文本拆分为单个字符（保留空格），用于逐字发光
function splitChars(text: string): string[] {
	return Array.from(text);
}

// ── 商籁（Sonnet）排版 ────────────────────────────────────────────
// Folia 的商籁是一个完整的文字 PV 导演程序（Pixi/WebGL，55 个文件 ~488KB），
// 不可能整体搬过来。这里只取它最核心的三件事，用纯 CSS 复刻观感：
//   1. 把当前行按词切开，挑一个「主词」放大到最大字号，再挑 0~2 个「半主词」；
//   2. 词与词错开入场，主词最后落定，整行叠上红/青色差与重影；
//   3. 段落交界处（行间隔超过 SONNET_PARAGRAPH_GAP）补一次模糊 + 错位的转场。
// 已知限制：LRC 只有行级时间戳，词级时间是按字数等分合成的近似值，
// 所以是「跟着这一行走」而不是「跟着唱词逐字走」。

// CJK 判断：平假名 / 片假名 / 汉字扩展 A / 基本汉字 / 兼容汉字
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// 切词：拉丁文按空白切，CJK 没有词边界，退化成「两字一组」的近似分词。
// 空白本身也作为独立 token 保留，这样重排后词间空格不会丢。
function splitWords(text: string): string[] {
	const words: string[] = [];
	let buffer = "";

	const flush = () => {
		if (buffer) {
			words.push(buffer);
			buffer = "";
		}
	};

	for (const ch of Array.from(text)) {
		if (/\s/.test(ch)) {
			flush();
			words.push(ch);
			continue;
		}
		if (CJK_RE.test(ch)) {
			flush();
			const prev = words[words.length - 1];
			// 连续 CJK 每两个字并成一个词：整行只剩一个字当主词会很难看
			if (prev && prev.length < 2 && CJK_RE.test(prev)) {
				words[words.length - 1] = prev + ch;
			} else {
				words.push(ch);
			}
			continue;
		}
		buffer += ch;
	}
	flush();
	return words;
}

interface SonnetWord {
	text: string;
	start: number;
	duration: number;
	// 词内逐字步长：由词时长摊出来，短词不会拖得比词本身还长
	charStep: number;
}

interface SonnetLayout {
	words: SonnetWord[];
	heroIndex: number;
	semiHeroIndices: number[];
}

// 主词评分：越长的词、占时越久的词得分越高（对应 Folia 的
// scoreSonnetHeroSegment：lengthScore + durationScore）。
function sonnetWordScore(word: SonnetWord): number {
	const visibleLength = word.text.trim().length;
	if (visibleLength === 0) return -1;
	return Math.min(visibleLength, 8) * 14 + Math.min(2.5, word.duration) * 18;
}

// 中文经 splitWords 切完后几乎全是等长等时的两字词，单看得分永远平手，
// 直接取第一个会让整行「开头大、后面越来越小」，很像排版坏了。
// 所以得分持平时再按位置挑：越靠近整行 60% 处越优先，
// 既不会顶在行首，也不会贴到行尾（对应 Folia 把 hero 放在视觉重心上的做法）。
const HERO_POSITION_BIAS = 0.6;

function sonnetHeroIndex(words: SonnetWord[]): number {
	let best = -Infinity;
	for (const word of words) {
		const score = sonnetWordScore(word);
		if (score > best) best = score;
	}
	if (best <= 0) return -1;

	const candidates: number[] = [];
	words.forEach((word, index) => {
		// 5% 以内都算平手，交给位置决定
		if (sonnetWordScore(word) >= best * 0.95) candidates.push(index);
	});
	if (candidates.length === 0) return -1;

	const denominator = Math.max(1, words.length - 1);
	let heroIndex = candidates[0];
	let heroDistance = Infinity;
	for (const index of candidates) {
		const distance = Math.abs(index / denominator - HERO_POSITION_BIAS);
		if (distance < heroDistance) {
			heroDistance = distance;
			heroIndex = index;
		}
	}
	return heroIndex;
}

function sonnetLayout(
	text: string,
	lineDuration: number,
	spreadCap: number,
): SonnetLayout | null {
	const tokens = splitWords(text);
	const visibleTokens = tokens.filter((token) => token.trim().length > 0);
	if (visibleTokens.length === 0) return null;

	const totalChars =
		visibleTokens.reduce((sum, token) => sum + token.length, 0) || 1;

	// 词级时间：按字数等分整行时长（LRC 只有行级时间，这是近似）。
	// 间奏会让 lineDuration 变成几十秒，直接照搬会让最后一个词等到天荒地老，
	// 所以整条时间轴按 spreadCap 等比压缩到几秒内走完。
	const rawTotal = tokens.reduce(
		(sum, token) => sum + (token.length / totalChars) * lineDuration,
		0,
	);
	const scale = rawTotal > spreadCap && rawTotal > 0 ? spreadCap / rawTotal : 1;

	let cursor = 0;
	const words: SonnetWord[] = tokens.map((token) => {
		const duration = (token.length / totalChars) * lineDuration;
		// 词内逐字：整词亮完的时间不超过词自身时长的一半，保证下一个词能接上
		const charCount = Math.max(1, Array.from(token).length);
		const charStep = Math.min(0.05, (duration * 0.5) / charCount);
		const word = {
			text: token,
			start: cursor * scale,
			duration,
			charStep,
		};
		cursor += duration;
		return word;
	});

	const heroIndex = sonnetHeroIndex(words);
	if (heroIndex < 0) return null;
	const heroScore = sonnetWordScore(words[heroIndex]);

	// 半主词：只有够长的行才有，必须与主词隔开，避免强调挤成一团。
	// 阈值与 Folia 一致：主词得分的 35%，且本身至少 2 个字。
	const wordLikeCount = visibleTokens.length;
	const semiHeroIndices: number[] = [];
	if (wordLikeCount >= 5) {
		const threshold = heroScore * 0.35;
		words.forEach((word, index) => {
			if (index === heroIndex) return;
			// 紧邻主词的位置留白，否则放大后会连成一大坨
			if (Math.abs(index - heroIndex) < 2) return;
			if (word.text.trim().length < 2) return;
			if (sonnetWordScore(word) < threshold) return;
			semiHeroIndices.push(index);
		});
		// 离主词越远的越优先，最多两个（长行才给两个），
		// 免得整行被均匀地放大成「波浪」而不是「重音」
		semiHeroIndices.sort(
			(a, b) => Math.abs(b - heroIndex) - Math.abs(a - heroIndex),
		);
		semiHeroIndices.length = Math.min(
			semiHeroIndices.length,
			wordLikeCount >= 10 ? 2 : 1,
		);
		semiHeroIndices.sort((a, b) => a - b);
	}

	return { words, heroIndex, semiHeroIndices };
}

// 让最后一个字的发光在下一行开始前完成，避免歌词切行时扫词被截断。
// 四种歌词动画共用这套时间轴，只在错开步长与发光时长上取值不同：
// scan 均匀扫词、flow 缓慢重叠成波、breathe 整行同时呼吸、cascade 快速落下。
function charTiming(text: string) {
	const count = Array.from(text).length;
	const mode = vizSettings.lyricMode;
	if (count <= 0 || currentIndex < 0 || !lyrics[currentIndex]) {
		return { step: 0, glowDuration: 0.42 };
	}

	const current = lyrics[currentIndex];
	const next = lyrics[currentIndex + 1];
	const duration =
		next && next.time > current.time ? next.time - current.time : 2.4;
	const span = Math.max(1, count - 1);

	let glowDuration: number;
	let step: number;
	let maxSweep: number;

	switch (mode) {
		case "flow":
			// 发光时长与整行等长，字与字相互重叠，形成持续流动的光带
			glowDuration = Math.min(1.1, Math.max(0.42, duration * 0.72));
			step = Math.max(0, (duration * 0.8 - glowDuration * 0.5) / span);
			maxSweep = 3;
			break;
		case "breathe":
			// 整行一起明灭，没有先后
			glowDuration = Math.min(1.8, Math.max(0.8, duration * 0.85));
			step = 0;
			maxSweep = 0;
			break;
		case "cascade":
			// 更短更快的逐个点亮，配合 CSS 的下落位移
			glowDuration = Math.min(0.34, Math.max(0.12, duration * 0.24));
			step = Math.max(0, (duration * 0.62 - glowDuration) / span);
			maxSweep = 1.6;
			break;
		case "sonnet":
			// 商籁按「词」而不是「字」推进，逐字延迟由 sonnetLayout() 的
			// word.start + word.charStep 给出，这里只需要更长的单字发光时长。
			glowDuration = Math.min(0.72, Math.max(0.3, duration * 0.5));
			step = Math.max(0, (duration * 0.78 - glowDuration) / span);
			maxSweep = 3.6;
			break;
		default:
			glowDuration = Math.min(0.42, Math.max(0.14, duration * 0.35));
			step = Math.max(0, (duration - glowDuration) / span);
			maxSweep = 2.4;
			break;
	}

	// 间奏会让 duration 变得极大（几十秒），按比例算出的步长会让整行扫上十几秒，
	// 看起来像卡住不动。这里给整行的错开总时长封顶，保证一次扫词总在几秒内走完。
	if (maxSweep > 0 && step * span > maxSweep) {
		step = maxSweep / span;
	}

	return { step, glowDuration };
}

function syncLyricOffset() {
	if (!containerEl || !trackEl || lyrics.length === 0) {
		offsetY = 0;
		return;
	}

	const nextIndex = currentIndex >= 0 ? currentIndex : 0;
	const activeEl = trackEl.querySelector<HTMLElement>(
		`[data-lyric-index="${nextIndex}"]`,
	);
	if (!activeEl) return;

	const lyricCenter = activeEl.offsetTop + activeEl.offsetHeight / 2;
	const targetCenter =
		containerEl.clientHeight * (currentIndex >= 0 ? 0.42 : 0.58);
	offsetY = targetCenter - lyricCenter;
}

async function queueLyricOffset() {
	await tick();
	syncLyricOffset();
}

function onLyrics(e: CustomEvent) {
	lyrics = e.detail.lyrics || [];
	lyricsStatus = e.detail.status || (lyrics.length > 0 ? "loaded" : "none");
	currentIndex = -1;
	void queueLyricOffset();
}

function onLrcIndex(e: CustomEvent) {
	currentIndex = e.detail.index;
	void queueLyricOffset();
}

onMount(() => {
	const mgr = window.__fireflyMusic;
	if (mgr) {
		const state = mgr.getState();
		lyrics = state.lyrics || [];
		currentIndex = state.currentLrcIndex;
		statusLabels = {
			loading: state.config?.i18n?.loadingLyrics || statusLabels.loading,
			none: state.config?.i18n?.noLyrics || statusLabels.none,
			failed: state.config?.i18n?.failedLyrics || statusLabels.failed,
		};
		lyricsStatus =
			state.lyricsStatus || (lyrics.length > 0 ? "loaded" : "loading");
	}
	void queueLyricOffset();

	window.addEventListener("fm:lyrics", onLyrics as EventListener);
	window.addEventListener("fm:lrc-index", onLrcIndex as EventListener);
});

onDestroy(() => {
	window.removeEventListener("fm:lyrics", onLyrics as EventListener);
	window.removeEventListener("fm:lrc-index", onLrcIndex as EventListener);
});
</script>

<div
	bind:this={containerEl}
	class="music-visualizer__lyrics"
	class:music-visualizer__lyrics--playing={isPlaybackActive}
	data-lyric-mode={vizSettings.lyricMode}
>
	<div class="music-visualizer__lyrics-stage">
		{#if hasLyrics}
		<div
			bind:this={trackEl}
			class="music-visualizer__lyrics-inner"
			style={`transform: translateY(${offsetY}px)`}
		>
			{#each visibleLyrics as entry (entry.index)}
				{@const line = entry.line}
				{@const index = entry.index}
			<div
				class="music-visualizer__lyric-line"
				class:music-visualizer__lyric-line--active={index === currentIndex}
				class:music-visualizer__lyric-line--past={index < currentIndex}
				class:music-visualizer__lyric-line--turn={index === currentIndex && isParagraphTurn}
				data-lyric-index={index}
			>
				{#if index <= currentIndex}
					{@const timing = index === currentIndex ? charTiming(line.text) : null}
					{#if index === currentIndex && sonnetLayoutForActive}
						{@const layout = sonnetLayoutForActive}
						<span
							class="music-visualizer__lyric-text music-visualizer__lyric-text--ktv music-visualizer__lyric-text--sonnet"
						>
							{#each layout.words as word, wi}
								<span
									class="music-visualizer__lyric-word"
									class:music-visualizer__lyric-word--hero={wi === layout.heroIndex}
									class:music-visualizer__lyric-word--semi={layout.semiHeroIndices.includes(wi)}
								>
									{#each splitChars(word.text) as char, j}
										<span
											class="music-visualizer__lyric-char"
											style={timing
												? `animation-delay: ${(word.start + j * word.charStep).toFixed(3)}s; animation-duration: ${timing.glowDuration.toFixed(3)}s`
												: undefined}
										>{char}</span>
									{/each}
								</span>
							{/each}
						</span>
					{:else}
					<span class="music-visualizer__lyric-text music-visualizer__lyric-text--ktv">
						{#each splitChars(line.text) as char, j}
							<span
								class="music-visualizer__lyric-char"
								style={timing
									? `animation-delay: ${(j * timing.step).toFixed(3)}s; animation-duration: ${timing.glowDuration.toFixed(3)}s`
									: undefined}
							>{char}</span>
						{/each}
					</span>
					{/if}
				{:else}
					<span class="music-visualizer__lyric-text">{line.text}</span>
				{/if}
			</div>
		{/each}
		</div>
		{:else}
			<div class="music-visualizer__lyrics-empty" aria-live="polite">
				<span>{statusText}</span>
			</div>
		{/if}
	</div>
</div>
