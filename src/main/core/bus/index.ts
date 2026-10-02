import type { ILogger } from '@contracts/logger'
import type {
  CoreEvent,
  EventHandler,
  IEventBus,
  PublishOptions,
  Unsubscribe
} from '@contracts/event'

/**
 * Core event bus — the only legal communication channel between modules.
 *
 * - Pure router: types and payloads are never interpreted here.
 * - Sync dispatch: `publish` runs handlers before returning, in
 *   registration order, over a snapshot (mid-dispatch subscribe/unsubscribe
 *   does not affect the current round).
 * - Async dispatch: `publishAsync` queues the whole dispatch on a microtask;
 *   consecutive async publishes keep FIFO order and the returned promise
 *   resolves after dispatch.
 * - Fault isolation: a throwing subscriber is logged and skipped — it can
 *   never affect the publisher or sibling subscribers.
 * - userId: the bus may stamp a default local user id; no id generation,
 *   no account system (anonymous by default).
 */

export interface EventBusOptions {
  /** Core logger (handler failures are reported here). */
  logger: ILogger
  /** Optional local user id stamped on every event unless overridden. */
  userId?: string
  /** Injectable clock (tests). */
  clock?: () => number
}

export function createEventBus(options: EventBusOptions): IEventBus {
  const log = options.logger.child('bus')
  const clock = options.clock ?? Date.now
  const handlers = new Map<string, Set<EventHandler<unknown>>>()

  function dispatch(event: CoreEvent<unknown>): void {
    const set = handlers.get(event.type)
    if (!set) return
    // Snapshot keeps the current round stable against concurrent changes.
    for (const handler of [...set]) {
      try {
        handler(event)
      } catch (e) {
        log.error('event handler threw', { type: event.type, error: String(e) })
      }
    }
  }

  function buildEvent<T>(
    type: string,
    payload: T | undefined,
    o: PublishOptions | undefined
  ): CoreEvent<T> {
    const event: CoreEvent<T> = {
      type,
      source: o?.source ?? 'core',
      time: clock(),
      version: o?.version ?? 1
    }
    if (payload !== undefined) event.payload = payload
    const uid = o?.userId ?? options.userId
    if (uid !== undefined) event.userId = uid
    return event
  }

  function subscribeImpl(type: string, handler: EventHandler<unknown>): Unsubscribe {
    let set = handlers.get(type)
    if (!set) {
      set = new Set()
      handlers.set(type, set)
    }
    // Set semantics: re-subscribing the same function is a no-op.
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  return {
    publish<T>(type: string, payload?: T, o?: PublishOptions): CoreEvent<T> {
      const event = buildEvent(type, payload, o)
      dispatch(event)
      return event
    },

    publishAsync<T>(type: string, payload?: T, o?: PublishOptions): Promise<CoreEvent<T>> {
      const event = buildEvent(type, payload, o)
      return new Promise<CoreEvent<T>>((resolve) => {
        queueMicrotask(() => {
          dispatch(event)
          resolve(event)
        })
      })
    },

    subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe {
      return subscribeImpl(type, handler as EventHandler<unknown>)
    },

    once<T>(type: string, handler: EventHandler<T>): Unsubscribe {
      let off: Unsubscribe = () => {}
      const wrapper: EventHandler<unknown> = (event) => {
        // Consume the subscription even if the handler itself throws.
        off()
        ;(handler as EventHandler<unknown>)(event)
      }
      off = subscribeImpl(type, wrapper)
      return off
    }
  }
}
