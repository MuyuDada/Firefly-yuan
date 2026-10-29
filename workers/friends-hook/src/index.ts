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
 *   GET  /captcha       站内申请表单的算术验证码
 *   POST /apply         站内申请表单的直接提交（不走 Waline 评论）
 *   GET  /api/links     已通过的友链列表，供前端 fetch 合并展示（?format=ts 输出配置片段）
 *   GET  /health        健康检查
 *   GET  /admin         审核页（需要 ADMIN_TOKEN）
 *   POST /admin/review  审核动作（approve / reject）
 */

import { checkBacklink, hostOf, isSafePublicUrl } from "./backlink";
import { issueCaptcha, verifyCaptcha } from "./captcha";
import { type ApplyPayload, validateApply } from "./form";
import { mailReady, notifyNewApplication } from "./mail";
import { findMissing, parseApplication } from "./parse";
import { clientIp, consumeQuota } from "./rate";
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
import { buildReplyRequest, replyViaWaline } from "./waline";

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
			/** 父评论 id —— 非空说明这条是回复，不是新申请 */
			pid?: number | null;
			/** 根评论 id —— 同上 */
			rid?: number | null;
			/** "administrator" / "author" 表示站长自己发的 */
			type?: string;
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

	const notApplication = rejectReason(comment);
	if (notApplication) return json({ ok: true, skipped: notApplication });

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
	options: { skipVerify?: boolean } = {},
): Promise<void> {
	try {
		// 定时轮询拿到的评论，来源本身就是 Waline 接口，不需要再核验一次
		if (!options.skipVerify) {
			const verify = await verifyCommentExists(env, id);
			if (!verify.ok) {
				console.warn(`[friends-hook] 核验失败，丢弃 ${id}：${verify.note}`);
				return;
			}
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

		// 新申请通知博主。ingest 本身跑在 waitUntil / cron 里，这里直接 await 即可
		await notifyNewApplication(env, application);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[friends-hook] 处理 ${id} 失败：${message}`);
	}
}

/** Waline 评论对象的形状（从 webhook payload 里取，去掉可选的 undefined） */
type WalineComment = NonNullable<
	NonNullable<WalineWebhookPayload["data"]>["comment"]
>;

/**
 * 判断一条友链页评论「不是友链申请」，返回跳过原因；是申请则返回 null。
 *
 * 为什么需要：站长自己在友链页回复「已添加」同样会触发 webhook，也会出现在轮询
 * 结果里。若不拦掉，这些回复会被当成申请解析（通常解析不出任何字段），在审核页
 * 堆成一串垃圾。判据两条，任一命中即跳过：
 *  - `pid`/`rid` 非空 —— Waline 里只有回复才有父评论 id；
 *  - `type` 是 `administrator`/`author` —— 站长自己发的评论。
 */
function rejectReason(comment: WalineComment): string | null {
	const replyTo = comment.pid ?? comment.rid;
	if (replyTo) return `这是对 #${replyTo} 的回复，不是新申请`;
	if (comment.type === "administrator" || comment.type === "author") {
		return "站长的评论，跳过";
	}
	return null;
}

/**
 * 定时轮询：直接从 Waline 拉友链页评论，把还没入库的补进来。
 *
 * 为什么需要它：Waline 的 WEBHOOK 配在 Vercel 那边的环境变量里，改它要动 Waline
 * 服务本身；而轮询只需要这个 Worker 自己跑 cron，不依赖任何外部配置。两条路可以
 * 并存（谁先到谁入库，另一条会因为 `app:<id>` 已存在而跳过），也可以只用轮询。
 *
 * 代价：评论从提交到出现在审核页最多延迟一个 cron 周期（默认 15 分钟）。
 */
async function handleScheduled(env: Env, ctx: ExecutionContext): Promise<void> {
	const applyPath = env.APPLY_PATH || "/friends/";
	const base = (env.WALINE_SERVER || "").replace(/\/+$/, "");
	if (!base) {
		console.warn("[friends-hook] 未配置 WALINE_SERVER，轮询跳过");
		return;
	}

	const url = `${base}/comment?path=${encodeURIComponent(applyPath)}&pageSize=100`;
	let comments: WalineComment[];
	try {
		const resp = await fetch(url, {
			signal: AbortSignal.timeout(15000),
			headers: { accept: "application/json" },
		});
		if (!resp.ok) {
			console.error(`[friends-hook] 轮询 Waline 返回 ${resp.status}`);
			return;
		}
		const payload = (await resp.json()) as { data?: WalineComment[] };
		comments = payload.data ?? [];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[friends-hook] 轮询 Waline 失败：${message}`);
		return;
	}

	const fresh: { comment: WalineComment; id: string }[] = [];
	for (const comment of comments) {
		const id = String(comment?.objectId ?? "");
		if (!id) continue;
		// 站长的「已添加」回复不是申请，别入库
		if (rejectReason(comment)) continue;
		// 已在库里（无论 pending / approved / rejected）就不再重复处理
		if (await getApplication(env.FRIENDS_KV, id)) continue;
		fresh.push({ comment, id });
	}

	if (fresh.length === 0) return;
	console.log(`[friends-hook] 轮询发现 ${fresh.length} 条新申请`);

	// 逐条串行处理：反链检测要抓外部站点，并发太多既慢又容易被打回
	for (const { comment, id } of fresh) {
		await ingest(env, comment, id, { skipVerify: true });
	}
	ctx.waitUntil(Promise.resolve());
}

/**
 * 生成单条可直接粘进 `src/config/friendsConfig.ts` 的友链条目。
 *
 * `tags` 固定给 "Blog"：`FriendCard.astro` 的 `TAG_LABELS` 只映射
 * Blog / Docs / Home / Framework 四个，未命中的 tag 会原样显示英文。
 */
function toConfigEntry(link: PublicLink): string {
	return `	{
		title: ${JSON.stringify(link.name)},
		imgurl: ${JSON.stringify(link.avatar)},
		desc: ${JSON.stringify(link.desc)},
		siteurl: ${JSON.stringify(link.siteurl)},
		tags: ["Blog"],
		weight: 1,
		enabled: true,
	},`;
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
	return links.map(toConfigEntry).join("\n");
}

/**
 * GET /captcha —— 出一道具算术题。
 *
 * 为什么需要：`/apply` 是个对公网开放的写接口。没有这道题，任何人写个循环就能把
 * 审核页刷满。算术题挡不住有心人，但挡得住「顺手写个脚本」这一类。
 *
 * 同时按 IP 限额，避免有人把验证码接口当随机数生成器刷 KV 写入额度。
 */
async function handleCaptcha(request: Request, env: Env): Promise<Response> {
	const ip = clientIp(request);
	const denied = await consumeQuota(env.FRIENDS_KV, ip, "cap", env);
	if (denied) return json({ ok: false, error: denied }, 429);

	const { id, question } = await issueCaptcha(env.FRIENDS_KV);
	return json({ ok: true, id, question });
}

/** 给表单提交生成的记录 id —— 加前缀，和 Waline 的数字 objectId 区分开 */
function formId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `form-${hex}`;
}

/**
 * POST /apply —— 站内表单直接提交。
 *
 * 与 `/hook` 的区别：那边是「Waline 评论 → 解析文本」，这边是「表单字段 → 直接用」。
 * 两条路的产物是同一种 `FriendApplication`，所以审核页、`/api/links`、审核动作都
 * 不需要任何改动。`nick` 记成「表单申请」，`raw` 存一份可读的文本快照，方便人工核对。
 *
 * 反链检测放在 `ctx.waitUntil` 里：它要抓外部站点，实测慢站首包 20s+，同步等会让
 * 用户对着转圈等半天。申请本身已经入库，检测结果随后补写。
 */
async function handleApply(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (env.ENABLE_FORM === "0") {
		return json({ ok: false, error: "站内申请已关闭。" }, 403);
	}

	let payload: ApplyPayload;
	try {
		payload = (await request.json()) as ApplyPayload;
	} catch {
		return json({ ok: false, error: "请求体不是合法 JSON。" }, 400);
	}

	const validated = validateApply(payload);
	if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

	const ip = clientIp(request);
	// 先验验证码：它是一次性的，验完即删；额度在验证码通过后才扣，
	// 免得用户填错一次就白扣一次配额。
	const captchaOk = await verifyCaptcha(
		env.FRIENDS_KV,
		validated.captchaId,
		validated.captchaAnswer,
	);
	if (!captchaOk) {
		return json({ ok: false, error: "验证码不对，请重新获取。" }, 400);
	}

	const denied = await consumeQuota(env.FRIENDS_KV, ip, "apply", env);
	if (denied) return json({ ok: false, error: denied }, 429);

	const { parsed } = validated;
	// 用共享的 REQUIRED_FIELDS 算一遍，别硬编码 —— 以后改了必填项两边不会脱节
	const missing = findMissing(parsed);
	const duplicateOf = await findDuplicate(env.FRIENDS_KV, parsed.siteurl);
	// 已经在友链列表里的站点直接回绝，省得审核页堆重复条目；
	// 只是「另一个待审申请撞了同一站点」的则照常入库，由审核页标出来让人判断。
	if (duplicateOf) {
		const other = await getApplication(env.FRIENDS_KV, duplicateOf);
		if (other?.status === "approved") {
			return json({ ok: false, error: "这个站点已经在友链列表里了。" }, 409);
		}
	}
	const id = formId();
	const now = new Date().toISOString();

	const application: FriendApplication = {
		id,
		createdAt: now,
		nick: "表单申请",
		link: "",
		raw: [
			`站点名称：${parsed.name}`,
			`站点描述：${parsed.desc}`,
			`站点链接：${parsed.siteurl}`,
			`头像链接：${parsed.avatar}`,
			parsed.email ? `邮箱：${parsed.email}` : "",
		]
			.filter(Boolean)
			.join("\n"),
		parsed,
		unparsed: [],
		complete: missing.length === 0,
		missing,
		backlink: { ok: false, checkedUrl: "", note: "检测中" },
		status: "pending",
		...(duplicateOf ? { duplicateOf } : {}),
	};

	await saveApplication(env.FRIENDS_KV, application);
	console.log(`[friends-hook] 表单申请已入库 ${id} (${parsed.siteurl})`);

	// 反链检测放后台，结果回写同一条记录
	ctx.waitUntil(
		(async () => {
			try {
				const timeoutMs = Number(env.BACKLINK_TIMEOUT_MS ?? "8000") || 8000;
				const backlink = isSafePublicUrl(parsed.siteurl)
					? await checkBacklink(parsed.siteurl, hostOf(env.SITE_URL), timeoutMs)
					: { ok: false, checkedUrl: "", note: "没有可检测的站点地址" };
				const current = await getApplication(env.FRIENDS_KV, id);
				// 审核员可能在检测跑完前就处理掉了，那就别再覆盖状态
				if (current?.status !== "pending") return;
				const updated = { ...current, backlink };
				await saveApplication(env.FRIENDS_KV, updated);
				console.log(
					`[friends-hook] 表单申请 ${id} 反链检测完成 ok=${backlink.ok}`,
				);
				// 等反链有结论再发信，博主收到时就能直接看到检测结果
				await notifyNewApplication(env, updated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[friends-hook] 表单申请 ${id} 反链检测失败：${message}`);
				// 反链检测挂了也要让博主知道有人申请，否则这条就彻底没声了
				await notifyNewApplication(env, application);
			}
		})(),
	);

	return json({
		ok: true,
		id,
		message: "申请已提交，审核通过后会显示在友链列表里。",
		...(duplicateOf ? { duplicate: true } : {}),
	});
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
		// 回复由浏览器发（Worker 出站到同 zone + 外部源站会被 CF 挡住），
		// 这里只把请求体算好交给审核页
		return json({
			ok: true,
			status: updated.status,
			id,
			reply: buildReplyRequest(env, updated, true),
		});
	}
	if (action === "reject") {
		const updated = await rejectApplication(
			env.FRIENDS_KV,
			app,
			note || "未通过审核",
		);
		return json({
			ok: true,
			status: updated.status,
			id,
			reply: buildReplyRequest(env, updated, false),
		});
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
			if (pathname === "/captcha" && request.method === "GET")
				return await handleCaptcha(request, env);
			if (pathname === "/apply" && request.method === "POST")
				return await handleApply(request, env, ctx);
			if (pathname === "/api/links" && request.method === "GET")
				return await handlePublicLinks(request, env);
			if (pathname === "/admin" && request.method === "GET")
				return await handleAdminPage(request, env);
			if (pathname === "/admin/review" && request.method === "POST")
				return await handleReview(request, env);
			// 诊断：单独跑一次「回复通知」，把失败原因原样返回，便于排查
			// 生产日志不方便看时（比如 wrangler tail 连不上），用这个接口定位
			if (pathname === "/admin/notify-test" && request.method === "POST") {
				if (!isAdmin(request, env))
					return json({ ok: false, error: "口令错误" }, 401);
				let body: {
					id?: string;
					approved?: boolean;
					probe?: boolean | string;
				};
				try {
					body = (await request.json()) as typeof body;
				} catch {
					return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
				}
				// probe：探测 Worker 到某个地址的连通性，不写任何数据
				// probe 传 true 时测 Waline，传字符串时测该地址（仅管理员可用，本地排查用）
				if (body.probe) {
					const base = (env.WALINE_SERVER ?? "").replace(/\/+$/, "");
					const defaultUrl = `${base}/comment?path=${encodeURIComponent(env.APPLY_PATH || "/friends/")}&pageSize=5`;
					const url =
						typeof body.probe === "string" ? body.probe : defaultUrl;
					try {
						const resp = await fetch(url, {
							headers: { accept: "application/json" },
						});
						const text = await resp.text();
						return json({
							probe: "GET",
							url,
							status: resp.status,
							contentType: resp.headers.get("content-type"),
							head: text.slice(0, 160),
						});
					} catch (error) {
						return json({
							probe: "GET",
							url,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
				const app = await getApplication(env.FRIENDS_KV, body.id ?? "");
				if (!app) return json({ ok: false, error: "找不到该申请" }, 404);
				const result = await replyViaWaline(
					env,
					app,
					body.approved !== false,
				);
				return json({
					ok: result.ok,
					result,
					env: {
						hasAdminEmail: Boolean(env.ADMIN_EMAIL),
						walineServer: env.WALINE_SERVER ?? null,
						applyPath: env.APPLY_PATH ?? null,
						enabled: env.ENABLE_WALINE_REPLY !== "0",
					},
				});
			}
			// 手动触发一次轮询，便于部署后立刻验证，不用等 cron
			if (pathname === "/admin/poll" && request.method === "POST") {
				if (!isAdmin(request, env))
					return json({ ok: false, error: "口令错误" }, 401);
				await handleScheduled(env, ctx);
				return json({ ok: true, polled: true });
			}
			if (pathname === "/health") {
				return json({
					ok: true,
					kv: Boolean(env.FRIENDS_KV),
					applyPath: env.APPLY_PATH || "/friends/",
					// 邮件通道：没配好时这里会是 false，据此排查通知不生效的原因
					mail: mailReady(env),
					channel: env.RESEND_API_KEY
						? "resend"
						: env.EMAIL
							? "cloudflare"
							: "none",
					notifyApply: env.NOTIFY_ON_APPLY !== "0",
					notifyReview: env.NOTIFY_ON_REVIEW !== "0",
					// 审核后是否走 Waline 评论回复（评论申请专用）
					walineReply: env.ENABLE_WALINE_REPLY !== "0",
					time: new Date().toISOString(),
				});
			}
			return json({ ok: false, error: "Not Found", path: pathname }, 404);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return json({ ok: false, error: message }, 500);
		}
	},
	/** cron 触发：兜底轮询 Waline，不依赖 WEBHOOK 环境变量 */
	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		await handleScheduled(env, ctx);
	},
} satisfies ExportedHandler<Env>;

/** HTML 转义。审核页里所有来自申请者的内容都要过这一层。 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** 从 URL 里取出用于展示的主机名 */
function hostLabel(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** 相对时间。审核页每次都是服务端现渲染，所以在这里算就够了 */
function timeAgo(iso: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return iso;
	const minutes = Math.round((Date.now() - then) / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} 天前`;
	return iso.slice(0, 10);
}

/** 审核页里三个状态的展示文案 */
const STATUS_LABEL: Record<FriendApplication["status"], string> = {
	pending: "待审",
	approved: "已通过",
	rejected: "已拒绝",
};

/**
 * 审核页的共用样式。
 *
 * 页面是自包含的（内联 style + 内联 script），不引任何外部资源 —— 审核页地址本身
 * 不公开，没必要为它维护一套构建流程；而且它在 Cloudflare 边缘渲染，多一个外链
 * 就多一次可能失败的首屏阻塞。
 */
const ADMIN_STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f5f6f8; --card:#fff; --text:#111827; --muted:#6b7280; --border:#e5e7eb;
  --soft:#f3f4f6; --accent:#4f46e5; --accent-soft:#eef2ff;
  --good:#047857; --good-bg:#ecfdf5; --good-bd:#a7f3d0;
  --warn:#b45309; --warn-bg:#fffbeb; --warn-bd:#fde68a;
  --bad:#b91c1c;  --bad-bg:#fef2f2;  --bad-bd:#fecaca;
  --shadow:0 1px 2px rgb(0 0 0 / 4%),0 8px 24px -12px rgb(0 0 0 / 12%);
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:#0b1020; --card:#151a2d; --text:#e8eaf2; --muted:#98a2b8; --border:#272e4a;
    --soft:#1c2238; --accent:#818cf8; --accent-soft:#1e2447;
    --good:#6ee7b7; --good-bg:#0d2b23; --good-bd:#1c5c4a;
    --warn:#fcd34d; --warn-bg:#2b2410; --warn-bd:#5c4a15;
    --bad:#fca5a5;  --bad-bg:#2b1416;  --bad-bd:#5c2225;
    --shadow:0 1px 2px rgb(0 0 0 / 30%),0 10px 30px -14px rgb(0 0 0 / 60%);
  }
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{
  background:var(--accent-soft);color:var(--accent);
  padding:1px 5px;border-radius:5px;font-size:.85em;
}

/* ── 顶栏 ── */
.topbar{
  position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--border);
}
.topbar-inner{
  max-width:1080px;margin:0 auto;padding:14px 20px;
  display:flex;align-items:center;gap:16px;flex-wrap:wrap;
}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:1.05rem}
.brand .dot{
  width:9px;height:9px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent);
}
.brand small{font-weight:400;color:var(--muted);font-size:.82rem}
.stats{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
.stat{
  display:flex;align-items:baseline;gap:6px;padding:5px 12px;border-radius:999px;
  background:var(--soft);border:1px solid var(--border);font-size:.8rem;color:var(--muted);
}
.stat b{font-size:.95rem;color:var(--text);font-variant-numeric:tabular-nums}
.stat.is-pending b{color:var(--warn)}
.stat.is-approved b{color:var(--good)}

/* ── 工具条 ── */
.toolbar{
  max-width:1080px;margin:0 auto;padding:18px 20px 0;
  display:flex;gap:12px;align-items:center;flex-wrap:wrap;
}
.tabs{
  display:flex;gap:4px;background:var(--soft);padding:4px;border-radius:12px;
  border:1px solid var(--border);max-width:100%;overflow-x:auto;scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  border:0;background:transparent;color:var(--muted);font:inherit;font-size:.85rem;
  padding:6px 14px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;
  transition:background .15s,color .15s;
  white-space:nowrap;flex:none;
}
.tab:hover{color:var(--text)}
.tab.is-active{background:var(--card);color:var(--text);box-shadow:var(--shadow)}
.tab [data-count]{
  font-size:.72rem;font-variant-numeric:tabular-nums;opacity:.75;
  background:color-mix(in srgb,currentColor 12%,transparent);padding:0 6px;border-radius:999px;
}
.search{
  flex:1;min-width:200px;padding:9px 14px;border-radius:11px;
  border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;font-size:.88rem;
}
.search:focus{outline:2px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:1px}

main{max-width:1080px;margin:0 auto;padding:18px 20px 96px}
.list{display:grid;gap:14px}

/* ── 卡片 ── */
.card{
  background:var(--card);border:1px solid var(--border);border-radius:16px;
  padding:16px 18px;box-shadow:var(--shadow);transition:opacity .2s,transform .2s;
}
.card[hidden]{display:none}
.card.is-leaving{opacity:0;transform:translateY(-6px)}
.card-top{display:flex;gap:13px;align-items:flex-start}
.avatar{
  position:relative;flex:none;width:46px;height:46px;border-radius:13px;overflow:hidden;
  background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;
  font-weight:650;font-size:1.15rem;text-transform:uppercase;border:1px solid var(--border);
}
.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.head{min-width:0;flex:1}
.head h3{margin:0;font-size:1rem;font-weight:650;overflow-wrap:anywhere}
.head .host{font-size:.82rem;color:var(--muted)}
.badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:100%}
.flag{
  font-size:.72rem;padding:2px 9px;border-radius:999px;border:1px solid;
  white-space:nowrap;line-height:1.7;
}
.flag.good{color:var(--good);border-color:var(--good-bd);background:var(--good-bg)}
.flag.warn{color:var(--warn);border-color:var(--warn-bd);background:var(--warn-bg)}
.flag.bad{color:var(--bad);border-color:var(--bad-bd);background:var(--bad-bg)}
.flag.plain{color:var(--muted);border-color:var(--border);background:var(--soft)}

.desc{margin:11px 0 0;font-size:.9rem;color:var(--muted);overflow-wrap:anywhere}
.meta-row{
  display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;
  font-size:.78rem;color:var(--muted);
}
.meta-row .sep{opacity:.4}
.links{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
.chip{
  font-size:.78rem;padding:3px 11px;border-radius:9px;border:1px solid var(--border);
  background:var(--soft);color:var(--text);
}
.chip:hover{border-color:var(--accent);color:var(--accent);text-decoration:none}
.backlink{
  margin:11px 0 0;font-size:.8rem;color:var(--muted);
  padding:9px 12px;border-radius:10px;background:var(--soft);border:1px solid var(--border);
  overflow-wrap:anywhere;
}
details{margin-top:10px}
details summary{
  cursor:pointer;font-size:.82rem;color:var(--muted);user-select:none;
  padding:3px 0;list-style:none;
}
details summary::-webkit-details-marker{display:none}
details summary::before{content:"▸ ";display:inline-block;transition:transform .15s}
details[open] summary::before{transform:rotate(90deg)}
details summary:hover{color:var(--text)}
details pre{
  margin:8px 0 0;padding:11px 13px;border-radius:10px;background:var(--soft);
  border:1px solid var(--border);white-space:pre-wrap;word-break:break-word;
  font-size:.78rem;color:var(--muted);max-height:260px;overflow:auto;
}

.actions{display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap}
.btn{
  padding:7px 17px;border-radius:10px;border:1px solid var(--border);background:var(--card);
  color:var(--text);font:inherit;font-size:.85rem;font-weight:500;cursor:pointer;
  transition:filter .15s,opacity .15s;
}
.btn:hover:not(:disabled){filter:brightness(1.04)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.danger{color:var(--bad);border-color:var(--bad-bd);background:var(--bad-bg)}
.note-input{
  flex:1;min-width:170px;padding:7px 12px;border-radius:10px;
  border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;font-size:.85rem;
}
.review-note{margin:12px 0 0;font-size:.82rem;color:var(--muted)}

/* ── 配置片段 ── */
.section-title{
  display:flex;align-items:center;gap:9px;margin:32px 0 12px;
  font-size:1rem;font-weight:650;
}
.section-title .badge{
  font-size:.72rem;font-weight:500;color:var(--accent);background:var(--accent-soft);
  border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);
  padding:1px 9px;border-radius:999px;
}
.pending{
  background:var(--card);border:1px solid var(--border);border-radius:16px;
  box-shadow:var(--shadow);overflow:hidden;
}
.pending-head{
  display:flex;gap:14px;align-items:center;padding:14px 18px;
  border-bottom:1px solid var(--border);
}
.pending-head p{margin:0;font-size:.85rem;color:var(--muted);flex:1;min-width:0}
.pending-head .btn{flex:none}
.pending-list{display:flex;flex-direction:column}
.pending-item{
  display:flex;align-items:center;gap:13px;padding:12px 18px;
  border-bottom:1px solid var(--border);
}
.pending-item:last-child{border-bottom:0}
.pending-item:hover{background:var(--soft)}
.pending-item .avatar{width:38px;height:38px;border-radius:11px;font-size:1rem}
.pending-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pending-info strong{font-size:.92rem;font-weight:600;overflow-wrap:anywhere}
.pending-info .host{font-size:.8rem;color:var(--accent)}
.pending-info .meta{font-size:.75rem;color:var(--muted);overflow-wrap:anywhere}
.pending-item .btn{flex:none}
#snippet{
  margin:0;padding:14px 16px;border-radius:11px;background:var(--soft);
  border:1px solid var(--border);white-space:pre;overflow:auto;max-height:360px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem;line-height:1.7;
}
#snippet[hidden]{display:none}
.empty{
  text-align:center;padding:56px 20px;color:var(--muted);font-size:.9rem;
  border:1px dashed var(--border);border-radius:16px;
}
.empty[hidden]{display:none}

/* ── 提示条 ── */
#toast{
  position:fixed;left:50%;bottom:28px;transform:translate(-50%,14px);
  background:var(--text);color:var(--bg);padding:10px 20px;border-radius:11px;
  font-size:.85rem;box-shadow:var(--shadow);opacity:0;pointer-events:none;
  transition:opacity .2s,transform .2s;z-index:50;
}
#toast.is-show{opacity:1;transform:translate(-50%,0)}

@media(max-width:620px){
  .topbar-inner{padding:12px 16px;gap:10px}
  .brand{font-size:1rem}
  .stats{width:100%;margin-left:0}
  .stat{padding:4px 10px}
  .toolbar{padding:14px 16px 0;gap:10px}
  .tabs{width:100%}
  .search{min-width:0}
  main{padding:14px 16px 72px}
  .card{padding:14px}
  .card-top{flex-wrap:wrap;gap:11px}
  .badges{justify-content:flex-start;width:100%}
  .avatar{width:42px;height:42px}
  .actions{gap:7px}
  .btn{padding:8px 16px;flex:1;min-width:0}
  .note-input{min-width:100%;order:3}
  .pending-head{padding:12px 14px;flex-wrap:wrap}
  .pending-head .btn{width:100%}
  .pending-item{padding:11px 14px;gap:11px}
  .pending-item .avatar{width:34px;height:34px}
  #snippet{font-size:.72rem}
}
`;

/** 未登录时的提示页 */
function adminLoginPage(): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>友链审核 · 需要口令</title>
<style>
${ADMIN_STYLE}
.gate{max-width:480px;margin:14vh auto;padding:0 20px}
.gate .box{
  background:var(--card);border:1px solid var(--border);border-radius:16px;
  padding:28px;box-shadow:var(--shadow);
}
.gate h1{margin:0 0 10px;font-size:1.15rem}
.gate p{margin:0 0 12px;color:var(--muted);font-size:.88rem;line-height:1.75}
.gate p:last-child{margin-bottom:0}
</style>
</head>
<body>
<div class="gate">
  <div class="box">
    <h1>需要口令</h1>
    <p>请在地址后面加上 <code>?token=你的口令</code>，或设置请求头 <code>x-admin-token</code>。</p>
    <p>口令由 <code>wrangler secret put ADMIN_TOKEN</code> 写入 Worker 环境，不会存在仓库里。</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * 审核页：一个自包含的静态页面，动作走 fetch 打 /admin/review。
 *
 * 所有卡片一次渲染完，靠 data-status 做前端筛选 —— 申请量是个人博客量级，
 * 不需要分页，但「待审 / 已通过 / 已拒绝」这个切换是每天都用的，所以做成了
 * 即时过滤而不是三个页面。
 */
function adminPage(apps: FriendApplication[], env: Env): string {
	const pending = apps.filter((app) => app.status === "pending");
	const approved = apps.filter((app) => app.status === "approved");
	const rejected = apps.filter((app) => app.status === "rejected");

	/** 已通过的记录转成 PublicLink，供配置片段生成用 */
	const approvedLinks: PublicLink[] = approved.map((app) => ({
		...app.parsed,
		id: app.id,
		approvedAt: app.reviewedAt ?? app.createdAt,
	}));
	const snippetText = toConfigSnippet(approvedLinks);

	/**
	 * 「待上线」区的一行：一条已通过的友链 = 一张小卡 + 单独的复制按钮。
	 *
	 * 原来是一个大 <pre> 把所有条目堆在一起，条数一多就得靠肉眼在里面找某一条。
	 * 拆成每行一条之后，每条能单独复制，也能一眼看到头像和域名对不对。
	 */
	const approvedItem = (app: FriendApplication): string => {
		const { parsed } = app;
		const snippet = toConfigEntry({
			...parsed,
			id: app.id,
			approvedAt: app.reviewedAt ?? app.createdAt,
		});
		return `<div class="pending-item">
    <div class="avatar">${
			parsed.avatar
				? `<img src="${escapeHtml(parsed.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
				: ""
		}<span>${escapeHtml((parsed.name || "友").slice(0, 1))}</span></div>
    <div class="pending-info">
      <strong>${escapeHtml(parsed.name || "(未识别站点名)")}</strong>
      <span class="host">${
				parsed.siteurl ? escapeHtml(hostLabel(parsed.siteurl)) : "(无站点链接)"
			}</span>
      <span class="meta">${escapeHtml(timeAgo(app.reviewedAt ?? app.createdAt))}${
				app.reviewNote ? ` · ${escapeHtml(app.reviewNote)}` : ""
			}</span>
    </div>
    <button class="btn" data-copy-entry type="button" data-snippet="${escapeHtml(snippet)}">复制</button>
  </div>`;
	};

	const card = (app: FriendApplication): string => {
		const { parsed } = app;
		const flags: string[] = [];

		if (app.missing.length > 0) {
			flags.push(
				`<span class="flag bad">缺字段：${escapeHtml(app.missing.join("、"))}</span>`,
			);
		}
		if (app.duplicateOf) {
			flags.push(
				`<span class="flag bad">疑似重复 ${escapeHtml(app.duplicateOf)}</span>`,
			);
		}
		if (app.backlink.ok) {
			flags.push(`<span class="flag good">反链已找到</span>`);
		} else {
			flags.push(`<span class="flag warn">反链未确认</span>`);
		}
		if (app.status !== "pending") {
			flags.push(
				`<span class="flag plain">${escapeHtml(STATUS_LABEL[app.status])}</span>`,
			);
		}

		const siteurl = parsed.siteurl || "";
		const avatar = parsed.avatar || "";
		const email = parsed.email || "";
		const name = parsed.name || "";
		// 前端搜索用的索引：站名、域名、邮箱、简介、id、来源昵称
		const searchIndex = [
			name,
			siteurl,
			hostLabel(siteurl),
			email,
			parsed.desc,
			app.id,
			app.nick,
		]
			.join(" ")
			.toLowerCase();

		const links: string[] = [];
		if (siteurl) {
			links.push(
				`<a class="chip" href="${escapeHtml(siteurl)}" target="_blank" rel="noopener noreferrer">访问站点</a>`,
			);
		}
		if (avatar) {
			links.push(
				`<a class="chip" href="${escapeHtml(avatar)}" target="_blank" rel="noopener noreferrer">查看头像</a>`,
			);
		}
		if (email) {
			links.push(
				`<a class="chip" href="mailto:${escapeHtml(email)}">写邮件</a>`,
			);
		}
		if (app.backlink.checkedUrl) {
			links.push(
				`<a class="chip" href="${escapeHtml(app.backlink.checkedUrl)}" target="_blank" rel="noopener noreferrer">检测地址</a>`,
			);
		}

		return `<article class="card" data-id="${escapeHtml(app.id)}" data-status="${escapeHtml(app.status)}" data-search="${escapeHtml(searchIndex)}">
  <div class="card-top">
    <div class="avatar">
      ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <span>${escapeHtml((name || "友").slice(0, 1))}</span>
    </div>
    <div class="head">
      <h3>${escapeHtml(name || "(未识别站点名)")}</h3>
      <div class="host">${
				siteurl
					? `<a href="${escapeHtml(siteurl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostLabel(siteurl))}</a>`
					: "(无站点链接)"
			}</div>
    </div>
    <div class="badges">${flags.join("")}</div>
  </div>
  ${parsed.desc ? `<p class="desc">${escapeHtml(parsed.desc)}</p>` : ""}
  <div class="meta-row">
    <span>#${escapeHtml(app.id)}</span>
    <span class="sep">·</span>
    <span>来源 ${escapeHtml(app.nick || "匿名")}</span>
    <span class="sep">·</span>
    <span title="${escapeHtml(app.createdAt)}">${escapeHtml(timeAgo(app.createdAt))}</span>
    ${email ? `<span class="sep">·</span><span>${escapeHtml(email)}</span>` : ""}
  </div>
  ${links.length > 0 ? `<div class="links">${links.join("")}</div>` : ""}
  <p class="backlink">反链检测：${escapeHtml(app.backlink.note || "未检测")}</p>
  ${
		app.unparsed.length > 0
			? `<details><summary>未识别的行（${app.unparsed.length}）</summary><pre>${escapeHtml(app.unparsed.join("\n"))}</pre></details>`
			: ""
	}
  ${
		app.status === "pending"
			? `<div class="actions">
    <button class="btn primary" data-action="approve" type="button">通过</button>
    <button class="btn danger" data-action="reject" type="button">拒绝</button>
    <input class="note-input" data-note placeholder="审核备注（可选，会记进 KV）" maxlength="200">
  </div>`
			: app.reviewNote
				? `<p class="review-note">审核备注：${escapeHtml(app.reviewNote)}</p>`
				: ""
	}
  <details><summary>原始内容</summary><pre>${escapeHtml(app.raw)}</pre></details>
</article>`;
	};

	// 默认落在「待审」；没有待审就直接给全部，免得一进来看到空列表
	const initialTab = pending.length > 0 ? "pending" : "all";
	const tab = (name: string, label: string, count: number): string =>
		`<button class="tab${name === initialTab ? " is-active" : ""}" data-tab="${name}" type="button">${label}<span data-count>${count}</span></button>`;

	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>友链审核 · ${escapeHtml(env.SITE_NAME || "本站")}</title>
<style>
${ADMIN_STYLE}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="dot"></span>
      <span>友链审核</span>
      <small>${escapeHtml(env.SITE_NAME || "本站")}</small>
    </div>
    <div class="stats">
      <span class="stat is-pending"><b>${pending.length}</b>待审</span>
      <span class="stat is-approved"><b>${approved.length}</b>已通过</span>
      <span class="stat"><b>${rejected.length}</b>已拒绝</span>
      <span class="stat"><b>${apps.length}</b>全部</span>
    </div>
  </div>
</header>

<div class="toolbar">
  <div class="tabs" role="tablist">
    ${tab("pending", "待审", pending.length)}
    ${tab("approved", "已通过", approved.length)}
    ${tab("rejected", "已拒绝", rejected.length)}
    ${tab("all", "全部", apps.length)}
  </div>
  <input class="search" id="q" type="search" placeholder="搜索站名 / 域名 / 邮箱 / 备注…" autocomplete="off">
</div>

<main>
  <div class="list" id="list">
    ${apps.length ? apps.map(card).join("\n") : ""}
  </div>
  <div class="empty" id="empty"${apps.length ? " hidden" : ""}>没有符合条件的申请。</div>

  ${
		approved.length
			? `<div class="section-title">待上线<span class="badge">${approved.length}</span></div>
  <div class="pending">
    <div class="pending-head">
      <p>把条目粘进 <code>src/config/friendsConfig.ts</code> 的 <code>friendsConfig</code> 数组，再重新部署即可生效 —— 友链列表是构建时读取的静态数组。</p>
      <button class="btn" id="copy-all" type="button">复制全部</button>
    </div>
    <div class="pending-list">
      ${approved.map(approvedItem).join("\n")}
    </div>
    <pre id="snippet" hidden>${escapeHtml(snippetText)}</pre>
  </div>`
			: ""
	}
</main>

<div id="toast" role="status" aria-live="polite"></div>

<script>
const TOKEN = new URL(location.href).searchParams.get("token") || "";
const list = document.getElementById("list");
const cards = Array.from(list.querySelectorAll(".card"));
const tabs = Array.from(document.querySelectorAll("[data-tab]"));
const search = document.getElementById("q");
const empty = document.getElementById("empty");
const toastEl = document.getElementById("toast");
let filter = ${JSON.stringify(initialTab)};

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("is-show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("is-show"), 2200);
}

/** 按当前 tab + 搜索词过滤卡片，并把计数刷进 tab 上的小徽章 */
function applyFilter() {
  const term = (search.value || "").trim().toLowerCase();
  let shown = 0;
  for (const card of cards) {
    const statusOk = filter === "all" || card.dataset.status === filter;
    const termOk = !term || card.dataset.search.includes(term);
    const visible = statusOk && termOk;
    card.hidden = !visible;
    if (visible) shown++;
  }
  empty.hidden = shown > 0 || cards.length === 0;
  for (const tab of tabs) {
    const name = tab.dataset.tab;
    const count = cards.filter((card) => {
      const statusOk = name === "all" || card.dataset.status === name;
      const termOk = !term || card.dataset.search.includes(term);
      return statusOk && termOk;
    }).length;
    const badge = tab.querySelector("[data-count]");
    if (badge) badge.textContent = String(count);
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    filter = tab.dataset.tab;
    for (const other of tabs) other.classList.toggle("is-active", other === tab);
    applyFilter();
  });
}
search.addEventListener("input", applyFilter);
applyFilter();

// 审核后要整页刷新（片段和计数都要重算），但记住滚动位置，
// 免得审完一条就被弹回页面顶部，还得重新滚下去。
const SCROLL_KEY = "friends-admin-scroll";
try {
  const saved = sessionStorage.getItem(SCROLL_KEY);
  if (saved) {
    sessionStorage.removeItem(SCROLL_KEY);
    requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
  }
} catch {}

document.addEventListener("click", async (event) => {
  const copyEntry = event.target.closest("[data-copy-entry]");
  if (copyEntry) {
    const text = copyEntry.dataset.snippet || "";
    try {
      await navigator.clipboard.writeText(text);
      copyEntry.textContent = "已复制";
      toast("这条配置已复制到剪贴板");
      setTimeout(() => { copyEntry.textContent = "复制"; }, 1500);
    } catch {
      toast("复制失败，请手动选中复制");
    }
    return;
  }

  const copyAll = event.target.closest("#copy-all");
  if (copyAll) {
    const text = document.getElementById("snippet")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      copyAll.textContent = "已复制";
      toast("全部配置片段已复制到剪贴板");
      setTimeout(() => { copyAll.textContent = "复制全部"; }, 1500);
    } catch {
      toast("复制失败，请手动选中复制");
    }
    return;
  }

  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const card = btn.closest(".card");
  const id = card.dataset.id;
  const note = card.querySelector("[data-note]")?.value || "";
  const action = btn.dataset.action;
  if (action === "reject" && !confirm("确定拒绝这条申请吗？")) return;

  const buttons = Array.from(card.querySelectorAll("button[data-action]"));
  for (const other of buttons) other.disabled = true;
  btn.textContent = action === "approve" ? "通过中…" : "拒绝中…";

  try {
    const resp = await fetch("/admin/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ id, action, note }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "操作失败");
    // 回复由浏览器发出去：Worker 出站到同 zone 且源站在外部的地址会被
    // Cloudflare 拦（400 / error code 1053），浏览器走 CF 代理则没问题。
    if (data.reply && data.reply.url) {
      btn.textContent = action === "approve" ? "通知申请人…" : "通知申请人…";
      try {
        const r = await fetch(data.reply.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data.reply.body),
        });
        if (!r.ok) toast("审核已生效，但评论回复失败（HTTP " + r.status + "）");
      } catch (e) {
        toast("审核已生效，但评论回复失败：" + (e.message || "网络错误"));
      }
    }
    card.classList.add("is-leaving");
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch {}
    setTimeout(() => location.reload(), 220);
  } catch (error) {
    toast("操作失败：" + (error.message || "未知错误"));
    for (const other of buttons) other.disabled = false;
    btn.textContent = action === "approve" ? "通过" : "拒绝";
  }
});
</script>
</body>
</html>`;
}
