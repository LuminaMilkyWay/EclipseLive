# core/diagnostics

诊断聚合（任务卡 T12）。类型见 `src/shared/diagnostics.ts`（渲染层 DTO——web 程序无 @contracts 别名，UI 类型归 shared）。

## 职责

- `collectDiagnostics`：全服务只读快照——app/网关（**token 只出现存在性布尔**）/模块（含名称、版本、权限、web 标记）/权限/OBS/网页工具/网络/样式已应用（读 `core.styles` 分区元数据）/凭据（**仅元数据：键名、weak 标记，绝无值**）/配置摘要（`IConfig.sections()`，无分区数据）
- `buildDiagnosticBundle`：快照 + 当日日志尾部（默认 200 行）——"一键导出诊断包"数据源（经保存对话框写入用户选择路径）
- 主进程经 `app:diagnostics` IPC 透传；渲染层 2s 自动刷新

## 红线

token 值、凭据值、配置分区数据、完整日志都不经 IPC 广播——只有元数据与聚合计数；诊断包是本地文件。

## 测试

- `tests/unit/diagnostics.spec.ts`（5 例：聚合形状/凭据元数据/样式已应用/配置摘要/诊断包日志尾部）
