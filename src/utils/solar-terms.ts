/**
 * 24 节气计算
 *
 * 采用经典「节气分钟偏移表 + 1900 年基线」公式，
 * 不依赖任何外部数据或接口，构建期直接算出。
 * 实测 2024-2027 与万年历逐项一致（误差 ≤ 1 天）。
 */

/** 24 节气名称，索引 0 = 小寒（1 月），索引 23 = 冬至（12 月） */
export const SOLAR_TERM_NAMES: string[] = [
	"小寒",
	"大寒",
	"立春",
	"雨水",
	"惊蛰",
	"春分",
	"清明",
	"谷雨",
	"立夏",
	"小满",
	"芒种",
	"夏至",
	"小暑",
	"大暑",
	"立秋",
	"处暑",
	"白露",
	"秋分",
	"寒露",
	"霜降",
	"立冬",
	"小雪",
	"大雪",
	"冬至",
];

/** 节气对应的 Iconify 图标名（material-symbols 集合已全量包含） */
export const SOLAR_TERM_ICONS: string[] = [
	"material-symbols:severe-cold",
	"material-symbols:ac-unit",
	"material-symbols:local-florist",
	"material-symbols:water-drop",
	"material-symbols:pest-control",
	"material-symbols:sunny",
	"material-symbols:park",
	"material-symbols:grain",
	"material-symbols:wb-sunny",
	"material-symbols:agriculture",
	"material-symbols:grass",
	"material-symbols:light-mode",
	"material-symbols:thermostat",
	"material-symbols:mode-heat",
	"material-symbols:eco",
	"material-symbols:air",
	"material-symbols:water-drop",
	"material-symbols:wb-twilight",
	"material-symbols:nights-stay",
	"material-symbols:ac-unit",
	"material-symbols:spa",
	"material-symbols:cloud",
	"material-symbols:snowing",
	"material-symbols:severe-cold",
];

/** 各节气相对 1900 年小寒的分钟偏移 */
const TERM_MINUTES: number[] = [
	0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072,
	240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210,
	440795, 462224, 483532, 504758,
];

/** 1900 年小寒的基准时刻（UTC） */
const BASE_UTC = Date.UTC(1900, 0, 6, 2, 5);

/** 回归年长度（毫秒），约 365.2422 天 */
const TROPICAL_YEAR_MS = 31556925974.7;

/** 单个节气 */
export interface SolarTerm {
	/** 节气名，如「谷雨」 */
	name: string;
	/** Iconify 图标名 */
	icon: string;
	/** 节气序号 0-23 */
	index: number;
	/** 公历月 1-12 */
	month: number;
	/** 公历日 1-31 */
	day: number;
	/** YYYY-MM-DD */
	dateKey: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * 取某一公历年的全部 24 个节气。
 * 每个节气的月份由序号决定（0/1 → 1 月，2/3 → 2 月 …），日由公式算出。
 */
export function getSolarTerms(year: number): SolarTerm[] {
	const terms: SolarTerm[] = [];
	for (let index = 0; index < 24; index += 1) {
		const time =
			TROPICAL_YEAR_MS * (year - 1900) + TERM_MINUTES[index] * 60000 + BASE_UTC;
		const month = Math.floor(index / 2) + 1;
		const day = new Date(time).getUTCDate();
		terms.push({
			name: SOLAR_TERM_NAMES[index],
			icon: SOLAR_TERM_ICONS[index],
			index,
			month,
			day,
			dateKey: `${year}-${pad(month)}-${pad(day)}`,
		});
	}
	return terms;
}

/** 取某一公历年「日期 -> 节气」的映射，便于日历格子快速查表 */
export function getSolarTermMap(year: number): Map<string, SolarTerm> {
	const map = new Map<string, SolarTerm>();
	for (const term of getSolarTerms(year)) {
		map.set(term.dateKey, term);
	}
	return map;
}
