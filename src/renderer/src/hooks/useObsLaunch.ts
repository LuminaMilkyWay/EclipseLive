import { useCallback, useState } from 'react'

/**
 * 自动拉起 OBS（T41）。只做三件事：探测路径并启动、把结果反馈给界面、暴露失败原因。
 * 就绪判定仍由 `useObsStream` 的既有连接探测负责（不新增第二条通道）。
 */
export function useObsLaunch(): {
  launching: boolean
  message: string
  launch: () => Promise<boolean>
  pickAndLaunch: () => Promise<boolean>
} {
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState('')

  const launch = useCallback(async (): Promise<boolean> => {
    setLaunching(true)
    try {
      const r = await window.eclipselive.obsLaunch()
      if (r.ok) {
        setMessage('已启动 OBS，正在等待它就绪（首次启动可能需要十几秒）。')
        return true
      }
      setMessage(r.errors?.[0] ?? '未能启动 OBS，请手动打开或指定可执行文件。')
      return false
    } catch {
      setMessage('未能启动 OBS，请手动打开。')
      return false
    } finally {
      setLaunching(false)
    }
  }, [])

  /** 手动指定 OBS 位置（Steam 版或自定义安装时用），指定后立即再试一次启动。 */
  const pickAndLaunch = useCallback(async (): Promise<boolean> => {
    try {
      const p = await window.eclipselive.obsPick()
      if (!p.ok) {
        setMessage('已取消选择。')
        return false
      }
      setMessage('已记录 OBS 位置，正在启动…')
      return await launch()
    } catch {
      setMessage('选择 OBS 位置失败，请重试。')
      return false
    }
  }, [launch])

  return { launching, message, launch, pickAndLaunch }
}
