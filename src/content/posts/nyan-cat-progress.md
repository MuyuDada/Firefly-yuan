---
title: '给音乐播放器换上 Nyan Cat 进度条'
slug: 'nyan-cat-progress'
published: 2026-10-30
description: '把 B 站那套彩虹猫进度条搬到博客侧栏的音乐卡片：拆解原版实现、为什么没照搬 2px 容器、猫缩到多小会糊，以及最终那 30 行 CSS。'
image: api
category: 小组件
tags: [CSS, Astro, 动画]
draft: false
pinned: false
---

十年前第一次见到 Nyan Cat，是在一个卡到掉帧的 GIF 网站上。十年后它又出现了，这次是在 B 站的进度条上——一只粉色像素猫，拖着一道彩虹，随着播放进度往前爬。

看到那个 UserCSS 的瞬间我就想把它搬到博客的音乐卡片里。这篇文章记录整个移植过程：原版是怎么实现的、哪些地方可以直接抄、哪些必须改。

## 一、先看原版做了什么

那段样式不长，但有几个很巧的点。

### 把容器压扁，让内容溢出

```css
.bpx-player-progress {
  height: 2px !important;          /* 布局只占 2px */
}
.bpx-player-progress-schedule {
  height: 9.6px !important;        /* 视觉是 9.6px */
  overflow: visible !important;    /* 允许溢出 */
}
```

B 站播放器控制栏的高度是固定的，进度条加粗会把整栏顶高，布局全乱。所以作者把外层容器压到 2px——**布局上它只是一条线，视觉上却是一条 9.6px 的彩虹带**。

这是个很聪明的 hack：不改任何兄弟元素的尺寸，只让进度条自己"长出去"。

### 猫头用负 margin 居中

```css
.bpx-player-progress-cursor {
  left: calc(var(--nyan_cat-w) / -2);
  top: calc((var(--rainbow-h) - var(--nyan_cat-h)) / 2 + 1px);
}
```

游标的 `left` 默认指的是**左边缘**位置。直接设成播放进度，猫的左边缘会卡在进度点上，整只猫往右偏半个身位。

减掉半个宽度，才是"猫身中心对准进度点"。同理 `top` 要减去高度差的一半，才能垂直居中。

### 但有些地方是多余的

原版里有一条 `--rainbow-bg` 变量，存着一段 base64 编码的 1×12 像素彩虹 PNG。往下翻几行：

```css
background: var(--rainbow-bg) !important;           /* 先设 PNG */
background: linear-gradient(to bottom, ...) !important;  /* 又被渐变盖掉 */
```

PNG 完全没用上，纯属早期实现的遗留。还有 `-webkit-linear-gradient`、`-moz-linear-gradient` 两份前缀写法，那是 2011 年的语法，现在浏览器都认标准写法了。

**抄的时候只抄思路，别抄代码。**

## 二、移植时的三个决定

### 决定一：不照搬 2px 容器

B 站必须压容器，因为它不能改变播放器控制栏高度。

但博客的音乐卡片不是——这个组件原本就是「外层 14px 负责好点，内层 4px 负责好看」：鼠标在 14px 的高度里随便戳都能拖动，视觉上只是一条细线。

如果照抄 2px，等于把好用的交互换成一个纯视觉 hack，不划算。

所以容器保持 14px，彩虹条保持 4px，只换游标。

### 决定二：猫不能太小

第一版我按比例算：B 站条高 9.6px 配 16.8px 的猫，那博客条高 4px，猫就该 7px。

缩完截图一看——**认不出是猫**。34×21 的像素图缩到 22×13.6，猫脸、腮红、尾巴全糊成一团色块，只剩个"进度条上有个彩色小方块"的观感。

改到 28×17.3（原始尺寸的 82%）才清楚。代价是猫的高度是进度条的 4 倍多，但这就是像素艺术——**它有最小可辨识尺寸，比例再好看也不能缩过头**。

### 决定三：GIF 存成文件，不内联

原版把 GIF 塞进 CSS 的 `url("data:image/gif;base64,...")`，好处是单文件自包含，坏处是：

- CSS 体积暴涨（这段 3.3KB 的图，base64 后 4.5KB）
- 浏览器无法单独缓存图片
- 编辑器里翻代码像在读乱码

放到 `public/assets/images/nyan-cat.gif`，CSS 里一行路径就够了。3.3KB 的图，缓存一次能用很久。

## 三、最终代码

模板结构（Astro）：

```astro
<div class="music-progress" role="slider" aria-valuemin="0" aria-valuemax="100">
  <span class="music-progress__track" aria-hidden="true"></span>
  <span class="music-progress__fill" aria-hidden="true"></span>
  <span class="music-progress__thumb" aria-hidden="true"></span>
</div>
```

样式：

```css
.music-progress {
  --bar-h: 4px;
  --bar-h-hover: 6px;
  --cat-w: 28px;
  --cat-h: 17.3px;
  --cat-bg: url("/assets/images/nyan-cat.gif") center / contain no-repeat;
  --progress-rainbow: linear-gradient(
    90deg, #ff8a9b 0%, #ffc46b 20%, #ffe97a 38%,
    #7be3a0 58%, #6fc6ff 78%, #b28bff 100%
  );

  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 14px;        /* 命中区，比视觉条高得多 */
  cursor: pointer;
  touch-action: none;
}

/* 底轨和填充共用几何 */
.music-progress__track,
.music-progress__fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: var(--bar-h);
  border-radius: 999px;
  transform: translateY(-50%);
  transition: height .18s ease;
}

.music-progress__track {
  right: 0;
  background: currentColor;
  opacity: .16;        /* 跟随文字色，深浅主题自动适配 */
}

.music-progress__fill {
  width: 0;            /* 由 JS 设置百分比 */
  background: var(--progress-rainbow);
}

.music-progress__thumb {
  position: absolute;
  top: 50%;
  left: 0;             /* 由 JS 设置百分比 */
  width: var(--cat-w);
  height: var(--cat-h);
  margin-left: calc(var(--cat-w) / -2);   /* 猫身中心对准进度点 */
  background: var(--cat-bg);
  pointer-events: none;
  transform: translateY(-50%);
  transition: transform .18s ease;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / .22));
}

/* 悬停：条变粗 + 猫放大 */
.music-progress:hover .music-progress__track,
.music-progress:hover .music-progress__fill {
  height: var(--bar-h-hover);
}
.music-progress:hover .music-progress__thumb {
  transform: translateY(-50%) scale(1.18);
}

@media (prefers-reduced-motion: reduce) {
  .music-progress__track,
  .music-progress__fill,
  .music-progress__thumb { transition: none; }
}
```

JS 侧只需要两行：

```js
fill.style.width = `${percent}%`;
thumb.style.left = `${percent}%`;
```

## 四、几个坑

**猫在 0% 时会被裁掉半边**

因为 `margin-left` 是负的，进度为 0 时猫的左半边在容器外。如果父级有 `overflow: hidden`，猫就只剩右半张脸。

解决办法是给进度条的父容器留点内边距（我用的 `px-1`），让溢出的部分有地方待。

**`filter: drop-shadow` 别用 `box-shadow`**

`box-shadow` 会跟着元素的矩形边框走，猫是 PNG 透明图，加 `box-shadow` 会出现一个方形阴影框。`drop-shadow` 沿 alpha 通道描边，才是贴着猫身子的。

**GIF 动画不受 `prefers-reduced-motion` 控制**

CSS 能停掉 transition，但停不了 GIF 自己播放。真要尊重这个设置，得换成静态图或者用 `image-rendering` + 帧动画。目前我选择保留——它只是摆尾巴，不闪烁。

## 五、可以调的地方

| 变量 | 作用 | 建议范围 |
|---|---|---|
| `--cat-w` / `--cat-h` | 猫的尺寸 | 保持 34:21 比例，最小别低于 24px 宽 |
| `--bar-h` | 进度条粗细 | 3–6px，再粗就抢猫的戏了 |
| `scale(1.18)` | hover 放大倍数 | 1.1–1.25，再大就晕 |
| `--progress-rainbow` | 彩虹配色 | 想更艳就往饱和调，想柔和就降明度 |

改 `--cat-w` 的时候记得同步 `--cat-h`，两个值是一比一绑死的。

---

写完之后盯着播放器看了一会儿。猫爬到 60% 的时候尾巴正好甩在黄色段上，和进度条的渐变叠在一起，有点像真的在彩虹上跑。

这种没什么用但看着高兴的小东西，大概就是折腾博客的意义。
