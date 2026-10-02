/**
 * 软件内监看组件（T42）：`<video>` 播放 OBS 虚拟摄像头画面。
 * 尺寸走 .obs-monitor 样式（renderer.css），与页面其它卡片一致。
 */
import { Btn } from '../ui'
import { useObsMonitor } from '../hooks/useObsMonitor'

export function ObsMonitor(): React.JSX.Element {
  const mon = useObsMonitor()
  return (
    <section className="card">
      <h2>画面监看</h2>
      <div className="obs-monitor">
        <video ref={mon.videoRef} className="obs-monitor-video" muted playsInline aria-label="OBS 画面预览" />
        {mon.state !== 'live' && <p className="obs-monitor-placeholder">未在监看</p>}
      </div>
      <p className="dim">{mon.hint}</p>
      <div className="obs-actions">
        <Btn onClick={() => void mon.toggle()} disabled={mon.state === 'starting'}>
          {mon.state === 'live' ? '停止监看' : '启动监看'}
        </Btn>
      </div>
    </section>
  )
}
