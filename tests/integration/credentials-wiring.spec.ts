import { test, expect, _electron as electron } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronExecutablePath = require('electron') as string
const projectRoot = join(__dirname, '../..')

test('凭据与网络客户端接线：safeStorage 真机往返 + 本地空实现就绪', async () => {
  // 独立 userData（EL_TEST_USERDATA 注入）：Windows 下 APPDATA 不重定向 userData，下同。
  const iso = mkdtempSync(join(tmpdir(), 'el-creds-it-'))
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
        if (content.includes('credentials ready') && content.includes('network client ready')) break
      }
    } catch {
      /* not flushed yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  await app.close()

  expect(content).toContain('[lifecycle] credentials ready')
  // roundtrip 探针：真实 Electron 环境下 safeStorage 加解密可用
  expect(content).toContain('"roundtrip":true')
  expect(content).toContain('[lifecycle] network client ready')
})
