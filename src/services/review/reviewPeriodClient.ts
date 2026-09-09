// 复盘区间取数助手（Epic #2033 · M2 · #2042/#2043）
// ---------------------------------------------------------------------------
// 周报/月报聚合需要逐日调 quant /review（每页一次请求）。按 4 并发分批，逐日软失败：
// 缺数日如实入 missingDays（未接入/覆盖区外/当日无数据），绝不以 0 补位。
// S1 归因写回（昨日单 preflight.morningReview.cause）随日一并取，供按业务成因聚合。
import { fetchReview, type ReviewResult } from '@/services/quant/quantClient'
import { listDeclarations } from '@/services/declarations'
import { causeLabelOf } from 'shared/trading-rules/morning-review.mjs'

export type PeriodReviewDay =
  | {
      ok: true
      date: string
      result: ReviewResult
      declaredTotalMwh: number
      /** S1 晨会写回的业务成因 id（负荷/新能源/通道/价格…）；未写回/待分析为 null */
      causeId: string | null
      causeLabel: string | null
    }
  | { ok: false; date: string; reason: string }

export type PeriodReview = { days: PeriodReviewDay[]; missingDays: string[] }

async function fetchOneDay(date: string, tolerancePct: number, penaltyPrice: number): Promise<PeriodReviewDay> {
  try {
    const [result, declRows] = await Promise.all([
      fetchReview({ date, tolerance_pct: tolerancePct, penalty_price: penaltyPrice }),
      listDeclarations({ date, limit: 5 }).catch(() => [])
    ])
    const latest = declRows.length ? declRows.reduce((a, c) => (c.updatedAt > a.updatedAt ? c : a)) : null
    const cause = latest?.preflight?.morningReview?.cause ?? null
    return {
      ok: true,
      date,
      result,
      declaredTotalMwh: result.detail.reduce((a, p) => a + (p.declared ?? 0), 0),
      causeId: typeof cause === 'string' && cause ? cause : null,
      causeLabel: cause ? causeLabelOf(cause) : null
    }
  } catch (e) {
    return { ok: false, date, reason: e instanceof Error ? e.message : '取数失败' }
  }
}

/** 逐日取 /review（4 并发分批，顺序保持）。失败日入 missingDays，不阻断其它日。
 *  onProgress：按批回报进度（已完成天数/总天数）——整月真算约 20-30s，调用方须给出可感知的进度。 */
export async function fetchReviewRange(
  dates: readonly string[],
  opts: { tolerancePct?: number; penaltyPrice?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<PeriodReview> {
  const { tolerancePct = 3.0, penaltyPrice = 100, onProgress } = opts
  const days: PeriodReviewDay[] = []
  const batch = 4
  let done = 0
  for (let i = 0; i < dates.length; i += batch) {
    const chunk = dates.slice(i, i + batch)
    const rows = await Promise.all(chunk.map((d) => fetchOneDay(d, tolerancePct, penaltyPrice)))
    days.push(...rows)
    done += rows.length
    onProgress?.(done, dates.length)
  }
  return { days, missingDays: days.filter((d): d is Extract<PeriodReviewDay, { ok: false }> => !d.ok).map((d) => d.date) }
}
