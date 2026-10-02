import { describe, expect, it } from 'vitest'
import { monitorHint, nextState, pickVirtualCamera } from '../../src/renderer/src/obs-monitor'

/**
 * 监看纯逻辑守卫（T42）：
 * ① 虚拟摄像头按**关键字**匹配（不同 OBS 版本/语言的设备名不同，不能用固定 deviceId）；
 * ② 启停**幂等**（重复 start 不会叠加流；stop 回到 idle）；
 * ③ 无设备/失败时给出**可操作**的中文提示（而不是空白）。
 */
describe('监看逻辑（T42）', () => {
  it('① 按关键字识别 OBS 虚拟摄像头（大小写与中英文都要认）', () => {
    expect(pickVirtualCamera([{ deviceId: 'a', label: 'HD Webcam' }])).toBeNull()
    expect(pickVirtualCamera([{ deviceId: 'b', label: 'OBS Virtual Camera' }])?.deviceId).toBe('b')
    expect(pickVirtualCamera([{ deviceId: 'c', label: 'obs virtual camera (v2)' }])?.deviceId).toBe('c')
    expect(pickVirtualCamera([{ deviceId: 'd', label: 'OBS 虚拟摄像头' }])?.deviceId).toBe('d')
  })

  it('② 启停状态机幂等', () => {
    expect(nextState('idle', 'start')).toBe('starting')
    expect(nextState('live', 'start')).toBe('live') // 已在监看：重复点不叠加
    expect(nextState('starting', 'started')).toBe('live')
    expect(nextState('live', 'stop')).toBe('idle')
    expect(nextState('starting', 'failed')).toBe('failed')
  })

  it('③ 提示可操作（无设备时给出"去 OBS 开虚拟摄像头"的指引）', () => {
    expect(monitorHint('idle', false)).toContain('启动虚拟摄像头')
    expect(monitorHint('failed', true)).toContain('虚拟摄像头可用')
    expect(monitorHint('live', true)).toContain('不影响直播输出')
  })
})
