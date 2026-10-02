import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('悬浮窗接线：真实启动装配 overlays 服务并写 overlays ready 日志；overlay preload 产物在位', async () => {
  // 第二 preload 入口构建验证：模块页面专属 resize 桥必须随包产出。
  expect(existsSync(join(projectRoot, 'out/preload/overlay.js')), '缺少 out/preload/overlay.js').toBe(true)

  const iso = mkdtempSync(join(tmpdir(), 'el-ovl-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: {
      ...process.env,
      EL_TEST_USERDATA: iso,
      EL_TEST_SKIP_TITLE: '1'
    } as unknown as Record<string, string>
  })

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const logsDir = join(userData, 'logs')

  let content = ''
  for (let i = 0; i < 10; i++) {
    try {
      const files = (await readdir(logsDir)).filter((f) => /^eclipselive-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      if (files.length > 0) {
        content = await readFile(join(logsDir, files[files.length - 1]), 'utf8')
        if (content.includes('overlays ready')) break
      }
    } catch {
      /* not flushed yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  await app.close()

  expect(content).toContain('[lifecycle] overlays ready')
})
