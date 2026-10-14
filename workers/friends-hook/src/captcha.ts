/**
 * 算术验证码：给自助申请表单用，挡掉纯脚本提交。
 *
 * 为什么不用 Turnstile：Turnstile 需要在申请页里嵌 Cloudflare 的脚本、再配一对
 * sitekey/secret，而这台 Worker 本来就在 Cloudflare 上、申请量又是个人博客量级。
 * 一个「6 + 7 = ?」的算术题已经能挡掉绝大多数无脑脚本，成本却接近于零。
 * （代价：挡不住专门针对本站写的脚本。真被盯上了再换 Turnstile。）
 *
 * 存法：`cap:<id>` → 答案字符串，TTL 5 分钟。一次性，答完即删。
 * KV 免费额度：读 10 万/天、写 1 千/天 —— 每人每次申请最多消耗 2 读 2 写。
 */

const CAPTCHA_PREFIX = "cap:";

/** 验证码有效期（秒）—— 5 分钟，够填完一张表单 */
const CAPTCHA_TTL_SECONDS = 300;

/** 一道题 + 它的答案 */
export interface CaptchaChallenge {
	/** 题目，例如 "6 + 7 = ?" */
	question: string;
	/** 正确答案 */
	answer: string;
}

/** 生成一道算术题。加减用 2–20，乘法用 2–9，避免心算太累。 */
export function makeChallenge(): CaptchaChallenge {
	const kind = Math.floor(Math.random() * 3);
	if (kind === 0) {
		const a = 2 + Math.floor(Math.random() * 19);
		const b = 2 + Math.floor(Math.random() * 19);
		return { question: `${a} + ${b} = ?`, answer: String(a + b) };
	}
	if (kind === 1) {
		// 保证结果非负，免得出现 "-3" 这种让人怀疑自己算错的答案
		const a = 10 + Math.floor(Math.random() * 11);
		const b = 2 + Math.floor(Math.random() * 9);
		return { question: `${a} - ${b} = ?`, answer: String(a - b) };
	}
	const a = 2 + Math.floor(Math.random() * 8);
	const b = 2 + Math.floor(Math.random() * 8);
	return { question: `${a} × ${b} = ?`, answer: String(a * b) };
}

/** 生成验证码 id（足够随机，不需要密码学强度，但别让人猜到别人的题） */
function makeId(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 出题并把答案写进 KV，返回题面与 id */
export async function issueCaptcha(
	kv: KVNamespace,
): Promise<{ id: string; question: string }> {
	const id = makeId();
	const { question, answer } = makeChallenge();
	await kv.put(CAPTCHA_PREFIX + id, answer, {
		expirationTtl: CAPTCHA_TTL_SECONDS,
	});
	return { id, question };
}

/**
 * 校验答案。无论对错都删掉这道题（一次性），避免被反复试答案。
 *
 * 比对前把全角数字与空白都归一化 —— 手机上输入法很容易打出全角。
 */
export async function verifyCaptcha(
	kv: KVNamespace,
	id: string,
	answer: string,
): Promise<boolean> {
	if (!id || !answer) return false;
	const expected = await kv.get(CAPTCHA_PREFIX + id);
	if (expected === null) return false;
	await kv.delete(CAPTCHA_PREFIX + id);
	const normalize = (value: string): string =>
		value
			.trim()
			.replace(/[０-９]/g, (ch) =>
				String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
			)
			.replace(/\s+/g, "");
	return normalize(answer) === normalize(expected);
}
