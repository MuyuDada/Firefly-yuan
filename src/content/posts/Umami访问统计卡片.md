---
title: '为 Firefly 添加 Umami 访问统计卡片'
slug: 'umami-stats'
published: 2026-09-26
description: '在侧边栏实时展示 Umami 的总浏览量、访问数与游客数，基于公开分享链接免 API Key 拉取，带数字滚动动画与懒加载。'
image: api
category: 小组件
tags: [API, 数据]
draft: false
pinned: true
---

博客跑了这么久，到底有多少人来看过？除了后台的数据面板，把它直接摆到侧边栏其实更有"存在感"——每次打开首页，游客数、访问数、总浏览量一目了然。本文记录给 Firefly 侧边栏加一个 Umami 访问统计卡片的完整过程：不需要 API Key，只靠一条 Umami 的公开分享链接就能把数据取回来。

## 一、功能概览

![Umami 访问统计卡片](https://muyuimg.cc.cd/file/blog/tg4UeDdq.webp)

主要能力：

- **三个核心指标** — 总浏览量（pageviews）、访问数（visits）、游客数（visitors）
- **免 API Key** — 用 Umami 的公开分享链接换取临时 token，前端直接拉取，无需暴露账号密钥
- **自建/云托管通吃** — 自动识别 Umami Cloud 的 US / EU 区域，自建实例则走自身域名
- **数字滚动动画** — 从 0 缓动到真实数值（easeOutCubic），两秒内跑完
- **懒加载** — 卡片进入视口才开始请求，首屏不浪费一次接口调用
- **失败兜底** — 拉取失败时回退到占位数值，不会留一片空白
- **点击跳转** — 整卡可点击，新标签页打开 Umami 的分享看板

组件基于 `WidgetLayout` 卡片开发，效果可以直接看本站左侧栏。

## 二、核心实现

### 组件完整源码

```astro title="src/components/widget/UmamiStats.astro"
---
import WidgetLayout from "@/components/common/WidgetLayout.astro";

interface Props {
  class?: string;
  style?: string;
}
const { class: className, style } = Astro.props;
---

<WidgetLayout id="umami-stats" name="统计" class:list={["umami-stats-container", className, "cursor-pointer transition-opacity active:scale-95"]} {style}>
    <a target="_blank" rel="noopener noreferrer" class="block umami-link">
        <div class="text-center py-2">
            <div class="text-3xl font-bold text-neutral-900 dark:text-neutral-100 umami-total-pageviews">-</div>
            <div class="text-sm text-neutral-500 dark:text-neutral-400">总浏览量</div>
        </div>
        <div class="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-700 text-center pt-2">
            <div class="px-2">
                <div class="text-xl font-bold text-neutral-900 dark:text-neutral-100 umami-total-visits">-</div>
                <div class="text-sm text-neutral-500 dark:text-neutral-400">访问数</div>
            </div>
            <div class="px-2">
                <div class="text-xl font-bold text-neutral-900 dark:text-neutral-100 umami-total-visitors">-</div>
                <div class="text-sm text-neutral-500 dark:text-neutral-400">游客数</div>
            </div>
        </div>
    </a>
</WidgetLayout>

<script>
const UMAMI_CONFIG = {
    shareUrl: 'https://cloud.umami.is/share/XXXXXXXXXXXX',
};

let __UMAMI_INTERNAL = {
    baseUrl: '',
    websiteId: '',
    shareToken: '',
    shareId: '',
    isReady: false
};

const FALLBACK_STATS = {
    pageviews: 1000,
    visits: 1000,
    visitors: 1000,
};

async function initUmamiConfig() {
    try {
        const sharePath = UMAMI_CONFIG.shareUrl.split('/share/')[1];
        if (!sharePath) throw new Error('Invalid Umami Share URL');

        let apiBase = '';
        if (UMAMI_CONFIG.shareUrl.includes('cloud.umami.is') || UMAMI_CONFIG.shareUrl.includes('analytics.umami.is')) {
            const region = UMAMI_CONFIG.shareUrl.includes('/analytics/eu/') ? 'eu' : 'us';
            apiBase = `https://cloud.umami.is/analytics/${region}/api`;
        } else {
            const urlObj = new URL(UMAMI_CONFIG.shareUrl);
            apiBase = `${urlObj.origin}/api`;
        }

        const res = await fetch(`${apiBase}/share/${sharePath}`);
        if (!res.ok) throw new Error(`Failed to fetch share config: ${res.status}`);
        const data = await res.json();

        __UMAMI_INTERNAL = {
            baseUrl: apiBase,
            websiteId: data.websiteId,
            shareToken: data.token,
            shareId: data.shareId,
            isReady: true
        };

        const links = document.querySelectorAll('.umami-link');
        links.forEach(link => link.setAttribute('href', UMAMI_CONFIG.shareUrl));

    } catch (e) {
        console.error('Umami Config Init Failed:', e);
    }
}

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return Math.round(num).toString();
}

function setStats(values: { pageviews: number; visits: number; visitors: number }) {
    const pageviewsElements = document.querySelectorAll('.umami-total-pageviews');
    const visitsElements = document.querySelectorAll('.umami-total-visits');
    const visitorsElements = document.querySelectorAll('.umami-total-visitors');

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const animHandles = new Map<HTMLElement, number>();

    const animateStat = (el: HTMLElement | null, to: number, duration = 2000) => {
        if (!el) return;

        const prev = animHandles.get(el);
        if (prev) cancelAnimationFrame(prev);

        const from = 0;
        const startTime = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easedProgress = easeOutCubic(progress);

            const current = from + (to - from) * easedProgress;
            el.textContent = formatNumber(current);

            if (progress < 1) {
                animHandles.set(el, requestAnimationFrame(tick));
            }
        };
        animHandles.set(el, requestAnimationFrame(tick));
    };

    pageviewsElements.forEach(el => animateStat(el as HTMLElement, values.pageviews));
    visitsElements.forEach(el => animateStat(el as HTMLElement, values.visits));
    visitorsElements.forEach(el => animateStat(el as HTMLElement, values.visitors));
}

async function fetchUmamiStats() {
    if (!__UMAMI_INTERNAL.isReady) {
        await initUmamiConfig();
    }

    if (!__UMAMI_INTERNAL.isReady) {
        setStats(FALLBACK_STATS);
        return;
    }

    try {
        const endAt = Date.now();
        const startAt = 0;
        const url = `${__UMAMI_INTERNAL.baseUrl}/websites/${__UMAMI_INTERNAL.websiteId}/stats?startAt=${startAt}&endAt=${endAt}&unit=hour&timezone=Asia%2FShanghai`;

        const response = await fetch(url, {
            headers: {
                'x-umami-share-context': '1',
                'x-umami-share-token': __UMAMI_INTERNAL.shareToken
            }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const getValue = (field: any) => (typeof field === 'object' ? field?.value : field) || 0;

        setStats({
            pageviews: getValue(data.pageviews),
            visits: getValue(data.visits),
            visitors: getValue(data.visitors),
        });

    } catch (error) {
        console.error('Umami Fetch Failed:', error);
        setStats(FALLBACK_STATS);
    }
}

let __umamiStatsStarted = false;
function startUmamiStats() {
    if (__umamiStatsStarted) return;
    __umamiStatsStarted = true;
    fetchUmamiStats();
}

function initUmamiStatsVisibility() {
    const containers = document.querySelectorAll('.umami-stats-container');
    const io = new IntersectionObserver((entries) => {
        let isAnyVisible = false;
        entries.forEach(entry => {
            if (entry.isIntersecting) isAnyVisible = true;
        });

        if (isAnyVisible) {
            startUmamiStats();
            io.disconnect();
        }
    }, { threshold: 0.1 });

    containers.forEach(container => io.observe(container));
}

initUmamiStatsVisibility();

if (window.swup) {
    window.swup.hooks.on('page:view', () => {
        __umamiStatsStarted = false;
        initUmamiStatsVisibility();
    });
}
</script>
```

## 三、注册组件

在 `src/components/layout/SideBar.astro` 中导入：

```js title="src/components/layout/SideBar.astro" ins={1}
import UmamiStats from "@/components/widget/UmamiStats.astro";
import YearProgress from "@/components/widget/YearProgress.astro";
```

同时在 `componentMap` 中注册：

```js title="src/components/layout/SideBar.astro" ins={4}
const componentMap = {
    // ...
    yearProgress: YearProgress,
    umamiStats: UmamiStats,
};
```

## 四、注册类型

在 `src/types/sidebarConfig.ts` 的类型联合中添加组件名：

```typescript title="src/types/sidebarConfig.ts" ins={5}
export type WidgetComponentType =
    | "profile"
    // ...
    | "yearProgress"
    | "umamiStats";
```

## 五、配置方式

在 `src/config/sidebarConfig.ts` 的左侧边栏中配置：

```typescript title="src/config/sidebarConfig.ts" ins={5}
leftComponents: [
    // ...
    {
        // 组件类型：Umami 统计组件
        type: "umamiStats",
        enable: true,
        position: "sticky",
        showOnPostPage: true,
    },
]
```

> `position` 可选 `top`（固定顶部）或 `sticky`（粘性定位）；`showOnPostPage` 控制文章详情页是否显示。想放到右侧栏就写进 `rightComponents`，移动端则加进 `mobileBottomComponents`（移动端组件没有 `position` 字段）。

## 六、获取并配置分享链接

卡片的所有数据都来自 Umami 的**公开分享链接**，这也是它不需要 API Key 的原因。先在 Umami 里生成一条分享链接：

1. 打开 Umami 后台，进入你的网站详情页
2. 找到「分享 / Share」入口，新建一条分享
3. 复制形如 `https://cloud.umami.is/share/xxxxxxxx` 的链接

把它填进组件顶部的 `UMAMI_CONFIG`：

```js title="src/components/widget/UmamiStats.astro" ins={2}
const UMAMI_CONFIG = {
    shareUrl: 'https://cloud.umami.is/share/你的分享ID',
};
```

> 卡片只读取公开的汇总数据，不会接触你的账号或密钥；分享链接一旦被删除，卡片就会走失败兜底。

### 别忘了装上统计脚本

卡片负责「展示」，数据本身还得靠 Umami 的统计脚本来产生。确认 `src/config/analyticsConfig.ts` 里填好了 `websiteId`：

```typescript title="src/config/analyticsConfig.ts" ins={3}
umamiAnalytics: {
    // Umami Website ID
    websiteId: "你的-website-id",
    scriptUrl: "https://cloud.umami.is/script.js",
    // ...
},
```

## 七、实现要点

### 用分享链接换 token，而不是 API Key

前端直接调 Umami 的私有 API 需要密钥，把它写进静态站点等于公开泄露。所以组件改走「分享」这条路：先用分享 ID 换一份只读凭证，再带着它去查汇总数据。

```js
// 1. 用分享路径换回 websiteId 与 shareToken
const res = await fetch(`${apiBase}/share/${sharePath}`);
const data = await res.json();
// data.websiteId / data.token

// 2. 带着 token 查统计
const url = `${apiBase}/websites/${data.websiteId}/stats?startAt=0&endAt=${Date.now()}&unit=hour&timezone=Asia%2FShanghai`;
await fetch(url, {
    headers: {
        'x-umami-share-context': '1',
        'x-umami-share-token': data.token
    }
});
```

`startAt=0` 表示统计从建站以来的全部数据，`endAt` 取当前时间戳。

### 自动识别云托管区域

Umami Cloud 分 US / EU 两个区域，API 域名前缀不同；自建实例则直接用自身域名。组件按分享链接做了分流：

```js
if (shareUrl.includes('cloud.umami.is') || shareUrl.includes('analytics.umami.is')) {
    const region = shareUrl.includes('/analytics/eu/') ? 'eu' : 'us';
    apiBase = `https://cloud.umami.is/analytics/${region}/api`;
} else {
    apiBase = `${new URL(shareUrl).origin}/api`;
}
```

所以无论你用官方云还是自建，都不用额外改代码。

### 数字滚动动画

数字不是直接赋值，而是用 `requestAnimationFrame` 从 0 缓动到目标值，缓动函数是 `easeOutCubic`（先快后慢）：

```js
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const current = from + (to - from) * easedProgress;
```

同时用一张 `Map` 记录每个元素的动画句柄，重复触发时会先 `cancelAnimationFrame`，避免多次请求后数字乱跳。展示上还做了单位缩写：超过 1000 显示 `1.2K`，超过 100 万显示 `1.5M`。

### 懒加载与 swup 兼容

卡片不急着请求，先用 `IntersectionObserver` 观察自己，等真正滚进视口（阈值 0.1）再拉数据，避免首屏多打一次接口：

```js
const io = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) {
        startUmamiStats();
        io.disconnect();
    }
}, { threshold: 0.1 });
```

Firefly 用 swup 做无感翻页，所以额外监听 `page:view`，重置标志位后重新观察——保证换页后新出现的卡片仍能正常加载。

### 失败兜底

接口异常时不会留白，而是回退到一组占位数值：

```js
const FALLBACK_STATS = { pageviews: 1000, visits: 1000, visitors: 1000 };
```

这样即使 Umami 临时不可用，卡片布局依然完整。

## 八、相关文件

组件：[/src/components/widget/UmamiStats.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/UmamiStats.astro)

统计脚本：[/src/components/analytics/UmamiAnalytics.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/analytics/UmamiAnalytics.astro)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

Umami 官网：[umami.is](https://umami.is/)

## 🔗 最后

这个卡片的巧思在于「绕开密钥」——用公开分享链接 + 临时 token 的方式，把只读的汇总数据安全地摆到前端。配上数字滚动和懒加载，既好看又不拖慢首屏。如果你还想展示「今日访客」「最近 7 天趋势」，在同一个 stats 接口上换个 `startAt` 即可，感兴趣的可以自己试试。
