/**
 * 抓取中国法定节假日 / 调休数据，写入 src/constants/holidays.json
 *
 * 站点日历页（/calendar/）用它给日历格子打「休 / 班」角标。
 * 数据是静态文件，构建期不联网；官方每年 11-12 月公布次年安排，届时跑一次即可：
 *
 *   pnpm holidays            # 自动补齐当前年份起往后 2 年
 *   pnpm holidays 2027 2028  # 指定年份
 *
 * 数据源：https://timor.tech/api/holiday/year/<year>
 * 返回里 `holiday: true` 表示放假（含「初一」「初二」这类只有序数名的连休日），
 * `holiday: false` 表示调休补班。两者都要保留：放假日在格子上打「休」，
 * 补班日既要打「班」角标，也要生成一条「调休」事件。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";

const OUTPUT = join(process.cwd(), "src", "constants", "holidays.json");
const API = "https://timor.tech/api/holiday/year/";

function request(url, redirects = 0) {
	return new Promise((resolve, reject) => {
		const req = get(
			url,
			{
				timeout: 15000,
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
					Accept: "application/json,text/plain,*/*",
					Referer: "https://timor.tech/",
				},
			},
			(res) => {
				if (
					res.statusCode >= 300 &&
					res.statusCode < 400 &&
					res.headers.location &&
					redirects < 3
				) {
					res.resume();
					resolve(request(res.headers.location, redirects + 1));
					return;
				}
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => resolve(body));
			},
		);
		req.on("error", reject);
		req.on("timeout", () => req.destroy(new Error("timeout")));
	});
}

async function fetchYear(year, attempts = 6) {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const json = JSON.parse(await request(`${API}${year}`));
			if (json.code === 0 && json.holiday) return json.holiday;
			throw new Error("unexpected payload");
		} catch (error) {
			console.warn(`  ${year} 第 ${attempt} 次失败：${error.message}`);
			await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
		}
	}
	return null;
}

/** 只保留日历页需要的字段，尽量压小 JSON 体积 */
function normalize(holiday) {
	return Object.values(holiday)
		.map((item) => {
			const row = {
				date: item.date,
				name: item.name,
				rest: item.holiday === true,
				wage: item.wage ?? 1,
			};
			if (item.target) row.target = item.target;
			return row;
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const args = process.argv.slice(2).filter((arg) => /^\d{4}$/.test(arg));
const currentYear = new Date().getFullYear();
const years =
	args.length > 0
		? args.map(Number)
		: [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

const data = {};
// 已抓过的年份先读进来，避免只抓某一年时把其它年份的数据清掉
try {
	Object.assign(data, JSON.parse(readFileSync(OUTPUT, "utf8")));
} catch {
	// 首次运行没有旧文件，忽略
}

for (const year of years) {
	process.stdout.write(`抓取 ${year}…\n`);
	const holiday = await fetchYear(year);
	if (!holiday) {
		process.stdout.write(`  ${year} 暂无数据（官方未公布），跳过\n`);
		continue;
	}
	const rows = normalize(holiday);
	if (rows.length === 0) {
		process.stdout.write(`  ${year} 返回空列表（官方未公布），跳过\n`);
		continue;
	}
	data[year] = rows;
	const rest = rows.filter((row) => row.rest).length;
	process.stdout.write(
		`  ${year} → ${rows.length} 条（休 ${rest} / 班 ${rows.length - rest}）\n`,
	);
}

if (Object.keys(data).length === 0) {
	console.error("没有抓到任何数据，holidays.json 保持不变");
	process.exit(1);
}

// 年份按升序写回，方便 diff；顺手清掉空数组（官方尚未公布的年份）
const sorted = {};
for (const key of Object.keys(data).sort()) {
	if (Array.isArray(data[key]) && data[key].length > 0) {
		sorted[key] = data[key];
	}
}

writeFileSync(OUTPUT, `${JSON.stringify(sorted, null, "\t")}\n`, "utf8");
process.stdout.write(`写入 ${OUTPUT}\n`);
