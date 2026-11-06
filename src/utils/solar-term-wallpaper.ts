import { getSolarTermInfo } from "@/utils/solar-term-utils";

export interface SolarTermLayerConfig {
	basePath: string;
	mobileBasePath?: string;
	extension: string;
	files?: Record<string, string>;
}

/**
 * 按当前节气换横幅壁纸。
 *
 * 为什么在客户端算：站点是静态构建，构建时间不等于访问时间。
 * 一次部署后可能几周不重建，构建期选好的图早就过季了。
 *
 * 幂等：靠 dataset.ready 保护，Swup 换页重复调用无害。
 */
export const initSolarTermWallpaper = (): void => {
	const layer = document.getElementById("solar-term-layer");
	if (!layer || layer.dataset.ready === "true") return;
	layer.dataset.ready = "true";

	const img = layer.querySelector("img");
	if (!img) return;

	let cfg: SolarTermLayerConfig;
	try {
		cfg = JSON.parse(layer.dataset.config ?? "{}");
	} catch {
		return;
	}
	if (!cfg.basePath) return;

	const mobileQuery = window.matchMedia("(max-width: 1023px)");
	const baseForViewport = () =>
		mobileQuery.matches && cfg.mobileBasePath ? cfg.mobileBasePath : cfg.basePath;

	let loadedUrl = "";

	const apply = (): void => {
		const { current } = getSolarTermInfo();
		// 挂在 html 上：方便排查当前算成了哪个节气，也能给 CSS 用
		document.documentElement.setAttribute("data-solar-term", current.slug);

		const url =
			cfg.files?.[current.slug] ||
			`${baseForViewport()}${current.slug}.${cfg.extension}`;
		if (url === loadedUrl) return;
		loadedUrl = url;

		// 缺图时保持透明，露出下面的默认壁纸，不显示破图
		img.onload = () => {
			layer.style.opacity = "1";
		};
		img.onerror = () => {
			layer.style.opacity = "0";
		};
		img.src = url;
	};

	apply();

	// 页面长时间挂着、跨过交节时刻时自动换（10 分钟一次，几乎不耗性能）
	window.setInterval(apply, 10 * 60 * 1000);

	// 断点变化可能切到另一套图
	mobileQuery.addEventListener("change", () => {
		loadedUrl = "";
		apply();
	});
};
