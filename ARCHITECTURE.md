# ARCHITECTURE — 架构与数据

## 总体形态

```
┌─────────────────────────────────────────────┐
│ Electron 主进程 = 核心（只做宿主，零业务）      │
│  lifecycle / gateway / config / bus /        │
│  modules / packages / obs / logger /          │
│  permissions / styles / webtools / net        │
├─────────────────────────────────────────────┤
│ contracts/  ← 模块唯一可见的标准接口            │
├─────────────────────────────────────────────┤
│ 业务模块（.elm 安装、事件总线通信、权限声明）     │
├─────────────────────────────────────────────┤
│ 渲染层 React 管理界面（遥控面板，经 preload）    │
│ OBS（浏览器源 ←→ 网关 HTTP/WS；obs-websocket）  │
└─────────────────────────────────────────────┘
```

## 模块划分（12 核心服务）

| # | 服务 | 职责 | 任务卡 |
| --- | --- | --- | --- |
| 1 | lifecycle | 启动/关闭/单实例/托盘/崩溃恢复 | T12 |
| 2 | gateway | 唯一 127.0.0.1 动态端口，HTTP+WS，token 校验，路由/频道注册 | T5 |
| 3 | config | 按模块 id 分区的配置中心，版本迁移/预设/导入导出 | T2 |
| 4 | bus | 事件总线：发布/订阅/一次性，标准事件格式 | T3 |
| 5 | modules | 模块发现/加载/启停/禁用/隔离 | T6 |
| 6 | packages | .elm 模块包：校验/安装/卸载/目录监听 | T7 |
| 7 | obs | obs-websocket v5 适配，浏览器源 URL 自动写入 | T8 |
| 8 | logger | 分级日志/脱敏/按日滚动/诊断导出 | T1 |
| 9 | permissions | 权限声明/校验/查询/撤销 | T4 |
| 10 | styles | 样式与预设包统一导入导出（回滚保证） | T10 |
| 11 | webtools | WebContentsView 受限容器，独立 session；T29+ 亦承载模块页面（web.url 相对引用，仅本网关 origin） | T11/T29-T31 |
| 12 | net | 统一网络客户端接口（空实现）+ safeStorage 凭据库 | T9 |
| 13 | shortcuts | 全局快捷键（globalShortcut 注入宿主，权限门禁+冲突检测） | T23/T24 |
| 14 | overlays | 悬浮窗服务（BrowserWindow 注入宿主，bounds 钳制+穿透+崩溃隔离） | T25-T27 |
| 15 | external-ws | 对外 WebSocket 客户端（**仅本机回环**，`ws` 注入宿主，权限门禁+归属隔离） | C0 |

## 接口契约

模块只能 import `src/contracts/`：`IModule / IEventBus / IConfig / IObsBridge / ILogger / IPermission / IStylePack / IWebTool / INetworkClient / ICredentialStore / IGlobalShortcuts / IOverlayWindows / IExternalWs / ModuleCredentials`。模块间禁止直接 import、禁止互读配置、禁止调用内部函数——只走事件总线与标准接口。

> 权限闭集（11 项）：`keyboard-capture / obs-control / network-access / file-read / file-write / clipboard / camera / microphone / global-shortcut / window-overlay / external-websocket`。
> 模块可得的能力门面：`config / bus / gateway / permissions / styles / shortcuts / overlays / externalWs / credentials`（后四者按服务装配情况条件注入，均为可选键）。

**web 声明的两种形态（T29 澄清）**：绝对 http(s) URL = 第三方工具（无业务代码，T11 不变）；`/` 前缀相对路径 = **模块页面**（业务模块，entry/routes/events 合法共存——应用内二级菜单入口 + 内容区槽位）。

## 数据流

- 主播输入/模块状态 → 网关 HTTP → 事件总线 → SSE/WS → OBS 浏览器源渲染
- OBS 状态 ← obs-websocket ← OBS 桥接 → 事件总线 → 诊断页/模块
- 配置变更 → 配置中心（写文件+版本）→ 事件 → 订阅方热更新

## 数据分类（必需表）

| 数据 | 敏感 | 可同步 | 可导出 | 存储位置 | 读写权限 |
| --- | --- | --- | --- | --- | --- |
| 用户配置 | 中 | 预留 | 是（JSON） | AppData/EclipseLIVE/config | 核心独占读写；模块经 IConfig |
| 预设 | 否 | 预留 | 是 | 同上 presets 分区 | 同上 |
| 样式包 | 否 | 预留 | 是（JSON/ZIP） | 导入时入配置中心 | styles 服务 |
| 模块包 (.elm) | 否 | 否 | 是 | AppData modules/ | packages 服务校验后落盘 |
| 日志 | 低（已脱敏） | 否 | 是（诊断包） | AppData logs/，按日滚动 | logger 独占写 |
| 统计 | 否 | 预留 | 是 | 配置中心 stats 分区 | 核心独占 |
| 缓存 | 否 | 否 | 否 | AppData cache/ | 各服务自清理 |
| 凭据 | **高** | 否（本地加密） | 否 | safeStorage 加密存储 | ICredentialStore 独占 |
| 全局底图 | 否 | 否 | 否（导出只含设置项） | AppData wallpapers/ | 核心独占 |

## UI 设计令牌（CSS 变量体系，T14–T22）

所有样式只用 CSS 变量，禁止硬编码颜色/尺寸。材质三档**共用同一套变量名，切换只改变量值**。

> **模块 UI 合规**：模块一切界面（应用内模块页 / 展开的功能页 / 悬浮窗 / 模块设置面板）同样只走这套令牌语义，不得自创外观；展开的功能页以**设置的二级菜单**为范本（三级材质为底，遵循区域圆角和显示面积）。模块页零 preload 读不到宿主变量——令牌由宿主**单向注入**（renderer 读计算值 → IPC `module-page:tokens` → 主进程 `executeJavaScript` 写页面 `:root`，白名单见 `src/renderer/src/ui-tokens.ts`），模块页只消费、禁止自建。规范本体 = **MODULE_UI_CONTRACT.md**，机械检查 = `tests/unit/module-ui-contract.spec.ts`（AI_RULES「UI 红线」18–20，违者拒绝合并）。

| 层 | 变量 | 说明 |
| --- | --- | --- |
| 主题层 | `--txt-1` `--txt-2` `--txt-3` `--txt-link` | 文字三级 + 链接色，随 `data-theme="light|dark"` 换值 |
| | `--bg-0` `--bg-card` `--bg-card-2` `--bg-overlay` `--line` `--line-strong` | 底色 / 卡片 / 控件底 / 浮层 / 描边 |
| | `--card-bg` | **玻璃面底色** = `color-mix(--bg-card × --mat-alpha-role)`，随材质角色不透明度 |
| | `--state-hover` `--state-press` | **中性交互态层**（深色 0.16/0.24、浅色 0.12/0.20——深色更重一档） |
| | `--ctrl-bg` `--ctrl-line` | **控件底/描边**（浅色用 `--bg-0` 而非 `--bg-card-2`，否则控件与白卡片同色"消失"） |
| | `--ctrl-shadow-rest/hover/press` | **控件阴影三态**：静止 → 悬停增强 → 按压减小（浅色整体更轻） |
| | `--scrim` | 模态遮罩，**恒半透明黑**，不随主题变（Windows「Smoke」语义） |
| | `--ok` `--bad` `--warn` | 状态色 |
| | `--acc` `--acc-soft` | 强调色（日冕橙 / 青蓝，可切换） |
| 材质层 | `--mat-blur` `--mat-sat` `--mat-alpha` **`--mat-alpha-role`** `--mat-highlight` `--mat-refract` `--mat-shadow-*` | 三档只改变量值 |
| 尺寸层 | `--r-sm` `--r-md` `--r-lg` `--r-xl` **`--r-pill`** | 圆角 8 / 12 / 16 / 24px + 999px 胶囊档 |
| | `--sp-1` … `--sp-7` **`--sp-4h`** | 间距 4 的倍数体系，4–48px（`--sp-4h` = 20px 半档） |
| | `--fs-scale` | 字号缩放 |
| 动效层 | `--ease-standard` `--ease-decelerate` `--ease-accelerate` | 非线性缓动：standard = 状态/材质过渡；decelerate = 进入；accelerate = 退出（禁 linear，进度/加载除外） |
| | `--duration-fast` `--duration-normal` `--duration-enter` `--duration-slow` | 时长四档：120 / 180 / 200 / 250ms（全部 ≤300ms，有单测强锁）；语义见下 |
| 底图层 | `--wallpaper-url` `--wallpaper-opacity` `--wallpaper-blur` | 全局底图，独立于材质调节；显示方式走 `data-wallpaper-fit` 属性 |

**动效时长语义（T-A1）**：`fast` = 退出与微交互（按压、悬停位移、弹窗退场）；`normal` = 浮层（弹窗、Toast、开关滑块）；`enter` = 进入（页面 / 标签 / 模块页槽位）；`slow` = 材质、主题、底图切换。**所有过渡与动画必须消费这两组令牌**，非令牌块出现裸时长或裸缓动即被单测判红。

**刻意不过渡 `backdrop-filter`**：模糊半径插值会持续整面重绘，而换档时模糊瞬时到位几乎不影响观感；去掉它是材质档切换最划算的性能让步（低配与直播场景尤其重要）。

**角色不透明度（`--mat-alpha-role`）**：`--mat-alpha` 服务于**最小的瞬时浮层**（二级下拉、Toast），`--mat-alpha-role`（经 `--card-bg`）服务于**大面**（侧栏、内容卡片、工具条、弹窗、模块页槽位）。依据 Apple HIG：*"Liquid Glass appears **more opaque in larger elements like sidebars** to preserve legibility over complex backgrounds."* 三档取值 **0.88 / 0.82 / 0.80**（均 ≥ 基准 `--mat-alpha`，档间递减）；`[data-reduce-transparency='1']` 下双双归 1。

材质三档预设值（`data-material="1|2|3"` 实时切换）：

| 变量 | 档 1 纯高斯模糊 | 档 2 半高斯半液态玻璃（默认） | 档 3 液态玻璃 |
| --- | --- | --- | --- |
| `--mat-blur` | 12–20px | 12–20px | 20–32px |
| `--mat-alpha` | 1.0（不透明） | 0.65–0.85 | 0.5–0.75 |
| 高光/折射 | 无 | 静态轻渐变 | 静态渐变（禁强折射/强反光） |

实现机制：

- 切换：根节点 `data-theme` / `data-material` 属性切档，实时生效；主题模式 `system` 时监听 `prefers-color-scheme`
- 材质：`backdrop-filter` 高斯模糊 + 半透明纯色底；高光/折射用静态渐变伪元素；失焦不变
- 全局底图：图片存 `userData/wallpapers/`（安全唯一名：原名清洗 + 扩展名白名单 PNG/JPG/JPEG/WebP + 撞名随机后缀），经自定义协议 `eclipse-wallpaper://` 供渲染端取图（白名单解析防穿越）；≤10MB；失败回退纯色；不参与配置导出
- 模块页面注册：复用 manifest `web` 声明闭集（方案 A），`src/contracts/module.ts` 不变
- `core.ui` 配置分区（config 服务）：主题模式 / 强调色 / 材质档位 / 底图设置 / 降级开关 / 检查更新开关，集中持久化
- 降级开关：减少透明度（材质退化为不透明）、高对比度、减少动态效果；档 3 对比度不达标自动降档 2


## 渲染层文件布局（2026-09-30 起）

渲染层按"**编排与功能分离**"组织：`App.tsx` 只做全局编排、路由、布局壳组装与标题页门
（`AI_RULES.md` 第 25 条，配 `tests/unit/app-size-budget.spec.ts` 棘轮）；
页面/槽位/布局件/状态与副作用/类型与常量分别落在 `screens|settings|diagnostics/`、`slots/`、`shell/`、
`hooks/`、`app-tables.ts|page-props.ts`。
**完整目录地图、落点决策表与"改动时必须同步的守卫清单"见 [docs/CODE-LAYOUT.md](docs/CODE-LAYOUT.md)。**

## 关键技术决策

- 单端口单 WS：全软件唯一动态端口，模块注册路由/频道，禁止自行监听
- token：启动随机生成，浏览器源 URL 自动注入，无 token 一律拒绝
- 逻辑卸载声明：JS 模块无法从进程真正卸载代码；"卸载"= 注销路由/事件/状态，内存回收需重启（已知限制，如实写入模块 README）
- UI 材质三档共用 CSS 变量名只改变量值；禁强反光/强折射/强动态模糊（iOS 26 克制原则）
- 全局底图走自定义协议 `eclipse-wallpaper://`，不引入 file:// 直读
- 模块 UI 页面复用 manifest `web` 声明（不新增 `ui` 契约键）
- 检查更新仅查 GitHub Releases 且默认关闭，不设自建更新服务器
