import { devicesConfig } from "@/config";
import type { Device, DeviceCategory } from "@/types/devicesConfig";

/** 带分类信息的设备项（卡片渲染与筛选都需要分类名） */
export interface DeviceWithCategory extends Device {
	category: string;
}

const DEFAULT_CATEGORY_ICON = "material-symbols:devices";

/** 把「分类 → 设备数组」展开成一维列表，并给每台设备附加分类名 */
export function listDevicesWithCategory(
	categories: DeviceCategory = devicesConfig.categories,
): DeviceWithCategory[] {
	return Object.entries(categories).flatMap(([category, devices]) =>
		devices.map((device) => ({ ...device, category })),
	);
}

/** 分类的筛选按钮数据：名称、图标、数量 */
export function listDeviceCategories(
	categories: DeviceCategory = devicesConfig.categories,
): { name: string; icon: string; count: number }[] {
	return Object.entries(categories).map(([name, devices]) => ({
		name,
		icon: devicesConfig.categoryIcons?.[name] ?? DEFAULT_CATEGORY_ICON,
		count: devices.length,
	}));
}

/** 取分类图标，未配置时回落到通用设备图标 */
export function getDeviceCategoryIcon(category: string): string {
	return devicesConfig.categoryIcons?.[category] ?? DEFAULT_CATEGORY_ICON;
}
