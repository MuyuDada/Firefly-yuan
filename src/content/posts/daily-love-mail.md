---
title: '用 GitHub Actions 每天给 TA 发一封情书邮件'
published: 2026-10-10
description: '一个跑在 GitHub Actions 上的定时脚本：每天早八点生成一张马卡龙配色卡片长图，写着在一起的第几天、两地天气、生活指数和一句土味情话，再通过 SMTP 发出去。用无头 Chrome 截图，零第三方渲染依赖。'
image: api
tags: [Node.js, GitHub Actions, 自动化, 邮件]
category: 自建服务
draft: false
slug: daily-love-mail
pinned: true
---

异地恋最难的不是想念，是**没有共同的日常**。你不知道对方那边今天下没下雨、该不该提醒她多穿一件。这些东西微信里问一遍也能问，但问多了就变成打卡。

所以我想让它自动发生：每天早上八点，TA 的收件箱里躺着一封邮件，点开是一张图，上面写着在一起的第几天、两个城市的天气、还有一句没营养的土味情话。不用回复，不用互动，看到就行。

这篇记录这个东西是怎么做出来的 —— 以及中间踩的几个坑。

## 一、先看效果

每天早上会收到这样一张卡片（配色每天自动换一种，一共 12 套）：

```
┌─────────────────────────────────────────┐
│  在一起的第 2453 天          2026年10月10日 星期六  │
├────────────────────┬────────────────────┤
│  ☀️ 北京             │  🌧️ 上海            │
│  晴转多云            │  小雨转阴            │
│  12° / 22°          │  19° / 25°          │
│  南风 1-3级          │  东南风 2-4级         │
│                     │                    │
│  🏃 运动(适宜)        │                    │
│  动一动吧，我在远方给你数着步数，...      │
│  👕 穿衣(较舒适)      │                    │
│  多穿一点，你的冷暖我最放在心上，...      │
├────────────────────┴────────────────────┤
│  💌 「我最近手头有点紧，想借你的手牵一牵」  │
│                              —— 爱你的小宝 │
└─────────────────────────────────────────┘
```

12 套配色分别是：蜜桃粉、薄荷绿、薰衣草紫、奶油黄、天空蓝、蜜桃橘、雾霾蓝、奶茶色、抹茶绿、莓果粉、海洋青、丁香紫。

## 二、整体结构

整个项目不到 500 行，纯 Node，除了 `nodemailer`、`node-fetch`、`dayjs` 之外没有别的依赖：

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

数据流很直白：

```
和风天气 API ─┐
天行数据 API ─┼─► buildContent() ─┬─► cardHtml() ─► renderHtmlToPng() ─► 卡片图
config.js ───┘                    └─► emailHtml() ─────────────────────► 纯文字兜底
                                                    │
                                                    ▼
                                              sendEmail() ─► SMTP
```

`content.js` 里 `buildContent()` 的设计值得单独说一句：**它把接口原始数据整理成「邮件」和「卡片图」共用的结构化内容**，两个模板都从同一个对象渲染。这样文字邮件和图片卡片永远一致，不会出现改了一处忘了另一处的情况。

## 三、收件人解析：多人、自动配对

`config.js` 里最花心思的是 `MAIL_TO` 的解析。它需要同时满足几种写法：

```ini
# 两个人自动互为 TA（最常用）
MAIL_TO=a@example.com|北京|101010100;b@example.com|上海|101020100
# 显式指定这个人的 TA 是广州
MAIL_TO=a@example.com|北京|101010100|广州|101280101
# 只写邮箱，都用默认城市
MAIL_TO=a@example.com,b@example.com
# 只给 LocationID，城市名自动反查
MAIL_TO=a@example.com|101010100
```

解析器逐段判断第二段是纯数字还是城市名：

```js
const [mail, p2, p3, p4, p5] = chunk.split('|').map((s) => (s || '').trim());

// 自己的城市：第二段是纯数字就当成 LocationID，否则当成城市名
let myCity = '';
let myLocation = '';
if (p2) {
  if (/^\d+$/.test(p2)) myLocation = p2;
  else myCity = p2;
}
if (p3) myLocation = p3;

// TA 的城市
let taCity = p4 || '';
let taLocation = '';
if (p5) taLocation = p5;
```

**只有两个人又都没显式写 TA 时，自动把对方填进来** —— 于是两个人收到的卡片是镜像的，各自看到自己城市的完整信息 + 对方城市的天气：

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

另外两个容错细节，都是被真实场景逼出来的：

**剥掉被一起粘进来的变量名前缀。** 很多人配置环境变量时会连 `MAIL_TO=` 一起复制，结果收件人变成 `MAIL_TO=a@example.com`：

```js
.map((chunk) => chunk.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, '').trim())
```

**换行也当分隔符。** 从 `.env` 里整段复制时，多个收件人往往是换行分隔的，只按逗号分会连成一条：

```js
.split(/[,;，；\r\n]+/)
```

还有一处提前校验 —— 地址不像邮箱就直接报错，免得跑到 SMTP 那一步才看到 550：

```js
const bad = people.filter((p) => !/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(p.to));
if (bad.length) {
  throw new Error(
    `MAIL_TO 里的收件人地址不合法：${bad.map((b) => `「${b.to}」`).join('、')}。` + ...
  );
}
```

发送时是**逐个单独发**的，每个人只看到自己的地址：

```js
// 分别单独发送：每个人只看到自己的地址，互相不可见
await sendEmail({
  from: fromDisplayText,
  to: person.to,
  subject: fromDisplaySubText,
  html: htmlStr,
  attachments,
});
```

## 四、卡片图：无头 Chrome + 手写 WebSocket

这是整个项目技术上最麻烦的部分。

需求很简单：生成一张排版精致的图片。可选方案有几个 —— Canvas 手绘（排版代码会很痛苦）、`node-canvas`（要装系统库，CI 上经常编译失败）、puppeteer（依赖几百 MB）、无头 Chrome 截图（要自己实现 CDP 通信）。

最后选了**无头 Chrome + DevTools 协议**，因为 HTML/CSS 排版最省事，而且 `render.js` 手写实现下来只有一个文件。

### 整页截图的正确姿势

关键是先量高度再截，否则 `captureBeyondViewport` 也截不全：

```js
const { result } = await cdp('Runtime.evaluate', {
  expression:
    'Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))',
  returnByValue: true,
});
const fullHeight = Math.max(1, Number(result.value) || 600);

await cdp('Emulation.setDeviceMetricsOverride', {
  width,
  height: fullHeight,
  deviceScaleFactor: scale,
  mobile: false,
});

const shot = await cdp('Page.captureScreenshot', {
  format,
  quality: format === 'jpeg' ? quality : undefined,
  captureBeyondViewport: true,
  // clip.scale 固定为 1：清晰度已经由 deviceScaleFactor 控制，
  // 两者相乘会变成 4 倍图（体积翻好几倍），没必要。
  clip: { x: 0, y: 0, width, height: fullHeight, scale: 1 },
});
```

这里有个容易多此一举的地方：**`clip.scale` 和 `deviceScaleFactor` 是相乘的**。两个都设成 2，得到的是 4 倍图，文件体积翻好几倍，清晰度却没有肉眼可见的提升。所以清晰度交给 `deviceScaleFactor`，`clip.scale` 固定为 1。

### 为什么必须手写 WebSocket

CDP 的通信是 WebSocket。Node 22 有全局 `WebSocket`，但 **GitHub Actions 上 `actions/setup-node` 指定的是 Node 20，没有全局 `WebSocket`**：

```js
new WebSocket(wsUrl);
// ReferenceError: WebSocket is not defined
```

而为了保持零依赖，又不能引 `ws` 包。所以 `render.js` 里用 `net` 手写了一个 RFC 6455 子集，大约 150 行：

```js
class MiniWebSocket {
  constructor(url) {
    const u = new URL(url);
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

要处理的细节一个都不能少：

- 握手时校验 `Sec-WebSocket-Accept`（`base64(sha1(key + 258EAFA5-E914-47DA-95CA-C5AB0DC85B11))`）；
- 客户端发出的每一帧都必须加掩码，服务端的不加 —— 掩码方向搞反会直接断连；
- 收到 `opcode 0x9`（ping）要回 `0xa`（pong）；
- 处理 126 / 127 两种扩展长度；
- 分片重组（`fin` 标志 + `opcode 0x0` 续帧）。

粘包处理是这类实现的经典坑：`data` 事件拿到的可能是半帧，也可能是两帧，所以需要维护一个缓冲区循环解析：

```js
_onData(chunk) {
  this._buf = Buffer.concat([this._buf, chunk]);
  // ...
  for (;;) {
    if (this._buf.length < 2) return;
    // 解析长度 → 判断是否有掩码 → 检查是否收齐
    if (this._buf.length < off + len) return;  // 没齐就退出，等下一个 chunk
    // ...
  }
}
```

### 中文字体

CI 上跑出来的中文**全是方框**，因为 ubuntu-latest 镜像里没有中文字体。workflow 里补上：

```yaml
- name: 安装中文字体与浏览器
  run: |
    sudo apt-get update -qq
    # 不装中文字体的话，卡片图里的中文会变成方框
    sudo apt-get install -y -qq fonts-noto-cjk fonts-noto-color-emoji
    # 运行器一般自带 Chrome；万一没有就用 chromium 兜底
    if ! command -v google-chrome >/dev/null 2>&1 && [ ! -x /usr/bin/google-chrome ]; then
      sudo apt-get install -y -qq chromium-browser || true
    fi
    fc-cache -f >/dev/null 2>&1 || true
```

`fonts-noto-color-emoji` 也不能漏 —— 卡片里的天气图标和生活指数图标用的是 emoji，缺了这个字体渲染出来是黑白轮廓。

> **顺便说个设计决策**：天气图标没有用和风返回的图标 URL，而是把 `iconDay` 数字码映射成 emoji。原因是**渲染时不依赖网络** —— 用外链图片的话，某天图片服务挂了或者慢，卡片上就会出现一块空白或延迟。emoji 是本地字体渲染的，永远都在。

## 五、配色每天不重样

12 套配色要满足三个条件：每天换一种、同一天结果恒定、相邻两天不撞色。

朴素做法是 `day % 12`，但那样会形成肉眼可见的周期（第 1 天和第 13 天颜色一样）。所以用 hash 打散，再对撞色做线性后移：

```js
/** 预生成每个天数的主题下标：确定性、相邻两天不撞色 */
const MAX_DAY = 4000;
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

几个细节：

- **表是预生成的**，不是每天现算。因为「相邻不撞色」这个约束依赖于前一天的结果，是链式的，必须顺序推导。
- **`MAX_DAY = 4000`**，超过就取模 —— 在一起 11 年才用得上，够了。
- 用 `Math.imul` 做 32 位整数乘法，避免 JS 浮点精度丢失导致 hash 结果不稳定。

想固定一种配色，把 `MAIL_THEME` 设成主题名就行，支持模糊匹配：

```js
/** 按名字挑主题（配置里写死某个颜色时用），找不到就返回 null */
function themeByName(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  return THEMES.find((t) => t.name === key || t.name.includes(key)) || null;
}
```

所以填「薄荷」也能命中「薄荷绿」，不用记全名。

## 六、异地恋语气

这一块是纯粹的文案工作，但我觉得挺重要。

生活指数的文案是按和风的 type 逐个写的，**刻意避开了「一起做」「陪着你」这类需要见面的说法**，改成隔着距离也在惦记你的语气：

```js
/**
 * 生活指数的亲昵语气前缀（异地恋版）。
 *
 * 刻意避开「一起做」「陪着你」这类需要见面的说法，
 * 改成隔着距离也在惦记你的语气。按和风指数 type 匹配，没有对应项就不加。
 */
const SWEET_PREFIX = {
  1: '动一动吧，我在远方给你数着步数，',
  2: '记得防晒，晒黑了我会心疼的，',
  3: '多穿一点，你的冷暖我最放在心上，',
  5: '洗车这种累活儿，留着等我回去干，',
  6: '这里先记下来，等我们见面一起去，',
  7: '别过敏呀，隔着屏幕我照顾不到你，',
  8: '这么好的天，真想和你一起晒晒太阳，',
  9: '千万别感冒，你难受我却抱不到你，',
  11: '空调别开太凉，我不在没人给你盖被子，',
  // ...
};
```

对比一下就很明显：通用的写法是「今天适宜运动」，改完之后是「动一动吧，我在远方给你数着步数」—— 同样一条数据，后者才像是有人真的在关心你。

生活指数的 `type` 对照表（和风）：1运动 2防晒 3穿衣 5洗车 6旅游 7过敏 8舒适度 9感冒 10空气 11空调 12太阳镜 13化妆 14晾晒 15交通。

## 七、三层兜底

定时任务最怕的是**某天悄悄失败了，你过了一周才发现**。所以做了三层：

**第一层：卡片图生成失败 → 退回纯文字邮件。**

```js
// 生成卡片图；失败就退回纯文字邮件，保证每天都有邮件
let htmlStr;
let attachments;
try {
  const png = await renderHtmlToPng(cardHtml(content), {
    width: 720, scale: 2, format: 'jpeg', quality: 85,
  });
  attachments = [{ filename: `每日提醒-${now.format('YYYY-MM-DD')}.jpg`, content: png, cid: 'daily-card' }];
  // 正文只放这张图，点开就是完整内容
  htmlStr = '<div><img src="cid:daily-card" alt="每日提醒" style="width:100%;max-width:720px" /></div>';
} catch (e) {
  console.error('[每日提醒] 卡片图生成失败，改为发送文字邮件：', e.message);
  htmlStr = emailHtml(content);
}
```

图挂了但邮件照发，至少不空手。

**第二层：TA 的天气拿不到 → 只不显示那一块。** 对方城市的接口异常不应该让整封邮件发不出去：

```js
/** 取某个 LocationID 的 TA 天气（只要天气情况，不带生活指数） */
async function getTaWeather(id) {
  if (!id || taFailed.has(id)) return null;
  try {
    return await getWeather(id);
  } catch (e) {
    console.error(`[每日提醒] TA城市(${id})天气获取失败，已忽略：`, e.message);
    taFailed.add(id);
    return null;
  }
}
```

**第三层：整体失败 → 发报错邮件给自己，并让 Actions 变红。**

```js
} catch (e) {
  // 先打印真实错误，保证 Actions 日志里能看到原因
  console.error('[每日提醒] 发送失败：', e);

  // 发送邮件给自己提示（这一步失败不能再把进程带崩）
  try {
    await sendEmail({
      from: '报错啦',
      to: user,
      subject: '定时邮件-报错提醒',
      html: `请查看 github actions<br><br><pre>${String((e && e.stack) || e)}</pre>`,
    });
  } catch (inner) {
    console.error('[每日提醒] 报错提醒邮件也发送失败：', inner);
  }

  // 让 GitHub Actions 显示为失败，而不是绿色成功
  process.exitCode = 1;
}
```

最后那行 `process.exitCode = 1` 是必要的。Node 默认以 0 退出，**哪怕 catch 里打印了错误，Actions 也会显示绿色成功** —— 等于把失败藏起来了。显式设成 1，GitHub 才会发失败通知。

## 八、部署

1. 推送代码到仓库。
2. **Settings → Secrets and variables → Actions**，添加必填的 `MAIL_USER`、`MAIL_PASS`、`MAIL_TO`、`WEATHER_KEY`、`TIANXING_KEY`。
3. 到 **Actions** 页面选 `daily-mail` → **Run workflow** 手动跑一次验证。
4. 之后每天北京时间 08:02 自动执行。

```yaml
on:
  schedule:
    # 注意：cron 使用 UTC 时间，北京时间 = UTC + 8
    # "02 00 * * *" = 北京时间每天 08:02
    - cron: "02 00 * * *"
  # 支持在 Actions 页面手动点一下立即运行，方便调试
  workflow_dispatch:
```

关于时间点，有两个坑：

- **cron 用的是 UTC**，北京 08:02 对应 `02 00`。写成 `08 00` 就变成下午四点了。
- **不要选整点**。GitHub 的 schedule 在整点前后负载最高，任务经常延迟十几分钟甚至更久。错开两分钟（`02` 而不是 `00`）能明显改善准点率。

`MAIL_PASS` 填的不是邮箱登录密码，而是**SMTP 授权码**。QQ 邮箱的获取路径是「设置 → 账户 → 开启 SMTP 服务」，生成的是一串独立密码。用登录密码会认证失败。

### 怎么查 LocationID

和风天气的天气接口**只认数字 LocationID，不认中文城市名** —— 填「北京」会直接返回 HTTP 400。

查询方式：访问 `https://geoapi.qweather.com/v2/city/lookup?key=你的key&location=北京`，返回 JSON 里的 `id` 字段就是，例如北京是 `101010100`、上海是 `101020100`。

> 这一点我在别的项目上踩过 —— 和风**也没有 IP 定位**。`location=auto_ip` 不会报错，而是会命中罗马尼亚一个真名叫 "Ip" 的城市，返回一份莫名其妙的天气。所以城市只能写死。

## 九、几个数字

- 12 套配色，相邻两天不撞色，周期感被 hash 打散
- 卡片渲染 720px 宽 × 2 倍图，输出 JPEG 质量 85，单张约 200 KB
- `MAX_DAY = 4000`，够用到 11 年后
- 零第三方渲染依赖，`render.js` 一个文件搞定 CDP + WebSocket

## 🔗 相关源码

- [MuyuDada/The-daily-mail](https://github.com/MuyuDada/The-daily-mail)

---

最后说点感性的。写这个东西花的时间不算多，但它每天真的会在八点零几分出现。异地的时候，「我知道你在惦记我」这件事本身，比惦记的内容更重要。

如果你也在异地，直接 fork 下来改几个 Secret 就能跑 —— 需要准备的只有两个免费 API key（和风天气、天行数据）和一个开启了 SMTP 的邮箱。
