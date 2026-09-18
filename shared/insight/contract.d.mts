// 市场洞察共享契约类型（#2993）。运行时值与校验来自 contract.mjs。

export declare const INSIGHT_SCHEMA_VERSION: 'insight/v1'
export declare const INSIGHT_TIME_ZONE: 'Asia/Shanghai'
export declare const MAX_WINDOW_DAYS: number
export declare function compareText(a: string, b: string): number
export declare const MAX_OBJECT_REFS: number
export declare const PAGE_SIZE_DEFAULT: number
export declare const PAGE_SIZE_MAX: number

export type InsightErrorKind = { status: 400 | 403 | 404 | 409 | 422 | 503; code: string }
export declare const INSIGHT_ERRORS: Readonly<{
  BAD_REQUEST: InsightErrorKind
  UNKNOWN_FIELD: InsightErrorKind
  FORBIDDEN_FIELD: InsightErrorKind
  LIMIT_EXCEEDED: InsightErrorKind
  UNPROCESSABLE: InsightErrorKind
  FORBIDDEN: InsightErrorKind
  NOT_REGISTERED: InsightErrorKind
  VERSION_CONFLICT: InsightErrorKind
  UNAVAILABLE: InsightErrorKind
}>
export declare class InsightContractError extends Error {
  constructor(kind: InsightErrorKind, message: string, details?: Record<string, unknown>)
  status: number
  code: string
  details?: Record<string, unknown>
}

export type AccessState = 'granted' | 'denied'
export type AvailabilityState = 'complete' | 'partial' | 'empty' | 'failed'
export type AvailabilityReason =
  | 'not-enabled' | 'not-applicable' | 'not-onboarded' | 'not-published' | 'beyond-coverage'
  | 'partial-missing' | 'quality-rejected' | 'source-disabled' | 'upstream-failure'
export type FreshnessState = 'fresh' | 'stale' | 'unknown'
export type ResultBasis = 'captured' | 'real' | 'provisional' | 'empty'
export type Derivation = 'source' | 'aligned' | 'aggregated' | 'derived'
export type ComparabilityStatus = 'compatible' | 'incompatible' | 'insufficient'
export type AnalysisMode = 'ex-post' | 'ex-ante'
export type MarketPhase = 'day-ahead' | 'real-time'
export type PriceObject = 'user-price' | 'public-node' | 'company-node' | 'plant-node' | 'settlement-price'

export declare const ACCESS_STATES: readonly AccessState[]
export declare const AVAILABILITY_STATES: readonly AvailabilityState[]
export declare const AVAILABILITY_REASONS: readonly AvailabilityReason[]
export declare const FRESHNESS_STATES: readonly FreshnessState[]
export declare const RESULT_BASIS: readonly ResultBasis[]
export declare const DERIVATIONS: readonly Derivation[]
export declare const COMPARABILITY_STATES: readonly ComparabilityStatus[]
export declare const ANALYSIS_MODES: readonly AnalysisMode[]
export declare const MARKET_PHASES: readonly MarketPhase[]
export declare const PRICE_OBJECTS: readonly PriceObject[]

export type ObjectRef = { type: string; id: string; effectiveAt?: string }
export type BusinessWindow = { start: string; end: string; timeZone: 'Asia/Shanghai'; days: number }
export type InsightContext = {
  regionId: string
  companyId: string | null
  subjectId: string | null
  objectRefs: readonly ObjectRef[]
  businessWindow: BusinessWindow
  marketPhase: MarketPhase | null
  priceObject: PriceObject | null
  sourceIds: readonly string[]
  mode: AnalysisMode
  asOf: string | null
  contextVersion: number
}
export type InsightContextInput = {
  regionId: string
  companyId?: string | null
  subjectId?: string | null
  objectRefs?: ObjectRef[]
  businessWindow: { start: string; end: string; timeZone?: 'Asia/Shanghai' }
  marketPhase?: MarketPhase | null
  priceObject?: PriceObject | null
  sourceIds?: string[]
  mode?: AnalysisMode
  asOf?: string | null
  contextVersion?: number
}
export type ExpectedResult = { resultVersion: string; readSetRef: string }
export type PageRequest = { size: number; cursor: string | null }
export type InsightQueryInput = {
  analysisId: string
  context: InsightContextInput
  filters?: Record<string, unknown>
  page?: { size?: number; cursor?: string | null }
  expected?: ExpectedResult | null
}

export type ComparabilityReason = { code: string; detail: string }
export type RuntimeStatus = {
  access: AccessState
  availability: { state: AvailabilityState; reason?: AvailabilityReason | null; detail?: string }
  freshness: { state: FreshnessState; cadence?: string; evidence?: string | null }
  comparability: { status: ComparabilityStatus; reasons: ComparabilityReason[] }
}
export type SourceRef = { sourceId: string; accessScope: 'public' | 'company'; versionToken?: string | null; channel?: string }
export type ResultPage =
  | { scope: 'all'; totalRows: number }
  | { scope: 'page'; size: number; offset: number; returnedRows: number; totalRows: number; nextCursor: string | null }

export type InsightResult<TData = unknown> = {
  schemaVersion: string
  queryId: string
  contextVersion: number
  analysisId: string
  analysisVersion: string
  resolvedScope: Record<string, unknown>
  businessWindow: BusinessWindow | { start: string; end: string }
  mode: AnalysisMode
  asOf?: string | null
  runtime: RuntimeStatus
  basis?: ResultBasis
  derivation?: Derivation
  sourceRefs?: SourceRef[]
  coverage?: Record<string, unknown>
  quality?: Record<string, unknown>
  data?: TData
  /** 分页范围（#2994）：不带 page 请求时为全量；带 page 时只切明细行，统计与版本仍按全量 */
  page?: ResultPage
  drilldowns?: unknown[]
  resultVersion?: string
  readSetRef?: string
  generatedAt: string
  expiresAt?: string | null
  mock: false
  productionWrite: false
}

export declare function calendarDayMs(value: string): number
export declare function parseBusinessWindow(value: unknown): BusinessWindow
export declare function parseInsightContext(input: unknown): InsightContext
export declare function parseExpectedResult(value: unknown): ExpectedResult | null
export declare function isResultVersion(value: unknown): value is string
export declare function isReadSetRef(value: unknown): value is string
export declare function parsePage(value: unknown): PageRequest
export declare function parseQueryRequest<TAnalysis extends { filters?: Record<string, (value: unknown) => unknown> }>(
  body: unknown,
  catalog: { getAnalysis: (id: string) => TAnalysis | null },
): { analysisId: string; analysis: TAnalysis; context: InsightContext; filters: Record<string, unknown>; page: PageRequest; expected: ExpectedResult | null }
export declare function assertRuntimeStatus(runtime: unknown): RuntimeStatus
export declare function assertInsightResult<T = unknown>(result: unknown): InsightResult<T>
