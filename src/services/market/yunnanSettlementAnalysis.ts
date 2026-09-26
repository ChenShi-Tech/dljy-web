// 云南结算价页「综合结算均价（量费加权）」取数与默认日期逻辑（#2992）。
//
// 为什么独立成模块：集团结算均价只有一套权威实现——服务端结算统计
// POST /api/v1/review/analysis/settlement（量费加权 Σ电费/Σ电量）。前端
// **不实现第二套加权公式**：本模块只负责①把请求入参（range/granularity/plants）
// 拼对，②把服务端返回的 daily/buckets 原样映射成图表序列，③失败时把中文原因
// 透传给页面（绝不回退到前端等权平均）。逻辑做成纯函数便于单测（#2992 验收 C）。
//
// 服务端契约（dljy#2998）：
// - range 与 period 二选一；这里只用 range（显式起止，参考期服务端自动取紧邻等长区间）。
// - granularity 省略 → current.daily[]（逐日，averagePrice 为当日量费加权）；
//   'week' | 'month' → current.buckets[]（key=ISO 周一日期 / YYYY-MM，与前端
//   settlementClient.weekKey/monthKey 分组键一致，可直接对齐到图 x 轴标签）。
// - 无成对记录的桶 averagePrice=null（不是 0）；缺测断开由图表 connectNulls:false 呈现。
// - 未授权公司/地区 403/404、读取失败 503、参数问题 400，信封 msg 为中文原因。

import {
  fetchSettlementAnalysis,
  type SettlementAnalysis,
  type SettlementAnalysisInput
} from '@/services/review/settlementAnalysis'
import type { Aggregation } from '@/services/market/settlementClient'
import { todayBeijing } from '@/utils/beijingDate'

// 消费面板需要持有 analysis 原始类型（序列派生自它）。
export type { SettlementAnalysis }

/** 地区固定云南：该页只在云南路由下挂载，不随全局地区切换。 */
export const SETTLEMENT_REGION = 'yunnan'

/** 综合结算均价序列点：key 与图 x 轴分组键一致（日=日期、周=ISO 周一、月=YYYY-MM）。 */
export interface WeightedAvgPoint {
  key: string
  price: number | null
}

export type SettleDateRange = [string, string]

/**
 * 首次进入的默认范围：北京时间「当天」单日。
 * 只在共享选中态仍是 store 出厂默认（写死的 2026-05-01，非用户选择）时替换为当天；
 * 用户/其它面板主动选过的范围（含单日）一律尊重——#2992 明确禁止「单日选区强制拉回五月」。
 */
export function resolveInitialSettleRange(
  raw: readonly [string, string] | undefined,
  storeDefaultRange: readonly [string, string],
  today: string
): SettleDateRange {
  const range = raw?.[0] && raw?.[1] ? [raw[0], raw[1]] as SettleDateRange : null
  if (!range) return [today, today]
  if (range[0] === storeDefaultRange[0] && range[1] === storeDefaultRange[1]) return [today, today]
  return range
}

/** 节点电价快照日默认值：跟随范围末日（不再写死五月）。 */
export function resolveInitialNodeDate(range: SettleDateRange): string {
  return range[1]
}

/** 所选范围整体早于今天 → 历史资料（面板顶部显示完整日期提示）。 */
export function isHistoryRange(range: SettleDateRange, today: string): boolean {
  return Boolean(range[0] && range[1] && range[1] < today)
}

/**
 * 服务端结算统计 → 综合结算均价序列。
 * day 取 current.daily（按日），week/month 取 current.buckets（服务端成对量费加权桶）。
 * analysis 为 null（尚未取得）时返回空序列；桶缺失（服务端未带 buckets）按空处理。
 */
export function weightedAvgSeries(
  analysis: SettlementAnalysis | null | undefined,
  agg: Aggregation
): WeightedAvgPoint[] {
  if (!analysis) return []
  if (agg === 'day') {
    return (analysis.current.daily ?? []).map((d) => ({ key: d.date, price: d.averagePrice }))
  }
  const buckets = analysis.current.buckets
  if (!buckets) return []
  return buckets.map((b) => ({ key: b.key, price: b.averagePrice }))
}

/** 服务端失败时展示给用户的原因（中文）；不吞错、不回退，原文透传。 */
export function describeWeightedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `结算统计不可用：${message || '未知原因'}`
}

/**
 * 拉取综合结算均价统计。全部厂站不传 plants；单厂传 [厂名]。
 * granularity 与面板聚合粒度联动：day 不传（走 daily），week/month 传对应值（走 buckets）。
 * 失败原样抛出（含 ApiError 的中文 msg），由调用方经 describeWeightedFailure 呈现。
 */
export async function fetchWeightedSettlementAvg(opts: {
  company: string
  plants: string[]
  dateRange: SettleDateRange
  aggregation: Aggregation
  signal?: AbortSignal
}): Promise<SettlementAnalysis> {
  const [start, end] = opts.dateRange
  if (!opts.company) throw new Error('尚未选择公司，无法读取结算统计')
  if (!start || !end) throw new Error('请选择有效的起止日期')
  const input: SettlementAnalysisInput = {
    region: SETTLEMENT_REGION,
    range: { start, end },
    ...(opts.aggregation === 'week' || opts.aggregation === 'month'
      ? { granularity: opts.aggregation }
      : {}),
    ...(opts.plants.length ? { plants: [...opts.plants] } : {})
  }
  return fetchSettlementAnalysis(opts.company, input, opts.signal)
}

/** 「查看历史资料」按钮把范围设为已入库覆盖区间；无覆盖时不给入口。 */
export function historyJumpRange(
  coverage: { start: string; end: string } | null
): SettleDateRange | null {
  if (!coverage?.start || !coverage?.end || coverage.start > coverage.end) return null
  return [coverage.start, coverage.end]
}

/** 面板默认「当天」基准：北京时间（全站口径见 utils/beijingDate）。 */
export function settleToday(): string {
  return todayBeijing()
}
