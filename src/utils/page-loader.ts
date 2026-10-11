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

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 全屏加载遮罩控制器。
 *
 * 遮罩 DOM 由 `PageLoader.astro` 服务端渲染（首屏立即可见，避免白屏闪烁），
 * 这里只负责显隐、进度与计时：
 * - `show()` 记录起点并启动进度爬升；
 * - `hide()` 保证首屏至少展示 `minDuration`（切页不设下限，靠 `hideDelay` 防闪一下）；
 * - `maxWait` 是兜底，避免 visit:end 没触发时遮罩永久盖住页面；
 * - `prefers-reduced-motion` 下不跑进度轮询，只做淡入淡出。
 */
class PageLoaderManager implements PageLoaderManagerLike {
	private el: HTMLElement | null = null;
	private visible = false;
	private disabled = false;
	private reduced = false;
	/** 当前这轮展示的最短时长下限 */
	private floorMs = 0;
	private shownAt = 0;
	private progress = 0;
	private hideTimer: number | null = null;
	private maxWaitTimer: number | null = null;
	private progressTimer: number | null = null;
	private loadListenerAttached = false;

	get isRunning(): boolean {
		return this.visible;
	}

	init(): void {
		this.el = document.getElementById("page-loader");
		if (!this.el) return;
		this.el.classList.add("page-loader--js");
		this.reduced = prefersReducedMotion();

		if (!pageLoaderConfig.showOnMobile && window.innerWidth < MOBILE_BREAKPOINT) {
			this.disabled = true;
			this.applyHiddenNow();
			return;
		}

		if (!pageLoaderConfig.showOnInitial) {
			this.applyHiddenNow();
			return;
		}

		// 首屏：遮罩已由服务端渲染为可见，这里只等页面就绪后收起
		this.visible = true;
		this.shownAt = performance.now();
		this.floorMs = pageLoaderConfig.minDuration;
		this.startProgress();
		this.armMaxWait();
		this.hideOnPageReady();
	}

	show(source: PageLoaderSource = "navigate"): void {
		if (this.disabled || !this.el) return;
		if (source === "initial" && !pageLoaderConfig.showOnInitial) return;
		if (source === "navigate" && !pageLoaderConfig.showOnNavigate) return;

		this.clearTimers();
		this.visible = true;
		this.shownAt = performance.now();
		// 切页同样受 minDuration 约束：Swup 预加载后导航常在 100ms 内完成，
		// 若不留下限，遮罩只会闪一下，既看不清又像卡顿
		this.floorMs = pageLoaderConfig.minDuration;
		this.resetProgress();
		this.el.classList.remove("is-hidden");
		this.startProgress();
		this.armMaxWait();
	}

	hide(options: { instant?: boolean } = {}): void {
		if (this.disabled || !this.el || !this.visible) return;
		this.clearTimers();

		if (options.instant) {
			this.finish();
			return;
		}

		const elapsed = performance.now() - this.shownAt;
		const wait = Math.max(0, this.floorMs - elapsed) + pageLoaderConfig.hideDelay;
		this.hideTimer = window.setTimeout(() => this.finish(), wait);
	}

	/** 首屏：load 已过就直接收，否则挂一次性监听 */
	private hideOnPageReady(): void {
		if (document.readyState === "complete") {
			// 让浏览器先把首帧画出来，再开始淡出，避免遮罩与首帧同帧
			requestAnimationFrame(() => this.hide());
			return;
		}
		if (this.loadListenerAttached) return;
		this.loadListenerAttached = true;
		window.addEventListener(
			"load",
			() => {
				this.loadListenerAttached = false;
				this.hide();
			},
			{ once: true },
		);
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

		window.setTimeout(() => {
			if (this.visible) return;
			this.resetProgress();
		}, 400);
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
