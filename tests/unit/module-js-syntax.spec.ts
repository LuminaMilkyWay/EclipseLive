import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 模块 JS 的**语法守卫**。
 *
 * 为什么值得一条守卫：本轮我在 `lib/prices-online.js` 里写了两处 **TypeScript 语法**
 * （`readonly string[]` 类型标注、`(e as Error)`）⇒ 整个测试文件 **10/10 全红**，
 * 而错误信息只表现为"所有用例都失败"，排查成本很高。模块代码是**纯 JS**（不经 tsc 检查），
 * 所以需要一道独立的语法闸门：`node --check` 每个 `.js`。
 *
 * 这条守卫的作用：把"TS 语法混进 JS"从**运行时炸**提前到**测试期立刻报出具体文件与行号**。
 */
const ROOT = resolve(process.cwd())

function jsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsFiles(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

describe('模块 JS 语法守卫', () => {
  it('① modules/**/*.js 必须全部通过 node --check（纯 JS，不得混入 TS 语法）', () => {
    const files = jsFiles(resolve(ROOT, 'modules')).filter((f) => !f.includes(`${join('modules', 'vts-controlpad', 'vendor')}`))
    expect(files.length, '应当找得到模块 JS（否则守卫失效）').toBeGreaterThan(0)
    const broken: string[] = []
    for (const f of files) {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
      } catch (e) {
        const out = String((e as { stderr?: Buffer }).stderr ?? '')
        broken.push(`${relative(ROOT, f)}: ${out.split('\n').slice(0, 2).join(' ').trim()}`)
      }
    }
    expect(broken, `以下模块 JS 语法不合法（多半是混入了 TS 语法）：\n${broken.join('\n')}`).toEqual([])
  })

  it('② 顺带守住：模块的 manifest.json 必须可解析且声明协议', () => {
    const dirs = readdirSync(resolve(ROOT, 'modules'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    expect(dirs.length).toBeGreaterThan(0)
    for (const d of dirs) {
      const p = resolve(ROOT, 'modules', d, 'manifest.json')
      try {
        const j = JSON.parse(require('node:fs').readFileSync(p, 'utf8')) as { id?: string; license?: string }
        expect(j.id, `${d}/manifest.json 的 id 必须等于目录名`).toBe(d)
        expect(j.license, `${d}/manifest.json 必须声明 license（T64 起的要求）`).toBeTruthy()
      } catch (e) {
        throw new Error(`modules/${d}/manifest.json 不可用：${String(e)}`)
      }
    }
  })
})
