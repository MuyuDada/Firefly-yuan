/**
 * 解析器自测：拿线上真实的 6 条申请评论跑一遍，检查字段是否被正确抽出。
 * 用法：npx tsx workers/friends-hook/test-parse.ts
 */
import { findMissing, parseApplication } from "./src/parse";

const samples: { label: string; html: string }[] = [
	{
		label: "真实 #1 名称/URL/头像/简介（无冒号，Waline 自动加 a 标签）",
		html: `<p>申请友链<br>\n名称 Zhong Website<br>\nURL <a href="https://zhongweb.cn" target="_blank" rel="ugc nofollow noreferrer noopener">https://zhongweb.cn</a><br>\n头像 <a href="https://zhongweb.cn/icons/icon-512.png" target="_blank" rel="ugc nofollow noreferrer noopener">https://zhongweb.cn/icons/icon-512.png</a><br>\n简介 医学生×互联网折腾爱好者</p>\n`,
	},
	{
		label: "真实 #2 标准模板",
		html: `<p>站点名称：玻璃瓶和纸飞机<br>站点描述：专注于个人搞笑和后端开发<br>站点链接：<a href="https://www.sunandyou.cn">https://www.sunandyou.cn</a><br>头像链接：<a href="https://www.sunandyou.cn/img/logo-B3KTxsD8.png">https://www.sunandyou.cn/img/logo-B3KTxsD8.png</a></p>`,
	},
	{
		label: "真实 #3 模板 + 邮箱",
		html: `<p>站点名称：O7statの小窝<br>站点描述：记录学习，分享笔记。<br>站点链接：<a href="https://hello123.fun">https://hello123.fun</a><br>头像链接：<a href="https://hello123.fun/media/covers/7c3f3f24d4ff4aee8cba04f9f3762369.webp">https://hello123.fun/media/covers/7c3f3f24d4ff4aee8cba04f9f3762369.webp</a><br>邮箱：hi@hello123.fun</p>`,
	},
	{
		label: "真实 #4 全角冒号 + 昵称行",
		html: `<p>站点名称：LonelyBingの小窝<br>站点描述：一名普普通通の大学生~<br>站点链接：<a href="https://lonelybing.top">https://lonelybing.top</a><br>头像链接：<a href="https://img.lonelybing.top/file/头像/1789400498937.jpg">https://img.lonelybing.top/file/头像/1789400498937.jpg</a></p>`,
	},
	{
		label: "脏数据：挤在一行 + 等号分隔 + 英文键",
		html: "<p>name=测试站 desc=一个测试站 url=https://example.com avatar=https://example.com/a.png email=me@example.com</p>",
	},
	{
		label: "脏数据：只有链接，没有字段名",
		html: "<p>https://only-link.example.com</p><p>随便写点东西</p>",
	},
];

let failed = 0;
for (const { label, html } of samples) {
	const { parsed, unparsed } = parseApplication(html);
	const missing = findMissing(parsed);
	console.log(`\n=== ${label}`);
	console.log(JSON.stringify(parsed, null, 2));
	if (unparsed.length) console.log("未识别行:", unparsed);
	console.log("缺失:", missing.length ? missing.join("、") : "(无)");

	// 前四条是真实数据，必须完整解析
	if (label.startsWith("真实") && missing.length > 0) {
		console.error("!! 真实样本应完整解析，却缺字段");
		failed++;
	}
}

console.log(
	failed === 0
		? "\nOK: 全部真实样本解析完整"
		: `\nFAILED: ${failed} 个样本不完整`,
);
process.exit(failed === 0 ? 0 : 1);
