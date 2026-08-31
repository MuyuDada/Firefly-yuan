---
title: '为Firefly添加IP定位欢迎弹窗'
published: 2026-08-28
description: '首次访问时右下角弹出欢迎提示，显示访客所在地，5 秒后自动关闭。'
image: api
tags: [Firefly, 博客, 二开, 交互]
category: Firefly
draft: false
slug: welcome-toast
pinned: true
---

当访客第一次打开你的博客时，右下角弹出一个轻巧的欢迎提示，显示"你好，来自 XX 的朋友"，5 秒后自动消失——这种小细节能让博客更有人情味。

## 一、功能概览

![欢迎弹框的效果](https://img.olinl.com/file/post-img/welcome-toast/0001.webp)

核心流程：
1. 检查 `sessionStorage` 中是否已有访问标记
2. 首次访问 → 调用 IP 定位 API 获取所在地
3. 右下角弹出欢迎 Toast，5 秒后自动关闭
4. 同一会话内不再重复弹出

## 二、实现细节

### 会话控制

```typescript title="src/components/widget/WelcomeToast.astro"
const VISIT_SESSION_KEY = "blog_visit_flag";

// 检查是否已弹过
if (sessionStorage.getItem(VISIT_SESSION_KEY)) return;

// 显示弹窗后标记
sessionStorage.setItem(VISIT_SESSION_KEY, "true");
```

### 获取访客位置

```typescript title="src/components/widget/WelcomeToast.astro"
fetch("https://v2.xxapi.cn/api/ip")
  .then(res => res.json())
  .then(data => {
    const address = data.data?.address || "";
    message.textContent = address
      ? `你好，来自 ${address} 的朋友 👋`
      : "你好，欢迎来到我的博客 👋";
  })
  .catch(() => {
    message.textContent = "你好，欢迎来到我的博客 👋";
  });
```

### 动画与关闭

```js title="src/components/widget/WelcomeToast.astro"
// 弹入动画
toast.classList.remove("translate-y-full", "opacity-0");

// 5 秒后自动关闭
setTimeout(() => {
  toast.classList.add("translate-y-full", "opacity-0");
}, 5000);

// 手动关闭
window.__closeWelcomeToast = () => {
  toast.classList.add("translate-y-full", "opacity-0");
};
```

## 三、核心代码

组件本身是一个自执行的 Astro 脚本组件，直接查看文件内容：

```astro title="src/components/widget/WelcomeToast.astro"
---
// 欢迎提示组件 —— 首次访问时从右下角弹出，显示访客所在地
---

<script>
  const VISIT_SESSION_KEY = "blog_visit_flag";
  let hasShownToast = false;

  function createWelcomeToast(): HTMLElement {
    const toast = document.createElement("div");
    toast.id = "welcome-toast";
    toast.className =
      "fixed bottom-4 right-4 z-50 translate-y-full opacity-0 transition-all duration-500 ease-out";

    toast.innerHTML = `
      <div class="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-4 max-w-xs">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 text-2xl">👋</div>
          <div class="flex-1 min-w-0">
            <p id="welcome-message" class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              正在加载...
            </p>
            <p class="text-xs text-gray-600 dark:text-gray-400 mt-2 italic">
              欢迎来到我的博客
            </p>
          </div>
          <button
            onclick="window.__closeWelcomeToast?.()"
            class="flex-shrink-0 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            aria-label="关闭"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(toast);
    return toast;
  }

  function closeWelcomeToast(): void {
    const toast = document.getElementById("welcome-toast");
    if (toast) {
      toast.classList.add("translate-y-full", "opacity-0");
      toast.classList.remove("translate-y-0", "opacity-100");
      setTimeout(() => {
        toast.remove();
      }, 500);
    }
  }

  async function fetchLocation(): Promise<void> {
    try {
      const response = await fetch("https://v2.xxapi.cn/api/ip");
      const data = await response.json();
      if (data.code === 200 && data.data) {
        const locationText = `你好，来自${data.data.address}的朋友`;
        const messageEl = document.getElementById("welcome-message");
        if (messageEl) messageEl.textContent = locationText;
      }
    } catch {
      const messageEl = document.getElementById("welcome-message");
      if (messageEl) messageEl.textContent = "你好，欢迎来到我的博客";
    }
  }

  async function showWelcomeToast(): Promise<void> {
    if (hasShownToast) return;
    const toast = createWelcomeToast();
    // 下一帧触发过渡动画
    requestAnimationFrame(() => {
      toast.classList.remove("translate-y-full", "opacity-0");
      toast.classList.add("translate-y-0", "opacity-100");
    });
    hasShownToast = true;
    await fetchLocation();
    setTimeout(() => {
      closeWelcomeToast();
    }, 5000);
  }

  function initWelcome(): void {
    // 仅首次访问显示（同一会话内不重复弹出）
    if (!sessionStorage.getItem(VISIT_SESSION_KEY)) {
      sessionStorage.setItem(VISIT_SESSION_KEY, "true");
      showWelcomeToast();
    }

    // 其他显示逻辑（按需切换）：
    // - 仅首页刷新显示：取消上面注释，改为 if (window.location.pathname === '/') showWelcomeToast();
    // - 每次刷新都显示：直接 showWelcomeToast();
  }

  window.__closeWelcomeToast = closeWelcomeToast;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWelcome);
  } else {
    initWelcome();
  }
</script>

<style>
  #welcome-toast {
    max-width: calc(100vw - 2rem);
  }
  @media (max-width: 640px) {
    #welcome-toast {
      top: auto;
      bottom: 1rem;
      left: 50%;
      right: auto;
      transform: translateX(-50%) translateY(100%);
      width: 90%;
      max-width: none;
      transition: transform 0.5s ease-out, opacity 0.5s ease-out;
    }
    #welcome-toast.translate-y-0 {
      transform: translateX(-50%) translateY(0);
    }
    #welcome-toast.translate-y-full {
      transform: translateX(-50%) translateY(100%);
    }
  }
</style>
```

若要启用，在 `src/layouts/Layout.astro` 中导入并挂载：

```js title="src/layouts/Layout.astro" ins={4,9}
import FontSetup from "@components/features/FontSetup.astro";
import MusicManager from "@components/features/MusicManager.astro";
import SakuraEffect from "@components/features/SakuraEffect.astro";
import WelcomeToast from "@components/widget/WelcomeToast.astro";
import ConfigCarrier from "@components/layout/ConfigCarrier.astro";
// ...
    <!-- Sakura Effect -->
    <SakuraEffect />
    <WelcomeToast />
    <!-- Fancybox Manager -->
```

## 四、相关文件

组件：[/src/components/widget/WelcomeToast.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/WelcomeToast.astro)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

## 🔗 最后

通过 IP 定位让每位访客感受到被欢迎，同时 `sessionStorage` 保证了不打扰体验。如果你有更好的 IP 定位 API，替换请求地址即可。

相关源码：[Firefly 博客 - WelcomeToast.astro](https://github.com/muyudada/firefly-yuan)