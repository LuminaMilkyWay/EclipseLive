import { BrowserWindow, WebContentsView, session } from 'electron'
import type { ILogger } from '@contracts/logger'
import type { WebToolHost, WebToolUiTokens, WebToolView, WebToolViewSpec } from '@contracts/webtools'

/**
 * T33: build the JS that injects host design tokens as `:root` CSS custom
 * properties on a module page. Pure + unit-tested (no Electron needed).
 * JSON.stringify escapes quotes/newlines; keys/values are already sanitized
 * by the service (sanitizeUiTokens) — keys are `--`-prefixed, values are
 * free of `;{}` — so the injected text can never escape the token block.
 */
export function buildUiTokenScript(tokens: WebToolUiTokens): string {
  const lines = Object.entries(tokens)
    .map(([key, value]) => {
      const k = JSON.stringify(key)
      const v = JSON.stringify(value)
      return `document.documentElement.style.setProperty(${k}, ${v});`
    })
    .join('\n')
  return lines
}

/** 父窗口候选的最小形态（duck typing——装配层传 BrowserWindow，测试传字面量）。 */
export interface WebToolParentCandidate {
  isOverlayWindow: boolean
}

/**
 * **原生外观框架**：允许注入"根元素圆角 + 透明底"的**站点白名单**（用户口径 ①：站点级，不是全局）。
 *
 * 背景与边界（用户已拍板）：
 * - 嵌入视图本身早已透明（见下方 `setBackgroundColor('#00000000')`），但第三方页面会自己铺一张
 *   **不透明矩形底**盖满视图盒 ⇒ 四角是尖的，看上去像"矩形纸贴在圆角玻璃面板上"；
 * - DOM 遮罩**技术上盖不住** `WebContentsView`（原生视图，不在渲染层合成栈里），Electron 也没有
 *   视图圆角 API ⇒ 唯一"不折损显示面积"的做法是**让 guest 的根元素自己圆角并透明**，由宿主槽位
 *   （.tool-slot / .module-page-host）的玻璃与圆角透出；
 * - 这会触及第三方页面的**根样式** ⇒ 按 `MODULE_UI_CONTRACT` §0/§4"不改站内 UI"的边界，
 *   **只对本白名单内的站点**生效（当前仅我们自有/合作站点），其余工具一律保持原样。
 */
export const NATIVE_FRAME_HOSTS: readonly string[] = ['chat.laplace.live']

/**
 * 注入到 guest **根元素**的样式（**用户口径：只裁剪一个与 UI 对应的圆角**）：
 * 只做「根元素圆角裁切」这一件事 —— 圆角值取宿主设计令牌 `--r-lg`(16px) 的同名镜像
 *（`--el-native-frame-radius`，默认 16px），**不改背景、不改颜色**（曾试过 `background: transparent`，
 * 属于多余动作且引入风险，已按用户要求删除）。
 * 明确**不含**任何颜色/灰层（`AI_RULES` 第 24 条红线）；不碰字号、间距、控件与任何站内结构。
 * 机械守卫：`tests/unit/webtools-native-frame.spec.ts`。
 */
export const NATIVE_FRAME_CSS =
  'html{border-radius:var(--el-native-frame-radius,16px)!important;overflow:hidden!important}' 

/**
 * 是否对该 URL 注入原生外观框架（**纯函数**，便于单测）。
 * 只做**主机名精确匹配**：不做子域通配、不看协议、非法 URL 一律不注入。
 */
export function shouldInjectNativeFrame(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return NATIVE_FRAME_HOSTS.includes(host)
  } catch {
    return false
  }
}

/**
 * 嵌入式视图父窗口选择（装配层注入 getParentWindow 时用）。
 *
 * 回归根因：此前直接取 `BrowserWindow.getAllWindows()[0]`——打字机模块（prologue-live）
 * 等启动期创建的 overlay 悬浮窗与主窗竞态创建，悬浮窗可能排到列表首位，导致第三方
 * 工具（laplacelive-link）的 WebContentsView 误挂到悬浮窗上（视窗"绑定到悬浮窗"，
 * 且无边框大窗遮住底部任务栏一半）。规则：显式主窗引用优先；退化时选列表第一个
 * 非悬浮窗；全是悬浮窗则返回 null（视图不挂任何窗口，宁缺勿错）。
 */
export function pickParentWindow<T extends object>(
  all: readonly T[],
  mainWindow: T | null | undefined
): T | null {
  const isOverlay = (w: T | null | undefined): boolean =>
    (w as { isOverlayWindow?: unknown }).isOverlayWindow === true
  if (mainWindow && !isOverlay(mainWindow)) return mainWindow
  return all.find((w) => !isOverlay(w)) ?? null
}

/**
 * Electron WebContentsView host (assembly-root use only; unit tests inject
 * a fake host so the core service stays Electron-free).
 *
 * - One WebContentsView per open tool — never an iframe.
 * - `session.fromPartition(spec.partition)` gives each tool its own
 *   persistent session (login state kept, isolated).
 * - Default deny: permission requests and downloads are rejected, new
 *   windows are suppressed, navigation goes through the spec policy.
 * - webPreferences: sandbox on, nodeIntegration off, contextIsolation on,
 *   NO preload — embedded pages get no Node.js / file / core access.
 *   A limited preload API would be an explicit future addition.
 * - Embedded views keep a bottom inset (the renderer's web tool toolbar)
 *   and re-apply bounds on window resize.
 */
export function createElectronWebToolHost(
  getParentWindow: () => BrowserWindow | null,
  getBottomInset: () => number = () => 0,
  logger?: ILogger
): WebToolHost {
  const log = logger?.child('webtool-host')
  return {
    createView(spec: WebToolViewSpec): WebToolView {
      const ses = session.fromPartition(spec.partition)

      // Permission requests: deny by default (T12 adds user-granted flow).
      // T29 exception: the module's OWN gateway page (selfOrigin) gets
      // clipboard-SANITIZED-WRITE (copy-to-clipboard buttons work; reading
      // the clipboard stays denied). Third-party tools have no selfOrigin.
      ses.setPermissionRequestHandler((wc, permission, callback) => {
        if (
          spec.selfOrigin !== null &&
          permission === 'clipboard-sanitized-write'
        ) {
          try {
            if (new URL(wc.getURL()).origin === spec.selfOrigin) {
              callback(true)
              return
          }
          } catch {
            /* not a URL yet — fall through to denial */
          }
        }
        spec.onDenied('permission', permission)
        callback(false)
      })
      // Downloads: denied by default.
      ses.on('will-download', (event) => {
        event.preventDefault()
        spec.onDenied('download', 'download')
      })

      const view = new WebContentsView({
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
          // no preload: 内嵌网页默认无核心调用（有限 API 属未来显式暴露）
        }
      })
      const wc = view.webContents

      // T34: 内嵌视图背景透明——模块页 body 为 transparent，材质底由宿主槽位
      // (.module-page-host / .tool-slot) 透出（"以三级材质为底"）；不透明白底会
      // 让透明页面显示为一块白矩形。第三方工具自身画背景，透明设置无影响。
      view.setBackgroundColor('#00000000')

      // T33: host design tokens injected as :root custom properties on every
      // finished load of THIS view (in-place reloads rebuild the document).
      // Host-controlled one-way push — module pages consume, never define.
      let lastTokens: WebToolUiTokens | null = null
      // 原生外观框架：按文档生命周期**每份文档注入一次**（新文档先移除上一次的键 ⇒ 幂等、不叠加）。
      let nativeFrameKey: string | null = null
      wc.on('did-start-navigation', (event) => {
        if (!event.isMainFrame) return
        if (nativeFrameKey === null) return
        const key = nativeFrameKey
        nativeFrameKey = null
        try {
          wc.removeInsertedCSS(key)
        } catch {
          /* 上一份文档已销毁 —— 无需处理 */
        }
      })
      wc.on('did-finish-load', () => {
        // 仅白名单站点注入（用户口径①：站点级，不是全局；边界见 NATIVE_FRAME_HOSTS 注释）。
        if (nativeFrameKey === null && shouldInjectNativeFrame(wc.getURL())) {
          try {
            void wc.insertCSS(NATIVE_FRAME_CSS).then((key) => {
              nativeFrameKey = key
            })
          } catch {
            /* 注入失败 ⇒ 保持普通矩形表现，不影响功能 */
          }
        }
        if (!lastTokens) return
        try {
          wc.executeJavaScript(buildUiTokenScript(lastTokens))
        } catch {
          /* page navigated away — next load re-injects */
        }
      })

      // New windows: suppressed (deny).
      wc.setWindowOpenHandler(({ url }) => {
        spec.onDenied('new-window', url)
        return { action: 'deny' }
      })
      // In-page navigation: gated by the service policy.
      wc.on('will-navigate', (event, url) => {
        if (!spec.allowNavigation(url)) event.preventDefault()
      })

      let hostWindow: BrowserWindow | null = null
      // T30: once the service drives a custom rect (T31 slot), the window
      // resize auto-fit must stop overriding it — compatibility full-area
      // fitting only applies until the first setBounds call.
      let rectDriven = false
      const applyBounds = (): void => {
        if (rectDriven) return
        const parent = getParentWindow()
        if (!parent) return
        const b = parent.getContentBounds()
        view.setBounds({
          x: 0,
          y: 0,
          width: b.width,
          height: Math.max(b.height - getBottomInset(), 0)
        })
      }

      if (spec.windowMode === 'window') {
        hostWindow = new BrowserWindow({
          width: 1120,
          height: 720,
          title: spec.moduleId,
          autoHideMenuBar: true
        })
        hostWindow.contentView.addChildView(view)
        view.setBounds({ x: 0, y: 0, width: 1120, height: 720 })
        hostWindow.on('closed', () => {
          hostWindow = null
        })
      } else {
        const parent = getParentWindow()
        if (parent) {
          parent.contentView.addChildView(view)
          applyBounds()
          parent.on('resize', applyBounds)
        }
      }

      return {
        load: async () => {
          await wc.loadURL(spec.url)
        },
        loadUrl: async (url: string) => {
          // T29: module page reload — the service re-resolves the gateway
          // URL (fresh port/token) before calling this.
          await wc.loadURL(url)
        },
        setBounds(rect) {
          if (hostWindow) return // window-mode views manage their own geometry
          rectDriven = true
          try {
            log?.info('embedded view setBounds', { moduleId: spec.moduleId, ...rect })
            view.setBounds(rect)
          } catch (e) {
            log?.warn('embedded view setBounds threw', { moduleId: spec.moduleId, error: String(e) })
          }
        },
        setVisible(visible) {
          if (hostWindow) return
          try {
            log?.info('embedded view setVisible', { moduleId: spec.moduleId, visible })
            view.setVisible(visible)
          } catch (e) {
            log?.warn('embedded view setVisible threw', { moduleId: spec.moduleId, error: String(e) })
          }
        },
        setUiTokens(tokens) {
          lastTokens = tokens
          try {
            wc.executeJavaScript(buildUiTokenScript(tokens))
          } catch (e) {
            log?.warn('ui token injection threw', { moduleId: spec.moduleId, error: String(e) })
          }
        },
        destroy() {
          try {
            const parent = getParentWindow()
            parent?.contentView.removeChildView(view)
            if (parent) parent.off('resize', applyBounds)
            hostWindow?.destroy()
            wc.close()
          } catch {
            /* already dead */
          }
        }
      }
    }
  }
}
