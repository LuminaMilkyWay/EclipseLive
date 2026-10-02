"""修复直播中控页在专注布局下的尺寸/高度问题（用户反馈）+ Dock 居中 + 友好文案。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R = os.path.join(ROOT, "src", "renderer", "src")
CSS = os.path.join(R, "renderer.css")
PAGE = os.path.join(R, "screens", "ObsStreamPage.tsx")
HOOK = os.path.join(R, "hooks", "useObsStream.ts")

# ---------- ① CSS：页面级尺寸规范 + Dock 居中 ----------
css = open(CSS, encoding="utf-8").read()
if ".obs-page" not in css:
    css = css.rstrip("\n") + """

/* ==========================================================================
 * 直播中控页的尺寸规范（用户反馈："每个功能组件的大小和高度是有问题的"）
 * 截图实测病灶：卡片内大片空白（标题字号过大 + 段落外边距叠加）、
 * 输入框仅 25px 高 / 142px 宽（占位符被截断）。
 * 全部用现有令牌（--sp-* / --fs-* / --r-*），不引入新数值体系。
 * ========================================================================== */
.obs-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.obs-page .card {
  padding: var(--sp-4);
}

/* 标题收敛：控制台不是落地页，标题不该占主导 */
.obs-page h1 {
  margin: 0 0 var(--sp-2);
  font-size: 18px;
  line-height: 1.3;
}

.obs-page h2 {
  margin: 0 0 var(--sp-2);
  font-size: 15px;
  line-height: 1.3;
}

/* 段落与提示不要撑出空白 */
.obs-page p {
  margin: 0 0 var(--sp-2);
  line-height: 1.5;
}

.obs-page p:last-child {
  margin-bottom: 0;
}

/* 表单行：输入框给足尺寸，窄窗自动换行 */
.obs-field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}

.obs-field-row input {
  flex: 1 1 260px;
  min-width: 220px;
  height: 32px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-sm);
  border: 1px solid var(--ctrl-line);
  background: var(--ctrl-bg);
  color: var(--txt-1);
  font-size: 13px;
}

.obs-field-row input::placeholder {
  color: var(--txt-3);
}

/* 动作行：按钮不拉伸、间距一致 */
.obs-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

/* 场景 chips */
.obs-scenes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.obs-scenes .chip {
  height: 30px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-pill);
  border: 1px solid var(--ctrl-line);
  background: var(--ctrl-bg);
  color: var(--txt-2);
  cursor: pointer;
}

.obs-scenes .chip.chip-active {
  color: var(--txt-1);
  border-color: var(--acc-line);
  background: var(--acc-fill);
}
"""
if "justify-content: center" not in css.split(".dock {")[1][:400]:
    css = css.replace(""".dock {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;""", """.dock {
  display: flex;
  align-items: center;
  justify-content: center; /* 用户选定 Q3=B：图标化、**居中排列**（状态区仍靠右） */
  gap: var(--sp-2);
  width: 100%;""", 1)
open(CSS, "w", encoding="utf-8", newline="\n").write(css)
print("CSS_OK=" + str(".obs-page" in css and "justify-content: center" in css))

# ---------- ② 页面：结构改写（class 名 + 友好文案） ----------
page = '''/**
 * 直播中控页（菜单第一个功能项；**内置功能页，不是模块**）—— T40 实装。
 *
 * 尺寸规范见 renderer.css 的 `.obs-page` 段（用户反馈"组件大小和高度有问题"后加入）。
 * 凭据路线 **B**：密钥直接下发给 OBS，本软件不落盘、不回显原文、不进日志。
 */
import { useState } from 'react'
import { Btn, TextInput } from '../ui'
import { useObsStream } from '../hooks/useObsStream'
import { maskKey } from '../obs-requests'

export function ObsStreamPage(): React.JSX.Element {
  const obs = useObsStream()
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
        {obs.error !== '' && <p className="dim">{obs.error}</p>}
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
      </section>
    </div>
  )
}
'''
open(PAGE, "w", encoding="utf-8", newline="\n").write(page)
print("PAGE_OK=True")

# ---------- ③ hook：把底层英文错误换成人话 ----------
h = open(HOOK, encoding="utf-8").read()
if "friendlyError" not in h:
    h = h.replace(
        "async function send(req: ObsRequest): Promise<SendResult> {",
        '''/** 把底层错误（英文/技术性）换成用户能懂的话；原文只在开发日志里出现。 */
export function friendlyError(raw: string | undefined): string {
  if (!raw) return '操作未成功，请稍后再试。'
  if (/not connected|ECONNREFUSED|socket|closed/i.test(raw)) return '未连接到 OBS，请先启动 OBS 并开启 WebSocket 服务器。'
  if (/timeout/i.test(raw)) return 'OBS 响应超时，请检查 OBS 是否卡住。'
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw
}

async function send(req: ObsRequest): Promise<SendResult> {''',
        1,
    )
    # 所有 setError 走友好化
    h = h.replace("setError(list.errors?.[0] ?? list.status?.comment ?? '无法连接 OBS')",
                  "setError(friendlyError(list.errors?.[0] ?? list.status?.comment))")
    for old, new in [
        ("setError(r.status?.comment ?? r.errors?.[0] ?? '切换场景失败')", "setError(friendlyError(r.status?.comment ?? r.errors?.[0]))"),
        ("setError(r.status?.comment ?? r.errors?.[0] ?? '开播失败')", "setError(friendlyError(r.status?.comment ?? r.errors?.[0]))"),
        ("setError(r.status?.comment ?? r.errors?.[0] ?? '停止推流失败')", "setError(friendlyError(r.status?.comment ?? r.errors?.[0]))"),
        ("setError(r.status?.comment ?? r.errors?.[0] ?? '推流设置下发失败')", "setError(friendlyError(r.status?.comment ?? r.errors?.[0]))"),
    ]:
        h = h.replace(old, new, 1)
open(HOOK, "w", encoding="utf-8", newline="\n").write(h)
print("HOOK_OK=" + str("friendlyError" in h))
