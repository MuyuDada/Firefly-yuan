---
title: "智能网页工作便签"
slug: smart-notes
published: 2025-12-06
draft: false
order: 90
description: "一个单文件网页便签应用。便签管理、分类、定时提醒、搜索过滤一应俱全，数据全存浏览器本地，无需服务器。"
image: "images/smart-notes.png"
status: "published"
tags:
  - HTML
  - CSS
  - JavaScript
  - 生产力
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/Smart-notes"
---

## 这是什么

一个纯前端的工作便签应用，全部逻辑塞在单个 `index.html` 里 —— 不需要构建，不需要服务器，用浏览器打开就能用。

## 核心功能

- **便签管理** — 创建、编辑、删除、标记完成
- **智能分类** — 按工作、个人、学习等分类组织
- **提醒系统** — 为重要便签设置提醒时间，每 30 秒自动检查一次，到点弹通知
- **搜索与过滤** — 按标题、内容搜索，按分类或提醒状态筛选
- **统计信息** — 便签总数、进行中数量、有提醒的数量
- **本地存储** — 所有数据存在浏览器 LocalStorage，不经过任何服务器

## 设计特色

- **霞鹜文楷字体** — 自托管 Web 字体，为便签应用添一点文艺气息
- **50+ 种交互动画** — 加载入场、按钮涟漪、悬停反馈、状态切换
- **便签动效** — 创建时淡入上浮，删除时向右飞出，完成时缩放淡出
- **视觉细节** — 粒子背景、纸张纹理、完成状态印章、装饰性毛笔笔触
- **五套配色** — 柔和的配色方案可选

## 浏览器兼容性

Chrome 60+ / Firefox 55+ / Safari 11+ / Edge 79+ / Opera 50+

## 使用

```bash
# 本地运行：保存为 index.html，用现代浏览器打开即可
# 在线部署：可放到 GitHub Pages / Netlify / Vercel / Cloudflare Pages
```

## 后续计划

- [ ] 便签导出（PDF / 图片）与数据导入导出
- [ ] 多主题切换、便签分享
- [ ] 云同步、多人协作
- [ ] 移动端应用、语音输入

MIT License。
