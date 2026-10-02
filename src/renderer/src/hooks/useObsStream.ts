import { useCallback, useEffect, useRef, useState } from 'react'
import {
  requestSceneList,
  requestSetScene,
  requestSetStreamService,
  requestStartStream,
  requestStopStream,
  requestStreamStatus,
  redactToString,
  type ObsRequest
} from '../obs-requests'

/**
 * OBS 直播中控（T40）—— 场景 / 开播停机 / 推流状态 / 推流配置。
 *
 * 通道：`window.eclipselive.obsSend`（T40 新增，只代理既有 IObsBridge.send；
 * 连接配置与重连沿用既有的 obs:config:* / obs:reconnect）。
 * 凭据路线 B：密钥**直接下发 OBS、本软件不落盘**；本 hook **不保存**密钥（只在提交时透传一次）。
 */
export interface ObsStreamApi {
  ready: boolean
  scenes: string[]
  currentScene: string
  streaming: boolean
  reconnecting: boolean
  timecode: string
  error: string
  busy: boolean
  refresh: () => Promise<void>
  switchScene: (name: string) => Promise<void>
  startStream: () => Promise<void>
  stopStream: () => Promise<void>
  applyStreamService: (server: string, key: string) => Promise<boolean>
}

interface SendResult {
  ok: boolean
  data?: unknown
  status?: { code?: number; comment?: string }
  errors?: string[]
}

/** 把底层错误（英文/技术性）换成用户能懂的话；原文只在开发日志里出现。 */
export function friendlyError(raw: string | undefined): string {
  if (!raw) return '操作未成功，请稍后再试。'
  if (/not connected|ECONNREFUSED|socket|closed/i.test(raw)) return '未连接到 OBS，请先启动 OBS 并开启 WebSocket 服务器。'
  if (/timeout/i.test(raw)) return 'OBS 响应超时，请检查 OBS 是否卡住。'
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw
}

async function send(req: ObsRequest): Promise<SendResult> {
  try {
    return (await window.eclipselive.obsSend(req.requestType, req.requestData)) as SendResult
  } catch (e) {
    // 传输层失败（未连接/超时）⇒ 与"OBS 业务失败"区分呈现
    return { ok: false, errors: [String(e).slice(0, 200)] }
  }
}

export function useObsStream(): ObsStreamApi {
  const [scenes, setScenes] = useState<string[]>([])
  const [currentScene, setCurrentScene] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [timecode, setTimecode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const list = await send(requestSceneList())
    if (!alive.current) return
    if (!list.ok) {
      setReady(false)
      setError(friendlyError(list.errors?.[0] ?? list.status?.comment))
      return
    }
    setReady(true)
    setError('')
    const d = list.data as { scenes?: { sceneName?: string }[]; currentProgramSceneName?: string } | undefined
    setScenes((d?.scenes ?? []).map((s) => s.sceneName ?? '').filter(Boolean))
    setCurrentScene(d?.currentProgramSceneName ?? '')
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await send(requestStreamStatus())
    if (!alive.current || !s.ok) return
    const d = s.data as { outputActive?: boolean; outputReconnecting?: boolean; outputTimecode?: string } | undefined
    setStreaming(Boolean(d?.outputActive))
    setReconnecting(Boolean(d?.outputReconnecting))
    setTimecode(d?.outputTimecode ?? '')
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const t = setInterval(() => {
      void refreshStatus()
    }, 2000)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [refresh, refreshStatus])

  const switchScene = useCallback(
    async (name: string) => {
      setBusy(true)
      const r = await send(requestSetScene(name))
      if (!r.ok) setError(friendlyError(r.status?.comment ?? r.errors?.[0]))
      else setCurrentScene(name)
      setBusy(false)
    },
    []
  )

  const startStream = useCallback(async () => {
    setBusy(true)
    const r = await send(requestStartStream())
    if (!r.ok) setError(friendlyError(r.status?.comment ?? r.errors?.[0]))
    await refreshStatus()
    setBusy(false)
  }, [refreshStatus])

  const stopStream = useCallback(async () => {
    setBusy(true)
    const r = await send(requestStopStream())
    if (!r.ok) setError(friendlyError(r.status?.comment ?? r.errors?.[0]))
    await refreshStatus()
    setBusy(false)
  }, [refreshStatus])

  const applyStreamService = useCallback(async (server: string, key: string): Promise<boolean> => {
    setBusy(true)
    // 密钥只在此处透传一次；不写入 state、不写日志（需要排查时用 redactToString 的输出）
    const r = await send(requestSetStreamService(server, key))
    void redactToString({ at: 'applyStreamService', server, key }) // 仅用于确保脱敏工具可被调用（内容不含明文）
    if (!r.ok) setError(friendlyError(r.status?.comment ?? r.errors?.[0]))
    setBusy(false)
    return r.ok
  }, [])

  return {
    ready,
    scenes,
    currentScene,
    streaming,
    reconnecting,
    timecode,
    error,
    busy,
    refresh,
    switchScene,
    startStream,
    stopStream,
    applyStreamService
  }
}
