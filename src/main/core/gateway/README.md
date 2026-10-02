# core/gateway

核心本地服务网关（任务卡 T5）。契约见 `src/contracts/gateway.ts`（IGateway）。

## 职责

- 全软件唯一网络面：127.0.0.1 + 动态端口，HTTP 与单一 WS 端点双协议；模块禁止自行监听
- 端口策略：读配置上次端口（`core.gateway.port`，默认 27900）→ 被占时回退系统随机端口 → 实际端口持久化并广播 `gateway:port-changed`（T8 据此更新 OBS 浏览器源）
- token：每次启动随机 48 hex，不持久化、不写日志；HTTP（query / Bearer）与 WS 升级全量校验，无 token 一律拒绝
- 单一 WS 端点 `/ws` 频道多路复用：`{channel, payload}` 信封，仅已注册频道可收发
- 故障隔离：路由/频道 handler 抛错 → 错误环 + 日志 + 500/忽略，绝不拖垮网关
- URL 生成器：`getBrowserSourceUrl` / `getRouteUrl` / `getWebSocketUrl`（启动前为 null）
- 诊断：`diagnostics()` + 内置 `GET /diagnostics`（token 保护）

## 事件

- 发布：`gateway:started` {port}、`gateway:port-changed` {port, previous}、`gateway:stopped`（source=gateway）
- 路由：注册面 `registerHttpRoute` / `registerWebSocketChannel`（重复注册=替换并告警，支持模块热重载）

## 测试

- `tests/unit/gateway.spec.ts`（13 例：URL/端口持久化/占用回退/401/路由语义/500 隔离/内置诊断/WS 闸门/频道路由/广播）
- `tests/integration/gateway-wiring.spec.ts`（真实启动 gateway ready 日志含端口）

## 已知限制

- OBS 端 URL 自动写入属 T8；模块所有权强制属 T6 清单
- 广播为"全体客户端"语义；按客户端定向发送在业务模块需要时再评估
- token 走 URL query（OBS 浏览器源最兼容的方式）；本机回环 + 单用户场景下可接受
