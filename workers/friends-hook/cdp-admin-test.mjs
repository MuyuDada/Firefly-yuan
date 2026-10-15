// 用 Chrome DevTools Protocol 驱动真实浏览器，验证友链审核页的筛选 / 搜索 / 审核交互。
// 用法：node cdp-admin-test.mjs <adminUrl> [screenshotPath]
// 依赖：Node >= 22（自带全局 WebSocket）、本机 Chrome。

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_URL =
	process.argv[2] || "http://127.0.0.1:8795/admin?token=test-token-123";
const SHOT = process.argv[3] || join(tmpdir(), "friends-admin.png");
const PORT = 9224;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const profile = mkdtempSync(join(tmpdir(), "cdp-admin-"));
const chrome = spawn(
	CHROME,
	[
		"--headless=new",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--no-proxy-server",
		"--window-size=1280,1400",
		"about:blank",
	],
	{ stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (res.ok) return await res.json();
		} catch {
			// 还没起来
		}
		await sleep(500);
	}
	throw new Error("Chrome DevTools did not come up");
}

const results = [];
function check(name, ok, detail = "") {
	results.push({ name, ok, detail });
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`,
	);
}

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
	const id = nextId++;
	ws.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id);
				reject(new Error(`${method} timed out`));
			}
		}, 30000);
	});
}

async function evaluate(expression) {
	const r = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (r.exceptionDetails) {
		throw new Error(
			r.exceptionDetails.exception?.description ||
				r.exceptionDetails.text ||
				"evaluate threw",
		);
	}
	return r.result?.value;
}

/** 可见卡片数（hidden 的卡片也算在 DOM 里，所以必须按 offsetParent 判可见） */
const VISIBLE_CARDS = `Array.from(document.querySelectorAll('.card')).filter(c => !c.hidden).length`;

try {
	const version = await waitForDevtools();
	console.log(`Chrome: ${version.Browser}`);

	const target = await fetch(
		`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,
		{ method: "PUT" },
	).then((r) => r.json());

	ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});

	ws.addEventListener("message", (event) => {
		const msg = JSON.parse(event.data);
		if (
			msg.method === "Runtime.consoleAPICalled" &&
			msg.params.type === "error"
		) {
			consoleErrors.push(
				msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
			);
		}
		if (msg.method === "Runtime.exceptionThrown") {
			consoleErrors.push(
				msg.params.exceptionDetails?.exception?.description ?? "exception",
			);
		}
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(msg.error.message));
			else resolve(msg.result);
		}
	});

	await send("Runtime.enable");
	await send("Page.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 1400,
		deviceScaleFactor: 2,
		mobile: false,
	});
	await send("Page.navigate", { url: ADMIN_URL });

	for (let i = 0; i < 60; i++) {
		const ready = await evaluate(
			"document.readyState === 'complete' && !!document.querySelector('.card')",
		);
		if (ready) break;
		await sleep(400);
	}

	// ── 结构与默认状态 ──
	check(
		"页面标题含站点名",
		(await evaluate("document.title")).includes("友链审核"),
		await evaluate("document.title"),
	);
	check(
		"顶栏统计渲染出四个数字",
		(await evaluate("document.querySelectorAll('.stats .stat').length")) === 4,
	);
	check(
		"存在待审/已通过/已拒绝/全部 四个 tab",
		(await evaluate("document.querySelectorAll('[data-tab]').length")) === 4,
	);

	const initialTab = await evaluate(
		`document.querySelector('.tab.is-active')?.dataset.tab`,
	);
	check("默认停在「待审」", initialTab === "pending", `实际 ${initialTab}`);

	const pendingCount = await evaluate(
		`document.querySelectorAll('.card[data-status="pending"]').length`,
	);
	const visibleDefault = await evaluate(VISIBLE_CARDS);
	check(
		"默认只显示待审卡片",
		visibleDefault === pendingCount,
		`可见 ${visibleDefault} / 待审 ${pendingCount}`,
	);

	// ── 卡片内容 ──
	check(
		"卡片显示站点名",
		(await evaluate(`!!document.querySelector('.card .head h3')`)) === true,
	);
	check(
		"卡片显示域名而非完整 URL",
		(await evaluate(
			`(document.querySelector('.card .host')?.textContent || '').includes('://')`,
		)) === false,
	);
	check(
		"反链结论渲染在卡片里",
		(await evaluate(
			`(document.querySelector('.card .backlink')?.textContent || '').includes('反链检测')`,
		)) === true,
	);
	check(
		"待审卡片有通过/拒绝按钮与备注输入框",
		(await evaluate(
			`(() => {
        const c = document.querySelector('.card[data-status="pending"]');
        return !!c.querySelector('[data-action="approve"]')
          && !!c.querySelector('[data-action="reject"]')
          && !!c.querySelector('[data-note]');
      })()`,
		)) === true,
	);
	check(
		"已处理卡片不再显示操作按钮",
		(await evaluate(
			`(() => {
        const c = document.querySelector('.card[data-status="rejected"]');
        return !c || !c.querySelector('[data-action]');
      })()`,
		)) === true,
	);

	// ── tab 切换 ──
	await evaluate(
		`document.querySelector('[data-tab="rejected"]').click(); true`,
	);
	await sleep(200);
	const rejectedVisible = await evaluate(VISIBLE_CARDS);
	const rejectedTotal = await evaluate(
		`document.querySelectorAll('.card[data-status="rejected"]').length`,
	);
	check(
		"切到「已拒绝」只剩已拒绝的卡片",
		rejectedVisible === rejectedTotal,
		`可见 ${rejectedVisible} / 共 ${rejectedTotal}`,
	);
	check(
		"tab 高亮跟随切换",
		(await evaluate(
			`document.querySelector('.tab.is-active')?.dataset.tab`,
		)) === "rejected",
	);

	await evaluate(`document.querySelector('[data-tab="all"]').click(); true`);
	await sleep(200);
	const allVisible = await evaluate(VISIBLE_CARDS);
	const allTotal = await evaluate(`document.querySelectorAll('.card').length`);
	check(
		"切到「全部」显示所有卡片",
		allVisible === allTotal,
		`可见 ${allVisible} / 共 ${allTotal}`,
	);

	// ── 搜索 ──
	await evaluate(`(() => {
    const q = document.getElementById('q');
    q.value = 'zhongweb';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
	await sleep(200);
	const searched = await evaluate(VISIBLE_CARDS);
	check(
		"搜索域名能过滤",
		searched >= 1 && searched < allTotal,
		`命中 ${searched}`,
	);

	await evaluate(`(() => {
    const q = document.getElementById('q');
    q.value = 'zzz-not-exist-zzz';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
	await sleep(200);
	check(
		"搜不到时显示空态",
		(await evaluate(`document.getElementById('empty').hidden`)) === false,
	);
	check("搜不到时可见卡片为 0", (await evaluate(VISIBLE_CARDS)) === 0);

	await evaluate(`(() => {
    const q = document.getElementById('q');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-tab="pending"]').click();
    return true;
  })()`);
	await sleep(200);
	check("清空搜索后恢复显示", (await evaluate(VISIBLE_CARDS)) > 0);

	// ── 待上线区 ──
	check(
		"已通过时出现待上线区",
		(await evaluate(`!!document.querySelector('.pending')`)) === true,
	);
	const approvedCount = await evaluate(
		`document.querySelectorAll('.card[data-status="approved"]').length`,
	);
	const pendingRows = await evaluate(
		`document.querySelectorAll('.pending-item').length`,
	);
	check(
		"待上线区每条一个独立行",
		pendingRows === approvedCount,
		`${pendingRows} 行 / ${approvedCount} 条已通过`,
	);
	check(
		"每行有头像、站名、域名",
		(await evaluate(
			`(() => {
        const r = document.querySelector('.pending-item');
        return !!r.querySelector('.avatar')
          && !!(r.querySelector('strong')?.textContent || '').trim()
          && !!(r.querySelector('.host')?.textContent || '').trim();
      })()`,
		)) === true,
	);
	check(
		"每行有独立的复制按钮",
		(await evaluate(
			`document.querySelectorAll('.pending-item [data-copy-entry]').length`,
		)) === pendingRows,
	);
	check(
		"单条复制的片段是合法的 friendsConfig 条目",
		(await evaluate(`(() => {
      const s = document.querySelector('[data-copy-entry]').dataset.snippet || '';
      return s.includes('title:')
        && s.includes('imgurl:')
        && s.includes('siteurl:')
        && s.includes('tags: ["Blog"]')
        && s.includes('enabled: true');
    })()`)) === true,
	);
	check(
		"有「复制全部」按钮",
		(await evaluate(`!!document.getElementById('copy-all')`)) === true,
	);
	check(
		"隐藏的整段片段条数等于待上线行数",
		(await evaluate(
			`(document.getElementById('snippet')?.textContent.match(/title:/g) || []).length`,
		)) === pendingRows,
	);

	// ── 深色模式 ──
	await send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-color-scheme", value: "dark" }],
	});
	await sleep(300);
	const darkBg = await evaluate(
		"getComputedStyle(document.body).backgroundColor",
	);
	check("深色模式生效", darkBg !== "rgb(245, 246, 248)", darkBg);

	// 截图（先滚到顶，保证截到顶栏）
	await evaluate("window.scrollTo(0, 0); true");
	await sleep(300);
	const shot = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
	console.log(`\n截图：${SHOT}`);

	// 单独给「待上线」区截一张，方便肉眼检查排版
	await evaluate(
		`document.querySelector('.pending')?.scrollIntoView({ block: 'center' }); true`,
	);
	await sleep(400);
	const shotPending = await send("Page.captureScreenshot", { format: "png" });
	const pendingPath = SHOT.replace(/\.png$/, "-pending.png");
	writeFileSync(pendingPath, Buffer.from(shotPending.data, "base64"));
	console.log(`待上线区截图：${pendingPath}`);

	// ── 移动端宽度 ──
	await send("Emulation.setDeviceMetricsOverride", {
		width: 390,
		height: 900,
		deviceScaleFactor: 2,
		mobile: true,
	});
	await sleep(400);
	check(
		"窄屏下没有横向溢出",
		(await evaluate(
			"document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1",
		)) === true,
		`scrollWidth=${await evaluate("document.documentElement.scrollWidth")} clientWidth=${await evaluate("document.documentElement.clientWidth")}`,
	);
	const shotMobile = SHOT.replace(/\.png$/, "-mobile.png");
	const shot2 = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(shotMobile, Buffer.from(shot2.data, "base64"));
	console.log(`移动端截图：${shotMobile}`);

	// ── 控制台 ──
	check(
		"无控制台报错",
		consoleErrors.length === 0,
		consoleErrors.slice(0, 2).join(" | "),
	);

	const failed = results.filter((r) => !r.ok).length;
	console.log(
		failed === 0
			? `\nOK: ${results.length} 项断言全部通过`
			: `\nFAILED: ${failed} / ${results.length} 项不通过`,
	);
	process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
	console.error("测试异常：", error);
	process.exitCode = 1;
} finally {
	try {
		ws?.close();
	} catch {}
	chrome.kill();
	await sleep(300);
	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {}
}
