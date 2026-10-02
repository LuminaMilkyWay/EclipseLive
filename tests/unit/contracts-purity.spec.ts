import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 接口层纯度守卫（P2 · 用户批准的最优方案的关键一环）。
 *
 * 为什么需要它：`src/contracts/**` 采用 **MIT**（见同目录 LICENSE）。
 * 只要有人（包括维护者自己）往这里"顺手"加一段实现，**该文件就变成 AGPL 作品** ⇒
 * 双协议边界**当场失效**。文字纪律挡不住人，所以用机械守卫挡。
 *
 * 判据（**窄口子**，兼顾实用与安全）
 *  允许：
 *    · `interface` / `type` / `import type` / `export type`
 *    · `const` 字面量、`as const` 对象/数组、`enum`
 *    · **纯谓词/派生常量**：`export function f(...) { return <单个表达式> }`
 *      —— 即"单 return 的纯函数"，无副作用、无外部调用，模块用来做本地校验
 *      （实测接口层现有 4 个此类函数：isPermissionType / isNavigationAllowed /
 *        isLoopbackWsUrl / moduleCredentialKey 等，属模块必需，故保留为允许项）
 *  禁止：
 *    · 多语句函数体、类实现、循环/分支之外的复杂逻辑
 *    · 任何副作用：I/O、注册、订阅、计时器、`process.*`、`require`、非 `import type` 的运行时导入
 *
 * 违反 = 边界失效 ⇒ 必须把实现移到 `src/shared/**`（AGPL）并经通道/事件暴露。
 */
const DIR = resolve(process.cwd(), 'src/contracts')

/** 逐文件扫描，返回违规描述（空数组 = 合规）。 */
function violations(src: string): string[] {
  const out: string[] = []
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 去块注释
    .replace(/^\s*\/\/.*$/gm, '') // 去行注释

  // ① 运行时导入（非 import type）—— 接口层不得依赖实现
  const rtImport = /^\s*import\s+(?!type\b)[^'"]*from\s+['"][^'"]+['"]/m.exec(code)
  if (rtImport) out.push(`运行时导入（应只用 import type）：${rtImport[0].trim().slice(0, 70)}`)

  // ② 副作用关键字
  const side = /\b(ipcMain|ipcRenderer|process\.|require\(|setTimeout|setInterval|console\.|window\.|document\.)\b/.exec(code)
  if (side) out.push(`副作用调用：${side[0]}`)

  // ③ 类实现
  const cls = /\bclass\s+\w+/.exec(code)
  if (cls) out.push(`类实现：${cls[0]}`)

  // ④ 函数：只允许"单 return"的纯谓词
  const fnRe = /export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(code)) !== null) {
    const name = m[1]
    const body = m[2].trim()
    if (/\basync\b/.test(m[0].split('{')[0])) out.push(`异步函数：${name}`)
    const statements = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'))
    const singleReturn = statements.length === 1 && statements[0].startsWith('return ')
    if (!singleReturn) out.push(`函数体不是"单 return 纯谓词"：${name}（${statements.length} 条语句）`)
  }
  const arrowFn = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(code)
  if (arrowFn) out.push(`箭头函数（应改为单 return 的 function 谓词或常量）：${arrowFn[1]}`)

  return out
}

describe('接口层纯度（src/contracts 为 MIT，禁止实现）', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'))

  it('至少扫到 10 个契约文件（防止守卫因路径变化而空转）', () => {
    expect(files.length, '契约文件数异常，检查 DIR 是否失效').toBeGreaterThanOrEqual(10)
  })

  /**
   * ★ 显式例外清单（**已知违规，带原因与迁移卡**）。
   * 这不是"放宽规则"：例外必须**逐条列名**并说明为何暂留，便于审计与限期迁移。
   * 新增例外 = 改这个数组 = 一次**看得见**的决定（评审时会被追问）。
   */
  const EXCEPTIONS: Record<string, string> = {
    'external-ws.ts:isLoopbackWsUrl':
      'URL 回环判定（多语句）。模块可能本地校验，但属实现 ⇒ 迁移卡 T63 移到 src/shared/（AGPL）并经通道暴露。',
    'external-ws.ts:sanitizeWsUrl':
      'WS URL 规范化（多语句）。同上，T63 迁移。',
    'webtools.ts:isNavigationAllowed':
      '导航白名单判定（多语句），核心强制用；模块无需此逻辑 ⇒ T63 迁移。'
  }

  it('每个契约文件只含类型、常量与单 return 纯谓词（无实现、无副作用）', () => {
    const bad: string[] = []
    for (const f of files) {
      for (const v of violations(readFileSync(resolve(DIR, f), 'utf8'))) bad.push(`${f}: ${v}`)
    }
    // 例外清单命中的违规项**不算失败**，但必须仍存在于代码中（防止"例外留着但已修好"的陈旧清单）
    const hit = (b: string, k: string): boolean => {
      const [file, fn] = k.split(':')
      return b.includes(file) && b.includes(fn)
    }
    const realBad = bad.filter((b) => !Object.keys(EXCEPTIONS).some((k) => hit(b, k)))
    const stale = Object.keys(EXCEPTIONS).filter((k) => !bad.some((b) => hit(b, k)))
    expect(
      stale,
      '例外清单已过期（对应代码已不存在或已合规）—— 请删除这些条目：' + stale.join('、')
    ).toEqual([])
    expect(
      realBad,
      '接口层出现实现（会让 MIT 文件变成 AGPL 作品，双协议边界失效）—— ' +
        '请把实现移到 src/shared/**（AGPL）并经通道/事件暴露，或（确有必要时）加入上方 EXCEPTIONS 并说明原因：\n  ' +
        realBad.join('\n  ')
    ).toEqual([])
  })

  it('接口层必须有 MIT LICENSE 与说明文档（授权落纸，不能只在根 NOTICE 里写）', () => {
    const entries = readdirSync(DIR)
    expect(entries, '缺少 src/contracts/LICENSE（MIT 授权落纸）').toContain('LICENSE')
    expect(entries, '缺少 src/contracts/README.md（边界说明）').toContain('README.md')
    const lic = readFileSync(resolve(DIR, 'LICENSE'), 'utf8')
    expect(lic, 'LICENSE 应为 MIT 全文').toContain('MIT License')
    expect(lic, 'LICENSE 不得是 AGPL（那会让模块作者背负 copyleft）').not.toContain('GNU AFFERO')
  })
})
