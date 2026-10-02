import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * `App.tsx` 体积与 hook 数量**棘轮**（AI_RULES 第 25 条 / docs/CODE-LAYOUT.md）。
 *
 * 存在理由：本项目的教训是"文档是纸，检查是锁"（见 docs/GRAY-VEIL-INCIDENT-LOG.md）——
 * 只写"App.tsx 原则上不新增代码"而没有机械约束，后人（含 AI）会自然地往 App 里加东西。
 *
 * 规则：**行数与 hook 调用次数都不得超过基线**；确有必要的上调，必须在任务卡里写明理由，
 * 并在此处同步基线（让"增长"成为一次显式、可审计的动作）。
 * 基线随每一次合规的拆分而下调（当前：D③ 完成后）。
 */
const APP = resolve(__dirname, '../../src/renderer/src/App.tsx')

/** 基线：D③（布局壳拆分完成）实测值。 */
const BASELINE = {
  // 2026-09-30 同步：T38（Dock 常驻 + 菜单开关）/ T39（专注布局 + 规则表）/ T40（直播中控通道）
  // 三次合规改动合计 +12 总行（345 → 357；含空行）。按本守卫注释规定的路径同步基线。
  totalLines: 357,
  nonEmptyLines: 320,
  useState: 11,
  useEffect: 11,
  useRef: 8,
  useCallback: 8
}

/** 允许的微小余量（格式化/注释导致的 1–2 行漂移）。 */
const SLACK_LINES = 6

describe('App.tsx 体积棘轮（AI_RULES 25）', () => {
  it('行数不超过基线 + 余量', async () => {
    const src = await readFile(APP, 'utf8')
    const lines = src.split('\n')
    const total = lines.length
    const nonEmpty = lines.filter((l) => l.trim() !== '').length
    expect(
      total,
      `App.tsx 总行 ${total} 超过基线 ${BASELINE.totalLines}+${SLACK_LINES}；新代码请按 docs/CODE-LAYOUT.md 落点`
    ).toBeLessThanOrEqual(BASELINE.totalLines + SLACK_LINES)
    expect(
      nonEmpty,
      `App.tsx 有效行 ${nonEmpty} 超过基线 ${BASELINE.nonEmptyLines}+${SLACK_LINES}`
    ).toBeLessThanOrEqual(BASELINE.nonEmptyLines + SLACK_LINES)
  })

  it('hook 调用次数不超过基线（新增状态必须进 hooks/）', async () => {
    const src = await readFile(APP, 'utf8')
    const count = (re: RegExp): number => (src.match(re) ?? []).length
    expect(count(/\buseState[<(]/g), 'App.tsx 的 useState 调用数超过基线').toBeLessThanOrEqual(
      BASELINE.useState
    )
    expect(count(/\buseEffect\s*\(/g), 'App.tsx 的 useEffect 调用数超过基线').toBeLessThanOrEqual(
      BASELINE.useEffect
    )
    expect(count(/\buseRef[<(]/g), 'App.tsx 的 useRef 调用数超过基线').toBeLessThanOrEqual(
      BASELINE.useRef
    )
    expect(count(/\buseCallback\s*\(/g), 'App.tsx 的 useCallback 调用数超过基线').toBeLessThanOrEqual(
      BASELINE.useCallback
    )
  })

  it('App.tsx 只保留编排/路由/布局壳/标题页门：不得再出现被搬出的组件定义', async () => {
    const src = await readFile(APP, 'utf8')
    for (const gone of [
      'function SettingsPage(',
      'function DiagnosticsPage(',
      'function ModuleManagePanel(',
      'function ModulePageHost(',
      'function ToolSlot(',
      'function TitleScreen(',
      'function Sidebar(',
      'function ContentArea(',
      'function ToolBar('
    ]) {
      expect(src.includes(gone), `App.tsx 不应再定义 ${gone}`).toBe(false)
    }
  })
})
