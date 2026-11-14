import aiSummaryData from "@/data/ai-summary.json";

export interface AISummaryEntry {
	/** 摘要正文，纯文本 */
	summary: string;
	/** 正文指纹，生成脚本用它判断要不要重算 */
	hash?: string;
	generatedAt?: string;
}

interface AISummaryFile {
	generatedAt?: string;
	model?: string;
	posts?: Record<string, AISummaryEntry>;
}

const file = aiSummaryData as AISummaryFile;

/** 生成这批摘要用的模型名，展示在卡片底部 */
export const aiSummaryModel: string = file.model ?? "";

/**
 * 取一篇文章的 AI 摘要。
 *
 * 优先级：frontmatter 里手写的 aiSummary > 脚本生成的 src/data/ai-summary.json。
 * 手写永远赢 —— 想改某一篇的措辞，直接写进那篇文章的 frontmatter 即可，
 * 下次跑生成脚本也不会覆盖它（脚本只写 JSON）。
 *
 * @param slug 文章 slug，与路由一致（entry.id 去掉扩展名）
 * @param manual frontmatter 里的 aiSummary 字段
 */
export function getAISummary(
	slug: string,
	manual?: string,
): AISummaryEntry | null {
	const handwritten = (manual ?? "").trim();
	if (handwritten) {
		return { summary: handwritten, generatedAt: "" };
	}
	const entry = file.posts?.[slug];
	if (!entry?.summary) return null;
	return entry;
}
