// Ported from folia-web <https://github.com/folia-ce/folia-web> (VisualizerCladdagh 的 useSpring / animate(lineOffset) 等效实现).
// Copyright (C) chthollyphile and folia-ce contributors. AGPL-3.0-or-later.
// Modifications: framer-motion 的 spring 以手写半隐式欧拉积分等效（同一共享时钟循环内推进），
// 替代 folia 的 MotionValue + ring settle 调度（单时钟循环下不再需要跨循环协调）。

// 圆环自转角（弧度）：换行时以 spring(stiffness 55, damping 14, mass 0.9) 转向 target。
// bass / vocal 为音频频段的平滑跟随（folia 的 useSpring(stiffness 150/120, damping 25/24)）。
// 所有 RingLine 与轴线都在每帧读取同一份状态；step() 按帧去重，先到先整合。
export const claddaghRing = {
	offset: 0,
	velocity: 0,
	target: 0,
	bass: 0,
	vocal: 0,
	bassTarget: 0,
	vocalTarget: 0,
	_lastFrame: 0,

	/** 每帧整合一次（同帧重复调用直接跳过）。nowMs 取 performance.now()。 */
	step(nowMs: number): void {
		const frame = Math.floor(nowMs);
		if (frame === this._lastFrame) return;
		const dt =
			this._lastFrame === 0
				? 1 / 60
				: Math.min((frame - this._lastFrame) / 1000, 0.05);
		this._lastFrame = frame;

		// lineOffset spring：k=55, c=14, m=0.9（folia animate(lineOffset) 的参数）
		const k1 = 55;
		const c1 = 14;
		const m1 = 0.9;
		const a1 = (-k1 * (this.offset - this.target) - c1 * this.velocity) / m1;
		this.velocity += a1 * dt;
		this.offset += this.velocity * dt;

		// bass / vocal：指数平滑跟随（等效 folia useSpring stiffness 150/120、damping 25/24 的响应速度）
		const bassLerp = Math.min(1, dt * 12);
		const vocalLerp = Math.min(1, dt * 10);
		this.bass += (this.bassTarget - this.bass) * bassLerp;
		this.vocal += (this.vocalTarget - this.vocal) * vocalLerp;
	},

	/** 跨多行跳变时直接落位（清零速度），与 folia 的 lineOffset.set 等效。 */
	snapTo(angle: number): void {
		this.offset = angle;
		this.target = angle;
		this.velocity = 0;
	},
};
