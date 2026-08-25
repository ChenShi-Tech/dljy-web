// S1 市场复盘 · 纯逻辑（Epic #2033 · S1 六维「维度三·市场复盘」· #2012）
// ---------------------------------------------------------------------------
// 回答「昨天市场发生了什么、价格为什么涨跌」：价格异常高低点（复用 S7 同款
// marketDigest 口径，不另建数据源）+ 供需基本面快照（复用 S2 fundamentals）。
// 红线：逐点归因只做**关联提示**（该时点对照当日快照的方向性对照），不做因果断言
// ——检修计划/分项实际出力无数据源；政策跟进无数据源 → data_gap 人工确认行。
import type { MarketDigest } from '@/services/trading/marketDigest'
import type { FundamentalEntry } from '@/services/trading/fundamentalsClient'

/** 小时价偏离加权均价多少算「异常点」（#2012 v1；对齐 riskReview 波动参考量级）。 */
export const PRICE_ANOMALY_DEV_PCT = 0.15

/** 归因提示与政策行的口径文案（关联非因果 / data_gap 不装作有数据）。 */
export const ATTRIBUTION_HINT_NOTE =
  '关联提示，非归因结论——检修计划与分项实际出力无数据源，逐点因果待接入后替换。'
export const POLICY_DATA_GAP_NOTE =
  '政策变化（限价/结算方式/新品种）无自动数据源——data_gap，晨会人工确认后跟进。'

export type PriceAnomalyPoint = {
  hour: number
  priceYuanPerMwh: number
  /** 相对加权均价的偏离（+高/-低，小数） */
  devPct: number
  direction: 'high' | 'low'
}

/**
 * 昨日价格异常高低点：逐小时价 vs 全天加权均价，|偏离| ≥ 阈值即标。
 * 输入来自 S7 同款 buildMarketDigest（本单口径，sourceBasis 由调用方呈现）；
 * 无加权均价（缺价）或样本 <4 小时 → 空（不出半真结论）。
 */
export function priceAnomalyPoints(digest: MarketDigest | null): PriceAnomalyPoint[] {
  if (!digest || digest.weightedAvgYuanPerMwh === null || digest.weightedAvgYuanPerMwh === 0) return []
  const mean = digest.weightedAvgYuanPerMwh
  const priced = digest.hourly.filter((h) => h.priceYuanPerMwh !== null)
  if (priced.length < 4) return []
  const points: PriceAnomalyPoint[] = []
  for (const h of digest.hourly) {
    const p = h.priceYuanPerMwh
    if (p === null) continue
    const dev = (p - mean) / Math.abs(mean)
    if (Math.abs(dev) >= PRICE_ANOMALY_DEV_PCT) {
      points.push({ hour: h.hour, priceYuanPerMwh: p, devPct: Math.round(dev * 1000) / 1000, direction: dev > 0 ? 'high' : 'low' })
    }
  }
  return points
}

/** 供需快照行（#2012 缺口二）：日级基本面归一呈现，带来源可信度（S2 同款判定）。 */
export type FundamentalSnapshotRow = {
  key: 'load' | 'renewable' | 'dispatchable' | 'netImport'
  label: string
  valueMw: number | null
  /** 调度/采集=true（数据），公司/人工=false（自报口径）——S2 isTrustedSource 同款 */
  trusted: boolean
  credibility: string | null
  note: string
}

const FUNDAMENTAL_FIELD_MAP: Array<{ key: FundamentalSnapshotRow['key']; label: string; field: FundamentalEntry['field'] }> = [
  { key: 'load', label: '系统负荷', field: 'system_load_mw' },
  { key: 'renewable', label: '新能源预测出力', field: 'renewable_forecast_mw' },
  { key: 'dispatchable', label: '火电可调（开机近似）', field: 'dispatchable_max_mw' },
  { key: 'netImport', label: '净外来电（跨区）', field: 'net_import_mw' },
]

/**
 * 日级供需快照：同字段多 slot 取均值（日级通常一条；多条按均值，note 注明条数）。
 * 「新能源出力偏差」只有预测侧无实际 → label 明示「预测出力」，不装作偏差。
 */
export function fundamentalSnapshot(entries: readonly FundamentalEntry[]): FundamentalSnapshotRow[] {
  return FUNDAMENTAL_FIELD_MAP.map(({ key, label, field }) => {
    const rows = entries.filter((e) => e.field === field && Number.isFinite(e.value_mw))
    if (!rows.length) {
      return { key, label, valueMw: null, trusted: false, credibility: null, note: '当日无记录（待 S2 录入/采集）' }
    }
    const avg = rows.reduce((a, r) => a + r.value_mw, 0) / rows.length
    const trusted = rows.every((r) => r.source_kind === 'dispatch' || r.source_kind === 'capture')
    return {
      key,
      label,
      valueMw: Math.round(avg * 10) / 10,
      trusted,
      credibility: rows[0]?.credibility ?? null,
      note: rows.length > 1 ? `${rows.length} 条按均值` : '',
    }
  })
}

/** 异常点关联提示（非因果）：高点↔负荷偏高等方向性对照，供人判断。 */
export function attributionHintOf(
  point: PriceAnomalyPoint,
  snap: readonly FundamentalSnapshotRow[]
): string {
  const load = snap.find((s) => s.key === 'load')?.valueMw ?? null
  const renewable = snap.find((s) => s.key === 'renewable')?.valueMw ?? null
  const netImport = snap.find((s) => s.key === 'netImport')?.valueMw ?? null
  const hh = String(point.hour).padStart(2, '0')
  if (point.direction === 'high') {
    const parts = [`>${hh}:00 价高（偏离 ${(point.devPct * 100).toFixed(1)}%）`]
    if (load !== null && renewable !== null && renewable < load * 0.2) parts.push('当日新能源占比低（供给紧）')
    if (netImport !== null && netImport < 0) parts.push('当日净外来电为负（受入减少）')
    return parts.join(' · ')
  }
  const parts = [`>${hh}:00 价低（偏离 ${(point.devPct * 100).toFixed(1)}%）`]
  if (renewable !== null && load !== null && renewable > load * 0.3) parts.push('当日新能源占比高（供给松）')
  return parts.join(' · ')
}

/** 六维③维一行（ready=digest 有价且基本面任一项有值）。 */
export function marketDimSummary(
  digest: MarketDigest | null,
  snap: readonly FundamentalSnapshotRow[]
): { summary: string; ready: boolean } {
  if (!digest || digest.weightedAvgYuanPerMwh === null) {
    return { summary: '昨单价格缺失——市场段无基准', ready: false }
  }
  const high = digest.highYuanPerMwh
  const low = digest.lowYuanPerMwh
  const base = `高 ${high ?? '—'} / 低 ${low ?? '—'} 元/MWh（加权均值 ${digest.weightedAvgYuanPerMwh}）`
  const hasFundamentals = snap.some((s) => s.valueMw !== null)
  return {
    summary: hasFundamentals ? base : `${base} · 基本面待 S2 录入`,
    ready: hasFundamentals,
  }
}
