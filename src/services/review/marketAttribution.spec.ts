// 月度市场归因纯逻辑测试（#2046：自动预填来源标注 / 异常月规则 / 无自动因果）
import { describe, expect, it } from 'vitest'
import { anomalyMonths, monthPriceStats, supplyDemandDirection } from './marketAttribution'
import type { MonthTrendRow, PriceTrendRow } from '@/services/market/marketAnalysis'

const trend = (month: string, spotPrice: number, mediumLongPrice = 380): PriceTrendRow =>
  ({ month, mediumLongPrice, spotPrice, retailPrice: spotPrice + 20, deviation: 0 })

describe('monthPriceStats（价格走势行）', () => {
  it('月行 + 年均基线 + 偏离%', () => {
    const rows = [trend('1月', 300), trend('2月', 400), trend('3月', 500)]
    const s = monthPriceStats(rows, '2月')
    expect(s.spotPrice).toBe(400)
    expect(s.yearMeanSpot).toBeCloseTo(400)
    expect(s.devFromYearMeanPct).toBeCloseTo(0)
    expect(monthPriceStats(rows, '12月').spotPrice).toBeNull() // 无该月数据 → null
  })
})

describe('anomalyMonths（异常价格事件 · 月粒度 2σ）', () => {
  it('显著偏离月被识别，按偏离幅度排序', () => {
    // ≥6 个月：离群点不足以把 σ 抬到掩蔽自身
    const rows = [trend('1月', 300), trend('2月', 310), trend('3月', 305), trend('4月', 308), trend('5月', 302), trend('6月', 900)]
    const out = anomalyMonths(rows)
    expect(out.events).toHaveLength(1)
    expect(out.events[0].month).toBe('6月')
    expect(out.note).toContain('小时粒度')
  })

  it('样本 <4 个月不出结论（统计不成立，宁可漏报不虚报）', () => {
    const out = anomalyMonths([trend('1月', 300), trend('2月', 900)])
    expect(out.events).toEqual([])
    expect(out.note).toContain('统计不成立')
  })

  it('无异常月如实说无', () => {
    const rows = [trend('1月', 300), trend('2月', 302), trend('3月', 301), trend('4月', 303)]
    const out = anomalyMonths(rows)
    expect(out.events).toEqual([])
    expect(out.note).toContain('无异常月')
  })
})

describe('supplyDemandDirection（供需形势行 · 量价方向代理 v1）', () => {
  const mt = (month: string, quantity: number, avgPrice: number): MonthTrendRow =>
    ({ month, quantity, avgPrice, mediumLong: 0, spot: 0, ancillary: 0 })

  it('量价同向/背离三类方向', () => {
    const rows = [mt('6月', 100, 400), mt('7月', 120, 430)]
    expect(supplyDemandDirection(rows, '7月', '6月').direction).toBe('量价齐升')
    expect(supplyDemandDirection([mt('6月', 100, 400), mt('7月', 80, 380)], '7月', '6月').direction).toBe('量价齐跌')
    expect(supplyDemandDirection([mt('6月', 100, 400), mt('7月', 120, 370)], '7月', '6月').direction).toBe('量价背离')
  })

  it('缺当月或上月 → 数据不足不出结论', () => {
    expect(supplyDemandDirection([mt('6月', 100, 400)], '7月', '6月').direction).toBe('数据不足')
  })
})
