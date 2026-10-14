// 用 Chrome DevTools Protocol 驱动真实浏览器，端到端验证友链申请向导。
// 用法：node cdp-friends-test.mjs <pageUrl> <apiBase>
// 依赖：Node >= 22（自带全局 WebSocket）、本机 Chrome。

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGE_URL = process.argv[2] || "http://localhost:4401/friends/";
const API_BASE = process.argv[3] || "http://127.0.0.1:8797";
const PORT = 9223;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const profile = mkdtempSync(join(tmpdir(), "cdp-friends-"));
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
	// 连的是 /json/new 给的页面级 WebSocket，消息里不能带 sessionId
	// （那是浏览器级连接经 Target.attachToTarget 才需要的）。
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

	// 页面里 data-apply-api 配的是线上 Worker，本地测试要把它指向本地 wrangler dev。
	// 必须在文档脚本执行前打补丁 —— initWizard 在 boot() 时就把地址读进闭包了，
	// 事后改 DOM 属性已经来不及。
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source: `(() => {
      const LOCAL = ${JSON.stringify(API_BASE)};
      const original = window.fetch.bind(window);
      window.__apiPatched = true;
      window.__apiRewritten = false;
      window.fetch = (input, init) => {
        try {
          const url = typeof input === "string" ? input : (input && input.url) || String(input);
          if (/^https?:\\/\\/friends-hook\\.muyudada\\.dpdns\\.org/.test(url)) {
            window.__apiRewritten = true;
            return original(url.replace(/^https?:\\/\\/friends-hook\\.muyudada\\.dpdns\\.org/, LOCAL), init);
          }
        } catch (e) {}
        return original(input, init);
      };
    })();`,
	});

	await send("Page.navigate", { url: PAGE_URL });

	for (let i = 0; i < 90; i++) {
		const ready = await evaluate(
			"document.readyState === 'complete' && !!document.querySelector('friend-rules-modal')",
		);
		if (ready) break;
		await sleep(500);
	}

	check(
		"fetch 补丁已注入",
		(await evaluate("window.__apiPatched === true")) === true,
	);
	check(
		"页面渲染出向导结构",
		(await evaluate(
			"!!document.querySelector('[data-modal-root] [data-wizard]')",
		)) === true,
	);

	const apiAttr = await evaluate(
		"document.querySelector('friend-rules-modal').dataset.applyApi",
	);
	check("data-apply-api 已注入", !!apiAttr, apiAttr);

	const state = async () =>
		evaluate(`(() => {
      const w = document.querySelector('[data-modal-root] [data-wizard]');
      const vis = (sel) => { const el = w.querySelector(sel); return el ? !el.hidden : null; };
      const steps = {};
      w.querySelectorAll('[data-wizard-step]').forEach((el) => { steps[el.dataset.wizardStep] = !el.hidden; });
      const q = w.querySelector('[data-captcha-question]');
      const st = w.querySelector('[data-form-status]');
      return {
        steps,
        prev: vis('[data-wizard-prev]'),
        next: vis('[data-wizard-next]'),
        submit: vis('[data-wizard-submit]'),
        activeDot: w.querySelector('.friend-wizard-dots .is-active')?.dataset.dot ?? null,
        captcha: q ? q.textContent.trim() : null,
        captchaState: q ? q.dataset.state : null,
        status: st && !st.hidden ? st.textContent : null,
        done: w.querySelector('[data-done-message]')?.textContent?.trim() ?? null,
      };
    })()`);

	// ── 打开弹窗 ────────────────────────────────
	await evaluate(
		"document.querySelector('friend-rules-modal [data-modal-open]').click()",
	);
	await sleep(400);

	let s = await state();
	check(
		"打开后停在「注意事项」",
		s.steps.notice === true && s.steps.self === false,
		JSON.stringify(s.steps),
	);
	check("第一步隐藏「上一步」", s.prev === false);
	check("第一步显示「下一步」", s.next === true);
	check("第一步隐藏「提交」", s.submit === false);
	check("步骤指示高亮第 1 个", s.activeDot === "notice", String(s.activeDot));

	// ── 第二步 ──────────────────────────────────
	await evaluate(
		"document.querySelector('[data-modal-root] [data-wizard-next]').click()",
	);
	await sleep(300);
	s = await state();
	check(
		"点下一步进入「本站信息」",
		s.steps.self === true && s.steps.notice === false,
		JSON.stringify(s.steps),
	);
	check("第二步出现「上一步」", s.prev === true);
	check("第二步高亮第 2 个", s.activeDot === "self", String(s.activeDot));

	// ── 第三步：进表单才取验证码 ──────────────────
	await evaluate(
		"document.querySelector('[data-modal-root] [data-wizard-next]').click()",
	);
	await sleep(300);
	s = await state();
	check(
		"再点下一步进入「申请表单」",
		s.steps.form === true && s.steps.self === false,
		JSON.stringify(s.steps),
	);
	check(
		"第三步显示「提交」并隐藏「下一步」",
		s.submit === true && s.next === false,
	);
	check("第三步高亮第 3 个", s.activeDot === "form", String(s.activeDot));

	for (let i = 0; i < 30; i++) {
		s = await state();
		if (s.captchaState === "ready" || s.captchaState === "error") break;
		await sleep(400);
	}
	check(
		"验证码题目已取到",
		s.captchaState === "ready",
		`state=${s.captchaState} text=${s.captcha}`,
	);

	if (s.captchaState === "ready") {
		// 先测「填错验证码」的路径
		await evaluate(`(() => {
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#friend-form-name', 'CDP 测试站');
      set('#friend-form-url', 'https://cdp-test.example.com');
      set('#friend-form-avatar', 'https://cdp-test.example.com/a.png');
      set('#friend-form-desc', 'CDP 端到端测试');
      set('#friend-form-email', 'cdp@cdp-test.example.com');
      set('#friend-form-captcha', '999999');
    })()`);
		await evaluate(
			"document.querySelector('[data-modal-root] [data-wizard-submit]').click()",
		);
		let wrongStatus = null;
		for (let i = 0; i < 30; i++) {
			await sleep(400);
			const st = await state();
			if (st.status) {
				wrongStatus = st.status;
				break;
			}
		}
		check(
			"答错验证码显示错误提示",
			!!wrongStatus && wrongStatus.includes("验证码"),
			String(wrongStatus),
		);

		// 错误后应自动换一道新题
		let fresh = null;
		for (let i = 0; i < 30; i++) {
			fresh = await state();
			if (fresh.captchaState === "ready" && fresh.captcha !== s.captcha) break;
			await sleep(400);
		}
		check(
			"失败后自动换了一道新题",
			fresh?.captchaState === "ready" && fresh.captcha !== s.captcha,
			`${s.captcha} -> ${fresh?.captcha}`,
		);

		const answer2 = await evaluate(`(() => {
      const t = document.querySelector('[data-modal-root] [data-captcha-question]').textContent;
      const m = t.match(/(\\d+)\\s*([+\\-x*])\\s*(\\d+)/);
      if (!m) return null;
      const a = Number(m[1]), b = Number(m[3]);
      return String(m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b);
    })()`);
		await evaluate(`(() => {
      const el = document.querySelector('#friend-form-captcha');
      el.value = ${JSON.stringify(String(answer2))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
		await evaluate(
			"document.querySelector('[data-modal-root] [data-wizard-submit]').click()",
		);

		let final = null;
		for (let i = 0; i < 40; i++) {
			await sleep(500);
			const st = await state();
			if (st.steps.done === true) {
				final = { kind: "done", text: st.done };
				break;
			}
			if (st.status) {
				final = { kind: "error", text: st.status };
				break;
			}
		}
		check(
			"重新作答后提交成功并进入成功页",
			final?.kind === "done",
			final ? JSON.stringify(final) : "超时无响应",
		);
	}

	// ── 重新打开应回到第一步 ──────────────────────
	// 注意：弹窗打开时 [data-modal-root] 会被搬到 document.body 上，
	// 所以关闭按钮必须用 [data-modal-root] 打头，不能再挂在 friend-rules-modal 下。
	await evaluate(
		"document.querySelector('[data-modal-root] [data-modal-close]').click()",
	);
	await sleep(300);
	await evaluate(
		"document.querySelector('friend-rules-modal [data-modal-open]').click()",
	);
	await sleep(400);
	s = await state();
	check(
		"重新打开回到第一步",
		s.steps.notice === true && s.steps.done === false,
		JSON.stringify(s.steps),
	);

	// ── 关闭按钮 ────────────────────────────────
	await evaluate(
		"document.querySelector('[data-modal-root] [data-modal-close]').click()",
	);
	await sleep(300);
	const closed = await evaluate(
		"document.querySelector('[data-modal-root]').hidden === true && !document.body.classList.contains('friend-modal-open')",
	);
	check("点关闭后弹窗隐藏且解除滚动锁", closed === true);

	check(
		"页面无控制台错误",
		consoleErrors.length === 0,
		consoleErrors.slice(0, 3).join(" | "),
	);
} catch (err) {
	console.error(`\n异常：${err.message}`);
	check("测试未抛异常", false, err.message);
} finally {
	try {
		ws?.close();
	} catch {}
	chrome.kill();
	await sleep(500);
	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {}

	const failed = results.filter((r) => !r.ok);
	console.log(
		`\n结果：${results.length - failed.length}/${results.length} 通过`,
	);
	if (failed.length) {
		console.log("失败项：");
		for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
	}
	process.exit(failed.length ? 1 : 0);
}
