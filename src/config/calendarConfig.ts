import type { SiteCalendarConfig } from "@/types/config";

/**
 * 站点日历页面配置
 *
 * 说明：
 * - 页面访问路径 `/calendar/`，关闭开关请改 `siteConfig.pages.calendar`。
 * - 节日全部由内置算法在构建期算出（公历固定节日 + 农历传统节日 + 清明 + 除夕），
 *   不依赖任何外部节假日 API，离线可用。
 * - 法定节假日与调休补班来自 `src/constants/holidays.json`（由 timor.tech 的年度数据
 *   预先抓取并静态化，构建期不联网）。数据只覆盖已有年份，缺年份时该年不显示「休/班」角标。
 * - 二十四节气用 `src/utils/solar-terms.ts` 的公式在构建期算出，无需数据文件。
 * - 日期规则的 `type`：
 *   - `"solar"`：公历年月日，每年重复；
 *   - `"lunar"`：农历年月日，由 src/utils/lunar-utils.ts 换算。
 * - `icon` 不填时回落类型默认图标
 *   （节日 celebration / 生日 cake / 安排 event / 文章 article）。
 *   Iconify 图标在本仓库 `astro.config.mjs` 中按 `"material-symbols": ["*"]` 全量包含，
 *   直接写名字即可，无需任何生成步骤。
 */
export const calendarConfig: SiteCalendarConfig = {
	title: "站点日历",
	description: "节日、纪念日、安排与文章发布，都在同一张日历上",

	// 补充节日：公历固定日期（农历节日已内置，无需在此重复）
	builtinHolidays: [
		{
			name: "情人节",
			date: { type: "solar", month: 2, day: 14 },
			icon: "material-symbols:favorite",
		},
		{
			name: "儿童节",
			date: { type: "solar", month: 6, day: 1 },
			icon: "material-symbols:celebration",
		},
		{
			name: "教师节",
			date: { type: "solar", month: 9, day: 10 },
			icon: "material-symbols:festival",
		},
	],

	// 生日 / 纪念日
	birthdays: [
		{
			name: "建站日",
			date: { type: "solar", month: 8, day: 24 },
			icon: "material-symbols:rocket-launch",
			note: "小窝的第一行代码",
		},
		{
			name: "我的阳历生日",
			date: { type: "solar", month: 10, day: 29 },
			icon: "material-symbols:cake",
			note: "阳历十月二十九",
		},
		{
			name: "我的农历生日",
			date: { type: "lunar", month: 10, day: 29 },
			icon: "material-symbols:cake",
			note: "农历十月二十九",
		},
	],

	// 安排（一次性写 date: "YYYY-MM-DD"，重复写 recurring）
	schedules: [
		// {
		// 	title: "博客周检",
		// 	recurring: { freq: "weekly", weekday: 1 },
		// 	icon: "material-symbols:event-note",
		// 	note: "每周一检查更新与依赖",
		// },
	],

	show: {
		// 把发文日期标到日历上
		posts: true,
		// 日历格子里显示农历日期
		lunarDate: true,
		// 法定节假日与调休补班（数据来自 src/constants/holidays.json，静态文件不联网）
		officialHolidays: true,
		// 二十四节气（构建期用公式算出）
		solarTerms: true,
	},

	overview: {
		// 左侧「近期事件」向后看多少天
		futureDays: 30,
		// 最多显示几条
		maxItems: 6,
	},
};
