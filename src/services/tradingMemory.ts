// 交易复盘记忆与贝叶斯学习（批次C，H8）。
//
// 替代实验室此前「贝叶斯学习」实为硬编码加权平均(tradingLab posteriorWinPct = 先验×0.72 +
// 置信×0.28)与 OODA 启发式胜率(0.5+价差/峰值×0.25)的占位口径。用 Beta-Binomial 共轭
// 后验从「多日真实执行结果」学习地区胜率：先验 Beta(α0,β0)（弱、中心 0.5），每笔执行
// 结果(win/loss)更新为后验 Beta(α0+wins, β0+losses)，后验均值即学习后的胜率，Kelly 据此下注。
//
// 设计纪律：
// - 纯数学(bayesianWinStats/summarizeOutcomes)不碰 localStorage，可被 verify 脚本裸 strip-types 跑；
// 模块顶层不访问 localStorage（仅函数被调用时访问），保证导入安全。
// - 持久化用 localStorage 按地区隔离（用户选定的「学习用 localStorage 起步」方案），
// 与会话历史的 Node SQLite 持久化正交；后续可升级为服务端。
// - 量化算法模块(quant.ts/tradingLab.ts)不 import 本模块（保持运行时自包含），由视图注入学习胜率。

export type TradeOutcome = {
  /** 交易/执行日 YYYY-MM-DD */
  date: string
  regionId: string
  /** 是否盈利（由 realizedPnlWan>0 推导或用户标注） */
  win: boolean
  /** 实际损益 万元（可选，用于展示与按阈值判定盈亏） */
  realizedPnlWan?: number
  note?: string
  /** 记录时间戳（毫秒），由调用方传入（避免在纯模块内用 Date.now 影响可测性） */
  ts: number
}

export type BetaPrior = { alpha: number; beta: number }

/** 默认弱先验：中心 0.5、等效样本量 4（约 4 笔历史观测的强度），避免少样本时过度自信。 */
export const DEFAULT_PRIOR: BetaPrior = { alpha: 2, beta: 2 }

export type WinStats = {
  wins: number
  losses: number
  sampleSize: number
  /** 先验胜率 α0/(α0+β0) */
  priorWinRate: number
  /** 后验胜率 (α0+wins)/(α0+β0+n)，学习后用于 Kelly 的胜率 */
  posteriorWinRate: number
  /** 后验 90% 可信区间下/上界（正态近似，clamp[0,1]），样本越多越窄 */
  credibleLow: number
  credibleHigh: number
  /** 后验等效样本量 α0+β0+n，反映胜率估计的可信强度 */
  strength: number
  /** 累计实际损益 万元（有 realizedPnlWan 记录的求和） */
  cumulativePnlWan: number
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/**
 * Beta-Binomial 共轭后验统计（纯函数）。
 * 后验 Beta(a,b) 均值 a/(a+b)、方差 ab/((a+b)²(a+b+1))；90% 可信区间用正态近似 mean±1.645·sd。
 */
export function bayesianWinStats(wins: number, losses: number, prior: BetaPrior = DEFAULT_PRIOR): WinStats {
  const w = Math.max(0, Math.floor(wins))
  const l = Math.max(0, Math.floor(losses))
  const a0 = Math.max(prior.alpha, 1e-6)
  const b0 = Math.max(prior.beta, 1e-6)
  const a = a0 + w
  const b = b0 + l
  const mean = a / (a + b)
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
  const sd = Math.sqrt(variance)
  return {
    wins: w,
    losses: l,
    sampleSize: w + l,
    priorWinRate: round(a0 / (a0 + b0)),
    posteriorWinRate: round(mean),
    credibleLow: round(clamp01(mean - 1.645 * sd)),
    credibleHigh: round(clamp01(mean + 1.645 * sd)),
    strength: round(a + b, 2),
    cumulativePnlWan: 0
  }
}

/** 从执行结果序列汇总后验胜率（纯函数）。 */
export function summarizeOutcomes(outcomes: TradeOutcome[], prior: BetaPrior = DEFAULT_PRIOR): WinStats {
  let wins = 0
  let losses = 0
  let pnl = 0
  for (const o of outcomes) {
    if (o.win) wins++
    else losses++
    if (typeof o.realizedPnlWan === 'number') pnl += o.realizedPnlWan
  }
  const stats = bayesianWinStats(wins, losses, prior)
  stats.cumulativePnlWan = round(pnl, 4)
  return stats
}

// localStorage 持久化层（仅浏览器/视图调用；纯数学不依赖此层）

const KEY_PREFIX = 'dljy.tradingMemory.'
const MAX_OUTCOMES = 200

function storageKey(regionId: string): string {
  return `${KEY_PREFIX}${regionId || 'base'}`
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function getRegionOutcomes(regionId: string): TradeOutcome[] {
  const ls = safeLocalStorage()
  if (!ls) return []
  try {
    const raw = ls.getItem(storageKey(regionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TradeOutcome[]) : []
  } catch {
    return []
  }
}

export function getRegionWinStats(regionId: string, prior: BetaPrior = DEFAULT_PRIOR): WinStats {
  return summarizeOutcomes(getRegionOutcomes(regionId), prior)
}

/** 追加一条执行结果（按地区隔离持久化，保留最近 MAX_OUTCOMES 条）。ts 缺省由调用方负责。 */
export function recordOutcome(outcome: TradeOutcome): WinStats {
  const ls = safeLocalStorage()
  const list = getRegionOutcomes(outcome.regionId)
  list.push(outcome)
  const trimmed = list.slice(-MAX_OUTCOMES)
  if (ls) {
    try {
      ls.setItem(storageKey(outcome.regionId), JSON.stringify(trimmed))
    } catch {
      /* 配额满等：静默放过，记忆为最佳努力 */
    }
  }
  return summarizeOutcomes(trimmed)
}

export function clearRegionOutcomes(regionId: string): void {
  const ls = safeLocalStorage()
  if (ls) {
    try {
      ls.removeItem(storageKey(regionId))
    } catch {
      /* ignore */
    }
  }
}
