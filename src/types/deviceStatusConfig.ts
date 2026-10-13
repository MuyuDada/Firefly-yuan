// 电脑状态组件配置类型
//
// 数据链路：本机 PowerShell 变化驱动上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。

/** 前台状态：在线 / 离开 / 锁屏 / 离线（离线由服务端按上报断流判定） */
export type DeviceStatusState = "online" | "away" | "locked" | "offline";

/** 按应用名关键词兜底的图标规则 */
export interface DeviceStatusKeywordIcon {
	/** 应用名里包含这个子串时命中 */
	match: string;
	/** Iconify 图标名，如 "fa7-brands:edge" */
	icon: string;
}

export interface DeviceStatusConfig {
	/** 是否启用该组件，false 时整张卡片不渲染 */
	enable: boolean;
	/** 只读接口地址（主通道），留空时只看备用通道 */
	endpoint: string;
	/**
	 * 备用通道：主通道取不到新鲜数据时的兜底来源，通常指向 GitHub Gist 的 raw 地址。
	 * 它是一份「裸快照」，没有 Worker 包装的 online / stale 字段，
	 * 所以前端会按和 Worker 一样的规则在本地补算时效。
	 * 留空 = 不用备用通道；与 endpoint 同时留空则整张卡片隐藏。
	 */
	fallbackEndpoint: string;
	/**
	 * 前端轮询间隔（秒）。
	 * 本机侧是「变化驱动 + 心跳」：前台应用一换就立刻上报，没换时在线 5 分钟
	 * 才发一次心跳，所以这里不用跟得很紧。
	 */
	refreshIntervalSeconds: number;
	/** 单次请求超时（毫秒） */
	requestTimeoutMs: number;
	/**
	 * 离线判定的兜底秒数。
	 * 主通道的权威值在 Worker 侧，它会按上报的 heartbeatSeconds 动态推算，
	 * 并以 staleAfterSeconds 字段随响应回传；备用通道没有服务端判活，
	 * 只能用这里的值配合快照里的 heartbeatSeconds 在本地算一遍。
	 */
	staleAfterSeconds: number;
	/** 从后台切回前台时，距上次成功超过这个秒数就立刻补一次 */
	visibilityRefreshAfterSeconds: number;
	/** 进程名（小写）→ Iconify 图标名 */
	iconMap: Record<string, string>;
	/**
	 * 进程名（小写）→ 品牌色。
	 * Iconify 的图标是单色的，想还原 Edge 蓝、微信绿这类品牌辨识度就得自带颜色。
	 * 没配的进程回落到状态色，所以这张表只需覆盖常用应用。
	 */
	iconColors: Record<string, string>;
	/** 进程名没命中时，按应用名关键词兜底 */
	keywordIcons: DeviceStatusKeywordIcon[];
}
