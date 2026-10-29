/**
 * 通过 Waline 评论接口「借道」发通知。
 *
 * 背景：Waline 只有两个发信触发点 —— 新评论通知博主、回复通知被回复者。
 * 它没有「给任意地址发一封自定义邮件」的接口，所以想复用它已经配好的 SMTP，
 * 唯一可行的办法就是：审核通过/拒绝时，替博主去申请人那条评论下面回一句。
 *
 * 适用条件：必须是**评论路径**来的申请（id 是 Waline 的 objectId）。
 * 站内表单提交的申请 id 形如 `form-xxxxxxxx`，没有可回复的父评论，这里直接跳过。
 *
 * 副作用（用之前要想清楚）：
 *   1. 这条回复会公开显示在友链页 —— 好处是访客能看到「已收录」的结果
 *   2. Akismet 默认开启，带链接的自动回复可能被判 spam 吞掉，需要把 Waline 的
 *      `AKISMET_KEY` 设为 `false`（个人博客的友链页本来也没什么垃圾评论压力）
 *   3. 邮件样式由 Waline 的 `MAIL_TEMPLATE` 决定，这里改不了
 */

import type { Env, FriendApplication } from "./types";

/** 表单申请的 id 前缀，用来区分来源 */
const FORM_ID_PREFIX = "form-";

/** 这条申请是不是评论路径来的（有可回复的父评论） */
export function hasSourceComment(app: FriendApplication): boolean {
	return Boolean(app.id) && !app.id.startsWith(FORM_ID_PREFIX);
}

/** 回评正文：审核通过 / 未通过 */
function buildReplyText(app: FriendApplication, approved: boolean): string {
	const note = (app.reviewNote ?? "").trim();
	const name = app.parsed.name || app.parsed.siteurl || "你的站点";

	if (approved) {
		const lines = [
			"**友链已收录** ✅",
			"",
			`感谢申请，\`${name}\` 已经出现在友链页上了。`,
		];
		if (note && note !== "审核通过") lines.push("", `备注：${note}`);
		return lines.join("\n");
	}

	const lines = ["**这次没有通过**", ""];
	lines.push(note ? `原因：${note}` : "站点上暂时没找到本站友链。");
	lines.push("", "补上之后随时可以重新申请～");
	return lines.join("\n");
}

export interface WalineReplyResult {
	ok: boolean;
	/** 失败原因，便于日志排查 */
	error?: string;
	/** 跳过时的说明 */
	skipped?: string;
}

/**
 * 替博主回复申请人那条评论。
 *
 * 用的是 Waline 的匿名评论接口 `POST /api/comment`，通过 `pid` 指定父评论，
 * Waline 就会按「被回复」的逻辑给 `parent.mail` 发通知。
 *
 * 注意：如果 Waline 服务端设了 `LOGIN=force`（强制登录才能评论），匿名 POST 会失败，
 * 这时只能退化到邮件通道。
 */
export async function replyViaWaline(
	env: Env,
	app: FriendApplication,
	approved: boolean,
): Promise<WalineReplyResult> {
	if (env.ENABLE_WALINE_REPLY === "0") return { ok: false, skipped: "开关已关闭" };
	if (!hasSourceComment(app)) return { ok: false, skipped: "表单申请没有父评论" };

	const server = (env.WALINE_SERVER ?? "").trim().replace(/\/+$/, "");
	if (!server) return { ok: false, skipped: "未配置 WALINE_SERVER" };

	// 昵称与邮箱：邮箱用博主自己的，Waline 会据此认定这条评论是博主发的，
	// 避免再给自己发一封「新评论通知」
	const nick = (env.WALINE_REPLY_NICK ?? "").trim() || "友链助手";
	const mail = (env.ADMIN_EMAIL ?? "").trim();
	if (!mail) return { ok: false, skipped: "未配置 ADMIN_EMAIL" };

	const url = env.APPLY_PATH || "/friends/";
	const payload = {
		comment: buildReplyText(app, approved),
		nick,
		mail,
		link: env.SITE_URL ?? "",
		url,
		// pid 指向被回复的评论；rid 是根评论。
		// 友链申请都是 /friends/ 下的顶层评论，所以根评论就是它自己。
		pid: app.id,
		rid: app.id,
		at: app.nick,
		ua: "friends-hook (+https://github.com/MuyuDada/Firefly-yuan)",
	};

	try {
		const response = await fetch(`${server}/api/comment`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				// Waline 默认走 CORS 校验，带上来源更稳妥
				origin: env.SITE_URL ?? "",
				referer: `${(env.SITE_URL ?? "").replace(/\/+$/, "")}${url}`,
			},
			body: JSON.stringify(payload),
		});

		const text = await response.text().catch(() => "");
		if (!response.ok) {
			return { ok: false, error: `HTTP ${response.status}：${text.slice(0, 200)}` };
		}
		// Waline 成功时返回新建的评论对象；401/429 等异常可能仍是 200，
		// 所以这里再看一眼有没有 errno
		if (text.includes('"errno"')) {
			return { ok: false, error: text.slice(0, 200) };
		}
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}
