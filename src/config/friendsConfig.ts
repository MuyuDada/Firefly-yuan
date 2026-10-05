import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,

	// 每页展示的卡片数量
	pageSize: 9,

	// ── 访问延时徽章 ──────────────────────────────────
	// 在卡片右上角显示探测到的访问延时：绿=良好，橙=偏慢，红=超时
	showLatency: true,
	// 探测超时（毫秒），超过仍无响应则显示「超时」
	latencyTimeout: 5000,
	// 「良好」阈值（毫秒），成功且耗时小于该值显示绿色
	latencyGoodMs: 2000,

	// ── 站点预览图 ──────────────────────────────────
	// 是否在卡片顶部显示预览区
	showPreview: true,
	// 未填写 previewurl 时，是否用 siteurl 走第三方截图服务自动生成缩略图
	// 依赖第三方服务，国内可能较慢或偶发空白；追求稳定请设为 false 并自行填写 previewurl
	autoPreview: true,

	// ── 申请指南弹窗 ──────────────────────────────────
	// 外链自助申请地址（如 GitHub Issue 模板），留空则不显示该按钮
	applyLink: "",

	// 弹窗中的「本站信息」，供访客一键复制用于互换友链
	siteInfo: {
		name: "Muyu の 小窝",
		desc: "永远相信美好的事情即将发生",
		url: "https://muyudada.dpdns.org",
		avatar:
			"https://i.imgs.ovh/2026/08/16/d9361d6e012c3125dc8bebbd1a913a92.gif",
		email: "2756390658@qq.com",
	},

	// 弹窗中的注意事项
	notes: [
		{
			title: "互换原则",
			content: "请先将本站添加到您的友链页面，确认后会添加您的友链",
		},
		{
			title: "链接维护",
			content: "友链网站长期无法访问或内容违规，将会被移除",
		},
		{
			title: "内容要求",
			content: "内容积极向上，不含有任何含色情/反动/暴力等违法违规内容",
		},
		{
			title: "站点要求",
			content: "支持 HTTPS，以原创内容为主，能够正常访问且有持续更新",
		},
	],
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	{
		title: "Muyu の 小窝",
		imgurl:
			"https://i.imgs.ovh/2026/08/16/d9361d6e012c3125dc8bebbd1a913a92.gif",
		desc: "永远相信美好的事情即将发生",
		siteurl: "https://muyudada.dpdns.org",
		tags: ["本站"],
		weight: 99, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "番茄主理人",
		imgurl:
			"https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640",
		desc: "躬身入局，心为主理，行有尺度，自持本心。",
		siteurl: "https://blog.fqzlr.top/",
		tags: ["Blog"],
		weight: 98, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "LonelyBingの小窝",
		imgurl:
			"https://img.lonelybing.top/file/头像/1789400498937.jpg",
		desc: "一名普普通通の大学生~",
		siteurl: "https://lonelybing.top",
		tags: ["Blog"],
		weight: 97, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "夏夜流萤",
		imgurl:
			"https://weavatar.com/avatar/d252655d40d6874417a720bad0a6c5f77f8f6a1fd2f882f8f338402dc37e4190?s=640",
		desc: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。",
		siteurl: "https://blog.cuteleaf.cn",
		tags: ["Blog"],
		weight: 3, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},
	{
		title: "池泛の小窝",
		imgurl: "https://chortle.asia/uploads/image/avater_1786082652615.jpg",
		desc: "山水有相逢，来日皆可期",
		siteurl: "https://chortle.asia",
		tags: ["Blog"],
		weight: 4,
		enabled: true,
	},
	{
		title: "Firefly Docs",
		imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
		desc: "Firefly主题模板文档",
		siteurl: "https://docs-firefly.cuteleaf.cn",
		tags: ["Docs"],
		weight: 2,
		enabled: true,
	},
	{
		title: "Astro",
		imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
		desc: "The web framework for content-driven websites. ⭐️ Star to support our work!",
		siteurl: "https://github.com/withastro/astro",
		tags: ["Framework"],
		weight: 1,
		enabled: true,
	},
];

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
