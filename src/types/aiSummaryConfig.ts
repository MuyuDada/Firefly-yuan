export interface AISummaryTypewriterConfig {
	/** 是否启用打字机效果。系统开启「减弱动态效果」时会自动跳过 */
	enable: boolean;
	/** 打完一整段摘要的总时长（毫秒）。文本长短不影响节奏，只会改变每帧字数 */
	duration: number;
}

export interface AISummaryConfig {
	/** 是否在文章页展示 AI 摘要卡片 */
	enable: boolean;
	/** 卡片初始是否展开。收起后点标题栏可展开 */
	defaultOpen: boolean;
	/** 打字机效果 */
	typewriter: AISummaryTypewriterConfig;
}
