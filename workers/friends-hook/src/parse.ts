/**
 * 从 Waline 评论正文里解析友链申请字段。
 *
 * Waline 把评论存成 HTML（换行是 `<br>`、裸链接被自动包成 `<a>`），用户则按弹窗里
 * 那个模板手写。模板是：
 *
 *   站点名称：您的站点名称
 *   站点描述：您的站点描述
 *   站点链接：您的站点链接
 *   头像链接：您的站点头像
 *   邮箱：您的邮箱
 *
 * 线上真实提交五花八门：全角/半角冒号、等号、干脆没有分隔符、英文键名、
 * 甚至整段挤在一行。所以这里不用「逐行匹配」而用「全文扫描字段锚点」：
 * 先找出所有「字段名 + 分隔符」的位置，两个锚点之间的内容就是前一个字段的值。
 * 这样单行和多行是同一条代码路径。
 */

import type { ParsedApplication } from "./types";

/** 字段别名表：同一字段的各种写法 */
const FIELD_ALIASES: Record<keyof ParsedApplication, string[]> = {
	name: [
		"站点名称",
		"网站名称",
		"名称",
		"站名",
		"标题",
		"name",
		"title",
		"site name",
		"sitename",
	],
	desc: [
		"站点描述",
		"网站描述",
		"描述",
		"简介",
		"介绍",
		"desc",
		"description",
		"intro",
	],
	siteurl: [
		"站点链接",
		"网站链接",
		"链接",
		"网址",
		"站点地址",
		"网站地址",
		"地址",
		"url",
		"site",
		"siteurl",
		"link",
		"website",
	],
	avatar: ["头像链接", "头像", "logo", "图标", "avatar", "icon", "headimg"],
	email: ["邮箱", "电子邮箱", "邮件", "email", "mail", "e-mail"],
};

/** 解析优先级：同一位置多个别名都能命中时，先试更长的（"站点名称" 优先于 "名称"） */
const ALIAS_INDEX: { key: keyof ParsedApplication; alias: string }[] = (
	Object.keys(FIELD_ALIASES) as (keyof ParsedApplication)[]
)
	.flatMap((key) =>
		FIELD_ALIASES[key].map((alias) => ({ key, alias: alias.toLowerCase() })),
	)
	.sort((a, b) => b.alias.length - a.alias.length);

/**
 * 把分隔符归一成半角，方便匹配。
 *
 * 只做**等长**替换（全角冒号/等号/空格都是 1 字符换 1 字符），归一化后的下标仍能
 * 对回原文。刻意**不**动全角逗号、句号、括号 —— 那些是中文正文的一部分，换了会把
 * 「记录学习，分享笔记。」错改成「记录学习,分享笔记.」。
 */
function normalizeSeparators(input: string): string {
	return input
		.replace(/\uFF1A/g, ":") // ：
		.replace(/\uFF1D/g, "=") // ＝
		.replace(/\u3000/g, " "); // 全角空格
}

/**
 * 把评论 HTML 还原成纯文本（保留换行）。
 * Waline 会用 `<br>` 断行，所以先把块级标签换成换行，再剥标签、解码常见实体。
 */
export function htmlToText(html: string): string {
	const withBreaks = html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
		.replace(/<li[^>]*>/gi, "\n");

	return normalizeSeparators(
		withBreaks
			.replace(/<[^>]+>/g, "")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'"),
	);
}

/** 一个字段锚点：字段名所在位置，以及它后面值的起始位置 */
interface FieldHit {
	key: keyof ParsedApplication;
	/** 字段名在文本中的下标（含其前面空白之前的位置） */
	start: number;
	/** 值在文本中的起始下标 */
	valueStart: number;
}

/**
 * 扫描全文，找出所有「字段名 + 分隔符」锚点。
 *
 * 一个锚点必须满足：
 *   1. 字段名位于行首，或者前面是空白（避免 "sitename" 里命中 "site"）；
 *   2. 字段名后面跟着分隔符（`:`/`=`/空白/破折号）；
 *   3. 若字段名不在行首，则分隔符里必须含非空白字符（`:`/`=`）——
 *      否则行中任意一个词都可能被当成标签。例如
 *      `名称 Zhong Website` 里，行中的 "Website" 就不该被认成 `siteurl` 标签，
 *      否则站名会被截成 "Zhong"。而 `name=测试站 desc=…` 这种一行写完的写法，
 *      靠 `=` 仍然能全部命中。
 */
function findFieldHits(text: string): FieldHit[] {
	const lower = text.toLowerCase();
	const hits: FieldHit[] = [];
	let i = 0;

	while (i < text.length) {
		const prev = i === 0 ? "" : text[i - 1];
		if (i !== 0 && !/\s/.test(prev)) {
			i++;
			continue;
		}
		const atLineStart = i === 0 || prev === "\n";

		let consumed = false;
		for (const { key, alias } of ALIAS_INDEX) {
			if (!lower.startsWith(alias, i)) continue;
			const after = i + alias.length;
			const rest = text.slice(after);
			const sep = rest.match(/^[\s:=\-—]+/);
			if (!sep) continue;
			if (!atLineStart && /^\s+$/.test(sep[0])) continue;

			hits.push({ key, start: i, valueStart: after + sep[0].length });
			i = after + sep[0].length;
			consumed = true;
			break;
		}
		if (!consumed) i++;
	}

	return hits;
}

/** 从一段文本里抽出第一个 URL */
export function extractUrl(line: string): string {
	const match = line.match(/https?:\/\/[^\s<>"'，,）)】]+/i);
	return match ? match[0] : "";
}

/** 从一段文本里抽出邮箱 */
export function extractEmail(line: string): string {
	const match = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
	return match ? match[0] : "";
}

export interface ParseResult {
	parsed: ParsedApplication;
	/** 完全无法归类的行 */
	unparsed: string[];
}

/**
 * 解析申请文本。
 *
 * 第一遍按锚点切分取出各字段值；第二遍把没被任何锚点覆盖的文本按行作为「未识别行」
 * 保留下来，并按内容特征给仍为空的字段兜底（含 URL 的当站点链接、含 @ 的当邮箱）。
 */
export function parseApplication(html: string): ParseResult {
	const text = htmlToText(html);
	const hits = findFieldHits(text);

	const parsed: ParsedApplication = {
		name: "",
		desc: "",
		siteurl: "",
		avatar: "",
		email: "",
	};

	// 每个锚点的值 = 从 valueStart 到下一个锚点 start（或文本结尾）
	hits.forEach((hit, index) => {
		const end = index + 1 < hits.length ? hits[index + 1].start : text.length;
		const value = text.slice(hit.valueStart, end).trim();
		if (!value) return;

		if (hit.key === "siteurl" || hit.key === "avatar") {
			const url = extractUrl(value);
			if (url && !parsed[hit.key]) parsed[hit.key] = url;
		} else if (hit.key === "email") {
			const mail = extractEmail(value);
			if (mail && !parsed.email) parsed.email = mail;
		} else if (!parsed[hit.key]) {
			// 名称/描述可能是多行，压成一行
			parsed[hit.key] = value.replace(/\s*\n\s*/g, " ").trim();
		}
	});

	// 未被任何锚点覆盖的文本，按行收集
	const covered = new Array(text.length).fill(false) as boolean[];
	hits.forEach((hit, index) => {
		const end = index + 1 < hits.length ? hits[index + 1].start : text.length;
		for (let p = hit.start; p < end; p++) covered[p] = true;
	});
	const leftoverText = text
		.split("")
		.filter((_, index) => !covered[index])
		.join("");

	const leftoverLines = leftoverText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	// 兜底：把剩下的行按内容特征塞进空字段
	const unparsed: string[] = [];
	for (const line of leftoverLines) {
		if (!parsed.siteurl && /https?:\/\//i.test(line)) {
			parsed.siteurl = extractUrl(line);
			continue;
		}
		if (!parsed.email && /[\w.+-]+@[\w-]+\.[\w.-]+/.test(line)) {
			parsed.email = extractEmail(line);
			continue;
		}
		if (!parsed.avatar && /https?:\/\//i.test(line)) {
			parsed.avatar = extractUrl(line);
			continue;
		}
		if (!parsed.name && line.length <= 40 && !/[:=]/.test(line)) {
			parsed.name = line;
			continue;
		}
		unparsed.push(line);
	}

	return { parsed, unparsed };
}

/** 必填字段与其中文名 */
export const REQUIRED_FIELDS: {
	key: keyof ParsedApplication;
	label: string;
}[] = [
	{ key: "name", label: "站点名称" },
	{ key: "desc", label: "站点描述" },
	{ key: "siteurl", label: "站点链接" },
	{ key: "avatar", label: "头像链接" },
];

/** 找出缺失的必填字段 */
export function findMissing(parsed: ParsedApplication): string[] {
	return REQUIRED_FIELDS.filter(({ key }) => !parsed[key]).map(
		({ label }) => label,
	);
}

/** 把站点地址归一化，用于查重与反链比较（去掉协议、www、端口、路径，忽略大小写） */
export function normalizeSiteUrl(raw: string): string {
	let host = raw.trim().toLowerCase();
	host = host.replace(/^https?:\/\//, "");
	host = host.replace(/^www\./, "");
	host = host.replace(/[/?#].*$/, "");
	host = host.replace(/:\d+$/, "");
	return host;
}
