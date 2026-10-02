# EclipseLIVE 构建与打包流程

> 本文档给出**可逐步复现、可独立验证**的构建与打包流程，以及每个环节的验收方法与已知陷阱。
> 目标：任何人拿到仓库后能自行产出安装包，并能**判断产物是否正确**，而不是"装不上就怀疑打包"。

---

## 1. 环境前置

| 项 | 版本 / 位置 | 说明 |
| --- | --- | --- |
| Node.js | 见 `package.json` 的 devDependencies 要求（本机 26.x） | |
| 包管理器 | `npm`（仓库用 npm，`package-lock` 语义） | Windows 上若 `npm.ps1` 被执行策略拦截，用 `npm.cmd` |
| Electron | `44.4.3`（devDependency） | 由 `electron-builder` 打进产物 |
| electron-builder | `26.15.3`（devDependency） | 输出 `dist/` |
| electron-vite | `5.x`（devDependency） | 编译 main / preload / renderer 到 `out/` |
| Electron 二进制缓存 | `node_modules/.cache/electron` | 见 `build.electronDownload.cache`，**仓库内**，便于离线 |
| electron-builder 缓存 | `%LOCALAPPDATA%\electron-builder\Cache` | 含 `nsis-3.0.4.1` / `nsis-resources-3.4.1` / `7zip@1.0.0`；**首次打包会自动下载，之后可离线** |

> **网络**：`build.electronDownload.mirror` 指向 `registry.npmmirror.com`。若缓存已就绪，打包全程无需联网（AI_RULES §11 同源要求）。

---

## 2. 目录与产物

| 路径 | 角色 | 是否入库 |
| --- | --- | --- |
| `src/` | 源码（`main` / `preload` / `renderer` / `shared` / `contracts`） | ✅ |
| `modules/` | 随包模块（经 `extraResources` 复制到 `resources/modules`） | ✅ |
| `out/` | **编译中间产物**（`out/main`、`out/preload`、`out/renderer`） | ❌ gitignore |
| `test-results/` | Playwright 报告与截图 | ❌ gitignore |
| `dist/` | **打包产物**（安装包、zip、`win-unpacked/`） | ❌ gitignore |
| `dist-staging/` | 历史手工暂存目录（当前仅含一个 2026-09-26 的 `app.asar`） | ❌ 未入库，可删 |

**`out/` 与 `dist/` 都可安全删除后重建**（`npm run dist` 会重新生成）。

---

## 3. 命令

```powershell
npm.cmd install                 # 安装依赖（首次）
npm.cmd run dev                 # 开发运行（热更）
npm.cmd test                    # 单元测试（vitest）
npm.cmd run typecheck           # 类型检查：node 侧 + web 侧（两者都必须过）
npm.cmd run test:integration    # 集成测试：先 build 再跑 Playwright（真实 Electron）
npm.cmd run build               # 仅编译 → out/
npm.cmd run dist                # 编译 + 打包 → dist/（NSIS 安装包 + zip）
```

**顺序建议**：`typecheck` → `test` → `test:integration` → `dist`。前一步红就不要进入下一步。

> **Windows 环境变量陷阱**：若 shell 中存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会以 Node 模式启动（`electron --version` 返回 Node 版本、应用不出窗口）。本机该变量**未持久化**（`HKCU\Environment` / `HKLM\...\Session Manager\Environment` 均无），仅个别终端会话注入。遇到"应用不启动"先执行：
> ```powershell
> Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
> ```

---

## 4. 打包配置逐字段说明（`package.json` → `build`）

```jsonc
{
  "appId": "live.eclipse.eclipselive",
  "productName": "EclipseLIVE",
  "artifactName": "${productName}-${version}-win-${arch}.${ext}",  // zip 用
  "directories": { "output": "dist" },
  "electronDownload": { "mirror": "…npmmirror…", "cache": "./node_modules/.cache/electron" },
  "files": ["out/**", "assets/**", "node_modules/**", "package.json"],
  "extraResources": [{ "from": "modules", "to": "modules" }],      // → resources/modules
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] },
      { "target": "zip",  "arch": ["x64"] }
    ],
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,                        // 辅助式安装（有目录选择页）
    "perMachine": false,                      // ★ 纯 per-user：装到 %LOCALAPPDATA%\Programs\EclipseLIVE
    "allowElevation": false,                  // ★ 永不请求提权（消除提权后身份/TEMP 不一致的失败模式）
    "allowToChangeInstallationDirectory": true,
    "artifactName": "EclipseLIVE-Setup-${version}.${ext}"
  }
}
```

**关键点**

- `perMachine: false` + `allowElevation: false`：安装**不需要管理员权限**，也**不会弹 UAC**。若安装时看到 UAC，说明不是本配置产生的提权请求。
- 两个 target 同时产出：**NSIS 安装包**（需临时目录解包）与 **zip 免安装包**（解压即用，不依赖安装器）。**zip 是排障与应急的保底路径。**
- `files` 只收 `out/`、`assets/`、`node_modules/`、`package.json`；`modules/` 走 `extraResources`（在 asar **之外**，模块可被主进程直接读取）。

---

## 5. 产物清单

| 文件 | 大小（参考） | 说明 |
| --- | --- | --- |
| `dist/EclipseLIVE-Setup-<version>.exe` | ~116 MB | NSIS 安装包（x64） |
| `dist/EclipseLIVE-Setup-<version>.exe.blockmap` | ~0.1 MB | 增量更新块图 |
| `dist/EclipseLIVE-<version>-win-x64.zip` | ~159 MB | 免安装包 |
| `dist/win-unpacked/` | ~400 MB | 未打包的应用目录（安装器/zips 的来源） |

体积变化的合理区间很小（±1 MB）。**若安装包显著变小，先怀疑 `extraResources` 或字体没被打进去。**

---

## 6. 构建后验证清单（可逐条复制执行）

### 6.1 单元与类型

```powershell
npm.cmd run typecheck     # 期望：无输出（两个 tsconfig 都过）
npm.cmd test              # 期望：Test Files 43 passed / Tests 560 passed（随卡增长，见 TASKS）
```

### 6.2 集成（真实 Electron）

```powershell
npm.cmd run test:integration    # 期望：44 passed
```

> 集成测试会在 `%TEMP%` 下为每次 Electron 启动创建隔离 userData（前缀 `el-`）。
> 已由 `tests/integration/global-teardown.ts` 在整套结束后回收（只回收 5 分钟前的，避免误删并行运行）。**若该回收被移除，`%TEMP%` 会被撑爆并导致 NSIS 安装器报 `Error writing temporary file`**（2026-09-28 实测事故，见 §8）。

### 6.3 安装包元数据

```powershell
$f = Get-Item dist\EclipseLIVE-Setup-*.exe
$f.Name; [math]::Round($f.Length/1MB,1); $f.VersionInfo.ProductVersion   # 版本必须与 package.json 一致
```

### 6.4 安装包载荷完整性（不运行安装器也能验证）

用 electron-builder 自带的 7-Zip 直接列出并解包载荷：

```powershell
$7za = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\7zip@1.0.0" -Recurse -Filter 7za.exe | Select-Object -First 1
& $7za.FullName l dist\EclipseLIVE-Setup-*.exe        # 期望：96 files / 10 folders，含 EclipseLIVE.exe、resources\app.asar、resources\modules\*
& $7za.FullName x dist\EclipseLIVE-Setup-*.exe -o<某空目录> -y
```

### 6.5 包内资源检查

```powershell
# asar 内是否含字体与渲染产物
npx.cmd asar list dist\win-unpacked\resources\app.asar | Select-String 'ttf$|index-.*\.(css|js)$'
# 期望字体位于 \out\renderer\assets\*.ttf —— 与 CSS 同目录（相对 URL 才解析得到，见 §8）

# 模块是否被拷到 asar **之外**（模块必须在 resources\modules，见 §5.1）
Get-ChildItem dist\win-unpacked\resources\modules -Directory | Select-Object -ExpandProperty Name
# 期望列出内置模块（prologue-live、vts-controlpad …）
```

### 6.5.1 模块分发（`resources/modules` 与 `.elm`）

**内置模块**：`package.json` 的 `build.extraResources` 把 `modules/` 拷到 `resources/modules`。
必须在 **asar 之外** —— 模块入口由 `import(pathToFileURL(entry).href)` 动态加载，
asar 内的路径无法这样加载；也因此**模块里的 npm 依赖永远解析不到**
（`node_modules` 在 asar 内，Node 的向上查找进不去 asar），所以模块必须**自包含**：
第三方库要 vendor 进模块目录（例：`modules/vts-controlpad/vendor/vtubestudio/`，含上游 LICENSE）。

**独立分发的 `.elm`**：模块可打成 `.elm`（zip：描述符 `module.json` + 全文件收集，
入口文件带 sha256）。打包/校验/安装由核心 `core/packages` 服务负责，**不要在脚本里
自行复刻这个格式**（会与核心漂移）。

产物位置：**`dist/modules/<模块id>-<版本>.elm`**，一条命令生成并对每个包做校验：

```powershell
npm run pack:modules     # = vitest run tests/unit/module-elm-pack.spec.ts
```

该命令会：把 `modules/` 下**每个**模块打成分发包 → `inspect` 往返校验（format/entry/sha256）
→ 校验包内是 `module.json` 而非 `manifest.json` → 带 `vendor/` 的模块必须含上游 LICENSE
→ **清掉同一模块的旧版本文件**（该目录只留当前版本，避免双版本混淆）。
它随 `npm test` 一起跑，所以**任何一次全量测试都会重新生成并校验**这些包。

> ⚠️ **不要整体删除 `dist/`**：会连带删掉 `dist/modules/*.elm` 与 `dist/历史版本回滚/` 的旧安装包归档，
> 而 `dist/` 不在 git 内、`Remove-Item` 也不走回收站 ⇒ 不可恢复（真实发生过一次）。
> 需要清理时按目录删（`dist/win-unpacked`、具体产物文件），或删完立刻 `npm run pack:modules` 重建。
> 另：`electron-builder` 的产物与 `dist/modules` 同处 `dist/`，稳妥顺序是**先打安装包、先生成分发包都行，但生成后别再整体清理 dist**。

装到用户目录的模块由"设置 → 模块"管理；`.elm` 丢进模块目录会被
`packages.watch()` 自动安装（该路径无需二次确认：能写该目录已等价于本地代码执行）。

### 6.6 成品可运行性（最重要）

三层验证，任一层通过即说明**打包产出的东西是可运行的**：

```powershell
# ① win-unpacked 直接跑
.\dist\win-unpacked\EclipseLIVE.exe

# ② zip 解压后跑
Expand-Archive .\dist\EclipseLIVE-<version>-win-x64.zip -DestinationPath <某空目录>
<某空目录>\EclipseLIVE.exe

# ③ 安装器装完跑（需在资源管理器中双击安装，理由见 §8）
"%LOCALAPPDATA%\Programs\EclipseLIVE\EclipseLIVE.exe"
```

应用内的自检点：标题页显示版本号、侧栏可展开「模块」并列出 4 个模块、设置→外观可切换材质档。

---

## 7. 排障：装不上时的定位顺序

按**从产物到环境**的顺序查，每一步都能独立给出结论：

| # | 检查 | 命令 / 方法 | 若失败说明 |
| --- | --- | --- | --- |
| 1 | 载荷是否完整 | §6.4 的 `7za l` | 打包/下载损坏 |
| 2 | 载荷是否可运行 | §6.6 的 ① 或 ② | 打包配置错（缺文件、入口错） |
| 3 | 版本号是否正确 | §6.3 | `package.json` 版本未更新 |
| 4 | 是否被拦截 | 见下方「拦截类检查」 | 安全策略/杀软 |
| 5 | 临时目录是否可用 | `$env:TEMP`、`Test-Path`、试写文件 | 环境变量/权限 |
| 6 | 安装目标是否可写 | `%LOCALAPPDATA%\Programs` 试写 | 权限 |
| 7 | 是否在受限容器/沙箱里运行 | 见 §8 的事故记录 | **沙箱阻止写系统 TEMP** |

**拦截类检查**

```powershell
Get-MpComputerStatus | Select AntivirusEnabled, RealTimeProtectionEnabled        # Defender 状态
Get-MpPreference   | Select EnableControlledFolderAccess                          # 受控文件夹访问
Get-MpPreference   | Select AttackSurfaceReductionRules_Ids                       # ASR 规则
Get-MpThreatDetection | Sort InitialDetectionTime -Descending | Select -First 5    # 是否拦截过
# Smart App Control：0=关 1=强制（会拦未签名程序）
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 20  # 代码完整性拦截
```

**TEMP/TMP 有效性（逐字符查，别只看有没有值）**

```powershell
$u = Get-ItemProperty 'HKCU:\Environment'
$u.TEMP; $u.TEMP.Length; $u.TEMP.ToCharArray() | ForEach-Object { [int]$_ }   # 期望全为可见 ASCII(32–126)
Test-Path $u.TEMP                                                            # 必须存在
(Get-Item $u.TEMP -Force).PSIsContainer                                      # 必须是目录
(Get-Item $u.TEMP -Force).LinkType                                           # 空=非重定向
```

---

## 8. 已知陷阱（都踩过，均有提交记录）

### 8.1 自定义字体不会随包加载（已修，`f6e2f25`）

`@font-face` 的 `url()` **必须是 Vite 能在构建期解析的相对路径**。原先字体放在 `public/fonts` 而写成 `url('fonts/…')`：Vite 解析失败后**原样保留**，打包后 CSS 位于 `assets/` 子目录，运行时被解析成 `assets/fonts/…`（不存在）→ 字体 404、**静默回退系统字体**。开发机若装了同名系统字体则完全看不出来。

**现状**：字体在 `src/renderer/src/assets/fonts/`，CSS 写 `url('./assets/fonts/…')`，由 Vite 构建期解析、哈希并重写。单测断言"每条 `url()` 都能在 CSS 源文件旁解析"。

### 8.2 表单控件不继承应用字体（已修，`f6e2f25`）

Chromium 的 UA 样式对 `button/input/select/textarea` 强制 `font: 400 13.3333px Arial`。已全局补 `font-family: inherit`（**只改 family，不动 size**，避免按钮几何漂移）。

### 8.3 集成测试泄漏临时目录 → 撑爆 `%TEMP%` → NSIS 报错（已修，`431eea4`）

每个 `_electron.launch()` 按 spec 前缀在 `tmpdir()` 建隔离 userData 且**从不清理**：6 天累积 **27,184 个目录**，`%TEMP%` 涨到 **29,635 项**。**NSIS 安装器必须先把载荷解到 `%TEMP%\nsXXXX.tmp`**，面对这种临时目录会报：

```
NSIS Error: Error writing temporary file. Make sure your temp folder is valid
```

**修复**：`tests/integration/global-teardown.ts` + `playwright.config.ts` 的 `globalTeardown`。清理后 `%TEMP%` 29,635 → 2,449，C 盘回收约 11 GB。

### 8.4 ★ 在受限沙箱/容器内运行安装器必然失败（2026-09-28 事故根因）

**症状**：双击安装包报 §8.3 的同一句话，但 `%TEMP%` 明明有效可写。

**根因**：**DSH 会话的文件沙箱为 workspace-write 模式——被它启动的进程只能写会话工作区**。安装器需要写**两处工作区外的位置**：`%TEMP%`（解包）与 `%LOCALAPPDATA%\Programs\EclipseLIVE`（安装）→ 被拦 → 报"临时文件夹无效"。

**对照实验（同一安装器，只改路径）**

| 实验 | TEMP | 安装目录 | 结果 |
| --- | --- | --- | --- |
| A | `C:\WINDOWS\TEMP`（工作区外） | 默认（工作区外） | ❌ 报错，`ns*.tmp` 一个都没建出来 |
| B | 工作区内 | 默认（工作区外） | ⚠️ 建出 `ns*.tmp`，但写安装目录被拦 |
| **C** | **工作区内** | **工作区内（`/D=`）** | ✅ **1 秒装完 97 文件 / 395.5 MB，卸载器已生成** |

**实验 C 装出来的程序实测可运行**：`v0.1.9-beta1.1`、5 条 `@font-face`（`Rajdhani:loaded` / `SourceHanSansSC:loaded`）、按钮字体为应用字体栈、渲染进程零报错。

**结论：打包与安装器均无问题；障碍是运行环境。**

**正确做法**：**在 Windows 资源管理器里双击安装包**（不要经由任何 agent/沙箱界面打开文件），使进程不受沙箱约束。

```cmd
:: 应急/排障：显式指定临时目录与安装目录
mkdir C:\el-tmp
set TEMP=C:\el-tmp
set TMP=C:\el-tmp
EclipseLIVE-Setup-<version>.exe /S /D=C:\EclipseLIVE
```

> `/D=` 必须是**最后一个参数**且不加引号。

### 8.5 单实例锁

应用使用 `app.requestSingleInstanceLock()`，锁位于 **userData**。若已有实例在运行，再次双击会**静默退出**（无提示）。测试可用 `EL_TEST_USERDATA` 指向隔离目录避免争锁。

### 8.6 ★ 启动上下文传递失效的 TEMP（同一句报错的第二种成因）

§8.3（`%TEMP%` 被撑爆）与 §8.4（沙箱拦写）之外，**还有第三种同样报 `Error writing temporary file` 的成因**：
**启动安装器的上下文向子进程传递了指向"已不存在目录"的 `TEMP`（或 `TEMP` 为空）**。

- 子进程默认**继承父进程环境块**；`GetTempPath()` **只解析字符串、不校验目录是否存在** → 返回坏路径 → `CreateDirectory(%TEMP%\nsXXXX.tmp)` 因父目录不存在而失败
- **以管理员身份运行会绕过**：提权经 AppInfo 服务，**从注册表重建环境块**而非继承 —— 所以"提权就能装"**不等于**权限问题
- 典型触发：从 agent/沙箱界面、集成终端、带自定义环境的启动器启动

**判别方法**：在出问题的上下文里 `echo %TEMP%` 并 `if exist "%TEMP%"` 校验；再用同一命令在管理员窗口执行一次对照。

> 完整分析（含 21 项排除清单与因果链）见 **[`INCIDENT-2026-0928-installer.md`](./INCIDENT-2026-0928-installer.md)**。

**排查通用原则**：当报错指向"某路径无效"时，分清三类问题 ——
① **路径的值**（环境变量从哪来、是否被继承）／② **路径的实体**（是否存在、可否写入）／③ **实体上的策略**（ACL、过滤器、应用控制）。
只查 ② ③ 会走进死胡同。

---

## 9. 归档记录（本轮定位过程）

| 提交 | 内容 |
| --- | --- |
| `e8f70cf` | 积压改动 + T-A1/T-A2/T-A3 存档 |
| `7084b01` | T-A4 变体与尺寸统一 |
| `1b95d63` | T-A5 导航展开/折叠动效 |
| `614817f` | spinner 深色下不可见修复 |
| `01d688d` | T-A7 系统动效偏好 + 低配模式（含"减少动态效果"从未生效的修复） |
| `f51852a` | T-A6 列表项错峰入场 |
| `c469c72` | T-A8 玻璃悬停高光（含默认档 `box-shadow` 整条失效的修复） |
| `32c9935` | 集成断言与设计不一致修正 + 任务卡 |
| `078edd4` | 版本 → `0.1.9-beta1.1` 并打包 |
| `f6e2f25` | 字体随包加载 + 控件继承字体 |
| `431eea4` | 集成测试临时目录泄漏修复 |
| `e00dacc` | NSIS 改 per-user / 不请求提权 + 新增 zip 目标 |
