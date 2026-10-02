import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * 第 1 轮拆分结构守卫（docs/APP-TSX-SPLIT-ASSESSMENT.md）。
 *
 * 目的：防"搬一半/搬重复/悄悄回退"——断言被搬出的组件确实在新文件里导出、
 * App.tsx 确实改为 import 且不再自行定义。**只查结构，不查行为**（行为由 596 单测 + 58 集成覆盖）。
 */
const APP = resolve(__dirname, '../../src/renderer/src/App.tsx')
const SP = resolve(__dirname, '../../src/renderer/src/settings/SettingsPage.tsx')
const PP = resolve(__dirname, '../../src/renderer/src/page-props.ts')

describe('第 1 轮：SettingsPage 拆分结构', () => {
  it('新文件存在并导出 SettingsPage / ModuleManagePanel', async () => {
    const sp = await readFile(SP, 'utf8')
    expect(sp, 'SettingsPage 应在新文件里导出').toContain('export function SettingsPage(')
    // 第 3 轮已把 ModuleManagePanel 拆到独立文件（settings/ModuleManagePanel.tsx）
    expect(sp, 'SettingsPage 应改为 import ModuleManagePanel').toContain("from './ModuleManagePanel'")
  })

  it('App.tsx 改为 import 且不再自行定义被搬出的符号', async () => {
    const app = await readFile(APP, 'utf8')
    // D② 之后 SettingsPage 的引用方是 ContentArea（App 只经布局壳间接使用）
    // ⇒ 断言改为"若 App 仍引用它就必须 import"，并把"谁来 import"前移到新的持有者。
    if (app.includes('SettingsPage')) {
      expect(app, 'App 若引用 SettingsPage，必须 import 它').toContain("from './settings/SettingsPage'")
    }
    const content = await readFile(
      resolve(__dirname, '../../src/renderer/src/shell/ContentArea.tsx'),
      'utf8'
    )
    expect(content, 'ContentArea 应 import SettingsPage').toContain("from '../settings/SettingsPage'")
    expect(app, 'App 不应再定义 SettingsPage').not.toContain('function SettingsPage(')
    expect(app, 'App 不应再定义 ModuleManagePanel').not.toContain('function ModuleManagePanel(')
    expect(app, 'App 不应再定义 WebToolUrl').not.toContain('function WebToolUrl(')
    expect(app, 'App 不应再定义 WebToolButton').not.toContain('function WebToolButton(')
  })

  it('共用的 PageProps 类型已提到中立模块，消费方都从中立模块 import（避免子文件反向依赖 App）', async () => {
    const pp = await readFile(PP, 'utf8')
    expect(pp).toContain('export interface PageProps')
    const sp = await readFile(SP, 'utf8')
    expect(sp, 'SettingsPage 应 import PageProps').toContain("from '../page-props'")
    // 第 2 轮把 DiagnosticsPage 也搬出后，App.tsx 已不再使用 PageProps（导入被正确修剪）
    // ⇒ 断言改为「若 App 使用该类型，则必须从中立模块导入」，避免守卫绑死在某个具体轮次上。
    const app = await readFile(APP, 'utf8')
    if (app.includes('PageProps')) {
      expect(app, 'App 若使用 PageProps，必须从中立模块导入').toContain("from './page-props'")
    }
    const dp = await readFile(resolve(__dirname, '../../src/renderer/src/diagnostics/DiagnosticsPage.tsx'), 'utf8')
    expect(dp, 'DiagnosticsPage 应 import PageProps').toContain("from '../page-props'")
  })
})
