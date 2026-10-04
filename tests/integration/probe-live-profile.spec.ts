import { _electron as electron, test } from '@playwright/test'
import { resolve } from 'node:path'

/**
 * 只读诊断（用户真实配置）：读根属性 + 采样侧栏位移，用于回答"实例里为什么看不到动画"。
 * 不做断言（断言交给 probe-transitions / probe-sidebar-geometry），也不启动外部程序。
 */
test('probe: 真实配置下的动效状态（只读）', async () => {
  test.setTimeout(120_000)
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: resolve(__dirname, '../..'),
    env: {
      ...process.env,
      EL_TEST_USERDATA: resolve(__dirname, '../../.live-userdata'),
      EL_TEST_SKIP_TITLE: '1',
      EL_TEST_SKIP_WHATSNEW: '1'
    } as unknown as Record<string, string>
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('[data-testid="tab-obs"]', { timeout: 30_000 })
    const attrs = await win.evaluate(
      "JSON.stringify({reduce:document.documentElement.getAttribute('data-reduce-motion'),material:document.documentElement.getAttribute('data-material'),theme:document.documentElement.getAttribute('data-theme'),osReduce:window.matchMedia('(prefers-reduced-motion: reduce)').matches})"
    )
    console.log('LIVE_ATTRS=' + attrs)

    const click = async (sel: string): Promise<void> => {
      await win.evaluate(`document.querySelector('${sel}')?.click()`)
    }
    const side =
      "(() => { const e = document.querySelector('.side-inner'); return e ? getComputedStyle(e).transform : 'none'; })()"

    await click('[data-testid="tab-obs"]')
    await win.waitForTimeout(900)
    console.log(
      'FOCUS_ATTRS=' +
        (await win.evaluate(
          "JSON.stringify({focus:document.documentElement.getAttribute('data-focus'),sidebar:document.documentElement.getAttribute('data-sidebar')})"
        ))
    )

    await click('[data-testid="dock-sidebar-toggle"]')
    const open: string[] = []
    for (let i = 0; i < 6; i++) {
      await win.waitForTimeout(40)
      open.push(String(await win.evaluate(side)))
    }
    console.log('LIVE_OPEN_T=' + JSON.stringify(open))

    await click('[data-testid="dock-sidebar-toggle"]')
    const close: string[] = []
    for (let i = 0; i < 6; i++) {
      await win.waitForTimeout(40)
      close.push(String(await win.evaluate(side)))
    }
    console.log('LIVE_CLOSE_T=' + JSON.stringify(close))
  } finally {
    await app.close().catch(() => {})
  }
})
