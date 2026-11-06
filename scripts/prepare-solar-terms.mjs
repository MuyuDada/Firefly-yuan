#!/usr/bin/env node
/**
 * 把二十四节气图整理成日历页可用的资源
 *
 * 官方节气图是竖版长图（1100×2000、1800×3800 之类），单张动辄 3–7MB。
 * 日历右栏只有 300px 宽，原图直接放进去纯属浪费带宽，所以这个脚本干三件事：
 *   1. 按文件名里的中文节气名识别（「2024年小雪节气图.png」→ xiaoxue）
 *   2. 重命名成拼音
 *   3. 等比缩到指定宽度（不裁切——竖图要靠 CSS 的 object-position 决定露哪一段，
 *      先裁死就再也调不回来了）
 *
 * 用法：
 *   node scripts/prepare-solar-terms.mjs <原图目录>
 *   node scripts/prepare-solar-terms.mjs ./原图 --width=800 --format=webp
 *
 * 输出到 public/wallpapers/solar-terms/，日历页会自动按当前节气取。
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const TERMS_SRC = path.join(ROOT, "src/utils/solar-terms.ts");
const OUT_DIR = path.join(ROOT, "public/wallpapers/solar-terms");

const IMAGE_EXT = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".avif",
	".gif",
	".bmp",
]);

/** 从工具模块读节气表，避免两边各写一份 24 条对不上 */
const readTerms = () => {
	const source = fs.readFileSync(TERMS_SRC, "utf8");
	const readArray = (exportName) => {
		const block = source.match(
			new RegExp(`export const ${exportName}: string\\[\\] = \\[([\\s\\S]*?)\\];`),
		);
		if (!block) throw new Error(`找不到 ${exportName}`);
		return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	};
	const names = readArray("SOLAR_TERM_NAMES");
	const slugs = readArray("SOLAR_TERM_SLUGS");
	if (names.length !== 24 || slugs.length !== 24) {
		throw new Error(`节气表解析异常：${names.length} 名 / ${slugs.length} 拼音`);
	}
	return names.map((name, i) => ({ name, slug: slugs[i] }));
};

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (const arg of args) {
	if (arg.startsWith("--")) {
		const [key, value] = arg.slice(2).split("=");
		flags.set(key, value ?? "true");
	} else {
		positional.push(arg);
	}
}

const srcDir = positional[0] ? path.resolve(positional[0]) : null;
if (!srcDir) {
	console.error("请指定原图目录，例如：node scripts/prepare-solar-terms.mjs ./节气图");
	process.exit(1);
}
if (!fs.existsSync(srcDir)) {
	console.error(`目录不存在：${srcDir}`);
	process.exit(1);
}

const width = Number(flags.get("width") ?? 800);
const quality = Number(flags.get("quality") ?? 82);
const format = (flags.get("format") ?? "jpg").toLowerCase();

const terms = readTerms();
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
	.readdirSync(srcDir)
	.filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));

if (files.length === 0) {
	console.error(`目录里没有图片：${srcDir}`);
	process.exit(1);
}

const hit = new Map();

for (const file of files) {
	// 文件名里同时出现两个节气名时取更长的，避免误判
	const matched = terms
		.filter((t) => file.includes(t.name))
		.sort((a, b) => b.name.length - a.name.length)[0];
	if (!matched) {
		console.log(`  跳过（认不出节气）：${file}`);
		continue;
	}
	if (hit.has(matched.slug)) {
		console.log(`  跳过（重复，保留先遇到的）：${file} → ${matched.name}`);
		continue;
	}
	hit.set(matched.slug, file);

	const out = path.join(OUT_DIR, `${matched.slug}.${format}`);
	// 只缩不裁：右栏用 object-fit: cover 决定露哪一段，这里裁掉就调不回来了
	const pipeline = sharp(path.join(srcDir, file)).resize({
		width,
		withoutEnlargement: true,
	});

	if (format === "webp") {
		await pipeline.webp({ quality, effort: 4 }).toFile(out);
	} else {
		await pipeline.jpeg({ quality, mozjpeg: true }).toFile(out);
	}

	const meta = await sharp(out).metadata();
	const size = (fs.statSync(out).size / 1024).toFixed(0);
	console.log(
		`  ${matched.name} → ${matched.slug}.${format}  ${meta.width}×${meta.height}  ${size}KB`,
	);
}

const missing = terms.filter((t) => !hit.has(t.slug)).map((t) => t.name);
console.log(`\n完成：${hit.size}/24 张，输出到 public/wallpapers/solar-terms/`);
if (missing.length > 0) {
	console.log(`缺：${missing.join("、")}`);
	console.log("缺的节气不会报错，右栏那块会自动隐藏。");
}
if (format !== "jpg") {
	console.log(
		`\n注意：输出的是 .${format}，记得把 src/config/calendarConfig.ts 里 solarTermImage.extension 也改成 "${format}"`,
	);
}
