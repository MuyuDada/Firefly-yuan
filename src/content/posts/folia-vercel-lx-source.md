---
title: '把 Folia 搬上 Vercel：网页版也能跑洛雪自定义源脚本'
slug: 'folia-vercel-lx-source'
published: 2026-11-11
description: '桌面版靠模组跑 lx 脚本，网页版既没有模组系统也没有主进程。于是把同一件事拆成「一个 Vercel 函数 + 一个换地址的客户端」：crossOrigin 的 CORS 门槛、HMAC 签名的中转、vm 里跨 realm 的错误对象，以及线上实测的 302 与耗时。'
image: 'https://muyuimg.cc.cd/file/blog/3HYslkMN.webp'
category: 开源项目
tags: [Vercel, Serverless, Node.js, 音乐]
draft: false
pinned: false
---

先给两个能点的东西：

- 体验地址：**[music.muyudada.dpdns.org](https://music.muyudada.dpdns.org/)**（网页版 Folia，配好脚本就能听到脚本解析出来的音质）
- 桌面版那个模组：[folia-lx-source-bridge](https://github.com/MuyuDada/folia-lx-source-bridge)

之前写过一篇文章讲桌面模组的设计（[在 Folia 里跑洛雪自定义源](/posts/folia-lx-source-bridge/)）。这一次是把同一件事搬到线上：**Folia 的 Web 版部署在 Vercel，然后用一个 Serverless 函数代替主进程去跑 lx 自定义源脚本。**

![Folia 网页版歌单页](https://muyuimg.cc.cd/file/blog/6fcVjBQX.webp)

整件事拆下来就三句话：先把 Folia 的 Web 版部署到 Vercel 并绑好域名；再加一个 `/api/lx-source` 函数，在 `node:vm` 里跑脚本、把解析结果 302 出去、必要时自己中转音频；最后在前端 `omni.getAudioSource` 的出口把地址换掉。

一次提交，8 个文件，+2009 行。下面按顺序说都干了什么、怎么干的。

## 一、第一步：把 Folia 部署到 Vercel

### 1.1 它本来就是给 Vercel 准备的

Folia（`chthollyphile/folia-major`，AGPL-3.0）有两套壳：桌面端是 Electron，Web 端是纯 Vite + React 19。仓库根目录本来就有 `api/`——`generate-theme.js`、`lyric-proxy.js`、`qq.js`、`segment-lyrics.js`，全是 Vercel 函数的形状。官方 README 里也挂着一键部署按钮。

所以「部署到 Vercel」这一步没什么玄学，官方文档写得比我清楚。真正需要我自己动手的只有两处：**Node 版本**和**构建命令**。

- `.nvmrc` 是 `24`，`engines.node` 要求 `>=24`。Vercel 项目设置里 Node 版本得跟着选 24，否则 `vite build` 会先死在语法上。
- 构建命令就是 `npm run build`。我把这个脚本改成了两段：

```json
"build": "npm run build:vercel-api && vite build",
"build:vercel-api": "tsc -p api-ts/tsconfig.json"
```

第一段把 `api-ts/*.ts` 编译到 `api/*.js`，第二段才是前端。这个顺序不能反：Vercel 是在构建阶段才发现 `api/` 目录里的函数的，产物必须先落地。

### 1.2 实际点的几个按钮

1. 把源码推到自己仓库（要改前端，不能只用官方一键部署）；
2. Vercel 里 Import 这个仓库，Framework 识别为 Vite，Output 是 `dist`；
3. 环境变量里把 AI 主题、QQ 相关的几个 key 填上（这些跟本文无关，官方文档有）；
4. Deploy，等第一次构建。

`vercel.json` 里我只保留了两件事：一个 `ignoreCommand`（只有 `HEAD` 与 `HEAD^` 真有差异才构建，避免纯文档改动触发重建）和一条 `/api/qq/:path*` 的 rewrite。

### 1.3 域名

域名是 `music.muyudada.dpdns.org`。在 Vercel 项目里 Add Domain 之后，它给的目标是 `8f3a23d60faa7e6f.vercel-dns-017.com`，回 DNS 那边加一条 CNAME 指向过去，证书由 Vercel 自动签发。

验一下：

```bash
nslookup -type=CNAME music.muyudada.dpdns.org
# music.muyudada.dpdns.org canonical name = 8f3a23d60faa7e6f.vercel-dns-017.com
curl -sI https://music.muyudada.dpdns.org/ | grep -i server
# Server: Vercel
```

到这里，「能听的 Folia」已经有了，但**听到的是内置音源给的地址**。这一步上线之后我才开始动音源桥。

## 二、第二步：桌面模组的三件套，网页版一件都没有

先复盘桌面版是怎么干的。它靠三样东西：

| 桌面版 | 干什么 |
| --- | --- |
| `omni.audioSourceResolved` 同步钩子 | 内置音源解析出地址的瞬间，改写成占位 URL（1.5 秒时限内必须返回） |
| 主进程 + `node:vm` | 真正跑 lx 脚本，脚本要 `Buffer`、`crypto`、`zlib` |
| `http://127.0.0.1:<port>` 回环代理 | 脚本给的 `http://` 地址在 https 页面里是混合内容，得由本地代理中转 |

网页版呢：

- `window.electron.mods` 不存在，没有模组系统；
- 没有主进程，也就没有常驻的本地 http 服务；
- 没有回环地址可以用来"洗白"混合内容。

所以三件套得一一找替代品。最后的映射关系是这样的：

| 桌面版 | 网页版 |
| --- | --- |
| 同步钩子改写地址 | `omni.getAudioSource` 返回前换地址（异步，没有 1.5s 限制） |
| 主进程 `node:vm` 跑脚本 | Vercel 函数里 `node:vm` 跑脚本 |
| 本地回环代理 | 本站的带签名中转 `/api/lx-source?op=stream&…` |

顺带说一个设计取舍：**为什么不干脆在浏览器里跑脚本？** lx 脚本不是普通 JS，它要 Node 的 `Buffer`/`crypto`/`zlib`，还默认自己能发任意跨域请求。塞进浏览器意味着把同源策略整个拆掉，而且那毕竟是别人写的代码——放服务端跑，它拿不到用户的 cookie、localStorage 和曲库。代价是冷启动和多一次网络往返，我认这个代价。

## 三、服务端：一个函数，三个动作

`api-ts/lx-source.ts` 860 行，编译出来 `api/lx-source.js` 768 行。对外只有三个 op：

```
GET /api/lx-source?op=status
GET /api/lx-source?op=resolve&p=<base64url 的 {provider, quality, song}>
GET /api/lx-source?op=stream&u=<base64url 目标>&sig=<HMAC>
```

| op | 作用 | 典型响应 |
| --- | --- | --- |
| `status` | 这份部署配了脚本没有、脚本叫什么、声明了哪些音源 | `{"configured":true,"providers":["netease","kugou","qq"],…}` |
| `resolve` | 跑脚本拿地址，然后跳过去 | `302 Location: https://…` |
| `stream` | 带 `Range` 的音频中转，回 CORS 头 | `206` + 音频流 |

### 3.1 脚本从哪来

不分发脚本，所以脚本只能从环境变量进：`LX_SOURCE_SCRIPT`（正文）、`LX_SOURCE_SCRIPT_B64`（base64，优先，防换行被吃）、`LX_SOURCE_SCRIPT_URL`（给个地址让函数自己拉，实例内存里缓存）。

我实际用的是 B64 那一档 + 一个显式签名密钥：

```bash
LX_SOURCE_SCRIPT_B64=<脚本正文的 base64>
LX_SOURCE_SIGNING_KEY=<一串随机字符>
LX_SOURCE_QUALITY=high
```

**没配任何一个时，这个功能是关闭的。**客户端先问一次 `op=status`，拿到 `configured: false` 就再也不碰播放地址——不会因为多了个功能让没配脚本的人多付一次请求。

一个坑写在这里：**Vercel 的环境变量改动要一次新的部署才生效**，改完点 Redeploy，别对着旧实例调半天。

### 3.2 沙箱和宿主 API

沙箱里只给脚本该有的东西，`console` 五个级别全劫持到函数日志里：

```ts
const sandbox = {
	console: scriptConsole,  // 打上 [lx-source] 前缀
	setTimeout, clearTimeout, setInterval, clearInterval,
	Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa,
	lx,
};
const context = createContext(sandbox);
runInContext(code, context, { filename: 'lx-source.js', timeout: 10_000 });
```

最后那个 `timeout: 10_000` 是必要的：脚本在自己顶层写个死循环，就会把整个函数实例拖死；给了时限，最差是这次请求失败，实例还能活。

`lx.request` 的语义按洛雪桌面版逐项对齐——回调 `(err, resp, body)`、`body` 是 utf8 文本再**无条件尝试 JSON.parse**、`resp.raw` 保留 `Buffer`、**不跟随重定向**、`GET/HEAD` 的 `form` 拼进查询串、超时上限 60 秒。这些不是洁癖：脚本作者就是按这套语义写的，差一条，某个脚本的 `body.xxx` 就变成 undefined。

### 3.3 播放地址的落地：直连还是中转

这是整个函数最核心的十几行。先探一下终点，再决定 302 到哪：

```ts
const probeTarget = async (url: string, hops = 0) => {
	const response = await fetch(url, {
		method: 'GET',
		headers: { 'User-Agent': BROWSER_UA, Range: 'bytes=0-1' },  // 只要两个字节，不下载正文
		redirect: 'manual',
		signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
	});
	if (hops < 5 && response.status >= 300 && response.status < 400) {
		const location = response.headers.get('location');
		await response.body?.cancel();
		if (location) return probeTarget(new URL(location, url).toString(), hops + 1);
	}
	const cors = Boolean(response.headers.get('access-control-allow-origin'));
	await response.body?.cancel();
	return { url: response.url || url, status: response.status, cors };
};
```

判定只有一张小表：

| 探测结果 | 302 到 |
| --- | --- |
| https 且带 `Access-Control-Allow-Origin` | 上游地址本身（不占本站带宽） |
| https 但没有 CORS 头 | `/api/lx-source?op=stream&…` |
| http（混合内容，浏览器会拦） | 同上 |
| 探不通 / 上游 4xx、5xx | 同上，中转一次再试试 |

## 四、客户端：只换一个地址

`src/services/lxSourceBridge.ts`，159 行，只做一件事：

```ts
export const applyLxSourceBridge = async (providerId, song, quality, source) => {
	const status = await lxSourceStatus();
	if (!status || !status.configured || status.disabled) return source;
	if (!status.providers.includes(providerId)) return source;

	const mediaId = mediaIdOf(song);
	if (mediaId === '') return source;

	const url = resolveEndpointUrl(providerId, song, quality, mediaId);
	return { ...(source ?? { quality, fetchedAt: Date.now() }), url, fetchedAt: Date.now(), preview: false };
};
```

几个刻意的细节：

- **只换 `url`**，其余字段沿用平台的。ReplayGain、试听标记这些还是内置音源说了算。
- **状态缓存 5 分钟**，并发共用同一个请求。`status` 挂了、404 了、超时了（2.5 秒）都当成"没配"，播放照旧走平台地址，绝不让音源桥把播放拖垮。
- **桌面端整个不参与**（`!window.electron`）。同一台机器上模组和网页两条链路同时接管，会把地址改两次。

接入点在 `omni.getAudioSource`，两处：

```ts
// 平台拒绝这首歌时的兜底分支：脚本可能解得出
const fromLxSource = await applyLxSourceBridge(provider.id, song, quality, null);
if (fromLxSource?.url) return fromLxSource;

// 正常路径的最后一层：平台给得出，但换成脚本给的
const hooked = await applyOmniAudioHook(song, source);
return await applyLxSourceBridge(provider.id, song, quality, hooked);
```

## 五、真正难的四件事

### 5.1 `crossOrigin="anonymous"`：没有 CORS 头就是播不了

这是从桌面版搬过来最容易被忽略的一条。Folia 的双音轨要进 Web Audio 做淡入淡出（`createMediaElementSource`），所以 `<audio crossOrigin="anonymous">` 是写死的，**目标地址必须带 CORS 头**。桌面版靠本地回环代理天然解决——`127.0.0.1` 是自己人；网页版没有这个特权，上游不给 `Access-Control-Allow-Origin`，浏览器直接拒播。

于是就有了上面那张"直连还是中转"的表。绝大多数网易云/QQ 的直链是带 CORS 的，直接 302 过去；少数不带、或者只给 http 的，才落到本站中转。实测下来大部分歌走的是直连，不吃本站流量。

### 5.2 中转不能变成开放代理

`op=stream&u=…` 这种形状天然像 SSRF 跳板。三道锁：

```ts
// 1. HMAC 签名，目标被改一个字符就 403
const signTarget = (target: string) => createHmac('sha256', signingKey()).update(target).digest('base64url').slice(0, 32);
// 2. 定长比较，别用 ===
timingSafeEqual(Buffer.from(signTarget(target)), Buffer.from(signature));
// 3. 只认公网 http(s)：localhost / 10. / 127. / 172.16-31. / 192.168. / 169.254 全挡
```

签名密钥优先取 `LX_SOURCE_SIGNING_KEY`；没配就用脚本内容派生一个 sha256（`lx-source-bridge|${script}`），这样同一个部署的各个实例算出来一致，重启也不失配。

线上验一下：

```bash
curl -s "https://music.muyudada.dpdns.org/api/lx-source?op=stream&u=aHR0cHM6Ly9leGFtcGxlLmNvbS9hLm1wMw&sig=deadbeef"
# {"error":"签名不符"}
```

### 5.3 vm 里抛出来的错误不是 `Error`

这个坑排查了很久。脚本在 `vm` 上下文里 `throw new Error('…')`，宿主这边拿到的对象 `instanceof Error` 是 **false**——不同 realm 的原型链不通用。直接 `String(error)` 只会得到 `"{}"`，日志里一片空白，看不出脚本到底死在哪。

```ts
// 按形状取，别按类型判断
const describeError = (error: unknown): Error => {
	if (error instanceof Error) return error;          // vm 里抛出来的走不到这一行
	const message = (error as { message?: unknown })?.message;
	if (typeof message === 'string' && message) return new Error(message);
	return new Error(safeText(error ?? '脚本返回被拒绝'));
};
```

顺带一个同源的坑：脚本传下来的值可能是 `Buffer`、字符串、数字，甚至对象。统一过一遍 `toBuffer`，别让 `String()` 把对象写成 `"[object Object]"`——`utils.zlib.inflate` 和 `aesEncrypt` 都吃这个亏。

### 5.4 缓存要缓存 Promise，落地结果还得带上 origin

两层缓存，都存 **Promise 本身**，不是结果：

```ts
const memo = (store, key, work) => {
	sweepCaches();
	const existing = store.get(key);
	if (existing) return existing.promise;   // 并发的第二个请求直接共享第一个的 in-flight
	const entry = { at: Date.now(), promise: work() };
	entry.promise.catch(() => { if (store.get(key) === entry) store.delete(key); });
	store.set(key, entry);
	return entry.promise;
};
```

存结果的话，两次几乎同时的取流会把脚本跑两遍（聚合脚本一次解析就是好几秒）；存 Promise，后到的那个直接等先到的。

两个 key 还不一样：

- `resolveCache`：`provider|songId|quality`，缓存 10 分钟；
- `locationCache`：`provider|songId|quality|origin`，**多一个 origin**——因为中转地址是绝对地址，换接入域名就不能复用。

另外，脚本加载失败后 30 秒内不再重试：一个坏脚本不该让每次播放都重新编译一遍。表超过 256 条淘汰最旧的。

音质档位也有个降档逻辑：请求档位脚本不支持时，取"不高于请求的最近一档"，都不满足才给最低档。不硬要，也不给用户听个静音。

## 六、验收

代码层面：`tsc` 干净、`lint` 新增问题 0 条、`onlineMusic` + `services` 两组 1579 个用例通过。接口层面本地跑了 10 项（302、降档、签名、Range、缓存命中）。

线上这几条是刚跑的：

```bash
# 1. 状态
curl -s https://music.muyudada.dpdns.org/api/lx-source?op=status
# {"configured":true,"providers":["netease","kugou","qq"],
#  "sources":{…6 个音源, 全部 musicUrl:true…},"loaded":true,"mode":"auto"}

# 2. 解析（302 直连，不吃本站流量）
curl -s -D - -o /dev/null "…/api/lx-source?op=resolve&p=…" | grep -i location
# Location: https://m701.music.126.net/…/….mp3

# 3. 耗时：三连测 0.65s / 0.62s / 0.62s（命中 10 分钟解析缓存）

# 4. 预检
curl -X OPTIONS -o /dev/null -w "%{http_code}\n" "…/api/lx-source"
# 204
```

拿一首歌实测：缓存命中的解析请求 0.6 秒左右，播放器跟过去就能出声；碰上要在几条链路里挨个试的歌，起播会拖到几秒。播到一半拖进度条正常——说明 `Range` 和 `Content-Range` 那套头透传是对的。

![Folia 网页版正在播放](https://muyuimg.cc.cd/file/blog/3HYslkMN.webp)

## 七、已知限制

诚实清单，写在 `docs/lx-source-bridge.md` 里：

- **首播慢几秒**：第一次播一首歌要跑一次脚本，聚合类脚本多链路解析更慢；10 分钟内重播命中缓存。
- **只接管三个平台**：`netease` / `kugou` / `qq` 对应脚本里的 `wy` / `kg` / `tx`。脚本声明里没有 `musicUrl` 的音源一律不动。
- **不做独立音源**：网页版的音源切换器不属于这条链路，LX 只负责"换地址"。歌单、搜索、**歌词**仍然来自内置音源（lx 脚本不给歌词）。
- **中转受函数时限与响应大小约束**：`maxDuration` 写的是 60 秒（Hobby 上限）。走中转的长音频可能中途断流，能直连的不受影响。长期靠中转就把 `LX_SOURCE_FORCE_PROXY` 关掉，或者换自带 CORS 头的源。
- **解析失败就是播放失败**：回 502，不悄悄退回平台地址——把平台那个带会话签名的地址塞进查询串，等于把它写进日志。要退就关掉音源桥（`LX_SOURCE_DISABLED=1`）。
- **改环境变量要重新部署一次**。

## 八、最后

回头看，桌面版那套设计（同步钩子改地址、主进程跑脚本、回环代理洗混合内容）在 Serverless 上几乎没有一条能照抄：钩子变成了函数返回值，主进程变成了冷启动的实例，回环代理变成了自己给自己签名的中转。真正搬得动的只有语义——**歌单和搜索还是平台的，播放地址是脚本的**。

代码在 [MuyuDada/folia](https://github.com/MuyuDada/folia) 的 `feat/lx-source-bridge-vercel` 分支（AGPL-3.0，跟随上游）。老规矩：本项目不含、不分发任何音源脚本；你导入脚本的内容与用途由你自己负责，这里只做播放地址解析，不下载、不存储、不分发音频文件。
