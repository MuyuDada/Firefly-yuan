<script lang="ts" module>
// folia 重度主题的 canvas 2D 简化移植共用外壳。
// 对应 folia-web 的 nebbia（雾笺）/ diorama（镜台）/ metaphor（隐喻）/
// machi（町景）/ sonnet（商籁）/ tempera（凝彩）/ lumiere（绘光）/
// hanabi（花火）/ prompt 各自的 GPU 渲染；Firefly 用 canvas 2D 捕捉
// 每个主题的签名观感（AGPL，见 NOTICE）。原始源码：
//   nebbia: WebGL2 双全屏着色器（雨窗/街景）
//   diorama / metaphor / machi: React Three Fiber 3D 场景
//   sonnet / tempera / lumiere / hanabi / prompt: Pixi WebGL
// Firefly 不引入 three.js 全场景 / pixi.js 依赖，观感方向保持一致。
import { fade } from "svelte/transition";
</script>
