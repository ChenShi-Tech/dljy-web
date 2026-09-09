import { describe, expect, it } from 'vitest'
import { declarationLabel, formatValue, matchesReviewScope, orderIntervals, platformIntervals, reviewGap } from './decisionWorkbench'
import type { DeclarationOrder } from '@/services/declarations'
import type { ReviewResult } from '@/services/quant/quantClient'

describe('复盘对象与分时口径', () => {
  it('缺失保持未知，真实零与负价可见', () => {
    expect(formatValue(null)).toBe('—'); expect(formatValue(NaN)).toBe('—')
    expect(formatValue(0)).toBe('0'); expect(formatValue(-12.5)).toBe('-12.5')
  })
  it('申报必须同日同地区，旧单地区未知也不能自动拼接', () => {
    const order = { targetDate: '2026-05-31', region: 'yunnan' } as DeclarationOrder
    expect(matchesReviewScope(order, '2026-05-31', 'yunnan')).toBe(true)
    expect(matchesReviewScope(order, '2026-06-01', 'yunnan')).toBe(false)
    expect(matchesReviewScope(order, '2026-05-31', 'shanxi')).toBe(false)
    expect(matchesReviewScope({ ...order, region: null }, '2026-05-31', 'yunnan')).toBe(false)
  })
  it('本单出清与申报可比较，但不得推导实际电量和价格', () => {
    const rows = orderIntervals({ energyCurveMwh96: Array(96).fill(10), clearing: { clearedCurveMwh96: Array(96).fill(8) } } as DeclarationOrder)
    expect(rows[0]).toMatchObject({ label: '00:00', declared: 10, cleared: 8, delta: -2, actual: null, daPrice: null })
    expect(rows[95].label).toBe('23:45')
  })
  it('不完整或非数值曲线不零填、不按序错位比较', () => {
    const rows = orderIntervals({ energyCurveMwh96: Array(96).fill(10), clearing: { clearedCurveMwh96: Array(95).fill(8) } } as DeclarationOrder)
    expect(rows.every(r => r.cleared === null && r.delta === null)).toBe(true)
    expect(orderIntervals({ energyCurveMwh96: Array(96).fill(NaN) } as DeclarationOrder)).toEqual([])
  })
  it('缺点、重复点、跨日点按时间留空；有效零价不丢弃', () => {
    const review = { date: '2026-05-31', detail: [
      { datetime: '2026-05-31 00:00', declared: 10, actual: 12, da_price: 0, rt_price: -3 },
      { datetime: '2026-05-31 00:30', declared: 10, actual: 15 },
      { datetime: '2026-05-31 00:30', declared: 10, actual: 14 },
      { datetime: '2026-06-01 00:15', declared: 99, actual: 100 }
    ] } as ReviewResult
    const rows = platformIntervals(review, '2026-05-31')
    expect(rows).toHaveLength(96)
    expect(rows[0]).toMatchObject({ delta: 2, daPrice: 0, rtPrice: -3 })
    expect(rows[1].actual).toBeNull(); expect(rows[2].actual).toBeNull()
    expect(platformIntervals(review, '2026-06-01')).toEqual([])
  })
  it('错误详情中的数据库字段和议题编号不会流入业务文案', () => {
    const message = reviewGap({ kind: 'data-not-onboarded', title: 'actual_mwh_96 #1488', description: 'review.risk_events', detail: 'serving-route-registry' })
    expect(message).toContain('结算资料仍可单独查看')
    expect(message).not.toMatch(/actual_|review\.|#1488|registry/)
  })
  it('模拟回执可见，不因真实申报模式误标为已执行交易', () => {
    expect(declarationLabel({ status: 'CLEARED', receipt: { mock: true } } as DeclarationOrder)).toContain('模拟演练')
  })
})
