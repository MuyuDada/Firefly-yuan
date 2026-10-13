---
title: '为 Firefly 添加「电脑状态」侧栏卡片：实时展示本机在用什么'
slug: 'device-status-card'
published: 2026-10-12
description: '静态博客看不到本机信息，所以由本机 PowerShell 每 30 秒上报，经 Cloudflare Worker + KV 中转，博客侧只读展示。含完整 Worker、上报脚本与侧栏组件源码，以及离线时间戳、图标三级匹配等实现要点。'
image: api
category: 自建服务
tags: [Cloudflare, PowerShell, 小组件]
draft: false
pinned: false
---

博客是纯静态的，构建完就是一堆 HTML，浏览器端看不到你电脑上开着什么程序。所以想在自己的站点上显示「此刻正在用什么」，链路只能是**反过来**的：本机主动把状态推上去，页面再去读。

这篇记录我从主页移植到博客的完整过程——Cloudflare Worker + KV 当中转站，本机 PowerShell 脚本每 30 秒上报一次，博客侧做成一张挂在左侧栏的卡片。效果可以直接看本站首页左侧栏。

## 一、功能概览

卡片标题叫「我在干嘛」，标题右边一个状态角标，中间是当前应用的图标和名字，下面一行窗口标题，底部是更新时间和手动刷新。

四种状态各有自己的配色，扫一眼颜色就知道人在不在：

| 状态 | 角标 | 图标 | 副文案 |
| --- | --- | --- | --- |
| 在线 | 绿 · 在线 | 当前应用图标 | 正在使用中。 |
| 离开 | 橙 · 离开 | 当前应用图标 | 已经 N 分钟没有操作了。 |
| 锁屏 | 灰 · 锁屏 | 显示器 | 电脑锁屏了，人不在跟前。 |
| 离线 | 红 · 离线 | 关机 | 本机上报已中断，可能关机或断网。 |

主要能力：

- **实时状态** — 本机每 30 秒上报一次前台应用、空闲时长与窗口标题，页面每 30 秒轮询
- **四种状态** — 在线 / 离开 / 锁屏 / 离线，由本机判定后上报，页面只负责渲染
- **图标三级匹配** — 进程名优先（126 条映射）→ 应用名关键词兜底 → 通用显示器图标
- **吐槽文案** — 应用名和文案都由本机脚本的映射表给出，页面直接展示，想加应用不用动博客代码
- **离线兜底** — 超过 180 秒没有新上报即判定离线，并显示本机**上次上报**的时间
- **卡片能力** — 基于 `WidgetLayout` 开发，自动继承折叠与入场动画，亮暗色自适应

## 二、整体架构

```
本机 PowerShell（每 30 秒）
        │  POST /api/device/report   （带 X-Report-Token）
        ▼
Cloudflare Worker  ──写入──▶  Cloudflare KV
        ▲
        │  GET /api/device/status    （公开只读，带 CORS）
        │
博客 DeviceStatus.astro（每 30 秒轮询）
```

KV 里只存一条记录（key = `device:latest`），永远覆盖，不累积历史。这样免费额度完全够用——KV 每天 10 万次读、1000 次写，按 30 秒上报 + 30 秒轮询算，一天约 2880 写 / 2880 读。

## 三、Cloudflare Worker

### 完整源码

```js title="worker/device-status-worker.js"
/**
 * Muyu 主页 · 电脑状态中转 Worker
 * ---------------------------------------------------------------------------
 * 纯静态主页（GitHub Pages / Caddy）看不到本机状态，所以由本机定时 POST 上报，
 * 页面再 GET 读取。数据存在 Cloudflare KV 里。
 *
 * 路由：
 *   POST /api/device/report   本机上报（需要 X-Report-Token）
 *   GET  /api/device/status   页面读取（公开，只读）
 *   GET  /api/device/health   探活
 *
 * 绑定的 KV 命名空间变量名：DEVICE_KV
 * 环境变量（Secret）：
 *   REPORT_TOKEN   上报口令，必须与本机脚本一致
 *
 * 部署见同目录 README.md。
 */

const KV_KEY = "device:latest";

// 页面侧只读，所以放开通配符；写接口靠 token 保护。
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Report-Token",
    "Access-Control-Max-Age": "86400",
};

function json(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...CORS_HEADERS,
        },
    });
}

/** 恒定时间比较，避免 token 被按字符逐位爆破 */
function safeEqual(a, b) {
    const x = String(a || "");
    const y = String(b || "");
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
}

function clampString(value, max) {
    const s = String(value == null ? "" : value);
    return s.length > max ? s.slice(0, max) : s;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, "") || "/";

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        // ---------------------------------------------------------------- 上报
        if (path === "/api/device/report" && request.method === "POST") {
            const token = request.headers.get("X-Report-Token") || "";
            if (!env.REPORT_TOKEN || !safeEqual(token, env.REPORT_TOKEN)) {
                return json({ success: false, code: "unauthorized" }, 401);
            }

            let body;
            try {
                body = await request.json();
            } catch (error) {
                return json({ success: false, code: "invalid_json" }, 400);
            }

            // 只保留需要的字段，避免 KV 被塞垃圾
            const record = {
                state: clampString(body.state || "unknown", 24),
                app: clampString(body.app, 64),
                // 原始进程名，页面据此挑图标；没有映射时留空
                process: clampString(body.process, 64),
                // 吐槽文案，由本机脚本生成，页面直接展示
                quip: clampString(body.quip, 160),
                title: clampString(body.title, 160),
                idleSeconds: Math.max(0, Math.min(86400, Number(body.idleSeconds) || 0)),
                host: clampString(body.host, 64),
                reportedAt: Date.now(),
            };

            await env.DEVICE_KV.put(KV_KEY, JSON.stringify(record));
            return json({ success: true, record: record });
        }

        // ---------------------------------------------------------------- 读取
        if (path === "/api/device/status") {
            const raw = await env.DEVICE_KV.get(KV_KEY);
            if (!raw) {
                return json({
                    success: true,
                    online: false,
                    stale: true,
                    reason: "no_report_yet",
                    record: null,
                });
            }

            let record;
            try {
                record = JSON.parse(raw);
            } catch (error) {
                return json({ success: false, code: "corrupt_record" }, 500);
            }

            // 超过 3 分钟没上报就认为本机掉线（上报间隔 30s，留足容错）
            const ageSeconds = Math.round((Date.now() - (record.reportedAt || 0)) / 1000);
            const stale = ageSeconds > 180;

            return json({
                success: true,
                online: !stale,
                stale: stale,
                ageSeconds: ageSeconds,
                record: record,
            });
        }

        if (path === "/api/device/health") {
            return json({ success: true, service: "device-status", time: Date.now() });
        }

        return json({ success: false, code: "not_found" }, 404);
    },
};
```

### 部署

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录（会打开浏览器授权）
wrangler login

# 3. 建 KV 命名空间，记下输出里的 id
wrangler kv namespace create DEVICE_KV
```

把返回的 id 填进 `wrangler.toml`：

```toml title="wrangler.toml"
[[kv_namespaces]]
binding = "DEVICE_KV"
id = "把上一步返回的 id 填在这里"
```

设置上报口令（自己随便编一串，别用弱口令）：

```bash
wrangler secret put REPORT_TOKEN
# 提示时输入，例如：k7Xm2pQ9vLz4Rt8Wn3Bc6Yd1
```

部署：

```bash
wrangler deploy
```

### ⚠️ 不要用 `*.workers.dev` 地址

输出里会有一行 `https://xxx.<你的子域>.workers.dev`。**别用这个地址。**

该域名在部分网络（尤其国内）会被 DNS 污染，解析到不可达的 IP，表现为「不开代理就取不到状态 / 上报失败」。正确做法是把 Worker 挂到自己已经接入 Cloudflare 的域名上：

```toml title="wrangler.toml"
routes = [
  { pattern = "muyuhome.cc.cd/api/device/*", zone_name = "muyuhome.cc.cd" }
]
```

这条路由只接管 `/api/device/*`，该域名的其他路径（整站页面）不受影响。换成你自己的域名时，改这里的 `pattern` 与 `zone_name` 两处即可，然后重新 `wrangler deploy`。

验证：

```bash
curl https://muyuhome.cc.cd/api/device/health
# → {"success":true,"service":"device-status","time":...}
```

## 四、本机上报脚本

### 取前台窗口与空闲时长

Windows 没有现成的命令行能拿到「当前前台应用」，得走 Win32 互操作：

```powershell title="tools/report-device.ps1"
if (-not ("MuyuWin32" -as [type])) {
    Add-Type -Namespace MuyuWin32 -Name Native -MemberDefinition @"
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
"@
}
```

- `GetForegroundWindow()` 拿前台窗口句柄，`GetWindowText()` 拿窗口标题，`GetWindowThreadProcessId()` 反查进程名
- `GetLastInputInfo()` 拿最后一次键鼠输入的时刻，和 `[Environment]::TickCount` 相减得到空闲秒数

这里有个坑：**变量不能叫 `$pid`**，那是 PowerShell 的只读自动变量，赋值会直接报错。用 `$ownerPid` 绕开。

### 应用名映射

进程名 → 中文名 + 吐槽文案，一张哈希表搞定：

```powershell title="tools/report-device.ps1"
$AppMap = @{
    "code"              = @{ Name = "VSCode 编辑器"; Quip = "正在写代码，也可能在看 AI 写代码。" }
    "cursor"            = @{ Name = "Cursor"; Quip = "在指挥 AI 写代码。" }
    "windowsterminal"   = @{ Name = "Windows 终端"; Quip = "很有可能在 Vibe coding。" }
    "msedge"            = @{ Name = "Edge"; Quip = "在浏览器里冲浪。" }
    "wechat"            = @{ Name = "微信"; Quip = "与朋友畅聊中……" }
    "qq"                = @{ Name = "QQ"; Quip = "在水群。" }
    # ... 共 126 条
}
```

没命中映射时，再从窗口标题里猜类别兜底：

```powershell
function Get-CategoryFromTitle {
    param([string]$Title)
    if ([string]::IsNullOrWhiteSpace($Title)) { return $null }
    if ($Title -match "QQ音乐|QQ 音乐|网易云|Spotify|酷狗|酷我") { return @{ Name = "音乐播放器"; Quip = "在听歌。" } }
    if ($Title -match "Chrome|Edge|Firefox|浏览器") { return @{ Name = "浏览器"; Quip = "在浏览器里冲浪。" } }
    if ($Title -match "Visual Studio|VSCode|PyCharm|IDEA|编辑器") { return @{ Name = "代码编辑器"; Quip = "在写代码。" } }
    return $null
}
```

### 状态判定与上报

```powershell title="tools/report-device.ps1"
function Send-DeviceStatus {
    $fg = Get-ForegroundWindowInfo

    # 状态判定：无前台窗口 → 锁屏；空闲超 5 分钟 → 离开
    if ([string]::IsNullOrWhiteSpace($fg.ProcessName)) {
        $state = "locked"
        $appName = "已锁屏"
        $quip = "电脑锁屏了，人不在跟前。"
    } elseif ($fg.IdleSeconds -gt 300) {
        $state = "away"
        $mapped = Get-AppDisplay -ProcessName $fg.ProcessName
        $appName = if ($mapped) { $mapped.Name } else { $fg.ProcessName }
        $quip = "已经 " + [int]($fg.IdleSeconds / 60) + " 分钟没有操作了。"
    } else {
        $state = "online"
        # ... 命中映射 → 标题兜底 → 原样输出进程名（略）
    }

    $payload = @{
        state       = $state
        app         = $appName
        process     = $fg.ProcessName   # 原始进程名，前端据此选图标
        quip        = $quip             # 吐槽文案，前端直接展示
        title       = $cleanTitle
        idleSeconds = $fg.IdleSeconds
        host        = $env:COMPUTERNAME
    } | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri $Endpoint -Method Post `
            -Headers @{ "X-Report-Token" = $Token } `
            -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) `
            -TimeoutSec 15

        if ($response.success) {
            Write-Host ("[{0}] 已上报: {1} / {2}" -f (Get-Date -Format "HH:mm:ss"), $state, $appName) -ForegroundColor Green
        } else {
            Write-Host ("[{0}] 上报被拒绝: {1}" -f (Get-Date -Format "HH:mm:ss"), ($response | ConvertTo-Json -Compress)) -ForegroundColor Yellow
        }
    } catch {
        Write-Host ("[{0}] 上报失败: {1}" -f (Get-Date -Format "HH:mm:ss"), $_.Exception.Message) -ForegroundColor Red
    }
}
```

### 口令不要写进脚本

仓库是公开的，所以脚本里只留空 `$Token`，按顺序查找：

1. 环境变量 `MUYU_REPORT_TOKEN`
2. 同目录的 `report-token.local`（已在 `.gitignore` 中忽略）
3. 脚本里的 `$Token` 兜底（留空即可，仅本地临时调试时填）

### 装成开机自启

先手动跑一次验证：

```powershell
powershell -ExecutionPolicy Bypass -File tools\report-device.ps1 -Once
# 成功会输出：已上报: online / Edge
```

确认无误后注册计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File tools\install-device-task.ps1
```

它会注册一个登录时启动的任务，后台常驻、每 30 秒上报一次、无窗口闪烁。这里也有一个坑：

```powershell
# 必须显式带上 -User：不带的话该触发器属于「任意用户登录」，注册需要管理员权限，
# 普通账户会直接报 Access is denied（0x80070005）
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
```

卸载：

```powershell
powershell -ExecutionPolicy Bypass -File tools\uninstall-device-task.ps1
```

## 五、博客侧组件

### 组件完整源码

```astro title="src/components/widget/DeviceStatus.astro"
---
import WidgetLayout from "@/components/common/WidgetLayout.astro";
import { deviceStatusConfig } from "@/config";
import "@/styles/components/device-status.css";

interface Props {
	class?: string;
	style?: string;
}

const { class: className, style } = Astro.props;

// 配置在构建期序列化后交给客户端脚本，避免把 126 条映射写死在模板里
const configJson = JSON.stringify(deviceStatusConfig);
---

<WidgetLayout
	id="device-status-widget"
	name="我在干嘛"
	class:list={["device-status-widget", className]}
	style={style}
>
	<span slot="title-icon" class="device-status__badge" data-device-badge>
		<span class="device-status__dot"></span>
		<span data-device-badge-text>连接中</span>
	</span>

	<div class="device-status__body">
		<span class="device-status__icon">
			<iconify-icon data-device-glyph icon="fa7-solid:desktop"></iconify-icon>
		</span>
		<div class="device-status__meta">
			<div class="device-status__app" data-device-app>正在获取…</div>
			<div class="device-status__quip" data-device-quip>正在读取本机状态</div>
		</div>
	</div>

	<div class="device-status__title" data-device-title hidden></div>

	<div class="device-status__foot">
		<span class="device-status__updated" data-device-updated>--</span>
		<button
			type="button"
			class="device-status__refresh"
			data-device-refresh
			aria-label="刷新电脑状态"
			title="刷新"
		>
			<iconify-icon icon="fa7-solid:rotate-right"></iconify-icon>
		</button>
	</div>
</WidgetLayout>

<script is:inline define:vars={{ configJson }}>
	(function () {
		var CONFIG = {};
		try {
			CONFIG = JSON.parse(configJson);
		} catch (e) {
			CONFIG = {};
		}

		// 只读接口。留空 = 功能未启用，卡片整块隐藏，不留空白。
		if (!CONFIG.endpoint) {
			document.querySelectorAll(".device-status-widget").forEach(function (el) {
				el.hidden = true;
			});
			return;
		}

		// 按需加载 Iconify 运行时（动态切换图标用），与 Weather.astro 同一套做法
		function ensureIconifyLoaded() {
			if (
				typeof customElements !== "undefined" &&
				customElements.get("iconify-icon")
			) {
				return Promise.resolve();
			}
			if (window.__iconifyLoading) return window.__iconifyLoading;
			window.__iconifyLoading = new Promise(function (resolve) {
				var s = document.createElement("script");
				s.src =
					"https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js";
				s.onload = function () {
					resolve();
				};
				s.onerror = function () {
					resolve(); // 加载失败也不阻塞状态显示
				};
				document.head.appendChild(s);
			});
			return window.__iconifyLoading;
		}

		var TONES = {
			online: { text: "在线", tone: "ok" },
			away: { text: "离开", tone: "warn" },
			locked: { text: "锁屏", tone: "idle" },
		};

		function iconFor(processName, appName) {
			var map = CONFIG.iconMap || {};
			var key = String(processName || "").toLowerCase();
			if (key && map[key]) return map[key];
			var name = String(appName || "");
			var keywords = CONFIG.keywordIcons || [];
			for (var i = 0; i < keywords.length; i++) {
				if (name.indexOf(keywords[i].match) !== -1) return keywords[i].icon;
			}
			return "fa7-solid:desktop";
		}

		function formatAge(reportedAt) {
			if (!reportedAt) return "--";
			var diff = Math.max(0, Date.now() - Number(reportedAt)) / 1000;
			if (diff < 60) return "刚刚更新";
			if (diff < 3600) return Math.floor(diff / 60) + " 分钟前更新";
			var d = new Date(Number(reportedAt));
			var hh = String(d.getHours()).padStart(2, "0");
			var mm = String(d.getMinutes()).padStart(2, "0");
			return hh + ":" + mm + " 更新";
		}

		function defaultQuip(state, idleSeconds) {
			if (state === "locked") return "电脑锁屏了，人不在跟前。";
			if (state === "away") {
				var mins = Math.floor((Number(idleSeconds) || 0) / 60);
				return mins > 0
					? "已经 " + mins + " 分钟没有操作了。"
					: "暂时离开了一下。";
			}
			if (state === "online") return "正在使用中。";
			return "状态未知。";
		}

		function initWidget(container) {
			// 幂等守卫：swup 切页后侧栏会被整体替换，脚本需要能重新挂载
			if (!container || container.dataset.deviceInited === "true") return;
			container.dataset.deviceInited = "true";

			var root = container.closest("widget-layout") || container;
			var badge = container.querySelector("[data-device-badge]");
			var badgeText = container.querySelector("[data-device-badge-text]");
			var glyph = container.querySelector("[data-device-glyph]");
			var appEl = container.querySelector("[data-device-app]");
			var quipEl = container.querySelector("[data-device-quip]");
			var titleEl = container.querySelector("[data-device-title]");
			var updatedEl = container.querySelector("[data-device-updated]");
			var refreshBtn = container.querySelector("[data-device-refresh]");

			var timer = null;
			var inFlight = false;
			var lastSuccessAt = 0;

			function setBadge(text, tone) {
				if (badgeText) badgeText.textContent = text;
				if (badge) {
					badge.classList.remove(
						"is-ok",
						"is-warn",
						"is-idle",
						"is-unknown",
						"is-off",
					);
					badge.classList.add("is-" + tone);
				}
			}

			function setIcon(name) {
				if (!glyph) return;
				// iconify-icon 只在 icon 属性变化时重渲染，所以必须写属性而不是类名
				glyph.setAttribute("icon", name || "fa7-solid:desktop");
			}

			function setState(state) {
				root.dataset.state = state || "unknown";
			}

			function renderOffline(reason, record) {
				setState("offline");
				setBadge("离线", "off");
				setIcon("fa7-solid:power-off");
				if (appEl) appEl.textContent = "电脑已离线";
				if (quipEl) {
					quipEl.textContent =
						reason || "本机上报已中断，可能关机或断网。";
				}
				if (titleEl) {
					titleEl.textContent = "";
					titleEl.hidden = true;
				}
				if (updatedEl) {
					// 显示「本机上次上报」的时间，而不是我们上次请求成功的时间，
					// 否则离线时会出现「刚刚更新」这种看起来数据很新的误导文案
					updatedEl.textContent =
						record && record.reportedAt
							? formatAge(record.reportedAt)
							: "暂无数据";
				}
			}

			function renderStatus(payload) {
				if (!payload || payload.success === false) {
					renderOffline("暂时读不到状态，稍后自动重试。", null);
					return;
				}
				if (payload.reason === "no_report_yet") {
					renderOffline("本机还没有上报过状态。", null);
					return;
				}
				if (!payload.online || !payload.record) {
					renderOffline(
						"本机上报已中断，可能关机或断网。",
						payload.record,
					);
					return;
				}

				var record = payload.record;
				var state = record.state || "unknown";
				var meta = TONES[state];
				setState(state);
				if (meta) setBadge(meta.text, meta.tone);
				else setBadge("未知", "unknown");

				var appName = record.app || record.process || "未知应用";
				setIcon(iconFor(record.process, appName));
				if (appEl) appEl.textContent = appName;
				if (quipEl) {
					quipEl.textContent =
						record.quip ||
						defaultQuip(state, record.idleSeconds);
				}
				if (titleEl) {
					if (record.title) {
						titleEl.textContent = record.title;
						titleEl.hidden = false;
					} else {
						titleEl.textContent = "";
						titleEl.hidden = true;
					}
				}
				if (updatedEl) updatedEl.textContent = formatAge(record.reportedAt);
			}

			function fetchStatus(manual) {
				if (inFlight) return;
				inFlight = true;
				if (manual && refreshBtn) refreshBtn.classList.add("is-spinning");

				var url =
					CONFIG.endpoint +
					(CONFIG.endpoint.indexOf("?") === -1 ? "?" : "&") +
					"t=" +
					Date.now();

				var controller =
					typeof AbortController !== "undefined"
						? new AbortController()
						: null;
				var timeoutId = controller
					? setTimeout(function () {
							controller.abort();
						}, CONFIG.requestTimeoutMs || 8000)
					: null;

				fetch(url, {
					cache: "no-store",
					signal: controller ? controller.signal : undefined,
				})
					.then(function (res) {
						if (!res.ok) throw new Error("HTTP " + res.status);
						return res.json();
					})
					.then(function (payload) {
						lastSuccessAt = Date.now();
						renderStatus(payload);
					})
					.catch(function (err) {
						console.warn("[DeviceStatus] 获取失败：" + err.message);
						// 失败只改角标，保留上次内容，避免网络抖动把卡片闪成空白
						renderOffline("暂时读不到状态，稍后自动重试。", null);
					})
					.finally(function () {
						if (timeoutId) clearTimeout(timeoutId);
						inFlight = false;
						if (refreshBtn) {
							refreshBtn.classList.remove("is-spinning");
						}
					});
			}

			function startPolling() {
				if (timer) clearInterval(timer);
				var interval = Math.max(
					10,
					Number(CONFIG.refreshIntervalSeconds) || 30,
				);
				timer = setInterval(function () {
					// 后台标签页的定时器会被浏览器降频，这里再兜一层
					if (document.visibilityState === "visible") fetchStatus(false);
				}, interval * 1000);
			}

			if (refreshBtn) {
				refreshBtn.addEventListener("click", function () {
					fetchStatus(true);
				});
			}

			// 切回前台时若距上次成功太久，立刻补一次
			document.addEventListener("visibilitychange", function () {
				if (document.visibilityState !== "visible") return;
				var gap = Date.now() - lastSuccessAt;
				var threshold =
					(Number(CONFIG.visibilityRefreshAfterSeconds) || 20) * 1000;
				if (lastSuccessAt === 0 || gap >= threshold) fetchStatus(false);
			});

			fetchStatus(false);
			startPolling();
		}

		function initAll() {
			document.querySelectorAll(".device-status-widget").forEach(function (el) {
				initWidget(el);
			});
		}

		ensureIconifyLoaded().then(initAll);

		// 侧栏是 swup 容器（#left-sidebar-dynamic / #right-sidebar-dynamic），
		// 切页时 DOM 被整体替换且内联脚本不会重跑，所以必须重新挂载
		document.addEventListener("swup:contentReplaced", initAll);
		document.addEventListener("swup:content:replace", initAll);
	})();
</script>
```

### 样式源码

```css title="src/styles/components/device-status.css"
/* 电脑状态组件
 *
 * 数据来自本机 PowerShell 上报 → Cloudflare Worker + KV，页面只读。
 * 状态色统一收在 --device-tone，由 data-state 一次性下发给角标、图标底衬、标题竖条三处，
 * 扫一眼颜色就知道状态，不用读文字。
 */

.device-status-widget {
	/* 亮色状态色 */
	--device-ok: oklch(0.62 0.14 155);
	--device-warn: oklch(0.7 0.14 65);
	--device-idle: oklch(0.6 0.03 250);
	--device-off: oklch(0.6 0.17 25);
	--device-tone: var(--device-idle);
}

:root.dark .device-status-widget {
	/* 暗色下提亮，保证在深色卡片上可读 */
	--device-ok: oklch(0.78 0.16 155);
	--device-warn: oklch(0.8 0.14 70);
	--device-idle: oklch(0.72 0.03 250);
	--device-off: oklch(0.75 0.16 25);
}

.device-status-widget[data-state="online"] {
	--device-tone: var(--device-ok);
}
.device-status-widget[data-state="away"] {
	--device-tone: var(--device-warn);
}
.device-status-widget[data-state="locked"] {
	--device-tone: var(--device-idle);
}
.device-status-widget[data-state="offline"] {
	--device-tone: var(--device-off);
}

/* —— 标题右侧的状态角标 —— */
.device-status__badge {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 6px;
	padding: 3px 10px 3px 8px;
	border-radius: 999px;
	color: var(--device-tone);
	background: color-mix(in oklch, var(--device-tone) 14%, transparent);
	border: 1px solid color-mix(in oklch, var(--device-tone) 26%, transparent);
	font-size: 11px;
	font-weight: 600;
	line-height: 1.5;
	letter-spacing: 0.5px;
	transition:
		color 150ms ease,
		background-color 150ms ease,
		border-color 150ms ease;
}

/* 角标自带兜底色：脚本只切 class 也能正确上色 */
.device-status__badge.is-ok {
	--device-tone: var(--device-ok);
}
.device-status__badge.is-warn {
	--device-tone: var(--device-warn);
}
.device-status__badge.is-idle,
.device-status__badge.is-unknown {
	--device-tone: var(--device-idle);
}
.device-status__badge.is-off {
	--device-tone: var(--device-off);
}

.device-status__dot {
	position: relative;
	flex: none;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: currentColor;
	animation: device-status-pulse 2s ease-in-out infinite;
}

@keyframes device-status-pulse {
	0%,
	100% {
		opacity: 1;
		box-shadow: 0 0 0 0 currentColor;
	}
	50% {
		opacity: 0.65;
		box-shadow: 0 0 0 3px color-mix(in oklch, currentColor 22%, transparent);
	}
}

/* —— 应用主体 —— */
.device-status__body {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 0 0.25rem;
}

.device-status__icon {
	position: relative;
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border-radius: 14px;
	color: var(--device-tone);
	background: linear-gradient(
		150deg,
		color-mix(in oklch, var(--device-tone) 24%, transparent),
		color-mix(in oklch, var(--device-tone) 7%, transparent)
	);
	border: 1px solid color-mix(in oklch, var(--device-tone) 24%, transparent);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
	font-size: 19px;
	line-height: 1;
	transition:
		color 200ms ease,
		background-color 200ms ease,
		border-color 200ms ease;
}

.device-status__icon iconify-icon {
	display: inline-flex;
	width: 1em;
	height: 1em;
}

.device-status__meta {
	flex: 1;
	min-width: 0;
}

.device-status__app {
	overflow: hidden;
	color: var(--deep-text);
	font-size: 15px;
	font-weight: 600;
	line-height: 20px;
	letter-spacing: 0.2px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

:root.dark .device-status__app {
	/* --deep-text 在暗色主题下没有被重定义，这里补上 */
	color: oklch(0.93 0.01 var(--hue));
}

.device-status__quip {
	margin-top: 3px;
	overflow: hidden;
	color: var(--content-meta);
	font-size: 12px;
	line-height: 17px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* —— 窗口标题：左侧一道状态色竖线，不用整块灰底 —— */
.device-status__title {
	position: relative;
	margin-top: 0.5rem;
	padding: 1px 0 1px 10px;
	overflow: hidden;
	color: var(--content-meta);
	font-size: 11.5px;
	line-height: 16px;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.8;
}

.device-status__title::before {
	content: "";
	position: absolute;
	top: 50%;
	left: 0;
	width: 2px;
	height: 12px;
	margin-top: -6px;
	border-radius: 1px;
	background: var(--device-tone);
	opacity: 0.6;
}

.device-status__title[hidden] {
	display: none;
}

/* —— 底部：更新时间 + 刷新 —— */
.device-status__foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 0.75rem;
	padding-top: 0.5rem;
	border-top: 1px solid var(--line-divider);
}

.device-status__updated {
	color: var(--content-meta);
	font-size: 11px;
	letter-spacing: 0.3px;
	opacity: 0.8;
}

.device-status__refresh {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--content-meta);
	font-size: 12px;
	cursor: pointer;
	opacity: 0.7;
	transition:
		color 150ms ease,
		background-color 150ms ease,
		opacity 150ms ease;
}

.device-status__refresh iconify-icon {
	display: inline-flex;
	width: 1em;
	height: 1em;
}

.device-status__refresh:hover {
	color: var(--primary);
	background: var(--btn-regular-bg);
	opacity: 1;
}

.device-status__refresh.is-spinning iconify-icon {
	animation: device-status-spin 0.8s linear infinite;
}

@keyframes device-status-spin {
	to {
		transform: rotate(360deg);
	}
}

/* —— 离线时整体降噪 —— */
.device-status-widget[data-state="offline"] .device-status__app {
	color: var(--content-meta);
}

.device-status-widget[data-state="offline"] .device-status__icon {
	background: linear-gradient(
		150deg,
		color-mix(in oklch, var(--device-tone) 14%, transparent),
		transparent
	);
}

@media (max-width: 480px) {
	.device-status__icon {
		width: 40px;
		height: 40px;
		border-radius: 13px;
		font-size: 17px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.device-status__dot {
		animation: none;
	}
	.device-status__refresh.is-spinning iconify-icon {
		animation: none;
	}
}
```

### 配置文件

```typescript title="src/config/deviceStatusConfig.ts"
import type { DeviceStatusConfig } from "@/types/deviceStatusConfig";

// 电脑状态组件配置
//
// 数据链路：本机 PowerShell 定时上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。
//
// 想加新应用：只需要在本机上报脚本的映射表里加，这里不用动。
// 这里只负责「进程名 → 图标」，映射表是按主页（muyudada.github.io）的 126 条抄过来的。
export const deviceStatusConfig: DeviceStatusConfig = {
	enable: true,

	// 只读接口。留空等于未启用：卡片会整块隐藏，页面上不会留一块空白。
	// 注意：不要用 *.workers.dev 那个地址，部分网络下该域名不可达，已改为自有域名。
	endpoint: "https://muyuhome.cc.cd/api/device/status",

	// 轮询间隔比本机上报间隔（30 秒）略长，避免刚好卡在上报边界上读到旧数据
	refreshIntervalSeconds: 30,
	requestTimeoutMs: 8000,
	// 与 Worker 侧的离线判定保持一致：超过 180 秒没有新上报就是离线
	staleAfterSeconds: 180,
	// 后台标签页的定时器会被浏览器降频，切回前台时距上次成功超过这个值就立刻补一次
	visibilityRefreshAfterSeconds: 20,

	// 进程名（小写）→ Iconify 图标名。
	// 进程名优先命中，其次按应用名关键词兜底，最后给通用显示器图标。
	iconMap: {
		// —— 编辑器 / IDE ——
		code: "fa7-solid:code",
		cursor: "fa7-solid:code",
		devenv: "fa7-solid:code",
		idea64: "fa7-solid:code",
		pycharm64: "fa7-solid:code",
		webstorm64: "fa7-solid:code",
		goland64: "fa7-solid:code",
		clion64: "fa7-solid:code",
		rider64: "fa7-solid:code",
		sublime_text: "fa7-solid:code",
		androidstudio64: "fa7-brands:android",
		// —— 终端 ——
		windowsterminal: "fa7-solid:terminal",
		wt: "fa7-solid:terminal",
		powershell: "fa7-solid:terminal",
		pwsh: "fa7-solid:terminal",
		cmd: "fa7-solid:terminal",
		conhost: "fa7-solid:terminal",
		"git-bash": "fa7-solid:terminal",
		mintty: "fa7-solid:terminal",
		// —— 浏览器 ——
		msedge: "fa7-brands:edge",
		msedgewebview2: "fa7-brands:edge",
		chrome: "fa7-brands:chrome",
		firefox: "fa7-brands:firefox-browser",
		brave: "fa7-brands:brave",
		opera: "fa7-brands:opera",
		safari: "fa7-brands:safari",
		iexplore: "fa7-brands:internet-explorer",
		// —— 通讯 ——
		wechat: "fa7-brands:weixin",
		weixin: "fa7-brands:weixin",
		qq: "fa7-brands:qq",
		tim: "fa7-brands:qq",
		telegram: "fa7-brands:telegram",
		discord: "fa7-brands:discord",
		skype: "fa7-brands:skype",
		whatsapp: "fa7-brands:whatsapp",
		line: "fa7-brands:line",
		viber: "fa7-brands:viber",
		dingtalk: "fa7-solid:comment-dots",
		wework: "fa7-solid:comment-dots",
		feishu: "fa7-solid:comment-dots",
		lark: "fa7-solid:comment-dots",
		// —— 音乐 ——
		cloudmusic: "fa7-solid:music",
		qqmusic: "fa7-solid:music",
		spotify: "fa7-brands:spotify",
		itunes: "fa7-brands:itunes",
		foobar2000: "fa7-solid:music",
		aimp: "fa7-solid:music",
		// —— 影音 ——
		potplayer: "fa7-solid:film",
		potplayermini64: "fa7-solid:film",
		vlc: "fa7-solid:film",
		mpv: "fa7-solid:film",
		bilibili: "fa7-brands:bilibili",
		youtube: "fa7-brands:youtube",
		vimeo: "fa7-brands:vimeo",
		twitch: "fa7-brands:twitch",
		obs64: "fa7-solid:video",
		// —— 游戏 ——
		steam: "fa7-brands:steam",
		steamwebhelper: "fa7-brands:steam",
		epicgameslauncher: "fa7-solid:gamepad",
		genshinimpact: "fa7-solid:gamepad",
		yuanshen: "fa7-solid:gamepad",
		starrail: "fa7-solid:gamepad",
		dota2: "fa7-solid:gamepad",
		cs2: "fa7-solid:gamepad",
		tslgame: "fa7-solid:gamepad",
		unity: "fa7-brands:unity",
		// fa7-brands 里没有 blender，退回 simple-icons
		blender: "simple-icons:blender",
		xbox: "fa7-brands:xbox",
		playstation: "fa7-brands:playstation",
		// —— 办公 ——
		winword: "fa7-solid:file-word",
		excel: "fa7-solid:file-excel",
		powerpnt: "fa7-solid:file-powerpoint",
		onenote: "fa7-solid:note-sticky",
		wps: "fa7-solid:file-lines",
		et: "fa7-solid:file-excel",
		wpp: "fa7-solid:file-powerpoint",
		acrobat: "fa7-solid:file-pdf",
		acrord32: "fa7-solid:file-pdf",
		sumatrapdf: "fa7-solid:file-pdf",
		notepad: "fa7-solid:file-lines",
		"notepad++": "fa7-solid:file-lines",
		typora: "fa7-solid:file-lines",
		obsidian: "fa7-solid:book",
		zotero: "fa7-solid:book",
		notion: "fa7-brands:notion",
		trello: "fa7-brands:trello",
		jira: "fa7-brands:jira",
		confluence: "fa7-brands:confluence",
		// —— 设计 ——
		photoshop: "fa7-solid:image",
		illustrator: "fa7-solid:pen-nib",
		figma: "fa7-brands:figma",
		sketch: "fa7-brands:sketch",
		afterfx: "fa7-solid:wand-magic-sparkles",
		premiere: "fa7-solid:film",
		// —— 开发工具 ——
		"github desktop": "fa7-brands:github",
		gitkraken: "fa7-brands:git-alt",
		sourcetree: "fa7-brands:git-alt",
		postman: "fa7-solid:paper-plane",
		docker: "fa7-brands:docker",
		navicat: "fa7-solid:database",
		dbeaver: "fa7-solid:database",
		// —— 服务器 / 网络 ——
		filezilla: "fa7-solid:server",
		winscp: "fa7-solid:server",
		putty: "fa7-solid:server",
		mobaxterm: "fa7-solid:server",
		xshell: "fa7-solid:server",
		clash: "fa7-solid:shield-halved",
		"clash-verge": "fa7-solid:shield-halved",
		v2rayn: "fa7-solid:shield-halved",
		openlist: "fa7-solid:cloud",
		alist: "fa7-solid:cloud",
		// —— 下载 / 压缩 ——
		idman: "fa7-solid:download",
		thunder: "fa7-solid:download",
		qbittorrent: "fa7-solid:download",
		motrix: "fa7-solid:download",
		"7zfm": "fa7-solid:file-zipper",
		winrar: "fa7-solid:file-zipper",
		bandizip: "fa7-solid:file-zipper",
		// —— 系统工具 ——
		explorer: "fa7-solid:folder-open",
		taskmgr: "fa7-solid:gauge-high",
		snippingtool: "fa7-solid:crop-simple",
		everything: "fa7-solid:magnifying-glass",
		mstsc: "fa7-solid:desktop",
		calculator: "fa7-solid:calculator",
		control: "fa7-solid:sliders",
		windbg: "fa7-solid:bug",
	},

	keywordIcons: [
		{ match: "音乐", icon: "fa7-solid:music" },
		{ match: "浏览器", icon: "fa7-solid:globe" },
		{ match: "终端", icon: "fa7-solid:terminal" },
		{ match: "代码", icon: "fa7-solid:code" },
		{ match: "编辑器", icon: "fa7-solid:code" },
		{ match: "设计", icon: "fa7-solid:pen-ruler" },
		{ match: "表格", icon: "fa7-solid:file-excel" },
		{ match: "文档", icon: "fa7-solid:file-lines" },
		{ match: "视频", icon: "fa7-solid:film" },
		{ match: "播放", icon: "fa7-solid:film" },
	],
};
```

### 类型定义

```typescript title="src/types/deviceStatusConfig.ts"
// 电脑状态组件配置类型
//
// 数据链路：本机 PowerShell 定时上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。

/** 前台状态：在线 / 离开 / 锁屏 / 离线（离线由服务端按上报断流判定） */
export type DeviceStatusState = "online" | "away" | "locked" | "offline";

/** 按应用名关键词兜底的图标规则 */
export interface DeviceStatusKeywordIcon {
	/** 应用名里包含这个子串时命中 */
	match: string;
	/** Iconify 图标名，如 "fa7-brands:edge" */
	icon: string;
}

export interface DeviceStatusConfig {
	/** 是否启用该组件，false 时整张卡片不渲染 */
	enable: boolean;
	/** 只读接口地址，留空等于未启用（卡片会隐藏，不留空白） */
	endpoint: string;
	/** 轮询间隔（秒），比本机上报间隔略长，避免刚好卡在上报边界读到旧数据 */
	refreshIntervalSeconds: number;
	/** 单次请求超时（毫秒） */
	requestTimeoutMs: number;
	/** 超过这个秒数没有新上报就显示离线（与 Worker 侧判定保持一致） */
	staleAfterSeconds: number;
	/** 从后台切回前台时，距上次成功超过这个秒数就立刻补一次 */
	visibilityRefreshAfterSeconds: number;
	/** 进程名（小写）→ Iconify 图标名 */
	iconMap: Record<string, string>;
	/** 进程名没命中时，按应用名关键词兜底 */
	keywordIcons: DeviceStatusKeywordIcon[];
}
```

## 六、注册组件

在 `src/components/layout/SideBar.astro` 中导入：

```js title="src/components/layout/SideBar.astro" ins={3}
import Advertisement from "@/components/widget/Advertisement.astro";
import Categories from "@/components/widget/Categories.astro";
import DeviceStatus from "@/components/widget/DeviceStatus.astro";
import Dynamic from "@/components/widget/Dynamic.astro";
```

同时在 `componentMap` 中注册：

```js title="src/components/layout/SideBar.astro" ins={4}
const componentMap = {
    // ...
    categories: Categories,
    deviceStatus: DeviceStatus,
    dynamic: Dynamic,
};
```

## 七、注册类型

在 `src/types/sidebarConfig.ts` 的类型联合中添加组件名：

```typescript title="src/types/sidebarConfig.ts" ins={3}
export type WidgetComponentType =
    | "categories"
    | "deviceStatus"
    | "dynamic";
```

## 八、配置方式

在 `src/config/sidebarConfig.ts` 的左侧边栏中配置。我把它排在用户资料下面，因为这两张卡都属于「关于我」的信息：

```typescript title="src/config/sidebarConfig.ts" ins={9-15}
leftComponents: [
    {
        // 组件类型：用户资料组件
        type: "profile",
        enable: true,
        position: "top",
        showOnPostPage: true,
    },
    {
        // 组件类型：电脑状态组件（本机上报 → Cloudflare Worker → 只读展示）
        type: "deviceStatus",
        enable: true,
        position: "top",
        showOnPostPage: false,
    },
    // ...
]
```

`position` 可选 `top`（固定顶部）或 `sticky`（粘性定位）；`showOnPostPage` 控制文章详情页是否显示。

> **移动端看不到这张卡片** —— 它放在左侧栏，而 `<768px` 时左右侧栏都会被隐藏（用户资料、公告、音乐都一样）。如果希望手机上也能看到，把它加进 `mobileBottomComponents`：
>
> ```typescript title="src/config/sidebarConfig.ts" ins={4}
> mobileBottomComponents: [
>     // ...
>     {
>         type: "deviceStatus",
>         enable: true,
>         showOnPostPage: false,
>     },
> ]
> ```

## 九、实现要点

### 状态色统一收在一个变量里

角标、图标底衬、标题竖条三处都要跟随状态变色。与其写三套选择器，不如把它们都指向同一个变量 `--device-tone`：

```css
.device-status-widget[data-state="online"] { --device-tone: var(--device-ok); }
.device-status-widget[data-state="away"]   { --device-tone: var(--device-warn); }
```

脚本只需要改 `root.dataset.state`，三处颜色一起变。角标自己再带一份 `.is-ok` / `.is-warn` 兜底，这样即使脚本只切 class 也能正确上色。

### 离线时的时间戳语义

这是个真实踩到的坑。第一版离线时显示的是「我们上次请求成功的时间」，结果本机断网 10 分钟后，卡片上依然写着「刚刚更新」——看起来数据很新，实际早就过期了。

正确的做法是显示**本机上次上报的时间**：

```js
// 显示「本机上次上报」的时间，而不是我们上次请求成功的时间，
// 否则离线时会出现「刚刚更新」这种看起来数据很新的误导文案
updatedEl.textContent =
    record && record.reportedAt ? formatAge(record.reportedAt) : "暂无数据";
```

### 图标三级匹配

`process` 字段是原始进程名（如 `msedge`），`app` 是中文名（如 `Edge`）。匹配顺序是：

1. **进程名精确命中** `iconMap` —— 最准，直接映射到品牌图标
2. **应用名关键词命中** `keywordIcons` —— 没登记过的进程，但名字里有「音乐」「浏览器」这类词
3. **通用显示器图标** —— 全都没命中时兜底

```js
function iconFor(processName, appName) {
    var map = CONFIG.iconMap || {};
    var key = String(processName || "").toLowerCase();
    if (key && map[key]) return map[key];
    var name = String(appName || "");
    var keywords = CONFIG.keywordIcons || [];
    for (var i = 0; i < keywords.length; i++) {
        if (name.indexOf(keywords[i].match) !== -1) return keywords[i].icon;
    }
    return "fa7-solid:desktop";
}
```

### `iconify-icon` 必须改属性而不是类名

动态换图标时，`iconify-icon` 只在 `icon` 属性变化时才重新渲染。改 class 是没用的：

```js
function setIcon(name) {
    if (!glyph) return;
    // iconify-icon 只在 icon 属性变化时重渲染，所以必须写属性而不是类名
    glyph.setAttribute("icon", name || "fa7-solid:desktop");
}
```

Iconify 运行时是按需加载的，加载失败也不阻塞状态文字显示——图标没有就没有，文字照常更新。

### 失败不闪空白

网络抖动是常事。请求失败时如果直接把卡片清空，用户会看到内容闪来闪去。所以失败路径只改角标和文案，保留上一次的正文内容：

```js
.catch(function (err) {
    console.warn("[DeviceStatus] 获取失败：" + err.message);
    // 失败只改角标，保留上次内容，避免网络抖动把卡片闪成空白
    renderOffline("暂时读不到状态，稍后自动重试。", null);
})
```

### swup 切页后要重新挂载

Firefly 用 Swup 做无刷新切页，左右侧栏是 swup 容器，切页时 DOM 会被整体替换，而内联脚本不会重跑。所以必须监听事件重新初始化，并加幂等守卫防止重复挂载：

```js
function initWidget(container) {
    // 幂等守卫：swup 切页后侧栏会被整体替换，脚本需要能重新挂载
    if (!container || container.dataset.deviceInited === "true") return;
    container.dataset.deviceInited = "true";
    // ...
}

document.addEventListener("swup:contentReplaced", initAll);
document.addEventListener("swup:content:replace", initAll);
```

### 主题适配

应用名走 `var(--deep-text)`，但**上游暗色主题没有重定义 `--deep-text`**（仍是 `oklch(0.25 0.02 250)`，接近黑色），在深色卡片上几乎看不见。所以这里必须自己补一份覆盖：

```css
:root.dark .device-status__app {
    color: oklch(0.93 0.01 var(--hue));
}
```

四档状态色也都在 `:root.dark` 下重新提亮了一轮，保证深色背景上的对比度。

### 后台标签页不轮询

浏览器会把后台标签页的定时器降频，与其让它乱跑，不如主动跳过，等切回前台再补：

```js
timer = setInterval(function () {
    // 后台标签页的定时器会被浏览器降频，这里再兜一层
    if (document.visibilityState === "visible") fetchStatus(false);
}, interval * 1000);
```

## 十、相关文件

组件：[/src/components/widget/DeviceStatus.astro](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/components/widget/DeviceStatus.astro)

配置：[/src/config/deviceStatusConfig.ts](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/config/deviceStatusConfig.ts)

样式：[/src/styles/components/device-status.css](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/styles/components/device-status.css)

相关源码：[MuyuDada/Firefly-yuan](https://github.com/MuyuDada/Firefly-yuan)

Cloudflare 文档：[Workers KV](https://developers.cloudflare.com/kv/)

## 🔗 最后

这套东西真正麻烦的不是前端——前端只是画一张卡片。麻烦的是**数据从哪来**：静态站点读不到本机状态，就只能反过来让本机推上去。

几个值得注意的点：`*.workers.dev` 域名在国内网络下不可靠，一定要挂自己的域名；计划任务的触发器要显式带 `-User`，否则普通账户注册不了；离线时显示的时间必须是本机上次上报的时间，不然会出现「明明关机了却显示刚刚更新」的迷惑现象。

安全上要有心理准备：**读接口是公开的**——任何知道地址的人都能看到你当前开着什么程序。写接口靠 `REPORT_TOKEN` 保护，但读接口没法加密（前端要读，token 写进 JS 等于没保护）。能接受这一点再上，介意的话就别放窗口标题。
