// 套保「结算复核」页签 spec 的载荷构造器（ChenShi-Tech/dljy#3054）。
// 形状对齐 dljy server/hedge/settlement-review.mjs 的 /settlement/coverage 与 /settlement/review 响应；
// 只构造数据、不依赖 mock（服务层 vi.mock 写在各 spec 文件里）。
import type {
  SettlementCoverage,
  SettlementLedger,
  SettlementReview,
  SettlementReviewRow,
  SettlementView,
} from '@/services/hedge/hedgeSettlementApi'

/**
 * 覆盖日历：covered 是「日期 → 当日有记录的场站」。只列出给定日期（真实后端会列出区间内每一天，
 * 页签必须把没列出的日期也当成未覆盖，这里刻意只列部分日期来覆盖这条路径）。
 */
export function coveragePayload(opts: {
  plants: string[]
  covered: Record<string, string[]>
  view?: SettlementView
  fromDate?: string
  toDate?: string
}): SettlementCoverage {
  const days = Object.entries(opts.covered)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, coveredPlants]) => ({
      date,
      coveredPlants,
      uncoveredPlants: opts.plants.filter((plant) => !coveredPlants.includes(plant)),
      full: opts.plants.length > 0 && coveredPlants.length === opts.plants.length,
    }))
  return {
    fromDate: opts.fromDate ?? '2025-10-01',
    toDate: opts.toDate ?? '2026-09-29',
    view: opts.view ?? 'FORMAL',
    plants: [...opts.plants].sort(),
    calendar: { days, coveredDays: days.filter((day) => day.full).length, totalDays: days.length },
    status: days.some((day) => day.coveredPlants.length) ? 'OK' : 'NOT_REPORTED',
    note: opts.view === 'PROVISIONAL' ? '暂结结算数据未入库' : null,
    dataQuality: { excludedUnverified: 0 },
  }
}

/** 一行恒等核对通过的日结算：100 + 20 − 5 = 115，已实现套保率 0.8696，现货总敞口 25、净敞口 15。 */
export function reviewRow(over: Partial<SettlementReviewRow> = {}): SettlementReviewRow {
  return {
    date: '2026-05-15',
    plant: '甲风电场',
    ltmEnergy: 100,
    dayAheadIncrementMwh: 20,
    realTimeIncrementMwh: -5,
    actualOnGridEnergy: 115,
    ltmPrice: 300,
    dayAheadPrice: 250,
    realTimePrice: 180,
    totalFee: 34100,
    dayAheadFee: 5000,
    realTimeFee: -900,
    feeSplit: { status: 'SPLIT', spotIncrementFee: 4100, midlongFee: 30000, totalFee: 34100, note: '日前+实时增量电费即「现货增量电费」' },
    balanced: true,
    residual: 0,
    realizedRatio: 0.8696,
    spotExposure: { dayAheadAbsMwh: 20, realTimeAbsMwh: 5, netMwh: 15 },
    note: null,
    ...over,
  }
}

/** 分段电量缺失的行（后端 balanced=null，不做恒等核对，也不给敞口）。 */
export function incompleteRow(over: Partial<SettlementReviewRow> = {}): SettlementReviewRow {
  return reviewRow({
    ltmEnergy: null,
    dayAheadIncrementMwh: 10,
    realTimeIncrementMwh: 0,
    actualOnGridEnergy: 50,
    totalFee: null,
    feeSplit: { status: 'UNKNOWN', spotIncrementFee: null, midlongFee: null, totalFee: null, note: '费用分段缺失，未做拆分' },
    balanced: null,
    residual: null,
    realizedRatio: 0.2,
    spotExposure: null,
    note: '分段电量缺失，未做全量恒等核对（已知部分见上）',
    ...over,
  })
}

export function ledgerPayload(over: Partial<SettlementLedger> = {}): SettlementLedger {
  return {
    month: '2026-05',
    stations: [],
    unmapped: [],
    note: '未解释差异 = 台账锁价电量 − 结算中长期电量；不归因任何一方。台账未分配到场站的量在交易单元一级对照。',
    unallocatedSubjectLevel: [],
    readmodelAsOf: '2026-05-31T23:59:59+08:00',
    ...over,
  }
}

export function reviewPayload(over: Partial<SettlementReview> = {}): SettlementReview {
  return {
    fromDate: '2026-05-01',
    toDate: '2026-05-31',
    granularity: 'DAY',
    view: 'FORMAL',
    status: 'OK',
    statusNote: null,
    rows: [reviewRow()],
    calendar: null,
    ledger: ledgerPayload(),
    mechanismFee: { status: 'NOT_REPORTED', amount: null, note: '机制差价科目预留：数据未入库' },
    dataQuality: { excludedUnverified: 0 },
    ...over,
  }
}

/** 暂结视角当前的真实响应：未入库，不造数。 */
export function provisionalNotReported(): SettlementReview {
  return reviewPayload({
    view: 'PROVISIONAL',
    status: 'NOT_REPORTED',
    note: '暂结结算数据未入库',
    rows: [],
    calendar: null,
    ledger: null,
  })
}
