/**
 * Cloudflare Workers 运行时类型的最小声明。
 *
 * 为什么不用 `@cloudflare/workers-types`：本目录不在根 tsconfig 的 include 里
 * （只有 `src/**` + `scripts/**`），为了一个 Worker 单独装一整个类型包、再拉一份
 * node_modules，代价不划算。这里只声明实际用到的几个 API，真机部署时完全兼容。
 *
 * 本文件没有任何 import/export，所以下面的声明是全局的。
 */

/** KV 的 list 返回项 */
interface KVListKey {
	name: string;
	expiration?: number;
	metadata?: unknown;
}

/** KV list 结果 */
interface KVListResult {
	keys: KVListKey[];
	list_complete: boolean;
	cursor?: string;
}

/** 只声明用到的方法 */
interface KVNamespace {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl?: number; metadata?: unknown },
	): Promise<void>;
	delete(key: string): Promise<void>;
	list(options?: {
		prefix?: string;
		limit?: number;
		cursor?: string;
	}): Promise<KVListResult>;
}

/** 模块默认导出（Worker 入口）的形状 */
interface ExportedHandler<EnvType = unknown> {
	fetch(
		request: Request,
		env: EnvType,
		ctx?: ExecutionContext,
	): Response | Promise<Response>;
	/** cron 触发（wrangler.jsonc 的 triggers.crons） */
	scheduled?(
		controller: ScheduledController,
		env: EnvType,
		ctx: ExecutionContext,
	): void | Promise<void>;
}

/** cron 触发器上下文 */
interface ScheduledController {
	scheduledTime: number;
	cron: string;
}

/** Worker 的 execution context：waitUntil 用来把慢活挪到响应之后 */
interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}
