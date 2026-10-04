import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 面板动效守卫（T45）。
 *
 * 依据（探针实测）：专注态列宽若写成裸 `0`，与 `minmax(0,1fr)` **不可插值** ⇒ 浏览器瞬变，
 * 用户看到的就是"右侧面板展开没有过渡"。因此这里钉死：
 * ① 专注态列宽必须是 `minmax(0, 0fr)`（与 `minmax(0, 1fr)` **同单位**才可插值；`0px` 与 `1fr` 仍会瞬变）；
 * ② 展开/收起关键帧必须存在，且收起以 **top right** 为原点（"从右上角开始收起"）；
 * ③ 两段动效的时长/缓动必须引用令牌。
 */
const CSS = resolve(__dirname, '../../src/renderer/src/renderer.css')
const MOTION = resolve(__dirname, '../../src/renderer/src/motion.css')

describe('面板动效（T45）', () => {
  it('① 专注态用**栅格对齐**（不用手算坐标），内容区跨列铺满、菜单盖在其上', async () => {
    const css = await readFile(CSS, 'utf8')
    const side = /:root\[data-focus='1'\]\s*\.side\s*\{([^}]*)\}/.exec(css)
    expect(side, '缺少专注态 .side 规则').toBeTruthy()
    expect(side![1], '菜单必须留在栅格单元里（几何与普通态逐像素一致）').toContain('grid-column: 1')
    expect(side![1], '必须盖在浮动面板之上（用户规格）').toMatch(/z-index:\s*30/)
    expect(side![1], '不得再用手算坐标定位').not.toMatch(/left:\s*var/)
    const content = /:root\[data-focus='1'\]\s*\.content\s*\{([^}]*)\}/.exec(css)
    expect(content, '缺少专注态 .content 规则').toBeTruthy()
    expect(content![1], '内容区必须跨列铺满（向左拓展到原侧栏最左边界）').toContain('grid-column: 1 / -1')
  })

  it('④ 收放方向为上下（用户规格），不再使用缩放/左右位移', async () => {
    const css = await readFile(MOTION, 'utf8')
    // 位移动效挂在内层 .side-inner（带折射的玻璃层不得被 transform 动画）
    const close = /:root\[data-sidebar='collapsed'\]\s*\.side-inner\s*\{([^}]*)\}/.exec(css)
    expect(close, '缺少收起规则').toBeTruthy()
    expect(close![1]).toContain('el-side-drop')
    const open = /:root:not\(\[data-sidebar='collapsed'\]\)\s*\.side-inner\s*\{([^}]*)\}/.exec(css)
    expect(open, '缺少展开规则').toBeTruthy()
    expect(open![1]).toContain('el-side-rise')
  })

  it('④b 覆盖层几何由栅格保证（不得回到手算坐标）', async () => {
    const css = await readFile(CSS, 'utf8')
    const m = /:root\[data-focus='1'\]\s*\.side\s*\{([^}]*)\}/.exec(css)
    expect(m, '缺少专注态覆盖层规则').toBeTruthy()
    expect(m![1], '必须留在栅格单元里（此前手算坐标实测 x/y 各偏 24px、宽高也偏）').toContain('grid-column: 1')
    expect(m![1], '不得再出现手算定位').not.toMatch(/left:\s*var|top:\s*var|width:\s*calc/)
  })

  it('⑥ 时长耦合：面板列宽与侧栏收放必须等长（否则观感"面板展开太快"）', async () => {
    const css = await readFile(CSS, 'utf8')
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(root, '缺少 :root').toBeTruthy()
    const body = root![1]
    const panel = /--duration-panel:\s*([^;]+);/.exec(body)
    const delay = /--duration-collapse-delay:\s*([^;]+);/.exec(body)
    const layout = /--duration-layout:\s*([^;]+);/.exec(body)
    expect(panel && delay && layout, '缺少时长令牌').toBeTruthy()
    // 面板总时长必须 = 侧栏动效时长 + 收起延时（两条动效同时结束）
    expect(layout![1].replace(/\s+/g, '')).toBe('calc(var(--duration-panel)+var(--duration-collapse-delay))')
    // 收起延时与第 ③ 例的过渡延时**同源**（不得再出现裸 200ms）
    // 列宽过渡可能在**另一个** `.shell` 块里（历史上分了两条规则）⇒ 检查全部 .shell 块
    const shellBlocks = [...css.matchAll(/^\.shell\s*\{([\s\S]*?)\n\}/gm)].map((m) => m[1] ?? '')
    expect(shellBlocks.length, '未找到 .shell 规则').toBeGreaterThan(0)
    expect(
      shellBlocks.some((b) => b.includes('var(--duration-layout)')),
      `.shell 的列宽过渡必须用 --duration-layout（当前块：${shellBlocks.length} 个）`
    ).toBe(true)
    const collapsedShellBlocks = [...css.matchAll(/:root\[data-sidebar='collapsed'\]\s*\.shell\s*\{([^}]*)\}/g)].map(
      (m) => m[1] ?? ''
    )
    expect(collapsedShellBlocks.length, '未找到收起态 .shell 规则').toBeGreaterThan(0)
    expect(
      collapsedShellBlocks.some((b) => b.includes('transition-delay: var(--duration-collapse-delay)')),
      `收起延时必须用令牌（当前块：${collapsedShellBlocks.length} 个）`
    ).toBe(true)
  })

  it('⑤ 带折射的玻璃层不得被 transform 动画（否则底图会"游动"）', async () => {
    const css = await readFile(MOTION, 'utf8')
    // 位移动效必须挂在内层 .side-inner，不得挂在 .side（.side 带 backdrop-filter 与 ::before 折射）
    expect(css, '位移动效必须挂 .side-inner').toContain('.side-inner')
    const sideAnimRules = [...css.matchAll(/:root[^{]*\.side\s*\{[^}]*\}/g)].map((m) => m[0])
    for (const r of sideAnimRules) {
      expect(r, `.side 规则里不得出现 transform/animation：${r}`).not.toMatch(/transform:|animation:/)
    }
  })

  it('②b 关键帧必须是上下方向、不得缩放（用户规格：向下回收/向上展开）', async () => {
    const css = await readFile(MOTION, 'utf8')
    const rise = /@keyframes el-side-rise \{([\s\S]*?)\n\}/.exec(css)
    const drop = /@keyframes el-side-drop \{([\s\S]*?)\n\}/.exec(css)
    expect(rise && drop, '缺少关键帧').toBeTruthy()
    for (const [name, body] of [
      ['rise', rise![1]],
      ['drop', drop![1]]
    ] as const) {
      expect(body, `${name} 必须是上下方向（translateY）`).toContain('translateY')
      expect(body, `${name} 不得缩放（会被读成"弹"）`).not.toContain('scale(')
      expect(body, `${name} 不得左右位移`).not.toMatch(/translateX/)
    }
    // 大面板不得使用带回弹的缓动
    const back = /--ease-out-back:\s*([^;]+);/.exec(await readFile(CSS, 'utf8'))
    if (back) expect(back[1], '大面板缓动不得回弹').not.toContain('1.56')
  })

  it('③ 关键帧存在且走令牌（时长/缓动）', async () => {
    const css = await readFile(MOTION, 'utf8')
    expect(css).toContain('@keyframes el-side-rise')
    expect(css).toContain('@keyframes el-side-drop')
    // 只检查**面板收放**那两条规则（含 el-side-* 关键帧的块）；T44 的通用过渡块用别的时长令牌
    const panelBlocks = [...css.matchAll(/:root[^{]*\{[^}]*\}/g)]
      .map((m) => m[0])
      .filter((b) => b.includes('el-side-rise') || b.includes('el-side-drop'))
    expect(panelBlocks.length, '未找到面板收放规则').toBeGreaterThanOrEqual(2)
    for (const body of panelBlocks) {
      expect(body, '面板动效必须使用 --duration-panel').toMatch(/var\(--duration-panel\)/)
      expect(body, '面板动效必须使用 --ease-* 令牌').toMatch(/var\(--ease-[a-z-]+\)/)
    }
  })
})
