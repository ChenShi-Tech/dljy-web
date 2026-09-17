// 中长期售电 P2 分时分解与场站分配（openspec tasks 第 7 组，#2970） 的共享类型声明（与 curves.mjs 配对，#2969 预登记）。
// 接口 DTO 形状与 server/midlong/midlong-p2-api.mjs 的响应一一对应。电量一律是规范十进制字符串（MWh），不是 number；
// 未知一律是 null，不是 '0'。时段时刻为带 +08:00 的北京时间 ISO 文本，区间 [start, end)。
import type { EvidenceBasis, MidlongUnallocatedEntry } from './contract.mjs'

export type CurveSetStatus = 'DRAFT' | 'CONFIRMED' | 'DISCARDED'
export type CurveInputKind = 'INTERVAL_SERIES' | 'TYPICAL_DAY' | 'ESTIMATE_GENERATED'
export type CurveGranularity = 15 | 30 | 60 | 1440
export type CurveMeasure = 'POWER' | 'ENERGY'
export type CurveConversionMethod = 'POWER_TIMES_DURATION' | 'ENERGY_UNIT_FACTOR'
export type CurveEstimateMethod = 'FLAT' | 'PROFILE'
export type CurveTimeStatus = 'CURVE' | 'TIME_UNKNOWN' | 'GRANULARITY_TOO_COARSE' | 'MONTH_UNKNOWN'
export type BucketCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'NO_OBLIGATION'
export type IntervalPositionGranularity = 'DAY' | 'HOUR' | 'QUARTER_HOUR'
export type StationAllocationKind = 'FORMAL_TRADING' | 'INTERNAL_OPERATING'
export type StationSegmentMode = 'CONTRACT_TOTAL' | 'MONTHLY'
export type StationDerivation = 'CONTRACT_STATION' | 'ALLOCATION' | 'UNALLOCATED' | 'ALLOCATION_MONTH_UNKNOWN'
export type CorrectionImpactStatus = 'RECONFIRM_REQUIRED' | 'QUANTITY_CHANGED'
export type CurveSourceDocumentType = 'IMPORT_SOURCE_FILE' | 'TRADING_CENTER_EXPORT' | 'ELECTRONIC_CONFIRMATION'
export type CurveFileRole = 'workbook' | 'intervals' | 'typicalDays' | 'typicalDayRanges' | 'dailyTotals'
export type IssueSeverity = 'blocking' | 'warning'

export interface CurveTemplateDeclaration {
  code: string
  label: string
  /** 模板声明的守恒容差（MWh）；是软件舍入容差，不是业务偏差许可。 */
  tolerance: string
  roundingRule: 'NONE' | 'ROUND_6_TAIL_TO_LAST'
  roundingRuleText: string
}

export interface CurveFileColumn { key: string; name: string; aliases: string[]; required: boolean; hint: string }

export declare const CURVE_SET_STATUSES: readonly CurveSetStatus[]
export declare const CURVE_EVIDENCE_BASES: readonly EvidenceBasis[]
export declare const CURVE_INPUT_KINDS: readonly CurveInputKind[]
export declare const CURVE_GRANULARITIES: readonly CurveGranularity[]
export declare const CURVE_POWER_GRANULARITIES: readonly CurveGranularity[]
export declare const CURVE_ESTIMATE_GRANULARITIES: readonly CurveGranularity[]
export declare const CURVE_ESTIMATE_METHODS: readonly CurveEstimateMethod[]
export declare const CURVE_MEASURES: readonly CurveMeasure[]
export declare const CURVE_CONVERSION_METHODS: readonly CurveConversionMethod[]
export declare const CURVE_UNITS: Readonly<Record<string, { measure: CurveMeasure; factor: string }>>
export declare const CURVE_TIMEZONES: Readonly<Record<string, number>>
export declare const CANONICAL_CURVE_TIMEZONE: 'Asia/Shanghai'
export declare const CURVE_STANDARD_TEMPLATE: 'MIDLONG-CURVE-STD-V1'
export declare const CURVE_ESTIMATE_TEMPLATE: 'MIDLONG-CURVE-ESTIMATE-V1'
export declare const CURVE_ESTIMATE_DECIMALS: number
export declare const CURVE_TEMPLATES: Readonly<Record<string, CurveTemplateDeclaration>>
export declare const CURVE_SOURCE_DOCUMENT_TYPES: readonly CurveSourceDocumentType[]
export declare const CURVE_FORMAL_SOURCE_DOCUMENT_TYPES: readonly CurveSourceDocumentType[]
export declare const P2_BASIS_EVIDENCE_TYPES: readonly string[]
export declare const MAX_CURVE_INTERVALS: number
export declare const MAX_CURVE_COVERAGE_MONTHS: number
export declare const CURVE_FILE_SHEETS: Readonly<Record<Exclude<CurveFileRole, 'workbook'>, string>>
export declare const CURVE_FILE_COLUMNS: Readonly<Record<Exclude<CurveFileRole, 'workbook'>, readonly CurveFileColumn[]>>
export declare const INTERVAL_POSITION_GRANULARITIES: Readonly<Record<IntervalPositionGranularity, number>>
export declare const INTERVAL_POSITION_MAX_DAYS: Readonly<Record<IntervalPositionGranularity, number>>
export declare const CURVE_TIME_STATUSES: readonly CurveTimeStatus[]
export declare const BUCKET_COVERAGES: readonly BucketCoverage[]
export declare const STATION_ALLOCATION_KINDS: readonly StationAllocationKind[]
export declare const STATION_SEGMENT_MODES: readonly StationSegmentMode[]
export declare const STATION_DERIVATIONS: readonly StationDerivation[]
export declare const CORRECTION_IMPACT_STATUSES: readonly CorrectionImpactStatus[]

export declare const CURVE_SET_STATUS_LABELS: Readonly<Record<CurveSetStatus, string>>
export declare const CURVE_EVIDENCE_BASIS_LABELS: Readonly<Record<EvidenceBasis, string>>
export declare const CURVE_INPUT_KIND_LABELS: Readonly<Record<CurveInputKind, string>>
export declare const CURVE_GRANULARITY_LABELS: Readonly<Record<CurveGranularity, string>>
export declare const CURVE_MEASURE_LABELS: Readonly<Record<CurveMeasure, string>>
export declare const CURVE_CONVERSION_METHOD_LABELS: Readonly<Record<CurveConversionMethod, string>>
export declare const CURVE_ESTIMATE_METHOD_LABELS: Readonly<Record<CurveEstimateMethod, string>>
export declare const CURVE_TIME_STATUS_LABELS: Readonly<Record<CurveTimeStatus, string>>
export declare const BUCKET_COVERAGE_LABELS: Readonly<Record<BucketCoverage, string>>
export declare const STATION_ALLOCATION_KIND_LABELS: Readonly<Record<StationAllocationKind, string>>
export declare const STATION_SEGMENT_MODE_LABELS: Readonly<Record<StationSegmentMode, string>>
export declare const STATION_DERIVATION_LABELS: Readonly<Record<StationDerivation, string>>
export declare const CORRECTION_IMPACT_LABELS: Readonly<Record<CorrectionImpactStatus, string>>
export declare const CURVE_ISSUES: Readonly<Record<string, { severity: IssueSeverity; label: string }>>
export declare const STATION_ALLOCATION_ISSUES: Readonly<Record<string, { severity: IssueSeverity; label: string }>>

// ── 校验报告 ────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  sourceRef?: string
  location?: { sheet?: string; rowNumber?: number } | null
  rowNo?: number
  rowIndex?: number
  start?: string
  end?: string
  month?: string
  date?: string
  field?: string
  segment?: string
  ranges?: Array<{ start: string; end: string; count: number }>
  [key: string]: unknown
}

export interface IssueSummaryEntry { code: string; severity: IssueSeverity; label: string; count: number }

export interface IssueReport {
  blocking: boolean
  blockingCount: number
  warningCount: number
  summary: IssueSummaryEntry[]
  /** 明细最多 300 条、每类最多 50 条；计数在 summary 里不截断。 */
  issues: ValidationIssue[]
  truncated: boolean
}

export interface CurveMonthCheck {
  month: string
  curveQuantity: string
  /** 合同该月正式月度分解；未知为 null（无法核对守恒，阻止确认）。 */
  formalQuantity: string | null
  difference: string | null
  status: 'CONSERVED' | 'WITHIN_TOLERANCE' | 'NOT_CONSERVED' | 'MONTH_UNKNOWN'
  intervalCount: number
  expectedIntervalCount: number
  missingIntervalCount: number
  zeroIntervalCount: number
}

export interface CurveValidationReport extends IssueReport {
  totalQuantity: string
  intervalCount: number
  expectedIntervalCount: number
  missingIntervalCount: number
  zeroIntervalCount: number
  completeness: 'COMPLETE' | 'PARTIAL'
  months: CurveMonthCheck[]
  coverage: { fromMonth: string; toMonth: string; start: string; end: string } | null
  tolerance: string
  templateCode: string
  roundingRule: string
  roundingRuleText: string
}

// ── 分时分解集 ──────────────────────────────────────────────────────────────

export interface CurveSourceFile { role: CurveFileRole; fileName: string; byteSize: number; sha256: string; storageKey: string }

export interface CurveSet {
  id: number
  contractId: number
  revisionId: number
  revisionNo: number | null
  setNo: number
  basedOnSetNo: number
  sourceSetId: number | null
  status: CurveSetStatus
  evidenceBasis: EvidenceBasis
  inputKind: CurveInputKind
  granularityMinutes: CurveGranularity
  sourceUnit: string
  sourceMeasure: CurveMeasure
  conversionMethod: CurveConversionMethod
  sourceTimezone: string
  templateCode: string
  tolerance: string
  roundingRule: string
  coverageFromMonth: string
  coverageToMonth: string
  intervalCount: number
  totalQuantity: string
  blockingIssueCount: number
  completeness: 'COMPLETE' | 'PARTIAL' | null
  evidenceIds: number[]
  note: string | null
  provenance: {
    format?: 'xlsx' | 'csv' | 'json' | 'estimate'
    sourceFiles?: CurveSourceFile[]
    sourceDocumentType?: CurveSourceDocumentType | null
    declaredDailyTotals?: Array<{ date: string; quantity: string }>
    typicalDays?: Array<{ name: string | null; dateRanges: Array<{ from: string | null; to: string | null }> }>
    copiedFrom?: { curveSetId: number; setNo: number; revisionNo: number }
    estimate?: { method: CurveEstimateMethod; profile: string[] | null } | null
  }
  recordedAt: string
  recordedBy: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  discardedAt: string | null
  discardedBy: string | null
  discardReason: string | null
}

export interface CurveInterval {
  rowNo: number
  start: string
  end: string
  quantity: string
  sourceValue: string
  sourceUnit: string
  /** 原始资料定位（工作表与行号、典型日与适用日期，或沿用 / 估算说明）。 */
  sourceRef: string | null
}

export interface CurveSetDetail extends CurveSet {
  contract: { contractId: number; externalContractNo: string; contractName: string; confirmationStatus: string; currentRevisionNo: number }
  isCurrentRevision: boolean
  template: CurveTemplateDeclaration | null
  validation: CurveValidationReport
  days: Array<{ date: string; quantity: string; intervalCount: number; zeroIntervalCount: number }>
  date: string | null
  intervals: CurveInterval[] | null
}

export interface CurveMonthRef { curveSetId: number; setNo: number; granularityMinutes: CurveGranularity; curveQuantity: string | null }

export interface CurveCorrectionImpact {
  status: CorrectionImpactStatus
  previousRevisionNo: number
  previousCurveSetId: number
  previousSetNo: number
  previousMonthlyQuantity: string | null
  previousCurveQuantity: string | null
  currentMonthlyQuantity: string | null
  monthAffectedByCorrection: boolean
  /** 同月正式电量未变：可以沿用原分解集生成当前版本的草稿（仍需确认）。 */
  canCopy: boolean
}

export interface ContractCurvesOverview {
  contractId: number
  companyId: string
  regionId: string
  externalContractNo: string
  contractName: string
  documentKind: string
  confirmationStatus: string
  currentRevisionNo: number
  deliveryStart: string | null
  deliveryEnd: string | null
  canCreate: boolean
  sets: Array<CurveSet & { isCurrentRevision: boolean }>
  months: Array<{
    month: string
    monthlyFormalQuantity: string | null
    timeStatus: Exclude<CurveTimeStatus, 'GRANULARITY_TOO_COARSE'>
    formalCurve: CurveMonthRef | null
    estimateCurve: CurveMonthRef | null
    correctionImpact: CurveCorrectionImpact | null
  }>
  templates: CurveTemplateDeclaration[]
}

export interface CurveIntervalRowInput { date?: string; periodIndex?: string | number; start?: string; end?: string; value: string | number | null }
export interface TypicalDayInput {
  name: string
  values: Array<{ periodIndex: string | number; value: string | number | null }>
  dateRanges: Array<{ from: string; to: string }>
  declaredDailyTotal?: string | number | null
}

export interface CurveDraftInput {
  expectedRevisionNo: number
  evidenceBasis: EvidenceBasis
  coverageFromMonth: string
  coverageToMonth: string
  granularityMinutes?: CurveGranularity
  unit?: string
  sourceTimezone?: string
  /** 四选一：文件、逐时段数据、典型日数据、沿用本合同已确认的分解集。 */
  files?: Array<{ role: CurveFileRole; fileName: string; contentBase64: string }>
  rows?: CurveIntervalRowInput[]
  typicalDays?: TypicalDayInput[]
  copyFromCurveSetId?: number
  declaredDailyTotals?: Array<{ date: string; quantity: string | number }>
  sourceDocumentType?: CurveSourceDocumentType
  evidenceIds?: number[]
  note?: string
}

export interface CurveEstimateInput {
  expectedRevisionNo: number
  coverageFromMonth: string
  coverageToMonth: string
  granularityMinutes: 15 | 30 | 60
  method: CurveEstimateMethod
  /** PROFILE：一天各时段的非负权重，个数 = 1440 / 粒度。 */
  profile?: Array<string | number>
  /** 估算依据说明（必填）。 */
  note: string
}

export interface CurveDraftDigest {
  blocking: boolean
  blockingCount: number
  warningCount: number
  summary: IssueSummaryEntry[]
  completeness: 'COMPLETE' | 'PARTIAL' | null
  months?: CurveMonthCheck[]
}

export interface CurveDraftResult { curveSetId: number; setNo: number; status: 'DRAFT'; revisionNo: number; validation: CurveDraftDigest; idempotentReplay?: boolean }
export interface CurveConfirmResult { curveSetId: number; setNo: number; status: 'CONFIRMED'; confirmedAt: string; evidenceIds: number[]; idempotentReplay?: boolean }
export interface P2DiscardResult { curveSetId?: number; allocationSetId?: number; setNo: number; status: 'DISCARDED' }

// ── 场站分配 ────────────────────────────────────────────────────────────────

export interface StationSegment {
  /** 'TOTAL'（合同总量）或 YYYY-MM（交割月）。 */
  segment: string
  segmentQuantity: string | null
  allocatedQuantity: string
  unallocatedQuantity: string | null
  excessQuantity: string | null
  stationCount: number
  status: 'WITHIN' | 'EXCEEDS' | 'SEGMENT_UNKNOWN'
}

export interface StationAllocationRow { id: number | null; stationId: number; stationName: string | null; segmentMonth: string | null; quantity: string }

export interface StationAllocationSet {
  id: number
  contractId: number
  revisionId: number
  revisionNo: number | null
  setNo: number
  basedOnSetNo: number
  status: CurveSetStatus
  allocationKind: StationAllocationKind
  segmentMode: StationSegmentMode
  basisNote: string | null
  evidenceIds: number[]
  blockingIssueCount: number
  recordedAt: string
  recordedBy: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  discardedAt: string | null
  discardedBy: string | null
  discardReason: string | null
  rows: StationAllocationRow[]
}

export interface StationAllocationSetDetail extends StationAllocationSet {
  contract: { contractId: number; externalContractNo: string; contractName: string; confirmationStatus: string; currentRevisionNo: number }
  isCurrentRevision: boolean
  segments: StationSegment[]
  validation: IssueReport & { segments: StationSegment[] }
}

export interface EffectiveStationAllocation { allocationSetId: number; setNo: number; segmentMode: StationSegmentMode; rows: StationAllocationRow[]; segments: StationSegment[] }

export interface ContractStationAllocationsOverview {
  contractId: number
  companyId: string
  regionId: string
  externalContractNo: string
  contractName: string
  confirmationStatus: string
  currentRevisionNo: number
  deliveryStart: string | null
  deliveryEnd: string | null
  totalQuantity: string | null
  monthlyFormal: Record<string, string>
  subjectId: number | null
  contractStation: { stationId: number; stationName: string | null } | null
  subjectStations: Array<{ stationId: number; stationName: string | null }>
  canCreate: boolean
  effective: Record<StationAllocationKind, EffectiveStationAllocation | null>
  sets: Array<StationAllocationSet & { isCurrentRevision: boolean; validation: IssueReport & { segments: StationSegment[] } }>
  impact: Array<{
    allocationKind: StationAllocationKind
    status: CorrectionImpactStatus
    previousRevisionNo: number
    previousAllocationSetId: number
    previousSetNo: number
    segmentsAgainstCurrent: StationSegment[]
    canReuse: boolean
  }>
}

export interface StationAllocationDraftInput {
  expectedRevisionNo: number
  allocationKind: StationAllocationKind
  segmentMode: StationSegmentMode
  rows: Array<{ stationId: number; segmentMonth?: string | null; quantity: string | number }>
  basisNote?: string
  evidenceIds?: number[]
}

export interface StationAllocationDraftResult {
  allocationSetId: number
  setNo: number
  status: 'DRAFT'
  revisionNo: number
  validation: { blocking: boolean; blockingCount: number; warningCount: number; summary: IssueSummaryEntry[]; completeness: null; segments: StationSegment[] }
  idempotentReplay?: boolean
}

export interface StationAllocationConfirmResult { allocationSetId: number; setNo: number; status: 'CONFIRMED'; confirmedAt: string; segments: StationSegment[]; idempotentReplay?: boolean }

// ── 分时 / 场站持仓 ─────────────────────────────────────────────────────────

export interface IntervalBucket {
  start: string
  end: string
  date: string
  month: string
  coverage: BucketCoverage
  /** 整桶未知时为 null（不是零）；部分未知时为已知部分，由 coverage 标明。 */
  formalQuantity: string | null
  knownContractCount: number
  unknownContractIds: number[]
}

export interface IntervalPositionReport {
  asOf: string
  view: 'CURRENT' | 'AS_OF'
  granularity: IntervalPositionGranularity
  granularityMinutes: number
  fromDate: string
  toDate: string
  status: 'empty' | 'partial' | 'complete'
  regionId: string
  companyIds: string[]
  generatedAt: string
  filters: Record<string, string>
  buckets: IntervalBucket[]
  contracts: Array<{
    contractId: number
    externalContractNo: string
    contractName: string
    subjectId: number | null
    stationId: number | null
    revisionNo: number
    deliveryStart: string
    deliveryEnd: string
    curveQuantityInRange: string
    months: Array<{
      month: string
      timeStatus: CurveTimeStatus
      monthlyFormalQuantity: string | null
      curve: { curveSetId: number; setNo: number; granularityMinutes: number; confirmedAt: string | null } | null
      estimate: { curveSetId: number; setNo: number; granularityMinutes: number; confirmedAt: string | null } | null
    }>
  }>
  totals: { contractCount: number; curveQuantityInRange: string; bucketCount: number; unknownBucketCount: number; partialBucketCount: number; timeUnknownContractCount: number }
  excluded: { estimateCurveSets: Array<{ contractId: number; month: string; curveSetId: number; setNo: number; granularityMinutes: number }>; note: string }
}

export interface IntervalPositionQuery {
  fromDate: string
  toDate: string
  granularity: IntervalPositionGranularity
  asOf?: string
  subjectId?: number | string
  stationId?: number | 'UNALLOCATED' | string
  productKind?: string
  tradeMethod?: string
  energyAttribute?: string
}

export interface StationContribution {
  month: string
  contractId: number
  externalContractNo: string
  contractName: string
  revisionNo: number
  stationId: number | null
  quantity: string
  derivation: StationDerivation
  allocationSetId: number | null
  allocationSetNo: number | null
}

export interface StationPositionReport {
  asOf: string
  view: 'CURRENT' | 'AS_OF'
  fromMonth: string
  toMonth: string
  allocationKind: StationAllocationKind
  status: 'empty' | 'partial' | 'complete'
  regionId: string
  companyIds: string[]
  generatedAt: string
  filters: Record<string, string>
  months: Array<{
    month: string
    /** 与 P1 月度持仓该月正式分解电量同一数值。 */
    subjectTotalQuantity: string
    stations: Array<{ stationId: number; stationName: string | null; quantity: string }>
    stationAllocatedQuantity: string
    unallocatedQuantity: string
    stationMonthUnknownQuantity: string
    incomplete: boolean
    affectedContractIds: number[]
  }>
  stations: Array<{ stationId: number; stationName: string | null; quantity: string }>
  totals: { subjectTotalQuantity: string; stationAllocatedQuantity: string; unallocatedQuantity: string; stationMonthUnknownQuantity: string; unallocatedPoolQuantity: string }
  unallocatedPool: MidlongUnallocatedEntry[]
  contributions: StationContribution[]
  allocationSetsUsed: Array<{ contractId: number; allocationSetId: number; setNo: number }>
  revisionsUsed: Array<{ contractId: number; revisionNo: number; confirmedAt: string }>
  excluded: { note: string }
}

export interface StationPositionQuery {
  fromMonth?: string
  toMonth?: string
  asOf?: string
  allocationKind?: StationAllocationKind
  subjectId?: number | string
  productKind?: string
  tradeMethod?: string
  energyAttribute?: string
}

export interface CurveTemplateFiles {
  format: 'xlsx' | 'csv'
  templateCode: string
  files: Array<{ role: CurveFileRole; fileName: string; contentBase64?: string; content?: string }>
}

// ── 纯函数 ──────────────────────────────────────────────────────────────────

export interface CurveDeclaration {
  granularityMinutes: CurveGranularity
  unit: string
  measure: CurveMeasure
  factor: string
  sourceTimezone: string
  offsetMinutes: number
  conversionMethod: CurveConversionMethod
  durationHours: string
  templateCode: string
  tolerance: string
  roundingRule: string
  roundingRuleText: string
}

export interface NormalizedInterval { rowNo: number; startMs: number; endMs: number; sourceValue: string; quantity: string; sourceRef: string }
export interface RevisionLike { deliveryStart: string | null; deliveryEnd: string | null; totalQuantity: string | null; allocations?: Array<{ deliveryMonth: string; quantity: string; evidenceBasis: EvidenceBasis }> }

export declare function resolveTimezoneOffset(value: unknown): number | null
export declare function dateMidnightMs(isoDate: string, offsetMinutes?: number): number | null
export declare function beijingPartsOf(ms: number): { date: string; month: string; minuteOfDay: number; second: number; millisecond: number }
export declare function toBeijingIso(ms: number): string
export declare function parseTimeOfDay(value: unknown): number | null
export declare function parseCurveDateTime(value: unknown, offsetMinutes: number): number | null
export declare function resolveCurveDeclaration(input?: { granularityMinutes?: unknown; unit?: unknown; sourceTimezone?: unknown; templateCode?: string }):
  | { ok: true; issues: []; value: CurveDeclaration }
  | { ok: false; issues: ValidationIssue[] }
export declare function convertCurveValue(sourceValue: string, declaration: CurveDeclaration): string
export declare function normalizeIntervalSeries(input: { declaration: CurveDeclaration; rows: Array<CurveIntervalRowInput & { location?: { sheet?: string; rowNumber?: number } }> }): { intervals: NormalizedInterval[]; issues: ValidationIssue[] }
export declare function expandTypicalDays(input: { declaration: CurveDeclaration; typicalDays: TypicalDayInput[] }): { intervals: NormalizedInterval[]; issues: ValidationIssue[] }
export declare function formalMonthlyQuantities(revision: RevisionLike | null | undefined): Map<string, string>
export declare function resolveCoverage(input: { coverageFromMonth: string; coverageToMonth: string; deliveryStart: string | null; deliveryEnd: string | null }):
  | { ok: true; fromMonth: string; toMonth: string; months: string[]; deliveryStartMs: number; deliveryEndMs: number; windowStartMs: number; windowEndMs: number }
  | { ok: false; message: string }
export declare function validateCurve(input: {
  intervals: NormalizedInterval[]
  declaration: CurveDeclaration
  coverageFromMonth: string
  coverageToMonth: string
  revision: RevisionLike
  declaredDailyTotals?: Array<{ date: string; quantity: string | number; location?: { sheet?: string; rowNumber?: number } | null }>
  priorIssues?: ValidationIssue[]
}): CurveValidationReport
export declare function summarizeIssues<T extends object>(issues: ValidationIssue[], extra?: T): IssueReport & T
export declare function generateEstimateCurve(input: { revision: RevisionLike; coverageFromMonth: string; coverageToMonth: string; granularityMinutes: unknown; method: unknown; profile?: unknown }):
  { ok: boolean; intervals: NormalizedInterval[]; issues: ValidationIssue[]; declaration: CurveDeclaration | null }
export declare function validateStationAllocations(input: { segmentMode: StationSegmentMode; rows: Array<{ stationId: unknown; segmentMonth?: unknown; quantity: unknown }>; revision: RevisionLike }):
  IssueReport & { rows: Array<{ stationId: number; segmentMonth: string | null; quantity: string; rowIndex: number }>; segments: StationSegment[] }
export declare function summarizeStationSegments(input: { segmentMode: StationSegmentMode; rows: Array<{ segmentMonth: string | null; quantity: string }>; revision: RevisionLike; formal?: Map<string, string> }): StationSegment[]
export declare function isSingleMonthDelivery(revision: RevisionLike | null | undefined): boolean
export declare function resolveIntervalRange(input: { fromDate: unknown; toDate: unknown; granularity: unknown }):
  | { ok: true; fromDate: string; toDate: string; granularity: IntervalPositionGranularity; granularityMinutes: number; days: number; fromMonth: string; toMonth: string; startMs: number; endMs: number }
  | { ok: false; message: string }
export declare function quantitiesEqual(a: string | null | undefined, b: string | null | undefined): boolean
export declare function quantityDifference(a: string | null | undefined, b: string | null | undefined): string | null
export declare function isCurveMonth(value: unknown): boolean
