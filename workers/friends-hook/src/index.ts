/**
 * 友链自助申请接收端（独立 Cloudflare Worker）
 *
 * 为什么单独一个 Worker，而不是做成 Astro 的动态路由：
 *   1. 本站是纯静态 SSG，加了动态路由后构建会变成 client/ + server/ 双目录，
 *      整个部署链路（wrangler assets 目录、scripts/site-root.ts 的探测逻辑）都要跟着改，
 *      风险远大于收益；
 *   2. Waline 的 WEBHOOK 只是往一个 URL POST 一条 JSON，不需要和站点同域；
 *   3. 这个 Worker 崩了也不影响博客本身。
 *
 * 路由：
 *   POST /hook          Waline WEBHOOK 的接收端（必须返回 JSON 体，Waline 会对响应 .json()）
 *   GET  /api/links     已通过的友链列表，供前端 fetch 合并展示（?format=ts 输出配置片段）
 *   GET  /health        健康检查
 *   GET  /admin         审核页（需要 ADMIN_TOKEN）
 *   POST /admin/review  审核动作（approve / reject）
 */

import { checkBacklink, hostOf, isSafePublicUrl } from "./backlink";
import { findMissing, parseApplication } from "./parse";
import type { PublicLink } from "./store";
import {
	approveApplication,
	findDuplicate,
	getApplication,
	listApplications,
	listPublicLinks,
	rejectApplication,
	saveApplication,
} from "./store";
import type { Env, FriendApplication } from "./types";

/** 统一 JSON 响应。Waline 会对 webhook 响应调用 .json()，所以这里必须返回合法 JSON。 */
function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			// Waline 后端在 Vercel，跨域调用审核接口时用得上
			"access-control-allow-origin": "*",
			"cache-control": "no-store",
		},
	});
}

/** 常量时间比较，避免口令被计时侧信道猜解 */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** 从请求里取口令：Authorization: Bearer / x-admin-token 头 / token 查询参数 */
function tokenFrom(request: Request): string {
	const auth = request.headers.get("authorization") ?? "";
	if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
	return (
		request.headers.get("x-admin-token") ??
		new URL(request.url).searchParams.get("token") ??
		""
	);
}

function isAdmin(request: Request, env: Env): boolean {
	if (!env.ADMIN_TOKEN) return false;
	return safeEqual(tokenFrom(request), env.ADMIN_TOKEN);
}

/** 用 Waline 自己的接口核验评论确实存在，防止有人伪造 webhook 打进来 */
async function verifyCommentExists(
	env: Env,
	objectId: string | number,
): Promise<{ ok: boolean; note: string }> {
	if (env.VERIFY_COMMENT === "0") return { ok: true, note: "已关闭核验" };
	if (!env.WALINE_SERVER)
		return { ok: true, note: "未配置 Waline 地址，跳过核验" };

	const url = `${env.WALINE_SERVER.replace(/\/+$/, "")}/comment?path=${encodeURIComponent(
		env.APPLY_PATH || "/friends/",
	)}&pageSize=100`;
	try {
		const resp = await fetch(url, {
			signal: AbortSignal.timeout(8000),
			headers: { accept: "application/json" },
		});
		if (!resp.ok)
			return { ok: false, note: `Waline 返回 ${resp.status}，核验失败` };
		const data = (await resp.json()) as { data?: { objectId?: number }[] };
		const found = (data.data ?? []).some(
			(c) => String(c.objectId) === String(objectId),
		);
		return found
			? { ok: true, note: "已在 Waline 核验评论存在" }
			: { ok: false, note: "在 Waline 未找到该评论，可能是伪造请求" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, note: `核验 Waline 失败：${message}` };
	}
}

/** Waline webhook 的 payload 形状（只用到的部分） */
interface WalineWebhookPayload {
	type?: string;
	data?: {
		comment?: {
			objectId?: number;
			comment?: string;
			nick?: string;
			link?: string;
			url?: string;
			status?: string;
			insertedAt?: string;
		};
		reply?: unknown;
	};
}

/**
 * 处理 Waline WEBHOOK。
 *
 * **立即返回，重活丢给 waitUntil。** 原因：Waline 的 webhook 调用是
 * `fetch(...).then(resp => resp.json())`，既没有超时也没有重试；而反链检测要抓
 * 申请者站点，实测慢站首包能到 20s+。如果在这里同步等检测跑完，Waline 的请求
 * 就会一直挂着。所以先回 200（Waline 只要求响应体是合法 JSON），再由
 * `ctx.waitUntil` 在后台完成核验、解析、反链检测与入库。
 */
async function handleHook(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	let payload: WalineWebhookPayload;
	try {
		payload = (await request.json()) as WalineWebhookPayload;
	} catch {
		return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
	}

	// Waline 只有一个事件
	if (payload.type !== "new_comment") {
		return json({ ok: true, skipped: `忽略事件 ${payload.type ?? "(空)"}` });
	}

	const comment = payload.data?.comment;
	if (!comment) return json({ ok: true, skipped: "payload 里没有 comment" });

	// 只处理发到友链页的评论
	const applyPath = env.APPLY_PATH || "/friends/";
	const commentPath = comment.url ?? "";
	if (applyPath && commentPath !== applyPath) {
		return json({ ok: true, skipped: `评论路径 ${commentPath} 不是友链页` });
	}

	const id = String(comment.objectId ?? "");
	if (!id) return json({ ok: true, skipped: "评论没有 objectId" });

	// 已处理过就跳过（Waline 不重试，但手工重放时能防重）
	const existing = await getApplication(env.FRIENDS_KV, id);
	if (existing)
		return json({
			ok: true,
			skipped: `申请 ${id} 已存在`,
			status: existing.status,
		});

	ctx.waitUntil(ingest(env, comment, id));
	return json({ ok: true, id, queued: true });
}

/** 后台完成核验 → 解析 → 反链检测 → 入库 */
async function ingest(
	env: Env,
	comment: NonNullable<NonNullable<WalineWebhookPayload["data"]>["comment"]>,
	id: string,
): Promise<void> {
	try {
		const verify = await verifyCommentExists(env, id);
		if (!verify.ok) {
			console.warn(`[friends-hook] 核验失败，丢弃 ${id}：${verify.note}`);
			return;
		}

		const raw = comment.comment ?? "";
		const { parsed, unparsed } = parseApplication(raw);
		const missing = findMissing(parsed);
		const duplicateOf = parsed.siteurl
			? await findDuplicate(env.FRIENDS_KV, parsed.siteurl)
			: undefined;

		// 反链检测：抓对方站点找本站 host。失败不影响入库，只作为审核证据。
		const timeoutMs = Number(env.BACKLINK_TIMEOUT_MS ?? "5000") || 5000;
		const backlink =
			parsed.siteurl && isSafePublicUrl(parsed.siteurl)
				? await checkBacklink(parsed.siteurl, hostOf(env.SITE_URL), timeoutMs)
				: { ok: false, checkedUrl: "", note: "没有可检测的站点地址" };

		const application: FriendApplication = {
			id,
			createdAt: comment.insertedAt ?? new Date().toISOString(),
			nick: comment.nick ?? "匿名",
			link: comment.link ?? "",
			raw,
			parsed,
			unparsed,
			complete: missing.length === 0,
			missing,
			backlink,
			status: "pending",
			...(duplicateOf ? { duplicateOf } : {}),
		};

		await saveApplication(env.FRIENDS_KV, application);
		console.log(
			`[friends-hook] 已入库 ${id} complete=${application.complete} backlink=${backlink.ok}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[friends-hook] 处理 ${id} 失败：${message}`);
	}
}

/**
 * 生成可直接粘进 `src/config/friendsConfig.ts` 的友链条目。
 *
 * 为什么需要它：`friends.astro` 的友链数据是构建时读的静态数组
 * （`getEnabledFriends()`），审核通过只写进了 KV，站点并不知道。所以审核页要能
 * 一键导出配置片段，粘过去重新部署即可上线。这是「零改造」路线下最短的闭环。
 */
function toConfigSnippet(links: PublicLink[]): string {
	if (links.length === 0) return "// 暂无已通过的友链";
	return links
		.map(
			(link) => `	{
		title: ${JSON.stringify(link.name)},
		imgurl: ${JSON.stringify(link.avatar)},
		desc: ${JSON.stringify(link.desc)},
		siteurl: ${JSON.stringify(link.siteurl)},
		tags: ["Friend"],
		weight: 1,
		enabled: true,
	},`,
		)
		.join("\n");
}

/** GET /api/links —— 已通过的友链，前端可直接 fetch */
async function handlePublicLinks(
	request: Request,
	env: Env,
): Promise<Response> {
	const links = await listPublicLinks(env.FRIENDS_KV);
	const format = new URL(request.url).searchParams.get("format");
	if (format === "ts") {
		return new Response(toConfigSnippet(links), {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"access-control-allow-origin": "*",
				"cache-control": "no-store",
			},
		});
	}
	return json({ ok: true, count: links.length, data: links });
}

/** GET /admin —— 审核页 */
async function handleAdminPage(request: Request, env: Env): Promise<Response> {
	if (!isAdmin(request, env)) {
		return new Response(adminLoginPage(), {
			status: 401,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}
	const apps = await listApplications(env.FRIENDS_KV);
	return new Response(adminPage(apps, env), {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

/** POST /admin/review —— 审核动作 */
async function handleReview(request: Request, env: Env): Promise<Response> {
	if (!isAdmin(request, env))
		return json({ ok: false, error: "口令错误" }, 401);

	let body: { id?: string; action?: string; note?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
	}

	const id = body.id ?? "";
	const action = body.action ?? "";
	const note = body.note ?? "";
	if (!id) return json({ ok: false, error: "缺少 id" }, 400);

	const app = await getApplication(env.FRIENDS_KV, id);
	if (!app) return json({ ok: false, error: `找不到申请 ${id}` }, 404);

	if (action === "approve") {
		if (app.missing.length > 0) {
			return json(
				{ ok: false, error: `字段不完整，缺少：${app.missing.join("、")}` },
				400,
			);
		}
		const updated = await approveApplication(
			env.FRIENDS_KV,
			app,
			note || "审核通过",
		);
		return json({ ok: true, status: updated.status, id });
	}
	if (action === "reject") {
		const updated = await rejectApplication(
			env.FRIENDS_KV,
			app,
			note || "未通过审核",
		);
		return json({ ok: true, status: updated.status, id });
	}
	return json({ ok: false, error: `未知动作 ${action}` }, 400);
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods": "GET,POST,OPTIONS",
					"access-control-allow-headers":
						"content-type,authorization,x-admin-token",
					"access-control-max-age": "43200",
				},
			});
		}

		try {
			if (pathname === "/hook" && request.method === "POST")
				return await handleHook(request, env, ctx);
			if (pathname === "/api/links" && request.method === "GET")
				return await handlePublicLinks(request, env);
			if (pathname === "/admin" && request.method === "GET")
				return await handleAdminPage(request, env);
			if (pathname === "/admin/review" && request.method === "POST")
				return await handleReview(request, env);
			if (pathname === "/health") {
				return json({
					ok: true,
					kv: Boolean(env.FRIENDS_KV),
					applyPath: env.APPLY_PATH || "/friends/",
					time: new Date().toISOString(),
				});
			}
			return json({ ok: false, error: "Not Found", path: pathname }, 404);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return json({ ok: false, error: message }, 500);
		}
	},
} satisfies ExportedHandler<Env>;

/** 未登录时的提示页 */
function adminLoginPage(): string {
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>友链审核 · 需要口令</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;color:#1f2937}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head><body>
<h1>需要口令</h1>
<p>请在地址后面加上 <code>?token=你的口令</code>，或设置请求头 <code>x-admin-token</code>。</p>
</body></html>`;
}

/** 审核页：一个自包含的静态页面，动作走 fetch 打 /admin/review */
function adminPage(apps: FriendApplication[], env: Env): string {
	const escapeHtml = (value: string): string =>
		value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	const pending = apps.filter((app) => app.status === "pending");
	const handled = apps.filter((app) => app.status !== "pending");
	// 已通过但还没粘进 friendsConfig.ts 的，就是「待上线」——管理员照这段片段粘过去
	const approved = apps.filter((app) => app.status === "approved");

	const card = (app: FriendApplication): string => {
		const { parsed } = app;
		const flags: string[] = [];
		if (app.missing.length > 0)
			flags.push(
				`<span class="flag bad">缺字段：${escapeHtml(app.missing.join("、"))}</span>`,
			);
		if (app.duplicateOf)
			flags.push(
				`<span class="flag bad">疑似重复（已存在 ${escapeHtml(app.duplicateOf)}）</span>`,
			);
		if (app.backlink.ok)
			flags.push(`<span class="flag good">反链已找到</span>`);
		else flags.push(`<span class="flag warn">反链未确认</span>`);

		return `<article class="card" data-id="${escapeHtml(app.id)}">
  <header>
    <strong>${escapeHtml(parsed.name || "(未识别站点名)")}</strong>
    <span class="meta">#${escapeHtml(app.id)} · ${escapeHtml(app.nick)} · ${escapeHtml(app.createdAt)} · ${escapeHtml(app.status)}</span>
  </header>
  <ul class="fields">
    <li>站点名称：${escapeHtml(parsed.name)}</li>
    <li>站点描述：${escapeHtml(parsed.desc)}</li>
    <li>站点链接：<a href="${escapeHtml(parsed.siteurl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(parsed.siteurl)}</a></li>
    <li>头像链接：<a href="${escapeHtml(parsed.avatar)}" target="_blank" rel="noopener noreferrer">${escapeHtml(parsed.avatar)}</a></li>
    <li>邮箱：${escapeHtml(parsed.email || "(未填)")}</li>
  </ul>
  <p class="flags">${flags.join(" ")}</p>
  <p class="note">反链检测：${escapeHtml(app.backlink.note)}${app.backlink.checkedUrl ? ` · <a href="${escapeHtml(app.backlink.checkedUrl)}" target="_blank" rel="noopener noreferrer">检测地址</a>` : ""}</p>
  ${app.unparsed.length > 0 ? `<details><summary>未识别的行（${app.unparsed.length}）</summary><pre>${escapeHtml(app.unparsed.join("\n"))}</pre></details>` : ""}
  ${
		app.status === "pending"
			? `<div class="actions">
      <button data-action="approve">通过</button>
      <button data-action="reject" class="danger">拒绝</button>
      <input data-note placeholder="审核备注（可选）">
    </div>`
			: `<p class="note">审核备注：${escapeHtml(app.reviewNote ?? "")}</p>`
	}
  <details><summary>原始评论</summary><pre>${escapeHtml(app.raw)}</pre></details>
</article>`;
	};

	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>友链审核 · ${escapeHtml(env.SITE_NAME || "本站")}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:0 auto;padding:24px 20px 80px;line-height:1.6}
h1{font-size:1.4rem}
.card{border:1px solid #d1d5db;border-radius:10px;padding:14px 16px;margin:14px 0}
.card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
.meta{font-size:.8rem;opacity:.7}
.fields{margin:10px 0;padding-left:0;list-style:none;font-size:.9rem}
.flags{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.flag{font-size:.75rem;padding:2px 8px;border-radius:999px;border:1px solid}
.flag.good{color:#065f46;border-color:#6ee7b7;background:#ecfdf5}
.flag.warn{color:#92400e;border-color:#fcd34d;background:#fffbeb}
.flag.bad{color:#991b1b;border-color:#fca5a5;background:#fef2f2}
.note{font-size:.8rem;opacity:.8;margin:6px 0}
.actions{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
button{padding:6px 14px;border-radius:8px;border:1px solid #9ca3af;background:transparent;cursor:pointer;font:inherit}
button.danger{color:#b91c1c;border-color:#fca5a5}
input{flex:1;min-width:160px;padding:6px 10px;border-radius:8px;border:1px solid #9ca3af;background:transparent;font:inherit}
pre{white-space:pre-wrap;word-break:break-word;font-size:.8rem;opacity:.85}
details{margin-top:8px;font-size:.85rem}
h2{font-size:1.1rem;margin-top:32px}
.snippet{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;overflow:auto;max-height:340px}
@media(prefers-color-scheme:dark){.snippet{background:#111827;border-color:#374151}}
</style></head><body>
<h1>友链审核 · ${escapeHtml(env.SITE_NAME || "本站")}</h1>
<p class="note">共 ${apps.length} 条，待审 ${pending.length} 条。审核通过后会写入 KV，并出现在下方的配置片段里。</p>
<h2>待审（${pending.length}）</h2>
${pending.length ? pending.map(card).join("\n") : `<p class="note">没有待审申请。</p>`}
<h2>已通过（${approved.length}）· 待粘进 friendsConfig.ts</h2>
${
	approved.length
		? `<p class="note">把下面的条目粘进 <code>src/config/friendsConfig.ts</code> 的 <code>friendsConfig</code> 数组，然后重新部署即可上线。</p>
<div class="snippet"><pre id="snippet">${escapeHtml(toConfigSnippet(approved.map((app) => ({ ...app.parsed, id: app.id, approvedAt: app.reviewedAt ?? app.createdAt }))))}</pre></div>
<div class="actions"><button id="copy-snippet" type="button">复制片段</button></div>`
		: `<p class="note">还没有通过的申请。</p>`
}
<h2>已处理（${handled.length}）</h2>
${handled.length ? handled.map(card).join("\n") : `<p class="note">暂无记录。</p>`}
<script>
const TOKEN = new URL(location.href).searchParams.get("token") || "";
document.addEventListener("click", async (event) => {
  const copyBtn = event.target.closest("#copy-snippet");
  if (copyBtn) {
    const text = document.getElementById("snippet")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = "复制片段"; }, 1500);
    } catch {
      alert("复制失败，请手动选中复制");
    }
    return;
  }

  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const card = btn.closest(".card");
  const id = card.dataset.id;
  const note = card.querySelector("[data-note]")?.value || "";
  btn.disabled = true;
  try {
    const resp = await fetch("/admin/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ id, action: btn.dataset.action, note }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "操作失败");
    location.reload();
  } catch (error) {
    alert("操作失败：" + error.message);
    btn.disabled = false;
  }
});
</script>
</body></html>`;
}
