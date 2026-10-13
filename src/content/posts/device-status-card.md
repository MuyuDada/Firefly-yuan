---
title: '为 Firefly 添加「电脑状态」侧栏卡片：实时展示本机在用什么'
slug: 'device-status-card'
published: 2026-10-12
description: '静态博客看不到本机信息，所以由本机 PowerShell 变化驱动上报，经 Cloudflare Worker + KV 中转，博客侧只读展示；再用 GitHub Gist 做一条备用通道，主通道挂了也不至于整块失效。含完整 Worker、上报脚本与侧栏组件源码，以及品牌色图标、离线阈值自动推算、图标三级匹配等实现要点。'
image: api
category: 自建服务
tags: [Cloudflare, PowerShell, 小组件]
draft: false
pinned: false
---

博客是纯静态的，构建完就是一堆 HTML，浏览器端看不到你电脑上开着什么程序。所以想在自己的站点上显示「此刻正在用什么」，链路只能是**反过来**的：本机主动把状态推上去，页面再去读。

这篇记录我从主页移植到博客的完整过程——Cloudflare Worker + KV 当中转站，本机 PowerShell 脚本在**前台应用变化时立刻上报**、不变时按心跳保活，博客侧做成一张挂在左侧栏的卡片。为了让这条链路别那么脆，后来又加了一条**备用通道**：同一份快照再写一份到 GitHub Gist，主通道取不到新鲜数据时页面改读它。效果可以直接看本站首页左侧栏。

## 一、功能概览

卡片标题叫「我在干嘛」，标题右边一个状态角标，中间是当前应用的**品牌色**图标和名字，下面一行窗口标题，底部是机器名、更新时间、数据来源和手动刷新。

四种状态各有自己的配色，扫一眼颜色就知道人在不在：

| 状态 | 角标 | 图标 | 副文案 |
| --- | --- | --- | --- |
| 在线 | 绿 · 在线 | 当前应用图标（品牌色） | 在浏览器里冲浪。 |
| 离开 | 橙 · 离开 | 当前应用图标（品牌色） | 已经 N 分钟没有操作了。 |
| 锁屏 | 灰 · 锁屏 | 锁 | 电脑锁屏了，人不在跟前。 |
| 离线 | 红 · 离线 | 关机 | 本机上报已中断，可能关机或断网。 |

主要能力：

- **变化驱动上报** — 本机每 15 秒在本地轮询一次前台窗口（纯 Win32 调用，零网络开销），**只有前台应用变了才上报**；没变时按心跳保活（在线 5 分钟、离开/锁屏 10 分钟），页面每 60 秒轮询一次
- **四种状态** — 在线 / 离开 / 锁屏 / 离线，由本机判定后上报，页面只负责渲染
- **两条色彩线索** — 状态色（`--device-tone`）由 `data-state` 下发给角标、图标底衬、标题竖条；品牌色（`--device-brand`）按进程名内联写入，只作用在图标本身，没配的应用自动回落状态色
- **图标三级匹配** — 进程名优先（138 条映射）→ 应用名关键词兜底 → 通用显示器图标
- **吐槽文案** — 应用名和文案都由本机脚本的映射表给出，页面直接展示，想加应用不用动博客代码
- **离线阈值自动推算** — 上报时带上当前心跳间隔，Worker 按 `max(心跳 × 2, 心跳 + 60s)` 算阈值，改心跳只需改本机脚本，两端不会失配
- **备用通道** — 本机每次上报成功后，把同一份快照 PATCH 到自己的 secret Gist；主通道连不上、或它说「离线」但 Gist 里那份更新鲜时，页面改读 Gist，并在底部标一个「备用通道」chip
- **卡片能力** — 基于 `WidgetLayout` 开发，自动继承折叠与入场动画，亮暗色自适应

## 二、整体架构

```
本机 PowerShell（本地轮询 15s，变化即上报，否则按心跳）
        │  POST /api/device/report   （带 X-Report-Token）
        ▼
Cloudflare Worker  ──写入──▶  Cloudflare KV
        ▲
        │  GET /api/device/status    （公开只读，带 CORS）
        │                                    ← 主通道，优先
        │
博客 DeviceStatus.astro（每 60 秒轮询）
        │
        │  主通道失败 / 主通道说离线但快照更新鲜
        ▼
GitHub Gist raw  ◀──PATCH──  同一份快照（本机上报成功后顺带写）
                                     ← 备用通道，独立链路
```

KV 里只存一条记录（key = `device:latest`），永远覆盖，不累积历史。

免费额度是**每天 10 万次读、1000 次写**，这里的关键是：**读不是瓶颈，写才是**。按固定 30 秒上报算，一天要 2880 次写，是额度的近 3 倍，而且写超额会直接报错、不会降级。所以上报改成了变化驱动：挂机时一天约 288 次写，正常使用 400~600 次，稳稳落在 1000 以内。

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

// 离线判定阈值（秒）。
//
// 阈值必须大于上报脚本对应状态的「心跳间隔」，否则会在两次心跳之间被误判成离线。
// 为了不用两头手动对齐，上报脚本会把当前心跳间隔（heartbeatSeconds）一起报上来，
// 这里按「心跳 × 容错倍数」自动算阈值：
//   online  心跳 300s → 阈值 600s
//   away    心跳 600s → 阈值 900s
// 容错倍数取 2，让网络抖动、一次上报失败都不会立刻翻成离线。
//
// 下面的 STALE_AFTER_SECONDS 只是**兜底**：老版本脚本没报 heartbeatSeconds 时用它。
const STALE_AFTER_SECONDS = { online: 600, away: 900, locked: 900 };
const DEFAULT_STALE_AFTER_SECONDS = 600;
const STALE_TOLERANCE_FACTOR = 2;   // 阈值 = 心跳 × 该倍数
const MIN_STALE_MARGIN = 60;        // 阈值至少比心跳多这么多秒
const MIN_STALE_SECONDS = 120;      // 阈值下限，防止心跳过小导致误判
// 阈值上限。必须**大于**上报字段允许的最大心跳（86400s，见 report 里的 clamp），
// 否则极端心跳下阈值会被压到等于心跳，正常的心跳间隙又会被误判成离线。
const MAX_STALE_SECONDS = 86400 * 2 + 60;

/**
 * 由上报的心跳间隔推算离线阈值（秒）。
 *
 * 硬性不变量：返回值恒 > heartbeatSeconds，否则设备会在两次正常心跳之间
 * 被误判成离线。为此取 max(心跳×倍数, 心跳+余量) 而不是单纯乘倍数。
 */
function staleThresholdFor(record) {
    const state = record && record.state;
    const fallback = STALE_AFTER_SECONDS[state] || DEFAULT_STALE_AFTER_SECONDS;

    const heartbeat = Number(record && record.heartbeatSeconds);
    if (!Number.isFinite(heartbeat) || heartbeat <= 0) {
        return fallback;
    }

    const computed = Math.max(
        heartbeat * STALE_TOLERANCE_FACTOR,
        heartbeat + MIN_STALE_MARGIN,
    );
    return Math.max(MIN_STALE_SECONDS, Math.min(MAX_STALE_SECONDS, computed));
}

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
                // 上报脚本当前的心跳间隔（秒）。读取时据此推算离线阈值，
                // 这样改心跳只需要改本机脚本，Worker 自动跟随，不会两端失配。
                heartbeatSeconds: Math.max(0, Math.min(86400, Number(body.heartbeatSeconds) || 0)),
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

            // 离线判定：阈值由上报脚本报上来的心跳间隔自动推算，
            // 所以改心跳只需改本机脚本，这里自动跟随，不会两端失配。
            const ageSeconds = Math.round((Date.now() - (record.reportedAt || 0)) / 1000);
            const threshold = staleThresholdFor(record);
            const stale = ageSeconds > threshold;

            return json({
                success: true,
                online: !stale,
                stale: stale,
                ageSeconds: ageSeconds,
                staleAfterSeconds: threshold,
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

### 离线阈值随心跳自动推算

第一版把离线阈值**写死在 Worker 里**（`STALE_AFTER_SECONDS = 600`），而心跳间隔在脚本里——两处数字靠人记住同步。一旦失配，设备会在两次正常心跳之间被误判成离线：比如脚本心跳改成 10 分钟，Worker 还按 600 秒算，那第 601 秒卡片就翻红了，可下一次心跳还要 9 分钟才来。

改成**由上报数据自己带阈值依据**：脚本上报时多带一个 `heartbeatSeconds`，Worker 收到后按「心跳 × 容错倍数」算：

```js
const STALE_TOLERANCE_FACTOR = 2;   // 阈值 = 心跳 × 该倍数
const MIN_STALE_MARGIN = 60;        // 阈值至少比心跳多这么多秒
const MIN_STALE_SECONDS = 120;      // 阈值下限，防止心跳过小导致误判
const MAX_STALE_SECONDS = 86400 * 2 + 60;

function staleThresholdFor(record) {
    const state = record && record.state;
    const fallback = STALE_AFTER_SECONDS[state] || DEFAULT_STALE_AFTER_SECONDS;

    const heartbeat = Number(record && record.heartbeatSeconds);
    if (!Number.isFinite(heartbeat) || heartbeat <= 0) {
        return fallback;
    }

    const computed = Math.max(
        heartbeat * STALE_TOLERANCE_FACTOR,
        heartbeat + MIN_STALE_MARGIN,
    );
    return Math.max(MIN_STALE_SECONDS, Math.min(MAX_STALE_SECONDS, computed));
}
```

这里有个**硬性不变量：返回值必须恒大于 `heartbeatSeconds`**，否则设备一定会在两次正常心跳之间被误判离线。所以取的是 `max(心跳×2, 心跳+60)` 而**不是单纯乘 2**——如果只写 `心跳 × 2` 再把结果夹到上限，那么当心跳 ≥ 3600 秒时，`2 × 心跳` 会被上限压回 3600，正好**等于**心跳，不变量就破了。加一个 `心跳 + 60` 的余量项才能保证严格大于。

容错倍数取 2，是让网络抖动、偶发一次上报失败都不至于立刻翻成离线。阈值算出来后随响应回传给前端（`staleAfterSeconds` 字段），所以前端也能知道「这次多久算过期」。

`STALE_AFTER_SECONDS` 那张表只是**兜底**：老版本脚本没报 `heartbeatSeconds` 时用它。

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
name = "muyu-device-status"
main = "device-status-worker.js"
compatibility_date = "2026-10-01"

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

**`routes` 必须写在 `[[kv_namespaces]]` 之前。** TOML 里表头之后的键都属于那张表，写在 KV 表下面会被解析成 `kv_namespaces[0].routes`，wrangler 只会警告一句 `Unexpected fields found in kv_namespaces[0] field: "routes"` 然后**静默忽略路由**——部署看起来成功了，实际路由根本没生效，表现就是「自定义域名 404，但 workers.dev 是好的」。

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
    # ... 共 104 条
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
        # 当前状态的心跳间隔。Worker 用「心跳 + 容错」算离线阈值，
        # 这样改心跳不用再去动 Worker，两端不会失配。
        heartbeatSeconds = (Get-HeartbeatForState -State $state)
        # 上报时刻（Unix 毫秒）。主通道不依赖它（Worker 自己盖时间戳），
        # 但备用通道读的是静态快照，前端必须靠这个字段判时效。
        reportedAt  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
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

真正省额度的是外面的主循环——**采集频率和上报频率解耦**：

```powershell
# ---- 省额度模式：变化驱动 + 心跳 ----
$identityChanged = ($signature -ne $lastSignature)
$titleChanged = ($TitleTriggersUpdate -and $fg.Title -ne $lastTitle)
$heartbeat = Get-HeartbeatForState -State $state
$heartbeatDue = (($now - $lastSentAt).TotalSeconds -ge $heartbeat)

if ($identityChanged -or $titleChanged -or $heartbeatDue) {
    [void](Send-DeviceStatus)
    $lastSentAt = $now
}
Start-Sleep -Seconds $PollSeconds
```

每 15 秒读一次前台窗口（纯本地 Win32 调用，不产生任何网络请求），只有「身份」变了才发请求。窗口标题变化**默认不触发上报**——浏览器翻页时标题一直在变，跟着走会瞬间烧光额度；标题由心跳顺带刷新。需要标题实时同步时可以加 `-TitleTriggersUpdate`。

### 备用通道：把同一份快照写进 Gist

主通道整条链路都压在 Cloudflare 上——域名被污染、Worker 故障、KV 额度耗尽，任意一环出问题卡片就瞎了。所以上报成功后再做一件「尽力而为」的事：把同一份 payload PATCH 到自己的一个 secret Gist，前端就多了一条完全独立的读取路径。

```powershell title="tools/report-device.ps1"
function Write-Snapshot {
    param([string]$Payload)

    if (-not $SnapshotEnabled) { return $false }

    # GitHub raw 响应带 Cache-Control: max-age=300，而且实测写完之后
    # GitHub 那边要几十秒到一百多秒才对外可见（连写 5 轮实测 1/58/103/54/46 秒）。
    # 写得比这更勤页面也不会更早看到，纯属浪费 API 配额
    # （未认证 60 次/小时，认证 5000 次/小时）。
    $elapsed = ([datetime]::UtcNow - $script:LastSnapshotAt).TotalSeconds
    if ($elapsed -lt $SnapshotIntervalSeconds) { return $false }

    try {
        $body = @{
            description = "Muyu 主页 · 电脑状态快照（备用通道，主页只读）"
            files       = @{
                $GistFileName = @{ content = $Payload }
            }
        } | ConvertTo-Json -Depth 4 -Compress

        [void](Invoke-RestMethod -Uri "https://api.github.com/gists/$GistId" -Method Patch `
            -Headers @{
                "Authorization" = "token $(Resolve-GithubToken)"
                "User-Agent"    = "muyu-device-status"
                "Accept"        = "application/vnd.github+json"
            } `
            -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
            -TimeoutSec 15)

        $script:LastSnapshotAt = [datetime]::UtcNow
        return $true
    } catch {
        Write-Host ("[{0}] 快照写入失败（不影响主通道）: {1}" -f (Get-Date -Format "HH:mm:ss"), $_.Exception.Message) -ForegroundColor Yellow
        return $false
    }
}
```

调用点就在主通道上报成功的分支里：

```powershell
if ($response.success) {
    Write-Host ("[{0}] 已上报: {1} / {2}" -f (Get-Date -Format "HH:mm:ss"), $state, $appName) -ForegroundColor Green
    Write-Snapshot -Payload $payload
    return $true
}
```

三个设计取舍值得说明：

- **失败只打黄字、不抛异常**。备用通道是加分项，绝不能因为写 Gist 失败就把主通道的结果也搞成失败。
- **写入节流**（`$SnapshotIntervalSeconds`，默认 60 秒）。Gist 保留全部修订历史，每次上报都写会让历史涨得飞快；而且 GitHub 那边本来就有传播延迟，写勤了也没用。节流下限与前端轮询节奏对齐。
- **凭据不进仓库**。gist id 走 `MUYU_GIST_ID` 环境变量 → `tools\gist-id.local`；令牌走 `MUYU_GITHUB_TOKEN` → `tools\github-token.local` → 最后再从 git 凭据管理器里捞（本机 push 用的那个令牌通常带 gist scope）。两个 `.local` 文件都已在 `.gitignore` 里。

`payload` 里的 `reportedAt` 就是为这条通道准备的：主通道不需要它（Worker 自己盖服务端时间戳），但 Gist 里存的是一份**静态快照**，前端必须靠这个字段自己判时效。

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

它会注册一个登录时启动的任务，后台常驻、无窗口闪烁，前台应用一变就上报、不变时按心跳保活。这里也有一个坑：

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

// 配置在构建期序列化后交给客户端脚本，避免把 100+ 条映射写死在模板里
const configJson = JSON.stringify(deviceStatusConfig);

// 关掉开关、或者主备两条通道都没配时整块不渲染，页面上不会留一块空白区域
const enabled =
	deviceStatusConfig.enable &&
	Boolean(deviceStatusConfig.endpoint || deviceStatusConfig.fallbackEndpoint);
---

{
	enabled && (
		<WidgetLayout
			id="device-status-widget"
			name="我在干嘛"
			class:list={["device-status-widget", className]}
			style={style}
		>
			<span slot="title-icon" class="device-status__badge" data-device-badge>
				<span class="device-status__dot" />
				<span data-device-badge-text>连接中</span>
			</span>

			<div class="device-status__body">
				<span class="device-status__icon" data-device-icon>
					<iconify-icon data-device-glyph icon="fa7-solid:desktop" />
				</span>
				<div class="device-status__meta">
					<div class="device-status__app" data-device-app>
						正在获取…
					</div>
					<div class="device-status__quip" data-device-quip>
						正在读取本机状态
					</div>
				</div>
			</div>

			<div class="device-status__title" data-device-title hidden />

			<div class="device-status__foot">
				<span class="device-status__host" data-device-host hidden>
					<iconify-icon icon="fa7-solid:display" />
					<span data-device-host-text />
				</span>
				<span class="device-status__updated" data-device-updated>
					--
				</span>
				<span class="device-status__source" data-device-source hidden>
					<iconify-icon icon="fa7-solid:cloud-arrow-down" />
					<span data-device-source-text>备用通道</span>
				</span>
				<button
					type="button"
					class="device-status__refresh"
					data-device-refresh
					aria-label="刷新电脑状态"
					title="刷新"
				>
					<iconify-icon icon="fa7-solid:rotate-right" />
				</button>
			</div>
		</WidgetLayout>
	)
}

<script is:inline define:vars={{ configJson }}>
	(function () {
		var CONFIG = {};
		try {
			CONFIG = JSON.parse(configJson);
		} catch (e) {
			CONFIG = {};
		}

		// 主备两条通道都没配时组件在构建期就不会渲染，这里只兜底 swup 替换后的旧 DOM
		if (
			CONFIG.enable === false ||
			(!CONFIG.endpoint && !CONFIG.fallbackEndpoint)
		) {
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

		// 品牌色只按进程名查，查不到返回空串，由 CSS 回落到状态色
		function colorFor(processName) {
			var map = CONFIG.iconColors || {};
			var key = String(processName || "").toLowerCase();
			return (key && map[key]) || "";
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
			var iconEl = container.querySelector("[data-device-icon]");
			var glyph = container.querySelector("[data-device-glyph]");
			var appEl = container.querySelector("[data-device-app]");
			var quipEl = container.querySelector("[data-device-quip]");
			var titleEl = container.querySelector("[data-device-title]");
			var hostEl = container.querySelector("[data-device-host]");
			var hostTextEl = container.querySelector("[data-device-host-text]");
			var updatedEl = container.querySelector("[data-device-updated]");
			var sourceEl = container.querySelector("[data-device-source]");
			var sourceTextEl = container.querySelector("[data-device-source-text]");
			var refreshBtn = container.querySelector("[data-device-refresh]");

			var timer = null;
			var inFlight = false;
			var lastSuccessAt = 0;
			var hostHasText = false;
			var sourceVisible = false;
			// 是否成功渲染过内容。两条通道都失败时要区分两种情况：
			// 之前有内容 → 保留它，只降级角标；从来没拿到过 → 老实说明读不到，
			// 否则卡片会一直挂着「正在获取…」这种占位文案，像是还在加载。
			var hasRendered = false;

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

			// 图标分「形状」和「颜色」两件事：形状说明在用什么应用，
			// 颜色尽量还原品牌色；没配品牌色的回落状态色，状态仍由角标兜底。
			function setIcon(name, brandColor) {
				if (!glyph) return;
				// iconify-icon 只在 icon 属性变化时重渲染，所以必须写属性而不是类名
				glyph.setAttribute("icon", name || "fa7-solid:desktop");
				if (!iconEl) return;
				if (brandColor) iconEl.style.setProperty("--device-brand", brandColor);
				else iconEl.style.removeProperty("--device-brand");
			}

			function setHost(host) {
				if (!hostEl) return;
				var text = String(host || "").trim();
				if (hostTextEl) hostTextEl.textContent = text;
				hostHasText = !!text;
				syncHostVisibility();
			}

			// 底部这一行要装「机器名 + 更新时间 + 来源 + 刷新」四件东西，宽度不够。
			// 来源关系到数据新不新鲜、优先级最高；机器名只在多机上报时才有意义，
			// 所以走备用通道时让机器名先让位。
			function syncHostVisibility() {
				if (!hostEl) return;
				hostEl.hidden = !hostHasText || sourceVisible;
			}

			// 走备用通道时单独标一个 chip：更新时间的宽度本来就不够，
			// 把来源接在它后面会被 ellipsis 吃掉，读者根本看不到。
			//
			// 代价是底部这一行装不下「机器名 + 更新时间 + 来源 + 刷新」四件东西，
			// 所以来源出现时让机器名先让位 —— 来源关系到数据新不新鲜，
			// 机器名只在多机上报时才有意义，优先级更低。
			function setSource(label) {
				if (!sourceEl) return;
				var text = String(label || "").trim();
				if (sourceTextEl) sourceTextEl.textContent = text || "备用通道";
				sourceEl.hidden = !text;
				sourceVisible = !!text;
				syncHostVisibility();
			}

			function setState(state) {
				root.dataset.state = state || "unknown";
			}

			function renderOffline(reason, record, keepContent, sourceLabel) {
				setState("offline");
				setBadge("离线", "off");
				if (keepContent) {
					// 网络抖一下就把卡片清空太粗暴：保留上一次的内容，只把角标降级，
					// 并在时间旁边标一下「读取失败」，读者仍能看到最近一次的状态
					if (updatedEl) {
						var last = updatedEl.dataset.deviceText || "";
						updatedEl.textContent = last ? last + " · 读取失败" : "读取失败";
					}
					return;
				}
				setIcon("fa7-solid:power-off");
				if (appEl) appEl.textContent = "电脑已离线";
				if (quipEl) {
					quipEl.textContent =
						reason || "本机上报已中断，可能关机或断网。";
				}
				if (titleEl) {
					titleEl.textContent = "";
					titleEl.removeAttribute("title");
					titleEl.hidden = true;
				}
				// 离线时机器名反而更有用（哪台机器掉线了），所以保留
				setHost(record && record.host);
				if (updatedEl) {
					// 显示「本机上次上报」的时间，而不是我们上次请求成功的时间，
					// 否则离线时会出现「刚刚更新」这种看起来数据很新的误导文案
					var text =
						record && record.reportedAt
							? formatAge(record.reportedAt)
							: "暂无数据";
					updatedEl.dataset.deviceText = text;
					updatedEl.textContent = text;
				}
				setSource(sourceLabel);
			}

			function renderStatus(payload, sourceLabel) {
				if (!payload || payload.success === false) {
					renderOffline(
						"暂时读不到状态，稍后自动重试。",
						null,
						hasRendered,
						sourceLabel,
					);
					return;
				}
				if (payload.reason === "no_report_yet") {
					renderOffline(
						"本机还没有上报过状态。",
						null,
						hasRendered,
						sourceLabel,
					);
					return;
				}
				if (!payload.online || !payload.record) {
					renderOffline(
						"本机上报已中断，可能关机或断网。",
						payload.record,
						false,
						sourceLabel,
					);
					return;
				}
				hasRendered = true;

				var record = payload.record;
				var state = record.state || "unknown";
				var meta = TONES[state];
				setState(state);
				if (meta) setBadge(meta.text, meta.tone);
				else setBadge("未知", "unknown");

				var appName = record.app || record.process || "未知应用";
				// 锁屏时前台应用已经不在了，显示应用图标会误导，统一换成锁
				if (state === "locked") setIcon("fa7-solid:lock");
				else setIcon(iconFor(record.process, appName), colorFor(record.process));
				if (appEl) appEl.textContent = appName;
				if (quipEl) {
					quipEl.textContent =
						record.quip ||
						defaultQuip(state, record.idleSeconds);
				}
				setHost(record.host);
				if (titleEl) {
					if (record.title) {
						titleEl.textContent = record.title;
						// 标题一定会被截断，挂个原生 tooltip 让鼠标悬停能看全
						titleEl.setAttribute("title", record.title);
						titleEl.hidden = false;
					} else {
						titleEl.textContent = "";
						titleEl.removeAttribute("title");
						titleEl.hidden = true;
					}
				}
				if (updatedEl) {
					var text = formatAge(record.reportedAt);
					updatedEl.dataset.deviceText = text;
					updatedEl.textContent = text;
				}
				setSource(sourceLabel);
			}

			// 主备通道共用的请求包装：超时按失败处理，避免请求悬着让卡片一直转圈
			function fetchJson(url) {
				var controller =
					typeof AbortController !== "undefined"
						? new AbortController()
						: null;
				var timeoutId = controller
					? setTimeout(function () {
							controller.abort();
						}, CONFIG.requestTimeoutMs || 8000)
					: null;

				return fetch(url, {
					cache: "no-store",
					signal: controller ? controller.signal : undefined,
				})
					.then(function (res) {
						if (!res.ok) throw new Error("HTTP " + res.status);
						return res.json();
					})
					.finally(function () {
						if (timeoutId) clearTimeout(timeoutId);
					});
			}

			// 带上时间戳绕开任何中间缓存；Worker 侧本身也是 no-store
			function bustCache(url) {
				return (
					url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now()
				);
			}

			// 备用通道拿到的是一份「裸快照」（没有 Worker 包装的 online / stale 字段），
			// 所以这里按和 Worker 一样的规则在本地补算一遍，让两种来源的载荷形状一致。
			//
			// 这一步不能省：GitHub raw 的 CDN 最长缓存 5 分钟，完全可能把一份早就过期的
			// 快照发过来。只有按 reportedAt 在本地判一次时效，才不会把「早就关机」
			// 显示成「在线」。
			function normalizeSnapshot(record) {
				var heartbeat = Number(record && record.heartbeatSeconds) || 0;

				// 与 Worker 的 staleThresholdFor 同一套规则：
				// 阈值 = max(心跳 × 2, 心跳 + 60s)，再夹到 [120s, 2 天 + 60s]
				var threshold =
					heartbeat > 0
						? Math.max(heartbeat * 2, heartbeat + 60)
						: Number(CONFIG.staleAfterSeconds) || 600;
				threshold = Math.max(120, Math.min(86400 * 2 + 60, threshold));

				var ageSeconds = Math.round(
					(Date.now() - (Number(record.reportedAt) || 0)) / 1000,
				);
				var stale = ageSeconds > threshold;

				return {
					success: true,
					online: !stale,
					stale: stale,
					ageSeconds: ageSeconds,
					staleAfterSeconds: threshold,
					record: record,
				};
			}

			// 备用通道：读 GitHub Gist 上的裸快照，本地补算时效后交给同一个渲染函数。
			// reject 表示这条通道也不可用。
			function fetchFallback() {
				var fallback = String(CONFIG.fallbackEndpoint || "").trim();
				if (!fallback) {
					return Promise.reject(new Error("未配置备用通道"));
				}

				// Gist raw 带 Cache-Control: max-age=300，浏览器自己就会缓存 5 分钟。
				// 挂一个每次都不同的查询串能绕开浏览器这一层（浏览器按完整 URL 做键）。
				//
				// 但别指望它能绕开 GitHub 那边的传播延迟：真正的兜底是返回后按
				// reportedAt 在本地判一次时效，而不是这个参数。
				return fetchJson(bustCache(fallback)).then(function (record) {
					if (!record || !record.reportedAt) {
						throw new Error("备用通道快照为空");
					}
					return normalizeSnapshot(record);
				});
			}

			function fetchStatus(manual) {
				if (inFlight) return;
				inFlight = true;
				if (manual && refreshBtn) refreshBtn.classList.add("is-spinning");

				var endpoint = String(CONFIG.endpoint || "").trim();

				// 主通道优先。它拿不到数据、或者拿到的已经过期，就退到备用通道。
				// 两条都失败才算真失败。
				var primary = endpoint
					? fetchJson(bustCache(endpoint))
					: Promise.reject(new Error("未配置主通道"));

				primary
					.then(function (payload) {
						if (
							payload &&
							payload.success !== false &&
							payload.online &&
							payload.record
						) {
							lastSuccessAt = Date.now();
							renderStatus(payload, "");
							return null;
						}

						// 主通道说「离线」时先别下结论：可能是 Cloudflare 那一段出问题，
						// 而本机其实好好的。这时用备用通道交叉验证一次。
						//
						// 但只有备用通道「新鲜」才算数：它也过期的话，说明本机确实断流了，
						// 而主通道的记录还更新一些，没有理由采信更旧的那份。
						return fetchFallback()
							.then(function (snapshot) {
								lastSuccessAt = Date.now();
								if (snapshot.online) {
									renderStatus(snapshot, "备用通道");
								} else {
									renderStatus(payload, "");
								}
								return null;
							})
							.catch(function () {
								// 备用通道也没有更新鲜的说法，就用主通道的结论
								lastSuccessAt = Date.now();
								renderStatus(payload, "");
								return null;
							});
					})
					.catch(function (err) {
						console.warn("[DeviceStatus] 主通道获取失败：" + err.message);

						return fetchFallback()
							.then(function (snapshot) {
								lastSuccessAt = Date.now();
								renderStatus(snapshot, "备用通道");
								return null;
							})
							.catch(function (fallbackErr) {
								console.warn(
									"[DeviceStatus] 备用通道获取失败：" +
										fallbackErr.message,
								);
								// 两条都拿不到时，有旧内容就保留（只降级角标，避免网络抖动
								// 把卡片闪成空白）；从来没有过内容就老实说明读不到，
								// 否则卡片会一直挂着「正在获取…」这种占位文案。
								renderOffline(
									"暂时读不到状态，稍后自动重试。",
									null,
									hasRendered,
								);
								return null;
							});
					})
					.finally(function () {
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
					Number(CONFIG.refreshIntervalSeconds) || 60,
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
 *
 * 两条色彩线索各管一件事，不互相抢：
 *   1. 状态色收在 --device-tone，由 data-state 一次性下发给角标、图标底衬、
 *      标题竖条，扫一眼颜色就知道在不在线，不用读文字。
 *   2. 品牌色收在 --device-brand（由脚本按进程名内联写入），只作用在图标本身，
 *      让人一眼认出是 Edge 还是微信。没配品牌色的应用自动回落状态色。
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
/* 标题行是 ml-8 且 justify-between，右端没有任何内边距，
 * 角标会紧贴卡片边缘、和下方 px-4 的内容对不齐，这里补上与内容一致的内缩。 */
.device-status__badge {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 6px;
	margin-right: 1rem;
	padding: 3px 10px 3px 8px;
	border-radius: 999px;
	/* 状态色直接当 11px 小字的文字色太浅（亮色下只有 2.9:1），往黑里压一档才够读。
	 * 圆点走 currentColor，会跟着一起压深，视觉上仍然一致。 */
	color: color-mix(in oklch, var(--device-tone) 70%, black);
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

/* 暗色下状态色本身已经足够亮（6.8:1），不需要再压 */
:root.dark .device-status__badge {
	color: var(--device-tone);
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

/* 离线/未知时不再「呼吸」：数据都不更新了，闪动只会让人误以为还活着 */
.device-status-widget[data-state="offline"] .device-status__dot,
.device-status-widget[data-state="unknown"] .device-status__dot {
	animation: none;
	opacity: 0.55;
}

/* —— 应用主体 —— */
.device-status__body {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 0 0.25rem;
}

/* 图标底衬：优先品牌色，没有品牌色就用状态色 */
.device-status__icon {
	position: relative;
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 46px;
	height: 46px;
	border-radius: 15px;
	color: var(--device-brand, var(--device-tone));
	background: linear-gradient(
		150deg,
		color-mix(in oklch, var(--device-brand, var(--device-tone)) 26%, transparent),
		color-mix(in oklch, var(--device-brand, var(--device-tone)) 7%, transparent)
	);
	border: 1px solid
		color-mix(in oklch, var(--device-brand, var(--device-tone)) 24%, transparent);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
	font-size: 20px;
	line-height: 1;
	transition:
		color 200ms ease,
		background-color 200ms ease,
		border-color 200ms ease;
}

/* 状态色外环：品牌色负责「是什么应用」，这圈负责「什么状态」，两者同时可读 */
.device-status__icon::after {
	content: "";
	position: absolute;
	inset: -3px;
	border-radius: 18px;
	border: 1px solid color-mix(in oklch, var(--device-tone) 30%, transparent);
	opacity: 0;
	transition: opacity 200ms ease;
}

.device-status-widget[data-state="online"] .device-status__icon::after {
	opacity: 1;
}

/* 暗色下把品牌色往白里提一提。
 * Steam、Epic、Notion 这些品牌色本身就接近纯黑（#1b2838 / #2a2a2a / #2f2f2f），
 * 直接画在深色卡片上等于隐形。混 38% 白既保住色相又能看清。 */
:root.dark .device-status__icon {
	color: color-mix(
		in oklch,
		var(--device-brand, var(--device-tone)) 62%,
		white 38%
	);
	background: linear-gradient(
		150deg,
		color-mix(
			in oklch,
			var(--device-brand, var(--device-tone)) 30%,
			white 6%
		),
		color-mix(
			in oklch,
			var(--device-brand, var(--device-tone)) 10%,
			transparent
		)
	);
	border-color: color-mix(
		in oklch,
		var(--device-brand, var(--device-tone)) 34%,
		transparent
	);
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
	font-size: 15.5px;
	font-weight: 650;
	line-height: 21px;
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

/* —— 底部：机器名 + 更新时间 + 刷新 —— */
.device-status__foot {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 0.75rem;
	padding-top: 0.5rem;
	border-top: 1px solid var(--line-divider);
}

/* 机器名：一台机器时意义不大，但哪天多机上报就能一眼分清 */
.device-status__host {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 4px;
	max-width: 45%;
	padding: 1px 6px;
	overflow: hidden;
	border-radius: 5px;
	background: var(--btn-regular-bg);
	color: var(--content-meta);
	font-size: 10.5px;
	line-height: 15px;
	letter-spacing: 0.2px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.device-status__host[hidden] {
	display: none;
}

.device-status__host iconify-icon {
	display: inline-flex;
	flex: none;
	width: 1em;
	height: 1em;
	opacity: 0.75;
}

.device-status__host > span {
	overflow: hidden;
	text-overflow: ellipsis;
}

.device-status__updated {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	color: var(--content-meta);
	font-size: 11px;
	letter-spacing: 0.3px;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.8;
}

/* 备用通道标记：只在主通道失效时出现。
   单独做成 chip 而不是接在更新时间后面 —— 那一行本来就窄，
   接上去会被 ellipsis 吃掉，读者看不到「这份数据是从备用通道来的」。 */
.device-status__source {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 4px;
	padding: 1px 6px;
	border-radius: 5px;
	background: color-mix(in oklch, var(--device-warn) 16%, transparent);
	color: color-mix(in oklch, var(--device-warn) 72%, black);
	font-size: 10.5px;
	line-height: 15px;
	letter-spacing: 0.2px;
	white-space: nowrap;
}

.device-status__source[hidden] {
	display: none;
}

.device-status__source iconify-icon {
	display: inline-flex;
	flex: none;
	width: 1em;
	height: 1em;
	opacity: 0.85;
}

:root.dark .device-status__source {
	color: var(--device-warn);
}

.device-status__refresh {
	display: inline-flex;
	flex: none;
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

/* —— 离线时整体降噪，不与在线态抢注意力 —— */
.device-status-widget[data-state="offline"] .device-status__app {
	color: var(--content-meta);
}

.device-status-widget[data-state="offline"] .device-status__icon {
	color: var(--device-tone);
	background: linear-gradient(
		150deg,
		color-mix(in oklch, var(--device-tone) 14%, transparent),
		transparent
	);
}

.device-status-widget[data-state="offline"] .device-status__title {
	opacity: 0.5;
}

@media (max-width: 480px) {
	.device-status__icon {
		width: 42px;
		height: 42px;
		border-radius: 14px;
		font-size: 18px;
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
// 数据链路：本机 PowerShell 变化驱动上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。
//
// 想加新应用：只需要在本机上报脚本的映射表里加，这里不用动。
// 这里负责「进程名 → 图标名」与「进程名 → 品牌色」，与上报脚本的 104 条进程名零缺口。
export const deviceStatusConfig: DeviceStatusConfig = {
	enable: true,

	// 只读接口。留空等于未启用：卡片会整块隐藏，页面上不会留一块空白。
	// 注意：不要用 *.workers.dev 那个地址，部分网络下该域名不可达，已改为自有域名。
	endpoint: "https://muyuhome.cc.cd/api/device/status",

	// 前端轮询间隔（秒）。
	// 本机侧是「变化驱动 + 心跳」：前台应用一换就立刻上报，没换时在线 5 分钟才发
	// 一次心跳（离开/锁屏 10 分钟）。所以这里没必要跟着 30 秒跑，60 秒足够。
	refreshIntervalSeconds: 60,
	requestTimeoutMs: 8000,
	// 离线判定的权威值在 Worker 侧：它按上报的 heartbeatSeconds 动态推算
	// （阈值 = max(心跳 × 2, 心跳 + 60s)，夹在 [120s, 2 天]），并以 staleAfterSeconds
	// 字段随响应回传。这里仅作兜底说明，不参与判断。
	staleAfterSeconds: 300,
	// 后台标签页的定时器会被浏览器降频，切回前台时距上次成功超过这个值就立刻补一次
	visibilityRefreshAfterSeconds: 20,

	// 备用通道：主通道取不到新鲜数据时的兜底来源。
	// 本机上报脚本会把同一份记录再写一份到 GitHub Gist，这里指向它的 raw 地址。
	//
	// 为什么需要它：主通道整条链路都压在 Cloudflare 上（域名被污染、Worker 故障、
	// KV 额度耗尽都会失效），而 GitHub raw 是完全独立的另一套链路，同时挂掉概率很低。
	//
	// 代价：GitHub raw 的 CDN 缓存是 300 秒，直接读可能拿到旧副本。实测给 URL 挂一个
	// 随机查询串就能让 CDN 回 MISS（缓存键含 query string），所以请求时会加 cache-bust
	// 参数。即便如此，仍要按快照里的 reportedAt 在本地判一次时效 —— 万一 CDN 还是发了
	// 旧副本，也不会把「早就离线」显示成「在线」。
	fallbackEndpoint:
		"https://gist.githubusercontent.com/MuyuDada/ddca5e9cfef3026b2503b56486cbb365/raw/device.json",

	// 进程名（小写）→ Iconify 图标名。
	// 进程名优先命中，其次按应用名关键词兜底，最后给通用显示器图标。
	iconMap: {
		// —— 编辑器 / IDE ——
		code: "fa7-solid:code",
		"code - insiders": "fa7-solid:code",
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
		wsl: "fa7-solid:terminal",
		// —— 浏览器 ——
		msedge: "fa7-brands:edge",
		msedgewebview2: "fa7-brands:edge",
		chrome: "fa7-brands:chrome",
		firefox: "fa7-brands:firefox-browser",
		brave: "fa7-brands:brave",
		opera: "fa7-brands:opera",
		safari: "fa7-brands:safari",
		iexplore: "fa7-brands:internet-explorer",
		"360se": "fa7-solid:globe",
		"360chrome": "fa7-solid:globe",
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
		"league of legends": "fa7-solid:gamepad",
		"deltaforceclient-win64-shipping": "fa7-solid:crosshairs",
		delta_force_launcher: "fa7-solid:crosshairs",
		nzmclient: "fa7-solid:gun",
		nzm_launcher: "fa7-solid:gun",
		wegame: "fa7-solid:gamepad",
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
		regedit: "fa7-solid:pen-ruler",
		mmc: "fa7-solid:screwdriver-wrench",
		windbg: "fa7-solid:bug",
	},

	// 进程名（小写）→ 品牌色。
	// Iconify 的图标本身是单色的，不配颜色的话 Edge 也会被染成状态色。
	// 只列常用应用，没命中的回落到状态色（在线绿/离开橙/锁屏灰/离线红）。
	iconColors: {
		// —— 浏览器 ——
		msedge: "#0f7ac0",
		msedgewebview2: "#0f7ac0",
		chrome: "#d93025",
		firefox: "#e66000",
		brave: "#e04a2f",
		opera: "#c0392b",
		safari: "#1a9de0",
		// —— 通讯 ——
		wechat: "#07c160",
		weixin: "#07c160",
		qq: "#12b7f5",
		tim: "#12b7f5",
		telegram: "#229ed9",
		discord: "#5865f2",
		skype: "#00aff0",
		whatsapp: "#25d366",
		line: "#06c755",
		// —— 音乐 / 影音 ——
		cloudmusic: "#c20c0c",
		qqmusic: "#31c27c",
		spotify: "#1db954",
		bilibili: "#00a1d6",
		youtube: "#ff0000",
		twitch: "#9146ff",
		vlc: "#ff8800",
		// —— 游戏 ——
		steam: "#1b2838",
		steamwebhelper: "#1b2838",
		epicgameslauncher: "#2a2a2a",
		unity: "#4a4a4a",
		blender: "#ea7600",
		xbox: "#107c10",
		// —— 办公 / 设计 ——
		winword: "#2b579a",
		excel: "#217346",
		powerpnt: "#d24726",
		wps: "#e8443a",
		acrobat: "#dc2b21",
		acrord32: "#dc2b21",
		notion: "#2f2f2f",
		figma: "#a259ff",
		photoshop: "#31a8ff",
		illustrator: "#ff9a00",
		afterfx: "#9999ff",
		premiere: "#9999ff",
		// —— 开发工具 ——
		"github desktop": "#6e5494",
		docker: "#2496ed",
		postman: "#ff6c37",
		// —— 服务器 / 网络 ——
		openlist: "#3b82f6",
		alist: "#3b82f6",
		clash: "#5b6ee1",
		"clash-verge": "#5b6ee1",
		v2rayn: "#5b6ee1",
		// —— 下载 ——
		qbittorrent: "#2f67b2",
		thunder: "#2e8ae6",
		idman: "#1c7ed6",
		motrix: "#5b8def",
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
// 数据链路：本机 PowerShell 变化驱动上报 → Cloudflare Worker + KV → 访客浏览器只读。
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
	/** 只读接口地址（主通道），留空时只看备用通道 */
	endpoint: string;
	/**
	 * 备用通道：主通道取不到新鲜数据时的兜底来源，通常指向 GitHub Gist 的 raw 地址。
	 * 它是一份「裸快照」，没有 Worker 包装的 online / stale 字段，
	 * 所以前端会按和 Worker 一样的规则在本地补算时效。
	 * 留空 = 不用备用通道；与 endpoint 同时留空则整张卡片隐藏。
	 */
	fallbackEndpoint: string;
	/**
	 * 前端轮询间隔（秒）。
	 * 本机侧是「变化驱动 + 心跳」：前台应用一换就立刻上报，没换时在线 5 分钟
	 * 才发一次心跳，所以这里不用跟得很紧。
	 */
	refreshIntervalSeconds: number;
	/** 单次请求超时（毫秒） */
	requestTimeoutMs: number;
	/**
	 * 离线判定的兜底秒数。
	 * 主通道的权威值在 Worker 侧，它会按上报的 heartbeatSeconds 动态推算，
	 * 并以 staleAfterSeconds 字段随响应回传；备用通道没有服务端判活，
	 * 只能用这里的值配合快照里的 heartbeatSeconds 在本地算一遍。
	 */
	staleAfterSeconds: number;
	/** 从后台切回前台时，距上次成功超过这个秒数就立刻补一次 */
	visibilityRefreshAfterSeconds: number;
	/** 进程名（小写）→ Iconify 图标名 */
	iconMap: Record<string, string>;
	/**
	 * 进程名（小写）→ 品牌色。
	 * Iconify 的图标是单色的，想还原 Edge 蓝、微信绿这类品牌辨识度就得自带颜色。
	 * 没配的进程回落到状态色，所以这张表只需覆盖常用应用。
	 */
	iconColors: Record<string, string>;
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
	umamiStats: UmamiStats,
	deviceStatus: DeviceStatus,
};
```

## 七、注册类型

在 `src/types/sidebarConfig.ts` 的类型联合中添加组件名：

```typescript title="src/types/sidebarConfig.ts" ins={4}
export type WidgetComponentType =
	// ...
	| "umamiStats"
	| "deviceStatus";
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

### 备用通道配置

在 `src/config/deviceStatusConfig.ts` 里指向 Gist 的 raw 地址即可启用：

```typescript title="src/config/deviceStatusConfig.ts"
// 备用通道：主通道取不到新鲜数据时的兜底来源。
// 本机上报脚本会把同一份记录再写一份到 GitHub Gist，这里指向它的 raw 地址。
//
// 为什么需要它：主通道整条链路都压在 Cloudflare 上（域名被污染、Worker 故障、
// KV 额度耗尽都会失效），而 GitHub raw 是完全独立的另一套链路，同时挂掉概率很低。
//
// 代价：GitHub raw 的 CDN 缓存是 300 秒，直接读可能拿到旧副本。实测给 URL 挂一个
// 随机查询串就能让 CDN 回 MISS（缓存键含 query string），所以请求时会加 cache-bust
// 参数。即便如此，仍要按快照里的 reportedAt 在本地判一次时效 —— 万一 CDN 还是发了
// 旧副本，也不会把「早就离线」显示成「在线」。
fallbackEndpoint:
	"https://gist.githubusercontent.com/MuyuDada/ddca5e9cfef3026b2503b56486cbb365/raw/device.json",
```

留空则关闭备用通道，行为和以前完全一致（只走主通道）。注意这里要用 **raw 地址**，不是 `gist.github.com` 的网页地址——后者返回的是 HTML，`res.json()` 会直接抛错。

> **移动端看不到这张卡片** —— 它放在左侧栏，而 `<768px` 时左右侧栏都会被隐藏（用户资料、公告、音乐都一样）。如果希望手机上也能看到，把它加进 `mobileBottomComponents`：
>
> ```typescript title="src/config/sidebarConfig.ts" ins={4}
> mobileBottomComponents: [
> 	// ...
> 	{
> 		type: "deviceStatus",
> 		enable: true,
> 		showOnPostPage: false,
> 	},
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

### 两条色彩线索：状态色 + 品牌色

只有状态色的话，图标永远是同一个颜色，认不出是 Edge 还是微信。所以又加了第二条线索 `--device-brand`：**由脚本按进程名内联写入，只作用在图标本身**。

两条线索分工明确，互不抢戏：

| 变量 | 来源 | 作用范围 | 回答的问题 |
| --- | --- | --- | --- |
| `--device-tone` | `data-state` | 角标 + 图标底衬 + 标题竖条 | 人在不在 |
| `--device-brand` | 脚本内联 | 只作用在图标本身 | 是什么应用 |

关键是**没配品牌色的应用要能自动回落**——`var(--device-brand, var(--device-tone))` 这个回退值就是干这个的，映射表里没有的应用自然显示状态色：

```css
.device-status__icon {
    color: var(--device-brand, var(--device-tone));
    background: linear-gradient(
        150deg,
        color-mix(in oklch, var(--device-brand, var(--device-tone)) 24%, transparent),
        color-mix(in oklch, var(--device-brand, var(--device-tone)) 7%, transparent)
    );
}
```

再加一圈**只有在线时才显示**的状态外环，这样品牌色和状态色同时可读：

```css
.device-status__icon::after {
    inset: -3px;
    border: 1px solid color-mix(in oklch, var(--device-tone) 30%, transparent);
    opacity: 0;
}
.device-status-widget[data-state="online"] .device-status__icon::after {
    opacity: 1;
}
```

脚本侧只是多写一个内联变量，查不到就 `removeProperty` 交还给 CSS 回落：

```js
function setIcon(name, brandColor) {
    if (!glyph) return;
    // iconify-icon 只在 icon 属性变化时重渲染，所以必须写属性而不是类名
    glyph.setAttribute("icon", name || "fa7-solid:desktop");
    if (!iconEl) return;
    if (brandColor) iconEl.style.setProperty("--device-brand", brandColor);
    else iconEl.style.removeProperty("--device-brand");
}
```

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

**进程名一定要转小写再查表**——上报脚本发的是 Windows 原始进程名（`NZMClient`），映射表里写的是小写（`nzmclient`），不转小写会永远匹配不上、静默退化成通用图标。这个 bug 真实存在过。

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

### 锁屏时不要显示应用图标

锁屏状态下前台应用已经不存在了，`process` 字段还是锁屏前最后一个应用。如果照常显示应用图标，会让人以为「微信正在用」，其实是「锁屏前最后用的是微信」。所以锁屏时直接换成一把锁：

```js
if (state === "locked") setIcon("fa7-solid:lock");
else setIcon(iconFor(record.process, appName), colorFor(record.process));
```

### 失败不闪空白

网络抖动是常事。请求失败时如果直接把卡片清空，用户会看到内容闪来闪去。所以失败路径只改角标和文案，保留上一次的正文内容：

```js
.catch(function (fallbackErr) {
    console.warn("[DeviceStatus] 备用通道获取失败：" + fallbackErr.message);
    // 两条都拿不到时，有旧内容就保留（只降级角标，避免网络抖动
    // 把卡片闪成空白）；从来没有过内容就老实说明读不到，
    // 否则卡片会一直挂着「正在获取…」这种占位文案。
    renderOffline("暂时读不到状态，稍后自动重试。", null, hasRendered);
    return null;
})
```

具体做法是给 `renderOffline` 加一个 `keepContent` 参数：为真时**不动正文**，只把角标降级成离线，并在时间后面缀上「· 读取失败」：

```js
function renderOffline(reason, record, keepContent) {
    // ...
    if (keepContent) {
        // 保留上一次的正文内容，只把角标和更新时间降级
        if (updatedEl) {
            var last = updatedEl.dataset.deviceText || "";
            updatedEl.textContent = last ? last + " · 读取失败" : "读取失败";
        }
        return;
    }
    // 真正的离线：清空正文，显示「电脑已离线」
    // ...
}
```

注意判断依据是 `hasRendered` 而不是「有没有旧数据」——如果这个页面从打开到现在一次都没成功过，那就该老实显示「读不到」，否则卡片会一直挂着「正在获取…」的占位文案，看起来像卡死了。

### 主备两条通道怎么选

有了备用通道，读取路径就不再是简单的「成功/失败」二选一，而是分三种情况：

```js
// 主通道优先。它拿不到数据、或者拿到的已经过期，就退到备用通道。
// 两条都失败才算真失败。
primary
    .then(function (payload) {
        if (payload && payload.success !== false && payload.online && payload.record) {
            lastSuccessAt = Date.now();
            renderStatus(payload, "");
            return null;
        }

        // 主通道说「离线」时先别下结论：可能是 Cloudflare 那一段出问题，
        // 而本机其实好好的。这时用备用通道交叉验证一次。
        //
        // 但只有备用通道「新鲜」才算数：它也过期的话，说明本机确实断流了，
        // 而主通道的记录还更新一些，没有理由采信更旧的那份。
        return fetchFallback()
            .then(function (snapshot) {
                lastSuccessAt = Date.now();
                if (snapshot.online) renderStatus(snapshot, "备用通道");
                else renderStatus(payload, "");
                return null;
            })
            .catch(function () {
                lastSuccessAt = Date.now();
                renderStatus(payload, "");
                return null;
            });
    })
    .catch(function (err) { /* 主通道整个挂了 → 直接走备用通道 */ });
```

两个判断点是有讲究的：

- **主通道说「离线」不等于本机离线。** 它返回的 `online: false` 可能是 Worker 读不到 KV，也可能是 Cloudflare 那段出问题，而本机其实一直在正常上报。所以这里必须交叉验证，不能直接采信。
- **但只有「更新鲜」的备用快照才值得采信。** 如果 Gist 里那份也过期了，说明本机是真的断流了——这时候主通道的记录反而更近，采信更旧的那份没有意义。

Gist 拿到的是一份**裸快照**，没有 Worker 包装的 `online` / `stale` / `staleAfterSeconds`，所以前端要按和 Worker 一样的规则在本地补算一遍，让两种来源的载荷形状一致：

```js
function normalizeSnapshot(record) {
    // 按和 Worker 一样的规则补算时效，让两种来源的载荷形状一致
    // ...
    return { success: true, online: !stale, stale: stale, ageSeconds: ageSeconds, staleAfterSeconds: threshold, record: record };
}
```

还有个 Gist 特有的坑：**它的 raw 响应带 `Cache-Control: max-age=300`**，浏览器会自己缓存 5 分钟。挂一个每次都不同的查询串能绕开浏览器这一层（浏览器按完整 URL 做键）：

```js
function bustCache(url) {
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
}
```

但别指望它能绕开 GitHub 那边的传播延迟——实测写完之后要几十秒到一百多秒才对外可见。真正的兜底是拿到快照后**按 `reportedAt` 在本地判一次时效**，而不是这个查询参数。

### 底部这一行装不下四件东西

走备用通道时要标一个来源 chip，否则读者不知道这份数据是从哪来的。但底部这一行本来就要装「机器名 + 更新时间 + 刷新键」，再加一个 chip 就会被 `ellipsis` 吃掉：

```js
// 底部这一行要装「机器名 + 更新时间 + 来源 + 刷新」四件东西，宽度不够。
// 来源关系到数据新不新鲜、优先级最高；机器名只在多机上报时才有意义，
// 所以走备用通道时让机器名先让位。
function syncHostVisibility() {
    if (!hostEl) return;
    hostEl.hidden = !hostHasText || sourceVisible;
}
```

所以做了取舍：**来源 chip 出现时，机器名先隐藏**。优先级判断的依据是「谁影响读者对数据新鲜度的判断」——来源影响，机器名不影响（只有多台机器上报时它才有意义）。

实测底部行宽 248px：主通道下机器名（77px）+ 更新时间（129px）+ 刷新键（26px）刚好放下；走备用通道时机器名让位给 chip，也不会溢出。

### 开关要真的能关掉

只判断 `endpoint` 是否为空是不够的——`enable: false` 也得生效，否则用户关掉开关后卡片还在。另外现在有了备用通道，只要两条通道里**任意一条**配了就该渲染。这个判断放在**构建期**，整块不渲染，页面上不会留空白：

```astro
---
// 关掉开关、或者主备两条通道都没配时整块不渲染，页面上不会留一块空白区域
const enabled =
    deviceStatusConfig.enable &&
    Boolean(deviceStatusConfig.endpoint || deviceStatusConfig.fallbackEndpoint);
---

{enabled && (<WidgetLayout id="device-status-widget" name="我在干嘛">...</WidgetLayout>)}
```

客户端脚本里再兜一层，防止 swup 替换 DOM 后残留旧节点。

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

品牌色还有个单独的问题：**有些品牌色本身就接近纯黑**——Steam `#1b2838`、Epic `#2a2a2a`、Notion `#2f2f2f`，直接画在深色卡片上等于隐形。所以暗色下把品牌色往白里提一提：

```css
:root.dark .device-status__icon {
    color: color-mix(in oklch, var(--device-brand, var(--device-tone)) 62%, white 38%);
}
```

反过来，亮色下**状态色当文字色又太浅**。角标只有 11px，实测「在线绿」直接当文字色只有 **2.9:1**，达不到 WCAG AA 的 4.5:1。所以亮色下把状态色往黑里压一档，暗色下状态色本身已经够亮（6.8:1）就不压：

```css
.device-status__badge {
    /* 状态色直接当小字色太浅，往黑里压一档才够读 */
    color: color-mix(in oklch, var(--device-tone) 70%, black);
}

:root.dark .device-status__badge {
    color: var(--device-tone);
}
```

压完亮色是 **7.2:1**、暗色 **5.5:1**，都过 AA。圆点用的是 `currentColor`，会跟着一起变深，视觉上仍然一致。

### 数据不更新时别让呼吸灯继续闪

角标上的小圆点有个呼吸动画，表示「数据是活的」。但离线之后数据根本不更新了，圆点还在闪会让人误以为还连着：

```css
.device-status-widget[data-state="offline"] .device-status__dot {
    animation: none;
    opacity: 0.55;
}
```

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

GitHub 文档：[Gists API](https://docs.github.com/en/rest/gists)

## 🔗 最后

这套东西真正麻烦的不是前端——前端只是画一张卡片。麻烦的是**数据从哪来**：静态站点读不到本机状态，就只能反过来让本机推上去。

几个值得注意的点：`*.workers.dev` 域名在国内网络下不可靠，一定要挂自己的域名；`wrangler.toml` 里的 `routes` 必须写在 `[[kv_namespaces]]` 之前，否则会被静默忽略；计划任务的触发器要显式带 `-User`，否则普通账户注册不了；离线阈值交给 Worker 按心跳推算，改心跳不用再动第二处；离线时显示的时间必须是本机上次上报的时间，不然会出现「明明关机了却显示刚刚更新」的迷惑现象。

最容易踩的是**额度**：KV 免费额度每天只有 1000 次**写**，固定 30 秒上报一天就是 2880 次，是额度的近 3 倍，而且写超额直接报错、不会降级。所以上报一定要做成「变化驱动 + 心跳」——本地轮询不花钱，网络请求才花钱。

**单点依赖是另一件要主动去想的事**。主通道从域名到存储全压在 Cloudflare 一家身上，任意一环出问题卡片就瞎了。加一条 Gist 备用通道的成本很低（上报时顺带 PATCH 一次），收益是链路真正变成了两条。但备用通道也有自己的脾气：raw 地址有 300 秒 CDN 缓存、写入后要几十秒到一百多秒才可见，所以**别指望它实时**——它的定位是「主通道挂了时不至于整块空白」，而不是「比主通道更快」。也正因为它是静态快照，`reportedAt` 这个字段必须上报，前端才能自己判时效。

安全上要有心理准备：**读接口是公开的**——任何知道地址的人都能看到你当前开着什么程序。写接口靠 `REPORT_TOKEN` 保护，但读接口没法加密（前端要读，token 写进 JS 等于没保护）。备用通道还多暴露一份到 Gist，不过 secret gist 同样不是私密的——**只要知道 URL 谁都能读**，别把它当成权限控制。能接受这一点再上，介意的话就别放窗口标题。
