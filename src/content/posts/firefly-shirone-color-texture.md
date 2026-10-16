---
title: '把 Shirone 的配色风格、配色规范与背景纹理移植到 Firefly'
published: 2026-10-17
description: 'Shirone 主题设置里有三个很有意思的选项：Color Style（9 种 Material 3 动态配色方案）、Color Spec（2021/2025 两版配色规范）和 Background Texture（6 种纯 CSS 背景纹理）。这篇记录把它们移植到 Firefly 的完整过程——包括如何用 @material/material-color-utilities 生成 51 个 M3 角色色，如何把 M3 色彩体系映射到 Firefly 原有的 --hue + oklch 变量，如何做到首帧不闪烁，以及 Astro 7 构建时踩到的那个 ESM 坑。'
image: api
category: 页面改造
tags: [主题, 美化, 前端开发, Material Design]
draft: false
slug: firefly-shirone-color-texture
pinned: false
---

我在逛 [Shirone](https://shirone.mysqil.com/) 这个主题时，被它主题设置里的三个选项吸引了：

- **Color Style** —— 9 种 Material 3 动态配色方案，每种都有不同的性格
- **Color Spec** —— Material 3 的 2021 / 2025 两版配色规范
- **Background Texture** —— 6 种背景纹理，而且全是纯 CSS 画的，零网络请求

这三个东西组合起来，可以在**不改一行 CSS** 的前提下把整个站的色调气质换掉。于是我把它们移植到了自己的 Firefly 上。

## 一、先看效果

### 1.1 设置面板

外观 Tab 底部多了两个区块。左边是配色风格 9 宫格，每格显示该方案下 primary / secondary / tertiary 三个色点；右边是背景纹理 6 宫格加一个透明度滑块。

![设置面板](https://muyuimg.cc.cd/file/blog/shirone-m3e/panel-settings.webp)

### 1.2 九种配色风格

同一套页面结构、同一个色相（250），只切换 Color Style，得到的气质完全不同：

![九种配色风格对比](https://muyuimg.cc.cd/file/blog/shirone-m3e/styles-9.webp)

可以看出来：`柔和`/`中性` 走低饱和灰调，`鲜艳`/`内容`/`保真` 是高饱和蓝，`水果沙拉` 偏青绿，`单色` 直接黑白灰。

### 1.3 两版配色规范

同一个 Color Style（鲜艳），只切换 Color Spec：

![2021 与 2025 对比](https://muyuimg.cc.cd/file/blog/shirone-m3e/spec-2.webp)

差异不算剧烈但确实存在——2025 版的容器色对比度更高，界面层次感更强一些。

### 1.4 六种背景纹理

这是我觉得最漂亮的部分。纹理是「主题色渐变 + SVG 图案遮罩」叠出来的，所以它**会跟着配色方案一起变**：

![六种背景纹理](https://muyuimg.cc.cd/file/blog/shirone-m3e/texture-zoom-6.webp)

暗色模式下的表现：

![暗色模式纹理](https://muyuimg.cc.cd/file/blog/shirone-m3e/textures-dark-3.webp)

> 演示图里为了看清图案，把透明度拉到了 100%。实际默认是 12%，是一个非常克制的程度。

## 二、Shirone 是怎么实现的

在动手移植之前，我先把 Shirone 的产物逆向了一遍。它是个 Astro 静态站，逻辑都在构建后的 JS 里。

### 2.1 配色：Material Color Utilities

关键代码在 `setting-utils.*.js` 里。核心就几行：

```javascript
// 色相 → HCT 源色，色度和色调固定
const source = Hct.from(hue, 60, 50);

// 按 variant 选 Scheme 类，生成配色
const scheme = new SchemeTonalSpot(source, isDark, 0, "2025");

// 遍历角色映射表，取值写成 CSS 变量
for (const [role, cssVar] of ROLE_TO_VAR) {
	root.style.setProperty(cssVar, hexFromArgb(MaterialDynamicColors[role].getArgb(scheme)));
}
```

它用的是 Google 官方的 [`@material/material-color-utilities`](https://github.com/material-foundation/material-color-utilities)（下称 MCU），9 种 variant 对应 9 个 `Scheme*` 类：

| Color Style | MCU Scheme 类 | 性格 |
| --- | --- | --- |
| `tonalSpot` | `SchemeTonalSpot` | 柔和，色相最稳定 |
| `vibrant` | `SchemeVibrant` | 鲜艳，高饱和 |
| `content` | `SchemeContent` | 从源色提取更多内容 |
| `expressive` | `SchemeExpressive` | 表现力强，色相偏移大 |
| `rainbow` | `SchemeRainbow` | 彩虹，多色相 |
| `fruitSalad` | `SchemeFruitSalad` | 水果沙拉，色相跨度极大 |
| `monochrome` | `SchemeMonochrome` | 纯灰阶 |
| `neutral` | `SchemeNeutral` | 中性低饱和 |
| `fidelity` | `SchemeFidelity` | 保真，最贴近源色 |

### 2.2 纹理：纯 CSS，零请求

纹理这块设计得很巧。它没有用任何图片文件，而是：

1. 一个固定全屏的 `div`，背景铺一层**主题色线性渐变**
2. 用内联的 **SVG data URI** 做 `mask-image` 遮罩，把渐变切成图案
3. 动画只位移 `mask-position`，开销极低

```css
#m3e-texture-canvas {
	position: fixed;
	inset: 0;
	pointer-events: none;
	z-index: -20;
	opacity: var(--texture-opacity, 0.12);
}

html[data-texture-preset="starlight"] #m3e-texture-canvas {
	background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 50%, var(--tertiary) 100%);
	mask-image: url("data:image/svg+xml,...");
	mask-size: 140px 140px;
	mask-repeat: repeat;
	animation: m3e-texture-starlight-float 16s ease-in-out infinite;
}
```

六种预设的图案参数：

| 预设 | 渐变取色 | mask-size | 动画 |
| --- | --- | --- | --- |
| `starlight` 星芒 | primary → secondary → tertiary | 140px | 16s 浮动 |
| `cyber-dots` 赛博点阵 | primary → secondary | 48px | 无 |
| `topography` 等高线 | secondary → tertiary | 240px | 32s 平移 |
| `geometric` 几何 | primary → tertiary | 160px | 无 |
| `sakura` 樱花 | secondary → primary | 180px | 28s 飘落 |

## 三、移植到 Firefly 要解决什么

直接抄代码是行不通的，Firefly 和 Shirone 的配色体系完全不同。

| | Shirone | Firefly |
| --- | --- | --- |
| 色彩空间 | M3 完整色板（51 个角色） | `oklch(L C var(--hue))` 单色相派生 |
| 变量命名 | `--mc-primary` 等 `--mc-*` | `--primary`、`--page-bg`、`--card-bg`… |
| 消费方式 | 全站直接用 `--mc-*` | 全站用语义变量 |

也就是说：**就算我把 51 个 `--mc-*` 全写进去，Firefly 的页面也不会变**——因为它根本不读这些变量。

所以移植的核心工作量不是抄算法，而是**做一层映射**：M3 角色 → Firefly 语义变量。

### 3.1 涉及的映射（33 个变量）

我保留了完整的 51 个 `--mc-*` 角色变量（和 Shirone 1:1 对齐），在此之上额外派生一套 Firefly 变量：

| Firefly 变量 | ← M3 角色 |
| --- | --- |
| `--primary` | `primary` |
| `--secondary` | `secondary` |
| `--tertiary` | `tertiary` |
| `--page-bg` | `surface` |
| `--card-bg` | `surfaceContainerLow` |
| `--float-panel-bg` | `surfaceContainer` |
| `--btn-content` | `primary` |
| `--btn-regular-bg` | `secondaryContainer` |
| `--deep-text` | `onSurface` |
| `--content-meta` | `onSurfaceVariant` |
| `--line-divider` | `outlineVariant` |
| `--toc-item-active` | `primary` |

（完整 33 条在 `buildFireflyOverrides()` 里，这里只列一部分。）

有个小细节：Firefly 的卡片背景有个半透明版本 `--card-bg-transparent`，格式是 `rgb(R G B / opacity)`。M3 给的是 hex，所以得先拆成通道值：

```typescript
function hexToRgbChannels(hex: string): string | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	const value = Number.parseInt(match[1], 16);
	const r = (value >> 16) & 255;
	const g = (value >> 8) & 255;
	const b = value & 255;
	return `${r} ${g} ${b}`;
}
```

### 3.2 补上缺失的 secondary / tertiary

纹理渐变依赖 `--primary` / `--secondary` / `--tertiary` 三个变量，但 Firefly 原本**只有 `--primary`**。

如果纹理开启时配色算法没跑（比如用户关了配色开关），纹理就会取不到色。所以我在 `src/styles/variables.styl` 里补了兜底值——用 `oklch` 在色相环上偏移得到：

```stylus
:root
	--secondary: unquote("oklch(0.68 0.11 calc(var(--hue) + 40))")
	--tertiary: unquote("oklch(0.72 0.12 calc(var(--hue) - 40))")

:root.dark
	--secondary: unquote("oklch(0.72 0.11 calc(var(--hue) + 40))")
	--tertiary: unquote("oklch(0.76 0.12 calc(var(--hue) - 40))")
```

（`unquote()` 是必须的，否则 Stylus 会去处理 `calc()`。）

### 3.3 z-index：为什么是 -1 而不是 -20

Shirone 的纹理层用 `z-index: -20`，我不能照抄。

原因在于**页面底色画在哪**：Shirone 的底色在 `body` 上，Firefly 的在 `<html>` 上（`Layout.astro` 的 `<html class="bg-(--page-bg) ...">`）。

按 CSS 层叠规则，负 z-index 的子元素会排在**根元素背景之后**。所以如果底色在 `html` 上，纹理层只要 `z-index: -1`，就能恰好落在「页面底色之上、正文之下」。用 -20 反而会被底色盖住。

## 四、核心实现

### 4.1 文件清单

| 文件 | 作用 |
| --- | --- |
| `src/config/colorSchemeConfig.ts` | 配置（新建） |
| `src/types/colorSchemeConfig.ts` | 类型（新建） |
| `src/utils/color-scheme-utils.ts` | 配色算法 + 变量应用（新建，约 600 行） |
| `src/styles/texture.css` | 六种纹理的样式（新建） |
| `src/components/layout/ConfigCarrier.astro` | 传默认值给前端 |
| `src/components/controls/DisplaySettingsIntegrated.svelte` | 设置面板 UI |
| `src/layouts/Layout.astro` | 纹理 DOM + 首帧脚本 |
| `src/utils/setting-utils.ts` | 色相/明暗变化时重算 |
| `src/utils/layout-init.ts` | 初始化时应用 |
| `src/styles/variables.styl` | 补 secondary / tertiary |
| `astro.config.mjs` | 构建配置（见第六节） |

### 4.2 配置

`src/config/colorSchemeConfig.ts` 是唯一需要改的地方：

```typescript title="src/config/colorSchemeConfig.ts"
export const colorSchemeConfig: ColorSchemeConfig = {
	enable: true,
	defaultStyle: "tonalSpot", // 9 种配色风格之一
	defaultSpec: "2025",       // "2021" | "2025"
	sourceChroma: 60,          // 源色色度（Shirone 用 60）
	sourceTone: 50,            // 源色色调（Shirone 用 50）
	applyToTheme: true,        // 是否把 M3 配色映射到 Firefly 语义变量
};

export const textureConfig: TextureConfig = {
	enable: true,
	defaultPreset: "none",     // 默认关闭，不改动现有观感
	defaultOpacity: 0.12,
	allowMotion: true,
};
```

> 注意这里有个**刻意的偏离**：Shirone 的默认纹理是 `starlight`，我把它设成了 `none`。因为纹理是全局背景层，默认开启会改变所有现有页面的观感，我倾向于让用户主动去开。

### 4.3 生成配色变量

核心函数是纯函数，方便测试和预览：

```typescript title="src/utils/color-scheme-utils.ts"
export function buildSchemeVarsFor(
	style: ColorStyle,
	spec: ColorSpec,
	dark: boolean,
	hue: number,
): ThemeVarMap {
	const config = readColorConfig();
	// 源色：色相来自 --hue，色度/色调固定
	const source = Hct.from(hue, config.sourceChroma, config.sourceTone);
	const SchemeClass = SCHEME_BY_STYLE[style] ?? SchemeTonalSpot;
	const scheme = new SchemeClass(source, dark, 0, spec);

	const result: ThemeVarMap = {};
	for (const [role, varName] of Object.entries(ROLE_TO_VAR)) {
		const dynamicColor = (MaterialDynamicColors as unknown as Record<
			string,
			{ getArgb: (s: SchemeLike) => number } | undefined
		>)[role];
		if (!dynamicColor) continue;
		result[varName] = hexFromArgb(dynamicColor.getArgb(scheme as unknown as SchemeLike));
	}
	return result;
}
```

（`MaterialDynamicColors` 的角色是静态属性而非方法，类型上是 `DynamicColor`，这里做了一次窄化转换以便按名字索引。）

设置面板的 9 宫格预览如果每个都算 51 个角色，开销会比较大。所以单独写了个只算三个色的轻量版：

```typescript
export function buildSchemePreview(style, spec, dark, hue) {
	// 只取 primary / secondary / tertiary，供面板色点显示
}
```

实测性能：`tonalSpot` 约 5.4 ms/次，最慢的 `vibrant` 约 13.9 ms。九格全算约 50–120 ms，可以接受。

### 4.4 首帧防闪烁

MCU 体积不小，塞不进 `Layout.astro` 的内联脚本。但如果不在首帧就把变量写进去，页面会先闪一下默认配色再变成用户选的配色。

解决办法是**缓存 + 回放**：运行时把算好的结果连同签名一起写进 localStorage，内联脚本只做「校验签名 → 回放」。

```typescript
export function colorSchemeSignature(style: ColorStyle, spec: ColorSpec, dark: boolean, hue: number): string {
	return `${style}|${spec}|${dark ? "dark" : "light"}|${hue}`;
}
```

`Layout.astro` 内联脚本里有等价的字符串拼接（**改动需同步**）：

```javascript
// src/layouts/Layout.astro
(function applyCachedColorScheme() {
	if (!schemeEnabled) return;
	try {
		const cached = JSON.parse(localStorage.getItem("mc-scheme-cache"));
		const style = localStorage.getItem("mc-style") || defaultColorStyle;
		const spec = localStorage.getItem("mc-spec") || defaultColorSpec;
		const signature =
			style + "|" + spec + "|" + (isDark ? "dark" : "light") + "|" + (Number.parseFloat(hue) || 0);
		if (cached?.sig !== signature || !cached.vars) return;
		for (const [name, value] of Object.entries(cached.vars)) {
			document.documentElement.style.setProperty(name, value);
		}
	} catch {
		// 缓存损坏：退化为运行时计算，仅多一次重算
	}
})();
```

纹理更简单——内联脚本直接写 `data-texture-preset` 属性就行，CSS 会自动接管：

```javascript
(function applyInitialTexture() {
	if (!textureEnabled) return;
	const preset = localStorage.getItem("texture-preset") || defaultTexturePreset;
	document.documentElement.dataset.texturePreset = preset;
	document.documentElement.style.setProperty("--texture-opacity", String(opacity));
})();
```

### 4.5 重算时机

配色需要在三个地方重新计算：

```typescript title="src/utils/setting-utils.ts"
// 1. 用户拖动色相滑块
export function setHue(newHue: number): void {
	// ... 写入 --hue ...
	refreshColorScheme(); // 色相是 M3 配色的源色
}

// 2. 明暗主题切换
export function applyThemeToDocument(...): void {
	// ...
	if (needsThemeChange) {
		refreshColorScheme(); // 亮暗两套色板不同
	}
}

// 3. 跟随系统主题变化
function handleSystemThemeChange(): void {
	// ... dispatch theme-change ...
	refreshColorScheme();
}
```

初始化则在 `layout-init.ts` 里，等 `#config-carrier` 挂载完成后调用一次：

```typescript
applyColorAndTexture();
```

### 4.6 设置面板

面板这块要接三个地方，缺一个控件就不会显示：

1. `src/config/displaySettingsConfig.ts` —— 实际开关值
2. `src/types/displaySettingsConfig.ts` —— 类型定义
3. `src/utils/display-settings-utils.ts` —— `DISABLED_SETTINGS`（总开关关闭时全 false）

另外面板的聚合派生值也要登记，否则 Tab 会被判定为空：

```typescript
const hasColorSchemeSettings = isColorStyleSwitchable || isColorSpecSwitchable;
const hasAppearanceTab = $derived(
	/* ...原有条件... */ || hasColorSchemeSettings || isTextureSwitchable,
);
```

面板里的色点用 `buildSchemePreview` 驱动，并且在 `onMount` 里挂了个 MutationObserver 监听 `documentElement` 的 class 变化，这样用户切换暗色模式时九宫格色点会实时跟着变。

## 五、离线图标

Firefly 的 `Icon.svelte` 用的是 `@iconify/svelte/offline` + 本地白名单 `src/constants/icons-data.json`（为了不产生运行时网络请求）。所以新增图标必须手动补进去。

纹理区块需要 6 个图标，从 Iconify 拉了数据。**这里有个坑**：`block-rounded` 在 Iconify 上是个 alias：

```json
{ "aliases": { "block-rounded": { "parent": "block" } } }
```

它的 `body` 是空的，真正的图形在父图标 `block` 里。而 `Icon.svelte` 的 `iconExists()` 只查 `collection?.icons?.[name]`，**不解析 alias**——所以必须把父图标的 body 抄过来当成 `block-rounded` 自己的条目，否则图标会静默不显示。

## 六、Astro 7 构建踩坑：MCU 的 ESM 问题

这是整个过程里最难缠的一个问题，值得单独说。

### 6.1 现象

开发时一切正常，但 `pnpm build` 在 `generating static routes` 阶段直接崩：

```
Cannot find module '.../node_modules/@material/material-color-utilities/dynamiccolor/dynamic_color'
imported from .../color_spec_2025.js
```

### 6.2 根因

MCU 0.4.0 包内有 **10 处无扩展名的相对导入**，比如：

```javascript
// dynamiccolor/color_spec_2025.js
import { DynamicColor, extendSpecVersion } from './dynamic_color';  // ← 缺 .js
```

Node 原生 ESM 解析器要求显式扩展名，所以加载不了。而 9 个 scheme 文件都有同样的问题。

**关键区别**：Vite/esbuild 打包时能解析这种写法，所以浏览器端没事；但 prerender 阶段代码是被外部化（externalize）交给 Node 直接 import 的，就炸了。

### 6.3 第一次尝试：失败

直觉是让 Vite 别外部化它：

```javascript
// astro.config.mjs
vite: {
	ssr: { noExternal: ["@material/material-color-utilities"] },
}
```

**无效**，报错一模一样。

翻了 Astro 的源码才明白为什么。Astro 7 走 Vite 8 的 environment API，在 `vite-plugin-environment/index.js` 的 `configEnvironment` 钩子里：

```javascript
if (_options.resolve?.noExternal !== true) {
	finalEnvironmentOptions.resolve.noExternal = [...ALWAYS_NOEXTERNAL, ...astroPkgsConfig.ssr.noExternal];
	finalEnvironmentOptions.resolve.external = [...(command === "dev" ? ONLY_DEV_EXTERNAL : []), ...astroPkgsConfig.ssr.external];
}
```

也就是说，**Astro 会用自己爬取依赖的结果覆盖掉用户配置**。用户侧的 `vite.ssr.noExternal` 只在爬取结果里做过滤，不会主动把新包加进去。

我还试了在 `resolveId` 钩子里返回绝对路径——也没用，因为外部化在 `resolveId` 之前就由 environment 的 `resolve.noExternal` 决定了。

### 6.4 有效方案

既然 Astro 在 `configEnvironment` 里覆盖，那就在**同一阶段**、用**自定义插件**把包追加回去：

```javascript title="astro.config.mjs"
{
	name: "material-color-utilities-bundle-fix",
	configEnvironment(_name, options) {
		// 已经被显式设为 true 的不动
		if (options.resolve?.noExternal === true) return;
		const current = options.resolve?.noExternal ?? [];
		if (current.includes("@material/material-color-utilities")) return;
		return {
			resolve: { noExternal: [...current, "@material/material-color-utilities"] },
		};
	},
}
```

这个插件要放在 `vite.plugins` 数组**靠前**的位置（我放在 `tailwindcss()` 之前）。同时保留 `vite.ssr.noExternal` 作为双保险。

修复后构建通过，检查产物 `dist/.prerender/chunks/*.mjs`，原本的 `from "@material/material-color-utilities"` 外部导入消失了，变成了内联的 `//#region node_modules/...`。

## 七、使用方式

打开设置面板 → 外观 Tab → 拉到底：

| 想要 | 操作 |
| --- | --- |
| 换配色气质 | 点「配色风格」九宫格任一格 |
| 切换配色规范 | 点「配色规范」的 2021 / 2025 |
| 开启纹理 | 点「背景纹理」六宫格任一格（默认「无」） |
| 调整纹理浓度 | 拖「纹理透明度」滑块，默认 12% |
| 恢复默认 | 每个区块右上角的重置按钮 |

选择会存在 localStorage（`mc-style` / `mc-spec` / `texture-preset` / `texture-opacity`），刷新后保持。

## 八、几个说明

**关于 `--mc-*` 变量。** 我保留了完整的 51 个 M3 角色变量。虽然 Firefly 现在只消费其中映射出去的那 33 个语义变量，但保留完整色板意味着以后想用某个角色色（比如 `--mc-inverse-surface`）可以直接用，不用改算法。

**关于纹理性能。** 纹理层是 `position: fixed` 的单个 div，动画只改 `mask-position`——这是合成器友好的属性，不会触发重排。同时 `prefers-reduced-motion: reduce` 和 Firefly 自己的 `html.motion-reduced` 都会把动画关掉。

**关于 `allowMotion`。** 配置项里留了这个字段，但**当前没有消费方**——动画开关实际由 `prefers-reduced-motion` 媒体查询控制。如果要做成面板开关，需要额外接线。

**关于单色方案。** `monochrome` 下 primary 会是纯黑/纯白，页面会变成彻底的黑白灰。这是 M3 的正常行为，不是 bug。

**关于配色去重。** 9 种风格的 primary 色去重后只有 7 个唯一值——`content`、`rainbow`、`fidelity` 三者在某些色相下会给出相同的 primary。这也是 MCU 的正常行为，它们的差异体现在 secondary/tertiary 和容器色上。

## 九、相关文件

```
src/config/colorSchemeConfig.ts                       配置
src/types/colorSchemeConfig.ts                        类型
src/utils/color-scheme-utils.ts                       核心算法
src/styles/texture.css                                纹理样式
src/components/layout/ConfigCarrier.astro             默认值传递
src/components/controls/DisplaySettingsIntegrated.svelte  设置面板
src/layouts/Layout.astro                              纹理 DOM + 首帧脚本
src/utils/setting-utils.ts                            重算时机
src/utils/layout-init.ts                              初始化
src/styles/variables.styl                             secondary/tertiary 兜底
src/constants/icons-data.json                         离线图标
src/i18n/{i18nKey.ts,languages/*.ts}                  21 个文案 × 6 语言
astro.config.mjs                                      MCU 构建修复
```

## 🔗 最后

这次移植最有意思的地方在于：**算法可以照搬，体系必须重做**。Shirone 用 M3 色彩体系，Firefly 用单色相 oklch，两者之间需要一层认真的映射，而不是复制粘贴。

纹理那部分的实现我很喜欢——用 SVG mask 把主题色渐变切成图案，六种纹理加起来不到 13 KB CSS，零网络请求，而且天然跟随配色方案变化。这个思路其实可以推广到很多场景。

相关源码：[MuyuDada/Firefly-yuan](https://github.com/MuyuDada/Firefly-yuan)

参考：[Shirone](https://shirone.mysqil.com/) · [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
