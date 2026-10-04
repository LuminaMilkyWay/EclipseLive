"""清理面向用户界面里的开发术语（Txx / 文件名 / 已实装），并加机械守卫。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# ---------- ① changelog.tsx ----------
p = os.path.join(ROOT, "src", "renderer", "src", "changelog.tsx")
t = open(p, encoding="utf-8").read()
before = t
t = t.replace('暂无更新日志内容（CHANGELOG.md 可能未随包分发）', '暂无更新日志内容')
t = t.replace(
    '应用内只显示最近 {CHANGELOG_IN_APP_VERSIONS} 个版本；完整历史见仓库根 CHANGELOG.md。',
    '应用内只显示最近 {CHANGELOG_IN_APP_VERSIONS} 个版本。',
)
open(p, "w", encoding="utf-8", newline="\n").write(t)
print("CHANGELOG_TSX_FIXED=" + str(t != before))

# ---------- ② SettingsPage.tsx 的分组描述 ----------
p2 = os.path.join(ROOT, "src", "renderer", "src", "settings", "SettingsPage.tsx")
s = open(p2, encoding="utf-8").read()
before2 = s
subs = [
    ("appearance: '减少透明度 / 高对比度 / 减少动态效果：T22 实装。',",
     "appearance: '减少透明度 / 高对比度 / 减少动态效果。',"),
    ("features: '已实装：关闭到托盘、检查更新（默认关闭，仅查 GitHub Releases）。',",
     "features: '关闭到托盘、检查更新（默认关闭）。',"),
    ("modules: '已实装：安装/导入、启停/卸载、打开关闭网页工具、导出样式包、权限查看与撤销、恢复预设（模块管理分区）。',",
     "modules: '安装 / 导入、启停 / 卸载、网页工具开关、导出样式包、权限查看与撤销、恢复预设。',"),
    ("connection: '已实装：OBS WebSocket 端口 / 密码 / 自动重连、本地网关信息展示。',",
     "connection: 'OBS WebSocket 端口 / 密码 / 自动重连、本地网关信息。',"),
    ("diagnostics: '已实装：日志查看、诊断刷新、诊断包导出。',",
     "diagnostics: '日志查看、诊断刷新、诊断包导出。',"),
]
for a, b in subs:
    assert a in s, a[:50]
    s = s.replace(a, b, 1)
open(p2, "w", encoding="utf-8", newline="\n").write(s)
print("SETTINGS_FIXED=" + str(s != before2))

# ---------- ③ 机械守卫 ----------
GUARD = '''import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * 面向用户的文案守卫：**界面里不得出现开发术语**。
 *
 * 用户要求（2026-09-30）：删掉"xx 模块已实装""在 Txx 任务中实现""具体详情见 XXXX.md"这类字样。
 * 本守卫扫描渲染层所有 `.tsx`（**先剥注释** —— 注释不面向用户，允许保留任务号），
 * 断言其中不再出现：任务号 `Txx`、文档文件名 `*.md`、"已实装 / 尚未实装"、"见 xxx.md"。
 */
const RENDERER = resolve(__dirname, '../../src/renderer/src')

/** 剥掉行注释与块注释（JSX 注释 `{/* … */}` 同样被剥掉）。 */
function stripComments(text: string): string {
  return text
    .replace(/\\{\\/\\*[\\s\\S]*?\\*\\/\\}/g, '')
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')
    .replace(/^\\s*\\/\\/.*$/gm, '')
}

async function tsxFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await tsxFiles(full)))
    else if (e.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('面向用户文案：不得出现开发术语', () => {
  it('渲染层 tsx（剥注释后）不含 Txx 任务号 / *.md / "已实装"', async () => {
    const files = await tsxFiles(RENDERER)
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const f of files) {
      const code = stripComments(await readFile(f, 'utf8'))
      for (const [name, re] of [
        ['任务号 Txx', /\\bT\\d{2,3}\\b/g],
        ['文档文件名 .md', /\\.md\\b/g],
        ['已实装/尚未实装', /(?:尚未)?已实装/g]
      ] as const) {
        const m = code.match(re)
        if (m) offenders.push(`${f.replace(RENDERER, '')} → ${name} × ${m.length}`)
      }
    }
    expect(offenders, `界面文案里出现开发术语：\\n${offenders.join('\\n')}`).toEqual([])
  })
})
'''
open(os.path.join(ROOT, "tests", "unit", "ui-wording-guard.spec.ts"), "w", encoding="utf-8", newline="\n").write(GUARD)
print("GUARD_WRITTEN=True")
