import type { PageLoaderConfig } from "../types/pageLoaderConfig";

// 全屏页面加载动画配置
// 视觉围绕像素小猫 loading-cat.gif 设计：像素对话框 + 汉堡进度条
export const pageLoaderConfig: PageLoaderConfig = {
	enable: true, // 是否启用全屏加载动画
	showOnInitial: true, // 首次进入站点时显示
	showOnNavigate: true, // Swup 切页时显示
	showOnMobile: true, // 移动端（<768px）显示
	style: "cat", // 猫咪主题：图片 + 像素气泡 + 汉堡进度条
	image: "/assets/images/loading-cat.gif", // 像素小猫（本地资源，避免 CDN 往返）
	text: "", // 留空则使用 i18n 文案
	minDuration: 900, // 最短显示时长（ms）
	maxWait: 2600, // 最长等待时长（ms），超时强制隐藏
	hideDelay: 120, // 就绪后延迟隐藏（ms）
	backdrop: "blur", // 毛玻璃遮罩
	zIndex: 10000, // 高于导航栏（20）、光标（10086 之下仍可见动画）
};
