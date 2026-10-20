/**
 * 站点日历事件聚合
 *
 * 把节日、生日、安排、文章四类事件统一成 `CalendarEvent`，
 * 全部在构建期（SSR）计算，所以不需要任何客户端数据请求。
 */

import { calendarConfig } from "@/config";
import holidaysData from "@/constants/holidays.json";
import type {
	CalendarDateRule,
	CalendarSchedule,
	SiteCalendarConfig,
} from "@/types/config";
import {
	formatDateKey,
	LUNAR_FESTIVALS,
	lunarDayName,
	lunarToSolar,
	qingmingDay,
	solarToLunar,
	startOfDay,
} from "@/utils/lunar-utils";
import { getSolarTerms } from "@/utils/solar-terms";

/** 事件类型 */
export type CalendarEventType =
	| "holiday"
	| "term"
	| "birthday"
	| "workday"
	| "schedule"
	| "post";

/** 统一的事件结构 */
export interface CalendarEvent {
	/** 唯一 id，用于选中态与 DOM 定位 */
	id: string;
	/** 事件类型 */
	type: CalendarEventType;
	/** 名称 */
	name: string;
	/** 事件发生日（本地时区 00:00） */
	date: Date;
	/** YYYY-MM-DD */
	dateKey: string;
	/** Iconify 图标名 */
	icon: string;
	/** 备注 / 说明 */
	note?: string;
	/** 农历写法，如「八月十五」 */
	lunar?: string;
	/** 是否法定节假日（本仓库不接 API，仅内置节日标记为 true） */
	isOfficial?: boolean;
	/** 点击后的跳转地址（文章事件用） */
	url?: string;
}

/** 类型对应的默认图标 */
export const EVENT_TYPE_ICON: Record<CalendarEventType, string> = {
	holiday: "material-symbols:celebration",
	term: "material-symbols:spa",
	birthday: "material-symbols:cake",
	workday: "material-symbols:work",
	schedule: "material-symbols:event",
	post: "material-symbols:article",
};

/** 类型对应的事件颜色 class 后缀 */
export const EVENT_TYPE_CLASS: Record<CalendarEventType, string> = {
	holiday: "holiday",
	term: "term",
	birthday: "birthday",
	workday: "workday",
	schedule: "schedule",
	post: "post",
};

/** 法定节假日 / 调休补班的单日信息（用于格子角标与当日详情） */
export interface OfficialDay {
	/** true = 放假，false = 调休补班 */
	rest: boolean;
	/** 所属节假日名或补班名，如「国庆节」「春节前补班」 */
	name: string;
	/** 加班工资倍数，1 表示普通补班 */
	wage: number;
}

/** 节假日数据文件的单条记录 */
interface HolidayRecord {
	date: string;
	name: string;
	rest: boolean;
	wage: number;
	target?: string;
}

/** `src/constants/holidays.json` 的结构：年份 -> 该年全部法定节假日/补班日 */
type HolidayData = Record<string, HolidayRecord[]>;

/** 把节假日数据按年份索引一次，避免每次都遍历 */
const HOLIDAY_DATA = holidaysData as HolidayData;

/** 法定节假日的基础放假规则（用于数据缺失年份的兜底，不含调休补班） */
interface StatutoryRule {
	/** 节日名，写入角标 title */
	name: string;
	/** 该年放假日的第一天 */
	resolve: (year: number) => Date | null;
	/** 连续放假天数（《全国年节及纪念日放假办法》2025 年修订版） */
	days: number;
}

/**
 * 兜底规则：官方次年安排一般要到当年 11-12 月才公布，
 * 在此之前 `holidays.json` 没有该年数据，这里按法定天数合成放假日，
 * 保证未来的节日至少能看到「休」角标（调休补班无法预测，留空）。
 */
const STATUTORY_RULES: readonly StatutoryRule[] = [
	{ name: "元旦", resolve: (year) => new Date(year, 0, 1), days: 1 },
	{
		name: "春节",
		// 除夕起放假，除夕 = 正月初一的前一天
		resolve: (year) => {
			const newYear = lunarToSolar(year, 1, 1, false);
			if (!newYear) return null;
			const eve = new Date(newYear);
			eve.setDate(eve.getDate() - 1);
			return eve;
		},
		days: 4,
	},
	{
		name: "清明节",
		resolve: (year) => new Date(year, 3, qingmingDay(year)),
		days: 1,
	},
	{ name: "劳动节", resolve: (year) => new Date(year, 4, 1), days: 2 },
	{
		name: "端午节",
		resolve: (year) => lunarToSolar(year, 5, 5, false),
		days: 1,
	},
	{
		name: "中秋节",
		resolve: (year) => lunarToSolar(year, 8, 15, false),
		days: 1,
	},
	{ name: "国庆节", resolve: (year) => new Date(year, 9, 1), days: 3 },
];

/** 按法定天数合成某一年的放假日（数据文件缺该年时使用） */
function buildStatutoryOfficialDays(year: number): Record<string, OfficialDay> {
	const map: Record<string, OfficialDay> = {};
	for (const rule of STATUTORY_RULES) {
		const start = rule.resolve(year);
		if (!start) continue;
		for (let offset = 0; offset < rule.days; offset++) {
			const day = new Date(start);
			day.setDate(day.getDate() + offset);
			// 跨年的放假日归到实际公历年，避免污染本年的映射
			if (day.getFullYear() !== year) continue;
			const key = formatDateKey(day);
			if (map[key]) continue;
			map[key] = { rest: true, name: rule.name, wage: 0 };
		}
	}
	return map;
}

/**
 * 取某一公历年的「日期 -> 法定节假日/补班」映射。
 * 数据来自 `src/constants/holidays.json`（构建期静态文件，不联网）。
 * 该年数据尚未收录时（官方未公布次年安排），退化为按法定天数合成的放假日，
 * 只有「休」没有「班」——调休安排无法提前预知。
 */
export function buildOfficialDayMap(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): Record<string, OfficialDay> {
	const map: Record<string, OfficialDay> = {};
	if (!config.show.officialHolidays) return map;
	const rows = HOLIDAY_DATA[String(year)];
	if (!rows || rows.length === 0) return buildStatutoryOfficialDays(year);
	for (const row of rows) {
		map[row.date] = {
			rest: row.rest,
			name: row.name,
			wage: row.wage,
		};
	}
	return map;
}

/** 生成某一公历年的二十四节气事件 */
export function buildSolarTermEvents(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	if (!config.show.solarTerms) return [];
	return getSolarTerms(year).map((term) => ({
		id: `term-${term.dateKey}-${term.name}`,
		type: "term" as CalendarEventType,
		name: term.name,
		date: new Date(year, term.month - 1, term.day),
		dateKey: term.dateKey,
		icon: term.icon,
		isOfficial: false,
	}));
}

/**
 * 把日期规则换算成某一公历年内的 Date。
 * 农历日期会跨年（如腊月二十三可能落在次年 1 月），返回的 Date 以实际公历为准。
 */
function resolveDateRule(rule: CalendarDateRule, year: number): Date | null {
	if (rule.type === "lunar") {
		return lunarToSolar(year, rule.month, rule.day, false);
	}
	const date = new Date(year, rule.month - 1, rule.day);
	// 过滤 2 月 30 日之类的非法日期
	if (date.getMonth() !== rule.month - 1) return null;
	return date;
}

/** 农历规则的文字写法，如「腊月廿三」 */
function lunarLabel(rule: CalendarDateRule): string | undefined {
	if (rule.type !== "lunar") return undefined;
	const months = [
		"",
		"正月",
		"二月",
		"三月",
		"四月",
		"五月",
		"六月",
		"七月",
		"八月",
		"九月",
		"十月",
		"冬月",
		"腊月",
	];
	return `${months[rule.month] ?? ""}${lunarDayName(rule.day)}`;
}

/**
 * 生成某一公历年的全部内置节日。
 * 包含：公历固定节日（元旦/清明/劳动节/国庆节）+ 农历传统节日 + 除夕 + 配置里的补充节日。
 */
export function buildHolidayEvents(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	const push = (
		name: string,
		date: Date | null,
		icon?: string,
		lunar?: string,
		isOfficial = true,
	) => {
		if (!date) return;
		events.push({
			id: `holiday-${formatDateKey(date)}-${name}`,
			type: "holiday",
			name,
			date: startOfDay(date),
			dateKey: formatDateKey(date),
			icon: icon ?? EVENT_TYPE_ICON.holiday,
			lunar,
			isOfficial,
		});
	};

	// 公历固定节日
	push("元旦", new Date(year, 0, 1), "material-symbols:celebration");
	push(
		"清明节",
		new Date(year, 3, qingmingDay(year)),
		"material-symbols:festival",
	);
	push("劳动节", new Date(year, 4, 1), "material-symbols:festival");
	push("国庆节", new Date(year, 9, 1), "material-symbols:celebration");

	// 农历传统节日
	for (const festival of LUNAR_FESTIVALS) {
		const date = lunarToSolar(year, festival.month, festival.day, false);
		push(
			festival.name,
			date,
			festival.icon,
			date ? `农历${lunarDayName(festival.day)}` : undefined,
		);
	}

	// 除夕 = 次年春节的前一天
	const nextNewYear = lunarToSolar(year + 1, 1, 1, false);
	if (nextNewYear) {
		const eve = new Date(nextNewYear);
		eve.setDate(eve.getDate() - 1);
		push("除夕", eve, "material-symbols:celebration", "农历腊月最后一天");
	}

	// 配置里的补充节日（公历或农历）
	for (const holiday of config.builtinHolidays) {
		const date = resolveDateRule(holiday.date, year);
		push(holiday.name, date, holiday.icon, lunarLabel(holiday.date), false);
	}

	return events;
}

/** 生成某一公历年的生日 / 纪念日事件 */
export function buildBirthdayEvents(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	for (const birthday of config.birthdays) {
		const date = resolveDateRule(birthday.date, year);
		if (!date) continue;
		events.push({
			id: `birthday-${formatDateKey(date)}-${birthday.name}`,
			type: "birthday",
			name: birthday.name,
			date: startOfDay(date),
			dateKey: formatDateKey(date),
			icon: birthday.icon ?? EVENT_TYPE_ICON.birthday,
			note: birthday.note,
			lunar: lunarLabel(birthday.date),
			isOfficial: false,
		});
	}
	return events;
}

/** 判断某个安排在某天是否发生 */
function scheduleMatches(schedule: CalendarSchedule, date: Date): boolean {
	if (schedule.date) {
		// 一次性安排：格式 YYYY-MM-DD
		return schedule.date === formatDateKey(date);
	}
	const recurring = schedule.recurring;
	if (!recurring) return false;

	if (recurring.lunar && recurring.freq === "yearly") {
		const lunar = solarToLunar(date);
		if (!lunar) return false;
		return (
			lunar.isLeap === false &&
			lunar.month === (recurring.month ?? 1) &&
			lunar.day === (recurring.day ?? 1)
		);
	}

	if (recurring.freq === "yearly") {
		return (
			date.getMonth() + 1 === (recurring.month ?? 1) &&
			date.getDate() === (recurring.day ?? 1)
		);
	}
	if (recurring.freq === "monthly") {
		return date.getDate() === (recurring.day ?? 1);
	}
	// weekly
	return date.getDay() === (recurring.weekday ?? 0);
}

/** 生成某一公历年内的安排事件（把该年的每一天都过一遍，支持重复规则） */
export function buildScheduleEvents(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	if (config.schedules.length === 0) return events;

	// 一次性安排可能指向任意年份，先单独处理，避免遍历太多天
	const recurringSchedules = config.schedules.filter((item) => !item.date);
	const onceSchedules = config.schedules.filter((item) => item.date);

	for (const schedule of onceSchedules) {
		if (!schedule.date) continue;
		const [y, m, d] = schedule.date.split("-").map(Number);
		if (y !== year || !m || !d) continue;
		const date = new Date(y, m - 1, d);
		events.push({
			id: `schedule-${formatDateKey(date)}-${schedule.title}`,
			type: "schedule",
			name: schedule.title,
			date: startOfDay(date),
			dateKey: formatDateKey(date),
			icon: schedule.icon ?? EVENT_TYPE_ICON.schedule,
			note: schedule.note,
			isOfficial: false,
		});
	}

	if (recurringSchedules.length === 0) return events;

	const cursor = new Date(year, 0, 1);
	while (cursor.getFullYear() === year) {
		const day = startOfDay(cursor);
		for (const schedule of recurringSchedules) {
			if (!scheduleMatches(schedule, day)) continue;
			events.push({
				id: `schedule-${formatDateKey(day)}-${schedule.title}`,
				type: "schedule",
				name: schedule.title,
				date: day,
				dateKey: formatDateKey(day),
				icon: schedule.icon ?? EVENT_TYPE_ICON.schedule,
				note: schedule.note,
				isOfficial: false,
			});
		}
		cursor.setDate(cursor.getDate() + 1);
	}

	return events;
}

/** 生成某一公历年的调休补班事件（只取 `rest: false` 的补班日） */
export function buildWorkdayEvents(
	year: number,
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	if (!config.show.officialHolidays) return [];
	const rows = HOLIDAY_DATA[String(year)];
	if (!rows) return [];
	const events: CalendarEvent[] = [];
	for (const row of rows) {
		if (row.rest) continue;
		const [y, m, d] = row.date.split("-").map(Number);
		if (!y || !m || !d) continue;
		events.push({
			id: `workday-${row.date}-${row.name}`,
			type: "workday",
			name: row.name,
			date: new Date(y, m - 1, d),
			dateKey: row.date,
			icon: EVENT_TYPE_ICON.workday,
			note: row.target ? `${row.target}调休` : undefined,
			isOfficial: true,
		});
	}
	return events;
}

/** 文章事件所需的输入 */
export interface CalendarPostInput {
	id: string;
	title: string;
	published: Date;
	url: string;
}

/** 生成某一公历年内的发文事件 */
export function buildPostEvents(
	year: number,
	posts: CalendarPostInput[],
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	if (!config.show.posts) return [];
	const events: CalendarEvent[] = [];
	for (const post of posts) {
		const published = new Date(post.published);
		if (Number.isNaN(published.getTime())) continue;
		if (published.getFullYear() !== year) continue;
		const date = startOfDay(published);
		events.push({
			id: `post-${formatDateKey(date)}-${post.id}`,
			type: "post",
			name: post.title,
			date,
			dateKey: formatDateKey(date),
			icon: EVENT_TYPE_ICON.post,
			url: post.url,
			isOfficial: false,
		});
	}
	return events;
}

/** 事件排序：先按日期，再按类型优先级（节日 > 节气 > 补班 > 生日 > 安排 > 文章） */
const TYPE_ORDER: Record<CalendarEventType, number> = {
	holiday: 0,
	term: 1,
	workday: 2,
	birthday: 3,
	schedule: 4,
	post: 5,
};

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
	return events.sort((a, b) => {
		const diff = a.date.getTime() - b.date.getTime();
		if (diff !== 0) return diff;
		return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
	});
}

/** 生成某一公历年的全部事件 */
export function buildYearEvents(
	year: number,
	posts: CalendarPostInput[] = [],
	config: SiteCalendarConfig = calendarConfig,
): CalendarEvent[] {
	return sortEvents([
		...buildHolidayEvents(year, config),
		...buildSolarTermEvents(year, config),
		...buildWorkdayEvents(year, config),
		...buildBirthdayEvents(year, config),
		...buildScheduleEvents(year, config),
		...buildPostEvents(year, posts, config),
	]);
}

/** 按 YYYY-MM-DD 分组成 Map */
export function groupEventsByDate(
	events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
	const map = new Map<string, CalendarEvent[]>();
	for (const event of events) {
		const list = map.get(event.dateKey);
		if (list) list.push(event);
		else map.set(event.dateKey, [event]);
	}
	return map;
}

/**
 * 取从现在起 `days` 天内的近期事件（含今天）。
 * `yearEvents` 需要同时包含今年与明年，以便跨年时也能取到。
 */
export function getUpcomingEvents(
	events: CalendarEvent[],
	now: Date,
	days: number,
): CalendarEvent[] {
	const today = startOfDay(now);
	const end = new Date(today);
	end.setDate(end.getDate() + days);
	return events.filter((event) => event.date >= today && event.date <= end);
}

/** 距今多少天，今天为 0 */
export function daysFromToday(event: CalendarEvent, now: Date): number {
	return Math.round(
		(event.date.getTime() - startOfDay(now).getTime()) / 86400000,
	);
}
