# CONTRIBUTING — 开发指南

> **当前已知问题与交接状态**：见 [`docs/PROBLEM-REPORT-2026-10-01.md`](docs/PROBLEM-REPORT-2026-10-01.md)。
> 新接手请先读它，再读 `AI_RULES.md`（硬规则）与本文（流程）。


> ✅ **当前政策（2026-10-02 更新）**：**核心落点接受外部贡献，采用
> [Harmony CLA 1.0](docs/cla/README.md) 官方文本** ✓（个人 [`ha-cla-i-v1.pdf`](docs/cla/ha-cla-i-v1.pdf)／
> 实体 [`ha-cla-e-v1.pdf`](docs/cla/ha-cla-e-v1.pdf)）—— 签署方式见 [`CLA.md`](CLA.md)。
> **MIT 落点**（`src/contracts/**`、`templates/**`、`modules/**`、`sdk/**`、`docs/**`）只需 **DCO**。
> **写模块不需要签任何协议** ✓（用 MIT 的 SDK，协议自选）。

## 贡献协议（CLA / DCO）

本项目**分区签署**（详见 [`CLA.md`](CLA.md) 与 [`DCO`](DCO)）：

| 你的改动落点 | 需要 | 怎么做 |
| --- | --- | --- |
| **核心**：`src/main/**`、`src/preload/**`、`src/renderer/**`、`src/shared/**`、`tests/**`、`scripts/**` | **CLA** | PR 描述中写：`I have read the CLA in CLA.md and I agree to it.` ＋ `Signed: 姓名 <邮箱>`，维护者登记到 [`CLA-SIGNATORIES.md`](CLA-SIGNATORIES.md) |
| **接口 / 模板 / 模块 / 文档**：`src/contracts/**`、`templates/**`、`modules/**`、`docs/**` | **DCO** | 提交时加 `-s`：`git commit -s`（生成 `Signed-off-by:` 行） |

⚠️ **两点必须知道**：

1. **DCO 不授予本项目"商业再许可权"** —— 那是 CLA 才有的条款。
   所以只要改动触及**核心**，就必须走 CLA 一栏，否则该项目**无法**把这份代码纳入商业授权。
2. **未签署的 PR 不会被合并到核心落点**（**不可逆**：先合并再补签不能追溯授权）。
   建议先开 Issue 讨论设计，再签协议提交代码。

**本地自检**（无依赖）：

```bash
node scripts/check-signoff.mjs 10   # 检查最近 10 个提交是否满足 DCO
```


## 开发环境

- Windows 11 / Node.js ≥ 18 / npm
- 推荐镜像加速：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

## 安装 / 构建 / 测试

```bash
npm install
npm run dev              # 开发（渲染层 HMR）
npm run typecheck        # node + web 两套 TS 检查
npm run test             # vitest 单测
npm run test:integration # electron-vite build + Playwright 拉起真实应用
npm run build            # 产出 out/
```

## 任务卡流程（唯一工作方式）

1. 在 `TASKS/` 建卡（格式见 TASKS/README.md）
2. **先写测试** → 实现 → 文档同步
3. typecheck / 单测 / 集成测试全绿
4. 交付验收清单 + 回滚方法，等用户放行下一张
5. 每张卡一个或一组独立 commit

## 代码规范

- TypeScript strict，无 `any`（确需时写明原因）
- 注释英文为主，关键复杂处可加中文；解释"为什么"，不复述代码
- 所有导出接口/函数/类型/事件/路由/配置字段/权限必须 TSDoc
- 死代码与被注释掉的代码不留
- 样式只用 CSS 变量做令牌，禁止引入大型样式框架

## 提交信息格式

```
<scope>: <动词过去式简述>

<卡号>: T<n>
```

示例：`core(logger): add leveled logger with masking. T1`

分支策略：`main`（稳定）+ `card/T<n>-<slug>`（任务卡分支），卡验收后合入。

## 如何新增模块

1. 用 `templates/module/` 模板复制出新目录
2. 填写 module.json（id/版本/权限/事件/路由/coreVersion）
3. 实现入口 + 声明事件 + 声明配置 + 声明样式
4. 写 UI（**强制合规**）：规范本体 = **MODULE_UI_CONTRACT.md**（含强制模板/禁区/豁免/上线清单），摘要见 PRODUCT.md「UI 外观与交互规范 · 模块 UI 规范」。展开的功能页以**设置的二级菜单**为范本，必须按照原来的样子：**以三级材质为底，遵循区域圆角和显示面积**；样式只消费宿主注入令牌（T33），禁止硬编码颜色与尺寸、禁止自建主题令牌（AI_RULES「UI 红线」18–20，机械检查 `tests/unit/module-ui-contract.spec.ts` 变红 = 拒绝合并）
5. 在 `modules/` 下加该模块的最小测试
6. 提交后按 T7 的 .elm 流程打包分发

> 验收清单必须含 UI 一致性检查：展开的功能页/设置面板与设置二级菜单逐项比对——材质底（三级材质）、区域圆角（走 `--r-*`，与所在区域一致）、显示面积（铺满槽位矩形，不外扩/不内缩/不越区滚动），并跑绿 `module-ui-contract.spec.ts`。唯一例外：OBS 浏览器源/悬浮窗画布（须声明 `canvas` meta；其模块内设置面板不例外）。

## 如何写测试

- 纯逻辑 → `tests/unit/`（vitest，import 目标模块直接断言）
- 走真实进程的流程 → `tests/integration/`（Playwright `_electron.launch`）
- 每张卡的新公共 API 至少有一条测试

## 如何更新文档

改了架构/数据流/接口 → 更新 ARCHITECTURE.md；改了行为 → CHANGELOG.md；
改了流程/规范 → CONTRIBUTING.md；模块内部行为 → 模块自己的 README。
**文档不同步 = 拒绝合并。**

## 改动落点（新代码放哪）

先查 [docs/CODE-LAYOUT.md](docs/CODE-LAYOUT.md) 的**落点决策表**：
新页面 → `screens|settings|diagnostics/`；槽位 → `slots/`；布局件 → `shell/`；状态与副作用 → `hooks/`；
类型与常量 → `app-tables.ts` / `page-props.ts`。
**`App.tsx` 原则上不新增代码**（`AI_RULES.md` 第 25 条）：它只承载 ① 全局编排 ② 路由 ③ 布局壳组装 ④ 标题页门；
若确需改动使其变长，必须在任务卡写明理由，并同步 `tests/unit/app-size-budget.spec.ts` 的基线。

## 守卫同步（搬运代码时的固定动作）

部分单测是"按文件路径 grep"的结构检查，**搬运代码会让它们指向空文件**。改动落点后必须：
① 在对应守卫里把扫描目标**前移**到新的持有者（断言语义与覆盖范围不变、**不删任何测试**）；
② 跑四项验收：`npx tsc --noEmit`（web + node）→ `npx vitest run` → `npx electron-vite build` → `npx playwright test`；
③ **任一失败即 `git revert`，不做修复性改动**。
当前需要留意的守卫：`tests/unit/theme.spec.ts`、`tests/unit/components.spec.ts`（含 `SHELL_PATHS`）、
`tests/unit/app-split-round1.spec.ts`、`tests/unit/app-size-budget.spec.ts`。

## 更新日志两份文件（每次改动都要看这一节）

| 文件 | 读者 | 写什么 | 什么时候写 |
| --- | --- | --- | --- |
| `RELEASE_NOTES.md` | **用户**（软件内「更新日志」页 + 升级弹窗只读它） | 只有 新增 / 修复 / 调整；每条一句话 ≤50 字；性能类写成「优化了 … 的性能表现」 | **有用户可感知变化时**必写 |
| `CHANGELOG.md` | **开发者**（界面不读） | 问题原因、复现、修复方案、涉及文件、影响范围、测试结果、回滚方法 | **每次技术改动**必写 |

- `RELEASE_NOTES.md` 只保留软件内会显示的那几版；当前版本没有段 ⇒ 不弹"更新了什么"弹窗。
- 守卫：`tests/unit/release-notes-guard.spec.ts`、`tests/unit/changelog.spec.ts`、`tests/unit/build.spec.ts`。
- 硬规则：`AI_RULES.md` 第 21 / 23 条的"口径变更"小节与第 27 条。

## 公开面与内部资料

本仓库只包含**产品与协议**。内部流程资料（任务卡、开发日志、事故复盘、内部评估）**不公开**，
但它们记录的**规则**已提炼进本文件与 [`AI_RULES.md`](AI_RULES.md) ⇒ 贡献者只需读这两份。
