/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

declare global {
	interface ImportMetaEnv {
		readonly MEILI_MASTER_KEY: string;
		// 视图设置面板总开关，可在部署平台配置（true / 1 / on / yes 开启）
		readonly PUBLIC_DISPLAY_SETTINGS?: string;
		// UAPI 天气接口的 key：访客额度被限流（429）时作为兜底使用。
		// 只从部署平台环境变量注入，禁止写进 src/config（会提交到仓库）。
		readonly PUBLIC_UAPI_KEY?: string;
	}

	interface ITOCManager {
		init: () => void;
		render: () => void;
		attach: () => void;
		cleanup: () => void;
	}

	interface Window {
		SidebarTOC: {
			manager: ITOCManager | null;
		};
		FloatingTOC: {
			btn: HTMLElement | null;
			panel: HTMLElement | null;
			manager: ITOCManager | null;
			isPostPage: () => boolean;
		};
		toggleFloatingTOC: () => void;
		tocInternalNavigation: boolean;
		ImmersiveReading: {
			btn: HTMLElement | null;
			tocBtn: HTMLElement | null;
			toc: HTMLElement | null;
			manager: ITOCManager | null;
			prevScroll: number;
			isImmersive: boolean;
		};
		toggleImmersiveReading: () => void;
		enterImmersiveReading: () => void;
		exitImmersiveReading: () => void;
		toggleImmersiveTOC: () => void;
		__immersiveReadingInit?: boolean;
		// swup is defined in global.d.ts
		// biome-ignore lint/suspicious/noExplicitAny: External library without types
		spine: any;
		closeAnnouncement: () => void;
		// __fireflyMusic type is defined in global.d.ts
		semifullScrollHandler?: (() => void) | undefined;
		initSemifullScrollDetection?: () => void;
	}
}

export {};
