// 中长期售电 P4 执行确认共享契约的类型侧伴随定义（#3013）。运行时见 execution.mjs。
// 接口 DTO 形状与 server/midlong/midlong-p4-api.mjs、midlong-p4-execution-store-pg.mjs 的响应一一对应。
// 电量、价格、金额、比率一律是规范十进制字符串（不是 number）；未知为 null，不是 0。
import type { PriceComponent, ProductKind, TaxBasis, TradeMethod } from './contract.mjs'
import type { PlanPeriodType, PlanVerificationStatus, ProposalStatus } from './planning.mjs'

export type ExecutionResultStatus = 'PRE_CLEARED' | 'CLEARED' | 'WITHDRAWN'
export type ExecutionRegisterableResultStatus = 'PRE_CLEARED' | 'CLEARED'
export type ExecutionLinkKind = 'OBLIGATION_CREATED' | 'EXISTING_LINKED'
export type ExecutionEventType =
  | 'PROPOSAL_PRE_CLEARED' | 'PROPOSAL_CLEARED' | 'PROPOSAL_WITHDRAWN'
  | 'EXECUTION_CONFIRMATION_REGISTERED' | 'EXECUTION_CONFIRMATION_REVISED' | 'EXECUTION_CONFIRMATION_REVOKED'
  | 'EXECUTION_CONTRACT_LINKED' | 'EXECUTION_OCCUPATION_CONVERTED'

export declare const EXECUTION_RESULT_STATUSES: readonly ExecutionResultStatus[]
export declare const EXECUTION_REGISTERABLE_RESULT_STATUSES: readonly ExecutionRegisterableResultStatus[]
export declare const EXECUTION_LINK_KINDS: readonly ExecutionLinkKind[]
export declare const EXECUTION_EVENT_TYPES: readonly ExecutionEventType[]
export declare const EXECUTION_ERROR_CODES: readonly string[]
export declare const EXECUTION_ERROR_LABELS: Readonly<Record<string, string>>

export declare const EXECUTION_RESULT_STATUS_LABELS: Readonly<Record<ExecutionResultStatus, string>>
export declare const EXECUTION_LINK_KIND_LABELS: Readonly<Record<ExecutionLinkKind, string>>
export declare const EXECUTION_EVENT_TYPE_LABELS: Readonly<Record<ExecutionEventType, string>>
export declare const EXECUTION_NOTICES: Readonly<{
  preClearedNotFormal: string
  clearedAtomic: string
  duplicateReplay: string
  contentChangeIsRevision: string
  subjectMismatch: string
  lateResult: string
  occupationFloor: string
  overPlan: string
  planDeviation: string
  revokeReversal: string
  linkNoDoubleCount: string
  linkRequiresConfirmed: string
  unsupportedProduct: string
  priceUnknown: string
}>
export declare const FORBIDDEN_EXECUTION_TERMS: readonly string[]

export interface ExecutionConfirmationSegmentInput {
  deliveryMonth: string
  quantity: string
  price?: string | null
}

export declare function confirmationContentFingerprint(value: {
  resultStatus: string
  productKind?: ProductKind | null
  tradeMethod?: TradeMethod | null
  unsupportedProduct?: string | null
  priceTaxBasis?: TaxBasis | null
  priceComponent?: PriceComponent | null
  externalConfirmedAt?: string | null
  segments?: ExecutionConfirmationSegmentInput[]
}): string

export interface OccupationConversionMonth {
  deliveryMonth: string
  /** 本版本声明的该交割月最终确认量（绝对量，不是增量）。 */
  targetQuantity: string
  /** 该确认单此前各月累计已转换量。 */
  previousConvertedQuantity: string
  /** 本次实际转换增量（修订减量为负；占用不足时小于目标差）。 */
  delta: string
  remainingBefore: string | null
  remainingAfter: string | null
  reason: 'CONVERTED' | 'PARTIAL' | 'REDUCED' | 'OCCUPATION_NOT_OPEN'
}
export interface OccupationConversionAllocation {
  months: OccupationConversionMonth[]
  totalDelta: string
  totalUnconverted: string
  lateResult: boolean
}
export declare function allocateOccupationConversion(input?: {
  segments?: Array<{ deliveryMonth: string; quantity: string }>
  previousConvertedByMonth?: Record<string, string>
  openOccupations?: Array<{ deliveryMonth: string; remainingQuantity: string }>
}): OccupationConversionAllocation

export interface PlanDeviationRow {
  planId: number
  periodType: PlanPeriodType
  periodKey: string
  targetQuantity: string | null
  soldQuantityBefore: string | null
  soldComplete: boolean
  /** 各月对已售的净增量（登记 = 确认量，修订 = 新旧差，冲正 = 负数）。 */
  confirmedQuantityInPeriod: string
  knownSoldQuantityAfter: string | null
  remainingPlanQuantityAfter: string | null
  completionRateAfter: string | null
  overPlan: boolean
  verificationStatus: PlanVerificationStatus
}
export interface PlanDeviationReport {
  rows: PlanDeviationRow[]
  notices: string[]
}
export declare function buildPlanDeviation(input?: {
  plans?: Array<{
    planId: number
    periodType: PlanPeriodType
    periodKey: string
    targetQuantity: string | null
    soldQuantity: string | null
    soldComplete: boolean
  }>
  segments?: ExecutionConfirmationSegmentInput[]
  conversion?: { totalUnconverted?: string; lateResult?: boolean }
}): PlanDeviationReport

// ── 接口 DTO（登记 / 修订响应、列表与详情行）─────────────────────────────────

export interface ExecutionConfirmationRevisionDto {
  id: number
  confirmationId: number
  revisionNo: number
  supersedesRevisionNo: number | null
  resultStatus: ExecutionResultStatus
  productKind: ProductKind | null
  tradeMethod: TradeMethod | null
  unsupportedProduct: string | null
  pendingReview: boolean
  priceTaxBasis: TaxBasis
  priceComponent: PriceComponent
  externalConfirmedAt: string | null
  sourceName: string | null
  note: string | null
  changeReason: string | null
  attachmentId: number | null
  conversion: OccupationConversionAllocation & { deviation?: PlanDeviationReport }
  recordedAt: string
  recordedBy: string | null
  segments: Array<{ id: number; deliveryMonth: string; quantity: string; price: string | null }>
}

export interface ExecutionContractLinkDto {
  contractId: number
  linkKind: ExecutionLinkKind
  note: string | null
  createdAt: string
  createdBy: string | null
}

export interface ExecutionConfirmationSummaryRow {
  id: number
  companyId: string
  regionId: string
  subjectId: number
  subjectName: string | null
  sourceNamespace: string
  confirmationNo: string
  proposalId: number | null
  proposalStatus: ProposalStatus | null
  currentRevisionNo: number
  rowVersion: number
  resultStatus: ExecutionResultStatus
  pendingReview: boolean
  totalQuantity: string
  priceKnown: boolean
  linkedContracts: Array<{ contractId: number; linkKind: ExecutionLinkKind }>
  reversed: boolean
  convertedQuantity: string
  createdAt: string
  createdBy: string | null
  updatedAt: string
}

export interface ExecutionConfirmationDetailDto extends ExecutionConfirmationSummaryRow {
  revisions: ExecutionConfirmationRevisionDto[]
  contractLinks: ExecutionContractLinkDto[]
  reversals: Array<{
    id: number
    baseRevisionNo: number
    reason: string
    externalRevokedAt: string | null
    attachmentId: number | null
    contractId: number | null
    contractRevisionNo: number | null
    createdAt: string
    createdBy: string | null
  }>
  conversions: Array<{
    id: number
    revisionNo: number
    occupationId: number
    deliveryMonth: string
    quantityDelta: string
    createdAt: string
    createdBy: string | null
  }>
  events: Array<{ id: number; eventType: string; revisionNo: number | null; occurredAt: string; actor: string | null; reason: string | null; payload: Record<string, unknown> }>
  notices: string[]
}

export interface RegisterConfirmationResultDto {
  confirmationId: number
  revisionNo: number
  resultStatus: ExecutionResultStatus
  businessKeyReplay: boolean
  pendingReview: { reason: 'UNSUPPORTED_PRODUCT'; raw: string } | null
  contractId: number | null
  linkKind: ExecutionLinkKind | null
  proposalId: number | null
  proposalStatus: ProposalStatus | null
  conversion: OccupationConversionAllocation
  deviation: PlanDeviationReport
  notices: string[]
}
