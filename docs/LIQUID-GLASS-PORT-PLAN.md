# 液态玻璃「照搬手册」—— 效果与可读性，逐项对应到本项目代码

> **本文的用途**：不再自己发明效果 ✗。所有配方都来自**现成工程**（尤其 Apple 官方口径）✓，
> 每条都写明「抄什么、抄到哪个文件、什么值」✓，实施时只做**转写**、不做再设计 ✓。
>
> 取证说明（如实）：本轮 `github.com` 直连与 `raw.githubusercontent.com`（DNS 拦截）**均抓取失败** ✗，
> 因此**配方细节来自本项目已归档的源码级调研** `docs/UI-LIQUID-GLASS-RESEARCH.md`
> （含 Apple 官方原文引用与各工程源码级结论）✓；本轮联网检索**只新增了工程清单**（见 §1 的"新发现"）✓。

---

## 1. 可抄的工程清单

| 工程 | 定位 | 我们抄什么 |
| --- | --- | --- |
| **Apple HIG / WWDC25（官方口径）** | 定义"什么才算对" | ① 透镜是定义性机制 ② regular/clear 两档按背景选 ③ clear 叠亮内容配 **35% 暗压层** ④ **内容层不用玻璃** ⑤ 材质化 ≠ 淡入 ⑥ Reduce Transparency / Reduce Motion 是官方出口 |
| [`shuding/liquid-glass`](https://github.com/shuding/liquid-glass)（MIT） | SDF 透镜位移 | 位移图通道约定：**R/G = `128+dx·127` / `128+dy·127`**，B 恒定；**低分辨率**（`canvasDPI=1`） |
| [`ObaidQatan/liquid-glass-component-library`](https://github.com/ObaidQatan/liquid-glass-component-library)（MIT） | 高光 | **烘焙高光贴图 + `lightAngle`**；`objectBoundingBox` 归一化（尺寸无关）；**resize 时 debounce 100ms**；小元素用 `lite` 精简滤镜 |
| [`lucasromerodb/liquid-glass-effect-macos`](https://github.com/lucasromerodb/liquid-glass-effect-macos) | 真高光（物理） | **`feSpecularLighting` 从高度图算高光**（与烘焙贴图**二选一**，不要都上） |
| [`nikdelvin/liquid-glass`](https://github.com/nikdelvin/liquid-glass)（MIT） | 位移图构造 + 色散 | 位移图 = **程序化方向场**（中性 `#808080` + X/Y 渐变 screen 合成 + 内缩倒角模糊出厚度）；**真三通道色散**（3× `feDisplacementMap`，scale `s+2c`/`s+c`/`s` → 各 `feColorMatrix` 抽单通道 → 两次 `feBlend mode="screen"`），**默认关** |
| [`samasante/liquid-glass`](https://github.com/samasante/liquid-glass)（新发现） | 无依赖、跨浏览器 | "**headless lens 折射实时 DOM**" 的思路：透镜与内容解耦、可复用同一张位移图 |
| [`childrentime/liquid-glass`](https://github.com/childrentime/liquid-glass)（新发现，含 `LIQUID_GLASS_EFFECT_EN.md`） | 效果说明文档 | 效果参数化说明（作为对照，不引入依赖） |
| [`Leonxlnx/liquid-glass`](https://github.com/Leonxlnx/liquid-glass)、[`VII-Cae/hyalite--liquid-glass`](https://github.com/VII-Cae/hyalite--liquid-glass)（新发现） | 同类实现 | hyalite 明确写 "**SDF lens maps + SVG displacement + backdrop-filter**" ⇒ 与我们架构一致，可作对照 |
| [`plasma-ui`](https://github.com/search?q=plasma-ui+liquid+glass) | 性能兜底 | **像素预算**：超预算先降内部分辨率，而不是掉帧 |
| [html-in-canvas.dev：Liquid Glass Effect in CSS and WebGL](https://html-in-canvas.dev/liquid-glass-effect/)（新发现） | 教程 | CSS 光学与 WebGL 两条路线的对照（我们走 CSS/SVG 路线） |

**明确不抄**（已核实是坑）：常驻 shimmer/breathe 动画；每次 `mousemove` 重建位移图；
每次 resize 重建整段 SVG 字符串；模糊半径随元素宽度线性放大；把滤镜挂在**元素自身** `filter:`
冒充折射（`Z1Code`、`gracefullight` 属此类）；任何需要新增依赖的方案。

---

## 2. 效果配方（照搬，逐项对应我们的代码）

| # | 效果要素 | 抄谁 | 落到我们的代码 | 关键值 |
| --- | --- | --- | --- | --- |
| 1 | **边缘透镜（折射）** | shuding + nikdelvin | `src/renderer/src/glass-bake.ts` → `bakeDisplacementPixels()`；`ensureBakedFilter()` | 贴边倒角带 `depth ≈ 0.07×256 ≈ 18px`；**位移强度 `scale ≈ 8–12px`**（iOS 只在边缘弯折几像素；46px 会撕图 ✗）；R/G 通道 `128+d·127`、B/A 常量 |
| 2 | **尺寸无关** | ObaidQatan | `buildBakedFilterMarkup()` | `primitiveUnits="objectBoundingBox"` + `x/y/w/h = 0/0/1/1` + `preserveAspectRatio="none"`；**一张 256×256 覆盖任意面板** |
| 3 | **滤镜几何** | （我们踩过的坑） | 同上 + `tests/unit/glass-filters.spec.ts` | 区域**贴合元素**（`0/0/100%/100%`，外扩会把位移画到面板外 ✗）；位移输入先 **`feTile`**（边缘采样环绕、不取空） |
| 4 | **真高光（二选一）** | ObaidQatan 或 lucasromerodb | `bakeHighlightPixels()`（烘焙贴图 + `lightAngle`） | 角度按 **11.25° 分档**缓存（≤32 张）；放在 `::after`（`mix-blend-mode: screen`）；强度**克制**（我们实测 0.55 仍偏亮 ⇒ 建议 0.35–0.5） |
| 5 | **真色散** | nikdelvin | `buildBakedFilterMarkup({ dispersion })` | 3× 位移 `s+2c`/`s+c`/`s` → 抽单通道 → 2× `screen`；**默认关**，档 4 才开且 `c ≈ 1–2` |
| 6 | **材质化过渡** | Apple（"materialize ≠ fade"） | `@property --mat-scene-op` + `el-materialize-in/-pop-in`（档 4 专属关键帧） | 过渡期调制**折射量**（`--mat-scene-op`）+ 位移幅度，而非纯 `opacity` |
| 7 | **性能兜底** | plasma-ui + 我们既有 FPS 采样 | `App.tsx` 帧率采样 + `shouldDegradeForFps` | 超预算先**降档**（4→3→2）+ `data-motion-low`；**位移图/高光图只烘焙一次**、按参数缓存 |

---

## 3. 可读性保证（Apple 官方口径，逐条照搬）

| # | Apple 的做法（原文要点） | 落到我们的代码 | 状态 |
| --- | --- | --- | --- |
| 1 | **regular / clear 两档按背景选**：regular "blurs and **adjusts the luminosity** of background content to maintain legibility" | 档 4 的 `backdrop-filter` 已含 `brightness()`（= 明度调整） | ✅ 已有（值可调） |
| 2 | **clear 叠在亮内容上时配 35% 不透明度的暗色压层** | 属研究文档 §6 **第 6 项（远期）** ⇒ 要用就必须**成卡**做，并遵守 `AI_RULES` 24（不得是"看得见的灰层"） | ⏸ 未做（按规范应单独成卡） |
| 3 | **"Don't use Liquid Glass in the content layer"** | 与"内容层也要玻璃"的用户要求**直接冲突** ⇒ **以用户要求为准**（已恢复内容层玻璃；若要回到官方口径需用户明确点头） | ⚠️ 用户已定：内容层保留玻璃 |
| 4 | **Reduce Transparency / Reduce Motion 是官方出口** | 既有三个开关（减少透明度 / 高对比度 / 减少动态效果）+ 自动降档 | ✅ 已有 |
| 5 | **滑块/开关仅在交互瞬间取用液态玻璃** | 档 4 控件的 `backdrop-filter` 只在 hover/active 挂 | ✅ 已有 |
| 6 | **高光/色散都要"贴边、克制"** | 见 §2 第 4/5 项（本次已把 `scale 46→12`、`dispersion 3→1.5` 收敛） | ✅ 本次收敛 |

**可读性的三条硬底线**（与 `AI_RULES` 24 一致）：① 不做整面灰层 ② 只提文字自身对比度或调材质自身的明度量
③ 既有两个无障碍开关始终可用。

---

## 4. 实施顺序（照搬式落地，不新增依赖）

1. **条目 1–3（透镜几何）** —— 已有实现，只需按上表核对数值（本次已收敛）；
2. **条目 4（高光二选一）** —— 已有烘焙贴图方案；把强度降到 0.35–0.5，并按 11.25° 分档；
3. **条目 5（色散）** —— 已有；默认关、档 4 开、`c ≈ 1–2`；
4. **条目 6（材质化）** —— 已有（档 4 专属关键帧）；
5. **条目 7（性能兜底）** —— 已有（缓存 + 逐级降档）；
6. 每一项完成后**必须**：跑 `tests/unit/glass-filters.spec.ts`、`tests/unit/glass-bake.spec.ts`、
   `tests/integration/material-tier4.spec.ts`，并按 `docs/GRAY-VEIL-INCIDENT-LOG.md` 顶部标记表
   逐条核对两条**复发型**缺陷（灰纱/竖条、模块区控件高度）。

---

## 5. 许可与依赖

所有条目**零新增依赖**（读思路 → 自写 SVG 滤镜 + 自生成位移图）✓。
若将来直接复用某段 MIT 代码，只考虑 [`shuding/liquid-glass`](https://github.com/shuding/liquid-glass) 与
[`ObaidQatan/liquid-glass-component-library`](https://github.com/ObaidQatan/liquid-glass-component-library)（均有 LICENSE 文件在位 ✓），
并**在任务卡里单独说明复用范围与出处**（`AI_RULES` 14）✓。
