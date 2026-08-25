// 策略复盘 · 纯逻辑（Epic #2033 · S1 六维「维度二·策略」· #2016）
// ---------------------------------------------------------------------------
// 区分「策略错了」（方向问题——连续跑输→标记过时需改逻辑）与「执行错了」（纪律问题，
// 已有执行偏差覆盖）。样本门槛红线：样本不足不判策略过时（不因单次/少次失败全盘否定）。
// 「跑赢率 vs 市场」缺按策略的市场基准序列——data_gap 诚实标注，不做假基准。
import type { MemoryOutcomeRow, StrategyWinStat } from './strategyReviewClient'

/** 连败多少期提示「策略可能过时」（#2016 缺口一；连续跑输的 v1 代理口径=连续亏损）。 */
export const STALE_STRATEGY_LOSS_STREAK = 3

/** 「跑赢率」缺市场基准的诚实口径文案（data_gap，不做假基准）。 */
export const BEAT_MARKET_DATA_GAP_NOTE =
  '跑赢率需按策略的市场基准序列（口径未定，#1968 活源未提供该切面）——data_gap，不做假基准。'

export type StaleStrategyFinding = {
  strategyName: string
  /** 截至最近一笔的连续亏损期数 */
  lossStreak: number
  /** 该策略样本量（服务端硬门禁 30 的前端镜像判定用） */
  sampleSize: number
  /** 样本门禁是否已过（过门禁才允许「过时」结论） */
  sampleSufficient: boolean
}

/**
 * 按策略算「截至最近一笔」的连败期数。只看尾部连续段（中间翻身即清零——
 * 三个月前连败过不等于现在过时）。
 */
export function lossStreakOf(outcomes: readonly MemoryOutcomeRow[]): number {
  const byDate = [...outcomes].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let streak = 0
  for (let i = byDate.length - 1; i >= 0; i -= 1) {
    if (byDate[i].win) break
    streak += 1
  }
  return streak
}

/**
 * 策略过时标记：连败 ≥ 阈值 **且** 样本已过服务端门禁（winRate 非空）才提示。
 * 样本不足的策略只报「样本不足」，不下过时结论（#2016 缺口三：样本门槛）。
 */
export function staleStrategyFindings(
  stats: readonly StrategyWinStat[],
  outcomes: readonly MemoryOutcomeRow[]
): { findings: StaleStrategyFinding[]; insufficient: StaleStrategyFinding[] } {
  const outcomesByName = new Map<string, MemoryOutcomeRow[]>()
  for (const o of outcomes) {
    outcomesByName.set(o.strategyName, [...(outcomesByName.get(o.strategyName) ?? []), o])
  }
  const findings: StaleStrategyFinding[] = []
  const insufficient: StaleStrategyFinding[] = []
  for (const s of stats) {
    const streak = lossStreakOf(outcomesByName.get(s.strategyName) ?? [])
    const entry: StaleStrategyFinding = {
      strategyName: s.strategyName,
      lossStreak: streak,
      sampleSize: s.sampleSize,
      sampleSufficient: s.winRate !== null,
    }
    if (streak >= STALE_STRATEGY_LOSS_STREAK && entry.sampleSufficient) findings.push(entry)
    else if (!entry.sampleSufficient && s.sampleSize > 0) insufficient.push(entry)
  }
  findings.sort((a, b) => b.lossStreak - a.lossStreak)
  return { findings, insufficient }
}

/** 六维摘要②维一行（ready=服务端 stats 可用且有任一策略过样本门禁）。 */
export function strategyDimSummary(
  feed: { available: true; stats: readonly StrategyWinStat[] } | { available: false },
  staleCount: number
): { summary: string; ready: boolean } {
  if (!feed.available) return { summary: '策略胜率服务不可用', ready: false }
  const rated = feed.stats.filter((s) => s.winRate !== null)
  if (!feed.stats.length) return { summary: '暂无策略交易记录', ready: false }
  if (!rated.length) {
    return { summary: `${feed.stats.length} 个策略 · 样本积累中（<30 笔不出胜率）`, ready: false }
  }
  const avg = rated.reduce((a, s) => a + (s.winRate ?? 0), 0) / rated.length
  const base = `${feed.stats.length} 个策略 · 胜率口径内 ${rated.length} 个 · 均值 ${(avg * 100).toFixed(1)}%`
  return {
    summary: staleCount > 0 ? `${base} · ${staleCount} 个连败待改逻辑` : base,
    ready: true,
  }
}

/**
 * 临场改价结论（#2016 缺口二的事后判定口径）：
 * 改对 → 「可复制」（改价方向与结果一致，值得沉淀为规则）；
 * 改错 → 「需修正」（临场偏离计划未获改善——纪律问题回到执行侧）。
 */
export type PriceChangeVerdict = 'replicable' | 'needs-fix'

export const PRICE_CHANGE_VERDICT_LABEL: Record<PriceChangeVerdict, string> = {
  replicable: '可复制',
  'needs-fix': '需修正',
}
