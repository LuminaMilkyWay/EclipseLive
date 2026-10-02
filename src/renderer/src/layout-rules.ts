/**
 * 布局扩展规则表（L2，**零清单格式变更**）。
 *
 * 来源：docs/UI-OBS-FOCUS-MODE-ASSESSMENT.md §十。
 * 语义：`moduleId/pageId → 布局档`；**缺省必须是 `standard`**（防止"忘记声明就全屏"）。
 * 新增一个需要更大操作范围的功能页时，**只在这里加一行**。
 */
export type LayoutTier = 'standard' | 'wide' | 'full'

/** 页面/功能标识 → 布局档。键用稳定的功能标识（不是模块 id）。 */
export const LAYOUT_RULES: Readonly<Record<string, LayoutTier>> = {
  // 直播中控是第一个消费者：进入即回缩侧栏、内容区扩展到原侧栏左边界
  'obs-stream': 'full'
}

/** 查表（缺省 standard）。 */
export function layoutFor(id: string | null | undefined): LayoutTier {
  if (!id) return 'standard'
  return LAYOUT_RULES[id] ?? 'standard'
}
