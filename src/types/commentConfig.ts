/**
 * Waline 表情预设地址（指向含 info.json 的目录）。
 * 远程预设用完整 URL，本站自托管的表情包用 `/emoji/xxx` 这样的站内路径。
 */
export type WalineEmojiPreset = string;

export type CommentConfig = {
	/**
	 * 当前启用的评论系统类型
	 * "none" | "twikoo" | "waline" | "giscus" | "disqus" | 'artalk'
	 */
	type: "none" | "twikoo" | "waline" | "giscus" | "disqus" | "artalk";
	twikoo?: {
		envId: string;
		region?: string;
		lang?: string;
		visitorCount?: boolean;
		/**
		 * Twikoo JS 文件地址，支持 CDN 链接
		 * 国内推荐: https://registry.npmmirror.com/twikoo/1.7.9/files/dist/twikoo.min.js
		 * 国际推荐: https://cdn.jsdelivr.net/npm/twikoo@1.7.9/dist/twikoo.min.js
		 */
		jsUrl?: string;
		/**
		 * Twikoo 自定义 CSS 文件地址，为空则不加载
		 */
		cssUrl?: string;
	};
	waline?: {
		serverURL: string;
		lang?: string;
		/**
		 * 表情预设。字符串走 Waline 的 info.json 约定；
		 * 对象则内联配置，可以指向任意支持 `${folder}/${prefix}${name}.${type}`
		 * 结构的远程目录（用于没有 info.json 的资源站）。
		 */
		emoji: WalineEmojiPreset[];
		login?: "enable" | "force" | "disable";
		visitorCount?: boolean; // 是否统计访问量，true 启用访问量，false 关闭
		/**
		 * 评论必填项，对应 Waline 的 requiredMeta。
		 * 可选值：[] / ["nick"] / ["nick", "mail"]，默认 []
		 */
		requiredMeta?: ("nick" | "mail" | "link")[];
		/**
		 * 覆盖 Waline 的界面文案，只写想改的键即可（其余沿用语言包）。
		 * 常用：nick / mail（输入框占位文字）、placeholder（评论框占位文字）。
		 */
		locale?: Record<string, string>;
		/**
		 * 图片上传配置。
		 *
		 * Waline 默认把图片转成 base64 直接塞进正文，而 wordLimit 统计的是
		 * 「词数」——base64 里的 + / 会把长串切碎，128KB 的图就要算 5400 词，
		 * 300 词上限下根本发不出去。
		 *
		 * 开启后改为：图片压缩成 WebP 暂存，正文里只写短标记 #wl-img-N，
		 * 提交瞬间再展开成完整数据。编辑框保持干净，词数也不受影响。
		 */
		imageUpload?: {
			/** 是否启用，默认 true */
			enabled?: boolean;
			/** 原图体积上限（MB），默认 10 */
			maxSizeMB?: number;
			/** 压缩后最长边（px），默认 1600 */
			maxSide?: number;
			/** WebP 画质 0–1，默认 0.82 */
			quality?: number;
			/** 压缩目标体积（KB），超过则继续降质，默认 300 */
			maxOutputKB?: number;
		};
	};
	artalk?: {
		// 后端程序 API 地址
		server: string;
		/**
		 * 语言，支持语言如下：
		 * - "en" (English)
		 * - "zh-CN" (简体中文)
		 * - "zh-TW" (繁体中文)
		 * - "ja" (日本語)
		 * - "ko" (한국어)
		 * - "fr" (Français)
		 * - "ru" (Русский)
		 * */
		locale: string | "auto";
		// 是否统计访问量，true 启用访问量，false 关闭
		visitorCount?: boolean;
	};
	giscus?: {
		repo: string;
		repoId: string;
		category: string;
		categoryId: string;
		mapping: string;
		strict: string;
		reactionsEnabled: string;
		emitMetadata: string;
		inputPosition: string;
		lang: string;
		loading: string;
	};
	disqus?: {
		shortname: string;
	};
};
