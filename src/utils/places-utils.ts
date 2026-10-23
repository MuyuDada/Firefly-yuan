import { getCollection } from "astro:content";
import { lookupCityCoords } from "@/data/china-city-coords";

// 足迹地图数据层
//
// 唯一数据源：`src/content/places/*.md`
// 这里只做「读集合 → 归一化 → 补坐标 → 算统计 → 序列化给客户端」，
// 不掺任何 DOM / 地图逻辑。

export interface PlaceRecord {
	/** 稳定 key：集合条目 id */
	id: string;
	/** 展示名：name → 区 → 市 → 省 */
	label: string;
	name: string;
	date: Date;
	endDate?: Date;
	province: string;
	city: string;
	district: string;
	experience: string;
	visitCount: number;
	category: string;
	lat?: number;
	lng?: number;
	images: string[];
	link: string;
}

/** 传给浏览器的形状：坐标已解析并做过微偏移，日期已序列化为字符串 */
export interface PlaceClient {
	id: string;
	label: string;
	date: string;
	endDate: string;
	years: number[];
	year: number;
	province: string;
	city: string;
	district: string;
	experience: string;
	visitCount: number;
	category: string;
	lat: number | null;
	lng: number | null;
	/** 是否使用了 md 里手写的精确坐标 */
	exact: boolean;
	images: string[];
	link: string;
}

const SCHOOL_RE =
	/小学|中学|高中|学院|大学|学校|完小|教育|幼儿园|education|school/i;
const WORK_RE =
	/开发|工程师|科技|公司|集团|实习|事业部|技术中心|后端|前端|服务器|办公|工作|码农|研发|studio|office/i;

/** 没手写 category 时，按经历文案粗分类（供筛选胶囊使用） */
export function inferPlaceCategory(place: {
	experience?: string;
	category?: string;
}): string {
	if (place.category?.trim()) return place.category.trim();
	const text = place.experience || "";
	if (SCHOOL_RE.test(text)) return "学校";
	if (WORK_RE.test(text)) return "工作";
	return "旅游";
}

/** 精确坐标优先，否则用省市中心兜底 */
export function resolvePlaceCoords(place: {
	province: string;
	city?: string;
	lat?: number;
	lng?: number;
}): { lng: number; lat: number } | null {
	if (
		typeof place.lat === "number" &&
		typeof place.lng === "number" &&
		Number.isFinite(place.lat) &&
		Number.isFinite(place.lng)
	) {
		return { lng: place.lng, lat: place.lat };
	}
	const found = lookupCityCoords(place.province, place.city);
	if (!found) return null;
	return { lng: found[0], lat: found[1] };
}

/** 展示名：name → 区 → 市 → 省 */
export function placeLabel(place: {
	name?: string;
	district?: string;
	city?: string;
	province: string;
}): string {
	return (
		place.name?.trim() ||
		place.district?.trim() ||
		place.city?.trim() ||
		place.province
	);
}

function toDateKey(value: Date): string {
	return value.toISOString().slice(0, 10);
}

/** 一条足迹跨越的年份（用于年份筛选） */
export function getPlaceYears(place: PlaceRecord): number[] {
	const start = place.date.getFullYear();
	const end = place.endDate?.getFullYear() ?? start;
	const years: number[] = [];
	for (let y = start; y <= end; y++) years.push(y);
	return years;
}

/** 读取所有足迹，按日期倒序（新的在前） */
export async function getPlaces(): Promise<PlaceRecord[]> {
	const entries = await getCollection("places");
	const records = entries.map((entry) => {
		const data = entry.data;
		return {
			id: entry.id,
			label: placeLabel(data),
			name: data.name || "",
			date: data.date,
			endDate: data.endDate,
			province: data.province,
			city: data.city || "",
			district: data.district || "",
			experience: data.experience || "",
			visitCount: data.visitCount || 1,
			category: inferPlaceCategory(data),
			lat: data.lat,
			lng: data.lng,
			images: (data.images || []).filter(Boolean),
			link: data.link?.trim() || "",
		} satisfies PlaceRecord;
	});

	return records.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** 年份列表（倒序） */
export function getPlaceYearOptions(places: PlaceRecord[]): number[] {
	const years = new Set<number>();
	for (const place of places) {
		for (const year of getPlaceYears(place)) years.add(year);
	}
	return [...years].sort((a, b) => b - a);
}

/** 分类列表：常见三类优先，其余按拼音序补在后面 */
export function getPlaceCategoryOptions(places: PlaceRecord[]): string[] {
	const present = new Set<string>();
	for (const place of places) {
		if (place.category) present.add(place.category);
	}
	const preferred = ["学校", "工作", "旅游"];
	const rest = [...present].filter((c) => !preferred.includes(c)).sort();
	return [...preferred.filter((c) => present.has(c)), ...rest];
}

export interface PlacesStats {
	/** 去重后的地点数（省+市） */
	locations: number;
	/** 去重后的省份数 */
	provinces: number;
	/** 到访次数合计 */
	visits: number;
	/** 今年出行次数 */
	thisYear: number;
}

export function getPlacesStats(places: PlaceRecord[]): PlacesStats {
	const locationSet = new Set<string>();
	const provinceSet = new Set<string>();
	let visits = 0;
	let thisYear = 0;
	const currentYear = new Date().getFullYear();

	for (const place of places) {
		locationSet.add(`${place.province}|${place.city}`);
		provinceSet.add(place.province);
		visits += place.visitCount || 1;
		if (getPlaceYears(place).includes(currentYear)) thisYear += 1;
	}

	return {
		locations: locationSet.size,
		provinces: provinceSet.size,
		visits,
		thisYear,
	};
}

/**
 * 序列化给浏览器。
 *
 * 同城/同点位的多个足迹会被聚合气泡吞成一个数字，所以这里按序号做极小偏移：
 * - 精确坐标：约 10~20m，肉眼不可察
 * - 兜底坐标：约 1km，避免同城点位完全重叠
 */
export function toClientPlaces(places: PlaceRecord[]): PlaceClient[] {
	return places.map((place, index) => {
		const exact =
			typeof place.lat === "number" &&
			typeof place.lng === "number" &&
			Number.isFinite(place.lat) &&
			Number.isFinite(place.lng);
		const coords = resolvePlaceCoords(place);
		const step = exact ? 0.00015 : 0.012;
		const jitterLng = coords ? ((index % 7) - 3) * step : 0;
		const jitterLat = coords
			? ((Math.floor(index / 7) % 7) - 3) * step * 0.85
			: 0;

		return {
			id: place.id,
			label: place.label,
			date: toDateKey(place.date),
			endDate: place.endDate ? toDateKey(place.endDate) : "",
			years: getPlaceYears(place),
			year: place.date.getFullYear(),
			province: place.province,
			city: place.city,
			district: place.district,
			experience: place.experience,
			visitCount: place.visitCount || 1,
			category: place.category,
			lat: coords ? Number((coords.lat + jitterLat).toFixed(6)) : null,
			lng: coords ? Number((coords.lng + jitterLng).toFixed(6)) : null,
			exact,
			images: place.images,
			link: place.link,
		};
	});
}
