// 云南中长期售电合同（P1）共享契约的类型侧伴随定义（#2938）。
// 运行时值来自 contract.mjs；接口 DTO 形状与 server/midlong/midlong-api.mjs 的响应一一对应。
// 金额、电量、价格一律是规范十进制字符串（不是 number），前端展示时再舍入。

export type DocumentKind = 'FRAMEWORK' | 'OBLIGATION'
export type ProductKind = 'ANNUAL' | 'MONTHLY' | 'INTRA_MONTH'
export type DeliveryCycle = 'YEAR' | 'MULTI_MONTH' | 'MONTH' | 'WITHIN_MONTH'
export type TradeMethod = 'BILATERAL' | 'CENTRALIZED_BIDDING' | 'LISTING' | 'CENTRALIZED_MATCHING'
export type MarketScope = 'PROVINCIAL' | 'INTER_PROVINCIAL'
export type EnergyAttribute = 'CONVENTIONAL' | 'GREEN'
export type ConfirmationStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'CONFIRMED' | 'VOIDED'
export type DeliveryProgress = 'NOT_STARTED' | 'IN_DELIVERY' | 'DELIVERY_ENDED' | 'UNKNOWN'
export type QualityFlag =
  | 'MISSING_SUBJECT' | 'SUBJECT_UNIT_CODE_MISSING' | 'STATION_UNALLOCATED' | 'MISSING_EVIDENCE' | 'MISSING_QUANTITY'
  | 'MISSING_DELIVERY_PERIOD' | 'MISSING_PRICE' | 'TAX_BASIS_UNKNOWN' | 'PRICE_COMPONENT_UNVERIFIED'
  | 'MISSING_MONTHLY_ALLOCATION' | 'PARTIAL_MONTHLY_ALLOCATION' | 'ESTIMATED_ALLOCATION_EXCLUDED' | 'LEGACY_BUYER_PRICE_ONLY'
export type PriceType = 'FIXED' | 'TIME_OF_USE'
export type PriceStatus = 'KNOWN' | 'UNKNOWN'
export type TaxBasis = 'TAX_INCLUDED' | 'TAX_EXCLUDED' | 'UNKNOWN'
export type PriceComponent = 'ENERGY_ONLY' | 'ENERGY_WITH_ENVIRONMENT' | 'UNVERIFIED'
export type EvidenceBasis = 'FORMAL' | 'INTERNAL_ESTIMATE'
export type AllocationCompleteness = 'COMPLETE' | 'PARTIAL' | 'NONE'
export type AllocationDerivation = 'SOURCE_ROW' | 'SINGLE_MONTH_TERMS'
export type EvidenceDocumentType =
  | 'ELECTRONIC_CONFIRMATION' | 'PAPER_CONTRACT' | 'TRADING_CENTER_EXPORT' | 'IMPORT_SOURCE_FILE' | 'SUPPLEMENT_SCAN' | 'OTHER'
export type RevisionKind = 'INITIAL' | 'BASELINE' | 'CORRECTION' | 'ADJUSTMENT' | 'TRANSFER' | 'PARTIAL_TERMINATION'
export type RevisionStatus = 'DRAFT' | 'CONFIRMED'
export type ContractOrigin = 'MANUAL' | 'IMPORT' | 'ONBOARDING'
export type ChangeType = 'CORRECTION'
export type EventType =
  | 'CREATED' | 'DRAFT_UPDATED' | 'IMPORTED' | 'ONBOARDED' | 'VERIFIED' | 'CORRECTED' | 'VOIDED' | 'EVIDENCE_ADDED' | 'ALIAS_LINKED' | 'ADJUSTED'
export type MidlongErrorCode =
  | 'VALIDATION_FAILED' | 'SCOPE_DENIED' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'PREVIEW_STALE' | 'BUSINESS_KEY_CONFLICT'
  | 'CONFIRMED_WRITE_PROTECTED' | 'MANAGED_BY_MIDLONG' | 'INCOMPLETE_BASIS' | 'UNSUPPORTED_PRODUCT' | 'UNSUPPORTED_REGION'
  | 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_KEY_REUSED' | 'EVIDENCE_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' | 'MODULE_DISABLED'
  | 'ADJUSTMENT_CHANNEL_REQUIRED' | 'ADJUSTABLE_BALANCE_EXCEEDED'

export declare const MIDLONG_API_PREFIX: '/api/v1/midlong'
export declare const MIDLONG_PILOT_REGIONS: readonly string[]
export declare const DOCUMENT_KINDS: readonly DocumentKind[]
export declare const PRODUCT_KINDS: readonly ProductKind[]
export declare const DELIVERY_CYCLES: readonly DeliveryCycle[]
export declare const TRADE_METHODS: readonly TradeMethod[]
export declare const MARKET_SCOPES: readonly MarketScope[]
export declare const ENERGY_ATTRIBUTES: readonly EnergyAttribute[]
export declare const TRADING_SIDES: readonly 'SELL'[]
export declare const CONFIRMATION_STATUSES: readonly ConfirmationStatus[]
export declare const DELIVERY_PROGRESS_VALUES: readonly DeliveryProgress[]
export declare const QUALITY_FLAGS: readonly QualityFlag[]
export declare const PRICE_TYPES: readonly PriceType[]
export declare const PRICE_STATUSES: readonly PriceStatus[]
export declare const TAX_BASES: readonly TaxBasis[]
export declare const PRICE_COMPONENTS: readonly PriceComponent[]
export declare const CURRENCIES: readonly 'CNY'[]
export declare const EVIDENCE_BASES: readonly EvidenceBasis[]
export declare const ALLOCATION_COMPLETENESS: readonly AllocationCompleteness[]
export declare const ALLOCATION_DERIVATIONS: readonly AllocationDerivation[]
export declare const EVIDENCE_DOCUMENT_TYPES: readonly EvidenceDocumentType[]
export declare const VERIFICATION_EVIDENCE_TYPES: readonly EvidenceDocumentType[]
export declare const REVISION_KINDS: readonly RevisionKind[]
export declare const REVISION_STATUSES: readonly RevisionStatus[]
export declare const CONTRACT_ORIGINS: readonly ContractOrigin[]
export declare const CHANGE_TYPES: readonly ChangeType[]
export declare const DEFERRED_CHANGE_TYPES: readonly string[]
export declare const EVENT_TYPES: readonly EventType[]
export declare const MIDLONG_ERROR_CODES: readonly MidlongErrorCode[]
export declare const MAX_IMPORT_DECIMALS: number
export declare const ENERGY_UNIT_FACTORS: Readonly<Record<string, string>>
export declare const PRICE_UNIT_FACTORS: Readonly<Record<string, string>>
export declare const CANONICAL_ENERGY_UNIT: 'MWh'
export declare const CANONICAL_PRICE_UNIT: '元/MWh'

export declare const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>>
export declare const PRODUCT_KIND_LABELS: Readonly<Record<ProductKind, string>>
export declare const DELIVERY_CYCLE_LABELS: Readonly<Record<DeliveryCycle, string>>
export declare const TRADE_METHOD_LABELS: Readonly<Record<TradeMethod, string>>
export declare const MARKET_SCOPE_LABELS: Readonly<Record<MarketScope, string>>
export declare const ENERGY_ATTRIBUTE_LABELS: Readonly<Record<EnergyAttribute, string>>
export declare const CONFIRMATION_STATUS_LABELS: Readonly<Record<ConfirmationStatus, string>>
export declare const DELIVERY_PROGRESS_LABELS: Readonly<Record<DeliveryProgress, string>>
export declare const QUALITY_FLAG_LABELS: Readonly<Record<QualityFlag, string>>
export declare const PRICE_TYPE_LABELS: Readonly<Record<PriceType, string>>
export declare const TAX_BASIS_LABELS: Readonly<Record<TaxBasis, string>>
export declare const PRICE_COMPONENT_LABELS: Readonly<Record<PriceComponent, string>>
export declare const EVIDENCE_BASIS_LABELS: Readonly<Record<EvidenceBasis, string>>
export declare const EVIDENCE_DOCUMENT_TYPE_LABELS: Readonly<Record<EvidenceDocumentType, string>>
export declare const REVISION_KIND_LABELS: Readonly<Record<RevisionKind, string>>
export declare const EVENT_TYPE_LABELS: Readonly<Record<EventType, string>>
export declare const MIDLONG_ERROR_LABELS: Readonly<Record<MidlongErrorCode, string>>

export declare function legacyMarketTypeOf(input: { productKind: ProductKind; tradeMethod: TradeMethod; energyAttribute: EnergyAttribute; marketScope?: MarketScope | null }): string
export declare const LEGACY_TRADE_MODE_OF: Readonly<Record<TradeMethod, string>>
export declare const LEGACY_STATUS_OF: Readonly<Record<ConfirmationStatus, string>>
export declare const LEGACY_MIDLONG_MARKET_TYPES: readonly string[]
export declare const LEGACY_SPOT_MARKET_TYPES: readonly string[]
export type LegacyCategory = 'MIDLONG_CANDIDATE' | 'SPOT' | 'RETAIL' | 'UNKNOWN'
export declare function classifyLegacyContract(row: Record<string, unknown>): { category: LegacyCategory; reasons: string[] }

export interface ImportColumnDeclaration {
  key: string
  name: string
  aliases: readonly string[]
  required: boolean
  type?: 'date' | 'month'
  unitIn?: 'energy' | 'price'
  choices?: Readonly<Record<string, string | boolean>>
}
export declare const DEFERRED_PRODUCT_KEYWORDS: readonly string[]
export declare function deferredProductKeywordOf(name: unknown): string | null
export declare const IMPORT_CONTRACT_COLUMNS: readonly ImportColumnDeclaration[]
export declare const IMPORT_ALLOCATION_COLUMNS: readonly ImportColumnDeclaration[]
export declare const IMPORT_SHEETS: Readonly<{ contracts: string; allocations: string }>
export declare const IMPORT_TEMPLATE_SAMPLES: Readonly<{ contracts: readonly (readonly string[])[]; allocations: readonly (readonly string[])[] }>

// ── 接口 DTO ────────────────────────────────────────────────────────────────

export interface MidlongErrorData {
  errorCode: MidlongErrorCode
  details: unknown
}

export interface MidlongCapabilities {
  enabled: boolean
  regionId: string
  regionSupported: boolean
  pilotRegions: string[]
  phase: 'P1'
  /** 各期能力开关：P1 合同/持仓/导入；P2 分时分解 curves 与场站分配 stationAllocations；P3 计划 plans 与交易执行 execution；P5 复盘 review。 */
  modules: { contracts: boolean; positions: boolean; imports: boolean; curves: boolean; stationAllocations: boolean; plans: boolean; execution: boolean; review: false }
  canWrite: boolean
  companyId: string
  scopeCompanyIds: string[]
  reason: string | null
}

export interface MidlongSubject {
  id: number
  companyId: string
  regionId: string
  subjectKey: string
  displayName: string
  unitCode: string | null
  unitCodeSource: string | null
  verificationNote: string | null
  stationIds: number[]
  createdAt: string
  createdBy: string | null
}

export interface MidlongAllocation {
  id: number | null
  revisionId?: number | null
  deliveryMonth: string
  quantity: string
  sourceQuantity: string | null
  price: string | null
  priceStatus: PriceStatus
  sourcePrice: string | null
  evidenceBasis: EvidenceBasis
  derivation: AllocationDerivation
}

export interface MidlongRevision {
  id: number
  revisionNo: number
  revisionKind: RevisionKind
  status: RevisionStatus
  supersedesRevisionNo: number | null
  totalQuantity: string | null
  sourceQuantity: string | null
  priceType: PriceType | null
  sellerPrice: string | null
  priceStatus: PriceStatus
  sourcePrice: string | null
  environmentPrice: string | null
  currency: 'CNY'
  taxBasis: TaxBasis
  priceComponent: PriceComponent
  deliveryStart: string | null
  deliveryEnd: string | null
  allocationDeclaredComplete: boolean
  allocationCompleteness: AllocationCompleteness
  businessEffectiveAt: string | null
  recordedAt: string
  recordedBy: string | null
  confirmedAt: string | null
  confirmedBy: string | null
  changeReason: string | null
  affectedMonths: string[]
  evidenceIds: number[]
  provenance: Record<string, unknown>
  allocations: MidlongAllocation[]
}

export interface MidlongContractCurrent {
  revisionNo: number
  status: RevisionStatus
  totalQuantity: string | null
  sellerPrice: string | null
  priceStatus: PriceStatus
  priceType: PriceType | null
  taxBasis: TaxBasis
  priceComponent: PriceComponent
  deliveryStart: string | null
  deliveryEnd: string | null
  allocationCompleteness: AllocationCompleteness
  businessEffectiveAt: string | null
  confirmedAt: string | null
}

export interface MidlongContractSummary {
  contractId: number
  companyId: string
  regionId: string
  documentKind: DocumentKind
  tradingSide: 'SELL'
  productKind: ProductKind | null
  deliveryCycle: DeliveryCycle | null
  tradeMethod: TradeMethod | null
  marketScope: MarketScope | null
  energyAttribute: EnergyAttribute | null
  contractName: string
  externalContractNo: string
  sourceNamespace: string
  counterpartyName: string | null
  signedDate: string | null
  frameworkContractId: number | null
  subjectId: number | null
  subjectKey: string | null
  subjectName: string | null
  subjectUnitCode: string | null
  stationId: number | null
  stationName: string | null
  stationType: string | null
  confirmationStatus: ConfirmationStatus
  deliveryProgress: DeliveryProgress
  qualityFlags: QualityFlag[]
  currentRevisionNo: number
  rowVersion: number
  origin: ContractOrigin
  importBatchId: string | null
  remarks: string | null
  firstConfirmedAt: string | null
  firstConfirmedBy: string | null
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
  createdAt: string
  updatedAt: string
  current: MidlongContractCurrent
}

export interface MidlongEvidence {
  id: number
  contractId: number | null
  importBatchId: string | null
  documentType: EvidenceDocumentType
  sha256: string
  byteSize: number
  originalFileName: string
  mediaType: string | null
  source: 'UPLOAD' | 'IMPORT' | 'ONBOARDING'
  note: string | null
  uploadedAt: string
  uploadedBy: string | null
}

export interface MidlongEvent {
  id: number
  eventType: EventType
  revisionNo: number | null
  occurredAt: string
  actor: string | null
  reason: string | null
  evidenceIds: number[]
  payload: Record<string, unknown>
}

export interface MidlongAlias {
  id: number
  sourceNamespace: string
  externalObligationId: string
  aliasKind: 'PRIMARY' | 'VERIFIED_ALIAS'
  subjectId: number | null
  verificationNote: string | null
  createdAt: string
  createdBy: string | null
  /** 合同作废时释放外部编号的时刻；非空表示该编号已可重新登记（迁移 056）。 */
  releasedAt: string | null
  releasedReason: string | null
}

/** 框架协议关系中的对方合同。 */
export interface MidlongRelatedContract {
  contractId: number
  contractName: string
  externalContractNo: string
  documentKind: DocumentKind
  confirmationStatus: ConfirmationStatus
  totalQuantity: string | null
  deliveryStart: string | null
  deliveryEnd: string | null
}

export interface MidlongContractDetail extends MidlongContractSummary {
  originalQuantity: string | null
  currentRevision: MidlongRevision | null
  revisions: MidlongRevision[]
  evidence: MidlongEvidence[]
  events: MidlongEvent[]
  aliases: MidlongAlias[]
  /** 电量合同所属的框架协议；未关联为 null。 */
  framework: MidlongRelatedContract | null
  /** 框架协议下关联的合同（含已作废）；电量合同恒为空数组。 */
  linkedContracts: MidlongRelatedContract[]
  linkedTrades: { label: string; tradeCount: number; volume: string }
}

export interface MidlongContractStats {
  total: number
  byStatus: Record<ConfirmationStatus, number>
  frameworkCount: number
  withQualityGaps: number
  confirmedObligationQuantity: string
  unconfirmedObligationQuantity: string
}

export interface MidlongContractListResult {
  rows: MidlongContractSummary[]
  page: number
  pageSize: number
  total: number
  stats: MidlongContractStats
}

export interface MidlongContractQuery {
  page?: number
  pageSize?: number
  deliveryFrom?: string
  deliveryTo?: string
  subjectId?: number | string
  frameworkContractId?: number | string
  stationId?: number | 'UNALLOCATED' | string
  documentKind?: DocumentKind
  productKind?: ProductKind
  tradeMethod?: TradeMethod
  energyAttribute?: EnergyAttribute
  confirmationStatus?: string
  deliveryProgress?: DeliveryProgress
  qualityFlag?: QualityFlag
  counterparty?: string
  keyword?: string
}

export interface MidlongEconomicsInput {
  totalQuantity?: string | null
  quantityUnit?: string | null
  sellerPrice?: string | null
  priceUnit?: string | null
  priceType?: PriceType | null
  taxBasis?: TaxBasis | null
  priceComponent?: PriceComponent | null
  environmentPrice?: string | null
  deliveryStart?: string | null
  deliveryEnd?: string | null
  allocationDeclaredComplete?: boolean
  allocations?: Array<{ deliveryMonth: string; quantity: string; quantityUnit?: string | null; price?: string | null; priceUnit?: string | null; evidenceBasis: EvidenceBasis }>
}

export interface MidlongContractInput {
  documentKind: DocumentKind
  productKind: ProductKind
  tradeMethod: TradeMethod
  marketScope: MarketScope
  energyAttribute: EnergyAttribute
  contractName: string
  externalContractNo: string
  sourceNamespace?: string
  counterpartyName?: string | null
  signedDate?: string | null
  subjectId?: number | null
  stationId?: number | null
  frameworkContractId?: number | null
  remarks?: string | null
  expectedRowVersion?: number
  economics: MidlongEconomicsInput
}

export interface MidlongImportIssue {
  sheet: string
  rowNumber: number | null
  column: string | null
  code: string
  message: string
  value?: string
  difference?: string
  severity?: 'warning'
}

export interface MidlongImportDiff {
  field: string
  existing: unknown
  incoming: unknown
}

export interface MidlongImportRowReport {
  rowId: string
  location: { sheet: string; rowNumber: number; allocationRowNumbers: number[] }
  op: 'CREATE' | 'SKIP' | 'CONFLICT' | 'ERROR'
  contractId: number | null
  confirmationStatus: ConfirmationStatus | null
  conflictReason: 'CONTENT_DIFFERS' | 'EXISTING_VOIDED' | 'AMBIGUOUS_SUBJECT' | null
  diffs: MidlongImportDiff[]
  candidateDuplicates: Array<{ contractId: number; externalContractNo: string; sourceNamespace: string }>
  /** 同一业务键曾随作废释放的合同：本行仍可新增，预览给出 PREVIOUSLY_VOIDED 提示。 */
  previouslyVoided: Array<{ contractId: number; voidedAt: string; voidReason: string | null }>
  externalObligationId: string
  contractName: string
  documentKind: DocumentKind | null
  productKind: ProductKind | null
  subjectKey: string | null
  stationName: string | null
  sourceNamespace: string | null
  deliveryStart: string | null
  deliveryEnd: string | null
  totalQuantity: string | null
  sellerPrice: string | null
  priceStatus: PriceStatus
  allocationCompleteness: AllocationCompleteness
  unallocatedQuantity: string | null
  allocationCount: number
  errors: MidlongImportIssue[]
  warnings: MidlongImportIssue[]
}

export interface MidlongImportMapping {
  sourceNamespace?: string | null
  quantityUnit?: string | null
  priceUnit?: string | null
  acceptPrecisionRounding?: boolean
  sourceDocumentType?: 'IMPORT_SOURCE_FILE' | 'TRADING_CENTER_EXPORT' | 'ELECTRONIC_CONFIRMATION'
}

export interface MidlongImportPreview {
  previewId: string
  status: 'OPEN' | 'COMMITTED'
  companyId: string
  regionId: string
  expiresAt: string
  format: 'xlsx' | 'csv'
  files: Array<{ role: 'workbook' | 'contracts' | 'allocations'; fileName: string; sha256: string; bytes: number }>
  mapping: Required<MidlongImportMapping>
  columns: {
    contracts: Array<{ name: string; header: string; via: 'name' | 'alias'; unitFromHeader: string | null }>
    allocations: Array<{ name: string; header: string; via: 'name' | 'alias'; unitFromHeader: string | null }>
  } | null
  summary: {
    contractRows: number
    allocationRows: number | null
    createCount: number
    skipCount: number
    conflictCount: number
    errorRowCount: number
    fileErrorCount: number
    warningCount: number
    canCommit: boolean
  }
  fileErrors: MidlongImportIssue[]
  fileWarnings: MidlongImportIssue[]
  rows: MidlongImportRowReport[]
  batchId?: string | null
  expired?: boolean
}

export interface MidlongImportBatch {
  batchId: string
  previewId: string
  regionId: string
  createdCount: number
  skippedCount: number
  results: Array<{ rowId: string; location: { sheet: string; rowNumber: number }; op: 'CREATED' | 'SKIPPED'; contractId: number; externalObligationId: string }>
  files: Array<{ role: string; fileName: string; sha256: string; bytes: number }>
  mapping: Record<string, unknown>
  committedAt: string
  committedBy: string | null
  note: string
  idempotentReplay?: boolean
  alreadyCommitted?: boolean
}

export interface MidlongPriceGroup {
  currency: 'CNY'
  taxBasis: TaxBasis
  priceComponent: PriceComponent
  knownQuantity: string
  notionalAmount: string
  averagePrice: string | null
}

export interface MidlongPriceSummary {
  groups: MidlongPriceGroup[]
  comparable: boolean
  averagePrice: string | null
  knownPriceQuantity: string
  unknownPriceQuantity: string
  coverageRatio: string | null
  knownNotionalAmount: string | null
  notionalAmountComplete: boolean
  environmentValue: { knownQuantity: string; notionalAmount: string } | null
}

export interface MidlongPositionMonth {
  month: string
  formalQuantity: string
  contractCount: number
  incomplete: boolean
  affectedContractIds: number[]
  price: MidlongPriceSummary
}

export interface MidlongPositionContribution {
  month: string
  contractId: number
  externalContractNo: string
  contractName: string
  subjectId: number | null
  stationId: number | null
  revisionNo: number
  allocationId: number | null
  quantity: string
  price: string | null
  priceSource: 'ALLOCATION' | 'CONTRACT' | null
  derivation: AllocationDerivation
}

export interface MidlongUnallocatedEntry {
  contractId: number
  externalContractNo: string
  contractName: string
  revisionNo: number
  deliveryStart: string
  deliveryEnd: string
  totalQuantity: string | null
  formalAllocatedQuantity: string
  unallocatedQuantity: string | null
  reason: 'TOTAL_QUANTITY_UNKNOWN' | 'MONTHLY_ALLOCATION_INCOMPLETE'
  overlappingMonths: string[]
}

export interface MidlongPositionReport {
  asOf: string
  fromMonth: string
  toMonth: string
  view: 'CURRENT' | 'AS_OF'
  status: 'empty' | 'partial' | 'complete'
  regionId: string
  companyIds: string[]
  generatedAt: string
  filters: Record<string, string>
  months: MidlongPositionMonth[]
  totals: {
    contractCount: number
    contractTotalQuantity: string
    formalQuantityInRange: string
    unallocatedPoolQuantity: string
    unallocatedContractCount: number
    price: MidlongPriceSummary
  }
  unallocatedPool: MidlongUnallocatedEntry[]
  contributions: MidlongPositionContribution[]
  revisionsUsed: Array<{ contractId: number; revisionNo: number; confirmedAt: string }>
  excluded: {
    draftCount: number
    pendingVerificationCount: number
    frameworkCount: number
    voidedCount: number
    estimatedQuantity: string
    note: string
  }
}

export interface MidlongPositionQuery {
  fromMonth?: string
  toMonth?: string
  asOf?: string
  subjectId?: number | string
  stationId?: number | 'UNALLOCATED' | string
  productKind?: ProductKind
  tradeMethod?: TradeMethod
  energyAttribute?: EnergyAttribute
}

export interface MidlongCsvExport {
  fileName: string
  contentType: 'text/csv'
  content: string
}

/** 可展示明细的盘点记录（合同归属规则已命中）。 */
export interface MidlongOnboardingVisibleRecord {
  contractId: number
  companyId: string
  ownershipBlocked: false
  contractNo: string | null
  contractName: string | null
  marketType: string | null
  legacyStatus: string | null
  stationId: number | null
  stationName: string | null
  stationRegionId: string | null
  category: LegacyCategory
  reasons: string[]
  duplicateContractIds: number[]
  gaps: string[]
  detailCount: number
}

/** 归属未确定的盘点记录：与旧合同接口同口径只给合同 ID，不含业务明细（MW-03）。 */
export interface MidlongOnboardingMaskedRecord {
  contractId: number
  companyId: string
  ownershipBlocked: true
  category: 'UNKNOWN'
  reasons: string[]
  duplicateContractIds: []
  gaps: []
  detailCount: null
}

export type MidlongOnboardingRecord = MidlongOnboardingVisibleRecord | MidlongOnboardingMaskedRecord

export interface MidlongOnboardingPreview {
  generatedAt: string
  readOnly: true
  summary: {
    total: number
    alreadyManaged: number
    MIDLONG_CANDIDATE: number
    SPOT: number
    RETAIL: number
    UNKNOWN: number
    /** 其中归属未确定、只给合同 ID 的记录数。 */
    ownershipBlocked: number
    /** 绑定其他地区场站、未列入本地区盘点的旧合同数。 */
    outOfRegion: number
    duplicateGroups: number
  }
  records: MidlongOnboardingRecord[]
  note: string
}

/** 旧 /api/company/contracts 列表行上补充的纳管状态。 */
export interface LegacyMidlongManagement {
  managed: true
  confirmationStatus: ConfirmationStatus
  currentRevisionNo: number
  rowVersion: number
  documentKind: DocumentKind
  regionId: string
  detailPath: string
}
