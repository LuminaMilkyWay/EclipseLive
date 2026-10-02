# core/packages

`.elm` 模块包服务（任务卡 T7）。契约见 `src/contracts/packages.ts`（IModulePackages / ElmPackageInfo）。

## 职责

- `pack`：模块目录 → `.elm`（ZIP）；manifest.json → module.json 映射，附 `format=1` / `coreVersion` / `license` / `sha256`（**入口文件 SHA-256**，保护被执行代码）
- `inspect`：全量校验预检，不落盘（T12 文件选择安装的确认流数据源）
- `install`：六项校验 → `.staging-<id>-<rand>` 解压 → 旧目录 rename 至 `.trash-<id>-<ts>` → 原子换入 → 清 trash；失败回滚
  1. id（目录名=manifest.id 不变量，复用 T6 `validateManifest`）
  2. 版本：降级拒绝（`force` 旁路），重装/升级放行
  3. coreVersion：`'*'` 或 `'>=x.y.z'`（按段数值比较 app 版本）
  4. 权限闭集（T6 清单契约原样执行）
  5. SHA-256 入口摘要
  6. 文件安全：zip-slip 防护（`..` / 绝对路径 / 盘符条目拒绝；双重 resolve 包含检查）
- `uninstall`：unload + 删目录；**配置分区、权限撤销记忆、禁用状态保留**（重装不得静默复权、仍为 disabled）
- `watch`：`fs.watch recursive` + 400ms 防抖 + reconcile——新/变更 `.elm` 自动安装并加载启动（升级路径 unload→install→load→start）；模块目录消失自动卸载

## module.json ↔ manifest.json

`.elm` 内描述文件为 `module.json`（需求命名，含包级字段 format/sha256/coreVersion/license）；安装落成模块目录内的 `manifest.json`（T6 发现器不变量），仅携带模块运行时字段（id/名称/版本/作者/描述/权限/依赖/入口/配置/事件/路由/频道/**web**——页面模块声明随包往返保留，安装后二级菜单数据源 `DiagnosticsModule.page` 依赖它）。

## 已知限制（如实）

- 签名体系未实现（本地优先、无密钥设施），`signed` 恒 false——未签名风险确认弹窗归 T12 UI；目录监听路径按需求自动安装（能写 modules 目录者已具备本机代码执行能力）
- watcher 对写入中的 `.elm`（拷贝未完成）可能安装失败并记录 mtime——文件完成前不再重试；文件选择路径（T12）无此问题
- 升级安装后新代码需重启应用生效（import 缓存，同 T6 逻辑卸载边界）
- 逐文件完整性（资源哈希）留待按需扩展；当前 sha256 仅覆盖入口文件

## 测试

- `tests/unit/packages.spec.ts`（9 例：pack→inspect 往返 / install 端到端含 T6 管理器全通 / 版本守卫 / coreVersion 守卫 / sha256 篡改 / zip-slip / format 与描述符缺失 / uninstall 保留配置 / watcher 自动安装卸载）
- `tests/integration/packages-wiring.spec.ts`（packages ready 日志）
