#!/usr/bin/env node
/**
 * 把二十四节气图批量整理成横幅壁纸
 *
 * 官方节气图是竖版长图（常见 1080×2275、2000×2829），直接铺到宽幅横幅上
 * 会裁掉一大半，人物也容易只剩半个身子。这个脚本干两件事：
 *   1. 按文件名里的中文节气名识别，重命名成拼音（lidong.jpg 之类）
 *   2. 裁成横幅比例，用 attention 策略挑信息最密集的区域，而不是硬切中间
 *
 * 用法：
 *   node scripts/prepare-solar-terms.mjs <原图目录>
 *   node scripts/prepare-solar-terms.mjs ./原图 --width=1920 --height=800
 *   node scripts/prepare-solar-terms.mjs ./原图 --position=centre   # 想看正中间就换成这个
 *
 * 输出到 public/wallpapers/solar-terms/，然后去 src/config/solarTermWallpaper.ts
 * 把 enable 改成 true 即可生效。
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const UTILS = path.join(ROOT, "src/utils/solar-term-utils.ts");
const OUT_DIR = path.join(ROOT, "public/wallpapers/solar-terms");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp"]);

/** 从工具模块读节气表，避免两边各写一份 24 条对不上 */
const readTerms = () => {
	const source = fs.readFileSync(UTILS, "utf8");
	const pattern = /\{\s*name:\s*"([^"]+)",\s*slug:\s*"([^"]+)"/g;
	const terms = [];
	for (const m of source.matchAll(pattern)) {
		terms.push({ name: m[1], slug: m[2] });
	}
	if (terms.length !== 24) {
		throw new Error(`节气表解析异常，只拿到 ${terms.length} 项`);
	}
	return terms;
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

const width = Number(flags.get("width") ?? 1920);
const height = Number(flags.get("height") ?? 800);
const quality = Number(flags.get("quality") ?? 82);
const position = flags.get("position") ?? "attention";

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
	// 文件名里同时出现两个节气名时，取更长的那个（避免「小寒」和「大寒」之类误判）
	const matched = terms
		.filter((t) => file.includes(t.name))
		.sort((a, b) => b.name.length - a.name.length)[0];
	if (!matched) {
		console.log(`  跳过（认不出节气）：${file}`);
		continue;
	}
	if (hit.has(matched.slug)) {
		console.log(`  跳过（重复，保留先遇到的）：${file} -> ${matched.name}`);
		continue;
	}
	hit.set(matched.slug, file);

	const out = path.join(OUT_DIR, `${matched.slug}.jpg`);
	await sharp(path.join(srcDir, file))
		.resize(width, height, { fit: "cover", position })
		.jpeg({ quality, mozjpeg: true })
		.toFile(out);

	const size = (fs.statSync(out).size / 1024).toFixed(0);
	console.log(`  ${matched.name} → ${matched.slug}.jpg  ${size}KB`);
}

const missing = terms.filter((t) => !hit.has(t.slug)).map((t) => t.name);
console.log(`\n完成：${hit.size}/24 张，输出到 public/wallpapers/solar-terms/`);
if (missing.length > 0) {
	console.log(`缺：${missing.join("、")}`);
	console.log("缺的节气不会报错，只会继续显示原来的随机壁纸。");
}
console.log("\n别忘了把 src/config/solarTermWallpaper.ts 里的 enable 改成 true。");
