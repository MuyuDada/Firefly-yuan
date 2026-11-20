---
title: "Astro 里动态插入的 DOM，为什么一条样式都吃不到"
published: 2026-11-19
draft: false
pinned: false
description: "给天气组件加了几个区块后，图标突然裸奔、深色模式下文字发黑。排查发现 Astro 的 scoped CSS 会编译成 [data-astro-cid-xxx] 属性选择器，而脚本用 innerHTML 插入的元素没有这个属性，整块样式直接失效。顺带记录了另一个「看起来是 bug 其实是数据源不存在」的问题：天气接口不返回 uv、没有降水概率、部分扩展字段还要额外参数才给。"
image: "api"
tags:
  - Astro
  - CSS
  - 调试
  - 踩坑
category: "前端开发"
aiSummary: "Astro 的 <style> 默认是组件作用域的，编译后会变成 .class[data-astro-cid-xxxx] 这种属性选择器。模板里写的元素会自动带上该属性，但脚本用 innerHTML / insertAdjacentHTML 动态插入的元素没有，于是这些元素的样式整条失效——表现是图标没有尺寸和配色、深色模式下文字仍是深色。解决办法是把动态内容的选择器写成 :global()，要注意 :global(html.dark) .foo 仍然带作用域，正确写法是 :global(html.dark .foo)。文章同时记录了天气接口的三个「假 bug」：顶层不返回 uv（真实数据在 life_indices.uv.level）、任何位置都没有降水概率 pop、以及 feels_like / visibility / cloud / precipitation 只有带 minutely=true 才返回。"
series: "Astro 前端笔记"
---

上周给博客的天气组件加了几个区块：未来三天预报、24 小时横向滚动条、生活指数。数据都渲染出来了，但界面很难看——图标是浏览器默认大小，没有颜色，深色模式下文字黑得几乎看不见。

一开始以为是新增的 CSS 写错了。查了半天，最后发现问题根本不在 CSS，而在**这些元素根本没有被 CSS 选中**。

## 一、现象：数据对了，样式全丢

先把现象列清楚：

- 3 天预报有数据，但图标巨大、没有颜色
- 24 小时的方块挤成一团，没有间距
- 生活指数是纯文字堆叠
- 切到深色模式，这些区域的文字仍然是深色，等于看不见

而同一张卡片里，**原有的区域（风力、能见度、气压）一切正常**。

这个对比很关键：同样在组件里、同样一个 `<style>` 块，为什么旧的生效、新的失效？

差别只有一个：**旧的是模板里写死的 HTML，新的是脚本用 `innerHTML` 插进去的**。

## 二、去线上 CSS 里找答案

直接抓线上编译后的样式：

```bash
curl -s https://你的域名/_astro/MainGridLayout.XXXX.css
```

搜索组件里的类名，看到的是：

```css
.extended-item[data-astro-cid-wbfed4q5]{border-radius:.5rem;align-items:center;...}
```

注意那个 `[data-astro-cid-wbfed4q5]`。

再看页面 HTML，模板里的元素长这样：

```html
<div class="extended-item" data-astro-cid-wbfed4q5>
```

**模板元素自动带上了这个属性，动态插入的元素没有。**

所以选择器 `[data-astro-cid-wbfed4q5]` 匹配不到脚本创建的那些 `<div class="forecast-row">`，整条规则就落空了。

## 三、原理：Astro 的 scoped CSS

Astro 的 `<style>` 默认是**组件作用域**的。编译时它会给选择器加上一个哈希属性，同时给模板里的元素也加上同一个属性，从而实现"这些样式只作用于这个组件"。

这件事平时是透明的，因为模板元素和样式是一起生成的。但只要元素的**创建时机**晚于编译（比如运行时 `innerHTML`），它就漏掉了属性。

同样会踩坑的写法：

```js
container.innerHTML = "<div class=\"forecast-row\">...</div>";
container.insertAdjacentHTML("beforeend", "...");
element.append(createEl()); // createEl 内部 document.createElement
```

以及所有"框架在客户端渲染出来的 DOM"——只要你在这个 `.astro` 组件的 `<style>` 里写了针对它们的规则，就匹配不上。

## 四、解法：`:global()`，但有个括号陷阱

Astro 提供 `:global()` 跳过作用域处理。把动态元素的规则包起来：

```css
/* 改之前：编译成 .forecast-row[data-astro-cid-xxx]，匹配不到 */
.forecast-row {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr) auto;
}

/* 改之后：原样输出，能匹配 */
:global(.forecast-row) {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr) auto;
}
```

静态容器不用改，保留作用域更安全：

```css
/* 这个 div 在模板里，正常命中 */
.forecast-list {
  display: flex;
  flex-direction: column;
}

/* 里面的行是动态插入的，必须 global */
:global(.forecast-row) { ... }
```

### 陷阱：`dark` 要写进括号里

我最初给深色模式这么写：

```css
/* ❌ 错误 */
:global(html.dark) .forecast-week {
  color: #f5f5f5;
}
```

编译结果大致是：

```css
html.dark .forecast-week[data-astro-cid-xxx] { ... }
```

`:global()` 只跳过了它括号里的部分，**括号外面的 `.forecast-week` 依然带作用域**，所以照样不生效。

正确写法是把整个选择器放进括号：

```css
/* ✅ 正确 */
:global(html.dark .forecast-week) {
  color: #f5f5f5;
}
```

这个细节很容易漏，尤其是你只测了亮色模式的时候——亮色下文字本来就该是深色，看着"正常"，一切到暗色才发现。

## 五、怎么验证

改完之后不能只看代码，得看真实渲染。因为 Astro 的 scope 处理发生在构建时，光读源码看不出对错。

我的验证方式：临时建一个只放这个组件的页面，300px 宽（等于侧边栏实际宽度），跑真实接口，亮色和暗色各截一张图。

```astro
---
import Weather from "@/components/widget/Weather.astro";
---
<html class={dark ? "dark" : ""}>
  <body>
    <div style="width: 300px">
      <Weather adcode="130600" city="保定" />
    </div>
  </body>
</html>
```

比在完整页面里翻找快得多，也不会被其它样式干扰。验证完删掉就行。

另一个更轻量的检查方式：抓线上 CSS，确认动态元素的选择器**不再带** `[data-astro-cid-...]`。

## 六、同一次排查里的三个"假 bug"

改这个组件时还遇到另一类问题：界面显示 `--`，看起来像代码 bug，其实是**数据压根不存在**。

调接口把原始返回打出来，对着字段名核，结论是这样：

### 1. 紫外线：字段在别的地方

组件读的是顶层 `uv`，但接口返回里根本没有这个字段：

```json
{
  "temperature": 1,
  "humidity": 24,
  "pressure": 1024,
  "aqi": 25,
  "air_pollutants": { ... }
}
```

真实的紫外线数据藏在生活指数里：

```json
{
  "life_indices": {
    "uv": {
      "level": "高",
      "brief": "较强",
      "advice": "紫外线较强，减少10-14点户外活动，涂抹SPF30+防晒霜"
    }
  }
}
```

注意它是**文字等级**，不是 0–11 的数字。所以渲染逻辑要能两种都接：有数字显示数字，没有就显示等级。

### 2. 降水概率：这个字段真的不存在

`forecast` 里每天只有：

```
date, week, temp_max, temp_min, weather_day, weather_night,
wind_dir_day, wind_dir_night, wind_scale_day, wind_scale_night,
sunrise, sunset
```

`hourly` 每小时只有：

```
time, temperature, weather, wind_direction, wind_speed, wind_scale
```

**没有任何 `pop`（probability of precipitation）。** 这跟代码写没写对无关，是数据源就没提供。

那怎么办？接口里有另一份数据可以用：分钟级降水（`minutely_precip`），24 条 × 5 分钟，每条带 `precip` 降水量。把它累加，就得到"未来 2 小时降水量"——虽然不等于概率，但是真实存在、对用户也有意义的信息。

所以那一格从「降水概率 `--%`」改成了「2 小时降水 `0.0mm`」。

### 3. 扩展字段需要额外参数

这个最反直觉。只带 `extended=true` 时，`feels_like`、`visibility`、`cloud`、`precipitation` 四个字段**全都没有**。

实测不同参数组合：

| 参数 | 扩展字段 |
|---|---|
| `extended=true` | ❌ 无 |
| `extended=true&hourly=true` | ❌ 无 |
| `extended=true&forecast=true&minutely=true` | ✅ 有 |
| `extended=true&indices=true` | ❌ 无 |

也就是说这四个字段是被 `minutely=true` 顺带激活的。原组件只请求 `extended+forecast`，所以体感温度、能见度、云量、降水量长期显示 `--`，一直没人发现——因为 `--` 看起来像"暂时没取到"，不像"字段不存在"。

加上 `minutely` 之后它们才有值。

## 七、小结

这次排查有两条经验值得记下来：

**第一，界面异常先分清"数据没来"还是"样式没来"。**
样式问题往往是整块失效（尺寸、颜色、间距全丢），数据问题通常是单个数值变成占位符。两者的排查路径完全不同。

**第二，在 Astro 里，凡是"运行时才存在的元素"，样式一律考虑 `:global()`。**
包括 `innerHTML`、`insertAdjacentHTML`、客户端渲染的第三方组件、动态创建的自定义元素。写的时候多问一句：这个 DOM 是编译时就有，还是运行时才有？

那个 `:global(html.dark) .foo` 的括号位置，我建议直接记成结论：**dark 和类名必须一起放进括号**。省得下次再踩。
