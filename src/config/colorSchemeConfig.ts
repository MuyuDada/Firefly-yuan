import type {
	ColorSchemeConfig,
	TextureConfig,
} from "../types/colorSchemeConfig";

// Color Style / Color Spec 配置
// 对应 Shirone 主题设置面板「外观 → Color Style / Color Spec」两项
// 参考站点：https://shirone.mysqil.com/（themeColor.style = "tonalSpot"，spec = "2025"）
export const colorSchemeConfig: ColorSchemeConfig = {
	// 总开关：关闭后设置面板中不显示这两项，站点保持 Firefly 原有 --hue 配色
	enable: true,

	// 默认配色风格
	defaultStyle: "tonalSpot",

	// 默认配色规范版本
	defaultSpec: "2025",

	// 源色色度：与 Shirone 保持一致（Hct.from(hue, 60, 50)）
	sourceChroma: 60,

	// 源色色调：与 Shirone 保持一致
	sourceTone: 50,

	// 把 M3 角色色映射到 Firefly 语义变量，让 Color Style 真正改变站点观感
	// 若只想保留 --mc-* 角色变量供自定义样式使用，可设为 false
	applyToTheme: true,
};

// Background Texture 配置
// 对应 Shirone 主题设置面板「外观 → Background Texture」
// 默认值与 Shirone 一致：preset = "starlight"，opacity = 0.12
// 说明：Shirone 的默认 preset 是 starlight；这里为了不改变 Firefly 既有观感，
// 默认设为 "none" —— 用户可在设置面板中主动开启
export const textureConfig: TextureConfig = {
	// 总开关：关闭后设置面板中不显示纹理选择器
	enable: true,

	// 默认纹理预设
	defaultPreset: "none",

	// 默认纹理不透明度，与 Shirone 一致
	defaultOpacity: 0.12,

	// 允许纹理动画（starlight 浮动 / topography 流动 / sakura 飘落）
	allowMotion: true,
};
