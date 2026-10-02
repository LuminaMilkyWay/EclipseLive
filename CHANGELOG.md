# Changelog

本文件记录每次可见变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.2-beta1] — 2026-10-02

> 本版技术记录（面向开发者；面向用户的更新说明见 `RELEASE_NOTES.md`）。

### 新增

- **品牌（首次随包发布）**：展示名 `EclipseLive 0.2.2-Corona`，`src/shared/appInfo.ts`
  为单一真源（守卫 `tests/unit/appInfo.spec.ts`：展示版本、代码版本、产物名三者钉住 0.2.2）；
  产物名 `EclipseLive-0.2.2-Corona-win-x64.zip` / `-Setup.exe`。品牌改动在 0.2.1 封包之后落地，
  本版为第一次随安装包分发。
- **T48 键盘焦点环**：全部交互控件获得统一的键盘焦点环（`outline` 方案，鼠标点击无残环）；
  DOCK 徽章键盘可达。
- **T49 Toast 退场动效**：`data-closing` 状态机 + `el-toast-out` 关键帧 + `TOAST_EXIT_MS`(160ms)
  延迟卸载；两帧均保持 `translateX(-50%)` 居中不变式；`prefers-reduced-motion` 下瞬时消失。
- **T51 列表行 hover**：状态令牌（仅背景/边框），无尺寸变化 —— 玻璃层位移禁令（AI_RULES §26）。
- **T52 开关弹性**：仅 knob 弹性缓动（knob 非玻璃层，不触发折射闸）。
- **T43 增量 2 迷你中控**：内置悬浮迷你控制浮窗（用户批准的公开通道），DOCK 工具栏入口
  （`53e1de9` 修复入口 JSX 断裂与 Btn 变体）。

### 修复

- **T47 后续（专注态矩形残留）**：`el:layout-settled` 时重报几何，且**重试到一致为止**
  （旧实现单次重报在动画窗口内取到未落定矩形，专注退出后残留宽矩形）。
- **T56 滚动条隐藏**：对**真实滚动容器**生效（T54 目标定位错误；T55 尝试后 revert 重做；
  守卫钉住容器清单防回退）。
- **T60 模块卡片材质**：模块特性页卡片改用宿主 `.card` 玻璃配方（用户决策 A）；
  材质契约审计（canvas 豁免误用、`--mat-*` 未消费）归档于交接文档。

### 测试与重构

- **T50 测试卫生**：`ui-shell` / `packaged-smoke` 标题断言品牌真源化（直接 require
  `APP_NAME`/`APP_DISPLAY_VERSION`，升版零改动跟随）；`wallpaper-ui` 重置竞态改 `expect.poll`
  轮询到落定；四个探针 spec 源名过滤改字面量（Playwright evaluate 闭包越不过序列化边界，
  浏览器侧引用不了自由变量 —— 教训归档任务卡与交接文档）。

### 涉及文件（主要）

- `src/shared/appInfo.ts`、`src/renderer/index.html`、`package.json`（版本 + 产物名）
- `src/renderer/src/{ui.tsx,renderer.css}`（T49）、`shell/*`、`screens/*`、`hooks/*`
- `tests/unit/{appInfo,build,components}.spec.ts`、`tests/integration/{ui-shell,packaged-smoke,wallpaper-ui,*-probe}.spec.ts`
- `RELEASE_NOTES.md`（滚动窗口 3 版：0.2.2 / 0.2.1 / 0.1.9-beta1.7）

### 测试结果

- tsc --noEmit 双侧通过；单元测试全绿；electron-vite build 三 bundle；集成测试按 T50 后基线。

### 回滚方法

`git revert <本提交>`；打包产物可用上一版安装包回退。

## [0.2.1-beta1] — 2026-09-30

> 本版技术记录（面向开发者；面向用户的更新说明见 `RELEASE_NOTES.md`）。

### 新增

- **T38 DOCK 常驻任务栏**：`shell/ToolBar.tsx` 常驻化 + `src/shared/layout.ts` 作为
  "任务栏高度 = 原生视图底部内缩"的**单一真源**（守卫 `tests/unit/dock-height.spec.ts`）。
- **T39 布局扩展能力**：`hooks/useFocusMode.ts`（L1，导出面恰好 `{state, enter, exit, toggle}`）
  + `layout-rules.ts`（L2，缺省 `standard`）；「直播中控」为菜单第一个功能项（内置页，非模块）。
- **T40/41/42 OBS 直连**：新增 `obs:send` 通道（只代理既有 `IObsBridge.send`）；
  自动拉起（注册表 / Steam 路径 / `.lnk` 解析 / `OBS_EXE`；`cwd` + EACCES ⇒ `shell.openPath`；
  已在运行不重复启动）；`core/process` 为**用户批准的独立服务**（不用 shell，`detached + unref`）；
  监看走虚拟摄像头（`getUserMedia`），关闭监看不影响推流。
- **T43 锁定模式**（Q2=A）：`data-layout-locked` + CSS 关闭该层动画。
- **T44–T47 动效体系**：`motion.css`（走 `--duration-*` / `--ease-*` 令牌）、
  侧栏单一真源状态、DOCK 项重设计（图标 + 名称 + hover ✕ 徽标）、栅格对齐的专注覆盖层。

### 修复

- **web 视图盖住所有面板**：`computeSlotReport` 曾抑制上报（`data-layout-anim`）⇒ 宿主回落
  "整窗自适应"；已移除抑制并在 `report-rect.ts` 留下事故注释（抑制必须配套事后再报）。
- **折射底图抽搐**：探测器 `probe-refract.spec.ts` 证明抽搐只发生在 `.side`（滤镜按元素自身
  坐标系烘焙）⇒ 只淡 `.side::before`；淡 `.card`/`.content` 会让用户看到"底图消失一会再出现"。
- **材质降档不恢复**：旧采样器降档后 `return` ⇒ 永久降档（表现为"启动不是第四档/进模块降级"）；
  新增 `hooks/useFpsGuard.ts`（4s 宽限期 + 恢复阈值 55 迟滞），`App.tsx` 322 → 300 行。
- **集成用例高频假红**：`module-view-bounds` / `multi-module-settings` 由"固定等待 + 立即断言"
  改为 `expect.poll` 轮询到落定（产品行为经日志核对是正确的）。

### 涉及文件（主要）

- `src/main/index.ts`、`src/main/core/process/*`（新增）、`src/shared/{theme,layout,obs-paths}.ts`
- `src/renderer/src/{App.tsx,changelog.tsx,renderer.css,motion.css}`、
  `hooks/{useUiSettings,useFocusMode,useShellLayout,useFpsGuard,useObsStream,useObsLaunch,useObsMonitor}.ts`、
  `slots/*`、`screens/Obs*`、`shell/*`
- 守卫/探针：`tests/unit/{dock-height,focus-mode,panel-motion,layout-lock,obs-*.spec.ts,release-notes-guard,fps-guard}.spec.ts`、
  `tests/integration/{probe-refract,probe-overlap,probe-transitions,probe-sidebar-geometry}.spec.ts`

### 测试结果

- tsc --noEmit 双侧通过；单元 652 例；electron-vite build 三 bundle；集成 65 例。

### 回滚方法

`git revert <本提交>`；打包产物可用上一版安装包回退。

## [0.1.9-beta1.7] — 2026-09-28

> 修复上一版液态玻璃的一组问题：档 4 的玻璃会变平、鼠标高光位置不对、界面出现灰色雾面。

### 修复

- **档 4 的玻璃不再变平**：上一版给档 4 接入了一套实验性的折射贴图，实测会让整块玻璃的模糊一起失效
  （观感就是"玻璃效果消失了"）。现已改回经过验证的折射方式，档 4 的模糊、饱和度与通透恢复正常
- **鼠标高光改为控件内高光**：上一版让高光跟随鼠标，但位置会偏，而且在侧栏、工具条这类大面板上
  会摊成一片灰雾。现改为**只落在控件自身顶部**的高光 —— 位置恒定正确，且仅在鼠标悬停时出现
- **灰色雾面消失**：移除两处会形成"整片灰色底"的覆盖（面板级高光、文字承托带）。
  文字可读性改由两条不显形的方式承担：内容区使用实面卡片，以及档 4 提升文字自身对比度
- **亮色底图下不再糊白**：此前在亮色底图上选档 4，侧栏会被透上来的底图冲成一片奶白、文字几乎看不清。
  现在档 4 会自动压一层淡淡暗色（类似烟熏玻璃）并把面板调实一些，文字恢复清晰；
  想要最大通透度可继续使用档 3

## [0.1.9-beta1.6] — 2026-09-28

> 新增「档 4 全液态玻璃」材质档位：折射与色散更强、玻璃更通透，并为它配套设计了更精致的控件材质；
> 界面动效更完整，同时给最透的档位补上了文字可读性保护。

### 新增

- **材质档位新增「档 4 全液态玻璃」**（在 设置 → 外观 里手动选择）：折射与色散最强、玻璃最通透；
  同一档位下**功能控件另有配套材质**——按钮、分段选择、输入框带镜面高光与更清晰的边缘，
  点按时有实体感，不会"漂"在玻璃上
- **指针跟随高光**：侧栏、底部工具条、弹窗与下拉菜单会随鼠标位置浮起一层柔和反光
  （四档通用，可用「减少动态效果」关闭）
- **亮背景保护**：使用亮色底图并选择档 4 时，界面自动加深压层、并给文字加局部承托，保证文字清晰可读

### 改进

- **入场更像玻璃**：页面与弹窗出现时，折射与反光会随出现过程一起"凝聚"出来，不再只是淡入
- **性能保护**：玻璃效果所需的贴图**一次烘焙、按参数缓存**，不随鼠标移动或窗口缩放反复重算；
  帧率下降时自动逐级降档（档 4 → 档 3 → 档 2）；静止状态的控件不带模糊，只在鼠标交互的瞬间才启用

## [0.1.9-beta1.5] — 2026-09-28

> 界面层次更清楚：侧栏、工具条、弹窗保留玻璃质感，内容区卡片改为更实在的纸面；
> 并修掉了设置页被模块页盖住、卡片发灰、以及「设置 → 模块」里按钮被拆行等问题。

### 改进

- **界面层次更清楚**：侧栏、底部工具条、下拉菜单、弹窗与提示保留玻璃质感；
  设置／诊断／模块页面里的**分区卡片改为更实在的纸面**（描边 + 层次阴影，不再透出背后的模糊），
  导航、内容、浮层一眼可辨
- **模块功能页外观与设置页统一**：PrologueType Live、VTS ControlPad 的功能页不再是
  "有的有卡片、有的只有一行标题"，统一为与「设置」一致的分组卡片
- **开关列表按可用宽度在规范区间内自适应**（每行 4–6 个）：窗口窄时 4 列、全屏时 6 列，
  始终不越出规范值

### 修复

- **「设置 → 模块」里操作按钮被拆成两行**：`打开` 原本独占一行、`禁用 / 卸载` 挤在下一行，
  按钮高度也不齐、模块行高参差。现在同一行的三个按钮对齐、高度一致
- **分区卡片下面那层"半透明灰色底图"**：材质档位选「液态玻璃」时，卡片和模块页面上会多糊一层灰色，
  已去掉
- **同时打开多个模块后，切到「设置」页会被模块/工具页面盖住**（设置页原有的功能菜单看不到）：
  现在切走后一律隐藏；要回到某个工具，点底部工具条上的名字即可（行为不变）

## [0.1.9-beta1.4] — 2026-09-28

> VTS 控制台的开关列表会铺满可用宽度；同时**去掉了所有快捷键相关的东西**，只用鼠标点击控制。

### 变更

- **去掉一切快捷键功能**：既不在本软件里另绑键盘快捷键，也不显示 VTube Studio 里的按键绑定。
  开关/触发**只用鼠标点击**虚拟按钮（这是本控制台本来的用法）。
  悬浮窗的"鼠标穿透"切换快捷键保留——它控制的是本软件自己的功能，VTS 没有对应物。

### 改进

- **界面层次更清楚了**：侧栏、底部工具条、下拉菜单、弹窗与提示保留玻璃质感；
  设置／诊断／模块页面里的**分区卡片改为更实在的纸面**（有描边与层次阴影，不再透出背后的模糊），
  导航、内容、浮层一眼就能区分
- **开关列表按可用宽度在规范区间内自适应**（每行 4–6 个）：窗口窄时 4 列、全屏时 6 列，
  始终不越出规范值；全屏下整幅宽度都被用上

### 修复

- **窗口化时开关列表只显示一半，下面的开关看不到**：已修。现在窗口化也能看到全部开关；
  只有热键确实超过一屏时才会提示「↕ 列表还有更多，向下滚动查看」
- 顶部标题、状态横幅与设置区的竖向留白收紧，把空间让给开关列表

## [0.1.9-beta1.3] — 2026-09-28

> 新增 **VTS ControlPad** 模块：连接 VTube Studio，把当前模型的热键做成可点按钮。
> 应用内新增「更新日志」，界面控件与动效整体打磨。

*版本说明：本段内容曾标为 `0.1.8-beta1.1` → `0.1.9-beta1.1`，均未打包发布；
本次出包统一为 `0.1.9-beta1.3`，未覆盖任何已发布版本。*

### 新增

- **VTS ControlPad（VTube Studio 热键控制台）**
  - 连接 VTube Studio：首次使用在弹出的授权窗里点一次「允许」，之后自动登录
  - 自动读取当前模型的热键并生成按钮网格（每行 4–6 个，热键多时可滚动）
  - 点按钮即触发热键；**开关式热键显示开/关状态**，在 VTube Studio 界面里触发也会同步
  - 在 VTube Studio 里切换模型，热键列表会自动更新
  - **悬浮精简控制窗**：只显示你勾选的热键，可拖动并自动吸附屏幕边缘、记住位置、支持鼠标穿透
  - **全局快捷键**：给任意热键绑定按键，在任意窗口按下都生效；按键冲突会明确提示原因
  - VTube Studio 未运行或未开启 API 时，界面会说明怎么处理，且不影响本软件启动
- **应用内更新日志**：新增「更新日志」页签；升级到新版本后首次启动会弹一次「本次更新」
- **模块页外观与应用统一**：模块页面跟随主题、材质与降级设置变化
- **控件与动效优化**：按钮四态、尺寸与变体统一、加载态与防重复点击、导航展开动效、
  系统「减少动态效果」支持、低配置自动降级、玻璃悬停高光、列表错峰入场
- **新增免安装版（zip）**：解压即用，不依赖安装器

### 改进

- 玻璃材质：修复面板阴影与高光失效的问题；拉大三档材质的通透差异，档位更容易分辨
- 视觉节奏：间距与圆角全部改用统一尺度，消除零散数值造成的"不齐"观感
- 交互态：按键、输入框等改用中性状态层，深色与浅色主题下都清晰
- 可读性：提升强调色与文字的对比度；弹窗遮罩随主题深浅变化
- 浅色主题：修复部分控件与卡片同色、几乎看不见的问题
- 滚动条：内容区右缘的灰条改为随主题配色
- 安装体验：安装器不再要求管理员权限、可选安装目录；换机后应用字体不再丢失
- 清理：移除所有占位图标

### 修复

- 修复首次启动时更新日志可能为空、升级提示不出现的问题（启动顺序：界面先于功能就绪）；
  同时消除了其他启动期界面调用偶发落空的同类问题
- 安装器报「无法写入临时文件」：定位为运行环境问题（不是安装包缺陷），
  文档中给出排查步骤，并提供免安装 zip 作为保底路径
- 测试产生的临时目录未回收，长期堆积会撑爆系统临时目录（严重时安装器无法安装）：已加入自动回收
- 自定义字体在安装版中从未生效（静默回退为系统字体）
- 「减少动态效果」开关实际没有生效
- 深色主题下加载指示器不可见
- 玻璃面板在纯色背景上看不出材质效果（底色层盖住了应用辉光）
- 分段控件选中态对比度不足；浅色主题下未选中项几乎消失

## [0.1.5-beta0926.8] — 2026-09-26

> 修复打开网页工具后无法切换到设置/诊断页的问题。

### 修复

- 打开网页工具后仍可自由切换设置页与诊断页（工具在后台保持运行），底部可切回工具视图

## [0.1.5-beta0926.7] — 2026-09-26

> 更换全局字体（中文思源黑体 + 拉丁/数字 Rajdhani），字体随包本地加载、不联网。

### 新增

- 打字机模块 0.1.7 版本快照随包分发

### 改进

- 全局字体更换：拉丁与数字使用 Rajdhani，中文使用思源黑体
- 字体随安装包分发、本地加载，不联网下载

## [0.1.5-beta0926.6] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926.6`（按日期 + 版本号规则：日期码 0926 + 重建序号 `.6`）
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.6.exe`（+ blockmap，win-unpacked 同步）——含本轮修复：**设置页外观控件（材质档位/底图上传）被布局压缩消失**、**模块下拉遮挡设置**（见 [Unreleased] Fixed 条目）；旧 0.1.5-beta0926.5 安装包归档至 `dist/历史版本回滚`
- **生效**：换装后设置页材质调节/底图上传完整可见；「模块」下拉展开为占流面板不遮挡设置按钮

## [0.1.5-beta0926.5] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926.5`（按日期 + 版本号规则：日期码 0926 + 重建序号 `.5`）
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.5.exe`（+ blockmap，win-unpacked 同步）——含本轮 UI 结构改动：**侧栏「模块」二级下拉**（全部已发现模块智能路由）+ **模块管理迁入设置页「模块」分区卡**（见 [Unreleased] 条目）；旧 0.1.5-beta0926.4 安装包归档至 `dist/历史版本回滚`
- **生效**：换装后左侧「扩展·模块」为点击展开的二级下拉；模块安装/导入/启停/卸载等管理在设置页「模块」分区卡

## [0.1.5-beta0926.4] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926.4`（按日期 + 版本号规则：日期码 0926 + 重建序号 `.4`）
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.4.exe`（+ blockmap，win-unpacked 同步）——模块 extraResources 快照更新为 prologue-live 0.1.6（分组纯色底删除，见 [Unreleased] 条目）；旧 0.1.5-beta0926.3 安装包归档至 `dist/历史版本回滚`
- **生效**：换装后打字机控制页分组无独立色块，页面底由宿主槽位呈现软件一致圆角矩形玻璃面

## [0.1.5-beta0926.3] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926.3`（按日期 + 版本号规则：日期码 0926 + 重建序号 `.3`）
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.3.exe`（+ blockmap，win-unpacked 同步）——含本轮修复：**模块页覆盖右侧 3/4 内容区**（`.content` flex 容器撑满槽位 + WebContentsView 透明背景，见 [Unreleased] T34 条目）；旧 0.1.5-beta0926.2 安装包归档至 `dist/历史版本回滚`
- **生效**：换装后打字机模块控制页等模块页铺满右侧 3/4 内容区，材质底由宿主槽位透出

## [0.1.5-beta0926.2] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926.2`（按日期 + 版本号规则：日期码 0926 = 今日 + 重建序号 `.2`，沿用历史回滚命名先例 `0.1.4-beta0926.2`）
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.2.exe`（+ blockmap，win-unpacked 同步）——含本轮全部新增：**模块 UI 契约落地**（T33 令牌单向注入机制、`module-ui-contract.spec.ts` 机械强制检查、control.html 整改为消费注入令牌、MODULE_UI_CONTRACT.md 规范本体）、图标三件套（build/icon.ico 多帧 + assets/icon.png + assets/tray.png）；旧 0.1.5-beta0926 安装包归档至 `dist/历史版本回滚`
- **生效**：模块页（如打字机控制页）随宿主主题/材质/降级实时变化；新增/修改模块页违反 UI 契约即被测试拒绝

### Changed — prologue-live 模块升版重打包 0.1.4 → 0.1.5（2026-09-26）

- **动机**：模块页面整改（control.html 消费宿主注入令牌、obs/overlay 声明画布豁免）已落模块源码与安装包 extraResources，但独立分发渠道 `dist/modules/*.elm` 仍是 0.1.4 旧包（旧 UI），需同步升版重打防同模块双版本混淆
- **动作**：`modules/prologue-live/manifest.json` version 0.1.4 → 0.1.5；T7 链路重打包 → `dist/modules/prologue-live-0.1.5.elm`（63,022 B，module.json 0.1.5 + web 声明往返保留 + 页面整改在位）；临时探针 pack→inspect→解包验证（module.json 0.1.5 / web.url 保留 / control.html 含 `background: transparent` 且无自建令牌块）跑通即删；`m8-pack.spec.ts` 版本断言同步 0.1.5；删除旧 `prologue-live-0.1.4.elm`
- **回归**：全量单测 + typecheck 全绿；已安装旧包需重装 `prologue-live-0.1.5.elm` + 重启应用生效

## [0.1.5-beta0926] — 2026-09-26

### Changed — 发布版本与安装包（2026-09-26）

- **版本**：`package.json` 迭代至 `0.1.5-beta0926`
- **重建安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-0.1.5-beta0926.exe`（+ blockmap，win-unpacked 同步）——含本轮全部修复：web 工具嵌入视图父窗竞态（pickParentWindow / mainWindow 引用）、`isMainWindowSender` 竞态、laplacelive-link 宿主显示整改（`.tool-slot` 内容区槽位 + 圆角玻璃壳）、T7 打包链 entry 可空修复；旧 0.1.4-beta0925 安装包已清理
- **回归**：全量 364 单测全绿 + typecheck 通过；修复进包经构建产物 grep 确认（out/main `pickParentWindow`/`mainWindow`、out/renderer `.tool-slot`）

### 生效清单（换装 0.1.5-beta0926 后）

- 打字机悬浮窗存在时打开 laplacelive-link：视图挂主窗、不绑定悬浮窗、底部任务栏不再被遮
- laplacelive-link 在内容区槽位内缩显示（圆角玻璃壳、侧栏可见）
- 无 entry 声明式模块（laplacelive-link-0.1.1.elm）安装不再报错

## [Unreleased]

### Fixed — 打开网页工具后无法切到设置/诊断页（2026-09-26）

- **根因**：内容区 switch 中 `openToolModuleId !== null`（T11 工具优先：工具打开即盖住除模块页外的所有 React 页）优先于 SettingsPage/DiagnosticsPage——laplacelive-link 打开后点「设置」永远显示工具
- **修复（T37）**：工具视图由显式 tab 驱动——`Tab` 新增 `tool:<moduleId>` 变体（`isToolTab`/`toolTabModuleId`）；内容区顺序改为 页面tab → 诊断 → 设置 → `tool:` → 兜底；点下拉工具项 = 切 `tool:`（ToolSlot 挂载 openWebTool 幂等保活）；底部 tool-bar chip 可点击切回工具视图（关闭按钮 `stopPropagation`，关闭当前工具视图时切回默认页防 ToolSlot 残留重开）
- **回归**：`pinned-tool-nav.spec.ts` 新增断言（工具打开 → 点设置 → 设置页可见 + 工具视图隐藏保活 state open → chip 切回 tool-slot 可见）；全量 376 单测 + typecheck + **35 集成全绿**
- **生效**：需重建安装包换装（渲染层改动）；待验收后按规则升版重打包

### Added — 全局字体体系：思源黑体 + Rajdhani（2026-09-26）

- **需求**：全局 UI 字体更换为思源黑体（中文）与 Rajdhani（拉丁/数字），按内容与字重匹配
- **实现（T36）**：`src/renderer/public/fonts/` 本地打包 `SourceHanSansSC-VF.ttf`（Noto Sans SC 可变字体，font-weight 100–900）+ Rajdhani 四字重（Regular/Medium/SemiBold/Bold），`@font-face` 声明，零联网加载（AI_RULES §11，字体均为 SIL OFL 可分发）；body 字体栈 `Rajdhani → SourceHanSansSC → Noto Sans SC → 微软雅黑兜底`（拉丁先命中 Rajdhani，CJK 回退思源黑体）；数字/端口/版本/徽章由 Consolas 改为 `Rajdhani → Consolas` 兜底；品牌 900 / 主标题 700 / 正文与标签 400–500
- **模块页**：`control.html` 字体栈同步（系统名回退——模块页独立上下文不加载打包字体，用户机器已装同源字体即生效）；OBS/悬浮窗画布为配置驱动字体（豁免）不动
- **升版重打包**：manifest 0.1.6 → 0.1.7，T7 重打 → `dist/modules/prologue-live-0.1.7.elm`（62,909 B，探针验证字体栈在位）；`m8-pack.spec.ts` 断言同步；删除旧 0.1.6.elm
- **回归**：全量 376 单测 + typecheck + **35 集成全绿**；字体随 out/renderer/fonts 进包（构建验证 + CSS url 保留）

### Fixed — 设置页外观控件被压缩消失 + 模块下拉遮挡设置（2026-09-26）

- **问题一（设置页材质调节/底图上传消失）**：T34 为模块页槽位撑满把 `.content` 改为 flex column，连带设置页 `.page` 成为可收缩 flex 子项——内容超高时被 `flex-shrink` 压缩而非滚动，外观分区卡（材质档位 / 全局底图上传）被挤没
  - **修复**：`.page` 加 `flex: none`（不收缩不增长，超高走 `.content` 滚动）；槽位（`.module-page-host`/`.tool-slot`）仍 `flex:1` 撑满
  - **回归断言**：`settings-ui.spec.ts` 增「外观组控件可见（seg-material-3 / wallpaper-reset）」
- **问题二（二级下拉盖住设置）**：`.nav-dropdown` 此前为绝对定位浮层（z-index:40），展开直接盖住下方偏好组设置按钮
  - **修复**：改回**占流面板**（展开把下方组推下、设置始终可见可点）；收起监听 `mousedown` → `click`（mousedown 立即收起会因占流布局位移使同一按钮 mouseup 目标漂移丢 click）
  - **测试**：layout-shell / laplacelive-link 恢复「展开后直接点设置」（不再需要先收起）
- **回归**：全量 376 单测 + typecheck + **35 集成全绿**；需重建安装包换装（渲染层改动）

### Changed — 侧栏「模块」二级下拉 + 模块管理迁入设置页分区（2026-09-26）

- **需求**：左侧「扩展」组下「模块」改为二级下拉菜单（点击展开/收起），列出**全部已发现模块**（智能路由：页面模块→打开模块页、pinned 工具→openWebTool、普通业务模块→跳转设置页模块分区）；原「模块管理页」（tab='modules'）删除，其资源管理功能迁入设置页「模块」分区卡（与权限查看/撤销、恢复预设同卡，SETTINGS_GROUPS 保持 6 组）
- **渲染层**：`Tab` 收缩为 `'diagnostics'|'settings'|page:`；侧栏扩展组「模块」nav-item（`tab-modules`）点击展开 `.nav-dropdown` 绝对定位玻璃浮层（不占流——收起不引起布局位移），子项保留 `page-nav-*`/`tool-nav-*` testid、新增 `module-nav-*`；切 tab 或点面板外自动收起；`ModulesPage` 改造为 `ModuleManagePanel` 渲染进设置 modules 分区（module-card-* testid 原样保留）
- **测试**：7 个集成 spec 更新（展开下拉/改道设置/收起后再点设置）；module-page-ui 几何阈值校正（内容区实测 ≈0.69 窗口宽）；全量 376 单测 + typecheck + **35 集成全绿**
- **生效**：需重建安装包换装（渲染层改动）；模块 elm 无需重打（模块内零改动）

### Changed — prologue-live 控制页分组纯色底删除，UI 统一软件圆角矩形（2026-09-26）

- **动机**：模块页 WebContentsView 透明背景上 `backdrop-filter` 不生效（模糊对象仅 view 自身画布），分组卡片玻璃配方退化为半透明深色实块——"纯色底"与软件玻璃卡片观感脱节
- **整改**：`pages/control.html` section 删除背景/边框/阴影（`background: transparent` + 圆角 `var(--r-lg)` 保留），页面底交由宿主槽位呈现（软件一致圆角矩形玻璃面）；控件（输入框/按钮 `--bg-card-2`）保持不变
- **测试**：`m3-control.spec.ts` 玻璃面断言换代「分组无独立色块」（background transparent / 无 backdrop-filter / 无 box-shadow / 无边框 / 圆角 var(--r-lg)）；全量 376 单测 + typecheck + 集成 3 例全绿
- **升版重打包**：manifest 0.1.5 → 0.1.6，T7 链路重打 → `dist/modules/prologue-live-0.1.6.elm`（62,882 B）；探针 pack→inspect→解包验证（section 透明 / 无 --mat-veil）跑通即删；`m8-pack.spec.ts` 断言同步 0.1.6；删除旧 0.1.5.elm

### Fixed — 模块页未覆盖右侧 3/4 内容区（2026-09-26）

- **根因**：`.content`（右侧 3/4 内容区）不是 flex/grid 容器，`.module-page-host` 的 `flex:1` 无效，槽位高度退化为 `min-height: 60vh` → WebContentsView 只覆盖右上局部，未铺满右侧 3/4；叠加 WebContentsView 未设透明背景（默认白底不透明），模块页透明 body 显示为一块白矩形
- **修复（T34）**：`.content` 改为 flex column 容器（槽位 `flex:1` 撑满内容区，其它 `.page` 页面内容驱动不受影响）；`electron-host` 创建 WebContentsView 后 `setBackgroundColor('#00000000')`（模块页透明，材质底由宿主槽位透出——"以三级材质为底"；第三方工具自身画背景不受影响）
- **测试**：`module-page-ui.spec.ts` 新增几何回归断言（槽位宽/高 ≥ 70% 窗口、位于右侧导航区之后，防再次退化）；全量 376 单测 + typecheck + 相关集成 3 例全绿
- **生效**：需重建安装包换装（主进程 + 渲染层改动）

### Added — 模块 UI 契约落地：令牌注入机制 + 机械强制检查（2026-09-26）

- **动机**：既有规范文档为散文条款，约束不了 agent——模块页零 preload 读不到宿主设计令牌，"样式只走设计令牌"对模块页实际不可执行，自建令牌镜像只是换了名字的硬编码。需把约束变成**机制 + 机器检查**（规范本体升级为 **MODULE_UI_CONTRACT.md**）
- **机制（T33 令牌单向注入）**：renderer 读宿主令牌当前解析值（白名单 `src/renderer/src/ui-tokens.ts` 的 `MODULE_PAGE_TOKEN_NAMES`，getComputedStyle 已含主题/强调色/材质档/降级开关当前结果）→ IPC `module-page:tokens`（仅主窗渲染层可发）→ 主进程 `executeJavaScript` 写模块页 `:root`（`buildUiTokenScript`，JSON 转义）；did-finish-load / reload / 重开后自动重注入；值域服务层清洗 `sanitizeUiTokens`（`--` 前缀键 + 值无 `;{}`，防 CSS 逃逸）。主题/材质/降级任一变化经 MutationObserver 实时重推，页面自动跟随
- **整改**：`modules/prologue-live/pages/control.html` 删除自建 `:root` 令牌块（自建 = 违规）、body 透明（材质底归宿主槽位 `.module-page-host`）、分组卡片 = 设置二级菜单 `.card` 配方（`--mat-*` 令牌 + `var(--r-lg)`）；`obs.html`/`overlay.html` 声明画布豁免 `<meta name="eclipse-ui-context" content="canvas">`
- **机械强制**：新增 `tests/unit/module-ui-contract.spec.ts` 扫描 `modules/*/pages/*.html`——非豁免页整页零颜色字面量 / 圆角只走 `var(--r-*)` / body `background: transparent` + `margin:0` + `min-height` / 消费宿主令牌；豁免画布须显式声明 meta。违者测试变红 = 拒绝合并（AI_RULES UI 红线 20）
- **测试换代**：`m3-control.spec.ts` UI 合规 6 例从「自建令牌块范式」改为「T33 注入消费范式」（不自建主题令牌 / 整页零颜色字面量 / 圆角 --r-* / .card 范本 / 显示面积 / body 透明 / var() 引用命中注入白名单）；webtools setUiTokens 4 例 + sanitizeUiTokens + buildUiTokenScript
- **文档**：MODULE_UI_CONTRACT.md 新建（机制/强制模板/禁区/豁免/上线清单/机械检查）；PRODUCT/AI_RULES（18–20 加机械强制条）/CONTRIBUTING/ARCHITECTURE/webtools README 全部指向它
- **回归**：全量单测 + typecheck 全绿

### Changed — laplacelive-link 宿主显示遵循本体 UI 规范（内容区内缩槽位 + 圆角玻璃壳）（2026-09-26）

- **背景**：laplacelive-link 是纯声明式 web 工具（无本地 UI 文件，网页为第三方不可改）——"遵循本体 UI 规范"的落点在宿主侧。此前第三方工具嵌入视图**全幅覆盖主窗（含侧栏）**、无圆角；现改为内容区槽位承载
- **渲染层**：新增 `ToolSlot`（App.tsx）——第三方工具（page=false）打开时在内容区渲染圆角玻璃壳（`.tool-slot`：档 1 frosted 材质底 + `--r-lg` 圆角 + `--sp-3` 内缩），经 T30 rect/visible 通道上报**壳内容盒**矩形（比壳内缩一圈 → 四角露出圆角玻璃边）；侧栏不再被覆盖；互斥同 ModulePageHost（最后激活者赢，卸载隐藏保活 + 恢复其它 open 视图）；挂载优先于 React 页（与 T11 工具优先一致）
- **主进程**：`isMainWindowSender` 由 `getAllWindows()[0]` 改为主窗引用 `mainWindow`（与 pickParentWindow 同源竞态修复——overlay 悬浮窗存在时槽位几何/显隐上报不再被误拒）
- **测试**：pinned-tool-nav 增断言（打开 example-web → `tool-slot` 在位 + 侧栏 `tab-settings` 仍可见 + 关闭后槽位消失）；module-page-ui / webtools-wiring / laplacelive-link 回归零破坏
- **回归**：全量 **364 单测全绿**（30 files）+ typecheck + build 通过；集成 6/6
- **生效**：宿主改动需重建主程序安装包换装；模块本体（.elm）无需重打（laplacelive-link-0.1.1 不变）

### Changed — PrologueType Live 模块 UI 规范合规收口（0.1.4）（2026-09-26）

- **口径确认**：本模块 UI 全部为本地受控 CSS（非外站嵌入）→ **完整适用** PRODUCT.md「模块 UI 规范」（AI_RULES UI 红线 18–20）；仅 OBS 浏览器源 / 悬浮窗的画布样式仍按规范例外，其设置面板不例外
- **合规收口**（承接 0.1.3 材质底/显示面积/组件对齐整改，清残留违例）：材质层补齐 `--mat-veil`，section 玻璃面 background 对齐核心 `.card` 范本配方（`var(--mat-veil), color-mix(--bg-card × --mat-alpha)`）；`.toast` 硬编码色 `#123324`/`#1d4a33` → `color-mix(--ok …)`（令牌块外颜色字面量清零）；散落间距字面量收进 `--sp-*`（按钮/色板/备注/历史行）
- **合规回归**：`m3-control.spec.ts` 新增「UI 规范合规」6 例（标准令牌齐全 / 令牌块外零颜色字面量 / 全模块圆角走 `--r-*` / 玻璃面 `.card` 范本配方 / 显示面积铺满槽位 / 无悬空变量引用）——RED→GREEN，杜绝再退化
- **升版重打包**：`manifest.json` 0.1.3 → 0.1.4，重打 → `dist/modules/prologue-live-0.1.4.elm`（解包验证 module.json 0.1.4 + 修复在位）；`m8-pack.spec.ts` 版本断言同步 0.1.4；删除旧 `prologue-live-0.1.3.elm` 防装错——已安装旧包需重装 + 重启应用生效
- **回归**：全量 **364 单测全绿（30 files）**

### Changed — PrologueType Live 模块 UI 实质遵循软件本体规范（材质底 + 显示面积 + 组件对齐）（2026-09-26）

- **范围**：本地模块（非 http 通讯的第三方 web 工具）界面完整遵循软件本体 UI 规范。控制页（模块内设置面板，不豁免）：`:root` 自建本体令牌块（尺寸层 `--r-*`/`--sp-*`、**材质层档 1 frosted** `--mat-blur 16px/--mat-sat/--mat-alpha 0.78/--mat-edge-light/--mat-border/--mat-shadow-*`、主题/强调层 `--bg-0/--bg-1/--bg-card-2/--acc-line/--acc-fill/--bg-glow-*`）；body 背景对齐本体（双层 radial 光晕 + 线性渐变）使 backdrop-filter 有真实模糊对象；section 消费玻璃面全套（半透明 `color-mix` 底 + blur/saturate + 白描边 + inset 顶高光 + 双阴影 + `--r-lg` 圆角）；显示面积对齐 `--sp-5`（body）/`--sp-4`（section/间距）；控件对齐组件库语义（`.btn` 6px 14px + `--line-strong` 描边 + hover 变强调色、`.input` `--sp-1 --sp-2` + `--bg-card-2`、primary 用 `--acc-fill/--acc-line`）——**可见差异：玻璃卡片 + 本体间距圆角**（上一轮仅令牌换写法的零变化已推翻）
- **画布豁免保持**：overlay.html / obs.html 属 OBS 浏览器源/悬浮窗画布样式例外，保留上轮圆角/间距令牌化，不叠加材质（各自配置驱动的样式系统不变）
- **升版重打包**：`modules/prologue-live` 0.1.2 → 0.1.3，T7 链路重打 → `dist/modules/prologue-live-0.1.3.elm`（61,446 B）；临时探针 pack→inspect→install 往返验证跑通即删；`m8-pack.spec.ts` 版本断言同步 0.1.3；删除旧 `prologue-live-0.1.2.elm`
- **回归**：全量 358 单测全绿（30 files）+ typecheck 通过

### Added — 模块 UI 强制合规规范（2026-09-26）

- **动机**：模块 UI 出现自创外观（硬编码颜色/尺寸、自造背景与圆角），与宿主 iOS 26 材质体系脱节；需在规范层强制各模块严格按软件现有 UI 规则写界面
- **动作**：PRODUCT.md「UI 外观与交互规范」新增「模块 UI 规范（强制）」——展开的功能页以**设置的二级菜单**为范本，必须按照原来的样子：**以三级材质为底，遵循区域圆角和显示面积**；样式只走设计令牌、禁止硬编码颜色与尺寸；组件观感对齐既有组件库；唯一例外为 OBS 浏览器源/悬浮窗的画布样式（其模块内设置面板不例外）。AI_RULES.md 追加「UI 红线」18–20（不重排既有 1–17 编号，外部引用 §5/§6/§13 不受影响）；CONTRIBUTING.md「如何新增模块」插入 UI 强制合规步骤 + 验收清单 UI 一致性检查；ARCHITECTURE.md「UI 设计令牌」节补模块合规指引
- **回归**：纯文档变更，不改代码；全量 358 单测基线不受影响。注意：`modules/prologue-live/pages/control.html` 现有硬编码颜色/圆角按新规属违规，留待后续模块卡整改（一次一卡）

### Changed — laplacelive-link 模块升版重打包 0.1.0 → 0.1.1（2026-09-26）

- **动机**：T7 打包链修复（entry 可空）与悬浮窗父窗修复均落主程序构建；模块本体升版重打，与旧 0.1.0 包（修复前链路产物）区分，避免同模块双版本混淆
- **动作**：`modules/laplacelive-link/manifest.json` version 0.1.1；T7 链路重打包 → `dist/modules/laplacelive-link-0.1.1.elm`（516 B，包内仅 module.json，无 entry/sha256，web 声明完整）；临时探针 pack→inspect→install 往返验证（version 0.1.1 / entry '' / web 保留）跑通即删；删除旧 `laplacelive-link-0.1.0.elm`
- **回归**：全量 358 单测全绿 + typecheck 通过（dist/modules 现为 laplacelive-link-0.1.1 + prologue-live-0.1.1）

### Fixed — web 工具嵌入视图误挂 overlay 悬浮窗 + 底部任务栏被遮（2026-09-26）

- **根因**：主进程 `createElectronWebToolHost` 的父窗取 `BrowserWindow.getAllWindows()[0]`——打字机模块（prologue-live）启用全局悬浮窗后，overlay 悬浮窗与主窗**竞态创建**，悬浮窗可能排到列表首位 → 第三方工具（laplacelive-link）的 WebContentsView 被 `parent.contentView.addChildView` 误挂到悬浮窗上（视窗"绑定悬浮窗"）；悬浮窗是无边框/透明/大尺寸形态，`getContentBounds()` 不扣任务栏 → **底部任务栏被展开窗口遮住一半**
- **修复**（装配层，契约/webtools 服务/App.tsx 零改动）：`index.ts` 模块级持有主窗引用 `mainWindow`（createWindow 赋值、closed 清空）；`getParentWindow` 改为 `pickParentWindow(getAllWindows(), mainWindow)`——显式主窗引用优先，退化时跳过悬浮窗取第一个非悬浮窗，宁缺勿错（全悬浮窗返回 null）
- **可测性**：父窗选择规则抽为 `electron-host.ts` 导出纯函数 `pickParentWindow`（duck typing，Electron 无关）——新增单测 `webtools-parent.spec.ts` 4 例（悬浮窗排首位仍选主窗 / 无主窗引用跳过悬浮窗 / 全悬浮窗返回 null / 主窗引用异常态退化）；集成 `webtools-wiring.spec.ts` 增例「存在 overlay 悬浮窗时视图仍挂主窗」
- **连带修复**：`tests/integration/laplacelive-link.spec.ts` 的 `readModule` 误用测试进程 `globalThis`（应 `page.evaluate`）——tsc 未用变量报错 + 该用例实际必失败，修正后通过
- **回归**：全量 **358 单测全绿**（30 files）+ typecheck 通过；集成 webtools-wiring 2/2、laplacelive-link 1/1、pinned-tool-nav 1/1
- **生效**：需重建安装包换装（旧包仍是 `getAllWindows()[0]` 逻辑）；已打开的视图需重开（重新 openWebTool）或重启应用

### Fixed — PrologueType Live 集成暴露的核心打包链缺陷（pack 丢失 web 声明）

- **根因**：`core/packages` 的 `pack()` 映射 manifest → module.json 时漏带 `web` 字段（T7 pack 早于 T29 页面模块机制）——安装落盘后 manifest 缺 `web` → 模块仅是业务模块而非页面模块 → **二级菜单无入口**（`DiagnosticsModule.page` 数据源缺失）
- **修复**：`module.json` 随包保留 `web`（页面模块声明往返）；`packages.spec` 增回归用例「pack→install 保留 web 声明」（断言含 T29 归一化 `allowedDomains: []`）；packages README 字段清单补 web
- **连带**：`modules/prologue-live/tests/m8-pack.spec.ts` 断言补 web 往返；**重新打包** `prologue-live-0.1.0.elm`（dist/modules，58,355 B）——已安装旧包需重装 + 重启应用生效

### Added — LaplaceLive-Link（2026-09-25）· LAPLACE Chat 网页端直连模块（任务二）

- **新模块 `modules/laplacelive-link/`**（纯声明式：零 JS、零 entry/routes/events/channels/config）——软件内直连打开 `https://chat.laplace.live/`（官方主页内置设置向导，不硬编码房间号），独立 `persist:` 会话保持登录态；`pinned: true` 进扩展组二级菜单（点击 = openWebTool，任务一机制即消费）
- **allowedDomains 闭集最小化**：LAPLACE 系官方域（chat.laplace.live / laplace.live / laplace.chat）+ 备用镜像域（chat.vrp.moe）；**默认不含 bilibili 登录域**——开放平台登录跳转会走导航闭集拦截（如实告知：用户走"匿名直连"，或自行要求后按需追加）
- **测试**：新增集成 `laplacelive-link.spec.ts`（RED→GREEN：启动即发现并 started（web:true / page:false / pinned:true）→ 扩展组 `tool-nav-laplacelive-link` 在位（名称 LaplaceLive-Link、非页面项）→ 模块管理页可见）；全量 **348 单测 + 34 集成全绿**，typecheck 通过
- **真机验收记录（本机已抽验）**：①外站导航拒绝——打开工具后渲染层向 `https://www.bilibili.com/` 发起导航，被 will-navigate 闸门拒绝、诊断计数 +1、视图保持 open；②关闭/重开机制级验证——chip 关闭后 `state: closed`，重开后 `state: open` 且视图重新加载 `chat.laplace.live`，分区恒为 `persist:webtool-laplacelive-link`（代码路径确定、单测覆盖）；③packaged 种子链路——`npm run dist` 出包后安装包 resources/modules 携带 `laplacelive-link/`，隔离 userData 首跑 win-unpacked 产物验证 seedPresetModules 自动播种、manifest 完整落盘——三项临时探针均跑通即删、未入库
- **待真机人工验收**：向导走通 / 登录态肉眼确认

### 决策记录 — LaplaceLive-Link 声明式模块

- **url 用官方主页而非房间号 URL**：会话持久、房间因人而异——用户首次在向导里完成绑定后登录态与历史保留；模块零逻辑零请求，无法也不必替用户固化房间
- **合规确认**：webtools 加载第三方页是 T11 既有架构用途（渲染层显示外部网页 ≠ 模块出网——模块自身零代码零请求）；四闸门（新窗口/下载/权限请求/导航）默认拒绝对 LAPLACE 弹幕机功能无影响；模块无需 network-access 权限（容器直载，与 example-web 声明面无关）

### Added — 前置核心小卡（2026-09-25）· pinned 声明式工具进扩展组二级菜单（LaplaceLive-Link 任务一）

- **数据面**：`DiagnosticsModule` 增 `pinned: boolean`（来源 `manifest.web?.pinned ?? false`）；`collectDiagnostics` 映射补齐；diagnostics.spec 断言跟进（web-mod `pinned:true` / plain-mod `pinned:false`）
- **渲染层**（App.tsx）：扩展组二级菜单数据源过滤扩为 `status==='started' && (m.page || (m.web && m.pinned))`——页面模块照旧、pinned 声明式工具进组；两种项视觉一致、行为各按其类：页面模块 = tab 切换（原逻辑不变）；pinned 工具 = 点击 `openWebTool(id)`（打开占内容区、chip 出现），active 态绑定 webtools 快照 `state==='open'` 而非 tab
- **测试**：新增集成 `pinned-tool-nav.spec.ts`（RED→GREEN：example-web `pinned:true` 出现在扩展组 → 点击 → 快照 `state open` + chip 在位 + active 类 → chip 关闭后切"诊断" React 正常）；既有 module-page-ui 两例 + layout-shell/ui-shell 回归零破坏；全量 **347 单测 + 33 集成全绿**，typecheck 通过
- **改动面**：核心文件仅限本卡清单（shared/diagnostics.ts + main/core/diagnostics/index.ts + App.tsx + 测试）；契约层零 diff

### 决策记录 — pinned 声明式工具进二级菜单

- **点击语义拍板**：pinned 声明式工具点击 = `openWebTool(id)` 而非 tab——无模块页 tab 可承载（ModulePageHost 只承载页面模块网关 URL），打开后工具占内容区、chip 出现；active 态绑定 webtools 快照 `state==='open'`（2s 轮询自然刷新），标签切换逻辑零改动
- **数据源**：pinned 值直读 `manifest.web.pinned`（`?? false`），example-web manifest 现值 `true` 即作集成数据源；页面模块（web 相对 url + entry，含 pinned 也走原路径）优先 tab 行为
- **已知交互**：第三方工具嵌入视图全幅覆盖侧栏（T11 既有行为不变），恢复侧栏操作经底部 chip 关闭

### Added — M7（2026-09-25）· PrologueType Live 模块交付（M1–M7 收口）

- **新模块 `modules/prologue-live/`**（无声系主播打字机，纯模块实现，核心零业务改动）：
  - **控制页**（web 相对声明进应用内二级菜单）：「获取URL」一键复制 OBS 浏览器源地址（clipboard-sanitized-write 特例，无 URL 明文）+ 已复制 Toast；输入区（Enter 发送/撤销上一条/暂停队列/清空 + 内存历史 5 条）；OBS 文字组与样式组（六组合切换 + 调色盘全参数，实时生效）；悬浮窗组（启用/多屏/透明度×2/穿透/吸附/记忆/独立样式/快捷键）
  - **OBS 页**：队列引擎（入口侧纯函数，typingSpeed 驱动 tick）逐字播放；行滚动（内容超高整体上移、新行下方进入，过渡=scrollSpeed）；前缀/后缀符号（可空可多字符）；六样式全部走 CSS 变量注入（零硬编码色值）；ResizeObserver 源长宽自适应；未发送不显示
  - **悬浮输入窗**：置顶/透明/不抢焦点/无任务栏（ctx.overlays 消费 T25/T26）；CSS `-webkit-app-region` 拖动 + `eclipseliveOverlay.resize` grip 缩放；背景/文字透明度分别可调；穿透开关 + 恢复三入口（模块快捷键/托盘/权限撤销）；位置尺寸 debounce 500ms 记忆 + 12px 四边吸附 + 多屏切换重建；崩溃/关闭复位 enabled 且错误经 /state 展示
  - **全局快捷键**（ctx.shortcuts 消费 T23/T24）：穿透切换 + 发送 flush（下行 request-send → 悬浮窗页提交输入）；冲突显式失败上报入 floatErrors（非静默）；float 禁用注销、改键 upsert、权限撤销即失效
  - **样式包**（ctx.styles）：obs / float 两 styleType，apply 只并入对应组（保另一组）、export 抽对应组，validate 拒未知/跨组键与非法 cssVars
- **配置 schema**（version 1，`lib/config.js` 单一来源，manifest defaults 一致性由测试锁定）：OBS 组 13 键 + float 组 20 键全清单（含 textOpacity 保底 30 可读、styleType 六值枚举、hex 校验）
- **文本脱敏红线落地**：bus 事件/日志/诊断只元数据（queue-changed 无 text 键断言）；发送历史仅内存会话级不落盘；/state 与频道内文本为唯一内存流转面
- **测试**：模块 83 例（M1–M7，含 ModulesRig 实载、真实网关 WS 端到端、FakeOverlay/FakeShortcut 生命周期、样式包 import/export）；全量 **347/347 单测全绿** + typecheck 通过；集成 32 例不受影响
- **唯一核心侧改动**：vitest.config.ts include +1 行（模块内测试纳入 `npm run test`，已拍板）；`tests/integration/modules-wiring.spec.ts` 断言从"恰好 2 个模块"改为"≥2 且 failed:[]"（新增模块必然改变参考模块集——更贴近原意图且不脆于未来模块）；核心文件与 App.tsx 其余零 diff
- **验收清单** `modules/prologue-live/ACCEPTANCE.md`：自动门禁 + 用户需求第八节逐条 + T27 九项 + T32 七项（模块接入场景）+ 样式包补充项 + 回滚方法

### 决策记录 — PrologueType Live 模块（M1–M7）

- **权限收敛**（对照 REQ 5.2）：`['window-overlay','global-shortcut']`——「获取URL」复制走自家网关 origin 的 clipboard-sanitized-write 特例，无需 clipboard 权限；快捷键走 global-shortcut 而非 keyboard-capture
- **路由收敛**：routes×4（obs/overlay/control/state），去 REQ 的 POST /send——文本入队统一走 WS 频道上行（三页共用一频道，天然同队列顺序播放）
- **引擎定位**：入口引擎速度无关（tick 由入口按 typingSpeed 调度），只负责段落衔接；OBS 页以同速率本地逐字渲染，两侧天然同步；/state 携带当前播放段落文本供 OBS 源重连恢复（仅内存）
- **撤销语义**（拍板项落地）：撤销"最后入队"段落——pending 静默移除 / playing 停止+移除 / done 从显示区移除
- **发送全局快捷键 = flush 模型**：文本活在悬浮窗页 DOM，快捷键 handler 下行 request-send 由页面提交输入（窗口未开则空操作）
- **样式包双组独立**：obs 与 float 各自 .elstyle 互不污染（默认 apply 为全量替换故自定义 merge）
- **崩溃/关闭语义**：onClosed/onCrashed 均复位 float.enabled=false（避免"启用但无窗"僵尸态），错误（含快捷键冲突）经 /state float.errors 与控制页提示条展示

### Changed — T32（2026-09-25）· Q1 收口：文档落地标记 + 打包链回归（Q1 第四卡）

- **文档收口**：REQ doc C1 标记"已落地（T29–T32，方案 A）"（含 clipboard 特例落地答案与 PrologueType Live 模块侧 manifest 消费写法）+ 第 7 节拍板项 1/2 勾销；ARCHITECTURE.md webtools 行扩"亦承载模块页面" + 核心服务清单补 shortcuts/overlays 两行 + 契约清单补 `IGlobalShortcuts`/`IOverlayWindows` + **web 声明双形态澄清**（绝对 URL=第三方工具零业务（T11 不变）；相对路径=模块页面业务共存——与 T29 校验语义严格一致）；PRODUCT.md 方案 A 行已准确无需改动
- **打包链回归**：`npm run dist` 全链路通过（staging 目录绕行被 IDE 锁定的旧 win-unpacked；exe 112,126,719B + blockmap + builder-debug 三件产出后清理，不入库；electronDownload 镜像配置沿用 0.1.2-beta0923 提交，零新增坑）
- **真机手动验收清单入卡**（7 项：保活秒切/resize 贴合/端口漂移 reload/clipboard 特例对比/托盘往返/packaged 安装包种子链路/T28 材质观感——发布前逐项执行）

### 决策记录 — T32（Q1/Q2/Q3 三块总收口）

- **Q1 模块页面承载 ✅**（T29 契约放宽+相对 URL 全链路 / T30 几何显隐 / T31 二级菜单+槽位+短路 bug 修复 / T32 收口）——PrologueType Live 的控制页（获取URL/输入/调色盘/设置）可全应用内承载
- **Q2 浮窗管理器 ✅**（T25/T26/T27）——悬浮输入窗全核心地基就绪（真机 9 项清单在 TASKS/T27）
- **Q3 全局快捷键 ✅**（T23/T24）——发送/暂停/切换穿透热键地基就绪
- **三块依赖关系兑现**：Q3 穿透恢复热键 → Q2 托盘+快捷键双入口；Q2 origin 闭集 → Q1 相对 URL 解析同构（同"仅自家网关"信任模型）
- 权限闭集从 8 → 10 项（global-shortcut / window-overlay）；诊断快照新增 shortcuts / overlays 两节；模块能力面新增 `ctx.shortcuts` / `ctx.overlays` / 模块页面（web 相对声明）——**PrologueType Live 全部核心前置就绪，可进入模块开发（M1 骨架起）**

### Added — T31（2026-09-25）· 渲染层模块二级菜单 + 内容区槽位（Q1 第三卡）

- **前置缺口补齐 `GatewayResponse.contentType`**：模块页面需要真 HTML——gateway 响应支持可选 contentType（默认 JSON 序列化不变；text/html 等非 JSON 时 body 字符串直写），契约+实现最小扩展
- **修复 T29 遗留短路 bug（本卡最重要的实质修复）**：`modules/index.ts load()` 的 webTool 分支原对一切带 `web` 的模块短路（不 import entry、不 init）→ **页面模块路由从未注册、页面 404**。改为 `manifest.web && !manifest.entry` 才短路——web+entry 页面模块走正常业务加载（日志从 `web tool module loaded` 变 `module loaded` 即铁证）；modules.spec 补路由注册断言（回归防线）
- **数据面**：`DiagnosticsModule.page`（web+entry 已启动业务模块——二级菜单数据源，2s 轮询自然刷新）
- **App.tsx**：`Tab` 扩展 `` `page:${moduleId}` `` 动态页；"扩展"组渲染页面模块二级菜单（模块名 nav-item + active 态）；`ModulePageHost` 槽位组件——挂载即 `openWebTool`（**保活**：切走仅 `visible=false` 不 close，重进秒开）+ open 成功后 show + rect 对齐 + ResizeObserver/resize 实时上报 + **互斥规则**（进入隐藏其它 open 视图、卸载恢复第三方工具显示回归 T11 chip 行为）+ **disposed 标志**（切走后 open 才完成时保持隐藏不泄漏显示）+ open 失败 EmptyState 兜底
- **example-empty 演进为最小页面模块**：manifest 加 `web.url: '/example-empty/page'` 相对声明 + GET 路由返回 text/html 示例页（仍是零业务逻辑参考模块）；modules-wiring 断言 2/2 不变
- **视觉验证（view webContents 截图定案）**：嵌入视图完整渲染模块 HTML（标题+两行说明+深色背景，非 404/空白）；**窗口级截图（CDP page.screenshot / win.capturePage）均不含 WebContentsView 合成层——截图手段局限，真机肉眼可见**（bounds/visible/内容三证齐全），记录入 T32 真机清单
- **测试**：集成 `module-page-ui.spec.ts` 2 例（二级菜单→槽位→快照 poll 断言 open+page 标记；切走保活 state open + React 正常）；既有 30 例回归零破坏（layout-shell/ui-shell/settings/a11y-motion）；单测 264 全绿（modules.spec 页面模块用例补"init 真执行·路由已注册"断言）——全套 **264 单测 + 32 集成全绿**

### 决策记录 — T31

- **webTool 短路 bug 教训**：T29 放宽校验时未同步改加载分支——校验（合法）≠加载（短路），集成断言 `state:open` 因 404 也算 loadURL 成功而未拦截；修复后以"路由已注册"断言封死该类盲区
- 互斥规则"最后激活者赢"：tab 为唯一真相源；已知限制——模块页 tab 内打开第三方工具后视图叠放（z 序后加在上），切走再切回模块页即恢复独占
- rect 上报不做节流（setBounds 轻量、一次性动效期间 8px 偏差可接受）；槽位 60vh min-height 兜底（.content 非 flex 容器）
- 窗口级截图不含 WebContentsView：后续 UI 视觉验收需 `win.capturePage` 之外的真人验收或 view.webContents 截图（已验证可行）

### Added — T30（2026-09-23）· embedded 视图几何跟随 + 显隐接口（Q1 第二卡）

- **契约 `webtools.ts`**：`WebToolRect {x,y,width,height}` + `WebToolView.setBounds/setVisible`（window 模式视图自管几何，两个方法 no-op）+ `IWebTools.setRect/show/hide`（非法矩形——非数字/非正宽高——忽略 + log warn；closed 工具无操作）
- **electron-host**：WebContentsView 胶水 + **rectDriven 标志**——服务一旦 setRect（T31 槽位驱动），主窗 resize 的整窗自适应（T11 兼容行为）即停止覆盖；未驱动前行为与 T11 完全一致（每卡独立绿）
- **装配**：IPC `module-page:rect` / `module-page:visible`（**sender 校验**=主窗 webContents——工具窗/悬浮窗/外来 sender 拒绝）+ preload 富桥 `reportModulePageRect` / `setModulePageVisible`（T31 槽位消费）
- **测试（RED 先行后转绿）**：webtools.spec 增 3（setRect 路由/非法矩形三态忽略/closed 无操作；show/hide 路由；reload+setRect 组合无干扰）——全套 **264 单测（261+3）+ 30 集成全绿**（example-web 既有行为零变化）

### 决策记录 — T30

- 兼容序：embedded open 后默认 show + 整窗自适应**不变**（T11 行为），T31 槽位激活才驱动 setRect/show/hide——本卡无消费方、独立可回滚
- rectDriven 单向标志：槽位驱动后 resize 不再整窗覆盖（防几何回退 bug）；window 模式不参与（独立 BrowserWindow 自管）
- rect 坐标系：主窗客户区（renderer getBoundingClientRect 直传，无缩放因子）；服务层防御 IPC 层的垃圾数据

### Added — T29（2026-09-23）· 模块页面契约放宽 + webtools 相对 URL 全链路（Q1 第一卡）

- **契约演进 `webtools.ts`**：`WebToolDeclaration.url` 双语义（绝对 http(s)=第三方工具（T11 不变）；`/`-前缀相对路径=**模块页面**——业务模块 web 与 entry/routes/events/channels 合法共存，第三方页仍禁业务防伪装）；`allowedDomains` 转可选（页面模块省略→校验器存 []，核心运行时注入网关 origin）；`WebToolViewSpec.selfOrigin`（自家网关 origin，第三方 null）+ `WebToolView.loadUrl`（reload 用）+ `IWebTools.reload` + `WebToolStatus.page` 标记 + `url: string | null`（**页面模块返回 null——解析后真实 URL 含 token 绝不外泄**）
- **validateManifest 放宽（方向性）**：只放相对 url + 业务声明共存；绝对 URL 四态校验零变化（example-web 无感）；相对 url 坏形拒绝（无 / 前缀/scheme/空格）；entry containment 补齐（web 模块提供 entry 时也查逃逸——原实现 web 存在即跳过）
- **webtools 服务**：`WebToolsOptions.gateway` 注入；open 时相对 url → `gateway.getRouteUrl` 运行时解析（网关未就绪显式失败），导航闭集 = `[网关 origin, ...声明]`；`reload` 重新解析 + loadUrl（第三方工具跳过）；装配层订阅 `gateway:port-changed` → open 页面全部 reload（**端口漂移跟随**）
- **clipboard 特例（拍板点采纳）**：electron-host permission handler——`selfOrigin` 命中且请求类型为 `clipboard-sanitized-write`（写剪贴板=复制按钮）→ 放行；**读仍默认拒**；第三方工具（selfOrigin null）不受特例
- **测试（RED 先行后转绿）**：modules.spec 增 2（相对 url 页面模块 web+entry/routes/events 合法加载 started；坏形/省略 allowedDomains）；webtools.spec 增 4（open 解析链路+导航闭集/token 断言；status 红线 url null + page 标记；reload 重载/第三方跳过；网关未就绪显式失败）——全套 **261 单测（256+5）+ 30 集成全绿**

### 决策记录 — T29

- 方案 A 落地形态：不新增契约键，`web.url` 相对引用即"模块页面"信号（与早期拍板一致）
- token 红线扩展：解析后 URL 仅存在于服务内部与 host spec；status/list/诊断快照一律 null（`DiagnosticsWebTools.statuses[].url: string | null` + `page` 字段）
- clipboard 特例收窄到 `clipboard-sanitized-write` 单类型：写满足复制按钮、读不放开（第三方工具对比断言走 onDenied 计数）
- 第三方工具零变化：绝对 URL 路径全部保留（模块校验"web+entry 拒"一例改为页面模块合法例，第三方拒由绝对 URL 分支继续承担）
- embedded 几何仍为整内容区（T11 已知限制）——T30 修

### Added — T27（2026-09-23）· 悬浮窗托盘入口 + 诊断展示 + Q2 收口

- **托盘"悬浮窗：关闭鼠标穿透"逃生入口**（createTray 菜单新增项，"显示主窗口"与"退出"之间）：点击遍历 `overlays.list()` 对所有 `clickThrough===true` 窗口 `setClickThrough(false)`（装配根循环，零契约膨胀）——**穿透恢复三入口闭环**：模块快捷键（ctx.shortcuts+ctx.overlays 组合）/ 托盘本项 / 权限撤销销毁，穿透变砖兜底
- **诊断快照 overlays 节**：`DiagnosticsOverlays { open, byModule, clickThroughCount }`（**URL 红线：节点不含窗口 URL**——token 绝不跨 IPC）+ `DiagnosticsDeps.overlays` 必填（沿 T24 shortcuts 收紧先例）+ 聚合映射；渲染层展示归 Q1 页面承载卡
- **文档**：REQ doc C2 标记落地（含与提案差异：resize 桥 / preload 隔离 / origin 闭集 / focusable 默认 true）+ **9 项真机手动验收清单入卡**（透明显示不抢焦点可打字 / screen-saver 置顶不遮系统对话框 / 穿透恢复三入口 / resize 手柄 + onMoved/onResized 持久化往返 / 多屏与拔屏回收 / 权限撤销销毁与 restart 恢复 / eclipseliveOverlay 桥隔离抽验 / overlay:resize sender 校验 / 独占全屏不承诺可见——PrologueType Live 悬浮窗接入时逐项执行）
- **测试**：diagnostics.spec +1（空形状 + URL 红线断言）+ 新增"创建并穿透后形状"（RED 先行）；托盘入口属装配胶水人工验收（记入清单）——全套 **256 单测 + 30 集成全绿**

### 决策记录 — T27

- 托盘菜单项**常开**（不做 enabled 动态重建）：正确性靠入口常开（无穿透窗口时点击无害无感），避免托盘菜单重建时序复杂度；`trayOverlays` 模块级晚绑定桥（IIFE 与 createTray 作用域，null 时无害）
- 诊断节点只出计数与分组（URL/bounds 不出——bounds 属模块隐私配置且诊断页无消费方）
- **Q2 全部完成**（T25 契约/服务 + T26 宿主/resize 桥/装配 + T27 托盘/诊断/文档）；下一步 **Q1 模块页面承载**（App.tsx 左侧二级菜单 + 右侧内容区槽位 + web/entry 互斥放宽）

### Added — T26（2026-09-23）· 悬浮窗 Electron 宿主 + resize 桥 + 装配（Q2 第二卡）

- **Electron 宿主 `src/main/core/overlay-windows/electron-host.ts`**：BrowserWindow 工厂（frame:false / transparent / `setAlwaysOnTop('screen-saver')` / skipTaskbar / focusable / resizable / `ready-to-show` 后 **`showInactive()` 显示不抢焦点**——透明窗必须等就绪再显否则黑块）+ `screen.getAllDisplays()` 映射（primary 标记）+ `setIgnoreMouseEvents(on, {forward:true})` 穿透（穿透态页面仍收 mousemove 供 hover）+ `render-process-gone` → onCrashed + `win.destroy()`（**崩溃隔离**：只死这一窗）+ moved/resized 回调携 getBounds + destroy 幂等（`isDestroyed()` 守卫）+ 窗口标记 `isOverlayWindow()`（供 resize IPC sender 校验）
- **悬浮窗专属最小 preload（核心首个面向模块页面的桥）**：`src/preload/overlay.ts` 仅暴露 `eclipseliveOverlay.resize({dx,dy,dw,dh})` 一个方法（send 单向，preload 层防御非法 delta）——**与主富桥完全隔离**（模块网关页面不得获得 window.eclipselive）；electron-vite 第二入口（`rollupOptions.input` index+overlay），产物 `out/preload/overlay.js` 0.63kB；**拖动不走 IPC**（页面 CSS `-webkit-app-region: drag` 原生）
- **resize IPC（`overlay:resize`）**：sender 必须是 overlay 窗口 webContents（`BrowserWindow.fromWebContents` + `isOverlayWindow` 标记校验——主窗/网页工具/外来 sender 一律静默忽略）+ `applyOverlayResize` 按 `win.getMinimumSize()` 钳制下限（用户驱动拖拽归 OS 约束屏边界，服务端钳制只管程序性 bounds——T25 决策）
- **装配**：`createOverlayWindows`（permissions 之后、createModules 之前，同 shortcuts 位次）→ modules options → **`ctx.overlays` 对真实模块可见**；`overlays ready` 日志锚点；**撤销联动**：`module:permission:set` 撤销 `window-overlay` → `removeModule` 窗口立即销毁（grant 不恢复须 restart）
- **测试**：集成 `overlays-wiring.spec.ts`（`overlays ready` 日志 + `out/preload/overlay.js` 产物存在双断言）；electron-host/preload 胶水不单测（vitest 无 Electron 运行时，沿 T24 先例——逻辑已在 T25 fake host 单测覆盖）——全套 **255 单测 + 30 集成全绿**

### 决策记录 — T26

- **preload 隔离红线**：overlay 窗载入模块网关页面（token 在 URL）——绝不复用主 preload；overlay preload 全部暴露面 = 1 个 resize 方法
- showInactive 在 `ready-to-show` 后调用（透明窗显示时序）：显示不抢焦点与点击可打字并存——不用 focusable:false
- 透明窗 Windows 无系统 resize（Electron 平台限制）→ resize 桥是唯一路径；非透明窗仍走系统 resize（host resizable 直设）
- `render-process-gone` 后 `win.destroy()` + onCrashed 一次（防半死窗重复上报；服务层 staleness 守卫吞后续事件）
- 撤销 `window-overlay` 即销毁 + create 门禁双保险（同 T24 shortcuts 模式）；托盘恢复穿透入口与诊断展示归 **T27**

### Added — T25（2026-09-23）· 悬浮窗契约 + 服务 + 模块接入（Q2 第一卡）

- **契约 `src/contracts/overlays.ts`**：`IOverlayWindows`（create/destroy/setClickThrough/setAlwaysOnTop/setBounds/getBounds/screens/list/removeModule/diagnostics）+ `ModuleOverlays` 门面（`ctx.overlays`）+ 注入式 `OverlayWindowHost`（不透明 `OverlayWindowHandle` + `OverlayHostHooks`：onClosed/onCrashed/onMoved/onResized）+ spec 默认值即悬浮输入窗形态（transparent/alwaysOnTop('screen-saver')/skipTaskbar/**focusable:true**（点击可打字——不用 focusable:false）/resizable/clickThrough off + minSize 200×120）
- **权限闭集扩展（第 10 项）**：`window-overlay`（置顶/透明/穿透/多屏打包声明）
- **核心服务 `src/main/core/overlay-windows`（零 Electron import）**：`${moduleId}:${id}` 注册表（所有权即 key 查找）；**create 门禁 + bounds 钳制**（minSize 兜底、最大相交屏收纳、离屏回落主屏——防丢窗）；**重复 create 拒绝**（窗口带活态，无 upsert——先 destroy 再建）；回调 throw 隔离 + **spec 身份 staleness 守卫**（同 id 销毁重建后旧 host 事件不得打新窗口）；onClosed/onCrashed 出表 + 防御性 host.destroy；onMoved/onResized 更新 bounds 供模块持久化（持久化归模块配置）；removeModule 全销毁（unload 路径，**stop 不清**——与 routes/channels/shortcuts 生命周期一致）
- **模块接线（沿 T23 先例）**：`ModulesOptions.overlays?` + `ctx.overlays` 门面（**URL origin 闭集：仅本网关 origin**——外部网页不得进置顶窗；facade 校验因只有 manager 知网关 origin）+ unload 清理
- **测试（RED 先行后转绿）**：`tests/unit/overlays.spec.ts` 15 例（全链路默认值/参数校验/权限门禁/重复拒绝/钳制三态/host 失败/所有权/setBounds 钳制/screens 透传/回调分发与 status 更新/onClosed 出表幂等/onCrashed 销毁/回调抛错隔离/removeModule/diagnostics）；modules.spec +3（网关 URL 成功 + 非网关 origin 拒/未声明权限拒/stop 不清 unload 清）；permissions.spec +1（window-overlay 入闭集）——全套 **255 单测（236+19）+ 29 集成全绿**

### 决策记录 — T25

- **悬浮窗内容 = 模块自己的网关页面**（origin 闭集），绝不复用主 preload 富桥（模块页面不得获得 window.eclipselive——专属 preload 归 T26）
- focusable 默认 true + host `showInactive` 显示是"不抢焦点但可输入"的正解；**不要** focusable:false（输入框将完全无法收键盘）
- 无 upsert（快捷键有、窗口没有）：窗口携带运行态（位置/穿透/页面状态），重复 create 显式拒绝
- 撤销即时性 = create 门禁 + 装配根撤销 IPC 联动销毁（T26）；服务层不做运行时权限轮询
- Electron 宿主（BrowserWindow 工厂/render-process-gone/穿透/resize 桥）归 **T26**；托盘恢复入口与诊断展示归 **T27**

### Changed — T28（2026-09-23）· 玻璃光学重构 + 基础动效

- **材质三档光学重构（iOS 26 Dock 语言，强度克制）**：renderer.css 材质令牌 6 变量 → **13 变量同构**（blur/sat/alpha/edge-light/edge-thick/border/refract 链/scene-op/disperse/veil/glow/shadow×2）——档 1 frosted（blur 16px+sat 1.2+**inset 顶高光 0.25**+白描边，半透明替代旧不透明塑料）；档 2 subtle liquid（+**SVG 位移折射** scene-op 0.6+弱 RGB 色散+底部厚度）；档 3 liquid（折射 scale 42+强色散+**强调色边缘光晕 color-mix(var(--acc))**+可读性 veil 32%）
- **折射实现路线（关键修正）**：用户规格提到 `backdrop-filter: url(#filter)`——经参考项目实证（@dpawlikowski/liquid-glass，nikdelvin/eirasmx 两仓库 404）**Chromium 不支持 url() 于 backdrop-filter**，参考项目同用「复制场景层」：`.card/.side/.tool-bar/.modal-panel::before` 以 `background-attachment:fixed` + fit 令牌镜像（--scene-size/pos/repeat）复绘壁纸，`filter: var(--mat-refract)`（feTurbulence 0.008 + feDisplacementMap scale 20/42，index.html 内嵌 defs，**静态无 animate**）；无壁纸→层透明（如实光学：无图可折射）
- **高光/色散**：边缘高光全部 **inset box-shadow**（弃渐变叠加，旧 --mat-highlight/--mat-refract 渐变令牌删除）；色散 `::after` inset 红蓝双色边 + `mix-blend-mode: screen`（档 2 0.07 / 档 3 0.12）
- **档 3 帧率自动降档（纯运行态）**：`shouldDegradeForFps` 纯函数（120 帧窗口均值 <45fps 判定，非正间隔防御）；App rAF 采样器仅档 3 未降级时运行→降档：data-material 渲染值 3→2 + `data-motion-low='1'`（禁非必要动效）+ 设置页 `material-fps-degrade-hint`；**重选档位即复位重试**；渲染值收口 effect 兜底复写（preload 写值无 fps 知识）
- **基础动效（克制：transform/opacity、ease-out、≤300ms、无持续动画）**：`.page` 切换淡入上移 180ms（remount 一次性）；`.modal` 遮罩淡入/`.modal-panel` 缩放入场 180ms + **退场 data-closing 缩放 160ms 延迟卸载**（Modal/ConfirmDialog 组件内建，按钮/遮罩同路径）；`.toast` 底部升起（关键帧保持 translateX(-50%) 合成）；`.btn/.nav-item/.seg` 悬停上浮 -1px/按压 scale .98 120ms；表面 280ms 主题/材质/底图过渡（backdrop-filter/box-shadow/color）；`[data-motion-low]` 低配降级；reduce-motion 全局开关不变（`* → none`）
- **reduce-transparency 扩展**：一切光学令牌归零（edge/border→var(--line-strong)/refract none/scene-op 0/disperse/veil/glow none）纯色面板
- **测试（RED 先行）**：theme.spec 材质段重写 5 例 + 玻璃光学层新增 5 例（SVG defs 形状/场景层 fixed+filter/色散 screen/fit 令牌镜像/关键帧仅 transform-opacity）+ shouldDegradeForFps 4 例 + reduce-transparency 扩展断言；Playwright 真机截图三档视觉验收（无白块/遮挡/溢出，inset 高光浮起生效）——全套 **236 单测（224+12）+ 29 集成全绿**

### 决策记录 — T28

- 折射走「复制场景伪元素层」而非 backdrop-filter:url()（Chromium 实证不支持；与用户引用参考项目同路线，效果等价）
- 档 1 由不透明改半透明 alpha 0.78（用户诊断"纯色塑料"的直接修正；frosted 本应是玻璃）；对比度运行时自动测量不做——档 3 veil 为静态兜底 + reduce-transparency 终极开关（如实注明）
- Toast 退场动画不做（父级 5s 直接卸载，改 App 卸载路径超出本卡克制范围）；模块列表展开折叠动效不做（当前无展开列表，规则已留 [data-motion-low] 与关键帧范式）
- fps 采样仅档 3 运行（健康清窗续采，降档即停）；fpsDegraded 纯运行态不持久化不进 core.ui（无 shape 变更无迁移）

### Added — T24（2026-09-23）· 全局快捷键 Electron 宿主 + 装配（Q3 收口）

- **Electron 宿主 `src/main/core/shortcuts/electron-host.ts`**：`globalShortcut` 薄胶水（register 返回 boolean、抛错转 false；unregister 幂等）——业务规则全在 Electron-free 服务层（同 credentials/webtools 胶水先例）；app 退出时 Electron 自动注销全部热键，不加退出兜底
- **装配根接线（main/index.ts）**：`createShortcuts` 组装于 permissions 之后、createModules 之前（依赖序 logger→permissions→shortcuts→modules）；`shortcuts` 传入 modules manager → **`ctx.shortcuts` 对真实模块可见**；启动日志 `shortcuts ready`（集成锚点）
- **撤销 IPC 联动**：`module:permission:set` 撤销 `global-shortcut` 成功后主动 `shortcuts.removeModule`（叠加 T23 触发时门禁，双保险）；**grant 不自动恢复**（handler 引用已随清理丢弃，重新授权须模块 restart 重注册——注释与设置页文案点明，避免"授权了热键没反应"陷阱）
- **诊断快照 shortcuts 节**：`DiagnosticsSnapshot.shortcuts`（registered / byModule 分组 / 冲突环拷贝）——渲染层展示归 Q1 页面承载卡；包校验/excludes 无涉
- **测试**：集成 `shortcuts-wiring.spec.ts`（真实启动断言 `[lifecycle] shortcuts ready`）+ 单测 diagnostics.spec 快捷键节点两断言（空形状/注册后 byModule）——RED 先行后转绿；全套 **224 单测 + 29 集成全绿**

### 决策记录 — T24

- 权限撤销即时性双保险：T23 触发时惰性门禁（行为层）+ 本卡 IPC 主动清理（注册表层）；grant 恢复显式不做（handler 引用不可复活，restart 是正解）
- `DiagnosticsDeps.shortcuts` 必填（非 optional）——装配根与测试 rig 同步收紧，类型安全优先
- Q3 全部完成（T23+T24）；`ctx.shortcuts` 已可用于模块开发（PrologueType Live 发送/暂停/穿透切换热键地基就绪），下一核心卡为 Q2 浮窗管理器

### Added — T23（2026-09-23）· 全局快捷键服务（Q3 第一卡）

- **契约 `src/contracts/shortcuts.ts`**：`IGlobalShortcuts`（register/unregister/removeModule/list/diagnostics）+ `ModuleShortcuts` 门面 + 注入式 `ShortcutHost`（唯一 Electron 感知点）+ `ShortcutsDiagnostics`（冲突环 20 条）；设计决策——**不新增 manifest 字段**：快捷键 id 是模块私有标签不占共享命名空间（区别于 events/routes/channels 的共享注册表），真实风险面 = 全局 accelerator 占用，已由权限门禁 + 冲突检测覆盖
- **权限闭集扩展（第 9 项）**：`global-shortcut` 进入 `PERMISSION_TYPES`（语义精确：特定 accelerator 全局热键 ≠ 全键盘捕获 `keyboard-capture`）；闭集校验/包 inspect 校验自动生效；渲染层权限名原样渲染无需改动
- **核心服务 `src/main/core/shortcuts`（零 Electron import）**：`${moduleId}:${id}` 注册表 + accelerator→键反查索引——**冲突检测必须在调 host 前自查**（Electron 同 accelerator 重复 register 会静默覆盖前一个回调）；跨模块冲突显式失败并点名持有方、系统占用显式失败（heldBy=system）双双入环；**upsert 无中间态**（新键先注册成功才释放旧键，失败则旧条目原样保留）；**权限双重门禁**（注册时 + 触发时——撤销下一次按键即失效且条目自动反注册）；handler 抛错隔离
- **模块接线（沿 T10 styles 先例）**：`ModulesOptions.shortcuts?` optional + `ctx.shortcuts` 门面（moduleId 强制绑定、list 过滤本模块）+ unload 时 `removeModule`（**stop 不清**——与 routes/channels 生命周期一致，契约注释写明）
- **测试（RED 先行后转绿）**：`tests/unit/shortcuts.spec.ts` 13 例（注册全链路/参数校验/upsert×3/跨模块冲突/系统占用/注册时+触发时撤销/unregister 所有权/removeModule 隔离/handler 抛错隔离/诊断环上限 20）；`modules.spec.ts` +3（ctx.shortcuts 门面注册与权限拒绝/stop 不清 unload 清/未接线无 shortcuts 键）；`permissions.spec.ts` +1（global-shortcut 入闭集）
- **集成版本断言修复（非 T23 回归，随本卡一并转绿）**：`app-launch` 硬编码 `v0.1.0` → 自适应 `package.json` 版本（`require` 注入）；`title-screen` 版本正则补预发布后缀 `(-[\w.]+)?`——两处均为版本号升至 `0.1.2-beta0923` 后的断言过时；全套 **223 单测（206+17）+ 28 集成全绿**

### 决策记录 — T23

- 权限命名（拍板点采纳）：新增 `global-shortcut` 而非复用 `keyboard-capture`——热键注册只占特定 accelerator，语义与"全键盘捕获"分层；Q2 将同批扩 `window-overlay`
- upsert 语义定死为「先注新、后释旧」：失败时旧条目原样保留（测试断言），杜绝"旧的没了新的也没成"中间态
- 触发时惰性权限门禁保证撤销即时生效，无需权限服务发事件、无需撤销 IPC 联动（联动归 T24 装配卡）
- Electron host 实现、装配根接线、撤销 IPC 联动、诊断快照聚合归 **T24**（`ctx.shortcuts` 在 T24 落地前对真实模块不可见——optional 注入）

### Added — T22（2026-09-23）· 动效与可读性收尾

- **可读性降级三开关**（`core.ui` shape v4）：`reduceTransparency / highContrast / reduceMotion` 三布尔默认 false；validate 必填布尔（拒字符串 / 数字 / 缺失 / 未知键），migrate v4 直通、v3 及以下补三布尔默认；main `core.ui` 注册 version 3 → 4
- **根节点降级属性**：`data-reduce-transparency / data-high-contrast / data-reduce-motion`（'1'/'0'），preload `applyUiSettings` 与 App.tsx 主题引擎双应用点同步写
- **降级 override 块 ×3**（renderer.css，置于材质层之后保层叠）：减少透明度 = 材质退化为不透明（`--mat-alpha: 1`、`--mat-blur: 0px`、高光/折射 `none`）；高对比度 = `--txt-2/--txt-3/--line/--line-strong` 重映射到 `-hc` 增强备用令牌（两主题层各 4 枚，色字面量只在令牌块，override 块零色字面量约束保持）；减少动态效果 = `[data-reduce-motion='1'] *` 全局 `transition/animation: none`
- **档 3 自动降档**：纯函数 `effectiveMaterial`（theme.ts 导出）——高对比度下档 3 文字对比度不足，`data-material` 按档 2 渲染（持久化值与档位选择器仍显示档 3），外观组条件提示 `material-degrade-hint`；「减少透明度」正交不触发降档
- **动效克制**：全站唯一短过渡 `.switch-knob` transform 160ms；单测断言全站 transition/animation 时长 ≤ 300ms；「失焦不变」= 零失焦监听，集成断言 blur/focus 后材质与降级属性不变
- **外观组 UI**：三 Switch 行（`switch-reduce-transparency` / `switch-high-contrast` / `switch-reduce-motion`）即时生效并持久
- **测试**：单测 theme.spec 扩（三布尔 validate / migrate v3→v4 补默认 + v4 直通 / `effectiveMaterial` 分支 / config 往返 / CSS 三降级块 + `-hc` 令牌 + 动效时长）；集成 a11y-motion 两用例（三开关默认关 + 根属性即时生效 + 持久往返 + 非法 patch 拒绝；档 3 自动降档 + 外观组 UI + 降档提示 + 失焦不变）——RED 先行后实现转绿；全套 206 单测 + 28 集成全绿

### 决策记录 — T22

- D1 三开关入 `core.ui` 视觉分区（shape v4）：默认 false、validate 严格布尔、migrate 补默认；根属性统一 '1'/'0'（规避 `String(true)==='true'` 陷阱）
- D2/D3 降级走「override 块 + 备用令牌」而非改三档材质令牌块——材质区间断言与 material-wiring 集成不受影响；`-hc` 色值只落主题令牌块，override 块用 `var()` 重映射
- D4 减少动态效果在 CSS 层全局兜底（`[data-reduce-motion='1'] *` 禁过渡与动画）；转场克制补唯一短过渡 160ms（≤300ms 单测约束）
- D5 档 3 自动降档用确定性简化（不做运行时逐像素对比度取样）：`effectiveMaterial(s) = s.material === 3 && s.highContrast ? 2 : s.material`——存储值与渲染值分离（config/选择器不变，`data-material` 写渲染值），preload/App 双应用点一致；失焦不变 = 不加失焦监听

### Added — T21（2026-09-23）· 设置项补全（含检查更新，默认关闭）

- **应用设置分区 `core.app`**（version 1）：`src/shared/appSettings.ts`——`AppSettings { checkUpdatesEnabled: false }` 默认关闭 + `validateAppSettings` 严格校验（非对象 / 未知键 / 非布尔逐项拒）；`core.ui` 纯视觉不动、`lifecycle` 形状不扩
- **检查更新服务** `src/main/core/updates`：注入式 transport 的 GitHub Releases 检查器——默认 Node `https` 直查 `api.github.com/repos/${GITHUB_REPO}/releases/latest`（User-Agent、10s 超时、只读 tag_name/html_url），`vX.Y.Z` 纯三段数比较（非法 tag 判 error）；**独立于 `INetworkClient`（local-empty 红线不变）**；`update:check` handler 先读开关，关闭态零请求直接返回「检查更新已关闭」
- **设置四组实装**（功能 / 模块 / 连接 / 诊断，`SETTINGS_PENDING` 同步改实装）：功能组关闭到托盘开关 + 检查更新开关（默认关闭）+「立即检查」Toast 反馈；模块组权限查看与撤销（declared 逐项授权/撤销）+ 恢复预设（manifest `config.defaults` 写回同名分区，无 config 模块显式提示）；连接组 OBS 端口 / 密码（空 = 不修改，写入凭据存储 `obs:password` 不落明文）/ 自动重连 + 应用并重连 + 本地网关信息只读展示；诊断组日志查看（当日日志尾 200 行 Modal 展示）+ 诊断刷新 + 诊断包导出
- **新增 IPC 七组**：`app-settings:get/set`、`lifecycle:get/set`、`obs:config:get/set`、`module:reset-config`、`module:permission:set`、`logs:tail`、`update:check`；preload 桥 10 个方法透传（`appSettings`/`setAppSettings`/`lifecycleSettings`/`setLifecycleSettings`/`obsConfig`/`setObsConfig`/`resetModuleConfig`/`setModulePermission`/`viewLogs`/`checkUpdate`）
- **diagnostics 提取 `readLogTail(logsDir, lines)`** 导出（`buildDiagnosticBundle` 复用），日志查看与诊断包共用当日 `eclipselive-YYYY-MM-DD.log` 尾部行逻辑
- **组件库消费**：Switch / TextInput / ListRow / Btn / Modal / Toast / EmptyState 全走 ui.tsx 零新碎片样式；新增 `.log-view`（模态日志文本，等宽 + 限高滚动）只消费设计令牌、零颜色字面量
- **测试**：单测 app-settings.spec 7 例（默认关闭规格 / 严格 validate / 检查器三态 fake transport 不触网）；集成 settings-full 三用例（功能组关闭态提示与托盘往返 / 模块组权限撤销往返与恢复预设反馈 / 连接诊断组 OBS 参数生效、网关渲染、日志 Modal）——RED 先行后实现转绿；全套 197 单测 + 26 集成全绿

### 决策记录 — T21

- 检查更新红线（D2）：网络路径独立于 `INetworkClient`（模块出网通道保持 local-empty），仅「立即检查」显式触发、开关关闭零请求；仓库暂无 git remote，URL 走常量 `GITHUB_REPO` 占位，发布仓库定型后填充；关闭态结果复用 `status: 'error'` + error 文案「检查更新已关闭」（不新增 'disabled' 状态枚举，UI Toast 直取 error 文案）
- 「恢复预设」（D3）= manifest `config.defaults` 写回 `<moduleId>` 同名配置分区（modules 加载时即以 defaults 注册）；example 两模块均无 config → 走「该模块没有可恢复的预设」提示路径，不静默失败
- OBS 密码（D4）写入凭据存储 `obs:password`、空输入 = 不修改、不落明文不回显；`obs:config:set` 改端口或密码后显式调 `obs.reconnect()`（obs 无 config onChange 监听，set 不触发自动重连）
- 日志查看（D5）= `readLogTail` 从 diagnostics 提取导出复用；`diag-export` 复用 `diagnostics:export` 原生保存对话框（集成测试只断言按钮在位不点击）；`module:permission:set` 入口用 `isPermissionType` 守卫收窄（未知权限类型显式拒绝）

### Added — T20（2026-09-23）· 组件库统一

- **组件库单模块** `src/renderer/src/ui.tsx`：12 个导出成套——Btn（variant: primary / secondary / danger / icon）、Switch、Select、Slider、TextInput、SegGroup（自 App.tsx 内联迁入归口）、ListRow、Badge、Modal、ConfirmDialog、Toast、EmptyState；PRODUCT.md 组件规范 13 类全落地（分组卡片 `.card` 沿用既有）
- **统一 CSS 类**（renderer.css 组件库段）：`.btn` + `.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn-icon`、`.switch`（`.switch-track`/`.switch-knob`/`.switch-label`）、`.select`、`.slider`、`.input`、`.list-row`、`.modal`/`.modal-panel`、`.confirm-dialog`、`.toast`、`.empty-state`——全部只消费设计令牌，零颜色字面量（theme.spec 全局断言覆盖）
- **界面全量接入**：全部按钮换 Btn 变体（标题页「进入」经 `.title-enter` 修饰类叠加）；卸载 `window.confirm` → ConfirmDialog（文案沿用「卸载 {id}？配置与撤销记忆将保留。」）；动作反馈 → Toast（5s 自动消失、单条覆盖）；「最近错误」卡恒渲染 + 空时 EmptyState、模块列表空态 EmptyState；style-list 行 → ListRow；透明度/模糊度 → Slider（`wallpaper-opacity`/`wallpaper-blur` testid 不变）
- **碎片样式清零**：`.page-actions button`/`.module-actions button`/`.tool-chip button`/`.style-list button`/`.settings-actions button`/`button.danger`/`.settings-range`/`.action-message`/`.side-foot` 全部删除；`window.confirm`/`className="danger"`/`settings-range` 在源码与注释中均清零（components.spec 禁用字面量断言）
- **测试**：单测 components.spec（13 类 CSS 块齐全 + 令牌消费 + 零颜色字面量 + ui.tsx 12 导出 + App.tsx 接入断言）；集成 ui-components.spec 三组断言（卸载确认对话框取消关闭且卡仍在 / OBS 重连 Toast 含动作名 / 最近错误空态在位）——RED 先行后实现转绿；全套 190 单测 + 23 集成全绿

### 决策记录 — T20

- SegGroup 迁入 ui.tsx 归口、App.tsx 内联版整块删除（T16 决策「组件库统一归 T20」兑现）；`seg-*` testid 命名（`${testId}-${v}`）与 active 类落 testid 元素自身的行为不变（既有集成锚点）
- `.title-enter` 保留为修饰类叠加 `.btn`（集成锚点 selector 不破）；ConfirmDialog 替代原生确认框但文案不变、`confirmLabel="卸载"`，onConfirm 先清 pending state 再执行动作（防 React state 快照滞后）
- Toast 单条覆盖（旧 `.action-message` 语义）、5s 自动消失；`bottom: calc(48px + var(--sp-4))` 避让 tool-bar 48px 嵌入契约；`.toast` 亦消费全部 `--mat-*`（theme.spec 组件消费断言）
- Modal 遮罩点击 = 关闭、面板 `stopPropagation` 不冒泡；空列表渲染 EmptyState（最近错误卡改为恒渲染，不再整卡隐藏——集成断言时序安全：OBS 重连不产生错误）；Switch/Select/TextInput 成套在位，实际业务接入留 T21

### Added — T19（2026-09-23）· 主界面布局重写（左 1/4 + 右 3/4）

- **两列布局** `.shell` 改 CSS grid：列 `minmax(0,1fr) minmax(0,3fr)`（≈ 左 1/4 导航区 + 右 3/4 内容区）、行 `minmax(0,1fr) auto`、gap `--sp-4`；`.side`/`.content` 显式占第一行两列，`.tool-bar` `grid-column: 1 / -1` 全宽占底部行
- **左侧导航区** `aside.side`（玻璃面）：`.brand` 纵排（`.brand-mark` + `.brand-name` + `.brand-version`）→ `.side-nav` 功能分组导航（`.nav-group` + `.nav-group-label` + `.nav-item`/`.nav-item.active`）→ `.side-foot` 动作反馈消息；三分组按功能聚合：监控（诊断）/ 扩展（模块）/ 偏好（设置）；入口按钮文本与 `data-testid="tab-settings"` 不变（回归锚点）
- **右侧内容区** `.content` 承载诊断 / 模块 / 设置三页切换（页面内容不动）；`.tool-bar` 保持全宽底部 48px——embedded 网页工具视图内缩契约（`WEB_TOOLBAR_PX`，electron-host bounds）零改动
- **样式**：`.side` 玻璃面消费 `--mat-alpha`/`--mat-blur`/`--mat-shadow-*`，高光/折射静态渐变伪元素选择器组扩展含 `.side`；新增块只用 CSS 变量、零颜色字面量（theme.spec 全局断言覆盖）；清理无引用 `.shell-header`/`.header-right`/`.tabs`/`.tab`
- **测试**：集成 layout-shell 三组断言（几何 1:3 并排 `content.width/side.width ∈ [2.5,3.5]` / `.nav-group` 功能分组且三入口各归属恰一组 / 三页切换内容在 `.content` 内可见且往返稳定）——RED 先行后实现转绿；全套 185 单测 + 22 集成全绿

### 决策记录 — T19

- `.shell` 布局走 grid 显式定位（`.side` col 1 / `.content` col 2 / `.tool-bar` 跨两列 row 2）：底部条条件渲染时空行 auto 高度归零、内容区自然占满；`height: 48px` 是主进程 embedded 内缩契约数值，本次重写明确保持不动
- 导航三分组「监控 / 扩展 / 偏好」按功能聚合既有三页（PRODUCT.md「左侧导航按功能分组」）；页面内部内容与组件样式不动（T20 组件库统一、T21 设置项补全）
- 几何断言只用 `boundingBox()` 相对比较（side/content 相邻、宽度比区间），不依赖视口尺寸——Electron 页 `page.viewportSize()` 返回 null 的 T18 教训沿用

### Added — T18（2026-09-23）· 标题页

- **全屏标题页** `TitleScreen`（`App.tsx`）：`.title-screen` 全屏居中——`.title-mark` 标记 + `APP_NAME` 应用名 + `.title-version`（`formatAppVersion`，`vX.Y.Z`）+ 「进入」按钮（`data-testid="title-enter"`）；进入前主界面不挂载（early return），点击进入后卸载标题页、挂载主界面
- **壁纸层复用**：标题页内嵌 `.wallpaper` 层（根节点三变量全局生效），无图默认纯色回退——壁纸/底图在标题页与主界面观感一致
- **测试缝 `EL_TEST_SKIP_TITLE`**：main `createWindow` 加载 URL 带 `skip-title=1` 查询参数（dev 追加查询串、prod `loadFile({ search })`），渲染层读 `location.search` 直入主界面——零 IPC / 契约变更；19 个既有集成 spec 的 launch env 统一注入该变量
- **样式**：`.title-screen`/`.title-body`/`.title-mark`/`.title-name`/`.title-version`/`.title-enter` 只消费设计令牌（`--acc*`/`--txt-2`/`--r-xl`/`--sp-*`/`--mat-shadow-*`），零颜色字面量（theme.spec 全局断言覆盖）
- **测试**：集成 title-screen 两用例（默认启动全屏标识 + 进入前主界面不挂载 + 点击进入渲染主界面；测试缝直入主界面）——RED 先行后实现转绿；全套 185 单测 + 21 集成全绿

### 决策记录 — T18

- 测试缝走「main 加载查询参数 + 渲染层读 `location.search`」而非 IPC 查询——启动时序确定、零契约变更；`EL_TEST_SKIP_TITLE` 只在 main 读一次，渲染层只见 `skip-title`
- 进入状态不落 config：每次启动展示一次标题页（PRODUCT.md「进入主界面的入口」语义）；进入记忆归后续卡按需求再议
- 集成全屏断言不能用 `page.viewportSize()`（Playwright Electron 页面返回 null）——走 `page.evaluate` 结构化读 `globalThis.innerWidth/innerHeight`（tsconfig.node.json 无 DOM 类型，`globalThis as unknown as {...}` 模式）与 `boundingBox()` 对比

### Added — T17（2026-09-23）· 全局底图（方案 A：eclipse-wallpaper://）

- **取图通道（方案 A）**：`eclipse-wallpaper://local/<name>` 自定义协议——启动早期 `protocol.registerSchemesAsPrivileged`（standard/secure/supportFetchAPI/corsEnabled），`protocol.handle` 接 `serveWallpaper`；只服务 `userData/wallpapers/` 白名单文件名，路径穿越/非法名/缺失一律 404；响应携带 `Access-Control-Allow-Origin`（渲染端 file:// 源 fetch 取图属跨源请求）；CSP `img-src`/`connect-src` 放行 `eclipse-wallpaper:`（否则 fetch 以 TypeError 代答、底图不加载）
- **壁纸存储** `src/main/core/wallpaper.ts`：`createWallpaperStore({ dir, logger })`——`install(sourcePath)`（PNG/JPG/JPEG/WebP 扩展名白名单 + ≤10MB + 复制入 `userData/wallpapers/` + 安全唯一名：safeStem 清洗、撞名随机后缀）、`pathFor(name)`（白名单解析防穿越）、`remove(name)`（幂等）；图片不落 config 目录（配置导出天然只含设置项，符合「不参与配置导出」）
- **core.ui shape v3**：`UiSettings` 增 `wallpaperImage`/`wallpaperFit`/`wallpaperOpacity`/`wallpaperBlur` + `migrateUiSettings` v1/v2→v3 补默认 + validate 区间校验（fit 五枚举、opacity 0–1、blur 0–24、图片名安全）
- **IPC `wallpaper:install`**（无参走 dialog、带 sourcePath 为测试缝）与 **`wallpaper:reset`**（清图 + 复位显示方式/透明度/模糊度 + 删图片文件）；preload `wallpaperInstall()`/`wallpaperReset()`（IPC resolve 前同步应用根节点）
- **底图层 CSS**：`.wallpaper` 全屏底层常驻 `background-color: var(--bg-0)` 纯色回退，图片经 `--wallpaper-url` 叠加；`--wallpaper-opacity`/`--wallpaper-blur` 独立于材质档调节；五种显示方式 `[data-wallpaper-fit='fill|fit|tile|center|stretch']`（填充/适应/平铺/居中/拉伸）；新增块零颜色字面量
- **设置页外观组「全局底图」控件**：选择图片 / 恢复默认（`wallpaper-reset`）/ 显示方式分段（`seg-wallpaper-fit-*`）/ 透明度与模糊度滑杆（`wallpaper-opacity`/`wallpaper-blur`，onChange 先同步写根节点变量再持久化）
- **测试**：单测 wallpaper.spec 22 例 + theme.spec 演进（v3 migrate/validate 全字段夹具）；集成 wallpaper-ui 七组断言（控件渲染 / 默认态 / 安装 / 协议 200+image/png 与穿越拒绝 / fit+滑杆即时生效并持久 / 恢复默认删文件 / 缺失 404+纯色回退）——RED 先行后实现转绿；全套 185 单测 + 19 集成全绿

### 决策记录 — T17

- 取图通道方案 A（自定义协议，不走 file:// 直读）：`protocol.handle` 白名单防穿越；文件名安全唯一名（safeStem 清洗 + 扩展名白名单 + 撞名随机后缀）——与 ARCHITECTURE.md 原「哈希命名、校验魔数」草案不同，以测试与任务卡为准并已回写文档对齐
- 恢复默认 = 清图 + **复位显示方式/透明度/模糊度** + 删图片文件；加载失败/缺失文件回退纯色背景（`.wallpaper` 层 `--bg-0` 恒在图片之下）
- CSS 变量命名 `--wallpaper-url`/`--wallpaper-opacity`/`--wallpaper-blur`，显示方式走 `data-wallpaper-fit` 属性（不设 `--wallpaper-fit` 变量）；层叠关系取 `.wallpaper` 常驻全屏底层 `z-index: -1`、body 渐变不动
- 集成断言竞态对策：`wallpaperInstall`/`wallpaperReset`/`setUiSettings` 在 IPC resolve 前同步完成「配置写入 + preload 应用」；滑杆 onChange 先同步写根节点变量再 onPatch（断言无重试）

### Added — T16（2026-09-22）· 设置框架（6 组分组）

- **设置页**（新增「设置」页签，`data-testid="tab-settings"`）：按规格渲染 6 个分组卡片（`settings-group-<id>`）——外观 / 功能 / 模块 / 连接 / 诊断 / 高级，顺序与 PRODUCT.md 一致；组元数据抽 `src/shared/settingsGroups.ts`（id/title/description，渲染与单测共用）
- **外观组三项实装**（分段选择器 `.seg-group`/`.seg`/`.seg.active`，点击即时生效并持久 core.ui）：主题模式 浅色/深色/跟随系统、强调色 日珥橙/青蓝、材质档位 档 1 纯模糊/档 2 玻璃/档 3 液态玻璃——经既有 `setUiSettings(patch)`（preload 侧 IPC resolve 后同步应用根节点属性），成功后回读同步分段 active 态
- **其余组框架占位**并标注归属卡片：全局底图→T17（`eclipse-wallpaper://` 通道）、检查更新（默认关闭，仅查 GitHub Releases）→T21、降级三开关→T22、高级组三项新功能（配置导入导出 / 缓存清理 / 模块崩溃自动重启）→独立小卡排 UI 卡之后
- **样式**：`.settings-groups`/`.settings-group`/`.settings-row`/`.seg*` 全部只消费设计令牌（`--sp-*`/`--r-md`/`--line`/`--acc`/`--acc-soft`/`--txt-*`），零颜色字面量（theme.spec 全局断言覆盖）
- **测试**：单测 settings.spec 3 例（SETTINGS_GROUPS 6 组 id 序列/唯一性/非空 + CSS 令牌消费正则）；集成 settings-ui（6 组渲染含高级组「独立小卡」标注 + 外观组三设置点击即时生效与持久往返）——RED 先行后实现转绿；全套 161 单测 + 18 集成全绿

### 决策记录 — T16

- 6 组元数据抽 `src/shared/settingsGroups.ts`（不进 contracts——T14 先例，UI 类型归 shared）；占位归属标注留 App.tsx 局部常量（卡片排期语义，非稳定契约）
- 分段选择器为本卡局部组件 `SegGroup`（外观组三处复用），组件库统一归 T20；即时生效沿用 preload「IPC resolve 后同步应用根节点」机制，无新增 IPC 通道、core.ui 契约不变
- 集成断言桥方法名用 `uiSettings`（window.eclipselive 方法名）而非 IPC 通道名——`page.evaluate` 内 `globalThis.eclipselive[...]` 按方法名索引（既有集成测试惯例）

### Added — T15（2026-09-22）· 材质分级三档

- **材质层设计令牌**（`renderer.css`）：`[data-material='1'|'2'|'3']` 三个令牌块，**变量名完全一致、只改变量值**——`--mat-blur` `--mat-alpha` `--mat-highlight` `--mat-refract` `--mat-shadow-1` `--mat-shadow-2`；档 1 纯高斯模糊（blur 14px、alpha 1.0 不透明、高光/折射 none）；档 2 默认半高斯半液态玻璃（blur 18px、alpha 0.8、静态轻渐变高光）；档 3 液态玻璃（blur 26px、alpha 0.65、渐变高光+轻折射，无强折射/强反光）；数值全部落在需求规格区间（blur 12–20/20–32px、alpha 1.0/0.65–0.85/0.5–0.75）
- **玻璃面落地**：`.card` / `.tool-bar`（`color-mix` 半透明底 + `backdrop-filter: blur(var(--mat-blur))` + `--mat-shadow-*` 双层柔和阴影）；高光/折射为静态渐变伪元素（`z-index: -1`——渐变画在底色之上、内容之下，不遮文字；`var(--mat-*')` 取 `none` 时自然不渲染）；组件样式只认 `--mat-*`，不按档写分支规则
- **主题系统演进** `src/shared/theme.ts`：`MaterialTier = 1 | 2 | 3`、`UiSettings.material`（默认档 2）、`validateUiSettings` 校验（1/2/3 之外拒绝）；`core.ui` 分区 version 1 → 2 + `migrateUiSettings`（v1 落盘数据补默认 `material: 2`，config load 路径自动迁移并以新 version 原子持久化）
- **主题引擎同步**：preload `applyUiSettings` + App.tsx 启动应用 `data-material`（与 `data-theme`/`data-accent` 同设根节点，切换立即生效）
- **测试**：theme.spec 升至 19 例（validate material / migrate v1→v2 与 v2 直通 / CSS 三档变量同名集合与数值区间 / 组件消费断言）；集成 `material-wiring` 五断言（默认档 2、切档 1/3 立即生效、往返一致、非法值拒绝且不变）——RED 先行（9 failed）后实现转绿

### Fixed — T15（测试基础设施）

- **集成测试 userData 隔离机制修复**：Windows 下 Electron `userData` 由 Shell Known Folder 解析、**不读 `APPDATA` 环境变量**——原隔离（`APPDATA: iso`）静默失效，全部实例挤占真实 userData 单实例锁，并发跑验证链时 `requestSingleInstanceLock` 失败即 `app.quit()`（17/17 `Target page closed`）。main 增测试专用注入点 `EL_TEST_USERDATA` → `app.setPath('userData', ...)`（单实例守卫之前）；全部 16 个集成 spec 统一改用（原先 9 个完全裸跑），并发互抢与跨用例状态泄漏一并消除

### 决策记录 — T15

- 三档共用同一套变量名、只改变量值（红线）；半透明底用 `color-mix(in srgb, var(--bg-card) calc(var(--mat-alpha) * 100%), transparent)`——主题层色不变，材质档只改 alpha
- 高光/折射伪元素 `z-index: -1`（backdrop-filter 使卡片成为层叠上下文）；令牌块前注释不得含 `data-material` 字面量（CSS 块解析语义——注释会拼进 selector）
- 范围界定：设置切换 UI 归 T16；文字可读性不达标自动降档与降级开关归 T22；失焦不变为静态渐变天然属性（无代码）

### Added — T14（2026-09-22）· M5 UI 重写开篇

- **设计令牌体系**（`renderer.css` 重构）：主题层（`--txt-1/2/3` `--txt-link` `--bg-0` `--bg-card` `--bg-overlay` `--line` `--ok` `--bad` `--warn`）+ 强调色层（`--acc` `--acc-soft` 及派生）+ 尺寸层（`--r-sm/md/lg/xl` = 8/12/16/24px、`--sp-1..7` 4 的倍数 4–48px 递增、`--fs-scale`）；`[data-theme='dark'|'light']`（dark 默认）× `[data-accent='corona-orange'|'cyan-blue']`（corona-orange 默认）四令牌块；**颜色字面量只允许出现在令牌块**（单测断言强制：非令牌块零 `#`/`rgb()`/`hsl()` 字面量），现有组件样式颜色全部迁入变量
- **主题系统** `src/shared/theme.ts`：`ThemeMode`（light/dark/system）、`ResolvedTheme`、`AccentId`、`UiSettings { themeMode, accent }`、`resolveTheme`（system 跟随 OS 外观）、`validateUiSettings`（严格校验——未知键/非法枚举拒绝）；`core.ui` 配置分区（version 1，材质/底图/降级字段后续卡经 migrate 演进）
- **IPC 面 + 主题引擎**：`ui:settings:get` / `ui:settings:set`（patch 先合并再整值 set——适配 IConfig 全量替换语义；校验失败不落盘）+ preload `uiSettings()` / `setUiSettings(patch)`（set 成功后同步应用根节点属性，消除生效竞态）；App.tsx 启动应用 `data-theme`/`data-accent`，system 模式经 `matchMedia('(prefers-color-scheme: dark)')` change 监听实时换值（含清理）
- **测试**：单测 +12（theme.spec：resolveTheme/validateUiSettings/core.ui 分区/CSS 令牌断言）；集成 `theme-wiring` 六断言（启动默认令牌属性、模式/强调色切换立即生效、system 解析、往返一致、非法 patch 拒绝且原值不变）；集成测试 launch 注入临时 userData（`APPDATA`/`XDG_CONFIG_HOME`）保证"启动默认"断言干净且不污染开发配置

### 决策记录 — T14

- UI 类型归 `shared` 不进 contracts（T12 先例——web 程序无 `@contracts` 别名）；preload 经 `@shared/theme` 复用 `resolveTheme` 纯函数与类型
- 本卡无设置切换 UI 入口（T16 设置界面接入）；尺寸字面量全面收敛放 T20（本卡只建令牌层 + 迁移圆角/间距用点）
- `theme-wiring` 的 `page.evaluate` 以 `globalThis` 结构化断言访问 `document`（tsconfig.node 无 DOM 类型的集成测试通用惯例）
- 材质三档（T15）以 `data-material` 同位扩展：三档共用同一套变量名，只改变量值

### Added — T13（2026-09-22）· M4 交付收官

- **electron-builder Windows 安装包**：`npm run dist` → `dist/EclipseLIVE-Setup-<version>.exe`（NSIS x64，本机构建 106.9MB 成功）；appId `live.eclipse.eclipselive`；程序生成图标（`assets/icon.png` 256px + `build/icon.ico` PNG 载荷 ICO）；`files` 白名单（out/assets/node_modules——托盘图标经 asar fs 补丁可读）；`extraResources` 携带 `modules/`；NSIS 允许改安装目录；CN 网络镜像说明（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）
- **预置模块播种** `core/packages.seedPresetModules`：打包版首次启动将 resources/modules 复制到 userData/modules（目标非空跳过——用户数据优先；源缺失 no-op）——"恢复预置模块"的数据面；用户清空 modules 目录可重新触发
- **交付物补齐**（需求第 175 行清单）：`templates/module-pack/example-empty.elm`（按 T7 pack 语义程序生成：module.json + sha256）、`templates/config/default.json`（配置导出信封示例）
- **总验收**：需求"第一步完成标准"十一项全部落地（自动化 139 单测 + 15 集成测试覆盖；OBS 真实互通/网页工具联网加载/托盘交互留真机清单）

### 决策记录 — T13

- **无代码签名**（无证书）：安装时 SmartScreen 提示为预期行为，如实文档；自动更新不做（红线：不做自建更新服务）
- 播种语义保守（仅空目录播种）；dist/ 不入库（.gitignore 已有）
- 安装包不含 templates/tests/源码（files 白名单）；example 模块经 extraResources 随包分发

### Added — T12（2026-09-22）

- **生命周期收尾**：托盘（程序生成的 `assets/tray.png` + 菜单"显示主窗口/退出"；点击恢复）；关闭到托盘（`lifecycle.closeToTray` 默认 true——close 拦截隐藏）；`before-quit` 显式退出语义；`window-all-closed` 仅非托盘模式退出
- **诊断聚合 `core/diagnostics`**：`collectDiagnostics`（全服务只读快照：app/网关——**token 只显示存在性**/模块（名称、版本、权限、web 标记）/权限/OBS/网页工具/网络/样式已应用/凭据元数据/配置摘要）+ `buildDiagnosticBundle`（快照 + 当日日志尾部 200 行）——"一键导出诊断包"数据源
- **渲染层管理界面**（React，CSS 变量令牌延续）：页签（诊断/模块）+ 2s 自动刷新 + 操作即刷新；诊断页（网关/OBS/模块/网页工具与网络/凭据与配置/最近错误 + 导出诊断包 + OBS 重连）；模块管理页（模块卡：状态徽章/权限芯片/网页工具 URL 与开闭/启用禁用/卸载确认/从文件安装 .elm/样式包导入与按已应用导出）；网页工具底部工具条（48px——embedded 视图经 host 底部内缩让出，resize 重排）
- **IPC 面**（preload 受限桥 + ipcMain.handle，动作统一 `{ ok, errors }`）：app:diagnostics、module:enable/disable/uninstall、package:install（对话框 + 安装即加载启动）、style:import/export、webtool:open/close、obs:reconnect、diagnostics:export（保存对话框）
- UI 级集成测试：UI 外壳（页签/IPC 快照/诊断页元素）、模块页交互（禁用→disabled→启用→discovered、网页工具按钮）、关闭到托盘（窗口隐藏、进程存活、可显式退出）；app-launch 断言更新到新 UI

### Changed — T12（契约演进）

- `IConfig` 新增 `sections(): Array<{ id, version }>`（配置摘要——无分区数据）
- `src/shared/diagnostics.ts` 新增渲染层快照 DTO（web 程序无 @contracts 别名——UI 类型归 shared，维持 T1 程序边界）

### 决策记录 — T12

- 红线延续：token 值、凭据值、配置分区数据、完整日志都不经 IPC——只有元数据与聚合计数；诊断包为本地文件（用户选路径）
- 单测数字如实：config +1（sections 并例断言）+ diagnostics 5 = 136 例；集成 15/15
- embedded 视图内缩/resize 重排无自动化断言（依赖真机窗口尺寸）——代码评审 + 真机验收；网页工具"打开"的联网加载行为同样留真机验收（CI 网络不稳）
- 模块管理页卸载在集成测试中不点击（会删除仓库示例模块）——卸载语义由 packages 单测覆盖

### Added — T11（2026-09-22）

- 核心网页工具容器 `core/webtools`（M3 收官）：第三方网页工具以**声明式模块**存在——manifest `web` 字段（url/allowedDomains/partition?/windowMode/pinned/icon?），**无 entry/routes/events/channels**（无业务代码），与普通模块同等启停/禁用/卸载
- **注入式 host**：核心服务零 Electron 依赖（单测注入 fake host）；组装根用 `electron-host`（Electron WebContentsView——不用 iframe：sandbox 开、nodeIntegration 关、contextIsolation 开、**无 preload**——内嵌页默认无 Node/文件/核心访问）
- 会话隔离：每工具独立 `persist:webtool-<partition ?? moduleId>` 持久会话（登录态保持、互相隔离）；embedded 模式挂主窗口内容区 / window 模式独立 BrowserWindow
- **默认拒绝四闸门**（全部计数入诊断，T12 在此之上加用户确认授予流）：导航仅放行 allowedDomains origin（`isNavigationAllowed` 纯策略：http(s) + origin 精确匹配）；新窗口 deny；下载 preventDefault；权限请求拒绝
- 诊断：工具数/打开数/拒绝计数/最近拒绝环（20 条）——T12 诊断页"网页工具状态"数据源
- `contracts/webtools.ts`：`WebToolDeclaration` / `WebToolWindowMode` / `isNavigationAllowed` / `WebToolViewSpec·View·Host` / `WebToolStatus` / `IWebTools` 进入 contracts
- 预置 `modules/example-web/`（声明式参考网页工具，example.com）+ main 接线（webtools ready 日志；启动不自动打开任何视图——T12 UI 决定）

### Changed — T11（契约演进）

- `ModuleManifest` 新增可选 `web?: WebToolDeclaration`；web 存在时 **entry 变为可选**（加载即注册，无入口导入），管理器状态机与普通模块一致（discover→loaded→started/stopped/disabled/unload）

### 决策记录 — T11

- URL origin 省略默认端口（`https://a.example:443` 与 `https://a.example` 同源）——WHATWG 标准行为，测试断言如实修正
- "用户确认后授予"的交互流归 T12（本卡默认拒绝 + onDenied 钩子已就位）；"第三方服务不受控"提示文案归 T12 UI
- embedded 模式布局为整内容区（T12 侧边栏/分区细化）；session 级 permission/download 处理器挂 partition 会话（同 partition 工具共享策略——默认拒绝一致）
- 网页工具像普通模块一样声明权限（如 `network-access`）；样式包模板同理无特权

### Added — T10（2026-09-22）

- 核心样式包服务 `core/styles`（M3 表现层开篇）：`.elstyle` 统一包格式（envelope：type=`eclipse-style`/moduleId/styleType/version/createdAt/coreVersion/payload），**内容嗅探**双形态（PK 魔数→ZIP 含 style.json+CSS/图片/字体；否则纯 JSON）
- 导入链路：顶层校验（type/kebab/版本/coreVersion）→ **敏感键深扫拒绝**（password/token/secret 等 12 类归一化匹配——敏感信息不导入）→ cssVars 值禁 `<`/`>`（防样式标签逃逸）→ 处理器查找（模块须已加载）→ 版本检查（旧版本须有迁移器、新版本拒绝——与配置中心同策）→ 模块 validate → **快照回滚式应用**（config 分区+applied 记录先快照、失败恢复；资源 `.staging-` 原子换入）→ 默认 apply=写模块配置分区（onChange 热更新即"重新渲染"）+ cssVars 持久化 `core.styles` + 总线 `styles:applied` 事件
- ZIP 安全红线：zip-slip 防护（`..`/绝对路径/盘符拒绝）、扩展名白名单（css/png/jpg/jpeg/webp/gif/woff/woff2/ttf/otf）、单文件 5MB 与总量 50MB 上限（可注入）、CSS 禁 `@import` 与带 scheme 的 `url(...)`（无远程引用）；**禁止执行脚本**（纯 JSON 数据，结构性保证）
- 导出：默认读模块配置分区（或自定义 export handler）→ envelope；模块样式资源目录存在时打包 ZIP（style.json+文件），否则 JSON
- `contracts/styles.ts`：`STYLE_PACK_TYPE` / `StylePackEnvelope` / `StylePayload` / `StyleHandler`（version/validate/migrate/apply/export）/ `ModuleStyles` / `AppliedStyle` / `IStylePacks` 进入 contracts
- 预置 `templates/style-pack/default.elstyle`（交付物清单要求的样式包模板）+ `example-empty` 注册参考样式类型 `theme`（模板可导入的端到端证明，仍零业务）
- 主进程接线：styles 服务先于模块管理器创建并传入（`ctx.styles` 门面），`styles ready` 日志

### Changed — T10（契约演进）

- `ModuleContext` 新增可选 `styles?: ModuleStyles` 门面（作用域化：moduleId 强制归属；模块 unload 时注销其全部样式处理器——旧代码不得再应用样式）

### 决策记录 — T10

- 需求 schema/默认值概念映射：schema→validate 函数、默认值→模块配置声明（避免双轨）；模块不得自行实现文件选择、解压、配置写入和回滚——全部核心代劳
- 回滚边界（如实）：config 分区与 applied 记录快照恢复、staging 资源删除；**自定义 apply 的其它副作用由处理器自行负责**
- CSS 选择器级作用域隔离归渲染层；核心做"无远程引用/无 @import/值无尖括号"红线（如实文档）
- 版本策略与配置中心一致（不支持降级迁移）；overlay 消费面（cssVars 网关路由/渲染注入）归 T11/T12 按需

### Added — T9（2026-09-22）

- 安全凭据存储 `core/credentials`（M2 收尾）：通用加密键值对——未来云 token / API key 的唯一归宿；**注入式 cipher**（核心零 Electron 依赖可测，单测注入 AES-256-GCM；组装根用 `electron-cipher`：safeStorage → Windows DPAPI / macOS Keychain / Linux libsecret）
- 密文先于落盘：`userData/credentials/credentials.json`（version + entries），原子写 tmp+rename、写入串行队列；损坏文件 `.bak` 备份后空库重建；解密失败 `get` 返回 null 不抛出；`list()` 仅元数据（key/weak/updatedAt）
- 统一网络客户端 `core/network`：接口 + **本地空实现**——所有对外请求一律 reject（local-first 红线信息）+ 拒绝计数诊断（T12"网络状态"数据源）；接真实端点需核心变更 + 用户显式同意，不可能被模块意外触发
- `contracts/credentials.ts`（`CredentialRecord` / `ICredentialStore`）与 `contracts/network.ts`（`NetworkRequestOptions` / `NetworkResponse` / `NetworkDiagnostics` / `INetworkClient`）进入 contracts
- **T8 承诺兑现**：OBS 密码优先读凭据库（`obs:password` 胜过 `core.obs.password` 配置明文；未传凭据库时行为不变，向后兼容）
- 主进程接线：`credentials ready`（含 **roundtrip 探针**——真机验证本环境 safeStorage 加解密可用）+ `network client ready` 日志

### 决策记录 — T9

- 需求第 12 节五项对照：统一网络客户端与安全凭据存储本卡补齐；配置版本号与修改时间（T2 已记录 version/updatedAt）、本地用户 ID（T3 事件信封已预留、默认匿名）、网络访问权限（T4 闭集 `network-access` 已可声明/授予/撤销）——前卡已满足，仅核对
- OS 加密不可用时回退明文并如实标记 `weak`（Windows DPAPI 恒可用，回退防备异常环境）——绝不静默降级
- 明文与密文都不落日志（仅键名与元数据）；网络拒绝信息不含 URL（防模块误把 token 拼进 URL 泄漏到诊断/日志）
- 模块侧 `ctx.network` 门面随未来真实云需求再立卡（YAGNI）；届时接 `network-access` 权限闸门

### Added — T8（2026-09-22）

- 核心 OBS 桥接 `core/obs`：obs-websocket v5 **出站客户端**（只连接不占用——网关仍是唯一监听面），默认 4455（`core.obs.port` 可配）
- v5 握手：Hello → Identify（rpcVersion 1 + eventSubscriptions）→ Identified，含 challenge/salt SHA-256 密码认证；op5 事件转发为内部总线 `obs:<eventType>`（source=obs）
- 请求语义分离：传输层失败（未连接/断线/超时）reject；OBS 业务失败 resolve `ok:false` + 原始状态——`send()` 覆盖场景/源/滤镜/音量/转场/录制/推流读写
- 断线指数退避自动重连（1s→30s，成功归零；`disconnect()` 停止 / `reconnect()` 重置）；`connect()` **永不抛错不阻塞启动**，OBS 未运行落诊断信息
- 浏览器源绑定（`core.obs.bindings` 持久化）：连接成功与 `gateway:port-changed`（消费 T5 事件）时同步——URL 取自网关生成器（**token 自动注入、绝不写日志**）；已存在则 SetInputSettings 更新（overlay 合并、仅 URL 变化时）、缺失则建于当前节目场景（browser_source）
- `contracts/obs.ts`：`ObsConnectionStatus` / `ObsBrowserSourceBinding/Status` / `ObsDiagnostics` / `ObsRequestResult` / `IObsBridge` 进入 contracts
- 主进程接线：packages ready 后 `void obs.connect()` + obs bridge ready 日志（不阻塞）

### 决策记录 — T8

- 单测以模拟 v5 服务验证协议（CI 无真实 OBS）；**真实互通留待用户验收**，事件订阅掩码默认 65535 全量、可经配置调整
- 集成测试只断言不阻塞与端口，不断言连接状态——开发机可能正运行 OBS（4455 有服务）
- `send()` 语义分离（transport reject vs 业务 resolve）——消费方可按错误类型分流重试
- 密码为本地配置明文（`core.obs.password`）——T9 凭据存储升级，如实记录
- 模块侧 obs 门面（`ctx.obs`）未提供——等真实模块需要时立 SDK 卡（YAGNI）；CreateInput 固定 800×600（OBS 内可调，同步只覆盖 URL）

### Added — T7（2026-09-22）

- 核心 `.elm` 模块包服务 `core/packages`：`pack`（模块目录 → ZIP，manifest.json → module.json 映射 + sha256=入口文件摘要 + format/coreVersion/license）、`inspect`（不落盘预检，T12 确认流数据源）、`install`（六项校验 + `.staging-` 原子换入）、`uninstall`（**保留配置/权限撤销记忆/禁用状态**）、`watch`（`fs.watch recursive` + 400ms 防抖：新/变更 .elm 自动安装并加载启动；模块目录消失自动卸载）
- `contracts/packages.ts`：`ELM_FORMAT_VERSION` / `ElmPackageInfo`（`signed: false` 如实上报）/ `PackOptions/PackResult` / `InspectResult` / `InstallOptions/InstallResult` / `IModulePackages` 进入 contracts
- 安装六项校验：id（目录名不变量，复用 T6 `validateManifest`——自 `core/modules` 导出共享）、版本（**降级拒绝**，`force` 旁路）、coreVersion（`'*'` 或 `'>=x.y.z'` 对 app 版本按段比较）、权限闭集、SHA-256 入口摘要、zip-slip 防护（`..` / 绝对路径 / 盘符条目拒绝 + resolve 双重包含检查）
- `adm-zip` 成为第二个运行时依赖（纯 JS ZIP 读写，MIT；+ `@types/adm-zip`）
- 主进程接线：modules ready 后 `packages.watch()` + `packages ready` 日志

### 决策记录 — T7

- module.json（包内，需求命名）↔ manifest.json（模块目录，T6 不变量）单向映射：包级字段（format/sha256/coreVersion/license）不进入 manifest.json
- **adm-zip 写入侧会净化恶意条目名**（`'../evil.js'`→`'evil.js'`、`'/abs/x'`→`'abs/x'`）——单测以手工原始 ZIP 字节构造真实攻击样本验证安装侧防御（真实 zip-slip 攻击来自其它压缩工具，防御面向读取侧）
- 目录监听路径自动安装无需确认：能写 modules 目录者已具备本机代码执行能力（威胁模型如实）；未签名模块风险确认弹窗归 T12 文件选择路径
- 升级已加载模块走 unload→install→load→start；新代码实例受 import 缓存限制需重启应用生效（同 T6 逻辑卸载边界，文档如实）
- watcher 对写入中的 .elm 可能安装失败并记录 mtime 不再重试（需文件再次变更触发）；文件选择路径无此问题
- 逐文件完整性（资源哈希）留待按需扩展；当前 sha256 仅覆盖入口（被执行代码）

### Added — T6（2026-09-22）

- 核心模块管理器 `core/modules`（M1 收尾）：发现/加载/启动/停止/重启/逻辑卸载全生命周期 + 崩溃隔离（import/init 抛错 → failed 并回滚半程注册；start 抛错 → failed；stop 抛错仅告警；绝不波及核心与同侪模块）
- `contracts/module.ts`：`ModuleManifest`（id/名称/版本/作者/权限声明/依赖/入口/配置声明/事件声明/路由声明/频道声明）、`IModule`（init/start/stop 全可选）、`ModuleContext`（logger/config/bus/gateway/permissions 全作用域化门面）、`IModuleManager`（discover/load/unload/start/stop/restart/disable/enable/startAll）进入 contracts
- 所有权强制（T5 网关注册面的清单闸门）：路由/频道/事件均为清单闭集，未声明一律抛错拒绝；事件发布 **source 强制为模块 id**（伪装无效）；config/权限访问绑定本模块分区
- 依赖检查：`{id, version?}` 最低版本按段数值比较；未加载/版本不足/未知依赖拒绝加载；`startAll` DFS 拓扑序 + 依赖环检测（环上模块 failed 且不阻塞他人）
- 禁用/启用：`core.modules.disabled` 持久化；disable 即停机卸载；load 对 disabled 拒绝
- 清单校验：目录名必须等于 manifest.id、id kebab-case、版本 x.y.z、权限闭集、entry 不得逃逸模块目录、路由/频道/事件/配置声明形状；无清单/损坏清单目录标记 invalid（可见可修）
- 预置 `modules/example-empty/`（参考空模块，随 startAll 启动）与 `templates/module/`（新建模块模板）
- 主进程接线：permissions → gateway → modules 链式就绪，`modules ready` 日志（discovered/started/failed 数量）

### 决策记录 — T6

- **逻辑卸载边界如实**：卸载注销路由/频道/订阅/权限声明（撤销记忆按权限契约保留——重装不得静默复权），但 config 分区注册表与权限撤销记忆驻留至应用重启（契约行为），ESM import 缓存使入口实例内存回收需重启——不做虚假承诺
- 目录名=manifest.id 强制（T7 .elm 安装的先决不变量）；点/下划线开头目录跳过
- restart 复用同一入口实例重新 init（import 缓存现实），全新实例需重启应用
- manifest 配置声明仅 defaults+version（JSON 不可携带校验函数，代码侧声明留待模块 SDK 卡）；manager 自身不发状态事件（T12 诊断页按需）
- 入口同时支持 CJS `module.exports` 与 ESM `export default`（Node 互操作均落 `.default`）

### Added — T5（2026-09-22）

- 核心本地服务网关 `core/gateway`：全软件唯一网络面（127.0.0.1 + 动态端口），HTTP + 单一 WS 端点双协议，`ws` 成为首个真正使用的运行时依赖
- 端口策略：读配置上次端口（`core.gateway.port`，默认 27900）→ 被占回退系统随机 → 实际端口持久化并广播 `gateway:port-changed`（T8 据此更新 OBS 浏览器源 URL）
- token 闸门：每次启动随机 48 hex，不持久化、**不写日志、URL 结果只传不记**；HTTP（query/Bearer）与 WS 升级全量校验，无 token 一律拒绝
- 频道多路复用：单一 `/ws` 端点 `{channel, payload}` 信封，仅已注册频道可收发；广播面向全体客户端
- 故障隔离：路由/频道 handler 抛错 → 错误环（20 条）+ 日志 + 500/忽略，绝不拖垮网关；错误环进入诊断
- `contracts/gateway.ts`：`HttpMethod/GatewayRequest/GatewayResponse/RouteHandler/WebSocketChannelHandler/GatewayDiagnostics/IGateway` 进入 contracts
- 内置 `GET /diagnostics`（token 保护）：端口/token 状态/路由/频道/WS 连接数/最近错误
- URL 生成器：`getBrowserSourceUrl`/`getRouteUrl`/`getWebSocketUrl`（启动前 null，token 自动注入）
- 主进程接线：gateway ready 日志（端口 + URL 可用性布尔，**不记 token**）

### 决策记录 — T5

- 广播仅限已注册频道（模块所有权前置），未注册频道的收发被拒绝并告警
- 路由/频道重复注册=替换并告警（支持模块热重载），所有权强制归 T6 清单
- token 走 URL query：OBS 浏览器源最兼容；本机回环 + 单用户场景可接受，更复杂方案留待局域网需求（须用户显式开启）
- CORS 全放开 + OPTIONS 处理：OBS CEF 来源多变，本地回环无暴露面
- 双网关测试的端口持久化竞态属测试时序问题（异步写盘 vs 立即重启），产品路径无此场景——测试中以 flush 显式落盘

### Added — T4（2026-09-22）

- 核心权限服务 `core/permissions`：闭集目录（8 类，未知字符串声明层拒绝）、声明登记、`check` 运行时闸门、撤销/授予即时生效并持久化（经配置中心 `core.permissions` 分区）、**撤销记忆跨卸载/重装保留**、垃圾配置权限名运行时收敛
- `contracts/permission.ts`：`PermissionType` / `PERMISSION_TYPES` / `isPermissionType` / `IPermission` 进入 contracts
- **防提权**：同一模块重复声明仅允许完全相同集合，变更一律拒绝（须走重装流程）
- 主进程接线：lifecycle 演示声明 `obs-control`，写 `permissions ready` 日志（异步工厂）

### Changed — T4（契约演进）

- `IConfig` 新增 `ready(): Promise<void>`（所有已注册分区加载完成）：由权限系统初始化需求驱动——持久化撤销必须先于任何声明加载，消灭"已撤销权限在启动窗口放行"的竞态

### Added — T3（2026-09-22）

- 核心事件总线 `core/bus`：标准信封（type/source/time/version/payload?/userId?）、同步派发（注册序+快照语义）、异步派发（微任务 FIFO、可 await）、`once` 一次性订阅（抛错也只消耗一次）、订阅者错误隔离（记 error 日志，绝不波及发布者与同侪）
- `contracts/event.ts`：`CoreEvent` / `IEventBus` / `PublishOptions` 进入 contracts
- 主进程接线：`lifecycle:started` 事件经总线订阅→发布往返写日志（source=lifecycle）

### Fixed — T3

- 接线遗漏：`lifecycle:started` 发布时未声明 `source: 'lifecycle'`（默认 core），由集成测试往返断言抓出

### 决策记录 — T3

- userId 仅预留字段（bus 级默认 + 单次覆盖），不生成 ID——匿名即缺省，账号体系属未来任务卡
- 同函数重复订阅按一次处理（Set 语义，防重复注册事故）
- 事件声明清单校验归 T6 模块清单；通配符订阅推迟到 T12 诊断页按需评估
- 审批服务超时导致的一次后台验证被拒 → 全流程改为分步前台执行，验证链路不变

### Added — T2（2026-09-22）

- 核心配置中心 `core/config`：按模块 id 分区（原子写 tmp+rename）、声明式结构（defaults+version+validate+migrate）、读取即深合并副本、版本迁移前自动备份 `.bak`、损坏文件回落默认且原样保留、多预设（增删列应用，应用强制走校验）、统一导出信封 + 两阶段原子导入
- `contracts/config.ts`：`IConfig` / `ConfigDefinition` / `ValidationResult` / `ImportResult` 进入 contracts
- 热更新：`onChange` 订阅合并值变更；同 id 重复注册忽略并告警
- 主进程接线：`lifecycle` 示例分区（`closeToTray`），启动写 `config ready` 日志

### 决策记录 — T2

- 校验失败三不（不落盘/不通知/不改缓存）；导入任一注册分区失败整体拒绝，未注册 id 进 skipped 不致命
- 无迁移器的旧版本数据按"保留原始数据"处理（宁可告警不丢配置）
- 预设加载完成后内存操作同步、落盘异步（`savePreset` 立即可见于 `listPresets`）
- 导入更新版本（> 当前定义）拒绝——不支持降级迁移

### Added — T1（2026-09-22）

- 核心日志服务 `core/logger`：四级输出、强制脱敏管道（敏感键 + 用户输入键 text/content/body）、按日轮转、14 天保留期清理、写失败永不崩溃
- `contracts/logger.ts`：contracts 层第一个标准接口 `ILogger`（模块依赖的最小面）
- 主进程接线：启动即写 `[lifecycle] app starting` 至 `userData/logs/eclipselive-YYYY-MM-DD.log`（dev 级别 debug，打包后 info）

### Fixed — T1

- tsconfig 程序边界：`tests/unit` 归 node 程序；web 程序只含渲染层 + 共享层（此前主进程单测被拉入 web 检查而 web 无 `@contracts` 映射导致失败）

### 决策记录 — T1

- 根 logger 的 child 使用裸来源（如 `gateway`），仅根自身记为 `core`；嵌套 child 以 `:` 追加（`gateway:ws`），与契约 TSDoc 一致
- 脱敏在序列化前强制执行；深度上限 4、字符串上限 200，防日志炸弹

### Added — T0（2026-09-22）

- 仓库重组：打字机原型移入 `prototype/`（回归通过），主项目占据根目录
- Electron + TypeScript + electron-vite + React 脚手架（`npm run dev` 可启动空壳）
- 受限 preload 桥（contextIsolation，仅暴露只读 `app:info`）
- 测试基建：vitest 单测管道 + Playwright `_electron` 集成管道（均绿）
- 文档骨架：README / PRODUCT / ARCHITECTURE（含数据分类表）/ AI_RULES / CONTRIBUTING / TASKS
- 极简单实例保护（`requestSingleInstanceLock`，完整生命周期由 T12 完成）

### 决策记录

- 技术栈：Electron 44 + TS strict + electron-vite + React 18+ + CSS 变量
- 运行时依赖仅 `ws`（网关 WebSocket 用，MIT）；`@vitejs/plugin-react` 锁 4.x（electron-vite 5 尚不支持 vite 8）
- 渲染层即"第一个接口消费者"，用于验证 contracts 设计
- Electron 44 包不再自动执行 postinstall：本地二进制需 `node node_modules/electron/install.js`（配 ELECTRON_MIRROR 镜像）
- 集成测试强制使用项目本地 electron 二进制并以 `electron .` 启动（生产路径，版本号正确，且规避 Playwright 在 CN 网络下载自家构建）
