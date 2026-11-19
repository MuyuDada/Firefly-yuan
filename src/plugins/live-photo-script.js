/*
 * 实况照片（Live Photo）交互脚本
 *
 * 为 .live-photo 提供：
 *   - 桌面端悬停播放、移出暂停复位
 *   - 触屏长按播放、松手复位
 *   - 键盘 Enter / 空格切换
 *   - 响应 prefers-reduced-motion（降低动效偏好时不悬停播放，只保留键盘）
 *   - 响应 astro:page-load（Swup）页面切换
 */
(() => {
	if (window._livePhotoInit) return;
	window._livePhotoInit = true;

	const initOne = (el) => {
		if (el.dataset.liveReady) return;
		const poster = el.querySelector(".lp-poster");
		const video = el.querySelector(".lp-video");
		if (!poster || !video) return;
		el.dataset.liveReady = "1";

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let playing = false;

		const play = () => {
			if (playing) return;
			playing = true;
			el.classList.add("is-playing");
			const p = video.play();
			if (p && typeof p.catch === "function") {
				p.catch(() => {
					playing = false;
					el.classList.remove("is-playing");
				});
			}
		};

		const stop = () => {
			if (!playing) return;
			playing = false;
			el.classList.remove("is-playing");
			video.pause();
			try {
				video.currentTime = 0;
			} catch {
				/* 忽略：视频元数据尚未加载 */
			}
		};

		// 桌面：悬停播放
		if (!reduceMotion) {
			el.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "mouse") play();
			});
			el.addEventListener("pointerleave", (e) => {
				if (e.pointerType === "mouse") stop();
			});
		}

		// 触屏：按住播放
		el.addEventListener("pointerdown", (e) => {
			if (e.pointerType === "mouse") return;
			play();
			try {
				el.setPointerCapture(e.pointerId);
			} catch {
				/* 部分浏览器不支持捕获 */
			}
		});
		el.addEventListener("pointerup", stop);
		el.addEventListener("pointercancel", stop);

		// 键盘可访问性
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				playing ? stop() : play();
			}
		});
		el.tabIndex = 0;
		el.setAttribute("role", "button");
		el.setAttribute(
			"aria-label",
			`${poster.alt || "实况照片"}（回车键播放）`,
		);
	};

	const initAll = () => {
		document.querySelectorAll("[data-live-photo]").forEach(initOne);
	};

	document.addEventListener("astro:page-load", () => {
		// Swup 切页后节点是新的，重新扫描
		initAll();
	});
	// 加密文章解密后内容才注入
	document.addEventListener("password:decrypted", () => {
		setTimeout(initAll, 100);
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initAll, { once: true });
	} else {
		initAll();
	}
})();
