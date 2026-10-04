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

/**
 * C3：**模块页的档位裁决** —— 规则表优先，其次看模块自己的 `nav.immersive` 声明。
 *
 * 为什么单列一个纯函数：本项目所有渲染层测试都受 tsconfig 项目边界限制（测试项目没有 DOM），
 * 放纯函数里才能**真跑单测**（而不是只做源码文本断言）。
 *
 * 安全默认（沿用 `layout-rules.ts` 的既定意图「忘记声明就全屏」是事故）：
 *   · 模块**未声明** immersive ⇒ 与今天一致（`standard`）；
 *   · 只有显式 `immersive === true` 才给 `full`。
 */
export function resolveTier(pageKey: string | null | undefined, immersive?: boolean): LayoutTier {
  // 没有页面键 ⇒ 不是模块页 ⇒ 一律 standard（**不得**凭 immersive 全屏：那会让 non-page 标签也变全屏）。
  if (!pageKey) return 'standard'
  const rule = layoutFor(pageKey)
  if (rule !== 'standard') return rule
  return immersive === true ? 'full' : 'standard'
}
