import { useEffect, useState, type ReactElement } from 'react'
import { APP_DISPLAY_VERSION } from '@shared/appInfo'

/**
 * 首次启动的**欢迎卡片**（替代"许可协议弹窗"）。
 *
 * 为什么不是许可协议弹窗：本软件以开源许可发布（AGPL-3.0 / MIT）⇒
 *   · 法律上不需要用户"点击同意"（源码义务由公开仓库与发布页满足）；
 *   · 强制点击既拦不住任何人，又给用户添麻烦 ⇒ 只做"该知道的事"。
 *
 * 文案纪律（守则 27）：**说人话** —— 不出现版本控制、许可缩写、模块术语等技术词，
 * 术语解释放在「许可与隐私」页，且同样用普通话讲清。
 *
 * 已读状态按展示版本记录 ⇒ 大版本更新时再提示一次；用 localStorage 以免依赖 IPC 与配置中心。
 */
const SEEN_KEY = 'el:onboarding-seen'
const REPO_URL = 'https://github.com/LuminaMilkyWay/EclipseLive'

export function Welcome(): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<'welcome' | 'terms'>('welcome')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) !== APP_DISPLAY_VERSION) setOpen(true)
    } catch {
      /* 存储不可用时就不打扰用户 */
    }
  }, [])

  if (!open) return null

  const finish = (): void => {
    try {
      localStorage.setItem(SEEN_KEY, APP_DISPLAY_VERSION)
    } catch {
      /* 忽略 */
    }
    setOpen(false)
  }

  const copyRepo = (): void => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(REPO_URL)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      } catch {
        setCopied(false)
      }
    })()
  }

  return (
    <div className="welcome-layer" data-testid="welcome">
      <section className="welcome-card" role="dialog" aria-label="欢迎">
        <header className="welcome-head">
          <h2>{page === 'welcome' ? '欢迎使用 EclipseLive' : '许可与隐私'}</h2>
        </header>

        {page === 'welcome' ? (
          <div className="welcome-body">
            <p className="welcome-lead">直播时常用的 OBS 操作，都在这里：切场景、开关推流、看画面、管互动。</p>
            <ul className="welcome-list">
              <li>开始前需要先装好 OBS。没装也没关系 —— 在「直播中控」里点「帮我启动 OBS」就行。</li>
              <li>你的数据只留在自己电脑上，我们不会上传任何东西。</li>
              <li>完全免费，接商单、收打赏都可以。源码也是公开的。</li>
            </ul>
            <p className="welcome-foot">当前是测试版：重要直播前，建议先准备好备用的开播方式。</p>
          </div>
        ) : (
          <div className="welcome-body">
            <ul className="welcome-list">
              <li>
                <b>你的权利</b>：这是开源软件，你可以自由使用、修改、再分发，也可以商用（接商单、收打赏都算）。
                这一页只是说明，<b>不改变许可证给你的权利</b>；万一两者有出入，<b>以许可证原文为准</b>。
              </li>
              <li>
                <b>我们收什么数据</b>：不收。软件在你自己的电脑上跑，我们没有服务器。
                你自己配置的第三方服务（比如云端服务、弹幕来源）由对应服务商处理。
              </li>
              <li>
                <b>导出诊断信息时</b>：只有你主动点「导出」才会生成；里面不含聊天内容、推流密钥、
                Cookie、密钥和直播间地址。
              </li>
              <li>
                <b>第三方组件</b>：软件里含其他开源项目，它们的许可证照原样保留；清单在仓库的「第三方组件声明」里。
              </li>
              <li>
                <b>想一起做</b>：改模块或模板，提交时加一行签署（git commit -s）就行；改核心需要先签一份
                贡献者协议，说明在仓库的 docs/cla 里。
              </li>
            </ul>
            <p className="welcome-foot">
              仓库地址：<code>{REPO_URL}</code>{' '}
              <button type="button" className="welcome-link" onClick={copyRepo}>
                {copied ? '已复制 ✓' : '复制地址'}
              </button>
            </p>
          </div>
        )}

        <footer className="welcome-actions">
          <span className="welcome-version">版本 {APP_DISPLAY_VERSION}</span>
          {page === 'welcome' ? (
            <button type="button" className="welcome-link" onClick={() => setPage('terms')}>
              许可与隐私
            </button>
          ) : (
            <button type="button" className="welcome-link" onClick={() => setPage('welcome')}>
              返回
            </button>
          )}
          <button type="button" className="welcome-primary" onClick={finish}>
            开始使用
          </button>
        </footer>
      </section>
    </div>
  )
}
