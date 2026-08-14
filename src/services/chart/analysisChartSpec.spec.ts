import { describe, expect, it } from 'vitest'
import {
  type AnalysisChartSpec,
  chartSpecToOption,
  NON_OPTION_TYPES,
  toDataBasis,
} from './analysisChartSpec'

const rows = [
  { ym: '2026-05', avg_price: 132.0, load: 3000 },
  { ym: '2026-06', avg_price: 145.5, load: 3200 },
]

describe('chartSpecToOption', () => {
  it('builds a line option with explicit series and x field', () => {
    const spec: AnalysisChartSpec = {
      chartType: 'line', title: '价格趋势',
      series: [{ name: '均价', key: 'avg_price' }],
      axes: { x: { kind: 'category', field: 'ym' } },
    }
    const opt = chartSpecToOption(spec, rows) as any
    expect(opt).toBeTruthy()
    expect(opt.xAxis.data).toEqual(['2026-05', '2026-06'])
    expect(opt.series[0].data).toEqual([132.0, 145.5])
  })

  it('infers series and x field when omitted', () => {
    const opt = chartSpecToOption({ chartType: 'bar', title: 't' }, rows) as any
    expect(opt.series.length).toBeGreaterThan(0)
    expect(opt.xAxis.data).toEqual(['2026-05', '2026-06'])
  })

  it('routes right-axis series to yAxisIndex 1 for dual_axis', () => {
    const spec: AnalysisChartSpec = {
      chartType: 'dual_axis', title: 't',
      series: [
        { name: '均价', key: 'avg_price', axis: 'left' },
        { name: '负荷', key: 'load', axis: 'right', seriesType: 'bar' },
      ],
      axes: { x: { kind: 'category', field: 'ym' } },
    }
    const opt = chartSpecToOption(spec, rows) as any
    expect(Array.isArray(opt.yAxis)).toBe(true)
    expect(opt.yAxis.length).toBe(2)
    expect(opt.series[1].yAxisIndex).toBe(1)
  })

  it('returns null for table/kpi/domain types (component-handled)', () => {
    for (const t of NON_OPTION_TYPES) {
      expect(chartSpecToOption({ chartType: t, title: 't' }, rows)).toBeNull()
    }
  })

  it('returns null for empty rows (honest empty state)', () => {
    expect(chartSpecToOption({ chartType: 'line', title: 't' }, [])).toBeNull()
  })

  it('coerces numeric strings', () => {
    const opt = chartSpecToOption(
      { chartType: 'line', title: 't', series: [{ name: 'v', key: 'v' }], axes: { x: { kind: 'category', field: 'x' } } },
      [{ x: 'a', v: '1.5' }, { x: 'b', v: '2.5' }],
    ) as any
    expect(opt.series[0].data).toEqual([1.5, 2.5])
  })
})

describe('toDataBasis', () => {
  it('maps contract basis to DataBasis, folding derived into captured', () => {
    expect(toDataBasis('real')).toBe('real')
    expect(toDataBasis('synthetic')).toBe('synthetic')
    expect(toDataBasis('derived')).toBe('captured')
    expect(toDataBasis('captured')).toBe('captured')
    expect(toDataBasis(undefined)).toBe('captured')
  })
})

describe('domain chart builders (#60)', () => {
  it('correlation_matrix from params.matrix builds heatmap', () => {
    const spec: AnalysisChartSpec = {
      chartType: 'correlation_matrix', title: '相关',
      params: { labels: ['price', 'load'], matrix: [[1, 0.8], [0.8, 1]] },
    }
    const opt = chartSpecToOption(spec, []) as any
    expect(opt.series[0].type).toBe('heatmap')
    expect(opt.series[0].data.length).toBe(4)
    expect(opt.visualMap.min).toBe(-1)
  })

  it('duration_curve sorts values descending', () => {
    const opt = chartSpecToOption(
      { chartType: 'duration_curve', title: 'dur', series: [{ name: 'p', key: 'p' }] },
      [{ p: 10 }, { p: 30 }, { p: 20 }],
    ) as any
    expect(opt.series[0].data).toEqual([30, 20, 10])
  })

  it('spread_distribution from params.histogram builds bars', () => {
    const opt = chartSpecToOption(
      { chartType: 'spread_distribution', title: 'd', params: { histogram: [{ bin: 1, count: 3 }, { bin: 2, count: 5 }] } },
      [],
    ) as any
    expect(opt.series[0].data).toEqual([3, 5])
  })

  it('deviation_band needs lower/upper columns', () => {
    const rows = [
      { x: 'a', lower: 1, mid: 2, upper: 3, actual: 2.5 },
      { x: 'b', lower: 2, mid: 3, upper: 4, actual: 3.1 },
    ]
    const opt = chartSpecToOption({ chartType: 'deviation_band', title: 'b', axes: { x: { kind: 'category', field: 'x' } } }, rows) as any
    expect(opt.series.some((s: any) => s.name === '实际' && s.type === 'scatter')).toBe(true)
    expect(chartSpecToOption({ chartType: 'deviation_band', title: 'b' }, [{ x: 'a', v: 1 }])).toBeNull()
  })

  it('price_heatmap infers time/date/value fields', () => {
    const rows = [
      { op_date: '2026-05-01', time_point: '00:00', price: 100 },
      { op_date: '2026-05-01', time_point: '00:15', price: 110 },
      { op_date: '2026-05-02', time_point: '00:00', price: 90 },
    ]
    const opt = chartSpecToOption({ chartType: 'price_heatmap', title: 'h' }, rows) as any
    expect(opt.series[0].type).toBe('heatmap')
    expect(opt.series[0].data.length).toBe(3)
  })

  it('domain type returns null on insufficient data (honest empty)', () => {
    expect(chartSpecToOption({ chartType: 'correlation_matrix', title: 'c' }, [])).toBeNull()
  })
})

