# `src/contracts/` · **MIT 许可**（接口层）

> **本目录下的所有文件采用 MIT 许可**（见同目录 [`LICENSE`](LICENSE)），
> 而非仓库根目录的 AGPL-3.0。这是 EclipseLIVE **双协议边界**的接口层。

## 为什么接口是 MIT

模块作者**必须**读这些契约才能开发模块。若接口也是 AGPL，社区开发模块就会背负
copyleft 的心理与合规负担 ⇒ 我们不希望如此。因此：

| 层 | 协议 | 说明 |
| --- | --- | --- |
| 接口层（**本目录**） | **MIT** | 只有类型、常量与契约语义；**不含实现** |
| 实现层（`src/main/core/**` 等） | AGPL-3.0-or-later | 宿主、总线、权限、网关、包服务等 |
| 模块（`modules/**`、社区 `.elm`） | 作者自选 | 可 MIT、可闭源收费 |

## ⚠️ 本目录的**硬性纪律**

1. **只允许**：`interface` / `type` / `import type` / `const` 字面量 / `enum` 声明，
   以及**窄口子**——`export function f(...) { return <单个表达式> }`（**单 return 的纯谓词**）：
   例如 `isPermissionType` / `isNavigationAllowed` / `isLoopbackWsUrl` 这类模块做本地校验必需的小函数；
2. **禁止**：函数体（除纯类型收窄的 `declare function`）、类实现、任何副作用（I/O、注册、订阅）；
3. **禁止**：把实现"顺手"搬进来 —— 那会让该文件变成 AGPL 作品，**边界立即失效**；
4. 需要给模块用的**算法或工具**：放到 `src/shared/**`（AGPL）并经事件总线/通道暴露，**不要**放进本目录。

> 该纪律由机械守卫强制（见 `tests/unit/contracts-purity.spec.ts`）。

## 给模块作者

- 你**可以**自由复制/参考本目录的定义（MIT）；
- 你的模块**不因调用这些接口**而成为核心的衍生作品（见根目录 [`NOTICE`](../../NOTICE) 第 3 节）；
- 模块协议**由你决定**，包括闭源收费；包内请放 `LICENSE` 并在 `manifest.json` 写 `license`。
