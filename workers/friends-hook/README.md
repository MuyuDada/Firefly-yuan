# 友链自助申请接收端

访客在友链页按弹窗里的模板留言 → Worker 解析出站点名称/描述/链接/头像 → 做反链检测 → 进待审队列 → 你在审核页点「通过」→ 复制生成的配置片段粘进 `src/config/friendsConfig.ts` → 重新部署上线。

评论进入 Worker 有**两条路，任选其一或都开**：

| 方式 | 触发时机 | 需要改外部配置吗 |
|---|---|---|
| **cron 轮询**（默认开启） | 每 15 分钟拉一次 Waline 友链页评论 | **不需要** —— 只靠 Worker 自己的 `triggers.crons` |
| **Waline WEBHOOK** | 评论创建后立刻推送 | 需要给 Waline 服务加 `WEBHOOK` 环境变量并重启 |

两条路可以并存：谁先到谁入库，后到的那条会因为 `app:<id>` 已存在而跳过，不会产生重复记录。轮询的代价是延迟最多一个 cron 周期。

**为什么是独立 Worker 而不是 Astro 动态路由**：本站是纯静态 SSG，一旦加入 `prerender = false` 的路由，构建产物会从扁平的 `dist/` 变成 `dist/client/` + `dist/server/` 双目录，`wrangler.jsonc` 的 `assets.directory`、`scripts/site-root.ts` 的探测逻辑、以及 Cloudflare 上的构建配置都要跟着改。而 Waline 的 WEBHOOK 只需要一个能收 POST 的 URL，不必与站点同域。独立 Worker 崩了也不影响博客。

---

## 一、前置条件

| 项 | 说明 |
|---|---|
| Cloudflare 账号 | 免费计划即可。KV 免费额度：读 10 万/天、写 1 千/天、存储 1 GB |
| Waline 服务 | 已部署且能改环境变量（本站是 `https://comment.muyudada.dpdns.org`） |
| Node.js ≥ 22 | `wrangler` 要求 |

---

## 二、部署步骤

### 1. 创建 KV namespace

```bash
cd workers/friends-hook
npx wrangler kv namespace create FRIENDS_KV
```

命令会输出一个 `id`，把它填进 `wrangler.jsonc` 的 `kv_namespaces[0].id`，替换掉 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`。

> 本地 `wrangler dev` 用的是 miniflare 模拟的 KV，不需要真实 id，但真机部署必须填对。

### 2. 设置管理口令

```bash
npx wrangler secret put ADMIN_TOKEN
```

输入一个足够长的随机串。这个口令用于访问审核页 `/admin` 和调用 `/admin/review`。**不要写进 `wrangler.jsonc`**（`vars` 里的内容会进 git）。

### 3. 核对 `wrangler.jsonc` 里的 `vars`

```jsonc
"vars": {
  "SITE_URL": "https://muyudada.dpdns.org",      // 本站地址，反链检测要找的就是这个 host
  "SITE_NAME": "Muyu の 小窝",                    // 仅用于审核页标题
  "APPLY_PATH": "/friends/",                      // 只处理发到这个路径的评论
  "WALINE_SERVER": "https://comment.muyudada.dpdns.org",  // 用于二次核验评论真实存在
  "VERIFY_COMMENT": "1",                          // "1" 开启核验，"0" 关闭
  "BACKLINK_TIMEOUT_MS": "8000"                   // 反链检测单路径超时
}
```

### 4. 部署

```bash
npx wrangler deploy -c wrangler.jsonc
```

> 和 `wrangler dev` 一样要显式 `-c wrangler.jsonc`，否则会撞上仓库根目录的 `.wrangler/deploy/config.json`。

部署成功会打印 Worker 地址与 cron 计划：

```
Uploaded firefly-friends-hook (3.75 sec)
Deployed firefly-friends-hook triggers (4.04 sec)
  friends-hook.muyudada.dpdns.org (custom domain)
  schedule: */15 * * * *
```

### 5. 验证

```bash
curl https://friends-hook.muyudada.dpdns.org/health
# → {"ok":true,"kv":true,"applyPath":"/friends/","time":"..."}
```

`kv: true` 表示 KV 绑定成功。

再手动触发一次轮询，立刻把已有的友链申请灌进队列（不用等 15 分钟）：

```bash
curl -X POST -H "x-admin-token: <你的 ADMIN_TOKEN>" \
  https://friends-hook.muyudada.dpdns.org/admin/poll
# → {"ok":true,"polled":true}
```

### 6. 自定义域（已配置，供参考）

Worker 绑的是自定义域 `friends-hook.muyudada.dpdns.org`，而不是默认的 `*.workers.dev`：

```jsonc
"routes": [
  { "pattern": "friends-hook.muyudada.dpdns.org", "custom_domain": true }
]
```

`custom_domain: true` 会让 wrangler 自动在该 zone 上建一条指向 Worker 的 DNS 记录并签发证书，不需要手工去 DNS 面板加 CNAME。

> **为什么不用 `*.workers.dev`**：`workers.dev` 在国内被 DNS 污染，必须挂代理才能访问 —— 审核页打不开、Waline 的 webhook 也推不过来。绑到自己的域上走的是正常解析。
>
> 代价：绑定自定义域后 **`workers_dev` 默认被关闭**（wrangler 会警告 `Because 'workers_dev' is not in your Wrangler file, it will be disabled`），原来的 `*.workers.dev` 地址会返回 404。想让两个地址都通，在 `wrangler.jsonc` 里显式加 `"workers_dev": true`。
>
> 前提：`muyudada.dpdns.org` 这个域必须已经托管在同一个 Cloudflare 账号下。该域有一条 `*.muyudada.dpdns.org` 通配 DNS 记录，所以任意子域都能解析到 Cloudflare，但**只有显式绑定的那个子域才指向 Worker**，其他子域仍是 404。

---

## 本站当前部署状态

已经部署好并在运行，无需重复以下步骤：

| 项 | 值 |
|---|---|
| Worker 地址 | `https://friends-hook.muyudada.dpdns.org`（自定义域） |
| KV namespace id | `f1def21c1578472abcd0691ca80ab953`（已写进 `wrangler.jsonc`） |
| cron | `*/15 * * * *` |
| 已入库 | 4 条待审（objectId 9 / 8 / 6 / 3），站长的两条「已添加」回复已正确过滤 |
| 未接线 | Waline 的 `WEBHOOK` 环境变量**没设** —— 现在完全靠 cron 轮询工作 |

也就是说：**访客照旧在友链页留言即可**，15 分钟内自动出现在审核页。想做到即时入库，再去 Vercel 给 Waline 加 `WEBHOOK`（见第三节方式 B）。

## 三、评论怎么进来

### 方式 A：cron 轮询（默认，无需任何外部配置）

`wrangler.jsonc` 里的 `triggers.crons` 是 `["*/15 * * * *"]`，Worker 每 15 分钟拉一次 Waline 的友链页评论，把 KV 里还没有的补进来。部署完就自动生效。

想立刻看到效果，不用等 cron：

```bash
curl -X POST https://friends-hook.muyudada.dpdns.org/admin/poll \
  -H "x-admin-token: <你的 ADMIN_TOKEN>"
```

> 轮询用 `pageSize=100`，只取 Waline 接口返回的第一页。友链页评论超过 100 条时，更早的申请不会再被自动补入（但已入库的记录不受影响）。真到那个量级再改成分页拉取即可。

### 方式 B：Waline WEBHOOK（即时推送）

在 Waline 服务的环境变量里加一条：

```
WEBHOOK=https://friends-hook.muyudada.dpdns.org/hook
```

Waline 会在**每次评论创建后**（不论最终审核状态）向这个地址发一条 POST。改完需要重启/重新部署 Waline 服务。这条只在 Waline 部署在 Vercel 等能改环境变量的平台上才可用。

> ⚠️ Waline 对 webhook 的调用是 `fetch(...).then(resp => resp.json())`，**没有超时、没有重试、不检查状态码**。所以：
> - 接收端必须返回**合法 JSON 体**（返回 204 或纯文本会让 Waline 侧抛错）；
> - 接收端必须**立刻返回**，慢活丢给 `ctx.waitUntil()`。本 Worker 已经这么做了（实测 `/hook` 响应 ~190ms，反链检测在后台跑）。
> - Waline 只有一个事件 `new_comment`，**没有**审核通过/注册等事件，也没有 URL 过滤 —— 过滤是在本 Worker 里按 `data.comment.url` 做的。
>
> 走 webhook 时，Worker 会回查 Waline 确认 `objectId` 真实存在（`VERIFY_COMMENT=1`），防止有人伪造请求打进来。轮询模式下这一步会跳过 —— 数据本来就是从 Waline 拉的。

---

## 四、日常使用

### 审核页

浏览器打开：

```
https://friends-hook.muyudada.dpdns.org/admin?token=<你的 ADMIN_TOKEN>
```

页面分三块：

1. **待审** — 每条显示解析出的字段、缺失字段标记、重复标记、反链检测结论、以及「未识别的行」和原始评论（便于人工核对）。点「通过」或「拒绝」。
2. **已通过 · 待粘进 friendsConfig.ts** — 一键复制生成的配置片段。
3. **已处理** — 已通过/已拒绝的记录。

> 带 token 的 URL 会进浏览器历史。介意的话改用请求头方式（`curl -H "x-admin-token: ..."`），或者看完就清一下历史。

### 上线一条友链

1. 审核页点「通过」；
2. 在「已通过」区点「复制片段」；
3. 打开 `src/config/friendsConfig.ts`，把片段粘进 `friendsConfig` 数组；
4. 重新部署博客。

> **为什么还要手工粘**：`friends.astro` 的友链数据是构建时读的静态数组（`getEnabledFriends()`），审核通过只写进了 KV，静态页面并不知道。要做到全自动，需要让前端在浏览器里 fetch `/api/links` 并合并进列表 —— 但卡片是服务端渲染的 HTML，还牵扯分页计数、标签筛选、搜索索引、延时徽章，客户端合并会很脏。手工粘一行是当前代价最小的闭环。

### 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/hook` | Waline WEBHOOK 接收端。立即返回 `{"ok":true,"id":"...","queued":true}` |
| GET | `/api/links` | 已通过的友链 JSON：`{"ok":true,"count":N,"data":[...]}` |
| GET | `/api/links?format=ts` | 同上，但输出可直接粘贴的 TS 配置片段 |
| GET | `/health` | 健康检查 |
| GET | `/admin?token=...` | 审核页 |
| POST | `/admin/review` | 审核动作，body `{"id":"...","action":"approve"\|"reject","note":"..."}` |
| POST | `/admin/poll` | 手动触发一次 Waline 轮询，不用等 cron |
| cron | `*/15 * * * *` | 自动轮询 Waline 友链页，把新评论补进队列 |

`/api/links` 与 `/hook` 带 `Access-Control-Allow-Origin: *`；`/admin*` 需要口令。

---

## 五、安全设计

| 风险 | 处置 |
|---|---|
| 有人伪造 webhook 打进来 | `VERIFY_COMMENT=1` 时，Worker 会回查 Waline 的 `/comment` 接口，确认这个 `objectId` 确实存在，否则丢弃 |
| 申请链接是 SSRF 跳板（探测内网） | `isSafePublicUrl()` 拦掉 `localhost`、`*.local`、`10.x`、`127.x`、`192.168.x`、`169.254.x`、`172.16-31.x` |
| 管理口令被计时侧信道猜解 | `safeEqual()` 常量时间比较 |
| 密钥泄漏 | `ADMIN_TOKEN` 走 `wrangler secret`；本地开发用 `.dev.vars`（已在 `.gitignore` 里） |
| 重复申请 | 按归一化后的 host 查重（去协议/`www`/端口/路径），审核页标「疑似重复」 |
| 字段不全就通过 | `approve` 时校验必填字段（站点名称/描述/链接/头像），缺一个就 400 |
| 只有链接、没有字段名的垃圾评论被当成申请 | 解析器仍会兜底抽出链接，但缺字段标记会让它在审核页显示为「缺字段」，且 `approve` 会被 400 挡住 |
| 站长自己的「已添加」回复被当成申请 | `rejectReason()`：`pid`/`rid` 非空（是回复）或 `type` 为 `administrator`/`author` 的评论一律跳过。webhook 与轮询两条路共用同一判据 |

> 反链检测只是**审核证据**，不是自动通过的门槛 —— 对方站点可能有 Cloudflare 拦截、JS 渲染或防盗链，抓不到不代表没放。最终由人判断。

---

## 六、本地开发

```bash
cd workers/friends-hook
npx tsc --noEmit                          # 类型检查
npx biome check src test-parse.ts         # 代码检查（从仓库根跑，用根 biome.json）
npx wrangler dev -c wrangler.jsonc        # 起本地服务，默认 http://127.0.0.1:8787
```

> 本目录**不在**根 `tsconfig.json` 的 `include` 里，也不在 `pnpm lint` / `pnpm format` / CI 的扫描范围内（它们只扫 `./src` 和 `./scripts`）。所以改完这里要自己跑上面两条命令。`biome.json` 的 `files.includes` 已排除 `**/.wrangler/**`，否则 wrangler 生成的临时 bundle 会报一堆无关错误。

**必须显式 `-c wrangler.jsonc`**。否则 wrangler 会同时看到仓库根目录的 `.wrangler/deploy/config.json` 和本目录的 `wrangler.jsonc`，报：

```
Found both a user configuration file at "wrangler.jsonc"
and a deploy configuration file at "..\..\.wrangler\deploy\config.json".
But these do not share the same base path so it is not clear which should be used.
```

本地变量可以直接用 `--var` 传，避免建 `.dev.vars`：

```bash
npx wrangler dev -c wrangler.jsonc --port 8787 \
  --var SITE_URL:https://muyudada.dpdns.org \
  --var APPLY_PATH:/friends/ \
  --var VERIFY_COMMENT:0 \
  --var BACKLINK_TIMEOUT_MS:8000 \
  --var ADMIN_TOKEN:test-token-123
```

### 解析器自测

```bash
npx tsx workers/friends-hook/test-parse.ts
```

拿线上真实的 6 条申请评论跑解析，检查字段是否被正确抽出。改 `src/parse.ts` 后务必重跑。

### 手工模拟一次 webhook

```bash
curl -X POST http://127.0.0.1:8787/hook \
  -H "content-type: application/json" \
  --data-binary @hook.json
```

`hook.json` 的形状：

```json
{
  "type": "new_comment",
  "data": {
    "comment": {
      "objectId": 93001,
      "comment": "站点名称：示例<br>站点描述：描述<br>站点链接：<a href=\"https://example.com\">https://example.com</a><br>头像链接：<a href=\"https://example.com/a.png\">https://example.com/a.png</a>",
      "nick": "tester",
      "url": "/friends/",
      "status": "approved",
      "insertedAt": "2026-10-14T12:00:00.000Z"
    }
  }
}
```

> 用 PowerShell 测试时注意：**必须把 JSON 写成 UTF-8 文件再用 `curl --data-binary @file`**。用 `Invoke-RestMethod -Body` 传含中文的字符串会因为编码问题导致中文全部丢失，看起来像解析器有 bug。

---

## 七、解析器说明

申请文本五花八门：全角/半角冒号、等号、英文键名、整段挤在一行、开头还写一句「申请友链」。所以 `src/parse.ts` 不用「逐行匹配」，而是**全文扫描字段锚点**：

1. 先找出所有「字段名 + 分隔符」的位置（字段名支持中英文别名，如 `站点名称`/`name`/`title`）；
2. 两个锚点之间的内容就是前一个字段的值 —— 单行和多行因此是同一条代码路径；
3. 剩下的、没被任何锚点覆盖的行作为「未识别行」保留，同时按内容特征兜底（含 URL 的当站点链接、含 `@` 的当邮箱）。

一条关键规则：**字段名要么在行首，要么后面必须跟 `:`/`=` 这类显式分隔符**。否则 `名称 Zhong Website` 里的行中单词 `Website` 会被认成 `siteurl` 标签，把站名截成 `Zhong`。

---

## 八、目录结构

```
workers/friends-hook/
├── package.json        依赖与脚本（wrangler / typescript）
├── tsconfig.json       独立于仓库根的 tsconfig
├── wrangler.jsonc      Worker 配置：KV 绑定 + vars
├── test-parse.ts       解析器自测（拿线上真实评论跑）
└── src/
    ├── index.ts        入口：路由、审核页、webhook 处理
    ├── parse.ts        评论 HTML → 结构化字段
    ├── store.ts        KV 读写（app: / dup: / link: 三种前缀）
    ├── backlink.ts     反链检测 + SSRF 防护
    ├── types.ts        共享类型
    └── runtime.d.ts    Workers 运行时类型的最小声明
```

`runtime.d.ts` 是自己写的，没用 `@cloudflare/workers-types` —— 本目录不在根 `tsconfig.json` 的 `include` 里（只有 `src/**` + `scripts/**`），为一个 Worker 单独装一整个类型包、再拉一份 `node_modules` 不划算。这里只声明实际用到的几个 API。
