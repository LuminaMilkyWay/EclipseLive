import { test, expect, _electron as electron } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('网关接线：启动后 gateway ready 日志包含端口', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-gateway-it-'))
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [projectRoot],
    env: { ...process.env, EL_TEST_USERDATA: iso, EL_TEST_SKIP_TITLE: '1' } as unknown as Record<string, string>
  })

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const logsDir = join(userData, 'logs')

  let content = ''
  for (let i = 0; i < 10; i++) {
    try {
      const files = (await readdir(logsDir)).filter((f) => /^eclipselive-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      if (files.length > 0) {
        content = await readFile(join(logsDir, files[files.length - 1]), 'utf8')
        if (content.includes('gateway ready')) break
      }
    } catch {
      /* not flushed yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  await app.close()

  expect(content).toContain('[lifecycle] gateway ready')
  expect(content).toMatch(/"port":\d+/)
  expect(content).toContain('"browserSourceUrl":true')
})
