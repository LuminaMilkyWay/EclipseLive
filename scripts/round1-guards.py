"""第 1 轮收尾：把两条结构守卫的扫描目标扩展为「App.tsx + 新文件」，并新增本轮结构守卫。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def patch(rel, subs, insert_after=None, insert_line=None):
    p = os.path.join(ROOT, rel)
    txt = open(p, encoding="utf-8").read()
    before = txt
    for a, b in subs:
        assert a in txt, (rel, a[:60])
        txt = txt.replace(a, b)
    if insert_after and insert_line and insert_line not in txt:
        assert insert_after in txt
        txt = txt.replace(insert_after, insert_after + "\n" + insert_line, 1)
    assert txt != before
    open(p, "w", encoding="utf-8", newline="\n").write(txt)
    print("PATCHED=" + rel)

SP = "src/renderer/src/settings/SettingsPage.tsx"
sp_line = "const SP_PATH = resolve(__dirname, '../../src/renderer/src/" + SP.replace("src/renderer/src/", "") + "')"

patch("tests/unit/theme.spec.ts", [
    ("const src = await readFile(APP_PATH, 'utf8')",
     "const src = (await readFile(APP_PATH, 'utf8')) + (await readFile(SP_PATH, 'utf8'))"),
], insert_after="const APP_PATH = resolve(__dirname, '../../src/renderer/src/App.tsx')", insert_line=sp_line)

patch("tests/unit/components.spec.ts", [
    ("const src = await load(APP_PATH)",
     "const src = (await load(APP_PATH)) + (await load(SP_PATH))"),
    ("const jsx = await load(APP_PATH)",
     "const jsx = (await load(APP_PATH)) + (await load(SP_PATH))"),
], insert_after="const APP_PATH = resolve(__dirname, '../../src/renderer/src/App.tsx')", insert_line=sp_line)

guard = '''import { describe, expect, it } from 'vitest'
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
    expect(sp, 'ModuleManagePanel 应随 SettingsPage 一并搬出（它将由第 3 轮再拆）').toContain(
      'export function ModuleManagePanel('
    )
  })

  it('App.tsx 改为 import 且不再自行定义被搬出的符号', async () => {
    const app = await readFile(APP, 'utf8')
    expect(app, 'App 应从新文件导入 SettingsPage').toContain("from './settings/SettingsPage'")
    expect(app, 'App 不应再定义 SettingsPage').not.toContain('function SettingsPage(')
    expect(app, 'App 不应再定义 ModuleManagePanel').not.toContain('function ModuleManagePanel(')
    expect(app, 'App 不应再定义 WebToolUrl').not.toContain('function WebToolUrl(')
    expect(app, 'App 不应再定义 WebToolButton').not.toContain('function WebToolButton(')
  })

  it('共用的 PageProps 类型已提到中立模块，双方都 import（避免子文件反向依赖 App）', async () => {
    const pp = await readFile(PP, 'utf8')
    expect(pp).toContain('export interface PageProps')
    const app = await readFile(APP, 'utf8')
    const sp = await readFile(SP, 'utf8')
    expect(app, 'App 应 import PageProps').toContain("from './page-props'")
    expect(sp, 'SettingsPage 应 import PageProps').toContain("from '../page-props'")
  })
})
'''
open(os.path.join(ROOT, "tests/unit/app-split-round1.spec.ts"), "w", encoding="utf-8", newline="\n").write(guard)
print("WROTE=tests/unit/app-split-round1.spec.ts")
