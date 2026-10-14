/**
 * 反链检测：抓取申请者站点，确认对方页面上确实放了本站链接。
 *
 * 这只是一个「审核证据」，不是自动通过的门槛 —— 对方站点可能做了 Cloudflare
 * 拦截、JS 渲染或防盗链，抓不到并不代表没放。所以结果只作为提示，最终由人决定。
 */

import type { BacklinkResult } from "./types";

/** 反链检测要尝试的路径，根路径优先，其余是常见友链页 */
const CANDIDATE_PATHS = [
	"",
	"/links/",
	"/friends/",
	"/link/",
	"/blogroll/",
	"/links",
	"/friends",
];

/**
 * 屏蔽内网 / 回环地址，避免被拿来当 SSRF 跳板探测内网。
 * 申请链接来自公网访客，属于不可信输入。
 */
export function isSafePublicUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return false;

	const host = url.hostname.toLowerCase();
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local")
	)
		return false;
	if (host === "::1" || host === "[::1]" || host === "0.0.0.0") return false;

	// IPv4 私网 / 链路本地 / 回环
	const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		if (a === 10 || a === 127 || a === 0) return false;
		if (a === 192 && b === 168) return false;
		if (a === 169 && b === 254) return false;
		if (a === 172 && b >= 16 && b <= 31) return false;
	}

	return true;
}

/** 从站点地址推出用于反链匹配的 host（与 parse.normalizeSiteUrl 保持一致的口径） */
export function hostOf(raw: string): string {
	try {
		return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

/**
 * 抓取对方站点，检查页面里是否出现本站 host。
 *
 * 候选路径**并发**请求，谁先命中用谁。早先是串行 for-await，最坏情况要跑满
 * 7 次超时（实测站点首包能到 20s+，串行 7 条就是两分钟），会把 Waline 的
 * webhook 请求一直挂住 —— 而 Waline 对 webhook 既不设超时也不重试。
 */
export async function checkBacklink(
	applicantSite: string,
	targetHost: string,
	timeoutMs: number,
): Promise<BacklinkResult> {
	if (!isSafePublicUrl(applicantSite)) {
		return {
			ok: false,
			checkedUrl: applicantSite,
			note: "站点地址不安全或不可访问，已跳过检测",
		};
	}
	if (!targetHost) {
		return {
			ok: false,
			checkedUrl: applicantSite,
			note: "未配置本站地址，无法检测",
		};
	}

	const base = applicantSite.replace(/\/+$/, "");

	const attempt = async (
		path: string,
	): Promise<{ ok: boolean; url: string; note: string }> => {
		const url = base + path;
		try {
			const resp = await fetch(url, {
				redirect: "follow",
				signal: AbortSignal.timeout(timeoutMs),
				headers: {
					// 有些站点对空 UA 直接 403
					"user-agent":
						"Mozilla/5.0 (compatible; FireflyFriendLinkBot/1.0; +https://github.com/MuyuDada/Firefly-yuan)",
					accept: "text/html,application/xhtml+xml",
				},
			});
			if (!resp.ok)
				return { ok: false, url, note: `对方站点返回 ${resp.status}` };
			const body = await resp.text();
			if (body.toLowerCase().includes(targetHost)) {
				return { ok: true, url, note: `已在 ${url} 找到本站链接` };
			}
			return { ok: false, url, note: `可访问，但未在 ${url} 找到本站链接` };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const note = /timeout|abort/i.test(message)
				? "对方站点响应超时"
				: `无法访问：${message}`;
			return { ok: false, url, note };
		}
	};

	const results = await Promise.all(
		CANDIDATE_PATHS.map((path) => attempt(path)),
	);
	const hit = results.find((result) => result.ok);
	if (hit) return { ok: true, checkedUrl: hit.url, note: hit.note };

	// 都没命中：挑一条信息量最大的作为结论。优先级：
	//   抓到页面但没找到链接（说明站点可达、只是没放友链）
	//   > 对方返回 HTTP 错误（如 404，至少证明连上了）
	//   > 超时 / 连不上
	// 不能简单取第一条：并发时 `/links/` 可能飞快返回 404，而真正有内容的 `/`
	// 只是慢，直接取第一条会把「404」当成结论，反而掩盖了真实情况。
	const rank = (note: string): number => {
		if (/超时|无法访问/.test(note)) return 2;
		if (/返回 \d/.test(note)) return 1;
		return 0;
	};
	const best = results.reduce((a, b) => (rank(a.note) <= rank(b.note) ? a : b));
	return { ok: false, checkedUrl: best.url, note: best.note };
}
