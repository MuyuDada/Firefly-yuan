import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// NavBar Configuration - Dynamically generate navigation bar links based on order
// ============================================================================
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: NavBarLink[] = [];

	// 主页
	links.push(LinkPresets.Home);

	// 文章及其子菜单
	links.push({
		name: "文章",
		url: "#",
		icon: "material-symbols:article",
		children: [
			// 归档
			LinkPresets.Archive,

			// 分类标签（分类与标签已合并为一页：玫瑰图 + 标签关系图）
			LinkPresets.Categories,

			// 系列
			LinkPresets.Series,

			// 站点日历（按日期浏览文章与事件）
			LinkPresets.Calendar,

			// 站点统计（基于 Umami 公开分享数据的访问分析）
			LinkPresets.Analytics,
		],
	});

	//社交及其子菜单
	links.push({
		name: "社交",
		url: "#",
		icon: "material-symbols:group",
		children: [
			// 友链
			LinkPresets.Friends,

			// 留言
			LinkPresets.Guestbook,
		],
	});

	// 我的及其子菜单
	links.push({
		name: "我的",
		url: "#",
		icon: "material-symbols:person",
		children: [
			// 动态
			LinkPresets.Dynamic,

			// 项目
			LinkPresets.Projects,

			// 设备
			LinkPresets.Devices,

			// 足迹地图
			LinkPresets.Places,

			// 相册
			LinkPresets.Gallery,

			// 书签导航
			LinkPresets.Booknav,
		],
	});

	// 娱乐及其子菜单（音乐可视化与 ACG 收藏/追番类页面）
	links.push({
		name: "娱乐",
		url: "#",
		icon: "material-symbols:live-tv",
		children: [
			// 音乐可视化
			LinkPresets.Music,

			// 哔哩哔哩追番
			LinkPresets.Bilibili,

			// 番组计划
			LinkPresets.Bangumi,

			// VNDB
			LinkPresets.VNDB,

			// MyAnimeList
			LinkPresets.MAL,
		],
	});

	// 关于及其子菜单
	links.push({
		name: "关于",
		url: "#",
		icon: "material-symbols:info",
		children: [
			// 打赏
			LinkPresets.Sponsor,

			// 关于页面
			LinkPresets.About,
		],
	});

	// 自定义导航栏链接
	links.push({
		name: "链接",
		url: "#",
		icon: "material-symbols:link",
		// 子菜单
		children: [
			{
				name: "GitHub",
				url: "https://github.com/muyudada",
				external: true,
				icon: "fa7-brands:github",
			},
			{
				name: "Gitee",
				url: "https://gitee.com/muyudada",
				external: true,
				icon: "fa7-brands:gitee",
			},
			{
				name: "个人主页",
				url: "https://muyuhome.cc.cd",
				external: true,
				icon: "material-symbols:explore",
			},
			{
				name: "个人网盘",
				url: "https://muyupan.cc.cd",
				external: true,
				icon: "material-symbols:cloud",
			},
			{
				name: "个人图床",
				url: "https://muyuimg.cc.cd",
				external: true,
				icon: "material-symbols:photo-library",
			},
			{
				name: "站点检测",
				url: "https://site.muyudada.dpdns.org",
				external: true,
				icon: "material-symbols:timeline",
			},
		],
	});

	// 文档链接
	// links.push({
	// 	name: "文档",
	// 	url: "https://docs-firefly.cuteleaf.cn",
	// 	external: true,
	// 	icon: "material-symbols:docs",
	// });

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Archive: {
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Categories: {
		name: "分类标签",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Series: {
		name: "系列",
		url: "/series/",
		icon: "material-symbols:layers",
	},
	Friends: {
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:link-2-rounded",
		pageKey: "friends",
	},
	Guestbook: {
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	Dynamic: {
		name: "动态",
		url: "/dynamic/",
		icon: "material-symbols:forum-rounded",
		pageKey: "dynamic",
	},
	Music: {
		name: "音乐",
		url: "/music/",
		icon: "material-symbols:music-note-rounded",
		pageKey: "music",
	},
	Calendar: {
		name: "站点日历",
		url: "/calendar/",
		icon: "material-symbols:calendar-month",
		pageKey: "calendar",
	},
	Devices: {
		name: "设备",
		url: "/devices/",
		icon: "material-symbols:devices",
		pageKey: "devices",
	},
	Places: {
		name: "足迹",
		url: "/places/",
		icon: "material-symbols:location-on",
		pageKey: "places",
	},
	Projects: {
		name: "项目",
		url: "/projects/",
		icon: "material-symbols:rocket-launch",
		pageKey: "projects",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Booknav: {
		name: "书签导航",
		url: "/booknav/",
		icon: "material-symbols:bookmarks",
		pageKey: "booknav",
	},
	Bilibili: {
		name: "哔哩哔哩",
		url: "/bilibili/",
		icon: "fa7-brands:bilibili",
		pageKey: "bilibili",
	},
	Bangumi: {
		name: "番组计划",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	VNDB: {
		name: "VNDB",
		url: "/vndb/",
		icon: "material-symbols:chrome-reader-mode-rounded",
		pageKey: "vndb",
	},
	MAL: {
		name: "AnimeList",
		url: "/myanimelist/",
		icon: "material-symbols:menu-book",
		pageKey: "mal",
	},
	Sponsor: {
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	Analytics: {
		name: "站点统计",
		url: "/analytics/",
		icon: "material-symbols:monitoring-rounded",
	},
	About: {
		name: "关于我",
		url: "/about/",
		icon: "material-symbols:person",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
