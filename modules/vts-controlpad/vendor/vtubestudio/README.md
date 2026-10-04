# vendored: vtubestudio

本目录是**第三方库的 vendor 副本**，不是本仓库代码。

| 项 | 值 |
| --- | --- |
| 上游 | `vtubestudio`（VTube Studio 官方 JS 客户端） |
| 版本 | **3.12.0**（见同目录 `package.json`） |
| 许可 | **MIT**（见同目录 `LICENSE`，原样保留） |
| 运行时依赖 | **无**（上游 `dependencies` 为空） |
| 引入方式 | `npm pack vtubestudio@3.12.0` 后复制 `lib/*.js` + `LICENSE` + `package.json` |

## 为什么要 vendor（而不是加进 package.json）

成品打包后，**模块位于 `resources/modules/`（asar 之外），而 `node_modules` 在 `app.asar` 之内**。
Node 的模块解析是沿着父目录向上找 `node_modules`，而 `app.asar` 是 `resources/` 下的一个**文件**、
不在路径链上 —— 因此模块里的 `require('vtubestudio')` **在成品中必然解析失败**。

vendor 进模块目录后由 `.elm` 打包器"全文件收集"一并带走，模块**自包含**：
开发态与成品态行为一致。

## 为什么用官方库而不是自己实现协议

需求明确"严禁自己重写底层协议"。库在 `ApiClient` 上提供了 `webSocketFactory` 扩展点，
于是可以**用官方库做协议层**，同时把传输换成核心门面 `ctx.externalWs` —— 见
`../../lib/transport.js`。这样既不重写协议，也不违反 AI_RULES 第 3 条「模块禁止自行开 WebSocket」。

同时库把 token 存取抽象成 `authTokenGetter/authTokenSetter` 回调，正好接核心加密凭据存储
（`ctx.credentials`），token 因此**从不经过渲染层**。

## 复制范围（刻意最小化）

已复制：`lib/api.js` `lib/endpoints.js` `lib/types.js` `lib/utils.js` `lib/validation.js`
`lib/ws.js` `lib/index.js` `LICENSE` `package.json` = **约 77 KB**。

**未复制**（运行不需要，纯体积与噪声）：

- `lib/*.d.ts` / `*.d.ts.map`：类型声明（开发期如需查类型，可用 `npm view` 或重新 `npm pack` 取）
- `lib/*.js.map`：sourcemap
- `lib/esm/*`、`lib/iife/*`：浏览器打包产物（我们只用 CJS）

## 如何升级

```powershell
mkdir <tmp>; cd <tmp>
npm pack vtubestudio@<新版本>
tar -xzf vtubestudio-<新版本>.tgz
# 覆盖 lib/*.js 与 package.json、LICENSE，然后跑 npm test（模块测试含清单/自包含性校验）
```

升级后必须确认 `lib/api.js` 里 `apiName` / `apiVersion` 与 `makeRequestMsg` 未变
（变了要同步 `totests/m3-auth.spec.ts` 的模拟服务端）。
