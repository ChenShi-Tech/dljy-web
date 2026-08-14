// S3 概率分布消费：P10/P50/P90 → 日内分布摘要 / 套利窗口清单 / 保守口径比对 / 漂移判定
// ----------------------------------------------------------------------------
// 手册零阶道理 Z1：「看概率分布而非点价」。后端 /agent-api 预测端点早已返回
// points(P50)/lower(P10)/upper(P90) 三条曲线，S3 此前只展示均值/峰谷点值——本文件
// 把分布消费的纯逻辑集中起来（组件只管渲染）：
//
//   · toHourlyQuantiles：96 点 → 24 小时聚合（分位序校验，违例超 ~8% 判带不可信）
//   · digestOf：分布摘要（均值/峰谷/带宽——带宽=不确定性的形状，P90−P10）
//   · arbitrageWindowList：套利窗口清单（F2.4）——谷段连续段 × 其后峰段配对，
//     保守口径价差 = 峰段 P10 均值 − 谷段 P90 均值（两边都取不利分位），
//     与 R3 盈亏平衡要求价差比对给「执行/待批/不做」——P90 口径超盈亏平衡
//     才给「准备执行」，正是手册 S3 步骤④ 的自动比对
//   · driftAssessment：模型漂移判定（MASE>1 = 不如朴素基线 / 未过质量门禁）
//
// 诚实性纪律：任一输入缺失/畸形返回 null 或空清单，不猜不补。
import {
  analyzePriceCurve,
  type PricePoint
} from '@/services/quant/quant'
import { arbitrageVerdict, ARBITRAGE_VERDICT_LABEL } from 'shared/trading-rules/storage-arbitrage.mjs'

export type HourlyQuantiles = { p10: number[]; p50: number[]; p90: number[] }

/**
 * 96 点（或任意 24 整数倍）分位曲线 → 24 小时聚合。
 * 校验：三条曲线等长、≥24 点、可整除 24；逐小时分位序 p10 ≤ p50 ≤ p90，
 * 违例超过 2 小时（≈8%）判带数据不可信返回 null——顺序错乱的分位带画出来是误导。
 */
export function toHourlyQuantiles(
  lower: unknown,
  points: unknown,
  upper: unknown
): HourlyQuantiles | null {
  const l = Array.isArray(lower) ? lower.map(Number) : []
  const m = Array.isArray(points) ? points.map(Number) : []
  const u = Array.isArray(upper) ? upper.map(Number) : []
  if (!l.length || l.length !== m.length || m.length !== u.length) return null
  if (m.length < 24 || m.length % 24 !== 0) return null
  const per = Math.floor(m.length / 24)
  const avg = (arr: number[], h: number): number => {
    const slice = arr.slice(h * per, (h + 1) * per).filter(Number.isFinite)
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : Number.NaN
  }
  const p10: number[] = []
  const p50: number[] = []
  const p90: number[] = []
  for (let h = 0; h < 24; h += 1) {
    p10.push(avg(l, h))
    p50.push(avg(m, h))
    p90.push(avg(u, h))
  }
  if (p10.some(Number.isNaN) || p50.some(Number.isNaN) || p90.some(Number.isNaN)) return null
  let disordered = 0
  for (let h = 0; h < 24; h += 1) {
    if (!(p10[h]! <= p50[h]! + 1e-6 && p50[h]! <= p90[h]! + 1e-6)) disordered += 1
  }
  if (disordered > 2) return null
  return { p10, p50, p90 }
}

export type DistributionDigest = {
  mean: number
  peak: number
  peakHour: number
  valley: number
  valleyHour: number
  spread: number
  /** 平均带宽（P90−P10 逐小时均值）：不确定性的形状，越宽越该保守 */
  avgBandWidth: number
  widestBandHour: number
  widestBandWidth: number
}

export function digestOf(q: HourlyQuantiles): DistributionDigest {
  const mean = q.p50.reduce((a, b) => a + b, 0) / 24
  const peak = Math.max(...q.p50)
  const valley = Math.min(...q.p50)
  const widths = q.p90.map((v, h) => v - q.p10[h]!)
  const widestBandWidth = Math.max(...widths)
  return {
    mean: Math.round(mean),
    peak: Math.round(peak),
    peakHour: q.p50.indexOf(peak),
    valley: Math.round(valley),
    valleyHour: q.p50.indexOf(valley),
    spread: Math.round(peak - valley),
    avgBandWidth: Math.round((widths.reduce((a, b) => a + b, 0) / 24) * 10) / 10,
    widestBandHour: widths.indexOf(widestBandWidth),
    widestBandWidth: Math.round(widestBandWidth * 10) / 10
  }
}

/** P50 曲线 → quant 域 PricePoint（复用 analyzePriceCurve / detectPeakValleyArbitrage 链）。 */
export function hourlyPointsOf(q: HourlyQuantiles): PricePoint[] {
  return q.p50.map((price, hour) => ({ hour, price }))
}

/**
 * 模型漂移判定（手册 S3 异常处理：漂移告警 → 回退保守模型、人工加大安全边际）。
 * 依据只有两条客观判据：MASE > 1（不如朴素基线）与 passes_gate = false（未过质量
 * 门禁）。二者皆非 → 不告警（宁可漏报也不靠感觉报警）。
 */
export function driftAssessment(
  metrics: { mase_vs_naive?: number | null; passes_gate?: boolean | null } | null | undefined
): { drifted: boolean; reasons: string[] } {
  const reasons: string[] = []
  const mase = Number(metrics?.mase_vs_naive)
  if (Number.isFinite(mase) && mase > 1) {
    reasons.push(`MASE ${mase.toFixed(2)} > 1：不如朴素基线（模型可能漂移）`)
  }
  if (metrics?.passes_gate === false) {
    reasons.push('未过模型质量门禁（passes_gate=false）')
  }
  return { drifted: reasons.length > 0, reasons }
}

export type ArbitrageWindowRow = {
  /** 充电窗口（含端点，小时） */
  chargeFrom: number
  chargeTo: number
  dischargeFrom: number
  dischargeTo: number
  chargePriceP50: number
  dischargePriceP50: number
  p50Spread: number
  /** 保守口径价差 = 峰段 P10 均值 − 谷段 P90 均值（两边都取不利分位） */
  conservativeSpread: number
  verdict: 'execute' | 'needs_approval' | 'skip'
  safetyMultiple: number
  verdictLabel: string
}

/**
 * 套利窗口清单（F2.4）：谷段连续段 × 其后第一个峰段连续段 = 一个可做窗口
 * （充电必须早于放电，与 R2 时序可行性同构）。
 * 判级用保守口径价差与 R3 要求价差比对（arbitrageVerdict，安全边际 1.15）——
 * P90 口径仍超盈亏平衡 × 1.15 才是「执行」，即手册「P90 价差 > 盈亏平衡点 → 准备执行」。
 * requiredSpread 非有限值时返回空清单（没有盈亏平衡就没有判级依据，只列窗口无意义）。
 */
export function arbitrageWindowList(
  q: HourlyQuantiles,
  requiredSpreadYuanPerMwh: number,
  safetyMargin = 1.15
): ArbitrageWindowRow[] {
  if (!Number.isFinite(requiredSpreadYuanPerMwh)) return []
  const stats = analyzePriceCurve(hourlyPointsOf(q))
  const valleySet = new Set(stats.valleyHours)
  const peakSet = new Set(stats.peakHours)

  /** 连续小时段 → [from, to]（含端点） */
  const runs = (set: Set<number>): Array<[number, number]> => {
    const hours = [...set].sort((a, b) => a - b)
    const out: Array<[number, number]> = []
    let start = hours[0]
    let prev = hours[0]
    for (const h of hours.slice(1)) {
      if (h === prev + 1) {
        prev = h
        continue
      }
      out.push([start!, prev!])
      start = h
      prev = h
    }
    if (start !== undefined) out.push([start, prev!])
    return out
  }

  const valleyRuns = runs(valleySet)
  const peakRuns = runs(peakSet)
  const mean = (arr: number[], from: number, to: number): number => {
    const slice = arr.slice(from, to + 1)
    return slice.reduce((a, b) => a + b, 0) / Math.max(slice.length, 1)
  }

  const rows: ArbitrageWindowRow[] = []
  for (const [cf, ct] of valleyRuns) {
    // 其后第一个峰段（放电必须晚于充电；跨零点窗口本日不凑）
    const peak = peakRuns.find(([pf]) => pf > ct)
    if (!peak) continue
    const [df, dt] = peak
    const chargeP50 = mean(q.p50, cf, ct)
    const dischargeP50 = mean(q.p50, df, dt)
    const p50Spread = dischargeP50 - chargeP50
    // 保守口径：放电侧取 P10（低 10% 情形），充电侧取 P90（高 90% 情形）
    const conservative = mean(q.p10, df, dt) - mean(q.p90, cf, ct)
    const v = arbitrageVerdict(conservative, requiredSpreadYuanPerMwh, safetyMargin)
    rows.push({
      chargeFrom: cf,
      chargeTo: ct,
      dischargeFrom: df,
      dischargeTo: dt,
      chargePriceP50: Math.round(chargeP50),
      dischargePriceP50: Math.round(dischargeP50),
      p50Spread: Math.round(p50Spread),
      conservativeSpread: Math.round(conservative),
      verdict: v.verdict,
      safetyMultiple: v.safetyMultiple,
      verdictLabel: ARBITRAGE_VERDICT_LABEL[v.verdict]
    })
  }
  return rows
}

// ============================================================================
// 日前 vs 中长期双曲线决策（#2006 · 会议 §5.1：S2/S3 决策核心输入）
// ----------------------------------------------------------------------------
// 「必须同时展示日前价 + 中长期（滚搓/撮合）价两条曲线对比 + 置信度，而非单一
// 预测值」。日前侧取 S3 概率分布（P50 均值与带宽）；中长期侧消费预测域 /midterm
// 的日均价序列（模型活在预测域，本层只消费）。决策规则（会议）：
//   高置信 + 日前价高 → 先现货（卖方卖贵/买方观望不锁）
//   高置信 + 日前价低 → 锁中长期（买方锁低价/卖方留现货另说——立场语义双写）
//   低置信 → 观望/谨慎
// 置信口径（客观判据，不拍脑袋）：日前带宽/中位 ≤ 25% 且中期 MASE ≤ 1 = 高置信。
// ============================================================================

export type MidtermCurve = {
  /** 未来 N 天日均电价（元/MWh），下标 0 = 明日 */
  dailyAvgPrice: number[]
  /** 中期模型 MASE（vs 持久基线）；>1 = 不如基线（低置信）；null = 后端未给 */
  maseVsPersistence: number | null
}

export type DualCurveDecision = {
  daMean: number
  daBandPct: number
  mltNear: number
  mltAvg: number
  /** 日前相对中长期的溢价 %（正=日前贵） */
  daPremiumPct: number
  confident: boolean
  confidenceNote: string
  verdict: 'prefer_spot' | 'prefer_mlt' | 'wait'
  hint: string
} | null

/**
 * 双曲线对比决策。任一侧缺失返回 null（不硬比）。mltNear 取中期序列首日（最近的
// 可锁价），mltAvg 取全序列均值（趋势锚）。
 */
export function dualCurveDecision(
  da: { mean: number; avgBandWidth: number } | null | undefined,
  mlt: MidtermCurve | null | undefined
): DualCurveDecision {
  if (!Number.isFinite(da?.mean) || !mlt || !Array.isArray(mlt.dailyAvgPrice) || !mlt.dailyAvgPrice.length) return null
  const prices = mlt.dailyAvgPrice.map(Number).filter(Number.isFinite)
  if (!prices.length) return null
  const daMean = Number(da!.mean)
  const daBandPct = Math.round((Number(da!.avgBandWidth) / Math.max(daMean, 1e-6)) * 1000) / 10
  const mltNear = prices[0]!
  const mltAvg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
  const maseOk = mlt.maseVsPersistence === null || mlt.maseVsPersistence === undefined ? true : Number(mlt.maseVsPersistence) <= 1
  const confident = daBandPct <= 25 && maseOk
  const confidenceNote = [
    `日前带宽/中位 ${daBandPct}%${daBandPct <= 25 ? '（窄）' : '（宽→低置信）'}`,
    mlt.maseVsPersistence == null ? '中期 MASE 未给（按可信处理）' : `中期 MASE ${Number(mlt.maseVsPersistence).toFixed(2)}${maseOk ? '（≤1 优于持久基线）' : '（>1 低置信）'}`
  ].join(' · ')
  const premium = Math.round(((daMean - mltNear) / Math.max(mltNear, 1e-6)) * 1000) / 10
  if (!confident) {
    return {
      daMean, daBandPct, mltNear, mltAvg, daPremiumPct: premium, confident, confidenceNote,
      verdict: 'wait',
      hint: `低置信，观望/谨慎：日前均值 ${Math.round(daMean)} vs 中长期近期 ${Math.round(mltNear)} 元/MWh（日前溢价 ${premium}%），但${daBandPct > 25 ? '日前带宽过宽' : '中期预测不如持久基线'}——按会议规则低置信不动作，人工加大安全边际`
    }
  }
  return premium > 3
    ? {
        daMean, daBandPct, mltNear, mltAvg, daPremiumPct: premium, confident, confidenceNote,
        verdict: 'prefer_spot',
        hint: `高置信 · 日前贵 ${premium}%（日前均值 ${Math.round(daMean)} > 中长期近期 ${Math.round(mltNear)}）——卖方先现货卖贵；买方不急锁中长期（等回落），先现货补缺`
      }
    : premium < -3
      ? {
          daMean, daBandPct, mltNear, mltAvg, daPremiumPct: premium, confident, confidenceNote,
          verdict: 'prefer_mlt',
          hint: `高置信 · 日前便宜 ${Math.abs(premium)}%（日前均值 ${Math.round(daMean)} < 中长期近期 ${Math.round(mltNear)}）——买方锁中长期低价划算；卖方留现货另议（卖方语义反向）`
        }
      : {
          daMean, daBandPct, mltNear, mltAvg, daPremiumPct: premium, confident, confidenceNote,
          verdict: 'wait',
          hint: `高置信但两曲线相当（日前溢价 ${premium}%，±3% 内）——价差不足以驱动先后顺序，按敞口与执行成本取便`
        }
}
