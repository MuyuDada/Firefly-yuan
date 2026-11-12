import { friendsPageConfig } from "@/config";
import type { FriendLink } from "@/types/friendsConfig";

/**
 * 审核通过的友链：构建时从 friends-hook 的 /api/links 拉一次，合并进友链列表。
 *
 * 为什么放在构建期而不是浏览器：卡片是 FriendCard.astro 渲染的，要在客户端补一批
 * 就得把整套 DOM 与样式复刻一遍，两边迟早走样；而且首屏会闪。构建期拉取 + 审核通过
 * 后触发一次重建（Worker 的 DEPLOY_HOOK_URL），站点仍然是纯静态，SEO 与首屏都不受影响。
 *
 * 拉不到就返回空数组 —— 新通过的友链晚一次构建才出现，也好过整个站点构建失败。
 * 关闭方式：friendsPageConfig.autoLinks = false。
 */

/** 拉取超时。构建期宁可少几条，也不要在这一步卡住整个站点 */
const TIMEOUT_MS = 5000;

/** /api/links 返回的单条结构（见 workers/friends-hook 的 PublicLink） */
interface ApiLink {
	id: string;
	name: string;
	desc: string;
	siteurl: string;
	avatar: string;
	email?: string;
	approvedAt: string;
}

/** 比较两条友链是不是同一个站点：忽略协议大小写、结尾斜杠 */
export function normalizeFriendUrl(url: string): string {
	return url.trim().replace(/\/+$/, "").toLowerCase();
}

function toFriendLink(link: ApiLink): FriendLink | null {
	const siteurl = (link.siteurl || "").trim();
	const title = (link.name || "").trim();
	// 解析不出站点链接或站名的记录，宁可不展示 —— 审核页那边会提示缺字段
	if (!title || !/^https?:\/\//i.test(siteurl)) return null;

	return {
		title,
		imgurl: (link.avatar || "").trim(),
		desc: (link.desc || "").trim(),
		siteurl,
		tags: ["Blog"],
		weight: friendsPageConfig.autoLinksWeight ?? 0,
		enabled: true,
	};
}

/** 拉取审核通过的友链。没有配置 applyApi 或显式关闭时返回空数组 */
export async function fetchApprovedFriends(): Promise<FriendLink[]> {
	if (friendsPageConfig.autoLinks === false) return [];

	const base = (friendsPageConfig.applyApi || "").trim().replace(/\/+$/, "");
	if (!base) return [];

	try {
		const resp = await fetch(`${base}/api/links`, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: "application/json" },
		});
		if (!resp.ok) {
			console.warn(
				`[friends] /api/links 返回 ${resp.status}，本次构建只用 friendsConfig`,
			);
			return [];
		}

		const payload = (await resp.json()) as { data?: ApiLink[] };
		const rows = Array.isArray(payload?.data) ? payload.data : [];
		const friends = rows
			.map(toFriendLink)
			.filter((friend): friend is FriendLink => friend !== null);

		console.log(`[friends] 从 /api/links 收录 ${friends.length} 条已通过的友链`);
		return friends;
	} catch (error) {
		console.warn(
			`[friends] 拉取 /api/links 失败：${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * 合并手工配置与自动收录。
 *
 * 顺序保持传入的顺序：手工的已经按 weight（或随机）排好，自动收录的追在后面，
 * 所以不需要再排一遍 —— 也顺手保住了 randomizeSort 的随机结果。
 * 同一个站点两处都有时以手工配置为准（那份可以写 previewurl、recommended 等字段）。
 */
export function mergeFriends(
	manual: FriendLink[],
	auto: FriendLink[],
): FriendLink[] {
	const seen = new Set(manual.map((friend) => normalizeFriendUrl(friend.siteurl)));
	const merged = [...manual];

	for (const friend of auto) {
		const key = normalizeFriendUrl(friend.siteurl);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		merged.push(friend);
	}

	return merged;
}
