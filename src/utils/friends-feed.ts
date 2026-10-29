import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sanitizeHtml from "sanitize-html";
import { siteConfig } from "@/config";
import type { FriendLink } from "@/types/friendsConfig";
import { getSortedPostsList } from "@/utils/content-utils";
import { formatDateToYYYYMMDD } from "@/utils/date-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";

// 朋友圈 / 友链动态数据层
//
// 移植自 Aemeath（https://github.com/Jarvis0227/Aemeath）的 src/utils/friends-feed.ts，
// 做了三处适配：
// 1. 友链站点配置来自本仓库的 friendsConfig（FriendLink 增加了可选的 rss 字段）
// 2. 本站自己的文章直接读 content collection，不必依赖线上 RSS
// 3. 增加 friendsFeedConfig 开关与并发/超时等可调项

/** 单条友链更新 */
export interface FriendFeedItem {
	friendTitle: string;
	friendUrl: string;
	avatar: string;
	title: string;
	link: string;
	description: string;
	publishedAt: Date | null;
	feedUrl: string;
}

/** 聚合结果 */
export interface FriendsFeedSnapshot {
	items: FriendFeedItem[];
	sources: Array<{
		title: string;
		friendUrl: string;
		feedUrl: string;
		feedUrls?: string[];
		itemCount: number;
		stale: boolean;
	}>;
	checkedCount: number;
	freshSources: number;
	staleSources: number;
}

interface FeedDocument {
	url: string;
	text: string;
}

interface ParsedFeedItem {
	title: string;
	link: string;
	description: string;
	publishedAt: Date | null;
}

interface FeedRecord {
	friend: FriendLink;
	feedUrls: string[];
	items: ParsedFeedItem[];
	stale: boolean;
}

interface StoredFeedItem {
	title: string;
	link: string;
	description: string;
	publishedAt: string | null;
}

interface StoredFeedRecord {
	friendUrl: string;
	feedUrl: string;
	feedUrls?: string[];
	items: StoredFeedItem[];
}

interface StoredFeedSnapshot {
	version: 1 | 2;
	sources: StoredFeedRecord[];
}

interface FriendsFeedOptions {
	/** 单次请求超时（毫秒） */
	timeoutMs?: number;
	/** 失败重试次数 */
	retries?: number;
	/** 同时抓取的友链数量 */
	concurrency?: number;
	/** 每个友链最多取几条 */
	maxItemsPerFriend?: number;
	/** 是否只读快照、不发网络请求 */
	cachedOnly?: boolean;
}

// 这些是可调项的默认值，页面侧可以按需覆盖
const DEFAULTS = {
	timeoutMs: 8000,
	retries: 3,
	concurrency: 5,
	maxItemsPerFriend: 6,
} as const;

const RETRY_DELAY_MS = 350;
const MAX_FEED_LENGTH = 1_500_000;
const SNAPSHOT_FILE = join(
	process.cwd(),
	"src/data/friends-feed-snapshot.json",
);
const DEFAULT_FEED_PATHS = [
	"rss.xml",
	"feed.xml",
	"feed/",
	"atom.xml",
	"index.xml",
	"?feed=rss2",
];

/** 归一化站点地址：去掉协议、www 前缀与尾部斜杠，用于跨源匹配 */
function normalizeSiteUrl(url: string): string {
	return url
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/\/+$/, "")
		.toLowerCase();
}

function decodeXmlEntities(value: string): string {
	const namedEntities: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: '"',
	};

	return value.replace(
		/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
		(_, entity: string) => {
			const normalized = entity.toLowerCase();
			if (normalized.startsWith("#x")) {
				return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
			}
			if (normalized.startsWith("#")) {
				return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
			}
			return namedEntities[normalized] ?? `&${entity};`;
		},
	);
}

/** 去掉 CDATA、脚本样式与全部 HTML 标签，得到纯文本摘要 */
function cleanText(value: string): string {
	const withoutCdata = value
		.replace(/^\s*<!\[CDATA\[/i, "")
		.replace(/\]\]>\s*$/i, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "");
	const sanitized = sanitizeHtml(withoutCdata, {
		allowedTags: [],
		allowedAttributes: {},
	});
	return decodeXmlEntities(sanitized).replace(/\s+/g, " ").trim();
}

function extractTag(block: string, names: string[]): string {
	for (const name of names) {
		const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const match = block.match(
			new RegExp(
				`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}>`,
				"i",
			),
		);
		if (match?.[1]) return match[1];
	}
	return "";
}

function extractAttribute(tag: string, name: string): string {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = tag.match(
		new RegExp(`${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"),
	);
	return match?.[1] ? decodeXmlEntities(match[1]) : "";
}

function resolveUrl(value: string, baseUrl: string): string {
	try {
		return new URL(decodeXmlEntities(value.trim()), baseUrl).href;
	} catch {
		return "";
	}
}

function parseDate(value: string): Date | null {
	if (!value.trim()) return null;
	const parsed = new Date(cleanText(value));
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractItemLink(block: string, baseUrl: string): string {
	const linkTags = Array.from(block.matchAll(/<link\b[^>]*>/gi));
	for (const match of linkTags) {
		const tag = match[0];
		const href = extractAttribute(tag, "href");
		const rel = extractAttribute(tag, "rel").toLowerCase();
		if (href && rel !== "self") return resolveUrl(href, baseUrl);
	}

	const textLink = extractTag(block, ["link"]);
	if (textLink) return resolveUrl(cleanText(textLink), baseUrl);

	const guid = extractTag(block, ["guid", "id"]);
	return guid ? resolveUrl(cleanText(guid), baseUrl) : "";
}

/** 同时兼容 RSS 的 <item> 与 Atom 的 <entry> */
function parseFeed(text: string, baseUrl: string): ParsedFeedItem[] {
	const blocks = Array.from(
		text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi),
	).map((match) => match[2]);

	return blocks
		.map((block) => {
			const title = cleanText(extractTag(block, ["title"]));
			const link = extractItemLink(block, baseUrl);
			const description = cleanText(
				extractTag(block, [
					"description",
					"summary",
					"content:encoded",
					"content",
				]),
			).slice(0, 320);
			const publishedAt = parseDate(
				extractTag(block, ["pubDate", "published", "updated", "date"]),
			);

			return { title, link, description, publishedAt };
		})
		.filter((item) => item.title && item.link);
}

async function readSnapshot(): Promise<
	Map<string, { feedUrls: string[]; items: ParsedFeedItem[] }>
> {
	try {
		const raw = await readFile(SNAPSHOT_FILE, "utf8");
		const parsed = JSON.parse(raw) as Partial<StoredFeedSnapshot>;
		if (
			![1, 2].includes(parsed.version ?? 0) ||
			!Array.isArray(parsed.sources)
		) {
			return new Map();
		}

		return new Map(
			parsed.sources
				.filter(
					(source): source is StoredFeedRecord =>
						typeof source?.friendUrl === "string" &&
						typeof source.feedUrl === "string" &&
						Array.isArray(source.items),
				)
				.map((source) => [
					normalizeSiteUrl(source.friendUrl),
					{
						feedUrls: [
							...(Array.isArray(source.feedUrls) ? source.feedUrls : []),
							...(source.feedUrl ? [source.feedUrl] : []),
						].filter((url, index, urls) => url && urls.indexOf(url) === index),
						items: source.items
							.map((item) => ({
								title: String(item.title ?? "").trim(),
								link: String(item.link ?? "").trim(),
								description: String(item.description ?? "").trim(),
								publishedAt: item.publishedAt
									? parseDate(item.publishedAt)
									: null,
							}))
							.filter((item) => item.title && item.link),
					},
				]),
		);
	} catch {
		return new Map();
	}
}

/**
 * 把本次抓取结果写回快照，供下次抓取失败时兜底。
 * 只有显式设置环境变量 FRIENDS_FEED_WRITE_SNAPSHOT=1 时才写，
 * 避免本地 dev 反复改动仓库里的文件。
 */
async function writeSnapshot(records: FeedRecord[]): Promise<void> {
	if (process.env.FRIENDS_FEED_WRITE_SNAPSHOT !== "1") return;

	const payload: StoredFeedSnapshot = {
		version: 2,
		sources: records
			.filter((record) => record.feedUrls.length > 0 && record.items.length > 0)
			.map((record) => ({
				friendUrl: record.friend.siteurl,
				feedUrl: record.feedUrls[0],
				feedUrls: record.feedUrls,
				items: record.items.map((item) => ({
					title: item.title,
					link: item.link,
					description: item.description,
					publishedAt: item.publishedAt?.toISOString() ?? null,
				})),
			})),
	};
	const serialized = `${JSON.stringify(payload, null, 2)}\n`;

	let previous = "";
	try {
		previous = await readFile(SNAPSHOT_FILE, "utf8");
	} catch {
		// 首次刷新时快照文件还不存在
	}
	if (previous === serialized) return;

	await mkdir(dirname(SNAPSHOT_FILE), { recursive: true });
	await writeFile(SNAPSHOT_FILE, serialized, "utf8");
}

async function fetchText(
	url: string,
	accept: string,
	options: Required<Pick<FriendsFeedOptions, "timeoutMs" | "retries">>,
): Promise<FeedDocument | null> {
	for (let attempt = 1; attempt <= options.retries; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
		try {
			const response = await fetch(url, {
				signal: controller.signal,
				redirect: "follow",
				headers: {
					Accept: accept,
					"Cache-Control": "no-cache",
					"User-Agent": `Firefly-Moments/1.0 (+${siteConfig.site_url}/)`,
				},
			});
			if (response.ok) {
				const text = await response.text();
				return {
					url: response.url || url,
					text: text.slice(0, MAX_FEED_LENGTH),
				};
			}

			const retryable =
				response.status === 408 ||
				response.status === 425 ||
				response.status === 429 ||
				response.status >= 500;
			if (!retryable) return null;
		} catch {
			// 网络错误与超时在下面重试，全部失败后回退到上次快照
		} finally {
			clearTimeout(timeout);
		}

		if (attempt < options.retries) {
			await new Promise((resolve) =>
				setTimeout(resolve, RETRY_DELAY_MS * attempt),
			);
		}
	}

	return null;
}

/** 首页 HTML 里的 <link rel="alternate" type="application/rss+xml"> 兜底探测 */
function findAlternateFeedUrls(html: string, siteUrl: string): string[] {
	const urls: string[] = [];
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		const rel = extractAttribute(tag, "rel").toLowerCase();
		const type = extractAttribute(tag, "type").toLowerCase();
		const href = extractAttribute(tag, "href");
		if (!href || !rel.split(/\s+/).includes("alternate")) continue;
		if (
			type.includes("rss") ||
			type.includes("atom") ||
			href.toLowerCase().match(/(?:rss|atom|feed|\.xml)/)
		) {
			const resolved = resolveUrl(href, siteUrl);
			if (resolved) urls.push(resolved);
		}
	}
	return [...new Set(urls)];
}

async function tryFeedUrls(
	urls: string[],
	options: Required<Pick<FriendsFeedOptions, "timeoutMs" | "retries">>,
): Promise<{ documents: FeedDocument[]; items: ParsedFeedItem[] } | null> {
	const results = await Promise.all(
		urls.map(async (url) => {
			const document = await fetchText(
				url,
				"application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
				options,
			);
			if (!document) return null;
			const items = parseFeed(document.text, document.url);
			return items.length > 0 ? { document, items } : null;
		}),
	);
	const successful = results.filter(
		(result): result is { document: FeedDocument; items: ParsedFeedItem[] } =>
			result !== null,
	);
	if (successful.length === 0) return null;

	const seenLinks = new Set<string>();
	const items: ParsedFeedItem[] = [];
	for (const result of successful) {
		for (const item of result.items) {
			if (seenLinks.has(item.link)) continue;
			seenLinks.add(item.link);
			items.push(item);
		}
	}

	return {
		documents: successful.map((result) => result.document),
		items,
	};
}

async function discoverFriendFeed(
	friend: FriendLink,
	options: Required<Pick<FriendsFeedOptions, "timeoutMs" | "retries">>,
) {
	// 配置里手填了 rss 就优先用它，否则按常见路径猜测
	const explicitUrls = friend.rss
		? (Array.isArray(friend.rss) ? friend.rss : [friend.rss])
				.map((feedUrl) => resolveUrl(feedUrl, friend.siteurl))
				.filter(Boolean)
		: [];

	const directCandidates = explicitUrls.length
		? explicitUrls
		: DEFAULT_FEED_PATHS.map((path) => resolveUrl(path, friend.siteurl));
	const directResult = await tryFeedUrls(
		[...new Set(directCandidates)],
		options,
	);
	if (directResult) return directResult;

	const homepage = await fetchText(
		friend.siteurl,
		"text/html, application/xhtml+xml;q=0.9",
		options,
	);
	if (!homepage) return null;
	const alternateUrls = findAlternateFeedUrls(homepage.text, homepage.url);
	return alternateUrls.length > 0 ? tryFeedUrls(alternateUrls, options) : null;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await task(items[index]);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => worker()),
	);
	return results;
}

async function refreshFriendsFeed(
	friends: FriendLink[],
	options: FriendsFeedOptions,
): Promise<FriendsFeedSnapshot> {
	const resolved = {
		timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
		retries: options.retries ?? DEFAULTS.retries,
		concurrency: options.concurrency ?? DEFAULTS.concurrency,
		maxItemsPerFriend: options.maxItemsPerFriend ?? DEFAULTS.maxItemsPerFriend,
		cachedOnly: options.cachedOnly ?? false,
	};
	const previousSnapshot = await readSnapshot();
	// 按「日历日期」过滤未来文章：构建当天的文章全部保留，
	// 只有日期晚于构建当天的才隐藏，避免误伤当天稍晚发布的文章。
	const todayKey = formatDateToYYYYMMDD(new Date());
	const records = await mapWithConcurrency<FriendLink, FeedRecord>(
		friends,
		resolved.concurrency,
		async (friend) => {
			// 本站用自己的文章列表，不依赖线上 RSS（线上可能还留着已删除的文章）
			if (
				normalizeSiteUrl(friend.siteurl) ===
				normalizeSiteUrl(siteConfig.site_url)
			) {
				const posts = await getSortedPostsList();
				return {
					friend,
					feedUrls: [new URL("rss.xml", siteConfig.site_url).href],
					items: posts.slice(0, resolved.maxItemsPerFriend).map((post) => ({
						title: post.data.title,
						link: new URL(getPostUrlBySlug(post.id), siteConfig.site_url).href,
						description: cleanText(post.data.description ?? ""),
						publishedAt: post.data.published,
					})),
					stale: false,
				};
			}
			const result = resolved.cachedOnly
				? null
				: await discoverFriendFeed(friend, {
						timeoutMs: resolved.timeoutMs,
						retries: resolved.retries,
					});
			if (result) {
				return {
					friend,
					feedUrls: result.documents.map((document) => document.url),
					items: result.items.slice(0, resolved.maxItemsPerFriend),
					stale: false,
				};
			}

			const cached = previousSnapshot.get(normalizeSiteUrl(friend.siteurl));
			if (cached?.items.length) {
				return {
					friend,
					feedUrls: cached.feedUrls,
					items: cached.items.slice(0, resolved.maxItemsPerFriend),
					stale: true,
				};
			}

			return { friend, feedUrls: [], items: [], stale: false };
		},
	);

	const seenLinks = new Set<string>();
	const items: FriendFeedItem[] = [];
	for (const record of records) {
		if (record.feedUrls.length === 0) continue;
		for (const item of record.items) {
			if (
				item.publishedAt &&
				formatDateToYYYYMMDD(item.publishedAt) > todayKey
			) {
				continue;
			}
			if (seenLinks.has(item.link)) continue;
			seenLinks.add(item.link);
			items.push({
				friendTitle: record.friend.title,
				friendUrl: record.friend.siteurl,
				avatar: record.friend.imgurl,
				title: item.title,
				link: item.link,
				description: item.description,
				publishedAt: item.publishedAt,
				feedUrl: record.feedUrls[0],
			});
		}
	}

	items.sort(
		(a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
	);

	if (!resolved.cachedOnly) await writeSnapshot(records);

	const sources = records
		.filter((record) => record.feedUrls.length > 0)
		.map((record) => ({
			title: record.friend.title,
			friendUrl: record.friend.siteurl,
			feedUrl: record.feedUrls[0],
			feedUrls: record.feedUrls,
			itemCount: record.items.length,
			stale: record.stale,
		}));

	return {
		items,
		sources,
		checkedCount: friends.length,
		freshSources: sources.filter((source) => !source.stale).length,
		staleSources: sources.filter((source) => source.stale).length,
	};
}

// 友链卡片与朋友圈页面共用同一次抓取，包括进行中的请求
const feedLoads = new Map<
	string,
	{ expiresAt: number; result: Promise<FriendsFeedSnapshot> }
>();

/** 拉取友链最新文章（带 5 分钟进程内缓存） */
export function loadFriendsFeed(
	friends: FriendLink[],
	options: FriendsFeedOptions = {},
): Promise<FriendsFeedSnapshot> {
	const key = `${Boolean(options.cachedOnly)}:${JSON.stringify(
		friends.map((friend) => [
			friend.siteurl,
			friend.rss,
			friend.title,
			friend.imgurl,
		]),
	)}`;
	const now = Date.now();
	for (const [cachedKey, cached] of feedLoads) {
		if (cached.expiresAt <= now) feedLoads.delete(cachedKey);
	}
	const existing = feedLoads.get(key);
	if (existing) return existing.result;
	const result = refreshFriendsFeed(friends, options).catch((error) => {
		feedLoads.delete(key);
		throw error;
	});
	feedLoads.set(key, { expiresAt: now + 5 * 60_000, result });
	return result;
}
