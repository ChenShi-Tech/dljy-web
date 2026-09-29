// 套保结算复核接口客户端（openspec build-midlong-spot-hedging 任务 10.5，specs HR-01..06，design D12；ChenShi-Tech/dljy#3054）。
//
// 两个只读端点（dljy server/hedge/settlement-review.mjs）：
// - GET /settlement/coverage：按已入库数据生成的覆盖日历（场站 × 日），正式/暂结分视角请求，不写死月份（HR-02/03）；
// - GET /settlement/review：逐行恒等核对与已实现指标、台账对照、费用口径、机制差价预留（HR-01/04/05）。
// 与 hedgeApi.ts 共用同一请求工具（身份头、地区头、错误信封）；本文件只做类型包装，不做口径加工。
// 数值为后端给出的 number，未知为 null——缺失一律保留 null，不在这里补 0。

import { request } from './hedgeApi'

export type SettlementView = 'FORMAL' | 'PROVISIONAL'
export type SettlementGranularity = 'DAY' | 'MONTH'
/** OK = 所选区间有已入库结算；NOT_REPORTED = 未入库（暂结视角当前恒为未入库）。 */
export type SettlementStatus = 'OK' | 'NOT_REPORTED'

export interface SettlementCoverageDay {
  date: string
  coveredPlants: string[]
  uncoveredPlants: string[]
  /** 当日全部场站都有记录。 */
  full: boolean
}

export interface SettlementCalendar {
  days: SettlementCoverageDay[]
  /** 全部场站都有记录的天数。 */
  coveredDays: number
  totalDays: number
}

export interface SettlementDataQuality {
  /** 未核实/模拟来源被剔除的行数（Mock 不进业务口径）。 */
  excludedUnverified: number
}

export interface SettlementCoverage {
  fromDate: string
  toDate: string
  view: SettlementView
  plants: string[]
  calendar: SettlementCalendar
  status: SettlementStatus
  note: string | null
  dataQuality: SettlementDataQuality
}

/** 费用口径（HR-05）：SPLIT 可拆出中长期电费；UNSPLIT 总额与分段不符、中长期电费不可拆分；UNKNOWN 分段缺失未拆。 */
export interface SettlementFeeSplit {
  status: 'SPLIT' | 'UNSPLIT' | 'UNKNOWN'
  spotIncrementFee: number | null
  midlongFee: number | null
  totalFee: number | null
  note: string
}

export interface SettlementSpotExposure {
  dayAheadAbsMwh: number
  realTimeAbsMwh: number
  netMwh: number
}

export interface SettlementReviewRow {
  date: string
  plant: string
  ltmEnergy: number | null
  dayAheadIncrementMwh: number | null
  realTimeIncrementMwh: number | null
  actualOnGridEnergy: number | null
  ltmPrice: number | null
  dayAheadPrice: number | null
  realTimePrice: number | null
  totalFee: number | null
  dayAheadFee: number | null
  realTimeFee: number | null
  feeSplit: SettlementFeeSplit
  /** 恒等核对：true 平、false 不平（超 0.01 MWh 容差）、null 分段缺失未核对。 */
  balanced: boolean | null
  residual: number | null
  realizedRatio: number | null
  spotExposure: SettlementSpotExposure | null
  note: string | null
}

export interface SettlementLedgerStation {
  stationId: number | string
  plantName: string
  ledgerMwh: number
  settlementMwh: number
  /** 未解释差异 = 台账锁价电量 − 结算中长期电量；不归因任何一方。 */
  unexplainedDiff: number
}

export interface SettlementLedger {
  month: string
  stations: SettlementLedgerStation[]
  /** 结算场站名在台账里没有映射：只有结算量，没有台账量。 */
  unmapped: Array<{ plantName: string; settlementMwh: number }>
  note: string
  /** 台账已分配到交易单元、未分配到场站的量（交易单元一级对照）。 */
  unallocatedSubjectLevel: Array<{ key: string | number; quantity: number }>
  readmodelAsOf: string | null
}

export interface SettlementMechanismFee {
  status: string
  amount: number | null
  note: string
}

export interface SettlementReview {
  fromDate: string
  toDate: string
  granularity: SettlementGranularity
  view: SettlementView
  status: SettlementStatus
  statusNote?: string | null
  /** 暂结视角未入库时的说明。 */
  note?: string | null
  rows: SettlementReviewRow[]
  calendar: SettlementCalendar | null
  /** 无结算行、或台账读模型读取失败时为 null。 */
  ledger: SettlementLedger | null
  mechanismFee: SettlementMechanismFee | null
  dataQuality: SettlementDataQuality | null
}

export function fetchSettlementCoverage(query: { fromDate: string; toDate: string; view?: SettlementView }) {
  return request<SettlementCoverage>('GET', '/settlement/coverage', { query })
}

export function fetchSettlementReview(query: { fromDate: string; toDate: string; granularity?: SettlementGranularity; view?: SettlementView }) {
  return request<SettlementReview>('GET', '/settlement/review', { query })
}
