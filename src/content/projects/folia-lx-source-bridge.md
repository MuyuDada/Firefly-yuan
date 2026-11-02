---
title: "Folia LX 音源桥"
slug: folia-lx-source-bridge
published: 2026-11-01
draft: false
order: 140
description: "在 Folia 桌面版里运行 LX Music（洛雪音乐）的自定义源脚本。歌单、搜索仍走内置音源，播放地址改由你自备的 lx 脚本解析——一个 Folium 模组。"
image: "images/folia-lx-source-bridge.png"
status: "published"
tags:
  - Electron
  - JavaScript
  - Node.js
  - 音乐
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/folia-lx-source-bridge"
---

## 这是什么

一个 [Folium](https://github.com/chthollyphile/folia-major) 模组，让 [Folia](https://github.com/chthollyphile/folia-major) 桌面版能「读懂」[LX Music（洛雪音乐）](https://github.com/lyswhut/lx-music-desktop)的自定义源脚本。

与洛雪里的自定义源语义一致：**歌单、搜索仍来自 Folia 内置音源（网易云/酷狗/QQ…），播放地址改由你自备的 lx 脚本解析。**

本项目不包含、不分发任何音源脚本，也不下载或存储任何音频内容——它只负责把脚本跑起来。

## 两种接法

| 模式 | 原理 |
| --- | --- |
| 钩子模式（默认开） | 挂 `omni.audioSourceResolved`，内置音源解析出播放地址后瞬间改写为本地占位地址，播放器取流时才真正解析 |
| 独立音源（默认开） | 通过 `omni.providers` 注册一个「LX」音源，搜索代理给脚本支持的第一个内置平台，播放地址一律问脚本 |

## 工作流程

```
你点歌（网易云歌单）
        │
        ▼
Folia 内置 provider 解析出地址
        │
        ▼
钩子（同步，1.5s 时限内）瞬间改写为本地占位地址
        │
        ▼
http://127.0.0.1:<port>/p/<歌曲信息>   ← 播放器来取流时才真正解析
        │
        ▼
main 进程：node:vm 沙箱运行 lx 脚本 ──► 多链路解析（10 分钟缓存 + 并发去重）
        │
        ▼
302 跳转到真实播放地址（http 地址自动经本地代理中转，支持 Range/拖进度条）
```

## LX 脚本规范覆盖

宿主 API 按洛雪桌面版逐项对齐（回调交付 utf8 字符串 + 自动 JSON 解析、`resp.raw` 保留 Buffer、不跟随重定向、needle 式 GET 查询串、60s 超时语义）：

| LX API | 实现 |
| --- | --- |
| `EVENT_NAMES` / `on` / `send` | 完整支持，`inited` / `updateAlert` 均可收到 |
| `request(url, options, callback)` | Node http/https；`method/headers/body/form/formData/timeout`；返回取消函数 |
| `utils.buffer.from / bufToString` | Node Buffer |
| `utils.crypto.md5 / randomBytes / aesEncrypt / rsaEncrypt` | `node:crypto`（AES 支持 ecb/cbc 与 `-nopad`；RSA 为 PKCS1） |
| `utils.zlib.inflate / deflate` | `node:zlib`（Promise） |
| `env` / `version` / `currentScriptInfo` | `desktop` / `1.0.0` / 解析头部 `@name @description @version @author @homepage` |

## 安装

前提：Folia 桌面版 0.7+（Folium 模组系统为实验功能）。

1. 从 [Releases](https://github.com/MuyuDada/folia-lx-source-bridge/releases) 下载可安装的 zip；
2. Folia「设置 → 模组」开启模组系统，把 zip 拖进模组面板；
3. 启用模组（未签名模组显示「未验证」属正常）；
4. 导入你自己的 lx 自定义源脚本（`.js`）：
   - 命令面板执行「**打开 LX 脚本目录**」，把脚本复制进去命名为 `source.js`（自动热重载）；或
   - 在模组设置「脚本下载地址」里填脚本的 http(s) 链接，自动下载保存。

模组设置里可选音质（128k / 320k / flac / flac24bit，脚本不支持时自动降档）、开关两种模式。

## 已知限制

- 钩子有 1.5s 时限，每首歌第一次播放起播会慢几秒，10 分钟内重播秒开
- 酷狗部分脚本解无损需要数字 `albumId`，Folia 只提供专辑名
- 独立音源模式下歌词为空（lx 音乐源脚本不提供歌词）；钩子模式歌词照常
- 仅 Electron 桌面端可用；Web/PWA 部署形态没有模组系统

完整说明见仓库 README。MIT License，仅供学习与技术研究。
