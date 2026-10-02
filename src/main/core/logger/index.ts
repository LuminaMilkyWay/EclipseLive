import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ILogger, LogLevel, LogMeta } from '@contracts/logger'

/**
 * Core file-backed logger.
 *
 * - Single uniform line: `<ISO> [level] [source] message :: {masked-json}`
 * - Daily rotation by file name; retention cleanup deletes only files
 *   matching our own prefix pattern.
 * - Masking is mandatory and happens before serialization: sensitive keys
 *   and user-input keys (text/content/body) never reach disk.
 * - File I/O runs on a serialized async queue and can never crash the app.
 */

export interface LoggerOptions {
  /** Directory where dated log files are written. */
  dir: string
  /** Minimum emitted level. Default 'info'. */
  level?: LogLevel
  /** Daily files to keep. Default 14. */
  retentionDays?: number
  /** Echo lines to stdout as well. Default true. */
  echoConsole?: boolean
  /** Injectable clock (tests). Default real time. */
  clock?: () => Date
  /** Log file name prefix. Default 'eclipselive'. */
  prefix?: string
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_DEPTH = 4
const MAX_STRING = 200

/** Exact (normalized) sensitive keys. */
const EXACT_SENSITIVE = new Set([
  'password', 'passwd', 'pwd', 'secret', 'token', 'credential', 'credentials',
  'authorization', 'authkey', 'apikey', 'session',
  // 需求红线：用户输入的文本内容不落盘，只记录事件元数据。
  'text', 'content', 'body'
])

/** Composite keys ending in these are also sensitive (e.g. userToken, api_key). */
const SENSITIVE_SUFFIX = ['password', 'token', 'secret', 'apikey', 'credential', 'passphrase']

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (EXACT_SENSITIVE.has(k)) return true
  return SENSITIVE_SUFFIX.some((s) => k.length > s.length && k.endsWith(s))
}

/**
 * Recursively mask sensitive keys and clamp log-payload size.
 * Exported for unit tests only; modules must not pre-mask data themselves.
 */
export function maskData(data: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[DEPTH]'
  if (data === null || data === undefined) return data
  if (typeof data === 'string') {
    return data.length > MAX_STRING ? `${data.slice(0, MAX_STRING)}…` : data
  }
  if (Array.isArray(data)) return data.map((v) => maskData(v, depth + 1))
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[MASKED]' : maskData(v, depth + 1)
    }
    return out
  }
  return data
}

function squeeze(message: string): string {
  return message.replace(/[\r\n]+/g, ' ')
}

function formatLine(now: Date, level: LogLevel, source: string, message: string, data?: LogMeta): string {
  let line = `${now.toISOString()} [${level}] [${source}] ${squeeze(String(message))}`
  if (data !== undefined) line += ` :: ${JSON.stringify(maskData(data))}`
  return line
}

function echoLine(level: LogLevel, line: string): void {
  if (level === 'warn') console.warn(line)
  else if (level === 'error') console.error(line)
  else console.log(line)
}

export function createLogger(options: LoggerOptions): ILogger & { flush(): Promise<void> } {
  const prefix = options.prefix ?? 'eclipselive'
  const retention = options.retentionDays ?? 14
  const echo = options.echoConsole ?? true
  const clock = options.clock ?? (() => new Date())
  let minLevel = LEVEL_ORDER[options.level ?? 'info']
  let queue: Promise<unknown> = Promise.resolve()
  let lastFile = ''
  let dirReady = false

  const fileFor = (d: Date): string => `${prefix}-${d.toISOString().slice(0, 10)}.log`

  async function cleanup(): Promise<void> {
    try {
      const pattern = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.log$`)
      const cutoff = new Date(clock().getTime() - retention * 86_400_000).toISOString().slice(0, 10)
      for (const f of await readdir(options.dir)) {
        const m = pattern.exec(f)
        if (m && m[1] < cutoff) {
          try { await unlink(join(options.dir, f)) } catch { /* already gone */ }
        }
      }
    } catch {
      /* dir not ready or unreadable — never fatal */
    }
  }

  function write(line: string): void {
    queue = queue.then(async () => {
      const file = fileFor(clock())
      const isNewFile = file !== lastFile
      if (isNewFile && !dirReady) {
        lastFile = file
        try {
          await mkdir(options.dir, { recursive: true })
          dirReady = true
        } catch (e) {
          console.warn('[logger] cannot create log dir:', e)
          return
        }
      }
      try {
        await appendFile(join(options.dir, file), line + '\n', 'utf8')
      } catch (e) {
        // File write failure must never propagate to callers.
        console.warn('[logger] write failed:', e)
        return
      }
      if (isNewFile) {
        lastFile = file
        await cleanup()
      }
    })
  }

  function makeLogger(source: string, isRoot: boolean): ILogger & { flush(): Promise<void> } {
    const emit = (level: LogLevel, message: string, data?: LogMeta): void => {
      if (LEVEL_ORDER[level] < minLevel) return
      const line = formatLine(clock(), level, source, message, data)
      if (echo) echoLine(level, line)
      write(line)
    }
    return {
      debug: (m, d) => emit('debug', m, d),
      info: (m, d) => emit('info', m, d),
      warn: (m, d) => emit('warn', m, d),
      error: (m, d) => emit('error', m, d),
      // Direct children of the root get a bare source (e.g. "gateway");
      // only the root itself logs as "core".
      child: (s) => makeLogger(isRoot ? s : `${source}:${s}`, false),
      setLevel: (level) => { minLevel = LEVEL_ORDER[level] },
      flush: async () => { await queue }
    }
  }

  // Chained so the first flush() also awaits initial retention cleanup.
  queue = queue.then(() => cleanup())

  return makeLogger('core', true)
}
