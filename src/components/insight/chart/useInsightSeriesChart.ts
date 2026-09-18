// 市场洞察序列图表内核（dljy#2996，OpenSpec 任务 5.8，design DE09）
// ----------------------------------------------------------------------------
// 把一份规范结果（insight-result-data/v1 长表 + 序列目录）转成 ECharts option：
//   - 每条序列一条阶梯线（step:'start'）：值代表 [intervalStart, intervalEnd) 整段，
//     不是时点瞬时值（DE03）；
//   - 缺测时段插 null 断开（connectNulls:false），不插值、不平滑（smooth 必须 false）——
//     平滑曲线会在缺测边界造出没有观测的形状；
//   - y 轴按单位分组：同单位共用一根轴，不同单位各自成轴；一张图最多两根轴，
//     超过两种单位拆成多个图（返回分组，由调用方渲染多个 ChartCard）；
//     价格（元/MWh）与功率（MW）因单位不同天然不共轴、不可比（A05）；
//   - tooltip 只显示业务身份与值（按来源显示精度），缺测写「缺测」；数值只在
//     显示层 Number()，本模块不做任何统计（DE12）。
// ECharts 实例生命周期由 useEChart / ChartCard 托管，本模块是纯转换。

import type { EChartsOption } from 'echarts'
import { businessDayRange } from 'shared/insight/intervals.mjs'
import type { InsightBlockResult, InsightSeriesMeta } from '@/services/insight/insightClient'
import { formatInsightValue, insightPrecision, insightSeriesName } from '../insightText'

/** 一条序列的展示点：ts 为区间起点毫秒；value 为 null 即缺测；end 为区间终点（北京时间 ISO）。 */
export type InsightChartPoint = { ts: number; value: number | null; end: string }

export type InsightChartSeries = {
  meta: InsightSeriesMeta
  /** 业务名（对象名 + 字段 + 市场阶段，见 insightSeriesName） */
  name: string
  unit: string
  points: InsightChartPoint[]
}

/** 一张图：最多两种单位，每种单位一根独立 y 轴。 */
export type InsightChartGroup = {
  units: string[]
  series: InsightChartSeries[]
}

const MINUTE_MS = 60_000

/** 北京时间 HH:mm（轴标签与 tooltip 用；显式换算，不依赖浏览器本地时区）。 */
function beijingHM(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16)
}

function beijingMD(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(5, 10)
}

/**
 * 单条序列 → 展示点。只在「首个有效行到最后有效行」的跨度内生成格点
 * （窗口级全量填充会在宽窗 × 多对象时造出几十万个空点），中间缺的时段照插 null，
 * 断线语义不受影响；首尾之外的日子本来就没有观测，不画线。
 */
function buildPoints(
  meta: InsightSeriesMeta,
  rows: Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }>
): InsightChartPoint[] {
  const own = rows
    .filter((row) => row.seriesId === meta.seriesId)
    .map((row) => ({ startMs: Date.parse(row.intervalStart), endIso: row.intervalEnd, value: row.value }))
    .filter((row) => Number.isFinite(row.startMs))
    .sort((a, b) => a.startMs - b.startMs)
  if (!own.length) return []

  const step = meta.resolutionMinutes * MINUTE_MS
  const slots = new Map<number, { endIso: string; value: string }>()
  for (const row of own) slots.set(row.startMs, { endIso: row.endIso, value: row.value })

  const points: InsightChartPoint[] = []
  // 从首个格点步进到最后一个有效起点；缺的格点为 null（缺测断开）。
  for (let ts = own[0].startMs; ts <= own[own.length - 1].startMs; ts += step) {
    const slot = slots.get(ts)
    points.push(
      slot
        ? { ts, value: Number(slot.value), end: slot.endIso }
        : { ts, value: null, end: new Date(ts + step + 8 * 3_600_000).toISOString().replace('Z', '+08:00') }
    )
  }
  return points
}

/**
 * 按单位分组：同单位共轴；一张图最多两根轴（两种单位），超过两种单位依次拆图。
 * 例：yuan/MWh + MW 同图（各自一轴），再出现 MWh 则另起一张图。
 */
export function buildInsightChartGroups(result: InsightBlockResult): InsightChartGroup[] {
  const data = result.data
  if (!data?.series?.length) return []
  const rows = (data.rows ?? []) as Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }>

  const groups: InsightChartGroup[] = []
  let current: InsightChartGroup | null = null
  for (const meta of data.series) {
    const points = buildPoints(meta, rows)
    if (!points.length) continue
    if (!current || !current.units.includes(meta.unit)) {
      if (!current || current.units.length >= 2) {
        current = { units: [], series: [] }
        groups.push(current)
      }
      current.units.push(meta.unit)
    }
    current.series.push({ meta, name: insightSeriesName(meta), unit: meta.unit, points })
  }
  return groups
}

type TooltipParam = {
  marker?: string
  seriesName?: string
  data?: { value?: [number, number | null]; end?: string }
}

/**
 * 一组序列 → ECharts option（tooltip 显示业务名、区间起止（北京时间）、值与单位，
 * 缺测写「缺测」）。brush / dataZoom 等交互组件由渲染方按需注入。
 */
export function buildInsightChartOption(group: InsightChartGroup): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? (raw as TooltipParam[]) : [raw as TooltipParam]
        const lines: string[] = []
        for (const param of params) {
          const value = param.data?.value
          if (!value) continue
          const [ts, val] = value
          const endIso = param.data?.end
          const endHM = endIso && Number.isFinite(Date.parse(endIso)) ? beijingHM(Date.parse(endIso)) : ''
          const shown =
            val === null || val === undefined || !Number.isFinite(val)
              ? '缺测'
              : formatInsightValue(String(val), insightPrecision(group.series.find((s) => s.name === param.seriesName)?.meta.sourceId ?? ''))
          const unit = group.series.find((s) => s.name === param.seriesName)?.unit ?? ''
          lines.push(
            `${param.marker ?? ''}${param.seriesName ?? ''}<br/>${beijingMD(ts)} ${beijingHM(ts)}~${endHM}：${shown}${unit ? ` ${unit}` : ''}`
          )
        }
        return lines.join('<br/>')
      },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 56, right: 56, top: 36, bottom: 48 },
    xAxis: {
      type: 'time',
      axisLabel: { formatter: (value: number) => `${beijingMD(value)} ${beijingHM(value)}` },
    },
    yAxis: group.units.map((unit) => ({ type: 'value', name: unit, scale: true })),
    dataZoom: [{ type: 'inside' }],
    series: group.series.map((series) => ({
      name: series.name,
      type: 'line' as const,
      // 阶梯线：值是 [start, end) 整段口径；缺测断开；不平滑（见文件头注释）。
      step: 'start' as const,
      connectNulls: false,
      smooth: false,
      yAxisIndex: group.units.indexOf(series.unit),
      symbol: 'none',
      data: series.points.map((point) => ({ value: [point.ts, point.value], end: point.end })),
      emphasis: { focus: 'series' as const },
    })),
  }
}

/** 业务窗（北京时间业务日）的毫秒区间；供渲染方设置 brush / 联动边界。 */
export function insightWindowRange(window: { start: string; end: string }): { startMs: number; endMs: number } {
  const start = businessDayRange(window.start)
  const end = businessDayRange(window.end)
  return { startMs: start.startMs, endMs: end.endMs }
}

/**
 * 表格/联动共用的行键：seriesId + intervalStart（语义身份，不按下标）。
 */
export function insightRowKey(row: { seriesId: string; intervalStart: string }): string {
  return `${row.seriesId}@${row.intervalStart}`
}
