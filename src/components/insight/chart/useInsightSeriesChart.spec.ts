// useInsightSeriesChart.spec.ts — 序列图表内核回归（dljy#2996 任务 5.8，design DE03/DE09）
// 守什么不变量：
//   ① 阶梯线 step:'end'（值是 [start,end) 整段口径、起点标注，不是时点瞬时值）；连续段末尾补区间终点边界点；
//   ② 缺测时段插 null 断开：connectNulls:false、smooth:false——平滑或连线都会造出
//      没有观测的形状，0 也不能顶替缺测；
//   ③ 首个有效行之前 / 最后有效行之后不画线（那些日子没有观测，不是缺测断线）；
//   ④ y 轴按单位分组：同单位共轴，价格（yuan/MWh）与功率（MW）各一根轴绝不共轴；
//      一张图最多两种单位，第三种单位拆成第二张图；
//   ⑤ tooltip 缺测写「缺测」，显示业务名与区间起止。
// 坏掉的症状：平滑曲线把缺测边界画成斜坡；不同量纲画在同一根轴上比大小。
import { describe, expect, it } from 'vitest'
import { buildInsightChartGroups, buildInsightChartOption } from './useInsightSeriesChart'
import { insightResult, loadSeries, nodePriceSeries, nodePriceResult } from '../insightFixtures'
import type { InsightSeriesMeta } from '@/services/insight/insightClient'

const TS_0000 = Date.parse('2026-09-10T00:00:00+08:00')
const TS_0015 = Date.parse('2026-09-10T00:15:00+08:00')

function optionOf(index = 0): ReturnType<typeof buildInsightChartOption> {
  return buildInsightChartOption(buildInsightChartGroups(nodePriceResult(['300.125', '301.5', null, '303']))[index])
}

describe('阶梯线与缺测断开', () => {
  it('边界点只负责画满最后一段：tooltip 不把它当观测列出', () => {
    const option = optionOf() as { tooltip: { formatter: (raw: unknown) => string } }
    const edge = option.tooltip.formatter([
      { marker: '', seriesName: groups0Name(), data: { value: [TS_0015, 301.5], end: '2026-09-10T00:30:00+08:00', edge: true } },
    ])
    expect(edge).toBe('')
  })

  it('step:end、connectNulls:false、smooth:false 一个都不能少', () => {
    const option = optionOf() as { series: Array<Record<string, unknown>> }
    const series = option.series[0]

    // 值标在区间起点：'end' 让它水平延续到下一个点；'start' 会把每个值画到前一个区间上。
    expect(series.step).toBe('end')
    expect(series.connectNulls).toBe(false)
    expect(series.smooth).toBe(false)
  })

  it('中间不下行的格点插 null 断开，值按显示层 Number() 转数字', () => {
    const groups = buildInsightChartGroups(nodePriceResult(['300.125', '301.5', null, '303']))
    const points = groups[0].series[0].points

    // 观测 3 个 + 缺测 1 个 + 两个连续段各补 1 个区间终点边界点
    expect(points).toHaveLength(6)
    expect(points[0]).toMatchObject({ ts: TS_0000, value: 300.125 })
    expect(points[1].value).toBe(301.5)
    // 缺测前的最后一段补边界点，把 301.5 画满到 00:30
    expect(points[2]).toMatchObject({ ts: Date.parse('2026-09-10T00:30:00+08:00'), value: 301.5, edge: true })
    // 00:30-00:45 无行 = 缺测：null 断开，绝不用 0 顶替。
    expect(points[3]).toMatchObject({ ts: Date.parse('2026-09-10T00:30:00+08:00'), value: null })
    expect(points[3].edge).toBeUndefined()
    expect(points[4].value).toBe(303)
    expect(points[5]).toMatchObject({ ts: Date.parse('2026-09-10T01:00:00+08:00'), value: 303, edge: true })
  })

  it('首个有效行之前与最后有效行之后不生成格点（没有观测 ≠ 缺测断线）', () => {
    const groups = buildInsightChartGroups(nodePriceResult([null, '300', null]))
    const points = groups[0].series[0].points

    // 一个观测 + 它的区间终点边界点；首尾之外不生成格点
    expect(points).toHaveLength(2)
    expect(points[0].value).toBe(300)
    expect(points[1].edge).toBe(true)
  })

  it('tooltip 缺测写「缺测」，正常值按来源显示精度', () => {
    const option = optionOf() as { tooltip: { trigger: string; formatter: (raw: unknown) => string } }
    expect(option.tooltip.trigger).toBe('axis')

    const missing = option.tooltip.formatter([
      { marker: '', seriesName: groups0Name(), data: { value: [TS_0015, null], end: '2026-09-10T00:15:00+08:00' } },
    ])
    expect(missing).toContain('缺测')

    const normal = option.tooltip.formatter([
      { marker: '', seriesName: groups0Name(), data: { value: [TS_0000, 300.125], end: '2026-09-10T00:15:00+08:00' } },
    ])
    expect(normal).toContain('300.125')
    expect(normal).toContain('yuan/MWh')
    // 区间起止（北京时间）必须在 tooltip 里：值是整段口径，不是时点。
    expect(normal).toContain('00:00~00:15')
  })
})

function groups0Name(): string {
  return buildInsightChartGroups(nodePriceResult(['300']))[0].series[0].name
}

/** 组一个多序列结果的 data 部分。 */
function dataOf(series: InsightSeriesMeta[], rows: Array<Record<string, string>>) {
  return {
    schemaVersion: 'insight-result-data/v1',
    dimensions: [
      { id: 'seriesId', kind: 'category' },
      { id: 'intervalStart', kind: 'time' },
      { id: 'intervalEnd', kind: 'time' },
    ],
    measures: [{ id: 'value', unit: 'by-series' }],
    rows,
    series,
  }
}

describe('y 轴按单位分组', () => {
  const price = nodePriceSeries()
  const load = loadSeries()
  const energy = loadSeries({ seriesId: 'ser-energy-1', fieldId: 'totalEnergy', unit: 'MWh', measureKind: 'energy' })
  const rows = [
    { seriesId: price.seriesId, intervalStart: '2026-09-10T00:00:00+08:00', intervalEnd: '2026-09-10T00:15:00+08:00', value: '300' },
    { seriesId: load.seriesId, intervalStart: '2026-09-10T00:00:00+08:00', intervalEnd: '2026-09-10T00:15:00+08:00', value: '12000' },
    { seriesId: energy.seriesId, intervalStart: '2026-09-10T00:00:00+08:00', intervalEnd: '2026-09-10T00:15:00+08:00', value: '5000' },
  ]

  it('价格与功率同图但各一根轴，绝不共轴比较', () => {
    const result = insightResult({ data: dataOf([price, load], rows.slice(0, 2)) })
    const groups = buildInsightChartGroups(result)

    expect(groups).toHaveLength(1)
    expect(groups[0].units).toEqual(['yuan/MWh', 'MW'])
    const option = buildInsightChartOption(groups[0]) as { yAxis: Array<{ name?: string }>; series: Array<{ yAxisIndex: number; name: string }> }
    expect(option.yAxis.map((axis) => axis.name)).toEqual(['yuan/MWh', 'MW'])
    expect(option.series.find((item) => item.name.includes('YN.KM.01'))?.yAxisIndex).toBe(0)
    expect(option.series.find((item) => !item.name.includes('YN.KM.01'))?.yAxisIndex).toBe(1)
  })

  it('超过两种单位拆成多张图：第三种单位另起一张', () => {
    const result = insightResult({ data: dataOf([price, load, energy], rows) })
    const groups = buildInsightChartGroups(result)

    expect(groups).toHaveLength(2)
    expect(groups[0].units).toEqual(['yuan/MWh', 'MW'])
    expect(groups[1].units).toEqual(['MWh'])
    expect(groups[1].series).toHaveLength(1)
  })
})

describe('业务名与格点', () => {
  it('序列名含对象身份与市场阶段，不暴露来源标识原文', () => {
    const groups = buildInsightChartGroups(nodePriceResult(['300']))
    const name = groups[0].series[0].name

    expect(name).toContain('YN.KM.01')
    expect(name).toContain('日前')
    expect(name).not.toMatch(/yn\.|capture|family/)
  })

  it('区间终点随点携带（tooltip 展示整段口径用）', () => {
    const groups = buildInsightChartGroups(nodePriceResult(['300']))
    expect(groups[0].series[0].points[0].end).toBe('2026-09-10T00:15:00+08:00')
  })
})
