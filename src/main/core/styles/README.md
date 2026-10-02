# core/styles

样式包服务（任务卡 T10，M3 表现层开篇）。契约见 `src/contracts/styles.ts`（IStylePacks / StylePackEnvelope / StyleHandler）。

## 职责

- `.elstyle` 统一包格式：envelope（type=`eclipse-style` / moduleId / styleType / version=负载格式版本 / createdAt / coreVersion / payload）；**内容嗅探**定形态（PK 魔数→ZIP，否则 JSON）
- 核心统一负责：解析（JSON 或 ZIP：style.json + CSS/图片/字体资源）、顶层校验、版本检查、快照回滚、写配置中心、`styles:applied` 总线事件、导出打包——模块只注册处理器（validate/migrate/apply/export），**不得**自行实现文件选择、解压、配置写入和回滚
- 导入链路：顶层校验 →（ZIP 资源全量预检）→ 处理器查找（模块须已加载注册）→ 版本检查（旧版本须有迁移器；新版本拒绝——与配置中心同策）→ 模块 validate → **快照回滚式应用**（config 分区 + applied 记录先快照，失败恢复；资源经 `.staging-` 原子换入）→ 默认 apply=写模块配置分区（onChange 热更新即"重新渲染"）+ cssVars 持久化 `core.styles` 分区 → 广播事件
- 导出：默认读模块配置分区（或自定义 export handler）→ envelope；模块样式资源目录存在时打包 ZIP（style.json+文件），否则纯 JSON
- 模块卸载联动：unload 时注销该模块全部样式处理器（旧代码不得再应用样式）

## 安全红线（导入时强制）

- **禁止执行脚本**：纯 JSON 数据，无任何求值路径（结构性保证）
- **敏感信息不导入**：payload.config 深扫敏感键（password/token/secret 等 12 类归一化匹配）→ 拒绝
- **CSS 作用域**：CSS 资源禁 `@import` 与带 scheme 的 `url(...)`（无远程引用）；cssVars 值禁 `<`/`>`（防样式标签逃逸）；选择器级作用域隔离归渲染层（如实文档）
- **资源路径不逃逸**：zip-slip 防护（`..`/绝对路径/盘符拒绝 + resolve 双重包含）
- **类型与大小限制**：扩展名白名单（css/png/jpg/jpeg/webp/gif/woff/woff2/ttf/otf）；单文件默认 5MB、总量默认 50MB（可注入）

## 模块接入

`ctx.styles.register(styleType, handler)`（T10 起 ModuleContext 可选门面，moduleId 强制归属）；处理器版本即负载当前版本。

## 测试

- `tests/unit/styles.spec.ts`（15 例：顶层四态/敏感键/cssVars 逃逸/JSON 全链路/处理器查找与注销/validate 失败零写入/迁移两态/应用失败回滚/自定义 apply+export/默认导出/ZIP 资源落位/zip-slip/白名单大小与 CSS 红线/资源导出往返/仓库模板可导入）
- `tests/integration/styles-wiring.spec.ts`（styles ready 日志）

## 已知限制（如实）

- 回滚边界：config 分区与 applied 记录快照恢复、staging 资源删除；**自定义 apply 的其它副作用由处理器自行负责**（文档如实）
- overlay 消费面（cssVars 网关路由/渲染注入）归 T11/T12 按需
- 需求中的 schema/默认值概念映射：schema→validate 函数，默认值→模块配置声明（避免双轨）
