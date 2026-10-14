/**
 * 按 IP 的每日限额：挡住同一台机器刷验证码 / 刷申请。
 *
 * 为什么用 KV 计数而不是 Durable Object：申请量是个人博客量级，KV 免费额度
 * （读 10 万/天、写 1 千/天）绰绰有余，而 DO 要额外的类和计费概念。
 *
 * 计数不是原子的（KV 没有 increment），两个人同一毫秒提交可能各读到旧值 ——
 * 对「每天最多 5 次」这种软限额完全无所谓。
 *
 * 键设计：`rl:<ip>:<YYYY-MM-DD>`（UTC 日期）→ JSON `{ cap: 出题次数, apply: 提交次数 }`，
 * TTL 48 小时（跨天自然过期，不用清理任务）。
 */

const RATE_PREFIX = "rl:";

/** 计数器在 KV 里的存活时间（秒）—— 48 小时，够跨过 UTC 零点 */
const RATE_TTL_SECONDS = 48 * 60 * 60;

/** 一个 IP 每天最多领几道验证码（留足重试余量：算错了要能换一道） */
const DEFAULT_CAPTCHA_PER_DAY = 30;

/** 一个 IP 每天最多提交几次申请 */
const DEFAULT_APPLY_PER_DAY = 5;

interface Counter {
	/** 领验证码的次数 */
	cap: number;
	/** 提交申请的次数 */
	apply: number;
}

/** UTC 日期串，作为键的一部分 —— 每天换一个键，相当于自动重置 */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function keyFor(ip: string): string {
	return `${RATE_PREFIX}${ip}:${today()}`;
}

async function readCounter(kv: KVNamespace, ip: string): Promise<Counter> {
	try {
		const raw = await kv.get(keyFor(ip));
		if (!raw) return { cap: 0, apply: 0 };
		const parsed = JSON.parse(raw) as Partial<Counter>;
		return { cap: Number(parsed.cap) || 0, apply: Number(parsed.apply) || 0 };
	} catch {
		// KV 读失败不该把正常用户挡在外面
		return { cap: 0, apply: 0 };
	}
}

async function writeCounter(
	kv: KVNamespace,
	ip: string,
	counter: Counter,
): Promise<void> {
	try {
		await kv.put(keyFor(ip), JSON.stringify(counter), {
			expirationTtl: RATE_TTL_SECONDS,
		});
	} catch {
		// 写失败只影响限额统计，不影响这次请求
	}
}

/**
 * 取客户端 IP。Cloudflare 会把真实来源放在 `CF-Connecting-IP` 里，
 * 这个头由边缘节点写入、客户端伪造不了。
 */
export function clientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

/**
 * 消耗一次配额。返回 `null` 表示放行，否则返回给用户看的中文拒绝理由。
 *
 * @param kind "cap" 领验证码 / "apply" 提交申请
 */
export async function consumeQuota(
	kv: KVNamespace,
	ip: string,
	kind: "cap" | "apply",
	env: { CAPTCHA_PER_DAY?: string; APPLY_PER_DAY?: string },
): Promise<string | null> {
	const capLimit = Number(env.CAPTCHA_PER_DAY ?? "") || DEFAULT_CAPTCHA_PER_DAY;
	const applyLimit = Number(env.APPLY_PER_DAY ?? "") || DEFAULT_APPLY_PER_DAY;

	const counter = await readCounter(kv, ip);
	if (kind === "cap") {
		if (counter.cap >= capLimit) {
			return "今天领取验证码的次数太多了，请明天再试。";
		}
		counter.cap += 1;
	} else {
		if (counter.apply >= applyLimit) {
			return `今天提交的次数已达上限（${applyLimit} 次），请明天再试。`;
		}
		counter.apply += 1;
	}
	await writeCounter(kv, ip, counter);
	return null;
}
