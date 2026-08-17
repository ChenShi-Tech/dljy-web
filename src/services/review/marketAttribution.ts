// 月度市场归因 · 纯逻辑（Epic #2033 · M3 · #2046：模板六）
// ---------------------------------------------------------------------------
// 模板六四行：价格走势/供需形势 A 档自动预填（市场经营分析既有真取数，basis 随行
// 标注）；政策变化人工 + AI 建议（不做自动因果）；异常价格事件按月粒度规则识别
// （|月均价 − 年均| > kσ；小时粒度需 clearing_price 覆盖区逐时数据，如实注明）。
import type { MonthTrendRow, PriceTrendRow } from '@/services/market/marketAnalysis'

export type MonthPriceStats = {
  month: string
  spotPrice: number | null
  mediumLongPrice: number | null
  yearMeanSpot: number | null
  /** 相对年均的偏离 %（年均缺失为 null） */
  devFromYearMeanPct: number | null
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
function std(xs: number[], mu: number | null): number | null {
  if (mu === null || xs.length < 2) return null
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
}

export function monthPriceStats(priceTrend: readonly PriceTrendRow[], month: string): MonthPriceStats {
  const row = priceTrend.find((r) => r.month === month) ?? null
  const spots = priceTrend.map((r) => Number(r.spotPrice)).filter(Number.isFinite)
  const yearMeanSpot = mean(spots)
  return {
    month,
    spotPrice: row ? Number(row.spotPrice) || null : null,
    mediumLongPrice: row ? Number(row.mediumLongPrice) || null : null,
    yearMeanSpot,
    devFromYearMeanPct:
      row && yearMeanSpot !== null && yearMeanSpot !== 0
        ? (Number(row.spotPrice) - yearMeanSpot) / yearMeanSpot
        : null
  }
}

export type AnomalyMonth = {
  month: string
  spotPrice: number
  devFromMeanPct: number
  /** 相对年均的绝对偏离 元/MWh */
  devFromMeanYuan: number
}

/**
 * 异常价格事件（月粒度 v1）：|月现货均价 − 年均| > k 倍年标准差。
 * k 缺省 2（保守：宁可漏报不虚报）；样本 <4 个月不出结论（统计不成立）。
 */
export function anomalyMonths(priceTrend: readonly PriceTrendRow[], k = 2): { events: AnomalyMonth[]; note: string } {
  const rows = priceTrend.filter((r) => Number.isFinite(Number(r.spotPrice)))
  const spots = rows.map((r) => Number(r.spotPrice))
  const mu = mean(spots)
  const sigma = std(spots, mu)
  if (rows.length < 4 || mu === null || sigma === null || sigma < 1e-9) {
    return { events: [], note: `样本 ${rows.length} 个月（<4），异常判别统计不成立——不出结论。` }
  }
  const events = rows
    .map((r) => ({ month: r.month, spotPrice: Number(r.spotPrice), devFromMeanYuan: Number(r.spotPrice) - mu, devFromMeanPct: (Number(r.spotPrice) - mu) / mu }))
    .filter((e) => Math.abs(e.devFromMeanYuan) > k * sigma)
    .sort((a, b) => Math.abs(b.devFromMeanYuan) - Math.abs(a.devFromMeanYuan))
  return {
    events,
    note: events.length
      ? `识别 ${events.length} 个异常月（|月均−年均| > ${k}σ，σ=${sigma.toFixed(1)} 元/MWh）；小时粒度事件（时间/极值/持续时长）需 clearing_price 覆盖区逐时数据。`
      : `无异常月（阈值 ${k}σ=${(k * sigma).toFixed(1)} 元/MWh）。`
  }
}

export type SupplyDemandDirection = '量价齐升' | '量价齐跌' | '量价背离' | '数据不足'

/** 供需形势行自动预填（v1 以量价方向为代理；供需比规则需供需 MW 输入，接入后替换）。 */
export function supplyDemandDirection(trend: readonly MonthTrendRow[], month: string, prevMonth: string): { direction: SupplyDemandDirection; note: string } {
  const cur = trend.find((r) => r.month === month)
  const prev = trend.find((r) => r.month === prevMonth)
  if (!cur || !prev) {
    return { direction: '数据不足', note: '当月或上月量价数据缺失——供需形势行不出结论。' }
  }
  const dq = Number(cur.quantity) - Number(prev.quantity)
  const dp = Number(cur.avgPrice) - Number(prev.avgPrice)
  const direction: SupplyDemandDirection =
    dq > 0 && dp > 0 ? '量价齐升' : dq < 0 && dp < 0 ? '量价齐跌' : '量价背离'
  return {
    direction,
    note: `环比上月：电量 ${dq >= 0 ? '+' : ''}${Math.round(dq)}、均价 ${dp >= 0 ? '+' : ''}${dp.toFixed(1)} 元/MWh。v1 以量价方向为代理——供需比规则（supply-demand.mjs）待供需 MW 输入接入后替换。`
  }
}
