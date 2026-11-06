/**
 * 二十四节气计算
 *
 * 用太阳视黄经反推，不依赖"年度日期表"——那张表每年都要维护，
 * 而且闰年/岁差会让公式逐渐偏移。这里直接按天文位置算，
 * 误差约 0.01°（对应时间 15 分钟量级），判断"今天属于哪个节气"绰绰有余。
 *
 * 节气 = 太阳到达黄经 15° 的整数倍的时刻。春分为 0°，此后每 15° 一个。
 */

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;

export type SolarTermSlug =
	| "lichun"
	| "yushui"
	| "jingzhe"
	| "chunfen"
	| "qingming"
	| "guyu"
	| "lixia"
	| "xiaoman"
	| "mangzhong"
	| "xiazhi"
	| "xiaoshu"
	| "dashu"
	| "liqiu"
	| "chushu"
	| "bailu"
	| "qiufen"
	| "hanlu"
	| "shuangjiang"
	| "lidong"
	| "xiaoxue"
	| "daxue"
	| "dongzhi"
	| "xiaohan"
	| "dahan";

export type SolarTermDef = {
	/** 节气名 */
	name: string;
	/** 拼音，用于拼图片文件名 */
	slug: SolarTermSlug;
	/** 对应的太阳黄经（度） */
	longitude: number;
	/** 季节，便于按季节做兜底图 */
	season: "spring" | "summer" | "autumn" | "winter";
};

/** 从立春开始，按黄经递增排列（315° → 330° → … → 300°） */
export const SOLAR_TERMS: readonly SolarTermDef[] = [
	{ name: "立春", slug: "lichun", longitude: 315, season: "spring" },
	{ name: "雨水", slug: "yushui", longitude: 330, season: "spring" },
	{ name: "惊蛰", slug: "jingzhe", longitude: 345, season: "spring" },
	{ name: "春分", slug: "chunfen", longitude: 0, season: "spring" },
	{ name: "清明", slug: "qingming", longitude: 15, season: "spring" },
	{ name: "谷雨", slug: "guyu", longitude: 30, season: "spring" },
	{ name: "立夏", slug: "lixia", longitude: 45, season: "summer" },
	{ name: "小满", slug: "xiaoman", longitude: 60, season: "summer" },
	{ name: "芒种", slug: "mangzhong", longitude: 75, season: "summer" },
	{ name: "夏至", slug: "xiazhi", longitude: 90, season: "summer" },
	{ name: "小暑", slug: "xiaoshu", longitude: 105, season: "summer" },
	{ name: "大暑", slug: "dashu", longitude: 120, season: "summer" },
	{ name: "立秋", slug: "liqiu", longitude: 135, season: "autumn" },
	{ name: "处暑", slug: "chushu", longitude: 150, season: "autumn" },
	{ name: "白露", slug: "bailu", longitude: 165, season: "autumn" },
	{ name: "秋分", slug: "qiufen", longitude: 180, season: "autumn" },
	{ name: "寒露", slug: "hanlu", longitude: 195, season: "autumn" },
	{ name: "霜降", slug: "shuangjiang", longitude: 210, season: "autumn" },
	{ name: "立冬", slug: "lidong", longitude: 225, season: "winter" },
	{ name: "小雪", slug: "xiaoxue", longitude: 240, season: "winter" },
	{ name: "大雪", slug: "daxue", longitude: 255, season: "winter" },
	{ name: "冬至", slug: "dongzhi", longitude: 270, season: "winter" },
	{ name: "小寒", slug: "xiaohan", longitude: 285, season: "winter" },
	{ name: "大寒", slug: "dahan", longitude: 300, season: "winter" },
];

/** 归一化到 [0, 360) */
const normalize = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * 太阳视黄经（度）
 * Meeus《Astronomical Algorithms》简化式，1900-2100 年内误差 < 0.01°
 */
const sunLongitude = (time: number): number => {
	// 儒略日
	const jd = time / MS_PER_DAY + 2440587.5;
	const T = (jd - 2451545.0) / 36525;

	const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
	const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
	const Mr = M * RAD;

	// 中心差
	const C =
		(1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
		(0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
		0.000289 * Math.sin(3 * Mr);

	const trueLong = L0 + C;
	// 章动与光行差修正，得到视黄经
	const omega = (125.04 - 1934.136 * T) * RAD;
	const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega);

	return normalize(lambda);
};

/** 求某个黄经对应的时刻，在 near 附近 ±20 天内搜索 */
const solveTermTime = (longitude: number, near: number): number | null => {
	const span = 20 * MS_PER_DAY;
	let lo = near - span;
	let hi = near + span;

	// 差值归一到 (-180, 180]，黄经逐日递增，窗口内单调，可二分
	const f = (t: number) => {
		const d = sunLongitude(t) - longitude;
		return ((d + 540) % 360) - 180;
	};

	let flo = f(lo);
	const fhi = f(hi);
	if (flo > 0 || fhi < 0) return null; // 窗口内不存在该黄经

	for (let i = 0; i < 48; i++) {
		const mid = (lo + hi) / 2;
		if (f(mid) < 0) {
			lo = mid;
			flo = f(mid);
		} else {
			hi = mid;
		}
	}
	void flo;
	return hi;
};

export type SolarTermInfo = {
	/** 当前所处节气 */
	current: SolarTermDef;
	/** 下一个节气 */
	next: SolarTermDef;
	/** 当前节气的开始时刻 */
	startTime: Date;
	/** 下一个节气的开始时刻 */
	nextTime: Date;
	/** 当前节气已过去的比例，0-1 */
	progress: number;
	/** 距下一个节气的天数（含小数） */
	daysToNext: number;
};

/**
 * 给定时刻落在哪个节气里
 * @param date 缺省为当前时间
 */
export const getSolarTermInfo = (date: Date = new Date()): SolarTermInfo => {
	const now = date.getTime();
	const lambda = sunLongitude(now);

	// "刚过去"的节气：黄经差（模 360）最小的那个
	let current = SOLAR_TERMS[0];
	let minPast = Number.POSITIVE_INFINITY;
	for (const term of SOLAR_TERMS) {
		const past = normalize(lambda - term.longitude);
		if (past < minPast) {
			minPast = past;
			current = term;
		}
	}

	// "下一个"节气：黄经差（模 360）最小的那个，排除自身
	let next = SOLAR_TERMS[0];
	let minAhead = Number.POSITIVE_INFINITY;
	for (const term of SOLAR_TERMS) {
		const ahead = normalize(term.longitude - lambda);
		if (ahead > 0 && ahead < minAhead) {
			minAhead = ahead;
			next = term;
		}
	}

	// 当前节气开始时刻：在 now 往前推 8 天附近找
	const startSolved = solveTermTime(current.longitude, now - 8 * MS_PER_DAY);
	const startTime = startSolved === null ? date : new Date(startSolved);

	// 下一个节气时刻
	const nextSolved = solveTermTime(next.longitude, now + 8 * MS_PER_DAY);
	const nextTime =
		nextSolved === null ? new Date(now + 15 * MS_PER_DAY) : new Date(nextSolved);

	const total = nextTime.getTime() - startTime.getTime();
	const progress = total > 0 ? (now - startTime.getTime()) / total : 0;

	return {
		current,
		next,
		startTime,
		nextTime,
		progress: Math.min(1, Math.max(0, progress)),
		daysToNext: (nextTime.getTime() - now) / MS_PER_DAY,
	};
};

/** 只要节气名，常用场景 */
export const getSolarTerm = (date: Date = new Date()): SolarTermDef =>
	getSolarTermInfo(date).current;
