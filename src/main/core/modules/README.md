# core/modules

核心模块管理器（任务卡 T6，M1 收尾）。契约见 `src/contracts/module.ts`（IModuleManager / ModuleManifest / ModuleContext / IModule）。

## 职责

- 发现：模块根目录（dev=仓库 `modules/`，打包=`userData/modules`）下一目录一模块；**目录名必须等于 manifest.id**；点/下划线开头目录跳过；清单校验（id kebab-case、版本 x.y.z、权限闭集、entry 不得逃逸模块目录、路由/频道/事件/配置声明形状）
- 加载：依赖检查（须已成功加载 + 最低版本按段数值比较）→ 权限经 `permissions.declare` → 配置经 `config.register`（分区 id=模块 id）→ 入口导入（CJS `module.exports` / ESM `export default` 均可）→ `init(ctx)`
- 所有权强制：`ctx.gateway` 只能注册清单声明的路由/频道（否则抛错，由崩溃隔离接住→failed）；`ctx.bus` 只能发布声明事件且 **source 强制为模块 id**（伪装无效）；`ctx.config` / `ctx.permissions.check` 绑定本模块分区；`ctx.logger` 为 `modules:<id>`
- 崩溃隔离：import/init 抛错 → failed 并**回滚半程注册**（路由/频道/订阅/权限声明）；start 抛错 → failed；stop 抛错仅告警；核心与其它模块绝不波及
- startAll：discover → 拓扑序（DFS + 环检测）加载启动全部启用模块；环上模块 failed（"dependency cycle detected"）且不阻塞他人
- 禁用/启用：`core.modules.disabled` 持久化；disable 即停机卸载；load 对 disabled 拒绝
- restart：卸载→重载→启动，**同一入口实例**（import 缓存）重新走 init

## 逻辑卸载边界（如实）

卸载会注销：该模块的网关路由/频道、总线订阅、权限声明（**撤销记忆按权限契约保留**——重装不得静默复权）。

以下内容驻留至应用重启（内存级回收需重启，不做虚假承诺）：config 分区注册表（契约无注销接口，defaults 无害）、权限撤销记忆、ESM 入口实例的 import 缓存。

## 模块资产

- `modules/example-empty/` — 预置参考空模块（合法清单 + 空入口，随 startAll 启动）
- `templates/module/` — 新建模块模板（复制到 `modules/<id>`，目录名=id）

## 测试

- `tests/unit/modules.spec.ts`（12 例：发现/清单校验、生命周期与 ctx 接线、所有权强制与回滚、事件 source 强制、卸载清理、重启计数、崩溃隔离、依赖三态、禁用/启用、startAll 拓扑/损坏/禁用/环）
- `tests/integration/modules-wiring.spec.ts`（真实启动发现并启动 example-empty）

## 已知限制

- .elm 打包安装归 T7；模块管理 UI 归 T12；manager 自身不发状态事件（T12 诊断页按需）
- manifest 的配置声明不含校验器/迁移器（JSON 不可携带函数；代码侧声明留待模块 SDK 卡评估）
