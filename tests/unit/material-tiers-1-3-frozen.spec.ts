import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * ★ 前三档材质**冻结守卫**（用户要求："保证前三档材质没有被不正确更改过"）。
 *
 * 背景：T37 为档 4「全液态玻璃」大改材质层时，容易顺手改动 1/2/3 档的令牌值
 * （我就曾把档 4 的不透明度改来改去，也差点波及公共令牌）。
 *
 * 本守卫把 1/2/3 档的**声明值逐条锁死**（值取自 T37 起点提交 cfc1f20，已用逐块逐行比对确认一致）。
 * 任何对前三档的改动都会在这里变红 —— 如果某个改动是有意的，必须**同时**在这里显式更新预期值，
 * 让"改了前三档"这件事在评审里无处可藏。
 *
 * 实现细节：
 * - 只比较**声明**（`--x: value;`），忽略注释与空行 ⇒ 文案/注释可以自由调整；
 * - 归一化行尾与连续空白 ⇒ 不受 LF/CRLF 与缩进影响（跨平台不会假红）；
 * - 多行值（如 --mat-refract / --mat-disperse 折行）会被拼成一行再比。
 */

/** 取出某个档的首个 `[data-material='N'] { … }` 块（配对括号，能正确处理块内注释与折行）。 */
function tierBlock(css: string, tier: string): string | null {
  const start = css.indexOf(`[data-material='${tier}'] {`)
  if (start < 0) return null
  let depth = 0
  const from = css.indexOf('{', start)
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  return null
}

/** 把块体解析成 `令牌名 → 值`（忽略注释；值内的换行与多空格压平）。 */
function declarations(block: string): Record<string, string> {
  const noComments = block.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Record<string, string> = {}
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(noComments)) !== null) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim()
  }
  return out
}

/** T37 起点（cfc1f20）时前三档的全部声明值 —— 改动前三档必须同时改这里。 */
const FROZEN: Record<string, Record<string, string>> = {
  '1': {
    '--mat-blur': '12px',
    '--mat-sat': '1.2',
    '--mat-alpha': '0.85',
    '--mat-alpha-role': '0.9',
    '--mat-edge-light': 'inset 0 1px 0 rgba(255, 255, 255, 0.25)',
    '--mat-edge-light-hover': 'inset 0 3px 0 rgba(255, 255, 255, 0.25)',
    '--mat-edge-thick': 'inset 0 0 0 transparent',
    '--mat-border': 'rgba(255, 255, 255, 0.12)',
    '--mat-refract': 'blur(var(--mat-blur)) saturate(var(--mat-sat))',
    '--mat-scene-op': '0',
    '--mat-disperse': 'none',
    '--mat-glow': '0 0 0 transparent',
    '--mat-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.24)',
    '--mat-shadow-2': '0 8px 24px rgba(0, 0, 0, 0.32)'
  },
  '2': {
    '--mat-blur': '18px',
    '--mat-sat': '1.4',
    '--mat-alpha': '0.68',
    '--mat-alpha-role': '0.8',
    '--mat-edge-light': 'inset 0 1.5px 0 rgba(255, 255, 255, 0.4)',
    '--mat-edge-light-hover': 'inset 0 3.5px 0 rgba(255, 255, 255, 0.4)',
    '--mat-edge-thick': 'inset 0 -1px 0 rgba(255, 255, 255, 0.06)',
    '--mat-border': 'rgba(255, 255, 255, 0.16)',
    '--mat-refract':
      'blur(var(--wallpaper-blur)) url(#glass-refract-subtle) blur(var(--mat-blur)) saturate(var(--mat-sat))',
    '--mat-scene-op': '0.6',
    '--mat-disperse':
      'inset 1px 0 0 rgba(255, 64, 96, 0.07), inset -1px 0 0 rgba(64, 160, 255, 0.07)',
    '--mat-glow': '0 0 0 transparent',
    '--mat-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.2)',
    '--mat-shadow-2': '0 10px 28px rgba(0, 0, 0, 0.28)'
  },
  '3': {
    '--mat-blur': '24px',
    '--mat-sat': '1.6',
    '--mat-alpha': '0.5',
    '--mat-alpha-role': '0.68',
    '--mat-edge-light': 'inset 0 1.5px 0 rgba(255, 255, 255, 0.6)',
    '--mat-edge-light-hover': 'inset 0 3.5px 0 rgba(255, 255, 255, 0.6)',
    '--mat-edge-thick': 'inset 0 -1.5px 0 rgba(255, 255, 255, 0.08)',
    '--mat-border': 'rgba(255, 255, 255, 0.22)',
    '--mat-refract':
      'blur(var(--wallpaper-blur)) url(#glass-refract-strong) blur(var(--mat-blur)) saturate(var(--mat-sat))',
    '--mat-scene-op': '0.85',
    '--mat-disperse':
      'inset 1.5px 0 0 rgba(255, 64, 96, 0.12), inset -1.5px 0 0 rgba(64, 160, 255, 0.12), inset 0 1.5px 0 rgba(255, 64, 96, 0.05), inset 0 -1.5px 0 rgba(64, 160, 255, 0.05)',
    '--mat-glow': '0 0 22px 1px color-mix(in srgb, var(--acc) 18%, transparent)',
    '--mat-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.18)',
    '--mat-shadow-2': '0 12px 32px rgba(0, 0, 0, 0.24)'
  }
}

describe('T37 前三档材质冻结（不得被档 4 的工作顺手改动）', () => {
  it('前三档不受"未限定档位的新增规则"影响（用户实测过这类 bug）', async () => {
    const raw = await readFile(join(process.cwd(), 'src/renderer/src/renderer.css'), 'utf8')
    const code = raw.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

    // ① **基础入场关键帧**不得含档 4 专属属性：关键帧无法按档位作用域，
    //    一旦写进 el-rise-in / el-pop-in，前三档的入场行为也会被改（实测发生过）。
    //    档 4 的"材质化"入场另用 el-materialize-in / el-materialize-pop-in，由 animation-name 覆盖。
    for (const kf of ['el-rise-in', 'el-pop-in', 'el-toast-in', 'el-item-in', 'el-drop-in', 'el-drop-out']) {
      const start = code.indexOf(`@keyframes ${kf}`)
      expect(start, `缺少关键帧 ${kf}`).toBeGreaterThanOrEqual(0)
      const body = code.slice(start, code.indexOf('\n}', start))
      expect(body, `基础关键帧 ${kf} 被写入了档 4 专属属性`).not.toContain('--mat-scene-op')
    }

    // ② **指针圆斑**必须限定档位：曾经漏限定 ⇒ 四个档位都会冒出光斑（实测发生的 bug）。
    expect(code, '指针圆斑应由档 4 门控').toMatch(
      /:root\[data-material='4'\]\[data-light='1'\]\s+body::after/
    )
    expect(code, '不得存在"未限档位"的圆斑显示规则').not.toMatch(
      /:root\[data-light='1'\]\s+body::after/
    )
  })

  it('档 1/2/3 的每一个声明值都与 T37 起点逐条一致', async () => {
    const raw = await readFile(join(process.cwd(), 'src/renderer/src/renderer.css'), 'utf8')
    const css = raw.replace(/\r\n/g, '\n')
    for (const tier of ['1', '2', '3']) {
      const block = tierBlock(css, tier)
      expect(block, `找不到档 ${tier} 的材质块`).toBeTruthy()
      const actual = declarations(block!)
      const expected = FROZEN[tier]
      // 令牌集合必须完全一致（多一个/少一个都算改动）
      expect(Object.keys(actual).sort(), `档 ${tier} 的令牌集合变了`).toEqual(
        Object.keys(expected).sort()
      )
      for (const [name, value] of Object.entries(expected)) {
        expect(actual[name], `档 ${tier} 的 ${name} 被改动了`).toBe(value)
      }
    }
  })
})
