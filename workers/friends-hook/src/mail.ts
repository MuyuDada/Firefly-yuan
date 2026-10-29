/**
 * 邮件通知：新申请通知博主、审核结果通知申请人。
 *
 * 两种发信通道，配了哪个用哪个（都配则优先 Resend）：
 *   1) RESEND_API_KEY + MAIL_FROM → Resend HTTP API
 *   2) EMAIL 绑定 + MAIL_FROM     → Cloudflare send_email binding
 * 两者都没配时静默跳过，不影响申请与审核流程。
 *
 * 所有函数都不抛错：邮件失败只写日志，绝不能把申请/审核动作带崩。
 */

import type { Env, FriendApplication } from "./types";

/** 站点主题色，和站点 / Waline 邮件保持一致 */
const ACCENT = "#5b6cf0";

export interface MailMessage {
	to: string;
	subject: string;
	html: string;
	text?: string;
}

/** 邮件通道是否可用 */
export function mailReady(env: Env): boolean {
	return Boolean(env.MAIL_FROM) && Boolean(env.RESEND_API_KEY || env.EMAIL);
}

function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function trimUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

/** 邮箱正文外壳：卡片 + 顶部主题色细线，邮件客户端兼容写法 */
function shell(params: {
	siteName: string;
	eyebrow: string;
	title: string;
	meta?: string;
	body: string;
	footer: string;
}): string {
	const meta = params.meta
		? `<div style="margin-top:8px;font-size:13px;line-height:1.6;color:#8b93a7;">${params.meta}</div>`
		: "";
	return `<div style="margin:0;padding:24px 12px;background:#eef0f6;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="height:4px;background:${ACCENT};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 0;">
<div style="font-size:11px;letter-spacing:0.18em;color:#9aa3b8;text-transform:uppercase;">${esc(params.eyebrow)}</div>
<div style="margin-top:12px;font-size:20px;line-height:1.4;font-weight:700;color:#151a2d;">${params.title}</div>
${meta}
</td></tr>
${params.body}
<tr><td style="padding:26px 28px 24px;">
<div style="padding-top:16px;border-top:1px solid #edf0f7;font-size:12px;line-height:1.7;color:#9aa3b8;">${params.footer}</div>
</td></tr>
</table>
</div>`;
}

/** 正文里的一段引用 / 说明块 */
function quote(text: string, muted = false): string {
	const bg = muted ? "#f7f8fa" : "#f5f6ff";
	const border = muted ? "#dbdfe9" : ACCENT;
	const color = muted ? "#7b8496" : "#2f3646";
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:14px 16px;background:${bg};border-left:3px solid ${border};border-radius:0 10px 10px 0;font-size:14px;line-height:1.8;color:${color};">${text}</td></tr></table>`;
}

/** 胶囊按钮 */
function button(href: string, label: string): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${ACCENT};border-radius:10px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
}

/** 键值信息列表 */
function infoRows(rows: Array<[string, string]>): string {
	const cells = rows
		.map(
			([k, v]) =>
				`<tr><td style="padding:6px 0;width:84px;font-size:12px;color:#9aa3b8;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-size:13px;line-height:1.7;color:#2f3646;word-break:break-all;">${v}</td></tr>`,
		)
		.join("");
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table>`;
}

/** 发一封邮件。失败只记日志。 */
export async function sendMail(env: Env, message: MailMessage): Promise<boolean> {
	if (!mailReady(env)) return false;
	const from = (env.MAIL_FROM ?? "").trim();
	if (!from || !isEmail(message.to)) return false;

	try {
		if (env.RESEND_API_KEY) {
			const response = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					authorization: `Bearer ${env.RESEND_API_KEY}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					from,
					to: [message.to],
					subject: message.subject,
					html: message.html,
					...(message.text ? { text: message.text } : {}),
				}),
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				console.error(
					`[friends-hook] Resend 发信失败 ${response.status}：${detail.slice(0, 300)}`,
				);
				return false;
			}
			console.log(`[friends-hook] 已发信 ${message.to}（Resend）`);
			return true;
		}

		if (env.EMAIL) {
			await env.EMAIL.send({
				from,
				to: message.to,
				subject: message.subject,
				html: message.html,
				...(message.text ? { text: message.text } : {}),
			});
			console.log(`[friends-hook] 已发信 ${message.to}（Cloudflare）`);
			return true;
		}
	} catch (error) {
		const message2 = error instanceof Error ? error.message : String(error);
		console.error(`[friends-hook] 发信异常：${message2}`);
	}
	return false;
}

function backlinkText(app: FriendApplication): string {
	if (!app.parsed.siteurl) return "没有可检测的站点地址";
	if (app.backlink.ok) return "已找到本站链接";
	const note = app.backlink.note || "未找到本站链接";
	return `${note}${app.backlink.checkedUrl ? `（检测地址：${app.backlink.checkedUrl}）` : ""}`;
}

/** 新申请 → 通知博主 */
export async function notifyNewApplication(
	env: Env,
	app: FriendApplication,
): Promise<void> {
	if (env.NOTIFY_ON_APPLY === "0") return;
	const admin = (env.ADMIN_EMAIL ?? "").trim();
	if (!admin || !mailReady(env)) return;

	const siteName = env.SITE_NAME || "本站";
	const adminUrl = env.ADMIN_URL || `${trimUrl(env.SITE_URL)}/admin`;
	const completeText = app.complete
		? "完整"
		: `缺少 ${app.missing.join("、")}`;
	const backlinkColor = app.backlink.ok ? "#1a7f37" : "#b45309";

	const body = `
<tr><td style="padding:20px 28px 0;">
${quote(esc(app.parsed.desc || "（没有填写描述）"))}
</td></tr>
<tr><td style="padding:18px 28px 0;">
${infoRows([
	["站点", `<a href="${esc(app.parsed.siteurl)}" style="color:${ACCENT};text-decoration:none;">${esc(app.parsed.siteurl || "—")}</a>`],
	["名称", esc(app.parsed.name || "—")],
	["邮箱", esc(app.parsed.email || "未填写，无法通知审核结果")],
	["字段", esc(completeText)],
	["反链", `<span style="color:${backlinkColor};">${esc(backlinkText(app))}</span>`],
	...(app.duplicateOf ? [["重复", `与已有记录 ${esc(app.duplicateOf)} 站点相同`] as [string, string]] : []),
])}
</td></tr>
<tr><td style="padding:22px 28px 0;">
${button(adminUrl, "去审核")}
</td></tr>`;

	const html = shell({
		siteName,
		eyebrow: siteName,
		title: `${esc(app.nick)} 提交了友链申请`,
		meta: `收到时间 ${esc(app.createdAt.replace("T", " ").slice(0, 16))}`,
		body,
		footer: `来自 ${esc(siteName)} 的友链接收端 · 回复本邮件不会通知到申请人`,
	});

	await sendMail(env, {
		to: admin,
		subject: `[友链申请] ${app.parsed.name || app.nick}`,
		html,
		text: `${app.nick} 提交了友链申请\n站点：${app.parsed.siteurl}\n名称：${app.parsed.name}\n描述：${app.parsed.desc}\n邮箱：${app.parsed.email || "未填写"}\n反链：${backlinkText(app)}\n审核：${adminUrl}`,
	});
}

/** 审核结果 → 通知申请人 */
export async function notifyReviewResult(
	env: Env,
	app: FriendApplication,
	approved: boolean,
): Promise<void> {
	if (env.NOTIFY_ON_REVIEW === "0") return;
	const to = (app.parsed.email ?? "").trim();
	if (!to || !isEmail(to) || !mailReady(env)) return;

	const siteName = env.SITE_NAME || "本站";
	const friendsUrl = `${trimUrl(env.SITE_URL)}/friends/`;
	const note = (app.reviewNote ?? "").trim();

	const body = approved
		? `
<tr><td style="padding:20px 28px 0;">
<div style="font-size:14px;line-height:1.9;color:#2f3646;">你好 ${esc(app.nick)}，你在 ${esc(siteName)} 提交的友链已经通过审核，<strong>${esc(app.parsed.name || app.parsed.siteurl)}</strong> 现在已出现在友链页上。</div>
</td></tr>
${note ? `<tr><td style="padding:16px 28px 0;">${quote(esc(note), true)}</td></tr>` : ""}
<tr><td style="padding:22px 28px 0;">
${button(friendsUrl, "去看看")}
</td></tr>`
		: `
<tr><td style="padding:20px 28px 0;">
<div style="font-size:14px;line-height:1.9;color:#2f3646;">你好 ${esc(app.nick)}，你在 ${esc(siteName)} 提交的友链这次没能通过审核。</div>
</td></tr>
${note ? `<tr><td style="padding:16px 28px 0;">${quote(esc(note), true)}</td></tr>` : ""}
<tr><td style="padding:18px 28px 0;">
<div style="font-size:13px;line-height:1.8;color:#8b93a7;">修改后可以重新提交申请，常见原因是：站点无法访问、没有添加本站链接、或内容与博客主题无关。</div>
</td></tr>
<tr><td style="padding:22px 28px 0;">
${button(friendsUrl, "去看看")}
</td></tr>`;

	const html = shell({
		siteName,
		eyebrow: siteName,
		title: approved ? "你的友链申请已通过" : "你的友链申请未通过",
		meta: esc(app.parsed.siteurl || ""),
		body,
		footer: `来自 ${esc(siteName)} 的友链申请结果通知 · 有问题可直接回复本邮件`,
	});

	await sendMail(env, {
		to,
		subject: approved
			? `友链已收录 · ${siteName}`
			: `友链申请结果 · ${siteName}`,
		html,
		text: approved
			? `你好 ${app.nick}，你的友链 ${app.parsed.name} 已通过审核，现在可以在 ${friendsUrl} 看到。${note ? `\n备注：${note}` : ""}`
			: `你好 ${app.nick}，你的友链申请未通过。${note ? `\n原因：${note}` : ""}\n修改后可以重新提交：${friendsUrl}`,
	});
}
