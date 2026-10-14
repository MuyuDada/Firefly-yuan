/**
 * 站内表单提交（POST /apply）的载荷校验。
 *
 * 和 `parse.ts` 的分工：parse.ts 负责从 Waline 评论正文里「猜」字段（用户手写、
 * 格式五花八门）；这里负责校验用户直接填的表单。表单是结构化的，所以不需要猜，
 * 只需要把不合法的挡在入库之前 —— 少了这一步，审核页会被空字段申请塞满。
 */

import type { ParsedApplication } from "./types";

/** 表单原始载荷（字段名与前端 form 的 name 属性一致） */
export interface ApplyPayload {
	siteName?: unknown;
	siteUrl?: unknown;
	avatarUrl?: unknown;
	contactEmail?: unknown;
	description?: unknown;
	captchaId?: unknown;
	captchaAnswer?: unknown;
	/** 蜜罐字段，正常用户看不到也填不到；有值就是脚本 */
	company?: unknown;
}

/** 校验结果：成功给字段，失败给中文理由 */
export type ApplyValidation =
	| {
			ok: true;
			parsed: ParsedApplication;
			captchaId: string;
			captchaAnswer: string;
	  }
	| { ok: false; error: string };

/** 各字段长度上限，与前端 maxLength 保持一致 */
const LIMITS = {
	siteName: 40,
	description: 120,
	siteUrl: 240,
	avatarUrl: 300,
	contactEmail: 254,
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 校验一个 http(s) 链接。只认这两种协议 —— 免得有人塞 `javascript:` 或
 * `data:` 进来，那些会被原样渲染到友链卡片上。
 */
function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** 邮箱只做宽松检查：有 @、有域名、无空格。发信不是我们的职责。 */
function isPlausibleEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * 校验表单载荷。
 *
 * 蜜罐（`company`）放在最前面：它一有值就直接判失败，不浪费后续的 KV 读写。
 * 正常用户看不到这个字段（CSS 隐藏 + `tabIndex:-1` + `aria-hidden`），
 * 只有自动填表脚本会把每个 input 都填上。
 */
export function validateApply(payload: ApplyPayload): ApplyValidation {
	if (asString(payload.company)) {
		return { ok: false, error: "提交被拒绝。" };
	}

	const name = asString(payload.siteName);
	if (!name) return { ok: false, error: "请填写站点名称。" };
	if (name.length > LIMITS.siteName) {
		return { ok: false, error: `站点名称不能超过 ${LIMITS.siteName} 个字。` };
	}

	const siteurl = asString(payload.siteUrl);
	if (!siteurl) return { ok: false, error: "请填写站点链接。" };
	if (siteurl.length > LIMITS.siteUrl) {
		return { ok: false, error: "站点链接太长了。" };
	}
	if (!isHttpUrl(siteurl)) {
		return {
			ok: false,
			error: "站点链接必须是 http:// 或 https:// 开头的完整地址。",
		};
	}

	const avatar = asString(payload.avatarUrl);
	if (!avatar) return { ok: false, error: "请填写头像链接。" };
	if (avatar.length > LIMITS.avatarUrl) {
		return { ok: false, error: "头像链接太长了。" };
	}
	if (!isHttpUrl(avatar)) {
		return {
			ok: false,
			error: "头像链接必须是 http:// 或 https:// 开头的完整地址。",
		};
	}

	const email = asString(payload.contactEmail);
	if (email) {
		if (email.length > LIMITS.contactEmail) {
			return { ok: false, error: "邮箱太长了。" };
		}
		if (!isPlausibleEmail(email)) {
			return { ok: false, error: "邮箱格式看起来不对。" };
		}
	}

	const desc = asString(payload.description);
	if (!desc) return { ok: false, error: "请填写一句话简介。" };
	if (desc.length > LIMITS.description) {
		return { ok: false, error: `简介不能超过 ${LIMITS.description} 个字。` };
	}

	const captchaId = asString(payload.captchaId);
	const captchaAnswer = asString(payload.captchaAnswer);
	if (!captchaId || !captchaAnswer) {
		return { ok: false, error: "请先完成验证码。" };
	}

	return {
		ok: true,
		parsed: { name, desc, siteurl, avatar, email },
		captchaId,
		captchaAnswer,
	};
}
