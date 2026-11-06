import type { SolarTermSlug } from "@/utils/solar-term-utils";

/**
 * 二十四节气壁纸配置
 *
 * 做法：把 24 张图按「拼音」命名放进 public 目录（或任意可直链的地址），
 * 页面加载时由客户端算出当前节气，拼出对应 URL 显示。
 *
 * 为什么不用构建时决定：站点是静态部署，构建时间 ≠ 访问时间。
 * 一次构建完可能几周不重建，构建期选出的图早就过季了。
 */
export type SolarTermWallpaperConfig = {
	/** 总开关。关掉时完全不影响现有随机壁纸 */
	enable: boolean;
	/** 桌面端图片目录，以 / 开头（public 下的路径） */
	basePath: string;
	/** 移动端图片目录；留空则与桌面端共用 */
	mobileBasePath?: string;
	/** 图片扩展名，如 "jpg" / "webp" / "avif" */
	extension: string;
	/** 图片填充方式，对应 CSS object-position，竖版长图建议 "center 30%" 之类 */
	position?: string;
	/** 淡入时长（毫秒） */
	fadeDuration?: number;
	/**
	 * 单独覆盖某几个节气的图片地址。
	 * 不需要覆盖时留空，按 `basePath + slug + "." + extension` 拼。
	 */
	files?: Partial<Record<SolarTermSlug, string>>;
};
