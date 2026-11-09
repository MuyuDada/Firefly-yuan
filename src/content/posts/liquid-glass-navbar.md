---
title: '给博客导航栏复刻 Apple 液态玻璃（Liquid Glass）'
slug: 'liquid-glass-navbar'
published: 2026-11-08
updated: 2026-11-09
description: '从零复刻 Apple Liquid Glass：backdrop-filter 毛玻璃 + feTurbulence/feDisplacementMap 折射，逐行拆解 SVG 滤镜，做成三段岛式导航栏、下拉面板与首页图标，并把模糊度、折射强度、波纹密度接进设置面板滑块。含完整代码、调试手册与踩坑记录。'
category: 页面改造
tags: [CSS, SVG, 液态玻璃]
draft: false
pinned: false
---

苹果在 iOS 26 引入的 Liquid Glass（液态玻璃）那种"背景透过玻璃流动扭曲"的质感，其实用纯前端手段就能复刻得八九不离十。这篇文章把我移植到自己博客的全过程完整写下来：先给一个能直接保存运行的最小示例，再逐行拆解 SVG 滤镜，最后落地成三段岛式导航栏 + 下拉面板 + 首页图标，并把三个参数接进设置面板。

不想读原理的，可以直接跳到[第三节](#三先搭一个能跑的最小示例)复制那个单文件示例，改两个参数就能用。

## 一、先搞懂机制：两个滤镜的套娃

液态玻璃的核心只有一句话：**把元素背后的背景模糊，再把模糊后的结果扭曲一下**。

第一件事用 `backdrop-filter`，第二件事用 `filter`。这两个属性名字很像，但作用对象完全不同：

| 属性 | 处理的对象 | 结果 |
| --- | --- | --- |
| `backdrop-filter: blur(3px)` | 元素**背后**的页面内容 | 磨砂，元素自身不受影响 |
| `filter: url(#distortion)` | 元素**自己绘制出来的全部内容** | 扭曲，包括它采样到的背景 |

关键在于第二行的括号：`filter` 处理的是"这个元素最终渲染成的那张图"。而 `backdrop-filter` 的输出，恰好就是这张图的一部分。所以把两个属性写在同一个元素上，浏览器会先做背景模糊，再把模糊结果交给 `filter` 去扭曲——这就是套娃。

```css
.glass {
    backdrop-filter: blur(3px);       /* 第一步：糊掉背后的背景 */
    filter: url(#glass-distortion);   /* 第二步：把糊掉的背景扭一下 */
}
```

反过来就无效：`filter` 无法去扭曲"别的地方的"背景，因为它只拿得到自己这个元素的渲染结果。

### 一个必须先知道的副作用：backdrop root

给元素加 `backdrop-filter` 会让它成为一棵 **backdrop root**。翻译成人话：它变成了一堵墙，墙内后代的 `backdrop-filter` 只能采样到墙内部的东西，采不到真正的页面背景。

这直接决定了后面所有的结构设计。如果你要在一个玻璃面板里再放一个玻璃下拉菜单，两层玻璃都挂在各自元素本体上的话，内层会变成一块"什么都没糊到的透明色块"。正确做法是：**玻璃挂在 `::before` 伪元素上，元素本体不碰 `backdrop-filter`**。

```html
<!-- ✅ 层次：本体（底色/圆角） → ::before（磨砂+折射，z-index:-1） → 内容 -->
<div class="glass">
    <div class="glass__content">文字永远是锐利的</div>
</div>
```

```css
.glass { position: relative; background: rgba(255,255,255,.18); }
.glass::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;               /* 沉到内容之下、背景之上 */
    border-radius: inherit;
    backdrop-filter: blur(3px);
    filter: url(#glass-distortion);
    pointer-events: none;      /* 别挡住点击 */
}
```

`z-index: -1` 的伪元素为什么不会跑到父元素背景下面？因为负值伪元素排在父元素**背景之后、内容之前**，刚好是我们要的夹层。这个位置是白捡的，不需要额外层级管理。

## 二、逐行拆解 SVG 滤镜

滤镜本体是一段躺在 DOM 里、宽高为 0 的 SVG：

```xml
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
        <filter id="glass-distortion"
                x="0%" y="0%" width="100%" height="100%"
                color-interpolation-filters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01"
                          numOctaves="1" seed="5" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="3" result="soft-noise" />
            <feComponentTransfer in="soft-noise" result="displacement-map">
                <feFuncR type="linear" slope="3.5" intercept="-1.25" />
                <feFuncG type="linear" slope="3.5" intercept="-1.25" />
            </feComponentTransfer>
            <feDisplacementMap in="SourceGraphic" in2="displacement-map"
                               scale="150"
                               xChannelSelector="R" yChannelSelector="G" />
        </filter>
    </defs>
</svg>
```

四个原语是一条流水线：**造噪声 → 磨平噪声 → 拉对比度 → 按噪声挪像素**。

### 1. feTurbulence：造一张噪声图

```xml
<feTurbulence type="fractalNoise" baseFrequency="0.01 0.01" numOctaves="1" seed="5" />
```

- `type="fractalNoise"`：分形噪声。另一种 `turbulence` 更"锐利"，像大理石纹，用在玻璃上太脏，不推荐。
- `baseFrequency`：噪声频率，**这是控制波纹密度的旋钮**。0.01 意味着大约每 100px 一个起伏周期，视觉上就是"大块缓慢流动"；调到 0.05 立刻变成细密的水波。
- `numOctaves`：叠加几层不同频率的噪声。1 层就够了；2 层以上细节更丰富，但计算量翻倍，玻璃反而显得脏。
- `seed`：随机种子。换个数字就换一套波纹图案，嫌默认形状不好看可以试试别的值。

### 2. feGaussianBlur：把噪声磨平

```xml
<feGaussianBlur in="noise" stdDeviation="3" result="soft-noise" />
```

原始噪声是像素级的颗粒，直接拿去做位移会得到"碎玻璃渣"的效果。`stdDeviation` 相当于把噪声图高斯模糊一遍，让相邻像素的值连成一片，位移才会平滑。

- 调大（4–6）：波形更圆润，像水滴；
- 调小（1–2）：波形更尖锐，像砂纸；
- 直接不要这一步：折射会碎成噪点，基本不可用。

### 3. feComponentTransfer：这一步参考实现里没有，但必须加

这是我在移植时补的，也是最容易被忽略的一步。

`feTurbulence` 输出的像素值高度集中在 0.5 附近（大部分落在 0.35–0.65 之间）。而 `feDisplacementMap` 的偏移量公式是：

```text
偏移 = scale × (通道值 − 0.5)
```

也就是说，通道值越接近 0.5，位移越接近 0。`scale=150` 听起来很猛，但因为噪声值都挤在 0.5 附近，实际只用到了一小部分量程，折射效果十分微弱——尤其在壁纸本身已经有模糊的情况下（全屏模式下滑后背景是糊的），几乎看不出来。

补一个线性拉伸，把 [0.357, 0.643] 这段映射到满量程 [0, 1]：

```text
y = 3.5x − 1.25
```

```xml
<feComponentTransfer in="soft-noise" result="displacement-map">
    <feFuncR type="linear" slope="3.5" intercept="-1.25" />
    <feFuncG type="linear" slope="3.5" intercept="-1.25" />
</feComponentTransfer>
```

超出范围的值会被截断到 0 或 1。效果是位移图的动态范围被撑满，同样的 `scale` 下折射明显得多，而且边缘会出现轻微的"挤压感"，反而更像真玻璃。

两个细节：

- **只拉 R 和 G**。B 通道不参与位移计算（下面会讲），改了没意义。
- 这一步是"可调"的。`slope` 越大对比越强、折射越硬；如果觉得太夸张，把 `slope` 降到 2 左右就温和了。

### 4. feDisplacementMap：按噪声图挪像素

```xml
<feDisplacementMap in="SourceGraphic" in2="displacement-map"
                   scale="150"
                   xChannelSelector="R" yChannelSelector="G" />
```

- `in="SourceGraphic"`：被扭曲的对象，也就是模糊后的背景。
- `in2`：位移图。
- `xChannelSelector="R"` / `yChannelSelector="G"`：**用位移图的哪个通道决定水平/垂直偏移**。R 管左右、G 管上下，B 和 A 不用——所以上一步只拉 R/G。
- `scale`：位移幅度上限（像素）。150 意味着单个像素最多挪 150px(×通道值)，波纹大、扭曲强；30 以下基本只看到轻微抖动。

### 5. 外层 filter 的两个属性

```xml
<filter x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
```

- `x/y/width/height`：滤镜的作用区域。默认是 `-10% -10% 120% 120%`（留出 10% 余量给模糊溢出）。这里收成刚好 100%，是为了少一点边缘溢出。**但这个裁剪是方的**，管不住位移把像素推到圆角外的角落——所以还需要后面的 `clip-path`。
- `color-interpolation-filters="sRGB"`：默认滤镜运算在 linearRGB 空间做，颜色会偏灰、对比度被拉平。改成 sRGB 后视觉更接近设计稿。几乎所有的玻璃滤镜示例都会带这一行。

### 三个旋钮的直觉对照

| 参数 | 位置 | 调大 | 调小 |
| --- | --- | --- | --- |
| `baseFrequency` | feTurbulence | 波纹细碎、密集 | 波纹宽缓、大块流动 |
| `stdDeviation` | feGaussianBlur | 波形圆润、像水滴 | 波形尖锐、像磨砂渣 |
| `scale` | feDisplacementMap | 扭曲剧烈、边缘挤压明显 | 接近无折射、只剩模糊 |

## 三、先搭一个能跑的最小示例

原理说完了，先给你一个可以直接保存成 `.html` 双击打开的单文件版本。它只有一张玻璃卡片，但结构和最终版完全一致——后面所有内容都是在这上面加料。

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Liquid Glass 最小示例</title>
<style>
  html, body { margin: 0; height: 100%; }

  /* 背景：故意用高饱和色块 + 文字，方便观察折射 */
  body {
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 20% 30%, #ff7a59 0 18%, transparent 18%),
      radial-gradient(circle at 75% 65%, #4f8cff 0 22%, transparent 22%),
      radial-gradient(circle at 55% 15%, #ffd166 0 14%, transparent 14%),
      repeating-linear-gradient(45deg, #12121a 0 12px, #1b1b26 12px 24px);
  }

  .glass {
    position: relative;
    width: 320px;
    height: 120px;
    border-radius: 28px;
    display: grid;
    place-items: center;
    color: #fff;
    font: 600 20px/1 system-ui, sans-serif;
    letter-spacing: .02em;

    /* 底色 + 内衬白圈 + 投影：本体只负责这些，不带任何滤镜 */
    background: rgba(255, 255, 255, 0.12);
    box-shadow:
      inset 0 0 0 1.5px rgba(255, 255, 255, 0.4),
      0 8px 32px rgba(0, 0, 0, 0.35);
  }

  /* 玻璃层 */
  .glass::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    backdrop-filter: blur(3px) saturate(1.6);
    filter: url(#glass-distortion);
    /* 位移会让玻璃溢出圆角，滤镜之后再裁一次 */
    clip-path: inset(0 round 28px);
    will-change: backdrop-filter;
  }
</style>
</head>
<body>

<!-- 滤镜定义：宽高 0，不占位 -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%"
            color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01"
                    numOctaves="1" seed="5" result="noise" />
      <feGaussianBlur in="noise" stdDeviation="3" result="soft-noise" />
      <feComponentTransfer in="soft-noise" result="displacement-map">
        <feFuncR type="linear" slope="3.5" intercept="-1.25" />
        <feFuncG type="linear" slope="3.5" intercept="-1.25" />
      </feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="displacement-map"
                         scale="150" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </defs>
</svg>

<div class="glass">Liquid Glass</div>

</body>
</html>
```

打开后左右拖动窗口，你会看到玻璃后面的斜条纹和色块被"揉"了一下。如果把 `scale` 改成 0，画面立刻变成一层普通的毛玻璃——这个 A/B 对比是判断滤镜有没有生效最快的办法。

三个可以立刻动手的试验：

1. 把 `baseFrequency` 改成 `0.03`，条纹变细密；
2. 把 `feComponentTransfer` 整段删掉，折射几乎消失（这就是第二节讲的问题）；
3. 把 `clip-path` 删掉，圆角四个角会出现玻璃的方角残影。

## 四、搬进真实导航栏：结构先行

我的博客导航栏不是一整条横条，而是**三段独立的岛式胶囊**（布局参考 jerrynis.com）：Logo 岛、菜单岛、工具岛各自悬浮，外壳完全透明。

```text
#navbar > div              ← 外壳：只管定位与高度，背景透明、无边框、overflow-visible
  ├─ .navbar-island        ← Logo 岛
  ├─ .navbar-island        ← 菜单岛（lg 以上显示，居中或左对齐）
  └─ .navbar-island        ← 工具岛（搜索 / 音乐 / 设置 / 明暗 / 移动端菜单）
```

为什么改成岛式？一是视觉上更接近 iOS 26 的分组语言，二是菜单岛在窄屏可以整块隐藏，宽度天然自适应，不用再算"一整条横条还剩多少可用宽度"。

外壳被剥得只剩布局：

```css
#navbar > div {
    background: transparent;
    border: none;
    position: relative;
}
```

视觉全部落到岛上。岛本体只负责**底色、内衬白圈、投影**，一律不碰滤镜：

```css
.navbar-island {
    position: relative;
    height: 3rem;
    border-radius: 9999px;
    background: var(--navbar-island-bg, color-mix(in oklch, var(--card-bg) 26%, transparent));
    box-shadow:
        inset 0 0 0 1.5px var(--navbar-island-ring, rgba(255, 255, 255, 0.4)),
        0 2px 8px rgba(0, 0, 0, 0.22);
    transition:
        background-color 0.36s cubic-bezier(0.22, 1, 0.36, 1),
        box-shadow 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}
```

玻璃层在 `::before`：

```css
.navbar-island::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    /* 模糊度走 CSS 变量，滑块只负责写变量 */
    backdrop-filter: blur(var(--navbar-glass-blur, 18px)) saturate(1.6);
    /* 折射位移会把玻璃推进圆角弧线外的方角区域，滤镜后二次裁剪 */
    clip-path: inset(0 round 9999px);
    /* 常驻合成层，避免淡入/首帧玻璃闪烁 */
    will-change: backdrop-filter;
}

/* 折射开关：有毛玻璃面（data-glass=on）且折射强度 > 0 时才启用 */
html[data-glass-distortion="on"] #navbar[data-glass="on"] .navbar-island::before {
    filter: url(#navbar-glass-distortion);
}
```

三个数值值得单独说：

**26% 的卡片底色。** 比旧版条状玻璃透得多，背景色块几乎原样透上来。正因为透，模糊只要 3px 就够"玻璃"了；一味加 blur 反而会把背景糊成一块死灰，反而失去通透感。

**1.5px 的白圈内衬。** 这是这次重构里高光方案的换代。旧版用的是 `::after` 上的斜向双内阴影（`inset 2px 2px 1px`），那是给矩形条准备的；搬到 9999px 圆角的胶囊上之后，斜向阴影会在弧顶堆出一小块亮斑，看着像没擦干净的油点。改成等宽白圈，边缘干净得多。

白圈的透明度走 `--navbar-island-ring`，亮色主题 0.28、暗色 0.5。**暗色必须更亮**，否则在深色底上完全看不见那个环，玻璃就"塌"了。

**投影是静态的。** `0 2px 8px rgba(0,0,0,.22)` 不随主题变，因为岛本来就浮在壁纸上，深浅两种主题下都需要同样的悬浮暗示。

## 五、玻璃层的三个 CSS 细节

除了 `::before` 和 `will-change`，还有两个坑是纯 CSS 层面的。

### 1. clip-path 必须补，否则圆角漏光

`border-radius` 只约束元素自身的背景和边框绘制，**管不住 filter 之后的输出**。位移滤镜会把像素推到元素盒边缘之外，胶囊的四个"角"就露出玻璃的方角残影，看起来像玻璃没贴住。

```css
clip-path: inset(0 round 9999px);   /* 零内缩 + 全圆角 */
```

它是 `clip-path` 而不是 `overflow: hidden`：后者会连 `backdrop-filter` 的采样一起裁掉，效果更差；而 `clip-path` 作用在滤镜链末端，只裁最终输出。

圆角值要和元素本身一致（这里是胶囊，所以 9999px；最小示例里是 28px）。

### 2. will-change 治淡入闪烁

面板关闭时是 `opacity: 0`，浏览器对全透明元素会跳过绘制，玻璃层的滤镜结果自然没有缓存。淡入的第一帧才开始现算磨砂+折射，于是先露出无玻璃的底色，过一两帧才补上——肉眼就是"闪一下"。

```css
will-change: backdrop-filter;
```

让浏览器把它常驻为合成层、滤镜结果可复用，闪烁就消失。代价是常驻显存，所以只在真正需要动画的元素上加，别全局铺开。

### 3. 外壳要 overflow-visible

岛是圆角胶囊，从它内部弹出的面板必须能溢出。如果外壳或某层容器带 `overflow: hidden`，面板会被裁掉一角：

```css
#navbar > div { overflow: visible !important; }
```

## 六、透明态：两把开关把守

我的主题里有"下滑前导航栏完全透明"的动态模式（`semifull`）。透明阶段玻璃面并不存在，如果折射滤镜还开着，就会把**清晰**的壁纸扭出一道波浪带，非常难看。

所以玻璃层由两把开关控制：

| 开关 | 挂在哪 | 含义 |
| --- | --- | --- |
| `#navbar[data-glass="on\|off"]` | 导航栏元素 | 当前这座岛有没有毛玻璃面（blur > 0） |
| `html[data-glass-distortion="on\|off"]` | `:root` | 折射总开关（玻璃面存在 **且** 折射强度 > 0） |

透明态则整组隐身——底色、白圈、投影、滤镜一起摘掉：

```css
/* 三条选择器分别对应：横幅壁纸 / 全屏壁纸 / 切页瞬间 */
html[data-has-wallpaper] #navbar[data-transparent-mode="semifull"]:not(.scrolled) .navbar-island,
html[data-wallpaper-mode="fullscreen"] #navbar[data-transparent-mode="semifull"]:not(.scrolled) .navbar-island,
.is-page-transitioning[data-has-wallpaper] #navbar[data-transparent-mode="semifull"]:not(.scrolled) .navbar-island {
    background: transparent !important;
    box-shadow: none !important;
}

html[data-has-wallpaper] #navbar[data-transparent-mode="semifull"]:not(.scrolled) .navbar-island::before {
    backdrop-filter: none;
    filter: none;          /* 关键：没有玻璃面就别折射 */
}
```

三条并列不是冗余：横幅壁纸（`data-has-wallpaper`）、全屏壁纸（`data-wallpaper-mode="fullscreen"`）、切页瞬间（`.is-page-transitioning`）是三个独立状态，漏掉任何一条都会在某个入口上闪出一道波浪带。

另外 `banner` 模式下 `transparentMode="none"` 表示"导航栏不渲染任何底色"，也要同样处理：

```css
html[data-wallpaper-mode="banner"] #navbar[data-transparent-mode="none"] .navbar-island {
    background: transparent !important;
    box-shadow: none !important;
}
html[data-wallpaper-mode="banner"] #navbar[data-transparent-mode="none"] .navbar-island::before {
    backdrop-filter: none;
    filter: none;
}
```

## 七、推广到下拉面板：四个坑

同样的结构搬到下拉菜单和浮动面板时，踩了四个很有代表性的坑。

### 坑一：backdrop root，这次更致命

第一反应是把 `filter: url(...)` 加到面板本体上——**不行**，那会把面板里的文字一起扭曲。更麻烦的是：工具岛里现在住着搜索面板和主题面板。

```html
<div class="navbar-island">     <!-- 如果它带 backdrop-filter -->
    <Search />                  <!-- 里面 #search-panel 的毛玻璃就废了 -->
</div>
```

所以分工必须严格：本体只管底色/边框/高光，磨砂+折射全在 `::before`：

```css
html:not([data-wallpaper-mode="none"]) :is(.dropdown-content, .float-panel)::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    backdrop-filter: blur(var(--navbar-panel-blur, 20px)) saturate(1.5);
    will-change: backdrop-filter;
}

html[data-glass-distortion="on"]:not([data-wallpaper-mode="none"])
    :is(.dropdown-content, .float-panel)::before {
    filter: url(#navbar-glass-distortion);
}
```

这里面板的门槛用的是 `:not([data-wallpaper-mode="none"])` 而不是 `data-glass`：纯色模式下没有壁纸可采样，但面板依然会从滚动内容上掠过，玻璃面还在。而导航岛上用 `data-glass` 更精确，因为它反映"这个岛此刻有没有毛玻璃面"。

面板底色按主题分两套，亮色 0.55 白、暗色 0.6 深灰，比岛更实一些——面板里要读文字，透太多会看不清：

```css
/* 亮色 */
html:not([data-wallpaper-mode="none"]) :is(.dropdown-content, .float-panel) {
    background: rgba(255, 255, 255, 0.55) !important;
    box-shadow: var(--shadow-md),
        inset 0 1px 0 rgba(255, 255, 255, 0.18),
        inset 2px 2px 1px 0 var(--navbar-glass-shine),
        inset -1px -1px 1px 1px var(--navbar-glass-shine) !important;
    border: 1px solid rgba(0, 0, 0, 0.06) !important;
}

/* 暗色 */
:root.dark:not([data-wallpaper-mode="none"]) :is(.dropdown-content, .float-panel) {
    background: rgba(23, 23, 23, 0.6) !important;
    box-shadow: var(--shadow-md),
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        inset 2px 2px 1px 0 var(--navbar-glass-shine),
        inset -1px -1px 1px 1px var(--navbar-glass-shine) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
}
```

注意面板这里**保留了**斜向双内阴影，因为面板是圆角矩形而不是胶囊，斜向高光在小圆角上反而更自然。岛用白圈、面板用斜向阴影，是两套不同形状下的同一套语言。

### 坑二：relative 激活了隐藏的 top 偏移

`.dropdown-content` 原本是静态定位，为了让 `::before` 有定位包含块，我给它加了 `position: relative`——结果整个下拉菜单凭空下坠了 84px。

排查半天才发现：它的基类 `.float-panel` 里躺着一个 `top-21`（84px）。静态定位时 `top` 不生效，改成 relative 后立刻激活。

```css
.float-panel { @apply top-21 ... }          /* 基类里埋的雷 */

.dropdown-content {
    /* top-0 抵消 .float-panel 基类的 top-21 */
    @apply relative top-0 bg-(--card-bg) rounded-(--radius-large) ...;
}
```

教训：**给"本来静态"的元素加定位之前，先翻一遍它继承的类里有没有 top/bottom 这类"静态时休眠"的属性。**

### 坑三：滚动容器会把玻璃层滚走

玻璃层是 `position: absolute; inset: 0` 的伪元素。如果**面板自身**带 `overflow-hidden` 并且是滚动容器，玻璃层会跟着内容一起滚走，滚到底部就露出一条没磨砂的"破洞"。

所以设置面板、搜索面板都把滚动下沉了一层——面板只负责玻璃，内层 div 负责滚动：

```html
<div id="display-setting" class="float-panel float-panel-closed absolute w-80 ...">
    <div class="max-h-[80vh] overflow-y-auto custom-scrollbar">
        <!-- 所有内容 -->
    </div>
</div>
```

```html
<div id="search-panel" class="float-panel float-panel-closed absolute md:w-120 ...">
    <div class="search-panel-scroll">…</div>
</div>
```

```css
.search-panel-scroll { overflow-y: auto; max-height: 60vh; }
```

### 坑四：面板搬进岛内后，定位全部失效

这个坑是岛式重构带来的。面板原本相对外壳（`#navbar > div`）定位，现在 `#search-panel` 和 `#theme-mode-panel` 都住在工具岛内部，而岛是 `position: relative` 的，锚点下移了整整一个岛高，水平方向也缩到了岛宽。

所以 navbar.css 尾部要一组补偿：

```css
#navbar .navbar-island #search-panel     { top: 3.5rem; right: 1rem; }
#navbar .navbar-island #theme-mode-panel { top: 3.75rem; right: 1rem; }
```

（两者 `top` 差 0.25rem，是因为主题面板比搜索框略矮，视觉上要各自对齐。）

## 八、首页标题图标：小尺寸要单独定模糊

首页横幅上的圆形图标按钮（`.banner-link`）也是同一套玻璃，但参数不能照抄导航栏——它只有 2.75rem 见方，3px 模糊在小面积上几乎看不出来，折射又容易把图标边缘揉糊。所以固定 8px：

```css
.banner-link {
    position: relative;         /* 玻璃层的定位包含块 */
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.18);
    transition: background-color .25s ease, color .25s ease, transform .2s ease;
}

.banner-link::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}

/* 折射跟随同一个总开关 */
html[data-glass-distortion="on"] .banner-link::before {
    filter: url(#navbar-glass-distortion);
}
```

注意这里**没有** `clip-path`：图标本身是纯圆形（9999px 圆角），且面积太小，位移溢出不明显；加不加都行，我选择不加，省一层合成。

还有一个坑：图标在 `<a>` 或 `<button>` 里，`::before` 的 `pointer-events: none` 不能省，否则会吃掉 `:hover`，按钮的放大动效失效。

## 九、把参数做成设置面板滑块

参考站的参数是写死的，但我想让"模糊度、折射强度、波纹密度"都能在设置面板里实时调。这里有个硬约束：

**SVG 滤镜属性没法被 CSS 变量驱动。** `feDisplacementMap` 的 `scale` 是 SVG 属性，不是 CSS 属性，`var()` 传不进去（`filter: url(#f)` 里的 `#f` 也不支持插值）。所以参数分成两条通道：

| 参数 | 载体 | 作用范围 | 默认值 | 区间 |
| --- | --- | --- | --- | --- |
| 玻璃模糊度 | `--navbar-glass-blur`（`#navbar` 与 `:root` 双写） | 三座岛 + 站内其他玻璃卡片 | 3px（配置） | 0–30 |
| 面板模糊度 | `--navbar-panel-blur`（`:root`，带 2px 下限） | 下拉菜单、浮动面板 | 跟随配置 | ≥2 |
| 折射强度 | `feDisplacementMap@scale`（JS） | 共用 `#navbar-glass-distortion` | 150 | 0–200 |
| 波纹密度 | `feTurbulence@baseFrequency`（JS） | 同上 | 0.01 | 0.004–0.02 |
| 折射总开关 | `html[data-glass-distortion]` | 岛 / 面板 / 首页图标共用 | on | on / off |
| 玻璃面开关 | `#navbar[data-glass]` | 判断当前是否真有毛玻璃面 | on | on / off |

blur 走 CSS 变量，滑块只负责写变量；折射参数必须走 JS。

### 1. 参数应用函数

```ts
const NAVBAR_GLASS_DEFAULT_SCALE = 150;
const NAVBAR_GLASS_DEFAULT_FREQUENCY = 0.01;
const NAVBAR_GLASS_MAX_BLUR = 30;
const NAVBAR_GLASS_MAX_SCALE = 200;
const NAVBAR_GLASS_MIN_FREQUENCY = 0.002;
const NAVBAR_GLASS_MAX_FREQUENCY = 0.03;

const clampNumber = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

export function applyNavbarGlassBlurToDocument(blur: number): void {
    const safeBlur = clampNumber(blur, 0, NAVBAR_GLASS_MAX_BLUR);

    // 双写：导航栏上的变量给岛用，:root 上的给站内其他玻璃面用
    const navbar = document.getElementById("navbar");
    navbar?.style.setProperty("--navbar-glass-blur", `${safeBlur}px`);
    document.documentElement.style.setProperty("--navbar-glass-blur", `${safeBlur}px`);

    // 面板始终保留毛玻璃，所以带 2px 下限
    document.documentElement.style.setProperty(
        "--navbar-panel-blur",
        `${Math.max(safeBlur, 2)}px`,
    );

    const glassOn = safeBlur > 0;
    navbar?.setAttribute("data-glass", glassOn ? "on" : "off");
    applyNavbarGlassDistortionFlag(glassOn);
}

export function applyNavbarGlassParamsToDocument(scale: number, frequency: number): void {
    const safeScale = clampNumber(scale, 0, NAVBAR_GLASS_MAX_SCALE);
    const safeFrequency = clampNumber(
        frequency,
        NAVBAR_GLASS_MIN_FREQUENCY,
        NAVBAR_GLASS_MAX_FREQUENCY,
    );

    // 只能改 SVG 属性，CSS 变量在这里无能为力
    const turbulence = document.querySelector("#navbar-glass-distortion feTurbulence");
    turbulence?.setAttribute(
        "baseFrequency",
        `${safeFrequency} ${safeFrequency.toFixed(4)}`,
    );
    const displacement = document.querySelector("#navbar-glass-distortion feDisplacementMap");
    displacement?.setAttribute("scale", String(Math.round(safeScale)));

    const glassOn =
        document.getElementById("navbar")?.getAttribute("data-glass") === "on";
    applyNavbarGlassDistortionFlag(glassOn);
}

function applyNavbarGlassDistortionFlag(glassOn: boolean): void {
    const scale = getStoredNavbarGlassScale();
    document.documentElement.setAttribute(
        "data-glass-distortion",
        glassOn && scale > 0 ? "on" : "off",
    );
}
```

注意 `baseFrequency` 写的是 `${f} ${f.toFixed(4)}`：X 和 Y 两个分量都要给，否则只有 X 轴有波纹，纵向是平的。

### 2. 三个滑块

```ts
export function setNavbarGlassBlur(blur: number): void {
    const safeBlur = clampNumber(blur, 0, NAVBAR_GLASS_MAX_BLUR);
    localStorage.setItem("navbarGlassBlur", String(safeBlur));
    applyNavbarGlassBlurToDocument(safeBlur);
}

export function setNavbarGlassScale(scale: number): void {
    const safeScale = clampNumber(scale, 0, NAVBAR_GLASS_MAX_SCALE);
    localStorage.setItem("navbarGlassScale", String(safeScale));
    applyNavbarGlassParamsToDocument(safeScale, getStoredNavbarGlassFrequency());
}

export function setNavbarGlassFrequency(frequency: number): void {
    const safeFrequency = clampNumber(
        frequency,
        NAVBAR_GLASS_MIN_FREQUENCY,
        NAVBAR_GLASS_MAX_FREQUENCY,
    );
    localStorage.setItem("navbarGlassFrequency", String(safeFrequency));
    applyNavbarGlassParamsToDocument(getStoredNavbarGlassScale(), safeFrequency);
}
```

Svelte 侧的滑块很直白，`oninput` 里既更新本地状态也落盘：

```svelte
{#if isGlassDistortionSwitchable}
<div class="py-1">
    <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-medium opacity-80">折射强度</span>
        <span class="text-xs font-bold rounded-full px-2 py-0.5">{Math.round(glassScale)}</span>
    </div>
    <input
        aria-label="折射强度"
        type="range" min="0" max="200" step="5"
        value={glassScale}
        oninput={(e) => {
            glassScale = Number(e.currentTarget.value);
            setNavbarGlassScale(glassScale);
        }}
        class="slider w-full"
    />
</div>
{/if}
```

三个滑块的取值区间：

| 滑块 | min | max | step | 说明 |
| --- | --- | --- | --- | --- |
| 玻璃模糊度 | 0 | 30 | 1 | 0 即关闭折射（没有玻璃面） |
| 折射强度 | 0 | 200 | 5 | 0 即只留磨砂 |
| 波纹密度 | 0.004 | 0.02 | 0.001 | UI 给可用区间，JS 侧宽容到 0.002–0.03 |

每一项都能单独关掉。配置里用对象形式控制，只留模糊度也行：

```ts
// src/config/displaySettingsConfig.ts
liquidGlassSwitchable: {
    blur: true,        // 玻璃模糊度
    distortion: true,  // 折射强度
    wave: true,        // 波纹密度
},
```

设成 `false` 则三个滑块全隐藏。

### 3. 首帧同步：解析期内联脚本

这是整套设计里我觉得最值得记录的部分。问题是这样的：

滑块拖动时实时生效，没问题。但**刷新页面**时，HTML 是先渲染出来的，JS 后执行——所以第一帧用的是 SSR 写入的默认参数，然后被 localStorage 里的用户参数覆盖。肉眼就是"玻璃参数闪一下再变"。

解法是在 Navbar 组件里放一段**解析期内联脚本**（`is:inline`，不加 `type="module"`，同步执行，早于首帧绘制），它在首帧前就把参数和开关同步到位：

```astro
<script is:inline define:vars={{ bannerBlur, fsBlur, bannerTMode, fsTMode }}>
  (function () {
    const wm = document.documentElement.getAttribute("data-wallpaper-mode");
    const navbar = document.getElementById("navbar");
    if (!wm || !navbar) return;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const readStored = (key) => {
      try {
        const v = parseFloat(localStorage.getItem(key));
        return Number.isFinite(v) ? v : null;
      } catch { return null; }
    };

    const storedBlur  = readStored("navbarGlassBlur");
    const storedScale = readStored("navbarGlassScale");
    const storedFreq  = readStored("navbarGlassFrequency");

    // 1) 按运行时壁纸模式重算透明模式与 blur
    let mode, blur;
    if (wm === "fullscreen") {
      mode = fsTMode === "semifull" && isHome ? "semifull" : "semi";
      blur = fsBlur;
    } else if (wm === "banner") {
      mode = bannerTMode === "semifull" && !isHome ? "semi" : bannerTMode;
      blur = mode === "none" ? 0 : bannerBlur;
    } else if (wm === "none") {
      mode = "none"; blur = 0;          // 纯色背景无可模糊对象
    } else {
      mode = "none"; blur = 20;         // overlay：由 main.css 强制 20px
    }

    // 2) 用户覆盖优先（透明态除外）
    if (blur > 0 && storedBlur !== null) blur = clamp(storedBlur, 0, 30);

    navbar.setAttribute("data-transparent-mode", mode);
    navbar.style.setProperty("--navbar-glass-blur", `${blur}px`);
    document.documentElement.style.setProperty("--navbar-glass-blur", `${blur}px`);

    const glassOn = blur > 0;
    navbar.setAttribute("data-glass", glassOn ? "on" : "off");

    // 3) SVG 属性同步
    const scale = storedScale !== null ? clamp(storedScale, 0, 200) : 150;
    const freq  = storedFreq  !== null ? clamp(storedFreq, 0.002, 0.03) : 0.01;
    const turb = document.querySelector("#navbar-glass-distortion feTurbulence");
    if (turb) turb.setAttribute("baseFrequency", `${freq} ${freq.toFixed(4)}`);
    const disp = document.querySelector("#navbar-glass-distortion feDisplacementMap");
    if (disp) disp.setAttribute("scale", String(Math.round(scale)));

    document.documentElement.setAttribute(
      "data-glass-distortion",
      glassOn && scale > 0 ? "on" : "off",
    );

    // 4) 面板模糊度跟随
    if (storedBlur !== null) {
      document.documentElement.style.setProperty(
        "--navbar-panel-blur",
        `${Math.max(blur, 2)}px`,
      );
    }
  })();
</script>
```

这段脚本兼职干了两件事，第二件很容易被忽略：

**修 SSR 与运行时的模式不一致。** 服务端渲染的 `data-transparent-mode` 是按配置文件写的，而用户的壁纸模式存在 localStorage 里，两者可能不同（比如配置是 fullscreen、用户选的是 banner）。不修的话首帧会先用错误的透明模式渲染，再被 JS 改回来——肉眼就是导航栏闪一下。

### 4. Swup 切页时参数被静默覆盖

还有一个非常隐蔽的 bug：主题里有个 `updateNavbarTransparency()` 会在 Swup 切页时按**配置文件**重写 blur 变量。

```ts
// 位置：src/utils/setting-utils.ts
export function updateNavbarTransparency(mode: WALLPAPER_MODE): void {
    // ...按 mode 算出 transparentMode / blurAmount...
    navbar.setAttribute("data-transparent-mode", transparentMode);

    const storedGlassBlur = readNavbarGlassBlurOverride();
    const effectiveBlur =
        blurAmount > 0 && storedGlassBlur !== null ? storedGlassBlur : blurAmount;

    navbar.style.setProperty("--navbar-glass-blur", `${effectiveBlur}px`);
    document.documentElement.style.setProperty("--navbar-glass-blur", `${effectiveBlur}px`);

    // 同步两个开关，否则切页后导航栏恢复了玻璃、面板还停在无折射
    const glassOn = effectiveBlur > 0;
    navbar.setAttribute("data-glass", glassOn ? "on" : "off");
    applyNavbarGlassDistortionFlag(glassOn);
}
```

症状是"切页一次丢一次设置"：拖动滑块调到 30px，点进一篇文章，导航栏又回到 3px。因为切页时这个函数把变量写回了配置值。

修法就一件事：**所有写 blur 变量的地方都必须尊重 localStorage 覆盖**。判断逻辑是"配置值 > 0 且有用户覆盖"才用覆盖值——透明态（配置 0）不应该被用户的 30px 强行点亮玻璃。

## 十、调试手册

这几个工具在调的过程中帮了大忙。

### 确认滤镜到底有没有生效

把 `scale` 临时改成 500。如果画面剧烈晃动/撕裂，说明滤镜链通了，只是参数太保守；如果一点变化都没有，问题在 CSS（`filter` 没挂上、选择器没命中、或者被 `filter: none` 覆盖了）。

用 DevTools 的 Styles 面板看 `filter` 那一行有没有被划掉——透明态那几条规则带 `!important`，很容易意外命中。

### 确认是不是 backdrop root 的锅

症状：玻璃层有，但磨砂是"实心"的，背景完全透不上来。

查法：在 Elements 面板选中玻璃层的祖先，逐个看 Computed 里有没有 `backdrop-filter`。任何一层祖先带了，它就成了 backdrop root，后代采样不到真正的页面背景。

修法：把那一层的 `backdrop-filter` 移到它自己的 `::before` 上。

### 确认伪元素的层级位置

临时给它加个 `background: red`，看它是不是在内容下面、底色上面。如果整个元素变红看不到文字，说明 `z-index: -1` 被某个 `isolation: isolate` 或 `transform` 创建的层叠上下文吃掉了（`.float-panel` 的 `transition-all` 在动画期间会创建层叠上下文，要留意）。

### 常见症状速查

| 症状 | 最可能的原因 | 解法 |
| --- | --- | --- |
| 完全没有玻璃感 | `filter` 没生效 / 背景没有可模糊的内容 | 查选择器；确认背后不是纯色 |
| 有磨砂但没有扭曲 | `feComponentTransfer` 缺失导致位移太小；或 `scale` 太低 | 补上对比度拉伸；把 scale 调到 150+ |
| 文字也跟着扭 | `filter` 挂在了元素本体上 | 移到 `::before` |
| 玻璃里看不到页面背景 | 祖先元素是 backdrop root | 移除祖先的 `backdrop-filter` |
| 圆角外有方角残影 | 缺 `clip-path` | `clip-path: inset(0 round <半径>)` |
| 淡入时闪一下 | 全透明元素跳过绘制，滤镜没缓存 | `will-change: backdrop-filter` |
| 滚到底部玻璃破洞 | 玻璃层跟着内容滚走了 | 滚动下沉到内层 div |
| 下拉菜单下坠 84px | 加 `relative` 激活了基类的 `top-21` | `@apply relative top-0` |
| 切页后参数回默认 | 别处按配置重写了变量 | 所有写入点都读 localStorage 覆盖 |
| 刷新时参数闪一下 | 首帧用了 SSR 默认值 | 解析期内联脚本同步 |

## 十一、兼容性与性能

- **Chrome / Edge**：完整效果，磨砂 + 折射 + 内衬环 + 投影。
- **Firefox**：基本可用。个别版本对"用元素滤镜扭曲 backdrop 输出"的处理略有差异，扭曲幅度可能比 Chrome 弱一些。
- **Safari**：不支持用元素滤镜扭曲 backdrop 结果，会安全退化成普通毛玻璃（磨砂 + 内衬环仍在），不白屏、不报错。`-webkit-backdrop-filter` 建议成对写上。
- **性能**：岛式布局在这一项上是有代价的。旧版整条导航栏只有一层 `backdrop-filter`，现在是**三座岛各一层**，加上面板和首页图标，同屏玻璃层从 1 个涨到 4 个以上。displacement 滤镜每帧重算，GPU 开销随之上升。
- **实测**：桌面端无感；低配设备/核显笔记本建议把折射强度降到 60–100，或者干脆归零只留磨砂。
- **降级链路**（自动，不需要额外代码）：
  1. 折射强度 = 0 → `data-glass-distortion="off"`，只留磨砂；
  2. blur = 0 → `data-glass="off"`，岛退回半透明底色；
  3. 壁纸模式 `none` → 面板与卡片的玻璃整体关闭。

## 十二、调参建议

| 想要的效果 | 模糊度 | 折射强度 | 波纹密度 |
| --- | --- | --- | --- |
| 参考 CodePen 原版（通透、扭曲强） | 3px | 150 | 0.01 |
| 克制的高质感（我的推荐） | 10–15px | 60–100 | 0.008 |
| 只留一点灵动 | 20px | 30 | 0.006 |

本站出厂默认是第一行（`navbar.blur: 3`，滑块 150 / 0.01），因为 26% 的岛底色足够透，3px 模糊就已经很像玻璃了。

两个经验：

1. **模糊度越低，折射越明显。** 磨砂把细节抹掉之后，位移图扭曲的就只剩色块了。所以这几个滑块要搭配着调，别单独拉满。
2. **模糊拉到 20px 以上还想看见流动感，就得把折射强度往上顶**，否则只会得到一块均匀的灰板。

还有一个反向的取舍：折射强度上到 180 以上时，边缘的挤压会开始"吃"文字附近的背景，导航栏在深色壁纸上会出现奇怪的亮边。日常用 100 左右是最稳的。

## 十三、文件索引

完整实现都在本站仓库：

| 文件 | 内容 |
| --- | --- |
| `src/components/layout/Navbar.astro` | SVG 滤镜定义、三岛结构、首帧同步脚本、滚动检测 |
| `src/styles/navbar.css` | 岛与玻璃层、开关体系、透明态、面板玻璃、面板定位补偿 |
| `src/utils/setting-utils.ts` | 滑块参数应用、localStorage 读写、Swup 切页同步 |
| `src/components/controls/DisplaySettingsIntegrated.svelte` | 三个滑块的 UI 与状态 |
| `src/config/displaySettingsConfig.ts` | `liquidGlassSwitchable` 开关 |
| `src/config/backgroundWallpaper.ts` | `navbar.blur` / `transparentMode` 默认值 |
| `src/styles/banner-home.css` | 首页标题图标的玻璃层 |
| `src/styles/main.css` | `.float-panel` / `.dropdown-content` 基类（坑二的来源） |

要移植到自己站上，最小路径是：复制第二节的 SVG 滤镜 → 按第三节结构改造你的导航元素 → 把 `filter: url(#...)` 挂到 `::before` → 按第十节的问题表逐个排查。参数先用 3px / 150 / 0.01，觉得不够再往上加。
