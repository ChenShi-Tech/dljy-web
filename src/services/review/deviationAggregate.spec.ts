// 偏差周月聚合纯逻辑测试（Epic #2033 · M2 · #2042）
// 核心断言：合计与逐日之和恒等（验收红线）；缺数日不进合计；二轴仅建议不直写。
import { describe, expect, it } from 'vitest'
import {
  aggregateDeviation,
  consecutiveDeviationBreach,
  RESPONSIBILITY_AXES,
  suggestResponsibility
} from './deviationAggregate'
import type { PeriodReviewDay } from './reviewPeriodClient'
// type-only import 编译期擦除——不会把 quantClient（触 window）拖进 node 环境
import type { ReviewResult } from '@/services/quant/quantClient'

const ok = (date: string, over: Partial<{ dev: number; assessed: number; penalty: number; declared: number; causeId: string | null; causeLabel: string | null }> = {}): PeriodReviewDay => ({
  ok: true,
  date,
  result: {
    deviation: {
      points: 96,
      total_abs_deviation_mwh: over.dev ?? 10,
      assessed_mwh: over.assessed ?? 4,
      estimated_penalty_yuan: over.penalty ?? 400,
      tolerance_pct: 3,
      worst_point: { datetime: `${date}T00:00`, deviation: 1 }
    }
  } as unknown as ReviewResult,
  declaredTotalMwh: over.declared ?? 400,
  causeId: over.causeId ?? null,
  causeLabel: over.causeLabel ?? null
})

const fail = (date: string): PeriodReviewDay => ({ ok: false, date, reason: '503 not_onboarded' })

describe('aggregateDeviation（周月聚合 · 恒等红线）', () => {
  it('合计 = 逐日之和（偏差/考核/费用恒等），偏差率=Σ偏差/Σ申报', () => {
    const agg = aggregateDeviation([
      ok('2026-08-10', { dev: 12, assessed: 5, penalty: 500, declared: 400 }),
      ok('2026-08-11', { dev: 8, assessed: 3, penalty: 300, declared: 600 })
    ])
    expect(agg.totals.days).toBe(2)
    expect(agg.totals.deviationMwh).toBeCloseTo(20)
    expect(agg.totals.assessedMwh).toBeCloseTo(8)
    expect(agg.totals.penaltyYuan).toBeCloseTo(800)
    expect(agg.totals.deviationPct).toBeCloseTo(20 / 1000)
  })

  it('缺数日如实列名、不进合计（不用 0 补位）', () => {
    const agg = aggregateDeviation([ok('2026-08-10', { dev: 10 }), fail('2026-08-11'), fail('2026-08-12'), ok('2026-08-13', { dev: 6 })])
    expect(agg.missingDays).toEqual(['2026-08-11', '2026-08-12'])
    expect(agg.totals.days).toBe(2)
    expect(agg.totals.deviationMwh).toBeCloseTo(16)
  })

  it('按业务成因聚合天数（第一轴，未判定日不计）', () => {
    const agg = aggregateDeviation([
      ok('2026-08-10', { causeId: 'load', causeLabel: '负荷预测偏差' }),
      ok('2026-08-11', { causeId: 'load', causeLabel: '负荷预测偏差' }),
      ok('2026-08-12', { causeId: 'price', causeLabel: '价格因素' }),
      ok('2026-08-13', {})
    ])
    expect(agg.byCause[0]).toMatchObject({ causeId: 'load', days: 2 })
    expect(agg.byCause).toHaveLength(2)
  })

  it('申报总量为 0 的日子偏差率 null；全周期无从计率', () => {
    const agg = aggregateDeviation([ok('2026-08-10', { declared: 0, dev: 5 })])
    expect(agg.rows[0].deviationPct).toBeNull()
    expect(agg.totals.deviationPct).toBeNull()
  })
})

describe('责任归因二轴（仅建议 · 人确认）', () => {
  it('四轴枚举固定；业务成因→责任归因映射建议命中已知项', () => {
    expect(RESPONSIBILITY_AXES.map((a) => a.id)).toEqual(['forecast_miss', 'contingency', 'strategy_error', 'operation_error'])
    expect(suggestResponsibility('load')).toMatchObject({ id: 'forecast_miss' })
    expect(suggestResponsibility('transmission')).toMatchObject({ id: 'contingency' })
    expect(suggestResponsibility('price')).toMatchObject({ id: 'strategy_error' })
  })

  it('未判定（null）与未知成因不给建议——不猜', () => {
    expect(suggestResponsibility(null)).toBeNull()
    expect(suggestResponsibility('pending')).toBeNull()
    expect(suggestResponsibility('mystery')).toBeNull()
  })
})

describe('consecutiveDeviationBreach（阈值连续超标占位）', () => {
  const row = (date: string, pct: number | null) => ({ date, deviationPct: pct, totalAbsDeviationMwh: 1, assessedMwh: 0, estimatedPenaltyYuan: 0, causeId: null, causeLabel: null })

  it('连续 ≥2 日超阈值成段；断档重新计', () => {
    const out = consecutiveDeviationBreach([row('d1', 0.06), row('d2', 0.07), row('d3', 0.01), row('d4', 0.09)], 0.05)
    expect(out).toMatchObject({ streak: 2, from: 'd1', to: 'd2' })
  })

  it('仅 1 日或无超标 → null（不虚报）；null 偏差率日断段', () => {
    expect(consecutiveDeviationBreach([row('d1', 0.09)], 0.05)).toBeNull()
    expect(consecutiveDeviationBreach([row('d1', 0.06), row('d2', null), row('d3', 0.07)], 0.05)).toBeNull()
  })
})
