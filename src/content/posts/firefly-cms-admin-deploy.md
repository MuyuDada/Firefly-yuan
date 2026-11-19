---
title: "把 Firefly 博客接上可视化后台：Cloudflare Pages 部署与适配实录"
published: 2026-11-18
draft: false
pinned: false
description: "给自己的 Astro 静态博客接一套可视化后台：从 fork、改 wrangler 配置、建 Cloudflare Pages 项目，到四个 secret 的坑、GitHub Fine-grained PAT 的权限边界，再到把原作者写死的配置表单改成自己仓库真实结构（31 个配置文件、4 个表单、58 个字段），以及友链保存如何不写丢 recommended 这类额外字段。"
image: "api"
tags:
  - Cloudflare Pages
  - Astro
  - GitHub API
  - 博客后台
category: "自建服务"
aiSummary: "本文记录了给 Firefly（Astro）博客接入 firefly-cms 可视化管理后台的全过程。后台是 Cloudflare Pages + Pages Functions + GitHub Contents API 的组合，不需要数据库：写文章本质上是往仓库提交 Markdown。部署阶段踩了三个坑：Pages 的 secret 改完必须重新部署才生效、GitHub PAT 必须用 Fine-grained 且只给目标仓库 Contents 读写、fork 里的 wrangler.toml 还写着作者自己的仓库名。适配阶段把原作者按自己配置写死的表单，改成博客仓库真实的 31 个配置文件与 4 个表单 58 个字段，并重写了友链保存逻辑——原来整组重写会丢失 recommended、previewurl 等额外字段，改成按 siteurl 精确匹配后只替换改动项。"
---

静态博客写久了都会遇到同一个问题：想发篇文章，得打开编辑器、找到 `src/content/posts`、复制一篇旧文章改 frontmatter、写内容、commit、push。偶尔在地铁上想记点东西，这套流程基本劝退。

所以这周给自己的博客接了一套可视化后台。后台不是自己写的，是 [firefly-cms](https://github.com/VTESLEK/firefly-cms) 这个开源项目——专门给 Firefly 主题配套的管理面板。这篇把从部署到真正好用的全过程写下来，包括那段"看起来能用、实际会写坏数据"的适配工作。

## 一、先搞清楚它是什么架构

很多人以为"后台"意味着要有个服务器和数据库。这套东西不是。

```
浏览器 → Cloudflare Pages（静态前端 + Functions）
                    ↓
          GitHub Contents API
                    ↓
       你的博客仓库（Markdown 文件）
```

核心就一句话：**后台不存数据，它只是一个更好用的 Git 客户端**。你在面板里"新建文章"，后端实际做的是调用 GitHub API，在 `src/content/posts/` 下创建一个 `.md` 文件并 commit。博客那边照常走原来的构建流水线，该多久发布还是多久。

这个设计对我来说非常合适：

- 没有数据库，不用备份，不用维护
- 所有内容仍然是纯文本 + Git，随时可以 `git log` 回溯
- 后台挂了不影响博客，博客挂了后台也没意义（但至少数据都在）

技术栈是 Cloudflare Pages Functions（跑在边缘的轻量后端）+ 原生 JS 前端 + Vue 3（只用了 CDN 版本）。登录态用了自己的签名 token，密码存在环境变量里。

## 二、部署：四个 secret 和三个坑

流程本身不复杂：

1. fork 仓库
2. 改 `wrangler.toml`，把对接的仓库指向自己
3. 建 Pages 项目
4. 写入环境变量
5. 部署

### 坑一：改了 secret 不重新部署，等于没改

我第一次配好密码后兴冲冲去登录，接口一直报"缺少环境变量"。

原因是 Pages 的 Functions 环境变量虽然能在控制台随时改，但**已经部署的那一版 Function 不会自动拿到新值**。必须重新触发一次部署：

```bash
npx wrangler pages deploy --commit-dirty=true
```

这个坑很隐蔽，因为控制台里明明显示变量已存在，日志却一直说没配。后来养成习惯：**每次改 secret，都跟一次 deploy**。

### 坑二：GitHub PAT 的权限不是"越大越好"

后台要往仓库提交文件，所以需要一个 GitHub Token。这里有两个选项：

| 类型 | 问题 |
|---|---|
| Classic Token | 权限是账户级的，`repo` 一勾就等于全仓库可写 |
| Fine-grained Token | 可以限定到单个仓库、单个权限项 |

选 Fine-grained，配置要点：

- **Repository access** → Only select repositories → 只勾博客仓库
- **Permissions** → Repository permissions → 只开 `Contents: Read and write`
- 其它全部保持 No access

这样即使 token 泄漏，攻击者也只能动这一个仓库的内容，碰不了账号和其它项目。

顺带一个真实教训：这个 token **只能动博客仓库**，动不了后台自己的仓库。我当时想顺手用同一个 token 去改 fork 里的 `wrangler.toml`，直接被 403 拒了——这是对的，权限就该这么窄。要改后台仓库，得在本地 commit 再 push。

### 坑三：fork 里的 `wrangler.toml` 还写着作者的仓库

`wrangler.toml` 里原本是这样：

```toml
[vars]
GITHUB_OWNER = "VTESLEK"
GITHUB_REPO = "my-blog"
GITHUB_BRANCH = "master"
```

不改的话，后台会把文章提交到**原作者**的仓库里。这个必须改成自己的。

这里还有个隐藏风险：如果将来把 Pages 项目改成"连接 Git 仓库自动构建"，Cloudflare 会读仓库里的 `wrangler.toml`，把变量覆盖回作者那份。所以**改完一定要提交推送**，不能只在本地改。

最终的 secret 清单（值放在 Cloudflare，不写进仓库）：

| 名称 | 用途 |
|---|---|
| `ACCESS_PASSWORD` | 后台登录密码 |
| `GITHUB_TOKEN` | 提交内容用 |
| `IMGHUB_BASE` | 图床地址 |
| `IMGHUB_TOKEN` | 图床上传鉴权 |

## 三、真正的工作量：适配自己的仓库

部署完能登录了，但打开"站点配置"会发现大部分表单是坏的。因为原作者的 `config-forms.js` 是照着他自己那套配置写的，字段路径和我的仓库对不上。

举几个具体的不匹配：

| 表单期望 | 我的仓库实际 |
|---|---|
| `siteConfig.pages.home` 直接是对象 | `pages` 由 `resolvePageToggles()` 生成，是独立常量 |
| `siteConfig.postsPerPage` | 实际在 `siteConfig.pagination.postsPerPage` |
| `siteConfig.showLastModified` | 实际在 `siteConfig.post.post.showLastModified` |
| `homeConfig.ts` | 仓库里根本没这个文件，首页信息在 `profileConfig.ts` |

如果只是"读不到"，顶多是显示空白。但**保存时更危险**：表单按错误路径写回，可能把原本的结构改坏。

所以这部分基本重写了：

- **白名单**从 21 个文件改成仓库真实的 **31 个配置文件**，逐个核对，一个不多一个不少
- **表单**重做为 4 个：站点信息（39 项）、个人信息、评论、公告
- 每个字段都验证了"可定位 + 未改动保存零 diff"

验证方法是写了个小脚本，把仓库里真实文件读出来，走一遍 `extract → apply`，比对输出和输入是否完全一致。58 个字段全部零 diff 才算过。

### 友链那里藏着一个会写丢数据的坑

这块最值得说。

原来的实现对友链是这么处理的：读出几条固定字段（title、siteurl、avatar……），编辑完**把整个数组重新序列化写回**。

而我的 `friendsConfig.ts` 里有这些东西：

```ts
{
  title: "...",
  siteurl: "...",
  avatar: "...",
  recommended: true,
  recommendedTheme: "silver",
  previewurl: "https://...",
},
```

还有数组末尾一整段被注释掉的模板条目。

按原逻辑保存一次，`recommended`、`recommendedTheme`、`previewurl` 全部消失，注释块也被吃掉。这种 bug 不会报错，只会在某天你发现"推荐位怎么空了"。

改成：**按 `siteurl` 匹配，只替换真正改动的那一条**，未改动的条目原样回写（连行内注释都保留）。

测试写了 13 项断言：未改动零 diff、改一条只重写一条、额外字段保留、注释条目保留、增删改都正常。

## 四、登录页：从白色卡片到会躲猫猫的角色

后台默认登录页是一张很朴素的白色卡片。后来参考 [animatedlogin](https://github.com/guohaolian/animatedlogin) 重做了一版：左侧是四个角色，会跟着鼠标看、随机眨眼、输密码时转头回避、点显示密码时紫色那只偷偷瞄回来、登录失败还会摇头。

这部分纯 CSS + JS，没引入动画库。配色跟着后台的明暗主题走：暗色是深蓝紫渐变，亮色是浅紫灰渐变。

细节上有个坑：角色是用 SVG 画的，初始定位如果按"铺满容器"来做，一缩放就会把左下角链接压住。最后改成和参考页一样的结构——logo、420px 高的舞台、页脚三段用 `space-between` 排，舞台底部对齐，这样任何高度都不会互相挤压。

## 五、两个让日常好用的改动

### 封面：能贴外链，也能随机

原来封面只有一个"上传"按钮，连输入框都没有，所以既贴不了外链也选不了随机图。

改成：

- 输入框直接粘贴 URL（图床链接、相对路径都行），右侧保留上传按钮
- 一个「随机封面 API」按钮，写入 `image: "api"`

后者是博客本身支持的约定：构建时从配置里那几个图 API 随机取一张。代价是**每次重新构建封面可能变**，这是特性不是 bug，接受不了就用固定图。

### 上传图片自动转 WebP

图床不会帮你转格式，png 传上去还是 png。所以改成上传前在浏览器里先转：

- jpg / png / bmp → WebP，质量 0.86
- 长边超过 2560px 等比缩小
- **GIF / SVG / WebP / AVIF 原样上传**（GIF 转了丢动画，SVG 转了丢矢量）
- 兜底：转完反而更大，或浏览器不支持 WebP 编码，就保留原图，避免出现"后缀 webp 内容是 png"

用噪声图实测（最坏情况）：

| 原图 | 结果 |
|---|---|
| 3000×1600 JPG 4101KB | WebP **2109KB**（-49%） |
| 1200×800 PNG 3215KB | WebP **716KB**（-78%） |
| GIF / SVG | 原样保留 |

真实照片压缩率通常比这还高。

这三个参数（开关、质量、最大边长）后来做进了设置抽屉，存在 localStorage 里，每个浏览器各自一份。

## 六、现在的状态

后台已经稳定用了几天，日常流程变成：手机或公司电脑打开网页 → 登录 → 写 → 保存。文章直接 commit 到仓库，博客那边自动构建。

回头看，这套东西的价值不在于"有个后台"，而在于：

1. **写作和发布解耦了**。不用本地起环境，不用记得 git 命令
2. **配置也能改**。改个站名、开关某个页面、加条友链，不用翻代码
3. **数据仍然是 Git**。随时能 `git log` 看谁在什么时候改了什么

要说遗憾，就是适配那部分工作量远超预期——原作者的表单是按他自己的仓库写的，换一个仓库就得重新对一遍字段路径。如果你也想接，建议先花十分钟把自己的 `src/config` 目录列一遍，再动手改表单，比改到一半发现字段对不上要省事得多。

下一篇写这套后台配合的另一件事：怎么在文章里放 iOS 实况照片。
