# core/network

统一网络客户端——本地空实现（任务卡 T9）。契约见 `src/contracts/network.ts`（INetworkClient / NetworkDiagnostics）。

## 职责

- **接口先行**：所有未来的对外网络请求必须走 `INetworkClient`——模块不得直接使用 fetch 或第三方 HTTP 客户端（模块契约规则，评审强制；模块侧门面将随真实云需求在 `network-access` 权限闸门后出现）
- **本地空实现**：`request()` 一律 reject（红线信息 + 计数 + 诊断 `mode:'local-empty'`）——不接入任何云端点，接云需要核心变更 + 用户显式同意，不可能被模块意外触发
- 诊断：拒绝计数 + 最近拒绝原因（T12 诊断页"网络状态"数据源）

## 已知限制（如实）

- T9 即"接口 + 空实现"全部；请求选项（method/headers/body/timeout）已定型，真实实现随未来云需求立卡
- 拒绝信息不含 URL（防模块误把 token 拼进 URL 泄漏到诊断/日志）
