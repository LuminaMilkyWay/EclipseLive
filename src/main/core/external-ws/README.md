# core/external-ws — 对外 WebSocket 客户端（C0）

模块**禁止自行开 WebSocket**（AI_RULES 第 3 条），所有对外连接必须走核心门面
（同旨：`core/network/README.md`）。本服务是 `INetworkClient`（HTTP）的 **WebSocket 对应物**。

## 存在的理由

同机伙伴应用（如 VTube Studio 的 `ws://127.0.0.1:8001`）需要长连接 + 双向推送，
HTTP 门面无法表达。此前核心只有 **OBS 专用的** 对外 WS 客户端（`core/obs`），
不能给模块用；本服务把"对外 WS 客户端"提升为**通用核心能力**。

## 三条边界（唯一实现点在本服务的 `index.ts`）

| 边界 | 做法 | 为什么 |
| --- | --- | --- |
| **回环限定** | 只接受 `ws://` / `wss://` + `127.0.0.1` / `localhost` / `::1`；其余一律拒绝 | AI_RULES 第 11 条禁止联网依赖/云服务/遥测。**门面在物理上不具备出网能力**，该红线才守得住 |
| **权限闸门** | `external-websocket`，**连接时**检查（撤销立即生效，无缓存） | 与其他能力一致：用户可否决 |
| **归属** | `${moduleId}:${id}`，重复 id 直接失败（不 upsert） | 连接带活状态；模块间不可互相操作 |

生命周期与 routes / channels / shortcuts / overlays 相同：`removeModule` 关闭该模块全部连接。

## 分层

- `index.ts` — 服务本体（**Electron-free**，注入宿主；测试注入 fake）
- `electron-host.ts` — 唯一接触 `ws` 的部分，只搬回调，**不做策略判断**

宿主不重复实现回环/权限检查：边界只有一个实现点，避免两处逻辑漂移。
因此宿主**只能**由 `createExternalWs` 调用。

## 刻意不做（YAGNI，AI_RULES 第 12 条）

- **不做**握手超时 / 自动重连 / 心跳：这些是模块自己的协议语义
  （VTS 两步认证与 OBS op 握手完全不同），核心只提供通用传输。
- **不做**消息编解码 / 协议适配：核心不认识 VTS 的 JSON 信封——那是模块业务。

## 安全细节

- 状态快照（`status` / `list` / `diagnostics`）里的 URL **已脱敏**（剥离 query/hash）：
  模块可能把一次性凭据放在 query 里，而快照会进日志与诊断页（AI_RULES 第 15 条）。
- 单帧 payload 上限 `EXTERNAL_WS_MAX_PAYLOAD`（1 MiB），防止模块把主进程内存打爆。
- 模块回调（`onOpen` / `onMessage` / `onClose` / `onError`）抛错被**隔离**，
  不影响服务、其他连接或其他模块。
