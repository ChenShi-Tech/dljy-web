// zsjfxAiContext — S3（Epic #3591 / dljy#3595，ZW-07/08）的确定性素材与标记构造。
// 区段统计（选中即问的 contextPayload 素材）与异动 markPoint/markArea 构造都是纯函数：
// AI 只消费算好的数值（控制反转），异动开关关闭时返回空标记、不触碰手动标注存储。
import type { ZsjfxScorecardAnomaly } from '@/services/insight/zsjfxScorecardClient'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 区段 [from, to]（含端点，槽位下标）内各序列的确定性统计：空值剔除并计数。 */
export function segmentStats(series: Record<string, Array<number | null>>, from: number, to: number): Record<string, { count: number; nulls: number; min: number | null; max: number | null; avg: number | null }> {
  const out: Record<string, { count: number; nulls: number; min: number | null; max: number | null; avg: number | null }> = {}
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(95, Math.max(from, to))
  for (const [name, curve] of Object.entries(series)) {
    let count = 0
    let nulls = 0
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (let i = lo; i <= hi; i += 1) {
      const v = curve?.[i]
      if (!isNum(v)) { nulls += 1; continue }
      count += 1
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
    out[name] = {
      count,
      nulls,
      min: count ? Math.round(min * 100) / 100 : null,
      max: count ? Math.round(max * 100) / 100 : null,
      avg: count ? Math.round((sum / count) * 100) / 100 : null
    }
  }
  return out
}

export type AnomalyMarks = {
  /** 挂到价格序列的 markPoint 数据（负价/限价逼近，market 标记归属 da/rt 序列）。 */
  points: Array<{ market: 'da' | 'rt'; coord: [number, number]; value: string; itemStyle?: Record<string, unknown> }>
  /** 价差离群的横向 markArea：ECharts 区间数据要求每段 [起点, 终点] 成对（codex #239 R1-03）。 */
  areas: Array<[{ xAxis: number; itemStyle?: Record<string, unknown> }, { xAxis: number }]>
}

/**
 * 异动事件 → 图表标记（ZW-08）。market 匹配的价格类型才挂 point（序列未画则不挂）；
 * da-rt 价差挂 markArea。开关关闭时返回空结构——渲染层据此不加任何标记，
 * 手动标注（analysis store）与本函数完全无关，开关不影响其存取。
 */
export function buildAnomalyMarks(anomalies: ZsjfxScorecardAnomaly[], opts: { show: boolean }): AnomalyMarks {
  if (!opts.show) return { points: [], areas: [] }
  const slotOf = (label: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(label ?? ''))
    if (!m) return null
    return Number(m[1]) * 4 + Math.floor(Number(m[2]) / 15)
  }
  const points: AnomalyMarks['points'] = []
  const areas: AnomalyMarks['areas'] = []
  for (const a of anomalies ?? []) {
    const from = slotOf(a.from)
    const to = slotOf(a.to)
    if (from == null) continue
    if (a.type === 'spread_outlier') {
      areas.push([
        { xAxis: from, itemStyle: { color: 'rgba(230,162,60,0.12)' } },
        { xAxis: to ?? from }
      ])
    } else {
      points.push({
        market: a.market === 'rt' ? 'rt' : 'da',
        coord: [from, a.value],
        value: a.type === 'negative_price' ? '负价' : '逼近限价',
        itemStyle: { color: a.severity === 'high' ? '#f56c6c' : '#e6a23c' }
      })
    }
  }
  return { points, areas }
}

import type { ZsjfxScorecard } from '@/services/insight/zsjfxScorecardClient'

/** 对拍结果的 AI 素材装配（ZW-07）：只摘算好的数值与口径说明，LLM 不计算。 */
export function buildScorecardContext(scorecard: ZsjfxScorecard | null): Record<string, unknown> | undefined {
  if (!scorecard?.totals) return undefined
  return {
    pair: scorecard.pair.label,
    window: `${scorecard.dateFrom}~${scorecard.dateTo}`,
    mae: scorecard.totals.mae,
    mape: scorecard.totals.mape,
    direction_hit_rate: scorecard.totals.directionHitRate,
    scored_days: scorecard.totals.scoredDays,
    skipped_days: scorecard.totals.skippedDays,
    definition: scorecard.totals.directionHitRateNote
  }
}

/** 异动事件的 AI 素材装配（ZW-07）：确定性派生结果原样摘录（type/severity/阈值口径）。 */
export function buildAnomalyContext(scorecard: ZsjfxScorecard | null): Array<Record<string, unknown>> | undefined {
  const anomalies = scorecard?.anomalies ?? []
  if (!anomalies.length) return undefined
  return anomalies.map((a) => ({ type: a.type, severity: a.severity, market: a.market, from: a.from, to: a.to, value: a.value, threshold: a.threshold }))
}
