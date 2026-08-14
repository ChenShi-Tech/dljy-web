// Generated from schemas/*.schema.json. Do not edit.

export type DatasetBasis = "captured" | "synthetic" | "forecast" | "user_saved" | "imported" | "derived" | "reference"
export type Basis = DatasetBasis
export type ProvenanceBasis = "real" | "captured" | "illustrative" | "synthetic" | "forecast" | "user_saved" | "imported" | "derived" | "reference"
export type SourceType = "REAL" | "CAPTURE" | "DB" | "IMPORT" | "MOCK" | "MIXED" | "OFFICIAL_API" | "CSG_DISCLOSURE" | "CONFIG" | "DEMO"
export type BusinessLine = "market-trading" | "decision-assets" | "retail-settlement" | "data-platform" | "core-platform" | "market-intelligence" | "spot-trading" | "forward-trading" | "decision-products" | "asset-grid"
export type ModuleKind = "real" | "mixed" | "forecast"
export type ModuleConstraint = "tenant" | "region" | "company" | "station" | "customer"
export type DomainEventType = "ForecastPublished" | "DeclarationSubmitted" | "TradeExecuted" | "SettlementCalculated" | "ContractChanged" | "AssetChanged" | "DatasetPublished" | "contract-updated" | "statement-issued" | "assessment-published"
export type ModuleDependencyKind = "contract" | "platform-sdk" | "platform-capability" | "core-capability"
export type LicenseClassification = "public" | "internal" | "restricted" | "licensed"
export type SpotDeclarationBasis = "real" | "captured" | "illustrative" | "synthetic"
export type DeclarationStatus = "DRAFT" | "RISK_CHECKED" | "PENDING_APPROVAL" | "APPROVED" | "SUBMITTED" | "ACKNOWLEDGED" | "CLEARED" | "DEVIATION_TRACKING" | "SETTLED" | "REVIEWED" | "REJECTED" | "EXPIRED"

export type RetailContractStatus = "draft" | "active" | "terminated"
export type WholesaleContractStatus = "draft" | "active" | "settled" | "terminated"
export type WholesaleSubjectType = "GENERATOR" | "RETAILER" | "AGGREGATOR" | "TRADER"
export type WholesaleMarketType = "annual_bilateral" | "annual_centralized" | "monthly_bilateral" | "monthly_centralized" | "intraday_matching" | "day_ahead" | "real_time" | "provincial_green_annual" | "provincial_green_monthly" | "cross_provincial_green_annual" | "cross_provincial_green_monthly"
export type WholesaleExecutionRelationType = "position_hold" | "trade_execution" | "none"
export type SettlementAmountStatus = "estimated" | "settled"
export type RetailSettlementEventType = "contract-updated" | "statement-issued" | "assessment-published"

export interface Provenance { basis: ProvenanceBasis; sourceType: SourceType; mock: boolean; productionWrite: boolean }
export interface ApiEnvelope<TData = unknown, TRow = TData> { code: number; msg: string; message?: string; data?: TData; rows?: TRow[]; total?: number; traceId: string; provenance?: Provenance }
export interface SpotDeclarationCreatePayload { targetDate: string; capacityMw: number; energyCurveMwh96?: number[]; priceCurve96?: number[] | null; subjectType?: string; strategySource?: string; basis?: SpotDeclarationBasis; note?: string | null }
export interface SpotDeclarationRiskCheck { checks: Record<string, unknown>[]; passed: boolean; gateLevel: "L2" | "L3"; totalMwh: number; maxMw: number; evaluatedAt: string; inputs?: Record<string, unknown> }
export interface SpotDeclarationOrder { id: string; targetDate: string; status: DeclarationStatus; deadline?: string; companyId?: string; region?: string | null; subjectId?: string | null; subjectType?: string | null; capacityMw?: number; energyCurveMwh96?: number[]; priceCurve96?: number[] | null; strategySource?: string; basis?: SpotDeclarationBasis; note?: string | null; riskCheck?: SpotDeclarationRiskCheck | null; approvalRecord?: Record<string, unknown>[]; receipt?: Record<string, unknown> | null; clearing?: Record<string, unknown> | null; createdBy?: string; createdAt?: string; updatedAt?: string; audit?: Record<string, unknown>[] }
export interface SpotDeclarationEnvelope extends ApiEnvelope<SpotDeclarationOrder> { data: SpotDeclarationOrder }
export interface ModuleNavigation { title: string; group: string | null; listed: boolean }
export interface ModuleRoute { id: string; path: string; component: string; module: string; kind: ModuleKind; endpoint: string | null; navigation: ModuleNavigation; requiredScopes: string[]; regions: string[]; constraints: ModuleConstraint[]; featureFlags: string[] }
export interface ModuleRegionPolicy { mode: 'global' | 'allowlist'; regions: string[] }
export interface ModuleDependency { kind: ModuleDependencyKind; name: string; version: string }
export interface ModuleContract { name: string; version: string }
export interface BusinessModuleManifest { schemaVersion: 1; id: string; version: string; businessLine: BusinessLine; module: string; routes: ModuleRoute[]; apiPrefixes: string[]; requiredScopes: string[]; constraints: ModuleConstraint[]; regionPolicy: ModuleRegionPolicy; featureFlags: string[]; contracts: ModuleContract[]; coreCapabilities: string[]; dependencies: ModuleDependency[] }
export interface DatasetLicensing { classification: LicenseClassification; redistributable: boolean; termsRef?: string }
export interface DatasetManifest { schemaVersion: string; datasetId: string; region: string; companyScope: string[]; basis: DatasetBasis; sourceType: SourceType; asOf: string; capturedAt: string; sha256: string; licensing: DatasetLicensing }
export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> { eventId: string; type: DomainEventType; version: number; occurredAt: string; traceId: string; companyId: string; regionId: string; payload: TPayload }
export interface RetailContractQuantity { value: number; unit: 'kWh' | 'MWh' }
export interface RetailContractPrice { value: number; unit: 'CNY/kWh' | 'CNY/MWh' }
export interface SettlementRelationRef { relationId: string; relationType: 'retail_supply_settlement' | 'retail_purchase_sale' }
export interface RetailContractAudit { createdAt: string; updatedAt: string; createdBy?: string; updatedBy?: string; traceId?: string }
export interface RetailContract { contractId: string; contractType: 'retail-customer-supply-contract'; ownerDomain: 'retail-settlement'; companyId: string; customerId: string; regionId: string; productType: string; basisVersion: string; quantity: RetailContractQuantity; price: RetailContractPrice; settlementRelationRef: SettlementRelationRef; status: RetailContractStatus; audit: RetailContractAudit }
export interface WholesaleContractQuantity { value: number; unit: 'kWh' | 'MWh' }
export interface WholesaleContractPrice { value: number; unit: 'CNY/kWh' | 'CNY/MWh' }
export interface WholesaleExecutionRef { relationType: WholesaleExecutionRelationType; positionId?: string; tradeCode?: string }
export interface WholesaleContractAudit { createdAt: string; updatedAt: string; createdBy?: string; updatedBy?: string; traceId?: string }
export interface WholesaleContract { contractId: string; contractType: 'wholesale-long-term-trading-contract'; ownerDomain: 'market-trading'; companyId: string; regionId: string; subjectId: string; subjectType: WholesaleSubjectType; marketType: WholesaleMarketType; basisVersion: string; quantity: WholesaleContractQuantity; price: WholesaleContractPrice; executionRef: WholesaleExecutionRef; status: WholesaleContractStatus; audit: WholesaleContractAudit }
export interface SettlementAmount { value: number; status: SettlementAmountStatus }
export interface SettlementAmounts { currency: 'CNY'; retailRevenue: SettlementAmount; wholesaleCost: SettlementAmount; deviationCost: SettlementAmount; serviceFee: SettlementAmount; netIncome: SettlementAmount }
export interface DeviationAssessment { assessmentId: string; status: SettlementAmountStatus; deviationVolume: number; deviationRate: number; amount: SettlementAmount }
export interface SettlementStatement { statementId: string; period: string; companyId: string; regionId: string; basisVersion: string; amounts: SettlementAmounts; deviationAssessment: DeviationAssessment; mock: boolean; sourceType: SourceType; productionWrite: boolean; fallback: boolean; auditRef: string }
export interface RetailSettlementEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> extends DomainEvent<TPayload> { type: RetailSettlementEventType }

export type QuantDecisionType = "kelly" | "milp" | "cvar"
export type SettlementComputationMode = "full_spot" | "contract_plus_deviation"
export type ElasticitySegmentLabel = "steep" | "flat"
export type ElasticityMarket = "da" | "rt"
export interface KellyDecisionInput { winProb: number; winPayoff: number; losePayoff: number }
export interface KellyDecisionResult { fraction: number; expectedValue: number; variance: number; sharpeRatio: number; cvar95: number; isSafe: boolean }
export interface MilpDecisionInput { prices: number[]; loads?: number[] | null; batteryCapacityMwh?: number; maxPowerMw?: number }
export interface MilpScheduleSlot { index: number; soc: number; charge: number; discharge: number }
export interface MilpDecisionResult { isFeasible: boolean; objectiveValue: number; totalRevenueYuan: number; totalChargeCostYuan: number; totalDegradationCostYuan: number; optimizationTimeMs: number; schedule: MilpScheduleSlot[] }
export interface CvarDecisionInput { returns: number[] }
export interface CvarDecisionResult { var95: number; var99: number; cvar95: number; cvar99: number; maxDrawdown: number; volatility: number; sharpeRatio: number; sortinoRatio: number; tailRisk: number }
export interface QuantDecisionEnvelope { decisionId: string; decisionType: QuantDecisionType; companyId?: string | null; regionId: string | null; basisVersion: string; input: KellyDecisionInput | MilpDecisionInput | CvarDecisionInput; result: KellyDecisionResult | MilpDecisionResult | CvarDecisionResult; generatedAt: string; provenance: Provenance }
export interface ElasticitySegment { seg: number; xLo: number; xHi: number; yLo: number; yHi: number; n: number; label: ElasticitySegmentLabel }
export interface SpotElasticityResult { date: string; market: ElasticityMarket; regionId: string | null; available: boolean; basisVersion: string; provenance: Provenance; reason?: string | null; kind?: string; segments?: ElasticitySegment[]; bidSpace?: (number | null)[]; actualPrice?: (number | null)[]; predictedPrice?: (number | null)[]; classification?: string[]; maeModel?: number | null; maeNaive?: number | null; maeImprovementPct?: number | null; predictionMethod?: string; steepSharePct?: number | null; trainDays?: number | null; trainPoints?: number | null; externalSendIncluded?: boolean; notes?: string[] }
export interface SettlementGenerationPoint { hour: number; actualGenerationMwh: number; forecastGenerationMwh?: number }
export interface SettlementContractInput { contractId: string; quantityMwh: number; priceYuanPerMwh: number; contractType?: string }
export interface SettlementSpotPricePoint { hour: number; priceYuanPerMwh: number; nodeId?: string }
export interface SettlementComputationInput { generationData: SettlementGenerationPoint[]; contracts?: SettlementContractInput[]; spotPrices: SettlementSpotPricePoint[] }
export interface SettlementComputationTotals { currency: 'CNY'; totalRevenueYuan: number; contractRevenueYuan: number; spotRevenueYuan: number; deviationRevenueYuan: number; penaltyCostYuan: number; netIncomeYuan: number }
export interface SettlementComputationDetail { hour: number; actualGenerationMwh: number; contractQuantityMwh: number; deviationMwh: number; spotPriceYuanPerMwh: number; spotRevenueYuan: number; contractRevenueYuan: number; penaltyCostYuan: number; netHourlyYuan: number }
export interface SettlementStatementRef { statementId: string; period: string }
export interface SettlementComputationResult { computationId: string; mode: SettlementComputationMode; companyId: string; regionId: string; targetDate: string; basisVersion: string; totals: SettlementComputationTotals; details: SettlementComputationDetail[]; summary?: string; input?: SettlementComputationInput; statementRef?: SettlementStatementRef; mock: boolean; sourceType: SourceType; productionWrite: boolean; fallback: boolean; auditRef: string }

export type ModelStage = "staging" | "production"
export type ModelQualitySourceRun = "full" | "lag_only"
export type ModelConfigKind = "training" | "llm"
export interface ModelShadowGate { passed: boolean; report?: string | null; checkedAt?: string | null }
export interface ModelCapabilities { supportsQuantiles: boolean; supportsCovariates: boolean; supportsMultivariate: boolean; horizon: number; zeroShot?: boolean }
export interface ModelQuality { passesSkillGate: boolean; skillVsLear?: number | null; skillVsSeasonalNaive?: number | null; sourceRun: ModelQualitySourceRun }
export interface ModelVersionMetrics { rmse?: number | null; mae?: number | null; r2?: number | null }
export interface ModelVersionInfo { stationId?: number | null; modelType?: string; metrics?: ModelVersionMetrics | null; trainSamples?: number | null; isActive: boolean; isDefault: boolean; description?: string | null; createdAt?: string; trainedAt?: string | null }
export interface ModelRegistryEntry { modelId: string; name?: string; target: string; regionId: string | null; namespace?: string; tier?: string; available: boolean; unavailableReason?: string | null; stage?: ModelStage; shadowGate?: ModelShadowGate; capabilities?: ModelCapabilities; quality?: ModelQuality; version?: ModelVersionInfo; supportedTargets?: string[]; basisVersion: string; provenance: Provenance }
export interface ModelConfigDescriptor { configName: string; kind: ModelConfigKind; provider?: string | null; defaultModel?: string | null; description?: string | null; isActive: boolean; createdAt?: string; updatedAt?: string | null; basisVersion: string; provenance: Provenance }

export type ForecastPredictionOperation = "predict" | "ultraShort" | "midterm" | "stationGeneration"
export type ForecastTarget = "price" | "load" | "generation"
export type ForecastHorizon = "dayAhead" | "ultraShort" | "midterm"
export type ForecastRiskOperation = "riskQuantify" | "deviationRisk"
export type ForecastBidDecisionOperation = "bidAdvice" | "optimizeBid" | "cockpit"
export type ForecastRiskPreference = "profitFocused" | "balanced" | "riskAverse"
export type ForecastValueUnit = "CNY/MWh" | "MW" | "MWh"
export interface DecisionSupportProvenance extends Provenance { productionWrite: false }
export interface ForecastPredictionRequest { operation: ForecastPredictionOperation; companyId: string; regionId: string; stationId?: string | null; modelId?: string | null; target: ForecastTarget; horizon: ForecastHorizon; startAt: string; intervalMinutes: number; periods: number; quantiles: number[] }
export interface ForecastQuantileValue { quantile: number; value: number }
export interface ForecastPredictionPoint { timestamp: string; value: number; quantiles: ForecastQuantileValue[] }
export interface ForecastPredictionResultBase { operation: ForecastPredictionOperation; companyId: string; regionId: string; stationId?: string | null; modelId?: string | null; target: ForecastTarget; horizon: ForecastHorizon; basisVersion: string; generatedAt: string; intervalMinutes: number; unit: ForecastValueUnit; leakageCaveats: string[] }
export interface AvailableForecastPredictionResult extends ForecastPredictionResultBase { available: true; unavailableReason?: never; points: [ForecastPredictionPoint, ...ForecastPredictionPoint[]] }
export interface UnavailableForecastPredictionResult extends ForecastPredictionResultBase { available: false; unavailableReason: string; points?: never }
export type ForecastPredictionResult = AvailableForecastPredictionResult | UnavailableForecastPredictionResult
export interface ForecastPredictionEnvelope extends ApiEnvelope<ForecastPredictionResult> { data: ForecastPredictionResult; provenance: DecisionSupportProvenance }
export interface ForecastBacktestRequest { companyId: string; regionId: string; stationId?: string | null; modelId?: string | null; target: ForecastTarget; horizon: ForecastHorizon; startDate: string; endDate: string }
export interface ForecastBacktestMetrics { sampleCount: number; mae: number; rmse: number; bias: number; mapePct?: number | null; quantileCoveragePct?: number | null }
export interface ForecastDailyBacktestResult { date: string; metrics: ForecastBacktestMetrics }
export interface ForecastBacktestResultBase { companyId: string; regionId: string; stationId?: string | null; modelId?: string | null; target: ForecastTarget; horizon: ForecastHorizon; basisVersion: string; generatedAt: string; evaluationMode: "walkForward"; outOfSample: true; cutoffPolicy: "strictPastOnly"; leakageCaveats: string[] }
export interface AvailableForecastBacktestResult extends ForecastBacktestResultBase { available: true; unavailableReason?: never; dailyResults: [ForecastDailyBacktestResult, ...ForecastDailyBacktestResult[]]; aggregateMetrics: ForecastBacktestMetrics }
export interface UnavailableForecastBacktestResult extends ForecastBacktestResultBase { available: false; unavailableReason: string; dailyResults?: never; aggregateMetrics?: never }
export type ForecastBacktestResult = AvailableForecastBacktestResult | UnavailableForecastBacktestResult
export interface ForecastBacktestEnvelope extends ApiEnvelope<ForecastBacktestResult> { data: ForecastBacktestResult; provenance: DecisionSupportProvenance }
export interface ForecastRiskRequest { operation: ForecastRiskOperation; companyId: string; regionId: string; targetDate: string; forecastRef: string; declarationRef?: string | null; settlementBasisRef?: string | null }
export type ForecastRiskLevel = "low" | "medium" | "high"
export type ForecastRiskBandLabel = "severeLoss" | "loss" | "neutral" | "profit" | "highProfit"
export interface ForecastRiskBand { label: ForecastRiskBandLabel; probability: number; profitYuan: number }
export interface ForecastRiskResultBase { operation: ForecastRiskOperation; companyId: string; regionId: string; targetDate: string; basisVersion: string; generatedAt: string; currency: "CNY"; leakageCaveats: string[] }
export interface AvailableForecastRiskResult extends ForecastRiskResultBase { available: true; unavailableReason?: never; riskLevel: ForecastRiskLevel; expectedProfitYuan?: number | null; var95Yuan?: number | null; cvar95Yuan?: number | null; lossProbability?: number | null; expectedDeviationMwh?: number | null; assessmentRiskYuan?: number | null; riskBands?: ForecastRiskBand[] }
export interface UnavailableForecastRiskResult extends ForecastRiskResultBase { available: false; unavailableReason: string; riskLevel?: never; expectedProfitYuan?: never; var95Yuan?: never; cvar95Yuan?: never; lossProbability?: never; expectedDeviationMwh?: never; assessmentRiskYuan?: never; riskBands?: never }
export type ForecastRiskResult = AvailableForecastRiskResult | UnavailableForecastRiskResult
export interface ForecastRiskEnvelope extends ApiEnvelope<ForecastRiskResult> { data: ForecastRiskResult; provenance: DecisionSupportProvenance }
export interface ForecastBidDecisionRequest { operation: ForecastBidDecisionOperation; companyId: string; regionId: string; targetDate: string; availableCapacityMw: number; forecastRef: string; riskRef?: string | null; riskPreference: ForecastRiskPreference }
export interface ForecastBidPredictionBandPoint { timestamp: string; lower: number; median: number; upper: number; unit: ForecastValueUnit }
export interface ForecastBidCurvePoint { periodIndex: number; quantityMwh: number; priceYuanPerMwh: number }
export interface ForecastBidFrontierPoint { riskPreference: ForecastRiskPreference; expectedProfitYuan: number; cvar95Yuan: number; selected: boolean; bidCurve: ForecastBidCurvePoint[] }
export interface ForecastBidDecisionResultBase { operation: ForecastBidDecisionOperation; companyId: string; regionId: string; targetDate: string; basisVersion: string; generatedAt: string; riskPreference: ForecastRiskPreference; leakageCaveats: string[] }
export interface ForecastBidDecisionOutputFields { summary?: string; predictionBands?: [ForecastBidPredictionBandPoint, ...ForecastBidPredictionBandPoint[]]; bidCurve?: [ForecastBidCurvePoint, ...ForecastBidCurvePoint[]]; frontier?: [ForecastBidFrontierPoint, ...ForecastBidFrontierPoint[]] }
export type AvailableForecastBidDecisionResult = ForecastBidDecisionResultBase & ForecastBidDecisionOutputFields & { available: true; unavailableReason?: never } & ({ summary: string } | { predictionBands: [ForecastBidPredictionBandPoint, ...ForecastBidPredictionBandPoint[]] } | { bidCurve: [ForecastBidCurvePoint, ...ForecastBidCurvePoint[]] } | { frontier: [ForecastBidFrontierPoint, ...ForecastBidFrontierPoint[]] })
export interface UnavailableForecastBidDecisionResult extends ForecastBidDecisionResultBase { available: false; unavailableReason: string; summary?: never; predictionBands?: never; bidCurve?: never; frontier?: never }
export type ForecastBidDecisionResult = AvailableForecastBidDecisionResult | UnavailableForecastBidDecisionResult
export interface ForecastBidDecisionEnvelope extends ApiEnvelope<ForecastBidDecisionResult> { data: ForecastBidDecisionResult; provenance: DecisionSupportProvenance }

export declare const MODEL_STAGES: readonly ModelStage[]
export declare const MODEL_CONFIG_KINDS: readonly ModelConfigKind[]
export declare const QUANT_DECISION_TYPES: readonly QuantDecisionType[]
export declare const SETTLEMENT_COMPUTATION_MODES: readonly SettlementComputationMode[]
export declare const FORECAST_PREDICTION_OPERATIONS: readonly ForecastPredictionOperation[]
export declare const FORECAST_RISK_OPERATIONS: readonly ForecastRiskOperation[]
export declare const FORECAST_BID_DECISION_OPERATIONS: readonly ForecastBidDecisionOperation[]
export declare const BUSINESS_LINES: readonly BusinessLine[]
export declare const DOMAIN_EVENT_TYPES: readonly DomainEventType[]
export declare const SOURCE_TYPES: readonly SourceType[]
export declare const DECLARATION_STATUSES: readonly DeclarationStatus[]
export declare const RETAIL_SETTLEMENT_EVENT_TYPES: readonly RetailSettlementEventType[]
export declare const DECLARATION_TRANSITIONS: Readonly<Record<DeclarationStatus, readonly DeclarationStatus[]>>

// ---- 前端平台注入面（PlatformSdk） ----
export interface PlatformHttpQuery { [key: string]: string | number | boolean | null | undefined }
export interface PlatformHttpOptions { signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> }
export interface PlatformHttp {
  get<T = unknown>(path: string, query?: PlatformHttpQuery, options?: PlatformHttpOptions): Promise<T & ApiEnvelope<T>>
  post<T = unknown>(path: string, body: unknown, options?: PlatformHttpOptions): Promise<T & ApiEnvelope<T>>
  put<T = unknown>(path: string, body: unknown, options?: PlatformHttpOptions): Promise<T & ApiEnvelope<T>>
  patch<T = unknown>(path: string, body: unknown, options?: PlatformHttpOptions): Promise<T & ApiEnvelope<T>>
  delete<T = unknown>(path: string, options?: PlatformHttpOptions): Promise<T & ApiEnvelope<T>>
}
export interface PlatformAuthUser { userId: string; displayName: string; roleCode: string; companyId: string; subjectId: string; subjectType: string; regionId: string; dataScopeOrgIds: string[] }
export interface PlatformAuth { currentUser(): PlatformAuthUser; token(): string | null }
export interface PlatformRegion { id: string; name: string }
export interface PlatformRegionContext { current(): PlatformRegion }
export interface PlatformCompany { id: string; name: string }
export interface PlatformCompanyContext { current(): PlatformCompany; selectedId(): string }
export interface PlatformScopeContext { companyId: string; regionId: string; subjectId: string; scopeIds: string[] }
export interface PlatformGovernance { canAccessPath(path: string): boolean; hasAction(action: string): boolean; requireScopeContext(): PlatformScopeContext }
export interface PlatformTheme { mode(): 'light' | 'dark' }
export interface PlatformRouteRegistration { path: string; name: string; component: unknown; meta?: Record<string, unknown>; props?: Record<string, unknown> }
export interface PlatformRouter { register(route: PlatformRouteRegistration): void }
export interface PlatformSdk { http: PlatformHttp; auth: PlatformAuth; region: PlatformRegionContext; company: PlatformCompanyContext; governance: PlatformGovernance; theme: PlatformTheme; router: PlatformRouter }
export interface PlatformModule { id: string; businessLine: BusinessLine; install(sdk: PlatformSdk): void }
export type PlatformModuleFactory = (sdk: PlatformSdk) => PlatformModule

// ---- Node 路由分片面（RouteSlice） ----
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type RouteSliceLine = BusinessLine | 'platform' | 'contracts'
export interface NodePlatformLogger { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
export interface NodeCapabilityRequest { operation: string; authorization: unknown; input?: unknown }
export interface NodeScopedCapability { invoke(request: NodeCapabilityRequest): unknown }
export interface NodePlatformCapabilities { analysis?: NodeScopedCapability; gridGeo?: NodeScopedCapability }
export interface NodePlatformContext { captureContext: unknown; /** @deprecated 新业务 handler 必须改用 capabilities 中的 scope 内建端口。 */ stores: Record<string, unknown>; middleware: Record<string, unknown>; capabilities?: NodePlatformCapabilities; logger: NodePlatformLogger; config: (key: string) => unknown }
export interface RouteEntry { method: RouteMethod; path: string; handler: unknown }
export interface RouteSlice { businessLine: RouteSliceLine; prefixes: string[]; routes: RouteEntry[] }
export type RouteSliceFactory = (ctx: NodePlatformContext) => RouteSlice

// ---- 数据分析图表契约（AnalysisChartSpec，#18/#32） ----
export type AnalysisChartType = "line" | "bar" | "dual_axis" | "scatter" | "pie" | "table" | "kpi" | "price_heatmap" | "duration_curve" | "spread_distribution" | "deviation_band" | "correlation_matrix"
export type AnalysisSeriesType = "line" | "bar" | "scatter" | "area"
export type AnalysisAxisSide = "left" | "right"
export type AnalysisAxisKind = "category" | "time" | "value"
export type AnalysisChartBasis = "real" | "captured" | "derived" | "synthetic" | "illustrative"
export type AnalysisDashboardLayout = "grid" | "stack"
export interface AnalysisChartSeries { name: string; key: string; seriesType?: AnalysisSeriesType; axis?: AnalysisAxisSide; unit?: string | null }
export interface AnalysisAxisSpec { kind: AnalysisAxisKind; label?: string | null; field?: string | null; unit?: string | null }
export interface AnalysisChartAxes { x?: AnalysisAxisSpec; yLeft?: AnalysisAxisSpec; yRight?: AnalysisAxisSpec }
export interface AnalysisChartSpec { chartType: AnalysisChartType; title: string; description?: string | null; series?: AnalysisChartSeries[]; axes?: AnalysisChartAxes; dataRef?: string | null; inlineData?: Record<string, unknown>[] | null; sql?: string | null; basis?: AnalysisChartBasis; params?: Record<string, unknown> }
export interface AnalysisDashboard { title: string; question?: string | null; layout?: AnalysisDashboardLayout; charts: AnalysisChartSpec[]; plan?: Record<string, unknown> | null }
export declare const ANALYSIS_CHART_TYPES: readonly AnalysisChartType[]

// ---- 命名分析视图契约（AnalysisView，#18 P3） ----
export type AnalysisViewConfigKind = "page-state" | "chart" | "dashboard"
export interface AnalysisViewPageStateConfig { kind: "page-state"; selected: string[]; currentDate: string; viewMonth: string; fixedAxis: boolean; hideAxis: boolean; activeGroups: string[]; company: string }
export interface AnalysisViewChartConfig { kind: "chart"; spec: AnalysisChartSpec; sql?: string | null; question?: string | null; savedAt?: string }
export interface AnalysisViewDashboardConfig { kind: "dashboard"; dashboard: AnalysisDashboard; sql?: string | null; question?: string | null; savedAt?: string }
export type AnalysisViewConfig = AnalysisViewPageStateConfig | AnalysisViewChartConfig | AnalysisViewDashboardConfig
export interface AnalysisView { viewId: string; ownerUsername: string; companyId: string; region: string | null; routePath: string; name: string; config: AnalysisViewConfig; createdAt: string; updatedAt: string; basis?: ProvenanceBasis; sourceType?: SourceType; mock?: boolean; productionWrite?: boolean }
export declare const ANALYSIS_VIEW_CONFIG_KINDS: readonly AnalysisViewConfigKind[]
