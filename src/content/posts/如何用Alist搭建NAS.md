---
title: 如何用 AList 搭建个人网盘系统
date: 2025-05-29 14:35:32
tags:
  - NAS
  - AList
  - 网盘
  - 自建
categories:
  - 技术教程
description: 详细介绍如何使用 AList 搭建属于自己的网盘系统，包含安装部署、存储配置、进阶使用等内容
keywords: AList, NAS, 网盘, 自建网盘, 教程
cover: https://upload-bbs.miyoushe.com/upload/2025/05/22/285532152/3042c2c08eca9ed600630afd47bb1c03_8525004275250625784.gif
---

# 使用 AList 搭建个人网盘系统

## 什么是 AList？

AList 是一个支持多存储的文件列表程序，使用 Golang 开发，支持多种存储providers，支持 WebDAV，支持网页浏览和下载，支持文件预览等功能。它可以将多个存储源（如本地存储、各类云盘）整合在一起，通过统一的界面进行管理和访问。

AList 的核心优势在于它能够将分散在各处的存储资源集中管理，让用户可以像使用单一网盘一样操作不同来源的文件，大大提高了文件管理的效率。

## 为什么选择 AList？

- **多存储源整合**：支持超过 20 种存储提供商，包括本地存储、OneDrive、Google Drive、Dropbox、S3、阿里云盘、百度网盘等
- **界面美观，操作简单**：采用现代化设计，响应式布局，支持暗黑模式，操作逻辑清晰
- **强大的文件预览能力**：支持图片、视频、音频、Office 文档、PDF、代码等多种格式的在线预览
- **完整的 WebDAV 支持**：可以通过 WebDAV 协议挂载到各种设备和系统中使用
- **丰富的功能扩展**：支持离线下载、文件分享、加密文件夹、元数据索引等功能
- **开源免费，持续更新**：活跃的开发团队和社区，定期发布新功能和安全更新
- **低资源占用**：即使在配置较低的设备上也能流畅运行
- **多平台支持**：提供 Windows、Linux、macOS、Docker 等多种部署方式

## 安装部署

### 1. 环境准备

在开始安装 AList 之前，需要准备以下环境：

- **系统要求**：
  - Windows 7 及以上版本
  - Linux（任何主流发行版）
  - macOS 10.13 及以上版本
  
- **硬件要求**：
  - CPU: 单核即可满足基本使用
  - 内存: 最低 256MB，推荐 512MB 以上
  - 存储: 至少 50MB 可用空间（不包括存储的文件）

- **网络环境**：
  - 稳定的网络连接
  - 如需外网访问，建议准备固定 IP 或 DDNS 服务
  
- **可选需求**：
  - 域名：用于配置 HTTPS 和更友好的访问地址
  - SSL 证书：用于启用 HTTPS 安全访问
  - 反向代理服务器：如 Nginx、Caddy 等，用于更灵活的访问控制

### 2. 下载安装

根据不同的操作系统，AList 提供了多种安装方式：

#### Windows 安装

```bash
# 下载最新版本
curl -fsSL "https://github.com/alist-org/alist/releases/latest/download/alist-windows-amd64.zip" -o alist.zip

# 解压文件
Expand-Archive -Path alist.zip -DestinationPath ./alist

# 进入解压目录
cd alist

# 启动服务
.\alist.exe server
```

#### Linux 安装（使用官方脚本）

```bash
# 一键安装脚本
curl -fsSL "https://alist.nn.ci/v3.sh" | bash

# 启动服务
systemctl start alist
```

#### Docker 安装

```bash
# 拉取镜像并运行
docker run -d --restart=always -v /opt/alist:/opt/alist/data -p 5244:5244 --name="alist" xhofe/alist:latest

# 查看运行状态
docker ps | grep alist
```

### 3. 初始配置

安装完成后，需要进行初始配置：

1. **访问管理页面**：打开浏览器，访问 `http://127.0.0.1:5244`（本地访问）或 `http://服务器IP:5244`（远程访问）

2. **获取初始管理员密码**：
   ```bash
   # Windows
   .\alist.exe admin

   # Linux
   ./alist admin

   # Docker
   docker exec -it alist ./alist admin
   ```

3. **登录管理面板**：
   - 用户名：admin
   - 密码：上一步获取的初始密码

4. **修改默认密码**：
   - 在管理面板中点击「个人资料」
   - 点击「修改密码」按钮
   - 输入新密码并确认

5. **基本设置**：
   - 站点信息：设置站点标题、描述、关键词等
   - 样式设置：选择主题色、是否启用暗黑模式等
   - 全局设置：配置默认排序方式、隐藏文件规则等

## 存储配置

AList 的核心功能是整合多种存储源，下面详细介绍如何配置各种存储。

### 1. 本地存储

本地存储是最基础的存储类型，直接使用服务器上的文件系统：

1. 在管理面板中点击「存储」→「添加」
2. 选择存储类型为「本地存储」
3. 填写配置信息：
   ```yaml
   存储名称: 本地文件
   挂载路径: /local  # 访问时的路径前缀
   根文件夹路径: /path/to/local/storage  # 实际文件系统路径
   ```
4. 高级选项：
   - 缓存过期时间：根据需要设置，默认为 30 分钟
   - 是否启用签名下载：适用于需要保护文件的场景
   - 是否隐藏文件：可设置正则表达式来隐藏特定文件

### 2. 云存储配置

AList 支持多种云存储服务，以下是几种常见云存储的配置方法：

#### OneDrive 配置

1. **准备工作**：
   - 注册 [Microsoft Azure](https://portal.azure.com/)
   - 创建应用并获取 Client ID 和 Client Secret
   - 设置重定向 URI 为 `http://你的域名或IP:5244/oauth/callback`

2. **AList 配置**：
   ```yaml
   存储名称: OneDrive
   挂载路径: /onedrive
   客户端 ID: 你的Client_ID
   客户端密钥: 你的Client_Secret
   重定向 URI: http://你的域名或IP:5244/oauth/callback
   根目录: /  # 可指定子目录
   ```

3. **授权流程**：
   - 点击「添加」后会生成授权链接
   - 点击链接并登录 Microsoft 账号授权
   - 授权成功后自动返回 AList

#### 阿里云盘配置

1. **获取刷新令牌**：
   - 使用 AList 官方提供的[获取工具](https://alist.nn.ci/tool/aliyundrive/)
   - 登录阿里云盘账号获取 refresh_token

2. **AList 配置**：
   ```yaml
   存储名称: 阿里云盘
   挂载路径: /aliyun
   刷新令牌: 你的refresh_token
   根目录ID: root  # 默认为根目录
   ```

3. **高级选项**：
   - 启用 QR 登录：适用于无法使用常规方式登录的情况
   - 内部上传：启用后可支持大文件上传

#### Google Drive 配置

1. **准备工作**：
   - 访问 [Google Cloud Console](https://console.cloud.google.com/)
   - 创建项目并启用 Google Drive API
   - 创建 OAuth 凭据获取 Client ID 和 Client Secret

2. **AList 配置**：
   ```yaml
   存储名称: Google Drive
   挂载路径: /gdrive
   客户端 ID: 你的Client_ID
   客户端密钥: 你的Client_Secret
   根文件夹ID: 可选，留空表示根目录
   ```

### 3. 存储高级功能

#### 虚拟存储

虚拟存储允许将多个存储源的内容合并显示在一个目录下：

1. 添加虚拟存储：
   ```yaml
   存储名称: 虚拟合并
   挂载路径: /all
   ```

2. 添加需要合并的存储路径：
   ```
   /local:/documents
   /onedrive:/photos
   /aliyun:/videos
   ```

#### 存储策略

为不同的存储配置不同的访问策略：

1. **代理下载**：通过服务器中转文件，适用于无法直接访问的存储
2. **直接链接**：直接返回文件链接，减轻服务器负担
3. **302 重定向**：通过重定向到实际链接，兼顾性能和兼容性
4. **WebDAV 策略**：配置 WebDAV 访问时的行为

## 进阶配置

### 1. 反向代理

使用反向代理可以提供更安全、更灵活的访问方式。

#### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # 重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL 配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    
    # 安全相关头信息
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    
    # 代理设置
    location / {
        proxy_pass http://127.0.0.1:5244;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 大文件上传支持
    client_max_body_size 20G;
}
```

#### Caddy 配置示例（自动 HTTPS）

```
your-domain.com {
    reverse_proxy 127.0.0.1:5244
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
    }
}
```

### 2. SSL 配置

如果不使用反向代理，也可以直接在 AList 中配置 SSL：

1. **准备证书**：
   - 可以使用 Let's Encrypt 等服务获取免费证书
   - 或者使用自签名证书（不推荐用于生产环境）

2. **修改 AList 配置**：
   编辑 `config.json` 文件（位于 AList 数据目录）：
   ```json
   {
     "scheme": {
       "https": true,
       "cert_file": "/path/to/cert.pem",
       "key_file": "/path/to/key.pem"
     },
     "address": "0.0.0.0",
     "port": 5244
   }
   ```

3. **重启 AList 服务**：
   ```bash
   # 重启服务
   systemctl restart alist
   
   # 或 Docker 环境
   docker restart alist
   ```

### 3. WebDAV 使用

AList 提供完整的 WebDAV 支持，可以将存储挂载到各种设备和系统中：

#### WebDAV 地址和凭据

- WebDAV 地址：`https://your-domain.com/dav`
- 用户名：在 AList 管理面板中创建的用户名
- 密码：对应用户的密码

#### 不同客户端的挂载方法

1. **Windows 资源管理器**：
   - 右键「此电脑」→「添加一个网络位置」
   - 输入 WebDAV 地址并提供凭据

2. **RaiDrive（Windows）**：
   - 点击「添加」→选择「WebDAV」
   - 输入地址和凭据，设置驱动器盘符

3. **Rclone（跨平台）**：
   ```bash
   # 配置 WebDAV 连接
   rclone config
   
   # 配置示例
   # name: alist
   # type: webdav
   # url: https://your-domain.com/dav
   # vendor: other
   # user: your-username
   # pass: your-password
   
   # 挂载到本地
   rclone mount alist:/ /path/to/mountpoint
   ```

4. **macOS Finder**：
   - 点击「前往」→「连接服务器」
   - 输入 `http://your-domain.com/dav` 并提供凭据

## 功能特性

### 1. 文件预览

AList 支持多种文件格式的在线预览：

#### 图片预览

- 支持格式：JPG、PNG、GIF、WEBP、BMP 等
- 功能：缩放、旋转、幻灯片播放
- 优化：自动生成缩略图，支持懒加载

#### 视频播放

- 支持格式：MP4、WebM、MKV、AVI 等
- 播放器功能：
  - 倍速播放
  - 画质切换
  - 字幕支持
  - 记忆播放位置
  - 画中画模式

#### 音频播放

- 支持格式：MP3、FLAC、WAV、OGG 等
- 播放器功能：
  - 播放列表
  - 循环模式
  - 音量控制
  - 后台播放

#### 文档预览

- Office 文档：支持 Word、Excel、PowerPoint 等
- PDF 文档：支持页面缩放、搜索、目录导航
- 文本文件：支持语法高亮、行号显示

### 2. 文件管理

AList 提供全面的文件管理功能：

#### 上传/下载

- **上传方式**：
  - 拖放上传
  - 选择文件上传
  - 文件夹上传
  - 远程链接上传
  
- **下载选项**：
  - 单文件下载
  - 多文件打包下载
  - 目录打包下载
  - 离线下载（支持 HTTP、FTP、磁力链接等）

#### 文件操作

- **基础操作**：
  - 复制/移动（支持跨存储）
  - 重命名
  - 删除（支持批量）
  - 新建文件/文件夹
  
- **高级操作**：
  - 在线解压（支持 ZIP、RAR、7Z 等）
  - 在线压缩
  - 文件复制链接
  - 文件分享（支持密码和有效期）

### 3. 权限控制

AList 提供多层次的权限控制系统：

#### 用户管理

- **用户类型**：
  - 管理员：拥有所有权限
  - 普通用户：根据分配的权限访问
  - 访客：仅有只读权限
  
- **用户设置**：
  - 基本信息：用户名、密码、邮箱等
  - 权限分配：可读、可写、可分享等
  - 存储空间限制：可设置用户配额

#### 路径权限

- **目录级别权限**：
  - 可为每个路径设置不同的访问权限
  - 支持继承上级目录权限
  
- **密码保护**：
  - 为特定目录设置访问密码
  - 支持密码有效期设置

#### 访问控制

- **IP 限制**：
  - 白名单/黑名单机制
  - 支持 IP 段设置
  
- **下载限制**：
  - 速率限制
  - 并发连接数限制
  - 单用户下载量限制

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 无法启动服务 | 1. 检查端口是否被占用：`netstat -ano \| findstr 5244`<br>2. 检查配置文件是否正确<br>3. 查看日志文件：`./data/log/xxx.log` |
| 存储添加失败 | 1. 验证账号密钥是否正确<br>2. 检查网络连接是否正常<br>3. 确认 API 访问权限是否开启 |
| 文件无法预览 | 1. 确认文件格式是否支持<br>2. 检查浏览器是否阻止了预览<br>3. 尝试更新预览插件 |
| WebDAV 连接失败 | 1. 确认用户名密码是否正确<br>2. 检查 URL 格式<br>3. 确认网络环境是否支持 WebDAV |
| 上传文件失败 | 1. 检查文件大小是否超过限制<br>2. 确认存储空间是否足够<br>3. 验证用户是否有上传权限 |
| 同步问题 | 1. 手动刷新元数据缓存<br>2. 设置适当的缓存过期时间<br>3. 检查存储源连接是否稳定 |

## 进阶使用

### 1. API 调用

AList 提供了完整的 API 接口，可以通过程序调用：

#### RESTful API

基本 API 格式：`https://your-domain.com/api/xxx`

常用 API 示例：
```javascript
// 获取文件列表
fetch('/api/fs/list', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: '/path/to/folder' })
})

// 上传文件
const formData = new FormData();
formData.append('file', fileObject);
formData.append('path', '/path/to/upload');
fetch('/api/fs/put', {
  method: 'PUT',
  body: formData
})
```

#### WebDAV API

除了标准 WebDAV 协议外，AList 还提供了扩展的 WebDAV API：

```
PROPFIND /dav/path - 获取文件属性
GET /dav/path - 下载文件
PUT /dav/path - 上传文件
DELETE /dav/path - 删除文件
MKCOL /dav/path - 创建目录
```

#### 自定义脚本

可以使用各种编程语言编写脚本，实现自动化操作：

```python
# Python 示例：自动同步文件
import requests
import os

# 登录获取 token
r = requests.post('https://your-domain.com/api/auth/login', json={
    'username': 'admin',
    'password': 'your_password'
})
token = r.json()['data']['token']

# 上传文件
def upload_file(local_path, remote_path):
    with open(local_path, 'rb') as f:
        files = {'file': f}
        headers = {'Authorization': token}
        r = requests.put(
            f'https://your-domain.com/api/fs/put',
            headers=headers,
            data={'path': remote_path},
            files=files
        )
        return r.json()

# 使用示例
upload_file('/local/path/file.txt', '/remote/path/file.txt')
```

### 2. 定时任务

AList 支持设置定时任务，实现自动化管理：

#### 缓存刷新

```yaml
任务名称: 刷新缓存
类型: 刷新缓存
路径: /onedrive
cron表达式: 0 0 * * * # 每小时执行一次
```

#### 元数据更新

```yaml
任务名称: 更新元数据
类型: 更新索引
路径: /aliyun/movies
cron表达式: 0 0 3 * * * # 每天凌晨3点执行
```

#### 文件同步

```yaml
任务名称: 文件同步
类型: 脚本执行
内容: |
  #!/bin/bash
  rclone sync /local/backup remote:/backup
cron表达式: 0 0 2 * * * # 每天凌晨2点执行
```

### 3. 性能优化

为了获得更好的性能，可以进行以下优化：

#### 使用 CDN

1. **配置 CDN**：
   - 将域名解析到 CDN 提供商
   - 设置源站为 AList 服务器地址
   - 配置缓存规则（建议缓存静态资源，不缓存 API）

2. **AList 设置**：
   - 在管理面板中设置「站点 URL」为 CDN 域名
   - 启用「签名下载」以保护文件安全

#### 开启缓存

1. **元数据缓存**：
   - 在存储设置中配置合适的缓存过期时间
   - 对于不经常变化的存储，可设置较长的缓存时间

2. **文件缓存**：
   - 启用本地缓存功能
   - 配置缓存目录和大小限制
   - 设置缓存清理策略

#### 限制并发

1. **下载并发限制**：
   - 设置全局最大并发下载数
   - 配置单用户并发下载限制

2. **上传优化**：
   - 启用分片上传
   - 配置合适的分片大小
   - 设置上传缓冲区大小

## 参考资源

- [AList 官方文档](https://alist.nn.ci/)：最全面的使用指南和 API 文档
- [AList GitHub](https://github.com/alist-org/alist)：源代码仓库，可以查看最新更新和提交问题
- [AList 官方论坛](https://github.com/alist-org/alist/discussions)：交流使用经验和问题解决方案
- [WebDAV 协议](https://tools.ietf.org/html/rfc4918)：了解 WebDAV 协议的详细规范
- [Docker 文档](https://docs.docker.com/)：Docker 部署相关参考
- [Nginx 文档](https://nginx.org/en/docs/)：配置反向代理的详细指南

## 进阶扩展

### 1. 与其他系统集成

#### 与 Jellyfin/Emby 集成

通过 WebDAV 将 AList 作为媒体源：
1. 在 Jellyfin 中添加媒体库
2. 选择「通过网络」添加媒体文件夹
3. 输入 WebDAV 地址和凭据
4. 设置媒体类型和扫描选项

#### 与 Obsidian 集成

将 AList 作为 Obsidian 的远程存储：
1. 在 Obsidian 中安装「Remote」插件
2. 配置 WebDAV 连接
3. 同步笔记和附件

### 2. 移动端使用

AList 提供响应式设计，可以在移动设备上使用：

1. **移动浏览器访问**：
   - 直接访问 AList 网址
   - 添加到主屏幕以获得类似 App 的体验

2. **第三方 WebDAV 客户端**：
   - iOS: Documents by Readdle
   - Android: Solid Explorer, X-plore

### 3. 备份与迁移

定期备份 AList 数据是很重要的：

1. **数据备份**：
   ```bash
   # 备份数据目录
   tar -czf alist_backup_$(date +%Y%m%d).tar.gz /opt/alist/data
   
   # 备份数据库
   cp /opt/alist/data/data.db alist_db_backup_$(date +%Y%m%d).db
   ```

2. **配置迁移**：
   - 复制 `config.json` 和 `data.db` 到新服务器
   - 确保路径和权限设置正确
   - 启动新实例并验证功能

---