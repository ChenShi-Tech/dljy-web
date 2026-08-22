// 驾驶舱现货价格面板的取数决策（#2392）。
//
// 这里每一条判断错了都**不会报错**，只会画出一条看起来完全正常的曲线——所以断言必须
// 钉在「不该出现的东西没有出现」上，而不只是「该出现的出现了」。
import { describe, expect, it } from 'vitest'
import { buildPricePanel, resolvePanelDate } from './cockpitPricePanel'
import type { SpotCurve } from './spotPriceCore'
import type { LatestForecast } from '@/services/forecast/latestForecast'

const N = 96
const curve = (base: number) =>
  Array.from({ length: N }, (_, i) => ({ time: `t${i}`, value: base + i }))

const clearing = (over: Partial<SpotCurve> = {}): SpotCurve => ({
  points: curve(300), isDemo: false, basis: 'captured', ...over,
} as SpotCurve)

const forecast = (over: Partial<LatestForecast> = {}): LatestForecast => ({
  available: true, targetDate: '2026-08-18',
  runs: [{
    modelId: 'lightgbm', modelVersion: 'v1', status: 'ok',
    points: Array.from({ length: N }, (_, i) => 200 + i),
    lower: null, upper: null, predictedAt: '2026-08-22T12:31:03Z', basis: 'captured', mock: false,
  }],
  ...over,
})

const COVERAGE = { start: '2026-01-01', end: '2026-08-18' }

describe('面板日期跟随真实覆盖区间', () => {
  it('今天还没有数据时退到覆盖区间末日——钉死"今天"就永远落在空日期上', () => {
    expect(resolvePanelDate('2026-08-22', COVERAGE)).toBe('2026-08-18')
  })

  it('今天在覆盖区间内就用今天', () => {
    expect(resolvePanelDate('2026-08-15', COVERAGE)).toBe('2026-08-15')
  })

  it('拿不到覆盖区间时仍回落今天，不猜一个日期', () => {
    expect(resolvePanelDate('2026-08-22', null)).toBe('2026-08-22')
  })
})

describe('合成曲线一律当作没有数据', () => {
  it('synth96 兜底不得进入图与 KPI——编造的价格比空面板危险得多', () => {
    const panel = buildPricePanel({
      date: '2026-08-22', coverage: COVERAGE,
      clearing: clearing({ basis: 'synthetic', isDemo: true }),
      forecast: forecast({ available: false, runs: [] }),
    })
    expect(panel.realPoints).toEqual([])
    expect(panel.basis).toBe('empty')
    expect(panel.stats).toEqual({ mean: null, spread: null, max: null, min: null })
    expect(panel.error).toContain('既无出清曲线也无已落库预测')
  })

  it('KPI 口径是实际出清，不是预测——"预测均价"来自编造曲线比没有数字更误导', () => {
    const panel = buildPricePanel({
      date: '2026-08-18', coverage: COVERAGE, clearing: clearing(), forecast: forecast(),
    })
    // 实际出清 300..395，均值 347.5；预测是 200..295，均值 247.5
    expect(panel.stats.mean).toBe(347.5)
    expect(panel.basis).toBe('captured')
    expect(panel.error).toBe('')
  })
})

describe('失败或空的预测不得被画成结论', () => {
  it('status 非 ok 的曲线不画，并说明为什么没有预测线', () => {
    const panel = buildPricePanel({
      date: '2026-08-18', coverage: COVERAGE, clearing: clearing(),
      forecast: forecast({ runs: [{ ...forecast().runs[0], status: 'skipped' }] }),
    })
    expect(panel.forecastPoints).toEqual([])
    expect(panel.error).toContain('尚无已落库的模型预测')
    // 真实出清仍要画出来——一条线没有不该拖累另一条
    expect(panel.realPoints).toHaveLength(N)
  })

  it('status=ok 但点数为空同样不画', () => {
    const panel = buildPricePanel({
      date: '2026-08-18', coverage: COVERAGE, clearing: clearing(),
      forecast: forecast({ runs: [{ ...forecast().runs[0], points: [] }] }),
    })
    expect(panel.forecastPoints).toEqual([])
  })

  it('预测在、出清还没出来 → 只画预测并说明该日尚未出清', () => {
    const panel = buildPricePanel({
      date: '2026-08-22', coverage: COVERAGE,
      clearing: clearing({ basis: 'synthetic' }), forecast: forecast(),
    })
    expect(panel.forecastPoints).toHaveLength(N)
    expect(panel.realPoints).toEqual([])
    expect(panel.error).toContain('尚未出清')
  })

  it('预测曲线铺在 96 点标准时间轴上，与出清曲线同一横轴', () => {
    const panel = buildPricePanel({
      date: '2026-08-18', coverage: COVERAGE, clearing: clearing(), forecast: forecast(),
    })
    expect(panel.forecastPoints[0].time).toBe('00:00')
    expect(panel.forecastPoints[N - 1].time).toBe('23:45')
  })
})
