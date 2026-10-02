import { describe, expect, it } from 'vitest'
import {
  maskKey,
  redact,
  redactToString,
  requestSceneList,
  requestSetScene,
  requestSetStreamService,
  requestStartStream,
  requestStopStream,
  requestStreamStatus,
  streamServerSummary
} from '../../src/renderer/src/obs-requests'

/**
 * OBS 请求构造与脱敏守卫（T40）。
 *
 * 依据：docs/OBS-STREAM-CONTROL-ASSESSMENT.md §2（命令面）与 §6-2（**推流密钥必须加密存储、
 * 禁止写入日志或诊断包**）。凭据路线 B：密钥直接下发 OBS、本软件不落盘 ⇒ 脱敏是最后一道闸。
 */
describe('OBS 请求构造', () => {
  it('命令名与参数形状正确（obs-websocket v5）', () => {
    expect(requestSceneList()).toEqual({ requestType: 'GetSceneList' })
    expect(requestSetScene('主场景')).toEqual({
      requestType: 'SetCurrentProgramScene',
      requestData: { sceneName: '主场景' }
    })
    expect(requestStartStream().requestType).toBe('StartStream')
    expect(requestStopStream().requestType).toBe('StopStream')
    expect(requestStreamStatus().requestType).toBe('GetStreamStatus')
  })

  it('推流服务配置为自定义 RTMP，且 server/key 结构符合 OBS 约定', () => {
    const r = requestSetStreamService('rtmp://live.example/app', 'STREAM-KEY-123')
    expect(r.requestType).toBe('SetStreamServiceSettings')
    expect(r.requestData).toEqual({
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: 'rtmp://live.example/app', key: 'STREAM-KEY-123' }
    })
  })

  it('展示用摘要与掩码都不含密钥原文', () => {
    expect(streamServerSummary('  rtmp://a/b ')).toBe('rtmp://a/b')
    expect(streamServerSummary('')).toBe('未设置服务器')
    const key = 'STREAM-KEY-123'
    const masked = maskKey(key)
    expect(masked).not.toContain(key)
    expect(maskKey('')).toBe('（未设置）')
  })
})

describe('脱敏（日志/诊断零明文）', () => {
  it('按键名白名单替换密钥类字段（含嵌套）', () => {
    const payload = {
      streamServiceSettings: { server: 'rtmp://a/b', key: 'KEY-AAA-111' },
      password: 'PWD-BBB-222',
      nested: { token: 'TOK-CCC-333', streamKey: 'SK-DDD-444' },
      safe: 'visible-value'
    }
    const out = redact(payload) as Record<string, unknown>
    const s = JSON.stringify(out)
    for (const secret of ['KEY-AAA-111', 'PWD-BBB-222', 'TOK-CCC-333', 'SK-DDD-444']) {
      expect(s, `脱敏后仍出现密钥：${secret}`).not.toContain(secret)
    }
    expect(s, '脱敏后的密钥位应替换为 ***').toContain('***')
    expect(s, '非密钥字段应保留（便于排查）').toContain('visible-value')
    expect(s, '服务器地址不是密钥，保留').toContain('rtmp://a/b')
  })

  it('redactToString 对任意输入都不抛、且不含密钥', () => {
    expect(redactToString({ key: 'K1' })).not.toContain('K1')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => redactToString(circular)).not.toThrow()
  })
})
