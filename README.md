# EclipseLIVE

> **许可证边界（一句话）**
> **核心 = AGPL-3.0-or-later** ｜ **接口（`src/contracts/`）、模板、示例、官方模块 = MIT** ｜ **社区模块 = 作者自选（可闭源收费）**
>
> · 遵守 AGPL 即可**免费商用**（含向网络用户提供源码的义务，AGPL §13）；
> · 需要**闭源分发**或不愿承担 §13 义务 ⇒ 见 [`COMMERCIAL_LICENSE.md`](COMMERCIAL_LICENSE.md)；
> · 代码可自由使用，但**品牌不可冒用** ⇒ 见 [`TRADEMARK.md`](TRADEMARK.md)；
> · 完整目录 → 协议对照表见 [`NOTICE`](NOTICE)。 源码仓库：<https://github.com/LuminaMilkyWay/EclipseLive>。


面向虚拟主播的**纯本地** OBS 辅助软件。所有功能以模块形式存在，支持按需安装、卸载、替换；通过本地浏览器源与 OBS WebSocket 与 OBS 通信。

> 当前仓库处于**第一步（核心框架/地基）**开发阶段，尚未包含任何直播业务功能。打字机悬浮窗原型保留在 `prototype/`，后续将以模块形式回归。

## 定位红线

不联网、不登录、不云同步、不做插件市场、不租服务器、不做自建更新服务。云能力仅预留接口，不实现。

## 开发环境

| 依赖 | 要求 |
| --- | --- |
| Node.js | ≥ 18（建议 20+） |
| 包管理 | npm（走 npm 镜像可加速） |

## 安装与运行

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（渲染层 HMR）
npm run build        # 构建到 out/
npm run typecheck    # 双端类型检查
npm run test         # 单元测试（vitest）
npm run test:integration  # 集成测试（先构建后 Playwright 拉起应用）
npm run dist         # Windows 安装包（dist/EclipseLIVE-Setup-<version>.exe）
```

> CN 网络构建安装包建议设置镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。安装包未做代码签名（无证书）——首次安装的 SmartScreen 提示属预期。

## 原型（打字机悬浮窗）

`prototype/` 内为独立的零依赖验证版，与本框架互不影响：

```bash
cd prototype && start.bat       # OBS 浏览器源指向 http://localhost:23334/
```

## 目录速览

- `src/main/core/` — 12 个核心服务（任务卡逐个填充）
- `src/contracts/` — 模块唯一可见的标准接口
- `src/renderer/` — React 管理界面（诊断页、模块管理）
- `modules/` — 预置与用户模块（`example-empty` 参考空模块、`example-web` 参考网页工具）
- `templates/module/` — 新建模块模板（复制到 `modules/<id>`，目录名=id）
- `templates/module-pack/example-empty.elm` — 模块包模板（`.elm` 安装格式示例）
- `templates/style-pack/default.elstyle` — 样式包模板（`.elstyle` 导入格式示例）
- `templates/config/default.json` — 配置模板（导出信封示例）
- `docs` — 见根目录 PRODUCT / ARCHITECTURE / AI_RULES / CONTRIBUTING / TASKS/

更多：[PRODUCT.md](PRODUCT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [AI_RULES.md](AI_RULES.md)

## 关于本仓库的范围

本仓库是**产品与协议**的公开面：源代码、测试、模块与模板、协议文件（LICENSE / NOTICE /
COMMERCIAL_LICENSE / TRADEMARK / CLA / DCO）以及面向使用者的文档。

**内部开发资料不在此公开**（任务卡、开发日志、事故复盘、内部评估报告）—— 它们属于团队内部流程，
对外既无必要也不便公开。参与开发请看 [`CONTRIBUTING.md`](CONTRIBUTING.md)；
模块开发请看 [`MODULE_UI_CONTRACT.md`](MODULE_UI_CONTRACT.md) 与 [`templates/`](templates/)。
