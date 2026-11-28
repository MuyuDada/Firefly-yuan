<script lang="ts">
// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/components/visualizer/metaphor).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// Firefly 简化移植：canvas 2D 签名观感（详见 compact/drawers.ts 头注）。

import type { FoliaVisualizerProps } from "../../types";
import CompactCanvasTheme from "../compact/CompactCanvasTheme.svelte";
import { COMPACT_DRAWERS } from "../compact/drawers";

let {
	clock,
	currentLineIndex,
	lines,
	theme,
	showText = true,
	getBands,
}: FoliaVisualizerProps = $props();
</script>

<CompactCanvasTheme
	mode="metaphor"
	{clock}
	{currentLineIndex}
	{lines}
	{theme}
	{showText}
	{getBands}
	drawFrame={COMPACT_DRAWERS.metaphor}
/>
