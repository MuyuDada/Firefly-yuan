---
title: "简约个人主页"
slug: muyudada-homepage
published: 2026-09-14
draft: false
order: 100
description: "个人引导页，纯静态、无需构建。集成一言、实时时钟、天气预报、APlayer 音乐播放器、GitHub 贡献贪吃蛇和主题设置面板。"
image: "images/homepage-shot.webp"
status: "published"
tags:
  - HTML
  - CSS
  - JavaScript
  - 静态页面
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/muyudada.github.io"
  - label: "在线访问"
    icon: "material-symbols:open-in-new"
    value: "https://muyudada.github.io"
---

## 这是什么

基于 [zyyo.net](https://zyyo.net) 模板魔改的个人主页，原生 HTML / CSS / JavaScript 实现，**无框架、无构建工具**，浏览器直接打开 `index.html` 就能跑。

## 功能特性

- **一言 Hitokoto** — 打字机效果逐字显示，每 20 秒自动刷新
- **当地时间** — 实时时钟 + 中文日期（含星期），每秒更新
- **天气预报** — 基于 [Open-Meteo](https://open-meteo.com)，免 API Key；支持浏览器定位 → IP 定位回退，可展开今日详情（风力、能见度、体感温度、湿度、气压、空气质量、紫外线、降水量、日出日落、污染物浓度）
- **音乐播放器** — [APlayer](https://aplayer.js.org) + Meting API 加载网易云歌单，支持歌词与歌单面板
- **主题设置** — 明暗切换（Cookie 持久化），背景 / 卡片的透明度、模糊度与卡片颜色可调（localStorage 持久化）
- **GitHub 贡献贪吃蛇** — 明暗两套 SVG 随主题切换
- **站点运行时长** — 建站起每秒累计的天 / 时 / 分 / 秒
- **FPS 实时显示** — 页面帧率监测
- **其他** — 加载动画、图片弹窗（QQ / 赞赏码）、访客统计、时间线、个人标签、站点与项目展示、移动端响应式适配

## 目录结构

```text
├── index.html            # 主页面
├── static/
│   ├── css/              # 样式表(style.css / root.css)
│   ├── js/script.js      # 站点全部逻辑
│   ├── img/              # 图片资源
│   ├── svg/              # 贪吃蛇 SVG 等素材
│   └── fonts/            # 自托管字体(霞鹜文楷 / Pacifico / Ubuntu)
├── Caddyfile             # Caddy 服务器配置
├── Dockerfile            # 基于 caddy:alpine 的镜像
└── docker-compose.yaml   # Docker Compose 编排
```

## 本地预览

```bash
# 方式一：直接用浏览器打开 index.html

# 方式二：起一个本地静态服务
python -m http.server 8080
# 访问 http://localhost:8080
```

> 一言、天气、音乐等接口需联网才能正常加载。

## 部署

### GitHub Pages

1. Fork 或推送到你的 `<用户名>.github.io` 仓库
2. 仓库 Settings → Pages，选择 `main` 分支保存即可

### Docker 自建

```bash
git clone https://github.com/MuyuDada/muyudada.github.io.git
cd muyudada.github.io
# 将 Caddyfile 中的 example.com 改为你的域名
docker compose up -d
```

## 个性化配置

主要改动集中在 `index.html` 和 `static/js/script.js`：

| 配置项 | 位置 | 说明 |
| --- | --- | --- |
| `musicPlaylistConfig.id` | `static/js/script.js` | 网易云歌单 ID（取歌单链接中的 id） |
| `weatherConfig` | `static/js/script.js` | 默认城市及经纬度 |
| `siteStartTime` | `static/js/script.js` | 建站起始时间（运行时长统计） |
| 社交链接 / 时间线 / 标签 / 项目卡片 | `index.html` | 按需替换为自己的内容 |
| 页面标题 / 描述 / 关键词 / ICP 备案号 | `index.html` | `<head>` 与 `<footer>` 中修改 |

## 鸣谢

- [zyyo.net](https://zyyo.net) — 页面模板
- [APlayer](https://github.com/DIYgod/APlayer) & [Meting](https://github.com/metowolf/Meting) — 音乐播放与解析
- [Hitokoto 一言](https://hitokoto.cn) — 一言数据
- [Open-Meteo](https://open-meteo.com) — 天气与空气质量数据

---

本仓库仅作个人使用与学习交流。
