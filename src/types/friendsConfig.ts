// 友链配置
export type FriendLink = {
	title: string; // 友链标题
	imgurl: string; // 头像图片URL
	desc: string; // 友链描述
	siteurl: string; // 友链地址
	previewurl?: string; // 站点预览图 URL，优先级高于 autoPreview
	tags?: string[]; // 标签数组
	weight: number; // 权重，数字越大排序越靠前
	enabled: boolean; // 是否启用
};

// 申请弹窗中的「本站信息」字段
export type FriendSiteInfo = {
	name: string; // 站点名称
	desc: string; // 站点描述 / 标语
	url: string; // 站点首页 URL
	avatar: string; // 头像图片 URL
	email?: string; // 联系邮箱（可选，仅作展示）
};

// 申请弹窗中的注意事项条目
export type FriendNote = {
	title: string; // 短标题
	content: string; // 说明正文
};

export type FriendsPageConfig = {
	title?: string; // 页面标题，留空则使用 i18n 中的翻译
	description?: string; // 页面描述，留空则使用 i18n 中的翻译
	showCustomContent?: boolean; // 是否显示自定义内容（friends.mdx）
	showComment?: boolean; // 是否显示评论区，默认 true
	randomizeSort?: boolean; // 是否打乱排序，如果为 true，将忽略 weight，随机排序

	pageSize?: number; // 每页展示的卡片数量，默认 9

	// ── 访问延时徽章 ──
	showLatency?: boolean; // 是否显示延时徽章，默认 true
	latencyTimeout?: number; // 探测超时（毫秒），默认 5000
	latencyGoodMs?: number; // 「良好」阈值（毫秒），默认 2000

	// ── 站点预览图 ──
	showPreview?: boolean; // 是否在卡片顶部显示预览区，默认 true
	autoPreview?: boolean; // 未填 previewurl 时是否用 siteurl 自动生成缩略图，默认 false

	// ── 申请指南弹窗 ──
	applyLink?: string; // 外链自助申请地址（如 GitHub Issue），留空则不显示该按钮
	siteInfo?: FriendSiteInfo; // 弹窗中的本站信息，供访客一键复制
	notes?: FriendNote[]; // 弹窗中的注意事项列表
};
