/**
 * 鼠标与输入特效的管理器接口。
 *
 * 四个特效组件（光标 / 点击粒子 / 星尘拖尾 / 输入火焰）都实现同一套生命周期，
 * 因此共用这个最小接口：
 * - `init()` 可能异步（例如等待 Canvas 尺寸就绪），调用方用 `void mgr.init()` 即可；
 * - `stop()` 必须幂等，重复调用不应抛错，用于开关关闭或组件卸载；
 * - `isRunning` 供 `init()` 内部做二次防抖，避免重复启动 rAF 循环。
 */
export interface MouseEffectManagerLike {
	/** 当前是否正在运行（rAF 循环是否已启动） */
	readonly isRunning: boolean;
	/** 启动特效；重复调用应当是安全的空操作 */
	init(): void | Promise<void>;
	/** 停止特效并释放资源；重复调用应当是安全的空操作 */
	stop(): void;
}

/** 自定义光标管理器 */
export type CursorManagerLike = MouseEffectManagerLike;

/** 点击粒子特效管理器 */
export type ClickParticleManagerLike = MouseEffectManagerLike;

/** 星尘拖尾特效管理器 */
export type FairyDustManagerLike = MouseEffectManagerLike;

/** 输入火焰特效管理器 */
export type InputFireManagerLike = MouseEffectManagerLike;
