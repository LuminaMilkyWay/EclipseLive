import { useCallback, useEffect, useRef, useState } from 'react'
import { type AppInfo } from '@shared/appInfo'
import type { ActionResult, DiagnosticsSnapshot } from '@shared/diagnostics'
import {
  effectiveMaterial,
  
} from '@shared/theme'
import type { ChangelogSnapshot } from '@shared/changelog'
import { collectUiTokens } from './ui-tokens'
import { TitleScreen } from './screens/TitleScreen'
import { Sidebar } from './shell/Sidebar'
import { ContentArea } from './shell/ContentArea'
import { ToolBar } from './shell/ToolBar'
import { useUiSettings } from './hooks/useUiSettings'
import { useGlassOptics } from './hooks/useGlassOptics'
import { useShellLayout } from './hooks/useShellLayout'
import { useFpsGuard } from './hooks/useFpsGuard'
import { SKIP_TITLE } from './app-tables'
import type { Tab } from './app-tables'

/**
 * T12 管理界面：诊断页 + 模块管理页 + 网页工具底部条。
 * 数据全部经 preload 受限桥（2s 自动刷新 + 操作即刷新）；token 只显示存在性。
 * T16 追加设置页：6 组分组（元数据 @shared/settingsGroups），外观组三项即时生效并持久。
 * T17 追加全局底图控件（eclipse-wallpaper:// 通道，恢复默认含显示方式/透明度/模糊度复位）。
 * T18 追加标题页：全屏应用标识 + 进入入口，进入前主界面不挂载。
 * T19 主界面布局重写：左 1/4 导航区（功能分组）+ 右 3/4 内容区；底部条全宽跨两列（embedded 契约不变）。
 * T20 组件库统一：13 类通用组件收敛到 ui.tsx 并全量接入（按钮变体/确认对话框/Toast/空状态/列表行/滑块等）。
 * T21 设置项补全：功能/模块/连接/诊断四组实装（检查更新默认关闭，仅查 GitHub Releases）。
 * T22 动效与可读性收尾：外观组三降级开关（减少透明度/高对比度/减少动态效果）
 * + 档 3 高对比度下自动降档渲染（持久化值不变，档位选择器仍显示档 3）。
 */


export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [tab, setTab] = useState<Tab>('diagnostics')
  // T34 更新日志：常驻页签数据 + "升级后首次启动弹一次"的开关
  const [changelog, setChangelog] = useState<ChangelogSnapshot | null>(null)
  const [whatsNew, setWhatsNew] = useState(false)
  // 侧栏「模块」二级下拉：点击展开/收起；切 tab 或点击面板外自动收起。
  // T-A5：收起需**保留节点到动画结束**再卸载（data-closing → el-drop-out），故用一个
  // 短延时卸载 + 定时器取消（快速连点不会状态错乱）；降级时延时为 0（CSS 动画已关，
  // 节点不该空等）。
  const [extOpen, setExtOpen] = useState(false)
  const [extClosing, setExtClosing] = useState(false)
  const sideNavRef = useRef<HTMLDivElement | null>(null)
  const extCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const extOpenRef = useRef(false)
  extOpenRef.current = extOpen
  // 降级标志（ui/fpsDegraded）在下方才声明——经 ref 传递，避免 TDZ 与依赖抖动
  const extMotionOffRef = useRef(false)
  const extCloseRef = useRef<() => void>(() => {})

  const closeExt = useCallback((): void => {
    if (!extOpenRef.current) return
    if (extCloseTimer.current !== null) clearTimeout(extCloseTimer.current)
    setExtClosing(true)
    extCloseTimer.current = setTimeout(
      () => {
        extCloseTimer.current = null
        setExtOpen(false)
        setExtClosing(false)
      },
      extMotionOffRef.current ? 0 : 180
    )
  }, [])
  extCloseRef.current = closeExt

  const toggleExt = useCallback((): void => {
    // 收起动画进行中再次点击 = 立即重新展开（取消待卸载的定时器）
    if (extCloseTimer.current !== null) {
      clearTimeout(extCloseTimer.current)
      extCloseTimer.current = null
    }
    if (extOpenRef.current) {
      closeExt()
      return
    }
    setExtClosing(false)
    setExtOpen(true)
  }, [closeExt])

  // 切 tab 自动收起（仅在 tab 变化时触发；经 ref 读取最新状态，避免依赖抖动）
  useEffect(() => {
    extCloseRef.current()
  }, [tab])
  useEffect(() => {
    // 点击面板外收起：用 document click（非 mousedown）——mousedown 立即收起会因
    // 下拉占流收起引起布局位移，使同一按钮的 mouseup 目标漂移、click 事件丢失。
    const onDocClick = (e: MouseEvent): void => {
      if (sideNavRef.current && !sideNavRef.current.contains(e.target as Node)) {
        extCloseRef.current()
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])
  useEffect(
    () => () => {
      if (extCloseTimer.current !== null) clearTimeout(extCloseTimer.current)
    },
    []
  )
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null)
  const [message, setMessage] = useState('')
  // T18 标题页：进入前主界面不挂载（测试缝 skip-title 直接视为已进入）。
  const [entered, setEntered] = useState(SKIP_TITLE)
  // T28 档 3 帧率自动降档：纯运行态（不持久化）。ref 供闭包内同步读取。
  const [fpsDegraded, setFpsDegraded] = useState(false)
  // T-A5：减少动态效果或帧率降档时，收起动画已由 CSS 关闭，卸载延时应为 0
  const fpsDegradedRef = useRef(false)
  const setDegraded = useCallback((v: boolean) => {
    fpsDegradedRef.current = v
    setFpsDegraded(v)
  }, [])

  // 第 6 轮：ui 状态 + patchUi + 主题/材质应用 effect 收进 hook（方案 A，最小安全范围）
  const { ui, setUi, patchUi } = useUiSettings({ setDegraded })
  // 第 7 轮：玻璃光学副作用（烘焙滤镜/自适应文字色/指针光斑）收进 hook
  useGlassOptics(ui)
  // T-A5：减少动态效果或帧率降档时，收起动画已由 CSS 关闭，卸载延时应为 0
  extMotionOffRef.current = (ui?.reduceMotion ?? false) || fpsDegraded

  const refresh = useCallback(() => {
    void window.eclipselive.diagnostics().then(setSnap).catch(() => {})
  }, [])

  useEffect(() => {
    void window.eclipselive.appInfo().then(setInfo)
  }, [])

  // T34 更新日志：读一次（含"是否需要弹本次更新"）。弹窗只在主进程说需要时出现，
  // 而主进程已排除"读不到内容/当前版本不在日志里"两种情况，故这里不会弹空窗。
  useEffect(() => {
    void window.eclipselive
      .changelogGet()
      .then((s) => {
        setChangelog(s)
        setWhatsNew(s.showWhatsNew)
      })
      .catch(() => {})
  }, [])


  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  // T-A7：尊重系统级「减少动态效果」（prefers-reduced-motion）。
  // 写**独立根属性**而不并入 data-reduce-motion——后者语义是"用户在应用内打开了开关"
  // （集成测试据此断言），折进同一属性会造成"开关关着却报 1"的语义混淆。
  useEffect(() => {
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = document.documentElement
    const applySysMotion = (): void => {
      root.setAttribute('data-sys-reduce-motion', rmq.matches ? '1' : '0')
    }
    applySysMotion()
    rmq.addEventListener('change', applySysMotion)
    return () => rmq.removeEventListener('change', applySysMotion)
  }, [])




  // T28 渲染值统一收口：preload 每次设置变更同步写根属性（无 fps 知识），
  // 这里在 state 落地后兜底复写 data-material——fps 降档（3→2）优先于高对比降档之外的一切。
  useEffect(() => {
    if (!ui) return
    const root = document.documentElement
    const rendered = effectiveMaterial(ui)
    root.setAttribute('data-material', String(fpsDegraded ? Math.max(1, rendered - 1) : rendered))
    if (fpsDegraded) root.setAttribute('data-motion-low', '1')
    else root.removeAttribute('data-motion-low')
  }, [ui, fpsDegraded])

  // T50：帧率保护（宽限期 + 降档 + **健康自动恢复**）已抽到 hooks/useFpsGuard。
  useFpsGuard(ui, fpsDegraded, setDegraded)


  // T17 全局底图动作：install 无参走主进程对话框；reset 删图并复位显示方式/透明度/模糊度。
  const installWallpaper = useCallback(() => {
    void window.eclipselive
      .wallpaperInstall()
      .then(async (r) => {
        setMessage(r.ok ? '全局底图已更换' : `全局底图设置失败：${r.errors.join('；')}`)
        setUi(await window.eclipselive.uiSettings())
      })
      .catch(() => {})
  }, [])
  const resetWallpaper = useCallback(() => {
    void window.eclipselive
      .wallpaperReset()
      .then(async (r) => {
        setMessage(r.ok ? '全局底图已恢复默认' : `全局底图恢复失败：${r.errors.join('；')}`)
        setUi(await window.eclipselive.uiSettings())
      })
      .catch(() => {})
  }, [])

  // T-A3 重入保护：同一操作在途时忽略重复触发——此前连点「安装模块包」会弹两次对话框、
  // 连点「OBS 重连」会并发两次重连。ref 供闭包内同步判断，state 供按钮渲染 loading。
  const inFlightRef = useRef<Set<string>>(new Set())
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set())

  const run = useCallback(
    async (label: string, action: () => Promise<ActionResult>, key?: string) => {
      const k = key ?? label
      if (inFlightRef.current.has(k)) return
      inFlightRef.current.add(k)
      setInFlight(new Set(inFlightRef.current))
      try {
        const r = await action()
        setMessage(r.ok ? `${label} 成功` : `${label} 失败：${r.errors.join('；')}`)
      } catch (e) {
        setMessage(`${label} 失败：${String(e)}`)
      } finally {
        inFlightRef.current.delete(k)
        setInFlight(new Set(inFlightRef.current))
      }
      refresh()
    },
    [refresh]
  )

  const isBusy = useCallback((key: string): boolean => inFlight.has(key), [inFlight])

  // T20 Toast：动作反馈统一浮层呈现，5s 自动消失（单条覆盖式）。
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), 5000)
    return () => clearTimeout(timer)
  }, [message])

  const openTools = snap?.webtools.statuses.filter((s) => s.state === 'open') ?? []
  // T38/T39：布局编排（手动菜单开关 + 规则表驱动的自动扩展）—— 全部落在 hooks，
  // App 只保留这一次调用（AI_RULES 25：App.tsx 不得增长）。
  const { sidebarCollapsed, toggleSidebar, dockPinned, toggleDockPinned, revealDock, locked, toggleLocked } = useShellLayout(
    tab,
    snap?.webtools.statuses ?? [], snap ?? null
  )
  // 模块页 + pinned 工具统一收进侧栏「模块」二级下拉（snap.modules 全量智能路由，见扩展组）。
  const webStatuses = snap?.webtools.statuses ?? []

  // T33 模块页 UI 令牌推送：主题/材质/强调色/降级任一变化（根节点属性变更）即重算
  // 解析值推给所有打开的模块页；初始也推一次。页面刚打开的首推由 ModulePageHost
  // 负责（快照 2s 刷新存在窗口期），这里覆盖后续实时变化（含 system 模式跟随 OS 换肤）。
  const webStatusesRef = useRef(webStatuses)
  webStatusesRef.current = webStatuses
  useEffect(() => {
    const root = document.documentElement
    const push = (): void => {
      const tokens = collectUiTokens()
      for (const s of webStatusesRef.current) {
        if (s.page && s.state === 'open') {
          void window.eclipselive.setModulePageUiTokens(s.moduleId, tokens)
        }
      }
    }
    push()
    const mo = new MutationObserver(push)
    mo.observe(root, {
      attributes: true,
      attributeFilter: [
        'data-theme',
        'data-accent',
        'data-material',
        'data-reduce-transparency',
        'data-high-contrast',
        'data-reduce-motion',
        'data-motion-low',
        'data-wallpaper-fit'
      ]
    })
    return () => mo.disconnect()
  }, [])

  // T18 标题页：未进入前只渲染标题页（主界面不挂载，壁纸层在标题页同样生效）。
  if (!entered) return <TitleScreen info={info} onEnter={() => setEntered(true)} />

  return (
    <main className="shell">
      <div className="wallpaper" />

      <Sidebar
        info={info}
        snap={snap}
        tab={tab}
        setTab={setTab}
        extOpen={extOpen}
        extClosing={extClosing}
        toggleExt={toggleExt}
        sideNavRef={sideNavRef}
      />

      <ContentArea
        tab={tab}
        snap={snap}
        changelog={changelog}
        ui={ui}
        webStatuses={webStatuses}
        refresh={refresh}
        run={run}
        isBusy={isBusy}
        setMessage={setMessage}
        patchUi={patchUi}
        installWallpaper={installWallpaper}
        resetWallpaper={resetWallpaper}
        fpsDegraded={fpsDegraded}
      />

      <ToolBar
        openTools={openTools}
        tab={tab}
        setTab={setTab}
        run={run}
        changelog={changelog}
        whatsNew={whatsNew}
        setWhatsNew={setWhatsNew}
        message={message}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        dockPinned={dockPinned}
        onToggleDockPinned={toggleDockPinned}
        onRevealDock={revealDock}
        layoutLocked={locked}
        onToggleLocked={toggleLocked}
      />
    </main>
  )
}


