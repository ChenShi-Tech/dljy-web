// 月度市场归因 · 纯逻辑（Epic #2033 · M3 · #2046；#3392 改接平台真实数据）
// ---------------------------------------------------------------------------
// 数据输入是 marketAttributionSource 聚合出的「近 12 个月」月度序列：月现货均价
// （元/MWh，云南 yn_system_forecast·da_user_price / 各地 sdpt_zcqxhdl 日前 p3）与
// 月均系统负荷（MW，sdpt_actualLoad 逐日均值）。中长期成交均价、零售价、成交电量
// 没有全省公共来源——本模块不再建模该字段，UI 固定显示「暂无公共来源」，不找替代、
// 不合成。四行规则：价格走势（月均 + 近 12 个月均值偏离）、供需形势（月均负荷环比 ×
// 月现货均价环比）、异常价格事件（|月均 − 近 12 个月均值| > kσ；样本 <4 个月不出
// 结论）；政策变化仍为人工 + AI 建议，不做自动因果。

export type MonthlyMarketPoint = {
  /** YYYY-MM */
  month: string
  /** 月现货均价（元/MWh）；该月无有效数据为 null（诚实空，不填 0） */
  spotPrice: number | null
  /** 月均系统负荷（MW）；该月无有效数据为 null */
  avgLoad: number | null
}

export type MonthPriceStats = {
  month: string
  spotPrice: number | null
  /** 近 12 个月均值（序列内全部有效月现货均价的均值，含复盘月） */
  trailing12Mean: number | null
  /** 相对近 12 个月均值的偏离 %（均值缺失或为 0 时为 null） */
  devFromTrailingMeanPct: number | null
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
function std(xs: number[], mu: number | null): number | null {
  if (mu === null || xs.length < 2) return null
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
}

export function monthPriceStats(points: readonly MonthlyMarketPoint[], month: string): MonthPriceStats {
  const row = points.find((r) => r.month === month) ?? null
  const spots = points
    .map((r) => (r.spotPrice === null ? NaN : Number(r.spotPrice)))
    .filter(Number.isFinite)
  const trailing12Mean = mean(spots)
  return {
    month,
    spotPrice: row && row.spotPrice !== null && Number.isFinite(Number(row.spotPrice)) ? Number(row.spotPrice) : null,
    trailing12Mean,
    devFromTrailingMeanPct:
      row?.spotPrice != null && trailing12Mean !== null && trailing12Mean !== 0
        ? (row.spotPrice - trailing12Mean) / trailing12Mean
        : null
  }
}

export type AnomalyMonth = {
  month: string
  spotPrice: number
  devFromMeanPct: number
  /** 相对近 12 个月均值的绝对偏离 元/MWh */
  devFromMeanYuan: number
}

/**
 * 异常价格事件（月粒度 v1）：|月现货均价 − 近 12 个月均值| > k 倍标准差。
 * k 缺省 2（保守：宁可漏报不虚报）；有效样本 <4 个月不出结论（统计不成立）。
 */
export function anomalyMonths(points: readonly MonthlyMarketPoint[], k = 2): { events: AnomalyMonth[]; note: string } {
  const rows = points.filter((r) => r.spotPrice !== null && Number.isFinite(Number(r.spotPrice)))
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
      ? `识别 ${events.length} 个异常月（|月均−近 12 个月均值| > ${k}σ，σ=${sigma.toFixed(1)} 元/MWh）；小时粒度事件（时间/极值/持续时长）需逐时价格覆盖数据。`
      : `无异常月（阈值 ${k}σ=${(k * sigma).toFixed(1)} 元/MWh）。`
  }
}

export type SupplyDemandDirection = '负荷与价格同升' | '负荷与价格同跌' | '负荷与价格背离' | '数据不足'

/**
 * 供需形势行（#3392 口径）：月均系统负荷环比 × 月现货均价环比的方向判定。
 * 负荷是需求侧代理，两量同向为同升/同跌，反向为背离；任一量缺当月或上月 → 数据不足。
 */
export function supplyDemandDirection(points: readonly MonthlyMarketPoint[], month: string, prevMonth: string): { direction: SupplyDemandDirection; note: string } {
  const cur = points.find((r) => r.month === month)
  const prev = points.find((r) => r.month === prevMonth)
  if (!cur || !prev || cur.avgLoad === null || prev.avgLoad === null || cur.spotPrice === null || prev.spotPrice === null) {
    return { direction: '数据不足', note: '当月或上月的月均负荷 / 月现货均价缺失——供需形势行不出结论，不合成。' }
  }
  const dq = cur.avgLoad - prev.avgLoad
  const dp = cur.spotPrice - prev.spotPrice
  const direction: SupplyDemandDirection =
    dq > 0 && dp > 0 ? '负荷与价格同升' : dq < 0 && dp < 0 ? '负荷与价格同跌' : '负荷与价格背离'
  return {
    direction,
    note: `环比上月：月均负荷 ${dq >= 0 ? '+' : ''}${Math.round(dq)} MW、月现货均价 ${dp >= 0 ? '+' : ''}${dp.toFixed(1)} 元/MWh（负荷=sdpt_actualLoad 逐日均值再求月均；价格=日前口径月均）。`
  }
}
