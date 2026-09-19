---
title: '为Firefly添加年度进度侧栏组件'
slug: 'year-progress'
published: 2026-09-20
description: '侧边栏年度进度组件，年份数字按进度水平填充、月份逐个点亮，附揭幕与填充双动画。'
image: api
category: Firefly
tags: [Firefly, 博客, 二开, 小部件]
draft: false
---

在[毛の博客](https://blog.huchao.vip/)看到一个非常精致的年度进度小组件：当前年份的数字会随着一年过去慢慢被"填满"，下面十二个月份逐个点亮，再配上一段从左到右的揭幕动画，简单又直观。于是决定在 Firefly 上复刻一个，本文记录完整实现。

## 一、功能概览

![年度进度组件（暗色模式）](https://muyuimg.cc.cd/file/blog/2GPwAzWB.webp)

![年度进度组件（亮色模式）](https://muyuimg.cc.cd/file/blog/Hy8fTI9h.webp)

主要能力：
- 当前年份与下一年份大字号显示，数字按年度进度从左到右水平填充
- 12 个月份小字号排开，已过月份全亮、当前月按比例填充、未来月份置灰
- 揭幕 + 填充双动画，通过 `@property` 注册自定义属性实现平滑过渡
- 亮暗色模式自适应，支持 `prefers-reduced-motion` 降级
- 进度由客户端实时计算，静态构建的博客也能始终显示最新进度，跨天自动刷新

组件基于 `WidgetLayout` 卡片开发，所以自动继承折叠、动画等通用能力。效果可以直接看本站首页右侧栏。

## 二、核心实现

### 组件完整源码

```astro title="src/components/widget/YearProgress.astro"
---
import WidgetLayout from "@/components/common/WidgetLayout.astro";

interface Props {
    class?: string;
    style?: string;
}

const { class: className, style } = Astro.props;

// 构建时的初始值，客户端脚本会在页面加载后按访问者的当前时间重新计算
const isLeapYear = (year: number) =>
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const now = new Date();
const currentYear = now.getFullYear();
const daysInYear = isLeapYear(currentYear) ? 366 : 365;
const dayOfYear = Math.floor(
    (now.getTime() - new Date(currentYear, 0, 0).getTime()) / 86400000,
);
const currentYearProgress = (dayOfYear / daysInYear) * 100;
const daysInMonth = new Date(currentYear, now.getMonth() + 1, 0).getDate();
const monthProgress = Array.from({ length: 12 }, (_, month) => {
    if (month < now.getMonth()) return 100;
    if (month > now.getMonth()) return 0;
    return (now.getDate() / daysInMonth) * 100;
});
const displayYears = [currentYear, currentYear + 1];
---

<WidgetLayout id="year-progress-widget" name="年度进度" class={className} style={style}>
    <div class="year-progress-widget" data-year-progress>
        <div class="year-progress-widget__stage">
            <div class="year-progress-widget__years">
                {displayYears.map((year, index) => (
                    <span
                        class="year-progress-widget__glyph year-progress-widget__glyph--year"
                        style={`--progress-target: ${index === 0 ? currentYearProgress : 0}`}
                    >
                        {year}
                    </span>
                ))}
            </div>
            <div class="year-progress-widget__months">
                {monthProgress.map((progress, index) => (
                    <span
                        class="year-progress-widget__glyph year-progress-widget__glyph--month"
                        style={`--progress-target: ${progress}`}
                    >
                        {index + 1}
                    </span>
                ))}
            </div>
        </div>
    </div>
</WidgetLayout>

<script is:inline>
    (function () {
        const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        const updateYearProgress = () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const date = now.getDate();
            const daysInYear = isLeapYear(year) ? 366 : 365;
            const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 86400000);
            const yearValues = [(dayOfYear / daysInYear) * 100, 0];
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const monthValues = [];
            for (let m = 0; m < 12; m++) {
                if (m < month) monthValues.push(100);
                else if (m > month) monthValues.push(0);
                else monthValues.push((date / daysInMonth) * 100);
            }
            document.querySelectorAll("[data-year-progress]").forEach((widget) => {
                widget.querySelectorAll(".year-progress-widget__glyph--year").forEach((glyph, i) => {
                    if (i >= yearValues.length) return;
                    glyph.textContent = String(year + i);
                    glyph.style.setProperty("--progress-target", yearValues[i]);
                });
                widget.querySelectorAll(".year-progress-widget__glyph--month").forEach((glyph, i) => {
                    if (i >= monthValues.length) return;
                    glyph.style.setProperty("--progress-target", monthValues[i]);
                });
                const stage = widget.querySelector(".year-progress-widget__stage");
                if (stage && !stage.classList.contains("is-ready")) stage.classList.add("is-ready");
            });
        };
        const init = () => {
            updateYearProgress();
            // 跨天（月末/年末）时刷新进度
            const next = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1);
            setTimeout(() => {
                updateYearProgress();
                setInterval(updateYearProgress, 86400000);
            }, next - new Date());
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
        else init();
        document.addEventListener("astro:page-load", updateYearProgress);
    })();
</script>

<style is:global>
    /* 注册后 --yp-progress 才能在 keyframes 中平滑插值，实现数字填充动画 */
    @property --yp-progress {
        syntax: "<number>";
        inherits: false;
        initial-value: 0;
    }

    .year-progress-widget__stage {
        --yp-fill: oklch(0.96 0.01 var(--hue));
        --yp-muted: oklch(0.52 0.02 var(--hue));
        background: oklch(0.11 0.01 var(--hue));
        border-radius: calc(var(--radius-large) - 0.35rem);
        clip-path: inset(0 100% 0 0);
        padding: 0.85rem 0.65rem 0.75rem;
        overflow: hidden;
    }

    .year-progress-widget__stage.is-ready {
        animation: 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards year-progress-widget-reveal;
    }

    .year-progress-widget__stage.is-ready .year-progress-widget__glyph {
        animation: 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards year-progress-widget-fill;
    }

    .year-progress-widget__years {
        justify-content: space-between;
        align-items: baseline;
        gap: 0.35rem;
        margin-bottom: 0.65rem;
        display: flex;
    }

    .year-progress-widget__months {
        flex-wrap: wrap;
        justify-content: center;
        align-items: baseline;
        gap: 0.28rem 0.42rem;
        display: flex;
    }

    .year-progress-widget__glyph {
        --yp-progress: 0;
        background: linear-gradient(
            90deg,
            var(--yp-fill) 0%,
            var(--yp-fill) calc(var(--yp-progress) * 1%),
            var(--yp-muted) calc(var(--yp-progress) * 1%),
            var(--yp-muted) 100%
        );
        color: transparent;
        letter-spacing: -0.03em;
        -webkit-user-select: none;
        user-select: none;
        -webkit-background-clip: text;
        background-clip: text;
        font-weight: 800;
        line-height: 1;
    }

    .year-progress-widget__glyph--year {
        font-size: clamp(1.65rem, 5.5vw, 2.15rem);
    }

    .year-progress-widget__glyph--month {
        letter-spacing: -0.02em;
        font-size: 0.78rem;
        font-weight: 700;
    }

    @keyframes year-progress-widget-reveal {
        0% {
            clip-path: inset(0 100% 0 0);
        }
        to {
            clip-path: inset(0);
        }
    }

    @keyframes year-progress-widget-fill {
        0% {
            --yp-progress: 0;
        }
        to {
            --yp-progress: var(--progress-target);
        }
    }

    :root.dark .year-progress-widget__stage {
        --yp-fill: oklch(0.97 0.008 var(--hue));
        --yp-muted: oklch(0.5 0.018 var(--hue));
        background: oklch(0.09 0.012 var(--hue));
    }

    @media (prefers-reduced-motion: reduce) {
        .year-progress-widget__stage,
        .year-progress-widget__stage.is-ready {
            clip-path: inset(0);
            animation: none;
        }
        .year-progress-widget__glyph,
        .year-progress-widget__stage.is-ready .year-progress-widget__glyph {
            --yp-progress: var(--progress-target);
            animation: none;
        }
    }
</style>
```

## 三、注册组件

在 `src/components/layout/SideBar.astro` 中导入：

```js title="src/components/layout/SideBar.astro" ins={6}
import Advertisement from "@/components/widget/Advertisement.astro";
import Announcement from "@/components/widget/Announcement.astro";
import Calendar from "@/components/widget/Calendar.astro";
// ...
import Schedule from "@/components/widget/Schedule.astro";
import YearProgress from "@/components/widget/YearProgress.astro";
```

同时在 `componentMap` 中注册：

```js title="src/components/layout/SideBar.astro" ins={6}
const componentMap = {
    profile: Profile,
    announcement: Announcement,
    // ...
    schedule: Schedule,
    yearProgress: YearProgress,
};
```

## 四、注册类型

在 `src/types/sidebarConfig.ts` 的类型联合中添加组件名：

```typescript title="src/types/sidebarConfig.ts" ins={6}
export type WidgetComponentType =
    | "profile"
    // ...
    | "schedule"
    | "relationship"
    | "yearProgress";
```

## 五、配置方式

在 `sidebarConfig.ts` 的右侧边栏中配置：

```typescript title="src/config/sidebarConfig.ts" ins={3}
rightComponents: [
    {
        // 组件类型：年度进度组件
        type: "yearProgress",
        enable: true,
        position: "top",
        showOnPostPage: false,
    },
    // ...
]
```

如果希望移动端也能看到，把它加进 `mobileBottomComponents`（移动端底部组件没有 `position` 字段）：

```typescript title="src/config/sidebarConfig.ts" ins={4}
mobileBottomComponents: [
    // ...
    {
        type: "yearProgress",
        enable: true,
        showOnPostPage: false,
    },
]
```

## 六、实现要点

### 数字是怎么"被填满"的

每个数字的填充靠 `background-clip: text` + 一段水平渐变：文字本身设为透明，用背景渐变的分界线当作"进度线"，分界线左侧是亮色、右侧是灰色，视觉上就像数字被液体注入一样。

分界线位置由自定义属性 `--yp-progress` 控制，而它能参与动画的关键在文件顶部的这行注册：

```css
@property --yp-progress {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}
```

CSS 自定义属性默认是字符串，keyframes 里从 `0` 到目标值的过渡只会"啪"一下跳变；用 `@property` 注册成 `<number>` 类型后，浏览器才能逐帧插值，渐变分界线随之平滑移动。

### 揭幕动画

舞台初始是 `clip-path: inset(0 100% 0 0)`（完全裁掉），等脚本算好进度、写入 `--progress-target` 之后再给它加上 `is-ready` 类，触发 1.2s 的两段动画：舞台从左到右擦入，同时每个数字从 0 填充到各自的目标进度。这样无论构建时的静态初始值是什么，用户看到的永远是正确的进度和完整的入场动画。

### 进度计算与刷新

进度全部在客户端计算，静态博客不用担心构建时间久了数据失真：

- 年进度 = 今年已过天数 ÷ 全年天数（闰年 366 天），下一年固定 0%
- 月进度：已过月份 100%，当前月按 日期 ÷ 当月天数，未来月份 0%
- 定时器对齐到次日零点刷新，跨天、跨月、跨年都能自动更新
- 监听 `astro:page-load`，swup 无感翻页后重新初始化

### 主题适配

配色全部基于主题的 `--hue` 和 `--radius-large` 变量，站点换主题色时组件会跟着变；暗色模式单独调整了填充色与背景色的亮度对比。

## 七、相关文件

组件：[/src/components/widget/YearProgress.astro](https://github.com/muyudada/firefly-yuan/blob/master/src/components/widget/YearProgress.astro)

相关源码：[muyudada/firefly-yuan](https://github.com/muyudada/firefly-yuan)

## 🔗 最后

感谢[毛の博客](https://blog.huchao.vip/)的原始设计。复刻过程中最有意思的是 `@property` 这个细节——一个不起眼的注册就能把"跳变"变成"流动"。如果你想调整填充方向（比如改成从下往上）、字号或配色，改对应的 CSS 变量和渐变角度即可。
