/**
 * 友链自助申请接收端 —— 共享类型
 */

/** Cloudflare 原生发信绑定（wrangler 的 send_email） */
export interface EmailBinding {
	send(message: {
		from: string;
		to: string;
		subject: string;
		html?: string;
		text?: string;
	}): Promise<{ messageId?: string }>;
}

/** Worker 运行时绑定与环境变量 */
export interface Env {
	/** 待审 / 已通过申请的存储 */
	FRIENDS_KV: KVNamespace;
	/** 管理页与审核接口的口令（用 `wrangler secret put ADMIN_TOKEN` 设置） */
	ADMIN_TOKEN: string;
	/** 本站地址，用于反链检测。例：https://muyudada.dpdns.org */
	SITE_URL: string;
	/** 本站名称，仅用于展示 */
	SITE_NAME: string;
	/** 友链页面路径，只有发到这个路径的评论才会被处理。例：/friends/ */
	APPLY_PATH: string;
	/** Waline 服务地址，用于二次核验评论真实存在。例：https://comment.muyudada.dpdns.org */
	WALINE_SERVER: string;
	/** 是否向 Waline 二次核验评论存在（"1" 开启，"0" 关闭，默认开启） */
	VERIFY_COMMENT?: string;
	/** 反链检测超时（毫秒），默认 5000 */
	BACKLINK_TIMEOUT_MS?: string;
	/** 是否开启站内表单申请（POST /apply）。"0" 关闭，默认开启 */
	ENABLE_FORM?: string;
	/** 一个 IP 每天最多领几道验证码，默认 30 */
	CAPTCHA_PER_DAY?: string;
	/** 一个 IP 每天最多提交几次申请，默认 5 */
	APPLY_PER_DAY?: string;

	// ── 邮件通知 ──────────────────────────────────────────
	/** 博主邮箱，接收新申请通知。不填则不发通知 */
	ADMIN_EMAIL?: string;
	/**
	 * 发件地址，必须是已校验的域名。例：
	 * `Muyu 小窝 <noreply@muyudada.dpdns.org>`
	 * 与 RESEND_API_KEY / EMAIL 绑定任一同时存在时才会发信
	 */
	MAIL_FROM?: string;
	/** Resend API Key（用 `wrangler secret put RESEND_API_KEY` 设置） */
	RESEND_API_KEY?: string;
	/** Cloudflare 原生发信绑定（wrangler.jsonc 里的 send_email） */
	EMAIL?: EmailBinding;
	/** 审核页完整地址，邮件里「去审核」跳转用 */
	ADMIN_URL?: string;
	/** 设为 "0" 关闭新申请通知 */
	NOTIFY_ON_APPLY?: string;
	/** 设为 "0" 关闭审核结果通知（通过 / 拒绝都会发） */
	NOTIFY_ON_REVIEW?: string;

	/** 设为 "0" 关闭「审核后自动去评论区回复」 */
	ENABLE_WALINE_REPLY?: string;
	/** 自动回复用的昵称，默认「友链助手」 */
	WALINE_REPLY_NICK?: string;
}

/** 从申请文本中解析出的字段 */
export interface ParsedApplication {
	/** 站点名称 */
	name: string;
	/** 站点描述 */
	desc: string;
	/** 站点链接 */
	siteurl: string;
	/** 头像链接 */
	avatar: string;
	/** 邮箱（可选） */
	email: string;
}

/** 反链检测结果 */
export interface BacklinkResult {
	/** 是否在对方站点上找到了本站链接 */
	ok: boolean;
	/** 实际检测过的地址（用于人工复核） */
	checkedUrl: string;
	/** 说明信息，例如 "未找到" / "无法访问" */
	note: string;
}

/** 一条待审 / 已通过的申请记录 */
export interface FriendApplication {
	/** 记录 id，取自 Waline 评论的 objectId */
	id: string;
	/** 收到时间（ISO 8601） */
	createdAt: string;
	/** 申请人昵称（Waline 提供） */
	nick: string;
	/** 申请人站点（Waline 的 link 字段，通常为空） */
	link: string;
	/** 原始评论 HTML，保留以便人工核对 */
	raw: string;
	/** 解析结果 */
	parsed: ParsedApplication;
	/** 解析时无法识别的行，供人工核对 */
	unparsed: string[];
	/** 必填字段是否齐全 */
	complete: boolean;
	/** 缺失的必填字段名 */
	missing: string[];
	/** 反链检测结果 */
	backlink: BacklinkResult;
	/** 审核状态 */
	status: "pending" | "approved" | "rejected";
	/** 与已有友链重复时，指向已存在的站点地址 */
	duplicateOf?: string;
	/** 审核意见 */
	reviewNote?: string;
	/** 审核时间 */
	reviewedAt?: string;
}
