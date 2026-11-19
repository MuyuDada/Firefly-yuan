import { h } from "hastscript";
import { visit } from "unist-util-visit";
import clientScript from "./live-photo-script.js?raw";

/** 已注入脚本的 tree 集合，避免同一 tree 多次注入 */
const injectedTrees = new WeakSet();

function hasLivePhoto(tree) {
	let found = false;
	visit(tree, "element", (node) => {
		if (found) return;
		const value = node.properties?.className ?? node.properties?.class;
		const classList = Array.isArray(value)
			? value
			: typeof value === "string"
				? value.split(/\s+/)
				: [];
		if (classList.includes("live-photo")) found = true;
	});
	return found;
}

/**
 * 实况照片交互脚本注入插件
 *
 * 只有文章里真的出现 .live-photo 时才内联脚本，避免每篇文章都背这部分体积。
 * 样式位于 src/styles/markdown-extend.styl（.live-photo / .lp-*）。
 */
export function rehypeLivePhoto() {
	return (tree) => {
		if (injectedTrees.has(tree)) return;
		injectedTrees.add(tree);
		if (!hasLivePhoto(tree)) return;

		const script = h("script", { type: "text/javascript" }, clientScript);
		tree.children = [...(tree.children || []), script];
	};
}
