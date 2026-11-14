/**
 * 构建时生成 AI 摘要
 *
 * 遍历 src/content/posts 下的文章，调用 OpenAI 兼容的 Chat Completions 接口
 * 生成中文摘要，写入 src/data/ai-summary.json，由文章页静态渲染。
 *
 * 为什么放在构建时做：
 * - 访客打开页面就是一段现成文本，没有等待、没有请求、不消耗 key 额度；
 * - key 只留在本地/CI，不会出现在浏览器里；
 * - 摘要写完可以自己改，模型抽风的地方能人工兜底。
 *
 * 用法：
 *   pnpm ai-summary                  只为新增或正文有改动的文章生成
 *   pnpm ai-summary --force          全部重新生成
 *   pnpm ai-summary --slug=firefly   只处理某一篇
 *   pnpm ai-summary --dry-run        只列出会处理哪些文章，不调接口
 *   pnpm ai-summary --prune          顺手删掉已不存在文章的旧摘要
 *   pnpm ai-summary --limit=5        最多处理 5 篇（先试水用）
 *
 * 环境变量（写在 .env.local 里即可，脚本会自动读取）：
 *   AI_SUMMARY_API_KEY   必填，模型服务商的 key
 *   AI_SUMMARY_BASE_URL  选填，默认 https://api.deepseek.com
 *   AI_SUMMARY_MODEL     选填，默认 deepseek-chat
 *
 * 想看效果又不想花 key：--dry-run 先把待处理清单打出来。
 * 想手动写摘要：直接在文章 frontmatter 里写 aiSummary，优先级高于本文件。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import matter from "gray-matter";

const ROOT = resolve(import.meta.dirname, "..");
const POSTS_DIR = join(ROOT, "src/content/posts");
const OUT_FILE = join(ROOT, "src/data/ai-summary.json");

/** 改提示词后抬高这个版本号，已有摘要会自动重算 */
const PROMPT_VERSION = "v1";
/** 送给模型的正文上限，超出部分取头尾（结尾常是总结，别丢） */
const MAX_INPUT_CHARS = 12000;

const SYSTEM_PROMPT = `你是中文技术博客的编辑，负责给文章写摘要，帮读者在十秒内判断这篇值不值得读。

要求：
1. 用中文，120-180 字，说清「这篇讲什么、解决什么问题、结论是什么」。
2. 只输出摘要正文。不要「摘要：」之类的前缀，不要 Markdown、列表、小标题、引号。
3. 忠于原文，不补充原文没有的信息，不评价文章好坏。
4. 保留关键的技术名词、版本号、工具名，别把它们抽象掉。
5. 正文以代码或配置为主时，概括它最终实现了什么效果。`;

interface SummaryEntry {
	summary: string;
	/** 正文 + 模型 + 提示词版本的指纹，用来判断是否需要重算 */
	hash: string;
	generatedAt: string;
}

interface SummaryFile {
	generatedAt?: string;
	model?: string;
	posts: Record<string, SummaryEntry>;
}

interface Options {
	force: boolean;
	slug: string | null;
	limit: number | null;
	dryRun: boolean;
	prune: boolean;
}

interface PendingPost {
	slug: string;
	title: string;
	body: string;
	hash: string;
}

/** 极简 .env 解析，省得让用户手动 export。.env.local 覆盖 .env。 */
function loadEnvFiles(): void {
	for (const name of [".env.local", ".env"]) {
		const file = join(ROOT, name);
		if (!existsSync(file)) continue;
		for (const rawLine of readFileSync(file, "utf-8").split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			const quoted =
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"));
			if (quoted) value = value.slice(1, -1);
			if (!(key in process.env)) process.env[key] = value;
		}
	}
}

function parseArgs(argv: string[]): Options {
	const opts: Options = {
		force: false,
		slug: null,
		limit: null,
		dryRun: false,
		prune: false,
	};
	for (const arg of argv) {
		if (arg === "--force") opts.force = true;
		else if (arg === "--dry-run") opts.dryRun = true;
		else if (arg === "--prune") opts.prune = true;
		else if (arg.startsWith("--slug=")) opts.slug = arg.slice(7).trim();
		else if (arg.startsWith("--limit=")) {
			const n = Number(arg.slice(8));
			if (Number.isFinite(n) && n > 0) opts.limit = Math.floor(n);
		}
	}
	return opts;
}

/**
 * 把 Markdown 压成纯文本。
 * 目的只是让模型看懂内容，不需要保留层级，所以标题符号、列表符号、链接语法全部丢掉。
 * 代码块换成占位符：模型只需要知道「这里有一段代码」，不需要读具体实现。
 */
function stripMarkdown(md: string): string {
	return md
		.replace(/```[\s\S]*?```/g, " [代码块] ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/^import\s.+$/gm, " ")
		.replace(/^export\s.+$/gm, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s*:::.*$/gm, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/^\s*>\s?/gm, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\|/g, " ")
		.replace(/[*_~]{2,}/g, " ")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 超长正文取头尾，中间标注省略，避免模型只看到开头就下结论 */
function clip(text: string): string {
	if (text.length <= MAX_INPUT_CHARS) return text;
	const head = text.slice(0, MAX_INPUT_CHARS - 2000);
	const tail = text.slice(-2000);
	return `${head}\n\n……（中间省略）……\n\n${tail}`;
}

function fingerprint(title: string, body: string): string {
	return createHash("sha256")
		.update(
			[
				PROMPT_VERSION,
				process.env.AI_SUMMARY_MODEL ?? "deepseek-chat",
				title,
				body,
			].join("\n"),
		)
		.digest("hex")
		.slice(0, 16);
}

function readExisting(): SummaryFile {
	if (!existsSync(OUT_FILE)) return { posts: {} };
	try {
		const parsed = JSON.parse(readFileSync(OUT_FILE, "utf-8")) as SummaryFile;
		return { ...parsed, posts: parsed.posts ?? {} };
	} catch {
		console.warn("⚠️  src/data/ai-summary.json 解析失败，将重新生成");
		return { posts: {} };
	}
}

function writeOutput(posts: Record<string, SummaryEntry>, model: string): void {
	const sorted = Object.fromEntries(
		Object.entries(posts).sort(([a], [b]) => a.localeCompare(b)),
	);
	const payload: SummaryFile = {
		generatedAt: new Date().toISOString(),
		model,
		posts: sorted,
	};
	writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, "\t")}\n`, "utf-8");
}

/** 模型偶尔会加戏：代码围栏、前缀、引号。这里统一擦掉。 */
function normalizeSummary(raw: string): string {
	return raw
		.replace(/^```[a-z]*\s*/i, "")
		.replace(/```\s*$/, "")
		.replace(/^\s*(摘要|总结|Summary)\s*[:：]\s*/i, "")
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
		.replace(/\s*\n+\s*/g, "")
		.trim();
}

async function callModel(
	baseUrl: string,
	apiKey: string,
	model: string,
	userContent: string,
): Promise<string> {
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userContent },
			],
			temperature: 0.3,
			max_tokens: 500,
		}),
		signal: AbortSignal.timeout(90_000),
	});

	if (!res.ok) {
		const detail = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
		throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail}`);
	}

	const json = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	const text = json.choices?.[0]?.message?.content ?? "";
	const summary = normalizeSummary(text);
	if (!summary) throw new Error("模型返回了空内容");
	return summary;
}

async function main(): Promise<void> {
	loadEnvFiles();

	const apiKey = (process.env.AI_SUMMARY_API_KEY ?? "").trim();
	const baseUrl = (
		process.env.AI_SUMMARY_BASE_URL ?? "https://api.deepseek.com"
	)
		.trim()
		.replace(/\/+$/, "");
	const model = (process.env.AI_SUMMARY_MODEL ?? "deepseek-chat").trim();
	const opts = parseArgs(process.argv.slice(2));

	const files = globSync("**/*.{md,mdx}", {
		cwd: POSTS_DIR,
		posix: true,
	}).sort();
	const existing = readExisting();
	const pending: PendingPost[] = [];
	const validSlugs = new Set<string>();

	for (const rel of files) {
		const slug = rel.replace(/\.(md|mdx)$/i, "");
		const source = readFileSync(join(POSTS_DIR, rel), "utf-8");
		const { data, content } = matter(source);

		// 草稿和加密文章不进摘要：一篇还没写完，一篇本来就不该被提前看到
		if (data.draft === true) continue;
		if (typeof data.password === "string" && data.password.length > 0) continue;

		const body = stripMarkdown(content);
		if (body.length < 150) continue;
		validSlugs.add(slug);

		if (opts.slug && slug !== opts.slug) continue;

		const title = String(data.title ?? slug);
		const hash = fingerprint(title, body);
		const cached = existing.posts[slug];
		if (!opts.force && cached && cached.hash === hash && cached.summary)
			continue;

		pending.push({ slug, title, body, hash });
	}

	const pruneTargets = Object.keys(existing.posts).filter(
		(key) => !validSlugs.has(key),
	);

	if (opts.slug && pending.length === 0) {
		const hit = files.some(
			(rel) => rel.replace(/\.(md|mdx)$/i, "") === opts.slug,
		);
		if (!hit) {
			console.error(`✗ 找不到文章：${opts.slug}`);
			process.exitCode = 1;
			return;
		}
	}

	const queue = opts.limit ? pending.slice(0, opts.limit) : pending;

	console.log(
		`\n📚 共 ${files.length} 篇文章，待生成 ${queue.length} 篇${opts.force ? "（--force）" : ""}`,
	);

	if (opts.prune && pruneTargets.length > 0) {
		console.log(
			`🧹 将清理 ${pruneTargets.length} 条已失效摘要：${pruneTargets.join(", ")}`,
		);
	}

	if (queue.length === 0) {
		if (opts.prune && pruneTargets.length > 0) {
			for (const key of pruneTargets) delete existing.posts[key];
			writeOutput(existing.posts, model);
			console.log("✓ 已清理失效条目\n");
			return;
		}
		console.log("✓ 全部摘要已是最新，无需生成\n");
		return;
	}

	if (opts.dryRun) {
		for (const [i, item] of queue.entries()) {
			console.log(
				`  ${String(i + 1).padStart(2, "0")}. ${item.slug} — ${item.title}（${item.body.length} 字）`,
			);
		}
		console.log("\n（--dry-run，未调用接口）\n");
		return;
	}

	if (!apiKey) {
		console.log("\n⚠️  没有找到 AI_SUMMARY_API_KEY，本次不生成。");
		console.log(
			"   在项目根目录的 .env.local 里补上这几行后重跑 pnpm ai-summary：\n",
		);
		console.log("     AI_SUMMARY_API_KEY=sk-xxxx");
		console.log(`     AI_SUMMARY_BASE_URL=${baseUrl}`);
		console.log(`     AI_SUMMARY_MODEL=${model}\n`);
		console.log("   换服务商只要改 BASE_URL（任何 OpenAI 兼容端点都行）：");
		console.log("     DeepSeek  https://api.deepseek.com        deepseek-chat");
		console.log(
			"     智谱 GLM  https://open.bigmodel.cn/api/paas/v4   glm-4-flash",
		);
		console.log(
			"     阿里百炼  https://dashscope.aliyuncs.com/compatible-mode/v1  qwen-plus",
		);
		console.log(
			"     OpenRouter https://openrouter.ai/api/v1   openai/gpt-4o-mini\n",
		);
		process.exitCode = 0;
		return;
	}

	const next = { ...existing.posts };
	let generated = 0;
	let failed = 0;

	for (const [index, item] of queue.entries()) {
		const prefix = `[${index + 1}/${queue.length}] ${item.slug}`;
		process.stdout.write(`${prefix} 生成中…`);
		try {
			const userContent = [
				`标题：${item.title}`,
				`正文：\n${clip(item.body)}`,
			].join("\n\n");
			const summary = await callModel(baseUrl, apiKey, model, userContent);
			next[item.slug] = {
				summary,
				hash: item.hash,
				generatedAt: new Date().toISOString(),
			};
			generated++;
			// 每篇都落盘，跑到一半中断不至于全丢
			writeOutput(next, model);
			console.log(`\r${prefix} ✓ ${summary.length} 字${" ".repeat(20)}`);
		} catch (error) {
			failed++;
			const message = error instanceof Error ? error.message : String(error);
			console.log(`\r${prefix} ✗ ${message}${" ".repeat(20)}`);
		}
	}

	if (opts.prune) {
		for (const key of pruneTargets) delete next[key];
	}

	writeOutput(next, model);
	console.log(
		`\n完成：成功 ${generated} 篇，失败 ${failed} 篇 → src/data/ai-summary.json\n`,
	);
	if (failed > 0) process.exitCode = 1;
}

await main();
