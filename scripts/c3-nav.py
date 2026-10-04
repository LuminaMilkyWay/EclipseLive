"""C3：导航层级（nav.level/after/order）+ 沉浸（immersive）接线。锚点断言，找不到即停。"""
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


# ============ ① 契约：ModuleNav ============
p = "src/contracts/module.ts"
t = rd(p)
if "ModuleNav" not in t:
    anchor = "export interface ModuleManifest {"
    must(anchor in t, "未找到 ModuleManifest")
    nav = '''/**
 * C3：**导航声明**（可选）。让模块页不再只能挂在「模块」二级菜单下。
 *
 * 未声明 ⇒ 行为与今天**完全一致**（仍在「模块」分类里）——
 * 这条不变式有守卫钉住（`tests/unit/module-nav.spec.ts`）。
 */
export interface ModuleNav {
  /** 1 = 一级菜单；2 = 「模块」分类下（默认）。 */
  level?: 1 | 2
  /**
   * 排在哪一项之后。取值见 `MODULE_UI_CONTRACT.md` 的**内置页面键**清单
   * （如 `obs-stream` = 直播中控）。指向不存在的项 ⇒ 降级为默认位置并记警告（**不得崩**）。
   */
  after?: string
  /** 同级次序（留空按发现顺序）。 */
  order?: number
  /** 该模块页是否允许**专注/沉浸**布局（侧栏收起、内容区更大）。 */
  immersive?: boolean
}

'''
    t = t.replace(anchor, nav + anchor, 1)
    m = re.search(r"^(  web\?: WebToolDeclaration\n)", t, re.M)
    must(m is not None, "未找到 manifest 的 web? 字段")
    t = t.replace(m.group(1), m.group(1) + "  /** C3：导航声明（可选；未声明则仍在「模块」分类下）。 */\n  nav?: ModuleNav\n", 1)
    wr(p, t)
print("  ① 契约 ModuleNav:", "ModuleNav" in rd(p) and "nav?: ModuleNav" in rd(p))

# ============ ② 校验 ============
p = "src/main/core/modules/index.ts"
t = rd(p)
if "nav must be" not in t:
    m = re.search(r"^(  if \(m\.web !== undefined\) \{[\s\S]{0,400}?\n  \}\n)", t, re.M)
    must(m is not None, "未找到 web 校验段（nav 校验插在它之后）")
    block = m.group(1)
    ind = "  "
    add = (
        "\n" + ind + "// C3: nav 声明（全部可选）。非法值**只记错误**，不修改其它行为；\n"
        + ind + "// 未声明 nav 的模块必须与今天完全一致（仍在「模块」分类里）。\n"
        + ind + "if (m.nav !== undefined) {\n"
        + ind + "  const nv = m.nav as Record<string, unknown>\n"
        + ind + "  if (typeof nv !== 'object' || nv === null || Array.isArray(nv)) {\n"
        + ind + "    errors.push('nav must be an object')\n"
        + ind + "  } else {\n"
        + ind + "    if (nv.level !== undefined && nv.level !== 1 && nv.level !== 2) {\n"
        + ind + "      errors.push('nav.level must be 1 or 2')\n"
        + ind + "    }\n"
        + ind + "    if (nv.after !== undefined && (typeof nv.after !== 'string' || nv.after.length === 0)) {\n"
        + ind + "      errors.push('nav.after must be a non-empty string')\n"
        + ind + "    }\n"
        + ind + "    if (nv.order !== undefined && (typeof nv.order !== 'number' || !Number.isFinite(nv.order))) {\n"
        + ind + "      errors.push('nav.order must be a finite number')\n"
        + ind + "    }\n"
        + ind + "    if (nv.immersive !== undefined && typeof nv.immersive !== 'boolean') {\n"
        + ind + "      errors.push('nav.immersive must be a boolean')\n"
        + ind + "    }\n"
        + ind + "  }\n"
        + ind + "}\n"
    )
    t = t.replace(block, block + add, 1)
    wr(p, t)
print("  ② 校验:", "nav must be an object" in rd(p))

# ============ ③ 快照带上 nav（照 T66 加 license 的同款位置） ============
p = "src/shared/diagnostics.ts"
t = rd(p)
if "nav?: " not in t:
    m = re.search(r"^(  license\?: string\n)", t, re.M)
    must(m is not None, "未找到 DiagnosticsModule.license 字段")
    t = t.replace(m.group(1), m.group(1) + "  /** C3：导航声明（界面据此把它放到一级菜单 / 允许专注布局）。 */\n  nav?: { level?: 1 | 2; after?: string; order?: number; immersive?: boolean }\n", 1)
    wr(p, t)
print("  ③ 快照契约:", "nav?:" in rd(p))

p = "src/main/core/diagnostics/index.ts"
t = rd(p)
if "nav: m.manifest?.nav" not in t:
    m = re.search(r"^(      license: m\.manifest\?\.license,\n)", t, re.M)
    must(m is not None, "未找到快照里的 license 行")
    t = t.replace(m.group(1), m.group(1) + "      nav: m.manifest?.nav,\n", 1)
    wr(p, t)
print("  ③ 快照映射:", "nav: m.manifest?.nav" in rd(p))

# ============ ④ 侧栏：一级菜单项（复用既有 page: tab，不新增 tab 类型） ============
p = "src/renderer/src/shell/Sidebar.tsx"
t = rd(p)
if "page-nav-top-" not in t:
    # 插在「直播」组结束、进入「扩展」组之前
    m = re.search(r"^(        </div>\n)(\s*<div className=\"nav-group\" ref=\{sideNavRef\}>)", t, re.M)
    must(m is not None, "未找到「直播」组与「扩展」组的交界")
    top = '''        {/* C3：声明了 nav.level=1 的模块 → 作为**一级菜单项**出现在这里（点它仍走既有 page: tab）。
            未声明 nav 的模块不受影响，仍在下面的「模块」下拉里。 */}
        {(snap?.modules ?? [])
          .filter((m) => m.page && m.nav?.level === 1)
          .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
          .map((m) => (
            <button
              key={m.id}
              data-testid={`page-nav-top-${m.id}`}
              className={tab === (`page:${m.id}` as Tab) ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(`page:${m.id}` as Tab)}
            >
              {m.name ?? m.id}
            </button>
          ))}
'''
    t = t[:m.start(2)] + top + t[m.start(2):]
    wr(p, t)
print("  ④ 侧栏一级项:", "page-nav-top-" in rd(p))

# 4b) 扩展下拉里排除已升到一级的模块（避免重复出现）
p = "src/renderer/src/shell/Sidebar.tsx"
t = rd(p)
if "m.nav?.level !== 1" not in t:
    m = re.search(r"^(                    \{\(snap\?\.modules \?\? \[\]\)\.map\(\(m\) => \{\n)", t, re.M)
    if m is None:
        m = re.search(r"^(                    \{\(snap\?\.modules \?\? \[\]\)\.length === 0 &&)", t, re.M)
    must(m is not None, "未找到扩展下拉的模块列表渲染点")
    pre = m.group(1)
    # 在 map 之前过滤：把 (snap?.modules ?? []) 换成过滤后的表达式
    t = t.replace("(snap?.modules ?? []).map((m) => {", "(snap?.modules ?? []).filter((m) => m.nav?.level !== 1).map((m) => {", 1)
    wr(p, t)
print("  ④ 下拉去重:", "m.nav?.level !== 1" in rd(p))

# ============ ⑤ 沉浸：先查 useShellLayout 的调用点是否在 App.tsx（棘轮） ============
callers = []
for f in glob.glob(os.path.join(ROOT, "src/renderer/src/**/*.ts*"), recursive=True):
    txt = open(f, encoding="utf-8", newline="").read()
    if "useShellLayout(" in txt:
        callers.append(os.path.relpath(f, ROOT).replace("\\", "/"))
print("  ⑤ useShellLayout 调用点:", callers)
if any(c.endswith("App.tsx") for c in callers):
    print("     ⚠ 调用点在 App.tsx（**棘轮冻结**）⇒ 本轮不动它，留作下一张卡（需先与维护者确认如何在不增行数的前提下接线）")
else:
    print("     · 调用点不在 App.tsx ⇒ 可接线（下一张卡做）")

print("READY")
