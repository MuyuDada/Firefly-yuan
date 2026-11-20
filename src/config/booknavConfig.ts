import type { BooknavGroup, BooknavPageConfig } from "../types/booknavConfig";

// 书签导航页面配置
export const booknavPageConfig: BooknavPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "网址导航",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description:
		"🧭 一路攒下来的站点 — 能聊天的、能查榜的、能存图的、能抬头看星星的，点开就能用",

	// favicon 自动获取配置
	favicon: {
		// 书签未填写 icon 时，是否自动获取目标站点的 favicon 图标
		enabled: true,

		// favicon 接口地址，{domain} 为占位符，会被替换成目标站点域名
		api: "https://a.favicon.im/{domain}",
	},
};

// 书签导航配置
// 每个数组项是一个分类组，分类组内的 items 是该分类下的书签
export const booknavConfig: BooknavGroup[] = [
	{
		id: "ai",
		name: "AI 助手与评测",
		icon: "material-symbols:smart-toy-rounded",
		desc: "🤖 常用几家放在前头，后面跟上各家评测榜 —— 谁强谁弱，看榜说话",
		weight: 100,
		items: [
			{ title: "ChatGPT", url: "https://chatgpt.com/", desc: "OpenAI 家的门面，写代码查资料都稳", weight: 14 },
			{ title: "Claude", url: "https://claude.ai/", desc: "长文和代码读得最细，写文档顺手", weight: 13 },
			{ title: "Gemini", url: "https://gemini.google.com/", desc: "谷歌出品，联网搜资料、看图都行", weight: 12 },
			{ title: "DeepSeek", url: "https://chat.deepseek.com/", desc: "国产开源模型，推理和数学很能打", weight: 11 },
			{ title: "Kimi", url: "https://www.kimi.com/", desc: "超长文档丢进去直接问，网页也能读", weight: 10 },
			{ title: "通义千问", url: "https://www.tongyi.com/", desc: "阿里 Qwen，中文问答与文档处理", weight: 9 },
			{ title: "腾讯元宝", url: "https://yuanbao.tencent.com/", desc: "接微信生态，公众号文章直接喂它", weight: 8 },
			{ title: "Grok", url: "https://grok.com/", desc: "xAI 出品，实时刷 X 上的动静", weight: 7 },
			{ title: "LMArena", url: "https://lmarena.ai/", desc: "大模型盲测对战榜，投票投出来的名次", weight: 6 },
			{ title: "Artificial Analysis", url: "https://artificialanalysis.ai/", desc: "智商、价格、速度放一张表里对比", weight: 5 },
			{ title: "ARC Prize", url: "https://arcprize.org/", desc: "ARC-AGI 基准，专考模型会不会举一反三", weight: 4 },
			{ title: "LiveBench", url: "https://livebench.ai/", desc: "每个月换新题的榜，防止选手刷题", weight: 3 },
			{ title: "SuperCLUE", url: "https://www.superclueai.com/", desc: "中文大模型测评，国产选手横评", weight: 2 },
			{ title: "OpenCompass 司南", url: "https://opencompass.org.cn/", desc: "上海 AI 实验室的开源评测体系", weight: 1 },
		],
	},
	{
		id: "hosting",
		name: "博客托管",
		icon: "material-symbols:cloud-rounded",
		desc: "🚀 都免备案、都有免费额度，Hexo 生成的静态站推上去就能跑",
		weight: 90,
		items: [
			{ title: "Cloudflare Pages", url: "https://pages.cloudflare.com/", desc: "免费不限流量，每月 500 次构建", weight: 10 },
			{ title: "GitHub Pages", url: "https://pages.github.com/", desc: "老牌免费，仓库一推就自动发布", weight: 9 },
			{ title: "EdgeOne Pages", url: "https://pages.edgeone.ai/", desc: "腾讯出品，国内节点快，免备案", weight: 8 },
			{ title: "Vercel", url: "https://vercel.com/", desc: "Hobby 计划免费，每月 100GB 流量", weight: 7 },
			{ title: "Netlify", url: "https://www.netlify.com/", desc: "免费 100GB 流量加 300 分钟构建", weight: 6 },
			{ title: "GitLab Pages", url: "https://docs.gitlab.com/user/project/pages/", desc: "私有仓库也能免费发静态站", weight: 5 },
			{ title: "Render", url: "https://render.com/", desc: "静态站点永久免费，自动配 HTTPS", weight: 4 },
			{ title: "Surge", url: "https://surge.sh/", desc: "命令行一条 surge 就发布，极简", weight: 3 },
			{ title: "Firebase Hosting", url: "https://firebase.google.com/products/hosting", desc: "谷歌托管，每月 10GB 存储免费", weight: 2 },
			{ title: "Zeabur", url: "https://zeabur.com/", desc: "中文界面友好，注册就有免费额度", weight: 1 },
		],
	},
	{
		id: "image-hosting",
		name: "图床服务",
		icon: "material-symbols:image-rounded",
		desc: "🖼️ 写博客总得外链图片 —— 这些都是国内能直连的免费图床，实测正常",
		weight: 80,
		items: [
			{ title: "PICUI 图床", url: "https://picui.cn/", desc: "公益图床，注册后不限量，接口开放", weight: 10 },
			{ title: "图床小镇", url: "https://imgbed.cn/", desc: "免登录直接传，单图 100MB，还收视频和 ZIP", weight: 9 },
			{ title: "路过图床", url: "https://imgchr.com/", desc: "老牌免费图床，免注册，单图 10MB", weight: 8 },
			{ title: "img.loc", url: "https://imgloc.com/", desc: "匿名可传，一次排队 5 张、每小时 60 张", weight: 7 },
			{ title: "ImageHub 图仓", url: "https://imagehub.cc/", desc: "公益图床，游客也能传，单图 5MB", weight: 6 },
			{ title: "西洋图床", url: "https://imgsea.com/", desc: "免注册可用，单图 10MB，注册后功能更全", weight: 5 },
			{ title: "水墨图床", url: "https://img.ink/", desc: "单图 12MB、一次 50 张，禁止商用", weight: 4 },
			{ title: "Imgos 图床", url: "https://imgos.cn/", desc: "注册后可用，国内 CDN 快", weight: 3 },
			{ title: "PicGo 图床", url: "https://picgo.net/", desc: "在线版，单图 25MB，建议注册", weight: 2 },
			{ title: "聚合图床", url: "https://www.superbed.cn/", desc: "一个接口聚合多家图床，直链稳，支持 API", weight: 1 },
		],
	},
	{
		id: "community",
		name: "知识社区",
		icon: "material-symbols:forum-rounded",
		desc: "💬 问答、股票、技术、资讯 —— 想找人聊两句、看看别人在想什么，来这儿",
		weight: 70,
		items: [
			{ title: "知乎", url: "https://www.zhihu.com/", desc: "中文问答主场，搜问题先看这里", weight: 12 },
			{ title: "哔哩哔哩", url: "https://www.bilibili.com/", desc: "学习区和科技区当免费公开课看，弹幕陪着不困", weight: 11 },
			{ title: "雪球", url: "https://xueqiu.com/", desc: "股民聊股票的地方，行情和吐槽一起看", weight: 10 },
			{ title: "V2EX", url: "https://www.v2ex.com/", desc: "程序员的深夜茶馆，聊技术也聊生活", weight: 9 },
			{ title: "LinuxDo", url: "https://linux.do/", desc: "技术社区新秀，搞 AI 和爱折腾的人多", weight: 8 },
			{ title: "少数派", url: "https://sspai.com/", desc: "讲效率工具和数字生活，写得很认真", weight: 7 },
			{ title: "掘金", url: "https://juejin.cn/", desc: "中文技术文章集散地，前端后端都有", weight: 6 },
			{ title: "律动 BlockBeats", url: "https://www.theblockbeats.info/", desc: "区块链新闻，币圈动静更新得快", weight: 5 },
			{ title: "奇客 Solidot", url: "https://www.solidot.org/", desc: "老牌科技新闻站，一条一句，看得快", weight: 4 },
			{ title: "Reddit", url: "https://www.reddit.com/", desc: "国外版贴吧，什么话题都有人接", weight: 3 },
			{ title: "X（原 Twitter）", url: "https://x.com/", desc: "全球实时信息流，科技圈和媒体都在这儿首发", weight: 2 },
			{ title: "Hacker News", url: "https://news.ycombinator.com/", desc: "硅谷技术圈风向标，英文原味", weight: 1 },
		],
	},
	{
		id: "tools",
		name: "实用工具",
		icon: "material-symbols:build-rounded",
		desc: "🧰 压图片、转 PDF、传大文件、画流程图，用完即走不用装",
		weight: 60,
		items: [
			{ title: "TinyPNG", url: "https://tinypng.com/", desc: "图片压缩神器，拖进去就小一半", weight: 18 },
			{ title: "Squoosh", url: "https://squoosh.app/", desc: "谷歌开源，压缩前后左右对比着看", weight: 17 },
			{ title: "Photopea", url: "https://www.photopea.com/", desc: "网页里的 PS，能直接打开 PSD", weight: 16 },
			{ title: "iLovePDF", url: "https://www.ilovepdf.com/zh-cn", desc: "PDF 转 Word、合并、拆分、加水印", weight: 15 },
			{ title: "Smallpdf", url: "https://smallpdf.com/cn", desc: "PDF 与 Office 互转，界面最清爽", weight: 14 },
			{ title: "CloudConvert", url: "https://cloudconvert.com/", desc: "两百多种格式互转，什么都能转", weight: 13 },
			{ title: "奶牛快传", url: "https://cowtransfer.com/", desc: "大文件传得快，不登录也能发", weight: 12 },
			{ title: "文叔叔", url: "https://www.wenshushu.cn/", desc: "免费传文件，单文件最大 5GB", weight: 11 },
			{ title: "WeTransfer", url: "https://wetransfer.com/", desc: "国际老牌，发链接给谁都认", weight: 10 },
			{ title: "Coolors", url: "https://coolors.co/", desc: "一键生成配色方案，锁色调色很爽", weight: 9 },
			{ title: "ray.so", url: "https://ray.so/", desc: "把代码贴进去生成好看的截图", weight: 8 },
			{ title: "Excalidraw", url: "https://excalidraw.com/", desc: "手绘风流程图，随手画两笔就成", weight: 7 },
			{ title: "draw.io", url: "https://app.diagrams.net/", desc: "免费专业的流程图和架构图工具", weight: 6 },
			{ title: "Regex101", url: "https://regex101.com/", desc: "正则在线调试，每步匹配都讲清楚", weight: 5 },
			{ title: "ITDOG", url: "https://www.itdog.cn/", desc: "全国节点 ping、测速与网站检测", weight: 4 },
			{ title: "草料二维码", url: "https://cli.im/", desc: "生成二维码，还能做活码和表单", weight: 3 },
			{ title: "PicGo", url: "https://picgo.app/", desc: "开源图床上传客户端，拖一下就传好", weight: 2 },
			{ title: "PicList", url: "https://piclist.cn/", desc: "PicGo 增强版，加水印、改格式都行", weight: 1 },
		],
	},
	{
		id: "astronomy",
		name: "仰望星空",
		icon: "material-symbols:auto-awesome-rounded",
		desc: "🔭 光污染、星图、云图、风场，外加正往天上扔火箭的那几家",
		weight: 50,
		items: [
			{ title: "SpaceX", url: "https://www.spacex.com/", desc: "星舰与猎鹰的发射直播、任务档案都在这儿", weight: 14 },
			{ title: "全球光污染地图", url: "https://www.lightpollutionmap.info/", desc: "查你家附近的光污染等级，观星必备", weight: 13 },
			{ title: "Stellarium Web", url: "https://stellarium-web.org/", desc: "浏览器里的星图，抬头对着看", weight: 12 },
			{ title: "Stellarium", url: "https://stellarium.org/", desc: "开源桌面星象馆，能模拟一万年", weight: 11 },
			{ title: "Heavens-Above", url: "https://heavens-above.com/", desc: "查空间站和卫星几点几分过境", weight: 10 },
			{ title: "天文通", url: "https://laysky.com/", desc: "中文观星助手，云量光污染一起看", weight: 9 },
			{ title: "NASA Worldview", url: "https://worldview.earthdata.nasa.gov/", desc: "NASA 卫星影像，看全球实时变化", weight: 8 },
			{ title: "Zoom Earth", url: "https://zoom.earth/", desc: "实时卫星云图，台风从哪来一目了然", weight: 7 },
			{ title: "earth.nullschool", url: "https://earth.nullschool.net/", desc: "全球风场洋流可视化，美到想截图", weight: 6 },
			{ title: "Windy", url: "https://www.windy.com/", desc: "风、雨、云、浪，天气预报里最好看", weight: 5 },
			{ title: "Ventusky", url: "https://www.ventusky.com/", desc: "天气动图，气温气压一层层叠", weight: 4 },
			{ title: "NASA Eyes", url: "https://eyes.nasa.gov/", desc: "NASA 官方可视化，跟着探测器飞", weight: 3 },
			{ title: "Clear Outside", url: "https://clearoutside.com/", desc: "按小时报观星天气，专为拍星党做", weight: 2 },
			{ title: "SunCalc", url: "https://www.suncalc.org/", desc: "日出日落与银河月亮方位一目了然", weight: 1 },
		],
	},
];
