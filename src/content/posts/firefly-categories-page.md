---
title: '为 Firefly 升级分类页：玫瑰图与标签关系图'
slug: 'firefly-categories-page'
published: 2026-09-29
description: '把 Firefly 的分类页从静态卡片列表升级为可视化入口：ECharts 南丁格尔玫瑰图 + 标签力导向关系图，两者都可点击跳转到归档筛选，并记录了两个 ECharts 主题适配的坑。'
image: api
category: 页面改造
tags: [ECharts, 可视化]
draft: false
pinned: false
---

分类页大概是博客里最"没存在感"的一页。文章少的时候，一个卡片列表就够了；但文章一多，"文章示例 11 篇、Firefly 9 篇"这种纯数字列表就很难一眼看出内容的分布。

这篇文章记录我把分类页升级为可视化入口的过程：**分类南丁格尔玫瑰图** + **标签力导向关系图**，两者都能点击跳到归档页做筛选，最后是两个 ECharts 主题适配踩到的坑。

## 一、先看效果

| 能力 | 说明 |
| --- | --- |
| 分类玫瑰图 | 左图右列表，扇区面积 = 文章数，列表小圆点与扇区颜色一一对应 |
| 标签关系图 | 力导向图谱，节点大小 = 标签引用次数，连线 = 共现次数 |
| 点击跳转 | 扇区 / 列表项 → `/archive/?category=…`；节点 → `/archive/?tag=…` |
| 拖拽缩放 | 关系图支持 `roam` + `draggable` |
| 主题适配 | 图表颜色以 `--hue` 为起点生成，暗色模式自动换色 |
| 旧路径兼容 | `/tags/` 301 重定向到 `/categories/#tag-graph-container` |
| 无 npm 依赖 | ECharts 走 CDN 动态加载 |

## 二、涉及的文件

| 文件 | 作用 |
| --- | --- |
| `src/pages/categories/index.astro` | 分类标签页入口 |
| `src/pages/tags/index.astro` | 重定向到图谱锚点 |
| `src/components/widget/CategoryRose.astro` | 分类玫瑰图 |
| `src/components/widget/TagGraph.astro` | 标签关系图 |
| `src/utils/tag-graph-data.ts` | 标签节点与共现边统计（纯函数） |
| `src/utils/content-utils.ts` | `getTagGraphData()` |
| `src/styles/pages/categories.css` | 页面与图表布局 |
| `src/config/navBarConfig.ts` | 导航「文章」子菜单去重 |
| `src/components/widget/Tags.astro` | 侧边栏「更多」指向图谱锚点 |
| `src/i18n/*` | 页面标题与副标题文案 |

## 三、数据：标签关系怎么算

先把统计逻辑抽成**不依赖 `astro:content` 的纯函数**，这样能单独测试，也方便复用：

```ts
export function buildTagGraphData(
	posts: TagGraphInputPost[],
	threshold = 2,
): TagGraphData
```

核心是两件事：

**1. 节点**：统计每个标签被多少篇文章引用。

```ts
const tags = [...new Set((post.tags || []).map((t) => t.trim()))].filter(Boolean);

for (const tag of tags) {
	let node = nodeMap.get(tag);
	if (!node) {
		node = { id: tag, name: tag, value: 0, posts: [], url: "" };
		nodeMap.set(tag, node);
	}
	node.value += 1;
	if (node.posts.length < 5) node.posts.push(post.title);
}
```

那行 `new Set(...)` 是必要的：同一篇文章里如果重复写了同一个标签，不去重会把计数算多。

**2. 边**：同一篇文章内的标签两两组合，累加共现次数。

```ts
for (let i = 0; i < tags.length; i++) {
	for (let j = i + 1; j < tags.length; j++) {
		const [a, b] = [tags[i], tags[j]].sort();
		const key = `${a}\u0000${b}`;
		linkMap.set(key, (linkMap.get(key) ?? 0) + 1);
	}
}
```

用排序后的 `a\u0000b` 做 key，保证 `(A,B)` 和 `(B,A)` 落到同一条边上，否则会算成两条各 1 次的边。

**阈值很关键。** 默认 `threshold = 2`，即两个标签至少要同时出现在 2 篇文章里才连线。只共现过一次的标签对数量极多，全都连上会让图谱糊成一团毛线：

```ts
for (const [key, value] of linkMap) {
	if (value < threshold) continue;
	const [source, target] = key.split("\u0000");
	links.push({ source, target, value });
}
```

最后还有个容易忽略的收尾：**过滤掉因阈值而变成孤立的节点**，否则图上会飘着几个没有连线的圆点。

```ts
const connected = new Set<string>();
for (const link of links) {
	connected.add(link.source);
	connected.add(link.target);
}
const nodes = [...nodeMap.values()].filter((node) => connected.has(node.id));
```

我这边 24 篇文章跑出来是 **9 个节点、13 条边**。

## 四、分类玫瑰图

南丁格尔玫瑰图用 ECharts 的 `pie` + `roseType: "area"`：

```js
series: [{
	type: "pie",
	radius: ["22%", "72%"],
	roseType: "area",
	data: chartData,
	color: palette,
}]
```

**配色以主题色相为起点把色环等分**，这样分类多的时候也不会撞色，而且站点换主题色时图表跟着变：

```js
function buildPalette(count) {
	var baseHue = getHue();               // 读 --hue
	var step = 360 / Math.max(count, 1);
	for (var i = 0; i < count; i++) {
		var h = (baseHue + i * step) % 360;
		colors.push("hsl(" + h + " " + s + "% " + l + "%)");
	}
}
```

右侧列表的小圆点要和扇区颜色对上，所以调色板生成后同步写进 CSS 变量：

```js
function applySwatches(container, palette) {
	container.querySelectorAll(".category-rose__list-item").forEach((item, i) => {
		item.querySelector(".category-rose__swatch")
			?.style.setProperty("--swatch", palette[i % palette.length]);
	});
}
```

点击扇区跳转靠 ECharts 的 `click` 事件，用 `name` 反查 URL：

```js
chart.on("click", function (params) {
	for (var i = 0; i < chartData.length; i++) {
		if (chartData[i].name === params.name && chartData[i].url) {
			window.location.href = chartData[i].url;
			break;
		}
	}
});
```

## 五、标签关系图

力导向图的关键配置：

```js
series: [{
	type: "graph",
	layout: "force",
	roam: true,        // 拖拽 + 缩放
	draggable: true,
	force: {
		repulsion: 150,      // 节点斥力
		edgeLength: [44, 150], // 边长范围
		gravity: 0.08,       // 向心力，防止节点飘散
	},
	emphasis: { focus: "adjacency" },  // 悬停高亮相邻节点
	data: nodes,
	links: links,
}]
```

节点直径按引用次数线性映射，让"高频标签"一眼可辨：

```js
function getSymbolSize(value, minValue, maxValue) {
	var minSize = 24, maxSize = 78;
	if (maxValue === minValue) return 44;   // 全部相同时给个中间值
	return minSize + ((value - minValue) / (maxValue - minValue)) * (maxSize - minSize);
}
```

边的粗细和透明度也跟共现次数挂钩，共现越多线越粗：

```js
lineStyle: {
	width: 0.8 + (link.value / maxLink) * 3,
	opacity: 0.22 + (link.value / maxLink) * 0.5,
	curveness: 0.12,   // 轻微弯曲，避免两条边完全重叠
}
```

tooltip 要区分节点和边，并且**节点名与文章标题都要转义** —— 标题里可能有 `<` 或 `&`：

```js
formatter: function (params) {
	if (params.dataType === "edge") {
		return escapeHtml(params.data.source) + " ↔ " + escapeHtml(params.data.target) +
			"<br/>" + cooccurLabel + " " + params.data.value + " " + articleUnit;
	}
	// 节点：名称 + 引用数 + 相关文章
}
```

## 六、两个坑

### 坑一：改了 `series.label` 但节点标签颜色不变

暗色模式下我切换主题，发现**节点颜色变了，但标签还是深色**，压在深色背景上几乎看不见。

排查方式是直接从 ECharts 实例里读配置：

```js
var inst = window.echarts.getInstanceByDom(el);
inst.getOption().series[0].data[0].label.color
// 亮色: "rgba(24,24,27,0.92)"
// 切暗色后: "rgba(24,24,27,0.92)"   ← 没变
```

原因是我在主题切换时只更新了 **series 级**的 `label`：

```js
chart.setOption({
	series: [{ label: { color: nc.text } }],   // 不生效
});
```

但每个节点自己带了 `label`（因为字号要按引用次数区分大小），**节点级配置优先级高于 series 级**，所以 series 上的改动被完全覆盖。

修法是逐个节点重写：

```js
data: nodes.map(function (n, i) {
	return {
		...n,
		label: { ...n.label, color: nc.text },   // 节点级也要更新
	};
}),
```

这个坑的通用教训：**ECharts 的配置是分层覆盖的（全局 → series → data item），改了上层不会影响下层已显式设置过的字段。** 遇到"改了没反应"，先确认那个字段是不是在更细的层级上被写死了。

顺带一提，分类玫瑰图没有踩到这个坑 —— 它的 `data` 里没有逐项 `label`，所以 series 级更新是生效的。同一个项目里两处相似代码表现不同，正是因为这一层差异。

### 坑二：CDN 加载要防止重复插入

两个组件都需要 ECharts，如果各自无脑 `document.createElement("script")`，页面里会插进两个 1MB 的 script 标签。

修法是给 loader 打标记并复用：

```js
function loadECharts(callback) {
	if (window.echarts) return callback(window.echarts);

	var existing = document.querySelector("script[data-echarts-loader]");
	if (existing) {
		// 关键：已在加载中时不能只挂 load 监听，还要处理"其实已经加载完"的情况
		if (window.echarts) callback(window.echarts);
		else existing.addEventListener("load", () => callback(window.echarts), { once: true });
		return;
	}
	// ...创建 script 并打上 data-echarts-loader
}
```

那个 `if (window.echarts)` 的二次判断不是多余的：如果第一个组件刚加载完、第二个组件此时进来，`script` 标签还在但 `load` 事件已经错过了，只挂监听会永远等不到回调。

## 七、页面组装与路由

页面本身是纯静态 Astro，图表初始化靠组件内的 `<script is:inline>`：

```astro
<CategoryRose categories={categories} articleUnit={articleUnit} />
<div class="categories-page__divider"></div>
<TagGraph graph={tagGraph} cooccurLabel={...} articleUnit={articleUnit} />
```

旧的 `/tags/` 保留为 301 重定向，避免外链和书签失效：

```astro
---
return Astro.redirect("/categories/#tag-graph-container", 301);
---
```

导航栏里「文章」子菜单原来同时有「分类」和「标签」两项，合并后就成了重复入口，去掉一个：

```ts
children: [
	LinkPreset.Archive,
	LinkPreset.Categories,   // 分类与标签已合并为一页
	LinkPreset.Series,
],
```

还要给图谱容器加 `scroll-margin-top`，否则从 `#tag-graph-container` 锚点进来时标题会被固定导航栏压住：

```css
.tag-graph__container {
	scroll-margin-top: 5.5rem;
}
```

## 八、和归档页的衔接

分类页只做可视化入口，**筛选落地在归档页**：

| 来源 | 跳转 URL |
| --- | --- |
| 玫瑰图扇区 / 分类列表 | `/archive/?category={name}` |
| 标签关系图节点 | `/archive/?tag={name}` |

这样职责清晰：分类页负责"看见分布"，归档页负责"筛选列表"。归档页那边已经有 `?category=` / `?tag=` 的解析逻辑，无需改动。

## 九、验收清单

- [ ] `/categories/` 显示玫瑰图 + 右侧分类列表
- [ ] 列表小圆点颜色与扇区一一对应
- [ ] 点击扇区或列表项跳转到归档分类筛选
- [ ] 标签关系图可拖拽、缩放，相邻标签有连线
- [ ] 点击标签节点跳转到 `/archive/?tag=…`
- [ ] `/tags/` 301 重定向到图谱锚点
- [ ] 暗色模式下图表配色切换，**节点标签颜色同步变白**
- [ ] 切换主题色相后图表配色跟随
- [ ] Swup 站内切到 `/categories/` 后图表正常渲染
- [ ] 导航「文章」下拉无重复「标签」项

## 十、常见问题

| 现象 | 排查方向 |
| --- | --- |
| 图表空白 | 能否访问 `cdn.jsdelivr.net`；Console 里看 ECharts 报错 |
| 改了配置没反应 | 该字段可能被更细层级（data item）显式覆盖，逐项更新 |
| 暗色下标签看不清 | 节点自带 `label` 时，只改 `series.label` 不生效 |
| 关系图没有连线 | 共现阈值默认为 2；调低 `buildTagGraphData(posts, 1)` 会更密 |
| 图谱糊成一团 | 阈值太低或标签过多；提高阈值，或过滤低频标签 |
| 孤立节点飘着 | 过滤边之后没有同步剔除不在边上的节点 |
| Swup 切页后图表失效 | 检查 `swup:contentReplaced` / `astro:page-load` 监听与 `dispose()` |
| 锚点跳转标题被挡 | 容器缺少 `scroll-margin-top` |

## 十一、相关文件

页面：[src/pages/categories/index.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/pages/categories/index.astro)

玫瑰图：[src/components/widget/CategoryRose.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/CategoryRose.astro)

关系图：[src/components/widget/TagGraph.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/TagGraph.astro)

数据：[src/utils/tag-graph-data.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/utils/tag-graph-data.ts)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

## 🔗 最后

感谢[毛の博客](https://blog.huchao.vip/posts/astro/firefly-categories-page/)的原始设计，玫瑰图与关系图的方向都来自那篇教程。

这次最有价值的收获是那个标签颜色的坑。它的表现很迷惑 —— **图表颜色明明变了，文字却没变** —— 而根因是 ECharts 的分层配置覆盖规则。同一份代码里，玫瑰图正常、关系图异常，差别只在于关系图的每个节点为了控制字号而单独设了 `label`。

所以遇到"配置改了没生效"，最有效的排查不是反复调参数，而是**把运行时真正的配置读出来对比**：`inst.getOption()` 一行就能看出哪个层级的值没被更新。
