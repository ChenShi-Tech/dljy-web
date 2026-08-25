// 策略复盘纯逻辑测试（#2016）：连败过时标记（样本门槛）、六维②维摘要、跑赢率 data_gap 口径
import { describe, expect, it } from 'vitest'
import {
  BEAT_MARKET_DATA_GAP_NOTE,
  lossStreakOf,
  staleStrategyFindings,
  strategyDimSummary,
  STALE_STRATEGY_LOSS_STREAK
} from './strategyReview'
import type { MemoryOutcomeRow, StrategyWinStat } from './strategyReviewClient'

function outcome(date: string, strategyName: string, win: boolean): MemoryOutcomeRow {
  return { id: `${date}-${strategyName}`, strategyName, date, win, realizedPnlWan: null }
}

function stat(strategyName: string, sampleSize: number, winRate: number | null): StrategyWinStat {
  return {
    strategyName,
    wins: Math.round((winRate ?? 0.5) * sampleSize),
    losses: sampleSize - Math.round((winRate ?? 0.5) * sampleSize),
    sampleSize,
    posteriorWinRate: winRate ?? 0.5,
    winRate,
    winRateConclusion: winRate === null ? '样本不足' : null,
    cumulativePnlWan: null,
  }
}

describe('lossStreakOf（尾部连败段）', () => {
  it('只数尾部连续亏损；中间翻身清零；乱序输入按日期排序', () => {
    const rows = [
      outcome('2026-08-01', 's', false),
      outcome('2026-08-02', 's', true),
      outcome('2026-08-03', 's', false),
      outcome('2026-08-05', 's', false),
      outcome('2026-08-04', 's', false), // 乱序给入
    ]
    expect(lossStreakOf(rows)).toBe(3)
  })

  it('全胜=0；空=0', () => {
    expect(lossStreakOf([outcome('2026-08-01', 's', true)])).toBe(0)
    expect(lossStreakOf([])).toBe(0)
  })
})

describe('staleStrategyFindings（策略过时标记 · 样本门槛红线）', () => {
  it('连败 ≥3 且样本过门禁（winRate 非空）→ 过时标记', () => {
    const stats = [stat('老策略', 40, 0.3)]
    const outcomes = [
      outcome('2026-08-01', '老策略', false),
      outcome('2026-08-02', '老策略', false),
      outcome('2026-08-03', '老策略', false),
    ]
    const { findings, insufficient } = staleStrategyFindings(stats, outcomes)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ strategyName: '老策略', lossStreak: 3, sampleSufficient: true })
    expect(insufficient).toHaveLength(0)
  })

  it('连败 ≥3 但样本不足（winRate=null）→ 不过时结论，进 insufficient（不因少样本否定策略）', () => {
    const stats = [stat('新策略', 5, null)]
    const outcomes = [
      outcome('2026-08-01', '新策略', false),
      outcome('2026-08-02', '新策略', false),
      outcome('2026-08-03', '新策略', false),
    ]
    const { findings, insufficient } = staleStrategyFindings(stats, outcomes)
    expect(findings).toHaveLength(0)
    expect(insufficient).toHaveLength(1)
    expect(insufficient[0].sampleSufficient).toBe(false)
  })

  it('连败不足阈值 → 无标记', () => {
    const stats = [stat('稳策略', 50, 0.6)]
    const outcomes = [outcome('2026-08-01', '稳策略', false), outcome('2026-08-02', '稳策略', true)]
    const { findings } = staleStrategyFindings(stats, outcomes)
    expect(findings).toHaveLength(0)
    expect(STALE_STRATEGY_LOSS_STREAK).toBe(3)
  })
})

describe('strategyDimSummary（六维②维一行）', () => {
  it('服务不可用 → 不 ready；有策略且有口径内 → ready 且带均值', () => {
    expect(strategyDimSummary({ available: false }, 0)).toEqual({ summary: '策略胜率服务不可用', ready: false })
    const feed = {
      available: true as const,
      stats: [stat('a', 40, 0.6), stat('b', 10, null)],
    }
    const d = strategyDimSummary(feed, 1)
    expect(d.ready).toBe(true)
    expect(d.summary).toContain('2 个策略')
    expect(d.summary).toContain('60.0%')
    expect(d.summary).toContain('1 个连败待改逻辑')
  })

  it('有策略但全部门槛未过 → 不 ready、样本积累中文案；零策略 → 暂无记录', () => {
    expect(strategyDimSummary({ available: true, stats: [stat('b', 10, null)] }, 0).ready).toBe(false)
    expect(strategyDimSummary({ available: true, stats: [stat('b', 10, null)] }, 0).summary).toContain('样本积累中')
    expect(strategyDimSummary({ available: true, stats: [] }, 0).summary).toBe('暂无策略交易记录')
  })
})

describe('跑赢率 data_gap 口径（不做假基准）', () => {
  it('文案明说缺基准与来源', () => {
    expect(BEAT_MARKET_DATA_GAP_NOTE).toContain('data_gap')
    expect(BEAT_MARKET_DATA_GAP_NOTE).toContain('不做假基准')
  })
})
