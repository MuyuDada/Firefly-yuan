# 项目长期记忆

## 样式变量约定（重要）

主题色变量定义在 `src/styles/variables.styl`：

- 文字主色是 **`--deep-text`**（`oklch(0.25 0.02 var(--hue))`），**注意 `:root.dark` 块里没有重新定义它**，深色模式下仍是深墨色，不能直接拿来做正文颜色。
- 项目里**没有** `--text-color`、`--font-active-sans`、`--glass-control-border` 这几个变量（移植外部主题页面时最容易踩）。
- 可用的主题变量：`--primary`、`--card-bg`、`--muted`、`--line-divider`、`--line-color`、`--content-meta`、`--page-bg`、`--radius-large`、`--duration-normal`、`--ease-standard`、`--ease-decelerate`。
- 深色判定统一用 `:root.dark`（Layout.astro 通过 `document.documentElement.classList.add("dark")` 切换），主题值存 `localStorage["theme"]`，可选 `light | dark | system`。

结论：从其他 Firefly 衍生主题搬运页面时，凡是 `var(--text-color)` 都要替换或在本页面作用域内自行定义一套会随主题反转的颜色变量。

## Umami Cloud 的公开数据接口（重要）

`cloud.umami.is` 只托管前端页面，**不是 API 域名**。数据网关是：

```
https://gateway-us.umami.is
```

- `GET /api/share/{shareId}` → 返回 `{ shareId, websiteId, token }`
- `GET /api/websites/{websiteId}/{stats|pageviews|metrics|sessions/...}`，需带 header：
  `x-umami-share-token: <token>` 和 `x-umami-share-context: 1`
- 分享页实际请求可在 `https://cloud.umami.is/share/<id>` 用 CDP 抓 Network 确认

因此 `analyticsConfig.umamiAnalytics.shareApiBase` 填 `https://gateway-us.umami.is`，
填 `https://cloud.umami.is` 会导致 `/api/share/...` 返回 404 HTML。

## 构建注意事项

- `pnpm build` 的 `preinstall` 强制 pnpm；Node 版本要求 `>=22.23.0`。
- `pnpm build` 后置脚本 `subset-fonts.ts` 在本机环境下会长时间挂起，日常验证用 `npx astro build` 即可。
- `dist` 目录在构建期间会被占用，重命名/删除前要先停掉预览服务。
