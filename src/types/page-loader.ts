/**
 * 全屏页面加载动画的管理器接口。
 *
 * 与鼠标特效不同，遮罩的生命周期由「首屏加载」和「Swup 切页」两个来源驱动，
 * 因此 `show()` 需要带上来源，便于按 `pageLoaderConfig.showOnInitial` /
 * `showOnNavigate` 分别开关。
 */
export type PageLoaderSource = "initial" | "navigate";

export interface PageLoaderManagerLike {
	/** 遮罩当前是否可见（含淡出过程中） */
	readonly isRunning: boolean;
	/** 显示遮罩；重复调用应当是安全的空操作 */
	show(source?: PageLoaderSource): void;
	/** 隐藏遮罩；最短展示时长与淡出延迟由实现负责，`instant` 跳过两者 */
	hide(options?: { instant?: boolean }): void;
}
