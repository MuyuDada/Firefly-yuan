// folia 重度主题的 canvas 2D 签名观感绘制函数。
// 对应 folia-web 各 GPU 主题的观感方向（AGPL，见 NOTICE.md）：
//   nebbia（雾笺）: 雨夜车窗——雾面玻璃上手写歌词，字迹划开雾气，背后有街景光斑。
//   diorama（镜台）: 纸艺盒景——分层纸片视差 + 台灯暖光。
//   metaphor（隐喻）: 墨融球——水墨球体缓慢旋转，字浮在其上。
//   machi（町景）: 夜晚街角霓虹——歌词是街边招牌灯箱。
//   sonnet（商籁）: PV 段落场景——整段歌词以「镜头」切换（淡入/淡出+推拉）。
//   tempera（凝彩）: 拼贴色块——歌词块按段落铺成色纸拼贴。
//   lumiere（绘光）: 舞台光——体积光束扫过舞台，歌词在光里。
//   hanabi（花火）: 夜空花火——烟花粒子 + 日式色块字。
//   prompt: CRT 终端——歌词以终端打字机输出。

import type { Line } from "@/utils/lyrics";
import type { CompactScene } from "../canvasStage";

const bgFill = (scene: CompactScene, color: string) => {
	scene.ctx.fillStyle = color;
	scene.ctx.fillRect(0, 0, scene.width, scene.height);
};

const drawCenteredLine = (
	scene: CompactScene,
	text: string,
	y: number,
	fontSize: number,
	color: string,
	glowColor: string,
	glowBlur: number,
) => {
	if (!text) return;
	const ctx = scene.ctx;
	ctx.font = `600 ${fontSize}px ${scene.theme.fontFamily}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color;
	if (glowBlur > 0) {
		ctx.shadowColor = glowColor;
		ctx.shadowBlur = glowBlur;
	}
	ctx.fillText(text, scene.width / 2, y);
	ctx.shadowBlur = 0;
};

const revealTextByProgress = (text: string, progress: number): string => {
	const chars = Array.from(text);
	const count = Math.floor(chars.length * Math.max(0, Math.min(1, progress)));
	return chars.slice(0, count).join("");
};

/** 主题绘制函数表：mode -> drawFrame。 */
export const COMPACT_DRAWERS: Record<string, (scene: CompactScene) => void> = {
	// nebbia（雾笺）：雨夜车窗 + 雾面手写词。
	nebbia(scene) {
		const { ctx, width, height, time } = scene;
		// 夜色街景：模糊的城市光斑。
		bgFill(scene, "rgba(10, 12, 22, 0.4)");
		ctx.save();
		for (let i = 0; i < 24; i++) {
			const seed = Math.sin(i * 78.233) * 43758.5453;
			const fx = (seed - Math.floor(seed)) * width;
			const fy = Math.abs(Math.sin(i * 12.9898)) * height * 0.7;
			const hue = Math.abs(Math.sin(i * 3.3)) * 60 + 200;
			const alpha = 0.06 + Math.abs(Math.sin(time * 0.7 + i)) * 0.05;
			ctx.fillStyle = `hsla(${hue.toFixed(0)}, 70%, 60%, ${alpha.toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(fx, fy, 30 + (i % 5) * 26, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();

		// 雾面玻璃：半透明白罩，雾气随时间缓慢流动。
		const fogAlpha = 0.34 + Math.sin(time * 0.2) * 0.05;
		ctx.fillStyle = `rgba(190, 200, 214, ${fogAlpha.toFixed(3)})`;
		ctx.fillRect(0, 0, width, height);

		// 手写词：当前句按进度显现，字体用斜体模拟手写。
		if (scene.line) {
			const fontSize = Math.min(width * 0.06, 52);
			const y = height * 0.46;
			ctx.save();
			ctx.translate(width / 2, y);
			ctx.rotate(-0.012);
			const revealed = revealTextByProgress(
				scene.line.fullText,
				scene.lineProgress,
			);
			// 划开雾气的擦痕感：文字周围一圈亮边。
			ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
			ctx.lineWidth = 1.4;
			ctx.font = `italic 600 ${fontSize}px ${scene.theme.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.strokeText(revealed, 0, 0);
			ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
			ctx.fillText(revealed, 0, 0);
			ctx.restore();
		}
	},

	// diorama（镜台）：纸艺盒景 + 分层视差。
	diorama(scene) {
		const { ctx, width, height, time, bass } = scene;
		bgFill(scene, "rgba(14, 12, 24, 0.45)");
		// 分层纸片：3 层视差（远景/中景/近景），低音推近。
		const layers = [
			{ depth: 0.3, color: "rgba(120, 110, 180, 0.20)" },
			{ depth: 0.55, color: "rgba(150, 130, 200, 0.24)" },
			{ depth: 0.85, color: "rgba(180, 160, 230, 0.28)" },
		];
		layers.forEach((layer, index) => {
			const shift = Math.sin(time * (0.3 + index * 0.12)) * 14 * (index + 1);
			const lift = bass * 18 * (index + 1);
			const boxHeight = height * (0.22 + index * 0.1);
			const y = height * 0.62 + index * 40 - lift;
			ctx.fillStyle = layer.color;
			ctx.save();
			ctx.translate(width / 2 + shift, y);
			ctx.rotate(Math.sin(time * 0.22 + index) * 0.015);
			// 纸片盒：平行四边形组合出层叠感。
			ctx.beginPath();
			ctx.moveTo(-width * 0.42, boxHeight);
			ctx.lineTo(-width * 0.36, 0);
			ctx.lineTo(width * 0.36, 0);
			ctx.lineTo(width * 0.42, boxHeight);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		});

		// 台灯暖光：随 vocal 呼吸。
		const lamp = ctx.createRadialGradient(
			width / 2,
			height * 0.36,
			20,
			width / 2,
			height * 0.36,
			width * 0.3,
		);
		lamp.addColorStop(
			0,
			`rgba(255, 214, 165, ${(0.16 + scene.vocal * 0.14).toFixed(3)})`,
		);
		lamp.addColorStop(1, "rgba(255, 214, 165, 0)");
		ctx.fillStyle = lamp;
		ctx.fillRect(0, 0, width, height);

		if (scene.line) {
			drawCenteredLine(
				scene,
				scene.line.fullText,
				height * 0.44,
				Math.min(width * 0.045, 42),
				scene.theme.primaryColor,
				scene.theme.accentColor,
				20,
			);
		}
	},

	// metaphor（隐喻）：墨融球 + 半调网点。
	metaphor(scene) {
		const { ctx, width, height, time, bass } = scene;
		bgFill(scene, "rgba(16, 14, 18, 0.4)");
		// 半调网点背景。
		ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
		const dotGap = 26;
		for (let gy = dotGap / 2; gy < height; gy += dotGap) {
			for (let gx = dotGap / 2; gx < width; gx += dotGap) {
				ctx.beginPath();
				ctx.arc(gx, gy, 1.1, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// 墨球：径向渐变墨滴，低音融胀。
		const cx = width / 2;
		const cy = height * 0.52;
		const radius = Math.min(width, height) * (0.22 + bass * 0.06);
		const ink = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
		ink.addColorStop(0, "rgba(18, 16, 22, 0.96)");
		ink.addColorStop(0.75, "rgba(28, 24, 34, 0.9)");
		ink.addColorStop(1, "rgba(28, 24, 34, 0)");
		ctx.fillStyle = ink;
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fill();

		// 球面环绕的字：沿椭圆轨道。
		if (scene.line) {
			const fontSize = Math.min(width * 0.04, 34);
			ctx.font = `600 ${fontSize}px ${scene.theme.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const chars = Array.from(scene.line.fullText);
			const arcSpan = Math.PI * 1.2;
			chars.forEach((char, index) => {
				const angle =
					-Math.PI * 0.6 +
					(index / Math.max(chars.length - 1, 1)) * arcSpan +
					Math.sin(time * 0.5) * 0.05;
				const rx = radius * 1.35;
				const ry = radius * 0.62;
				const x = cx + Math.cos(angle) * rx;
				const y = cy + Math.sin(angle) * ry * 0.4;
				const depth = (Math.sin(angle) + 1) / 2;
				ctx.globalAlpha = 0.3 + depth * 0.7;
				ctx.fillStyle =
					depth > 0.6 ? scene.theme.accentColor : scene.theme.primaryColor;
				ctx.fillText(char, x, y);
			});
			ctx.globalAlpha = 1;
		}
	},

	// machi（町景）：夜晚街角霓虹招牌。
	machi(scene) {
		const { ctx, width, height, time, bass } = scene;
		bgFill(scene, "rgba(10, 8, 16, 0.5)");
		// 街灯背景条：霓虹招牌列。
		const signCount = 5;
		for (let i = 0; i < signCount; i++) {
			const sx = width * (0.12 + (i / (signCount - 1)) * 0.76);
			const flicker = Math.sin(time * (3 + i) + i * 7) > -0.75 ? 1 : 0.24;
			const signH = height * (0.12 + Math.abs(Math.sin(i * 2.4)) * 0.2);
			ctx.save();
			ctx.translate(sx, height * 0.3);
			ctx.fillStyle = `hsla(${(i * 47 + 200) % 360}, 80%, 62%, ${(0.14 + bass * 0.1) * flicker})`;
			ctx.fillRect(-18, -signH / 2, 36, signH);
			ctx.strokeStyle = `hsla(${(i * 47 + 200) % 360}, 90%, 70%, ${0.4 * flicker})`;
			ctx.lineWidth = 2;
			ctx.strokeRect(-18, -signH / 2, 36, signH);
			ctx.restore();
		}

		// 当前句：街边主招牌灯箱。
		if (scene.line) {
			const fontSize = Math.min(width * 0.052, 46);
			const y = height * 0.52;
			const text = scene.line.fullText;
			ctx.font = `600 ${fontSize}px ${scene.theme.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			// 霓虹双层：外圈强光 + 内芯白。
			ctx.shadowColor = scene.theme.accentColor;
			ctx.shadowBlur = 26 + bass * 26;
			ctx.fillStyle = scene.theme.accentColor;
			ctx.fillText(text, width / 2, y);
			ctx.shadowBlur = 10;
			ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
			ctx.fillText(text, width / 2, y);
			ctx.shadowBlur = 0;
		}
	},

	// sonnet（商籁）：段落镜头切换。
	sonnet(scene) {
		const { ctx, width, height, time } = scene;
		// 场景色随段落（行号 / 4）切换。
		const sectionHues = [222, 268, 330, 30];
		const section = Math.max(0, scene.currentLineIndex) % sectionHues.length;
		const hue = sectionHues[section];
		bgFill(scene, `hsla(${hue}, 40%, 12%, 0.42)`);
		// 推拉镜头感：慢速缩放的装饰框。
		const zoom = 1 + Math.sin(time * 0.28) * 0.03;
		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(zoom, zoom);
		ctx.strokeStyle = `hsla(${hue}, 60%, 62%, 0.2)`;
		ctx.lineWidth = 1;
		ctx.strokeRect(-width * 0.38, -height * 0.26, width * 0.76, height * 0.52);
		ctx.restore();

		if (scene.line) {
			// 段内淡入淡出：行进度 0-0.15 淡入、0.85-1 淡出。
			const fadeIn = Math.min(1, scene.lineProgress / 0.15);
			const fadeOut = Math.min(1, (1 - scene.lineProgress) / 0.15);
			const alpha = Math.min(fadeIn, fadeOut);
			drawCenteredLine(
				scene,
				scene.line.fullText,
				height * 0.46,
				Math.min(width * 0.05, 46),
				`rgba(255, 255, 255, ${(0.94 * alpha).toFixed(3)})`,
				`hsla(${hue}, 70%, 62%, 1)`,
				22,
			);
			if (scene.line.translation) {
				drawCenteredLine(
					scene,
					scene.line.translation,
					height * 0.56,
					Math.min(width * 0.022, 22),
					`rgba(255, 255, 255, ${(0.6 * alpha).toFixed(3)})`,
					"transparent",
					0,
				);
			}
		}
	},

	// tempera（凝彩）：拼贴色块排版。
	tempera(scene) {
		const { ctx, width, height, time, bass, line } = scene;
		bgFill(scene, "rgba(18, 14, 20, 0.42)");
		if (!line) return;
		// 段落色块：按行号给每行一个色纸，当前行放大。
		const chars = Array.from(line.fullText);
		const perRow = 9;
		const rows = Math.ceil(chars.length / perRow);
		const tileW = Math.min(width * 0.8, rows > 2 ? 380 : 480) / perRow;
		const tileH = tileW * 1.18;
		const offsetX = width / 2 - (Math.min(perRow, chars.length) * tileW) / 2;
		const offsetY = height * 0.4 - (rows * tileH) / 2;

		chars.forEach((char, index) => {
			const row = Math.floor(index / perRow);
			const col = index % perRow;
			const isPrinted =
				index / Math.max(chars.length - 1, 1) <= scene.lineProgress;
			const hue = (row * 47 + col * 13 + 200) % 360;
			const scale = isPrinted ? 1 + bass * 0.1 : 0.92;
			const x = offsetX + col * tileW + tileW / 2;
			const y = offsetY + row * tileH + tileH / 2;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(Math.sin(time * 0.4 + index) * 0.03);
			ctx.scale(scale, scale);
			ctx.fillStyle = `hsla(${hue}, ${isPrinted ? 62 : 30}%, ${isPrinted ? 58 : 34}%, ${isPrinted ? 0.85 : 0.35})`;
			ctx.fillRect(-tileW / 2 + 2, -tileH / 2 + 2, tileW - 4, tileH - 4);
			if (isPrinted) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
				ctx.font = `600 ${tileH * 0.52}px ${scene.theme.fontFamily}`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(char, 0, 0);
			}
			ctx.restore();
		});
	},

	// lumiere（绘光）：舞台光束扫过。
	lumiere(scene) {
		const { ctx, width, height, time, bass } = scene;
		bgFill(scene, "rgba(8, 6, 14, 0.45)");
		// 体积光束：3 束从顶部扇形展开，低音增亮。
		const beamCount = 3;
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		for (let i = 0; i < beamCount; i++) {
			const anchorX = width * (0.3 + (i / (beamCount - 1)) * 0.4);
			const sweep = Math.sin(time * (0.5 + i * 0.13)) * width * 0.18;
			const gradient = ctx.createLinearGradient(
				anchorX,
				0,
				anchorX + sweep,
				height,
			);
			gradient.addColorStop(
				0,
				`rgba(255, 236, 200, ${(0.1 + bass * 0.14).toFixed(3)})`,
			);
			gradient.addColorStop(
				0.5,
				`rgba(255, 236, 200, ${(0.04 + bass * 0.06).toFixed(3)})`,
			);
			gradient.addColorStop(1, "rgba(255, 236, 200, 0)");
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.moveTo(anchorX - 14, 0);
			ctx.lineTo(anchorX + 14, 0);
			ctx.lineTo(anchorX + sweep + width * 0.14, height);
			ctx.lineTo(anchorX + sweep - width * 0.14, height);
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();

		// 浮尘。
		ctx.fillStyle = "rgba(255, 244, 224, 0.3)";
		for (let i = 0; i < 30; i++) {
			const seed = Math.sin(i * 91.7) * 10000;
			const px = (seed - Math.floor(seed)) * width;
			const py =
				((seed * 7 - Math.floor(seed * 7)) * height +
					time * 14 * (0.5 + (i % 3))) %
				height;
			ctx.beginPath();
			ctx.arc(px, py, 1 + (i % 2), 0, Math.PI * 2);
			ctx.fill();
		}

		if (scene.line) {
			const alpha =
				Math.min(1, scene.lineProgress / 0.12) *
				Math.min(1, (1 - scene.lineProgress) / 0.12);
			drawCenteredLine(
				scene,
				scene.line.fullText,
				height * 0.5,
				Math.min(width * 0.05, 46),
				`rgba(255, 250, 240, ${(0.94 * alpha).toFixed(3)})`,
				"rgba(255, 236, 200, 1)",
				26 + bass * 18,
			);
		}
	},

	// hanabi（花火）：夜空烟花 + 色块字。
	hanabi(scene) {
		const { ctx, width, height, time, bass, line } = scene;
		bgFill(scene, "rgba(6, 8, 20, 0.5)");
		// 花火粒子：每 1.2 秒在随机点绽放一轮。
		ctx.globalCompositeOperation = "lighter";
		const burstPhase = (time % 1.4) / 1.4;
		const burstSeed = Math.floor(time / 1.4);
		const burstX = seededRandom(burstSeed, 1) * width;
		const burstY = height * (0.16 + seededRandom(burstSeed, 2) * 0.3);
		const hue = (burstSeed * 61) % 360;
		const particleCount = 42;
		for (let i = 0; i < particleCount; i++) {
			const angle = (i / particleCount) * Math.PI * 2;
			const dist =
				burstPhase * width * (0.14 + seededRandom(burstSeed, 3 + i) * 0.1);
			const px = burstX + Math.cos(angle) * dist;
			const py = burstY + Math.sin(angle) * dist + burstPhase * 40;
			const alpha = (1 - burstPhase) * 0.7;
			ctx.fillStyle = `hsla(${hue + i * 3}, 90%, 64%, ${alpha.toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(px, py, 2.2, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalCompositeOperation = "source-over";

		// 日式色块字：竖排色块 + 白字。
		if (line) {
			const chars = Array.from(line.fullText);
			const tile = Math.min(width * 0.07, 54);
			const startY = height * 0.34;
			chars.slice(0, 8).forEach((char, index) => {
				const tx =
					width / 2 +
					(index - (Math.min(chars.length, 8) - 1) / 2) * tile * 1.06;
				const bounce = Math.sin(time * 2 + index * 0.8) * bass * 6;
				ctx.fillStyle = `hsla(${(index * 43 + hue) % 360}, 76%, 56%, 0.88)`;
				ctx.fillRect(tx - tile / 2, startY - tile / 2 + bounce, tile, tile);
				ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
				ctx.font = `600 ${tile * 0.62}px ${scene.theme.fontFamily}`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(char, tx, startY + bounce);
			});
		}
	},

	// prompt：CRT 终端打字机。
	prompt(scene) {
		const { ctx, width, height, time, line, lineProgress } = scene;
		bgFill(scene, "rgba(4, 10, 6, 0.55)");
		// 扫描线。
		ctx.fillStyle = "rgba(0, 255, 130, 0.03)";
		for (let y = 0; y < height; y += 3) {
			ctx.fillRect(0, y, width, 1);
		}

		const fontSize = Math.min(width * 0.032, 26);
		ctx.font = `500 ${fontSize}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		const textColor = "rgba(0, 255, 130, 0.88)";
		const marginX = width * 0.12;
		const marginTop = height * 0.3;
		const maxCharsPerRow = Math.floor((width * 0.76) / (fontSize * 0.62));

		if (!line) {
			ctx.fillStyle = textColor;
			ctx.fillText("$ awaiting track...", marginX, marginTop);
			return;
		}

		// 打字机：按行进度输出，带光标闪烁。
		const typed = revealTextByProgress(line.fullText, lineProgress);
		const rows: string[] = [];
		for (let i = 0; i < typed.length; i += maxCharsPerRow) {
			rows.push(typed.slice(i, i + maxCharsPerRow));
		}
		ctx.fillStyle = "rgba(0, 255, 130, 0.5)";
		ctx.fillText(
			`$ line[${scene.currentLineIndex}] ::`,
			marginX,
			marginTop - fontSize * 1.8,
		);
		rows.forEach((row, index) => {
			ctx.fillStyle = textColor;
			ctx.fillText(row, marginX, marginTop + index * fontSize * 1.6);
		});
		// 光标。
		if (Math.sin(time * 6) > 0) {
			const lastRow = rows[rows.length - 1] ?? "";
			ctx.fillStyle = "rgba(0, 255, 130, 0.9)";
			ctx.fillRect(
				marginX + lastRow.length * fontSize * 0.62,
				marginTop + (rows.length - 1) * fontSize * 1.6,
				fontSize * 0.6,
				fontSize,
			);
		}
	},
};

const seededRandom = (seed: number, offset: number): number => {
	const x = Math.sin(seed * 1000 + offset) * 10000;
	return x - Math.floor(x);
};
