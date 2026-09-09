// 复盘完成度统计（覆盖率/填写率）· 纯逻辑（清单《视频参考优化清单.md》附录 B1 口径落地）
// ---------------------------------------------------------------------------
// 口径（2026-09-03 拍板）：
// - 覆盖率（按天）= 当月存在「已提交复盘实例」的天数 ÷ 当月可回测天数。
//   可回测天数 = 当月 ∩ 采集覆盖窗 ∩ ≤今天（captureCoverage，登记制、未登记=0）；
//   产出以日锚实例（periodKey=YYYY-MM-DD，submitted/reviewed）计——覆盖以 T08 日档
//   等日周期模板为主，event:xxx 等非日锚实例不计入天数。
// - 填写率（按实例）= 当月已提交（submitted/reviewed）实例数 ÷ 当月应填实例总数。
//   应填清单由触发引擎按周期生成（#2037 设计语义：引擎生成分母）；分母按 periodKey
//   月份前缀统计，event: 锚实例无月份前缀、分子分母一致排除（待实例锚定信息补齐再纳）。
//   分母为 0 或端点缺席时不出百分比（不出 100% 冒充全填完），fillPct 返回 null。
// - 实例端点缺席（endpoint-absent/unauthorized/unreachable）：产出暂按 0 计（真实：
//   已知提交为 0），coveragePct 仍出真实分母下的 0%；feedAvailable=false 供 UI 标注原因。
// 全部输入为真实数据，无合成、无默认值凑数。

import type { TemplateInstanceFeed, TemplateInstanceStatus } from './templateInstanceApi'

export type ReviewCompletionInput = {
  /** 统计月 'YYYY-MM'（复盘日所在月） */
  month: string
  /** 今天 'YYYY-MM-DD'（北京口径，未过天数不进分母） */
  today: string
  /** 采集覆盖窗（captureCoverage 登记制；null=未登记地区） */
  coverage: { start: string; end: string } | null
  feed: TemplateInstanceFeed
}

export type ReviewCompletion = {
  /** 当月可回测天数（分母；0=覆盖外/未登记，此时 coveragePct=null） */
  reviewableDays: number
  /** 有已提交日锚实例的天数 */
  producedDays: number
  /** 覆盖率 0..1；无可回测天时 null（不出 0% 冒充） */
  coveragePct: number | null
  /** 当月应填实例总数（引擎生成分母） */
  instancesTotal: number
  /** 其中已提交数 */
  instancesSubmitted: number
  /** 填写率 0..1；无应填实例或端点缺席时 null */
  fillPct: number | null
  /** 实例端点是否可用（false 时产出按 0 计并标注原因） */
  feedAvailable: boolean
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}/
const DONE: readonly TemplateInstanceStatus[] = ['submitted', 'reviewed']

/** 当月 ∩ 覆盖窗 ∩ ≤今天 的天数。today 早于月初、覆盖窗不相交、未登记均得 0。 */
export function reviewableDaysInMonth(
  month: string,
  today: string,
  coverage: { start: string; end: string } | null
): number {
  if (!coverage || !/^\d{4}-\d{2}$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`
  const from = monthStart > today ? null : monthStart
  const to = monthEnd < today ? monthEnd : today
  if (!from || from > to) return 0
  const winStart = from > coverage.start ? from : coverage.start
  const winEnd = to < coverage.end ? to : coverage.end
  if (winStart > winEnd) return 0
  const startUtc = Date.parse(`${winStart}T00:00:00Z`)
  const endUtc = Date.parse(`${winEnd}T00:00:00Z`)
  if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc)) return 0
  return Math.floor((endUtc - startUtc) / 86400000) + 1
}

export function reviewCompletionOf(input: ReviewCompletionInput): ReviewCompletion {
  const reviewableDays = reviewableDaysInMonth(input.month, input.today, input.coverage)
  if (!input.feed.available) {
    return {
      reviewableDays,
      producedDays: 0,
      coveragePct: reviewableDays > 0 ? 0 : null,
      instancesTotal: 0,
      instancesSubmitted: 0,
      fillPct: null,
      feedAvailable: false
    }
  }
  const monthInstances = input.feed.instances.filter((i) => i.periodKey.startsWith(input.month))
  const producedDates = new Set(
    monthInstances
      .filter((i) => DAY_KEY_RE.test(i.periodKey) && DONE.includes(i.status))
      .map((i) => i.periodKey.slice(0, 10))
  )
  const instancesSubmitted = monthInstances.filter((i) => DONE.includes(i.status)).length
  const instancesTotal = monthInstances.length
  return {
    reviewableDays,
    producedDays: producedDates.size,
    coveragePct: reviewableDays > 0 ? producedDates.size / reviewableDays : null,
    instancesTotal,
    instancesSubmitted,
    fillPct: instancesTotal > 0 ? instancesSubmitted / instancesTotal : null,
    feedAvailable: true
  }
}
