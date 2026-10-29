# 友链自助申请接收端

访客在友链页有两种申请方式，**推荐用表单**：

| 申请方式 | 访客体验 | 后端路径 |
|---|---|---|
| **站内表单**（推荐） | 弹窗里点「已添加，去填写申请」→ 填表 → 提交，页面内完成 | `GET /captcha` 取算术题 → `POST /apply` |
| 评论区留言（旧方式，仍可用） | 复制弹窗里的模板 → 贴到评论区 | `POST /hook`（webhook）或 cron 轮询 |

两条路的产物是同一种 `FriendApplication`，都进同一个待审队列，审核页、`/api/links`、审核动作完全共用。你在审核页点「通过」→ 复制生成的配置片段粘进 `src/config/friendsConfig.ts` → 重新部署上线。

评论进入 Worker 有**两条路，任选其一或都开**：

| 方式 | 触发时机 | 需要改外部配置吗 |
|---|---|---|
| **cron 轮询**（默认开启） | 每 15 分钟拉一次 Waline 友链页评论 | **不需要** —— 只靠 Worker 自己的 `triggers.crons` |
| **Waline WEBHOOK** | 评论创建后立刻推送 | 需要给 Waline 服务加 `WEBHOOK` 环境变量并重启 |

两条路可以并存：谁先到谁入库，后到的那条会因为 `app:<id>` 已存在而跳过，不会产生重复记录。轮询的代价是延迟最多一个 cron 周期。**站内表单不受这两条路影响** —— 它直接 POST 到 `/apply`，即时入库。

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
  "BACKLINK_TIMEOUT_MS": "8000",                  // 反链检测单路径超时
  "ENABLE_FORM": "1",                             // 站内表单开关，"0" 关闭
  "CAPTCHA_PER_DAY": "30",                        // 单 IP 每天最多领几道验证码
  "APPLY_PER_DAY": "5"                            // 单 IP 每天最多提交几次申请
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
| 前端接线 | `src/config/friendsConfig.ts` 的 `friendsPageConfig.applyApi` 指向本 Worker，弹窗已切换为三步向导 + 表单 |
| 未接线 | Waline 的 `WEBHOOK` 环境变量**没设** —— 评论区那条路完全靠 cron 轮询工作 |

也就是说：**访客直接在友链页弹窗里填表提交即可**，立刻进待审队列。评论区留言也仍然有效，15 分钟内自动出现在审核页。想做到即时入库，再去 Vercel 给 Waline 加 `WEBHOOK`（见第三节方式 B）。

## 三、申请怎么进来

### 方式 A：站内表单（推荐，无需任何外部配置）

友链页弹窗的第三步是一个真实表单，提交时打两个接口：

1. `GET /captcha` → `{"ok":true,"id":"...","question":"6 + 7 = ?"}`
2. `POST /apply` → body 见下，成功返回 `{"ok":true,"id":"form-...","message":"..."}`

```jsonc
{
  "siteName": "我的博客",           // 必填，≤40 字
  "siteUrl": "https://example.com", // 必填，≤240，必须 http(s)
  "avatarUrl": "https://.../a.png", // 必填，≤300，必须 http(s)
  "contactEmail": "hi@example.com", // 可选，≤254
  "description": "一句话简介",       // 必填，≤120 字
  "captchaId": "...",               // 必填，来自 /captcha
  "captchaAnswer": "13",            // 必填
  "company": ""                     // 蜜罐，正常用户永远留空
}
```

前端开关是 `src/config/friendsConfig.ts` 的 `friendsPageConfig.applyApi`：填了 Worker 地址就启用向导，留空则退回旧的「复制模板 → 评论区留言」流程。

### 方式 B：cron 轮询（默认，无需任何外部配置）

`wrangler.jsonc` 里的 `triggers.crons` 是 `["*/15 * * * *"]`，Worker 每 15 分钟拉一次 Waline 的友链页评论，把 KV 里还没有的补进来。部署完就自动生效。

想立刻看到效果，不用等 cron：

```bash
curl -X POST https://friends-hook.muyudada.dpdns.org/admin/poll \
  -H "x-admin-token: <你的 ADMIN_TOKEN>"
```

> 轮询用 `pageSize=100`，只取 Waline 接口返回的第一页。友链页评论超过 100 条时，更早的申请不会再被自动补入（但已入库的记录不受影响）。真到那个量级再改成分页拉取即可。

> ⚠️ **当前环境下轮询实际取不到数据**：它和「自动回复」是同一个出站问题 —— Worker 访问
> `comment.muyudada.dpdns.org`（同 zone 橙云 + Vercel 源站）会被 Cloudflare 返回
> `400 / error code 1053`。所以现在**靠 WEBHOOK（方式 C）入库**，轮询形同虚设。
> 想恢复轮询，把该子域的橙云改成 DNS only 即可；或者让 Worker 改用域名没有经过 CF 代理的地址。

### 方式 C：Waline WEBHOOK（即时推送）

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

页面是一张单页看板，全部卡片一次渲染完，靠前端过滤切换：

- **顶栏**：站点名 + 四个统计胶囊（待审 / 已通过 / 已拒绝 / 全部），数字实时反映当前队列。
- **工具条**：四个 tab 做状态过滤（默认停在「待审」），右侧搜索框按站名 / 域名 / 邮箱 / 简介 / 备注 / 记录 id 实时筛选；搜不到时显示空态提示。
- **卡片**：头像（抓不到就显示站名首字）、站名、域名、状态徽章、简介、元信息行（记录 id、来源、时间、邮箱）、快捷链接（访问站点 / 查看头像 / 写邮件 / 检测地址）、反链检测结论、折叠的「原始内容」。
  - 待审卡片：`通过` / `拒绝` + 备注输入框，以及反链徽章（已找到 / 检测中 / 未确认）
  - 已处理卡片：徽章只保留上线状态（已上线 / 待上线 / 状态未知），不再挂反链徽章 —— 都审完了还提示「反链未确认」纯属噪音
  - 每张卡片都有 `重新检测反链`（对方后来才补上链接时用）和 `删除`（连同 `link:` / `dup:` / `pend:` 关联键一起清掉，需二次确认）
- **待上线**：已通过但**还没写进 `friendsConfig`** 的记录，一条一行，每行显示头像、站名、域名、通过时间和审核备注，右侧有独立的「复制」按钮；标题栏还有「复制全部」一次性复制整段配置。
- **已上线**：已通过**且线上友链页已经能看到**的记录，只做展示，不提供复制按钮。

> 「待上线 / 已上线」是抓一次线上友链页判断出来的（页面里出现该域名即视为已上线）。抓不到页面时退化成「状态未知」，不会谎报成待上线。
- 深色模式跟随系统；窄屏下 tab 横向可滚、按钮撑满整行。
- 审核动作是 fetch 打 `/admin/review`，成功后卡片淡出并刷新页面（刷新前把滚动位置存进 `sessionStorage`，回来还在原位）。

> 带 token 的 URL 会进浏览器历史。介意的话改用请求头方式（`curl -H "x-admin-token: ..."`），或者看完就清一下历史。

### 上线一条友链

1. 审核页点「通过」；
2. 在「待上线」区找到那一条，点它右侧的「复制」（或点标题栏的「复制全部」）；
3. 打开 `src/config/friendsConfig.ts`，把片段粘进 `friendsConfig` 数组；
4. 重新部署博客。

> 生成的条目 `tags` 固定给 `"Blog"`：`FriendCard.astro` 的 `TAG_LABELS` 只映射 Blog / Docs / Home / Framework 四个，未命中的 tag 会原样显示英文。

> **为什么还要手工粘**：`friends.astro` 的友链数据是构建时读的静态数组（`getEnabledFriends()`），审核通过只写进了 KV，静态页面并不知道。要做到全自动，需要让前端在浏览器里 fetch `/api/links` 并合并进列表 —— 但卡片是服务端渲染的 HTML，还牵扯分页计数、标签筛选、搜索索引、延时徽章，客户端合并会很脏。手工粘一行是当前代价最小的闭环。

### 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/captcha` | 出一道具算术题，给站内表单用。返回 `{"ok":true,"id":"...","question":"6 + 7 = ?"}` |
| POST | `/apply` | 站内表单直接提交。返回 `{"ok":true,"id":"form-...","message":"..."}` |
| POST | `/hook` | Waline WEBHOOK 接收端。立即返回 `{"ok":true,"id":"...","queued":true}` |
| GET | `/api/links` | 已通过的友链 JSON：`{"ok":true,"count":N,"data":[...]}` |
| GET | `/api/links?format=ts` | 同上，但输出可直接粘贴的 TS 配置片段 |
| GET | `/health` | 健康检查 |
| GET | `/admin?token=...` | 审核页 |
| POST | `/admin/review` | 审核动作，body `{"id":"...","action":"approve"\|"reject","note":"..."}`。响应里带 `reply`，由页面负责发给 Waline |
| POST | `/admin/backlink` | 重新检测某条申请的反链，body `{"id":"..."}`，结果写回 KV |
| POST | `/admin/delete` | 彻底删除一条申请及其 `link:` / `dup:` / `pend:` 关联键，body `{"id":"..."}` |
| POST | `/admin/poll` | 手动触发一次 Waline 轮询，不用等 cron |
| cron | `*/15 * * * *` | 自动轮询 Waline 友链页，把新评论补进队列 |

`/captcha`、`/apply`、`/api/links` 与 `/hook` 带 `Access-Control-Allow-Origin: *`（前两个要跨域，因为博客站与 Worker 不同域）；`/admin*` 需要口令。

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
| 脚本刷 `/apply` 把审核页塞满 | 算术验证码（`GET /captcha`，答案存 KV 带 300 秒 TTL，**用一次即删**）+ 蜜罐字段 `company` + 单 IP 每日限额（`CAPTCHA_PER_DAY` / `APPLY_PER_DAY`） |
| 有人在链接里塞 `javascript:` / `data:` | `validateApply()` 的 `isHttpUrl()` 只放行 `http:`/`https:`，否则会被原样渲染进友链卡片的 `href` |
| 表单提交绕过了「评论必须真实存在」的核验 | 表单不走 Waline，因此没有 `VERIFY_COMMENT` 回查 —— 它靠验证码 + 限额代替。反链检测照常做，结果作为审核证据 |
| 同一站点连投两次 | `saveApplication()` 会写 `pend:<host>` 待审索引，`findDuplicate()` 先查已通过的 `dup:` 再查 `pend:`。表单路径下若命中的是**已通过**记录，直接 409 回绝 |

> 反链检测只是**审核证据**，不是自动通过的门槛 —— 对方站点可能有 Cloudflare 拦截、JS 渲染或防盗链，抓不到不代表没放。最终由人判断。

---

## 六、本地开发

```bash
cd workers/friends-hook
npx tsc --noEmit                          # 类型检查
npx biome check src test-parse.ts cdp-admin-test.mjs cdp-friends-test.mjs  # 代码检查（从仓库根跑，用根 biome.json）
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

### 浏览器端到端测试（表单向导）

```bash
# 先起两个服务：Worker（8797）与 Astro dev（4401）
npx wrangler dev -c wrangler.jsonc --port 8797 \
  --var ADMIN_TOKEN:test-token-123 --var VERIFY_COMMENT:0 \
  --var BACKLINK_TIMEOUT_MS:2000 --var CAPTCHA_PER_DAY:500 --var APPLY_PER_DAY:500

# 另开一个终端，在仓库根跑 pnpm dev --port 4401

# 然后跑 CDP 测试（需要本机 Chrome）
node workers/friends-hook/cdp-friends-test.mjs \
  "http://localhost:4401/friends/" "http://127.0.0.1:8797"
```

`cdp-friends-test.mjs` 用 Chrome DevTools Protocol 驱动一个无头浏览器，覆盖 21 项断言：向导三步切换、步骤指示高亮、按钮显隐、验证码取题、答错提示、失败后自动换题、重新作答成功进成功页、关闭按钮与滚动锁、以及页面无控制台错误。

> 它会在文档脚本执行前给 `window.fetch` 打补丁，把 `https://friends-hook.muyudada.dpdns.org` 重写到本地 Worker 地址 —— 因为 `data-apply-api` 是在 `boot()` 时读进闭包的，事后改 DOM 属性来不及。所以本地测试不需要改 `friendsConfig.ts`。
>
> 弹窗打开时 `[data-modal-root]` 会被搬到 `document.body` 上（`#content-wrapper` 的 `transform` 会成为 `position:fixed` 的包含块），所以测试里凡是弹窗内部的元素都要用 `[data-modal-root] ...` 打头选择器。

### 浏览器端到端测试（审核页）

```bash
# 起 Worker，用宽松限额以便反复灌测试数据
npx wrangler dev -c wrangler.jsonc --port 8795 \
  --var ADMIN_TOKEN:test-token-123 --var VERIFY_COMMENT:0 \
  --var BACKLINK_TIMEOUT_MS:2000

# 然后跑（需要本机 Chrome）
node workers/friends-hook/cdp-admin-test.mjs \
  "http://127.0.0.1:8795/admin?token=test-token-123" "$env:TEMP\admin.png"
```

`cdp-admin-test.mjs` 用 CDP 驱动无头 Chrome，覆盖 22 项断言：标题与统计、四个 tab 的过滤与高亮、默认停在「待审」、卡片内容（域名而非完整 URL、反链结论、待审才有操作按钮、已处理无按钮）、搜索命中与空态、配置片段区、深色模式、窄屏无横向溢出、以及无控制台报错。它同时输出桌面与移动端两张截图（第二个参数是桌面截图路径，移动端自动加 `-mobile` 后缀）。

> 队列为空时先灌几条测试数据：`GET /captcha` 拿题 → 算出答案 → `POST /apply`。注意 PowerShell 直接传含中文的 JSON 会丢字，要写成 UTF-8 文件再用 `curl --data-binary @file`。

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
├── package.json         依赖与脚本（wrangler / typescript）
├── tsconfig.json        独立于仓库根的 tsconfig
├── wrangler.jsonc       Worker 配置：KV 绑定 + vars
├── test-parse.ts        解析器自测（拿线上真实评论跑）
├── cdp-friends-test.mjs 友链页表单向导的浏览器端到端测试（CDP 驱动无头 Chrome）
├── cdp-admin-test.mjs   审核页的浏览器端到端测试（筛选 / 搜索 / 深色模式 / 窄屏）
└── src/
    ├── index.ts         入口：路由、审核页、webhook 处理、表单接收
    ├── parse.ts         评论 HTML → 结构化字段
    ├── form.ts          表单载荷校验（必填、长度、http(s) 协议、蜜罐）
    ├── captcha.ts       算术验证码：出题 / 存 KV / 一次性校验
    ├── rate.ts          按 IP 的每日限额（验证码 30 次、申请 5 次）
    ├── store.ts         KV 读写（app: / dup: / pend: / link: 四种前缀）
    ├── backlink.ts      反链检测 + SSRF 防护
    ├── mail.ts          邮件通知（新申请 / 审核结果），双通道
    ├── waline.ts        审核后替博主回复评论，借 Waline 的发信能力
    ├── types.ts         共享类型
    └── runtime.d.ts     Workers 运行时类型的最小声明
```

`runtime.d.ts` 是自己写的，没用 `@cloudflare/workers-types` —— 本目录不在根 `tsconfig.json` 的 `include` 里（只有 `src/**` + `scripts/**`），为一个 Worker 单独装一整个类型包、再拉一份 `node_modules` 不划算。这里只声明实际用到的几个 API。

## 九、为什么用算术验证码而不是 Turnstile

Turnstile 要嵌一段 Cloudflare 的脚本、再配 sitekey/secret 两处，而本 Worker 本来就跑在 Cloudflare 上、申请量是个人博客量级 —— 一道「6 + 7 = ?」已经能挡掉绝大多数无脑脚本，成本接近零。

代价是挡不住**专门针对本站写的**脚本。真被盯上了再换成 Turnstile：`captcha.ts` 只有出题与校验两个函数，替换掉它们、把前端那个 `<img>` 换成 widget 即可，其余流程不用动。

## 十、通知

分两条完全独立的通道，**优先用评论系统，配不上再退回邮件**：

### 通道一：借 Waline 的评论回复（默认开启，零额外成本）

Waline 只有两个发信触发点 —— 新评论通知博主、回复通知被回复者，没有「给任意地址发信」的接口。所以想复用它已经配好的 SMTP，办法只有：**审核时替博主去申请人那条留言下面回一句**，由 Waline 自己发「你被回复了」的邮件。

| 场景 | 谁发 | 结果 |
|---|---|---|
| 访客在友链页留言申请 | Waline 自己 | 你会收到新评论通知（这套本来就有，不用配） |
| 审核页点「通过 / 拒绝」 | **审核页的浏览器**直接 POST 到 Waline | 申请人收到回复通知 |

> **为什么回复由浏览器发、而不是 Worker 发**：`comment.muyudada.dpdns.org` 在本 zone 下是橙云代理、源站在 Vercel，
> Worker 出站访问这类「同 zone + 外部源站」的地址会被 Cloudflare 挡回 `400 / error code: 1053`
> （同 zone 但源站在 Cloudflare 自家就没事，比如博客本体）。而浏览器走 CF 代理完全正常。
> 所以 `/admin/review` 只负责算好请求体（`reply` 字段），由审核页 JS 发出去。
> 副作用：这一步依赖审核页处于打开状态——点按钮时它本来就是开着的，不影响使用。

相关变量：

| 变量 | 说明 |
|---|---|
| `ENABLE_WALINE_REPLY` | `"0"` 关闭自动回复 |
| `WALINE_REPLY_NICK` | 回复用的昵称，默认「友链助手」 |
| `ADMIN_EMAIL` | 同时作为回复者的邮箱（Waline 据此判定是博主本人，避免再给自己发通知） |

**三个已知限制**：

1. **只对评论留言方式的申请有效**。站内表单提交的申请 id 形如 `form-xxxxxxxx`，没有可回复的父评论，会直接跳过。
2. **申请人必须留了邮箱**，否则 Waline 没有收件人可发。为此站点的评论框已经要求昵称和邮箱都必填
   （`src/config/commentConfig.ts` 的 `waline.requiredMeta`）。
3. **回复是公开的**，会出现在友链页评论区。好处是访客能直接看到「已收录」。

如果 Waline 服务端设了 `LOGIN=force`（强制登录才能评论），匿名 POST 会失败，此时会自动退化到下面的邮件通道。

### 通道二：Worker 自己发邮件（可选，**当前未启用**）

> 下面这套需要额外接一个发信服务（Resend）或升级 Workers Paid 用 Cloudflare 原生发信。
> 目前本站没启用，只走通道一。整段可以先跳过，等真要给**表单申请**也发通知时再回来看。

| 邮件 | 收件人 | 触发点 |
|---|---|---|
| 新申请通知 | `ADMIN_EMAIL` | 申请入库后（表单申请会等反链检测出结果再发，邮件里直接带检测结论） |
| 审核结果通知 | 申请里填的邮箱 | 审核页点「通过」或「拒绝」后，**且评论回复没走通时** |

申请人**没填邮箱就无法收到结果通知**，这是他自己的选择，Worker 侧不做补救。

#### 发信通道

两条路二选一，都配了优先用 Resend：

| 通道 | 需要的配置 | 说明 |
|---|---|---|
| **Resend**（推荐） | `wrangler secret put RESEND_API_KEY` | 免费额度每天 100 封，个人博客够用 |
| **Cloudflare 原生** | 打开 `wrangler.jsonc` 里的 `send_email` 绑定 | 不引入第三方，需先把域名接入 Email Service |

两条路都要求 **`MAIL_FROM` 填的是已校验的域名**，否则会被拒信：

```jsonc
"MAIL_FROM": "Muyu 小窝 <noreply@muyudada.dpdns.org>"
```

用 Resend 时去后台 Domains 添加 `muyudada.dpdns.org`，按提示加 TXT / CNAME 记录（SPF、DKIM），状态变绿才算校验通过。**从 QQ 邮箱直接当发件人是不可行的** —— 发件域必须归你控制，否则 SPF 校验过不去，邮件会直接进垃圾箱或被退。

### 变量一览

| 变量 | 作用 |
|---|---|
| `ADMIN_EMAIL` | 新申请通知收件人 |
| `MAIL_FROM` | 发件地址，留空则完全不发信 |
| `ADMIN_URL` | 邮件里「去审核」按钮的跳转地址 |
| `NOTIFY_ON_APPLY` | `"0"` 关闭新申请通知 |
| `NOTIFY_ON_REVIEW` | `"0"` 关闭审核结果通知 |
| `RESEND_API_KEY` | Resend 密钥，用 `wrangler secret put` 设置，别写进 `vars` |

`vars` 里的值改了要重新 `wrangler deploy`；`secret` 是即时生效的。

### 验证

```bash
curl -s https://friends-hook.muyudada.dpdns.org/health | jq
```

关注三个字段：`mail`（邮件通道是否就绪）、`channel`（`resend` / `cloudflare` / `none`）、`walineReply`（是否开启评论回复）。

要端到端测一次，最简单是用站内表单提交一条**自己邮箱**的申请，看博主邮箱是否收到；再在审核页点「通过」，看申请人邮箱是否收到。

### 失败时不会卡住流程

`mail.ts` 里所有发送函数都吞掉异常、只打日志。发信挂了，申请照样入库、审核照样生效，`wrangler tail` 里能看到原因：

```
[friends-hook] Resend 发信失败 403：{"message":"The gmail.com domain is not verified..."}
```

这条日志说明 `MAIL_FROM` 用了没校验的域名，是最常见的失败原因。
