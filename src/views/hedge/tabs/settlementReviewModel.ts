// 套保「结算复核」页签的纯函数视图模型（openspec build-midlong-spot-hedging 任务 10.5，HR-01..05；ChenShi-Tech/dljy#3054）。
//
// 只做三件事，全部不补 0：
// 1) 月份与区间：回看窗口（含当月最近 12 个月）、默认月份取最近一个有正式覆盖的月份（HR-02：不写死月份）；
// 2) 覆盖日历：把正式/暂结两份 coverage 合成「场站 × 日」三态（正式 / 暂结 / 未覆盖），缺失格子就是未覆盖；
// 3) 已实现指标汇总：只用恒等核对通过的场站日（HR-01：不平与分段缺失的行剔除并单列），
//    已实现套保率走 settlementFormula.hedgeCoverage（HA-06 统一口径：分母为 0 或缺失 →「不可计算」）。
// 逐行的套保率、敞口、恒等核对、费用拆分都由后端给出，这里只按行汇总、不改口径。

import { hedgeCoverage } from '@/services/settlementFormula'
import type {
  SettlementCalendar,
  SettlementCoverage,
  SettlementReview,
  SettlementReviewRow,
  SettlementView,
} from '@/services/hedge/hedgeSettlementApi'

/** 覆盖日历回看窗口：含当月在内最近 12 个月。更早的月份不在可选范围内。 */
export const COVERAGE_LOOKBACK_MONTHS = 12

const pad2 = (n: number) => String(n).padStart(2, '0')
const round2 = (value: number) => Math.round(value * 100) / 100

/** 'YYYY-MM' 平移 delta 个月。 */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number)
  const index = year * 12 + (mon - 1) + delta
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`
}

/** 'YYYY-MM' 的最后一天 'YYYY-MM-DD'。 */
export function monthLastDay(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return `${month}-${pad2(new Date(Date.UTC(year, mon, 0)).getUTCDate())}`
}

/** 回看窗口：months 从新到旧（首项为当月），fromDate 为最早月份的 1 日，toDate 截到今天。 */
export function coverageWindow(today: string, lookback = COVERAGE_LOOKBACK_MONTHS) {
  const current = today.slice(0, 7)
  const months = Array.from({ length: lookback }, (_, i) => shiftMonth(current, -i))
  return { fromDate: `${months[months.length - 1]}-01`, toDate: today, months }
}

/** 某月的复核区间：当月截到今天（今天之后的日子还没发生，不算「缺失」）。 */
export function monthRange(month: string, today: string) {
  const last = monthLastDay(month)
  return { fromDate: `${month}-01`, toDate: last < today ? last : today }
}

/** fromDate..toDate（含两端）的逐日日期。 */
export function datesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  const end = Date.parse(`${toDate}T00:00:00Z`)
  for (let t = Date.parse(`${fromDate}T00:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

// ── 响应归一：缺字段一律按「没有」处理，数值保持 null，绝不补 0 ─────────────────────────

function normalizeCalendar(raw: unknown): SettlementCalendar | null {
  const cal = raw as Partial<SettlementCalendar> | null | undefined
  if (!cal || !Array.isArray(cal.days)) return null
  return {
    days: cal.days.map((day) => ({
      date: String(day?.date ?? ''),
      coveredPlants: Array.isArray(day?.coveredPlants) ? day.coveredPlants : [],
      uncoveredPlants: Array.isArray(day?.uncoveredPlants) ? day.uncoveredPlants : [],
      full: Boolean(day?.full),
    })),
    coveredDays: Number(cal.coveredDays ?? 0),
    totalDays: Number(cal.totalDays ?? cal.days.length),
  }
}

export function normalizeCoverage(raw: unknown, view: SettlementView): SettlementCoverage {
  const cov = (raw ?? {}) as Partial<SettlementCoverage>
  const calendar = normalizeCalendar(cov.calendar) ?? { days: [], coveredDays: 0, totalDays: 0 }
  return {
    fromDate: String(cov.fromDate ?? ''),
    toDate: String(cov.toDate ?? ''),
    view,
    plants: Array.isArray(cov.plants) ? cov.plants : [],
    calendar,
    status: cov.status === 'OK' ? 'OK' : 'NOT_REPORTED',
    note: cov.note ?? null,
    dataQuality: { excludedUnverified: Number(cov.dataQuality?.excludedUnverified ?? 0) },
  }
}

export function normalizeReview(raw: unknown, view: SettlementView): SettlementReview {
  const rev = (raw ?? {}) as Partial<SettlementReview>
  const rows = Array.isArray(rev.rows) ? rev.rows : []
  return {
    fromDate: String(rev.fromDate ?? ''),
    toDate: String(rev.toDate ?? ''),
    granularity: rev.granularity === 'MONTH' ? 'MONTH' : 'DAY',
    view,
    status: rev.status === 'OK' || (rev.status === undefined && rows.length > 0) ? 'OK' : 'NOT_REPORTED',
    statusNote: rev.statusNote ?? null,
    note: rev.note ?? null,
    rows,
    calendar: normalizeCalendar(rev.calendar),
    ledger: rev.ledger ?? null,
    mechanismFee: rev.mechanismFee ?? null,
    dataQuality: rev.dataQuality ?? null,
  }
}

// ── 月份选择 ─────────────────────────────────────────────────────────────────

function coveredIndex(coverage: SettlementCoverage | null): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const day of coverage?.calendar.days ?? []) index.set(day.date, new Set(day.coveredPlants))
  return index
}

export interface MonthCoverageSummary {
  month: string
  /** 至少一个场站有正式记录的天数。 */
  formalDays: number
  /** 没有任何正式记录、只有暂结记录的天数。 */
  provisionalOnlyDays: number
}

/** 逐月覆盖摘要（顺序同 months：从新到旧）。 */
export function summarizeMonths(months: string[], formal: SettlementCoverage | null, provisional: SettlementCoverage | null): MonthCoverageSummary[] {
  const formalIndex = coveredIndex(formal)
  const provisionalIndex = coveredIndex(provisional)
  const byMonth = new Map(months.map((month) => [month, { month, formalDays: 0, provisionalOnlyDays: 0 }]))
  for (const date of new Set([...formalIndex.keys(), ...provisionalIndex.keys()])) {
    const acc = byMonth.get(date.slice(0, 7))
    if (!acc) continue
    if ((formalIndex.get(date)?.size ?? 0) > 0) acc.formalDays += 1
    else if ((provisionalIndex.get(date)?.size ?? 0) > 0) acc.provisionalOnlyDays += 1
  }
  return months.map((month) => byMonth.get(month) ?? { month, formalDays: 0, provisionalOnlyDays: 0 })
}

/** 默认月份：最近一个有正式覆盖的月份；没有正式覆盖时取最近一个有暂结的月份；都没有返回 null（由调用方回落当月）。 */
export function defaultMonth(summaries: MonthCoverageSummary[]): string | null {
  return summaries.find((s) => s.formalDays > 0)?.month
    ?? summaries.find((s) => s.provisionalOnlyDays > 0)?.month
    ?? null
}

export function monthOptionLabel(summary: MonthCoverageSummary): string {
  const parts: string[] = []
  if (summary.formalDays) parts.push(`正式 ${summary.formalDays} 天`)
  if (summary.provisionalOnlyDays) parts.push(`仅暂结 ${summary.provisionalOnlyDays} 天`)
  return `${summary.month}（${parts.length ? parts.join(' · ') : '未入库'}）`
}

// ── 覆盖日历（场站 × 日）────────────────────────────────────────────────────────

/** 单个场站日：正式 = 有正式日结；暂结 = 正式缺失、只有暂结记录；未覆盖 = 都没有（不按 0 计）。 */
export type CellState = 'FORMAL' | 'PROVISIONAL' | 'MISSING'
/** 全场站一行：在三态之外多一个「部分场站有正式记录」。 */
export type DayState = CellState | 'PARTIAL'

export const CELL_LABEL: Record<CellState, string> = { FORMAL: '正式', PROVISIONAL: '暂结', MISSING: '未覆盖' }

export interface CoverageMatrixRow {
  plant: string
  cells: CellState[]
  /** 有正式记录的天数。 */
  formal: number
  /** 有暂结记录的天数（不论是否也有正式）。 */
  provisionalRecords: number
  /** 只有暂结、正式缺失的天数。 */
  provisionalOnly: number
  missing: number
}

export interface CoverageMatrixDay {
  date: string
  state: DayState
  formalPlants: number
  totalPlants: number
}

export interface CoverageMatrix {
  dates: string[]
  plants: string[]
  rows: CoverageMatrixRow[]
  days: CoverageMatrixDay[]
  totals: {
    cells: number
    formal: number
    provisionalRecords: number
    provisionalOnly: number
    missing: number
    /** 全部场站都有正式记录的天数。 */
    fullFormalDays: number
  }
}

export function buildCoverageMatrix(dates: string[], formal: SettlementCoverage | null, provisional: SettlementCoverage | null): CoverageMatrix {
  const formalIndex = coveredIndex(formal)
  const provisionalIndex = coveredIndex(provisional)
  const plants = [...new Set([...(formal?.plants ?? []), ...(provisional?.plants ?? [])])].sort()
  const rows: CoverageMatrixRow[] = plants.map((plant) => {
    let formalCount = 0
    let provisionalRecords = 0
    let provisionalOnly = 0
    let missing = 0
    const cells = dates.map((date): CellState => {
      const hasFormal = formalIndex.get(date)?.has(plant) ?? false
      const hasProvisional = provisionalIndex.get(date)?.has(plant) ?? false
      if (hasProvisional) provisionalRecords += 1
      if (hasFormal) { formalCount += 1; return 'FORMAL' }
      if (hasProvisional) { provisionalOnly += 1; return 'PROVISIONAL' }
      missing += 1
      return 'MISSING'
    })
    return { plant, cells, formal: formalCount, provisionalRecords, provisionalOnly, missing }
  })
  const days = dates.map((date, i): CoverageMatrixDay => {
    const formalPlants = rows.filter((row) => row.cells[i] === 'FORMAL').length
    const provisionalPlants = rows.filter((row) => row.cells[i] === 'PROVISIONAL').length
    const totalPlants = rows.length
    let state: DayState = 'MISSING'
    if (totalPlants > 0 && formalPlants === totalPlants) state = 'FORMAL'
    else if (formalPlants > 0) state = 'PARTIAL'
    else if (provisionalPlants > 0) state = 'PROVISIONAL'
    return { date, state, formalPlants, totalPlants }
  })
  const sum = (pick: (row: CoverageMatrixRow) => number) => rows.reduce((acc, row) => acc + pick(row), 0)
  return {
    dates,
    plants,
    rows,
    days,
    totals: {
      cells: plants.length * dates.length,
      formal: sum((row) => row.formal),
      provisionalRecords: sum((row) => row.provisionalRecords),
      provisionalOnly: sum((row) => row.provisionalOnly),
      missing: sum((row) => row.missing),
      fullFormalDays: days.filter((day) => day.state === 'FORMAL').length,
    },
  }
}

export function dayLabel(day: CoverageMatrixDay): string {
  if (day.state === 'PARTIAL') return `正式 ${day.formalPlants}/${day.totalPlants}`
  return CELL_LABEL[day.state]
}

/** 按场站列出某种状态的日期（连续日期压成区间），供数据质量区使用。 */
export function datesByPlant(matrix: CoverageMatrix, state: CellState): Array<{ plant: string; count: number; dates: string }> {
  return matrix.rows
    .map((row) => {
      const hits = matrix.dates.filter((_, i) => row.cells[i] === state)
      return { plant: row.plant, count: hits.length, dates: compressDates(hits, matrix.dates) }
    })
    .filter((item) => item.count > 0)
}

/** 连续日期压成「MM-DD~MM-DD」，整段区间都命中时写「全部 N 天」。 */
export function compressDates(hits: string[], all: string[]): string {
  if (!hits.length) return ''
  if (hits.length === all.length) return `全部 ${all.length} 天`
  const position = new Map(all.map((date, i) => [date, i]))
  const parts: string[] = []
  let start = hits[0]
  let prev = hits[0]
  const flush = () => { parts.push(start === prev ? start.slice(5) : `${start.slice(5)}~${prev.slice(5)}`) }
  for (const date of hits.slice(1)) {
    if ((position.get(date) ?? -2) === (position.get(prev) ?? -9) + 1) { prev = date; continue }
    flush()
    start = date
    prev = date
  }
  flush()
  return parts.join('、')
}

// ── 已实现指标汇总（HR-01）────────────────────────────────────────────────────────

export interface RealizedSummary {
  rowCount: number
  /** 计入的场站日：恒等核对通过（balanced === true）且电量齐全。 */
  usedRows: number
  /** 恒等核对不平的行（剔除并单列）。 */
  unbalancedRows: number
  /** 分段电量缺失、未做恒等核对的行（剔除并单列）。 */
  incompleteRows: number
  ltmMwh: number | null
  actualMwh: number | null
  /** 已实现套保率 = Σ中长期 ÷ Σ实际上网（计入行）；分母为 0 → null（不可计算）；没有计入行 → null。 */
  realizedRatio: number | null
  /** 现货总敞口 = Σ(|日前增量| + |实时增量|)（计入行）。 */
  spotGrossMwh: number | null
  /** 净敞口 = Σ(日前增量 + 实时增量)（计入行）。 */
  spotNetMwh: number | null
}

function isCountable(row: SettlementReviewRow): boolean {
  return row.balanced === true && row.ltmEnergy !== null && row.actualOnGridEnergy !== null && row.spotExposure !== null
}

export function summarizeRealized(rows: SettlementReviewRow[]): RealizedSummary {
  const used = rows.filter(isCountable)
  const base = {
    rowCount: rows.length,
    usedRows: used.length,
    unbalancedRows: rows.filter((row) => row.balanced === false).length,
    incompleteRows: rows.filter((row) => row.balanced !== true && row.balanced !== false).length,
  }
  if (!used.length) return { ...base, ltmMwh: null, actualMwh: null, realizedRatio: null, spotGrossMwh: null, spotNetMwh: null }
  let ltm = 0
  let actual = 0
  let gross = 0
  let net = 0
  for (const row of used) {
    ltm += row.ltmEnergy as number
    actual += row.actualOnGridEnergy as number
    const exposure = row.spotExposure as NonNullable<SettlementReviewRow['spotExposure']>
    gross += exposure.dayAheadAbsMwh + exposure.realTimeAbsMwh
    net += exposure.netMwh
  }
  const coverage = hedgeCoverage({ contractedMwh: round2(ltm), forecastMwh: round2(actual) })
  return {
    ...base,
    ltmMwh: round2(ltm),
    actualMwh: round2(actual),
    realizedRatio: coverage.coverageRate,
    spotGrossMwh: round2(gross),
    spotNetMwh: round2(net),
  }
}

/** 逐场站月度汇总（顺序按 plants，结算行里出现但不在 plants 中的场站追加在后）。 */
export function summarizeByPlant(rows: SettlementReviewRow[], plants: string[]): Array<RealizedSummary & { plant: string }> {
  const order = [...plants]
  for (const row of rows) if (row.plant && !order.includes(row.plant)) order.push(row.plant)
  return order.map((plant) => ({ plant, ...summarizeRealized(rows.filter((row) => row.plant === plant)) }))
}

// ── 显示格式 ───────────────────────────────────────────────────────────────

/** 电量/金额：缺失显示「—」，不显示 0。 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return round2(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function formatRatio(value: number | null): string {
  return value === null ? '不可计算' : `${(value * 100).toFixed(2)}%`
}
