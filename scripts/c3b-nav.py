"""C3 收尾：按【已核对】锚点加 nav 校验 + 快照 + 侧栏一级项 + 下拉去重 + 守卫。"""
import os
import re
import glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def rd(p):
    return open(os.path.join(ROOT, p), encoding="utf-8", newline="").read().replace("\r\n", "\n")


def wr(p, t):
    open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n").write(t)


def must(c, m):
    if not c:
        raise SystemExit("中止：" + m)


# ---------- ② 校验（插在 channels 块之后、web 注释之前；用既有 isPlainObject） ----------
p = "src/main/core/modules/index.ts"
t = rd(p)
if "nav must be an object" not in t:
    anchor = "  // T11 declarative web tool / T29 module page declaration.\n"
    must(anchor in t, "未找到 web 注释锚点")
    nav = (
        "  // C3: nav 声明（全部可选）。**非法值只记错误**，不影响其它行为；\n"
        "  // 未声明 nav 的模块必须与今天完全一致（仍在「模块」分类下）—— 有守卫钉住。\n"
        "  if (m.nav !== undefined) {\n"
        "    if (!isPlainObject(m.nav)) {\n"
        "      errors.push('nav must be an object')\n"
        "    } else {\n"
        "      const nv = m.nav\n"
        "      if (nv.level !== undefined && nv.level !== 1 && nv.level !== 2) {\n"
        "        errors.push('nav.level must be 1 or 2')\n"
        "      }\n"
        "      if (nv.after !== undefined && (typeof nv.after !== 'string' || nv.after.length === 0)) {\n"
        "        errors.push('nav.after must be a non-empty string')\n"
        "      }\n"
        "      if (\n"
        "        nv.order !== undefined &&\n"
        "        (typeof nv.order !== 'number' || !Number.isFinite(nv.order))\n"
        "      ) {\n"
        "        errors.push('nav.order must be a finite number')\n"
        "      }\n"
        "      if (nv.immersive !== undefined && typeof nv.immersive !== 'boolean') {\n"
        "        errors.push('nav.immersive must be a boolean')\n"
        "      }\n"
        "    }\n"
        "  }\n\n"
    )
    t = t.replace(anchor, nav + anchor, 1)
    wr(p, t)
print("  ② 校验:", "nav must be an object" in rd(p))

# ---------- ③ 快照契约 + 映射 ----------
p = "src/shared/diagnostics.ts"
t = rd(p)
if "nav?:" not in t:
    m = re.search(r"^  license\?: string\n", t, re.M)
    must(m is not None, "未找到 DiagnosticsModule.license")
    t = t.replace(m.group(0), m.group(0) + "  /** C3：导航声明（界面据此把它放到一级菜单、并允许专注布局）。 */\n  nav?: { level?: 1 | 2; after?: string; order?: number; immersive?: boolean }\n", 1)
    wr(p, t)

p = "src/main/core/diagnostics/index.ts"
t = rd(p)
if "nav: m.manifest?.nav" not in t:
    m = re.search(r"^      license: m\.manifest\?\.license,\n", t, re.M)
    must(m is not None, "未找到快照 license 行")
    t = t.replace(m.group(0), m.group(0) + "      nav: m.manifest?.nav,\n", 1)
    wr(p, t)
print("  ③ 快照:", "nav?:" in rd("src/shared/diagnostics.ts") and "nav: m.manifest?.nav" in rd("src/main/core/diagnostics/index.ts"))

# ---------- ④ 侧栏：一级项（插在「直播」组 </div> 之后、「扩展」组之前，缩进 14） ----------
p = "src/renderer/src/shell/Sidebar.tsx"
t = rd(p)
if "page-nav-top-" not in t:
    anchor = '              <div className="nav-group" ref={sideNavRef}>\n'
    must(anchor in t, "未找到「扩展」组起始锚点")
    top = (
        '              {/* C3：声明 nav.level=1 的模块 → 作为**一级菜单项**（点击仍走既有 page: tab）。\n'
        '                  未声明 nav 的模块不受影响，仍在下面的「模块」下拉里。 */}\n'
        '              {(snap?.modules ?? [])\n'
        '                .filter((m) => m.page && m.nav?.level === 1)\n'
        '                .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))\n'
        '                .map((m) => (\n'
        '                  <button\n'
        '                    key={m.id}\n'
        '                    data-testid={`page-nav-top-${m.id}`}\n'
        "                    className={tab === (`page:${m.id}` as Tab) ? 'nav-item active' : 'nav-item'}\n"
        "                    onClick={() => setTab(`page:${m.id}` as Tab)}\n"
        '                  >\n'
        '                    {m.name ?? m.id}\n'
        '                  </button>\n'
        '                ))}\n'
    )
    t = t.replace(anchor, top + anchor, 1)
    wr(p, t)
# 4b) 下拉里排除已升到一级的（避免重复出现）
if "m.nav?.level !== 1" not in t:
    old = "{(snap?.modules ?? []).map((m) => {"
    must(old in t, "未找到下拉 map")
    t = t.replace(old, "{(snap?.modules ?? []).filter((m) => m.nav?.level !== 1).map((m) => {", 1)
    wr(p, t)
print("  ④ 侧栏:", "page-nav-top-" in rd(p) and "m.nav?.level !== 1" in rd(p))

# ---------- ⑤ 沉浸接线现状（如实记录，不硬改棘轮） ----------
callers = []
for f in glob.glob(os.path.join(ROOT, "src/renderer/src/**/*.ts*"), recursive=True):
    if "useShellLayout(" in open(f, encoding="utf-8", newline="").read():
        callers.append(os.path.relpath(f, ROOT).replace("\\", "/"))
print("  ⑤ useShellLayout 调用点:", callers)

# ---------- ⑥ 守卫 ----------
wr(
    "tests/unit/module-nav.spec.ts",
    """import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleNav } from '../../src/contracts/module'

/**
 * C3 守卫：导航声明的三条不变式。
 *
 *   ① **未声明 nav ⇒ 行为与今天完全一致**（仍在「模块」下拉里）—— 这是本能力最重要的兼容承诺；
 *   ② 声明 `nav.level=1` ⇒ 出现在**一级**位置，且**不在**「模块」下拉里重复出现；
 *   ③ 非法 `nav` **只记错误、不得崩溃**（`nav.level` 只接受 1|2 等）。
 *
 * 为什么用"读源码 + 类型断言"而不是渲染测试：本项目的测试项目没有 DOM
 * （`tsconfig.node.json` 的 `include` 含 `tests/**` 而 `lib` 无 DOM）⇒ 渲染层模块不可直接 import。
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('模块导航声明（C3）', () => {
  it('① 类型层面：nav 的 level 只能是 1 或 2', () => {
    const nav: ModuleNav = { level: 1, after: 'obs-stream', order: 20, immersive: true }
    expect(nav.level).toBe(1)
    // @ts-expect-error level 只接受 1|2（写 3 必须编译失败）
    const bad: ModuleNav = { level: 3 }
    expect(bad).toBeDefined()
  })

  it('② 侧栏：一级项按 level=1 过滤，且下拉里不重复', () => {
    const ui = read('src/renderer/src/shell/Sidebar.tsx')
    expect(ui, '一级项必须按 nav.level===1 过滤').toContain('m.nav?.level === 1')
    expect(ui, '一级项必须按 order 排序').toContain('.sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))')
    expect(ui, '下拉里必须排除已升到一级的模块（否则重复出现）').toContain('m.nav?.level !== 1')
    expect(ui, '一级项必须复用既有 page: tab（不新增 tab 类型）').toContain('page:${m.id}')
  })

  it('③ 主进程：nav 校验必须只记错误（不得抛/崩溃），且覆盖四个字段', () => {
    const core = read('src/main/core/modules/index.ts')
    expect(core, 'nav 必须是对象').toContain('nav must be an object')
    expect(core, 'level 只接受 1|2').toContain('nav.level must be 1 or 2')
    expect(core, 'after 必须是非空字符串').toContain('nav.after must be a non-empty string')
    expect(core, 'order 必须是有限数').toContain('nav.order must be a finite number')
    expect(core, 'immersive 必须是布尔').toContain('nav.immersive must be a boolean')
  })

  it('④ 快照必须把 nav 带给界面（否则侧栏无从判断）', () => {
    expect(read('src/shared/diagnostics.ts'), 'DiagnosticsModule 必须有 nav').toMatch(/nav\\?:/)
    expect(read('src/main/core/diagnostics/index.ts'), '快照必须映射 nav').toContain('nav: m.manifest?.nav')
  })

  it('⑤ 未声明 nav 的模块必须仍在「模块」下拉里（兼容承诺）', () => {
    const ui = read('src/renderer/src/shell/Sidebar.tsx')
    // 下拉的过滤条件必须是"排除 level===1"，因此未声明 nav 的模块（nav?.level === undefined）会被保留
    expect(ui).toContain('.filter((m) => m.nav?.level !== 1)')
  })
})
""",
)
print("  ⑥ 守卫已写入")
print("READY")
