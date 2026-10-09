---
title: '为 Firefly 打造友链页：Tag 筛选、分页、延时徽章与申请弹窗'
slug: 'firefly-friends-page'
published: 2026-09-28
description: '把 Firefly 自带的友链页从「一排卡片」改造成带搜索、Tag 筛选、分页、访问延时徽章和申请指南弹窗的完整页面，并踩平了两个静默失效的坑：DOMContentLoaded 被第三方资源卡死、祖先元素的 transform 让 position:fixed 弹窗错位。'
image: api
category: 页面改造
tags: [交互]
draft: false
pinned: false
---

友链页大概是博客里最"社交"的一个页面 —— 它回答的不是"我做过什么"，而是"我认识谁"。Firefly 自带 `/friends/` 路由和一份基础配置，但默认只把配置里的卡片平铺出来：没有筛选、没有分页、没有懒加载，访客想知道某个站点通不通只能自己点进去。

这篇文章记录我把它补齐的过程：搜索、Tag 筛选、分页、访问延时徽章、站点预览图、申请指南弹窗，以及**两个花了最多时间才定位到的坑**。

## 一、先看效果

改造后这一页具备：

| 能力 | 说明 |
| --- | --- |
| 搜索 | 按站名 / 简介 / 域名 / 标签过滤，输入有 150ms 防抖 |
| Tag 筛选 | 「全部」+ 所有友链 `tags` 并集，带滑动指示条 |
| 分页 | 默认每页 9 条，筛选后自动重新分页并回到第 1 页 |
| 延时徽章 | 卡片进入视口才探测，绿 / 橙 / 红三档，带脉冲圆点 |
| 站点预览图 | 顶栏 16:9 缩略图，支持手填或自动截图 |
| 头像懒加载 | 进入视口才把 `data-src` 赋给 `src`，失败显示首字占位 |
| 申请弹窗 | 右上角按钮，本站信息一键复制 + 三步流程 + 注意事项 |
| 空态 | 筛选无结果时显示提示，而不是留一片空白 |
| 卡片视觉 | 三列网格、极光晕、左侧色轨、悬停扫光与前往按钮 |

## 二、涉及的文件

| 文件 | 作用 |
| --- | --- |
| `src/config/friendsConfig.ts` | 日常只改这里：页面配置 + 友链列表 |
| `src/types/friendsConfig.ts` | `FriendLink` / `FriendsPageConfig` 类型 |
| `src/pages/friends.astro` | 页面骨架 + 全部客户端交互 |
| `src/components/features/FriendCard.astro` | 单张友链卡片（极光晕 / 色轨 / 角标 / 预览 / 延时） |
| `src/components/features/FriendRulesModal.astro` | 「如何申请友链」弹窗 |
| `src/styles/components/friend-card.css` | 卡片视觉、延时徽章与动画 |
| `src/styles/components/friend-rules-modal.css` | 弹窗样式 |
| `src/styles/pages/friends.css` | 工具栏、三列网格、Tag 指示条、分页样式 |
| `src/content/spec/friends.mdx` | 卡片区下方的自定义内容 |
| `src/i18n/i18nKey.ts` + `languages/*.ts` | 弹窗与徽章文案 |

## 三、配置：把可调项都抽出来

第一步是把散落在页面里的行为参数收进配置文件。`friendsPageConfig` 扩展后长这样：

```ts
export const friendsPageConfig: FriendsPageConfig = {
	title: "",
	description: "",
	showCustomContent: true,
	showComment: true,
	randomizeSort: false,

	// 每页展示的卡片数量
	pageSize: 9,

	// ── 访问延时徽章 ──
	showLatency: true,
	latencyTimeout: 5000,   // 探测超时（毫秒）
	latencyGoodMs: 2000,    // 「良好」阈值（毫秒）

	// ── 站点预览图 ──
	showPreview: true,
	autoPreview: false,

	// ── 申请指南弹窗 ──
	applyLink: "",
	siteInfo: {
		name: "Muyu の 小窝",
		desc: "永远相信美好的事情即将发生",
		url: "https://muyudada.dpdns.org",
		avatar: "https://.../avatar.gif",
	},
	notes: [
		{ title: "互换原则", content: "请先将本站添加到您的友链页面…" },
		// ...
	],
};
```

几条设计取舍：

- **`autoPreview` 默认关**。它用第三方截图服务按 `siteurl` 现拉缩略图，免去手动截图，但国内访问可能很慢甚至空白。宁可默认不显示，需要的人自己开或填 `previewurl`。
- **`showLatency` / `showPreview` 用"视为 true"的写法**（`!== false` 而不是 `=== true`）。这样旧配置不写这两项时功能仍然开启，不会因为升级而静默失效。
- **弹窗是否出现**由 `applyLink`、`siteInfo`、评论区三者之一决定，不用额外开关。

友链条目本身新增了可选的 `previewurl`：

```ts
{
title: "Muyu の 小窝",
imgurl:"https://i.imgs.ovh/2026/08/16/d9361d6e012c3125dc8bebbd1a913a92.gif",
desc: "永远相信美好的事情即将发生",
siteurl: "https://muyudada.dpdns.org",
tags: ["本站"],
weight: 99, // 权重，数字越大排序越靠前
enabled: true, // 是否启用
}
```

## 四、卡片：视觉、懒加载与延时徽章

卡片单独抽成 `FriendCard.astro`，视觉上做成玻璃票卡：顶部 16:9 预览区、圆形头像带光环、Tag 角标、右上角延时徽章、底部简介条，悬停时整卡上浮 + 扫光 + 右下角弹出前往按钮。

**图片不立即加载** —— 头像和预览图都先只写 `data-src`：

```astro
<div class="friend-card-avatar" data-avatar-wrap data-initial={initial}>
  <span class="friend-card-avatar__face" aria-hidden="true">{initial}</span>
  <img class="friend-card-avatar__img" data-avatar data-src={friend.imgurl} alt={friend.title} />
</div>
```

首字占位常驻在头像底下，图片加载成功给**外层容器**加 `.is-loaded` 再淡入；失败则加 `.is-error`，用 CSS 把 `<img>` 藏掉、把首字显出来：

```css
.friend-card-avatar.is-loaded .friend-card-avatar__img { opacity: 1; }
.friend-card-avatar.is-error .friend-card-avatar__face { opacity: 1; }
.friend-card-avatar.is-error .friend-card-avatar__img { display: none; }
```

注意状态类加在**容器**上而不是 `<img>` 上：因为 `opacity` 过渡需要容器参与，而且用容器类名做状态机比在 img 上堆类更好维护。

延时徽章初始是"检测中"，带一个脉冲圆点；超时文案放在 `data-` 属性上，避免在 JS 里硬编码多语言字符串：

```astro
<span class="friend-latency is-pending" data-latency
      data-timeout-label={i18n(I18nKey.friendsLatencyTimeout)}>
  <span class="friend-latency__dot" aria-hidden="true"></span>
  <span class="friend-latency__text" data-latency-text>{i18n(I18nKey.friendsLatencyTesting)}</span>
</span>
```

探测结束后统一走一个 `settle()` 收尾，保证三种状态互斥、圆点动画停止：

```js
const settle = (state, text) => {
	badge.classList.remove("is-pending");
	badge.classList.add(state);          // is-good / is-warn / is-bad
	if (badgeText) badgeText.textContent = text;
};
```

卡片网格是固定三列，窄屏降到两列、再降到一列 —— 比 `auto-fill` 更能保证一排卡片的视觉节奏一致：

```css
.friends-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.15rem 1rem; }
@media (max-width: 1024px) { .friends-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .friends-grid { grid-template-columns: 1fr; } }
```

## 五、交互：筛选、分页与视口懒加载

所有交互都写在 `friends.astro` 的 `<script is:inline>` 里，核心是一份"过滤 → 分页 → 观察"的流程：

```js
function apply() {
	// 1. 按 Tag + 关键词过滤
	matched = allCards.filter((card) => { /* ... */ });

	// 2. 过滤条件变化后页码可能越界，回到第 1 页
	const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
	if (currentPage > pages) currentPage = 1;

	// 3. 只显示当前页
	const start = (currentPage - 1) * PAGE_SIZE;
	const pageSet = new Set(matched.slice(start, start + PAGE_SIZE));
	allCards.forEach((card) => {
		card.style.display = pageSet.has(card) ? "" : "none";
	});

	// 4. 空态 + 分页按钮
	// 5. 新进入视口的卡片才加载资源
	observeCards([...pageSet]);
}
```

**图片和延时探测都交给 `IntersectionObserver`**，而且只对"当前页可见"的卡片注册：

```js
const io = new IntersectionObserver((entries) => {
	entries.forEach((entry) => {
		if (!entry.isIntersecting) return;
		const card = entry.target;
		loadImages(card);
		probeLatency(card);
		io.unobserve(card);   // 处理过就不再观察
	});
}, { rootMargin: "200px" });
```

`rootMargin: "200px"` 让卡片在进入视口前 200px 就开始准备，滚动时不会有明显的"先白后图"。

延时探测本身很简单 —— 用 `no-cors` 发一个请求，量往返耗时：

```js
const started = performance.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), LATENCY_TIMEOUT);

try {
	await fetch(target, {
		mode: "no-cors",
		cache: "no-store",
		signal: controller.signal,
	});
	clearTimeout(timer);
	const ms = Math.round(performance.now() - started);
	badge.textContent = ms + " MS";
	badge.classList.add(ms < LATENCY_GOOD_MS ? "is-good" : "is-warn");
} catch {
	clearTimeout(timer);
	badge.textContent = badge.dataset.timeoutLabel;
	badge.classList.add("is-bad");
}
```

有几个必须说清楚的局限：

- `no-cors` **拿不到 HTTP 状态码**，只能判断"大致能不能连通"。对方返回 404 也会算成功。
- 数值受访客网络、DNS、对方 CDN 影响，是**参考值而非测速**。
- 对方是 `http://` 而本站是 HTTPS 时会被混合内容拦截，通常表现为一直「超时」。

分页按钮的页码做了折叠：首尾页 + 当前页 ±1，中间用 `…` 连接，避免友链多了以后按钮铺满一整行。

Tag 筛选用一条会滑动的指示条，比给按钮直接换背景色更精致。指示条的位置靠测量按钮矩形算，注意在字体加载完成后要重算一次（否则中文字体切换会让按钮宽度变化、指示条错位）：

```js
const moveIndicator = (button) => {
	const wrapRect = tabsWrap.getBoundingClientRect();
	const btnRect = button.getBoundingClientRect();
	indicator.style.left = btnRect.left - wrapRect.left + "px";
	indicator.style.width = btnRect.width + "px";
};

moveIndicator(activeBtn);
document.fonts?.ready.then(() => moveIndicator(activeBtn));
window.addEventListener("resize", () => moveIndicator(activeBtn));
```

## 六、坑一：DOMContentLoaded 一直不来

页面写完后本地打开一看：**卡片渲染正常，但筛选点了没反应、延时徽章永远停在「检测中」**。

排查过程是这样的 —— 先确认脚本在不在：

```js
[...document.querySelectorAll('script')]
	.filter(s => s.textContent.includes('LATENCY_GOOD_MS')).length   // 1，在
```

脚本在 `<head>` 里，10457 个字符，语法也没问题。再看初始化标记：

```js
window.__friendsPageInit   // true —— 说明脚本顶层确实执行了
```

顶层执行了，那 `boot()` 为什么没跑？打印一下 `document.readyState`：

```js
document.readyState   // "loading"
```

**页面加载 5 秒后，`readyState` 还是 `loading`。** 原来我写的是：

```js
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
```

而 `DOMContentLoaded` 要等所有阻塞资源就绪。这一页引入了评论系统的样式（unpkg 上的 Waline CSS）和统计脚本（Umami），其中任何一个请求悬挂，`DOMContentLoaded` 就永远不触发，`boot()` 自然永远等不到。

**修法是不再依赖这个事件**，改成"立即尝试 + 用 `MutationObserver` 兜底"：

```js
const startWatching = () => {
	boot();   // 先试一次：Swup 切页时 DOM 其实已经就绪
	if (document.querySelector("[data-friends-grid]")) return;

	// 首屏时 <head> 脚本早于 DOM 解析，等网格节点出现再初始化
	const observer = new MutationObserver(() => {
		if (!document.querySelector("[data-friends-grid]")) return;
		observer.disconnect();
		boot();
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
};
```

同时给初始化加了幂等保护，避免 Swup 换页后重复绑定：

```js
function boot() {
	const grid = document.querySelector("[data-friends-grid]");
	if (!grid || grid.dataset.friendsBound === "true") return;
	grid.dataset.friendsBound = "true";
	init();
	initModal();
}
```

这个坑的教训值得单独记一句：**把初始化逻辑挂在 `DOMContentLoaded` 上，等于把页面的可用性押在所有第三方资源上。** 只要有一个外链请求卡住，你的交互就全部失效 —— 而这类请求往往还是评论、统计这种"锦上添花"的东西。

## 七、申请弹窗

弹窗把"怎么申请友链"从一段静态说明变成可交互的组件。是否渲染在页面里判断：

```astro
const hasApplyModal = Boolean(
	friendsPageConfig.applyLink ||
		friendsPageConfig.siteInfo ||
		isCommentEnabled,
);
```

弹窗内容分四块：本站信息（每行一个复制按钮）、三步流程、申请模板（可整体复制）、注意事项。复制走一个带兜底的函数 —— `navigator.clipboard` 在非 HTTPS 环境或旧浏览器里可能不可用：

```js
const copyText = async (text) => {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch { /* 落到兜底 */ }

	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
};
```

关闭方式做了三种：右上角按钮、点遮罩、按 `Esc`。打开时给 `body` 加 `friend-modal-open` 锁住背景滚动。

### 坑二：弹窗跑到了屏幕外面

第一版弹窗写完，点开一看：**面板被挤到视口下方，底部按钮点不到，遮罩也只盖住了内容区的一小块。**

样式写的是最标准的居中：

```css
.friend-modal {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
}
```

`position: fixed` + `inset: 0` 理论上就该铺满视口。于是打印一下它的实际矩形：

```js
modal.getBoundingClientRect()
// { x: 312, y: 423, w: 936, h: 1351 }  ← 视口是 1264×905
```

它根本没铺满视口，而是铺满了一个 936×1351 的**别的元素**。顺着父级往上找，答案出现了：

```
DIV#content-wrapper.onload-animation   flags: [ 'transform:matrix(1, 0, 0, 1, 0, 0)' ]
```

**`#content-wrapper` 上有一个 transform** —— 就是主题入场动画留下的 `matrix(1,0,0,1,0,0)`，一个"什么都没做"的单位矩阵。

但按 CSS 规范，**只要元素有 transform（哪怕是单位矩阵），它就成为后代 `position: fixed` 的包含块**。所以 `inset: 0` 铺满的是这个 wrapper，而不是视口。wrapper 的高度是内容撑开的 1351px、位置在 y=423，弹窗自然就跟着跑偏了。

顺带一提，这个 wrapper 上还有 `backdrop-filter` 时同理（`filter`、`perspective`、`will-change: transform` 也会触发）。

**修法是把弹窗挂到 `body` 上**，让它脱离这个包含块：

```js
// 记住原位置，便于关闭后归位
const anchor = document.createComment("friend-modal-anchor");
root.parentNode.insertBefore(anchor, root);

const open = () => {
	if (root.parentNode !== document.body) {
		document.body.appendChild(root);
	}
	root.hidden = false;
	document.body.classList.add("friend-modal-open");
};

const close = () => {
	root.hidden = true;
	document.body.classList.remove("friend-modal-open");
	// 归位，让节点跟随页面内容一起被 Swup 回收
	if (anchor.parentNode) {
		anchor.parentNode.insertBefore(root, anchor.nextSibling);
	}
};
```

关闭时归位这一步别省：弹窗留在 `body` 上虽然能用，但 Swup 切页时它不会被换掉，下次进 `/friends/` 会看到上一个页面残留的弹窗。所以我在 `initModal()` 开头也加了一句清理：

```js
document.querySelectorAll("body > [data-modal-root]").forEach((el) => el.remove());
```

**另一个连带问题**：弹窗挂到 `body` 后就脱离了页面内容的层叠上下文，得直接和主题的全局浮层比 `z-index`。主题的浮动控件是 `z-1000`、移动端导航面板是 `z-1100`，所以我把它设成 `1200`：

```css
.friend-modal {
	position: fixed;
	inset: 0;
	z-index: 1200; /* > 主题浮动控件 z-1000、移动端导航 z-1100 */
	...
}
```

高度也顺手换成 `dvh`，避免移动端浏览器地址栏收缩时面板底部被吃掉：

```css
.friend-modal-panel {
	max-height: min(85dvh, 85vh, 44rem);
}
```

修完复测：`modalRect` 变成 `{x:0, y:0, w:1264, h:905}`，与视口完全一致；面板居中且完整可见；底部按钮在滚动后仍可点到。

这个坑最值得记的地方是：**错误不在弹窗自己的样式里，而在一个八竿子打不着的祖先元素上。** 排查时不要盯着 `position: fixed` 反复看，直接打印 `getBoundingClientRect()` 对比视口尺寸，再用循环往上找带 `transform` / `filter` 的祖先，比猜快得多。

## 八、和底部自定义区怎么分工

`friends.mdx` 渲染在卡片网格下方。原来我把本站信息、申请流程、注意事项都写在这里 —— 现在弹窗已经承载了这些内容，两边重复会让页面显得啰嗦。

我的处理是让它们分工：**弹窗负责"怎么办"（可操作、可复制），`friends.mdx` 负责"为什么"** —— 写了会优先通过哪些站点、什么情况会被移除。如果你不需要底部内容，把 `showCustomContent` 设为 `false` 即可。

## 九、多语言

新增的文案都进了 i18n，六种语言包（`zh_CN` / `zh_TW` / `en` / `ja` / `ko` / `ru`）同步补齐，包括「如何申请友链」「超时」「已复制」等：

```ts
friendsApplyHow = "friendsApplyHow",
friendsLatencyTimeout = "friendsLatencyTimeout",
friendsCopy = "friendsCopy",
friendsCopied = "friendsCopied",
```

延时徽章的超时文案通过 `data-timeout-label` 传给客户端脚本，这样脚本里不需要判断当前语言。

## 十、验收清单

改完建议逐条过一遍：

- [ ] `/friends/` 可打开，导航有友链入口
- [ ] 卡片显示站名、域名、简介、Tag 角标，一排三列
- [ ] 点击卡片在新标签打开 `siteurl`
- [ ] 搜索能按站名 / 简介 / 域名 / 标签过滤
- [ ] Tag 切换正确，指示条滑动到位，切换后回到第 1 页
- [ ] 友链多于 `pageSize` 时出现分页，首尾页按钮正确禁用
- [ ] 卡片进入视口后头像才加载，延时徽章从「检测中」变成数值或「超时」
- [ ] 绿 / 橙 / 红阈值符合 `latencyGoodMs` / `latencyTimeout` 预期
- [ ] 申请弹窗可打开，**面板完整居中在视口内、底部按钮点得到**
- [ ] 弹窗关闭后页面能正常滚动，再次打开仍然居中
- [ ] 本站信息可复制，`Esc` / 遮罩 / 右上角按钮都能关闭
- [ ] `showCustomContent: false` 时底部 MDX 消失
- [ ] `siteConfig.pages.friends = false` 时 `/friends/` 返回 404

## 十一、常见问题

| 现象 | 排查方向 |
| --- | --- |
| 筛选 / 分页点了没反应 | 先看 `document.readyState`；大概率是 `DOMContentLoaded` 被第三方资源卡住 |
| **弹窗偏到屏幕外 / 底部按钮点不到** | 祖先元素有 `transform` / `filter` / `perspective`，成了 `position: fixed` 的包含块；把弹窗挂到 `body` |
| 弹窗被导航栏盖住 | 弹窗挂在 `body` 后要和全局浮层比 `z-index`（主题用 `z-1000` / `z-1100`） |
| 切页后残留上一个页面的弹窗 | 弹窗留在 `body` 上不会被 Swup 回收；初始化时清理 `body > [data-modal-root]` |
| 延时一直「超时」 | 对方站点不可达、HTTPS 混合内容、广告拦截扩展，或 `latencyTimeout` 太短 |
| 延时全绿但数值偏大 | 正常，测的是访客到对方的路径；可调高 `latencyGoodMs` |
| 头像不显示 | `imgurl` 是否可访问、图床是否防盗链、卡片是否已滚入当前页 |
| 预览图空白 | 是否填了 `previewurl` 或开了 `autoPreview`；第三方截图服务国内可能失败 |
| 申请按钮不出现 | 需 `applyLink` / `siteInfo` / 评论区实际开启，三者之一 |
| 排序不对 | `randomizeSort: true` 会忽略 `weight`；否则检查 `weight` 大小 |
| 弹窗里文字在暗色下发黑 | 检查是否漏了 `:root.dark` 下的颜色覆盖 |
| Tag 指示条错位 | 中文字体加载后按钮宽度会变，需要在 `document.fonts.ready` 后重算一次 |

## 十二、相关文件

页面：[src/pages/friends.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/pages/friends.astro)

卡片：[src/components/features/FriendCard.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/features/FriendCard.astro)

弹窗：[src/components/features/FriendRulesModal.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/features/FriendRulesModal.astro)

配置：[src/config/friendsConfig.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/config/friendsConfig.ts)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

## 🔗 最后

感谢[毛の博客](https://blog.huchao.vip/posts/astro/firefly-friends-page/)的原始设计与卡片视觉，延时徽章、申请弹窗和极光票卡的方向都来自那一页。

这次最有价值的收获不是那些功能，而是两个坑的共同点：**它们都不报错。** `DOMContentLoaded` 被第三方资源卡住时，交互静默失效、控制台一片干净；`transform` 让弹窗错位时，CSS 语法完全正确、样式表里挑不出毛病。这类问题只能靠"打印实际数值再和预期对比"来定位 —— `document.readyState`、`getBoundingClientRect()`，两个最朴素的 API 就够了。

如果你也在给页面写交互，建议初始化别只挂在 `DOMContentLoaded` 上；写 `position: fixed` 的浮层时，先确认它的祖先链里没有 `transform`。
