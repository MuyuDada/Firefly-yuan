import type { AISummaryConfig } from "../types/aiSummaryConfig";

/**
 * 文章 AI 摘要展示配置
 *
 * 摘要内容本身由 `pnpm ai-summary` 生成到 src/data/ai-summary.json，
 * 这里是「怎么展示」的开关。改完刷新即可，不需要重跑生成脚本。
 */
export const aiSummaryConfig: AISummaryConfig = {
	// 是否在文章页展示 AI 摘要卡片
	// 关掉后卡片完全不渲染，已生成的摘要数据保留，随时可以再打开
	enable: true,

	// 卡片初始是否展开
	// 想让它安静地待着就设 false，读者感兴趣会自己点开
	defaultOpen: true,

	typewriter: {
		// 是否让摘要逐字浮现（关掉则直接整段显示）
		enable: true,

		// 打完的总时长，单位毫秒
		// 字数多时每帧多打几个字，所以长摘要不会拖很久；调大更从容，调小更利落
		duration: 1400,
	},
};
