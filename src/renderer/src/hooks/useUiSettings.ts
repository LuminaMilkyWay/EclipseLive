import { useCallback, useEffect, useState } from 'react'
import { effectiveMaterial, resolveTheme, wallpaperUrl, type UiSettings } from '@shared/theme'

/**
 * UI 设置（主题/强调色/材质档/底图/三降级开关）的状态与写入通道。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 6 轮（**方案 A：最小安全范围**，用户确认）。
 * 红线遵守：本文件里的 effect **依赖数组与语句顺序逐字来自 App.tsx**（[] 与 [setDegraded]），
 * 未做任何等价的"优化"重写；`ui` 仍是**单一整体状态**，未按字段拆分。
 * `setDegraded`（帧率降档复位）由调用方以参数传入 —— 该状态属第 7 轮（帧率/玻璃副作用）范围，
 * 本轮**不搬**，以免跨轮合并。
 */

/** 调用方需提供的依赖：帧率降档复位（用于"重选材质档位即复位降档"）。 */
export interface UseUiSettingsDeps {
  setDegraded: (v: boolean) => void
}

export interface UseUiSettingsResult {
  ui: UiSettings | null
  /** 直接写入（供底图安装/复位等既有调用点使用；语义与拆分前一致）。 */
  setUi: (s: UiSettings) => void
  patchUi: (patch: Partial<UiSettings>) => void
}

export function useUiSettings({ setDegraded }: UseUiSettingsDeps): UseUiSettingsResult {
  const [ui, setUi] = useState<UiSettings | null>(null)

  // T14 主题引擎 + T15 材质档：启动读 core.ui 应用主题/强调色/材质根节点属性
  // （preload 侧已先行应用，这里兜底并接管后续变化）；
  // system 模式经 matchMedia 监听跟随 OS 外观实时换值。
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    let mode: UiSettings['themeMode'] = 'dark'
    const apply = (s: UiSettings): void => {
      mode = s.themeMode
      setUi(s)
      root.setAttribute('data-theme', resolveTheme(s.themeMode, mq.matches))
      root.setAttribute('data-accent', s.accent)
      // T22 档 3 自动降档：data-material 写渲染值 + 同步三降级属性（'1'/'0'）。
      root.setAttribute('data-material', String(effectiveMaterial(s)))
      root.setAttribute('data-reduce-transparency', s.reduceTransparency ? '1' : '0')
      root.setAttribute('data-high-contrast', s.highContrast ? '1' : '0')
      root.setAttribute('data-reduce-motion', s.reduceMotion ? '1' : '0')
      root.setAttribute('data-wallpaper-fit', s.wallpaperFit)
      root.style.setProperty(
        '--wallpaper-url',
        s.wallpaperImage ? `url("${wallpaperUrl(s.wallpaperImage)}")` : 'none'
      )
      root.style.setProperty('--wallpaper-opacity', String(s.wallpaperOpacity))
      root.style.setProperty('--wallpaper-blur', `${s.wallpaperBlur}px`)
    }
    const onSystemChange = (): void => {
      if (mode === 'system') root.setAttribute('data-theme', resolveTheme('system', mq.matches))
    }
    void window.eclipselive.uiSettings().then(apply).catch(() => {})
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  // T16：设置项变更——preload 在 IPC resolve 后同步应用根节点属性（即时生效），
  // 成功后回读最新值同步本地 state（分段控件 active 态）。
  // T28：重选材质档位 = 复位 fps 降档（给低配设备重试机会）。
  const patchUi = useCallback((patch: Partial<UiSettings>) => {
    if (patch.material !== undefined) setDegraded(false)
    void window.eclipselive
      .setUiSettings(patch)
      .then(async (r) => {
        if (r.ok) setUi(await window.eclipselive.uiSettings())
      })
      .catch(() => {})
  }, [setDegraded])

  return { ui, setUi, patchUi }
}
