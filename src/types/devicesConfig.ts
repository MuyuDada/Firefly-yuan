// 设备展示页配置类型
//
// 页面访问路径 `/devices/`，关闭开关请改 `siteConfig.pages.devices`。
// 数据本身放在 `src/config/devicesConfig.ts`，日常只维护那个文件。

/** 单台设备 */
export interface Device {
	/** 设备名称，如 "iPhone 17 Pro" */
	name: string;
	/**
	 * 设备图片：
	 * - 完整外链（官网 CDN / 图床），如 "https://example.com/device.webp"
	 * - 站内 public 路径，如 "/assets/images/devices/phone.webp"
	 * 留空则卡片显示通用设备图标占位。
	 */
	image: string;
	/** 规格胶囊文案，如 "深蓝色 / 12G + 256G" */
	specs: string;
	/** 一句话描述，卡片里最多显示两行 */
	description: string;
	/** 详情外链（新窗口打开） */
	link: string;
	/** 价格胶囊文案（可选），如 "8999元" */
	price?: string;
}

/** 分类名 → 该分类下的设备列表；分类名即筛选按钮文案 */
export type DeviceCategory = Record<string, Device[]>;

export interface DevicesConfig {
	/** 设备数据：按分类分组，分类可随意增删 */
	categories: DeviceCategory;
	/**
	 * 分类图标（Iconify 名称 → 见 astro-icon include 的图标集）。
	 * 没配的分类统一回落 "material-symbols:devices"。
	 */
	categoryIcons?: Record<string, string>;
}
