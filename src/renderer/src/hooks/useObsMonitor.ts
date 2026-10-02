import { useCallback, useEffect, useRef, useState } from 'react'
import { nextState, pickVirtualCamera, monitorHint, type MonitorState } from '../obs-monitor'
import { requestStartVirtualCam, requestStopVirtualCam } from '../obs-requests'

/**
 * 软件内监看（T42，方案 A）：一键启动 OBS 虚拟摄像头并在 `<video>` 里预览。
 * 关闭监看只停止本地预览，**不影响直播输出**（不调用 StopStream）。
 */
export function useObsMonitor(): {
  state: MonitorState
  hint: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => Promise<void>
} {
  const [state, setState] = useState<MonitorState>('idle')
  const [hasDevice, setHasDevice] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        // 需要一次权限探测后才能拿到 label（浏览器安全策略）
        const all = await navigator.mediaDevices.enumerateDevices()
        const cams = all.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }))
        setHasDevice(pickVirtualCamera(cams) !== null)
      } catch {
        setHasDevice(false)
      }
    })()
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop()
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState((s) => nextState(s, 'stop'))
    // 顺手关掉 OBS 的虚拟摄像头（失败无所谓：可能本就不是我们开的）
    await window.eclipselive.obsSend(requestStopVirtualCam().requestType).catch(() => {})
  }, [])

  const start = useCallback(async (): Promise<void> => {
    setState((s) => nextState(s, 'start'))
    try {
      // ① 让 OBS 打开虚拟摄像头（若已开则 OBS 会返回失败，忽略即可）
      await window.eclipselive.obsSend(requestStartVirtualCam().requestType).catch(() => {})
      // ② 枚举设备并挑 OBS 虚拟摄像头
      const all = await navigator.mediaDevices.enumerateDevices()
      const cams = all.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }))
      const cam = pickVirtualCamera(cams)
      setHasDevice(cam !== null)
      if (!cam) {
        setState((s) => nextState(s, 'failed'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cam.deviceId } },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setState((s) => nextState(s, 'started'))
    } catch {
      setState((s) => nextState(s, 'failed'))
    }
  }, [])

  const toggle = useCallback(async (): Promise<void> => {
    if (state === 'live') await stop()
    else await start()
  }, [state, start, stop])

  // 卸载时必须释放摄像头（否则会一直占用设备）
  useEffect(() => () => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop()
  }, [])

  return { state, hint: monitorHint(state, hasDevice), videoRef, start, stop, toggle }
}
