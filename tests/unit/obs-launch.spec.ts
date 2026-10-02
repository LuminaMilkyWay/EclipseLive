import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  buildObsCandidates,
  dedupePaths,
  isObsProcessListed,
  OBS_SHORTCUT_NAMES,
  exeFromInstallDir,
  expandEnv,
  parseRegQueryDefault,
  pickObsExecutable,
  OBS_EXE_CANDIDATES_STEAM,
  OBS_LAUNCH_ARGS,
  OBS_EXE_CANDIDATES_WIN,
  OBS_REGISTRY_KEY
} from '../../src/shared/obs-paths'

/**
 * 自动拉起 OBS 守卫（T41）。
 * ① 路径探测：按顺序、展开环境变量、缺失变量判不可用、都不存在返回 null；
 * ② 启动参数为**官方参数数组**（不是拼接的命令行）；
 * ③ 服务实现**不得使用 shell**（红线：只传 exe + 参数数组，防注入）。
 */
const SERVICE = resolve(__dirname, '../../src/main/core/process/index.ts')

describe('OBS 路径探测与启动（T41）', () => {
  it('① 展开 %VAR% 并返回第一个存在的候选', () => {
    const env = { ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\LA' }
    expect(expandEnv('%ProgramFiles%\\obs-studio\\bin\\64bit\\obs64.exe', env)).toBe(
      'C:\\PF\\obs-studio\\bin\\64bit\\obs64.exe'
    )
    expect(expandEnv('%NOT_SET%\\x.exe', env), '未定义变量整体不可用').toBe('')

    // 注意：exists 收到的是**已展开**的路径（不再含 %VAR% 字面量）
    const exists = (p: string): boolean => p.startsWith('C:\\PF\\') || p.startsWith('C:\\LA\\')
    const picked = pickObsExecutable(['%NOT_SET%\\a.exe', '%LOCALAPPDATA%\\b.exe'], env, exists)
    expect(picked).toBe('C:\\LA\\b.exe')
    expect(pickObsExecutable(OBS_EXE_CANDIDATES_WIN, {}, () => false)).toBeNull()
  })

  it('①b 注册表兜底：能解析 Steam/自定义安装目录并拼出可执行文件路径（用户真实场景）', () => {
    // 用户机器实测输出（Steam 版）：默认值就是安装目录
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\OBS Studio\r\n    (默认)    REG_SZ    D:\\steam1\\steamapps\\common\\OBS Studio\r\n\r\n'
    const dir = parseRegQueryDefault(out)
    expect(dir, '应解析出安装目录').toBe('D:\\steam1\\steamapps\\common\\OBS Studio')
    expect(exeFromInstallDir(dir!)).toBe('D:\\steam1\\steamapps\\common\\OBS Studio\\bin\\64bit\\obs64.exe')
    // 英文键名同样要认
    expect(parseRegQueryDefault('    (Default)    REG_SZ    C:\\OBS')).toBe('C:\\OBS')
    expect(parseRegQueryDefault('无有效行')).toBeNull()
    expect(exeFromInstallDir('')).toBe('')
    // 注册表键与 Steam 候选都必须存在
    expect(OBS_REGISTRY_KEY).toContain('OBS Studio')
    expect(OBS_EXE_CANDIDATES_STEAM.length).toBeGreaterThan(0)
    // 候选顺序：用户指定优先
    const all = buildObsCandidates(['D:\\custom\\obs64.exe'])
    expect(all[0]).toBe('D:\\custom\\obs64.exe')
    expect(all.length).toBeGreaterThan(1 + OBS_EXE_CANDIDATES_WIN.length)
  })

  it('①c 已在运行检测（中英文 tasklist 输出都要认）+ 路径去重 + 快捷方式名', () => {
    expect(
      isObsProcessListed('obs64.exe                     1234 Console                    1    123,456 K')
    ).toBe(true)
    expect(isObsProcessListed('信息: 没有运行的任务匹配指定标准。')).toBe(false)
    expect(isObsProcessListed('INFO: No tasks are running which match the specified criteria.')).toBe(false)
    expect(dedupePaths(['A\\x.exe', 'a\\X.EXE', '', 'B\\y.exe'])).toEqual(['A\\x.exe', 'B\\y.exe'])
    expect(OBS_SHORTCUT_NAMES.some((n) => n.toLowerCase().includes('obs'))).toBe(true)
  })

  it('② 启动参数是官方参数数组（不含 shell 元字符）', () => {
    expect(OBS_LAUNCH_ARGS).toContain('--disable-shutdown-check')
    for (const a of OBS_LAUNCH_ARGS) {
      expect(a, `参数不应含 shell 元字符：${a}`).not.toMatch(/[;&|`$><]/)
    }
  })

  it('③ 进程服务不得用 shell，且必须 detached + unref（退出软件默认保留）', async () => {
    const src = await readFile(SERVICE, 'utf8')
    expect(src, '红线：不得使用 shell').not.toMatch(/shell:\s*true/)
    expect(src, '红线：不得拼接命令行字符串').not.toMatch(/exec\(|execSync/)
    expect(src, '必须 detached（与本软件进程组解耦）').toContain('detached: true')
    expect(src, '必须 unref（否则会拖住退出）').toContain('unref()')
  })
})
