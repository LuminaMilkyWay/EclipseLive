import { useEffect } from 'react'
import { wallpaperUrl, type UiSettings } from '@shared/theme'
import { compositeLuma, pickTextTone, sampleWallpaperLuma, type PanelColor } from '../adaptive-text'
import { ensureBakedFilter, applyHighlightVar } from '../glass-bake'

/**
 * 玻璃光学副作用：烘焙折射滤镜注入 + 自适应文字色 + 指针光斑。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 7 轮。
 * 红线遵守：三个 effect 的**代码与依赖数组逐字来自 App.tsx**（`[]` / `[ui?.wallpaperImage, ui?.themeMode, ui?.material]` / `[ui]`），
 * 未做任何重写；执行顺序与拆分前一致（烘焙 → 自适应文字色 → 指针光斑）。
 * 本轮**不含**帧率降档与渲染值收口（若并入会与 useUiSettings 的参数形成循环顺序 ⇒ 该对留在 App，归后续轮次）。
 */
export function useGlassOptics(ui: UiSettings | null): void {
  // T37 两处已**移除**（用户实测回退）：
  // ① 烘焙折射注入（glass-refract-baked）——CSS.supports 只校验语法，不保证 feImage 滤镜链
  //    在 backdrop-filter 路径可用；一旦整条滤镜列表被丢弃，连同写在一起的 blur() 也失效
  //    ⇒ 用户看到"玻璃效果消失"。⇒ 档 4 只用静态 #glass-refract-strong。
  // ② 指针跟随高光——把高光画在整块面板上、用视口坐标定位 ⇒ 每块面板都错位，
  //    且 40% 半径在大面板上摊成灰雾（"灰色薄纱"的观感）。
  //    ⇒ 改为纯 CSS 的**控件 hover 顶部高光**（位置由元素边界决定，恒正确）。
  // ③ 亮背景暗压层——它依赖的"一次性采样"在真实运行时不生效（壁纸经自有协议加载，
  //    在 canvas 里取像素会被拦/污染 ⇒ 采样永远失败）。**不保留无法验证的特性** ⇒ 一并移除；
  //    可读性只留能验证的两条：内容层标准材质（T36）+ 档 4 提升文字对比度。

  // T37 重做：烘焙折射注入（**一次性**）
  // 关键：滤镜挂在**场景层的普通 filter** 上（由 CSS 的 --mat-refract 消费），**不是**面板的
  // backdrop-filter —— 后者对 feImage 支持有限，整条列表被丢弃时连 blur 一起失效（上一轮"玻璃消失"）。
  // 这里只负责"注入 + 置标志"：注入成功才置 data-baked（CSS 据此切换），失败自动保持静态滤镜。
  useEffect(() => {
    const root = document.documentElement
    const ok = ensureBakedFilter()
    if (ok) root.setAttribute('data-baked', '1')
    else root.removeAttribute('data-baked')
  }, [])

  // T37 指针光斑（**用户定义**："指针下方会出现以指针为中心的圆形光斑"）
  // ① 圆斑：把指针坐标写进 --light-x/--light-y（px）⇒ CSS 用一个 fixed 覆盖层画圆斑，
  //    圆心就是指针 ⇒ 天然"以指针为中心"。
  // ② ★ 材质受光**不再跟随指针**（用户反馈："点击的块状按钮还有奇怪的跟随高光"）：
  //    iOS 26 的小控件只有**固定的上沿镜面**（--ctrl-specular），镜面**不追指针**。
  //    因此这里只在挂载时给一次静止光照角度（250°＝顶部偏左来光），指向移动只更新圆斑坐标。
  // 性能：rAF 节流（每帧最多一次）；纯 CSS 绘制（零滤镜、零 canvas）。
  useEffect(() => {
    if (!ui) return
    const root = document.documentElement
    // ★ 只服务档 4：前三档**不装监听、不写属性**（用户实测过"前三档被修出 bug"；
    //   既保证前三档行为完全不变，也省掉一个常驻全局监听）。
    if (ui.material !== 4 || ui.reduceMotion || root.getAttribute('data-motion-low') === '1') {
      root.removeAttribute('data-light')
      return
    }
    let raf: number | null = null
    const onMove = (e: PointerEvent): void => {
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        root.style.setProperty('--light-x', `${e.clientX}px`)
        root.style.setProperty('--light-y', `${e.clientY}px`)
        root.setAttribute('data-light', '1')
      })
    }
    applyHighlightVar(250) // 静止光照：一次，之后不随指针变化（iOS 26 的小控件镜面是固定的）
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf !== null) cancelAnimationFrame(raf)
      root.removeAttribute('data-light')
    }
  }, [ui])

  // T37 **自适应文字色**（用户要求："识别下方元素颜色，切换黑色或者白色字体"）
  // ① 采样壁纸平均亮度（fetch→Blob→createImageBitmap→离屏 canvas；**一次性、按 URL 缓存**）；
  // ② 读**真实元素**的计算背景色（自定义属性里的 color-mix 不会被解析，必须读元素本身）；
  // ③ 合成「面板色 × α + 底图 × (1-α)」⇒ 偏亮 ⇒ 深色字；偏暗 ⇒ 浅色字。
  // 采样失败（无图/不支持/被拦）⇒ 不写属性、保持主题默认文字色 ⇒ **绝不因失败改变观感**。
  useEffect(() => {
    const root = document.documentElement
    const url = ui ? wallpaperUrl(ui.wallpaperImage) : ''
    let cancelled = false
    void sampleWallpaperLuma(url ?? '').then((backdrop) => {
      if (cancelled) return
      if (backdrop === null) {
        root.removeAttribute('data-glass-text')
        return
      }
      const side = document.querySelector('.side')
      let panel: PanelColor = { r: 13, g: 19, b: 34, a: 0.5 }
      if (side) {
        const bg = getComputedStyle(side).backgroundColor
        const m = /rgba?\(([^)]+)\)/.exec(bg)
        if (m) {
          const p = m[1].split(',').map((v) => parseFloat(v))
          panel = {
            r: p[0] ?? 0,
            g: p[1] ?? 0,
            b: p[2] ?? 0,
            a: Number.isFinite(p[3]) ? (p[3] as number) : 1
          }
        }
      }
      root.setAttribute('data-glass-text', pickTextTone(compositeLuma(panel, backdrop)))
    })
    return () => {
      cancelled = true
    }
  }, [ui?.wallpaperImage, ui?.themeMode, ui?.material])
}
