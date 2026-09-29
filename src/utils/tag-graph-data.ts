// 标签关系图数据：节点 = 标签，边 = 共现（同一篇文章内同时出现）
//
// 单独抽成模块便于测试：不依赖 astro:content，纯函数。

export type TagGraphInputPost = {
	title: string;
	url: string;
	published: Date;
	tags: string[];
};

export type TagGraphNode = {
	id: string;
	name: string;
	value: number; // 引用该标签的文章数
	posts: string[]; // 相关文章标题（供 tooltip 展示）
	url: string; // 点击跳转地址（由调用方填充）
};

export type TagGraphLink = {
	source: string; // 节点 id
	target: string; // 节点 id
	value: number; // 共现次数
};

export type TagGraphData = {
	nodes: TagGraphNode[];
	links: TagGraphLink[];
	threshold: number;
};

/**
 * 构建标签关系图数据。
 *
 * @param posts 文章列表（应已过滤草稿）
 * @param threshold 共现次数阈值：低于该值的边会被丢弃。
 *   默认 2，即两个标签至少要同时出现在 2 篇文章里才连线 ——
 *   否则只共现过一次的标签也会连边，图谱会糊成一团。
 */
export function buildTagGraphData(
	posts: TagGraphInputPost[],
	threshold = 2,
): TagGraphData {
	// 节点：统计每个标签的引用次数与相关文章
	const nodeMap = new Map<string, TagGraphNode>();
	// 边：key 用排序后的 "a\u0000b" 保证 (a,b) 与 (b,a) 归一到同一条
	const linkMap = new Map<string, number>();

	for (const post of posts) {
		// 去重：同一篇文章里重复写同一个标签只算一次
		const tags = [...new Set((post.tags || []).map((t) => t.trim()))].filter(
			Boolean,
		);

		for (const tag of tags) {
			let node = nodeMap.get(tag);
			if (!node) {
				node = { id: tag, name: tag, value: 0, posts: [], url: "" };
				nodeMap.set(tag, node);
			}
			node.value += 1;
			// tooltip 只展示最近几篇，避免节点数据过大
			if (node.posts.length < 5) node.posts.push(post.title);
		}

		// 两两组合累加共现
		for (let i = 0; i < tags.length; i++) {
			for (let j = i + 1; j < tags.length; j++) {
				const [a, b] = [tags[i], tags[j]].sort();
				const key = `${a}\u0000${b}`;
				linkMap.set(key, (linkMap.get(key) ?? 0) + 1);
			}
		}
	}

	const links: TagGraphLink[] = [];
	for (const [key, value] of linkMap) {
		if (value < threshold) continue;
		const [source, target] = key.split("\u0000");
		links.push({ source, target, value });
	}

	// 只保留仍在边上的节点，避免出现孤立点（阈值过滤后可能产生）
	const connected = new Set<string>();
	for (const link of links) {
		connected.add(link.source);
		connected.add(link.target);
	}

	const nodes = [...nodeMap.values()]
		.filter((node) => connected.has(node.id))
		.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

	return { nodes, links, threshold };
}
