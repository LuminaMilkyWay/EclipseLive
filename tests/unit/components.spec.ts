import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/* ---------- 组件库（T20）：PRODUCT.md 组件规范 13 类 ---------- */

const CSS_PATH = resolve(__dirname, '../../src/renderer/src/renderer.css')
const UI_PATH = resolve(__dirname, '../../src/renderer/src/ui.tsx')
const APP_PATH = resolve(__dirname, '../../src/renderer/src/App.tsx')
const TS_PATH = resolve(__dirname, '../../src/renderer/src/screens/TitleScreen.tsx')
const MP_PATH = resolve(__dirname, '../../src/renderer/src/settings/ModuleManagePanel.tsx')
const SP_PATH = resolve(__dirname, '../../src/renderer/src/settings/SettingsPage.tsx')
// D 方案（布局壳拆分）后，原先位于 App.tsx 的布局 JSX 分散到 shell/ 下：
// 这些守卫检查的"碎片样式清零 / 接入新组件"必须同时覆盖新的持有者（断言语义不变）。
const SHELL_PATHS = [
  resolve(__dirname, '../../src/renderer/src/shell/Sidebar.tsx'),
  resolve(__dirname, '../../src/renderer/src/shell/ContentArea.tsx'),
  resolve(__dirname, '../../src/renderer/src/shell/ToolBar.tsx')
]

async function load(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

/** 提取类块体（组件块无嵌套；贪婪到第一个 }）。 */
function classBlock(css: string, cls: string): string | null {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  return m ? m[1] : null
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/

/** 13 类组件的 CSS 类清单（按钮四变体归「按钮」一类计）。 */
const COMPONENT_CLASSES = [
  // 按钮（主要/次要/危险/文字 + 大尺寸）
  '.btn',
  '.btn-primary',
  '.btn-secondary',
  '.btn-danger',
  '.btn-text',
  '.btn-lg',
  // 开关 / 选择器 / 滑块 / 输入框
  '.switch',
  '.select',
  '.slider',
  '.input',
  // 分组卡片（既有）/ 列表行 / 徽章（既有）
  '.card',
  '.list-row',
  '.badge',
  // 模态框 / 确认对话框 / Toast / 空状态
  '.modal',
  '.modal-panel',
  '.confirm-dialog',
  '.toast',
  '.empty-state'
]

/** ui.tsx 应导出的组件（SegGroup 自 App.tsx 迁入一并归口）。 */
const UI_EXPORTS = [
  'Btn',
  'Switch',
  'Select',
  'Slider',
  'TextInput',
  'SegGroup',
  'ListRow',
  'Badge',
  'Modal',
  'ConfirmDialog',
  'Toast',
  'EmptyState'
]

describe('组件库 CSS 类齐全（PRODUCT.md 13 类）', () => {
  it('每类组件都有独立样式块', async () => {
    const css = await load(CSS_PATH)
    for (const cls of COMPONENT_CLASSES) {
      expect(classBlock(css, cls), `缺少组件样式块 ${cls}`).not.toBeNull()
    }
  })

  it('组件块消费设计令牌且零颜色字面量', async () => {
    const css = await load(CSS_PATH)
    for (const cls of COMPONENT_CLASSES) {
      const body = classBlock(css, cls)
      expect(body, `缺少组件样式块 ${cls}`).not.toBeNull()
      expect(body, `${cls} 未消费设计令牌 var(--…)`).toMatch(/var\(--/)
      expect(COLOR_LITERAL.test(body ?? ''), `${cls} 含颜色字面量`).toBe(false)
    }
  })
})

describe('组件库模块 ui.tsx', () => {
  it('导出 12 个组件齐全', async () => {
    const src = await load(UI_PATH)
    for (const name of UI_EXPORTS) {
      expect(src, `ui.tsx 缺少导出 ${name}`).toMatch(
        new RegExp(`export (?:function|const) ${name}\\b`)
      )
    }
  })
})

describe('界面接入统一组件', () => {
  it('App.tsx：window.confirm / 碎片按钮类 / settings-range 清零，接入新组件', async () => {
    const src = (await load(APP_PATH)) + (await load(SP_PATH)) + (await load(MP_PATH)) + (await load(TS_PATH)) +
      (await Promise.all(SHELL_PATHS.map((p) => load(p)))).join('\n')
    expect(src, 'window.confirm 应清零（统一 ConfirmDialog）').not.toContain('window.confirm')
    expect(src, 'className="danger" 碎片类应清零（统一 Btn variant）').not.toContain(
      'className="danger"'
    )
    expect(src, '.settings-range 应清零（统一 Slider）').not.toContain('settings-range')
    expect(src, '应接入 ConfirmDialog').toContain('<ConfirmDialog')
    expect(src, '应接入 Toast').toContain('<Toast')
    expect(src, '应接入 EmptyState').toContain('<EmptyState')
  })

  it('renderer.css：碎片按钮/消息样式清零', async () => {
    const css = await load(CSS_PATH)
    expect(css, '.page-actions button 碎片样式应清零').not.toContain('.page-actions button')
    expect(css, '.settings-actions button 碎片样式应清零').not.toContain('.settings-actions button')
    expect(css, 'button.danger 碎片样式应清零').not.toContain('button.danger')
    expect(css, '.action-message 应清零（统一 Toast）').not.toContain('.action-message')
  })
})

/* ---------- 按钮四态（T-A2）：焦点 / 禁用 / 悬停 / 按压 ---------- */

describe('按钮四态（T-A2）', () => {
  /** 取指定选择器的块体（允许选择器里出现 :not()/:hover 等）。 */
  function blockOf(css: string, selector: string): string | null {
    const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    return m ? m[1] : null
  }

  it('焦点态：outline 2px 强调色，且不改变布局（不用 border/尺寸）', async () => {
    const css = await load(CSS_PATH)
    // T48：焦点环已扩展为全站统一多选择器规则（.btn/.nav-item/.dock-item/... 共用一个块），
    // 匹配"选择器列表中包含 .btn:focus-visible"的块；断言语义不变。
    const m = /\.btn:focus-visible[^{]*\{([^}]*)\}/.exec(css)
    const focus = m ? m[1] : null
    expect(focus, '缺少 .btn:focus-visible（键盘焦点不可见）').toBeTruthy()
    expect(focus!, '焦点环应为 outline（不占布局）').toContain('outline')
    expect(focus!, '焦点环宽度应为 2px').toMatch(/outline:\s*2px/)
    expect(focus!, '焦点环颜色应走强调色令牌').toContain('var(--acc)')
    expect(focus!, '焦点态不得改 border（会推动布局）').not.toContain('border')
    expect(focus!, '焦点态不得改尺寸').not.toMatch(/\b(width|height|padding|margin)\s*:/)
  })

  it('禁用态：透明度 0.5 + 无动效 + 禁用手型', async () => {
    const css = await load(CSS_PATH)
    const dis = blockOf(css, '.btn:disabled')
    expect(dis, '缺少 .btn:disabled（禁用与可用外观无差别）').toBeTruthy()
    expect(dis!, '禁用态透明度应为 0.5').toMatch(/opacity:\s*0\.5/)
    expect(dis!, '禁用态应显式关闭过渡').toMatch(/transition:\s*none/)
    expect(dis!, '禁用态光标应为 not-allowed').toContain('not-allowed')
  })

  it('交互态被 :not(:disabled) 守卫（禁用按钮不得响应悬停/按压）', async () => {
    const css = await load(CSS_PATH)
    expect(blockOf(css, '.btn:not(:disabled):hover'), '缺少 :not(:disabled):hover').toBeTruthy()
    expect(blockOf(css, '.btn:not(:disabled):active'), '缺少 :not(:disabled):active').toBeTruthy()
    // 不得再有裸的 .btn:hover / .btn:active（含聚合选择器里的成员）
    expect(css, '不得存在裸 .btn:hover').not.toMatch(/(^|[\s,])\.btn:hover/m)
    expect(css, '不得存在裸 .btn:active').not.toMatch(/(^|[\s,])\.btn:active/m)
  })

  it('变体各守其色：危险按钮悬停不得被改成强调色（B6 回归）', async () => {
    const css = await load(CSS_PATH)
    const dangerHover = blockOf(css, '.btn-danger:not(:disabled):hover')
    expect(dangerHover, '缺少 .btn-danger:not(:disabled):hover').toBeTruthy()
    expect(dangerHover!, '危险按钮悬停应保持危险色').toContain('var(--bad)')
    expect(dangerHover!, '危险按钮悬停不得变成强调色').not.toContain('var(--acc)')
    const primaryHover = blockOf(css, '.btn-primary:not(:disabled):hover')
    expect(primaryHover, '缺少 .btn-primary:not(:disabled):hover').toBeTruthy()
    // 悬停应强化到强调色系（T-A4 起为 --acc-soft 提亮；此处只要求仍在 --acc 家族内）
    expect(primaryHover!, '主按钮悬停应强化强调色系').toContain('var(--acc')
  })

  it('按压缩放落在 0.97–0.99（规范区间）', async () => {
    const css = await load(CSS_PATH)
    const active = blockOf(css, '.btn:not(:disabled):active')
    const m = /scale\(([\d.]+)\)/.exec(active ?? '')
    expect(m, '按压态应使用 scale()').toBeTruthy()
    const s = parseFloat(m![1])
    expect(s, `按压缩放 ${s} 低于 0.97`).toBeGreaterThanOrEqual(0.97)
    expect(s, `按压缩放 ${s} 高于 0.99`).toBeLessThanOrEqual(0.99)
  })

  it('阴影三态走 --ctrl-shadow-* 令牌（悬停增强、按压减小）', async () => {
    const css = await load(CSS_PATH)
    // 主题层必须给两套主题都定义三档阴影
    for (const theme of ['dark', 'light']) {
      const themeBlock = new RegExp(`\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`).exec(css)
      expect(themeBlock, `缺少 data-theme='${theme}' 块`).toBeTruthy()
      for (const name of ['--ctrl-shadow-rest', '--ctrl-shadow-hover', '--ctrl-shadow-press']) {
        expect(themeBlock![1], `主题 ${theme} 缺少 ${name}`).toContain(`${name}:`)
      }
    }
    expect(blockOf(css, '.btn')!, '静止态应消费 --ctrl-shadow-rest').toContain('var(--ctrl-shadow-rest)')
    expect(
      blockOf(css, '.btn:not(:disabled):hover')!,
      '悬停态应消费 --ctrl-shadow-hover'
    ).toContain('var(--ctrl-shadow-hover)')
    expect(
      blockOf(css, '.btn:not(:disabled):active')!,
      '按压态应消费 --ctrl-shadow-press'
    ).toContain('var(--ctrl-shadow-press)')
  })
})

/* ---------- 按钮变体与尺寸（T-A4） ---------- */

describe('按钮变体与尺寸（T-A4）', () => {
  function blockOf(css: string, selector: string): string | null {
    const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    return m ? m[1] : null
  }

  it('主按钮是「强调色实底 + 专用前景色」，不再是 8% 透明底', async () => {
    const css = await load(CSS_PATH)
    const primary = blockOf(css, '.btn-primary')
    expect(primary, '缺少 .btn-primary').toBeTruthy()
    expect(primary!, '主按钮应为强调色实底').toContain('background: var(--acc)')
    expect(primary!, '主按钮前景应走专用墨色（对比度）').toContain('var(--ink-on-acc)')
    expect(primary!, '主按钮不得再用 8% 强调底').not.toContain('--acc-fill')
    const hover = blockOf(css, '.btn-primary:not(:disabled):hover')
    expect(hover, '主按钮悬停态应有 :not(:disabled) 守卫').toBeTruthy()
    expect(hover!, '主按钮悬停应提亮到强调浅色').toContain('var(--acc-soft)')
  })

  it('危险按钮有可辨的危险底色（不只是描边变色）', async () => {
    const css = await load(CSS_PATH)
    const danger = blockOf(css, '.btn-danger')
    expect(danger, '缺少 .btn-danger').toBeTruthy()
    expect(danger!, '危险按钮应有危险色底').toMatch(/color-mix\(in srgb, var\(--bad\)/)
    expect(danger!, '危险按钮应消费危险描边令牌').toContain('var(--bad-line)')
    expect(danger!, '危险按钮文字应走危险色').toContain('var(--bad)')
  })

  it('新增「文字」变体：无底无边，悬停才出中性层', async () => {
    const css = await load(CSS_PATH)
    const text = blockOf(css, '.btn-text')
    expect(text, '缺少 .btn-text（规范四类里的「文字」按钮）').toBeTruthy()
    expect(text!, '文字按钮应无边框').toMatch(/border-color:\s*transparent/)
    expect(text!, '文字按钮应无底色').toMatch(/background:\s*transparent/)
    const hover = blockOf(css, '.btn-text:not(:disabled):hover')
    expect(hover, '文字按钮悬停态应带守卫').toBeTruthy()
    expect(hover!, '文字按钮悬停应出中性状态层').toContain('var(--state-hover)')
    expect(hover!, '文字按钮悬停文字应提亮').toContain('var(--txt-1)')
  })

  it('新增大尺寸修饰：更大内边距 + 更大圆角', async () => {
    const css = await load(CSS_PATH)
    const lg = blockOf(css, '.btn-lg')
    expect(lg, '缺少 .btn-lg').toBeTruthy()
    expect(lg!, '大尺寸应走间距令牌').toMatch(/padding:\s*var\(--sp-\d\)/)
    expect(lg!, '大尺寸圆角应走更大档令牌').toContain('var(--r-lg)')
  })

  it('标题页入口按钮收归体系：自身不再重绘按钮皮肤', async () => {
    const css = await load(CSS_PATH)
    const jsx = (await load(APP_PATH)) + (await load(SP_PATH)) + (await load(MP_PATH)) + (await load(TS_PATH)) +
      (await Promise.all(SHELL_PATHS.map((p) => load(p)))).join('\n')
    const titleEnter = blockOf(css, '.title-enter')
    expect(titleEnter, '缺少 .title-enter').toBeTruthy()
    // 只允许保留布局（间距），皮肤交给 .btn + 变体
    for (const banned of ['background', 'border:', 'border-color', 'border-radius', 'color:', 'font-size']) {
      expect(titleEnter!, `.title-enter 不得再自绘 ${banned}`).not.toContain(banned)
    }
    expect(titleEnter!, '.title-enter 应保留布局间距').toContain('margin-top')
    expect(css, '.title-enter:hover 应清除（悬停交给变体）').not.toContain('.title-enter:hover')
    expect(jsx, '入口按钮应使用 primary 变体 + 大尺寸').toMatch(/title-enter[^"]*btn-lg|btn-lg[^"]*title-enter/)
    expect(jsx, '入口按钮应声明 primary 变体').toMatch(/variant="primary"/)
  })

  it('新增变体的悬停态一律带 :not(:disabled) 守卫', async () => {
    const css = await load(CSS_PATH)
    for (const v of ['.btn-primary', '.btn-danger', '.btn-text']) {
      expect(blockOf(css, `${v}:not(:disabled):hover`), `${v} 悬停缺少守卫`).toBeTruthy()
      expect(css, `${v}:hover 裸写残留`).not.toMatch(new RegExp(`(^|[\\s,])${v.replace('.', '\\.')}:hover`, 'm'))
    }
  })

  it('变体集合与规范四类严格一致（主要/次要/文字/危险），无多余类', async () => {
    const css = await load(CSS_PATH)
    const src = await load(UI_PATH)
    // BtnVariant 联合类型必须恰好是四类
    const union = /export type BtnVariant = ([^\n]+)/.exec(src)
    expect(union, '未找到 BtnVariant').toBeTruthy()
    const kinds = [...union![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    expect(kinds, '变体集合应与规范四类一致').toEqual(['danger', 'primary', 'secondary', 'text'])
    // 每类都要有独立样式块；且全站不得残留已废弃的 .btn-icon
    for (const k of kinds) {
      expect(blockOf(css, `.btn-${k}`), `缺少 .btn-${k} 样式块`).toBeTruthy()
    }
    expect(css.replace(/\/\*[\s\S]*?\*\//g, ''), '.btn-icon 已废弃（正名为 .btn-text），不得残留生效规则').not.toContain(
      '.btn-icon'
    )
    expect(src, 'ui.tsx 不得再声明 icon 变体').not.toContain("'icon'")
  })
})

/* ---------- 按钮加载态（T-A3）：spinner + 防重复点击 ---------- */

describe('按钮加载态（T-A3）', () => {
  function blockOf(css: string, selector: string): string | null {
    const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    return m ? m[1] : null
  }

  it('spinner 令牌就位：--ease-linear 与 --duration-spin（例外写进令牌集，不开守卫特例）', async () => {
    const css = await load(CSS_PATH)
    const root = /:root\s*\{([^}]*)\}/.exec(css)
    expect(root, '缺少 :root').toBeTruthy()
    expect(root![1], '缺少 --ease-linear（加载旋转的显式例外）').toMatch(/--ease-linear:\s*linear/)
    expect(root![1], '缺少 --duration-spin').toMatch(/--duration-spin:\s*\d+ms/)
  })

  it('spinner 只做旋转：动画消费令牌，且圆角/尺寸走令牌', async () => {
    const css = await load(CSS_PATH)
    const spinner = blockOf(css, '.spinner')
    expect(spinner, '缺少 .spinner').toBeTruthy()
    expect(spinner!, 'spinner 动画须消费时长令牌').toContain('var(--duration-spin)')
    expect(spinner!, 'spinner 动画须消费缓动令牌（linear 已令牌化）').toContain('var(--ease-linear)')
    expect(spinner!, 'spinner 圆角应走胶囊令牌').toContain('var(--r-pill)')
    expect(spinner!, 'spinner 不得改布局属性').not.toMatch(/\b(margin|padding)\s*:/)
  })

  it('旋转关键帧只允许 transform', async () => {
    const css = (await load(CSS_PATH)).replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /@keyframes\s+el-spin\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(m, '缺少 el-spin 关键帧').toBeTruthy()
    expect(m![1], '旋转关键帧应使用 transform').toContain('transform')
    for (const forbidden of ['width', 'height', 'margin', 'padding', 'filter', 'box-shadow', 'left', 'top']) {
      expect(m![1], `旋转关键帧不得动 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('加载态：文字变淡 + 不被"禁用半透明"误伤 + 禁用手型', async () => {
    const css = await load(CSS_PATH)
    const loading = blockOf(css, ".btn[data-loading='true']")
    expect(loading, "缺少 .btn[data-loading='true']").toBeTruthy()
    expect(loading!, '加载态文字应变淡（走文字令牌）').toContain('var(--txt-2)')
    const loadingDisabled = blockOf(css, ".btn[data-loading='true']:disabled")
    expect(loadingDisabled, '加载态需覆盖禁用态的 0.5 透明度（工作中 ≠ 不可用）').toBeTruthy()
    expect(loadingDisabled!, '加载态透明度应高于禁用态').toMatch(/opacity:\s*0\.7/)
    expect(loadingDisabled!, '加载态光标应为 progress').toContain('progress')
  })

  it('spinner 轨道在深色下可见：轨道色不得取自控件描边', async () => {
    const css = await load(CSS_PATH)
    const spinner = blockOf(css, '.spinner')
    expect(spinner, '缺少 .spinner').toBeTruthy()
    // --ctrl-line 在深色主题下（#2d3752）与控件底（#0d1322）几乎同色，轨道环会消失、
    // 只剩顶弧——12px 下读起来是个橙点而不是转圈。轨道必须取对比度令牌。
    expect(spinner!, 'spinner 轨道应取对比度令牌（--txt-1）').toContain('var(--txt-1)')
    // 负向判定剥注释：说明性注释里会提到被禁的令牌名
    expect(spinner!.replace(/\/\*[\s\S]*?\*\//g, ''), 'spinner 轨道不得用 --ctrl-line').not.toContain(
      'var(--ctrl-line)'
    )
  })

  it('Btn 组件接入 loading：置 disabled + data-loading + aria-busy + 渲染 spinner', async () => {
    const src = await load(UI_PATH)
    expect(src, 'Btn 应支持 loading 属性').toMatch(/loading\??:\s*boolean/)
    expect(src, 'loading 时应置 disabled（原生拦截重复点击）').toMatch(/disabled=\{[^}]*loading/)
    expect(src, 'loading 时应写 data-loading 供 CSS 命中').toMatch(/data-loading=/)
    expect(src, 'loading 时应写 aria-busy 供读屏').toMatch(/aria-busy=/)
    expect(src, 'loading 时应渲染 spinner').toMatch(/className="spinner"/)
  })

  it('run() 具备重入保护（同一操作在途时忽略重复触发）', async () => {
    const src = (await load(APP_PATH)) + (await load(SP_PATH)) + (await load(MP_PATH)) + (await load(TS_PATH)) +
      (await Promise.all(SHELL_PATHS.map((p) => load(p)))).join('\n')
    const runFn = /const run = useCallback\(([\s\S]*?)\n {2}\)/.exec(src)
    expect(runFn, '未找到 run 定义').toBeTruthy()
    expect(runFn![1], 'run 应维护在途键集合').toMatch(/inFlight|busy/i)
    expect(runFn![1], 'run 应在入口处早退').toMatch(/return/)
    expect(src, 'run 应暴露在途状态给按钮（供 loading）').toMatch(/isBusy|inFlight/)
  })
})

/* ---------- Toast 进出场（T49）：进场自 T28 已有，本卡补退场 ---------- */

describe('Toast 进出场（T49）', () => {
  it('退场关键帧 el-toast-out 存在且镜像进场几何（居中不变式）', async () => {
    const css = await load(CSS_PATH)
    const enter = /@keyframes el-toast-in\s*\{([\s\S]*?)\n\}/.exec(css)
    const exit = /@keyframes el-toast-out\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(enter, '缺少 el-toast-in（T28 既有关键帧，不得删改）').toBeTruthy()
    expect(exit, '缺少 el-toast-out 退场关键帧').toBeTruthy()
    const fromBlock = /from\s*\{([^}]*)\}/.exec(exit![1])
    const toBlock = /to\s*\{([^}]*)\}/.exec(exit![1])
    expect(fromBlock && toBlock, 'el-toast-out 必须有 from/to 两帧').toBeTruthy()
    // 居中不变式：两帧都必须保留 translateX(-50%)，否则退场过程中水平跳动
    for (const [name, body] of [
      ['from', fromBlock![1]],
      ['to', toBlock![1]]
    ] as const) {
      expect(body, `${name} 帧必须保持 translateX(-50%) 居中`).toContain('translateX(-50%)')
    }
    expect(fromBlock![1], '退场起点必须不透明').toMatch(/opacity:\s*1/)
    expect(toBlock![1], '退场终点必须透明').toMatch(/opacity:\s*0/)
    expect(toBlock![1], '退场应下沉（与进场 translateY(8px) 对称）').toContain('translateY(8px)')
    expect(fromBlock![1] + toBlock![1], '关键帧只动 transform/opacity，禁颜色字面量').not.toMatch(
      COLOR_LITERAL
    )
  })

  it("[data-closing] 退场规则走令牌并以 forwards 定格末帧", async () => {
    const css = await load(CSS_PATH)
    const rule = /\.toast\[data-closing='true'\]\s*\{([^}]*)\}/.exec(css)
    expect(rule, "缺少 .toast[data-closing='true'] 规则").toBeTruthy()
    expect(rule![1], '必须引用 el-toast-out').toContain('el-toast-out')
    expect(rule![1], '时长必须走令牌（禁裸 ms）').toContain('var(--duration-fast)')
    expect(rule![1], '缓动必须走 --ease-* 令牌').toMatch(/var\(--ease-[a-z-]+\)/)
    expect(rule![1], '必须 forwards 定格末帧（卸载前不回闪到首帧）').toContain('forwards')
  })

  it('ui.tsx：Toast 退场状态机接线（data-closing + 延时卸载 + 可取消）', async () => {
    const src = await load(UI_PATH)
    // props 契约不变（公共接口红线）
    expect(src, 'Toast props 契约不变').toContain('export function Toast({ text }: { text: string | null })')
    const toastFn = /export function Toast\(\{ text \}: \{ text: string \| null \}\) \{([\s\S]*?)\n\}/.exec(src)
    expect(toastFn, '未找到 Toast 组件体').toBeTruthy()
    const body = toastFn![1]
    expect(body, '退场期间必须写 data-closing 供 CSS 命中').toMatch(/data-closing=/)
    expect(body, '卸载必须延时（等退场动画播完再卸载，常量命名 TOAST_EXIT_MS）').toMatch(/TOAST_EXIT_MS/)
    expect(body, '退场窗口内复显/组件卸载必须 clearTimeout（取消待执行卸载）').toContain('clearTimeout')
  })

  it('T51 列表行 hover 反馈：只用状态令牌、走状态过渡、禁用态不给反馈', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    const rule = /\.list-row:hover[^{]*\{([^}]*)\}/.exec(css)
    expect(rule, '应存在 .list-row 的 hover 规则').toBeTruthy()
    const body = rule![1]
    expect(body, 'hover 背景必须取状态令牌').toContain('var(--state-hover)')
    expect(body, '不得在 hover 里改尺寸（红线：不动宽高/内外边距）').not.toMatch(/(^|[^-])(width|height|padding|margin)\s*:/)
    expect(rule![0], '禁用态不应获得 hover 反馈').toContain(':not(:disabled)')
    // 过渡必须走时长令牌，且只过渡颜色类属性
    const tr = /\.list-row\s*\{[^}]*transition:\s*([^;]+);/.exec(css)
    expect(tr, '.list-row 应有 transition').toBeTruthy()
    expect(tr![1], '过渡时长必须走令牌').toContain('var(--duration-')
  })

  it('T52 开关 knob 使用弹簧缓动（仅缓动，属性与时长不变）', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    const rule = /\.switch-knob\s*\{([^}]*)\}/.exec(css)
    expect(rule, '未找到 .switch-knob 规则').toBeTruthy()
    expect(rule![1], 'knob 过渡必须换用 --ease-spring').toContain('var(--ease-spring)')
    expect(rule![1], '过渡属性不变（仍是 transform）').toContain('transform')
    expect(rule![1], '时长仍须走令牌').toContain('var(--duration-')
  })

  it('T53/T54/T55 滚动条一律不显示：以实测滚动容器为准，且仍可滚动', async () => {
    const css = await readFile(CSS_PATH, 'utf8')
    // 真正的滚动容器（`overflow-y: auto` 的宿主）——T54 曾误写 `.content`，T55 修正
    const SCROLLERS = ['.side', '.content-scroll', '.whatsnew-body', '.nav-dropdown']
    for (const sel of SCROLLERS) {
      expect(css, `${sel} 应不显示滚动条（标准属性）`).toMatch(
        new RegExp(`\\${sel}[^{]*\\{[^}]*scrollbar-width:\\s*none`)
      )
      expect(css, `${sel} 应不显示滚动条（webkit 伪元素）`).toMatch(
        new RegExp(`\\${sel}::-webkit-scrollbar[^{]*\\{[^}]*display:\\s*none`)
      )
      if (sel === '.nav-dropdown') continue // 浮层自身不设 overflow
      expect(css, `${sel} 仍必须是滚动容器（overflow-y: auto），隐藏的是"条"不是"能滚动"`).toMatch(
        new RegExp(`\\${sel}[^{]*\\{[^}]*overflow-y:\\s*auto`)
      )
    }
  })
})
