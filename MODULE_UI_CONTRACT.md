# MODULE_UI_CONTRACT — 模块 UI 强制合规契约

> ★ **红线（写死，无例外；本体见 `AI_RULES.md` 第 24 条）**：**不准出现"灰色薄纱底图"**。
> 任何为"补文字可读性"而加的**成片**半透明灰层（整面承托渐变 / 面板级暗压 / 局部承托带 / 面板底色暗色调）
> 一律禁止 —— 它们看得见，用户实测一律读成"糊了一层灰"（已复现三次）。
> 液态玻璃 = 半透明 + 边缘透镜折射 + 镜面高光 + 随环境自适应明暗；可读性只走三条：
> ① 结构性（玻璃与文字同层，不做整面覆盖）② 提升文字自身对比度（走 `--txt-*` 高对比备用令牌）
> ③ 既有降级开关（减少透明度 / 高对比度 / 减少动效）。机械守卫变红即拒绝合并。

> **本文档是模块 UI 的唯一权威约束，一份文档读完即知全部规矩。**
> 权威链：本契约（规范本体 + 机械检查）→ PRODUCT.md「UI 外观与交互规范 · 模块 UI 规范」→ AI_RULES「UI 红线」（18–20）。
> 文档是纸，检查是锁：`tests/unit/module-ui-contract.spec.ts` 全量扫描 `modules/*/pages/*.html`，违者测试变红 = 拒绝合并，无例外。

## 0. 一句话原则

**模块一切界面 = 宿主皮肤。** 模块没有自创外观的权利：不引入新样式框架、不自造组件视觉、不自建主题、不自绘画布底。界面长得像「设置 → 二级菜单」，仅此一种答案。

## 1. 令牌从哪来（机制，先读这段）

模块页跑在 **零 preload 的 WebContentsView** 里——**读不到宿主的 CSS 变量**。因此令牌由宿主**单向注入**：

```
renderer（getComputedStyle 读解析值，白名单见 src/renderer/src/ui-tokens.ts）
  → IPC module-page:tokens（仅主窗渲染层可发，值域服务层清洗：-- 前缀键 + 无 ;{} 值）
  → 主进程 executeJavaScript → 模块页 :root 上的 CSS 自定义属性
```

- 模块页**只消费**注入的 `--r-* / --sp-* / --txt-* / --bg-* / --mat-* / --acc-* / --ok/--bad/--warn`，**禁止定义自己的同名/仿造令牌**（页面出现任何颜色字面量 = 违规）。
- 主题、强调色、材质三档、降级开关（减少透明度/高对比度/减少动态效果）的变更由宿主实时重推——模块页自动跟随，**不需要也不允许**自己感知。
- 令牌名与语义与宿主 renderer.css 完全一致（尺寸 `--r-sm/md/lg/xl`=8/12/16/24px、`--sp-1..7`=4 倍数；材质 `--mat-alpha/blur/sat/...` 随档位换值）。

## 2. 强制模板（抄这段就能过）

非豁免页面 = 上面这样写（范本：`modules/prologue-live/pages/control.html`）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>…</title>
<style>
  /* 消费宿主注入令牌；零硬编码颜色/尺寸；不自建 :root 主题块 */
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100vh; }
  body {
    background: transparent;          /* 材质底由宿主槽位 .module-page-host 提供 */
    color: var(--txt-1);
    padding: var(--sp-5);              /* 显示面积：铺满槽位矩形 + 内边距走令牌 */
  }
  /* 分组卡片 = **标准材质**（T36 层级纪律）。
     依据 Apple HIG「Don't use Liquid Glass in the content layer」：液态玻璃属 chrome
     （宿主侧栏/工具条/下拉/弹窗/提示），**模块功能页属内容层**，用标准材质：
     `--std-bg`（半实色面）+ `--std-border`（描边）+ `--std-shadow-1/2`（层级阴影）+ `--r-lg`。
     ⚠️ 三条禁令：
     ① 不得整面刷 `--mat-veil`（该令牌已退休：3 档下是 24% 灰面，会糊出灰色底图）；
     ② 不得用 `backdrop-filter`（内容层不该常驻模糊，这也是性能红线）；
     ③ 不得自造颜色/圆角/尺寸（只消费注入令牌）。
     觉得内容面不够实就反馈给宿主调 `--std-bg`，模块侧不要自行加雾加纱。 */
  section {
    background: var(--std-bg);
    border: 1px solid var(--std-border);
    border-radius: var(--r-lg);        /* 区域圆角：与槽位/设置卡片一致，走 --r-* */
    box-shadow: var(--std-shadow-1), var(--std-shadow-2);
    padding: var(--sp-4);
  }
  h2 { color: var(--acc); }
  input, select, button { /* 对齐既有组件观感：全部 var(--…) 令牌 */ }
</style>
</head>
<body>…</body>
</html>
```

## 3. 禁区（写了这些 = 违规 = 拒绝合并）

| # | 禁区 | 违例示例 | 正确写法 |
|---|------|----------|----------|
| 1 | **任何颜色字面量**（整页：style 块、内联 style、脚本里都不行） | `#10141d`、`rgba(255,255,255,.12)`、`--bg-card: #fff` | `var(--bg-card)`、`color-mix(in srgb, var(--ok) 14%, transparent)` |
| 2 | **自建主题令牌**（:root 里定义任何颜色/材质值） | `:root { --mat-alpha: 0.78; --txt-1: #e9eef9 }` | 什么都不定义——宿主注入 |
| 3 | **自绘画布底**（html/body 上画背景） | `body { background: radial-gradient(...) }` | `body { background: transparent }`（材质底由宿主槽位提供） |
| 4 | **数字圆角** | `border-radius: 8px`、`border-radius: 6px` | `border-radius: var(--r-md)` |
| 5 | **数字尺寸/间距**（布局类字面量除外） | `padding: 16px`、`margin: 24px` | `padding: var(--sp-4)`、`margin: var(--sp-5)` |
| 6 | **自造组件视觉 / 引入样式框架** | 新写一套按钮/开关/卡片观感、引 bootstrap | 观感对齐宿主组件（按钮/开关/选择器/滑块/输入框/分组卡片/列表行/徽章/模态框/Toast/空状态） |
| 7 | **越出显示面积** | 页面内容溢出槽位滚动、固定定位飞出 | 槽位矩形即页面视口，铺满不外扩不内缩 |

布局类字面量（`margin: 0`、`width: 100%`、`flex: 1`、`box-sizing: border-box`、透明值）不算违例。

## 4. 唯一豁免（且必须显式声明）

**OBS 浏览器源页面、悬浮窗画布**属「输出画布」，样式由模块样式包/模块配置定义——不适用本契约。豁免页必须在 `<head>` 显式声明：

```html
<meta name="eclipse-ui-context" content="canvas">
```

没有此声明 = 非豁免 = 全量适用。**模块内设置面板 / 功能页永远不豁免**（它们是宿主内界面，不是输出画布）。

## 5. 三条硬语义

- **以三级材质为底**：页面底 = 宿主槽位材质（`.module-page-host` 玻璃面，随主题/材质档实时变化），页面自身透明；分组卡片叠在底上用 `--mat-*` 玻璃面。
- **遵循区域圆角**：圆角与所在区域一致，走 `--r-*` 令牌，不放大、不缩小、不抹除、不自造。
- **遵循显示面积**：`html, body { margin: 0; min-height: 100vh }` + 透明底铺满槽位矩形；槽位矩形即页面视口，不外扩、不内缩出多余边距、不越区滚动。

## 6. 机械检查（为什么这次文档真的能约束）

`tests/unit/module-ui-contract.spec.ts`（vitest，`npm test` 全量跑）扫描 `modules/*/pages/*.html`：

1. 无豁免 meta 的页面：整页零颜色字面量、`border-radius` 零数字（只许 `var(--r-*)`）、body 必须 `background: transparent` + `margin: 0` + `min-height: 100vh`、必须消费 `--mat-*/--bg-*/--txt-*` 令牌；
2. 有豁免 meta 的页面：跳过（画布自由，但必须显式声明）。

**写模块 UI 前先跑一次 `npx vitest run tests/unit/module-ui-contract.spec.ts`；本地过不了就不许提 merge request。**

## 7. 上线前清单（逐项勾）

- [ ] 非豁免页面整页无颜色字面量（hex / rgb / hsl）
- [ ] 无自建 `:root` 主题令牌
- [ ] body：`background: transparent`、`margin: 0`、`min-height: 100vh`，padding 走 `--sp-*`
- [ ] 所有圆角走 `var(--r-*)`，尺寸间距走 `var(--sp-*)`
- [ ] 分组卡片 = **标准材质**（`var(--std-bg)` + `var(--std-border)` + `var(--std-shadow-1/2)` + `var(--r-lg)`）；**不得有 `backdrop-filter`**（内容层不用玻璃）、**不得整面刷 `--mat-veil`**（已退休）
- [ ] 强调色不得压在玻璃面上（标题/正文走 `--txt-*`；强调色只用于交互态与主操作）
- [ ] 圆角一律 `var(--r-*)`（胶囊走 `var(--r-pill)`），间距一律 `var(--sp-*)`（含 `--sp-4h` = 20px 半档）
- [ ] 交互态走中性状态层 `--state-hover` / `--state-press`，不要用不透明底色
- [ ] 与「设置 → 二级菜单」逐项目视比对（材质底/圆角/面积/控件观感）
- [ ] 豁免画布页带 `<meta name="eclipse-ui-context" content="canvas">`
- [ ] `module-ui-contract.spec.ts` 绿

## 8. 生命周期提醒

- 页面打开瞬间宿主首推令牌；随后主题/材质/降级任何变化实时重推（MutationObserver 监听根节点属性）。
- 令牌在页面每次重新加载（含网关端口变更 reload）后由主进程自动重注入——模块页无需自己处理。
- 新增模块页 / 改现有页面：改完就跑第 6 节的检查，绿灯才能算完。

---

## 附：内容层配方变更（用户拍板 A · 2026-10-02）

**背景**：用户反馈「现有模块功能页里一些 UI 没有同步材质」。审计（`docs/MODULE-MATERIAL-SYNC-AUDIT.md`）
确认：宿主内容卡 `.card` 已按用户要求恢复**三档玻璃材质**（`--card-bg` + `backdrop-filter: blur(var(--mat-blur))
saturate(var(--mat-sat))` + `--mat-border` + `--mat-edge-*`/`--mat-glow`/`--mat-shadow-*`），
而模块功能页的分组卡片仍停留在 T36 的"内容层用标准材质（`--std-bg` 半实色面）、不用玻璃"约定
⇒ 档 4 下模块页明显比周围"更平"。

**决策（A）**：**推翻 T36 关于内容层的这一条**。模块功能页的分组卡片**必须与宿主 `.card` 同配方**：

```
background: var(--card-bg);
backdrop-filter: blur(var(--mat-blur)) saturate(var(--mat-sat));
-webkit-backdrop-filter: blur(var(--mat-blur)) saturate(var(--mat-sat));
border: 1px solid var(--mat-border);
box-shadow: var(--mat-edge-light), var(--mat-edge-thick), var(--mat-glow), var(--mat-shadow-1), var(--mat-shadow-2);
border-radius: var(--r-lg);
```

**仍然禁止**：`--mat-veil`（§24 灰纱红线，3 档下是 24% 灰面）；
**其它条款不变**：零颜色字面量、圆角只走 `var(--r-*)`、body 透明、铺满槽位、消费宿主令牌。

**机械守卫**：`tests/unit/module-ui-contract.spec.ts` 已同步（`backdrop-filter` 由"禁止"改为"必需"，
并新增 `--card-bg` / `--mat-blur` / `--mat-sat` / `--mat-border` 断言）；
模块自带测试 `modules/prologue-live/tests/m3-control.spec.ts` 同步更新。
