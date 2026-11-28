# NOTICE — 逐句歌词库（src/utils/lyrics）

本目录下的歌词解析库移植自 [folia-ce/folia-web](https://github.com/folia-ce/folia-web)
（`src/utils/lyrics/` 及其类型定义、`appPlaybackHelpers` 中的行索引辅助函数）。

- 原项目版权：Copyright (C) chthollyphile and folia-ce contributors
- 原项目许可证：**GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）**
- 本仓库因此部分代码同样以 AGPL-3.0-or-later 授权发布。

## 移植文件与改动

| 本仓库文件 | 来源 | 改动 |
| --- | --- | --- |
| `lyricData.ts` | folia-web `src/types.ts`（歌词相关类型） | 裁剪至本项目用到的字段，移除 TTML agent / 背景和声结构 |
| `types.ts` | `src/utils/lyrics/types.ts` | 移除多来源 RawLyricSource 契约 |
| `formatDetection.ts` | `src/utils/lyrics/formatDetection.ts` | 移除 TTML 探测 |
| `renderHints.ts` | `src/utils/lyrics/renderHints.ts` | 无逻辑改动 |
| `graphemeTiming.ts` | `src/utils/lyrics/graphemeTiming.ts` | 仅调整类型导入路径 |
| `estimatedLineTiming.ts` | `src/utils/lyrics/estimatedLineTiming.ts` | 仅调整类型导入路径 |
| `parserCore.ts` | `src/utils/lyrics/parserCore.ts` | 移除 TTML 解析（`parseTTML` 及 `@applemusic-like-lyrics/ttml`、`@xmldom/xmldom` 依赖），其余逐词/逐句解析、翻译对齐、间奏插入逻辑保持原样 |
| `noLyricLines.ts` | `src/utils/lyrics/noLyricLines.ts` | 无逻辑改动 |
| `textDirection.ts` | `src/utils/lyrics/textDirection.ts` | 无逻辑改动 |
| `wordSegmentation.ts` | `src/utils/lyrics/wordSegmentation.ts` | 无逻辑改动 |
| `cjkSemanticLayout.ts` | `src/utils/lyrics/cjkSemanticLayout.ts` | 无逻辑改动 |
| `sentenceLayout.ts` | `src/utils/lyrics/sentenceLayout.ts` | 移除未使用的 `splitWesternPhrase` 与负数 targetCount 分支；空格常量改为字面量 |
| `index.ts`（`findLatestActiveLineIndex`） | `src/utils/appPlaybackHelpers.ts` | 独立导出 |

全屏歌词动画组件（`src/components/features/music-visualizer/folia/`）移植自 folia-web
`src/components/visualizer/`：共享运行时（时钟 / GlowWord / 字幕浮层 / 重叠计算等）
以 Svelte/CSS 等效重写，动画参数与行为保持一致；各主题（classic、partita、still、tilt
等）的布局与动画逻辑同样移植自对应主题的 React 源码，其中：

- `themes/tilt/tiltLayout.ts`、`SubtitleOverlay.svelte`、`colorMix.ts`、`textMeasureCache.ts`、
  `glowWordOverlap.ts`、`glowWordTiming.ts`、`runtime.ts`、`wordColoring.ts`、
  `subtitleFontSizes.ts`、`GlowWord.svelte`（三态机与发光参数）为对应 React 模块的
  Svelte 等效移植；
- `themes/claddagh/`（claddaghTimeline / claddaghLayout / RingLine / Visualizer / ringMotion）
  为对应 React 模块的 Svelte 等效移植；其中 `@chenglou/pretext` 的字素测量以 canvas
  `measureText`（含 `ctx.letterSpacing`）替代，framer 的 `useSpring` / `animate(lineOffset)`
  以 `ringMotion.ts` 的手写弹簧积分替代，Linux 专用 drop-shadow 光晕路径与帧率上限调度未移植；
- framer-motion 的 spring / keyframes 以 CSS `linear()` 弹簧曲线、CSS transition 与
  WAAPI 等效实现，不引入 framer-motion 依赖；
- `@chenglou/pretext` 的文字测量以共享 canvas `measureText` 等效替代。

- `themes/cappella/`（cappellaCore / cappellaReveal / cappellaMetrics / MessageRow /
  Visualizer）为对应 React 模块的 Svelte 等效移植；folia 内置表情/头像图库不移植，
  头像用主题色渐变占位、emo 消息禁用。
- `themes/cadenza/`（cadenzaTypes / Envelopes / Fragments / Placements / PreparedState /
  OverlayNodes / Visualizer）为对应 React 模块的 Svelte 等效移植。
- `themes/monet/`（monetCore / MonetRailLine / Visualizer）为对应 React 模块的
  Svelte 等效移植；rich-inline 富文本测量以 canvas 逐 token 宽度 + 贪心断行等效；
  AutoMix 歌曲交接、肖像拖拽挂架、音频覆盖条、浮动装饰与设置面板未移植，
  肖像用当前曲目封面（folia 默认 portraitSource 也是 "cover"）。
- `themes/fume/`（fumeCore / Visualizer）为精简 canvas 渲染管线：保留文章式排版
  （blocks / hero 变体）、相机缓移与逐字素打字机高亮；geometric background 场景、
  live raster、分片布局调度与完整相机 step 语义未移植。
- `themes/pendolo/`、`themes/compact/`（nebbia / diorama / metaphor / machi /
  sonnet / tempera / lumiere / hanabi / prompt 共用 CompactCanvasTheme + drawers）
  为 canvas 2D 签名观感移植：pendolo 保留摆钟机械 + 低音摆动；其余 9 个主题按各自
  签名观感（雨窗/纸艺盒景/墨融球/霓虹招牌/段落镜头/拼贴色块/舞台光束/花火/CRT
  终端）重写；folia 的 WebGL2 着色器、React Three Fiber 场景与 Pixi 运行时不移植，
  智能拍点（htdemucs 模型）全部跳过。
