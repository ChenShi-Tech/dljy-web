// 月度市场归因纯逻辑测试（#2046 规则 + #3392 改接真实月度序列后的回归护栏）
// 守的不变量：① 缺数据恒 null（不填 0、不合成）；② 近 12 个月均值只取有效样本、
// null 跳过不进分母；③ 异常月 2σ 规则、样本 <4 不出结论；④ 供需四档方向判定
// 以「月均负荷环比 × 月现货均价环比」为口径，任一量缺失即数据不足。
// 坏掉的症状：面板价格/供需行给出伪数值或错误方向，误导月度复盘。
// issue：ChenShi-Tech/dljy#3392（原 #2046）。
import { describe, expect, it } from 'vitest'
import { anomalyMonths, monthPriceStats, supplyDemandDirection, type MonthlyMarketPoint } from './marketAttribution'

const pt = (month: string, spotPrice: number | null, avgLoad: number | null = 30000): MonthlyMarketPoint =>
  ({ month, spotPrice, avgLoad })

describe('monthPriceStats（价格走势行）', () => {
  it('月行 + 近 12 个月均值基线 + 偏离%（手算对拍）', () => {
    const rows = [pt('2026-02', 300), pt('2026-03', 400), pt('2026-04', 500), pt('2026-05', 400)]
    const s = monthPriceStats(rows, '2026-04')
    expect(s.spotPrice).toBe(500)
    expect(s.trailing12Mean).toBeCloseTo(400) // (300+400+500+400)/4
    expect(s.devFromTrailingMeanPct).toBeCloseTo(0.25) // (500-400)/400
  })

  it('复盘月缺数据 → spotPrice/dev 为 null，但近 12 个月均值仍由其余月算出', () => {
    const rows = [pt('2026-02', 300), pt('2026-03', 500)]
    const s = monthPriceStats(rows, '2026-05')
    expect(s.spotPrice).toBeNull()
    expect(s.devFromTrailingMeanPct).toBeNull()
    expect(s.trailing12Mean).toBeCloseTo(400)
  })

  it('null 月价跳过，不进均值分母；空序列全 null', () => {
    const rows = [pt('2026-02', 300), pt('2026-03', null), pt('2026-04', 500)]
    expect(monthPriceStats(rows, '2026-04').trailing12Mean).toBeCloseTo(400) // null 不计入
    const empty = monthPriceStats([pt('2026-04', null)], '2026-04')
    expect(empty.spotPrice).toBeNull()
    expect(empty.trailing12Mean).toBeNull()
    expect(empty.devFromTrailingMeanPct).toBeNull()
  })
})

describe('anomalyMonths（异常价格事件 · 月粒度 2σ）', () => {
  it('显著偏离月被识别，按偏离幅度排序；null 月不计样本', () => {
    // ≥6 个有效月：离群点不足以把 σ 抬到掩蔽自身
    const rows = [
      pt('2025-12', 300), pt('2026-01', 310), pt('2026-02', null),
      pt('2026-03', 305), pt('2026-04', 308), pt('2026-05', 302), pt('2026-06', 900)
    ]
    const out = anomalyMonths(rows)
    expect(out.events).toHaveLength(1)
    expect(out.events[0].month).toBe('2026-06')
    expect(out.events[0].spotPrice).toBe(900)
    expect(out.note).toContain('近 12 个月均值')
  })

  it('有效样本 <4 个月不出结论（统计不成立，宁可漏报不虚报）', () => {
    const out = anomalyMonths([pt('2026-04', 300), pt('2026-05', 900), pt('2026-06', null)])
    expect(out.events).toEqual([])
    expect(out.note).toContain('统计不成立')
  })

  it('无异常月如实说无', () => {
    const rows = [pt('2026-03', 300), pt('2026-04', 302), pt('2026-05', 301), pt('2026-06', 303)]
    const out = anomalyMonths(rows)
    expect(out.events).toEqual([])
    expect(out.note).toContain('无异常月')
  })
})

describe('supplyDemandDirection（供需形势行 · 负荷环比 × 价格环比）', () => {
  const win = (load0: number | null, price0: number | null, load1: number | null, price1: number | null): MonthlyMarketPoint[] => [
    pt('2026-05', price0, load0),
    pt('2026-06', price1, load1)
  ]

  it('同升/同跌/背离三档方向', () => {
    expect(supplyDemandDirection(win(30000, 400, 33000, 430), '2026-06', '2026-05').direction).toBe('负荷与价格同升')
    expect(supplyDemandDirection(win(30000, 400, 27000, 380), '2026-06', '2026-05').direction).toBe('负荷与价格同跌')
    expect(supplyDemandDirection(win(30000, 400, 33000, 370), '2026-06', '2026-05').direction).toBe('负荷与价格背离')
  })

  it('note 写清环比数值与口径（负荷 MW、价格 元/MWh）', () => {
    const out = supplyDemandDirection(win(30000, 400, 31500, 430), '2026-06', '2026-05')
    expect(out.note).toContain('+1500 MW')
    expect(out.note).toContain('+30.0 元/MWh')
    expect(out.note).toContain('sdpt_actualLoad')
  })

  it('任一量缺当月或上月 → 数据不足不出结论（含 null 值，不出伪方向）', () => {
    expect(supplyDemandDirection([pt('2026-05', 400, 30000)], '2026-06', '2026-05').direction).toBe('数据不足')
    expect(supplyDemandDirection(win(null, 400, 33000, 430), '2026-06', '2026-05').direction).toBe('数据不足')
    expect(supplyDemandDirection(win(30000, 400, 33000, null), '2026-06', '2026-05').direction).toBe('数据不足')
  })
})
