// S3 素材纯函数单测（Epic #3591 / dljy#3595，ZW-07/08）：区段统计口径、异动标记构造与开关语义。
import { describe, expect, it } from 'vitest'
import { buildAnomalyContext, buildAnomalyMarks, buildScorecardContext, segmentStats } from './zsjfxAiContext'
import type { ZsjfxScorecard } from '@/services/insight/zsjfxScorecardClient'

describe('segmentStats（ZW-07：AI 只消费算好的数值）', () => {
  const series = {
    日前价出清: [100, 200, null, 400, 500],
    实时价出清: [80, null, null, 360, 520]
  } as unknown as Record<string, Array<number | null>>

  it('区间统计剔除空值并如实计数（真实零参与）', () => {
    series.日前价出清.push(0)
    const stats = segmentStats(series, 0, 5)
    expect(stats.日前价出清.count).toBe(5)
    expect(stats.日前价出清.nulls).toBe(1)
    expect(stats.日前价出清.min).toBe(0)
    expect(stats.日前价出清.max).toBe(500)
    expect(stats.实时价出清.count).toBe(3)
    expect(stats.实时价出清.nulls).toBe(3)
  })

  it('区间全空 → min/max/avg 为 null（不补零）', () => {
    const stats = segmentStats({ x: [null, null, null] }, 0, 2)
    expect(stats.x).toEqual({ count: 0, nulls: 3, min: null, max: null, avg: null })
  })

  it('下标越界按 [0,95] 夹紧', () => {
    const stats = segmentStats({ x: new Array<number | null>(96).fill(1) }, -10, 200)
    expect(stats.x.count).toBe(96)
  })
})

describe('buildAnomalyMarks（ZW-08：开关与标记语义）', () => {
  const anomalies = [
    { type: 'negative_price' as const, severity: 'high' as const, market: 'da' as const, from: '02:00', to: '02:45', value: -20, threshold: 0, message: '' },
    { type: 'limit_approach' as const, severity: 'mid' as const, market: 'da' as const, from: '18:00', to: '18:15', value: 1150, threshold: 1080, message: '' },
    { type: 'spread_outlier' as const, severity: 'mid' as const, market: 'da-rt' as const, from: '10:00', to: '10:45', value: 170, threshold: 150, message: '' }
  ]

  it('负价/限价 → markPoint（带 market 归属），价差 → markArea（槽位区间）', () => {
    const marks = buildAnomalyMarks(anomalies, { show: true })
    expect(marks.points).toHaveLength(2)
    expect(marks.points[0].market).toBe('da')
    expect(marks.points[0].coord).toEqual([8, -20]) // 02:00 → 槽位 8
    expect(marks.areas).toHaveLength(1)
    expect([marks.areas[0][0].xAxis, marks.areas[0][1].xAxis]).toEqual([40, 43]) // 起止点对：10:00~10:45 → 槽位 40..43
  })

  it('开关关闭 → 空标记（渲染层不加任何标记；手动标注存储不经过本函数，不受影响）', () => {
    const marks = buildAnomalyMarks(anomalies, { show: false })
    expect(marks.points).toEqual([])
    expect(marks.areas).toEqual([])
  })

  it('坏时间标签跳过不炸', () => {
    const marks = buildAnomalyMarks([{ ...anomalies[0], from: 'bad' }], { show: true })
    expect(marks.points).toEqual([])
  })
})

const scorecardStub = {
  pair: { id: 'load-d1', label: '日前负荷预测 × 系统负荷实际值', forecast: '日前负荷预测', actual: '系统负荷实际值' },
  dateFrom: '2026-06-30', dateTo: '2026-06-30',
  totals: { scoredDays: 1, skippedDays: { forecastMissing: 0, actualMissing: 0, noData: 0 }, slots: 96, mae: 279.8, mape: 0.009, directionHitRate: 0.895, directionHitRateNote: '方向命中率 = 相邻有效时段预测与实际涨跌方向一致占比' },
  anomalies: [{ type: 'negative_price', severity: 'high', market: 'da', from: '02:00', to: '02:45', value: -20, threshold: 0, message: 'm' }],
  anomalyNotes: []
} as unknown as ZsjfxScorecard

describe('AI 素材装配（ZW-07：素材含算好指标字段）', () => {
  it('buildScorecardContext 摘算好的 MAE/MAPE/方向命中率与口径说明', () => {
    const ctx = buildScorecardContext(scorecardStub)
    expect(ctx).toMatchObject({ mae: 279.8, mape: 0.009, direction_hit_rate: 0.895, scored_days: 1, skipped_days: { forecastMissing: 0, actualMissing: 0, noData: 0 } })
    expect(String(ctx!.definition)).toContain('方向命中率')
  })
  it('无对拍结果 → undefined（不臆造素材）', () => {
    expect(buildScorecardContext(null)).toBeUndefined()
    expect(buildAnomalyContext(null)).toBeUndefined()
  })
  it('buildAnomalyContext 原样摘录异动（含阈值口径）', () => {
    const ctx = buildAnomalyContext(scorecardStub)
    expect(ctx).toEqual([{ type: 'negative_price', severity: 'high', market: 'da', from: '02:00', to: '02:45', value: -20, threshold: 0 }])
  })
})
