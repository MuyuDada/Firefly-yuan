import type {
	ClickParticleConfig,
	CursorConfig,
	FairyDustConfig,
	InputFireConfig,
	SakuraConfig,
} from "../types/effectsConfig";

// 特效配置 - 集中管理所有动画特效

export const sakuraConfig: SakuraConfig = {
	// 是否启用樱花特效
	enable: false,

	// 樱花数量
	sakuraNum: 21,

	// 樱花越界限制次数，-1为无限循环
	limitTimes: -1,

	// 樱花尺寸
	size: {
		// 樱花最小尺寸倍数
		min: 0.5,
		// 樱花最大尺寸倍数
		max: 1.1,
	},

	// 樱花不透明度
	opacity: {
		// 樱花最小不透明度
		min: 0.3,
		// 樱花最大不透明度
		max: 0.9,
	},

	// 樱花移动速度
	speed: {
		// 水平移动
		horizontal: {
			// 水平移动速度最小值
			min: -1.7,
			// 水平移动速度最大值
			max: -1.2,
		},
		// 垂直移动
		vertical: {
			// 垂直移动速度最小值
			min: 1.5,
			// 垂直移动速度最大值
			max: 2.2,
		},
		// 旋转速度
		rotation: 0.03,
		// 消失速度，不应大于最小不透明度
		fadeSpeed: 0.03,
	},

	// 层级，确保樱花在合适的层级显示
	zIndex: 100,
};

// 自定义光标（跟随鼠标的缓动圆点）
export const cursorConfig: CursorConfig = {
	// 是否启用自定义光标
	enable: true,

	// 光标直径（px）
	size: 20,

	// 光标颜色
	color: "rgb(57, 197, 187)",

	// 静止时的不透明度
	opacity: 0.25,

	// 悬停在可点击元素上时的不透明度
	hoverOpacity: 0.1,

	// 悬停在可点击元素上时的缩放倍数
	hoverScale: 2.5,

	// 按下时的不透明度
	activeOpacity: 0.5,

	// 按下时的缩放倍数
	activeScale: 0.5,

	// 缓动跟随系数，0~1，越大跟随越紧
	lerpFactor: 0.15,

	// 层级，需高于页面内容但低于点击粒子
	zIndex: 10086,

	// 原生光标处理方式：dot 用半透明小圆点替换，none 完全隐藏，default 保留
	// 选 dot 的好处是即使 JS 未执行或执行失败，用户仍能看到一个可见光标
	nativeCursor: "dot",
};

// 点击粒子特效（单击/长按迸发彩色小球）
export const clickParticleConfig: ClickParticleConfig = {
	// 是否启用点击粒子特效
	enable: true,

	// 粒子配色
	colors: ["#F73859", "#14FFEC", "#00E0FF", "#FF99FE", "#FAF15D"],

	// 单击产生的粒子数量
	count: {
		min: 10,
		max: 20,
	},

	// 长按产生的粒子数量与初速度
	longPress: {
		// 判定为长按的时长（ms）
		delay: 500,
		count: {
			min: 50,
			max: 100,
		},
		speed: {
			min: 14,
			max: 15,
		},
	},

	// 单击粒子的初速度
	speed: {
		min: 6,
		max: 12,
	},

	// 粒子半径
	radius: {
		min: 8,
		max: 12,
		// 每帧半径衰减量
		shrink: 0.3,
	},

	// 每帧速度衰减系数
	friction: 0.9,

	// 层级，粒子需盖在光标之上
	zIndex: 99999,
};

// 星尘拖尾特效（鼠标移动时洒落的星形粒子）
export const fairyDustConfig: FairyDustConfig = {
	// 是否启用星尘拖尾特效
	enable: false,

	// 星尘配色
	colors: ["#D61C59", "#E7D84B", "#1B8798"],

	// 星尘使用的字符
	glyph: "*",

	// 字符字号（px）
	fontSize: 21,

	// 星尘存活帧数
	lifeSpan: {
		min: 60,
		max: 90,
	},

	// 星尘运动参数
	velocity: {
		x: 0.5,
		y: {
			min: 0.9,
			max: 1.6,
		},
		gravity: 0.02,
	},

	// 触发新星尘的最小移动距离（px），避免停留时反复生成
	minDistance: 1.5,

	// 层级
	zIndex: 99998,
};

// 输入火焰特效（在输入框打字时从光标位置迸出粒子）
export const inputFireConfig: InputFireConfig = {
	// 是否启用输入火焰特效
	enable: true,

	// 是否使用随机彩色，false 时取输入框文字颜色
	colorful: true,

	// 输入时是否轻微抖动页面（关闭以免影响阅读）
	shake: false,

	// 每次输入产生的粒子数量
	count: {
		min: 5,
		max: 15,
	},

	// 粒子存活帧数
	frames: 120,

	// 粒子运动参数
	velocity: {
		x: 1,
		y: {
			min: -3.5,
			max: -1.5,
		},
		gravity: 0.075,
	},

	// 每帧透明度衰减系数
	alphaDecay: 0.96,

	// 粒子边长（px）
	size: 3,

	// 层级，需盖住所有页面元素
	zIndex: 999999,
};
