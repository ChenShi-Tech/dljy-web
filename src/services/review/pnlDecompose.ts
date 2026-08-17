// 收益三层拆解 · 纯逻辑（Epic #2033 · M2 · #2043：模板二 收益拆解 / 模板三 典型交易）
// ---------------------------------------------------------------------------
// 三层：分品种（现货日前/实时增量先行，中长期待 S6 持仓线如实标未接入）/
// 分时段（峰平谷读 SettlementRuleSpec，未参数化不借用他省）/ 单笔 Top5（M2 以日为笔，
// 逐笔成交归集待 #1966）。口径：日前=Σ申报×日前价，实时增量=Σ(实际−申报)×实时价；
// 金额 self-computed（结算细则未核验）。两层合计与总收益恒等（构造保证，测试断言）。
import type { SettlementRuleSpec } from '@/rules/types'

export type DetailPointLike = {
  datetime: string
  declared: number
  actual: number
  da_price?: number
  rt_price?: number
}

/** datetime → 小时（0–23）；解析不出返回 null（该点不计入分时段层，进缺口计数）。 */
export function hourOfDatetime(datetime: string): number | null {
  const m = /(\d{1,2}):\d{2}/.exec(String(datetime))
  if (!m) return null
  const h = Number(m[1])
  return h >= 0 && h <= 23 ? h : null
}

export type VarietyLayer = {
  variety: string
  revenueYuan: number | null
  /** null=未接入（如实呈现，不用 0 冒充） */
  note?: string
}

export type SegmentLayerRow = { segment: string; revenueYuan: number; share: number }

export type DailyPnlDecompose = {
  daRevenueYuan: number
  rtIncrementYuan: number
  totalYuan: number
  /** 价格缺失点数（da 或 rt 任一缺失；这些点不计入对应层，如实计数） */
  priceGapPoints: number
  byVariety: VarietyLayer[]
  /** spec 未参数化 → null（调用方显式提示，不借用他省时段） */
  bySegment: SegmentLayerRow[] | null
  segmentUnparameterized: boolean
}

export function decomposeDaily(detail: readonly DetailPointLike[], spec: SettlementRuleSpec | null): DailyPnlDecompose {
  let da = 0
  let rt = 0
  let priceGapPoints = 0
  const segMap = new Map<string, number>()
  for (const p of detail) {
    const declared = Number.isFinite(p.declared) ? p.declared : 0
    const actual = Number.isFinite(p.actual) ? p.actual : 0
    if (typeof p.da_price === 'number' && Number.isFinite(p.da_price)) {
      da += declared * p.da_price
    } else {
      priceGapPoints += 1
    }
    if (typeof p.rt_price === 'number' && Number.isFinite(p.rt_price)) {
      rt += (actual - declared) * p.rt_price
    } else {
      priceGapPoints += 1
    }
    if (spec) {
      const h = hourOfDatetime(p.datetime)
      if (h !== null) {
        const seg = spec.timeSegmentFactors.find((s) => s.hours.includes(h))?.segment ?? '平'
        const pointRevenue =
          (typeof p.da_price === 'number' ? declared * p.da_price : 0) +
          (typeof p.rt_price === 'number' ? (actual - declared) * p.rt_price : 0)
        segMap.set(seg, (segMap.get(seg) ?? 0) + pointRevenue)
      }
    }
  }
  const total = da + rt
  const bySegment = spec
    ? [...segMap.entries()]
        .map(([segment, revenueYuan]) => ({ segment, revenueYuan, share: total !== 0 ? revenueYuan / total : 0 }))
        .sort((a, b) => b.revenueYuan - a.revenueYuan)
    : null
  return {
    daRevenueYuan: da,
    rtIncrementYuan: rt,
    totalYuan: total,
    priceGapPoints,
    byVariety: [
      { variety: '现货·日前', revenueYuan: da },
      { variety: '现货·实时增量', revenueYuan: rt },
      { variety: '中长期', revenueYuan: null, note: '未接入：中长期品种收益待 S6 持仓线（#1966）接通后补列' }
    ],
    bySegment,
    segmentUnparameterized: !spec
  }
}

/** 月度滚动：Σ日。两层合计恒等仍成立（Σ(Σ点)=Σ点）。 */
export function rollupMonthly(daily: ReadonlyArray<{ date: string; d: DailyPnlDecompose | null }>): {
  byVariety: VarietyLayer[]
  bySegment: SegmentLayerRow[] | null
  totalYuan: number
  days: number
  priceGapPoints: number
} {
  const picked = daily.filter((x): x is { date: string; d: DailyPnlDecompose } => x.d !== null)
  const totalYuan = picked.reduce((a, x) => a + x.d.totalYuan, 0)
  const da = picked.reduce((a, x) => a + x.d.daRevenueYuan, 0)
  const rt = picked.reduce((a, x) => a + x.d.rtIncrementYuan, 0)
  let bySegment: SegmentLayerRow[] | null = null
  if (picked.some((x) => x.d.bySegment)) {
    const m = new Map<string, number>()
    for (const x of picked) {
      for (const row of x.d.bySegment ?? []) m.set(row.segment, (m.get(row.segment) ?? 0) + row.revenueYuan)
    }
    bySegment = [...m.entries()]
      .map(([segment, revenueYuan]) => ({ segment, revenueYuan, share: totalYuan !== 0 ? revenueYuan / totalYuan : 0 }))
      .sort((a, b) => b.revenueYuan - a.revenueYuan)
  }
  return {
    byVariety: [
      { variety: '现货·日前', revenueYuan: da },
      { variety: '现货·实时增量', revenueYuan: rt },
      { variety: '中长期', revenueYuan: null, note: '未接入：待 S6 持仓线（#1966）' }
    ],
    bySegment,
    totalYuan,
    days: picked.length,
    priceGapPoints: picked.reduce((a, x) => a + x.d.priceGapPoints, 0)
  }
}

export type TopTradeRow = {
  rank: number
  date: string
  pnlYuan: number
  type: '盈利' | '亏损'
}

/**
 * 单笔 Top5 盈亏榜（M2 以日为笔：逐笔成交归集待 #1966；口径与拆解同源——同一次
 * /review 聚合产出，满足「同源同口径」验收）。按 |盈亏| 降序取前 n。
 */
export function monthlyPnlTop(daily: ReadonlyArray<{ date: string; pnlYuan: number }>, n = 5): TopTradeRow[] {
  return [...daily]
    .sort((a, b) => Math.abs(b.pnlYuan) - Math.abs(a.pnlYuan))
    .slice(0, n)
    .map((x, i) => ({ rank: i + 1, date: x.date, pnlYuan: x.pnlYuan, type: x.pnlYuan >= 0 ? '盈利' : '亏损' }))
}

/** 环比强制归因（方案原文规则）：|Δ|/上期 > 20% 时该栏必填。 */
export function momForcesAttribution(cur: number, prev: number | null, ratio = 0.2): boolean {
  if (prev === null || Math.abs(prev) < 1e-9) return false
  return Math.abs(cur - prev) / Math.abs(prev) > ratio
}
