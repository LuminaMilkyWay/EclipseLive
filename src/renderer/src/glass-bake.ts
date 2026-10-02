/**
 * T37 档 4（全液态玻璃）的**烘焙材质**管线。
 *
 * ## 为什么烘焙
 * 档 4 的光学需要两张"贴图"：**SDF 位移图**（决定透镜如何弯折背景）与**镜面高光贴图**
 * （决定受光侧亮斑）。如果每帧或每次交互重算，会把 CPU/GPU 吃光 —— 研究文档
 * （docs/UI-LIQUID-GLASS-RESEARCH.md §6）明确把范本工程里这几种做法列为**不借鉴**：
 * 每次 `mousemove` 重建位移图、每次 `resize` 重建整段 SVG 字符串、滤镜挂在元素自身。
 *
 * 本模块的策略：
 * 1. **程序化生成**（不依赖噪声随机数）⇒ 输出**确定性**，可单测、可缓存、可复核；
 * 2. **通道打包**：R/G 存 `128 + d·127`（0x80 = 零位移），B/Alpha 保留常量 —— 照抄研究文档 §6-1 的约定；
 * 3. **尺寸无关**：贴图按 `objectBoundingBox` 归一化消费 ⇒ **一张 256×256 覆盖任意面板**，
 *    尺寸变化不需要重生（研究文档 §6-5）；
 * 4. **按参数缓存**：同参数只生成一次；高光贴图按角度分档缓存（指针轻推时不会狂建）。
 *
 * ## 分层（可测性）
 * - `bakeDisplacementPixels` / `bakeHighlightPixels`：**纯函数**（只吃参数、吐 RGBA）⇒ node 单测；
 * - `bakeToDataUrl` / `ensureBakedFilters`：薄适配层（canvas + DOM）⇒ 集成测试。
 */

/** 位移图基准尺寸（objectBoundingBox 归一化后与面板大小无关）。 */
export const DISPLACEMENT_SIZE = 256
/** 高光贴图基准尺寸（比位移图小一档：它只是柔和亮斑，不需要高频细节）。 */
export const HIGHLIGHT_SIZE = 128
/** 中性值：0x80 = 零位移（R/G 通道约定）。 */
const NEUTRAL = 128

export interface DisplacementOptions {
  size: number
  /** 内缩倒角宽度（像素）：决定"透镜厚度"作用的边缘带宽度。 */
  depth: number
  /** 位移强度缩放（0 = 全中性；1 = 满幅）。 */
  strength: number
}

export interface HighlightOptions {
  size: number
  /** 光源角度（度）：0 = 光来自 +x（右），180 = 光来自 -x（左）。 */
  lightAngle: number
  /**
   * 强度（0..1，默认 1）。用于把高光贴图整体压暗 —— 用户实测"高光过曝、看着难受"，
   * 于是挂层时用 0.55。压低的是**贴图亮度**，不改角度逻辑。
   */
  strength?: number
}

/**
 * 取某个像素处的倒角法线（-1..1；正中间为 0）。两轴独立，角落处两轴同时非零。
 *
 * ★ 关键修正（用户实测"四周有奇怪的黑色折射"）：
 * 位移量**必须在边界处归零** —— 否则最外圈会以最大位移去采样元素**外面**的像素，
 * 那里什么都没有 ⇒ 吸进透明/黑，形成一圈黑边。
 * 现在用 `sin(π·t)`（t = 0 在边界、1 在倒角内侧）：边界 0 → 倒角中部峰值 → 内侧 0，
 * 位移峰值落在倒角**中间**，两端都平滑归零 ⇒ 不再有黑边（这也是各开源实现的共同做法）。
 */
function bevelNormal(x: number, y: number, size: number, depth: number): { nx: number; ny: number } {
  const max = size - 1
  const edge = (d: number): number => {
    if (d >= depth) return 0
    const t = d / depth // 0 = 贴边，1 = 倒角内侧
    return Math.sin(Math.PI * t)
  }
  const nx = -edge(x) + edge(max - x)
  const ny = -edge(y) + edge(max - y)
  return { nx, ny }
}

/**
 * 烘焙 **SDF 位移图**：程序化方向场（研究文档 §6-4 的思路，但用纯数学而非混合模式合成，
 * 以便在 node 里可测且确定）。
 *
 * 约定（§6-1）：`R = 128 + nx·127`、`G = 128 + ny·127`、B/A 常量。
 * `feDisplacementMap` 以 R/G 为 X/Y 位移通道，故中性 128 表示"不平移"。
 */
export function bakeDisplacementPixels(o: DisplacementOptions): Uint8ClampedArray {
  const size = Math.max(2, Math.floor(o.size))
  const depth = Math.max(1, Math.floor(o.depth))
  const strength = Math.max(0, Math.min(1, o.strength))
  const px = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const { nx, ny } = bevelNormal(x, y, size, depth)
      px[i] = NEUTRAL + nx * 127 * strength
      px[i + 1] = NEUTRAL + ny * 127 * strength
      px[i + 2] = 255 // B 保留常量（将来可打包其它信息）
      px[i + 3] = 255
    }
  }
  return px
}

/**
 * 烘焙**镜面高光贴图**：按光源角度算 Lambert 型亮斑（灰度）。
 *
 * 表面法线取自与位移图同一套倒角场（保证"弯折"和"受光"来自同一个几何），
 * 再补一个 z 分量构成半球法线；与光源方向点乘后取幂 ⇒ 亮斑集中在受光侧。
 */
export function bakeHighlightPixels(o: HighlightOptions): Uint8ClampedArray {
  const size = Math.max(2, Math.floor(o.size))
  const depth = Math.max(2, Math.round(size * 0.18))
  const a = (o.lightAngle * Math.PI) / 180
  const lx = Math.cos(a)
  const ly = Math.sin(a)
  const lz = 0.55
  const len = Math.hypot(lx, ly, lz)
  const px = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const { nx, ny } = bevelNormal(x, y, size, depth)
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const dot = (nx * lx + ny * ly + nz * lz) / len
      // 幂次 4（原为 6）：亮斑更宽、过渡更柔 —— 6 太"聚" ⇒ 一亮一大片白，观感刺眼（用户实测）
      const lit = Math.pow(Math.max(0, dot), 4) * (o.strength ?? 1)
      const v = Math.round(255 * Math.min(1, lit))
      px[i] = v
      px[i + 1] = v
      px[i + 2] = v
      px[i + 3] = 255
    }
  }
  return px
}

/* ------------------------------------------------------------------ *
 * 以下是薄适配层（canvas / DOM），不在 node 单测范围内。
 * ------------------------------------------------------------------ */

/** 按参数缓存 data-URI：同参数只烘焙一次（性能守则第 4 条）。 */
const cache = new Map<string, string>()

function cacheKey(kind: string, o: Record<string, number>): string {
  return `${kind}:${Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`
}

/** 把 RGBA 像素编码成 PNG data-URI（浏览器环境）。 */
export function bakeToDataUrl(pixels: Uint8ClampedArray, size: number): string {
  // 经 globalThis 取 DOM：本文件同时被 web/node 两套 tsconfig 检查（渲染层其它文件同此写法）。
  const g = globalThis as unknown as {
    document: {
      createElement(tag: string): {
        width: number
        height: number
        getContext(id: string): {
          createImageData(w: number, h: number): { data: Uint8ClampedArray }
          putImageData(img: unknown, x: number, y: number): void
        } | null
        toDataURL(type: string): string
      }
    }
  }
  const canvas = g.document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  // 用 createImageData + set 而非 new ImageData(pixels,…)：后者在 TS 5.7 的
  // 类型化数组泛型下会因 Uint8ClampedArray<ArrayBufferLike> 与 <ArrayBuffer> 不兼容而报错。
  const img = ctx.createImageData(size, size)
  img.data.set(pixels)
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** 位移图 data-URI（带缓存）。 */
export function displacementDataUrl(o: DisplacementOptions): string {
  const key = cacheKey('disp', { ...o })
  const hit = cache.get(key)
  if (hit) return hit
  const url = bakeToDataUrl(bakeDisplacementPixels(o), o.size)
  cache.set(key, url)
  return url
}

/**
 * 高光贴图 data-URI（带缓存）。角度按 **11.25° 分档**：指针轻推高光时不会狂建贴图
 * （32 档足以让观感连续），这是"保性能"的关键取舍。
 */
export function highlightDataUrl(o: HighlightOptions): string {
  const snapped = Math.round(o.lightAngle / 11.25) * 11.25
  const key = cacheKey('hl', { size: o.size, lightAngle: snapped })
  const hit = cache.get(key)
  if (hit) return hit
  const url = bakeToDataUrl(bakeHighlightPixels({ ...o, lightAngle: snapped }), o.size)
  cache.set(key, url)
  return url
}

/** 仅供测试/诊断：当前缓存条目数（用于断言"没有重复烘焙"）。 */
export function bakedCacheSize(): number {
  return cache.size
}

/**
 * 指针位置（视口坐标）→ **光源角度**（度；0 = 光来自右侧，180 = 来自左侧）。
 *
 * 以**窗口中心**为原点 ⇒ 全场**单一光源**（物理自洽）。这一点是刻意的：
 * 之前那版"指针高光"是按每块面板各自算位置，结果每块面板都错位（用户实测指出）。
 * 用"单一光源 + 角度"则天然正确 —— 高光贴图本身按 `objectBoundingBox` 铺满元素，
 * 角度只决定受光侧，不需要任何逐元素映射。
 */
export function lightAngleFromPointer(cx: number, cy: number, w: number, h: number): number {
  const dx = cx - w / 2
  const dy = cy - h / 2
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  return (deg + 360) % 360
}

/** 根元素的最小结构（本文件同时被 web/node 两套 tsconfig 检查，不用 DOM 类型）。 */
interface VarRoot {
  style: { setProperty(name: string, value: string): void }
}

/**
 * 把**烘焙高光贴图**按当前角度写进根元素的自定义属性（`--glass-highlight`）。
 * 角度已按 11.25° 分档缓存 ⇒ 全生命周期最多 32 张 PNG，且只生成一次（性能守则）。
 * 失败静默返回 false（调用方据此回退到纯 CSS 高光）。
 */
export function applyHighlightVar(angle: number, root?: VarRoot): boolean {
  try {
    const g = globalThis as unknown as { document?: { documentElement?: VarRoot } }
    const el = root ?? g.document?.documentElement
    if (!el) return false
    // strength 0.4：按照搬手册 §2 第 4 项（区间 0.35–0.5）—— 只留"被打光"的一层薄暗示，
    // 不抢主体（此前 0.55 实测偏亮，1.0 时曾被用户判为"巨大随动的假高光"）。
    const url = highlightDataUrl({ size: HIGHLIGHT_SIZE, lightAngle: angle, strength: 0.4 })
    el.style.setProperty('--glass-highlight', `url("${url}")`)
    return true
  } catch {
    return false
  }
}

/** 清空缓存（测试用）。 */
export function clearBakedCache(): void {
  cache.clear()
}

/**
 * 能力探测：宿主是否支持 `backdrop-filter: url(#filter)`（真折射的必要条件）。
 * 不支持 ⇒ 档 4 的渲染值降档（沿用既有 FPS 降档通道，不改变持久化选择）。
 */
export function supportsBakedRefraction(filterId = 'glass-refract-baked'): boolean {
  try {
    // 经 globalThis 取 CSS：本文件同时被 web/node 两套 tsconfig 检查，
    // 直接写 DOM 全局在 node 侧没有声明（渲染层其它文件同此写法）。
    const g = globalThis as unknown as {
      CSS?: { supports(prop: string, value: string): boolean }
    }
    return typeof g.CSS?.supports === 'function' && g.CSS.supports('backdrop-filter', `url(#${filterId})`)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 运行时注入：把烘焙位移图接进 SVG 滤镜（纯字符串构造 + 薄 DOM 适配）
 * ------------------------------------------------------------------ */

export interface BakedFilterOptions {
  id: string
  /** 烘焙位移图的 data-URI（R/G = 位移，B/A 常量）。 */
  mapUrl: string
  /** 位移强度（px 量级；档 4 用 46）。 */
  scale: number
  /** 色散强度（每通道递增的位移量，px）。0/缺省 = 不做色散（单次位移）。 */
  dispersion?: number
}

/** 抽单通道用的 4×5 色彩矩阵（保留指定通道，alpha 原样）。 */
const CHANNEL_MATRIX: Record<'R' | 'G' | 'B', number[]> = {
  R: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  G: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  B: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
}

/**
 * 构造 `glass-refract-baked` 滤镜标记（**纯函数**，确定性 ⇒ 可单测）。
 *
 * 基础结构照研究文档 §6 的结论：
 * - `feImage` 载入烘焙位移图，用 `primitiveUnits="objectBoundingBox"` +
 *   `x/y/width/height = 0/0/1/1` + `preserveAspectRatio="none"` ⇒ **一张 256×256 贴图
 *   铺满任意尺寸面板**（尺寸无关，尺寸变化不需要重生）；
 * - `feDisplacementMap` 以 R/G 为 X/Y 位移通道（我们的贴图正是 `128 + d·127` 的约定）。
 *
 * `dispersion > 0` 时启用**真三通道色散**（研究文档 §6-3 的做法）：
 * 同一 `SourceGraphic` 上三次位移（scale = `s+2c` / `s+c` / `s`）→ 各用 `feColorMatrix`
 * 抽单通道 → 两次 `feBlend mode="screen"` 合回。
 * 这比"整面 screen 叠加"更省（只合通道结果，不合整面），代价是多了 2 个位移节点 + 3 个矩阵节点。
 *
 * 位移图与色散都只依赖**烘焙产物** ⇒ 运行期零计算。
 */
export function buildBakedFilterMarkup(o: BakedFilterOptions): string {
  // ★ 滤镜区域**必须贴合元素盒子**（x/y/width/height = 0/0/100%/100%）。
  //   曾经写成 x=-40% / y=-40% / width=180% / height=180%（为了"留位移余量"），
  //   但滤镜输出**不受元素 border-radius 裁切** ⇒ 位移后的画面会画到圆角之外，
  //   面板四周多出一圈灰（用户实测："光效范围有些溢出…又出现了类似灰色薄纱的东西"）。
  //   feDisplacementMap 只是**按位移采样**、输出仍在原位 ⇒ 贴合盒子即可，无需外扩。
  const head =
    `<filter id="${o.id}" x="0" y="0" width="100%" height="100%" ` +
    `color-interpolation-filters="sRGB" primitiveUnits="objectBoundingBox">` +
    `<feImage href="${o.mapUrl}" x="0" y="0" width="1" height="1" ` +
    `preserveAspectRatio="none" result="bakedMap" />`
  const disp = (scale: number, res?: string): string =>
    `<feDisplacementMap in="SourceGraphic" in2="bakedMap" scale="${scale}" ` +
    `xChannelSelector="R" yChannelSelector="G"${res ? ` result="${res}"` : ''} />`
  const chan = (src: string, keep: 'R' | 'G' | 'B', res: string): string =>
    `<feColorMatrix in="${src}" type="matrix" values="${CHANNEL_MATRIX[keep].join(' ')}" result="${res}" />`

  const d = Math.max(0, o.dispersion ?? 0)
  if (d === 0) return `${head}${disp(o.scale)}</filter>`

  return (
    head +
    // 三通道：位移量递减 ⇒ 红/绿/蓝错位，形成色散
    disp(o.scale + 2 * d, 'dispR') +
    chan('dispR', 'R', 'chR') +
    disp(o.scale + d, 'dispG') +
    chan('dispG', 'G', 'chG') +
    disp(o.scale, 'dispB') +
    chan('dispB', 'B', 'chB') +
    `<feBlend in="chR" in2="chG" mode="screen" result="chRG" />` +
    `<feBlend in="chRG" in2="chB" mode="screen" />` +
    `</filter>`
  )
}

/** 一次性把烘焙滤镜注入 DOM（幂等；失败静默——调用方据返回值决定是否切令牌）。 */
export function ensureBakedFilter(
  o: BakedFilterOptions = {
    id: 'glass-refract-baked',
    mapUrl: displacementDataUrl({
      size: DISPLACEMENT_SIZE,
      // 倒角（厚度）带收窄：位移集中在**贴边的一圈**（iOS 26 的透镜就是"贴边的克制弯折"），
      // 而不是让整面都被拉扯（0.12 → 0.07）。
      depth: Math.round(DISPLACEMENT_SIZE * 0.07),
      strength: 1
    }),
    // ★ 位移强度大幅收敛（46 → 12）：46px 的整面位移会把底图**撕开**（用户实测"底图被撕裂"）。
    // 照 iOS 26 的口径：透镜只在边缘做**几像素**的弯折，中央几乎是平的。
    scale: 12,
    // 真三通道色散同步收敛（3 → 1.5）：只留极轻的色边，避免"彩色撕裂"。
    dispersion: 1.5
  }
): boolean {
  try {
    const g = globalThis as unknown as {
      document: {
        getElementById(id: string): unknown
        createElementNS(ns: string, tag: string): {
          setAttribute(n: string, v: string): void
          innerHTML: string
        }
        createElement(tag: string): {
          setAttribute(n: string, v: string): void
          setAttributeNS(ns: string, n: string, v: string): void
          appendChild(child: unknown): void
          style: { cssText: string }
        }
        body: { appendChild(el: unknown): void }
      }
    }
    if (g.document.getElementById(o.id)) return true // 幂等
    const NS = 'http://www.w3.org/2000/svg'
    const svg = g.document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = buildBakedFilterMarkup(o)
    const host = g.document.createElement('div')
    host.setAttributeNS(NS, 'aria-hidden', 'true')
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
    host.appendChild(svg)
    g.document.body.appendChild(host)
    return true
  } catch {
    return false
  }
}
