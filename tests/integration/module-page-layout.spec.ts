import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 模块页布局守卫（用户反馈两次"看不到的问题"后补上）。
 *
 * 模块页跑在宿主独立的 `WebContentsView` 里，普通截图抓不到它，所以这里用夹具主进程
 * 单独把页面渲染出来（桩掉 fetch/WebSocket、注入设计令牌），**量取真实排版**。
 *
 * 守的是用户明确抱怨过的两条：
 * 1. 窗口化时下半截开关"没人知道还有"⇒ 内容溢出时必须出现显式提示；
 * 2. 全屏时右侧大片没用上 ⇒ 网格必须铺满可用宽度；热键不多时不该出现滚动。
 * 另附一条：**不得再出现按键/快捷键相关的展示**（该功能已按用户要求彻底移除）。
 */

// 与其它集成 spec 一致：spec 走 CJS，直接 require electron 可执行文件路径
const ELECTRON_BIN = require('electron') as string
const MAIN = resolve('tests/integration/fixtures/module-page-main.cjs')
const PAGE = resolve('modules/vts-controlpad/pages/control.html')

/** 页面用到的设计令牌（量级取自 renderer.css；只影响排版，不追求像素级还原）。 */
const TOKENS = `:root{
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
  --r-sm:6px; --r-md:10px; --r-lg:14px;
  --txt-1:#eaeaf0; --txt-2:#9a9aa8; --bg-0:#0e0e12; --bg-card-2:#1b1b22;
  --line:#2a2a33; --line-strong:#3a3a46;
  --acc:#ffb27a; --acc-fill:rgba(255,178,122,.18); --acc-line:rgba(255,178,122,.5);
  --ok:#8fe3a8; --bad:#ff9a9a; --bad-line:rgba(255,154,154,.5); --ink-on-acc:#1a1206;
  --ctrl-bg:#1b1b22; --ctrl-line:#3a3a46; --fs-xs:12px;
}`

function fakeState(count: number) {
  const hotkeys = Array.from({ length: count }, (_, i) => ({
    id: `hk${i}`,
    name: `热键 ${i + 1}`,
    kind: i % 3 === 0 ? 'toggle' : 'trigger',
    type: i % 3 === 0 ? 'ToggleExpression' : 'TriggerAnimation',
    description: ''
  }))
  return {
    status: 'authenticated',
    detail: '已授权',
    authenticated: true,
    model: { loaded: true, name: '演示模型' },
    hotkeys,
    states: {},
    lastResult: null,
    float: {
      enabled: false,
      clickThrough: false,
      columns: 3,
      bgOpacity: 80,
      error: '',
      shortcutError: ''
    },
    floatHotkeys: []
  }
}

async function render(width: number, height: number, hotkeyCount: number) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [MAIN],
    env: {
      ...process.env,
      PROBE_W: String(width),
      PROBE_H: String(height),
      PROBE_PAGE: PAGE,
      EL_TEST_USERDATA: mkdtempSync(join(tmpdir(), 'el-layout-'))
    }
  })
  try {
    const page = await app.firstWindow()
    await page.addInitScript(
      ({ state, tokens }) => {
        // 集成 spec 走 node 侧 tsconfig（无 DOM lib），故一律经 globalThis 断言取用
        const g = globalThis as unknown as {
          document: {
            createElement(tag: string): { textContent: string }
            head: { append(node: unknown): void }
            addEventListener(type: string, fn: () => void): void
          }
          fetch: unknown
          WebSocket: unknown
        }
        const style = g.document.createElement('style')
        style.textContent = tokens
        g.document.addEventListener('DOMContentLoaded', () => g.document.head.append(style))
        g.fetch = async () => ({ json: async () => state })
        g.WebSocket = class {
          readyState = 1
          send(): void {}
          close(): void {}
        }
      },
      { state: fakeState(hotkeyCount), tokens: TOKENS }
    )
    await page.reload()
    await page.waitForTimeout(500)
    const metrics = await page.evaluate(() => {
      interface Box {
        getBoundingClientRect(): { width: number }
        clientHeight: number
        scrollHeight: number
        hidden: boolean
      }
      const g = globalThis as unknown as {
        document: {
          body: Box
          querySelector(sel: string): Box | null
          querySelectorAll(sel: string): { length: number }
        }
        getComputedStyle(el: unknown): { gridTemplateColumns: string; display: string }
      }
      const grid = g.document.querySelector('.grid')
      const more = g.document.querySelector('.more')
      const btn = g.document.querySelector('.hk')
      const empty = g.document.querySelector('.empty')
      const cols = grid ? g.getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
      return {
        bodyWidth: g.document.body.getBoundingClientRect().width,
        gridWidth: grid ? grid.getBoundingClientRect().width : 0,
        overflowing: grid ? grid.scrollHeight - grid.clientHeight > 4 : false,
        hintVisible: more ? !more.hidden : false,
        buttonWidth: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
        columns: cols,
        keyBadges: g.document.querySelectorAll('.kb, .sb').length,
        // 空态不得在网格显示时仍占位：`.empty{flex:1}` 抢高度会挤掉下半截开关
        // （实测症状：窗口化时开关列表只剩一半，"没人知道下面还有"）
        emptyShown: empty ? g.getComputedStyle(empty).display !== 'none' : false
      }
    })
    return metrics
  } finally {
    await app.close().catch(() => {})
  }
}

test('模块页布局：每行 4–6 个（规范值）、铺满宽度；窗口化溢出时有显式提示', async () => {
  // ① 全屏（宽）：列数应取到规范上限 6，且网格铺满可用宽度
  const wide = await render(1904, 1000, 20)
  expect(
    wide.gridWidth / wide.bodyWidth,
    `全屏下网格应铺满宽度（实际 ${wide.gridWidth}/${wide.bodyWidth}）`
  ).toBeGreaterThan(0.9)
  expect(wide.columns, '全屏下应取到规范上限 6 列').toBe(6)
  expect(wide.emptyShown, '网格显示时不得再渲染空态（会抢走一半高度、挤掉下半截开关）').toBe(false)

  // ② 窗口化（窄而矮）：列数仍须落在规范区间 [4,6]；20 个开关应能全部装下
  //    （空态不再抢高度后，窗口化也不该只剩半截 —— 这正是用户抱怨的场景）
  const small = await render(1264, 640, 20)
  expect(small.columns, '列数不得越出规范区间 4–6').toBeGreaterThanOrEqual(4)
  expect(small.columns, '列数不得越出规范区间 4–6').toBeLessThanOrEqual(6)
  expect(small.emptyShown, '网格显示时不得再渲染空态').toBe(false)
  expect(small.overflowing, '窗口化下 20 个开关应当能全部显示（修复前被空态挤掉一半）').toBe(false)
  expect(small.hintVisible, '不需滚动时不该显示提示').toBe(false)

  // ③ 热键很多时（60 个）：必须溢出，且给出显式提示（否则"没人知道下面还有"）
  const many = await render(1264, 640, 60)
  expect(many.overflowing, '60 个开关应当溢出').toBe(true)
  expect(many.hintVisible, '溢出时必须显示"还有更多"的提示').toBe(true)

  // ④ 按键/快捷键相关展示已彻底移除
  expect(wide.keyBadges, '不得再出现按键徽标或屏幕按钮标注').toBe(0)
  expect(small.keyBadges).toBe(0)
})
