import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ILogger } from '@contracts/logger'
import type { IPermission, PermissionType } from '@contracts/permission'
import { isPermissionType, PERMISSION_TYPES } from '@contracts/permission'
import { createConfig } from '../../src/main/core/config'
import { createPermissions } from '../../src/main/core/permissions'

/* ---------- 测试辅助 ---------- */

function testLogger() {
  const warnings: string[] = []
  const make = (source: string): ILogger => ({
    debug: () => {},
    info: () => {},
    warn: (m) => { warnings.push(`${source}: ${m}`) },
    error: () => {},
    child: (s) => make(s),
    setLevel: () => {}
  })
  return { logger: make('root'), warnings }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'el-perm-'))
}

interface Rig {
  flush(): Promise<void>
  perms: IPermission
}

async function makeService(dir?: string): Promise<Rig & { dir: string }> {
  const d = dir ?? (await tempDir())
  const { logger } = testLogger()
  const config = createConfig({ dir: d, logger })
  const perms = await createPermissions({ logger, config })
  return {
    dir: d,
    perms,
    flush: () => config.flush()
  }
}

const as = (list: string[]): PermissionType[] => list as unknown as PermissionType[]

/* ---------- 声明 ---------- */

describe('声明', () => {
  it('合法声明登记成功；未知权限字符串被拒绝', async () => {
    const { perms } = await makeService()
    const ok = perms.declare('a', ['clipboard', 'camera'])
    expect(ok).toEqual({ ok: true, errors: [] })
    expect(perms.check('a', 'clipboard')).toBe(true)

    const bad = perms.declare('b', as(['camera', 'teleport']))
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toContain('teleport')
    expect(perms.check('b', 'camera')).toBe(false)
  })

  it('相同集合重复声明幂等；不同集合（提权/降权）被拒绝且原声明保留', async () => {
    const { perms } = await makeService()
    perms.declare('a', ['clipboard'])
    expect(perms.declare('a', ['clipboard']).ok).toBe(true)
    const up = perms.declare('a', ['clipboard', 'camera'])
    expect(up.ok).toBe(false)
    expect(up.errors.join('\n')).toContain('escalation')
    expect(perms.check('a', 'camera')).toBe(false)
    expect(perms.check('a', 'clipboard')).toBe(true)

    const down = perms.declare('a', [])
    expect(down.ok).toBe(false)
    expect(perms.check('a', 'clipboard')).toBe(true)
  })

  it('空权限声明合法（模块可以什么都不需要）', async () => {
    const { perms } = await makeService()
    expect(perms.declare('plain', []).ok).toBe(true)
    expect(perms.status('plain')).toEqual({ declared: [], revoked: [], granted: [] })
  })
})

/* ---------- 校验三态 ---------- */

describe('运行时校验', () => {
  it('check：声明且未撤销 true；未声明权限 false；未声明模块 false', async () => {
    const { perms } = await makeService()
    perms.declare('a', ['clipboard'])
    expect(perms.check('a', 'clipboard')).toBe(true)
    expect(perms.check('a', 'camera')).toBe(false)
    expect(perms.check('ghost', 'clipboard')).toBe(false)
  })
})

/* ---------- 撤销与授予 ---------- */

describe('撤销与授予', () => {
  it('撤销即时生效；授予恢复；均持久化（新实例同目录仍生效）', async () => {
    const rig = await makeService()
    rig.perms.declare('a', ['clipboard', 'camera'])
    expect(rig.perms.revoke('a', 'camera')).toBe(true)
    expect(rig.perms.check('a', 'camera')).toBe(false)
    expect(rig.perms.grant('a', 'camera')).toBe(true)
    expect(rig.perms.check('a', 'camera')).toBe(true)

    rig.perms.revoke('a', 'camera')
    await rig.flush()

    const rig2 = await makeService(rig.dir)
    rig2.perms.declare('a', ['clipboard', 'camera'])
    expect(rig2.perms.check('a', 'camera')).toBe(false)
    expect(rig2.perms.check('a', 'clipboard')).toBe(true)
  })

  it('撤销未声明的权限返回 false；撤销/授予幂等', async () => {
    const { perms } = await makeService()
    perms.declare('a', ['clipboard'])
    expect(perms.revoke('a', 'camera')).toBe(false)
    expect(perms.revoke('a', 'clipboard')).toBe(true)
    expect(perms.revoke('a', 'clipboard')).toBe(true)
    expect(perms.grant('a', 'clipboard')).toBe(true)
    expect(perms.grant('a', 'clipboard')).toBe(true)
  })
})

/* ---------- 持久化与防御 ---------- */

describe('持久化与防御', () => {
  it('垃圾配置：非法权限名不产生幻影撤销/幻影授予（读取端收敛，不崩溃）', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, 'core.permissions.json'),
      JSON.stringify({
        format: 'eclipselive-config-section',
        version: 1,
        updatedAt: 1,
        data: { revoked: { ghost: ['teleport'], a: ['camera'] } }
      }),
      'utf8'
    )
    const { perms } = await makeService(dir)
    perms.declare('a', ['camera', 'clipboard'])
    expect(perms.check('a', 'camera')).toBe(false) // 合法撤销生效
    expect(perms.check('a', 'clipboard')).toBe(true)
    const st = perms.status('a')
    expect(st.revoked).toEqual(['camera'])
    expect(st.granted).toEqual(['clipboard'])
  })

  it('removeModule：清理声明、可重新声明任意集合、撤销记忆保留（重装不放行）', async () => {
    const { perms } = await makeService()
    perms.declare('a', ['camera'])
    perms.revoke('a', 'camera')
    perms.removeModule('a')
    expect(perms.check('a', 'camera')).toBe(false)
    // 重新声明一个不同集合：removeModule 后不受升级限制
    expect(perms.declare('a', ['clipboard', 'camera']).ok).toBe(true)
    expect(perms.check('a', 'clipboard')).toBe(true)
    expect(perms.check('a', 'camera')).toBe(false) // 撤销记忆仍生效
  })
})

/* ---------- 闭集扩展（T23/T25） ---------- */

describe('闭集扩展（T23/T25）', () => {
  it('global-shortcut 进入闭集：isPermissionType 认可、可声明、可撤销', async () => {
    const { perms } = await makeService()
    expect(isPermissionType('global-shortcut')).toBe(true)
    expect(PERMISSION_TYPES).toContain('global-shortcut')
    expect(perms.declare('hot', ['global-shortcut']).ok).toBe(true)
    expect(perms.check('hot', 'global-shortcut')).toBe(true)
    expect(perms.revoke('hot', 'global-shortcut')).toBe(true)
    expect(perms.check('hot', 'global-shortcut')).toBe(false)
  })

  it('window-overlay 进入闭集（T25）：isPermissionType 认可、可声明、可撤销', async () => {
    const { perms } = await makeService()
    expect(isPermissionType('window-overlay')).toBe(true)
    expect(PERMISSION_TYPES).toContain('window-overlay')
    expect(perms.declare('float', ['window-overlay']).ok).toBe(true)
    expect(perms.check('float', 'window-overlay')).toBe(true)
    expect(perms.revoke('float', 'window-overlay')).toBe(true)
    expect(perms.check('float', 'window-overlay')).toBe(false)
  })

  it('external-websocket 进入闭集（C0）：回环对外 WebSocket 需显式声明与授权', async () => {
    const { perms } = await makeService()
    expect(isPermissionType('external-websocket')).toBe(true)
    expect(PERMISSION_TYPES).toContain('external-websocket')
    // 闭集内命名统一 kebab-case（任务卡原文 external.websocket 为描述性写法）
    expect(isPermissionType('external.websocket'), '带点写法不在闭集内').toBe(false)
    expect(perms.declare('vts', ['external-websocket']).ok).toBe(true)
    expect(perms.check('vts', 'external-websocket')).toBe(true)
    expect(perms.revoke('vts', 'external-websocket')).toBe(true)
    expect(perms.check('vts', 'external-websocket')).toBe(false)
  })
})

/* ---------- 状态查询 ---------- */

describe('状态查询', () => {
  it('status 计算 declared/revoked/granted；listAll 覆盖全部已声明模块', async () => {
    const { perms } = await makeService()
    perms.declare('a', ['clipboard', 'camera'])
    perms.declare('b', ['microphone'])
    perms.revoke('a', 'camera')
    expect(perms.status('a')).toEqual({
      declared: ['clipboard', 'camera'],
      revoked: ['camera'],
      granted: ['clipboard']
    })
    const all = perms.listAll()
    expect(all.map((m) => m.moduleId)).toEqual(['a', 'b'])
    expect(all[1].granted).toEqual(['microphone'])
    expect(perms.status('ghost')).toEqual({ declared: [], revoked: [], granted: [] })
  })
})
