export type SakuraConfig = {
	enable: boolean; // 是否启用樱花特效
	sakuraNum: number; // 樱花数量，默认21
	limitTimes: number; // 樱花越界限制次数，-1为无限循环
	size: {
		min: number; // 樱花最小尺寸倍数
		max: number; // 樱花最大尺寸倍数
	};
	opacity: {
		min: number; // 樱花最小不透明度
		max: number; // 樱花最大不透明度
	};
	speed: {
		horizontal: {
			min: number; // 水平移动速度最小值
			max: number; // 水平移动速度最大值
		};
		vertical: {
			min: number; // 垂直移动速度最小值
			max: number; // 垂直移动速度最大值
		};
		rotation: number; // 旋转速度
		fadeSpeed: number; // 消失速度，不应大于最小不透明度
	};
	zIndex: number; // 层级，确保樱花在合适的层级显示
};

// 系统原生光标的替代方式
// dot: 用一枚半透明小圆点替换（JS 未加载时也能看到光标，默认）
// none: 完全隐藏原生光标，只保留自定义光标
// default: 保留系统默认光标（会与自定义光标同时出现，一般仅用于调试）
export type NativeCursorMode = "dot" | "none" | "default";

export type CursorConfig = {
	enable: boolean; // 是否启用自定义光标
	size: number; // 光标直径（px）
	color: string; // 光标颜色
	opacity: number; // 静止时的不透明度
	hoverOpacity: number; // 悬停在可点击元素上时的不透明度
	hoverScale: number; // 悬停在可点击元素上时的缩放倍数
	activeOpacity: number; // 按下时的不透明度
	activeScale: number; // 按下时的缩放倍数
	lerpFactor: number; // 缓动跟随系数，0~1，越大跟随越紧
	zIndex: number; // 层级
	nativeCursor: NativeCursorMode; // 原生光标处理方式
};

export type ClickParticleConfig = {
	enable: boolean; // 是否启用点击粒子特效
	colors: string[]; // 粒子配色
	count: {
		min: number; // 单击产生的最少粒子数
		max: number; // 单击产生的最多粒子数
	};
	longPress: {
		delay: number; // 判定为长按的时长（ms）
		count: {
			min: number; // 长按产生的最少粒子数
			max: number; // 长按产生的最多粒子数
		};
		speed: {
			min: number; // 长按粒子的最小初速度
			max: number; // 长按粒子的最大初速度
		};
	};
	speed: {
		min: number; // 单击粒子的最小初速度
		max: number; // 单击粒子的最大初速度
	};
	radius: {
		min: number; // 粒子最小半径
		max: number; // 粒子最大半径
		shrink: number; // 每帧半径衰减量
	};
	friction: number; // 每帧速度衰减系数
	zIndex: number; // 层级
};

export type FairyDustConfig = {
	enable: boolean; // 是否启用星尘拖尾特效
	colors: string[]; // 星尘配色
	glyph: string; // 星尘使用的字符
	fontSize: number; // 字符字号（px）
	lifeSpan: {
		min: number; // 最短存活帧数
		max: number; // 最长存活帧数
	};
	velocity: {
		x: number; // 水平初速度最大绝对值（正负随机）
		y: {
			min: number; // 垂直初速度最小值
			max: number; // 垂直初速度最大值
		};
		gravity: number; // 每帧垂直加速度
	};
	minDistance: number; // 触发新星尘的最小移动距离（px）
	zIndex: number; // 层级
};

export type InputFireConfig = {
	enable: boolean; // 是否启用输入火焰特效
	colorful: boolean; // 是否使用随机彩色，false 时取输入框文字颜色
	shake: boolean; // 输入时是否轻微抖动页面
	count: {
		min: number; // 每次输入产生的最少粒子数
		max: number; // 每次输入产生的最多粒子数
	};
	frames: number; // 粒子存活帧数
	velocity: {
		x: number; // 水平初速度最大绝对值（正负随机）
		y: {
			min: number; // 垂直初速度最小值
			max: number; // 垂直初速度最大值
		};
		gravity: number; // 每帧垂直加速度
	};
	alphaDecay: number; // 每帧透明度衰减系数
	size: number; // 粒子边长（px）
	zIndex: number; // 层级
};
