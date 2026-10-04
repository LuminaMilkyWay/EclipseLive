# 第三方组件声明（THIRD-PARTY NOTICES）

本文件列出 **EclipseLIVE 安装包/免安装包中实际包含的第三方组件**及其许可证全文位置。
本项目遵循 [`NOTICE`](NOTICE) 第 5 节的承诺：**分发时一并保留这些许可证** ✓。

> 本文件由守卫 `tests/unit/license-coverage.spec.ts` 钉住：`package.json` 的每个
> 运行时依赖**必须**出现在下表中（版本以本项目实际安装为准）。

## 1. 运行时依赖（打包进安装包）

| 组件 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| `adm-zip` | 0.6.1 | **MIT** | 依赖（随安装包分发） |
| `react` | 19.3.0 | **MIT** | 依赖（随安装包分发） |
| `react-dom` | 19.3.0 | **MIT** | 依赖（随安装包分发） |
| `ws` | 8.21.3 | **MIT** | 依赖（随安装包分发） |

许可证全文位置：各依赖目录内的 `LICENSE`（发布包中位于 `node_modules/<组件>/LICENSE`）。

## 2. 应用运行时（由 Electron 提供）

| 组件 | 许可证 | 说明 |
| --- | --- | --- |
| Electron | **MIT** | 应用外壳；其内置 Chromium 的第三方声明随包提供：`dist/win-unpacked/LICENSES.chromium.html` ✓ |
| Chromium | **BSD-3-Clause** 等（多个） | 见上（Electron 随包的 `LICENSES.chromium.html`） |
| Node.js | **MIT** | 运行时（Electron 内置） |

## 3. 仓库内嵌的第三方代码

| 位置 | 许可证 | 说明 |
| --- | --- | --- |
| `modules/vts-controlpad/vendor/vtubestudio/` | **该目录自带 `LICENSE`** ✓（保留原有协议，不得重许可） | VTube Studio 客户端库；随模块包 `.elm` 一同分发（模块包内保留其许可证 ✓） |

## 4. 本项目自身的授权

- 核心（`src/main`、`src/preload`、`src/renderer`、`src/shared`、`tests`、`scripts`）：**AGPL-3.0-or-later**
- 接口（`src/contracts`）、模板（`templates`）、官方模块（`modules/*`）、SDK（`sdk`）、对外文档（`docs`）：**MIT**
- 完整对照表见 [`NOTICE`](NOTICE) 第 2 节。
