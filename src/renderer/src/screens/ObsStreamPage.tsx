/**
 * 直播中控页（菜单第一个功能项；**内置功能页，不是模块**）—— T40 实装。
 *
 * 尺寸规范见 renderer.css 的 `.obs-page` 段（用户反馈"组件大小和高度有问题"后加入）。
 * 凭据路线 **B**：密钥直接下发给 OBS，本软件不落盘、不回显原文、不进日志。
 */
import { useState } from 'react'
import { Btn, TextInput } from '../ui'
import { useObsStream } from '../hooks/useObsStream'
import { useObsLaunch } from '../hooks/useObsLaunch'
import { ObsMonitor } from './ObsMonitor'
import { maskKey } from '../obs-requests'

export function ObsStreamPage(): React.JSX.Element {
  // 方案 C：OBS 要求密码时**就地**补一次；密码写入凭据库（不落明文），保存后立即清空输入。
  const [obsPw, setObsPw] = useState('')
  const [obsSaving, setObsSaving] = useState(false)
  const saveObsPw = async (): Promise<void> => {
    setObsSaving(true)
    try {
      await window.eclipselive.setObsConfig({ password: obsPw })
      setObsPw('')
      await obs.refresh()
    } finally {
      setObsSaving(false)
    }
  }
  const obs = useObsStream()
  const launcher = useObsLaunch()
  const [server, setServer] = useState('')
  const [key, setKey] = useState('')
  const [applied, setApplied] = useState(false)

  return (
    <div className="obs-page">
      <section className="card">
        <h1>直播中控</h1>
        <p className="dim">
          {obs.ready
            ? `已连接 OBS${obs.streaming ? '（正在推流）' : ''}${obs.reconnecting ? '（重连中）' : ''}`
            : '未连接 OBS。请确认 OBS 已启动，并在它的「工具 → WebSocket 服务器设置」中启用服务器；端口与密码可在本软件的 设置 → 连接 中填写。'}
        </p>
        {/* 仅在错误能提供"已连接但操作失败"这类额外信息时才显示，避免与上面的未连接说明重复 */}
        {obs.error !== '' && obs.ready && <p className="dim">{obs.error}</p>}
        {launcher.message !== '' && <p className="dim">{launcher.message}</p>}
        <div className="obs-actions">
          <Btn onClick={() => void obs.refresh()} disabled={obs.busy}>
            刷新
          </Btn>
          <Btn onClick={() => void obs.startStream()} disabled={obs.busy || !obs.ready || obs.streaming}>
            开始推流
          </Btn>
          <Btn onClick={() => void obs.stopStream()} disabled={obs.busy || !obs.ready || !obs.streaming}>
            停止推流
          </Btn>
          {!obs.ready && (
            <Btn onClick={() => void launcher.launch()} disabled={launcher.launching}>
              {launcher.launching ? '正在启动…' : '帮我启动 OBS'}
            </Btn>
          )}
          {!obs.ready && (
            <Btn onClick={() => void launcher.pickAndLaunch()}>手动选择 OBS 位置</Btn>
          )}
          {obs.timecode !== '' && <span className="dim">已推流 {obs.timecode}</span>}
        </div>
      </section>

      <section className="card">
        <h2>场景</h2>
        {obs.scenes.length === 0 ? (
          <p className="dim">暂无场景。连接 OBS 后这里会列出全部场景，点一下即可切换。</p>
        ) : (
          <div className="obs-scenes">
            {obs.scenes.map((name) => (
              <button
                key={name}
                type="button"
                className={name === obs.currentScene ? 'chip chip-active' : 'chip'}
                data-testid={`obs-scene-${name}`}
                onClick={() => void obs.switchScene(name)}
                disabled={obs.busy}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>推流服务器</h2>
        <p className="dim">
          填写后点「下发到 OBS」。若 OBS 未立即生效，请到 OBS 界面点一次「应用」（这是 OBS 的限制）。
          串流密钥只在下发时使用，不在本软件保存。
        </p>
        <div className="obs-field-row">
          <TextInput value={server} onChange={(e) => setServer(e.target.value)} placeholder="rtmp://…" aria-label="推流服务器地址" />
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="串流密钥" aria-label="串流密钥" />
          <Btn
            disabled={obs.busy || server.trim() === ''}
            onClick={() => {
              void obs.applyStreamService(server, key).then((ok) => {
                setApplied(ok)
                if (ok) setKey('')
              })
            }}
          >
            下发到 OBS
          </Btn>
        </div>
        {applied && <p className="dim">已下发（密钥已从本界面清除）。</p>}
        {key !== '' && <p className="dim">待下发：{maskKey(key)}</p>}
      
      {obs.needsPassword && (
        <div className="obs-password-inline" data-testid="obs-password-inline">
          <p className="dim">OBS 要求密码，但软件里还没填。填一次就会记住，之后不用再填。</p>
          <div className="obs-password-row">
            <input
              type="password"
              className="obs-password-input"
              aria-label="OBS 密码"
              placeholder="OBS 里设置的密码"
              value={obsPw}
              onChange={(e) => setObsPw(e.target.value)}
            />
            <Btn onClick={() => void saveObsPw()} disabled={obsPw.length === 0 || obsSaving}>
              {obsSaving ? '保存中…' : '保存'}
            </Btn>
          </div>
          <p className="dim">也可以到「设置 → 连接」里修改。</p>
        </div>
      )}
</section>

      <ObsMonitor />
    </div>
  )
}
