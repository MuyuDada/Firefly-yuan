/**
 * 存储层：所有数据放在一个 KV namespace 里。
 *
 * 键设计（前缀区分，便于 list 与人工排查）：
 *   app:<id>        一条申请记录（FriendApplication 的 JSON）
 *   dup:<host>      已通过的站点 host → 记录 id，用于查重
 *   pend:<host>     待审的站点 host → 记录 id，用于「同一站点重复投递」提醒
 *   link:<host>     已通过的友链（用于 /api/links 输出）
 *
 * KV 免费额度：读 10 万/天、写 1 千/天、总量 1 GB。本站量级远远用不完。
 * 注意同一 key 的写入频率上限是 1 次/秒 —— 友链申请不可能到这个量级。
 */

import { normalizeSiteUrl } from "./parse";
import type { FriendApplication, ParsedApplication } from "./types";

const APP_PREFIX = "app:";
const DUP_PREFIX = "dup:";
const PEND_PREFIX = "pend:";
const LINK_PREFIX = "link:";

/** 已通过审核、对外公开的友链 */
export interface PublicLink extends ParsedApplication {
	/** 记录 id */
	id: string;
	/** 通过审核的时间 */
	approvedAt: string;
}

/** 写入一条申请记录 */
export async function saveApplication(
	kv: KVNamespace,
	app: FriendApplication,
): Promise<void> {
	await kv.put(APP_PREFIX + app.id, JSON.stringify(app));
	// 待审站点登记一个 pend: 键，让同一站点再次提交时能被认出来。
	// 只登记 pending 的：一旦审核（通过或拒绝）就该由 dup: 接管，否则被拒的站点
	// 会一直背着「疑似重复」的标记。
	const host = normalizeSiteUrl(app.parsed.siteurl);
	if (host) {
		if (app.status === "pending") {
			await kv.put(PEND_PREFIX + host, app.id);
		} else {
			await kv.delete(PEND_PREFIX + host);
		}
	}
}

/** 读取一条申请记录 */
export async function getApplication(
	kv: KVNamespace,
	id: string,
): Promise<FriendApplication | null> {
	const raw = await kv.get(APP_PREFIX + id);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as FriendApplication;
	} catch {
		return null;
	}
}

/** 列出全部申请记录，按收到时间倒序 */
export async function listApplications(
	kv: KVNamespace,
): Promise<FriendApplication[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await kv.list({ prefix: APP_PREFIX, limit: 1000, cursor });
		for (const key of page.keys) keys.push(key.name);
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);

	const apps = await Promise.all(keys.map((key) => kv.get(key)));
	return apps
		.map((raw) => {
			if (!raw) return null;
			try {
				return JSON.parse(raw) as FriendApplication;
			} catch {
				return null;
			}
		})
		.filter((app): app is FriendApplication => app !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 查重：这个站点是否已经申请过（待审）或已在友链列表里（已通过）。
 *
 * 两个键都要看：`dup:` 只有审核通过才写，所以光查它会漏掉「同一站点连投两次」——
 * 那种情况下审核页会出现两条一模一样的待审记录。
 */
export async function findDuplicate(
	kv: KVNamespace,
	siteurl: string,
): Promise<string | undefined> {
	const host = normalizeSiteUrl(siteurl);
	if (!host) return undefined;
	const approved = await kv.get(DUP_PREFIX + host);
	if (approved) return approved;
	const pending = await kv.get(PEND_PREFIX + host);
	return pending ?? undefined;
}

/** 审核通过：写入公开友链、登记查重键 */
export async function approveApplication(
	kv: KVNamespace,
	app: FriendApplication,
	note: string,
): Promise<FriendApplication> {
	const approvedAt = new Date().toISOString();
	const updated: FriendApplication = {
		...app,
		status: "approved",
		reviewNote: note,
		reviewedAt: approvedAt,
	};
	await saveApplication(kv, updated);

	const publicLink: PublicLink = {
		...updated.parsed,
		id: updated.id,
		approvedAt,
	};
	await kv.put(
		LINK_PREFIX + normalizeSiteUrl(updated.parsed.siteurl),
		JSON.stringify(publicLink),
	);
	await kv.put(
		DUP_PREFIX + normalizeSiteUrl(updated.parsed.siteurl),
		updated.id,
	);
	return updated;
}

/** 审核拒绝 */
export async function rejectApplication(
	kv: KVNamespace,
	app: FriendApplication,
	note: string,
): Promise<FriendApplication> {
	const updated: FriendApplication = {
		...app,
		status: "rejected",
		reviewNote: note,
		reviewedAt: new Date().toISOString(),
	};
	await saveApplication(kv, updated);
	return updated;
}

/** 读取全部已通过的友链，按通过时间倒序 */
export async function listPublicLinks(kv: KVNamespace): Promise<PublicLink[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await kv.list({ prefix: LINK_PREFIX, limit: 1000, cursor });
		for (const key of page.keys) keys.push(key.name);
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);

	const rows = await Promise.all(keys.map((key) => kv.get(key)));
	return rows
		.map((raw) => {
			if (!raw) return null;
			try {
				return JSON.parse(raw) as PublicLink;
			} catch {
				return null;
			}
		})
		.filter((link): link is PublicLink => link !== null)
		.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
}
