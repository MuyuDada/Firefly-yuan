---
title: 'OpenList 搭建、使用与美化：从零做一个自己的私人网盘'
slug: 'openlist-guide'
published: 2026-10-05
description: '从 AList 信任危机讲起，完整记录 OpenList 的部署（Docker / 一键脚本 / 二进制）、后台设置与存储挂载，再到源码级的自定义头部注入机制，以及一套可复用的毛玻璃美化配方 —— 含背景图、字体、评论、音乐播放器、光标特效与 7 个真实踩坑。'
image: api
category: 自建服务
tags: [OpenList, Docker, 美化]
draft: false
pinned: false
---

一直想把散落在各家网盘里的文件收拢到一个入口。AList 是这个领域最成熟的方案，但 2025 年年中它的仓库发生了一连串变化，社区里冒出了 OpenList 这个分叉。

我自己搭了一个Openlist，从部署、挂载、到把前端改得完全不像原版，前后折腾了不少。这篇把整个过程写下来：**怎么搭、怎么用、怎么美化**，最后是七个真实踩到的坑。

## 一、先看效果

美化前后的差别是这样的 —— 下面是同一个实例的完整首页，左边亮色、右边暗色：

![OpenList 首页 · 亮色](https://muyuimg.cc.cd/file/blog/iOcKOqh3.webp)

![OpenList 首页 · 暗色](https://muyuimg.cc.cd/file/blog/H5vMkVeL.webp)

拆开看，readme 区（列表下方那一大块）是这样的：

![readme 区 · 亮色](https://muyuimg.cc.cd/file/blog/a9oSZSkf.webp)

![readme 区 · 暗色](https://muyuimg.cc.cd/file/blog/MeVWVizW.webp)

最底下的评论区：

![评论区](https://muyuimg.cc.cd/file/blog/tI9UbkTj.webp)

对照原版，主要改动了这些：

| 能力 | 原版 | 美化后 |
| --- | --- | --- |
| 背景 | 纯色 | 亮/暗两套全屏背景图（`background-attachment: fixed`） |
| 文件列表 / readme 卡片 | 不透明白/黑 | 半透明 + `backdrop-filter: blur(3px)` 毛玻璃 |
| 字体 | 系统无衬线 | 霞鹜文楷（LXGW WenKai）全局替换 |
| 音乐 | 无 | Meting + APlayer 悬浮播放器，歌词胶囊化 |
| 评论 | 无 | Valine 评论区 + 输入框跳舞小人 |
| 页脚 | `Powered by OpenList` | 一言 + 图标链接组 + 不蒜子访问统计 |
| 特效 | 无 | 自定义光标、FPS 检测、Granim 渐变背景、点击彩球 |
| readme | 原生 Markdown | 渐变下划线标题 + 胶囊玻璃小标题 + 滚动彩虹欢迎语 |

## 二、OpenList 是什么，为什么要用它

### 2.1 一句话定位

官方文档的原话：

> OpenList 是一个支持多种存储的文件列表程序🗂️，是一个有韧性、长期治理、社区驱动的 AList 分支🔀，旨在防御基于信任的开源攻击🛡️。

英文版更直白：

> OpenList is a resilient, long-term governance, community-driven fork of AList — built to defend open source against trust-based attacks.

技术上它就是个 **Gin + SolidJS** 写的文件列表程序：后端聚合几十种存储驱动，前端提供一个网页界面，另外附带 WebDAV、S3、FTP 等协议出口。

### 2.2 和 AList 的关系

| 项 | OpenList | AList |
| --- | --- | --- |
| 仓库 | `github.com/OpenListTeam/OpenList` | `github.com/AlistGo/alist` |
| 仓库描述 | `A new AList Fork to Anti Trust Crisis` | — |
| 建仓时间 | **2025-06-11** | 2020-12-23 |
| 许可证 | **AGPL-3.0** | AGPL-3.0 |
| 当前版本 | **v4.2.6**（2026-09-01） | v3.64.0（2026-09-03） |

分叉的导火索是一条时间线，这些都能在 GitHub 上直接查到：

1. **2024-10-14** GitHub 组织 `AlistGo` 创建（未认证）。
2. **2025-06-05** PR `AlistGo/alist#8633`「Machine statistics」提交，作者 `alist666`。这条 PR **从未被合并**（`merged_at: null`），但拿到了 **330 个 👎**、42 条评论。
3. **2025-06-11** OpenList 仓库建立。
4. **2025-06-12** issue `#9015`「关于Alist未来发展的一点建议」发出，44 条评论，当天被以 `not_planned` 关闭。
5. **2025-06-15** issue `#9100`（66 条评论）里提到公共共享 API 后端已被吊销 —— 这解释了为什么现在用 AList 挂载各家网盘会各种报错。
6. **2025-07-26** AList v3.46.0 发布，也就是 OpenList 文档里标注的「平滑迁移不兼容」的边界版本。

> [!WARNING] 关于「收购」的说法
> 网上流传的「AList 被某公司收购」**没有任何官方公告**可以佐证，`alistgo.com/pricing.html` 页面正文也是空的（只有页脚版权）。可以确证的只有上面这条时间线和 330 个 👎 这个硬数据。
>
> 所以我个人的判断依据是：**PR 的反对票数 + 公共 API 被吊销这两件事**，而不是某个公司名。

### 2.3 许可证：AGPL-3.0

OpenList 的条款页写得很清楚：

> 所有基于 OpenList 的下游项目必须严格遵守 AGPL 3.0 协议的全部条款，包括明确标注来源、保持开源属性并采用相同许可协议。

FAQ 里也有人问「怎么去掉底部的 Powered by OpenList」，官方答复只引用了 copyleft 的要求：**`Copyright and license notices must be preserved`**。

**所以美化的时候，页脚版权信息是唯一不能删的东西**（本文后面的配方里，页脚是被替换成自定义内容，而不是删除）。

## 三、搭建

### 3.1 选哪种方式

| 方式 | 适合谁 | 难度 |
| --- | --- | --- |
| Docker | 有 Docker 的 Linux 服务器，**推荐** | ⭐ |
| 一键脚本 | 全新 VPS，systemd 环境 | ⭐ |
| 二进制 + systemd | 想完全控制，或非 Docker 环境 | ⭐⭐ |
| 1Panel | 已有 1Panel 面板 | ⭐ |
| TrueNAS / Koyeb | 对应平台用户 | ⭐⭐ |
| 从源码构建 | 想改前端 | ⭐⭐⭐⭐ |

端口一览，先记下来：

| 服务 | 默认端口 | 配置键 |
| --- | --- | --- |
| HTTP（网页） | **5244** | `scheme.http_port` |
| HTTPS | `-1`（禁用） | `scheme.https_port` |
| S3 | `5246` | `s3.port` |
| FTP | `:5221` | `ftp.listen` |
| SFTP | `:5222` | `sftp.listen` |
| WebDAV | 复用 HTTP 端口，路径 `/dav/` | — |
| aria2 RPC | `6800` | `aria2_uri` |
| qBittorrent WebUI | `8080` | `qbittorrent_url` |

### 3.2 Docker（推荐）

镜像名是 **`openlistteam/openlist`**（不是 AList 的 `xhofe/alist`），数据卷固定挂到容器内 `/opt/openlist/data`。

**⚠️ v4.1.0 之后有个不兼容变更**：镜像移除了 `PUID` / `PGID` 环境变量，改为像 MariaDB 那样内置一个 `openlist` 用户（**UID 1001**）和同名组（**GID 1001**），并以它运行 `openlist server`。所以旧教程里的 `-e PUID=0 -e PGID=0` 在新版本上是无效的。

三种写法，挑一种：

```bash
# ① 以当前用户运行（最省事，不用改权限）
mkdir -p /etc/openlist
docker run --user $(id -u):$(id -g) -d --restart=unless-stopped \
  -v /etc/openlist:/opt/openlist/data \
  -p 5244:5244 -e UMASK=022 --name="openlist" openlistteam/openlist:latest

# ② 用镜像内置的 uid 1001 运行（要先改目录属主）
sudo chown -R 1001:1001 /etc/openlist
docker run -d --restart=unless-stopped \
  -v /etc/openlist:/opt/openlist/data \
  -p 5244:5244 -e UMASK=022 --name="openlist" openlistteam/openlist:latest

# ③ v4.1.0 及以前的老写法
docker run -d --restart=unless-stopped \
  -v /etc/openlist:/opt/openlist/data \
  -p 5244:5244 -e PUID=0 -e PGID=0 -e UMASK=022 --name="openlist" openlistteam/openlist:latest
```

`docker-compose.yml` 版本：

```yaml
services:
  openlist:
    image: 'openlistteam/openlist:latest'
    container_name: openlist
    user: '0:0' # 换成你实际的 UID:GID
    volumes:
      - './data:/opt/openlist/data'
    ports:
      - '5244:5244'
    environment:
      - UMASK=022
      - TZ=Asia/Shanghai
    restart: unless-stopped
```

```bash
docker compose pull && docker compose up -d
```

**镜像 tag 怎么选**：

| tag | 用途 |
| --- | --- |
| `latest` | 稳定版 |
| `v4.2.6` 之类 | 锁定具体版本 |
| `latest-lite` | 精简版。PaaS 平台有 100MB 镜像限制时用，否则会报 `Pod ephemeral local storage usage exceeds the total limit of containers 100Mi.` |
| `beta` | 开发版 |
| `latest-aio` | 预装全部（ffmpeg + aria2） |
| `latest-ffmpeg` | 本地存储缩略图 |
| `latest-aria2` | 离线下载 |

**拿初始密码**：第一次启动后

```bash
docker logs openlist
# 日志里找：Successfully created the admin user and the initial password is: xYZabHGf
```

之后想改：

```bash
docker exec -it openlist ./openlist admin random      # 随机重置
docker exec -it openlist ./openlist admin set 新密码   # 手动指定
```

**更新**：

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower openlist --cleanup --run-once
```

### 3.3 一键脚本

要求 Linux（systemd 或 OpenRC）、root、已装 `curl` 和 `tar`。三个源任选：

```bash
# 全球
curl -fsSL https://res.oplist.org/script/v4.sh > install-openlist-v4.sh && sudo bash install-openlist-v4.sh

# 中国镜像
curl -fsSL https://res.oplist.org.cn/script/v4.sh > install-openlist-v4.sh && sudo bash install-openlist-v4.sh

# GitHub 源
curl -fsSL https://raw.githubusercontent.com/OpenListTeam/OpenList-Resource/refs/heads/main/script/v4.sh > install-openlist-v4.sh && sudo bash install-openlist-v4.sh
```

脚本菜单有 14 项：安装 / 更新 / 卸载、查看状态、密码管理、启动停止重启、备份恢复配置、Docker 管理、定时更新、系统状态。装完之后随时敲 `openlist` 或 `openlist-manager` 能再次调出这个面板。

### 3.4 二进制 + systemd

去 [Releases](https://github.com/OpenListTeam/OpenList/releases) 下载，命名规则是 `openlist-<系统>-<架构>[-lite].tar.gz`（Windows 是 `.zip`）。Linux 推荐 **musl** 版本，下载量最高的是 `openlist-linux-musl-amd64.tar.gz`：

```bash
tar -zxvf openlist-linux-musl-amd64.tar.gz
chmod +x openlist
./openlist server
```

成功会输出 `start server@0.0.0.0:5244`，**第一次运行会直接打印初始密码**。

配成开机自启，写 `/usr/lib/systemd/system/openlist.service`：

```ini
[Unit]
Description=openlist
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/openlist
ExecStart=/opt/openlist/openlist server
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now openlist
systemctl status openlist
```

如果报 `lib64/libc.so.6: version 'GLIBC_2.28' not found` 或 `accept: function not implemented`，说明系统 glibc 太旧，换 musl 构建或直接用 Docker。

其它平台的等价写法：

| 平台 | 命令 |
| --- | --- |
| macOS | `brew install openlist` |
| Windows | `scoop install openlist` / `winget install OpenListTeam.OpenList` |
| Termux | `pkg install openlist` |
| APT | `curl -fsSL https://github.com/OpenListTeam/OpenList-APT/releases/latest/download/install-apt.sh \| bash` 然后 `apt install openlist` |
| PPA | `sudo add-apt-repository ppa:openlist/server` |
| Flatpak | `flatpak run org.oplist.openlist server` |

v3.4.0 之后还支持静默控制：`openlist start|stop|restart`。

### 3.5 反向代理（上公网必做）

OpenList 靠请求头生成 URL，**反代必须把 `Host` 和 `X-Forwarded-Proto` 正确传下去**，否则分享链接、直链会全部是内网地址。

```nginx
location / {
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Range $http_range;
  proxy_set_header If-Range $http_if_range;
  proxy_redirect off;
  proxy_pass http://127.0.0.1:5244;
  proxy_http_version 1.1;
  client_max_body_size 20000m;   # 上传大小上限，不设的话大文件会 413
}
```

三个 `Host` 变量的区别，官方文档专门列了一张表：

| 变量 | 含义 |
| --- | --- |
| `$http_host` | 原始 Host 头，**含端口**；Host 缺失时为空 |
| `$host` | 服务器名，**不含端口**；缺失时回退 `server_name` |
| `$host:$server_port` | 名字 + 端口，非 80/443 或要 HTTP/3 时用这个 |

**宝塔用户额外两步**（不做的话大文件播放会失败）：

1. 删掉默认生成的三个 location：`location ~ ^/(\.user.ini|\.htaccess|\.git|\.svn|\.project|LICENSE|README.md`、`location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$`、`location ~ .*\.(js|css)?$`。
2. 编辑 `/www/server/nginx/conf/proxy.conf`：**删掉** `proxy_cache cache_one;`，**加上** `proxy_max_temp_file_size 0;`。否则 nginx 会先把大文件缓存到本机磁盘，再吐给浏览器。

Apache 和 Caddy 的写法：

```apache
# Apache
AllowEncodedSlashes NoDecode
ProxyPreserveHost On
ProxyPass "/" "http://127.0.0.1:5244/" nocanon
ProxyPassReverse "/" "http://127.0.0.1:5244/" nocanon
```

```txt
# Caddy，有域名会自动申请证书
example.com {
  reverse_proxy 127.0.0.1:5244
}
```

### 3.6 其它平台

- **1Panel**：应用商店搜 `openlist`。参数里有 WebUI 端口（5244）、S3 端口（5246）、预装环境（缩略图=ffmpeg / 离线下载=aria2 / 以上所有）、时区。**高级设置里务必勾上「端口外部访问」**。
- **TrueNAS Scale**：官方 App 目录里**没有** OpenList，必须用 Custom App。Security Context 勾 Custom User，UID/GID 用 `568/568`（apps 用户），避免用 root；挂载路径必须是 `/opt/openlist/data`。
- **Koyeb**：Command 必须覆盖成 `./openlist server --config /tmp/config.json`，不写会报「当前用户没有 `/opt/openlist/data` 的写和/或执行权限」；环境变量务必设 `OPENLIST_ADMIN_PASSWORD`，否则每次重启都随机生成新密码。

## 四、配置与使用

### 4.1 两个配置文件，别搞混

这是 OpenList 最容易踩的一个认知坑：**有两套完全不同的配置**。

| | `config.json` | 数据库设置表 |
| --- | --- | --- |
| 管什么 | **进程级**配置：端口、数据库、日志、并发、代理 | **应用级**设置：站点标题、Logo、主颜色、公告、预览类型、自定义头部 |
| 在哪 | `<data 目录>/config.json` | 后台 `/@manage/settings/*` |
| 怎么改 | 编辑文件后**重启** | 网页上点保存，立即生效 |

**站点标题、Logo、Favicon、主颜色、公告都不在 `config.json` 里** —— 它们在数据库里，只能通过后台改。所以「改配置文件改标题」是行不通的。

`config.json` 的路径按安装方式不同：

| 安装方式 | 路径 |
| --- | --- |
| 一键脚本 | `/opt/openlist/data/config.json` |
| 手动 / 二进制 | `<openlist 目录>/data/config.json` |
| Docker | 宿主机映射目录 `/data/config.json`（容器内 `/opt/openlist/data/config.json`） |
| OpenWrt | 用 `luci-app-openlist` 在网页改 |

### 4.2 config.json 关键字段

```jsonc
{
  "force": false,                 // true = 忽略环境变量，强制读本文件
  "site_url": "",                 // 公网地址，不能以 / 结尾
  "cdn": "",                      // 前端 CDN，支持 $version 占位符
  "jwt_secret": "random_generated",
  "token_expires_in": 48,         // 登录有效期（小时），默认 48
  "database": {
    "type": "sqlite3",            // sqlite3 / mysql / postgres
    "db_file": "data/data.db",
    "table_prefix": "x_",
    "ssl_mode": "", "dsn": ""
  },
  "scheme": {
    "address": "0.0.0.0",
    "http_port": 5244,
    "https_port": -1,             // -1 = 禁用
    "force_https": false
  },
  "temp_dir": "data/temp",        // ⚠️ 每次启动都会被清空
  "bleve_dir": "data/bleve",
  "log": { "enable": true, "name": "data/log/log.log", "max_size": 50, "max_backups": 30 },
  "max_connections": 0,
  "max_concurrency": 64,
  "tls_insecure_skip_verify": true,
  "s3":   { "enable": false, "port": 5246, "ssl": false },
  "ftp":  { "enable": false, "listen": ":5221" },
  "sftp": { "enable": false, "listen": ":5222" },
  "mcp":  { "enable": false },
  "proxy_address": ""             // HTTP/HTTPS/SOCKS4/SOCKS5
}
```

几个要点：

- **`temp_dir` 每次启动都会被清空**，千万别把数据目录指过去，Docker 里也别映射成正在用的目录。
- **`site_url`** 不是可选项 —— 本地缩略图、开 Web 代理后的预览/下载地址、子目录反代，都依赖它。
- **`force`**：默认程序**优先读环境变量**；设成 `true` 才会忽略环境变量、强制读配置文件。
- **`token_expires_in` 默认 48 小时**，这就是 FAQ 里那个 `Token is expired` 的来源。

### 4.3 环境变量

OpenList 支持把 `config.json` 的每个字段用环境变量传进去，**`OPENLIST_` 前缀由配置加载器统一施加**（不是写在 struct tag 里的）。所以：

```
OPENLIST_DB_TYPE / OPENLIST_DB_HOST / OPENLIST_DB_PORT ...
OPENLIST_SCHEME_HTTP_PORT / OPENLIST_SCHEME_FORCE_HTTPS ...
OPENLIST_TEMP_DIR / OPENLIST_BLEVE_DIR
OPENLIST_LOG_ENABLE / OPENLIST_LOG_NAME ...
OPENLIST_MAX_CONCURRENCY / OPENLIST_MAX_CONNECTIONS
OPENLIST_S3_ENABLE / OPENLIST_FTP_ENABLE / OPENLIST_SFTP_ENABLE
OPENLIST_PROXY_ADDRESS
```

**但 Docker 镜像默认带了 `--no-prefix`，所以容器里直接用裸名字**：

```yaml
environment:
  - UMASK=022
  - TZ=Asia/Shanghai
  - OPENLIST_ADMIN_PASSWORD=你的密码
```

### 4.4 挂载第一个存储

进后台 `/@manage/storages`，点「添加」。先看几个**所有驱动共有**的字段：

| 字段 | 说明 |
| --- | --- |
| **挂载路径** | 唯一标识 + 对外展示名 + 挂载位置。挂根目录填 `/` |
| **序号** | 数字越小越靠前，可以填负数 |
| **备注** | 便于自己管理 |
| **引用** | 备注第一行写 `ref:/mount_path`，可让多个存储共享同一个 token |
| **缓存过期** | 目录结构缓存时长，**默认半小时** |
| **自定义缓存策略** | 按路径设不同缓存，单位分钟。`*` 匹配单层、`**` 匹配多层 |
| **Web 代理** | 预览/下载是否走中转，**开启后必须设 `site_url`** |
| **WebDAV 策略** | 见下表 |

**挂载路径的两个报错**要认得出：

```
Failed create storage in database: UNIQUE constraint failed: x_storages.mount_path
```
→ 路径重复了。想合并多个网盘用 `别名`（alias）存储。

```
Key: 'Storage.MountPath' Error: Field validation for 'MountPath' failed on the 'required' tag
```
→ 路径留空了。

**WebDAV 策略的三种模式**，选错会影响能不能播：

| 模式 | 行为 | 代价 |
| --- | --- | --- |
| 302 重定向 | 跳到真实链接 | 不耗服务器流量，但官方**不建议分享使用**，有封号风险 |
| 使用代理 URL | 跳到代理地址 | 耗代理流量 |
| 本机代理 | 经服务器中转 | 兼容性最好，耗服务器流量 |

**自定义缓存策略**的写法，官方给了示例：

```
/Series/Completed/*:60      # 已完成目录，缓存 60 分钟
/Series/Updating/*/**:10    # 更新中目录及其子目录，缓存 10 分钟
/Series/Archived/**:30      # 归档目录及全部子目录，缓存 30 分钟
```

**本机存储**（`local`）最常用的几个字段：根文件夹 ID（Linux 填 `/root`、Windows 填 `C:`）、回收站路径（**留空 = 彻底删除，没有后悔药**）、缩略图（视频需要 ffmpeg；macOS 上还能用 Quick Look 生成 **PDF 首页缩略图**，需同时开启「缩略图」和「PDF 缩略图」）。

顺带一提，OpenList 的驱动数量很可观，源码里注册了 **88 个**。常见的：115 / 123 / 139 / 189、阿里云盘、百度网盘、夸克、迅雷、PikPak、OneDrive、Google Drive、Dropbox、MEGA、S3、WebDAV、SFTP、FTP、SMB、GitHub、Emby、以及 `local`、`crypt`（加密目录）、`alias`（别名聚合）、`virtual`（虚拟存储）、`alist_v3`（挂载旧 AList）。

> [!TIP] 文档里查不到名字时
> 文档页名和代码目录名**不完全一致**，比如 `baidu` 对应 `baidu_netdisk`、`google_photos` 对应 `google_photo`、`quark`/`uc` 其实都归到 `quark_uc`。搜不到就用代码目录名试。

### 4.5 用户与权限

后台 `/@manage/users`。权限是逐项勾选的：

可以看到隐藏 / 无密码访问 / 添加离线下载任务 / 创建目录或上传 / 重命名 / 移动 / 复制 / 删除 / WebDAV 读取 / WebDAV 管理 / FTP 读取 / FTP 管理 / 读取压缩文件 / 解压

几个关键点：

- **游客账户（guest）默认是停用的**。想允许访客浏览，去后台把 guest 的「停用」取消勾选。反过来，如果看到 `Guest user is disabled, login please`，就是这里。
- **连续 6 次密码错误会封禁该 IP 30 分钟**（重启可清除）。
- 「添加离线下载任务」这个权限有额外警告：授予远程文件读写权限，同时也赋予了**利用服务器网络环境（含内网地址）访问资源**的能力。官方原文是「请仅向完全可信的用户授予此权限」。

**想只让登录用户看到内容**，三种做法：

1. 把 guest 可见目录指向一个空文件夹，里面放个 readme 说明；
2. 在元信息里给根目录加密码；
3. 直接停用 guest 用户（v3.10.1+ 会强制跳转登录页）。

### 4.6 元信息：密码、隐藏、readme

后台 `/@manage/metas`，可以对任意路径叠加一层规则：

| 字段 | 说明 |
| --- | --- |
| **密码** | 访问该路径需要密码。**对 WebDAV 不生效** |
| **应用到子文件夹** | 让密码/白名单作用到子目录 |
| **可读用户 / 可写用户** | 白名单，非空时只有列出的用户能访问 |
| **开放写入** | 任何用户都能建目录/上传，绕过用户级写检查 |
| **隐藏** | Golang 正则，一行一条。**对 WebDAV 也生效** |
| **说明（Readme）** | Markdown 内容或链接，显示在列表**底部** |
| **顶部说明（Header）** | 显示在列表**顶部** |

> [!CAUTION] 一个很容易勾错的组合
> **不要同时勾「写入」和「应用到子文件夹」** —— 官方文档原话是这会导致 "anyone has permission to write dangerous operations"，也就是任何人都拿到了写权限。

另外注意：**全局的「隐藏文件」不是真隐藏**。官方文档明确说 `The file will still appear in the API response list, but will not be displayed in the front-end interface` —— 文件仍然在 API 列表里，只是前端不显示。要真隐藏，用元信息。

还有个小技巧：想隐藏「某个文件夹里的某个子文件夹」，必须为那个子文件夹**单独建一条元信息**，不能把它填进根目录 `/` 的元信息记录里（这是已知 issue `alist-org/alist#4494`）。

### 4.7 搜索索引

后台 → 索引，或者 `config.json` 的 `search_index`。**源码默认值是 `none`（不建索引）**，得手动开。

| 取值 | 特点 |
| --- | --- |
| `database` | 全文搜索，复用 `data.db`；**不分词**；支持增量更新。官方推荐没特殊需求就用它 |
| `database_non_full_text` | **MySQL 用户推荐用它**；慢一些，但不会搜到奇怪的文件 |
| `bleve` | 会分词，搜索结果「可能很奇怪」；更耗资源；**不支持增量更新**，必须全量重建 |
| `meilisearch` | 最准，但**每 10 万文件约占 800MiB**，且删除文档不释放空间 |
| `none` | 默认，不建索引 |

sqlite3 建索引时容易出现 `database is locked`，等它跑完就好，或者换 MySQL。数据库太大可以连上去执行一次 `VACUUM;`。

### 4.8 WebDAV、分享与直链

**WebDAV** 地址是 `http[s]://你的域名:端口/dav/`。权限要开两个：

- **WebDAV 读取** → 只能看；
- **WebDAV 管理** → 能写。**但只开这一个不够**，还要同时勾上具体的文件系统权限（重命名 / 删除 / 复制 / 创建目录或上传）。

**分享链接**模板是 `{{base_url}}/@s/{{id}}`，单文件直链下载是 `{{base_url}}/sd/{{id}}`。

**直链签名**有两个相关设置：

- **签名所有（`sign_all`）**：给所有直链加 `?sign=...`，**公开站点关闭它可能导致密码被绕过**，建议保持开启。
- **直链有效期（`link_expiration`）**：单位小时，0 = 不过期。注意**只有加了密码的路径才有过期时间** —— 因为过期信息写在 `sign` 参数里，无密码的路径根本不校验 `sign`。

### 4.9 离线下载

支持 **Aria2** 和 **qBittorrent**（> v3.11.0）。链接类型支持 `magnet`、`http`、`ed2k`；PikPak 还支持 X / TikTok / Facebook / TG 的 URL。

**OpenList ≥ 3.42.0 必须先配置临时文件夹**（后台 → 设置 → 其他），否则离线下载里只显示 SimpleHttp 一个选项。

Docker 部署时，**Aria2 必须能访问和 OpenList 相同的目录** `/opt/openlist/data/temp/aria2`。如果 OpenList 挂的是 `./data:/opt/openlist/data`，Aria2 容器就要额外挂 `./data/temp/aria2:/opt/openlist/data/temp/aria2`。

qBittorrent 的默认连接串是 `http://admin:adminadmin@localhost:8080/`。如果报 `Qbittorrent not ready`，把两个程序都重启一次。

### 4.10 备份

**两种备份方式，覆盖范围不一样**：

| 方式 | 备份内容 |
| --- | --- |
| 后台「备份/恢复」 | 配置数据，**不含索引** |
| 直接备份 `data/data.db` | **含索引** |

用第二种的话：

- 如果有 `data.db-shm` 和 `data.db-wal`，**必须一起备份**；
- **建议先停掉 OpenList 再备份** —— 这样两个 WAL 文件会合并进 `data.db`，备份才完整。

MySQL / PostgreSQL 用户，官方文档的原话是 "please solve it by yourself"。

### 4.11 公告：一个实用的用法

「公告」支持 Markdown，而且是**通过 toast 组件渲染**的 —— 也就是说它可以塞 HTML。

我自己把和风天气做成了一个 iframe 放进去，每次打开首页右上角就是本地天气：

```html
<iframe id='qwx-weather' title='和风天气' scrolling='no'
  style='width:290px;max-width:100%;height:96px;border:0;display:block;overflow:hidden;background:transparent'
  srcdoc="<!DOCTYPE html>..."></iframe>
```

有个小细节：公告的关闭按钮会盖住内容右上角，官方建议**在公告内容前面加个标题**。如果想去掉关闭按钮：

```css
.notify-render .hope-close-button {
  display: none;
}
```

## 五、美化：只有两个注入点

### 5.1 先搞清楚能改什么

后台 → 设置 → 全局，里面只有**两个**自定义入口：

| 设置 | 中文名 | 注入位置 |
| --- | --- | --- |
| `customize_head` | **自定义头部** | 网页 `<head>` |
| `customize_body` | **自定义内容** | `<body>` 末尾 |

官方说明：

> 在此处设置的内容会自动插入到网页头部位置（**管理页面除外**）。您可以在此处引用脚本、CSS等，对 OpenList 的前端进行美化。

> 在此处设置的内容会自动插入到网页正文的末尾。您可以在此处添加备案信息、访问统计等。

> [!WARNING] 不存在「自定义侧边栏」
> 网上有些教程提到 `customize_sidebar` —— 源码里**没有这个设置键**。文档里的「侧边栏设置」讲的是首页右下角那个可展开工具栏（刷新 / 新建文件 / 新建文件夹 / 递归移动 / 删除空文件夹 / 批量重命名 / 上传），跟 HTML 注入无关。

### 5.2 注入机制（源码级）

理解机制能省掉一大半调试时间。

**服务端**（`server/static/static.go`）先替换一批基础占位符（favicon / logo / 标题 / 主颜色），生成管理页用的 HTML；再替换两个注释占位符生成普通页 HTML：

```go
replaceMap2 := map[string]string{
    "<!-- customize head -->": customizeHead,
    "<!-- customize body -->": customizeBody,
}
```

因为管理页返回的是**没做第二次替换**的那份 HTML，所以**自定义内容不会注入到后台管理页** —— 这是官方有意为之的安全边界。

**前端**（`OpenList-Frontend/src/utils/customize.ts`）负责实际落地，几个细节值得知道：

1. 它用 `document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)` 找那两个注释锚点。**如果锚点都不在，就认为服务端已经注入过，直接跳过** —— 这是防重复注入的机制。
2. **用 `innerHTML` 插入的 `<script>` 永远不会执行**（HTML 规范会把这种方式创建的脚本标记为 "already started"）。所以它专门 `document.createElement("script")`、拷贝属性、设置 `textContent` 再插入。
3. 注入是插到**锚点原位**，然后删掉锚点，不是追加到末尾。
4. 外链脚本会按顺序 `await`，失败或超时只打印警告，不会阻塞后续脚本。

**官方记录的 5 条限制**，写代码前先看：

| 限制 | 影响 |
| --- | --- |
| 注入发生在设置接口返回**之后** | 自定义 CSS 会有一次首屏闪烁（FOUC） |
| JS 被禁用 / bundle 加载失败 | 自定义内容**完全失效** |
| 爬虫和社交分享卡片**不执行 JS** | 自定义内容对它们无效，`<title>` 仍是构建期默认值 |
| 注入位置是占位符**原位** | 不是追加到 `</body>` 前 |
| 注入时 `DOMContentLoaded` / `load` 可能**已经触发过** | 依赖这两个事件的代码要自己检查 `document.readyState` |

### 5.3 为什么必须轮询 `.footer`

如果你看过别人的 OpenList 美化代码，大概率见过这段：

```js
let interval = setInterval(() => {
  if (document.querySelector(".footer")) {
    document.querySelector("#customize").style.display = "";
    clearInterval(interval);
  }
}, 200);
```

**这不是玄学，是有源码依据的。**

前端布局是 `<Header /> <Toolbar /> <Body /> <Footer />`，而页脚组件的写法是：

```tsx
<VStack class="footer" w="$full" py="$4">
```

**`.footer` 是 SolidJS 运行时渲染出来的，静态 HTML 里根本没有这个元素。** 而 `customize_body` 注入的时候，`#root` 还是空的。所以任何「把内容插到页脚旁边/后面」的脚本，**必须等这个节点出现**。

两种等法：`setInterval` 轮询（简单）或 `MutationObserver`（干净）。我两个都用了，双保险。

### 5.4 哈希类名：能改，但会失效

OpenList 前端用的是 **Hope UI / PandaCSS**，生成的是形如 `hope-c-PJLV-ifkxHPo-css` 的原子化哈希类名。

**证据**：官方文档自己的 Markdown 里就嵌着这种类名：

```html
class="toolbar-toggle hope-icon hope-c-XNyZK hope-c-PJLV hope-c-PJLV-ifkxHPo-css"
```

**结论：任何依赖 `hope-c-PJLV-*` 的选择器，在 OpenList 升级后都会失效** —— 因为 PandaCSS 会重新生成哈希。

那为什么我还在用？因为**有些元素确实没有稳定类名可用**。我的策略是：

- **优先用稳定语义类名**：`.footer`、`.obj-box`、`.markdown-body`、`.newValine`、`.aplayer`、`#root > .header` —— 这些不随构建变化；
- 只有拿不到语义类名时才用哈希类名，并且**每个都写清注释**，方便升级后定位修复。

### 5.5 配方：毛玻璃基座

整个美化的核心是「半透明 + 模糊」，先用一组 CSS 变量把设计语言固定下来，后面所有模块复用：

```css
:root {
  --my-card: rgba(255, 255, 255, .46);
  --my-card-line: rgba(0, 0, 0, .07);
  --my-fg: #1f2430;
  --my-dim: rgba(31, 36, 48, .60);
  --my-accent: #1890ff;
  --my-accent-2: #5cb3ff;
  --my-blur: blur(3px) saturate(1.2);
  --my-radius: var(--hope-radii-xl, 12px);
  --my-shadow: var(--hope-shadows-lg, 0 10px 15px -3px rgb(0 0 0 / .09));
}

/* 暗色：两套覆盖，一套跟随站点类名，一套跟随系统偏好 */
body.hope-ui-dark {
  --my-card: rgba(255, 255, 255, .07);
  --my-card-line: rgba(255, 255, 255, .12);
  --my-fg: #eef1f6;
  --my-dim: rgba(238, 241, 246, .66);
}
@media (prefers-color-scheme: dark) {
  body:not(.hope-ui-light) {
    --my-card: rgba(255, 255, 255, .07);
    --my-card-line: rgba(255, 255, 255, .12);
    --my-fg: #eef1f6;
    --my-dim: rgba(238, 241, 246, .66);
  }
}
```

> [!TIP] 为什么暗色要写两遍
> OpenList 的主题有两种来源：**站点内手动切换**（加 `hope-ui-dark` / `hope-ui-light` 类）和**跟随系统偏好**（什么都不加）。只写 `.hope-ui-dark` 的话，系统级暗色的用户看不到效果。两套都写才完整。

然后把这套变量套到各个区域（只列几个代表，模式完全一样）：

```css
/* 主列表 */
.obj-box.hope-stack.hope-c-dhzjXW.hope-c-PJLV.hope-c-PJLV-igScBhH-css {
  background-color: rgba(255, 255, 255, 0.5) !important;
  backdrop-filter: blur(3px) !important;
}
.hope-c-PJLV.hope-c-PJLV-iigjoxS-css {          /* 暗色 */
  background-color: rgb(0 0 0 / 50%) !important;
  backdrop-filter: blur(3px) !important;
}

/* readme 卡片 */
.hope-c-PJLV.hope-c-PJLV-ikSuVsl-css {
  background-color: rgba(255, 255, 255, 0.5) !important;
  backdrop-filter: blur(3px) !important;
}

/* 导航条 */
.body > .nav {
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: var(--hope-radii-xl);
}
.body > .nav::after { display: none; }          /* 去掉自带的遮罩 */
```

### 5.6 配方：背景图

```css
.hope-ui-light {
  background-image: url("https://t.alcy.cc/pc") !important;
  background-repeat: no-repeat;
  background-size: cover;
  background-attachment: fixed;    /* 关键：滚动时背景不动 */
  background-position-x: center;
}
.hope-ui-dark {
  background-image: url("你的暗色背景图") !important;
  /* 同上 */
}
```

### 5.7 配方：字体

霞鹜文楷，直接从 CDN 引：

```html
<link rel="stylesheet" href="https://npm.elemecdn.com/lxgw-wenkai-webfont@1.1.0/lxgwwenkai-regular.css">
```

```css
* { font-family: LXGW WenKai; font-weight: bold; }
body { font-family: LXGW WenKai; }
```

### 5.8 配方：音乐播放器（Meting + APlayer）

MetingJS 和 APlayer 都是**第三方项目**，OpenList 官方文档里一个字都没提。基础用法：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.css">
<script src="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/meting@2/dist/Meting.min.js"></script>
<meting-js server="netease" type="playlist" id="60198" fixed="true" mini="true"></meting-js>
```

常用属性：

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| `id` / `server` / `type` | 必填 | `server` 支持 `netease` / `tencent` / `kugou` / `xiami` / `baidu`；`type` 支持 `song` / `playlist` / `album` / `search` / `artist` |
| `fixed` | `false` | 贴边悬浮 |
| `mini` | `false` | 迷你模式 |
| `theme` | `#2980b9` | 主色 |
| `loop` / `order` | `all` / `list` | — |
| `list-max-height` | `340px` | 列表高度 |
| `storage-name` | `metingjs` | 记住用户设置的 localStorage key |

⚠️ 网上常说「支持酷我」，但**官方 README 列出的 `server` 取值里没有 `kuwo`**。

APlayer 要改得好看，有三个**必须知道的坑**，我的注释里都记着：

**坑 1：彩虹文字不能画在 `li` 上。** `li` 的背景还承担「当前播放行」高亮，`background-clip: text` 会把高亮一起裁掉。要画在内部的 `span` 上：

```css
.aplayer-list-index,
.aplayer-list-title,
.aplayer-list-author,
.aplayer-music,
.aplayer-time,
.aplayer-lrc p {
  background: var(--mp-rainbow);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: masked-animation 3s infinite linear;
}
@keyframes masked-animation {
  0%   { background-position: 0 0; }
  100% { background-position: -100%, 0; }
}
```

**坑 2：歌词行高必须锁死 16px。** APlayer 每行歌词的位移是**硬编码**的 `translateY(-16 * index)`。如果 `p` 的高度不是 16px，歌词就会逐行错位：

```css
.aplayer-lrc p {
  height: 16px !important;
  min-height: 16px !important;
  max-height: 16px !important;
  line-height: 16px !important;
  font-size: 13px !important;
  padding: 0;
  margin: 0;
  text-shadow: none;
  opacity: .55;
}
.aplayer-lrc p.aplayer-lrc-current { opacity: 1; font-weight: 700; }
```

**坑 3：贴边隐藏的平移量必须等于封面宽度。** 折叠态整块宽 86px（封面 66 + 把手 18 + 边框）。如果写 `translateX(-100%)`，会把把手也推出屏幕（实测把手落到 `x = -19`，点不到）。必须写死 `-66px`：

```css
.aplayer.aplayer-fixed.aplayer-narrow .aplayer-body {
  transform: translateX(-66px);   /* 不是 -100% */
  background: transparent !important;
  border-color: transparent;
  box-shadow: none;
}
.aplayer.aplayer-fixed .aplayer-body:hover,
.aplayer.aplayer-fixed .aplayer-body:focus-within {
  transform: translateX(0);
}
```

**还有一条移动端的**：播放列表展开时会和歌词胶囊完全压在一起（实测列表 `y 528-778`、歌词 `y 730-760`）。`aplayer-list-hide` 这个类加在 **`.aplayer-list`** 上而不是 `.aplayer` 上，所以必须用 `:has()`：

```css
.aplayer.aplayer-fixed:has(.aplayer-list:not(.aplayer-list-hide)) .aplayer-lrc {
  display: none;
}
```

### 5.9 配方：评论区（Valine）

```js
new Valine({
  el: '#vcomments',
  appId: '你的 AppID',
  appKey: '你的 AppKey',
  avatar: 'wavatar',
  visitor: true,
  placeholder: '有什么问题欢迎评论区留言~么么哒',
});
```

配合毛玻璃：

```css
.newValine {
  width: min(96%, 940px);
  flex-direction: column;
  row-gap: var(--hope-space-2);
  border-radius: var(--hope-radii-xl);
  padding: var(--hope-space-2);
  box-shadow: var(--hope-shadows-lg);
  background-color: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(3px);
}
```

加个「输入时跳舞小人下沉」的小细节 —— 用 `background-position` 做过渡：

```css
.vedit {
  background-image: url("你的小人.gif");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: right bottom;
  transition: all .25s ease-in-out 0s;
}
textarea#comment-textarea:focus {
  background-position-y: 120px;
}
```

### 5.10 配方：readme 区美化

readme 区的所有选择器都限定在 `.markdown-body` 下，不会污染别处。一级标题加渐变下划线、二级标题做成胶囊：

```css
.markdown-body > h1 {
  position: relative;
  padding: 0 0 14px;
  border-bottom: 0;
  font-size: 30px;
  font-weight: 800;
}
.markdown-body > h1::after {
  content: "";
  position: absolute;
  left: 0; bottom: 0;
  width: 72px; height: 4px;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--my-accent), var(--my-accent-2));
  box-shadow: 0 0 12px rgba(24, 144, 255, .45);
}
.markdown-body > h2 {
  display: flex;
  width: fit-content;
  padding: 6px 15px;
  border: 1px solid var(--my-card-line);
  border-radius: 99px;
  background: var(--my-card);
  backdrop-filter: var(--my-blur);
  font-size: 17px;
  font-weight: 700;
}
```

**滚动彩虹欢迎语**是最花心思的一个。核心是把两个动画**拆到两层元素**上：

```css
/* 滚动放在外层 */
.muyu-scroll {
  display: inline-block;
  padding-left: 100%;
  white-space: nowrap;
  animation: myu-scroll 22s linear infinite;
}
.muyu-marquee:hover .muyu-scroll { animation-play-state: paused; }
@keyframes myu-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}

/* 彩虹放在内层 */
#nr {
  background: var(--my-rainbow);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: myu-rainbow 2s linear infinite;
}
```

> [!CAUTION] 为什么必须分两层
> **两个都用 `animation` 简写，写在同一个元素上会互相覆盖** —— 后声明的那个把前一个整个顶掉。
>
> 更隐蔽的是：`.muyu-marquee #nr` 的特异性高于 `#nr`，所以就算你把彩虹写在 `#nr` 上，外层那条规则也会把它盖掉。分元素是唯一稳妥的写法。

对应 HTML：

```html
<div class="muyu-marquee">
  <div class="muyu-marquee-inner">
    <div class="muyu-scroll"><span id="nr">( ﾟ∀ﾟ)ﾉ 嗨，欢迎来到牧屿的小破盘~</span></div>
  </div>
</div>
```

### 5.11 配方：几个小特效

**FPS 检测**（左上角常驻，用来判断毛玻璃 + 背景图是否拖垮了低配设备）：

```js
let fps = 0, lastTime = performance.now();
// ... 每帧累加，每秒统计一次
if (window.localStorage.getItem("fpson") !== "1") {
  document.getElementById("fps").style = "display:none!important";
}
```

分档文案挺有意思：`<=5` 是「卡成ppt🤢」、`<=15` 是「电竞级帧率😖」、`<35` 是「不太流畅🙄」、`<=45` 是「还不错哦😁」、再高就是「十分流畅🤣」。

**自定义光标**（一个跟随鼠标的圆点，靠 `Math.lerp` 缓动）：

```js
class Cursor {
  render() {
    this.pos.x = Math.lerp(this.pos.x, this.$cursor.x, 0.15);
    this.pos.y = Math.lerp(this.pos.y, this.$cursor.y, 0.15);
    // ...
  }
}
```

它还会遍历所有元素，把 `cursor === "pointer"` 的挑出来，在悬停时放大圆点。**注意列表切换后要重新采集**，否则新出现的元素没有悬停反馈。

**渐变背景**（Granim.js，作为 `z-index: -999` 的底层）：

```js
new Granim({
  element: '#canvas-basic',
  direction: 'left-right',
  isPausedWhenNotInView: true,
  states: { 'default-state': { gradients: [
    ['#a18cd1', '#fbc2eb'], ['#fff1eb', '#ace0f9'],
    ['#d4fc79', '#96e6a1'], ['#a1c4fd', '#c2e9fb'],
  ] } },
});
```

**点击彩球**：`mousedown` 时生成 10~20 个球，**长按 500ms 后爆发 50~100 个**，每个球每帧 `r -= 0.3` 慢慢消失。

### 5.12 完整加载框架

把所有东西串起来的骨架，核心就是「等 `.footer` 出现 → 显示容器 → 初始化各模块」：

```html
<!-- 自定义内容 -->
<div id="customize" style="display:none;">
  <meting-js server="netease" type="playlist" id="你的歌单" fixed="true" mini="true"></meting-js>
  <span id="fps"></span>
  <div class="newValine" id="vcomments"></div>
  <center class="dibu"><!-- 页脚 --></center>
  <canvas id="canvas-basic"></canvas>
</div>

<script>
  // 双保险：轮询 + MutationObserver
  let interval = setInterval(() => {
    if (document.querySelector(".footer")) {
      document.querySelector("#customize").style.display = "";
      clearInterval(interval);
    }
  }, 200);

  new MutationObserver(() => {
    if (document.querySelector(".footer")) {
      document.querySelector("#customize").style.display = "";
    }
  }).observe(document.body, { childList: true, subtree: true });
</script>
```

> [!TIP] 自定义内容放哪
> 因为 `customize_body` 注入时 SPA 还没渲染，**把要延迟初始化的东西先放进一个 `display:none` 的容器里**，等 DOM 就绪再显示 —— 这样能避免一堆「元素还不存在」的报错。

## 六、七个真实的坑

### 坑 1：`markdown-body:before` 漏了一个点

我最初写背景遮罩时写的是：

```css
markdown-body:before {   /* ← 少了 . */
  content: "";
  position: fixed;
  background: url(...) center/cover;
}
```

**这不是 `class` 选择器，而是元素选择器** —— 意思是「所有 `<markdown-body>` 标签」。页面上根本没有这种标签，所以**整条规则静默失效，不报错**。

CSS 里最讨厌的就是这种：不报错、不警告、就是没效果。**排查时先看选择器有没有笔误，再看特异性。**

### 坑 2：`!important` 也会输

旧版样式里对 `.aplayer-lrc p` 写过 `background: none !important`，新规则如果特异性相同，**就看谁在后面**。我加规则的位置在它之前，结果一直不生效。解决办法只有两个：提高特异性，或者确保规则靠后。

### 坑 3：触屏设备没有 hover

做 APlayer 贴边隐藏时，我一开始按「只在鼠标设备上隐藏」写：

```css
@media (hover: hover) { ... }
```

结果手机上永远收不进去（触屏没有 hover）。最后**所有设备都隐藏**，靠 `:focus-within` 兜住键盘用户。

### 坑 4：`temp_dir` 会被清空

`config.json` 里的 `temp_dir` 默认是 `data/temp`，**每次启动程序都会清空它**。我一度想把下载目录指过去，幸好先看了文档。

### 坑 5：`openlist admin` 读的是「当前目录」

这个在 FAQ 里，但很容易中招：**`openlist admin` 读的是你执行命令时所在目录的配置**。如果你在别的目录（比如 Windows 上的 `C:\Windows\System32`）执行，它会在那里生成一份全新的配置，然后你拿到的密码跟实际运行的服务对不上。

### 坑 6：Docker 迁移时卷路径必须改

从 AList 迁到 OpenList，**必须把卷映射从 `/opt/alist/data` 改成 `/opt/openlist/data`**。官方原文警告：

> make sure to modify the Volume mapping by changing the configuration file path from `/opt/alist/data` to `/opt/openlist/data`. Otherwise, your configuration files will be lost after updating the version and rebuilding the container!

而且官方建议**删掉旧容器再重建**，不要原地改。

### 坑 7：`filter_readme_scripts` 默认是开着的

OpenList 默认开启了 README 脚本过滤，所以**在 readme 里写的 `<style>` 和 `<script>` 不会生效**。

要去 **设置 → 预览 → 关掉「过滤 README 文件中的脚本」**。

官方对这个开关的说明是：

> 作为一项安全措施，防止执行来自不受信任来源的潜在恶意脚本，系统默认启用了 XSS 防护。

**关掉它意味着你要为自己 readme 里的内容负责** —— 如果 readme 来自别人（比如你挂载了一个公共仓库），那就等于允许对方在你的站点上执行 JS。

## 七、验收清单

- [ ] 浏览器打开 `http://IP:5244` 能看到登录页
- [ ] `docker logs openlist` 里能拿到初始密码
- [ ] 后台能登录，站点标题 / Logo / 主颜色按预期显示
- [ ] 至少挂载了一个存储，列表能看到文件
- [ ] 挂载路径没有重复，序号排序符合预期
- [ ] 反代后分享链接里的域名和端口正确（不是 `127.0.0.1`）
- [ ] 上传一个大文件不报 413
- [ ] 游客账户按需启停，`Guest user is disabled` 提示符合预期
- [ ] WebDAV 能挂载，写入权限按需开启
- [ ] 搜索索引已建，搜索能出结果
- [ ] **自定义头部**里的 CSS 生效（F12 能看到 `<style>` 在 `<head>` 里）
- [ ] **自定义内容**里的 HTML 生效（`#customize` 容器已显示）
- [ ] 亮色 / 暗色两套配色都正常
- [ ] 后台管理页**没有**被自定义内容污染
- [ ] 页脚版权信息仍然保留（AGPL 要求）
- [ ] 手机端布局没有错位

## 八、常见问题

| 现象 | 排查方向 |
| --- | --- |
| 页面打开报 `failed get storage: can't find storage with rawPath: /` | 还没添加任何存储，去后台加一个 |
| 上传报 **413** | 反向代理的 `client_max_body_size` 太小 |
| 上传的文件不显示 / 删掉的文件还在 | 目录缓存（默认半小时），点工具栏的**刷新按钮**（不是 F5） |
| 登录提示 `Token is expired` | `token_expires_in` 默认 48 小时；如果刚登录就过期，检查是不是套了 CDN 缓存 |
| `Guest user is disabled, login please` | 后台 → 用户 → `guest` → 取消勾选「停用」 |
| 挂载路径报 `UNIQUE constraint failed` | 路径重复，用「别名」存储聚合 |
| 离线下载只有 SimpleHttp | OpenList ≥ 3.42.0 必须先配临时文件夹 |
| `Qbittorrent not ready` | 把 OpenList 和 qBittorrent 都重启一次 |
| 预览 ZIP 文件名乱码 | 设置 → 预览 → 「ZIP 文件备选编码」改成 `GBK` |
| `System error: TypeError: n.replaceAll is not a function` | 浏览器内核太旧，在**自定义头部**加 `String.prototype.replaceAll` 的 polyfill |
| 自定义 CSS 不生效 | ① 是否在管理页（管理页不注入）；② 选择器是否笔误；③ 是否被 `!important` 或特异性覆盖 |
| 自定义 JS 不执行 | ① 是否等了 `.footer`；② 是否用了 `innerHTML` 插入脚本（不会执行）；③ Console 看 `[customize]` 前缀的警告 |
| 升级后美化全乱 | 大概率是 `hope-c-PJLV-*` 哈希类名变了，逐个替换 |
| 大文件播放失败（宝塔） | 删掉 `proxy_cache cache_one;`，加上 `proxy_max_temp_file_size 0;` |
| `data.db-shm` / `data.db-wal` 能删吗 | **不要删**，这是 SQLite WAL 模式的正常文件 |
| 想只让登录用户访问 | 三选一：guest 指向空文件夹 / 根目录元信息加密码 / 停用 guest |

## 九、安全提醒

OpenList 官方并没有说过「不要暴露到公网」这句话 —— README 和条款页里都没有。官方只有「严禁任何形式的滥用」+「风险自负」的免责声明。

但该做的加固还是要做，下面这些**全部来自官方设置项**：

| 加固项 | 位置 | 建议 |
| --- | --- | --- |
| 允许索引 | 设置 → 站点 | 保持关闭（默认已是） |
| 允许挂载 | 设置 → 站点 | **建议关闭**（默认开启） |
| robots.txt | 设置 → 站点 | 不想被爬就改 `Disallow: /` |
| 签名所有 | 设置 → 全局 | **保持开启**，关了密码可能被绕过 |
| 直链有效期 | 设置 → 全局 | 按需设置，0 是永不过期 |
| 隐藏文件 | 设置 → 全局 | 记住这不是真隐藏，真隐藏用元信息 |
| 元信息密码 | 后台 → 元信息 | 对 WebDAV 不生效；勿同时勾「写入 + 应用到子文件夹」 |
| 过滤 README 脚本 | 设置 → 预览 | **保持开启**，除非你完全信任 readme 来源 |
| WebDAV / FTP / SFTP | 权限 + config.json | 不用就保持关闭 |
| 用户权限 | 后台 → 用户 | 最小权限；「添加离线下载任务」只给可信用户 |
| 令牌（Token） | 设置 → 其他 | 管理员全权令牌，泄露即失守 |
| 反向代理 | nginx | 传 `Host` / `X-Forwarded-Proto`，设 `client_max_body_size` |

另外提醒一句：**自定义头部和自定义内容里的 HTML 会被原样注入并执行脚本**。也就是说，任何能改这两个设置的人，都能在所有访客的浏览器上执行任意 JS。引用第三方 CDN 的 JS（音乐播放器、评论系统、看板娘、统计脚本）等于把供应链信任交给那个 CDN —— 建议只用知名 CDN，或者把资源下载到自己服务器。

## 十、相关链接

**OpenList 官方**

- 主仓库：[github.com/OpenListTeam/OpenList](https://github.com/OpenListTeam/OpenList)
- 前端仓库：[github.com/OpenListTeam/Openlist-Frontend](https://github.com/OpenListTeam/Openlist-Frontend)
- 文档站：[doc.oplist.org](https://doc.oplist.org)（国内 [doc.oplist.org.cn](https://doc.oplist.org.cn)）
- 演示站：[demo.oplist.org](https://demo.oplist.org)
- Releases：[github.com/OpenListTeam/OpenList/releases](https://github.com/OpenListTeam/OpenList/releases)
- Docker Hub：[hub.docker.com/r/openlistteam/openlist/tags](https://hub.docker.com/r/openlistteam/openlist/tags)
- 一键脚本：[res.oplist.org/script/v4.sh](https://res.oplist.org/script/v4.sh)
- 代理（Cloudflare Workers）：[github.com/OpenListTeam/OpenList-Proxy](https://github.com/OpenListTeam/OpenList-Proxy)
- 配置结构体（查全部环境变量）：[pkg.go.dev/.../internal/conf#Config](https://pkg.go.dev/github.com/OpenListTeam/OpenList/v4/internal/conf#Config)
- 条款 / 隐私：[doc.oplist.org/terms](https://doc.oplist.org/terms) / [doc.oplist.org/privacy](https://doc.oplist.org/privacy)
- 社区：[github.com/OpenListTeam/OpenList/discussions](https://github.com/OpenListTeam/OpenList/discussions)、[t.me/OpenListTeam](https://t.me/OpenListTeam)

**本文用到的第三方项目**

- [APlayer](https://github.com/MoePlayer/APlayer) / [MetingJS](https://github.com/metowolf/MetingJS) —— 音乐播放器
- [Valine](https://github.com/xCss/Valine) —— 评论系统
- [Granim.js](https://github.com/sarcadass/granim.js) —— 渐变背景
- [霞鹜文楷](https://github.com/lxgw/LxgwWenKai) —— 字体

## 🔗 最后

关于 OpenList 和 AList 的关系，网上情绪化的说法很多。我自己的判断方式是**只采信能查到的东西**：那条 PR 的 330 个反对票、公共 API 被吊销、以及 OpenList 建仓的时间点。至于「被谁收购」这类说法，到现在都没有官方公告，写教程的时候我把它们标成了未验证。

美化部分最值得记的不是某条 CSS，而是**先搞懂注入机制再动手**。知道 `customize_body` 注入时 `#root` 是空的，就理解了为什么大家都要轮询 `.footer`；知道前端用的是 PandaCSS 哈希类名，就明白为什么升级后美化会崩；知道 `<script>` 走 `innerHTML` 不会执行，就不会在「为什么我的 JS 没跑」上浪费一下午。

这也是我在本站其他几篇页面改造教程里反复踩到的同一类坑：**框架的行为都有源码依据，先读源码，再改样式。**
