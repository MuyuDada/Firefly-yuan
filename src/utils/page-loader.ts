import { pageLoaderConfig } from "@/config";
import type {
	PageLoaderManagerLike,
	PageLoaderSource,
} from "@/types/page-loader";

/** 与 CSS 中的移动端断点保持一致（< 768px 视为移动端） */
const MOBILE_BREAKPOINT = 768;

/** 进度在等待期间最多爬到 90%，剩下的 10% 留给真正完成时补上 */
const PROGRESS_CEILING = 0.9;

/** 进度轮询间隔：只在「还没加载完」时爬条，完成即停止 */
const PROGRESS_TICK = 140;

/** 会话级标记：同一标签页内首屏动画是否已播放过（sessionStorage，跨刷新保留） */
const SESSION_KEY = "firefly:page-loader:shown";

/** 复位进度的延迟：要等淡出过渡（320ms）走完 */
const RESET_DELAY = 400;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 全屏加载遮罩控制器。
 *
 * 遮罩 DOM 由 `PageLoader.astro` 服务端渲染（首屏立即可见，避免白屏闪烁），
 * 这里只负责「什么时候该出现」以及显隐、进度与计时：
 *
 * 频率策略（默认值见 `pageLoaderConfig`）
 * - 首屏：同一标签页只播一次（`oncePerSession`），刷新 / 前进后退直接跳过；
 * - 切页：默认关闭（`showOnNavigate`）；即便打开，也要等 `delayOnNavigate`
 *   仍未完成才淡入——快导航根本不会看到遮罩；
 * - 冷却：两次展示之间至少间隔 `minInterval`，避免连点时反复闪；
 * - `prefers-reduced-motion` 下不跑进度轮询，只做淡入淡出。
 *
 * 时长策略
 * - `minDuration` 只兜首屏（切页已由 delay 等待兜过，不再叠加下限）；
 * - 首屏不再死等 `window.load`：`initialGrace` 到点先松手，避免大壁纸把遮罩拖到 `maxWait`；
 * - `maxWait` 是兜底，避免就绪信号没来（报错 / 网络挂起）时遮罩永久盖住页面。
 */
class PageLoaderManager implements PageLoaderManagerLike {
	private el: HTMLElement | null = null;
	private visible = false;
	private disabled = false;
	private reduced = false;
	/** 当前这轮展示的最短时长下限 */
	private floorMs = 0;
	private shownAt = 0;
	/** 上一次淡出结束的时刻，用于展示冷却 */
	private lastHiddenAt = Number.NEGATIVE_INFINITY;
	/** 停留在延迟展示的等待中（尚未真正显示，也不会闪烁） */
	private pending = false;
	private progress = 0;
	private hideTimer: number | null = null;
	private maxWaitTimer: number | null = null;
	private progressTimer: number | null = null;
	private graceTimer: number | null = null;
	private showTimer: number | null = null;
	private resetTimer: number | null = null;
	private loadListenerAttached = false;

	get isRunning(): boolean {
		return this.visible;
	}

	init(): void {
		this.el = document.getElementById("page-loader");
		if (!this.el) return;
		this.el.classList.add("page-loader--js");
		this.reduced = prefersReducedMotion();

		if (!pageLoaderConfig.enable) {
			this.disabled = true;
			this.applyHiddenNow();
			return;
		}

		if (
			!pageLoaderConfig.showOnMobile &&
			window.innerWidth < MOBILE_BREAKPOINT
		) {
			this.disabled = true;
			this.applyHiddenNow();
			return;
		}

		// 首屏只播一次：同一标签页内刷新 / 前进后退都直接跳过，
		// 否则每次打开站点都要先看一遍遮罩，次数上去了反而像卡顿
		if (!pageLoaderConfig.showOnInitial || this.seenThisSession()) {
			this.applyHiddenNow();
			return;
		}

		// 首屏：遮罩已由服务端渲染为可见，这里只等页面就绪后收起
		this.visible = true;
		this.shownAt = performance.now();
		this.floorMs = pageLoaderConfig.minDuration;
		this.writeSessionFlag();
		this.startProgress();
		this.armMaxWait();
		this.hideOnPageReady();
	}

	show(source: PageLoaderSource = "navigate"): void {
		if (this.disabled || !this.el) return;
		if (source === "initial" && !pageLoaderConfig.showOnInitial) return;
		if (source === "navigate" && !pageLoaderConfig.showOnNavigate) return;
		// 正在显示 / 正在等延迟：重复调用是安全的空操作
		if (this.visible || this.pending) return;
		// 冷却：刚收起不久就不再弹，连续切页时不会来回闪
		if (performance.now() - this.lastHiddenAt < pageLoaderConfig.minInterval) {
			return;
		}

		const delay = source === "navigate" ? pageLoaderConfig.delayOnNavigate : 0;
		if (delay <= 0) {
			this.reveal(source);
			return;
		}

		// 延迟显示：导航在 delay 内完成就压根不会出现遮罩，
		// 只有真正慢的那几次才看得见，这是「别太频繁」最关键的一条
		this.pending = true;
		this.showTimer = window.setTimeout(() => {
			this.showTimer = null;
			this.pending = false;
			this.reveal(source);
		}, delay);
	}

	hide(options: { instant?: boolean } = {}): void {
		// 还停在延迟等待里：说明这次加载够快，直接取消，遮罩从头到尾没出现过
		if (this.pending) {
			this.cancelPending();
			return;
		}
		if (this.disabled || !this.el || !this.visible) return;
		this.clearTimers();

		if (options.instant) {
			this.finish();
			return;
		}

		const elapsed = performance.now() - this.shownAt;
		const wait =
			Math.max(0, this.floorMs - elapsed) + pageLoaderConfig.hideDelay;
		this.hideTimer = window.setTimeout(() => this.finish(), wait);
	}

	/** 首屏：load 已过就直接收，否则等 load 或 initialGrace 先到者 */
	private hideOnPageReady(): void {
		const done = () => {
			this.clearGrace();
			// grace 与 load 可能先后到达，只在第一次生效
			if (this.hideTimer !== null || !this.visible) return;
			this.hide();
		};

		if (document.readyState === "complete") {
			// 让浏览器先把首帧画出来，再开始淡出，避免遮罩与首帧同帧
			requestAnimationFrame(done);
			return;
		}

		if (!this.loadListenerAttached) {
			this.loadListenerAttached = true;
			window.addEventListener(
				"load",
				() => {
					this.loadListenerAttached = false;
					done();
				},
				{ once: true },
			);
		}

		// load 要等壁纸、字体、全部图片就绪，首屏常被拖到 maxWait 才有反应；
		// initialGrace 到点先松手，剩下的资源让页面自己补齐（0 = 关掉兜底，死等 load）
		const grace = pageLoaderConfig.initialGrace;
		if (grace > 0) {
			this.graceTimer = window.setTimeout(done, grace);
		}
	}

	/** 真正把遮罩显示出来（不含延迟判断） */
	private reveal(source: PageLoaderSource): void {
		if (!this.el || this.visible) return;
		this.clearTimers();
		this.visible = true;
		this.shownAt = performance.now();
		// 切页已经为「慢导航」等过 delayOnNavigate，再叠最短时长就太久了
		this.floorMs = source === "navigate" ? 0 : pageLoaderConfig.minDuration;
		this.resetProgress();
		this.el.classList.remove("is-hidden");
		this.startProgress();
		this.armMaxWait();
	}

	private cancelPending(): void {
		if (this.showTimer !== null) {
			window.clearTimeout(this.showTimer);
			this.showTimer = null;
		}
		this.pending = false;
	}

	private startProgress(): void {
		if (this.reduced) return;
		if (this.progressTimer !== null) return;
		this.progressTimer = window.setInterval(() => {
			// 越接近上限爬得越慢，形成自然的“卡在最后一点”观感
			const step = (PROGRESS_CEILING - this.progress) * 0.12;
			this.progress = Math.min(PROGRESS_CEILING, this.progress + step);
			this.writeProgress();
		}, PROGRESS_TICK);
	}

	private armMaxWait(): void {
		if (pageLoaderConfig.maxWait <= 0) return;
		this.maxWaitTimer = window.setTimeout(() => {
			this.finish();
		}, pageLoaderConfig.maxWait);
	}

	/** 收尾：进度补满 → 淡出 → 复位，供下一轮复用 */
	private finish(): void {
		this.clearTimers();
		if (!this.el) return;
		this.progress = 1;
		this.writeProgress();
		this.el.classList.add("is-hidden");
		this.visible = false;
		this.lastHiddenAt = performance.now();

		// 复位要等淡出走完；期间若又开始新一轮展示，由 clearTimers() 取消，
		// 否则会把新的一轮进度条从 100% 倒着拉回去
		this.resetTimer = window.setTimeout(() => {
			this.resetTimer = null;
			if (this.visible || this.pending) return;
			this.resetProgress();
		}, RESET_DELAY);
	}

	private resetProgress(): void {
		if (!this.el) return;
		this.progress = 0;
		// 复位时禁用过渡，否则进度条会从 100% 倒着退回去
		this.el.classList.add("page-loader--reset");
		this.writeProgress();
		// 强制提交样式，保证下一次写入重新走过渡
		void this.el.offsetWidth;
		this.el.classList.remove("page-loader--reset");
	}

	private writeProgress(): void {
		this.el?.style.setProperty("--pl-progress", this.progress.toFixed(3));
	}

	private applyHiddenNow(): void {
		this.visible = false;
		this.el?.classList.add("is-hidden");
	}

	/** 本标签页内是否已经播过首屏动画 */
	private seenThisSession(): boolean {
		if (!pageLoaderConfig.oncePerSession) return false;
		try {
			return window.sessionStorage.getItem(SESSION_KEY) === "1";
		} catch {
			// 隐私模式 / 禁用存储：退化成「每次都播」，不影响功能
			return false;
		}
	}

	private writeSessionFlag(): void {
		if (!pageLoaderConfig.oncePerSession) return;
		try {
			window.sessionStorage.setItem(SESSION_KEY, "1");
		} catch {
			/* 存储不可用时静默忽略 */
		}
	}

	private clearGrace(): void {
		if (this.graceTimer === null) return;
		window.clearTimeout(this.graceTimer);
		this.graceTimer = null;
	}

	private clearTimers(): void {
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
		if (this.maxWaitTimer !== null) {
			window.clearTimeout(this.maxWaitTimer);
			this.maxWaitTimer = null;
		}
		if (this.progressTimer !== null) {
			window.clearInterval(this.progressTimer);
			this.progressTimer = null;
		}
		if (this.resetTimer !== null) {
			window.clearTimeout(this.resetTimer);
			this.resetTimer = null;
		}
		if (this.showTimer !== null) {
			window.clearTimeout(this.showTimer);
			this.showTimer = null;
		}
		this.clearGrace();
	}
}

/**
 * 初始化加载遮罩（幂等：Swup 切页会重跑模块脚本，用守卫避免重复建管理器）。
 */
export function initPageLoader(): void {
	if (window.__fireflyPageLoaderInit) return;
	window.__fireflyPageLoaderInit = true;
	const manager = new PageLoaderManager();
	manager.init();
	window.pageLoaderManager = manager;
}

/** 供 Swup 钩子调用：显示遮罩（无管理器时安全空操作） */
export function showPageLoader(source: PageLoaderSource = "navigate"): void {
	window.pageLoaderManager?.show(source);
}

/** 供 Swup 钩子调用：隐藏遮罩（无管理器时安全空操作） */
export function hidePageLoader(options?: { instant?: boolean }): void {
	window.pageLoaderManager?.hide(options);
}
