---
title: '为 Firefly 升级归档页：双热力图与三级时间轴'
slug: 'firefly-archive-page'
published: 2026-09-28
description: '把 Firefly 自带的时间轴归档页升级为 GitHub 贡献 + 文章发布双热力图，加上年→月→文章三级结构与 SVG 悬停高亮连线，并记录了三个真实踩到的坑：容器宽度误判、月份行错位、第三方 API 抖动。'
image: api
category: Firefly
tags: [Firefly, 博客, 二开, 归档]
draft: false
pinned: false
---

归档页在博客里有点尴尬 —— 它是最少被点开、却最容易被低估的一页。读者想找一篇文章时，翻归档往往比搜索更有效；而对自己来说，归档页是一张"发布节奏体检表"。

Firefly 自带的归档页只有一条按年分组的时间轴。这篇文章记录我把它升级的过程：**GitHub 贡献 + 文章发布双热力图**，以及**年 → 月 → 文章三级时间轴**（悬停时用一条带圆角的 SVG 路径把三级节点连起来），最后是三个真实踩到的坑。

## 一、先看效果

| 能力 | 说明 |
| --- | --- |
| GitHub 贡献热力图 | 左栏，经典绿色系，构建时拉取，带年度贡献总数 |
| 文章发布热力图 | 12 月 × 4 周网格，可切换年份，点击月份高亮 |
| 三级时间轴 | 年 → 月 → 文章，每月显示篇数 |
| 悬停高亮连线 | 年节点 → 月节点 → 文章节点，圆角拐弯 + 光晕双层描边 |
| 分类配色 | 18 色固定色盘，按分类名排序循环分配，颜色稳定 |
| URL 筛选 | `?category=` / `?tag=` / `?uncategorized=1`，联动 Banner 标题 |
| 主题适配 | 文章热力图与时间轴高亮跟随 `--hue`；GitHub 保持官方绿 |
| 移动端 | 热力图纵向堆叠，时间轴隐藏节点与连线、保留列表 |

## 二、涉及的文件

| 文件 | 作用 |
| --- | --- |
| `src/pages/archive.astro` | 归档页入口：标题面板 + 热力图 + 时间轴 |
| `src/components/controls/ArchivePanel.astro` | 三级时间轴 + 筛选 + SVG 高亮 |
| `src/components/widget/ArchiveHeatmap.astro` | 双热力图容器 |
| `src/components/widget/GithubHeatmap.astro` | GitHub 贡献热力图 |
| `src/components/widget/PostHeatmap.astro` | 文章发布热力图 |
| `src/styles/components/archive-heatmap.css` | 热力图样式与色阶 |
| `src/styles/components/archive-panel.css` | 时间轴与连线样式 |
| `src/config/siteConfig.ts` | `heatmap.github` 配置 |
| `src/types/siteConfig.ts` | `heatmap` 类型 |
| `src/i18n/*` | 热力图相关文案 |

## 三、配置

先在 `siteConfig` 里加一个可关的热力图配置：

```ts
heatmap: {
	github: {
		// 是否显示 GitHub 贡献热力图
		enabled: true,
		// 你的 GitHub 用户名
		username: "MuyuDada",
	},
},
```

| 想要 | 改什么 |
| --- | --- |
| 关闭 GitHub 图 | `enabled: false` |
| 只显示文章分布 | 删掉 `github` 或设 `enabled: false` |
| 换账号 | 改 `username` |

## 四、GitHub 贡献热力图

数据来源是一个第三方接口，**不需要 GitHub Token**：

```
https://github-contributions-api.jogruber.de/v4/{username}
```

它一次返回所有年份，我筛出当前年份渲染成 53 周 × 7 天的日历格子。`level` 字段（0-4）直接映射到 `.github-cell.level-N` 色阶。

关键点是**这个请求不能拖垮整页**。它跑在构建期，属于外部依赖，因此我把失败处理成"只影响本面板"：

```astro
let contributions = [];
let loadFailed = false;

const data = await fetchContributions();   // 内部带一次重试
if (data) {
	contributions = data.contributions.filter((c) => c.date.startsWith(String(currentYear)));
} else {
	loadFailed = true;
}
```

模板里失败就显示一行提示，不渲染空网格：

```astro
{loadFailed ? (
	<div class="heatmap-error">{i18n(I18nKey.heatmapLoadFailed)}</div>
) : (
	<div class="heatmap-body">...</div>
)}
```

**色阶必须用固定绿色，不能跟主题色。** 这是 GitHub 贡献图的视觉约定，用 `var(--hue)` 会变成紫色或粉色，一眼就不对：

```css
.github-cell.level-1 { background: #b8d6c5; }
.github-cell.level-2 { background: #77b493; }
.github-cell.level-3 { background: #118659; }
.github-cell.level-4 { background: oklch(38% 0.15 160); }  /* 固定色相 160 */
```

而文章热力图相反，**应该跟主题色**，这样站点换主题色时它会一起变：

```css
.post-cell.level-1 { background: oklch(0.91 0.035 var(--hue)); }
.post-cell.level-2 { background: oklch(0.82 0.08 var(--hue)); }
.post-cell.level-3 { background: oklch(0.72 0.12 var(--hue)); }
.post-cell.level-4 { background: oklch(0.62 0.14 var(--hue)); }
```

## 五、文章发布热力图

12 个月 × 4 周的网格，服务端统计好再序列化给客户端做年份切换：

```ts
// 按「年 → 月 → 周」统计（1-7 日为 W1，最多 4 周）
const week = Math.min(3, Math.floor((d.getDate() - 1) / 7));

// 色阶按该年最大值相对分档
function toLevel(count, max) {
	if (count === 0) return 0;
	if (max <= 1) return 4;
	const ratio = count / max;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}
```

**用相对分档而不是固定阈值**：博客产量因人而异，有人一年 5 篇、有人一年 200 篇。按当年最大值分档，两边的图都有层次感；写死"1 篇=level1、5 篇=level4"会让高产博客全是深色、低产博客全是浅色。

年份切换在客户端做，只改 DOM 不重新请求：

```js
function render() {
	const year = years[index];
	const data = grids[String(year)];
	gridEl.innerHTML = "";
	for (const row of data.grid) { /* 重建格子 */ }
	labelEl.textContent = String(year);
	prevBtn?.classList.toggle("is-disabled", index <= 0);
	nextBtn?.classList.toggle("is-disabled", index >= years.length - 1);
}
```

## 六、三级时间轴

分组是「年 → 月 → 文章」三层。月份的本地化交给 `Intl`，不手写映射表：

```ts
const langTag = (siteConfig.lang || "zh_CN").replace("_", "-");
const monthFormatter = new Intl.DateTimeFormat(langTag, { month: "short" });
// zh-CN → "9月"，en → "Sep"
```

**分类配色用固定色盘 + 稳定排序**，这样同一个分类在任何页面、任何时候都是同一个颜色：

```ts
const allCategories = [...new Set(posts.map(p => p.data.category).filter(Boolean))].sort();
allCategories.forEach((name, index) => {
	categoryColors.set(name, CATEGORY_COLORS[index % CATEGORY_COLORS.length]);
});
```

如果用 `Math.random()` 或按出现顺序分配，每次构建颜色都会变，读者会产生"这是另一个分类"的错觉。

### 6.1 悬停高亮连线

这是整个页面最有意思的部分：悬停一篇文章时，用一条路径把 **年节点 → 月节点 → 文章节点** 连起来。路径不能是直角折线，要在拐弯处做圆角：

```js
buildPath(x0, y0, x1, y1, x2, y2) {
	const r = 8;
	// 垂直距离太小就不做圆角，避免路径自交
	const rr1 = Math.min(r, Math.abs(y1 - y0) / 2);
	const rr2 = Math.min(r, Math.abs(y2 - y1) / 2);

	return [
		`M ${x0} ${y0}`,
		`L ${x0} ${y1 - rr1}`,
		`A ${rr1} ${rr1} 0 0 0 ${x0 + rr1} ${y1}`,   // 第一个圆角
		`L ${x1 - rr1} ${y1}`,
		`A ${rr1} ${rr1} 0 0 0 ${x1} ${y1 + rr1}`,
		`L ${x1} ${y2 - rr2}`,
		`A ${rr2} ${rr2} 0 0 0 ${x1 + rr2} ${y2}`,   // 第二个圆角
		`L ${x2} ${y2}`,
	].join(" ");
}
```

那个 `Math.min(r, 距离/2)` 很关键：如果两行挨得很近、垂直距离小于圆角半径的两倍，圆弧会互相重叠导致路径扭曲。把半径夹到距离的一半以内就不会了。

坐标全部相对 SVG 测量，用 `getBoundingClientRect()` 取节点中心：

```js
const base = svg.getBoundingClientRect();
const center = (el) => {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
};
```

**坐标必须缓存。** 每篇文章都遍历一次全表测量节点是 O(n²) 的布局读取，鼠标一动就会卡。我改成首次悬停时测一次并缓存，布局变化时置空：

```js
// 折叠 / 筛选 / 缩放都会让缓存的坐标失效
toggle.addEventListener("click", () => {
	this.nodeCache = null;
	this.clearHighlight();
});
window.addEventListener("resize", () => {
	this.nodeCache = null;
	this.clearHighlight();
});
```

描边用双层：下面一层粗的做光晕，上面一层细的做主线。

```css
.ap-highlight-glow { stroke: color-mix(in oklch, var(--btn-content) 32%, transparent); stroke-width: 6; opacity: .62; }
.ap-highlight-line { stroke: var(--btn-content); stroke-width: 2.5; opacity: .9; }
```

高亮色用 `--btn-content` 而不是 `--primary` —— 前者比主题色略深一点，压在白底和浅色卡片上更清晰。

## 七、三个坑

### 坑一：媒体查询判断"够不够宽"会误判

第一版我把两个热力图并排，宽度不够时用媒体查询折行：

```css
.heatmap-container { display: flex; }
@media (max-width: 768px) { .heatmap-container { flex-direction: column; } }
```

结果在 1384px 的视口下，两栏各只有 **277px**，GitHub 的 53 周网格（约 900px）完全放不下 —— 月份标签被挤成一团，格子被裁掉。

原因是**内容区被两侧侧边栏挤压**：视口 1384px，减去侧边栏和留白后内容区只剩 **577px**。媒体查询看的是视口宽度，自然判断成"够宽，可以并排"。

修法是用**容器自身的宽度**决定列数，而不是视口：

```css
.heatmap-container {
	display: grid;
	/* 每栏至少 320px，放不下就自动折成上下堆叠 */
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
```

`auto-fit + minmax` 由容器实际宽度决定列数，和真实可用空间一致。这个教训可以推广：**只要组件可能被放进侧边栏、卡片或任何不确定宽度的容器里，就不要用媒体查询判断布局，用内在尺寸（`auto-fit` / `flex-wrap` / 容器查询）。**

### 坑二：月份行和网格各自滚动会错位

GitHub 热力图横向放不下时需要滚动。我最初只给网格加了 `overflow-x: auto`：

```css
.heatmap-grid { overflow-x: auto; }   /* 月份行没加 */
```

结果月份标签自己撑出容器、格子单独滚动，**两者完全错位** —— 滚动时月份数字不动，格子在动。

修法是把月份行和网格放进**同一个滚动容器**，并让内部宽度为 `max-content` 保证两者同宽：

```css
.heatmap-scroll { overflow-x: auto; }
.heatmap-months { width: max-content; }
.heatmap-grid-wrap { width: max-content; }
```

```html
<div class="heatmap-scroll">
  <div class="heatmap-months">...</div>
  <div class="heatmap-grid-wrap">...</div>
</div>
```

顺带一提：`width: max-content` 是必须的。否则月份行会被压到容器宽度，53 列的 grid 内容溢出，滚动宽度算不对。

### 坑三：第三方 API 偶发抖动

构建时拉 GitHub 贡献数据，第一次跑就失败了：

```
[GITHUB-HEATMAP] Failed to load contributions: [DOMException [AbortError]: This operation was aborted]
```

我设的超时是 15 秒。单独测这个接口，**响应时间在 270ms 到 1.1s 之间波动** —— 正常情况下绰绰有余，但构建期并发请求多、网络抖动时就会撞上超时。

修法是把超时放宽到 20 秒并加一次重试：

```js
for (let attempt = 1; attempt <= 2; attempt++) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20000);
	try {
		const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal });
		clearTimeout(timer);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	} catch (error) {
		clearTimeout(timer);
		if (attempt === 2) {
			console.warn("[GITHUB-HEATMAP] Failed to load contributions:", error);
			return null;
		}
	}
}
```

另外那个 `User-Agent: Mozilla/5.0` 不是可选项 —— 很多第三方接口会拒绝没有 UA 的请求。

## 八、验收清单

- [ ] `/archive/` 可见双热力图（或仅文章图，若关闭 GitHub）
- [ ] GitHub 图为绿色系，显示年度贡献总数
- [ ] 文章热力图可切换年份，点击月份格子高亮整月
- [ ] 时间轴按年 / 月分组，每月显示篇数
- [ ] 悬停文章出现主题色圆角连线，年 / 月 / 文章节点同时高亮
- [ ] 移开鼠标后连线与高亮全部清除
- [ ] 折叠年份后再次悬停，连线位置仍然正确（坐标缓存已失效重建）
- [ ] `/archive/?category=Firefly` 只显示对应分类，Banner 标题联动
- [ ] `/archive/?tag=Firefly` 同上
- [ ] 切换主题色相后，文章热力图与时间轴高亮同步变化，GitHub 图保持绿色
- [ ] 移动端热力图上下排列，时间轴列表可读

## 九、常见问题

| 现象 | 排查方向 |
| --- | --- |
| GitHub 图显示"加载失败" | 用户名是否正确、构建环境能否访问外网；临时设 `enabled: false` |
| GitHub 图变成紫色/主题色 | 误改了 `.github-cell` 色阶；它应该用固定色相 160 |
| 两个热力图挤在一起 | 不要用媒体查询判断宽度，用 `auto-fit + minmax` 让容器自己决定 |
| 月份标签与格子错位 | 月份行和网格要放在同一个滚动容器里 |
| 悬停连线位置不对 | 节点坐标缓存没在布局变化时失效；折叠/筛选/缩放后要重建 |
| 连线在相邻行之间扭曲 | 圆角半径没有按垂直距离夹紧，用 `Math.min(r, 距离/2)` |
| 悬停卡顿 | 每篇文章都遍历全表测量节点；改成首次测量后缓存 |
| 高亮线太粗/太细 | 调 `.ap-highlight-line` 的 `stroke-width`（2～3）与 `.ap-highlight-glow`（6） |
| 分类颜色每次构建都在变 | 色盘分配依赖了随机或出现顺序；改用排序后的稳定映射 |
| 文章热力图全是深色 | 色阶用了固定阈值；改成按当年最大值相对分档 |

## 十、相关文件

页面：[src/pages/archive.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/pages/archive.astro)

时间轴：[src/components/controls/ArchivePanel.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/controls/ArchivePanel.astro)

GitHub 热力图：[src/components/widget/GithubHeatmap.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/GithubHeatmap.astro)

文章热力图：[src/components/widget/PostHeatmap.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/PostHeatmap.astro)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

## 🔗 最后

感谢[毛の博客](https://blog.huchao.vip/posts/astro/firefly-archive-page/)的原始设计，双热力图与三级时间轴的方向都来自那篇教程。

三个坑里，前两个其实是同一类问题：**我以为在描述"屏幕有多大"，但真正决定布局的是"容器有多宽"。** 视口宽 1384px，内容区只有 577px —— 差了一倍多。用媒体查询就是在描述前者，而 `auto-fit` / `max-content` 描述的是后者。

第三个坑则是外部依赖的常态：一个平均 300ms 的接口，在构建期并发压力下就会超过 15 秒。给外部请求留足超时、加重试、并且让失败只影响它自己那一块，比事后排查省事得多。
