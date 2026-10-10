import { describe, expect, it } from 'vitest'
import type { RelationScatterRow } from '@/services/data/contracts/relationScatterAdapter'
import {
  RELATION_HOURS,
  heatmapMatrix,
  hourlyRegression,
  linearRegression,
  pointsForHour,
  sensitivityBars,
  summaryKpis
} from './relationInsight'

// 构造一天的行：hourPrices 为该行各小时的 [驱动量, 电价]；缺省小时置 null。
function row(date: string, cells: Record<number, [number, number]>): RelationScatterRow {
  const r: RelationScatterRow = { date }
  for (const h of RELATION_HOURS) r['p' + h] = cells[h] ?? null
  return r
}

describe('linearRegression', () => {
  it('完美正相关 y=2x+1 → slope=2, intercept=1, r=r2=1', () => {
    const res = linearRegression([[0, 1], [1, 3], [2, 5], [3, 7]])
    expect(res.slope).toBeCloseTo(2, 6)
    expect(res.intercept).toBeCloseTo(1, 6)
    expect(res.r).toBeCloseTo(1, 6)
    expect(res.r2).toBeCloseTo(1, 6)
    expect(res.n).toBe(4)
  })

  it('完美负相关 → r 为 -1、r2 为 1', () => {
    const res = linearRegression([[0, 10], [1, 8], [2, 6], [3, 4]])
    expect(res.slope).toBeCloseTo(-2, 6)
    expect(res.r).toBeCloseTo(-1, 6)
    expect(res.r2).toBeCloseTo(1, 6)
  })

  it('样本 < 2 → n<2 且 slope/r 归零（不崩）', () => {
    expect(linearRegression([]).n).toBe(0)
    const one = linearRegression([[5, 42]])
    expect(one.n).toBe(1)
    expect(one.slope).toBe(0)
    expect(one.intercept).toBe(42)
  })

  it('驱动量方差为 0（竖线点）→ r=0、不产生 NaN', () => {
    const res = linearRegression([[5, 1], [5, 2], [5, 3]])
    expect(res.slope).toBe(0)
    expect(res.r).toBe(0)
    expect(Number.isNaN(res.r)).toBe(false)
  })
})

describe('pointsForHour', () => {
  const xd = [
    row('2026-06-01', { 1: [100, 200], 2: [300, 400] }),
    row('2026-06-02', { 1: [110, 210] })
  ]
  it('只取该小时的有效 cell，跳过 null', () => {
    expect(pointsForHour(xd, 1, 30)).toEqual([[100, 200], [110, 210]])
    expect(pointsForHour(xd, 2, 30)).toEqual([[300, 400]])
  })
  it('days 截取取最近 N 天', () => {
    expect(pointsForHour(xd, 1, 1)).toEqual([[110, 210]])
  })
})

describe('hourlyRegression', () => {
  it('对某小时逐日点做回归', () => {
    const xd = [
      row('d1', { 3: [0, 0] }),
      row('d2', { 3: [1, 2] }),
      row('d3', { 3: [2, 4] })
    ]
    const res = hourlyRegression(xd, 3, 30)
    expect(res.slope).toBeCloseTo(2, 6)
    expect(res.r2).toBeCloseTo(1, 6)
    expect(res.n).toBe(3)
  })
})

describe('heatmapMatrix', () => {
  const xd = [
    row('d1', { 1: [500, 100], 2: [500, 300] }),
    row('d2', { 1: [1500, 200], 2: [1500, 500] })
  ]
  it('固定上界分箱：小时×分箱平均电价，min/max 覆盖真实电价范围', () => {
    const m = heatmapMatrix(xd, { days: 30, binCount: 2, binMax: 2000 })
    expect(m.xHours).toEqual(RELATION_HOURS)
    expect(m.yBins).toHaveLength(2)
    // 小时1 的两点分落两箱（500→箱0，1500→箱1）
    const hour1 = m.cells.filter((c) => c[0] === 0)
    expect(hour1).toHaveLength(2)
    expect(m.min).toBe(100)
    expect(m.max).toBe(500)
  })

  it('同一格多点取平均', () => {
    const same = [
      row('d1', { 1: [500, 100] }),
      row('d2', { 1: [600, 300] })
    ]
    const m = heatmapMatrix(same, { days: 30, binCount: 1, binMax: 1000 })
    // 单箱单小时：平均 (100+300)/2 = 200
    const cell = m.cells.find((c) => c[0] === 0 && c[1] === 0)
    expect(cell?.[2]).toBe(200)
    expect(m.counts[m.cells.indexOf(cell!)]).toBe(2)
  })

  it('空数据不崩，min/max 归零、无单元格', () => {
    const m = heatmapMatrix([], { days: 30, binCount: 5 })
    expect(m.cells).toHaveLength(0)
    expect(m.min).toBe(0)
    expect(m.max).toBe(0)
  })

  it('全自适应（负荷未传 binMax）：下界锚样本最小值，不从 0 起分箱', () => {
    // 负荷 15000~45000，binCount=2 → 两箱应为 15000–30000 / 30000–45000
    const load = [
      row('d1', { 1: [15000, 100] }),
      row('d2', { 1: [45000, 400] })
    ]
    const m = heatmapMatrix(load, { days: 30, binCount: 2 })
    expect(m.yBins[0].startsWith('15000')).toBe(true)
    expect(m.yBins[1].endsWith('45000')).toBe(true)
  })

  it('固定上界（新能源 binMax）：下界仍锚 0', () => {
    const re = [row('d1', { 1: [7000, 200] })]
    const m = heatmapMatrix(re, { days: 30, binCount: 2, binMax: 14000 })
    expect(m.yBins[0].startsWith('0')).toBe(true)
  })
})

describe('sensitivityBars & summaryKpis', () => {
  const xd = [
    row('d1', { 1: [0, 0], 5: [0, 10] }),
    row('d2', { 1: [1, 2], 5: [1, 10] }),
    row('d3', { 1: [2, 4], 5: [2, 10] })
  ]
  it('sensitivityBars 返回 24 条、按小时', () => {
    const bars = sensitivityBars(xd, 30)
    expect(bars).toHaveLength(24)
    expect(bars[0].hour).toBe(1)
    expect(bars[0].slope).toBeCloseTo(2, 6) // 小时1 强相关
    expect(bars[4].r).toBe(0) // 小时5 电价恒定 → 无相关
  })

  it('summaryKpis 汇总：最强相关时段=小时1，样本天数正确', () => {
    const s = summaryKpis(xd, 30)
    expect(s.strongestHour).toBe(1)
    expect(s.sampleDays).toBe(3)
    expect(s.totalPoints).toBe(6)
    expect(s.overallR).not.toBeNull()
    expect(Math.abs(s.overallR!)).toBeGreaterThan(0)
  })

  it('全空 → KPI 缺测为 null（不显示假 0），时段为 null', () => {
    const s = summaryKpis([], 30)
    expect(s.strongestHour).toBeNull()
    expect(s.weakestHour).toBeNull()
    // R3：空样本显示缺测（null），不再伪装成 0 相关/0 敏感度的假零
    expect(s.meanSlope).toBeNull()
    expect(s.overallR).toBeNull()
    expect(s.totalPoints).toBe(0)
    expect(s.totalPoints).toBe(0)
  })
})
