# core/obs

OBS 桥接（任务卡 T8）。契约见 `src/contracts/obs.ts`（IObsBridge / ObsDiagnostics）。

## 职责

- **只连接不占用**：obs-websocket v5 出站客户端（`ws://127.0.0.1:<port>`，默认 4455，`core.obs.port` 可配）；网关仍是唯一监听面
- v5 握手：Hello → Identify（rpcVersion 1 + eventSubscriptions）→ Identified；OBS 索要密码时按 challenge/salt 计算 SHA-256 认证串（`core.obs.password`）
- 请求：op6/op7 按 requestId 匹配 + 超时拒绝；**传输层失败 reject，OBS 业务失败 resolve `ok:false`**（语义分离）；`send()` 覆盖场景/源/滤镜/音量/转场/录制/推流读写
- 事件：op5 转发为内部总线 `obs:<eventType>`（source=obs），任何模块可订阅
- 重连：失败指数退避 `min(base × 2^(attempts-1), cap)`（默认 1s→30s）；成功归零；`disconnect()` 停止、`reconnect()` 重置；`connect()` **永不抛错、不阻塞启动**
- 浏览器源绑定（`core.obs.bindings` 持久化）：连接成功与 `gateway:port-changed` 时同步——URL 取自网关（token 自动注入）；已存在则 SetInputSettings 更新（仅 URL 变化时，overlay 合并）、不存在则 GetSceneList 取当前场景 CreateInput（browser_source 800×600）；单绑定失败只标记 `synced:false + lastError`
- 诊断：状态/端口/尝试数/最近错误/最近连接时间/请求响应计数/绑定状态

## 红线

- **URL/密码绝不写日志**：浏览器源 URL 内嵌网关 token——同步日志只记 sourceName/path/synced
- 密码当前为本地配置明文（`core.obs.password`）——T9 凭据存储升级，如实记录

## 已知限制（如实）

- 单测针对模拟 v5 服务验证协议行为；**真实 OBS 互通在用户验收校准**（事件订阅掩码默认 65535 全量，可经配置调整）
- OBS 事件的 intent 掩码经 Identify 单值下发，未做按模块的订阅裁剪（T12 诊断页按需评估）
- 模块侧 obs 门面（`ctx.obs`）未提供——等真实模块需要时立 SDK 卡（YAGNI）
- CreateInput 固定 800×600 初始尺寸（OBS 内可调；同步只覆盖 URL）

## 测试

- `tests/unit/obs.spec.ts`（10 例：握手/请求往返与超时/密码认证/缺密码提示/事件转发/未运行不阻塞+重试冻结/断线自动重连/浏览器源创建同步/端口变化更新与解绑）
- `tests/integration/obs-wiring.spec.ts`（obs bridge ready 日志，不阻塞启动）
