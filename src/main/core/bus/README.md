# core/bus

核心事件总线（任务卡 T3）。契约见 `src/contracts/event.ts`（CoreEvent / IEventBus）。

## 职责

- 模块间唯一合法通信通道；纯路由，不解释类型与负载（需求红线）
- 标准信封：type / source / time / version / payload? / userId?
- 同步派发 `publish`（注册序、快照语义）与异步派发 `publishAsync`（微任务、FIFO、可 await）
- `once` 一次性订阅（触发前可退订；handler 抛错也只消耗一次）
- 错误隔离：订阅者抛错记 error 日志，不影响发布者与同类型其他订阅者
- userId 预留：bus 级默认 + 单次覆盖，不生成 ID（匿名 = 字段缺省）

## 事件 / 路由 / 配置 / 权限

- 自身无事件、无路由、无配置、无权限需求

## 测试

- `tests/unit/bus.spec.ts`（13 例：格式/同步/once/异步保序/错误隔离/快照）
- `tests/integration/bus-wiring.spec.ts`（真实启动 lifecycle:started 事件往返）

## 已知限制

- 仅进程内（主进程）；跨进程转发属于网关（T5）之后的桥接工作
- 事件声明清单（发布/订阅哪些类型）由 T6 模块清单承载，总线不做校验
- 无通配符订阅；T12 诊断页需要观察流时再评估
