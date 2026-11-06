import type { SolarTermWallpaperConfig } from "@/types/solarTermWallpaper";

/**
 * 二十四节气壁纸
 *
 * ── 怎么用 ──────────────────────────────────────────────
 * 1. 在 public 下建目录，把节气图按拼音命名，例如：
 *      public/wallpapers/solar-terms/lidong.jpg
 *      public/wallpapers/solar-terms/xiaoxue.jpg
 *      ……（24 个，见下方名单）
 * 2. 把 enable 改成 true。
 *
 * 文件名必须是小写拼音，24 个分别是：
 *   立春 lichun      雨水 yushui      惊蛰 jingzhe     春分 chunfen
 *   清明 qingming    谷雨 guyu        立夏 lixia       小满 xiaoman
 *   芒种 mangzhong   夏至 xiazhi      小暑 xiaoshu     大暑 dashu
 *   立秋 liqiu       处暑 chushu      白露 bailu       秋分 qiufen
 *   寒露 hanlu       霜降 shuangjiang 立冬 lidong      小雪 xiaoxue
 *   大雪 daxue       冬至 dongzhi     小寒 xiaohan     大寒 dahan
 *
 * ── 几个要点 ────────────────────────────────────────────
 * • 图必须放 public（或可直链的远程地址）。原因：节气是客户端算的，
 *   拿不到 Astro 构建期优化出来的 URL；public 的路径是固定的，才能直接拼。
 * • 少了某个节气的图不会报错，只会继续显示原来的随机壁纸（onerror 兜底）。
 * • 官方的节气图是竖版长图（常见 1:2 甚至 1:2.1），横幅是宽幅，
 *   直接铺会裁掉大半。建议自己裁成 1920×800 左右，或者调 position
 *   把构图重心留出来（比如人物在上半部分就用 "center 25%"）。
 * • 版权：官方图可作个人站点壁纸自用，注明出处；不要打包分发或商用。
 */
export const solarTermWallpaper: SolarTermWallpaperConfig = {
	// 默认关闭：没放图就打开会一直是随机壁纸，反倒让人以为没生效
	enable: false,
	basePath: "/wallpapers/solar-terms/",
	// 想让手机端用另一套竖图时填这里，例如 "/wallpapers/solar-terms/mobile/"
	// mobileBasePath: "/wallpapers/solar-terms/mobile/",
	extension: "jpg",
	// 竖版长图取上三分之一，人物和主体通常在那儿
	position: "center 30%",
	fadeDuration: 600,
};
