// 策略复盘传输层测试（#2016）：stats 信封（{strategies:[…]}）解析、行归一、探针降级
// @vitest-environment happy-dom（经 agentClient → regionContext 顶层读 window.localStorage）
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchMemoryOutcomes, fetchStrategyStats } from './strategyReviewClient'

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchStrategyStats', () => {
  it('Node 信封 {code,msg,data:{strategies:[…]}} → 逐行归一（含样本门禁字段）', async () => {
    const spy = mockFetch(200, {
      code: 200,
      msg: 'ok',
      data: {
        strategies: [
          { strategyName: '两充两放', wins: 24, losses: 16, sampleSize: 40, posteriorWinRate: 0.6, winRate: 0.6, winRateConclusion: null, cumulativePnlWan: 12.5 },
          { strategy_name: '价差套利', wins: 5, losses: 5, sampleSize: 10, posteriorWinRate: 0.5, winRate: null, winRateConclusion: '样本不足', cumulativePnlWan: -1.2 }
        ]
      }
    })
    const feed = await fetchStrategyStats()
    expect(feed.available).toBe(true)
    if (!feed.available) return
    expect(feed.stats).toHaveLength(2)
    expect(feed.stats[0]).toMatchObject({ strategyName: '两充两放', winRate: 0.6, sampleSize: 40 })
    expect(feed.stats[1]).toMatchObject({ strategyName: '价差套利', winRate: null })
    expect(spy.mock.calls[0][0]).toContain('/review/trading-memory/stats')
  })

  it('404/HTML → endpoint-absent 诚实降级；网络异常 → unreachable', async () => {
    mockFetch(404, null)
    expect(await fetchStrategyStats()).toEqual({ available: false, reason: 'endpoint-absent' })
    mockFetch(200, '<html>login</html>')
    expect(await fetchStrategyStats()).toEqual({ available: false, reason: 'endpoint-absent' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'))
    expect(await fetchStrategyStats()).toEqual({ available: false, reason: 'unreachable' })
  })
})

describe('fetchMemoryOutcomes', () => {
  it('裸行数组 → camelCase 归一；snake_case 容忍', async () => {
    mockFetch(200, {
      code: 200,
      msg: 'ok',
      data: [
        { id: 3, strategyName: '两充两放', date: '2026-08-24', win: true, realizedPnlWan: 1.5 },
        { id: 4, strategy_name: '价差套利', date: '2026-08-25', win: false, realized_pnl_wan: -0.5 }
      ]
    })
    const feed = await fetchMemoryOutcomes()
    expect(feed.available).toBe(true)
    if (!feed.available) return
    expect(feed.outcomes).toEqual([
      { id: '3', strategyName: '两充两放', date: '2026-08-24', win: true, realizedPnlWan: 1.5 },
      { id: '4', strategyName: '价差套利', date: '2026-08-25', win: false, realizedPnlWan: -0.5 }
    ])
  })

  it('401 → unauthorized（不合成空胜率）', async () => {
    mockFetch(401, null)
    expect(await fetchMemoryOutcomes()).toEqual({ available: false, reason: 'unauthorized' })
  })
})
