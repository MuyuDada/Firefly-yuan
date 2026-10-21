---
title: '为 Firefly 添加站点日历页面：节日、农历、节气与发文日同框'
slug: 'firefly-calendar-page'
published: 2026-10-21
description: '独立全宽的三栏日历页：左栏按节日/纪念日/安排分组倒计时，中栏月历带农历与休班角标，右栏当日详情；节日、节气、调休数据全部构建期算出，不联网。'
image: api
category: 页面改造
tags: [日历, 农历, Astro]
draft: false
pinned: false
---

在[毛の博客](https://blog.huchao.vip/posts/astro/firefly-calendar-page/)看到他的站点日历页，第一反应是「这不就是把侧栏那个小日历放大吗」——点进去才发现完全不是一回事：法定节假日、农历传统节日、二十四节气、生日纪念日、自定义安排、文章发布日，六类信息全部塞进同一张月历，而且左边还有一排实时倒计时。

于是决定给 Firefly 也做一个。效果可以直接看本站的[站点日历](/calendar/)。本文记录完整实现，包括三个差点写错的地方。

## 一、效果概览

页面上半屏是年度进度 Hero，向下滚动是日历主体：

| 位置 | 内容 |
|---|---|
| 首屏 Hero | 当年 + 次年大字，12 个月份小字，按已过比例做渐变填充动画 |
| 左栏 | 近期事件分三节：最近的节日 / 最近的纪念日 / 最近的安排，每条带秒级倒计时 |
| 中栏 | 月历网格，格子显示日期 + 农历 + 事件条 + 「休」「班」角标 |
| 右栏 | 选中日的全部事件详情 |

几个设计上的选择：

- **独立全宽页**，不走 `MainGridLayout`。日历自己就有三栏，再套一层站点侧栏会挤成一条缝。
- **零客户端数据请求**。所有事件在构建期算完，塞进一个 `<script type="application/json">`，客户端只负责翻月和倒计时。
- **不引入新依赖**。农历用位掩码表，节气用公式，节假日用预抓取的静态 JSON。

## 二、文件清单

| 文件 | 作用 |
|---|---|
| `src/pages/calendar.astro` | 页面入口 + 客户端交互脚本 |
| `src/components/pages/calendar/CalendarHero.astro` | 首屏年度进度 Hero |
| `src/components/pages/calendar/EventOverview.astro` | 左栏近期事件 |
| `src/components/pages/calendar/MonthCalendar.astro` | 中栏月历网格 |
| `src/components/pages/calendar/EventDetail.astro` | 右栏当日详情 |
| `src/utils/lunar-utils.ts` | 农历换算（1900–2100） |
| `src/utils/solar-terms.ts` | 二十四节气计算 |
| `src/utils/calendar-events.ts` | 六类事件聚合成统一结构 |
| `src/utils/calendar-grid-utils.ts` | 月历矩阵生成 |
| `src/config/calendarConfig.ts` | 页面配置：生日、安排、内置节日、开关 |
| `src/constants/holidays.json` | 法定节假日与调休数据 |
| `scripts/fetch-holidays.mjs` | 抓取节假日数据的脚本 |
| `src/styles/pages/calendar.css` | 页面样式与事件色令牌 |

## 三、快速开始

### 1. 打开页面开关

`src/config/siteConfig.ts` 的 `pages` 里加一项：

```ts title="src/config/siteConfig.ts" ins={3}
const pages = resolvePageToggles({
	// ...
	calendar: true,
});
```

类型定义在 `src/types/siteConfig.ts` 的 `pages` 里补 `calendar: boolean`。设为 `false` 时 `/calendar/` 会重定向到 404，导航、sitemap 也一并隐藏。

### 2. 配置内容

日常只改 `src/config/calendarConfig.ts`：

```ts title="src/config/calendarConfig.ts"
export const calendarConfig: SiteCalendarConfig = {
	title: "站点日历",
	description: "节日、纪念日、安排与文章发布，都在同一张日历上",

	// 补充节日（农历节日与公历大节已内置，这里只补零散的）
	builtinHolidays: [
		{ name: "情人节", date: { type: "solar", month: 2, day: 14 } },
		{ name: "平安夜", date: { type: "solar", month: 12, day: 24 } },
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
			name: "我的农历生日",
			date: { type: "lunar", month: 10, day: 29 },
			icon: "material-symbols:cake",
		},
	],

	// 安排：一次性写 date，重复写 recurring
	schedules: [
		{
			title: "博客周检",
			recurring: { freq: "weekly", weekday: 1 },
			icon: "material-symbols:event-note",
			note: "每周一检查更新与依赖",
		},
	],

	show: {
		posts: true,
		lunarDate: true,
		officialHolidays: true,
		solarTerms: true,
	},

	overview: {
		futureDays: 30,
		maxItems: 6,
	},
};
```

`date.type` 只有两个值：

- `"solar"` —— 公历月日，每年重复
- `"lunar"` —— 农历月日，构建时按当年换算

农历生日就写 `{ type: "lunar", month: 10, day: 29 }`，不用自己查当年对应哪一天。比如农历十月二十九，2026 年是 12 月 7 日，2027 年是 11 月 26 日，每年浮动十来天，这正是必须按农历换算的原因。

`schedules` 支持三种重复频率：

```ts
// 一次性
{ title: "发布会", date: "2026-08-01" }
// 每年（公历）
{ title: "年检", recurring: { freq: "yearly", month: 3, day: 15 } }
// 每年（农历）
{ title: "忌日", recurring: { freq: "yearly", month: 7, day: 15, lunar: true } }
// 每月 / 每周（weekday 0 = 周日）
{ title: "月度小结", recurring: { freq: "monthly", day: 1 } }
```

### 3. 注册导航

`src/config/navBarConfig.ts` 里加一个 `LinkPresets`：

```ts title="src/config/navBarConfig.ts"
Calendar: {
	name: "站点日历",
	url: "/calendar/",
	icon: "material-symbols:calendar-month",
	pageKey: "calendar",
},
```

然后把它塞进「我的」子菜单的 `children` 数组。`pageKey` 是关键——导航过滤逻辑靠它判断页面开关，写错或漏写会导致关了开关导航还在。

导航名称的 i18n 在 `src/utils/navbar-i18n.ts` 的 `NAVBAR_DEFAULT_NAMES` 里映射：`站点日历: I18nKey.calendar`。

### 4. sitemap 过滤

`astro.config.mjs` 的 sitemap `filter` 里补一行，否则关了页面 sitemap 还会留着：

```js title="astro.config.mjs"
if (pathname === "/calendar/" && !siteConfig.pages.calendar) {
	return false;
}
```

### 5. 更新节假日数据

```bash
pnpm holidays          # 自动补齐当前年份起往后两年
pnpm holidays 2027     # 只抓指定年份
```

## 四、三类数据是怎么来的

这是整个页面最花时间的部分，因为三类数据性质完全不同。

### 农历：位掩码表

仓库里侧栏的 `Schedule.astro` 已经有一份可用的农历实现，直接移植成 TS 模块，不引入 `lunar-typescript` 之类的依赖。

核心是一张 1900–2100 年的位掩码表，每年一个整数：

```ts title="src/utils/lunar-utils.ts"
// 低 4 位为闰月月份，0x10000 位标记闰月大小，
// 0x8000 起每位移位对应 1-12 月的大小月（1 为大月 30 天）
const LUNAR_INFO = [0x04bd8, 0x04ae0, 0x0a570, /* ... 共 201 项 ... */];

export function leapMonth(year: number): number {
	return LUNAR_INFO[year - LUNAR_MIN_YEAR] & 0xf;
}

export function lunarMonthDays(year: number, month: number): number {
	return LUNAR_INFO[year - LUNAR_MIN_YEAR] & (0x10000 >> month) ? 30 : 29;
}
```

**农历转公历**（配置里写 `type: "lunar"` 时用）：从 1900-01-31 起累加天数偏移。

```ts title="src/utils/lunar-utils.ts"
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
	if (isLeap && leap === lunarMonth) offset += lunarMonthDays(lunarYear, lunarMonth);
	offset += lunarDay - 1;
	const date = new Date(1900, 0, 31);
	date.setDate(date.getDate() + offset);
	return date;
}
```

**公历转农历**（日历格子里显示「初一」「十五」用）：反向走一遍，遇到闰月要额外插一个位置。

```ts title="src/utils/lunar-utils.ts"
export function solarToLunar(date: Date): LunarDate | null {
	// ... 略去边界检查与基准日计算 ...
	let lunarYear = LUNAR_MIN_YEAR;
	while (offset >= totalLunarDays(lunarYear)) {
		offset -= totalLunarDays(lunarYear);
		lunarYear++;
	}
	const leap = leapMonth(lunarYear);
	let lunarMonth = 1;
	let isLeap = false;
	while (lunarMonth <= 12) {
		const days = isLeap ? leapDays(lunarYear) : lunarMonthDays(lunarYear, lunarMonth);
		if (offset < days) break;
		offset -= days;
		if (!isLeap && leap === lunarMonth) {
			isLeap = true; // 进入闰月
		} else {
			isLeap = false;
			lunarMonth++;
		}
	}
	return { year: lunarYear, month: lunarMonth, day: offset + 1, isLeap };
}
```

### 节气：一个公式搞定

二十四节气不需要数据表，用经典的「分钟偏移 + 回归年」公式就能算，实测 2024–2027 与万年历逐项一致：

```ts title="src/utils/solar-terms.ts"
// 各节气相对 1900 年小寒的分钟偏移
const TERM_MINUTES = [0, 21208, 42467, /* ... 共 24 项 ... */];

// 1900 年小寒的基准时刻（UTC）
const BASE_UTC = Date.UTC(1900, 0, 6, 2, 5);

// 回归年长度（毫秒），约 365.2422 天
const TROPICAL_YEAR_MS = 31556925974.7;

export function getSolarTerms(year: number): SolarTerm[] {
	const terms: SolarTerm[] = [];
	for (let index = 0; index < 24; index += 1) {
		const time =
			TROPICAL_YEAR_MS * (year - 1900) + TERM_MINUTES[index] * 60000 + BASE_UTC;
		const month = Math.floor(index / 2) + 1; // 每个节气月两个节气
		const day = new Date(time).getUTCDate();
		terms.push({ name: SOLAR_TERM_NAMES[index], index, month, day, /* ... */ });
	}
	return terms;
}
```

节气名按固定顺序排列，索引 0 是小寒、索引 23 是冬至，月份直接由 `Math.floor(index / 2) + 1` 得出，不需要额外判断。

### 法定节假日：静态文件 + 兜底

这块是最容易踩坑的。法定节假日和调休补班**没法用公式算**——哪天补班是国务院每年单独发的通知，只能取现成数据。

所以做成了「构建期抓一次，存成静态 JSON」：

```ts title="scripts/fetch-holidays.mjs"
const API = "https://timor.tech/api/holiday/year/";

function normalize(holiday) {
	return Object.values(holiday)
		.map((item) => {
			const row = {
				date: item.date,
				name: item.name,
				rest: item.holiday === true, // true = 放假，false = 调休补班
				wage: item.wage ?? 1,
			};
			if (item.target) row.target = item.target;
			return row;
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
```

脚本会先读旧文件再合并，所以 `pnpm holidays 2027` 只补 2027，不会把 2025/2026 冲掉；抓不到的空年份自动跳过。

**但是**：官方次年安排一般要到当年 11–12 月才公布。在这之前 `holidays.json` 里根本没有下一年数据，日历上未来的节日就一个「休」角标都不显示——而过去的节日全是角标，视觉上特别像 bug。

解决办法是按法定天数合成兜底：

```ts title="src/utils/calendar-events.ts"
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
	{ name: "清明节", resolve: (year) => new Date(year, 3, qingmingDay(year)), days: 1 },
	{ name: "劳动节", resolve: (year) => new Date(year, 4, 1), days: 2 },
	{ name: "端午节", resolve: (year) => lunarToSolar(year, 5, 5, false), days: 1 },
	{ name: "中秋节", resolve: (year) => lunarToSolar(year, 8, 15, false), days: 1 },
	{ name: "国庆节", resolve: (year) => new Date(year, 9, 1), days: 3 },
];
```

数据文件里有该年数据就完全走真实数据，只有缺年份才走兜底：

```ts title="src/utils/calendar-events.ts"
export function buildOfficialDayMap(year: number): Record<string, OfficialDay> {
	const map: Record<string, OfficialDay> = {};
	if (!calendarConfig.show.officialHolidays) return map;
	const rows = HOLIDAY_DATA[String(year)];
	if (!rows || rows.length === 0) return buildStatutoryOfficialDays(year);
	for (const row of rows) {
		map[row.date] = { rest: row.rest, name: row.name, wage: row.wage };
	}
	return map;
}
```

兜底只给「休」不给「班」，因为调休安排无法提前预知。宁可少标，也不标错。

## 五、六类事件聚合成一个结构

不管数据来自哪条线，最后都变成同一个 `CalendarEvent`：

```ts title="src/utils/calendar-events.ts"
export type CalendarEventType =
	| "holiday"   // 节日（含法定节假日、农历传统节日）
	| "term"      // 二十四节气
	| "birthday"  // 生日 / 纪念日
	| "workday"   // 调休补班
	| "schedule"  // 自定义安排
	| "post";     // 文章发布

export interface CalendarEvent {
	id: string;
	type: CalendarEventType;
	name: string;
	date: Date;
	dateKey: string;   // YYYY-MM-DD，客户端查表用
	icon: string;
	note?: string;
	lunar?: string;
	isOfficial?: boolean;
	url?: string;      // 文章事件跳转用
}
```

页面里把前后各一年都算出来（翻月、跨年都能取到数据），再用 `Map` 按 `id` 去重——跨年边界上的节日可能被算两次：

```ts title="src/pages/calendar.astro"
const years = [currentYear - 1, currentYear, currentYear + 1];
const allEvents: CalendarEvent[] = [];
for (const year of years) {
	allEvents.push(...buildYearEvents(year, postInputs));
}
const eventMap = new Map<string, CalendarEvent>();
for (const event of allEvents) eventMap.set(event.id, event);
const events = [...eventMap.values()];
```

## 六、三栏布局

用 CSS Grid 的 `grid-template-areas`，响应式只需改一处：

```css title="src/styles/pages/calendar.css"
.calendar-page__shell {
	display: grid;
	grid-template-areas: "left main right";
	grid-template-columns: minmax(15rem, 17.5rem) minmax(0, 1fr) minmax(16rem, 20rem);
	gap: 1rem;
	align-items: start;
}

@media (max-width: 1200px) {
	.calendar-page__shell {
		grid-template-areas:
			"left"
			"main"
			"right";
		grid-template-columns: minmax(0, 1fr);
	}
}
```

`minmax(0, 1fr)` 这个写法很重要——中栏里是月历网格，如果用 `1fr`，内容的最小宽度会撑破布局。

事件颜色用一组 OKLCH 令牌，跟着站点 `--hue` 走：

```css title="src/styles/pages/calendar.css"
.calendar-page {
	--cal-holiday: oklch(0.62 0.14 35);      /* 节日：暖橙 */
	--cal-term: oklch(0.6 0.11 155);         /* 节气：青绿 */
	--cal-workday: oklch(0.55 0.02 var(--hue)); /* 调休：中性 */
	--cal-birthday: oklch(0.64 0.12 350);    /* 纪念日：玫红 */
	--cal-schedule: var(--primary);          /* 安排：主题色 */
	--cal-post: oklch(0.48 0.05 var(--hue)); /* 文章：低饱和 */
}
```

## 七、首屏 Hero 的填充动画

和侧栏年度进度组件同一个思路：`background-clip: text` + 水平渐变，用渐变分界线当进度线。关键是 `@property` 注册：

```css title="src/styles/pages/calendar.css"
@property --cal-hero-progress {
	syntax: "<number>";
	inherits: false;
	initial-value: 0;
}
```

CSS 自定义属性默认是字符串，keyframes 里从 0 到目标值只会「啪」一下跳变；注册成 `<number>` 后浏览器才能逐帧插值。

数字之间错峰出现靠 `--glyph-delay`：

```astro title="src/components/pages/calendar/CalendarHero.astro"
<span
	class="calendar-hero__glyph calendar-hero__glyph--month"
	style={`--progress-target: ${progress}; --glyph-delay: ${180 + index * 45}ms`}
>
	{index + 1}
</span>
```

## 八、客户端只做三件事

SSR 已经把当月网格画好了，客户端脚本只负责翻月、倒计时、点击联动。

数据通过一个 JSON 脚本块传过去：

```astro title="src/pages/calendar.astro"
<script
	is:inline
	type="application/json"
	id="calendar-client-payload"
	set:html={JSON.stringify(clientPayload)}
/>
```

`is:inline` 不能省，否则 Astro 会把它当模块脚本处理，`type="application/json"` 就失效了。

### 翻月

翻月要重新生成网格，所以矩阵生成逻辑必须和 SSR 完全一致，否则首屏和翻月后的格子会对不上：

```js title="src/pages/calendar.astro"
// 与服务端 getMonthMatrix 保持一致：周日开头、6 行 × 7 列
function buildMatrix(year, month) {
	var first = new Date(year, month - 1, 1);
	var cursor = new Date(first);
	cursor.setDate(cursor.getDate() - first.getDay());
	// ... 6 × 7 循环 ...
}
```

### 倒计时

左栏每秒刷新一次，只改文本节点，不重建 DOM：

```js title="src/pages/calendar.astro"
function updateCountdowns() {
	var cards = document.querySelectorAll(".nearest-card[data-event-date]");
	var nowMs = Date.now();
	for (var i = 0; i < cards.length; i++) {
		var card = cards[i];
		var parts = card.getAttribute("data-event-date").split("-");
		var ongoing = card.getAttribute("data-event-ongoing") === "1";
		// 当天的事件算到当天 23:59:59，其余算到当天 00:00
		var target = new Date(
			Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]),
			ongoing ? 23 : 0, ongoing ? 59 : 0, ongoing ? 59 : 0,
		).getTime();
		// ... 写入 days/hours/minutes/seconds ...
	}
}
```

### 点击联动

左栏卡片点击后要翻到对应月份并选中那天。用自定义事件解耦，右栏或其他组件也能触发：

```js title="src/pages/calendar.astro"
function selectDate(key) {
	var parts = key.split("-");
	var year = Number(parts[0]);
	var month = Number(parts[1]);
	if (year < payload.minYear || year > payload.maxYear) return;
	state.year = year;
	state.month = month;
	state.selected = key;
	update();
}

document.addEventListener("calendar:select-date", function (event) {
	selectDate(event.detail);
});
```

## 九、三个踩过的坑

### 坑一：农历日期用 `toISOString()` 会差一天

一开始用 `date.toISOString().slice(0, 10)` 生成日期键，结果所有农历日期都偏了一天。原因是 `toISOString()` 转 UTC，东八区的本地零点减 8 小时就变成了前一天 16:00。

必须用本地时间拼：

```ts title="src/utils/lunar-utils.ts"
export function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
```

### 坑二：闰月会让生日重复出现

农历换算时如果没处理闰月，遇到有闰月的年份，同一个生日会在日历上出现两次（正常月一次、闰月一次）。所以 `lunarToSolar` 固定传 `isLeap = false`，`solarToLunar` 里判断 `lunar.isLeap === false`，闰月里的同名日期一律不匹配。

### 坑三：`<script>` 不加 `is:inline` 就传不了 JSON

`<script type="application/json">` 看起来是个普通脚本标签，但 Astro 默认会把它当模块脚本处理并改写，`type` 属性直接丢掉，`JSON.parse` 拿到空字符串。加上 `is:inline` 才是原样输出。

顺带一提，`astro check` 对这种情况会提示 `astro(4000)`，看到这个警告基本就是这个问题。

## 十、相关文件

页面：[/src/pages/calendar.astro](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/pages/calendar.astro)

样式：[/src/styles/pages/calendar.css](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/styles/pages/calendar.css)

配置：[/src/config/calendarConfig.ts](https://github.com/MuyuDada/Firefly-yuan/blob/master/src/config/calendarConfig.ts)

相关源码：[MuyuDada/Firefly-yuan](https://github.com/MuyuDada/Firefly-yuan)

## 🔗 最后

感谢[毛の博客](https://blog.huchao.vip/)的原始设计。

这个页面做下来最深的体会是：**能用算法算的就别存数据，必须存数据的一定要设计降级路径**。农历和节气都是纯计算，代码写完就不用管；法定节假日必须存数据，那就得接受「数据缺失」是常态，提前想好兜底方案，而不是等用户发现「为什么未来没有角标」再补。

如果你也想加这个页面，配置部分改 `calendarConfig.ts` 就够了，日常维护只有一件事——每年 11 月前后跑一次 `pnpm holidays`。
