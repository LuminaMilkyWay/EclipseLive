import type { ActionResult, DiagnosticsSnapshot } from '@shared/diagnostics'

/**
 * 诊断页 / 设置页 / 模块管理面板共用的页面契约（自 App.tsx 拆出；纯搬运，字段与含义未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md 第 1 轮。
 * 拆出的理由：SettingsPage 等组件移入 settings/SettingsPage.tsx 后仍需要该类型，
 * 留在 App.tsx 会造成子文件反向依赖 App（循环导入）⇒ 提到中立模块供双方 import。
 */
export interface PageProps {
  snap: DiagnosticsSnapshot | null
  onRefresh?: () => void
  run: (label: string, action: () => Promise<ActionResult>, key?: string) => Promise<void>
  /** 某操作是否在途（键同 run 的 key，缺省为 label）——供按钮 loading 态。 */
  isBusy: (key: string) => boolean
}
