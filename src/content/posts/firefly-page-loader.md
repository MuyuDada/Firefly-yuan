---
title: '为 Firefly 添加全屏页面加载动画：一只端着汉堡的像素小猫'
published: 2026-10-12
description: '参考 huchao 的 Firefly 页面加载器架构，用一张像素小猫 GIF 重做视觉：像素对话框 + 对话尾巴 + 汉堡进度条，配色直接取自 GIF 全局调色板。附带四个真实踩到的坑：同色导致小猫隐形、原图放大糊、暗色变量未覆盖、切页闪一下，以及上线一周后才发现的真正毛病——遮罩太频繁。'
image: api
category: 小组件
tags: [交互, 特效, 像素风]
draft: false
slug: firefly-page-loader
pinned: false
series: "Firefly 魔改实录"
---

Firefly 用 Swup 做无刷新切页，体感很快，但也带来一个小问题：**点击链接到新内容出现之间，只有顶部一根 3px 的进度条在动**。如果目标页面要等接口或图片，页面中段会有一段时间是「旧内容不动、新内容没来」的静止状态，看起来像是卡住了。

这篇文章记录我加一层**全屏加载遮罩**的过程。架构参考了 [huchao 的 Firefly 页面加载器](https://blog.huchao.vip/posts/astro/firefly-page-loader/)，但视觉完全重做——用一张像素小猫 GIF，把它设计成一个「小猫端着汉堡正在准备」的对话框。

## 一、先看效果

遮罩由三部分组成，全部围绕这张 112×112 的像素小猫：

| 部分 | 说明 |
| --- | --- |
| 像素对话框 | 用 4 向 `box-shadow` 描边做出无圆角的「像素角」，小猫 GIF 就坐在里面 |
| 对话尾巴 | 两级台阶，缺口处压住对话框下边框，和气泡连成一体 |
| 汉堡进度条 | 就是小猫手里那个汉堡：层叠渐变画出面包 / 芝士 / 番茄 / 肉饼 / 生菜，从左往右填满 |

配色不是随手挑的——**全部取自 GIF 的全局调色板**，这样遮罩和图片天然同源：

| 变量 | 色值 | 取自小猫的 |
| --- | --- | --- |
| `--pl-cream` | `#f2ead5` | 身体奶白 |
| `--pl-brown` | `#5c3013` | 深棕斑块 |
| `--pl-brown-light` | `#b06825` | 浅棕斑块 |
| `--pl-pink` | `#ff7c6b` | 腮红 / 耳内 |
| `--pl-pink-soft` | `#ff9e91` | 浅粉 |
| `--pl-blush` | `#f8c6b4` | 汉堡芝士层 |
| `--pl-tan` | `#bfab93` | 汉堡生菜层 |

## 二、涉及的文件

| 文件 | 作用 |
| --- | --- |
| `src/config/pageLoaderConfig.ts` | 开关、时长、样式、遮罩类型 |
| `src/types/pageLoaderConfig.ts` | 配置类型 |
| `src/components/features/PageLoader.astro` | 遮罩 DOM（服务端渲染） |
| `src/utils/page-loader.ts` | 显隐、进度、计时的控制器 |
| `src/types/page-loader.ts` | 管理器接口 |
| `src/styles/components/page-loader.css` | 全部视觉与动画 |
| `src/utils/swup-transitions.ts` | 接入 `visit:start` / `visit:end` |
| `src/layouts/Layout.astro` | 挂载点 |
| `src/i18n/*` | 文案（6 种语言） |
| `public/assets/images/loading-cat.gif` | 像素小猫素材 |

## 三、配置

`src/config/pageLoaderConfig.ts` 是唯一需要改的地方：

```typescript title="src/config/pageLoaderConfig.ts"
export const pageLoaderConfig: PageLoaderConfig = {
	enable: true,                          // 是否启用全屏加载动画
	showOnInitial: true,                   // 首次进入站点时显示
	showOnNavigate: false,                 // Swup 切页时显示（打开后仍需超过 delayOnNavigate 才出现）
	showOnMobile: false,                   // 移动端（<768px）显示
	style: "cat",                          // 猫咪主题：图片 + 像素气泡 + 汉堡进度条
	image: "/assets/images/loading-cat.gif", // 像素小猫（本地资源，避免 CDN 往返）
	text: "",                              // 留空则使用 i18n 文案

	// 频率控制
	oncePerSession: true,                  // 同一标签页只播一次首屏，刷新/前进后退跳过
	minInterval: 2500,                     // 两次展示的最小间隔（ms）
	delayOnNavigate: 400,                  // 切页延迟显示（ms），快于此值不出现遮罩

	// 时长控制
	minDuration: 700,                      // 首屏最短显示时长（ms）
	initialGrace: 1200,                    // 首屏最长等待就绪时间（ms），0 = 死等 load
	maxWait: 2600,                         // 最长等待时长（ms），超时强制隐藏
	hideDelay: 120,                        // 就绪后延迟隐藏（ms）

	backdrop: "blur",                      // 毛玻璃遮罩
	zIndex: 10000,                         // 高于导航栏（20）与进度条（9999）
};
```

| 想要 | 改什么 |
| --- | --- |
| 完全关掉 | `enable: false` |
| 只在切页时出现 | `showOnInitial: false` |
| 手机上不要 | `showOnMobile: false` |
| 每次刷新都想看 | `oncePerSession: false` |
| 切页也要出现 | `showOnNavigate: true` + 调大 `delayOnNavigate` |
| 换成自己的图 | `image` 指向 `public/` 下的任意图片 |
| 不要毛玻璃 | `backdrop: "solid"` 或 `"theme"` |
| 想多停留一会 | 调大 `minDuration` |

## 四、实现细节

### 为什么必须挂在 Swup 容器之外

这是整件事最关键的一条约束。Firefly 的 Swup 配置里只声明了六个替换容器：

```javascript title="astro.config.mjs"
containers: [
	"#banner-overlay-container",
	"#banner-dim-container",
	"#swup-container",
	"#left-sidebar-dynamic",
	"#right-sidebar-dynamic",
	"#floating-toc-wrapper",
],
```

**只有这六个容器里的内容会被替换**，`<body>` 上其他元素跨页面存活。把遮罩挂在 `Layout.astro` 的 `</body>` 前，它就永远不会被 Swup 拆掉——切页时复用同一个 DOM，不需要重建、也不会闪。

代价是：模块脚本在切页后会被重新执行。所以 `initPageLoader()` 必须幂等：

```typescript title="src/utils/page-loader.ts"
export function initPageLoader(): void {
	if (window.__fireflyPageLoaderInit) return;
	window.__fireflyPageLoaderInit = true;
	const manager = new PageLoaderManager();
	manager.init();
	window.pageLoaderManager = manager;
}
```

这和 Firefly 里 `SakuraEffect`、`FairyDustEffect` 等特效的做法完全一致，是这套架构的通用约定。

### 首屏不白屏：遮罩由服务端渲染

很多加载动画是「脚本跑起来才创建 DOM」，那样首屏会先闪一下白，再出现遮罩，反而更难看。

这里的做法是**遮罩由 Astro 服务端直接渲染成可见态**，脚本只负责「收起」：

```astro title="src/components/features/PageLoader.astro"
const initiallyHidden = !showOnInitial;
```

只有 `showOnInitial: false` 时才以隐藏态渲染。其余情况下，HTML 一到浏览器遮罩就已经在了，脚本等页面就绪后淡出。

「就绪」不等于 `load`。`load` 要等壁纸、字体、全部图片都下完，首页很容易被它一路拖到 `maxWait`，观感上就是「明明内容早出来了，遮罩还赖着不动」。所以现在取 `load` 与 `initialGrace`（默认 1200ms）先到者：

```typescript title="src/utils/page-loader.ts"
// load 要等壁纸、字体、全部图片就绪，首屏常被拖到 maxWait 才有反应；
// initialGrace 到点先松手，剩下的资源让页面自己补齐（0 = 关掉兜底，死等 load）
this.graceTimer = window.setTimeout(done, pageLoaderConfig.initialGrace);
```

### 进度条就是小猫手里的汉堡

进度填充用 `transform: scaleX()` 而不是 `width`，因为 transform 走合成线程，不触发回流：

```css title="src/styles/components/page-loader.css"
.page-loader__burger-fill {
	transform: scaleX(var(--pl-progress));
	transform-origin: left center;
	transition: transform 220ms linear;
	will-change: transform;
}
```

汉堡的层次感来自一条多段线性渐变：

```css
background: linear-gradient(
	to bottom,
	#b06825 0 34%,     /* 上层面包 */
	#f8c6b4 34% 43%,   /* 芝士 */
	#ff7c6b 43% 55%,   /* 番茄 */
	#5c3013 55% 77%,   /* 肉饼 */
	#bfab93 77% 86%,   /* 生菜 */
	#975720 86% 100%   /* 下层面包 */
);
```

同一套渐变铺两层：`-ghost` 降透明度当作「空槽」，`-fill` 叠在上面被 `scaleX` 裁切。芝麻和刻度放在第三层 `.page-loader__burger-ticks`，**故意不参与缩放**，所以进度推进时刻度纹丝不动。

进度爬升不是匀速的——越接近上限爬得越慢，形成自然的「卡在最后一点」观感：

```typescript title="src/utils/page-loader.ts"
const step = (PROGRESS_CEILING - this.progress) * 0.12;
this.progress = Math.min(PROGRESS_CEILING, this.progress + step);
```

上限是 `0.9`，剩下 10% 留给真正完成时补满。

### 像素感是怎么做出来的

三个要点，缺一个都会「糊」：

1. **描边不能用 `border`**。圆角是像素风的天敌，用 4 向 `box-shadow` 外扩才能得到硬边直角：

```css
box-shadow:
	calc(var(--pl-pixel) * -1) 0 0 0 var(--pl-line),
	var(--pl-pixel) 0 0 0 var(--pl-line),
	0 calc(var(--pl-pixel) * -1) 0 var(--pl-line),
	0 var(--pl-pixel) 0 0 var(--pl-line);
```

2. **GIF 放大必须 `pixelated`**。原图只有 112px，展示要 168px，浏览器默认的双线性插值会把像素边缘糊掉：

```css
.page-loader__cat {
	width: 168px;
	height: 168px;
	image-rendering: pixelated;
	-ms-interpolation-mode: nearest-neighbor;
}
```

3. **闪烁用 `steps(1, end)`**。缓动会让透明度渐变，而像素画的闪烁应该是硬切换：

```css
.page-loader__sparkle {
	animation: pl-blink 1.6s steps(1, end) infinite;
}
```

### 生命周期与三个计时器

控制器一共管三个时间量，分别解决三个不同的问题：

| 配置 | 解决的问题 |
| --- | --- |
| `minDuration` | 加载太快时遮罩只闪一下，比不加还难看——用最短展示时长兜住（只兜首屏） |
| `maxWait` | 万一 `visit:end` 没触发（网络挂了、Swup 报错），遮罩会永久盖住页面——超时强制退场 |
| `hideDelay` | 页面就绪与遮罩淡出同帧会显得突兀——延后一点点 |
| `initialGrace` | 首屏别死等 `load`：壁纸和字体很容易把它拖到 `maxWait` |

```typescript title="src/utils/page-loader.ts"
hide(options: { instant?: boolean } = {}): void {
	if (this.disabled || !this.el || !this.visible) return;
	this.clearTimers();

	if (options.instant) {
		this.finish();
		return;
	}

	const elapsed = performance.now() - this.shownAt;
	const wait = Math.max(0, this.floorMs - elapsed) + pageLoaderConfig.hideDelay;
	this.hideTimer = window.setTimeout(() => this.finish(), wait);
}
```

进度条复位时有个小细节：从 100% 直接写回 0% 会看到进度条「倒着退回去」。所以复位前先加一个禁用过渡的类，写完强制提交样式再移除：

```typescript title="src/utils/page-loader.ts"
private resetProgress(): void {
	if (!this.el) return;
	this.progress = 0;
	this.el.classList.add("page-loader--reset");
	this.writeProgress();
	void this.el.offsetWidth; // 强制提交样式，保证下一次写入重新走过渡
	this.el.classList.remove("page-loader--reset");
}
```

### 频率策略：只在真正慢的时候出现

第一版上线后自己用了一周，最大的问题不是难看，是**太频繁**：每次打开站点、每次刷新，都得先看一遍小猫；而它挡住的那 1–2 秒里，页面其实早就画好了。加载动画的价值在于「填充等待」，等待不存在的时候，它只是在收过路费。

所以频率由三层把关，配置里的 `oncePerSession` / `delayOnNavigate` / `minInterval` 分别对应：

**一、同一标签页只播一次首屏。** 用 `sessionStorage` 记一个标记（跨刷新保留、换新标签页重置）：

```typescript title="src/utils/page-loader.ts"
private seenThisSession(): boolean {
	if (!pageLoaderConfig.oncePerSession) return false;
	try {
		return window.sessionStorage.getItem(SESSION_KEY) === "1";
	} catch {
		// 隐私模式 / 禁用存储：退化成「每次都播」，不影响功能
		return false;
	}
}
```

麻烦的是**闪一帧**：遮罩是服务端渲染的可见态，JS 要等模块下载执行才知道「这一轮该跳过」，中间那一帧遮罩已经画出来了，刷新时会明显抖一下。

解法是把判断提前到解析阶段——在遮罩 DOM 之前插一段 `is:inline` 脚本，直接给 `<html>` 打标记，CSS 在脚本接管前就把遮罩压住：

```astro title="src/components/features/PageLoader.astro"
<script is:inline>
	try {
		if (sessionStorage.getItem("firefly:page-loader:shown") === "1") {
			document.documentElement.setAttribute("data-page-loader-seen", "");
		}
	} catch {}
</script>
```

```css title="src/styles/components/page-loader.css"
/* 加上 .page-loader--js 后本规则失效，显隐完全交给 JS 管理 */
html[data-page-loader-seen] #page-loader:not(.page-loader--js) {
	opacity: 0;
	visibility: hidden;
}
```

`is:inline` 保证脚本原地执行、按文档顺序排在遮罩前面，这一帧的窗口就没了。

**二、切页延迟显示。** 与其等遮罩出现了再想办法让它多停一会，不如**先别出现**——`delayOnNavigate` 到点后才淡入，导航在这之前完成就什么都没发生：

```typescript title="src/utils/page-loader.ts"
this.pending = true;
this.showTimer = window.setTimeout(() => {
	this.showTimer = null;
	this.pending = false;
	this.reveal(source);
}, pageLoaderConfig.delayOnNavigate);
```

配套地，`hide()` 发现还在等待期就直接取消，而不是去走「最短时长 + 延迟隐藏」那套：

```typescript title="src/utils/page-loader.ts"
// 还停在延迟等待里：说明这次加载够快，直接取消，遮罩从头到尾没出现过
if (this.pending) {
	this.cancelPending();
	return;
}
```

**三、冷却。** 两次展示之间至少隔 `minInterval`，连点几个链接也不会来回闪。

顺带修掉一个真实竞态：`finish()` 里那个 400ms 后复位进度的定时器原先没进 `clearTimers()`。如果新一轮展示在它触发前开始，进度条会被上一轮从 100% **倒着拉回** 0，看起来像倒退。现在所有定时器统一登记、统一清理。

### 接入 Swup 钩子

只加两行，与原有的顶部进度条共存：

```typescript title="src/utils/swup-transitions.ts"
window.swup.hooks.on("visit:start", (visit) => {
	startProgressBar();
	showPageLoader("navigate");   // ← 新增
	// ...
});

window.swup.hooks.on("visit:end", () => {
	finishProgressBar();
	hidePageLoader();             // ← 新增
	// ...
});
```

### 两道兜底

**脚本没跑起来**（被广告拦截、JS 报错）时，遮罩会永久盖住整站。CSS 里留了一个纯 CSS 兜底：只要脚本没执行，`.page-loader--js` 类就不会被加上，8 秒后遮罩自行退场。

```css
#page-loader:not(.page-loader--js) {
	animation: pl-failsafe 400ms ease 8s forwards;
}
```

**用户偏好减少动效**时，关掉所有装饰动画，只保留淡入淡出：

```css
@media (prefers-reduced-motion: reduce) {
	.page-loader__bubble,
	.page-loader__tail,
	.page-loader__sparkle,
	.page-loader__cat,
	.page-loader__dots i {
		animation: none;
	}

	.page-loader__burger-fill {
		transition: none;
	}
}
```

对应的 JS 侧也会跳过进度轮询，不再定时写 CSS 变量。

## 五、踩到的四个坑

### 坑一：小猫在对话框里「隐形」了

第一次跑起来，对话框里是一个**空白奶白方块**。

原因很直白：小猫身体的颜色是 `#F2EAD5`，而我把对话框底色也设成了 `#f2ead5`——**两个值完全相同**，奶白猫糊在奶白气泡里，边界彻底消失。

修法不是改图片，而是让对话框比小猫深一档：

```css
/* 必须比小猫身体(#F2EAD5)深一档，否则奶白猫会糊在奶白气泡里 */
--pl-bubble: #d9cbb5;
```

暗色模式下再压深一次（`#a8917a`）。

**教训**：用图片本身的主色当背景时，一定要确认两者不是同一个值。像素画的边缘本来就靠色块区分，同色等于没有边缘。

### 坑二：112px 的像素画根本看不清

按原图尺寸 `112px` 展示，像素细节全糊在一起，看不出是猫。

像素画**只能整数倍或接近整数倍放大**，同时必须配 `image-rendering: pixelated`。最后定在 `168px`（1.5 倍），并把像素基准从 `6px` 提到 `7px`、对话框内边距从 `16px` 提到 `20px`，让整个对话框的比例跟上。

### 坑三：暗色模式下文字看不见

文案原本用的是 `var(--deep-text)`。这个变量在 `src/styles/variables.styl` 里**只在亮色的 `:root` 中定义**：

```stylus
:root {
	--deep-text: oklch(0.25 0.02 var(--hue))  // 只在亮色定义
}
```

暗色块覆盖了 `--line-divider`、`--content-meta`、`--muted`，但**没有覆盖 `--deep-text`**。结果就是暗色下文字仍是深色，糊在深色遮罩上完全看不见。

修法是给遮罩自己定义一对文案色变量，两套主题各自给值：

```css
#page-loader {
	--pl-text: var(--deep-text);
	--pl-text-soft: var(--content-meta);
}

:root.dark #page-loader {
	--pl-text: #f2ead5;
	--pl-text-soft: rgba(242, 234, 213, 0.62);
}
```

**教训**：跨主题复用的组件不要直接依赖「只在单侧主题定义」的变量。用之前先确认它在 `:root.dark` 里也有值。

### 坑四：切页时遮罩只闪了一下

最初 `minDuration` 只作用于首屏，切页不设下限。想法是「切页本来就快，不该拖慢」。

实测下来是错的：Swup 有 `preload: { hover: true, visible: true }`，鼠标悬停时目标页就已经预取完了，所以 `visit:end` 常常在 **100ms 内**就触发。遮罩出现又消失，用户只看到一闪，既看不清内容，又像是页面抖了一下。

改成切页同样受 `minDuration` 约束：

```typescript title="src/utils/page-loader.ts"
// 切页同样受 minDuration 约束：Swup 预加载后导航常在 100ms 内完成，
// 若不留下限，遮罩只会闪一下，既看不清又像卡顿
this.floorMs = pageLoaderConfig.minDuration;
```

改完后实测时间线（点击 → 遮罩消失）：

```
181ms   visible   progress 0.000
412ms   visible   progress 0.203
1200ms  visible   progress 0.576
2418ms  visible   progress 0.750
2650ms  hidden    progress 1.000
3007ms  hidden    progress 0.000   ← 复位完成，可复用
```

「不闪了」是解决了，但**代价是每次切页都要等 2.65 秒**——为了掩盖一个 100ms 的导航，硬加了两秒多的等待。这是典型的「用时长盖住频率问题」：症状消失，根因还在。

最终的方向反过来了：切页默认不出现（`showOnNavigate: false`），即便打开也先等 `delayOnNavigate`，只有真正慢的导航才看得见；`minDuration` 只兜首屏，不再叠加到切页上：

```typescript title="src/utils/page-loader.ts"
// 切页已经为「慢导航」等过 delayOnNavigate，再叠最短时长就太久了
this.floorMs = source === "navigate" ? 0 : pageLoaderConfig.minDuration;
```

**教训**：预加载越激进，「加载动画」越容易退化成「闪一下」。但「闪一下」的正确修法是让它**别出现**，而不是让它**多停一会**——凡是带最短时长的动画，先问一句「这次真的有人在等吗」。

## 六、相关文件

组件与样式：

- [/src/components/features/PageLoader.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/features/PageLoader.astro)
- [/src/styles/components/page-loader.css](https://github.com/muyudada/firefly-yuan/blob/master/src/styles/components/page-loader.css)
- [/public/assets/images/loading-cat.gif](https://github.com/muyudada/firefly-yuan/blob/master/public/assets/images/loading-cat.gif)

配置与类型：

- [/src/config/pageLoaderConfig.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/config/pageLoaderConfig.ts)
- [/src/types/pageLoaderConfig.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/types/pageLoaderConfig.ts)
- [/src/types/page-loader.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/types/page-loader.ts)

控制器与接入：

- [/src/utils/page-loader.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/utils/page-loader.ts)
- [/src/utils/swup-transitions.ts](https://github.com/muyudada/firefly-yuan/blob/master/src/utils/swup-transitions.ts)
- [/src/layouts/Layout.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/layouts/Layout.astro)

## 🔗 最后

真正花时间的不是画对话框或写渐变，而是四件事：**Swup 的容器边界**（决定了遮罩能不能活过切页）、**服务端渲染可见态**（决定了首屏会不会白闪）、**主题变量的覆盖范围**（决定了暗色下还能不能看见）、以及**最短时长要覆盖所有触发来源**（决定了它是动画还是闪烁）。

前两条是架构问题，后两条是那种「本地看着没问题、换个主题或换个页面就崩」的坑。如果你也想加一个，建议从 `pageLoaderConfig.ts` 开始——换图片、换配色、调时长都不用碰组件代码。

相关源码：[Firefly 博客 - 全屏页面加载动画](https://github.com/muyudada/firefly-yuan)
