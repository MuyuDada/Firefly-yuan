<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/still/VisualizerStill.tsx).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// still（静止）：三行静态歌词（上一句 / 当前句 / 下一句），无逐词动画，低占用。
import { resolveSubtitleFontSizes } from "../../subtitleFontSizes";
import type { FoliaVisualizerProps } from "../../types";

let {
	currentLineIndex,
	lines,
	theme,
	showText = true,
	lyricsFontScale = 1,
}: FoliaVisualizerProps = $props();

let effectiveIndex = $state(0);

// 命中当前行时跟随；间奏（-1）保持上一句；越界回到第一句。
$effect(() => {
	if (currentLineIndex !== -1) {
		effectiveIndex = currentLineIndex;
	} else if (effectiveIndex >= lines.length) {
		effectiveIndex = 0;
	}
});

const subtitleSizes = $derived(resolveSubtitleFontSizes(lyricsFontScale));

const visibleLines = $derived(
	[-1, 0, 1].map((offset) => ({
		offset,
		line: lines[effectiveIndex + offset] ?? null,
		isCurrent: offset === 0,
	})),
);
</script>

<div class="folia-theme folia-still" data-folia-theme="still">
	<div class="folia-still-vignette" aria-hidden="true"></div>

	{#if showText}
		<div class="folia-still-lines">
			{#each visibleLines as entry (entry.offset)}
				{#if entry.line}
					<div class="folia-still-line-group">
						{#if entry.line.fullText}
							<div
								class="folia-still-text"
								class:is-current={entry.isCurrent}
								style={`color:${theme.primaryColor};font-family:${theme.fontFamily};scale:${lyricsFontScale};font-weight:${theme.fontWeight};`}
							>
								{entry.line.fullText}
							</div>
						{/if}
						{#if entry.line.translation}
							<div
								class="folia-still-translation"
								class:is-current={entry.isCurrent}
								style={`color:${theme.secondaryColor};font-size:${subtitleSizes.translationFontSize};scale:${lyricsFontScale};font-weight:${entry.isCurrent ? 500 : 400};`}
							>
								{entry.line.translation}
							</div>
						{/if}
					</div>
				{:else}
					<div class="folia-still-spacer"></div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
