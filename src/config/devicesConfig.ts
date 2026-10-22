import type { DevicesConfig } from "@/types/devicesConfig";

// 设备展示页配置
//
// 页面路径：`/devices/`（开关在 src/config/siteConfig.ts 的 pages.devices）
// 日常只改这个文件：按分类名分组，分类名就是筛选按钮上的文案，可随意增删。
//
// 每台设备的字段：
// - name        设备名称（必填）
// - image       图片地址（必填，可留空显示通用占位图标）
//               支持三种写法：
//               1. 完整外链："https://img.example.com/device.webp"（官网 CDN / 图床，推荐）
//               2. 站内 public 路径："/assets/images/devices/phone.webp"
//               3. 空字符串 ""：卡片显示通用设备图标
// - specs       规格，显示为胶囊标签（必填）
// - description 一句话描述，卡片里最多两行（必填）
// - link        详情外链，新窗口打开（必填，没有官网可填 "#"）
// - price       价格，显示为第二个胶囊标签（可选，不填则不显示）
//
// 改完需要重新 build（pnpm build）才能在线上生效。
export const devicesConfig: DevicesConfig = {
	categories: {
		数码: [
			{
				name: "iPhone 15",
				image: "https://muyuimg.cc.cd/file/blog/7RLvWKvx.webp",
				specs: "黑色 / 6G + 128G",
				description: "创新设计，打造巅峰性能和超长续航。",
				link: "https://www.apple.com.cn/",
				price: "3000元",
			},
			{
				name: "iPhone 13 Mini",
				image: "https://muyuimg.cc.cd/file/blog/NTojIQDu.webp",
				specs: "蓝色 / 256G",
				description: "看文档、画草图、追番都够用的那块屏幕。",
				link: "https://www.apple.com.cn/",
				price: "2700元",
			},
		],
		电脑: [
			{
				name: "戴尔G15-5511",
				image: "https://muyuimg.cc.cd/file/blog/Ez07yPj5.webp",
				specs: "i5-1126H / RTX 3050/ 16G+512G",
				description: "主力生产力机器，跑构建和剪视频。",
				link: "#",
				price: "6400元",
			},
			// {
			// 	name: "技嘉 RTX 5060 魔鹰 OC",
			// 	image: "",
			// 	specs: "8GB / 魔鹰 OC",
			// 	description: "主力显卡，目前没有带不动的游戏。",
			// 	link: "https://www.gigabyte.cn/Graphics-Card/",
			// 	price: "2513元",
			// },
		],
		外设: [
			{
				name: "泰坦军团 P2510H Plus 24.5英寸显示器",
				image: "https://muyuimg.cc.cd/file/blog/HB3TfD8x.webp",
				specs: "24.5英寸 1K 260Hz / 硬件低蓝光",
				description: "主显示器，可升降旋转俯仰。",
				link: "https://www.titanarmy.com/",
				price: "500元",
			},
			// {
			// 	name: "真我 Buds Air6",
			// 	image: "",
			// 	specs: "入耳式 / TWS 蓝牙 / 钛空橙",
			// 	description: "50dB 深海降噪，通勤标配。",
			// 	link: "https://buy.realme.com/cn/goods/583",
			// 	price: "299元",
			// },
		],
	},

	// 分类图标（Iconify 图标名）；没配的分类统一用 material-symbols:devices
	categoryIcons: {
		数码: "material-symbols:devices",
		电脑: "material-symbols:desktop-windows",
		外设: "material-symbols:keyboard",
	},
};
