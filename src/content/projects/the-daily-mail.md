---
title: "每日情书邮件"
slug: the-daily-mail
published: 2026-10-10
draft: false
order: 130
description: "每天早八点自动发一封邮件：一张卡片长图，写着在一起的第几天、两地天气、生活指数和一句土味情话。配色每天换一种，用无头 Chrome 截图，零第三方依赖。"
image: "images/the-daily-mail.png"
status: "published"
tags:
  - Node.js
  - GitHub Actions
  - 自动化
  - 逆向
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/MuyuDada/The-daily-mail"
---

## 这是什么

一个跑在 GitHub Actions 上的定时脚本。每天早上 08:02（北京时间），它会生成一张卡片长图，通过 SMTP 发到指定邮箱。

卡片上有四块内容：

| 区域 | 内容 |
| --- | --- |
| 标题 | 在一起的第 N 天、当前日期与星期 |
| 左栏「我」 | 今天的天气、气温、风力，以及运动 / 穿衣 / 感冒等生活指数 |
| 右栏「TA」 | 对方城市的天气，只显示天气不带指数 |
| 底部 | 一句土味情话 + 落款 |

卡片配色**每天自动换一种**，共 12 套马卡龙色（蜜桃粉、薄荷绿、薰衣草紫、奶油黄、天空蓝、蜜桃橘、雾霾蓝、奶茶色、抹茶绿、莓果粉、海洋青、丁香紫）。

数据来源：[和风天气](https://dev.qweather.com/) + [天行数据](https://www.tianapi.com/)。

## 文件结构

```text
├── index.js          # 主流程：取数据 → 生成卡片 → 发送
├── config.js         # 环境变量读取 + 收件人解析
├── content.js        # 接口数据 → 结构化内容（邮件与图片共用）
├── themes.js         # 12 套马卡龙配色 + 每日轮换算法
├── cardHtml.js       # 卡片模板
├── render.js         # 无头 Chrome 整页截图
├── emailHtml.js      # 纯文字兜底模板
├── sendEmail.js      # SMTP 发送
└── .github/workflows/daily-mail.yml
```

## 配置

所有密钥通过**环境变量**读取，不写进代码。本地开发时在项目根目录建 `.env`（已被 `.gitignore` 忽略）：

```ini
MAIL_USER=you@example.com            # 发送者邮箱
MAIL_PASS=你的SMTP授权码             # QQ邮箱 → 设置 → 账户 → 开启SMTP后生成的授权码
MAIL_TO=you@example.com|北京|101010100;ta@example.com|上海|101020100
WEATHER_KEY=你的和风天气key
WEATHER_LOCATION=101010100           # 默认「我」的城市 LocationID，只能填数字ID
MAIL_CITY=北京                        # 可选：默认「我」的城市显示名，留空自动反查
TIANXING_KEY=你的天行数据key
START_DAY=2020-01-01                 # 在一起的日期
WEATHER_LOCATION_TA=101020100        # 可选：默认「TA」城市 LocationID，填 off 整块不显示
MAIL_CITY_TA=上海                     # 可选：默认「TA」城市名
```

缺失必填项时 `config.js` 会直接抛出明确报错，而不是等接口返回 400：

```js
const missing = ['MAIL_USER', 'MAIL_PASS', 'MAIL_TO', 'WEATHER_KEY', 'TIANXING_KEY'].filter(
  (k) => !env[k]
);
```

### 发给多个人

`MAIL_TO` 用**逗号或分号**分隔多个收件人，每个人会**分别单独收到一封**邮件（互相看不到对方地址），某个人失败也不影响其他人。

每人的格式是 `邮箱|我的城市名|我的LocationID|TA的城市名|TA的LocationID`，后面的段都可以省略：

| 写法 | 含义 |
| --- | --- |
| `a@example.com\|北京\|101010100;b@example.com\|上海\|101020100` | 两人自动互为 TA（推荐） |
| `a@example.com\|北京\|101010100\|广州\|101280101` | 显式指定这个人的 TA 是广州 |
| `a@example.com,b@example.com` | 只写邮箱，都用默认城市 |
| `a@example.com\|101010100` | 只给 ID，城市名自动反查 |

只有两个人又都没显式写 TA 时，代码会自动把对方填进来，于是两个人看到的卡片是**镜像**的：

```js
// 只有两个人、又都没显式写 TA 的时候，自动把对方当成 TA
if (people.length === 2 && !taOff) {
  for (const p of people) {
    if (p.hasTa) continue;
    const other = people.find((q) => q !== p);
    p.taLocation = other.myLocation || defaultTaLoction;
    p.taCity = other.myCity || '';
  }
}
```

解析器还会剥掉被一起粘进来的变量名前缀（`MAIL_TO=a@example.com` → `a@example.com`），把换行也当分隔符，并在地址不像邮箱时提前报错，免得跑到 SMTP 那一步才看到 550。

> **怎么查 LocationID**：访问 `https://geoapi.qweather.com/v2/city/lookup?key=你的key&location=城市名`，返回里的 `id` 字段就是。填中文城市名会直接报 HTTP 400。

## 卡片图是怎么生成的

用本机 Chrome 的**无头模式 + DevTools 协议**整页截图，纯 Node 实现，不依赖 puppeteer（省掉几百 MB 依赖）。

流程是：`--headless=new` 启动 Chrome 并开一个调试端口 → 先按 720 宽度量出 `document.body.scrollHeight` → 用这个高度重设视口 → `Page.captureScreenshot` 配合 `captureBeyondViewport: true` 截整页。

```js
const { result } = await cdp('Runtime.evaluate', {
  expression:
    'Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))',
  returnByValue: true,
});
const fullHeight = Math.max(1, Number(result.value) || 600);

await cdp('Emulation.setDeviceMetricsOverride', {
  width, height: fullHeight, deviceScaleFactor: scale, mobile: false,
});

const shot = await cdp('Page.captureScreenshot', {
  format, quality: format === 'jpeg' ? quality : undefined,
  captureBeyondViewport: true,
  // clip.scale 固定为 1：清晰度已经由 deviceScaleFactor 控制，
  // 两者相乘会变成 4 倍图（体积翻好几倍），没必要。
  clip: { x: 0, y: 0, width, height: fullHeight, scale: 1 },
});
```

### 为什么要手写 WebSocket

Node 20（GitHub Actions 用的版本）**没有全局 `WebSocket`**，直接 `new WebSocket(...)` 会抛 `WebSocket is not defined`，卡片图就生成不了。为了保持零依赖，`render.js` 里用 `net` + 手写帧协议实现了一个 RFC 6455 子集：

```js
class MiniWebSocket {
  constructor(url) {
    // ...
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(Number(u.port || 80), u.hostname, () => {
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
  }
}
```

握手校验 `Sec-WebSocket-Accept`、客户端帧加掩码、ping 回 pong、分片重组，都在这一个类里。

### 配色每天不重样

`themes.js` 预生成一张 0~4000 天的下标表：先用 hash 打散，如果和前一天撞色就线性后移一位。结果是**看起来随机换色，但同一天结果恒定，且相邻两天一定不撞色**。

```js
const SEQ = (() => {
  const n = THEMES.length;
  const hash = (v) => {
    let x = Math.imul(v ^ 0x5bf03635, 0x9e3779b1);
    x ^= x >>> 15;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    return (x >>> 0) % n;
  };
  const out = new Array(MAX_DAY + 1);
  out[0] = hash(0);
  for (let day = 1; day <= MAX_DAY; day++) {
    let next = hash(day);
    if (next === out[day - 1]) next = (next + 1) % n;
    out[day] = next;
  }
  return out;
})();
```

想固定一种配色，把 `MAIL_THEME` 设成主题名即可（支持模糊匹配，写「薄荷」也能命中「薄荷绿」）。

### 异地恋语气

生活指数的文案是按 type 逐个写的，刻意避开「一起做」「陪着你」这类需要见面的说法，改成隔着距离也在惦记你的语气：

```js
const SWEET_PREFIX = {
  1: '动一动吧，我在远方给你数着步数，',
  3: '多穿一点，你的冷暖我最放在心上，',
  9: '千万别感冒，你难受我却抱不到你，',
  11: '空调别开太凉，我不在没人给你盖被子，',
  // ...按和风指数 type 匹配，没有对应项就不加
};
```

天气图标则把和风的 `iconDay` 数字码映射成 emoji —— 用 emoji 而不是外链图片，是因为它不依赖渲染时的网络。

## 部署到 GitHub Actions

1. 把代码推送到仓库。
2. **Settings → Secrets and variables → Actions**，逐个添加 `MAIL_USER`、`MAIL_PASS`、`MAIL_TO`、`WEATHER_KEY`、`TIANXING_KEY`，可选再加 `WEATHER_LOCATION`、`MAIL_CITY`、`START_DAY`、`WEATHER_LOCATION_TA`、`MAIL_CITY_TA`、`MAIL_THEME` 等。
3. 到 **Actions** 页面选 `daily-mail` → **Run workflow** 手动跑一次验证。
4. 之后每天北京时间 08:02 自动执行（cron 用 UTC，`02 00 * * *` = 北京 08:02）。

```yaml
on:
  schedule:
    # 注意：cron 使用 UTC 时间，北京时间 = UTC + 8
    # "02 00 * * *" = 北京时间每天 08:02
    - cron: "02 00 * * *"
  workflow_dispatch:
```

CI 上跑卡片图需要中文字体，workflow 里已经装了 `fonts-noto-cjk` 和 `fonts-noto-color-emoji` —— 不装的话中文会变方框、emoji 会变黑白。

## 出错时

三层兜底：

1. **卡片图生成失败**（比如没有 Chrome 的机器）→ 自动退回纯文字邮件，保证每天都有邮件，原因打印在日志里。
2. **TA 的天气拿不到** → 只不显示那一块，不影响整封邮件。
3. **发送失败** → 打印完整错误栈，并尝试给自己发一封「定时邮件-报错提醒」，同时以非 0 退出码结束，**Actions 会显示红色失败**。

```js
// 让 GitHub Actions 显示为失败，而不是绿色成功
process.exitCode = 1;
```

> 注意：job 显示绿色**不等于**功能正常。如果怀疑卡片图没生成，去那次运行的 `Run Project` 步骤里搜「卡片图生成失败」。

## 本地运行

```bash
npm install
npm run server
```

MIT License。
