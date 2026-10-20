/**
 * 农历工具
 *
 * 算法移植自 `src/components/widget/Schedule.astro`（仓库内既有实现），
 * 采用 1900-2100 年的农历位掩码表，避免引入 lunar-typescript 依赖。
 */

// 农历数据表（1900-2100），每年一个位掩码：低 4 位为闰月月份，0x10000 位标记闰月大小，
// 0x8000 起每位移位对应 1-12 月的大小月（1 为大月 30 天）。
const LUNAR_INFO = [
	0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0,
	0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
	0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50,
	0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
	0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
	0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
	0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573,
	0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
	0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5,
	0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
	0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46,
	0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
	0x05ac0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50,
	0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
	0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
	0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
	0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0,
	0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
	0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370,
	0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
	0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0,
	0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50,
	0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930, 0x07337, 0x06aa0,
	0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968, 0x0d520,
	0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
	0x0d520,
];

/** 农历年份支持范围 */
export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;

/** 闰月月份，0 表示无闰月 */
export function leapMonth(year: number): number {
	return LUNAR_INFO[year - LUNAR_MIN_YEAR] & 0xf;
}

/** 闰月天数 */
export function leapDays(year: number): number {
	if (!leapMonth(year)) return 0;
	return LUNAR_INFO[year - LUNAR_MIN_YEAR] & 0x10000 ? 30 : 29;
}

/** 农历某月的天数 */
export function lunarMonthDays(year: number, month: number): number {
	return LUNAR_INFO[year - LUNAR_MIN_YEAR] & (0x10000 >> month) ? 30 : 29;
}

/** 农历某年的总天数 */
export function totalLunarDays(year: number): number {
	let sum = 348;
	for (let i = 0x8000; i > 0x8; i >>= 1) {
		sum += LUNAR_INFO[year - LUNAR_MIN_YEAR] & i ? 1 : 0;
	}
	return sum + leapDays(year);
}

/**
 * 农历转公历。闰月用 `isLeap` 指定；超出 1900-2100 返回 null。
 * 返回的 Date 是本地时区当天 00:00:00。
 */
export function lunarToSolar(
	lunarYear: number,
	lunarMonth: number,
	lunarDay: number,
	isLeap = false,
): Date | null {
	if (lunarYear < LUNAR_MIN_YEAR || lunarYear > LUNAR_MAX_YEAR) return null;
	const leap = leapMonth(lunarYear);
	if (isLeap && leap !== lunarMonth) return null;
	let offset = 0;
	for (let y = LUNAR_MIN_YEAR; y < lunarYear; y++) offset += totalLunarDays(y);
	for (let m = 1; m < lunarMonth; m++) offset += lunarMonthDays(lunarYear, m);
	// 闰月之后的月份在序列中多占一个位置
	if (leap > 0 && lunarMonth > leap) offset += leapDays(lunarYear);
	if (isLeap && leap === lunarMonth)
		offset += lunarMonthDays(lunarYear, lunarMonth);
	offset += lunarDay - 1;
	const date = new Date(1900, 0, 31);
	date.setDate(date.getDate() + offset);
	return date;
}

/**
 * 公历转农历（用于在日历格子里显示农历日期）。
 * 简化实现：以 1900-01-31 为基准做偏移差。
 */
export interface LunarDate {
	year: number;
	month: number;
	day: number;
	isLeap: boolean;
}

export function solarToLunar(date: Date): LunarDate | null {
	const year = date.getFullYear();
	if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
	const base = new Date(1900, 0, 31);
	const target = new Date(year, date.getMonth(), date.getDate());
	let offset = Math.round((target.getTime() - base.getTime()) / 86400000);
	if (offset < 0) return null;

	let lunarYear = LUNAR_MIN_YEAR;
	while (offset >= totalLunarDays(lunarYear)) {
		offset -= totalLunarDays(lunarYear);
		lunarYear++;
	}
	const leap = leapMonth(lunarYear);
	let lunarMonth = 1;
	let isLeap = false;
	while (lunarMonth <= 12) {
		const days = isLeap
			? leapDays(lunarYear)
			: lunarMonthDays(lunarYear, lunarMonth);
		if (offset < days) break;
		offset -= days;
		if (!isLeap && leap === lunarMonth) {
			isLeap = true;
		} else {
			isLeap = false;
			lunarMonth++;
		}
	}
	return { year: lunarYear, month: lunarMonth, day: offset + 1, isLeap };
}

export const CN_MONTH: string[] = [
	"",
	"正",
	"二",
	"三",
	"四",
	"五",
	"六",
	"七",
	"八",
	"九",
	"十",
	"冬",
	"腊",
];

export const CN_DAY: string[] = [
	"",
	"一",
	"二",
	"三",
	"四",
	"五",
	"六",
	"七",
	"八",
	"九",
	"十",
];

/** 农历日的中文写法 */
export function lunarDayName(day: number): string {
	if (day <= 10) return `初${CN_DAY[day]}`;
	if (day < 20) return `十${CN_DAY[day - 10]}`;
	if (day === 20) return "二十";
	if (day < 30) return `廿${CN_DAY[day - 20]}`;
	return "三十";
}

/** 农历短写法：初一/十五/廿三 之类，供日历格子使用 */
export function lunarDayShort(day: number): string {
	if (day === 1) return "初一";
	if (day === 10) return "初十";
	if (day === 20) return "二十";
	if (day === 30) return "三十";
	return lunarDayName(day);
}

/** 中国传统节日（农历） */
export const LUNAR_FESTIVALS: {
	name: string;
	month: number;
	day: number;
	icon?: string;
}[] = [
	{ name: "春节", month: 1, day: 1, icon: "material-symbols:celebration" },
	{ name: "元宵节", month: 1, day: 15, icon: "material-symbols:festival" },
	{ name: "龙抬头", month: 2, day: 2, icon: "material-symbols:celebration" },
	{ name: "端午节", month: 5, day: 5, icon: "material-symbols:festival" },
	{ name: "七夕", month: 7, day: 7, icon: "material-symbols:favorite" },
	{ name: "中元节", month: 7, day: 15, icon: "material-symbols:celebration" },
	{ name: "中秋节", month: 8, day: 15, icon: "material-symbols:festival" },
	{ name: "重阳节", month: 9, day: 9, icon: "material-symbols:festival" },
	{ name: "腊八节", month: 12, day: 8, icon: "material-symbols:festival" },
	{ name: "小年", month: 12, day: 23, icon: "material-symbols:festival" },
];

/**
 * 清明是节气，用寿星公式计算（适用于 2000-2099，其余年份退化为 4 月 4 日）
 */
export function qingmingDay(year: number): number {
	if (year < 2000 || year > 2099) return 4;
	const n = year % 100;
	return Math.floor(n * 0.2422 + 4.81) - Math.floor(n / 4);
}

/** 解析成当天 00:00 的本地 Date，避免时分秒影响比较 */
export function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 格式化为 YYYY-MM-DD（本地时区） */
export function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
