export type ProfileConfig = {
	avatar?: string;
	/** 头像后方渐隐的背景图（留空时自动用头像本身） */
	banner?: string;
	name: string;
	bio?: string;
	links: {
		name: string;
		url: string;
		icon: string;
		showName?: boolean;
	}[];
};
