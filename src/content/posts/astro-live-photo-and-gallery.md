---
title: "在 Astro 博客里实现 iOS 实况照片，顺手把动态图片墙改成九宫格"
published: 2026-11-19
draft: false
pinned: false
description: "实况照片本质是一张静图加一段约 3 秒的 MOV，浏览器却播不了 HEVC。这篇写我把它搬进 Astro 博客的完整链路：ffmpeg 转码参数、::livephoto 自定义指令、rehype 组件与按需注入的交互脚本、桌面悬停与手机长按的交互取舍，以及后台一键上传静图+视频。附动态图片墙从 6 张拼贴改成 3×3 九宫格的改动。"
image: "api"
tags:
  - Astro
  - Live Photo
  - ffmpeg
  - CSS
category: "页面改造"
aiSummary: "iOS 的实况照片由一张静图和一段约 3 秒的 MOV（HEVC 编码）组成，浏览器无法直接播放后者，所以要先用 ffmpeg 转成 H.264 的 MP4，再与静图配对使用。文章给出了转码参数（限制 3 秒、去掉音轨、长边 1280、crf 26、faststart）和从视频首帧抽静图的做法，保证图文衔接自然。渲染侧设计了 ::livephoto{photo video alt} 指令，通过 rehype 组件输出 figure 结构，交互脚本按文章实际使用情况按需注入，不增加其它页面体积；交互支持桌面悬停播放、触屏长按播放、键盘 Enter/空格，并遵循 prefers-reduced-motion。后台侧加了「实况照片」按钮，一次选静图+视频即自动上传并插入指令，选中 MOV 会提示先转码。文末附动态图片墙改为 3 列九宫格的做法。"
series: "Astro 前端笔记"
---

iPhone 的实况照片（Live Photo）大概是手机摄影里最容易被浪费的功能：拍的时候是"活的"，发到任何网页上就变回一张静止的图。

苹果官网那种效果其实不难做：静图常显，鼠标移上去或手指按住时播放那段 3 秒的视频，松手回到静图。这篇把我在 Astro 博客里实现它的过程完整写下来。

## 一、先搞清楚实况照片是什么

在手机里长按照片，你会看到画面动了一下。这个"动"的数据在文件系统里是分开存的：

| 文件 | 内容 |
|---|---|
| `IMG_0001.HEIC` | 静态图像（主图） |
| `IMG_0001.MOV` | 约 3 秒的视频，含拍摄前后各 1.5 秒 |

关键点：**MOV 里用的是 HEVC（H.265）编码**。

而浏览器的 `<video>` 对 HEVC 的支持基本等于没有——Chrome 和 Firefox 都不播，Safari 在某些条件下能播，但你不可能只服务 Safari。

所以第一件事不是写代码，是转码。

## 二、转码：把 MOV 变成能播的 MP4

从手机导出：照片 App 里长按实况照片 → 右上角「…」→「导出」→「未修改的原始文件」，会得到 HEIC + MOV 两个文件。

然后 ffmpeg：

```bash
ffmpeg -y -i IMG_0001.MOV \
  -t 3 \
  -an \
  -vf "scale='min(1280,iw)':-2" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -crf 26 \
  -movflags +faststart \
  IMG_0001.mp4
```

每个参数都是有原因的：

| 参数 | 作用 |
|---|---|
| `-t 3` | 只要前 3 秒，实况照片本身也就这么长，多留没意义 |
| `-an` | 去掉音轨。实况照片的音频是环境杂音，网页上悬停播放突然出声很吓人 |
| `scale='min(1280,iw)':-2` | 长边限制 1280，`-2` 保证高度是偶数（H.264 要求） |
| `-pix_fmt yuv420p` | 兼容性最好的像素格式，不加某些播放器会黑屏 |
| `-crf 26` | 质量/体积平衡点，3 秒片子通常 100–400KB |
| `-movflags +faststart` | 把索引移到文件头，边下边播而不是等整个文件 |

**静图不要单独从 HEIC 转**。更好的做法是从刚转好的 MP4 里抽第一帧：

```bash
ffmpeg -y -i IMG_0001.mp4 -frames:v 1 -q:v 2 IMG_0001.jpg
```

这样静图和视频首帧**完全对齐**，鼠标移上去开始播的那一瞬间不会有跳变。如果静图用原图、视频从另一个时间点开始，视觉上会"闪一下"。

批量处理：

```powershell
Get-ChildItem *.MOV | ForEach-Object {
  ffmpeg -y -i $_.FullName -t 3 -an -vf "scale='min(1280,iw)':-2" `
    -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart ($_.BaseName + ".mp4")
  ffmpeg -y -i ($_.BaseName + ".mp4") -frames:v 1 -q:v 2 ($_.BaseName + ".jpg")
}
```

## 三、在 Markdown 里怎么表达

博客用的是 Astro，Markdown 支持自定义指令（项目里已经用 `::github{...}` 这种写法）。我照着加了一个：

```
::livephoto{photo="https://图床/a.jpg" video="https://图床/a.mp4" alt="街景实况"}
```

可选 `ratio="4/3"` 强制裁成固定比例。

为什么不直接写 HTML？因为 Markdown 里塞 `<video>` 会很难看，而且移动端和桌面端的交互逻辑不同，需要统一处理。

实现分三块：

```
rehype-component-live-photo.mjs   生成 HTML 结构
rehype-live-photo.mjs             检查页面是否用到，决定要不要注入脚本
live-photo-script.js              浏览器端交互
```

结构大概是这样：

```html
<figure class="live-photo">
  <img class="lp-poster" src="..." alt="街景实况">
  <video class="lp-video" src="..." muted playsinline preload="metadata"></video>
  <span class="lp-badge">LIVE</span>
  <span class="lp-hint">悬停播放</span>
</figure>
```

`video` 设置成绝对定位铺满、`opacity: 0`，播放时改成 1。这样静图和视频尺寸天然一致，不需要额外算比例。

### 脚本按需注入

这里有个容易被忽略的优化：交互脚本不该打进每个页面。

做法是在 rehype 阶段扫描一遍：

```js
export function rehypeLivePhoto() {
  return (tree, file) => {
    let used = false;
    visit(tree, "element", (node) => {
      if (node.properties?.className?.includes("live-photo")) used = true;
    });
    if (!used) return;
    // 只有当前文章真的用了实况照片，才把脚本作为 <script> 注入
    // ...
  };
}
```

没用到实况照片的页面，多一个字节都不会有。

## 四、交互：桌面和手机得分开设计

同一个效果，两种设备的自然手势不一样：

| 设备 | 触发方式 |
|---|---|
| 桌面 | 鼠标悬停播放，移出复位 |
| 触屏 | 长按播放，松手复位（和 iOS 原生一致） |

实现上统一成两个事件：`pointerenter/pointerleave`（鼠标）和 `pointerdown/pointerup`（触摸），用 `matchMedia("(hover: hover)")` 判断走哪一套。

还补了三件事：

1. **键盘可操作**：`tabindex="0"`，Enter / 空格切换播放
2. **`prefers-reduced-motion`**：系统开了"减少动态效果"就不自动播放，避免不适
3. **`playsinline` + `muted`**：iOS Safari 不这样设置会强制全屏播放

另外右下角有「悬停播放」的小提示，鼠标移上去就淡出；触屏设备没有 hover，提示常驻。

## 五、后台怎么发

裸写指令要记参数、要手算链接，太麻烦。所以在后台编辑器工具栏加了一个「实况照片」按钮：

点一下 → 文件选择框（`multiple`）→ 一次选中静图和视频 → 自动上传两个文件到图床 → 在光标处插入指令。

几个细节：

- 通过 `file.type` 区分哪个是图哪个是视频，不依赖文件名
- 选到 `.mov` 会**拦住并提示先转码**，因为浏览器播不了，传上去也是坏的
- 视频的体积上限单独放宽（图 15MB / 视频 45MB），实况照片的视频不该被 15MB 卡住

编辑器里看不到预览（它不渲染 Markdown 组件），发布后去前台看效果。

## 六、踩到的两个坑

### 坑一：Stylus 不认 `color-mix()`

写焦点样式时顺手用了：

```styl
&:focus-visible
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 45%, transparent)
```

构建直接报 `illegal unary "in"`。原因是 Stylus 会把 `in` 当成自己的运算符解析，而不是 CSS 函数参数。

换成 `outline` 就绕过去了（而且 outline 不占布局，本来也更合适）：

```styl
&:focus-visible
  outline: 2px solid var(--primary)
  outline-offset: 3px
```

### 坑二：动态图片墙会把实况静图抽走

博客的动态页（说说）会从正文 Markdown 里提取 `![](...)` 生成图片墙。而实况照片的 `<img>` 也在正文里，于是被当成普通配图抽进了九宫格，figure 结构被破坏。

改一行选择器解决：

```js
const elements = [...source.querySelectorAll("img:not(.lp-poster)")];
```

## 附：动态图片墙改成九宫格

顺带把动态页的图片墙也改了。原来的实现是「最多 6 张，3 张和 5 张时用大图 + 小图的不对称拼贴」，不是九宫格。

改成标准 3 列：

```css
.page-gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
}

/* 2 张 / 4 张用两列，4 张自然成 2×2 */
.page-gallery-grid[data-count="2"],
.page-gallery-grid[data-count="4"] {
  width: min(100%, 28rem);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

效果：

| 图片数 | 布局 |
|---|---|
| 1 张 | 单张大图 |
| 2 张 | 两列 |
| 3 张 | 一行三列 |
| 4 张 | 2×2 |
| 5–9 张 | 3 列，9 张正好 3×3 |
| 超过 9 张 | 第 9 格盖 `+N`，灯箱里仍能翻全部 |

配合 `data-count` 属性做分支，比写一堆 `:nth-child` 干净得多。

## 最后

实况照片这东西，技术上没什么难点，难的是**转码这一步不在网页里**——它发生在你把照片从手机导出来的那一刻。所以真正让这件事变得"日常可用"的，是后台那个一键上传按钮：选两个文件，剩下全自动。

如果只做了前端渲染，每次发照片都要开终端敲 ffmpeg，那这个功能大概率用两次就荒废了。

下一篇写这次改天气组件时踩的一个更隐蔽的坑：Astro 里动态插入的 DOM，为什么一条样式都吃不到。
