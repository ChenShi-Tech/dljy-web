import { describe, expect, it } from 'vitest'
import type { DeskDataResult, DeskSeries } from './disclosureDeskData'
import { buildDisclosureDeskInsights } from './disclosureDeskInsights'

const point = (time: string, value: number | null) => ({ time: `2026-07-01 ${time}`, value })
const series = (id: string, values: Array<ReturnType<typeof point>>, minutes = 15): DeskSeries => ({ id, label: id, unit: 'MW', nativeMinutes: minutes, step: false, points: values })
const result = (id: string, series: DeskSeries[]): DeskDataResult => ({ metric: { id, label: id, unit: 'MW', themeId: 'load', family: 'fixture', sources: [], requiresChannel: false, nativeMinutes: 15, difference: { id: id === 'price' ? 'spread' : 'deviation', label: '差值' } }, series, channels: [], status: 'available', reason: '', sourceType: 'DB', latestAt: null, summary: [], warnings: [] })

describe('披露台选区关键变化', () => {
  it('价差按有符号数值最大值，预测偏差按绝对值，定位原生完整时段', () => {
    const data = [result('price', [series('spread', [point('10:00', -120), point('11:00', -20)], 60)]), result('load', [series('deviation', [point('10:00', 50), point('10:15', -80)])])]
    const insights = buildDisclosureDeskInsights(data)
    expect(insights.map((item) => item.value)).toEqual([-20, -80])
    expect(insights[0]).toMatchObject({ from: '2026-07-01T11:00:00.000+08:00', to: '2026-07-01T11:59:59.999+08:00' })
    expect(insights[1]).toMatchObject({ from: '2026-07-01T10:15:00.000+08:00', to: '2026-07-01T10:29:59.999+08:00' })
  })
  it('只统计与选区重叠的原始时段，UTC与北京时间含义一致', () => {
    const data = [result('price', [series('spread', [point('09:00', 999), point('10:00', 0), point('11:00', 999)], 60)])]
    const insights = buildDisclosureDeskInsights(data, { from: '2026-07-01T02:15:00Z', to: '2026-07-01T02:45:00Z' })
    expect(insights).toHaveLength(1)
    expect(insights[0].value).toBe(0)
    expect(insights[0].time).toBe('2026-07-01 10:00')
  })
  it('真实零值参与连续变化，缺测、非15分钟间距和选区外前值不参与', () => {
    const data = [result('load', [series('actual', [point('09:45', 900), point('10:00', 10), point('10:15', 0), point('10:30', null), point('10:45', 100), point('11:30', 1000)])])]
    const [insight] = buildDisclosureDeskInsights(data, { from: '2026-07-01T10:00:00+08:00', to: '2026-07-01T11:45:00+08:00' })
    expect(insight.value).toBe(-10)
    expect(insight.from).toBe('2026-07-01T10:00:00.000+08:00')
    expect(insight.to).toBe('2026-07-01T10:29:59.999+08:00')
    expect(buildDisclosureDeskInsights(data, { from: '2026-07-01T10:15:00+08:00', to: '2026-07-01T10:29:59+08:00' })).toEqual([])
  })
  it('分别读取同口径派生偏差，不能凭两条原始线臆造偏差；小时与日级不算15分钟变化', () => {
    const data = [result('load', [series('forecast', [point('10:00', 200), point('11:00', 100)], 60), series('actual', [point('10:00', 300), point('11:00', 10)], 60)])]
    expect(buildDisclosureDeskInsights(data)).toEqual([])
    data[0].series[0].nativeMinutes = null
    expect(buildDisclosureDeskInsights(data)).toEqual([])
  })
  it('在预测和实际中选绝对变化最大的序列，并排除偏差线', () => {
    const [deviation, ramp] = buildDisclosureDeskInsights([result('new-energy', [series('forecast', [point('10:00', 20), point('10:15', 25)]), series('actual', [point('10:00', 25), point('10:15', 0)]), series('deviation', [point('10:00', 5), point('10:15', -1000)])])])
    expect(deviation.value).toBe(-1000)
    expect(ramp.value).toBe(-25)
    expect(ramp.label).toContain('actual')
  })
  it('错误响应不使用残留数据；部分缺测仅比较有效样本，非市场偏差也可定位', () => {
    const data = result('non-market', [series('deviation', [point('10:00', null), point('10:15', 15)])])
    expect(buildDisclosureDeskInsights([{ ...data, status: 'unauthorized' }])).toEqual([])
    expect(buildDisclosureDeskInsights([{ ...data, status: 'partial' }])[0]).toMatchObject({ metricId: 'non-market', value: 15 })
  })
  it('反向和无效选区不产生摘要', () => {
    const data = [result('price', [series('spread', [point('10:00', 10)], 60)])]
    expect(buildDisclosureDeskInsights(data, { from: '2026-07-01T10:45:00+08:00', to: '2026-07-01T10:15:00+08:00' })).toEqual([])
    expect(buildDisclosureDeskInsights(data, { from: 'invalid', to: '2026-07-01T10:15:00+08:00' })).toEqual([])
  })
})
