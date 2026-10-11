// 全屏页面加载动画（PageLoader）配置类型
// 架构参考 https://blog.huchao.vip/posts/astro/firefly-page-loader/，
// 视觉改为围绕像素小猫（loading-cat.gif）设计。

/** 加载动画样式：cat 为猫咪主题（像素对话框 + 汉堡进度条），image 只显示图片，dots 为纯 CSS 像素点 */
export type PageLoaderStyle = "cat" | "image" | "dots";

/** 加载动画遮罩：solid 纯色、blur 毛玻璃、theme 跟随主题变量 */
export type PageLoaderBackdrop = "solid" | "blur" | "theme";

export type PageLoaderConfig = {
	enable: boolean; // 是否启用全屏加载动画
	showOnInitial: boolean; // 首次进入站点时是否显示
	showOnNavigate: boolean; // Swup 切页时是否显示
	showOnMobile: boolean; // 移动端（<768px）是否显示
	style: PageLoaderStyle; // 动画样式
	image: string; // 中心图片地址（像素小猫 GIF）
	text: string; // 加载文案，留空则使用 i18n
	minDuration: number; // 最短显示时长（ms），避免一闪而过
	maxWait: number; // 最长等待时长（ms），超时强制隐藏
	hideDelay: number; // 页面就绪后延迟隐藏（ms）
	backdrop: PageLoaderBackdrop; // 遮罩样式
	zIndex: number; // 层级，需高于导航栏与看板娘
};
