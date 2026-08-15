// 风险事件与阈值触发 · 纯逻辑（Epic #2033 · M3 · #2047：模板九/十）
// ---------------------------------------------------------------------------
// 阈值触发四类（偏差率连续超标/连续三日未达预期价差/止损仓位越限/胜率低于阈值）：
// 阈值数值等梁总 P2 提供前用缺省并可配置；判级对齐风控阈值面板同源
// （riskThresholds）。越限即预警型待办 + 事件库草稿；未越限不生成（负例红线）。
// near_miss（侥幸逃过）独立附记：不计损失金额但入案例库（方案原文）。
import { consecutiveDeviationBreach, type DailyAggRow } from './deviationAggregate'

export type RiskFinding = {
  id: string
  level: 'red' | 'yellow'
  title: string
  detail: string
  /** data_gap = 该触发器所需数据未接入（如实呈现，不出假结论） */
  dataGap: boolean
}

export type ThresholdDefaults = {
  /** 偏差率阈值（|偏差率| 超过视为超标）；P2 确认前缺省 5% */
  deviationPct: number
  /** 胜率阈值；P2 确认前缺省 45% */
  winRate: number
  /** 连续未达预期价差天数 */
  spreadDays: number
}

export const DEFAULT_THRESHOLD: ThresholdDefaults = {
  deviationPct: 0.05,
  winRate: 0.45,
  spreadDays: 3
}

/**
 * 价差序列（分数口径）：点级 (实时−日前)/日前，双价齐备才产出——喂 /quant/cvar
 * 做压力测试（VaR/CVaR 权威引擎）。缺价点跳过，序列 <2 返回空（引擎 min_length=2）。
 */
export function spreadReturns(detail: ReadonlyArray<{ da_price?: number; rt_price?: number }>): number[] {
  const out: number[] = []
  for (const p of detail) {
    if (typeof p.da_price === 'number' && typeof p.rt_price === 'number' && p.da_price !== 0) {
      out.push((p.rt_price - p.da_price) / Math.abs(p.da_price))
    }
  }
  return out
}

/**
 * 阈值触发清单。输入来自真数据（月度 /review 聚合行 + 前端胜率服务）；
 * 止损仓位越限缺仓位数据 → data_gap 占位（不假装在监测）。
 */
export function thresholdFindings(input: {
  aggRows: readonly DailyAggRow[]
  /** 逐日价差盈亏（元；来自 /review backtest.da_rt_spread_pnl_yuan），null=当日无 */
  dailySpreadPnl: ReadonlyArray<{ date: string; pnlYuan: number | null }>
  /** 后验胜率（0–1）；无样本为 null */
  winRate: number | null
  thresholds?: Partial<ThresholdDefaults>
}): { findings: RiskFinding[]; thresholds: ThresholdDefaults } {
  const t = { ...DEFAULT_THRESHOLD, ...input.thresholds }
  const findings: RiskFinding[] = []

  const breach = consecutiveDeviationBreach(input.aggRows, t.deviationPct)
  if (breach) {
    findings.push({
      id: 'deviation-streak',
      level: 'red',
      title: `偏差率连续 ${breach.streak} 日超 ${(t.deviationPct * 100).toFixed(0)}%`,
      detail: `${breach.from} ~ ${breach.to}。越限即预警型待办并生成事件库草稿（触发全量归本单）。`,
      dataGap: false
    })
  }

  // 连续 N 日未达预期价差（v1 代理口径：价差盈亏连续为负；「预期价差」定义待 P2）
  let streak = 0
  let from = ''
  let to = ''
  let best = 0
  let bestRange = { from: '', to: '' }
  for (const d of input.dailySpreadPnl) {
    if (d.pnlYuan !== null && d.pnlYuan < 0) {
      if (streak === 0) from = d.date
      streak += 1
      to = d.date
      if (streak > best) {
        best = streak
        bestRange = { from, to }
      }
    } else {
      streak = 0
    }
  }
  if (best >= t.spreadDays) {
    findings.push({
      id: 'spread-streak',
      level: 'yellow',
      title: `价差盈亏连续 ${best} 日为负（未达预期价差）`,
      detail: `${bestRange.from} ~ ${bestRange.to}。v1 以「价差盈亏为负」为代理口径——「预期价差」正式定义待梁总 P2 确认后替换。`,
      dataGap: false
    })
  }

  if (input.winRate !== null && input.winRate < t.winRate) {
    findings.push({
      id: 'win-rate',
      level: 'yellow',
      title: `后验胜率 ${(input.winRate * 100).toFixed(1)}% 低于阈值 ${(t.winRate * 100).toFixed(0)}%`,
      detail: '来源：tradingMemory Beta-Binomial 后验（前端胜率服务）。阈值缺省可配置（P2 确认后调整）。',
      dataGap: false
    })
  }

  findings.push({
    id: 'stop-loss-position',
    level: 'yellow',
    title: '止损仓位越限：待数据接入',
    detail: '持仓/止损线数据未接入（data_gap）——本触发器未在监测，接入前不显示监测中假象。',
    dataGap: true
  })

  return { findings, thresholds: t }
}

/** near_miss（侥幸逃过）：独立附记——不计损失金额，但入案例库（方案原文）。 */
export const NEAR_MISS_NOTE =
  'near_miss（侥幸逃过）不计入损失金额统计，但须入案例库沉淀——「这次没事」不等于「下次没事」。'

export type NearMissDraft = {
  eventTime: string
  riskLevel: 'high' | 'medium' | 'low'
  positionSnapshot: string
  handling: string
  effectiveness: string
}

/** 压力测试承受能力评级：强/中/弱由人定（方案原文）；「弱」限期整改复测状态跟踪。 */
export const STRESS_GRADES = Object.freeze([
  { id: 'strong', label: '强（可承受极端情景）' },
  { id: 'medium', label: '中（部分指标越限，需关注）' },
  { id: 'weak', label: '弱（限期整改并复测）' }
] as const)
