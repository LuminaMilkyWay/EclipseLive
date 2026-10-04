"""C3 收尾（方案 1）：模块 immersive ⇒ 专注档位，**不改 App.tsx 行数**。"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def rd(p):
    return open(os.path.join(ROOT, p), encoding="utf-8", newline="").read().replace("\r\n", "\n")


def wr(p, t):
    open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(t)


def must(c, m):
    if not c:
        raise SystemExit("中止：" + m)


app_before = len(rd("src/renderer/src/App.tsx").split("\n"))
print("  App.tsx 行数（改前）:", app_before)

# ---------- ① layout-rules：纯函数 resolveTier（模块 immersive 的唯一裁决点） ----------
p = "src/renderer/src/layout-rules.ts"
t = rd(p)
if "resolveTier" not in t:
    anchor = "export function layoutFor(id: string | null | undefined): LayoutTier {"
    must(anchor in t, "未找到 layoutFor")
    m = re.search(r"export function layoutFor[\s\S]{0,200}?\n\}\n", t)
    must(m is not None, "layoutFor 函数体未找到")
    add = '''
/**
 * C3：**模块页的档位裁决** —— 规则表优先，其次看模块自己的 `nav.immersive` 声明。
 *
 * 为什么单列一个纯函数：本项目所有渲染层测试都受 tsconfig 项目边界限制（测试项目没有 DOM），
 * 放纯函数里才能**真跑单测**（而不是只做源码文本断言）。
 *
 * 安全默认（沿用 `layout-rules.ts` 的既定意图「忘记声明就全屏」是事故）：
 *   · 模块**未声明** immersive ⇒ 与今天一致（`standard`）；
 *   · 只有显式 `immersive === true` 才给 `full`。
 */
export function resolveTier(pageKey: string | null | undefined, immersive?: boolean): LayoutTier {
  const rule = layoutFor(pageKey)
  if (rule !== 'standard') return rule
  return immersive === true ? 'full' : 'standard'
}
'''
    t = t[:m.end()] + add + t[m.end():]
    wr(p, t)
print("  ① resolveTier:", "resolveTier" in rd(p))

# ---------- ② useShellLayout：接收快照 + 用 resolveTier ----------
p = "src/renderer/src/hooks/useShellLayout.ts"
t = rd(p)
if "resolveTier" not in t:
    must("import { layoutFor } from '../layout-rules'" in t, "未找到 layoutFor 导入")
    t = t.replace("import { layoutFor } from '../layout-rules'", "import { resolveTier } from '../layout-rules'\nimport { isPageTab, pageTabModuleId } from '../app-tables'", 1)
    # 签名：加第三个参数
    m = re.search(r"export function useShellLayout\(\n  tab: string,\n  statuses: DiagnosticsSnapshot\['webtools'\]\['statuses'\]\n\)", t)
    must(m is not None, "未找到 useShellLayout 签名")
    t = t.replace(
        m.group(0),
        "export function useShellLayout(\n  tab: string,\n  statuses: DiagnosticsSnapshot['webtools']['statuses'],\n  /** C3：模块页的 nav 声明来自快照（App 已有该数据，传引用不新增状态）。 */\n  snap: DiagnosticsSnapshot | null = null\n)",
        1,
    )
    # 规则表那一行：改为按页面键 + immersive 裁决
    old = "    const tier = layoutFor(tab === 'obs' ? 'obs-stream' : null)"
    must(old in t, "未找到 tier 计算行")
    new = ("    // C3：模块页用 page:<id> 解析出模块 id ⇒ 读它的 nav.immersive（未声明 ⇒ standard，绝不误全屏）。\n"
           "    const pageModuleId = isPageTab(tab) ? pageTabModuleId(tab) : null\n"
           "    const immersive = snap?.modules.find((m) => m.id === pageModuleId)?.nav?.immersive\n"
           "    const tier = resolveTier(tab === 'obs' ? 'obs-stream' : pageModuleId, immersive)")
    t = t.replace(old, new, 1)
    wr(p, t)
print("  ② hook:", "resolveTier" in rd(p) and "snap: DiagnosticsSnapshot | null = null" in rd(p))

# ---------- ③ App.tsx：只改一行（行数必须不变） ----------
p = "src/renderer/src/App.tsx"
t = rd(p)
old = "    snap?.webtools.statuses ?? []\n"
must(old in t, "未找到 App 的 statuses 传参行")
if "snap ?? null" not in t:
    t = t.replace(old, "    snap?.webtools.statuses ?? [],\n    snap ?? null\n", 1)
    wr(p, t)
app_after = len(rd("src/renderer/src/App.tsx").split("\n"))
print("  App.tsx 行数（改后）:", app_after, "／ 不变:", app_before == app_after)
must(app_before == app_after, "App.tsx 行数变了 ⇒ 违反棘轮")

# ---------- ④ 守卫（真单测 + 接线 + 棘轮） ----------
wr(
    "tests/unit/layout-immersive.spec.ts",
    """import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTier } from '../../src/renderer/src/layout-rules'
import * as rules from '../../src/renderer/src/layout-rules'

/**
 * C3 守卫：模块 `nav.immersive` ⇒ 专注档位。
 *
 * 三条不变式：
 *   ① **未声明 immersive ⇒ 与今天完全一致**（模块页 = standard，绝不误全屏）—— 安全默认；
 *   ② 显式 `immersive === true` ⇒ `full`（与内置「直播中控」同档）；
 *   ③ 内置规则表仍然优先（`obs-stream` ⇒ full 不因传参变化）。
 *
 * `resolveTier` 是**纯函数**（`layout-rules.ts` 无 DOM）⇒ 这里可以真跑单测，
 * 不受"测试项目没有 DOM"的项目边界限制。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('模块 immersive ⇒ 专注档位（C3）', () => {
  it('① 未声明 immersive ⇒ standard（安全默认，防误全屏）', () => {
    expect(resolveTier('my-module', undefined), '未声明必须留 standard').toBe('standard')
    expect(resolveTier('my-module', false), '显式 false 也留 standard').toBe('standard')
    expect(resolveTier(null, true), '没有页面键时不得凭 immersive 全屏').toBe('standard')
  })

  it('② 显式 immersive === true ⇒ full', () => {
    expect(resolveTier('my-module', true)).toBe('full')
  })

  it('③ 内置规则表优先', () => {
    expect(resolveTier('obs-stream', undefined), '直播中控仍应为 full').toBe('full')
    expect(resolveTier('obs-stream', false), '规则表不因模块传参而改变').toBe('full')
  })

  it('④ 规则表存在的键不得被 immersive 之外的逻辑改写', () => {
    expect(rules.LAYOUT_RULES['obs-stream']).toBe('full')
  })

  it('⑤ 接线：App 在**不增加行数**的前提下把快照传给了布局 hook', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app, 'App 必须把 snap 传给布局 hook（C3）').toContain('snap ?? null')
    // 棘轮：App.tsx 行数上限由 app-size-budget.spec.ts 另行钉住；这里只确认没有整块新增
    expect(app.split('\\n').length, 'App.tsx 不应因本卡增长').toBeLessThanOrEqual(300)
    const hook = read('src/renderer/src/hooks/useShellLayout.ts')
    expect(hook, '布局 hook 必须用 resolveTier 裁决').toContain('resolveTier(')
    expect(hook, '必须从 tab 解析模块 id').toContain('pageTabModuleId(tab)')
    expect(hook, '必须读模块的 nav.immersive').toContain('nav?.immersive')
  })
})
""",
)
print("  ④ 守卫已写入")
print("READY")
