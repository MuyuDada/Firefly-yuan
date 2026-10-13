import type { DeviceStatusConfig } from "@/types/deviceStatusConfig";

// 电脑状态组件配置
//
// 数据链路：本机 PowerShell 变化驱动上报 → Cloudflare Worker + KV → 访客浏览器只读。
// 纯静态博客读不到本机信息，所以只能由本机主动上报、页面被动读取。
//
// 想加新应用：只需要在本机上报脚本的映射表里加，这里不用动。
// 这里负责「进程名 → 图标名」与「进程名 → 品牌色」，与上报脚本的 104 条进程名零缺口。
export const deviceStatusConfig: DeviceStatusConfig = {
	enable: true,

	// 只读接口。留空等于未启用：卡片会整块隐藏，页面上不会留一块空白。
	// 注意：不要用 *.workers.dev 那个地址，部分网络下该域名不可达，已改为自有域名。
	endpoint: "https://muyuhome.cc.cd/api/device/status",

	// 前端轮询间隔（秒）。
	// 本机侧是「变化驱动 + 心跳」：前台应用一换就立刻上报，没换时在线 5 分钟才发
	// 一次心跳（离开/锁屏 10 分钟）。所以这里没必要跟着 30 秒跑，60 秒足够。
	refreshIntervalSeconds: 60,
	requestTimeoutMs: 8000,
	// 离线判定的权威值在 Worker 侧：它按上报的 heartbeatSeconds 动态推算
	// （阈值 = max(心跳 × 2, 心跳 + 60s)，夹在 [120s, 2 天]），并以 staleAfterSeconds
	// 字段随响应回传。这里仅作兜底说明，不参与判断。
	staleAfterSeconds: 300,
	// 后台标签页的定时器会被浏览器降频，切回前台时距上次成功超过这个值就立刻补一次
	visibilityRefreshAfterSeconds: 20,

	// 备用通道：主通道取不到新鲜数据时的兜底来源。
	// 本机上报脚本会把同一份记录再写一份到 GitHub Gist，这里指向它的 raw 地址。
	//
	// 为什么需要它：主通道整条链路都压在 Cloudflare 上（域名被污染、Worker 故障、
	// KV 额度耗尽都会失效），而 GitHub raw 是完全独立的另一套链路，同时挂掉概率很低。
	//
	// 代价：GitHub raw 的 CDN 缓存是 300 秒，直接读可能拿到旧副本。实测给 URL 挂一个
	// 随机查询串就能让 CDN 回 MISS（缓存键含 query string），所以请求时会加 cache-bust
	// 参数。即便如此，仍要按快照里的 reportedAt 在本地判一次时效 —— 万一 CDN 还是发了
	// 旧副本，也不会把「早就离线」显示成「在线」。
	fallbackEndpoint:
		"https://gist.githubusercontent.com/MuyuDada/ddca5e9cfef3026b2503b56486cbb365/raw/device.json",

	// 进程名（小写）→ Iconify 图标名。
	// 进程名优先命中，其次按应用名关键词兜底，最后给通用显示器图标。
	iconMap: {
		// —— 编辑器 / IDE ——
		code: "fa7-solid:code",
		"code - insiders": "fa7-solid:code",
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
		wsl: "fa7-solid:terminal",
		// —— 浏览器 ——
		msedge: "fa7-brands:edge",
		msedgewebview2: "fa7-brands:edge",
		chrome: "fa7-brands:chrome",
		firefox: "fa7-brands:firefox-browser",
		brave: "fa7-brands:brave",
		opera: "fa7-brands:opera",
		safari: "fa7-brands:safari",
		iexplore: "fa7-brands:internet-explorer",
		"360se": "fa7-solid:globe",
		"360chrome": "fa7-solid:globe",
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
		"league of legends": "fa7-solid:gamepad",
		"deltaforceclient-win64-shipping": "fa7-solid:crosshairs",
		delta_force_launcher: "fa7-solid:crosshairs",
		nzmclient: "fa7-solid:gun",
		nzm_launcher: "fa7-solid:gun",
		wegame: "fa7-solid:gamepad",
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
		regedit: "fa7-solid:pen-ruler",
		mmc: "fa7-solid:screwdriver-wrench",
		windbg: "fa7-solid:bug",
	},

	// 进程名（小写）→ 品牌色。
	// Iconify 的图标本身是单色的，不配颜色的话 Edge 也会被染成状态色。
	// 只列常用应用，没命中的回落到状态色（在线绿/离开橙/锁屏灰/离线红）。
	iconColors: {
		// —— 浏览器 ——
		msedge: "#0f7ac0",
		msedgewebview2: "#0f7ac0",
		chrome: "#d93025",
		firefox: "#e66000",
		brave: "#e04a2f",
		opera: "#c0392b",
		safari: "#1a9de0",
		// —— 通讯 ——
		wechat: "#07c160",
		weixin: "#07c160",
		qq: "#12b7f5",
		tim: "#12b7f5",
		telegram: "#229ed9",
		discord: "#5865f2",
		skype: "#00aff0",
		whatsapp: "#25d366",
		line: "#06c755",
		// —— 音乐 / 影音 ——
		cloudmusic: "#c20c0c",
		qqmusic: "#31c27c",
		spotify: "#1db954",
		bilibili: "#00a1d6",
		youtube: "#ff0000",
		twitch: "#9146ff",
		vlc: "#ff8800",
		// —— 游戏 ——
		steam: "#1b2838",
		steamwebhelper: "#1b2838",
		epicgameslauncher: "#2a2a2a",
		unity: "#4a4a4a",
		blender: "#ea7600",
		xbox: "#107c10",
		// —— 办公 / 设计 ——
		winword: "#2b579a",
		excel: "#217346",
		powerpnt: "#d24726",
		wps: "#e8443a",
		acrobat: "#dc2b21",
		acrord32: "#dc2b21",
		notion: "#2f2f2f",
		figma: "#a259ff",
		photoshop: "#31a8ff",
		illustrator: "#ff9a00",
		afterfx: "#9999ff",
		premiere: "#9999ff",
		// —— 开发工具 ——
		"github desktop": "#6e5494",
		docker: "#2496ed",
		postman: "#ff6c37",
		// —— 服务器 / 网络 ——
		openlist: "#3b82f6",
		alist: "#3b82f6",
		clash: "#5b6ee1",
		"clash-verge": "#5b6ee1",
		v2rayn: "#5b6ee1",
		// —— 下载 ——
		qbittorrent: "#2f67b2",
		thunder: "#2e8ae6",
		idman: "#1c7ed6",
		motrix: "#5b8def",
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
