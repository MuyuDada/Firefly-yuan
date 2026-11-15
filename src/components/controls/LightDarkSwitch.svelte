<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import DropdownItem from "@/components/common/DropdownItem.svelte";
import Icon from "@/components/common/Icon.svelte";
import { DARK_MODE, LIGHT_MODE, SYSTEM_MODE } from "@/constants/constants";
import type { LIGHT_DARK_MODE } from "@/types/config.ts";
import {
	applyThemeToDocument,
	getStoredTheme,
	setTheme,
} from "@/utils/setting-utils";

// Define Swup type for window object
interface SwupHooks {
	on(event: string, callback: () => void): void;
}

interface SwupInstance {
	hooks?: SwupHooks;
}

type WindowWithSwup = Window & { swup?: SwupInstance };

let mode: LIGHT_DARK_MODE = $state(LIGHT_MODE);
let displayedMode: LIGHT_DARK_MODE = $state(LIGHT_MODE); // 显示的实际主题（在system模式下会随系统变化）
let refreshThemeModeHighlight: (() => void) | undefined;

function switchScheme(newMode: LIGHT_DARK_MODE) {
	mode = newMode;
	setTheme(newMode);
	updateDisplayedMode();
	requestAnimationFrame(() => refreshThemeModeHighlight?.());
}

// 更新显示的主题（用于显示当前实际主题）
function updateDisplayedMode() {
	if (mode === SYSTEM_MODE) {
		// 如果是system模式，显示实际的系统主题
		const isSystemDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;
		displayedMode = isSystemDark ? DARK_MODE : LIGHT_MODE;
	} else {
		displayedMode = mode;
	}
}

// 使用onMount确保在组件挂载后正确初始化
onMount(() => {
	// 立即获取并设置正确的主题
	const storedTheme = getStoredTheme();
	mode = storedTheme;
	updateDisplayedMode();

	// 确保DOM状态与存储的主题一致（只对非system模式检查）
	if (storedTheme !== SYSTEM_MODE) {
		const currentTheme = document.documentElement.classList.contains("dark")
			? DARK_MODE
			: LIGHT_MODE;
		if (storedTheme !== currentTheme) {
			applyThemeToDocument(storedTheme);
		}
	}

	// 如果是system模式，监听系统主题变化
	if (storedTheme === SYSTEM_MODE) {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleSystemChange = () => {
			updateDisplayedMode();
		};
		mediaQuery.addEventListener("change", handleSystemChange);
	}

	// 添加Swup监听
	const handleContentReplace = () => {
		const newTheme = getStoredTheme();
		mode = newTheme;
		updateDisplayedMode();
		requestAnimationFrame(() => refreshThemeModeHighlight?.());
	};

	// 检查Swup是否已经加载
	const win = window as WindowWithSwup;
	if (win.swup?.hooks) {
		win.swup.hooks.on("content:replace", handleContentReplace);
	} else {
		document.addEventListener("swup:enable", () => {
			const w = window as WindowWithSwup;
			if (w.swup?.hooks) {
				w.swup.hooks.on("content:replace", handleContentReplace);
			}
		});
	}

	// 监听主题变化事件
	const handleThemeChange = () => {
		// 只有当mode不是system模式时才更新mode
		// system模式下，mode应该保持为SYSTEM_MODE，displayedMode会自动更新
		if (mode !== SYSTEM_MODE) {
			const newTheme = getStoredTheme();
			mode = newTheme;
			updateDisplayedMode();
		} else {
			// system模式下只需要更新displayedMode
			updateDisplayedMode();
		}
		requestAnimationFrame(() => refreshThemeModeHighlight?.());
	};

	window.addEventListener("theme-change", handleThemeChange);

	const panel = document.getElementById("theme-mode-panel");
	let removeHighlightListeners = () => {};
	if (panel) {
		const highlight = panel.querySelector<HTMLElement>(
			".navbar-dropdown-highlight",
		);
		if (highlight) {
			let activeTarget: HTMLElement | null = null;
			let hoveredTarget: HTMLElement | null = null;
			let initialized = false;

			const moveHighlight = (target: HTMLElement | null) => {
				if (!target?.isConnected) {
					highlight.style.opacity = "0";
					return;
				}

				const panelRect = panel.getBoundingClientRect();
				const targetRect = target.getBoundingClientRect();
				const contentRect = target
					.querySelector<HTMLElement>(".navbar-dropdown-item-content")
					?.getBoundingClientRect();
				const targetStyle = getComputedStyle(target);
				const paddingLeft = Number.parseFloat(targetStyle.paddingLeft) || 0;
				const paddingRight = Number.parseFloat(targetStyle.paddingRight) || 0;
				const left = contentRect
					? contentRect.left - paddingLeft
					: targetRect.left;
				const width = contentRect
					? contentRect.width + paddingLeft + paddingRight
					: targetRect.width;

				highlight.style.transform = `translate3d(${left - panelRect.left - panel.clientLeft}px, ${targetRect.top - panelRect.top - panel.clientTop}px, 0)`;
				highlight.style.width = `${width}px`;
				highlight.style.height = `${targetRect.height}px`;
				highlight.style.opacity = "1";

				if (!initialized) {
					initialized = true;
					requestAnimationFrame(() => (highlight.dataset.ready = "true"));
				}
			};

			const refreshActiveTarget = () => {
				activeTarget = panel.querySelector<HTMLElement>(
					".navbar-theme-mode-item.current-theme-btn",
				);
				panel
					.querySelectorAll<HTMLElement>(".navbar-theme-mode-item")
					.forEach((item) => {
						item.toggleAttribute("data-nav-active", item === activeTarget);
					});
				moveHighlight(hoveredTarget ?? activeTarget);
			};

			const getTarget = (element: EventTarget | null) => {
				if (!(element instanceof Element)) return null;
				const target = element.closest<HTMLElement>(".navbar-theme-mode-item");
				return target && panel.contains(target) ? target : null;
			};

			const onPointerOver = (event: PointerEvent) => {
				const target = getTarget(event.target);
				if (target && target !== hoveredTarget) {
					hoveredTarget = target;
					moveHighlight(target);
				}
			};
			const onPointerLeave = () => {
				hoveredTarget = null;
				moveHighlight(activeTarget);
			};
			const onFocusIn = (event: FocusEvent) => {
				const target = getTarget(event.target);
				if (target) {
					hoveredTarget = target;
					moveHighlight(target);
				}
			};
			const onFocusOut = (event: FocusEvent) => {
				if (
					event.relatedTarget instanceof Node &&
					panel.contains(event.relatedTarget)
				)
					return;
				hoveredTarget = null;
				moveHighlight(activeTarget);
			};
			const onResize = () => moveHighlight(hoveredTarget ?? activeTarget);

			panel.addEventListener("pointerover", onPointerOver);
			panel.addEventListener("pointerleave", onPointerLeave);
			panel.addEventListener("focusin", onFocusIn);
			panel.addEventListener("focusout", onFocusOut);
			window.addEventListener("resize", onResize);
			refreshThemeModeHighlight = refreshActiveTarget;
			requestAnimationFrame(refreshActiveTarget);

			removeHighlightListeners = () => {
				panel.removeEventListener("pointerover", onPointerOver);
				panel.removeEventListener("pointerleave", onPointerLeave);
				panel.removeEventListener("focusin", onFocusIn);
				panel.removeEventListener("focusout", onFocusOut);
				window.removeEventListener("resize", onResize);
				if (refreshThemeModeHighlight === refreshActiveTarget) {
					refreshThemeModeHighlight = undefined;
				}
			};
		}
	}

	// 清理函数
	return () => {
		window.removeEventListener("theme-change", handleThemeChange);
		removeHighlightListeners();
	};
});
</script>

<div class="z-50">
	<button aria-label="Light/Dark Mode" aria-haspopup="menu" aria-controls="theme-mode-panel" aria-expanded="false" class="relative btn-plain scale-animation rounded-lg h-11 w-11 active:scale-90" id="scheme-switch">
        <div class="absolute inset-0 flex items-center justify-center" class:opacity-0={displayedMode !== LIGHT_MODE}>
            <Icon icon="material-symbols:wb-sunny-outline-rounded" class="text-[1.25rem]"></Icon>
        </div>
        <div class="absolute inset-0 flex items-center justify-center" class:opacity-0={displayedMode !== DARK_MODE}>
            <Icon icon="material-symbols:dark-mode-outline-rounded" class="text-[1.25rem]"></Icon>
        </div>
    </button>
    <div id="theme-mode-panel" class="float-panel float-panel-closed absolute transition-all top-21 right-4 p-2 z-50" role="menu" aria-labelledby="scheme-switch" data-floating-panel data-floating-panel-trigger="scheme-switch" inert aria-hidden="true">
		<span class="navbar-dropdown-highlight" aria-hidden="true"></span>
        <DropdownItem
            role="menuitem"
            isActive={mode === LIGHT_MODE}
            isLast={false}
			class="navbar-theme-mode-item"
            onclick={() => switchScheme(LIGHT_MODE)}
        >
			<span class="navbar-dropdown-item-content">
				<Icon icon="material-symbols:wb-sunny-outline-rounded" class="text-[1.25rem] mr-3"></Icon>
				<span>{i18n(I18nKey.lightMode)}</span>
			</span>
        </DropdownItem>
        <DropdownItem
            role="menuitem"
            isActive={mode === DARK_MODE}
            isLast={false}
			class="navbar-theme-mode-item"
            onclick={() => switchScheme(DARK_MODE)}
        >
			<span class="navbar-dropdown-item-content">
				<Icon icon="material-symbols:dark-mode-outline-rounded" class="text-[1.25rem] mr-3"></Icon>
				<span>{i18n(I18nKey.darkMode)}</span>
			</span>
        </DropdownItem>
        <DropdownItem
            role="menuitem"
            isActive={mode === SYSTEM_MODE}
            isLast={true}
			class="navbar-theme-mode-item"
            onclick={() => switchScheme(SYSTEM_MODE)}
        >
			<span class="navbar-dropdown-item-content">
				<Icon icon="material-symbols:brightness-auto-outline-rounded" class="text-[1.25rem] mr-3"></Icon>
				<span>{i18n(I18nKey.systemMode)}</span>
			</span>
        </DropdownItem>
    </div>
</div>
