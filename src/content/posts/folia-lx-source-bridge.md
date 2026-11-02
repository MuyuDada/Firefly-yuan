---
title: '在 Folia 里跑洛雪自定义源：folia-lx-source-bridge 的设计与实现'
slug: 'folia-lx-source-bridge'
published: 2026-11-02
description: '一个 Folium 模组：歌单和搜索留给 Folia 内置音源，播放地址交给洛雪自定义源脚本解析。核心是三个问题——1.5 秒的同步钩子时限怎么绕、lx 宿主 API 怎么逐项仿冒、http 音频地址在安全上下文里怎么落地。'
image: api
category: 开源项目
tags: [Electron, JavaScript, Node.js, 音乐]
draft: false
pinned: false
---

我平时用 [Folia](https://github.com/chthollyphile/folia-major) 听歌，歌单、搜索都是内置音源（网易云/酷狗/QQ），但播放地址嘛……总有些歌它给不了高音质，或者干脆给不了。而洛雪音乐的[自定义源脚本](https://lxmusic.toside.cn/desktop/custom-source)生态里恰好有大量现成的解析脚本。

于是我写了一个 Folium 模组：[folia-lx-source-bridge](https://github.com/MuyuDada/folia-lx-source-bridge)。它本身不含任何音源脚本，只做一件事——让 Folia 能"读懂"你自己带进来的 lx 脚本。

这篇文章记录整个设计过程。源码就两个文件：`client.mjs`（渲染进程，343 行）和 `index.cjs`（主进程，819 行），但中间踩的坑不少。

## 一、接在哪里：两条路，都要

Folia 的模组平台 Folium 提供了两个实验接口，正好对应两种用法：

**钩子模式**（`omni.hooks`）：内置音源解析出播放地址后，我把它换掉。这也是 lx 自定义源在洛雪桌面版里的真实语义——**列表用宿主的，URL 换脚本的**。用户什么都不用改，点歌、搜歌、歌单全是原来的体验。

**独立音源**（`omni.providers`）：在音源切换器里注册一个「LX」条目。搜索代理给脚本支持的第一个内置平台（歌曲 id 形如 `wy:123456`），播放地址一律问脚本。

两条路可以同时开，每一路单独 try/catch，互不拖垮——钩子挂了独立音源照常工作，反之亦然。这类实验接口随时可能随宿主版本变化，兜底必须做足。

## 二、1.5 秒钩子时限：占位地址

这是整个项目最关键的设计。

Folium 的 `omni.audioSourceResolved` 钩子是**同步的，且全程限时 1.5 秒**。而 lx 脚本解析一次播放地址，往往要走好几个上游接口——加密请求、解密响应、多链路探测——几秒钟都算快的。在钩子里同步等脚本？必超时。

所以钩子里只做一件瞬间完成的事：**把地址改写成占位 URL**。

```js
events.on('omni.audioSourceResolved', ev => {
  const lxSource = HOOK_SOURCE_MAP[ev.song.source]   // netease → wy
  if (!lxSource || !supportsMusicUrl(lxSource)) return
  const payload = toBase64Url(JSON.stringify({
    source: lxSource,
    quality: values.quality || 'high',
    song: { id: String(ev.song.id), title: ev.song.title ?? '', /* ... */ },
  }))
  ev.url = `http://127.0.0.1:${status.proxyPort}/p/${payload}`
  prefetch(lxSource, ev.song, values.quality)   // fire-and-forget 预热
})
```

占位地址里 base64url 编码了完整的解析参数。真正的解析发生在**播放器拿着这个占位地址来取流时**——主进程收到 `/p/` 请求，跑脚本拿到真实地址，然后 302 跳过去。

等于把异步解析从"钩子里"搬到了"播放器请求时"，钩子永远瞬间返回，绝不超时。

顺手还做了个优化：改写占位地址的同时 fire-and-forget 地预热一次解析，和取流时的解析共享同一份缓存。播放器真正来取流时，多半解析已经完成了。

## 三、解析缓存：去重比缓存更重要

主进程的解析缓存很简单——`Map` + 10 分钟 TTL：

```js
const getOrCreateResolve = (key, payload) => {
  sweepResolve()   // 清理过期项
  let entry = resolveCache.get(key)
  if (!entry) {
    entry = {
      at: Date.now(),
      promise: (async () => (await placeholderHandler(payload)).url)(),
    }
    entry.promise.catch(() => {
      if (resolveCache.get(key) === entry) resolveCache.delete(key)
    })
    resolveCache.set(key, entry)
  }
  return entry.promise
}
```

注意缓存的是 **Promise 本身**，不是结果。这个细节很重要：预热和取流几乎必然并发发生，如果缓存结果，两次解析会都跑一遍；缓存 Promise，后到的直接共享先到的那个 in-flight 请求。key 是 `source|songId|quality`，同一首歌同一音质永远只解析一次。

解析失败时把坏条目从缓存里删掉，下次重播还能重试。

## 四、主进程：node:vm 沙箱仿冒洛雪宿主

lx 脚本不是普通代码，它运行在一个叫 `globalThis.lx` 的宿主 API 上。我的任务是在 Folia 的 Electron 主进程里把这个 API 完整仿冒出来，再用 `node:vm` 把脚本跑起来：

```js
const sandbox = {
  console: scriptConsole,   // 劫持掉，日志重定向到模组日志
  setTimeout, clearTimeout, setInterval, clearInterval,
  Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa,
  lx,
}
const context = vm.createContext(sandbox)
vm.runInContext(code, context, { filename: 'lx-source.js' })
```

沙箱里只给脚本该有的东西。`console` 五个级别全部劫持重定向到模组日志，方便排查脚本问题。

### 4.1 最难仿的是 request

`lx.request` 是脚本和外界通信的唯一通道，语义必须和洛雪 preload.js **逐项一致**，因为脚本就是按这些语义写的：

- 回调形式 `(err, resp, body)`；`resp.raw` 保留原始 Buffer，`resp.body` 是 `raw.toString('utf8')` 后**无条件尝试 JSON.parse** 的结果
- **不跟随重定向**（needle 默认 `follow_max=0`）
- GET/HEAD 请求的 `form`/`formData` 拼进查询串，其他方法 `form` → urlencoded、`formData` → multipart
- 超时是 `min(timeout, 60000)`

特别是"自动 JSON.parse"这条——脚本作者都默认 `body` 可能是对象，如果你的实现返回字符串，一堆脚本的 `body.xxx` 直接 undefined 报错。这种语义差异不跑真脚本根本发现不了。

### 4.2 crypto 的坑：nopad

`utils.crypto.aesEncrypt` 要支持洛雪的 mode 字符串，包括 `-nopad` 变体：

```js
aesEncrypt: (buffer, mode, key, iv) => {
  let algo = String(mode).toLowerCase()
  const noPad = algo.includes('nopad')
  algo = algo.replace(/-?nopad/g, '')
  const cipher = crypto.createCipheriv(algo, key, /ecb/.test(algo) ? null : iv)
  cipher.setAutoPadding(!noPad)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
},
```

不复杂，但 `aes-128-ecb-nopad` 这种写法 Node 不认识，得自己拆。RSA 固定 PKCS1 padding——洛雪规范如此。

### 4.3 歌曲 id 的映射

Folium 内置 provider 的 mediaId 语义和 lx 脚本惯用的 `musicInfo` 字段要对上：

| 源 | musicInfo 字段 |
| --- | --- |
| `wy`（网易云） | `songmid`、`songId` |
| `kg`（酷狗） | `hash`、`albumId: ''` |
| `tx`（QQ） | `songmid`、`mediaMid` |
| `kw`（酷我） | `songmid` |
| `mg`（咪咕） | `songmid`、`copyrightId` |

酷狗的 `albumId` 给空串是个遗憾——部分脚本解无损要数字专辑 id，而 FoliumSong 只带专辑名，实在变不出来。这个坑在 README 里写明了。

## 五、http 播放地址：混合内容问题

脚本返回的播放地址经常是 `http://` 的。浏览器里 `<audio src="http://...">` 出现在 https 页面上是混合内容，直接被拒：`MEDIA_ELEMENT_ERROR: Format error`。

处理顺序分三层：

```
http 地址
  → GET 跟随重定向（不下载正文），终点是 https？直接用终点
  → 终点还是 http？交给本地回环代理：http://127.0.0.1:<port>/a/<token>
```

`http://127.0.0.1` 是安全上下文放行的回环地址，不算混合内容。代理的 token 表里有目标地址和 headers，15 分钟过期、最多 64 条；转发时透传 `Range` 头，把上游的 `Content-Range`、`Accept-Ranges` 等头带回来——**拖进度条能不能用全靠这几个头**。

```js
const headers = { 'User-Agent': BROWSER_UA, ...entry.headers }
if (clientReq.headers.range) headers.Range = clientReq.headers.range
// ...上游响应原样 pipe 回客户端
res.pipe(clientRes)
clientReq.on('close', () => upstream?.destroy())   // 用户切歌立刻断上游
```

探测重定向终点时只发 GET 不收正文，最多跟 5 跳。有个容易忽略的细节：探测发现上游已经 4xx/5xx（多链路脚本常见的死链），日志里写明 `探测结果为 HTTP xxx`，但仍交给本地代理重试一次——有些上游会对 HEAD/非浏览器 UA 耍脾气，真实取流时反而是好的。

## 六、独立音源：把游标分页适配成偏移分页

注册「LX」音源时还有个不小的坑：`omni.searchSongs` 返回的是**游标分页**（`nextCursor`），而 omni provider 接口要的是**偏移分页**（`limit/offset`）。得自己记一张 query → `{ cursor, nextOffset }` 的表做适配：

```js
let state = searchStates.get(query)
let cursor, consumed = 0
if (state && offset >= state.nextOffset) {
  cursor = state.cursor
  consumed = state.nextOffset
} else {
  searchStates.delete(query)
}
const page = await omni.searchSongs(query, { providerId, cursor, limit })
const drop = Math.max(0, offset - consumed)
const items = page.items.slice(drop).map(/* ... */)
searchStates.set(query, { cursor: page.nextCursor, nextOffset: consumed + page.items.length })
```

顺序翻页时直接复用游标；乱跳（比如用户直接跳到第 5 页）就从头重搜再切片。表超过 32 条淘汰最旧的。

搜索代理平台的选取逻辑也值得记一笔：从脚本支持的音源里挑第一个"宿主侧已配置且支持搜索"的内置平台。脚本支持 wy 但你根本没登录网易云？那就试试 kg、tx——按固定顺序降级，注册失败也不影响钩子模式。

## 七、已知限制

诚实清单，README 里都有：

- **首播慢几秒**：多链路解析的时间，10 分钟内重播秒开（缓存）
- **酷狗数字专辑 id 缺失**：部分脚本解不了无损
- **`tx` 的 `mediaMid`** 暂用 `songmid` 代替，个别脚本个别音质会失败
- **独立音源模式下歌词为空**：lx 音乐源脚本规范里只有 local 源提供 lyric；钩子模式歌词照常走内置音源
- **聚合类脚本掉到死链**：解析失败退到不做健康检查的 URL 模板，模板失效就没救了
- 仅 Electron 桌面端；Web/PWA 形态没有模组系统

## 八、怎么装

1. Folia 桌面版 0.7+，「设置 → 模组」开启模组系统
2. 从 [Releases](https://github.com/MuyuDada/folia-lx-source-bridge/releases) 下载 zip 拖进模组面板，启用
3. 导入你自己的 lx 脚本，二选一：
   - 命令面板执行「打开 LX 脚本目录」，脚本改名为 `source.js` 放进去（自动热重载）
   - 模组设置里填脚本下载地址，自动拉取

模组设置里可选音质档位，脚本不支持时自动降档。

---

代码在 [GitHub](https://github.com/MuyuDada/folia-lx-source-bridge)（MIT）。老规矩：本项目不含、不分发任何音源脚本，不下载不存储任何音频；你导入的脚本内容与用途由你自己负责。
