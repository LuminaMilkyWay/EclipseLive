# core/webtools

网页工具容器（任务卡 T11）。契约见 `src/contracts/webtools.ts`（IWebTools / WebToolDeclaration / WebToolHost / isNavigationAllowed）。

## 职责

- 网页工具 = **声明式模块**（manifest `web` 字段：url/allowedDomains/partition?/windowMode/pinned/icon?；无 entry/routes/events/channels——无业务代码），经 T6 管理器同等启停/禁用/卸载
- **注入式 host**：核心服务零 Electron 依赖（单测注入 fake host）；组装根用 `electron-host`（WebContentsView——不用 iframe）
- 隔离：每工具独立 `persist:webtool-<partition ?? moduleId>` 会话（登录态保持、互相隔离、与主程序隔离）
- **默认拒绝四闸门**：导航仅放行 allowedDomains origin（精确含端口）+ 计数；新窗口 deny；下载 preventDefault；权限请求拒绝（T12 在此之上加用户确认授予流）
- 无 preload：内嵌页无 Node.js/文件/核心访问（结构性保证；有限 API 属未来显式暴露）
- **模块页 UI 令牌（T33）**：模块页零 preload 读不到宿主设计令牌——`IWebTools.setUiTokens` 把宿主当前解析值经 IPC `module-page:tokens` 收下，清洗（`sanitizeUiTokens`：`--` 前缀键 + 值无 `;{}`）后由 host `executeJavaScript` 注入页面 `:root`（`buildUiTokenScript`；did-finish-load 与 reload/重开后自动重注入）。规范本体 `MODULE_UI_CONTRACT.md`，机械检查 `tests/unit/module-ui-contract.spec.ts`
- 诊断：工具数/打开数/拒绝计数/最近拒绝环（20 条）——T12 诊断页"网页工具状态"数据源

## 已知限制（如实）

- embedded 模式布局为整内容区（T12 侧边栏/分区细化）；window 模式独立 BrowserWindow
- "内嵌网页是第三方服务"提示文案与图标渲染归 T12 UI
- session 的 permission/download 处理器挂在 partition 会话上（同 partition 的工具共享处置策略——默认拒绝一致）

## 测试

- `tests/unit/webtools.spec.ts`（6 例：open 全链路/拒绝与重开/partition 覆写与 window 模式/导航策略与拒绝计数/纯策略函数/list 与诊断）
- `tests/unit/modules.spec.ts` 网页工具模块 4 例（声明式加载同等/entry 拒/routes-events 拒/坏声明四态）
- `tests/integration/webtools-wiring.spec.ts`（webtools ready 日志）
