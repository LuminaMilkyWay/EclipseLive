/**
 * OBS 请求构造与脱敏（**纯逻辑**，便于单测；T40）。
 *
 * 来源：docs/OBS-STREAM-CONTROL-ASSESSMENT.md §2/§6-2；契约：src/contracts/obs.ts（T8 已就绪）。
 * 凭据路线 **B**（用户批准）：串流密钥**直接下发给 OBS**，本软件**不落盘**；
 * 因此这里只负责"把命令拼对"，并且**任何进入日志/诊断的字符串都必须先脱敏**。
 */

/** obs-websocket v5 请求体。 */
export interface ObsRequest {
  requestType: string
  requestData?: unknown
}

/** 场景列表（返回 scenes[] 与 currentProgramSceneName）。 */
export function requestSceneList(): ObsRequest {
  return { requestType: 'GetSceneList' }
}

/** 切换当前节目场景。 */
export function requestSetScene(sceneName: string): ObsRequest {
  return { requestType: 'SetCurrentProgramScene', requestData: { sceneName } }
}

/** 开播 / 停机。 */
export function requestStartStream(): ObsRequest {
  return { requestType: 'StartStream' }
}
export function requestStopStream(): ObsRequest {
  return { requestType: 'StopStream' }
}

/** 推流状态（outputActive / outputReconnecting / outputTimecode …）。 */
export function requestStreamStatus(): ObsRequest {
  return { requestType: 'GetStreamStatus' }
}

/**
 * 下发推流服务配置（自定义 RTMP）。
 * ⚠️ 返回值与入参都含密钥 ⇒ 调用方**不得**把它写进日志/诊断（见 redact）。
 */
export function requestSetStreamService(server: string, key: string): ObsRequest {
  return {
    requestType: 'SetStreamServiceSettings',
    requestData: {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server, key }
    }
  }
}

/** 虚拟摄像头开关（监看方案 A 依赖它）。 */
export function requestStartVirtualCam(): ObsRequest {
  return { requestType: 'StartVirtualCam' }
}
export function requestStopVirtualCam(): ObsRequest {
  return { requestType: 'StopVirtualCam' }
}

/** 只含服务器、不含密钥的展示用摘要（用于日志与界面回显）。 */
export function streamServerSummary(server: string): string {
  return server.trim() === '' ? '未设置服务器' : server.trim()
}

/** 密钥掩码（界面回显用；永不显示原文）。 */
export function maskKey(key: string): string {
  if (key.length === 0) return '（未设置）'
  return '•'.repeat(Math.min(key.length, 12))
}

/**
 * 脱敏：把任意值里可能出现的密钥替换掉，供日志/诊断使用。
 * 判定依据是**键名白名单**（key / streamKey / password / token），不是值的内容 ⇒ 不依赖运气。
 */
const SECRET_KEYS = ['key', 'streamKey', 'password', 'token', 'secret']

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.includes(k)) {
      out[k] = '***'
      continue
    }
    out[k] = typeof v === 'object' && v !== null ? redact(v) : v
  }
  return out
}

/** 脱敏后的字符串（用于日志行；保证不出现密钥原文）。 */
export function redactToString(value: unknown): string {
  try {
    return JSON.stringify(redact(value))
  } catch {
    return '[unserializable]'
  }
}
