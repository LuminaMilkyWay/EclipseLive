import { _electron as electron, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 折射异常探测器 v2（T47）：补上 v1 漏掉的场景与更强的判据。
 *
 * v1 判据只有"元素尺寸变化"⇒ 0 异常，说明闪烁另有来源。v2 增加：
 *   · 场景：**滚动内容**、**窗口缩放**、**开关网页工具**、**悬停卡片**；
 *   · 信号：`::before` 的 **完整 filter 字符串**（重新烘焙必然换值）、`--mat-refract` 变量值、
 *     `background-attachment`、元素 rect 与 `::before` 的 opacity。
 * 任一"可见期间信号变化"⇒ 记一条 ANOMALY（含场景与前后值）。
 */
test('probe: 折射异常全场景扫描 v2', async () => {
  test.setTimeout(180_000)
  const iso = mkdtempSync(join(tmpdir(), 'el-probe-refract2-'))
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: resolve(__dirname, '../..'),
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATSNEW: '1'
    } as unknown as Record<string, string>
  })

  const SAMPLE = `(() => {
    const out = []
    const root = getComputedStyle(document.documentElement)
    const refract = root.getPropertyValue('--mat-refract').trim()
    const els = [['content', document.querySelector('.content')], ['card', document.querySelector('.content-scroll .card')], ['side', document.querySelector('.side')]]
    for (const [name, el] of els) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el, '::before')
      out.push({ name, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), o: cs.opacity, f: cs.filter, ba: cs.backgroundAttachment, refractLen: refract.length })
    }
    return JSON.stringify(out)
  })()`

  interface Frame {
    name: string
    w: number
    h: number
    x: number
    y: number
    o: string
    f: string
    ba: string
    refractLen: number
  }

  try {
    const win = await app.firstWindow()
    await win.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })
    await win.waitForTimeout(700)
    console.log('REFRACT_SAMPLE=' + String(await win.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--mat-refract').slice(0,60)")))

    const scan = async (scenario: string, frames = 24): Promise<string[]> => {
      // 场景前先静默等待：否则上一段动画仍在跑，采样会把"跨场景串扰"误报成本场景异常
      await win.waitForTimeout(900)
      const seq: Frame[][] = []
      for (let i = 0; i < frames; i++) {
        await win.waitForTimeout(30)
        seq.push(JSON.parse(String(await win.evaluate(SAMPLE))) as Frame[])
      }
      const anomalies: string[] = []
      for (let i = 1; i < seq.length; i++) {
        for (const cur of seq[i]) {
          const prev = seq[i - 1].find((p) => p.name === cur.name)
          if (!prev) continue
          const visible = Number(prev.o) > 0.05 || Number(cur.o) > 0.05
          const reasons: string[] = []
          if (prev.f !== cur.f) reasons.push('filter 变化')
          if (prev.ba !== cur.ba) reasons.push('background-attachment 变化')
          if (visible && (prev.w !== cur.w || prev.h !== cur.h)) reasons.push(`尺寸 ${prev.w}x${prev.h}→${cur.w}x${cur.h}`)
          if (visible && (prev.x !== cur.x || prev.y !== cur.y)) reasons.push(`位置 ${prev.x},${prev.y}→${cur.x},${cur.y}`)
          if (reasons.length > 0) {
            anomalies.push(`${scenario} @f${i} ${cur.name}: ${reasons.join('；')}`)
            break
          }
        }
      }
      console.log(`SCENARIO=${scenario} anomalies=${anomalies.length}`)
      for (const a of anomalies.slice(0, 5)) console.log('ANOMALY ' + a)
      return anomalies
    }

    const click = async (sel: string): Promise<void> => {
      await win.evaluate(`document.querySelector('${sel}')?.click()`)
    }

    /** OPACITY_KEEP：切页全过程中，卡片的折射层透明度**不得低于 0.05**（用户反馈"底图消失一会再出现"）。 */
    const opacityScan = async (label: string, sel: string): Promise<void> => {
      await win.evaluate(`document.querySelector('${sel}')?.click()`)
      let min = 1
      for (let i = 0; i < 20; i++) {
        await win.waitForTimeout(30)
        const o = Number(
          await win.evaluate(
            "(() => { const e = document.querySelector('.content-scroll .card'); return e ? Number(getComputedStyle(e, '::before').opacity) : 1 })()"
          )
        )
        min = Math.min(min, o)
      }
      console.log(`OPACITY_KEEP ${label}: min=${min.toFixed(3)}`)
      if (min < 0.05) console.log(`ANOMALY ${label}: 底图消失（min opacity ${min}）`)
    }

    const all: string[] = []
    await opacityScan('切到更新日志', '[data-testid="tab-changelog"]')
    await opacityScan('切到诊断', '[data-testid="tab-obs"]')
    // ① 滚动内容（.content-scroll 可滚动区）
    await win.evaluate("document.querySelector('.content-scroll')?.scrollBy({top: 400})")
    all.push(...(await scan('滚动内容 400px')))
    await win.evaluate("document.querySelector('.content-scroll')?.scrollBy({top: -400})")
    all.push(...(await scan('回滚内容 -400px')))

    // ② 窗口缩放
    const win0 = win.viewportSize()
    if (win0) {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(980, 640)
      })
      all.push(...(await scan('窗口缩小到 980x640')))
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1120, 720)
      })
      all.push(...(await scan('窗口恢复 1120x720')))
    }

    // ③ 打开/关闭网页工具（原生视图出现/消失）
    await win.evaluate(
      "(async () => { try { await window.eclipselive.openWebTool('example-web') } catch {} })()"
    )
    all.push(...(await scan('打开网页工具')))
    await win.evaluate("(async () => { try { await window.eclipselive.closeWebTool('example-web') } catch {} })()")
    all.push(...(await scan('关闭网页工具')))

    // ④ 进专注 + 收放 + 退出
    await click('[data-testid="tab-obs"]')
    all.push(...(await scan('进入专注')))
    await click('[data-testid="dock-sidebar-toggle"]')
    all.push(...(await scan('专注态展开菜单')))
    await click('[data-testid="dock-sidebar-toggle"]')
    all.push(...(await scan('专注态收起菜单')))
    await click('[data-testid="tab-settings"]')
    all.push(...(await scan('退出专注')))

    console.log('TOTAL_ANOMALIES=' + all.length)
  } finally {
    await app.close().catch(() => {})
  }
})
