// shared/hedge/contract.mjs 的类型声明（前端 sync 副本使用；零运行时）。

export declare const HEDGE_API_PREFIX: string
export declare const HEDGE_REGIONS: readonly string[]

export declare const LEG_KEYS: readonly string[]
export declare type LegKey =
  | 'LEDGER' | 'LABELS' | 'MECHANISM' | 'ACTUAL' | 'FORECAST_MODEL' | 'FORECAST_VENDOR' | 'PRICE' | 'BAND' | 'BASELINE' | 'CAPS'
export declare const LEG_STATUSES: readonly string[]
export declare type LegStatus = 'OK' | 'PARTIAL' | 'STALE' | 'FAILED' | 'FORBIDDEN' | 'UNSUPPORTED' | 'NOT_CONFIGURED'
export declare const STALE_ELIGIBLE_LEG_KEYS: readonly string[]
export declare const LEG_KEY_LABELS: Readonly<Record<LegKey, string>>
export declare const LEG_STATUS_LABELS: Readonly<Record<LegStatus, string>>
export declare const HEDGE_LEG_ROW_KEYS: readonly string[]

/** 页头逐腿水位（HW-01）：legs.rows[] 的一行。时刻为 ISO 字符串；缺失为 null 并在 reason 写原因。 */
export interface HedgeLegRow {
  key: LegKey
  /** 来源键：FORECAST_VENDOR 各来源分别一行（yunnan-vendor-envision / yunnan-vendor-guoneng）。 */
  sourceKey: string | null
  label: string
  status: LegStatus
  /** 最近变更时刻（台账、标注、机制、基准、上限、生效方案；这些腿不判过期）。 */
  changedAt: string | null
  /** 数据截止点（实际、预测、价格）。 */
  dataThrough: string | null
  /** 发布口径：BUSINESS_TIME / DAY_BEFORE_MIDNIGHT / RUN_RECORD。 */
  publishRule: string | null
  publishAssumption: string | null
  /** 发布时刻：仅源数据自带发布时刻时给出，登记假设口径为 null。 */
  publishedAt: string | null
  /** 数据集入库时刻。 */
  ingestedAt: string | null
  /** 生效方案及版本（BAND 腿）。 */
  version: { schemeId: number; versionNo: number; name: string; basis: LockBasis | null; effectiveFrom: string | null } | null
  reason: string | null
  note: string | null
}

/** 读侧响应的 legs：旧摘要字段保留，rows 为逐腿水位。 */
export interface HedgeLegs {
  status: 'OK' | 'PARTIAL'
  note?: string
  degraded?: boolean
  rows: HedgeLegRow[]
}

export declare const INTERVAL_SOURCES: readonly string[]
export declare type IntervalSource = 'ACTUAL' | 'FORECAST' | 'UNCOVERED'
export declare const UNCOVERED_REASONS: readonly string[]
export declare type UncoveredReason =
  | 'ACTUAL_MISSING' | 'IN_PROGRESS' | 'NO_FORECAST_SOURCE' | 'FORECAST_NOT_ARRIVED'
  | 'MODEL_NOT_ADMITTED' | 'STALE_INPUT' | 'RUN_PURGED' | 'UNMAPPED'
export declare const UNCOVERED_REASON_LABELS: Readonly<Record<UncoveredReason, string>>

export declare const RATIO_BASES: readonly string[]
export declare type RatioBasis = 'INTERVAL' | 'BASELINE'
export declare const LOCK_BASES: readonly string[]
export declare type LockBasis = 'WITH_MECHANISM' | 'MIDLONG_ONLY'

export declare const TIERS: readonly string[]
export declare type Tier = 'DAY_AHEAD' | 'INTRA_MONTH' | 'FORWARD'
export declare const TIER_LABELS: Readonly<Record<Tier, string>>

export declare const STANDARD_METRICS: readonly string[]
export declare type StandardMetric = 'TODAY2_INTERVAL' | 'MONTH_INTERVAL' | 'MONTH_BASELINE' | 'FORWARD_BASELINE'
export declare const STANDARD_METRIC_LABELS: Readonly<Record<StandardMetric, string>>
export declare const STANDARD_METRIC_RULE: Readonly<Record<StandardMetric, Readonly<{ tier: Tier; ratioBasis: RatioBasis }>>>

export declare const ASSESSMENT_LEVELS: readonly string[]
export declare type AssessmentLevel = 'UNDER' | 'WITHIN' | 'OVER' | 'NOT_ASSESSED'
export declare const ASSESSMENT_LEVEL_LABELS: Readonly<Record<AssessmentLevel, string>>

export declare const ASSESSMENT_REASONS: readonly string[]
export declare type AssessmentReason =
  | 'NO_ACTIVE_SCHEME' | 'TIER_NOT_SET' | 'LOWER_NOT_SET' | 'UPPER_NOT_SET' | 'NOT_COMPUTABLE' | 'INCOMPLETE_COVERAGE'
  | 'MECHANISM_INCOMPLETE' | 'LEG_FAILED' | 'FORBIDDEN' | 'NON_STANDARD_WINDOW' | 'REALIZED_NOT_ASSESSED'
  | 'REGION_UNSUPPORTED' | 'NO_CREDENTIAL' | 'UNALLOCATED_PRESENT'
export declare const ASSESSMENT_REASON_LABELS: Readonly<Record<AssessmentReason, string>>

export declare const GRANULARITIES: readonly string[]
export declare type Granularity = 'QUARTER_HOUR' | 'HOUR' | 'DAY'
export declare const GRANULARITY_MINUTES: Readonly<Record<Granularity, number>>

export declare const HEDGE_VIEWS: readonly string[]
export declare type HedgeView = 'CURRENT' | 'AS_OF'

export declare const BUYER_CATEGORY_DIMENSION: 'BUYER_CATEGORY'
export declare const BUYER_CATEGORIES: readonly string[]
export declare type BuyerCategory = 'GRID_AGENCY' | 'PRIORITY_GENERATION' | 'RETAILER' | 'END_USER' | 'INTER_PROVINCIAL_BUYER' | 'OTHER'
export declare const BUYER_CATEGORY_LABELS: Readonly<Record<BuyerCategory, string>>
export declare const BUYER_CATEGORY_UNCLASSIFIED: 'UNCLASSIFIED'
export declare const BUYER_CATEGORY_UNCLASSIFIED_LABEL: string

export declare const BREAKDOWN_DIMENSIONS: readonly string[]
export declare type BreakdownDimension = 'productKind' | 'marketScope' | 'energyAttribute' | 'buyerCategory' | 'lockSource'
export declare const BREAKDOWN_DIMENSION_LABELS: Readonly<Record<BreakdownDimension, string>>
export declare const LOCK_SOURCES: readonly string[]
export declare const LOCK_SOURCE_LABELS: Readonly<Record<'MIDLONG' | 'MECHANISM', string>>

export declare const BREAKDOWN_QUERY_DIMENSIONS: readonly string[]
export declare type BreakdownQueryDimension = 'subject' | 'station' | 'productKind' | 'marketScope' | 'energyAttribute' | 'buyerCategory'
export declare const BREAKDOWN_QUERY_DIMENSION_LABELS: Readonly<Record<BreakdownQueryDimension, string>>
export declare const BREAKDOWN_UNCLASSIFIED: 'UNCLASSIFIED'
export declare const BREAKDOWN_UNALLOCATED: 'UNALLOCATED'
export declare const BREAKDOWN_STATION_MONTH_UNKNOWN: 'STATION_MONTH_UNKNOWN'
export declare const BREAKDOWN_SPECIAL_KEY_LABELS: Readonly<Record<'UNCLASSIFIED' | 'UNALLOCATED' | 'STATION_MONTH_UNKNOWN', string>>

/** 守恒校验结果（HM-06）：全部已知时严格校验；含未知时只校验已知部分不超过上层。 */
export interface HedgeConsistency {
  ok: boolean | null
  partial: boolean | null
  code?: 'HEDGE_CONSISTENCY_FAILED'
  level?: string
  diff?: string
  gaps?: Array<{ code: string; message: string; affected: string | null }>
  note?: string
}

/** 钻取中的合同层（HW-04）：版本、指纹与中长期详情所需标识。 */
export interface HedgeBreakdownContractRef {
  contractId: number
  externalContractNo: string | null
  contractName: string | null
  subjectId: number | null
  stationId: number | null
  quantityMwh: string
  revisionId: number | null
  revisionNo: number | null
  confirmedAt: string | null
  fingerprint: string | null
  detail: { module: 'midlong'; contractId: number; api: string }
}

/** GET /breakdown（HW-04/HC-02）：按窗口所触及月份的月度净义务分类汇总。旧字段 contracts/months 保留。 */
export interface HedgeBreakdown {
  status: 'OK' | 'FORBIDDEN'
  reason: string | null
  dimension: BreakdownQueryDimension
  dimensionLabel: string
  basis: 'MONTHLY_NET_OBLIGATION'
  basisNote: string
  months: unknown[]
  totalMwh: string | null
  rows: Array<{ key: string | number; label: string; quantityMwh: string; contractCount: number; contracts: HedgeBreakdownContractRef[] }>
  consistency: HedgeConsistency | null
}

export declare const MONTH_PERIODS: readonly string[]
export declare type MonthPeriod = 'PAST' | 'CURRENT' | 'FORWARD'
export declare const MONTH_PERIOD_LABELS: Readonly<Record<MonthPeriod, string>>
export declare const BASELINE_COVERAGES: readonly string[]
export declare type BaselineCoverage = 'COMPLETE' | 'PARTIAL' | 'NONE'
export declare const BASELINE_UNCOVERED_NOTE: string
export declare const BASELINE_PLAN_LABEL: string
export declare const CAP_STATUSES: readonly string[]
export declare type CapStatus = 'REGISTERED' | 'NOT_REGISTERED' | 'MODIFIED_AFTER_AS_OF' | 'FAILED'
export declare const CAP_NOT_REGISTERED_LABEL: string
export declare const CAP_EXCEEDED_LABEL: string
export declare const CAP_MODIFIED_AFTER_AS_OF_LABEL: string

/** 比率值：status 为 OK / NOT_COMPUTABLE / INCOMPLETE_COVERAGE / MECHANISM_INCOMPLETE / FORBIDDEN。 */
export interface HedgeRatioValue { value: string | null; status: string }
/** 判级：metric 为 null 表示非标准窗口（只展示）；tier 按标准指标对照表给出。 */
export interface HedgeMonthAssessment {
  metric: StandardMetric | null
  tier: Tier | null
  level: AssessmentLevel
  reason: AssessmentReason | null
  hints: string[]
  basis: LockBasis | null
}

/** GET /months 的逐月一行（HW-03/HB-07/HM-02）：读模型月度行的字段保留，其余为新增。 */
export interface HedgeMonthView {
  month: string
  formalQuantity: string | null
  period: MonthPeriod
  midlong: {
    lockedMwh: string | null
    structure: Record<'productKind' | 'marketScope' | 'energyAttribute' | 'buyerCategory', Array<{ key: string; label: string; quantityMwh: string }>> | null
    incomplete: boolean | null
    affectedContractIds: number[]
    note: string | null
  }
  /** 只有月量的合同的月净义务（不摊到日）。 */
  monthlyUndecomposed: { quantityMwh: string | null; contractIds: number[]; note: string }
  /** 计划口径机制电量（月度基准 × 比例，扣省间）。 */
  mechanism: { basis: 'PLANNED'; label: string; value: string | null; stations: Array<{ stationId: number; value: string | null; expired: boolean; note: string | null }>; unknownStationIds: number[]; note: string }
  generation: { granularity: 'DAY'; actualDays: number; forecastDays: number; uncoveredDays: number; totalDays: number }
  days: Array<{
    date: string
    /** 当日已确认分时分解的锁价（只有月量的合同不计入；任一分解缺当日为 null）。 */
    lockedDecomposedMwh: string | null
    generation: { value: string | null; source: IntervalSource; uncoveredReason: UncoveredReason | null; unknownStationIds: number[] }
  }>
  baseline: { coverage: BaselineCoverage; totalMwh: string | null; coveredStationIds: number[]; missingStationIds: number[]; label: string; note: string | null }
  ratios: {
    interval: { granularity: 'HOUR' | 'DAY'; coverage: { coveredCount: number; totalCount: number; ratio: string | null }; withMechanism: HedgeRatioValue; midlongOnly: HedgeRatioValue; assessment: HedgeMonthAssessment }
    baseline: { label: string; withMechanism: HedgeRatioValue; midlongOnly: HedgeRatioValue; assessment: HedgeMonthAssessment }
  }
  caps: {
    status: CapStatus
    /** 行级 status：认知时点视图下 recorded_at 晚于 T 的行为 MODIFIED_AFTER_AS_OF（不回放当时的上限值）。 */
    rows: Array<{ subjectId: number; status: 'REGISTERED' | 'NOT_REGISTERED' | 'MODIFIED_AFTER_AS_OF'; capMwh: string | null; lockedMwh: string | null; remainingMwh: string | null; exceeded: boolean | null; sourceNote: string | null; note: string | null }>
    note: string
  }
  consistency: HedgeConsistency
}

export declare const MECHANISM_PARAM_STATUSES: readonly string[]
export declare const MECHANISM_PARAM_STATUS_LABELS: Readonly<Record<'PENDING' | 'CONFIRMED' | 'RETIRED', string>>
export declare const MECHANISM_END_REASONS: readonly string[]
export declare const MECHANISM_END_REASON_LABELS: Readonly<Record<'EXPIRY' | 'EXIT' | 'SUPERSEDED', string>>
export declare const MECHANISM_PROJECT_CLASSES: readonly string[]
export declare const MECHANISM_PROJECT_CLASS_LABELS: Readonly<Record<'EXISTING' | 'INCREMENTAL', string>>
export declare const MECHANISM_REFERENCE_BASES: readonly string[]
export declare const MECHANISM_REFERENCE_BASIS_LABELS: Readonly<Record<'MIDLONG_MONTHLY_AVG' | 'RT_NODAL_MONTHLY_AVG', string>>
export declare const MECHANISM_PRICE_UNIT: 'CNY_PER_MWH'

export declare const SIMULATION_SHAPES: readonly string[]
export declare type SimulationShape = 'FLAT' | 'RECENT_ACTUAL_PROFILE' | 'CONTRACT_CURVE'
export declare const SIMULATION_SHAPE_LABELS: Readonly<Record<SimulationShape, string>>
export declare const SIMULATION_PROFILE_DEFAULT_DAYS: number
export declare const SIMULATION_PROFILE_MAX_DAYS: number
export declare const SIMULATION_ASSUMPTION_LABEL: string

/** POST /simulate 请求中的形状：权重一律由服务端计算，客户端传入的 weights 被忽略。 */
export interface HedgeSimulationShapeRequest {
  kind: SimulationShape
  /** RECENT_ACTUAL_PROFILE：场站（缺省为查询 stationId，再缺省为范围内全部场站之和）。 */
  stationId?: number
  /** RECENT_ACTUAL_PROFILE：回看整日数（1—60，缺省 14）。 */
  days?: number
  /** CONTRACT_CURVE：合同。 */
  contractId?: number
}

/** POST /simulate 响应 shapes[]：每条调整实际用到的形状（标「假设」）。 */
export interface HedgeSimulationShapeInfo {
  index: number
  kind: SimulationShape
  label?: string
  assumption?: string
  stationId?: number | null
  stationIds?: number[]
  days?: number
  profileFrom?: string
  contractId?: number
  revisionNo?: number | null
  note?: string
  weightedIntervalCount: number
  skippedIntervalCount: number
  /** 缺权重、未分摊的时段开始时刻（最多 96 个）。 */
  skippedStarts: string[]
}

export declare const HEDGE_ERROR_CODES: readonly string[]
export declare type HedgeErrorCode =
  | 'UNSUPPORTED_REGION' | 'VALIDATION_FAILED' | 'ASOF_IN_FUTURE' | 'MECHANISM_RATIO_INCREASE_NEEDS_NOTE'
  | 'BAND_TIER_INVALID' | 'BACKDATING_NOT_ALLOWED' | 'SIMULATION_EXCEEDS_LOCKED' | 'VERSION_CONFLICT'
  | 'FORBIDDEN' | 'HEDGE_CONSISTENCY_FAILED'
export declare const HEDGE_ERROR_STATUS: Readonly<Record<HedgeErrorCode, number>>
export declare const HEDGE_ERROR_LABELS: Readonly<Record<HedgeErrorCode, string>>

export declare const HEDGE_META_KEYS: readonly string[]
export declare const HEDGE_GAP_KEYS: readonly string[]
export declare const HEDGE_IDEMPOTENCY_HEADER: 'Idempotency-Key'

export declare const SCHEME_BASES: readonly string[]
export declare const BAND_LIMIT_LOW: '0'
export declare const BAND_LIMIT_HIGH: '2'
