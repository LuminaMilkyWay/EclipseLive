import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * 面向用户的文案守卫：**界面里不得出现开发术语**。
 *
 * 用户要求（2026-09-30）：删掉"xx 模块已实装""在 Txx 任务中实现""具体详情见 XXXX.md"这类字样。
 *
 * 本守卫扫描渲染层所有 `.tsx`，并**先剥掉注释**（注释不面向用户，允许保留任务号与文档名），
 * 然后断言不再出现：① 任务号 `Txx`；② 文档文件名 `*.md`；③ "已实装 / 尚未实装"。
 */
const RENDERER = resolve(__dirname, '../../src/renderer/src')

/** 剥掉 JSX 注释、块注释与行注释。 */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
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

    const checks: Array<{ name: string; re: RegExp }> = [
      { name: '任务号 Txx', re: /\bT\d{2,3}\b/g },
      { name: '文档文件名 .md', re: /\.md\b/g },
      { name: '已实装/尚未实装', re: /(?:尚未)?已实装/g }
    ]

    const offenders: string[] = []
    for (const f of files) {
      const code = stripComments(await readFile(f, 'utf8'))
      for (const c of checks) {
        const m = code.match(c.re)
        if (m) offenders.push(`${f.replace(RENDERER, '')} → ${c.name} × ${m.length}`)
      }
    }
    expect(offenders, `界面文案里出现开发术语：\n${offenders.join('\n')}`).toEqual([])
  })
})
