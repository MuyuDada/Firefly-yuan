/**
 * 月历矩阵工具
 *
 * 生成周日开头、补齐前后月的 6×7 网格。
 */

import { formatDateKey, startOfDay } from "@/utils/lunar-utils";

/** 网格中的一个格子 */
export interface CalendarCell {
	/** 当天 00:00 */
	date: Date;
	/** YYYY-MM-DD */
	dateKey: string;
	/** 是否属于当前月 */
	inMonth: boolean;
	/** 是否今天 */
	isToday: boolean;
	/** 是否周末（周六、周日） */
	isWeekend: boolean;
}

/** 取某年某月（1-12）的月历矩阵，6 行 × 7 列 */
export function getMonthMatrix(
	year: number,
	month: number,
	now: Date = new Date(),
): CalendarCell[][] {
	const first = new Date(year, month - 1, 1);
	const today = startOfDay(now);
	const todayKey = formatDateKey(today);

	// 周日开头：把 first 回退到当周周日
	const start = new Date(first);
	start.setDate(start.getDate() - first.getDay());

	const weeks: CalendarCell[][] = [];
	const cursor = new Date(start);
	for (let w = 0; w < 6; w++) {
		const week: CalendarCell[] = [];
		for (let d = 0; d < 7; d++) {
			const day = startOfDay(cursor);
			const key = formatDateKey(day);
			week.push({
				date: day,
				dateKey: key,
				inMonth: day.getMonth() === month - 1,
				isToday: key === todayKey,
				isWeekend: d === 0 || d === 6,
			});
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push(week);
	}
	return weeks;
}

/** 某年某月（1-12）的天数 */
export function getDaysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}
