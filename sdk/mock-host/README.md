# mock-host（SDK 的一部分 · MIT）

让模块作者**不装 Electron** 就能把模块跑起来的最小宿主替身。

```bash
node sdk/mock-host/index.mjs ../modules/example-empty
node sdk/mock-host/index.mjs ../modules/prologue-live --port 7788
```

它会：

1. **清单自查**（与宿主打包闸门同一口径的最小版）
   —— 缺 `id`/`version`/`license`，或声明了真实协议却没有许可证文件，都会**明确提示**；
2. 构造**假 `ctx`**（`logger` / `config` / `bus` / `permissions` / `gateway` / `overlays` 桩件，
   形状对齐 [`../contracts/`](../contracts/)）；
3. 若清单有 `entry`，尝试 `import` 并调用其 `activate(ctx)`；
4. 起一个**本地静态服务**，把 `manifest.web.url` 对应的页面端起来（浏览器里调 UI）。

## ⚠️ 它不是宿主

- 不做**真实权限管控**、不加载原生能力（OBS 桥 / 悬浮窗 / 快捷键等）、不做沙箱 ✗；
- 因此**正式验收必须在 EclipseLIVE 内进行**（装上 `.elm` 包或放进 `modules/` 目录）。

它的价值是**把反馈循环从"装宿主"缩短到"跑一条命令"** —— 这决定社区愿不愿意动手写第一个模块。
