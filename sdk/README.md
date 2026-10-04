# EclipseLIVE SDK（**MIT**）

> 这是模块作者需要的一切，**全部 MIT** —— 你不需要（也不会被迫）接触核心的 AGPL 代码。
>
> **协议边界**：核心 = AGPL-3.0-or-later；**本 SDK、接口（`contracts/`）、模板、示例、官方模块 = MIT**；
> 你的模块**协议由你自己决定**（可 MIT、可闭源收费）。详见仓库根 [`NOTICE`](../NOTICE) 与
> [`COMMERCIAL_LICENSE.md`](../COMMERCIAL_LICENSE.md)。

## 目录

| 路径 | 内容 | 来源 |
| --- | --- | --- |
| `contracts/` | 模块可用的**全部接口与常量**（类型/字面量/单 return 纯谓词） | 主仓 `src/contracts/` 的**逐字节镜像** |
| `templates/` | 模块骨架与包样例（复制即用，**自带 LICENSE**） | 主仓 `templates/` 的镜像 |
| `mock-host/` | **离线假宿主**：不装 Electron 就能跑模块（清单自查 + 假 ctx + 本地静态服务） | 本仓库 |
| `LICENSE` | MIT 全文 | — |

## 镜像规则（重要）

`contracts/` 与 `templates/` 是**镜像**，请**不要**在这里提 PR 改它们 ✗ ——
改动请提到主仓的 `src/contracts/` / `templates/`，然后运行同步：

```bash
node scripts/sync-sdk.mjs      # 主仓 → sdk/（单向）
```

主仓有一条机械守卫 `tests/unit/sdk-mirror.spec.ts`：**镜像与主仓不一致就会变红** ⇒
因此"接口改了但 SDK 没同步"这类漂移**不可能悄悄发生** ✓。

## 先跑起来（不装宿主）

```bash
node sdk/mock-host/index.mjs ../modules/example-empty
```

它做**清单自查** + 假 `ctx` + 本地静态服务；但**不是宿主**（不做权限管控/原生能力/沙箱）⇒
正式验收仍在 EclipseLIVE 内。详见 [`mock-host/README.md`](mock-host/README.md)。

## 写一个模块（最少三步）

1. 复制 `templates/module/` 为一个新目录（含 `manifest.json` 与 `LICENSE`）；
2. 在 `manifest.json` 里声明 `id` / `version` / `permissions` / `entry`（或 `web`）与 **`license`**；
3. 用 `contracts/` 里的类型实现 `index.js`，只经宿主注入的 `ctx` 与事件总线通信。

**不要**复制核心代码、不要依赖核心内部符号 —— 模块只经公共接口通信，因此**你的模块是独立作品**，
可以自选协议（包括闭源收费）。

## 打包

模块包 `.elm` 由**宿主**生成（模块作者不需要打包工具）：

- 包内**必须**有 `LICENSE`；`manifest.json` **必须**声明 `license`；
- 声明真实协议（如 `MIT`）却**没有**许可证文件 ⇒ 宿主的打包闸门会**拒绝打包**；
- `UNLICENSED`（专有/未授权）⇒ 允许打包且不要求许可证文件。
