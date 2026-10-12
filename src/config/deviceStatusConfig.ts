import type { DeviceStatusConfig } from "@/types/deviceStatusConfig";

// 电脑状态组件配置
//
// 数据链路：本机 PowerShell 定时上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。
//
// 想加新应用：只需要在本机上报脚本的映射表里加，这里不用动。
// 这里只负责「进程名 → 图标」，映射表是按主页（muyudada.github.io）的 126 条抄过来的。
export const deviceStatusConfig: DeviceStatusConfig = {
	enable: true,

	// 只读接口。留空等于未启用：卡片会整块隐藏，页面上不会留一块空白。
	// 注意：不要用 *.workers.dev 那个地址，部分网络下该域名不可达，已改为自有域名。
	endpoint: "https://muyuhome.cc.cd/api/device/status",

	// 轮询间隔比本机上报间隔（30 秒）略长，避免刚好卡在上报边界上读到旧数据
	refreshIntervalSeconds: 30,
	requestTimeoutMs: 8000,
	// 与 Worker 侧的离线判定保持一致：超过 180 秒没有新上报就是离线
	staleAfterSeconds: 180,
	// 后台标签页的定时器会被浏览器降频，切回前台时距上次成功超过这个值就立刻补一次
	visibilityRefreshAfterSeconds: 20,

	// 进程名（小写）→ Iconify 图标名。
	// 进程名优先命中，其次按应用名关键词兜底，最后给通用显示器图标。
	iconMap: {
		// —— 编辑器 / IDE ——
		code: "fa7-solid:code",
		cursor: "fa7-solid:code",
		devenv: "fa7-solid:code",
		idea64: "fa7-solid:code",
		pycharm64: "fa7-solid:code",
		webstorm64: "fa7-solid:code",
		goland64: "fa7-solid:code",
		clion64: "fa7-solid:code",
		rider64: "fa7-solid:code",
		sublime_text: "fa7-solid:code",
		androidstudio64: "fa7-brands:android",
		// —— 终端 ——
		windowsterminal: "fa7-solid:terminal",
		wt: "fa7-solid:terminal",
		powershell: "fa7-solid:terminal",
		pwsh: "fa7-solid:terminal",
		cmd: "fa7-solid:terminal",
		conhost: "fa7-solid:terminal",
		"git-bash": "fa7-solid:terminal",
		mintty: "fa7-solid:terminal",
		// —— 浏览器 ——
		msedge: "fa7-brands:edge",
		msedgewebview2: "fa7-brands:edge",
		chrome: "fa7-brands:chrome",
		firefox: "fa7-brands:firefox-browser",
		brave: "fa7-brands:brave",
		opera: "fa7-brands:opera",
		safari: "fa7-brands:safari",
		iexplore: "fa7-brands:internet-explorer",
		// —— 通讯 ——
		wechat: "fa7-brands:weixin",
		weixin: "fa7-brands:weixin",
		qq: "fa7-brands:qq",
		tim: "fa7-brands:qq",
		telegram: "fa7-brands:telegram",
		discord: "fa7-brands:discord",
		skype: "fa7-brands:skype",
		whatsapp: "fa7-brands:whatsapp",
		line: "fa7-brands:line",
		viber: "fa7-brands:viber",
		dingtalk: "fa7-solid:comment-dots",
		wework: "fa7-solid:comment-dots",
		feishu: "fa7-solid:comment-dots",
		lark: "fa7-solid:comment-dots",
		// —— 音乐 ——
		cloudmusic: "fa7-solid:music",
		qqmusic: "fa7-solid:music",
		spotify: "fa7-brands:spotify",
		itunes: "fa7-brands:itunes",
		foobar2000: "fa7-solid:music",
		aimp: "fa7-solid:music",
		// —— 影音 ——
		potplayer: "fa7-solid:film",
		potplayermini64: "fa7-solid:film",
		vlc: "fa7-solid:film",
		mpv: "fa7-solid:film",
		bilibili: "fa7-brands:bilibili",
		youtube: "fa7-brands:youtube",
		vimeo: "fa7-brands:vimeo",
		twitch: "fa7-brands:twitch",
		obs64: "fa7-solid:video",
		// —— 游戏 ——
		steam: "fa7-brands:steam",
		steamwebhelper: "fa7-brands:steam",
		epicgameslauncher: "fa7-solid:gamepad",
		genshinimpact: "fa7-solid:gamepad",
		yuanshen: "fa7-solid:gamepad",
		starrail: "fa7-solid:gamepad",
		dota2: "fa7-solid:gamepad",
		cs2: "fa7-solid:gamepad",
		tslgame: "fa7-solid:gamepad",
		unity: "fa7-brands:unity",
		// fa7-brands 里没有 blender，退回 simple-icons
		blender: "simple-icons:blender",
		xbox: "fa7-brands:xbox",
		playstation: "fa7-brands:playstation",
		// —— 办公 ——
		winword: "fa7-solid:file-word",
		excel: "fa7-solid:file-excel",
		powerpnt: "fa7-solid:file-powerpoint",
		onenote: "fa7-solid:note-sticky",
		wps: "fa7-solid:file-lines",
		et: "fa7-solid:file-excel",
		wpp: "fa7-solid:file-powerpoint",
		acrobat: "fa7-solid:file-pdf",
		acrord32: "fa7-solid:file-pdf",
		sumatrapdf: "fa7-solid:file-pdf",
		notepad: "fa7-solid:file-lines",
		"notepad++": "fa7-solid:file-lines",
		typora: "fa7-solid:file-lines",
		obsidian: "fa7-solid:book",
		zotero: "fa7-solid:book",
		notion: "fa7-brands:notion",
		trello: "fa7-brands:trello",
		jira: "fa7-brands:jira",
		confluence: "fa7-brands:confluence",
		// —— 设计 ——
		photoshop: "fa7-solid:image",
		illustrator: "fa7-solid:pen-nib",
		figma: "fa7-brands:figma",
		sketch: "fa7-brands:sketch",
		afterfx: "fa7-solid:wand-magic-sparkles",
		premiere: "fa7-solid:film",
		// —— 开发工具 ——
		"github desktop": "fa7-brands:github",
		gitkraken: "fa7-brands:git-alt",
		sourcetree: "fa7-brands:git-alt",
		postman: "fa7-solid:paper-plane",
		docker: "fa7-brands:docker",
		navicat: "fa7-solid:database",
		dbeaver: "fa7-solid:database",
		// —— 服务器 / 网络 ——
		filezilla: "fa7-solid:server",
		winscp: "fa7-solid:server",
		putty: "fa7-solid:server",
		mobaxterm: "fa7-solid:server",
		xshell: "fa7-solid:server",
		clash: "fa7-solid:shield-halved",
		"clash-verge": "fa7-solid:shield-halved",
		v2rayn: "fa7-solid:shield-halved",
		openlist: "fa7-solid:cloud",
		alist: "fa7-solid:cloud",
		// —— 下载 / 压缩 ——
		idman: "fa7-solid:download",
		thunder: "fa7-solid:download",
		qbittorrent: "fa7-solid:download",
		motrix: "fa7-solid:download",
		"7zfm": "fa7-solid:file-zipper",
		winrar: "fa7-solid:file-zipper",
		bandizip: "fa7-solid:file-zipper",
		// —— 系统工具 ——
		explorer: "fa7-solid:folder-open",
		taskmgr: "fa7-solid:gauge-high",
		snippingtool: "fa7-solid:crop-simple",
		everything: "fa7-solid:magnifying-glass",
		mstsc: "fa7-solid:desktop",
		calculator: "fa7-solid:calculator",
		control: "fa7-solid:sliders",
		windbg: "fa7-solid:bug",
	},

	keywordIcons: [
		{ match: "音乐", icon: "fa7-solid:music" },
		{ match: "浏览器", icon: "fa7-solid:globe" },
		{ match: "终端", icon: "fa7-solid:terminal" },
		{ match: "代码", icon: "fa7-solid:code" },
		{ match: "编辑器", icon: "fa7-solid:code" },
		{ match: "设计", icon: "fa7-solid:pen-ruler" },
		{ match: "表格", icon: "fa7-solid:file-excel" },
		{ match: "文档", icon: "fa7-solid:file-lines" },
		{ match: "视频", icon: "fa7-solid:film" },
		{ match: "播放", icon: "fa7-solid:film" },
	],
};
