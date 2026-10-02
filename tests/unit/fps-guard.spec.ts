import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FPS_DEGRADE_THRESHOLD,
  FPS_RECOVER_THRESHOLD,
  shouldDegradeForFps,
  shouldRecoverForFps
} from '../../src/shared/theme'

/**
 * 帧率保护守卫（T50，用户实测两个问题）：
 * ① 刚进软件材质不是第四档；② 进入某些模块材质明显降级。
 * 根因：原实现降档后 `return` 不再采样 ⇒ 降档永久生效（只有手动重选档位才复位）。
 * 本守卫钉三件事：
 *  - 恢复判定存在且与降档**迟滞**（恢复阈值 > 降档阈值，避免来回抖动）；
 *  - 采样器（hooks/useFpsGuard）必须同时具备降档与恢复两条分支 + 启动宽限期；
 *  - App.tsx 不再内联采样器（防回归到"降档后不再采样"的旧实现）。
 */
const HOOK = resolve(__dirname, '../../src/renderer/src/hooks/useFpsGuard.ts')
const APP = resolve(__dirname, '../../src/renderer/src/App.tsx')

describe('帧率保护（T50）', () => {
  it('① 迟滞：恢复阈值高于降档阈值', () => {
    expect(FPS_RECOVER_THRESHOLD).toBeGreaterThan(FPS_DEGRADE_THRESHOLD)
  })

  it('② 帧间隔样本 → 降档 / 恢复判定互斥且方向正确', () => {
    const slow = Array.from({ length: 120 }, () => 1000 / 20) // 20fps
    const fast = Array.from({ length: 120 }, () => 1000 / 60) // 60fps
    expect(shouldDegradeForFps(slow)).toBe(true)
    expect(shouldRecoverForFps(slow)).toBe(false)
    expect(shouldRecoverForFps(fast)).toBe(true)
    expect(shouldDegradeForFps(fast)).toBe(false)
    // 样本不足不判定
    expect(shouldRecoverForFps([16, 16, 16])).toBe(false)
    // 异常样本（非正间隔）不恢复（防御）
    expect(shouldRecoverForFps([16, 0, 16])).toBe(false)
  })

  it('③ 采样器必须有"恢复"分支与启动宽限期；App 不得再内联采样器', async () => {
    const hook = await readFile(HOOK, 'utf8')
    expect(hook, '缺少恢复分支').toContain('shouldRecoverForFps(samples)')
    expect(hook, '缺少降档分支').toContain('shouldDegradeForFps(samples)')
    expect(hook, '缺少启动宽限期（GRACE_MS）').toContain('GRACE_MS')
    const app = await readFile(APP, 'utf8')
    expect(app, 'App 不应再内联帧率采样器').not.toContain('shouldDegradeForFps')
    expect(app, 'App 应调用 useFpsGuard').toContain('useFpsGuard(ui, fpsDegraded, setDegraded)')
  })
})
