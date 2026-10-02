# core/logger

核心日志服务（任务卡 T1）。契约见 `src/contracts/logger.ts`（ILogger）。

## 职责

- 统一行格式：`<ISO> [level] [source] message :: {masked-json}`
- 分级：debug/info/warn/error，`setLevel` 运行时调整且作用于整棵来源树
- 脱敏（强制管道，序列化前）：敏感键（password/token/secret/credential/authorization/apikey/session 及复合键）与**用户输入键（text/content/body）**一律 `[MASKED]`；深度上限 4、字符串上限 200
- 轮转：文件名带日期（`eclipselive-YYYY-MM-DD.log`），写前检查跨日
- 保留期：默认 14 天，仅删除自家前缀的过期文件
- 健壮性：写盘走串行异步队列，任何 IO 失败仅 `console.warn`，不影响进程

## 事件 / 路由 / 配置 / 权限

- 无事件、无路由、无自有配置（级别由启动参数决定，T2 接入配置中心后迁移）
- 无权限需求

## 测试

- `tests/unit/logger.spec.ts`（脱敏/分级/格式/轮转/保留/健壮性）
- `tests/integration/logger-wiring.spec.ts`（真实启动写日志）

## 已知限制

- 追加写非原子，进程被强杀时最后一行可能不完整（可接受）
- 日志目录需可写；被占用时降级为仅控制台输出
