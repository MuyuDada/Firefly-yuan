// folia-web 用 framer-motion 的 spring(stiffness 200, damping 20) 驱动词的放大/位移。
// Firefly 不引入 framer-motion：这里把该弹簧的位置-时间曲线采样成 CSS linear() 缓动，
// 供 transition 使用。参数与 glowWordVariants.ts 的 active 弹簧一致。

// 弹簧微分方程 x'' = -k(x - 1) - c·x'，k=200、c=20、x0=0、v0=0，
// 解析解 x(t) = 1 - e^(-ζω t)(cos(ωd t) + (ζω/ωd)·sin(ωd t))。
const STIFFNESS = 200;
const DAMPING = 20;
const MASS = 1;

const omega = Math.sqrt(STIFFNESS / MASS);
const zeta = DAMPING / (2 * Math.sqrt(STIFFNESS * MASS));
const omegaD = omega * Math.sqrt(1 - zeta * zeta);

const positionAt = (t: number) => {
	const decay = Math.exp(-zeta * omega * t);
	return (
		1 -
		decay *
			(Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
	);
};

/** 采样弹簧曲线并序列化为 CSS linear() 缓动（归一化时长 0..1）。 */
const buildSpringLinear = (settleSeconds: number, steps: number): string => {
	const points: string[] = [];
	for (let i = 0; i <= steps; i += 1) {
		const t = (i / steps) * settleSeconds;
		const progress = Math.max(0, Math.min(1.15, positionAt(t)));
		// linear() 的控制点按等时间距排列，只给进度值即可。
		points.push(`${(progress * 100).toFixed(3)}%`);
	}
	return `linear(${points.join(", ")})`;
};

// 采样约 1.1 秒（弹簧在 ~0.4s 进入 ±1% 邻域，尾部留足余量）。
export const FOLIA_SPRING_EASING: string = buildSpringLinear(1.1, 40);
