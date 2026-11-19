/// <reference types="mdast" />
import { h } from "hastscript";

/**
 * 实况照片组件（Markdown 指令）
 *
 * 用法：`::livephoto{photo="静图地址" video="视频地址"}`
 * 由静图 + 3 秒左右的静音短视频组成：默认显示静图，悬停 / 长按播放视频。
 *
 * @param {Object} properties - 指令属性
 * @param {string} properties.photo - 静图地址（必填）
 * @param {string} properties.video - 视频地址，建议 mp4(h264)（必填）
 * @param {string} [properties.alt] - 无障碍描述
 * @param {string} [properties.ratio] - 容器宽高比，如 "4/3"，留空按图片原始比例
 * @param {import('mdast').RootContent[]} children
 * @returns {import('mdast').Parent}
 */
export function LivePhotoComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0) {
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("livephoto" must be leaf type "::livephoto{photo="..." video="..."}")',
		]);
	}

	const photo = String(properties?.photo ?? "").trim();
	const video = String(properties?.video ?? "").trim();
	const isUrl = (v) => /^https?:\/\//.test(v) || v.startsWith("/");

	if (!isUrl(photo) || !isUrl(video)) {
		return h("div", { class: "hidden" }, [
			'Invalid livephoto. ("photo" and "video" must be absolute or root-relative URLs)',
		]);
	}

	const alt = String(properties?.alt ?? "").trim() || "实况照片";
	const ratio = String(properties?.ratio ?? "").trim();

	return h(
		"figure",
		{
			class: "live-photo",
			"data-live-photo": "true",
			...(ratio ? { style: `--lp-ratio: ${ratio}` } : {}),
		},
		[
			h("img", {
				class: "lp-poster",
				src: photo,
				alt,
				loading: "lazy",
				decoding: "async",
			}),
			h("video", {
				class: "lp-video",
				src: video,
				muted: true,
				playsinline: true,
				loop: true,
				preload: "none",
				"aria-hidden": "true",
				tabindex: -1,
			}),
			h("span", { class: "lp-badge", "aria-hidden": "true" }, ["LIVE"]),
			h("span", { class: "lp-hint", "aria-hidden": "true" }, ["长按或悬停播放"]),
		],
	);
}
