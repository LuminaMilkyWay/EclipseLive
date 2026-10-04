# UI 液态玻璃 —— 范本调研补充与修订（源码级核查）

> 本文是 [UI-LIQUID-GLASS-ASSESSMENT.md](UI-LIQUID-GLASS-ASSESSMENT.md) 的**补充与修订**：
> 主报告里的"未核实"项（`glass-refraction`、`@nyc-design/glass-effects`、各范本技术路线）由两名独立调研子代理做了**源码级核查**（GitHub API + jsDelivr + npm registry 直读源码），结论有修正也有强化。
> **本文与主报告冲突处，以本文为准。** 仍然：未改任何代码。

## 0. 调研方法与被推翻的前提

- `web_search` 在本会话不可用（缺 API key）；`raw.githubusercontent.com` 无法解析；`github.com` HTML 不可达。
- 实际可用通道：`api.github.com`（读文件走 Contents API base64）、`registry.npmjs.org`、`cdn.jsdelivr.net`、`data.jsdelivr.com`、Apple 官方 JSON 端点。
- **因此：所有"技术路线"结论均为读过源码后得出**，不再是我主报告里的按 description 推断。凡未读到的，仍标 UNVERIFIED。

## 1. 条目修正表（推翻主报告的三项）

| 主报告结论 | 修正后 | 依据 |
| --- | --- | --- |
| `glass-refraction`「未能定位」 | **存在**：[Z1Code/glass-refraction](https://github.com/Z1Code/glass-refraction)，38★，MIT，TypeScript，npm `glass-refraction@0.1.0`（2026-02-10 单版本）；同一名字另有 16 个同名仓库，其中 `ffgsusysg/glass-refraction` 是 topic 蹲位仓库、`voloder/glass-refraction-demo` 是 C++ 无关项目 | 仓库元数据 + Contents API + jsDelivr 读 `src/react/GlassFilters.tsx`、`src/css/glass.css` |
| `@nyc-design/glass-effects`「未核实」 | **包存在**（npm v2.0.0，2025-11-27，MIT 声明，28 文件/52 KB，作者 Neil Tapiavala），**但 GitHub 仓库 404**：`GET /repos/nyc-design/glass-effects` 与 `/orgs/nyc-design` 均为 404，package.json 里的 repository/homepage/bugs 全指向不存在的仓库 → **无源码可审计**；另：构建脚本用 `sed -i` 改 `dist`，**在 Windows 上跑不起来** | npm registry 元数据 + GitHub API 404 + 构建脚本内容 |
| `lucasromerodb`「无许可证，排除」 | **结论不变**（已核实 `license: null`、根目录无 LICENSE 文件 = 默认版权保留），但**其滤镜图形值得借鉴**（见 §2.3） | 仓库元数据 + Contents API |

其余条目（`shuding`、`nikdelvin`、`plasma-ui`、`liquid-glass-webgl`、`liquidGL`、`gracefullight`、`ObaidQatan`、两个 awesome 清单）主报告的"存在性/许可"判断全部成立，本文补上**技术细节**。

## 2. 逐项技术内核（源码级）

> 通用前提（对整个小组都成立，也印证了本项目现有架构）：**Chromium 不支持 `backdrop-filter: url(#svg滤镜)`**。所有"真折射"作品的实际写法都是——**在一个复绘背景的伪层上施加 `filter: url(#f)`**，再用 `backdrop-filter: blur()` 兜底。这与本项目 `renderer.css` 的 `.card::before` 方案（L941–958）**同构**，所以"不推翻现有结构"在这一点上是有外部共识的。

### 2.1 `shuding/liquid-glass` —— 与我们的第 1 条建议完全同路（MIT，1188★）

- 结构：固定 300×200 圆角面板；容器 `backdrop-filter: url(#<id>_filter) blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.1)`；隐藏 0×0 `<svg>` 里放 `<feImage>` + `<feDisplacementMap in="SourceGraphic" in2="#<id>_map" R/G>`。
- **折射实现 = 圆角矩形 SDF 生成的位移图**：隐藏 canvas（**`canvasDPI = 1`，故意不做 DPR 缩放**）逐像素算 `roundedRectSDF` → `smoothStep(0.8, 0, distToEdge - 0.15)` → `smoothStep(0,1,·)` 得透镜衰减，把 `dx/dy` 写进 **R/G 通道**（按 `maxScale*0.5` 归一），`canvas.toDataURL()` 塞给 `feImage`，`feDisplacementMap.scale = maxScale / canvasDPI`。**这就是"透镜厚度场"，是本项目最该抄的那一段。**
- 短板（不要抄的部分）：位移图**每次 `mousemove` 全量重建**（300×200×4 数组循环 + `toDataURL()` 重编码 + 重新挂滤镜）；无 DPR 处理；**零高光、零色散**。
- 对我们的意义：**证明了"不需要 WebGL 也能做真折射"**，且成本可以压到"一张小图 + 一个滤镜"。

### 2.2 `ObaidQatan/liquid-glass-component-library` —— 语义最完整（MIT，LICENSE 文件已核实）

- **真·斯涅尔折射**（`displacementMath.ts`）：玻璃→空气单次折射，n₁=1.5、n₂=1，贝塞尔高度剖面数值求导，`displacement = -(refracted.x * height * thickness) / refracted.y`，**128 个预采样 + 每像素 lerp**。
- 形状：圆角矩形 **SDF**（`sdf.ts`）+ 剖面（默认 `convex-circle`）→ 把向内的位移向量打包成 `R=128+dx·127, G=128+dy·127, B=128, A=255`（128 = 中性）。
- **高光**：单独**烘焙一张 specular 贴图**，由 `lightAngle`（默认 −150°）、`shininess: 6`、`specularOpacity` 驱动，再用 `<feComponentTransfer><feFuncA type="linear" slope="opacity">` + `<feBlend mode="screen">` 合成到折射结果上。
- **色散：没有**（单采样折射、无逐通道 IOR）——注意：这是本项目**有机会超过它**的地方。
- **性能工程（唯一一个有做法可抄的项目）**：① 首帧在 `useLayoutEffect` 里**同步烘焙**，理由是自述"避免玻璃层比贴图先出现造成的 ~100–300 ms 可见延迟"；② 后续重生 **100 ms debounce + rAF**；③ `normalized` 模式用 `objectBoundingBox`/`primitiveUnits`，**一张固定 256×256 贴图适配任意尺寸**；④ 另有一个**精简滤镜** `lg-liquid-glass-filter-lite`（烘焙高光，省掉 `feComponentTransfer`）给小/中元素用。
- 兼容：`supportsKubeBackdropFilter()` 直接探测 `CSS.supports("backdrop-filter","url(#…)")`，源码注释写明 **"Currently this is Chrome-only"**。
- 分发：**不是 npm 包**，是"70+ 组件的私有单文件 demo"，README 注明暂不接受贡献 → **只能 cherry-pick `src/components/liquid-glass/kube/`（约 7 个小文件）**，不能当依赖引。

### 2.3 `lucasromerodb/liquid-glass-effect-macos` —— 唯一把"高光"当光学量算的（828★，无许可证）

滤镜 `#glass-distortion`（`filterUnits="objectBoundingBox"`，零 JS）：

```
feTurbulence(fractalNoise, baseFrequency 0.01, numOctaves 1, seed 5)
  → feComponentTransfer( feFuncR gamma exp=10 offset=.5 ; feFuncG amplitude=0 ; feFuncB offset=.5 )   ← 把噪声收成单通道高度图
  → feGaussianBlur(3)              → result "softMap"
  → feSpecularLighting(in=softMap, surfaceScale=5, specularConstant=1, specularExponent=100, fePointLight x=-200 y=-200 z=300)
  → feComposite(arithmetic k2=1 k3=1)
  → feDisplacementMap(in=SourceGraphic, in2=softMap, scale=150, R/G)
```

- CSS 里是 `backdrop-filter: blur(3px)` **加** `filter: url(#glass-distortion)` 落在同一层，外面 `overflow:hidden; isolation:isolate`。
- 命名技术：**噪声法线图 + `feSpecularLighting` 高光 + `feDisplacementMap` 折射**（注意仍是 turbulence 路线，不是几何透镜；`scale=150` 很激进）。
- **"液态"是纯 CSS 过渡**（padding / border-radius，`cubic-bezier(0.175,0.885,0.32,2.2)`），没有任何运行时形变。
- 短板：`objectBoundingBox` + `baseFrequency 0.01` 使观感**随元素尺寸与缩放漂移**；无 DPR 处理；无 `-webkit-` 前缀；**无许可证**。
- 对我们的意义：**"高光 = 用 `feSpecularLighting` 从一个高度图算出来"** 是解决本项目"高光假"（诊断 #5）的正统做法，而它只需一个滤镜节点，不需要 WebGL。

### 2.4 `Z1Code/glass-refraction` —— 便宜，但名不副实（MIT，38★）

- 滤镜：`feGaussianBlur(SourceGraphic, 0.3)` → `feTurbulence(baseFrequency "0.015 0.012", octaves 2, seed 42)` → `feGaussianBlur(3)` → `feDisplacementMap(scale 8, R/G)` → `feColorMatrix saturate 1.3`；"strong" 变体 scale 16。
- **关键：它把滤镜挂在元素自身上（`filter:`），所以位移的是元素自己的绘制内容，不是背景** → 虽然 README 写"SVG refraction"，但**不是折射**。
- "色散"是 CSS 假装的：4 个极低 alpha 的 `radial-gradient` 叠加（`rgba(0,180,255,.045)` / `(120,80,255,.04)` / `(255,100,200,.035)` / `(100,255,180,.025)`）+ 4 条 1px 异色 inset `box-shadow`；高光是 `::before` 渐变 + **`specular-breathe` 5s 呼吸**与 **`glass-shimmer` 7s 扫光**两个常驻动画。
- 主题面：`:root` 上 `--gr-blur/--gr-blur-card/--gr-blur-pill`、`--gr-saturation*`、`--gr-radius*`、`--gr-chromatic-*`、`--gr-shimmer-duration`、`--gr-specular-duration`；三档类 `.glass` / `.glass-card` / `.glass-pill`。
- 其他：单 commit v0.1.0，README 示例有错别字（`<GlssCard>`/`<GlssPill>`）与坏表格。
- **可借**：只有"用 CSS 变量组织三档 + 三个语义类名"的表皮方式（与本项目 `--mat-*` + 三档的思路一致，可互相校验命名）；**不可借**其折射与常驻动画（后者还违反本项目"禁强动态模糊/克制原则"）。

### 2.5 `nikdelvin/liquid-glass` —— **本组里最值得逐行读的一个**（MIT，108★，Astro）

主报告只把它标为"CSS + SVG filters"，源码核查后发现它的做法**恰是本项目阶段 2/3 最该采用的形态**，且**是本组唯一实现真·逐通道色散的项目**：

- 滤镜链写在**内联样式**里：`backdrop-filter: blur(blur/2 px) url('<data:image/svg+xml,…>#displace') blur(blur px) brightness(x) saturate(y)` —— 位移图以 **data-URI 内嵌 SVG** 提供，无外部请求、无构建期资产（**正好落在本项目 CSP `img-src 'self' data:` 白名单内**）。
- **位移图是"程序化生成"的，不是噪声**（`src/utils/liquidGlass.ts` → `getDisplacementMap()` / `getDisplacementFilter()`，约 4.3 KB 纯函数、零依赖）：以 `#808080` 为**中性基色（0x80 = 零位移）**，叠一个 `blur(2px)` 组下的 `#000080` 底、X 向渐变 `#F00→#000` 与 Y 向渐变 `#0F0→#000`（用 `mix-blend-mode: screen` 合成），再叠一个内缩 `depth` px、`rx=radius` 的圆角矩形（`#808080`，以 `depth` px 模糊）。`feDisplacementMap xChannelSelector="R" yChannelSelector="G"` 读的就是 R/G 相对 0x80 的偏移量 = **边缘法线方向位移**。参数：`depth`（倒角宽度，默认 10）、`strength`（位移量，默认 100）。
- **真色散**：同一 `SourceGraphic` 上叠 **3 个 `feDisplacementMap`**，scale 分别为 `strength + CA*2`、`strength + CA`、`strength`，各自用 `feColorMatrix` 抽成单通道（R/G/B），再用两个 `feBlend mode="screen"` 合回。`chromaticAberration` **默认 0（关）**，文档/演示用 2。
- 高光：滤镜里没有；只有 CSS 变体的 inset 白描边（`inset 0 0 4px #fafafa80`）、半透明覆层（`rgba(0,0,0,.3)` / `rgba(255,255,255,.1)`）与一个 `brightness()` 项。**全程无 `feTurbulence`、无 `feGaussianBlur` 节点**——模糊全交给 `backdrop-filter: blur()`。
- 降级是**真代码**：`CSS.supports('backdrop-filter: url(#test)')` 特性探测，不支持则退化为 `-webkit-backdrop-filter: blur(width/10 px) saturate(180%)` + box-shadow。⚠️ 注意其退化版**模糊半径随元素宽度线性增长**，宽元素上反而更贵 → 我们要抄"探测 + 降级"的机制，**不要抄这个按宽度放大的退化公式**。
- 其他成本事实：每个元素一份 `backdrop-filter` URL 滤镜（各自强制一次 backdrop 快照）；滤镜层尺寸取自 `.lg-content` 的 `getBoundingClientRect` 并烘成 px 宽高；**每个元素一个 `ResizeObserver` → 重建整段 SVG 字符串 + `encodeURIComponent` + 重写 style**（尺寸抖动时会反复重编码，这点不要抄）；一个 anime.js 20s 线性旋转仅在带背景图变体时运行。
- 兼容自述：Chrome 76+ 完整 / Firefox 103+ 完整 / Edge 79+ 完整 / Safari 15+ 部分（自动退化）。
- **可借（高价值）**：`getDisplacementMap()` / `getDisplacementFilter()` 两个纯函数的**整套思路**——0x80 中性基色、渐变 + screen 合成出方向场、`depth`/`strength` 参数化、3 次位移 + 通道抽取 + screen 合成的色散。**这套东西用本项目现有的 `index.html` `<svg>` 基座就能重写，不需要任何依赖。**

### 2.6 `gracefullight/liquid-glass` —— 与 gracefullight 主报告的"无许可证"判断一致

- npm `@gracefullight/liquid-glass@0.1.0`（2025-06-14 单次发布，8 文件/27 KB，peerDep react ≥19.1）；仓库 20★，**最后推送 2025-06-15（已停滞约 15 个月）**。
- 做法：全局隐藏 `<svg>` 一个滤镜 `feTurbulence(fractalNoise, baseFrequency 0.002², octaves 2, seed 92)` → `feGaussianBlur(2)` → `feDisplacementMap(scale 10, R/G)`；`LiquidGlassFilters` 渲染两个绝对定位 span（`border-radius: inherit`）：A 层 = inset 白高光（`rgba(255,255,255,.7)` blur 20 spread −5）+ `rgba(…,0.04)` 着色；B 层 = `backdrop-filter: blur(2px)` + `filter: url(#…)` + `isolation: isolate`。
- 许可：npm package.json 与两个 README 声明 MIT，但**仓库无 LICENSE 文件**、`GET /repos/.../license` 404（GitHub 报 `license: null`）→ **"声明但未落文件"**，集成前须单独确认。
- 可借：约 3.8 KB、2 个文件，**"两个 span 分层 + 继承圆角"**这个最小的玻璃原语很干净；同样**无色散、无真折射语义**（turbulence 位移）。

### 2.7 其余（主报告判断成立，补一句内核 —— 其中 plasma-ui 比主报告估计得更"重"）

| 项目 | 内核（源码级） | 与我们的关系 |
| --- | --- | --- |
| `CruxGarden/plasma-ui`（190★，MIT，npm `@cruxgarden/plasma-ui@0.7.0`，零运行时依赖） | **WebGL2 全视口画布**，5 个 fragment program（bg/mask/tint/blur/comp）；面板是 2D SDF 用 smooth-min 融合（metaball）；折射 `off = -n * pow(bevel,2.2) * 50 * slope * uRefract`（≤50px，采样预模糊背景）；**色散 = 逐通道偏移缩放**（R 用 `off*(1+disp)`、G 用 `off`、B 用 `off*(1-disp)`）；高光是**朝向指针**的 `pow(dot(n,L),26)`（光跟着光标走，不是固定太阳）；另有 Fresnel 边缘、虹彩边缘、发丝线、body shimmer、背景光晕、**仅背景的胶片颗粒**；材质还有 crystal/metal/mercury/wood/stone/cloud（GGX/Smith/Schlick BRDF、SDF 光线步进最多 96 步、Beer–Lambert、Henyey–Greenstein） | 不引入；但**它有几条做法值得抄思路**（见 §4 第 6 条）：`MAX_PIXELS = 2_600_000` **像素预算**、`quality` 1.25 上限、`maxSurfaces = 16`、`needsRedraw` 跳帧、离屏剔除、`prefers-reduced-motion` 关动效 |
| `martin65536/liquid-glass-webgl`（82★，Apache-2.0）—— 注意 **`liquid-glass-webgl` 这个名字有 4 个仓库**（另有 `Zqysl/` 13★MIT React 组件、`wangmuerxiao/` 1★、`gickonfts-bot/` 0★） | WebGL1 + Next.js 16；G2 连续曲率圆角（每角 3 段三次贝塞尔/20 控制点）、胶囊精确曲面细分、256² SDF 贴图；**"2-blit scissor ping-pong scratch"**：`scissor(bbox)` 把 curFbo 拷到 otherFbo → 在 otherFbo 上采样 curTex 画该元素 → 再 scissor 拷回 curFbo、**从不交换**；作者自述每次 blit 像素量少约 50×、整体约 25× 提速；目标是"10 个玻璃元素 @60fps（移动级设备）" | 不引入（是 Next.js **应用**不是库，`private: true` 未发 npm）；它的**几何与跳帧工程**值得读，但代价是"整块画布替掉应用表面" |
| `naughtyduk/liquidGL`（901★，**许可 NOASSERTION**） | WebGPU/WebGL | 排除（许可不明，AI_RULES §14） |
| `GetStream/awesome-liquid-glass`（252★，**license null**） | **不是清单**，是 SwiftUI 示例源码 + GIF | 与 Web/Electron 无关；只能看观感 |
| `carolhsiaoo/awesome-liquid-glass`（68★，CC0-1.0） | 真·策展清单，2025-07 后停滞；指向的 Web 实现包括 `shuding/liquid-glass`、Shadertoy `WftXD2` | 素材索引，可用 |

## 3. Apple 官方口径（用于给"什么才算对"定标）

来源（Apple 自家端点与 WWDC 文字稿）：[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Technology Overviews: Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)、[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[WWDC25 219 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)、[WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)。

| 官方要点 | 原文关键句 | 对本项目的直接含义 |
| --- | --- | --- |
| **Lensing 是定义性机制** | "this new set of materials dynamically bends, shapes, and concentrates light in real time"；镜片作用发生在**四周** | 折射不是装饰而是主体 → 主报告第四节第 1 条（厚度图）优先级应再提 |
| **是"数字化元材料"** | 明确说不是物理材质的复刻 | 允许"语义正确 + 观感对"的近似，不必追求物理精确 → 降低了对 WebGL 的刚需 |
| **材质化 ≠ 淡入** | "Instead of fading, Liquid Glass objects materialize in and out by gradually modulating the light bending and lensing" | ⚠️ **新增一条诊断（主报告诊断表未列）**：本项目页面/弹窗用的是 `opacity + translateY`（`el-rise-in`，renderer.css L1056–1065），按 Apple 口径属"非规范行为"；正确做法是过渡期调制折射量 |
| **两档材质，按背景选** | regular "blurs and adjusts the luminosity of background content to maintain legibility"；clear "highly translucent… float above media backgrounds"；clear 叠在亮内容上时配 **35% 不透明度的暗色压层** | 对应本项目"有壁纸/无壁纸/亮图/暗图"四种真实组合 —— 现在只有一条固定配方 |
| **层级纪律（最重要的一条）** | "Don't use Liquid Glass in the content layer"；标准材质才用于内容层；滑块/开关仅**交互瞬间**临时取用液态玻璃 | ⚠️ **方向性修正**：本项目现在把玻璃用在**内容卡片**（`.card` / `.settings-group` / `.grid`）——按官方口径应当**反过来**：chrome（侧栏/工具条/弹窗/导航项/滑块开关）用玻璃，**内容卡片用标准材质**。这正好命中主报告诊断 #7 与"内容区无材质"的纠结 |
| **滚动边缘效果** | 背景内容"blurring and reducing the opacity"；系统栏默认采用 | 对右侧 3/4 内容区：材质面应偏向"滚动边缘"而非"整块玻璃" |
| **可访问性** | 用户可选 Liquid Glass 观感，或开 Reduce Transparency / Reduce Motion；"These settings can remove or modify certain effects" | 本项目 `reduceTransparency` / `highContrast` / `reduceMotion` **正好对得上官方预期**，是既有资产而非负担（主报告 §5 建议 1 因此更站得住） |
| **动画与视觉是一体设计** | "both the visuals AND motion were designed as one"；按钮会 morph 成菜单、滑块旋钮在交互中"变成"液态玻璃 | 支持"指针/交互驱动高光"的方向；但本项目直播场景仍应克制（主报告 §5 已建议默认关） |

## 4. 结论增补（相对主报告的变化）

**诊断表增补第 13 项（新发现）**

| # | 维度 | 现状 | 官方/正确做法 | 技术 |
| --- | --- | --- | --- | --- |
| 13 | **入场/退场语义** | `.page` / `.modal` / `.toast` 用 `opacity + translateY/scale` 淡入淡出（L1056–1121），并有一段 `280ms` 的 `backdrop-filter` 过渡（L1142–1150） | 液态玻璃应"材质化"——通过**调制折射量**进出，而非改透明度 | CSS（过渡 `--mat-scene-op`/位移幅度）；无需 JS |

**方向性修正（层级纪律）**：推荐方案从"给内容区也加玻璃"改为**"内容层去玻璃化 + chrome 玻璃化"**——即
- 玻璃只用于：侧栏（chrome）、底部工具条、二级下拉、弹窗/Toast、导航项、分段控件、按钮、滑块/开关的活动态；
- 内容层（`.card` / `.settings-group` / `.grid` 内的卡片）改用**标准材质**（明确的实色/半实色面 + 描边 + 层级阴影，不再带 `backdrop-filter`）；
- 右侧 3/4 内容区改为**滚动边缘效果**式中性背景面。

**收益**：① 符合 Apple 的层级纪律，视觉层次立刻可辨（直接解决"分不出导航/内容/浮层"）；② **大幅降低常驻 `backdrop-filter` 面积**（现在设置页 6 张卡片 + 诊断页 4–8 张卡片都在模糊），这是本方案里**性能收益最大的一步**；③ 逐项可测、可独立回滚。

**性能部分**：本项目将成为"唯一有实测数据的一方"——所有范本**均未公布** FPS/GPU/DPR/frame-budget（两个独立调研都确认了这点），主报告第五节"阶段 0 先建探针"的必要性由此强化。

**推荐借鉴点（主报告第四节）增补**：
1. 第 1 条（厚度图）→ 落地细节可直接照抄 `shuding` 的 SDF 思路：**R/G 通道存 `128+dx·127` / `128+dy·127`，B 通道恒定**，且**位移图分辨率故意做低**（他用 `canvasDPI = 1`）。
2. 第 2 条（高光）→ 升级为 `ObaidQatan` 式"**烘焙高光贴图 + `lightAngle`**"，或 `lucasromerodb` 式"**`feSpecularLighting` 从高度图算高光**"，二选一即可（不要两条都上）。
3. **（新增，替代原第 3 条的"先做廉价版"建议）色散直接上"真"做法 —— 照 `nikdelvin` 的三通道方案**：同一 `SourceGraphic` 上 3 个 `feDisplacementMap`（scale 分别 `s+2c` / `s+c` / `s`）→ 各用 `feColorMatrix` 抽单通道 → 两次 `feBlend mode="screen"` 合回；**默认关闭**（他默认 0），强度随档位开。这不仅语义正确，而且**比"整面 screen 叠加"更省**（无整面混合），成本只是多两个位移节点。
4. **（新增）位移图的构造不要用噪声，用 `nikdelvin` 的"程序化方向场"**：中性基色 `#808080`（0x80 = 零位移）+ X/Y 渐变以 `mix-blend-mode: screen` 合成出方向 + 内缩倒角矩形模糊出"厚度"；参数只需 `depth`（倒角宽）与 `strength`（位移量）。**且它可以是一个 data-URI 内嵌 SVG** → 正好落在本项目 CSP `img-src 'self' data:` 白名单内，**零新增资产、零新增依赖**。
5. **（新增）尺寸无关化** —— 用 **`objectBoundingBox` + 一张固定 256×256 位移图**覆盖任意面板（`ObaidQatan` 的 `normalized` 模式）；小元素用**精简滤镜**（省 `feComponentTransfer`），大面板才用完整滤镜（`ObaidQatan` 的 `lite` 思路）。二者结合可避免"每个面板一张图"的生成/显存开销。
6. **（新增，仅借鉴思路）降级与预算机制** —— 抄 `plasma-ui` 的**像素预算**概念（超过预算先降内部分辨率而不是掉帧）与 `martin65536` 的**`needsRedraw` 跳帧**（"没有任何变化就整帧不画"）到本项目的 fps 降级里；**但不要抄 plasma-ui 的"全视口画布替掉应用表面"**。
7. **明确不借鉴**：`Z1Code` 的 5s/7s **常驻 shimmer/breathe 动画**（违反本项目"禁强动态模糊、动效克制"与 reduce-motion 语义）；`shuding` 的**每次 `mousemove` 重建位移图**；`nikdelvin` 的**每次 resize 重建整段 SVG 字符串 + `encodeURIComponent`**、以及其**退化模糊半径随元素宽度线性放大**的公式；任何项目"把滤镜挂在元素自身 `filter:` 上冒充折射"的写法（`Z1Code`、`gracefullight` 属此类）；`martin65536` 仓库本身（含提交进仓库的 `.env`、`db/custom.db`，以及 README 里未被我独立核实的"抄袭指控"段落）——**只读其公开 GLSL 思路，不做代码来源**。

**许可与依赖（最终口径）**：
- 本方案**不需要引入任何依赖**。所有可借鉴内容都能用"读思路 → 自写 SVG 滤镜 + 自生成位移图"落地，这也规避了 `gracefullight`（MIT 声明但无 LICENSE 文件）、`@nyc-design`（无源码）、`liquidGL`（许可不明）、`lucasromerodb`（零许可）四处许可风险。
- 若你希望**直接复用某个 MIT 片段**，我建议只考虑 [shuding/liquid-glass](https://github.com/shuding/liquid-glass)（MIT 且 LICENSE 文件在位，9.4 KB 单文件）与 [ObaidQatan](https://github.com/ObaidQatan/liquid-glass-component-library)（MIT 且 LICENSE 文件已核实）两家，并**在任务卡里单独说明复用范围与出处**（AI_RULES §14）。

## 5. 对主报告第六节分阶段方案的修订点

| 阶段 | 修订 |
| --- | --- |
| **阶段 1**（层次与去塑料化） | 目标改为 Apple 层级纪律：**内容层去 `backdrop-filter`，chrome 层玻璃化**；新增"材质化过渡"替换 `opacity` 淡入（诊断 #13）。验收额外看：常驻模糊面积下降（用阶段 0 探针量化） |
| **阶段 2**（高光与色散） | 高光改用 `feSpecularLighting` 或烘焙高光贴图（二选一）；**不加任何常驻动画** |
| **阶段 3**（折射） | 位移图改为 **SDF 生成 + R/G 通道打包 + 低分辨率 + `objectBoundingBox` 归一化**；首帧同步生成、尺寸变化时 **debounce 100ms 重生**（照抄 `ObaidQatan` 的延迟理由）；能力探测用 `CSS.supports("backdrop-filter","url(#f)")` 显式降级 |
| **阶段 4**（WebGL 试点） | 优先级**下调**：既然 SDF 位移图已被证实可做真折射，WebGL 的边际收益只剩"动态内容折射"，而官方也明说内容层不该用玻璃 → 该阶段可**降为"仅在有明确需求时再做"** |
| **阶段 6**（模块页适配） | 因阶段 1 改了层级纪律，模块页配方（`.card` 范本）与 `MODULE_UI_CONTRACT.md` **必须同步**，否则模块页会继续用"内容层玻璃"而宿主已改 → 这是一次**契约级**变更，需单独成卡并改 `module-ui-contract.spec.ts` |

---

## 6. 效果提升执行清单（把 §3–§5 落成可勾选项，2026-09-28 增补）

> 背景：用户问"评估更好的效果方案了吗"。本文 §3–§5 就是那份评估（源码级核查 + Apple 官方定标），
> 但此前只有分析、没有落地清单。本节把它整理成**按收益/成本排序的执行项**，供逐卡实施。

**前置关系（重要）**：`--mat-veil` 整面薄纱已在 T36 彻底退休。那层薄纱存在的唯一理由是
"给最透档的内容卡片补可读性"——而按 §4 的层级纪律，**内容卡片本就不该是半透明玻璃**，
所以**去掉薄纱正是第 1 项的前置步骤**，两者方向一致、不冲突。

| 优先级 | 执行项 | 做什么 | 收益 | 成本/风险 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| **1（最高）** | **层级纪律：内容层去玻璃化 + chrome 玻璃化** | 内容卡片（`.card`/`.settings-group`/`.grid`）改**标准材质**（半实色 + 描边 + 层级阴影，去掉常驻 `backdrop-filter`）；玻璃只留侧栏/工具条/下拉/弹窗/Toast/导航项/分段控件/按钮/滑块开关活动态；右侧内容区改"滚动边缘"式中性面 | ① 层次立刻可辨（解决"分不出导航/内容/浮层"）② **常驻模糊面积大幅下降**（本方案性能收益最大的一步）③ 与 Apple 口径一致 | 中：**契约级变更** —— `MODULE_UI_CONTRACT.md` 的 `.card` 范本与 `module-ui-contract.spec.ts` 必须同步改；需单独成卡 | 无 |
| **2** | **高光升级（二选一，不要都上）** | ① 烘焙高光贴图 + `lightAngle`（ObaidQatan 式）或 ② `feSpecularLighting` 从高度图算高光（lucasromerodb 式） | 玻璃"被打光"的物理感 —— 这是目前最缺的一环（现状只有 inset 边缘高光） | 低–中：纯 CSS/SVG，无 JS | 优先用在 chrome 面（第 1 项之后才有明确载体） |
| **3** | **真色散（默认关闭）** | `nikdelvin` 三通道：同一 `SourceGraphic` 上 3 个 `feDisplacementMap`（scale `s+2c`/`s+c`/`s`）→ 各 `feColorMatrix` 抽单通道 → 两次 `feBlend mode="screen"` | 语义正确，且**比"整面 screen 叠加"更省**（无整面混合） | 低：多两个位移节点；**默认关**，强度随档位开 | 无 |
| **4** | **材质化过渡（替代淡入）** | 入场/退场由"调透明度 + 位移"改为**调制折射量**（过渡 `--mat-scene-op`/位移幅度），对应诊断 #13 | 符合 Apple"材质化而非淡入"；观感更贵 | 低：纯 CSS 过渡 | 建议与第 1 项同卡或紧随 |
| **5** | **位移图 SDF 化 + 尺寸无关** | 位移图改程序化方向场：中性基色 `#808080` + X/Y 渐变以 `mix-blend-mode: screen` 合成方向 + 内缩倒角模糊出厚度；**R/G 通道打包**、低分辨率（`canvasDPI=1`）、`objectBoundingBox` + 一张 256×256 覆盖任意面板；大面板用完整滤镜、小元素用 lite 精简滤镜；**内嵌 data-URI SVG**（落在既有 CSP `img-src 'self' data:` 内，零新增资产/依赖） | 折射从"噪声近似"升级为"程序化厚度" | 中：需首帧同步生成 + resize 时 debounce 100ms 重生；能力探测 `CSS.supports('backdrop-filter','url(#f)')` | 第 1 项（载体明确后） |
| **6（远期）** | 两档材质按背景选（regular / clear，含 35% 暗压层） | 按"有壁纸/无壁纸 × 亮图/暗图"四种真实组合给两种配方 | 覆盖真实场景差异 | 中 | 第 1 项 |
| **✗ 降级** | WebGL 试点 | — | SDF 位移图已能做出真折射；官方明说内容层不该用玻璃 ⇒ 边际收益只剩"动态内容折射" | — | **仅在有明确需求时再做** |

**明确不借鉴**（研究已核实的坑）：常驻 shimmer/breathe 动画；每次 `mousemove` 重建位移图；
每次 resize 重建整段 SVG 字符串；模糊半径随元素宽度线性放大；把滤镜挂在元素自身 `filter:` 上冒充折射；
任何需要引入依赖的方案（本项目**零新增依赖**即可落地全部上述项）。

**建议实施顺序**：第 1 项（单独成卡，**契约级**）→ 第 4 项（可与第 1 项同卡）→ 第 2 项 → 第 3 项（默认关）→ 第 5 项 → 第 6 项。

---

## 附：本文的未核实项（如实保留）

- `shuding/liquid-glass` 的姊妹文件 `liquid-diamond.js`（35 KB）**未能读取**（API 限流 + jsDelivr 拒取 `application/javascript`）→ 它是否引入 WebGL 或真色散，UNVERIFIED。
- `shuding` 与 `lucasromerodb` **未在其真实 Electron/Chromium 上运行验证**（本会话只做只读调研），兼容性结论均来自代码结构。
- `@nyc-design/glass-effects` 的折射实现细节 UNVERIFIED（无源码可读；从其 keywords 推断为 turbulence + `feDisplacementMap`）。
- 所有范本**均无 FPS/GPU/DPR/帧预算数字** → 任何性能结论必须在本项目实测（阶段 0）。
- 本文与主报告均**未修改任何代码**，只在 `docs/` 增加两个文档。
