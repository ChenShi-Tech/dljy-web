// S1 风险复盘纯逻辑测试（Epic #2033 · #2015）
// 守的不变量：提醒只在「near_miss 未评估 / 处置缺失 / 有效性未回查」时触发（已闭环不打扰）；
// 昨日窗口半开区间过滤；data_gap 口径文案常驻不静默。
// 坏掉的症状：昨日有侥幸逃过未评估却不出提醒（侥幸被忽略），或 data_gap 文案缺失
// （页面假装全面监测）——两者都直接违背 #2015 验收条款。
// 关联：dljy#2015（六维⑤）；父任务 dljy#1961。
import { describe, expect, it } from 'vitest'
import {
  beijingDayStartUtc,
  eventsInWindow,
  NODE_PRICE_SPIKE_DATA_GAP_NOTE,
  riskDimSummary,
  riskReviewReminder,
  STOP_LOSS_DATA_GAP_NOTE
} from './morningRiskReview'
import type { RiskEventSummary } from './reviewStoreApi'

function ev(over: Partial<RiskEventSummary> = {}): RiskEventSummary {
  return {
    id: '1',
    eventTime: '2026-08-25T10:00:00Z',
    eventType: 'price_anomaly',
    riskLevel: 'medium',
    impactYuan: null,
    impactCaliber: null,
    nearMiss: false,
    disposal: null,
    effective: null,
    lessons: null,
    extremeValue: null,
    durationHours: null,
    positionSnapshot: null,
    updatedAt: null,
    ...over,
  }
}

describe('eventsInWindow（昨日窗口，半开区间）', () => {
  it('[since, until)：含 since、不含 until；ISO 字符串序即可', () => {
    const rows = [
      ev({ id: 'a', eventTime: '2026-08-25T00:00:00Z' }),
      ev({ id: 'b', eventTime: '2026-08-25T23:59:59Z' }),
      ev({ id: 'c', eventTime: '2026-08-26T00:00:00Z' }),
      ev({ id: 'd', eventTime: '2026-08-24T23:59:59Z' }),
    ]
    const win = eventsInWindow(rows, '2026-08-25T00:00:00Z', '2026-08-26T00:00:00Z')
    expect(win.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('beijingDayStartUtc（北京日界→UTC 瞬时）', () => {
  it('北京 00:00 = 前一日 16:00Z；窗口按北京日界收（昨日 0-8 点的事件不再漏）', () => {
    expect(beijingDayStartUtc('2026-08-25')).toBe('2026-08-24T16:00:00.000Z')
    // 北京昨日 06:00 = 2026-08-25T22:00Z（前一日的 22:00Z）——旧 UTC 边界会漏掉它
    const rows = [
      ev({ id: 'early', eventTime: '2026-08-25T22:00:00.000Z' }), // 北京 26日06:00 → 不属于 25 日窗口
      ev({ id: 'd25', eventTime: '2026-08-24T20:00:00.000Z' }),   // 北京 25日04:00 → 属于
      ev({ id: 'd26', eventTime: '2026-08-25T17:00:00.000Z' }),   // 北京 26日01:00 → 不属于（旧边界会错收）
    ]
    const win = eventsInWindow(rows, beijingDayStartUtc('2026-08-25'), beijingDayStartUtc('2026-08-26'))
    expect(win.map((e) => e.id)).toEqual(['d25'])
  })
})

describe('riskReviewReminder（回顾提醒判定）', () => {
  it('near_miss 未评估 → 提醒；near_miss 已评估 → 不提醒（预判或运气已说清）', () => {
    const r1 = riskReviewReminder([ev({ id: '1', nearMiss: true, effective: null })])
    expect(r1.notes).toHaveLength(1)
    expect(r1.notes[0]).toContain('侥幸逃过')
    expect(r1.hasNearMiss).toBe(true)
    expect(r1.nearMissCount).toBe(1)
    const r2 = riskReviewReminder([ev({ id: '1', nearMiss: true, effective: true, disposal: '切换申报' })])
    expect(r2.notes).toHaveLength(0)
    expect(r2.hasNearMiss).toBe(true) // 标注仍在（呈现在事件表），只是不催办
  })

  it('near_miss 已评估但处置为空 → 处置缺失提醒（已评估≠已闭环，不再静默跳过）', () => {
    const r = riskReviewReminder([ev({ id: '1', nearMiss: true, effective: false, disposal: null })])
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toContain('未填处置')
    // 未评估的 near_miss 只出专属提醒，不叠加处置缺失（同一事件不催两次）
    const r2 = riskReviewReminder([ev({ id: '2', nearMiss: true, effective: null, disposal: null })])
    expect(r2.notes).toHaveLength(1)
    expect(r2.notes[0]).toContain('侥幸逃过')
  })

  it('常规事件：未填处置 / 处置已填有效性未回查 → 分别提醒；全闭环 → 零提醒', () => {
    const r = riskReviewReminder([
      ev({ id: '1', disposal: null }),
      ev({ id: '2', disposal: 'x', effective: null }),
    ])
    expect(r.notes).toHaveLength(2)
    expect(r.notes.some((n) => n.includes('未填处置'))).toBe(true)
    expect(r.notes.some((n) => n.includes('有效性未回查'))).toBe(true)
    const ok = riskReviewReminder([ev({ id: '3', disposal: 'x', effective: false })])
    expect(ok.notes).toHaveLength(0)
  })

  it('空事件 → 零提醒零标注', () => {
    const r = riskReviewReminder([])
    expect(r).toEqual({ notes: [], hasNearMiss: false, nearMissCount: 0, total: 0 })
  })
})

describe('riskDimSummary（六维⑤维）', () => {
  it('服务不可用 → 不 ready；平安日 → ready；有事件带计数与待回顾', () => {
    expect(riskDimSummary({ available: false }, riskReviewReminder([]))).toEqual({ summary: '风险事件服务不可用', ready: false })
    expect(riskDimSummary({ available: true }, riskReviewReminder([])).summary).toContain('平安日')
    const r = riskReviewReminder([
      ev({ id: '1', nearMiss: true, effective: null }),
      ev({ id: '2', disposal: 'x', effective: null }),
    ])
    const d = riskDimSummary({ available: true }, r)
    expect(d.ready).toBe(true)
    expect(d.summary).toContain('2 起风险事件')
    expect(d.summary).toContain('侥幸逃过 1 起')
    expect(d.summary).toContain('有待回顾项')
  })
})

describe('data_gap 口径红线（不装作在监测）', () => {
  it('两项无源监测的文案常驻且明说 data_gap', () => {
    expect(NODE_PRICE_SPIKE_DATA_GAP_NOTE).toContain('data_gap')
    expect(NODE_PRICE_SPIKE_DATA_GAP_NOTE).toContain('人工登记')
    expect(STOP_LOSS_DATA_GAP_NOTE).toContain('data_gap')
    expect(STOP_LOSS_DATA_GAP_NOTE).toContain('未在监测')
  })
})
