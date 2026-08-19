// AnalysisChartSpec → ECharts option 映射（dljy-meta#18 / P0 #59）。
//
// 消费 @chenshi-tech/dljy-contracts 的 AnalysisChartSpec（#32）：把 Agent text2sql 产出的图表规格
// 转成 ECharts option，复用 chartStyle 封装。不引入 GPT-Vis。类型只来自 monorepo contracts
// 生成物，避免前端另存镜像而发生漂移。

import type { DataBasis } from '../data/types'
import type {
  AnalysisChartBasis,
  AnalysisChartSeries,
  AnalysisChartSpec,
  AnalysisChartType,
} from '@dljy/contracts'
import { axisTooltip } from './chartOptions'
import { POWER, barSeries, divergingColors, lineSeries, palette, seqColors } from './chartStyle'

export type {
  AnalysisChartBasis,
  AnalysisChartSeries,
  AnalysisChartSpec,
  AnalysisChartType,
  AnalysisDashboard,
} from '@dljy/contracts'

export type AnalysisRow = Record<string, unknown>

/** 契约 basis → DataBasisBadge 的 DataBasis（derived 无对应徽标样式，归入 captured）。 */
export function toDataBasis(basis: AnalysisChartBasis | undefined): DataBasis {
  switch (basis) {
    case 'real': return 'real'
    case 'synthetic': return 'synthetic'
    case 'illustrative': return 'illustrative'
    case 'captured':
    case 'derived':
    default:
      return 'captured'
  }
}

/** 这些类型由渲染组件特殊处理（表格/KPI 非图表），不走 ECharts option 映射。 */
export const NON_OPTION_TYPES = new Set<AnalysisChartType>(['table', 'kpi'])

/** 电力域专用图型（#60）：由 buildDomainOption 生成，走 ECharts。 */
export const DOMAIN_TYPES = new Set<AnalysisChartType>([
  'price_heatmap', 'duration_curve', 'spread_distribution',
  'deviation_band', 'correlation_matrix',
])

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 从行推断 x 轴字段：优先 axes.x.field；否则取首个非数值列。 */
function resolveXField(spec: AnalysisChartSpec, rows: AnalysisRow[]): string | null {
  if (spec.axes?.x?.field) return spec.axes.x.field
  if (!rows.length) return null
  const cols = Object.keys(rows[0])
  const seriesKeys = new Set((spec.series ?? []).map((s) => s.key))
  const nonNumeric = cols.find((c) => !seriesKeys.has(c) && toNumber(rows[0][c]) === null)
  return nonNumeric ?? cols[0] ?? null
}

/** 从行推断数值系列（当 spec.series 缺省时）。 */
function inferSeries(spec: AnalysisChartSpec, rows: AnalysisRow[], xField: string | null): AnalysisChartSeries[] {
  if (spec.series?.length) return spec.series
  if (!rows.length) return []
  return Object.keys(rows[0])
    .filter((c) => c !== xField && toNumber(rows[0][c]) !== null)
    .slice(0, 6)
    .map((c) => ({ name: c, key: c }))
}

/**
 * AnalysisChartSpec + 行数据 → ECharts option。
 * 覆盖通用图型 line/bar/dual_axis/scatter/pie；其余类型返回 null（由组件另行处理）。
 * 数据无效/为空返回 null（组件据此显示诚实空态）。
 */
export function chartSpecToOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  if (NON_OPTION_TYPES.has(spec.chartType)) return null
  if (DOMAIN_TYPES.has(spec.chartType)) return buildDomainOption(spec, rows)
  if (!rows.length) return null
  const xField = resolveXField(spec, rows)
  const series = inferSeries(spec, rows, xField)
  if (!series.length || !xField) return null

  const categories = rows.map((r) => String(r[xField] ?? ''))
  const colors = palette()

  if (spec.chartType === 'pie') {
    const valueKey = series[0].key
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll', bottom: 0 },
      series: [{
        type: 'pie', radius: ['40%', '68%'],
        data: rows.map((r) => ({ name: String(r[xField] ?? ''), value: toNumber(r[valueKey]) ?? 0 })),
      }],
    }
  }

  if (spec.chartType === 'scatter') {
    const yKey = series[0].key
    return {
      tooltip: axisTooltip(),
      xAxis: { type: 'category', name: spec.axes?.x?.label ?? xField, data: categories },
      yAxis: { type: 'value', name: series[0].unit ?? spec.axes?.yLeft?.unit ?? '' },
      series: [{
        type: 'scatter',
        data: rows.map((r, i) => [categories[i], toNumber(r[yKey])]),
      }],
    }
  }

  const dual = spec.chartType === 'dual_axis'
  const yAxis = dual
    ? [
        { type: 'value', name: spec.axes?.yLeft?.label ?? spec.axes?.yLeft?.unit ?? '' },
        { type: 'value', name: spec.axes?.yRight?.label ?? spec.axes?.yRight?.unit ?? '' },
      ]
    : [{ type: 'value', name: spec.axes?.yLeft?.label ?? spec.axes?.yLeft?.unit ?? '' }]

  const echSeries = series.map((s, i) => {
    const data = rows.map((r) => toNumber(r[s.key]))
    const color = colors[i % colors.length]
    const yAxisIndex = dual && s.axis === 'right' ? 1 : 0
    const base = s.seriesType === 'bar' || spec.chartType === 'bar'
      ? barSeries(s.name, data, color)
      : lineSeries(s.name, data, color)
    return { ...base, yAxisIndex }
  })

  return {
    tooltip: axisTooltip(),
    legend: series.length > 1 ? { type: 'scroll', top: 0 } : undefined,
    xAxis: { type: 'category', name: spec.axes?.x?.label ?? '', data: categories },
    yAxis,
    series: echSeries,
  }
}

// ---------------------------------------------------------------------------
// 电力域专用图型（#60）：日×96 点电价热力图、持续曲线、价差分布、偏差带、相关矩阵热图。
// 优先读 spec.params（stats 工具产出）；否则从行数据推断。数据形态不满足时返回 null，
// 组件据此显示诚实空态。
// ---------------------------------------------------------------------------

function firstNumericKey(rows: AnalysisRow[], exclude: string[] = []): string | null {
  if (!rows.length) return null
  return Object.keys(rows[0]).find((c) => !exclude.includes(c) && toNumber(rows[0][c]) !== null) ?? null
}

function firstNonNumericKey(rows: AnalysisRow[]): string | null {
  if (!rows.length) return null
  return Object.keys(rows[0]).find((c) => toNumber(rows[0][c]) === null) ?? null
}

function correlationMatrixOption(spec: AnalysisChartSpec): Record<string, unknown> | null {
  const p = spec.params ?? {}
  const labels = (p.labels as string[]) ?? []
  const matrix = (p.matrix as (number | null)[][]) ?? []
  if (!labels.length || matrix.length !== labels.length) return null
  const data: [number, number, number][] = []
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      const v = toNumber(matrix[i]?.[j])
      if (v !== null) data.push([j, i, Math.round(v * 1000) / 1000])
    }
  }
  return {
    tooltip: { position: 'top' },
    grid: { top: 40, bottom: 60, left: 90, right: 20 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 30 } },
    yAxis: { type: 'category', data: labels },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: divergingColors() },
    },
    series: [{
      type: 'heatmap', data,
      label: { show: labels.length <= 8, formatter: (o: { value: number[] }) => String(o.value[2]) },
      emphasis: { itemStyle: { shadowBlur: 8 } },
    }],
  }
}

function priceHeatmapOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  if (!rows.length) return null
  const p = spec.params ?? {}
  const yField = (p.yField as string) ?? spec.axes?.yLeft?.field ?? firstNonNumericKey(rows)
  const cols = Object.keys(rows[0])
  const xField = (p.xField as string) ?? spec.axes?.x?.field ??
    cols.find((c) => /point|time|时段|时点/i.test(c)) ?? null
  const valField = (p.valueField as string) ?? firstNumericKey(rows, [xField ?? '', yField ?? ''])
  if (!yField || !xField || !valField) return null
  const yVals = [...new Set(rows.map((r) => String(r[yField] ?? '')))]
  const xVals = [...new Set(rows.map((r) => String(r[xField] ?? '')))]
  const yIdx = new Map(yVals.map((v, i) => [v, i]))
  const xIdx = new Map(xVals.map((v, i) => [v, i]))
  const data: [number, number, number][] = []
  let min = Infinity, max = -Infinity
  for (const r of rows) {
    const v = toNumber(r[valField])
    if (v === null) continue
    data.push([xIdx.get(String(r[xField] ?? '')) ?? 0, yIdx.get(String(r[yField] ?? '')) ?? 0, v])
    min = Math.min(min, v); max = Math.max(max, v)
  }
  if (!data.length) return null
  return {
    tooltip: { position: 'top' },
    grid: { top: 30, bottom: 60, left: 90, right: 20 },
    xAxis: { type: 'category', data: xVals, name: spec.axes?.x?.label ?? xField },
    yAxis: { type: 'category', data: yVals, name: spec.axes?.yLeft?.label ?? yField },
    visualMap: {
      min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: seqColors() },
    },
    series: [{ type: 'heatmap', data, progressive: 2000, emphasis: { itemStyle: { shadowBlur: 6 } } }],
  }
}

function durationCurveOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  const key = spec.series?.[0]?.key ?? firstNumericKey(rows)
  if (!key) return null
  const values = rows.map((r) => toNumber(r[key])).filter((v): v is number => v !== null).sort((a, b) => b - a)
  if (!values.length) return null
  const x = values.map((_, i) => `${Math.round((i / (values.length - 1 || 1)) * 100)}%`)
  return {
    tooltip: axisTooltip(),
    xAxis: { type: 'category', data: x, name: '时间占比' },
    yAxis: { type: 'value', name: spec.series?.[0]?.unit ?? spec.axes?.yLeft?.unit ?? '' },
    series: [lineSeries(spec.series?.[0]?.name ?? key, values, POWER.load)],
  }
}

function spreadDistributionOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  const p = spec.params ?? {}
  const hist = (p.histogram as { bin: number; count: number }[]) ?? null
  const bins = hist ?? rows.map((r) => ({ bin: toNumber(r.bin) ?? 0, count: toNumber(r.count) ?? 0 }))
  if (!bins.length) return null
  return {
    tooltip: axisTooltip(),
    xAxis: { type: 'category', data: bins.map((b) => (typeof b.bin === 'number' ? b.bin.toFixed(1) : String(b.bin))), name: spec.axes?.x?.label ?? '区间' },
    yAxis: { type: 'value', name: '频数' },
    series: [barSeries('频数', bins.map((b) => b.count), POWER.price)],
  }
}

function deviationBandOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  if (!rows.length) return null
  const cols = Object.keys(rows[0])
  const has = (n: string) => cols.includes(n)
  if (!(has('lower') && has('upper'))) return null
  const xField = spec.axes?.x?.field ?? firstNonNumericKey(rows) ?? cols[0]
  const x = rows.map((r) => String(r[xField] ?? ''))
  const lower = rows.map((r) => toNumber(r.lower))
  const upper = rows.map((r) => toNumber(r.upper))
  const mid = rows.map((r) => toNumber(r.mid ?? r.median ?? r.forecast))
  const actual = rows.map((r) => toNumber(r.actual))
  const band = lower.map((lo, i) => (lo == null || upper[i] == null ? null : upper[i]! - lo))
  return {
    tooltip: axisTooltip(),
    legend: { top: 0 },
    xAxis: { type: 'category', data: x, name: spec.axes?.x?.label ?? '' },
    yAxis: { type: 'value', name: spec.axes?.yLeft?.unit ?? '' },
    series: [
      { name: '下界', type: 'line', data: lower, lineStyle: { opacity: 0 }, stack: 'band', symbol: 'none' },
      { name: '区间', type: 'line', data: band, lineStyle: { opacity: 0 }, stack: 'band', symbol: 'none',
        areaStyle: { color: POWER.forecast, opacity: 0.25 } },
      { name: '中枢', type: 'line', data: mid, lineStyle: { color: POWER.forecast, type: 'dashed' }, symbol: 'none' },
      { name: '实际', type: 'scatter', data: actual.map((v, i) => [x[i], v]), itemStyle: { color: POWER.deviation }, symbolSize: 6 },
    ],
  }
}

function buildDomainOption(spec: AnalysisChartSpec, rows: AnalysisRow[]): Record<string, unknown> | null {
  switch (spec.chartType) {
    case 'correlation_matrix': return correlationMatrixOption(spec)
    case 'price_heatmap': return priceHeatmapOption(spec, rows)
    case 'duration_curve': return durationCurveOption(spec, rows)
    case 'spread_distribution': return spreadDistributionOption(spec, rows)
    case 'deviation_band': return deviationBandOption(spec, rows)
    default: return null
  }
}
