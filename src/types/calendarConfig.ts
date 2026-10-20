/**
 * 站点日历页面配置类型
 *
 * 注意：这里刻意与 `./sidebarConfig` 中的 `CalendarConfig`（侧栏日历组件配置）区分，
 * 页面级配置统一使用 `SiteCalendarConfig` 命名，避免类型名冲突。
 */

/** 日期规则类型：solar = 公历（每年重复），lunar = 农历（由内置算法换算） */
export type CalendarDateType = "solar" | "lunar";

/** 生日 / 内置节日共用的日期规则 */
export interface CalendarDateRule {
	/** 公历或农历 */
	type: CalendarDateType;
	/** 月份，1-12 */
	month: number;
	/** 日，1-31（农历为 1-30） */
	day: number;
}

/** 生日 / 纪念日 */
export interface CalendarBirthday {
	/** 名称，如「建站日」 */
	name: string;
	/** 日期规则，支持公历与农历 */
	date: CalendarDateRule;
	/** Iconify 图标名，缺省时使用蛋糕图标 */
	icon?: string;
	/** 备注，显示在事件详情里 */
	note?: string;
}

/** 安排重复频率 */
export type CalendarRecurringFreq = "yearly" | "monthly" | "weekly";

/** 安排的重复规则 */
export interface CalendarScheduleRecurring {
	/** yearly / monthly / weekly */
	freq: CalendarRecurringFreq;
	/** 月份（yearly 时使用），1-12 */
	month?: number;
	/** 日，1-31（yearly / monthly 时使用） */
	day?: number;
	/** 星期几（weekly 时使用），0 = 周日 */
	weekday?: number;
	/** 是否为农历（仅 freq: "yearly" 时生效） */
	lunar?: boolean;
}

/** 一次性或重复的安排 */
export interface CalendarSchedule {
	/** 标题 */
	title: string;
	/** 一次性安排，格式 YYYY-MM-DD；与 `recurring` 二选一 */
	date?: string;
	/** 重复安排 */
	recurring?: CalendarScheduleRecurring;
	/** Iconify 图标名，缺省时使用日程图标 */
	icon?: string;
	/** 备注 */
	note?: string;
}

/** 内置节日（无需联网，构建期直接算出） */
export interface BuiltinHoliday {
	/** 节日名 */
	name: string;
	/** 日期规则 */
	date: CalendarDateRule;
	/** Iconify 图标名，缺省时使用庆典图标 */
	icon?: string;
}

/** 站点日历页配置 */
export interface SiteCalendarConfig {
	/** 页面标题 */
	title: string;
	/** 页面副标题 */
	description: string;
	/** 额外内置节日（公历固定节日、农历节日之外的补充） */
	builtinHolidays: BuiltinHoliday[];
	/** 生日 / 纪念日列表 */
	birthdays: CalendarBirthday[];
	/** 安排列表 */
	schedules: CalendarSchedule[];
	/** 显示开关 */
	show: {
		/** 是否把发文日期标到日历上 */
		posts: boolean;
		/** 是否在日历格子里显示农历日期 */
		lunarDate: boolean;
		/** 是否显示法定节假日与调休补班（数据来自 src/constants/holidays.json） */
		officialHolidays: boolean;
		/** 是否显示二十四节气 */
		solarTerms: boolean;
	};
	/** 左侧「近期事件」概览 */
	overview: {
		/** 向后看多少天 */
		futureDays: number;
		/** 最多显示几条 */
		maxItems: number;
	};
}
