// shared/hedge/contract.mjs 的类型声明（前端 sync 副本使用；零运行时）。

export declare const HEDGE_API_PREFIX: string
export declare const HEDGE_REGIONS: readonly string[]

export declare const LEG_KEYS: readonly string[]
export declare type LegKey =
  | 'LEDGER' | 'LABELS' | 'MECHANISM' | 'ACTUAL' | 'FORECAST_MODEL' | 'FORECAST_VENDOR' | 'PRICE' | 'BAND' | 'BASELINE' | 'CAPS'
export declare const LEG_STATUSES: readonly string[]
export declare type LegStatus = 'OK' | 'PARTIAL' | 'STALE' | 'FAILED' | 'FORBIDDEN' | 'UNSUPPORTED' | 'NOT_CONFIGURED'
export declare const STALE_ELIGIBLE_LEG_KEYS: readonly string[]

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
