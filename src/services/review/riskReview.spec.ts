// 风险事件与阈值触发纯逻辑测试（#2047 验收：未越限不生成；越限生成且口径可溯）
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLD,
  NEAR_MISS_NOTE,
  spreadReturns,
  STRESS_GRADES,
  thresholdFindings
} from './riskReview'
import type { DailyAggRow } from './deviationAggregate'

const row = (date: string, deviationPct: number | null): DailyAggRow => ({
  date, deviationPct, totalAbsDeviationMwh: 1, assessedMwh: 0, estimatedPenaltyYuan: 0, causeId: null, causeLabel: null
})

describe('thresholdFindings（阈值触发 · 负例红线）', () => {
  it('负例：未越限不生成任何触发（只有 data_gap 占位项）', () => {
    const out = thresholdFindings({
      aggRows: [row('d1', 0.02), row('d2', 0.03)],
      dailySpreadPnl: [{ date: 'd1', pnlYuan: 100 }, { date: 'd2', pnlYuan: 50 }],
      winRate: 0.6
    })
    expect(out.findings.filter((f) => !f.dataGap)).toEqual([])
    expect(out.findings).toHaveLength(1) // 止损仓位 data_gap 占位
    expect(out.findings[0].dataGap).toBe(true)
  })

  it('偏差率连续超标 → red 触发；价差连续为负 ≥N 日 → yellow 触发', () => {
    const out = thresholdFindings({
      aggRows: [row('2026-08-24', 0.06), row('2026-08-25', 0.07), row('2026-08-26', 0.08)], // 真实日历日（连续按相邻日判定）
      dailySpreadPnl: [
        { date: '2026-08-24', pnlYuan: -100 }, { date: '2026-08-25', pnlYuan: -50 },
        { date: '2026-08-26', pnlYuan: -80 }, { date: '2026-08-27', pnlYuan: 10 }
      ],
      winRate: 0.6
    })
    const deviation = out.findings.find((f) => f.id === 'deviation-streak')
    expect(deviation?.level).toBe('red')
    expect(deviation?.title).toContain('3 日')
    const spread = out.findings.find((f) => f.id === 'spread-streak')
    expect(spread?.level).toBe('yellow')
    expect(spread?.detail).toContain('代理口径')
  })

  it('胜率低于阈值触发；无样本（null）不触发不猜', () => {
    const low = thresholdFindings({ aggRows: [], dailySpreadPnl: [], winRate: 0.3 })
    expect(low.findings.some((f) => f.id === 'win-rate')).toBe(true)
    const none = thresholdFindings({ aggRows: [], dailySpreadPnl: [], winRate: null })
    expect(none.findings.some((f) => f.id === 'win-rate')).toBe(false)
  })

  it('阈值可配置覆盖缺省（P2 确认前缺省显式）', () => {
    expect(DEFAULT_THRESHOLD.deviationPct).toBe(0.05)
    const out = thresholdFindings({
      aggRows: [row('d1', 0.06), row('d2', 0.07)],
      dailySpreadPnl: [], winRate: null, thresholds: { deviationPct: 0.10 }
    })
    expect(out.findings.some((f) => f.id === 'deviation-streak')).toBe(false)
    expect(out.thresholds.deviationPct).toBe(0.10)
  })
})

describe('spreadReturns（价差序列喂 CVaR）', () => {
  it('双价齐备才产出 (rt−da)/|da|；缺价点跳过', () => {
    const out = spreadReturns([
      { da_price: 100, rt_price: 110 },
      { da_price: 200, rt_price: 180 },
      { da_price: undefined, rt_price: 150 },
      { da_price: 0, rt_price: 50 }
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toBeCloseTo(0.1)
    expect(out[1]).toBeCloseTo(-0.1)
  })
})

describe('near_miss 与压力测试评级常量', () => {
  it('near_miss 不计损失但入案例库（方案原文语义）', () => {
    expect(NEAR_MISS_NOTE).toContain('不计入损失金额')
    expect(NEAR_MISS_NOTE).toContain('案例库')
  })
  it('承受能力评级三档且「弱」带限期整改语义', () => {
    expect(STRESS_GRADES.map((g) => g.id)).toEqual(['strong', 'medium', 'weak'])
    expect(STRESS_GRADES[2].label).toContain('限期整改')
  })
})
