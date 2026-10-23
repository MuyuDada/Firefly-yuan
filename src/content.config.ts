import { defineCollection } from "astro:content";
import type { CollectionConfig } from "astro/content/config";
import { glob } from "astro/loaders";
import { type ZodType, z } from "astro/zod";

type PostData = {
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	image: string;
	tags: string[];
	category: string | null;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	password: string;
	passwordHint: string;
	series: string;
	seriesOrder?: number;
	prevTitle: string;
	prevSlug: string;
	nextTitle: string;
	nextSlug: string;
};

type DynamicData = {
	published: Date;
	pinned: boolean;
	location: string;
};

type ProjectLink = {
	label: string;
	icon: string;
	value: string;
};

type ProjectData = {
	title: string;
	published: Date;
	draft: boolean;
	order?: number;
	description: string;
	image: string;
	tags: string[];
	link: ProjectLink[];
	status: string;
	lang: string;
};

type ZiyuanData = {
	title: string;
	quotes: {
		text: string;
		author: string;
	}[];
};

type PlaceData = {
	name: string;
	date: Date;
	endDate?: Date;
	province: string;
	city: string;
	district: string;
	experience: string;
	visitCount: number;
	category: string;
	lat?: number;
	lng?: number;
	images: string[];
	link: string;
};

type ContentCollection<T> = CollectionConfig<
	ZodType<T>,
	ReturnType<typeof glob>
>;

const postsCollection: ContentCollection<PostData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		author: z.string().optional().default(""),
		sourceLink: z.string().optional().default(""),
		licenseName: z.string().optional().default(""),
		licenseUrl: z.string().optional().default(""),
		comment: z.boolean().optional().default(true),
		password: z.string().optional().default(""),
		passwordHint: z.string().optional().default(""),
		series: z.string().optional().default(""),
		seriesOrder: z.number().optional(),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});

const specCollection: ContentCollection<Record<string, never>> =
	defineCollection({
		loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/spec" }),
		schema: z.object({}),
	});

const dynamicCollection: ContentCollection<DynamicData> = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/dynamic" }),
	schema: z.object({
		published: z.date(),
		pinned: z.boolean().optional().default(false),
		location: z.string().optional().default(""),
	}),
});

const ziyuanCollection: ContentCollection<ZiyuanData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/ziyuan" }),
	schema: z.object({
		title: z.string().optional().default(""),
		quotes: z
			.array(
				z.object({
					text: z.string(),
					author: z.string().optional().default(""),
				}),
			)
			.optional()
			.default([]),
	}),
});

// 足迹地图：一个 md 记一个去过的地方（src/content/places/）
const placesCollection: ContentCollection<PlaceData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/places" }),
	schema: z.object({
		/** 具体地点名，如「大唐不夜城」；不填则依次回落 区/市/省 */
		name: z.string().optional().default(""),
		date: z.coerce.date(),
		endDate: z.coerce.date().optional(),
		province: z.string(),
		city: z.string().optional().default(""),
		district: z.string().optional().default(""),
		/** 经历文案，也参与分类推断 */
		experience: z.string().optional().default(""),
		/** 到访次数，影响点位数字与统计 */
		visitCount: z.number().optional().default(1),
		/** 分类（学校 / 工作 / 旅游 …），不填则按经历文案推断 */
		category: z.string().optional().default(""),
		/** 精确坐标（高德 GCJ-02），不填则用省市中心兜底 */
		lat: z.number().optional(),
		lng: z.number().optional(),
		/** 足迹照片，点击点位时轮播展示 */
		images: z.array(z.string()).optional().default([]),
		/** 可选外链，如对应游记文章 */
		link: z.string().optional().default(""),
	}),
});

const projectsCollection: ContentCollection<ProjectData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		draft: z.boolean().optional().default(false),
		order: z.number().optional(),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		link: z
			.array(
				z.object({
					label: z.string(),
					icon: z.string().optional().default(""),
					value: z.string(),
				}),
			)
			.optional()
			.default([]),
		status: z.string().optional().default(""),
		lang: z.string().optional().default(""),
	}),
});

export const collections: {
	dynamic: typeof dynamicCollection;
	posts: typeof postsCollection;
	spec: typeof specCollection;
	ziyuan: typeof ziyuanCollection;
	projects: typeof projectsCollection;
	places: typeof placesCollection;
} = {
	dynamic: dynamicCollection,
	posts: postsCollection,
	spec: specCollection,
	ziyuan: ziyuanCollection,
	projects: projectsCollection,
	places: placesCollection,
};
