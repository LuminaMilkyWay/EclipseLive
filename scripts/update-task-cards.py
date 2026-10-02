"""按用户三点补充更新任务卡：新布局沿用现有材质等级 / T40 凭据 IPC 结论 / UI 问题具体化。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = os.path.join(ROOT, "TASKS")


def append(path, text):
    p = os.path.join(T, path)
    t = open(p, encoding="utf-8").read()
    if text.strip().split("\n")[0] in t:
        print("SKIP=" + path)
        return
    open(p, "w", encoding="utf-8", newline="\n").write(t.rstrip("\n") + "\n" + text)
    print("UPDATED=" + path)


MATERIAL = """

## ★★ 材质与档位约束（用户补充，2026-09-30）

> 用户原话：「新布局基于现有材质等级」。

- **不新建材质体系**：任务栏与专注布局**只消费现有令牌**（`--card-bg` / `--mat-*` / `--ctrl-*` / `--r-*` /
  `--mat-edge-*` / `--mat-shadow-*`）⇒ 四档各自呈现**既有材质**，档位切换自动跟随。
- **档位令牌块一个字节不改**：`[data-material='1'|'2'|'3'|'4']` 的令牌定义保持原样
  ⇒ "前三档冻结"守卫（`tests/unit/material-tiers-1-3-frozen.spec.ts`）必须继续为绿。
- **对前三档的唯一影响是"布局"而非"材质"**：侧栏可回缩、任务栏常驻属于**结构变化**，
  不改变任何档位的颜色/模糊/不透明度配方 ⇒ 因此**不再需要"前三档授权"**（此前评估里的问题 4 由此关闭）。
- **机械守卫**：新增规则中**不得**出现 `--mat-*` 令牌的**重新定义**（只允许消费）。
"""

UIQ = """

## ★★ UI 侧问题的具体选项（用户要求"需要具体一些"）

请逐题点一个（括号内为我的建议）：

**Q1 触发范围**
- A. **仅「OBS 直播中控」页自动回缩**，其它页面保持现状；任何页面都可手动切换（**建议**）
- B. OBS 页 + 其它**内置功能页**（设置/诊断/更新日志）在进入时都回缩
- C. **所有**页面（含模块页与网页工具页）一律自动回缩 ⇒ 需接受嵌入页面在动画期间逐帧 reflow 的抖动

**Q2 锁定模式的语义范围**
- A. **三条全要**：① 不自动隐藏 ② 不参与回缩动画 ③ 位置固定（**建议**）
- B. 只要 ① + ②
- C. 只要 ②（锁定时仅不参与动画，其它照旧）

**Q3 Dock 形态**
- A. **保持条状 + chip + 文字标签 + 右端状态区**（改动最小、信息最全，**建议**）
- B. 图标化、居中排列、hover 放大（最像 macOS Dock，成本最高，且需为每个入口设计图标）
- C. 混合：默认显示图标 + 文字，hover 时才放大并强调标签

**Q4 专注模式下手动入口的位置**
- A. 任务栏**最左端**一个"侧栏"开关按钮（**建议**，与 Dock 语义一致）
- B. 顶部悬浮的小把手（需要新增浮层，成本更高）
"""

append("T38-dock-taskbar.md", MATERIAL)
append("T38-dock-taskbar.md", UIQ)
append("T39-expand-layout-capability.md", MATERIAL)

OBS_IPC = """

## ★★ T40 前置结论：凭据 IPC 是否刚需（已实测，2026-09-30）

**实测证据**
- `src/preload/index.ts` 暴露的桥面里**没有任何凭据 API**（只有 appInfo / diagnostics / changelog /
  module:* / package:* / style:* / webtool:* / module-page:*）。
- 主进程侧确实有加密凭据：`src/main/index.ts` 创建 store，并在 L536 用 `credentials.set('obs:password', …)`
  —— 但那是**命令行参数**入口，渲染层够不到。
- 渲染层现有唯一相关引用是**只读计数**（诊断页显示 `snap.credentials.count`）。

**结论：不是绝对刚需，但有两条路**

| 选项 | 做法 | 代价 | 评价 |
| --- | --- | --- | --- |
| **A（推荐）** | **新增一条 additive IPC**（如 `obs:stream-key:set`），把密钥写入既有加密凭据存储；界面上只回显掩码 | 属"**新增**接口"（不改任何既有接口/事件/配置结构）⇒ **需你批准** | 体验最好：加密落盘、下次自动填充 |
| B（零 IPC 备选） | **本地不落盘**：密钥仅本次会话内存持有，经既有 OBS 桥 `SetStreamServiceSettings` 下发给 OBS；需要时用 `GetStreamServiceSettings` 向 OBS 读回 | 重开软件需重新输入（或从 OBS 读回） | 完全不新增接口；仍满足"密钥加密存储"（**存储在 OBS 自己的加密配置里**） |

**两者都必须做到**：日志与诊断包对 `key` / `password` 字段白名单过滤 ⇒ **零明文**（守卫断言）。

> **开工前请点一个：A（批准新增一条 IPC）或 B（零 IPC）。**
"""

append("T40-obs-direct-mvp.md", OBS_IPC)
