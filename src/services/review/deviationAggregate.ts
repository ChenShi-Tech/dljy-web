// 偏差周月聚合 · 纯逻辑（Epic #2033 · M2 · #2042：模板七 偏差归因分析 / 模板八 偏差成本核算）
// ---------------------------------------------------------------------------
// 验收红线：周报数字与逐日 /review 之和恒等（合计=Σ已取到日，缺数日不计入且如实列名）；
// 责任归因二轴（预测不准/突发情况/策略失误/操作失误）仅周聚合人工补填，AI 只给
// 业务成因→责任归因的映射建议、人确认，与 S1 业务成因四因子正交、不合并。
// 两轴均存 id 不存中文（morning-review.mjs 教训）。
import { nextDayOf } from '@/utils/calendarDate'
import type { PeriodReviewDay } from './reviewPeriodClient'

/** 责任归因第二轴（方案 §模板七；正交于业务成因四因子，不合并） */
export const RESPONSIBILITY_AXES = Object.freeze([
  { id: 'forecast_miss', label: '预测不准' },
  { id: 'contingency', label: '突发情况' },
  { id: 'strategy_error', label: '策略失误' },
  { id: 'operation_error', label: '操作失误' }
] as const)
export type ResponsibilityAxisId = (typeof RESPONSIBILITY_AXES)[number]['id']

export function responsibilityLabelOf(id: string): string | null {
  return RESPONSIBILITY_AXES.find((a) => a.id === id)?.label ?? null
}

/**
 * 业务成因 → 责任归因映射建议（仅建议，人确认；日度不强制，数据不够时逼人答
 * 第二问只会得到假归因）。pending/none 不给建议（连第一问都没答）。
 */
export const RESPONSIBILITY_SUGGESTION: Readonly<Record<string, ResponsibilityAxisId>> = Object.freeze({
  load: 'forecast_miss',
  load_forecast: 'forecast_miss',
  new_energy: 'forecast_miss',
  renewable_forecast: 'forecast_miss',
  transmission: 'contingency',
  congestion: 'contingency',
  price: 'strategy_error',
  strategy: 'strategy_error'
})

export function suggestResponsibility(causeId: string | null): { id: ResponsibilityAxisId; label: string } | null {
  if (!causeId) return null
  const id = RESPONSIBILITY_SUGGESTION[causeId]
  return id ? { id, label: responsibilityLabelOf(id) ?? id } : null
}

/**
 * ISO 周键（与 Node review-api.mjs `periodKeysForDate().weekly` 完全同口径：
 * 周一为一周之始、第 1 周含当年首个周四；用正午 12:00+08:00 取日期，边界日不漂移），
 * 如 2026-W36。聚合面板的责任归因按它匹配锚定周的 T07 实例。
 */
export function isoWeekKeyOf(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return ''
  const year = d.getUTCFullYear()
  const target = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const weekYear = target.getUTCFullYear()
  const jan1 = new Date(Date.UTC(weekYear, 0, 1))
  const jan1DayNr = (jan1.getUTCDay() + 6) % 7
  const firstThursday = new Date(jan1)
  firstThursday.setUTCDate(1 + ((3 - jan1DayNr + 7) % 7))
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${weekYear}-W${pad(week)}`
}

export type DailyAggRow = {
  date: string
  deviationPct: number | null
  totalAbsDeviationMwh: number
  assessedMwh: number
  estimatedPenaltyYuan: number
  causeId: string | null
  causeLabel: string | null
}

export type DeviationAggregate = {
  rows: DailyAggRow[]
  /** 取数失败/缺数据日（不进合计；如实列出） */
  missingDays: string[]
  totals: {
    days: number
    deviationMwh: number
    assessedMwh: number
    penaltyYuan: number
    /** Σ偏差 / Σ申报；申报总量≤0 → null（无从计率） */
    deviationPct: number | null
  }
  byCause: Array<{ causeId: string; causeLabel: string; days: number }>
}

/** 聚合逐日 /review：合计恒等（= Σ行）由构造保证；测试断言守卫。 */
export function aggregateDeviation(days: readonly PeriodReviewDay[]): DeviationAggregate {
  const rows: DailyAggRow[] = []
  const missingDays: string[] = []
  let declaredTotal = 0
  for (const d of days) {
    if (!d.ok) {
      missingDays.push(d.date)
      continue
    }
    declaredTotal += d.declaredTotalMwh
    rows.push({
      date: d.date,
      deviationPct: d.declaredTotalMwh > 0 ? d.result.deviation.total_abs_deviation_mwh / d.declaredTotalMwh : null,
      totalAbsDeviationMwh: d.result.deviation.total_abs_deviation_mwh,
      assessedMwh: d.result.deviation.assessed_mwh,
      estimatedPenaltyYuan: d.result.deviation.estimated_penalty_yuan,
      causeId: d.causeId,
      causeLabel: d.causeLabel
    })
  }
  const deviationMwh = rows.reduce((a, r) => a + r.totalAbsDeviationMwh, 0)
  const byCauseMap = new Map<string, { causeLabel: string; days: number }>()
  for (const r of rows) {
    if (!r.causeId) continue
    const cur = byCauseMap.get(r.causeId) ?? { causeLabel: r.causeLabel ?? r.causeId, days: 0 }
    cur.days += 1
    byCauseMap.set(r.causeId, cur)
  }
  return {
    rows,
    missingDays,
    totals: {
      days: rows.length,
      deviationMwh,
      assessedMwh: rows.reduce((a, r) => a + r.assessedMwh, 0),
      penaltyYuan: rows.reduce((a, r) => a + r.estimatedPenaltyYuan, 0),
      deviationPct: declaredTotal > 0 ? deviationMwh / declaredTotal : null
    },
    byCause: [...byCauseMap.entries()].map(([causeId, v]) => ({ causeId, ...v })).sort((a, b) => b.days - a.days)
  }
}

/** 阈值预警占位（#2042 范围只做标记；触发全量归 M3/#2047）：连续 |偏差率| 超标天数。 */
export function consecutiveDeviationBreach(
  rows: readonly DailyAggRow[],
  thresholdPct: number
): { streak: number; from: string; to: string } | null {
  let best: { streak: number; from: string; to: string } | null = null
  let run: DailyAggRow[] = []
  for (const r of rows) {
    if (r.deviationPct === null || Math.abs(r.deviationPct) <= thresholdPct) {
      run = []
      continue
    }
    // 缺数日被调用方剔除时数组天然跳日（aggregateDeviation 只收 ok 日）——
    // 「连续」必须校验日期相邻，否则缺数日被隐含当超标日计入，虚报连续天数
    //（违背「缺数日不计入且如实列名」口径；与 riskReview 价差 streak 的缺数断链对齐）。
    const prev = run[run.length - 1]
    if (prev && nextDayOf(prev.date) !== r.date) run = []
    run.push(r)
    if (!best || run.length > best.streak) best = { streak: run.length, from: run[0].date, to: r.date }
  }
  return best && best.streak >= 2 ? best : null
}
