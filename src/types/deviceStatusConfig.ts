// 电脑状态组件配置类型
//
// 数据链路：本机 PowerShell 定时上报 → Cloudflare Worker + KV → 访客浏览器只读。
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
	/** 只读接口地址，留空等于未启用（卡片会隐藏，不留空白） */
	endpoint: string;
	/** 轮询间隔（秒），比本机上报间隔略长，避免刚好卡在上报边界读到旧数据 */
	refreshIntervalSeconds: number;
	/** 单次请求超时（毫秒） */
	requestTimeoutMs: number;
	/** 超过这个秒数没有新上报就显示离线（与 Worker 侧判定保持一致） */
	staleAfterSeconds: number;
	/** 从后台切回前台时，距上次成功超过这个秒数就立刻补一次 */
	visibilityRefreshAfterSeconds: number;
	/** 进程名（小写）→ Iconify 图标名 */
	iconMap: Record<string, string>;
	/** 进程名没命中时，按应用名关键词兜底 */
	keywordIcons: DeviceStatusKeywordIcon[];
}
