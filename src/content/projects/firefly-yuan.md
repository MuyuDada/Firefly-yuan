---
title: "Muyu の 小窝（本站）"
slug: firefly-yuan
published: 2026-09-27
draft: false
order: 120
description: "本站源码。基于 Firefly 主题的二次开发，在侧边栏塞进了恋爱计时、时间进度、天气、时段问候、Umami 统计等一堆自研小组件。"
image: "images/firefly-yuan.png"
status: "developing"
tags:
  - Astro
  - Svelte
  - TypeScript
  - TailwindCSS
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/Firefly-yuan"
  - label: "在线访问"
    icon: "material-symbols:open-in-new"
    value: "https://muyudada.dpdns.org/"
---

## 这是什么

你现在看到的这个博客就是它 —— [Firefly](https://github.com/CuteLeaf/Firefly) 主题的一份个人分支，主题本身来自上游，这里放的是我自己的改动。

## 自研小组件

这些组件的完整源码和实现思路都写成了文章，源码文件也都在本仓库里：

| 组件 | 说明 | 源码 |
| --- | --- | --- |
| 恋爱计时 | 记录在一起的时长 | `src/components/widget/RelationshipTimer.astro` |
| 时间进度 + 节假日倒计时 | 年 / 月 / 周进度条 | `src/components/widget/Schedule.astro` |
| 天气预报 | Open-Meteo 数据，IP 自动定位，本地缓存 30 分钟 | `src/components/widget/Weather.astro` |
| 时段问候时钟 | 按时间切换问候语与背景图 | `src/components/widget/TimeGreeting.astro` |
| Umami 统计卡片 | 免 API Key，靠公开分享链接取数 | `src/components/widget/UmamiStats.astro` |
| IP 定位欢迎弹窗 | 首次访问提示访客所在地 | `src/components/widget/WelcomeToast.astro` |

## 设计原则

尽量把可调项抽到 `src/config/` 下，让使用组件的人改配置而不是改代码。每个组件都带独立的 `xxxConfig.ts` 和对应的类型定义。

## 部署

与上游 Firefly 一致，静态输出到 `dist/`，可部署到 Vercel、Cloudflare Pages 等任意静态托管。

```bash
pnpm install
pnpm dev      # 本地开发，默认 http://localhost:4321
pnpm build    # 生产构建
```
