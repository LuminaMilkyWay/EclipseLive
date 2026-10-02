# core/permissions

核心权限服务（任务卡 T4）。契约见 `src/contracts/permission.ts`（PermissionType 闭集 / IPermission）。

## 职责

- 闭集权限目录（8 类），未知权限字符串在声明层拒绝
- 声明即登记；同集合重复声明幂等；**不同集合（提权/降权）一律拒绝**——变更必须走重装
- 撤销即时生效并持久化（经配置中心 `core.permissions` 分区）；授予恢复声明内权限；两者幂等
- `check` 是唯一运行时闸门：未声明模块 / 未声明权限 / 已撤销 → 一律 false
- **撤销记忆跨卸载/重装保留**（重装不放行，直至用户重新授予）
- 异步工厂：等待配置加载完成后再接受声明，消灭"已撤销权限在启动窗口内放行"的竞态

## 事件 / 路由 / 配置 / 权限

- 无事件、无路由、无自有配置；持久化借用 `core.permissions` 分区
- 服务自身无权限需求

## 测试

- `tests/unit/permissions.spec.ts`（9 例：声明/提权拒绝/三态校验/撤销授予持久化/垃圾配置防御/removeModule 记忆/status）
- `tests/integration/permissions-wiring.spec.ts`（真实启动演示声明 + permissions ready 日志）

## 已知限制

- 授予/撤销的变更通知（渲染层界面实时刷新）将在 T12 诊断页接入事件总线后提供
- 安装时用户确认流程属于 T7 包安装（本卡只做登记与校验语义）
