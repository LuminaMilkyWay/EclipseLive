import type { ILogger } from '@contracts/logger'
import type {
  INetworkClient,
  NetworkDiagnostics,
  NetworkRequestOptions,
  NetworkResponse
} from '@contracts/network'

/**
 * Unified network client — LOCAL EMPTY implementation (T9).
 *
 * Every outbound request rejects: no cloud endpoints exist (local-first red
 * line, requirement: "当前只定义接口和本地空实现，不接入任何云端点"). Wiring a
 * real endpoint requires a core change behind explicit user consent — it
 * cannot happen by accident through a module.
 */

const REJECTION =
  'local-first: no cloud endpoints are configured — the unified network client is interface-only in T9'

export interface NetworkClientOptions {
  logger: ILogger
}

export function createNetworkClient(options: NetworkClientOptions): INetworkClient {
  const log = options.logger.child('network')
  let rejected = 0
  let lastRejection: string | undefined

  return {
    request(_url: string, _requestOptions?: NetworkRequestOptions): Promise<NetworkResponse> {
      rejected += 1
      lastRejection = REJECTION
      log.warn('outbound request rejected (local-first red line)', { rejected })
      return Promise.reject(new Error(REJECTION))
    },

    diagnostics(): NetworkDiagnostics {
      return { mode: 'local-empty', rejected, lastRejection }
    }
  }
}
