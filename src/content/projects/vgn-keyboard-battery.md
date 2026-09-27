---
title: "VGN 键盘电量插件"
slug: vgn-keyboard-battery
published: 2026-09-24
draft: false
order: 110
description: "在 TrafficMonitor 的任务栏上显示 VGN V98Pro 机械键盘的剩余电量。逆向官方网页驱动的 WebHID 协议，用纯 Win32 API 写成一个 C++ 插件 DLL。"
image: "images/vgn-keyboard-battery.png"
status: "published"
tags:
  - C++
  - Win32
  - HID
  - 逆向
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/VGNKeyboardBattery"
---

## 这是什么

一个 [TrafficMonitor](https://github.com/zhongyang219/TrafficMonitor) 插件，把 VGN V98Pro 系列机械键盘的电量显示到任务栏 / 主窗口上。

| 位置 | 显示内容 |
| --- | --- |
| 任务栏 / 主窗口 | `键盘 85%`，带一条电量柱状图 |
| 鼠标悬停 | `VGN V98Pro  电量：85%  电压：3980 mV` |
| 右键 → 插件命令 | `立即刷新键盘电量` |

## 支持的型号

| 型号 | VID / PID | 协议 |
| --- | --- | --- |
| V98Pro（原版 / V2）有线 | `0x320F` / `0x5055` | 维盛 weisheng，Report ID 4 |
| V98Pro（原版 / V2）2.4G | `0x320F` / `0x5088` | 同有线 |
| V98Pro V3 有线 | `0x258A` / `0x024E` | 北鹰 beiying，Feature Report 9 |
| V98Pro V3 2.4G | `0x258A` / `0x024F` | 北鹰 beiying，Output Report 19 |

> V4 用的是 VIA 协议（Usage Page `0xFF60` / Usage `0x61`），指令体系完全不同，暂不支持。

## 协议怎么来的

VGN 官方网页驱动 [VGN HUB](https://hub.vgnlab.com.cn/) 本身就是一个 WebHID 应用，直接通过浏览器 HID 接口和键盘通信。把它的前端 JS 拉下来分析，就能拿到官方自己在用的完整协议 —— 包括设备表、控制器类型和查询指令。

## 踩到的坑

**厂商通道只在中断 OUT 端点上接收指令。**

用 `HidD_SetOutputReport()` 发送时走的是控制传输（`IOCTL_HID_SET_OUTPUT_REPORT`），调用会返回成功，但设备完全不理会，表现为「命令发出去了却永远收不到回包」。

换成 `WriteFile()` 走中断 OUT 传输后立刻就能收到应答：

```
发送（WriteFile，64 字节）：04 00 00 1A 06 00 00 00 00 ... 00
接收（ReadFile，64 字节）：04 00 00 1A 06 00 00 00 64 01 00 00 ... 00
                                              ↑↑ ↑↑
                                    电量 = 0x64 = 100%   充电 = 1
```

这个坑在 WebHID 里不存在，因为浏览器底层本来就用中断传输 —— 所以逆向时看到的逻辑是对的，落到原生 API 上才暴露出来。

## 安装

1. 找到 `TrafficMonitor.exe` 所在目录
2. 把 `VGNKeyboardBattery.dll` 复制到该目录下的 `plugins` 子目录（没有就新建）
3. 重启 TrafficMonitor
4. 右键 → 其他功能 → 插件管理，确认出现「VGN 键盘电量」
5. 右键 → 显示项目，勾选「键盘电量」

键盘需要有线上连接或已插入 2.4G 接收器；蓝牙模式走标准 GATT 电池服务，协议不同，不支持。

## 编译

必须编译成 64 位（TrafficMonitor 主程序是 64 位）：

```bash
g++ -shared -O2 -static-libgcc -static-libstdc++ -DUNICODE -D_UNICODE -Isrc \
    src/VgnKeyboardBattery.cpp src/VgnHidReader.cpp -o VGNKeyboardBattery.dll \
    -lsetupapi -lhid -luser32 -lkernel32
```

也可以直接用 Visual Studio，或双击 `build.bat`。仓库里附带 `PluginTester.exe`（模拟主程序加载插件）和 `HidProbe.exe`（抓原始报文），方便自己复现。

MIT License。
