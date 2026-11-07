---
title: '给博客导航栏复刻 Apple 液态玻璃（Liquid Glass）'
slug: 'liquid-glass-navbar'
published: 2026-11-08
description: '用 backdrop-filter 毛玻璃 + SVG 湍流置换滤镜，给 Astro 博客的导航栏、下拉面板和首页图标复刻 Apple Liquid Glass 材质，并把折射强度、波纹密度、模糊度做成设置面板滑块。'
category: 页面改造
tags: [CSS, SVG, 液态玻璃]
draft: false
pinned: false
---

苹果在 iOS 26 引入的 Liquid Glass（液态玻璃）那种"背景透过玻璃流动扭曲"的质感，其实用纯前端手段就能复刻得八九不离十。本文记录我把参考实现移植到自己博客的完整过程：导航栏、下拉菜单、浮动面板、首页标题图标全部换上这种材质，还顺手把它做成了设置面板里的三个可调滑块。效果直接看本站导航栏就行——把鼠标悬停在"文章"上，或者滚动首页，背景透过玻璃的流动感肉眼可见。

## 一、参考实现拆解

社区里最经典的参考是 lucasromerodb 在 CodePen 上的 [Liquid Glass](https://codepen.io/lucasromerodb/pen/vEOWpYM)。它的结构是四层叠加：

```text
┌─ liquidGlass-text    内容层（图标/文字，永不被扭曲）
├─ liquidGlass-shine   高光层（斜向内阴影，模拟玻璃边缘反光）
├─ liquidGlass-tint    着色层（半透明白，让玻璃"发白"）
└─ liquidGlass-effect  玻璃层（backdrop-filter 模糊 + SVG 滤镜折射）
```

其中玻璃层是灵魂，它同时挂了两个滤镜：

```css
.liquidGlass-effect {
    position: absolute;
    inset: 0;
    backdrop-filter: blur(3px);
    filter: url(#glass-distortion);
    overflow: hidden;
    isolation: isolate;
}
```

`backdrop-filter: blur()` 负责磨砂；`filter: url(#glass-distortion)` 负责折射——注意这两个滤镜不是一回事：**backdrop-filter 只处理元素背后的背景，而元素自身的 filter 会把自己渲染出来的所有东西（包括 backdrop-filter 的输出）一起再处理一遍**。正是这个"套娃"，让模糊后的背景被 SVG 滤镜扭曲出流动感。

SVG 滤镜本体只有三个核心原语：

```xml
<filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%"
        color-interpolation-filters="sRGB">
    <!-- 1. 生成噪声图 -->
    <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01"
                  numOctaves="1" seed="5" result="noise" />
    <!-- 2. 把噪声抹平成平滑的位移图 -->
    <feGaussianBlur in="noise" stdDeviation="3" result="soft-noise" />
    <!-- 3. 按位移图扭曲输入 -->
    <feDisplacementMap in="SourceGraphic" in2="soft-noise" scale="150"
                       xChannelSelector="R" yChannelSelector="G" />
</filter>
```

三个参数各有分工：

| 原语 / 参数 | 作用 | 调大 | 调小 |
| --- | --- | --- | --- |
| `feTurbulence@baseFrequency` | 噪声频率，决定波纹密度 | 波纹细碎 | 波纹宽缓 |
| `feGaussianBlur@stdDeviation` | 噪声平滑度 | 波形更圆润 | 波形更尖锐 |
| `feDisplacementMap@scale` | 位移强度 | 扭曲剧烈 | 接近无折射 |

`feDisplacementMap` 的原理是拿位移图每个像素的 R 通道值算水平偏移（`scale × (R - 0.5)`）、G 通道算垂直偏移，所以噪声图的通道分布直接决定扭曲的形态。

## 二、挂到导航栏：为什么在 ::before 上

我的主题里导航栏本来就有毛玻璃，但架构上有个关键约束：**磨砂层在 `#navbar > div::before` 上，而不是面板本体**。这不是为了好看——

> 给元素本体加 `backdrop-filter`，这个元素就会成为后代元素的 **backdrop root**。它内部的子面板再想磨砂，就只能采样本体内部的内容，采不到真正的页面背景，毛玻璃直接失效。

所以液态玻璃的折射滤镜必须和磨砂一起挂在 `::before` 上，文字内容留在正常文档流里，永远锐利：

```css
#navbar > div::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    backdrop-filter: blur(var(--navbar-surface-blur, 0px));
}

/* 折射开关由设置项控制：html[data-glass-distortion="on"] */
html[data-glass-distortion="on"] #navbar[data-glass="on"] > div::before {
    filter: url(#navbar-glass-distortion);
}
```

高光层用 `::after` 复刻参考站的斜向内阴影，它不被扭曲，始终保持锐利：

```css
#navbar[data-glass="on"] > div::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1; /* ::after 在树序上晚于 ::before，绘制在其上方、内容之下 */
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
        inset 2px 2px 1px 0 var(--navbar-glass-shine),
        inset -1px -1px 1px 1px var(--navbar-glass-shine);
}
```

有一个必须处理的边界：我的主题里有"下滑前导航栏完全透明"的动态模式。透明阶段玻璃面并不存在，如果折射滤镜还开着，就会把**清晰**的壁纸扭出一道波浪带，非常难看。所以折射和高光都用 `data-glass` / `data-glass-distortion` 两个开关把守，只在磨砂真正存在的状态下生效。

## 三、推广到面板和图标：三个真实的坑

把同样的结构搬到下拉菜单、浮动面板和首页标题图标时，踩了三个很有代表性的坑。

### 坑一：backdrop root（上面已经提到，再强调一次）

面板原本体上挂着 `backdrop-filter: blur() saturate()`。想加折射，第一反应是把 `filter: url(...)` 也挂本体——**不行**，那会把面板里的文字一起扭曲。正确做法是把磨砂从本体下移到 `::before`，折射挂在同一个 `::before` 上，本体只留底色、边框和高光。

### 坑二：relative 激活了隐藏的 top 偏移

`.dropdown-content` 原本是静态定位，为了让 `::before` 有定位包含块，我给它加了 `position: relative`——结果整个下拉菜单凭空下坠了 84px。排查半天才发现：它的基类 `.float-panel` 里躺着一个 `top-21`（84px），静态时 `top` 不生效，改 relative 后立刻激活。解法很简单，`@apply relative top-0` 把它归零：

```css
.dropdown-content {
    /* top-0 抵消 .float-panel 基类的 top-21 */
    @apply relative top-0 bg-(--card-bg) rounded-(--radius-large) ...;
}
```

教训：**给"本来静态"的元素加定位之前，先翻一遍它继承的类里有没有 top/bottom 这类"静态时休眠"的属性。**

### 坑三：淡入瞬间的玻璃闪烁

面板关闭时是 `opacity: 0`，浏览器对全透明元素会跳过绘制，玻璃层的滤镜结果自然没有缓存；淡入的第一帧才开始现算磨砂+折射，于是先露出无玻璃的底色，过一两帧才补上。给玻璃层加一行：

```css
::before {
    will-change: backdrop-filter;
}
```

让浏览器把它常驻为合成层、滤镜结果可复用，闪烁就消失了。

另外还有个滚动相关的细节：玻璃层是 `position: absolute; inset: 0` 的伪元素，如果**面板自身**是滚动容器，玻璃层会跟着内容一起滚走，滚到底部就露出一条没磨砂的"破洞"。所以把设置面板、搜索面板的滚动都内层化了一层（面板只负责玻璃，内层 div 负责滚动）。

## 四、把参数做成设置面板滑块

参考站的参数是写死的，但我想让"折射强度、波纹密度、玻璃模糊度"都能在设置面板里实时调。这里有个硬约束：**SVG 滤镜属性没法被 CSS 变量驱动**——`feDisplacementMap` 的 `scale` 是 SVG 属性，CSS 自定义属性传不进去，只能走 JS：

```ts
function applyNavbarGlassParamsToDocument(scale: number, frequency: number) {
    const turbulence = document.querySelector(
        "#navbar-glass-distortion feTurbulence",
    );
    turbulence?.setAttribute("baseFrequency", `${frequency} ${frequency.toFixed(4)}`);
    const displacement = document.querySelector(
        "#navbar-glass-distortion feDisplacementMap",
    );
    displacement?.setAttribute("scale", String(Math.round(scale)));
}
```

blur 则可以走 CSS 变量：导航栏和子面板分别消费 `--navbar-glass-blur` 和 `--navbar-panel-blur`，滑块只负责写变量。

持久化和防闪烁的配合是这套设计里我觉得最值得记录的部分：

1. 滑块拖动 → 写 localStorage → 实时应用（变量 + SVG 属性 + 开关属性）；
2. 页面加载时，Navbar 组件里有一段**解析期内联脚本**（`is:inline`，同步执行，早于首帧绘制），它在首帧前读 localStorage 把参数和开关同步到位——所以刷新页面不会看到"默认参数闪一下再变成用户参数"。

中途还抓到一个隐蔽 bug：主题里有个 `updateNavbarTransparency()` 会在 Swup 切页时按**配置文件**重写 blur 变量，把用户滑块的值静默覆盖掉。切页一次丢一次设置，非常诡异。修法是让这个函数也尊重 localStorage 覆盖，并且顺手把 `data-glass`、折射开关一起同步。

## 五、兼容性与性能

- **Chrome / Edge**：完整效果，磨砂 + 折射 + 高光。
- **Firefox**：基本可用，个别版本对 SVG 滤镜在 backdrop 输出上的应用略有差异。
- **Safari**：不支持用元素滤镜扭曲 backdrop 结果，会安全退化成普通毛玻璃（磨砂 + 高光仍在），不会白屏也不会报错。
- **性能**：displacement 滤镜每帧重算，全宽导航栏 + 多个面板有一定 GPU 开销。实测桌面端无感；低配设备可以把折射强度调低，或者干脆滑块归零只留磨砂。
- **降级链路**：折射强度 0 → 自动摘掉滤镜只留磨砂；壁纸纯色模式 → 无背景可折射，整套玻璃自动关闭。

## 六、调参建议

| 想要的效果 | 模糊度 | 折射强度 | 波纹密度 |
| --- | --- | --- | --- |
| 参考 CodePen 原版（通透、扭曲强） | 3px | 150 | 0.01 |
| 克制的高质感（我的推荐） | 10–15px | 60–100 | 0.008 |
| 只留一点灵动 | 20px | 30 | 0.006 |

一个经验：**模糊度越低，折射越明显**——磨砂把细节抹掉之后，位移图扭曲的就只剩色块了。所以这两 个滑块要搭配着调，别单独拉满。

完整实现都在本站仓库里，想看细节的直接翻 `src/components/layout/Navbar.astro`（SVG 滤镜与首帧同步脚本）和 `src/styles/navbar.css`（玻璃层与开关体系）。
