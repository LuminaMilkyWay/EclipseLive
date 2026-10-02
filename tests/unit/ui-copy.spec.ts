import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户文案守卫（守则 27）。
 *
 * 界面混进技术词，是最容易"写代码的人看不见、用户一眼皱眉"的问题。样式已有 `theme.spec.ts` 管，
 * 这里补上**文案**：① 渲染层用户可见字符串不得出现内部术语；② 「画面监看」必须告诉用户
 * 去 OBS 开启**虚拟摄像头**（监看本质就是播放 OBS 虚拟摄像头画面）。
 *
 * 实现要点：**先剥注释**再检查 —— 注释里出现技术词是正常的（那是写给维护者看的）。
 */
const ROOT = resolve(process.cwd())

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** 剥掉块注释与整行注释（只剥以 // 开头的整行，避免误伤 URL 里的 //）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** 内部术语：出现在用户可见位置即为违规。 */
const JARGON = ['本地网关', '网关信息', 'IPC', '宿主', '渲染进程', 'payload', '已实装', '未实装']

describe('用户文案不含内部术语（守则 27）', () => {
  const files = sourceFiles(resolve(ROOT, 'src/renderer/src'))

  it('① 渲染层用户可见字符串不得出现内部术语', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const word of JARGON) {
        if (src.includes(word)) bad.push(`${relative(ROOT, f)}: ${word}`)
      }
    }
    expect(bad, `界面出现内部术语：${bad.join('；')}`).toEqual([])
  })

  it('② 「画面监看」必须提示去 OBS 开启虚拟摄像头', () => {
    const all = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')
    expect(all, '监看文案必须提到"虚拟摄像头"').toContain('虚拟摄像头')
    expect(all, '必须指明"在 OBS 里"开启虚拟摄像头').toMatch(/在 OBS 里[^。]*启动虚拟摄像头/)
    expect(all, '不得把内部选型理由（延迟最低）写给用户看').not.toContain('延迟最低')
  })
})
