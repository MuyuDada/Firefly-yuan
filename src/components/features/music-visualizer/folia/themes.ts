// folia 全屏歌词主题注册表。
// 对应 folia-web 的 registry.tsx + visualizerModes：每个主题一个 Svelte 组件，
// 经动态 import 惰性加载（各自独立 chunk，与 folia 的 React.lazy 策略一致）。
// 批次 0 起步：classic / partita / still；后续批次逐个补充其余主题。

import type { Component } from "svelte";
import type { FoliaVisualizerProps } from "./types";

export type FoliaModeId =
	| "classic"
	| "partita"
	| "still"
	| "claddagh"
	| "monet"
	| "fume"
	| "cadenza"
	| "cappella"
	| "prompt"
	| "tilt"
	| "pendolo"
	| "nebbia"
	| "diorama"
	| "metaphor"
	| "machi"
	| "sonnet"
	| "tempera"
	| "lumiere"
	| "hanabi";

export interface FoliaThemeDef {
	id: FoliaModeId;
	label: string;
	/** 主题是否已移植完成（未完成的批次不出现在选择列表里）。 */
	available: boolean;
	load: () => Promise<{ default: Component<FoliaVisualizerProps> }>;
}

export const FOLIA_THEMES: FoliaThemeDef[] = [
	{
		id: "classic",
		label: "Classic",
		available: true,
		load: () => import("./themes/classic/Visualizer.svelte"),
	},
	{
		id: "partita",
		label: "Partita",
		available: true,
		load: () => import("./themes/partita/Visualizer.svelte"),
	},
	{
		id: "still",
		label: "Still",
		available: true,
		load: () => import("./themes/still/Visualizer.svelte"),
	},
	{
		id: "tilt",
		label: "Tilt",
		available: true,
		load: () => import("./themes/tilt/Visualizer.svelte"),
	},
	{
		id: "claddagh",
		label: "Claddagh",
		available: true,
		load: () => import("./themes/claddagh/Visualizer.svelte"),
	},
	{
		id: "cadenza",
		label: "Cadenza",
		available: true,
		load: () => import("./themes/cadenza/Visualizer.svelte"),
	},
	{
		id: "cappella",
		label: "Cappella",
		available: true,
		load: () => import("./themes/cappella/Visualizer.svelte"),
	},
	{
		id: "monet",
		label: "Monet",
		available: true,
		load: () => import("./themes/monet/Visualizer.svelte"),
	},
	{
		id: "fume",
		label: "Fume",
		available: true,
		load: () => import("./themes/fume/Visualizer.svelte"),
	},
	{
		id: "nebbia",
		label: "Nebbia",
		available: true,
		load: () => import("./themes/nebbia/Visualizer.svelte"),
	},
	{
		id: "diorama",
		label: "Diorama",
		available: true,
		load: () => import("./themes/diorama/Visualizer.svelte"),
	},
	{
		id: "metaphor",
		label: "Metaphor",
		available: true,
		load: () => import("./themes/metaphor/Visualizer.svelte"),
	},
	{
		id: "machi",
		label: "Machi",
		available: true,
		load: () => import("./themes/machi/Visualizer.svelte"),
	},
	{
		id: "sonnet",
		label: "Sonnet",
		available: true,
		load: () => import("./themes/sonnet/Visualizer.svelte"),
	},
	{
		id: "tempera",
		label: "Tempera",
		available: true,
		load: () => import("./themes/tempera/Visualizer.svelte"),
	},
	{
		id: "lumiere",
		label: "Lumiere",
		available: true,
		load: () => import("./themes/lumiere/Visualizer.svelte"),
	},
	{
		id: "hanabi",
		label: "Hanabi",
		available: true,
		load: () => import("./themes/hanabi/Visualizer.svelte"),
	},
	{
		id: "prompt",
		label: "Prompt",
		available: true,
		load: () => import("./themes/prompt/Visualizer.svelte"),
	},
	{
		id: "pendolo",
		label: "Pendolo",
		available: true,
		load: () => import("./themes/pendolo/Visualizer.svelte"),
	},
];

export const DEFAULT_FOLIA_MODE: FoliaModeId = "classic";

export function resolveFoliaMode(value: unknown): FoliaModeId {
	const found = FOLIA_THEMES.find((theme) => theme.id === value);
	return (found?.available ? found.id : undefined) ?? DEFAULT_FOLIA_MODE;
}

export function getFoliaThemeDef(id: FoliaModeId): FoliaThemeDef | undefined {
	return FOLIA_THEMES.find((theme) => theme.id === id && theme.available);
}
