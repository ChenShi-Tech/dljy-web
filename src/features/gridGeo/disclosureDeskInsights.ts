import type { DeskDataResult, DeskPoint, DeskSeries } from './disclosureDeskData'

export type DeskInsightWindow = { from: string; to: string }
export type DeskInsight = DeskInsightWindow & {
  id: string; metricId: string; label: string; value: number; unit: string; time: string; detail: string
}

function stamp(value: string) {
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}+08:00`)
}
function iso(value: number) { return `${new Date(value + 8 * 3600_000).toISOString().slice(0, 23)}+08:00` }
function pointWindow(point: DeskPoint, series: DeskSeries): DeskInsightWindow {
  const from = stamp(point.time)
  return { from: iso(from), to: iso(from + (series.nativeMinutes ?? 0) * 60_000 - 1) }
}
function pointsInWindow(series: DeskSeries, window?: DeskInsightWindow | null) {
  if (!series.nativeMinutes) return []
  const from = window ? stamp(window.from) : -Infinity, to = window ? stamp(window.to) : Infinity
  if (window && (!Number.isFinite(from) || !Number.isFinite(to) || from > to)) return []
  return series.points.filter((point) => {
    const time = stamp(point.time)
    return Number.isFinite(time) && time <= to && time + series.nativeMinutes! * 60_000 > from
  }).sort((a, b) => stamp(a.time) - stamp(b.time))
}
const valid = (point: DeskPoint): point is DeskPoint & { value: number } => point.value !== null && Number.isFinite(point.value)

/** Only summarize normalized, comparable series. Never infer a forecast error from unrelated datasets. */
export function buildDisclosureDeskInsights(results: DeskDataResult[], window?: DeskInsightWindow | null): DeskInsight[] {
  const insights: DeskInsight[] = []
  for (const result of results) {
    if (!['available', 'partial'].includes(result.status)) continue
    const metric = result.metric
    const difference = result.series.find((series) => series.id === metric.difference?.id)
    if (difference) {
      const candidates = pointsInWindow(difference, window).filter(valid)
      const price = metric.id === 'price'
      const peak = candidates.reduce<(typeof candidates)[number] | null>((best, point) => !best || (price ? point.value > best.value : Math.abs(point.value) > Math.abs(best.value)) ? point : best, null)
      if (peak) insights.push({
        id: `${metric.id}:difference`, metricId: metric.id, label: price ? '实时－日前价差最大' : `${metric.label} · 预测偏差最大`,
        value: peak.value, unit: difference.unit, time: peak.time, ...pointWindow(peak, difference),
        detail: price ? '按价差数值取最大值' : '按绝对值比较，显示实际－预测',
      })
    }
    if (!['load', 'new-energy'].includes(metric.id)) continue
    let ramp: DeskInsight | null = null
    for (const series of result.series.filter((item) => item.nativeMinutes === 15 && item.id !== metric.difference?.id)) {
      const points = pointsInWindow(series, window)
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1], point = points[index]
        // Missing samples and non-adjacent timestamps must never become a 15-minute ramp.
        if (!valid(previous) || !valid(point) || stamp(point.time) - stamp(previous.time) !== 15 * 60_000) continue
        const value = point.value - previous.value
        if (ramp && Math.abs(value) <= Math.abs(ramp.value)) continue
        ramp = { id: `${metric.id}:ramp`, metricId: metric.id, label: `${series.label} · 15 分钟变化最大`, value, unit: series.unit, time: point.time,
          from: pointWindow(previous, series).from, to: pointWindow(point, series).to,
          detail: `${previous.time.slice(5)} → ${point.time.slice(5)}，后值－前值` }
      }
    }
    if (ramp) insights.push(ramp)
  }
  return insights
}
