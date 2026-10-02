import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * `RELEASE_NOTES.md` 守卫（用户口径，2026-09-30 确认）。
 *
 * 该文件**只对软件内显示的更新内容负责**：软件内「更新日志」页与升级弹窗只读它。
 * 因此本守卫钉死四件事：
 * ① 结构：`## [版本] — 日期` + `### 新增 / 修复 / 调整`，且版本段数 ≤ 界面窗口大小；
 * ② 每条 ≤50 字（用户要求）；
 * ③ **不得出现技术术语**（副作用 / 依赖 / 重渲染 / IPC / 事件总线 / 渲染层）与
 *    文件名、行号、任务号（开发者内容一律进 `CHANGELOG.md`）；
 * ④ 性能类条目必须写成「优化了 … 的性能表现」。
 */
const NOTES = resolve(__dirname, '../../RELEASE_NOTES.md')
const SHARED = resolve(__dirname, '../../src/shared/changelog.ts')

const MAX_CHARS = 50
const ALLOWED_SECTIONS = ['新增', '修复', '调整']
const BANNED = [
  '副作用',
  '依赖',
  '重渲染',
  'IPC',
  '事件总线',
  '渲染层',
  '重构',
  '回滚',
  '单测',
  '组件',
  '函数',
  '接口'
]
/** 性能类关键词：出现即要求固定句式。 */
const PERF_RE = /(性能|帧率|流畅|卡顿|延迟|加载)/
const PERF_OK_RE = /^优化了.+的性能表现。?$/

interface Entry {
  line: number
  text: string
}

async function load(): Promise<{ raw: string; versions: string[]; sections: string[]; entries: Entry[] }> {
  const raw = await readFile(NOTES, 'utf8')
  const versions = [...raw.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1] ?? '')
  const sections = [...raw.matchAll(/^### (.+)$/gm)].map((m) => (m[1] ?? '').trim())
  const entries: Entry[] = []
  raw.split('\n').forEach((l, i) => {
    if (l.startsWith('- ')) entries.push({ line: i + 1, text: l.slice(2).trim() })
  })
  return { raw, versions, sections, entries }
}

describe('RELEASE_NOTES.md（软件内更新说明的唯一数据源）', () => {
  it('① 结构：有版本段、分节只用 新增/修复/调整，且版本段数不超过界面窗口', async () => {
    const { versions, sections } = await load()
    const shared = await readFile(SHARED, 'utf8')
    const m = /CHANGELOG_IN_APP_VERSIONS\s*=\s*(\d+)/.exec(shared)
    expect(m, '找不到 CHANGELOG_IN_APP_VERSIONS').toBeTruthy()
    const window = Number(m![1])

    expect(versions.length, '应有版本段（格式 ## [版本] — 日期）').toBeGreaterThan(0)
    expect(versions.length, `只保留软件内会显示的那几版（窗口 ${window}）`).toBeLessThanOrEqual(window)
    for (const s of sections) {
      expect(ALLOWED_SECTIONS, `分节只允许 新增/修复/调整，出现：${s}`).toContain(s)
    }
  })

  it('② 每条不超过 50 字', async () => {
    const { entries } = await load()
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.text.length, `第 ${e.line} 行超过 ${MAX_CHARS} 字：${e.text}`).toBeLessThanOrEqual(MAX_CHARS)
    }
  })

  it('③ 不含技术术语 / 文件名 / 行号 / 任务号', async () => {
    const { entries } = await load()
    for (const e of entries) {
      for (const w of BANNED) {
        expect(e.text.includes(w), `第 ${e.line} 行出现技术术语「${w}」：${e.text}`).toBe(false)
      }
      expect(e.text, `第 ${e.line} 行疑似含文件名：${e.text}`).not.toMatch(/\.(md|ts|tsx|css|json)\b/)
      expect(e.text, `第 ${e.line} 行疑似含行号：${e.text}`).not.toMatch(/第\s*\d+\s*行|L\d{2,}/)
      expect(e.text, `第 ${e.line} 行疑似含任务号：${e.text}`).not.toMatch(/\bT\d{2,3}\b/)
    }
  })

  it('④ 性能类条目必须写成「优化了 … 的性能表现」', async () => {
    const { entries } = await load()
    for (const e of entries) {
      if (!PERF_RE.test(e.text)) continue
      expect(
        PERF_OK_RE.test(e.text),
        `第 ${e.line} 行是性能条目，必须写成「优化了 … 的性能表现」：${e.text}`
      ).toBe(true)
    }
  })
})
