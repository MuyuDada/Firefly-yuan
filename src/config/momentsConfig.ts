import { friendsConfig, siteConfig } from "@/config";
import type { FriendLink } from "@/types/friendsConfig";

// 朋友圈页面配置
//
// 页面路径：`/moments/`，开关在 src/config/siteConfig.ts 的 pages.moments。
// 数据来源：friendsConfig 里的友链站点 RSS / Atom，
// 抓取逻辑见 src/utils/friends-feed.ts（移植自 Aemeath 项目）。
//
// 想控制某个友链的来源，可在 friendsConfig 的对应条目里加 rss 字段：
//   rss: "https://example.com/rss.xml"        // 单个地址
//   rss: [".../rss.xml", ".../atom.xml"]      // 多个地址，全部合并去重
//   不填则会自动尝试 rss.xml / feed.xml / atom.xml / index.xml 等常见路径
export const friendsFeedConfig = {
	// 单次请求超时（毫秒）。友链站点多时建议别调太大，否则构建会变慢
	timeoutMs: 8000,

	// 请求失败重试次数（超时、429、5xx 会重试）
	retries: 2,

	// 同时抓取的友链数量
	concurrency: 6,

	// 每个友链最多展示几篇文章
	maxItemsPerFriend: 6,

	// 每页展示多少条朋友圈
	pageSize: 12,

	// 是否在页头显示抓取统计（最新 N 个来源 / 沿用快照 M 个）
	showFeedStats: true,

	// 是否显示未提供 RSS 的友链提示
	showUnsubscribedHint: true,
} as const;

/** 本站地址（归一化），用于识别「本站主理人」卡片 */
export function getOwnSiteUrl(): string {
	return (siteConfig.site_url || "")
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/\/+$/, "")
		.toLowerCase();
}

/** 启用的友链（供朋友圈页面使用） */
export function getMomentsFriends(): FriendLink[] {
	return friendsConfig.filter((friend) => friend.enabled);
}
