// S1 实机计时 · 纯逻辑 spec（#2040）：进入→计时→收口；刷新不重计；>5 分钟黄标；
// 零写回红线（工具不接触任何单据字段——只有 sessionStorage 时间戳一个副作用面）。
// @vitest-environment happy-dom（services 目录缺省 node 环境，本 spec 需要 sessionStorage）
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  markS1Started,
  readStartedAt,
  s1ElapsedOnComplete,
  s1TimerKey,
  s1TimerView,
  DEFAULT_S1_SLOW_MINUTES
} from './stageTimer'

const NOW = Date.UTC(2026, 7, 18, 1, 0, 0) // 2026-08-18T01:00Z

beforeEach(() => {
  sessionStorage.clear()
})

describe('markS1Started / readStartedAt', () => {
  it('记进入时间戳；重复调用不重计（刷新/重进保留首记）', () => {
    const first = markS1Started('decl-1', '2026-08-18', NOW)
    expect(first).toBe(NOW)
    expect(markS1Started('decl-1', '2026-08-18', NOW + 120_000)).toBe(NOW)
    expect(readStartedAt('decl-1', '2026-08-18')).toBe(NOW)
  })

  it('per 申报单 + 日期隔离：跨单/跨日互不串读', () => {
    markS1Started('decl-1', '2026-08-18', NOW)
    expect(readStartedAt('decl-2', '2026-08-18')).toBeNull()
    expect(readStartedAt('decl-1', '2026-08-19')).toBeNull()
    expect(s1TimerKey('decl-1', '2026-08-18')).not.toBe(s1TimerKey('decl-1', '2026-08-19'))
  })
})

describe('s1TimerView', () => {
  it('未开始计时：null/null/不慢', () => {
    expect(s1TimerView('decl-1', '2026-08-18', { now: NOW })).toEqual({
      startedAt: null,
      elapsedMinutes: null,
      slow: false
    })
  })

  it('4 分钟：不慢；6 分钟：黄标（缺省阈值 5 分钟）', () => {
    markS1Started('decl-1', '2026-08-18', NOW)
    const fast = s1TimerView('decl-1', '2026-08-18', { now: NOW + 4 * 60_000 })
    expect(fast.elapsedMinutes).toBe(4)
    expect(fast.slow).toBe(false)
    const slow = s1TimerView('decl-1', '2026-08-18', { now: NOW + 6 * 60_000 })
    expect(slow.elapsedMinutes).toBe(6)
    expect(slow.slow).toBe(true)
    expect(DEFAULT_S1_SLOW_MINUTES).toBe(5)
  })

  it('跨过 30 秒即算 1 分钟在途（向上取整口径）', () => {
    markS1Started('decl-1', '2026-08-18', NOW)
    expect(s1TimerView('decl-1', '2026-08-18', { now: NOW + 31_000 }).elapsedMinutes).toBe(1)
  })
})

describe('s1ElapsedOnComplete', () => {
  it('writeBack 收口读数=elapsed；只读不写（零写回）', () => {
    markS1Started('decl-1', '2026-08-18', NOW)
    expect(s1ElapsedOnComplete('decl-1', '2026-08-18', { now: NOW + 7 * 60_000 })).toBe(7)
    // 未开始的单：null（不编造数值）
    expect(s1ElapsedOnComplete('decl-x', '2026-08-18', { now: NOW })).toBeNull()
  })
})

describe('存储不可用降级', () => {
  it('sessionStorage 抛错不炸：读 null、记仍返回 now（内存口径）', () => {
    const spy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota')
    })
    expect(markS1Started('decl-1', '2026-08-18', NOW)).toBe(NOW)
    expect(readStartedAt('decl-1', '2026-08-18')).toBeNull()
    spy.mockRestore()
  })
})
