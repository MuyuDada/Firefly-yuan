// Firefly folia 全屏歌词的共享歌词时钟。
// 对应 folia-web 的模块级 MotionValue + usePlaybackVisualizerBridge rAF 循环：
// 全屏层激活期间由外壳驱动一个 rAF 循环读 <audio>.currentTime，主题组件按需订阅。
// 遵循 folia 的守则：高频时间值不走 Svelte $state，订阅方只在状态跃迁时写自己的状态。

type ClockListener = (time: number) => void;

export class LyricClock {
	/** 当前歌词时间（秒）。普通数字而非 $state：订阅者经回调感知变化。 */
	value = 0;

	private listeners = new Set<ClockListener>();
	private frame = 0;
	private getTime: (() => number) | null = null;

	subscribe(listener: ClockListener): () => void {
		this.listeners.add(listener);
		// 注意：这里不能同步调用 listener(this.value)。
		// 订阅通常发生在 $effect 内，立即回调会在 effect 体里写被追踪的 $state，
		// 触发 Svelte 的 effect 循环保护把整个 effect（连同 rAF 循环）拆掉。
		// 初始对齐由 rAF 的第一帧完成（≤16ms），调用方不需要自己做同步。
		return () => {
			this.listeners.delete(listener);
		};
	}

	set(time: number): void {
		this.value = time;
		for (const listener of this.listeners) {
			// 单个订阅者的异常不能拖垮整个时钟循环；错误打进控制台便于定位。
			try {
				listener(time);
			} catch (error) {
				console.error("[folia] lyric clock listener failed:", error);
			}
		}
	}

	/** 启动 rAF 循环。重复调用幂等；getTime 返回音频当前时间（秒）。 */
	start(getTime: () => number): void {
		this.getTime = getTime;
		if (this.frame) return;
		const tick = () => {
			// 先注册下一帧再跑回调：回调抛错也只会跳过一帧，不会终止循环。
			this.frame = requestAnimationFrame(tick);
			if (this.getTime) this.set(this.getTime());
		};
		this.frame = requestAnimationFrame(tick);
	}

	stop(): void {
		if (!this.frame) return;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.getTime = null;
	}
}

/** 页面级单例：所有全屏歌词主题共享同一时钟。 */
export const foliaClock: LyricClock = new LyricClock();
