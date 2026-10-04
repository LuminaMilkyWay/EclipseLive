# core/config

核心配置中心（任务卡 T2）。契约见 `src/contracts/config.ts`（IConfig / ConfigDefinition）。

## 职责

- 按模块 id 分区：`<dir>/<moduleId>.json` = `{ format, version, updatedAt, data }`，原子写（tmp+rename）
- 声明式结构：模块只给 defaults + version + 可选 validate/migrate，永不直接碰文件
- 读取 = 默认值与持久化数据深合并（纯对象递归，数组整体替换），返回副本
- 版本迁移：旧版本数据先备份 `.bak` 再迁移；无迁移器时保留原始数据（不丢用户配置）
- 强制校验：set / import / applyPreset 全走同一校验路径，失败不落盘、不通知、不改缓存
- 热更新：onChange 订阅合并值变更；同 id 重复注册忽略并告警
- 预设：集中存 `presets.json`，应用时重新校验（含跨版本迁移）
- 导入导出：统一信封 `eclipselive-config`；导入两阶段（先全量校验后应用），任一注册分区失败整体拒绝；未注册 id 进 skipped

## 事件 / 路由 / 配置 / 权限

- 无事件、无路由、无自有配置、无权限需求
- 冲突合并能力仅预留（version + updatedAt 已落盘），实现属于未来任务卡

## 测试

- `tests/unit/config.spec.ts`（17 例：注册/深合并/校验三不/原子写/损坏回落/迁移备份/导入原子性/预设全流程）
- `tests/integration/config-wiring.spec.ts`（真实启动注册 lifecycle 分区并写 config ready 日志）

## 已知限制

- register 为异步加载（排队）；flush()（实现层方法）供测试等待，正常调用方无需关心
- 导入更老版本且无迁移器时按"原始数据导入"处理并告警（拒绝会丢配置，权衡后保留）
