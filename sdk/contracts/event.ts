/**
 * Event contract — the only legal communication channel between modules.
 *
 * The bus is a pure router: it never interprets types or payloads, keeps
 * handler order per subscription, isolates throwing subscribers, and stamps
 * every event with the standard envelope below.
 */

/**
 * Standard event envelope.
 *
 * - `type`   namespaced event name, e.g. "lifecycle:started".
 * - `source` publisher scope (module id or core service name; "core" default).
 * - `time`   epoch milliseconds.
 * - `version` payload format version (default 1). Old modules may keep
 *   publishing/consuming old versions — handlers check this field.
 * - `userId` reserved local user id (anonymous when absent; no account
 *   system is implemented).
 */
export interface CoreEvent<T = unknown> {
  type: string
  source: string
  time: number
  version: number
  payload?: T
  userId?: string
}

/** Options for a single publish call. */
export interface PublishOptions {
  /** Publisher scope; default "core". */
  source?: string
  /** Payload format version; default 1. */
  version?: number
  /** Override the bus-level user id for this event. */
  userId?: string
}

/** Receives dispatched events. */
export type EventHandler<T = unknown> = (event: CoreEvent<T>) => void

/** Removes a subscription; safe to call more than once. */
export type Unsubscribe = () => void

/**
 * In-process event bus.
 *
 * - `publish`      dispatches synchronously; returns the built event.
 * - `publishAsync` dispatches on a microtask (FIFO with other async
 *   publishes); the returned promise resolves after dispatch, so callers
 *   may await completion.
 * - `subscribe`    registers a handler (duplicate registration of the
 *   same function is collapsed to one subscription).
 * - `once`         fires at most once, then removes itself.
 *
 * A throwing subscriber is logged and skipped; it never affects the
 * publisher or sibling subscribers.
 */
export interface IEventBus {
  publish<T>(type: string, payload?: T, options?: PublishOptions): CoreEvent<T>
  publishAsync<T>(type: string, payload?: T, options?: PublishOptions): Promise<CoreEvent<T>>
  subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe
  once<T>(type: string, handler: EventHandler<T>): Unsubscribe
}
