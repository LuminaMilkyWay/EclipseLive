/**
 * OBS 可执行文件定位（T41，**纯逻辑**：无 fs、无 Node API ⇒ 可单测）。
 *
 * 设计（docs/OBS-STREAM-CONTROL-ASSESSMENT.md §4）：
 * - **不查注册表**（省权限与依赖，收益与成本不成比例）；
 * - 顺序：用户已保存的路径 → 常见安装路径候选 → 环境变量 `OBS_EXE` → 交给用户手动指定；
 * - 平台差异由调用方把候选表按平台传入（本文件只提供 Windows 默认表与选取逻辑）。
 */

/** Windows 下常见的 OBS 安装位置（按优先级）。 */
export const OBS_EXE_CANDIDATES_WIN: readonly string[] = [
  '%ProgramFiles%\\obs-studio\\bin\\64bit\\obs64.exe',
  '%ProgramFiles(x86)%\\obs-studio\\bin\\64bit\\obs64.exe',
  '%LOCALAPPDATA%\\Programs\\obs-studio\\bin\\64bit\\obs64.exe',
  '%ProgramFiles%\\obs-studio\\bin\\32bit\\obs32.exe',
  '%ProgramFiles(x86)%\\obs-studio\\bin\\32bit\\obs32.exe'
]

/** 启动参数：官方命令行参数，避免"关机检查"弹窗。 */
export const OBS_LAUNCH_ARGS: readonly string[] = ['--disable-shutdown-check']

/**
 * 展开候选里的环境变量（`%VAR%`）并返回**第一个存在的**路径；都不存在返回 null。
 * `exists` 由调用方注入（主进程注入 `fs.existsSync`；测试注入假函数）。
 */
export function pickObsExecutable(
  candidates: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  exists: (p: string) => boolean
): string | null {
  for (const raw of candidates) {
    const expanded = expandEnv(raw, env)
    if (expanded !== '' && exists(expanded)) return expanded
  }
  return null
}

/** 展开 `%VAR%`（Windows 风格；未定义的变量整体判为不可用）。 */
export function expandEnv(template: string, env: Readonly<Record<string, string | undefined>>): string {
  let missing = false
  const out = template.replace(/%([^%]+)%/g, (_m, name: string) => {
    const v = env[name]
    if (v === undefined || v === '') {
      missing = true
      return ''
    }
    return v
  })
  return missing ? '' : out
}

/* ==========================================================================
 * T41 增量 2：真实用户反馈「实例拉起不了 OBS」的诊断结果 ——
 * 用户机器上的 OBS 是 **Steam 版**，装在 `D:\steam1\steamapps\common\OBS Studio`
 * （注册表 `HKLM\SOFTWARE\OBS Studio` 的默认值里就写着这个目录），
 * 而最初的候选只覆盖 Program Files / LOCALAPPDATA ⇒ 5 个候选全部不存在 ⇒ 拉起失败。
 * 补齐：注册表定位（Steam/自定义安装的标准做法）+ Steam 常见路径 + 用户手动指定。
 * 仍然**不使用 shell**：查询用 `reg.exe` 程序本身，参数以数组传入。
 * ========================================================================== */

/** OBS 官方安装器写入注册表的键（默认值 = 安装目录）。 */
export const OBS_REGISTRY_KEY = 'HKLM\\SOFTWARE\\OBS Studio'

/** Steam 版 OBS 的常见位置（库目录可通过 `libraryfolders.vdf` 变化，这里覆盖默认库）。 */
export const OBS_EXE_CANDIDATES_STEAM: readonly string[] = [
  '%ProgramFiles(x86)%\\Steam\\steamapps\\common\\OBS Studio\\bin\\64bit\\obs64.exe',
  '%ProgramFiles%\\Steam\\steamapps\\common\\OBS Studio\\bin\\64bit\\obs64.exe'
]

/** 把注册表默认值（安装目录）拼成可执行文件路径候选。 */
export function exeFromInstallDir(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '')
  return trimmed === '' ? '' : `${trimmed}\\bin\\64bit\\obs64.exe`
}

/**
 * 解析 `reg query "<key>" /ve` 的输出，取 `(默认)` / `(Default)` 的值（安装目录）。
 * 样例行：`    (默认)    REG_SZ    D:\steam1\steamapps\common\OBS Studio`
 */
export function parseRegQueryDefault(stdout: string): string | null {
  // ⚠️ 不依赖表头文字：中文系统上 reg.exe 的输出是 GBK，`(默认)` 经 utf8 解码会变成乱码
  // ⇒ 只要一行里有 `REG_SZ`，就取其后第一个非空字段作为值（更稳，且与语言/编码无关）。
  for (const line of stdout.split(/\r?\n/)) {
    const m = /REG_SZ\s+(.+?)\s*$/i.exec(line)
    if (m) return m[1].trim()
  }
  return null
}


/** 汇总所有候选（顺序即优先级）：用户已保存 → 常见安装 → Steam → 注册表安装目录。 */
export function buildObsCandidates(extra: readonly string[] = []): string[] {
  return [...extra, ...OBS_EXE_CANDIDATES_WIN, ...OBS_EXE_CANDIDATES_STEAM]
}

/**
 * 桌面/开始菜单里常见的 OBS 快捷方式名（T41 增量 3）。
 * 用户实测：机器上有**两个** OBS（一个桌面快捷方式 + Steam 版）⇒ 必须支持多实例发现，
 * 并用 Electron 自带的 `shell.readShortcutLink` 解析 `.lnk` 目标（**零新依赖**）。
 */
export const OBS_SHORTCUT_NAMES: readonly string[] = ['OBS Studio.lnk', 'OBS.lnk']

/** 快捷方式所在的常见目录（相对用户目录/公共目录）。 */
export const OBS_SHORTCUT_DIRS: readonly string[] = ['Desktop', 'OneDrive\\Desktop', 'OneDrive\\桌面', '桌面']

/** 去重并保持顺序（多实例发现时用）。 */
export function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = p.toLowerCase()
    if (p !== '' && !seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/** OBS 进程名（用于"已在运行就不重复启动"的检测）。 */
export const OBS_PROCESS_NAMES: readonly string[] = ['obs64.exe', 'obs32.exe']

/**
 * 解析 `tasklist /FI "IMAGENAME eq obs64.exe" /NH` 的输出，判断进程是否在运行。
 * 样例（运行中）：`obs64.exe                     1234 Console                    1    123,456 K`
 * 样例（未运行）：`信息: 没有运行的任务匹配指定标准。`（中文系统）
 */
export function isObsProcessListed(stdout: string): boolean {
  const lower = stdout.toLowerCase()
  return OBS_PROCESS_NAMES.some((n) => lower.includes(n))
}
