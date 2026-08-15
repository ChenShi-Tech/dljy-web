// 收益三层拆解纯逻辑测试（#2043 验收：三层合计与总收益恒等；同源同口径）
import { describe, expect, it } from 'vitest'
import {
  decomposeDaily,
  hourOfDatetime,
  momForcesAttribution,
  monthlyPnlTop,
  rollupMonthly
} from './pnlDecompose'
import type { SettlementRuleSpec } from '@/rules/types'

const spec = (timeSegmentFactors: SettlementRuleSpec['timeSegmentFactors']): SettlementRuleSpec =>
  ({
    regionId: 'test', version: 'v0', effectiveness: 'trial', deviationTolerancePct: 3,
    assessmentPriceBasis: 'da', assessmentPriceFloor: 0, timeSegmentFactors,
    recycleSubjects: [], notes: [], references: []
  }) as SettlementRuleSpec

const pt = (hhmm: string, declared: number, actual: number, da?: number, rt?: number) => ({
  datetime: `2026-08-14 ${hhmm}`, declared, actual, da_price: da, rt_price: rt
})

describe('decomposeDaily（三层拆解 · 恒等红线）', () => {
  const detail = [
    pt('00:15', 10, 12, 300, 310), // 谷段（0 时）
    pt('00:30', 10, 9, 300, 290),
    pt('11:15', 20, 18, 500, 520) // 峰段（11 时）
  ]

  it('日前=Σ申报×日前价、实时增量=Σ(实际−申报)×实时价，两品种之和=总收益', () => {
    const d = decomposeDaily(detail, null)
    expect(d.daRevenueYuan).toBeCloseTo(10 * 300 + 10 * 300 + 20 * 500)
    expect(d.rtIncrementYuan).toBeCloseTo(2 * 310 + -1 * 290 + -2 * 520)
    expect(d.totalYuan).toBeCloseTo(d.daRevenueYuan + d.rtIncrementYuan)
  })

  it('中长期如实标未接入（revenueYuan null，不用 0 冒充）', () => {
    const d = decomposeDaily(detail, null)
    const ltm = d.byVariety.find((v) => v.variety === '中长期')!
    expect(ltm.revenueYuan).toBeNull()
    expect(ltm.note).toContain('S6')
  })

  it('分时段读 SettlementRuleSpec：峰谷归属+占比；未命中小时归「平」', () => {
    const d = decomposeDaily(detail, spec([{ segment: '峰', hours: [11], factor: 1.2 }, { segment: '谷', hours: [0], factor: 0.4 }]))
    expect(d.bySegment).not.toBeNull()
    const seg = Object.fromEntries((d.bySegment ?? []).map((r) => [r.segment, r]))
    expect(seg['谷'].revenueYuan).toBeCloseTo(10 * 300 + 2 * 310 + 10 * 300 + -1 * 290)
    expect(seg['峰'].revenueYuan).toBeCloseTo(20 * 500 + -2 * 520)
    // 两时段之和=总（恒等）；share 合计 1
    expect(seg['谷'].revenueYuan + seg['峰'].revenueYuan).toBeCloseTo(d.totalYuan)
    expect((d.bySegment ?? []).reduce((a, r) => a + r.share, 0)).toBeCloseTo(1)
  })

  it('spec 未参数化 → 分时段层 null + 标记（不借用他省）', () => {
    const d = decomposeDaily(detail, null)
    expect(d.bySegment).toBeNull()
    expect(d.segmentUnparameterized).toBe(true)
  })

  it('价格缺失点进缺口计数、不计入对应层', () => {
    const d = decomposeDaily([pt('00:15', 10, 10, undefined, 320), pt('01:15', 10, 10, 300, undefined)])
    expect(d.priceGapPoints).toBe(2)
    expect(d.daRevenueYuan).toBeCloseTo(10 * 300) // 仅第二点有日前价：10×300
    expect(d.rtIncrementYuan).toBeCloseTo(0) // 第一点实际=申报 → 0×320=0
  })
})

describe('rollupMonthly + monthlyPnlTop + 环比强制归因', () => {
  const d1 = decomposeDaily([pt('00:15', 10, 10, 300, 300)], null)
  const d2 = decomposeDaily([pt('11:15', 20, 20, 500, 500)], null)

  it('月度滚动=Σ日，恒等保持', () => {
    const m = rollupMonthly([
      { date: '2026-08-01', d: d1 },
      { date: '2026-08-02', d: d2 },
      { date: '2026-08-03', d: null }
    ])
    expect(m.days).toBe(2)
    expect(m.totalYuan).toBeCloseTo(d1.totalYuan + d2.totalYuan)
    const da = m.byVariety.find((v) => v.variety === '现货·日前')!
    expect(da.revenueYuan).toBeCloseTo(d1.daRevenueYuan + d2.daRevenueYuan)
  })

  it('Top5 按 |盈亏| 降序、带盈亏类型（以日为笔口径）', () => {
    const top = monthlyPnlTop([
      { date: 'd1', pnlYuan: 100 }, { date: 'd2', pnlYuan: -800 },
      { date: 'd3', pnlYuan: 500 }, { date: 'd4', pnlYuan: -50 }
    ], 3)
    expect(top.map((t) => t.date)).toEqual(['d2', 'd3', 'd1'])
    expect(top[0].type).toBe('亏损')
    expect(top[0].rank).toBe(1)
  })

  it('环比超 20% 强制归因；上期无数据不强制', () => {
    expect(momForcesAttribution(150, 100)).toBe(true)
    expect(momForcesAttribution(115, 100)).toBe(false)
    expect(momForcesAttribution(150, null)).toBe(false)
  })
})

describe('hourOfDatetime', () => {
  it('常见 datetime 形态都能取到小时；取不到返回 null', () => {
    expect(hourOfDatetime('2026-08-14 00:15')).toBe(0)
    expect(hourOfDatetime('08-14 23:45')).toBe(23)
    expect(hourOfDatetime('garbage')).toBeNull()
  })
})
