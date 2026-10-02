# 渲染层文件布局与落点规则（CODE-LAYOUT）

> **一句话**：`App.tsx` 只做**编排**，不写功能。新代码一律落到下表对应位置。
> 硬规则见 `AI_RULES.md` **第 25 条**；机械棘轮见 `tests/unit/app-size-budget.spec.ts`。

## 1. 目录地图（`src/renderer/src/`）

| 目录 / 文件 | 放什么 | 不放什么 |
| --- | --- | --- |
| `App.tsx` | **仅**四类：① 全局编排（调用 hooks、注入依赖）② 路由（`tab`）③ 布局壳组装（`<Sidebar/>` `<ContentArea/>` `<ToolBar/>`）④ 标题页门（`entered`） | 页面内容、组件定义、业务状态、副作用逻辑、常量表 |
| `shell/` | **布局件**：`Sidebar` / `ContentArea` / `ToolBar` 及后续同类"壳"组件 | 业务逻辑、数据获取 |
| `screens/` | **整屏**组件（如 `TitleScreen`） | 子面板 |
| `settings/` | 设置页与其子面板（`SettingsPage` / `ModuleManagePanel`） | 设置之外的页面 |
| `diagnostics/` | 诊断页 | —— |
| `slots/` | **槽位**：`ModulePageHost` / `ToolSlot`（含 WebContentsView 几何上报） | 普通展示组件 |
| `hooks/` | 状态与副作用：`useUiSettings` / `useGlassOptics` 及后续 `use*` | JSX 渲染 |
| `app-tables.ts` | 应用级**类型与常量**（`Tab` 及其判定辅助、测试缝常量） | 组件、副作用 |
| `page-props.ts` | **跨文件共用**的 props 契约（中立模块，避免子文件反向依赖 `App.tsx`） | 具体实现 |
| `ui.tsx` | 组件库（Btn/Badge/Toast/Modal/SegGroup…） | 页面级组件 |
| `renderer.css` | 令牌 + 样式（令牌集中在 `:root` / 主题块；细节见 `MODULE_UI_CONTRACT.md`） | 内联颜色字面量（令牌块外） |
| `glass-bake.ts` / `adaptive-text.ts` / `light-angle.ts` | 光学与可读性算法（纯函数优先） | 组件 |

## 2. 落点决策表（"我要加 X ⇒ 放哪"）

| 我要加… | 落到 | 备注 |
| --- | --- | --- |
| 一个新页面（诊断/设置之外） | `screens/`（整屏）或按领域新建目录 | 页面只收 props，不自己取全局状态 |
| 设置页里的一个新分区 | `settings/`（子面板组件） | 通过 props 传 `ui` / `patchUi` |
| 一个新槽位（承载 WebContentsView） | `slots/` | **几何上报 effect 的依赖数组与时机不得改**（红线，`module-view-bounds` 守卫） |
| 侧栏/内容区/工具条的改动 | `shell/` 对应文件 | 布局件**不含 hook/状态** |
| 一段新的状态或副作用 | `hooks/use*.ts` | 依赖以参数注入；本文件内 effect 的依赖数组逐字写清 |
| 一个跨文件共用的类型 | `page-props.ts`（props 契约）或 `app-tables.ts`（应用级） | 禁止子文件 `import … from '../App'` |
| 一个常量/查表 | `app-tables.ts` 或就近模块顶层 | 不塞进 `App.tsx` |
| 一处样式 | `renderer.css`（令牌优先） | 见 `AI_RULES` 24 与 `MODULE_UI_CONTRACT.md` |
| 一个测试 | `tests/unit/`（纯函数/结构）或 `tests/integration/`（真机行为） | 结构守卫的扫描路径见下 §4 |

## 3. `App.tsx` 的例外与上限（棘轮）

- **允许的例外**：编排、路由、布局壳组装、标题页门 —— 除此之外**不新增代码**。
- **行数上限**：由 `tests/unit/app-size-budget.spec.ts` 锁死（当前基线 345 总行 / 310 有效行；
  守卫留少量余量，**任何上调都必须在该任务卡写明理由**）。
- **hook 调用上限**：`useState`/`useEffect`/`useRef`/`useCallback` 的**调用次数不得超过基线**
  ⇒ 新增状态必须进 `hooks/`，不能就地加在 `App` 里。

## 4. 改动落点时**必须同步**的守卫（本会话踩过 5 次）

部分守卫是"**按文件路径 grep**"的结构检查，搬运代码会让它们指向空文件：

| 守卫 | 扫描目标 | 何时需要同步 |
| --- | --- | --- |
| `tests/unit/theme.spec.ts` | `App.tsx` + `settings/SettingsPage.tsx` | 主题/材质相关代码被搬走时 |
| `tests/unit/components.spec.ts` | `App.tsx` + `settings/*` + `screens/TitleScreen.tsx` + `shell/*`（`SHELL_PATHS`） | 布局件或设置页被搬动时 |
| `tests/unit/app-split-round1.spec.ts` | `App.tsx` 与各新文件的持有关系 | 拆分结构变化时 |

**做法**（用户已批准的"方案 A"）：**更新扫描目标、断言语义与覆盖范围不变、不删任何测试**。

## 5. 一次改动的标准流程

1. **定落点**：查 §2 决策表；若结论是"加在 `App.tsx`"，先在任务卡写明理由。
2. **改代码**：只搬/只加在既有边界内，不顺手改功能（`AI_RULES`：不确定不删、不改）。
3. **同步守卫**：按 §4 更新被搬动代码的扫描路径。
4. **四项验收**：`npx tsc --noEmit`（web + node）→ `npx vitest run` → `npx electron-vite build` → `npx playwright test`，**任一失败即 `git revert`，不做修复性改动**。
5. **记录**：应用内可见变化写 `CHANGELOG.md`；实现细节与验收写 `TASKS/*.md`；历史明细进 `docs/CHANGELOG-DEV.md`。
