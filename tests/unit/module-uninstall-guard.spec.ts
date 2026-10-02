import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 卸载模块守卫（用户报障「设置里的卸载模块不能用」）。
 * 钉住：`module:uninstall` handler **必须捕获异常并回传原因**（动作契约 { ok, errors }），
 * 不得让 `packages.uninstall` 的异常直接把 IPC 打挂（那会表现为"点了没反应、看不到原因"）。
 */
const main = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')

describe('卸载模块（module:uninstall）', () => {
  it('handler 必须 try/catch 并把原因回传，同时写日志', () => {
    const start = main.indexOf("ipcMain.handle('module:uninstall'")
    expect(start, '未找到 module:uninstall handler').toBeGreaterThan(0)
    const seg = main.slice(start, start + 1200)
    expect(seg, '必须 await packages.uninstall').toContain('packages.uninstall(moduleId)')
    expect(seg, '必须捕获异常（否则界面看不到原因）').toMatch(/try\s*\{/)
    expect(seg, '必须回传 ok:false + errors').toMatch(/ok:\s*false/)
    expect(seg, '必须写日志便于排查').toContain('module uninstall failed')
  })
})
