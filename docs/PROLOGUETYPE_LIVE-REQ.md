# PrologueType Live（.elm 模块）需求总览 — 给新 Agent 的开发参考
> ⚠️ **行号已失效（2026-09-30）**：本文中的 `App.tsx` 行号写于 T37 期间。此后 `App.tsx` 已按
> [APP-TSX-SPLIT-ASSESSMENT.md](./APP-TSX-SPLIT-ASSESSMENT.md) 拆分完毕（**1571 → 310 行**），
> 相关代码迁至 `shell/`（布局件）、`settings/`、`diagnostics/`、`slots/`（槽位）、`hooks/`（状态与副作用）、
> `app-tables.ts` / `page-props.ts`（类型与常量）。**新代码落点一律以
> [CODE-LAYOUT.md](./CODE-LAYOUT.md) 与 `AI_RULES.md` 第 25 条为准**；本文行号仅作历史留痕。



> 用途：新 agent 接手 PrologueType Live 模块开发前的**唯一入口文档**。包含：.elm 模块开发规范速览、需求结构化总览、现状可行性评估、需核心补充的通用能力、模块设计草案（目录 / module.json / 路由 / 事件 / 配置 schema / 页面结构 / 实现顺序 / 风险点）。
> 纪律：**本阶段不写业务代码、不改核心**。第 7 节"待拍板问题"经用户确认后，才按第 6 节子任务顺序实现。一次只做一张任务卡（AI_RULES §13）。

---

## 1. .elm 模块开发规范速览

权威来源（本节是摘要，冲突以源文件为准）：

| 主题 | 文件 |
| --- | --- |
| 模块契约（清单/上下文/生命周期） | `src/contracts/module.ts` |
| .elm 打包安装 | `src/main/core/packages/README.md`、`src/contracts/packages.ts` |
| 模块管理器行为 | `src/main/core/modules/README.md` |
| 网关 / 事件 / 配置 / 权限 / 样式 | `src/contracts/gateway.ts`、`event.ts`、`config.ts`、`permission.ts`、`styles.ts` |
| 硬规则 | `AI_RULES.md` |
| 架构与红线 | `ARCHITECTURE.md` |

> 注意：需求原文提到的 `docs/MODULE_GUIDE.md` **目前不存在**；模块规范分散在上表文件中。本节即为等效速览。

### 1.1 目录与清单

- 模块根目录：开发态 = 仓库 `modules/`；打包后 = `userData/modules`。**一目录一模块，目录名必须等于 `manifest.id`**；`.`/`_` 开头目录跳过。
- `id` 格式：小写 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`）；`version`：纯 `x.y.z`（暂不允许预发布后缀）。
- 每个模块必备：`manifest.json` + 入口脚本 + 配置声明 + 事件声明 + 路由/频道声明 + 测试 + 验收清单（AI_RULES §6）。

`manifest.json` 字段（`ModuleManifest`）：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | string | kebab-case，= 目录名 |
| `name` / `version` / `author?` / `description?` | string | version 为 `x.y.z` |
| `permissions` | PermissionType[] | **闭集 8 项**（见 1.3），未知项拒绝 |
| `dependencies` | `{id, version?}[]` | 依赖须已加载，版本按段数值比较；环 → failed |
| `entry` | string | 相对路径，**不得逃逸模块目录** |
| `config?` | `{defaults, version}` | 注册为以模块 id 为键的配置分区 |
| `events?` | string[] | **闭集**：仅可发布此处声明的事件类型 |
| `routes?` | `{method: GET\|POST, path}[]` | **闭集**：仅可注册此处声明的路由 |
| `channels?` | string[] | **闭集**：仅可注册此处声明的 WS 频道 |
| `web?` | WebToolDeclaration | 纯声明式网页工具专用；**与 entry/routes/events/channels 互斥**（`modules/index.ts` 校验：`web tool modules must not declare an entry`） |

### 1.2 生命周期与 ModuleContext

- 入口导出 `IModule`：`init(ctx)` → `start()` → `stop()`（均可选、可异步）。
- 崩溃隔离：import/init/start 抛错 → 该模块 `failed` 并回滚半程注册，核心与其它模块不受影响；`stop` 抛错仅告警。
- 逻辑卸载边界：卸载注销路由/频道/订阅/权限声明；config 分区注册、权限撤销记忆、import 缓存驻留至重启。
- `ctx`（`ModuleContext`）是**唯一能力入口**：`logger`（`modules:<id>`）、`config`（本分区 get/set/onChange）、`bus`（发布限声明事件、source 强制为模块 id）、`gateway`（仅声明路由/频道；`getRouteUrl` / `getBrowserSourceUrl` / `getWebSocketUrl` / `broadcast`）、`permissions.check`、`styles?`（样式包注册）。

### 1.3 权限闭集（`permission.ts`）

`keyboard-capture` / `obs-control` / `network-access` / `file-read` / `file-write` / `clipboard` / `camera` / `microphone`。

- 声明即授予，用户可撤销（立即生效、重装不复权）；重复声明必须完全一致（改权限 = 重装）。
- **闭集扩展必须改核心**（契约明示 by design）——见第 4 节 C2。

### 1.4 .elm 包格式（`packages.ts` / T7）

- `.elm` = ZIP。包内描述文件名为 `module.json`（= manifest 字段 + 包级 `format=1` / `coreVersion` / `license` / `sha256`）；`sha256` 为**入口文件** SHA-256。安装落盘后还原为模块目录内的 `manifest.json`（T6 发现器不变量）。
- `pack`：模块目录 → `.elm`；`inspect`：全量预检不落盘；`install`：六项校验（id 不变量 / 版本降级拒绝、升级放行 / `coreVersion` 为 `*` 或 `>=x.y.z` / 权限闭集 / sha256 摘要 / zip-slip 防护）+ 原子换入；`uninstall`：删目录但**保留**配置分区、权限撤销记忆、禁用状态；`watch`：modules 目录丢入 `.elm` 自动安装启动（写入未完成的包可能装失败，文件选择安装无此问题）。
- 签名体系未实现（`signed` 恒 false，未签名确认弹窗归 UI）；升级后新代码**需重启生效**（import 缓存）。

### 1.5 模块红线（AI_RULES + 需求第七节）

禁止：改核心 / App.tsx / 核心服务 / 全局样式变量 / 清单格式 / 事件格式 / 核心接口；自行监听端口、自开 WebSocket、直连外网、读写其它模块配置、调其它模块内部函数；**记录用户文本输入**（日志、持久化均不允许）；硬编码颜色和尺寸（样式只用 CSS 变量）。模块间只走事件总线 + contracts。每个功能可独立禁用、崩溃隔离、可回滚；**先写测试后写实现**；任务卡完成 = 测试 + 文档 + 验收清单 + 回滚方法。

---

## 2. PrologueType Live 需求总览（结构化）

定位：面向无声系主播的独立 .elm 模块。两部分：**软件内控制页面**（输入文字、调样式、发送）+ **OBS 浏览器源显示页面**（视觉小说式逐字展示）。不改核心，只用核心接口注册路由/事件/配置/权限/样式。对应 PRODUCT.md 场景"打字机风格把主播输入逐字显示（原型已验证，将以模块回归）"。

### 2.1 基础功能

- 出现在左侧模块菜单，名称 `PrologueType Live`。
- OBS 通信基于核心网关生成的 URL（`getBrowserSourceUrl`，token 自动嵌入）；**不自行拼接端口和 token**。
- OBS 显示随源长宽自适应（不裁切/不拉伸/不错位）。
- 逐字显示（打字机），速度可调；**未点发送时 OBS 不显示任何内容**，发送后才开始逐字显示。
- 换行滚动：当前行超出显示区整体上移、新行从下方进入，滚动速度可调。
- 调色盘改文字色；开头/结尾特殊符号（如 `[` / `]`），可留空、可多字符，每段显示前后包裹。
- 字体切换基于 Windows 系统字体库，选择后 OBS 同步生效。

### 2.2 OBS 显示样式（六组合）

无底图无外框 / 无底图有外框 / 高斯模糊无外框 / 高斯模糊有外框 / 纯色无外框 / 纯色有外框。每种可调：背景色、文字色、外框色、模糊强度、透明度、外框宽度。**所有参数实时生效**。

### 2.3 模块详情页

顶部第一部分 = URL 生成区：不展示 URL 明文，只放**「获取URL」按钮**；点击复制当前 OBS 浏览器源地址到剪贴板并提示"已复制"。

### 2.4 悬浮输入窗（可选功能）

形态对标 B 站直播姬：置顶、半透明、不抢焦点的**纯浮动输入框**（不是弹幕查看器/消息列表）。输入进打字机队列，由 OBS 页逐字展示。

- 窗口：始终置顶但不抢焦点、不致全屏游戏切出/最小化；不进任务栏（或独立工具窗口）；可拖动、调大小、记忆位置尺寸；吸附屏幕边缘；主界面最小化/隐藏时独立显示；多显示器可选屏；关闭后不影响模块主页面与 OBS 显示。
- 输入：文本框 + 发送按钮；发送/快捷键（回车、自定义）入队；清空输入、撤销上一条、暂停队列；与主页面**共享同一配置与队列**（两入口按序播放）；可显示最近发送几条（仅确认用，非弹幕列表）。
- 透明度：背景透明度、文字透明度**分别可调**（不透明→高度透明），文字必须始终可读；鼠标穿透开关（开启后点击穿透到下层）+ 快捷键/托盘入口**临时关闭穿透**恢复操作；透明与穿透实时生效并保存。
- 边界：不强制游戏窗口化、不改游戏显示模式、不注入进程、不绕过反作弊；仅独立顶层窗口；**不承诺所有全屏模式下可见**（独占全屏受系统/游戏限制），受限时给提示而非反复抢焦点。
- 样式：悬浮窗样式**独立于 OBS 样式**（背景色/文字色/外框色/模糊强度/透明度独立设置，实时生效；支持六组合或至少独立参数）。
- 权限与隐私：需声明窗口置顶/透明/多显示器相关权限；不记录用户文本输入以外的敏感信息；不访问网络；不绕过权限系统；悬浮窗崩溃不影响主页面与 OBS 显示。

### 2.5 配置项（至少）

- 模块：文字颜色、字体、字号、打字速度、滚动速度、开头符号、结尾符号、显示样式类型、背景色、外框色、外框宽度、模糊强度、透明度。
- 悬浮窗：是否启用、显示屏幕、位置、尺寸、背景透明度、文字透明度、是否鼠标穿透、穿透快捷键、背景色、文字色、外框色、模糊强度、字体、字号、是否吸附边缘、是否记住位置、发送快捷键、是否显示发送历史。
- 全部经核心配置中心读写，实时生效并保存。

### 2.6 验收标准（摘要）

模块出现在模块菜单；详情页「获取URL」可复制；发送→OBS 逐字显示、未发送不显示；打字速度/滚动速度/符号/字体/文字色可调实时生效；六样式可切、调色盘可用；OBS 源尺寸变化自适应。悬浮窗：独立开关、置顶、拖动/缩放/记忆、透明可调文字可读、穿透可开关有恢复入口、全屏下不强制切出、发送后按规则显示、关闭后主页面与 OBS 不受影响。**核心文件与 App.tsx 零改动**，旧模块旧功能不受影响。

---

## 3. 现状可行性评估（对照 2026-09-23 代码）

| 需求点 | 现状 | 结论 |
| --- | --- | --- |
| OBS 浏览器源逐字展示 | 网关单端口 HTTP+WS、`getBrowserSourceUrl(path)`、channel `broadcast`，OBS 桥还能自动同步浏览器源 URL（`gateway:port-changed` 重写） | ✅ 完全支持，纯模块内实现 |
| 配置中心读写、实时生效 | `ctx.config`（分区=模块 id，onChange 热更新） | ✅ 支持 |
| 事件/路由/频道注册 | 闭集声明制，卸载自动清理 | ✅ 支持 |
| 六样式 + 调色盘 + 自适应 | OBS 页面内 CSS/JS | ✅ 模块内实现（样式只用 CSS 变量） |
| 「获取URL」复制 | `clipboard` 权限已有；但**复制动作在哪个页面执行**取决于页面承载方案（见下） | ⚠️ 取决于 C1 |
| **控制页/详情页进应用内** | 业务模块（带 entry）**不能**声明 `web`（校验明令互斥）；纯 `web` 工具又不能有 entry/routes/channels（无法注册网关路由）；且 `web.url` 要求静态 http(s) origin 精确列入 allowedDomains，而网关端口动态（冲突时 OS 分配）→ origin 不可预知 | ❌ **缺口 C1**：业务模块的应用内页面没有承载机制 |
| **悬浮输入窗**（置顶/透明/不抢焦点/无任务栏/穿透/多屏/吸附记忆） | 全项目无 `alwaysOnTop` / `transparent` / `skipTaskbar` / `setIgnoreMouseEvents` / `globalShortcut` 任何调用；webtools 的 `windowMode:'window'` 只是普通 1120×720 BrowserWindow（[electron-host.ts](../src/main/core/webtools/electron-host.ts)）；contracts 无窗口接口 | ❌ **缺口 C2** |
| 穿透恢复快捷键 / 发送全局快捷键 | 无全局快捷键服务；`keyboard-capture` 权限存在但无对应能力接口 | ❌ **缺口 C3** |
| 字体切换（Windows 系统字体库） | 项目无字体枚举能力；Electron 无内置枚举 API | ⚠️ **缺口 C4**（可降级：常用字体白名单 + `local()` 字体栈，纯模块内实现，见 7.4） |
| 发送历史 | 需求允许"最近几条"，但红线禁止记录用户输入 | ✅ 仅内存会话级（模块内约束） |

**结论**：OBS 显示链路（打字机主功能）现有机制完全够用；**两个硬缺口**——①业务模块的应用内页面承载（C1）②悬浮窗通用窗口能力（C2，含 C3 全局快捷键）。二者都是**核心通用能力**，按 AI_RULES §5 必须排独立核心卡、单独审查，不能夹带在模块卡里。

---

## 4. 需核心补充的通用能力（归属划分）

> 原则：核心只提供**与业务无关的通用窗口/页面承载原语**；打字机、队列、样式、吸附算法、历史等一切业务留在模块内。

### C1 模块页面承载（核心通用能力）— **已落地（T29/T30/T31/T32，2026-09-25，方案 A）**

- ~~问题：业务模块无法获得应用内页面。~~
- **落地结果（方案 A 原样落地，零新契约键）**：`web.url` 双语义——绝对 http(s)=第三方工具（T11 不变）；`/`-前缀相对路径=**模块页面**（web 与 entry/routes/events 合法共存，第三方页仍禁业务防伪装）。核心侧：`validateManifest` 放宽（T29）+ **webTool 加载分支修正**（web+entry 走正常 init——T31 修复的关键 bug：原实现短路导致页面 404）+ webtools open 运行时 `getRouteUrl` 解析（token/端口跟随，`gateway:port-changed` 自动 reload）+ 导航闭集注入网关 origin + `GatewayResponse.contentType`（text/html 页面路由）。渲染层（T31）：左侧"扩展"组**二级菜单**自动列出页面模块 → `page:<id>` 动态 Tab → 内容区**槽位**（WebContentsView 按 ResizeObserver 实时矩形叠加、保活互斥显示"最后激活者赢"）。
- **clipboard 特例（C1 附带评估的落地答案）**：自家网关 origin 页面放行 `clipboard-sanitized-write`（复制按钮可用）；剪贴板**读**仍默认拒；第三方工具不享特例。webtools 容器仍是零 preload（模块页面与容器同权，模块页与核心通信走自家网关 WS 频道）。
- 模块侧消费（PrologueType Live）：manifest `web: { url: '/prologue-live/control', ... }` + 控制页路由（text/html）即可获得应用内页面入口；「获取URL」按钮用 `navigator.clipboard.writeText`（经特例放行）。

### C2 悬浮窗通用服务（核心通用能力）— **已落地（T25/T26/T27，2026-09-23）**

- ~~提案：contracts 新增窗口契约（名称示意）`IOverlayWindows`，能力原语与业务无关：创建/销毁浮窗（`alwaysOnTop`、`transparent`、`skipTaskbar`、`focusable` + `showInactive`、无边框可拖拽/可缩放）；`setClickThrough(on)`（支持 forward）；显示器枚举与按屏定位（`screen` API）；bounds 读写（位置/尺寸记忆由**模块配置**存，核心只给原语）；生命周期隔离：浮窗崩溃/关闭只通知模块，不影响主窗口。~~
- **落地结果**：`src/contracts/overlays.ts`（`IOverlayWindows` + `ModuleOverlays` 门面（`ctx.overlays`）+ 注入式 `OverlayWindowHost`）+ `core/overlay-windows`（Electron-free 服务：bounds 钳制防丢窗 / 所有权闭集 / 回调抛错隔离 / staleness 守卫）+ `electron-host.ts`（BrowserWindow 工厂：`ready-to-show` 后 `showInactive` 显示不抢焦点 / `screen-saver` 置顶 / `setIgnoreMouseEvents(+forward)` 穿透 / `render-process-gone` 崩溃隔离）；权限闭集新增第 10 项 `window-overlay`；**URL origin 闭集**（悬浮窗只载模块自己的网关页面）+ **专属最小 preload**（仅 `resize` 一方法，透明窗 Windows 无系统 resize 的对策桥；模块页面绝不获得主窗富桥）；撤销权限即销毁（create 门禁 + IPC 联动双保险，grant 不恢复须 restart）；托盘"悬浮窗：关闭鼠标穿透"逃生入口（穿透恢复三入口闭环：模块快捷键 / 托盘 / 权限撤销）；诊断快照含 overlays 节（URL 红线：不出 token）。
- 归属不变：置顶、透明、任务栏、穿透、多屏**是核心能力**（已落地）；吸附边缘、记忆位置（onMoved/onResized 回调已供）、透明度滑块、样式、发送历史**是模块内实现**（PrologueType Live 消费）。
- 真机手动验收清单（9 项，见 TASKS/T27-overlay-surface.md）：PrologueType Live 悬浮窗接入时逐项执行。

### C3 全局快捷键（核心通用能力）— **已落地（T23/T24，2026-09-23）**

- ~~提案：contracts 新增 `IGlobalShortcuts`（register/unregister/冲突上报），底层 `globalShortcut`；权限复用 `keyboard-capture` 或新增 `global-shortcut`（拍板项 7.2）。~~
- **落地结果**：`src/contracts/shortcuts.ts`（`IGlobalShortcuts` + `ModuleShortcuts` 门面 + 注入式 `ShortcutHost`）+ `core/shortcuts`（Electron-free 服务）+ `electron-host.ts`（globalShortcut 胶水）；权限闭集新增第 9 项 `global-shortcut`（拍板 7.2 已决：不复用 `keyboard-capture`）；模块经 `ctx.shortcuts` 注册；撤销权限即失效（触发时门禁 + `module:permission:set` 主动清理，grant 不恢复须 restart）；诊断快照含 shortcuts 节。
- 模块内：快捷键触发"发送/暂停/切换穿透"等业务动作映射（PrologueType Live 消费时接线）。

### C4 系统字体枚举（可选，倾向模块内降级）

- 若做核心能力：`ILocalFonts.list()`（只读字体名清单，不读文件内容）。
- 降级方案（推荐先做）：模块内置常用 Windows 字体白名单 + 用户手输字体名，CSS `local()` 字体栈生效——零核心改动。拍板项 7.4。

---

## 5. 模块设计草案（PrologueType Live）

### 5.1 目录结构（模块目录，id = 目录名）

```
modules/prologue-live/
  manifest.json        # 开发态清单（打包为 .elm 时映射为 module.json，含 format/coreVersion/license/sha256）
  index.js             # 入口：init/start/stop；队列引擎、路由/频道/事件/配置/样式注册
  pages/
    obs.html           # OBS 浏览器源页面（逐字引擎 + 六样式渲染 + 自适应）
    overlay.html       # 悬浮输入窗页面（输入/发送/历史/拖拽缩放手柄）
    control.html       # 控制/详情页（获取URL + 发送 + 调色盘 + 全部设置组）
  src/                 # 页面共享脚本/样式（纯静态资源，随包分发）
  tests/               # 模块测试（先于实现编写）
```

- 页面均由 `GET` 网关路由提供（见 5.3），OBS/悬浮窗/控制页全部同源网关、token 走 URL 注入（现状机制），**不自拼端口/token**。
- 静态资源服务也走声明路由（如 `GET /assets/*`——若路由闭集只允许精确 path，则以 `GET /asset?name=` 查询参数形式注册，实现时按 T5 路由匹配规则定）。

### 5.2 module.json / manifest.json 字段草案

```json
{
  "id": "prologue-live",
  "name": "PrologueType Live",
  "version": "0.1.0",
  "author": "EclipseLIVE",
  "description": "无声系主播打字机：输入文字经 OBS 浏览器源逐字展示，含悬浮输入窗",
  "permissions": ["clipboard", "keyboard-capture", "window-overlay"],
  "dependencies": [],
  "entry": "index.js",
  "config": { "defaults": {}, "version": 1 },
  "events": ["prologue-live:queue-changed", "prologue-live:style-changed", "prologue-live:float-changed"],
  "routes": [
    { "method": "GET", "path": "/prologue-live/obs" },
    { "method": "GET", "path": "/prologue-live/overlay" },
    { "method": "GET", "path": "/prologue-live/control" },
    { "method": "GET", "path": "/prologue-live/state" },
    { "method": "POST", "path": "/prologue-live/send" }
  ],
  "channels": ["prologue-live"]
}
```

- `permissions` 中 `window-overlay`（及视方案而定的快捷键权限）依赖 C2/C3 落地；`clipboard` 供「获取URL」复制。
- 声明事件**只含元数据**（计数/状态/样式），文本内容只在模块内部 + 网关频道内流转，不进 bus、不进日志（红线：禁止记录用户文本输入）。
- 若 C1 走方案 A，另加 `web` 声明指向 `/prologue-live/control`（url 相对引用形式按核心实现定）。

### 5.3 路由设计

| 路由 | 用途 |
| --- | --- |
| `GET /prologue-live/obs` | OBS 浏览器源页面（「获取URL」复制的就是它的 `getBrowserSourceUrl`） |
| `GET /prologue-live/overlay` | 悬浮窗页面（由 C2 浮窗承载加载） |
| `GET /prologue-live/control` | 控制/详情页（C1 承载进应用内模块页） |
| `GET /prologue-live/state` | 初始化状态 JSON（当前样式/队列概要/配置），页面首屏用 |
| `POST /prologue-live/send` | 文本入队（备选入口；页面主通道走 WS 上行） |

WS 频道 `prologue-live`：
- 下行（`broadcast`）：`state`（全量样式/配置推送，配置改动实时生效）、`enqueue`（新段落入队，含文本）、`action`（undo/pause/clear 等队列操作结果）。
- 上行（`onMessage`）：`send`（入队）、`action`（撤销/暂停/清空）。两入口（主页面/悬浮窗）共用此通道 → **天然同队列顺序播放**。

### 5.4 事件设计（bus）

| 事件 | payload（元数据，无文本） | 用途 |
| --- | --- | --- |
| `prologue-live:queue-changed` | `{ pending, playing, paused }` | 诊断/状态徽章 |
| `prologue-live:style-changed` | `{ scope: 'obs'\|'float' }` | 样式包/状态同步 |
| `prologue-live:float-changed` | `{ enabled, clickThrough }` | 悬浮窗状态 |

订阅：`gateway:port-changed`（URL 变化后刷新「获取URL」与已复制地址语义；OBS 浏览器源由核心 obs 桥自动重写）。

### 5.5 配置 schema（config.defaults 草案，version 1）

**OBS 显示 / 文字（模块组）**

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `textColor` | color | 文字颜色 |
| `fontFamily` / `fontSize` | string / number | 字体、字号（fontFamily 来源见 C4） |
| `typingSpeed` | number | 打字速度（建议 ms/字，10–500） |
| `scrollSpeed` | number | 行滚动速度 |
| `prefixSymbol` / `suffixSymbol` | string | 开头/结尾符号，可空可多字符 |
| `styleType` | enum | 六组合：`none\|blur\|solid` × `border\|no-border` |
| `bgColor` / `borderColor` | color | 背景/外框色 |
| `borderWidth` | number | 外框宽度 |
| `blurStrength` | number | 模糊强度 px |
| `opacity` | number | 透明度 0–100 |

**悬浮窗（float 组，同分区嵌套键）**

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | 是否启用 |
| `screen` | string/number | 显示屏标识（C2 枚举） |
| `x/y/width/height` | number | 位置尺寸（配合 `rememberPosition`） |
| `bgOpacity` / `textOpacity` | number | 背景/文字透明度**分别设置**，文字保底可读 |
| `clickThrough` | boolean | 鼠标穿透 |
| `toggleThroughHotkey` / `sendHotkey` | string | 穿透切换 / 发送快捷键（C3） |
| `bgColor` / `textColor` / `borderColor` / `blurStrength` | — | 悬浮窗独立样式 |
| `fontFamily` / `fontSize` | — | 悬浮窗独立字体 |
| `snapEdges` / `rememberPosition` | boolean | 吸附边缘 / 记忆位置 |
| `showHistory` | boolean | 显示发送历史（内存，条数上限实现定，建议 5） |

- 所有值经 `ctx.config` 读写（validate 自写、version 升级走 migrate），实时生效；颜色/尺寸一律走 CSS 变量注入，**不硬编码**。
- 发送历史**不入配置、不落盘**（红线）。

### 5.6 页面结构

- **control 控制/详情页**：① URL 生成区（「获取URL」按钮 + 已复制 Toast；无 URL 明文）→ ② 输入区（文本框、发送、清空、撤销上一条、暂停队列、发送历史几条）→ ③ 文字组（颜色/字体/字号/打字速度/滚动速度/开头/结尾符号）→ ④ 显示样式组（六组合切换 + 调色盘：背景/文字/外框/模糊/透明度/外框宽度）→ ⑤ 悬浮窗组（启用/屏幕/透明度×2/穿透+快捷键/样式/字体/吸附/记忆/发送快捷键/历史开关）。
- **obs 页**：透明页面底（无底图=透明，适配 OBS 浏览器源惯例）；打字机引擎（逐字定时器、暂停/撤销/清空语义）；行滚动容器（超出整体上移、新行下方进入）；符号包裹；六样式渲染 + 全部参数实时热更（订阅 `state` 推送）；`ResizeObserver` 自适应源长宽。
- **overlay 悬浮窗页**：文本框 + 发送按钮（回车发送）；最近几条历史；拖动/缩放手柄（依赖 C2 的无边框窗口 + app-region 支持）；穿透开启时提示恢复入口（快捷键/托盘）；样式独立渲染。

### 5.7 实现顺序（子任务卡，一次一张、测试先行）

| # | 卡 | 类型 | 内容 |
| --- | --- | --- | --- |
| 0 | 拍板 | — | 第 7 节问题确认（C1 方案、权限命名、C4 路线等） |
| W1 | 核心：C1 页面承载 | 核心卡（单独审查） | web/entry 互斥放宽 + 网关页面 URL 解析 + 容器复制通道；契约形状不变 |
| W2 | 核心：C2 浮窗服务 + C3 全局快捷键 | 核心卡（单独审查） | `IOverlayWindows` + `IGlobalShortcuts` + 权限闭集扩展 + 崩溃隔离 |
| M1 | 模块骨架 | 模块卡 | 目录/manifest/配置 schema/路由频道事件声明 + 空入口 + 测试 |
| M2 | OBS 显示页 | 模块卡 | 队列引擎、逐字、滚动、符号、六样式、自适应 |
| M3 | 控制页 | 模块卡 | 输入发送、调色盘全参数、获取URL 复制 |
| M4 | 悬浮窗 | 模块卡 | 窗口生命周期、置顶/透明/穿透/恢复入口、吸附、记忆、多屏 |
| M5 | 快捷键与队列操作 | 模块卡 | 发送/穿透切换快捷键、撤销/暂停/清空、历史 |
| M6 | 样式包 | 模块卡 | `ctx.styles.register`（obs/float 两个 styleType，.elstyle 导入导出） |
| M7 | 收尾 | 模块卡 | 测试补全、验收清单（对照 2.6）、文档、回滚方法 |

### 5.8 风险点

1. **全屏独占游戏可见性**：Windows 独占全屏下任何顶层窗口都可能不可见或致游戏最小化（尤其显示瞬间抢焦点）。对策：`showInactive` 不抢焦点、置顶层级选型、说明文案明示"无边框/窗口化全屏可用，独占全屏不保证"、受限时一次性提示**不反复抢焦点**。验收条款"不强制切出"以此为前提。
2. **穿透变砖**：穿透开启后无法点击悬浮窗 → 恢复入口（全局快捷键 + 托盘）必须在穿透开启前可用且可靠；恢复入口失效视为严重缺陷。
3. **页面承载（C1）方案影响面**：webtools 容器无 preload、默认拒绝权限请求/下载/新窗口——复制按钮、字体枚举、与核心通信（token）都要在该安全模型下重新评估；网关 token 出现在页面 URL 与剪贴板（现状即如此），文档需提示勿泄露。
4. **快捷键冲突**：`globalShortcut.register` 可能失败（被占用）→ 必须上报冲突并允许改键，不静默。
5. **队列并发**：两入口（主页面/悬浮窗）同时发送的顺序与撤销语义（"撤销上一条"指最后入队还是最后播完）需在 M1 测试里定死。
6. **文本脱敏**：日志/诊断/事件一律不得携带用户输入文本；测试须断言（沿用 logger 脱敏机制）。
7. **字体枚举**：无官方 API；白名单方案可能覆盖不全，用户手输兜底。
8. **测试环境**：BrowserWindow/全局快捷键在 CI/无头环境不可用 → 仿 webtools 模式把 Electron 依赖收敛到装配根，服务层注入假宿主；预留测试 seam。
9. **打包校验**：入口 sha256 只覆盖 `index.js`——页面资源不入摘要（已知限制），注意 `coreVersion` 声明与版本降级守卫。
10. **升级生效**：模块升级后新代码需重启（import 缓存），文案提示。

---

## 6. 回滚

- 模块级：禁用/卸载 `prologue-live` 即回滚（配置分区与撤销记忆保留是契约行为）。
- 核心级（W1/W2）：独立提交、独立回滚；契约改动（权限闭集扩展、校验放宽）附迁移说明。

---

## 7. 待用户拍板（确认后才开始实现）— **拍板项 1/2 已全部定案并落地**

1. ~~**C1 页面承载方案**~~ → **已定：方案 A**（2026-09-23 拍板，T29–T31 落地，零契约键变更）。
2. ~~**全局快捷键权限**~~ → **已定：新增 `global-shortcut`**（T23）+ **`window-overlay`**（T25），闭集现 10 项。
3. **打字速度/滚动速度单位与档位**（建议 ms/字 + 数值滑块）。
4. **字体方案**：C4 核心枚举 /（推荐）白名单 + 手输降级。
5. **发送历史**：条数上限（建议 5）与"撤销上一条"的确切语义。
6. **W1/W2 两张核心卡的排期**（在模块卡之前）——AI_RULES §5/§13 要求核心改动单独审查、一次一卡。
