/**
 * 监看的纯逻辑（T42）—— 与 DOM/React 无关，便于单测。
 *
 * 方案（docs/OBS-STREAM-CONTROL-ASSESSMENT.md §3）：
 *   A（主）：OBS **虚拟摄像头** ⇒ 作为系统摄像头被 `getUserMedia` 读取 ⇒ 延迟最低、零新依赖；
 *   C（兜底）：`desktopCapturer` 抓 OBS 窗口 ⇒ 需 OBS 窗口可见；
 *   B（禁用）：本地 RTMP 拉流 ⇒ 需引入新依赖且延迟最差，明确不做。
 */

/** 虚拟摄像头设备名匹配（不同版本/语言下名称不同，按关键字匹配，而不是固定 deviceId）。 */
const VIRTUAL_CAM_HINTS = ['obs virtual camera', 'obs 虚拟摄像头', 'obs-camera']

export interface CameraLike {
  deviceId: string
  label: string
}

/** 从设备列表里挑出 OBS 虚拟摄像头（找不到返回 null）。 */
export function pickVirtualCamera(devices: readonly CameraLike[]): CameraLike | null {
  for (const d of devices) {
    const label = d.label.toLowerCase()
    if (VIRTUAL_CAM_HINTS.some((h) => label.includes(h))) return d
  }
  return null
}

/** 监看状态机（启停幂等；失败给出可读原因）。 */
export type MonitorState = 'idle' | 'starting' | 'live' | 'failed'

export function nextState(current: MonitorState, action: 'start' | 'started' | 'stop' | 'failed'): MonitorState {
  if (action === 'start') return current === 'live' ? 'live' : 'starting'
  if (action === 'started') return 'live'
  if (action === 'stop') return 'idle'
  return 'failed'
}

/** 给用户的下一步提示（无设备 / 失败时的引导）。 */
export function monitorHint(state: MonitorState, hasDevice: boolean): string {
  if (state === 'live') return '正在监看 OBS 画面。关闭监看不影响直播输出。'
  if (!hasDevice) return '未找到 OBS 虚拟摄像头：请在 OBS 里点一次「启动虚拟摄像头」（或改用窗口捕获）。'
  if (state === 'failed') return '监看启动失败，请确认 OBS 正在运行且虚拟摄像头可用。'
  return '点「启动监看」即可查看 OBS 画面；看不到画面时，先在 OBS 里点一次「启动虚拟摄像头」。'
}
