import { useEffect } from 'react'
import type { UiSettings } from '@shared/theme'
import { shouldDegradeForFps, shouldRecoverForFps } from '@shared/theme'

/**
 * 帧率保护（T50 修复）：档 3 / 档 4 下采样帧间隔，慢则降一档，**健康则自动恢复**。
 *
 * 用户实测的两个问题与根因
 * - 「刚进软件材质一定不是第四档」：启动阶段负载高（模块加载、底图解码）⇒ 120 帧均值低于阈值 ⇒ 降档；
 *   原实现在降档后 `return`，**不再采样** ⇒ 永久降档，只有手动重选档位才复位。
 * - 「进入某些模块会明显发现材质降级」：同理，进入瞬间掉帧即降档且不恢复。
 *
 * 处置
 * - **启动宽限期**：前 `GRACE_MS` 毫秒不判定（避开启动/切页等一次性负载）；
 * - **自动恢复**：已降档时继续采样，帧率持续达到 `FPS_RECOVER_THRESHOLD` 即撤销降档；
 * - 恢复阈值高于降档阈值 ⇒ 不会来回抖动（迟滞）。
 */
const GRACE_MS = 4000
const WINDOW_FRAMES = 120

export function useFpsGuard(
  ui: UiSettings | null,
  degraded: boolean,
  setDegraded: (v: boolean) => void
): void {
  useEffect(() => {
    if (!ui || ui.material < 3) return
    let raf = 0
    let last = 0
    let started = 0
    let samples: number[] = []
    const tick = (t: number): void => {
      if (started === 0) started = t
      // 宽限期：启动/切页等一次性负载不参与判定（修复"刚进软件不是第四档"）
      if (t - started < GRACE_MS) {
        last = t
        raf = requestAnimationFrame(tick)
        return
      }
      if (last > 0) samples.push(t - last)
      last = t
      if (samples.length >= WINDOW_FRAMES) {
        if (!degraded && shouldDegradeForFps(samples)) {
          setDegraded(true)
          samples = []
        } else if (degraded && shouldRecoverForFps(samples)) {
          // 帧率恢复 ⇒ 撤销降档（回到用户选择的档位）
          setDegraded(false)
          samples = []
        } else {
          samples = []
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ui, degraded, setDegraded])
}
