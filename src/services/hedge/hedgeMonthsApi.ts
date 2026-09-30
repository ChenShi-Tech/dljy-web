// 套保当月/后续月份视图与钻取的接口客户端（openspec build-midlong-spot-hedging 任务 8.3，HW-03/HW-04/HB-07/HM-02；ChenShi-Tech/dljy#3421）。
//
// 两个只读端点（dljy server/hedge/hedge-read-routes.mjs、months-view.mjs、breakdown.mjs）：
// - GET /months：逐月视图（按日锁价/发电、月度未分解、品种结构、计划口径机制电量、基准、两口径套保率与判级、核定上限）；
// - GET /breakdown：按维度的中长期月度净义务钻取（rows[].contracts[] 只读、链接中长期合同详情）。
// 与 hedgeApi.ts 共用同一请求工具（身份头、地区头、错误信封）；本文件只做类型包装与 shared 契约转发，
// 不做口径加工（前端不算正式口径）。数值为十进制字符串、未知为 null：缺失一律保留 null，不在这里补 0；
// 顶层 status = FORBIDDEN 时锁价侧为 null 而非 0（HW-04：无权限不得显示 0）。

import { request } from './hedgeApi'
import { monthFirstDay, monthLastDay } from 'shared/midlong/dates.mjs'
import { decimalCompare, decimalSum } from 'shared/midlong/decimal.mjs'
import type {
  HedgeBreakdown, HedgeBreakdownContractRef, HedgeConsistency, HedgeMonthAssessment, HedgeMonthView, HedgeRatioValue,
} from 'shared/hedge/contract.mjs'
import {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, BREAKDOWN_QUERY_DIMENSIONS, BREAKDOWN_QUERY_DIMENSION_LABELS,
  BREAKDOWN_SPECIAL_KEY_LABELS, CAP_EXCEEDED_LABEL, CAP_MODIFIED_AFTER_AS_OF_LABEL, CAP_NOT_REGISTERED_LABEL,
  MONTH_PERIOD_LABELS, TIER_LABELS, UNCOVERED_REASON_LABELS,
} from 'shared/hedge/contract.mjs'

// 页面经本文件取用 shared/hedge 与 shared/midlong 的共享规则与类型，不直接依赖 shared/ 路径（与 hedgeMaintenanceModel 同一约定）。
export type {
  HedgeBreakdown, HedgeBreakdownContractRef, HedgeConsistency, HedgeMonthAssessment, HedgeMonthView, HedgeRatioValue,
}
export {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, BREAKDOWN_QUERY_DIMENSIONS, BREAKDOWN_QUERY_DIMENSION_LABELS,
  BREAKDOWN_SPECIAL_KEY_LABELS, CAP_EXCEEDED_LABEL, CAP_MODIFIED_AFTER_AS_OF_LABEL, CAP_NOT_REGISTERED_LABEL,
  MONTH_PERIOD_LABELS, TIER_LABELS, UNCOVERED_REASON_LABELS, decimalCompare, decimalSum, monthFirstDay, monthLastDay,
}

/** GET /months 的响应（months-view.mjs 组装；旧字段 totals/unallocatedPool/revisionsUsed/contracts 原样保留）。 */
export interface HedgeMonthsPayload {
  status: 'OK' | 'FORBIDDEN'
  fromMonth: string | null
  toMonth: string | null
  months: HedgeMonthView[]
  totals: unknown
  unallocatedPool: unknown[]
  revisionsUsed: unknown[]
  contracts: unknown[]
  scheme: Record<string, unknown> | null
  legs: Record<string, unknown>
  gaps: Array<{ code: string; message: string; affected: string | null }>
  asOf: string
  view: 'CURRENT' | 'AS_OF'
}

/** GET /breakdown 的响应（breakdown.mjs 组装；旧字段 contracts/months 原样保留）。 */
export interface HedgeBreakdownPayload extends HedgeBreakdown {
  fromDate: string
  toDate: string
  contracts: unknown[]
  asOf?: string
  view?: 'CURRENT' | 'AS_OF'
}

export type BreakdownDimension = HedgeBreakdown['dimension']
export type HedgeBreakdownRow = HedgeBreakdown['rows'][number]
export type HedgeMonthCapRow = HedgeMonthView['caps']['rows'][number]
export type HedgeMonthStructureRow = NonNullable<HedgeMonthView['midlong']['structure']>[keyof NonNullable<HedgeMonthView['midlong']['structure']>][number]

export function fetchMonthsView(query: { fromMonth: string; toMonth: string; asOf?: string }) {
  return request<HedgeMonthsPayload>('GET', '/months', { query })
}

export function fetchBreakdownView(query: { fromDate: string; toDate: string; dimension: BreakdownDimension; asOf?: string }) {
  // 月度分类不需要小时曲线；DAY 支持默认跨月及最多十二个月窗口。
  return request<HedgeBreakdownPayload>('GET', '/breakdown', { query: { ...query, granularity: 'DAY' } })
}

/** 月份范围 → 钻取窗口（首月一日 → 末月最后一日）；任一月键非法为 null。 */
export function monthWindowOf(fromMonth: string, toMonth: string): { fromDate: string; toDate: string } | null {
  const fromDate = monthFirstDay(fromMonth)
  const toDate = monthLastDay(toMonth)
  return fromDate && toDate ? { fromDate, toDate } : null
}
