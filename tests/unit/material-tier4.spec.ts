import { describe, expect, it } from 'vitest'
import { validateUiSettings, uiDefaults } from '../../src/shared/theme'

/**
 * T37 档 4（全液态玻璃）：档位取值扩到 1–4。
 *
 * 背景：现有三档 = 1 纯高斯模糊 / 2 半高斯半液态（默认）/ 3 液态玻璃。
 * 本次新增 **档 4「全液态玻璃」**：折射最强 + 真色散 + 烘焙高光/位移图 + 场景层拉满。
 *
 * 本文件只测"档位取值契约"（校验与默认值）；材质本身的光学断言见
 * `tests/unit/theme.spec.ts`（renderer.css 的令牌块）与
 * `tests/unit/glass-bake.spec.ts`（烘焙生成器的确定性）。
 */
describe('T37 材质档位：扩到 1–4', () => {
  it('四档都合法（1/2/3/4）', () => {
    for (const m of [1, 2, 3, 4]) {
      const r = validateUiSettings({ ...uiDefaults, material: m })
      expect(r.ok, `档 ${m} 应被接受：${r.errors.join('; ')}`).toBe(true)
    }
  })

  it('越界与非法值仍被拒绝（0 / 5 / 字符串 / 缺失 / 小数）', () => {
    for (const bad of [0, 5, -1, '4', null, undefined, 3.5]) {
      const r = validateUiSettings({ ...uiDefaults, material: bad })
      expect(r.ok, `material=${String(bad)} 应被拒绝`).toBe(false)
    }
  })

  it('默认档仍是 2（老用户配置不受影响）', () => {
    expect(uiDefaults.material).toBe(2)
  })

  it('★ 档 4 的 CSS：光学/控件/可读性/烘焙切换四组规则齐备（读真实的 renderer.css）', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const css = await readFile(join(process.cwd(), 'src/renderer/src/renderer.css'), 'utf8')
    // 剥掉注释后再做"不得包含"类断言 —— 说明性注释里会提到被移除的 id/属性（注释子串陷阱）。
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')

    // ① 档 4 光学本体
    expect(css).toContain("[data-material='4'] {")
    expect(css, '档 4 应有自己的折射定义').toMatch(/\[data-material='4'\][\s\S]{0,2600}--mat-refract:/)
    expect(css, '档 4 场景层应拉满').toMatch(/\[data-material='4'\][\s\S]{0,2600}--mat-scene-op: 1;/)

    // ② 控件配套材质 + 交互瞬间才取用液态玻璃
    expect(css, '档 4 应有控件镜面高光令牌').toMatch(/\[data-material='4'\][\s\S]{0,1200}--ctrl-specular:/)
    expect(
      css,
      '档 4 控件的模糊必须挂在 hover/active 上（静止态零成本）'
    ).toMatch(/\[data-material='4'\] \.btn:not\(:disabled\):hover/)

    // ③ 可读性：提文字对比度（且不得再用整面薄纱）
    expect(css, '档 4 应提升次级文字对比度').toMatch(/\[data-material='4'\][\s\S]{0,3200}--txt-2:/)
    expect(css.includes('var(--mat-veil)'), '不得重新引入整面薄纱').toBe(false)
    expect(cssCode, '亮背景暗压层已移除（其依赖的运行时采样不可用）').not.toContain('data-backdrop-luma')

    // ④ 折射接线（**重做后的正确形态**）
    //    教训：烘焙位移图必须由**场景层的普通 filter**（--mat-refract）消费，
    //    绝不能挂到面板的 backdrop-filter —— 那条路径对 feImage 支持有限，
    //    整条滤镜列表被丢弃时连 blur() 一起失效（用户实测"玻璃效果消失"）。
    expect(cssCode, '静态强折射滤镜必须仍在（回退路径）').toContain('url(#glass-refract-strong)')
    expect(cssCode, '烘焙折射应由 data-baked 门控').toContain("[data-material='4'][data-baked='1']")
    expect(cssCode, '烘焙折射必须由 --mat-refract 承载（场景层）').toMatch(
      /--mat-refract:[^;]*url\(#glass-refract-baked\)/
    )
    expect(
      cssCode.includes('backdrop-filter: blur(var(--wallpaper-blur)) url(#glass-refract-baked)'),
      '烘焙滤镜不得出现在 backdrop-filter 值里'
    ).toBe(false)

    // ⑤ 材质化过渡（研究诊断 #13）：档 4 用**专属关键帧**调制折射量；
    //    基础关键帧必须保持原样（前三档不受影响 —— 见 material-tiers-1-3-frozen.spec.ts）。
    expect(css, '@property 应把 --mat-scene-op 注册为可动画数值').toContain('@property --mat-scene-op')
    for (const kf of ['el-materialize-in', 'el-materialize-pop-in']) {
      const start = css.indexOf(`@keyframes ${kf}`)
      expect(start, `缺少档 4 专属关键帧 ${kf}`).toBeGreaterThanOrEqual(0)
      const body = css.slice(start, css.indexOf('\n}', start))
      expect(body, `${kf} 应调制折射量（材质化而非纯淡入）`).toContain('--mat-scene-op')
      expect(body, `${kf} 仍应保留 transform/opacity`).toContain('transform')
      expect(body).toContain('opacity')
    }
    expect(css, '档 4 应覆盖动画名（不动基础关键帧）').toMatch(
      /\[data-material='4'\] \.modal-panel\s*\{\s*animation-name: el-materialize-pop-in/
    )

    // ⑥ "灰色薄纱底图"回归守卫（用户实测两次出现）
    //    教训：任何**成片**覆盖（面板级高光 / 长条承托带 / 未验证滤镜）都会被读成糊了一层灰。
    // 指针光斑：**全视口固定层**（用户定义："以指针为中心的圆形光斑"），
    // 不得再出现"把径向渐变画在面板上"的写法（那正是上一版错位、摊成灰雾的原因）。
    expect(cssCode, '指针光斑应由全视口固定层承载').toMatch(/body::after\s*\{[^}]*position:\s*fixed/)
    expect(cssCode, '不得把指针光斑画在面板上').not.toMatch(
      /:root\[data-light='1'\]\s*\.(side|tool-bar|modal-panel|card)/
    )
    expect(cssCode, '局部承托带已移除').not.toMatch(/\[data-backdrop-luma='bright'\] \.nav-item/)
    // 控件 hover 高光：只作用在控件自身，位置由元素边界决定（恒正确）
    expect(css, '应有控件 hover 顶部高光').toMatch(
      /\[data-material='4'\] \.btn:not\(:disabled\):hover[\s\S]{0,260}background-image/
    )
    // ⑦ 令牌**不得自引用**：`--x: … var(--x) …` 是无效值 ⇒ 令牌计算为空、
    //    所有 var(--x) 消费者一起失效（实测抓到：档 4 的 --txt-2 为空串，档 2 为 #8f9ab5）。
    const selfRef = /(--[a-z0-9-]+)\s*:\s*[^;{}]*var\(\1\)/g
    const offenders = [...cssCode.matchAll(selfRef)].map((m) => m[1])
    expect(offenders, `令牌自引用（会让整个令牌变空）：${offenders.join(', ')}`).toEqual([])

    // ⑧ 档 4 的控件面必须**不透明**：半透明面压在壁纸上会变成发闷的深色块（"纯色"观感）
    expect(css, '档 4 控件面不得用半透明 color-mix').not.toMatch(
      /\[data-material='4'\][\s\S]{0,900}--ctrl-bg:\s*color-mix/
    )
    // ⑨ ★ 规范红线（AI_RULES 第 24 条，写死）：**不准出现"灰色薄纱底图"**。
    //    把已复现过的四种形态全部纳入机械检查 —— 它们看得见，用户实测一律读成"糊了一层灰"。
    expect(cssCode, '不得把面板底色混入暗色（"暗色调"）').not.toMatch(
      /--(card|std)-bg:\s*color-mix\([^;]*--scrim/
    )
    expect(cssCode, '不得再出现整面/面板级暗压渐变').not.toMatch(
      /background-image:\s*linear-gradient\(\s*color-mix\(in srgb,\s*var\(--scrim\)/
    )
    expect(cssCode, '不得再出现局部承托带').not.toMatch(/\[data-backdrop-luma='bright'\]\s*\.nav-item/)
    expect(cssCode.includes('--mat-veil'), '不得重新引入整面薄纱').toBe(false)

    // ⑩ ★ "均匀灰面"守卫（AI_RULES 24 的机械代理 —— 用户反复指出的"灰色薄纱"就是这个）
    //    均匀灰面 = 重度模糊把底图抹平，或面太实把底图盖住 ⇒ 两个数都必须有上限。
    const blur = /\[data-material='4'\][\s\S]{0,2200}--mat-blur:\s*(\d+)px/.exec(cssCode)
    expect(blur, '档 4 必须有 --mat-blur').toBeTruthy()
    expect(
      Number(blur![1]),
      '档 4 的模糊不得超过 14px（再高就会把底图抹成均匀灰面 = 灰纱）'
    ).toBeLessThanOrEqual(14)

    const role = /\[data-material='4'\][\s\S]{0,2200}--mat-alpha-role:\s*([\d.]+)/.exec(cssCode)
    expect(role, '档 4 必须有 --mat-alpha-role').toBeTruthy()
    expect(
      Number(role![1]),
      '档 4 的大面不透明度不得超过 0.55（否则玻璃变实、底图被盖住 = 灰纱）'
    ).toBeLessThanOrEqual(0.55)

    const brightness = /brightness\(([\d.]+)\)/.exec(cssCode)
    expect(brightness, '明度调整（苹果自适应明度）必须在位').toBeTruthy()
    expect(
      Number(brightness![1]),
      '明度不得压到 0.85 以下（压太狠就成"压暗=灰"）'
    ).toBeGreaterThanOrEqual(0.85)
  })
})
