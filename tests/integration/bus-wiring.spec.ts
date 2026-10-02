import { test, expect, _electron as electron } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('事件总线接线：lifecycle:started 事件经总线订阅往返并写日志', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-bus-it-'))
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
        if (content.includes('lifecycle started event')) break
      }
    } catch {
      /* not flushed yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  await app.close()

  expect(content).toContain('[lifecycle] lifecycle started event')
  expect(content).toContain('"source":"lifecycle"')
  expect(content).toContain('"version":1')
})
