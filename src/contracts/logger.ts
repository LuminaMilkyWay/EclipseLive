/**
 * Logging contract — the first standard interface of the contracts layer.
 *
 * Modules obtain a scoped logger from the core (T6 module manager will
 * hand each module its own child). All log meta data passes through the
 * core masking pipeline before it ever reaches a file: sensitive keys and
 * user-input keys (text/content/body) are replaced with "[MASKED]".
 */

/** Log severity levels in ascending order. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured metadata attached to a log call.
 * Keys that match the sensitive-key list are masked before serialization.
 */
export type LogMeta = Record<string, unknown>

/**
 * Uniform logger used by core services and modules.
 *
 * - `source` is hierarchical: child loggers append, e.g. "gateway:ws".
 * - `setLevel` affects the whole logger tree (bound to the root).
 */
export interface ILogger {
  /** Emit a debug line (dev diagnostics; suppressed at info level). */
  debug(message: string, data?: LogMeta): void
  /** Emit an info line. */
  info(message: string, data?: LogMeta): void
  /** Emit a warning line. */
  warn(message: string, data?: LogMeta): void
  /** Emit an error line. */
  error(message: string, data?: LogMeta): void
  /** Derive a logger with an appended source scope. */
  child(source: string): ILogger
  /** Change the minimum emitted level for this logger tree at runtime. */
  setLevel(level: LogLevel): void
}
