// 中长期售电 P4（执行确认 + 合同调整）的类型与枚举出口（dljy#3014，后端契约 dljy#3013）。
// 页面经 services 取用共享契约，不直接依赖 shared/ 路径（契约由 dljy 主仓 shared/midlong 单向同步而来，本仓只读）。
// 执行确认的接口 DTO 已在 shared/midlong/execution.d.mts 定义，直接转发；调整的 DTO 形状与后端
// midlong-p4-adjust-store-pg.mjs 的响应一一对应，在下方按同构约定补齐（量价金额一律规范十进制字符串，未知为 null）。
import type { TaxBasis } from 'shared/midlong/contract.mjs'
// 本文件内 DTO 引用的枚举类型：转发出口不引入局部名字，这里显式导入。
import type {
  AdjustmentDeltaRow, AdjustmentDirectionSource, AdjustmentPendingReason, AdjustmentStatus, AdjustmentType, ObligationDirection,
} from 'shared/midlong/adjustment.mjs'

// ── 执行确认（executions）：枚举、标签与 DTO 全部转发共享契约 ──────────────────

export type {
  ExecutionConfirmationDetailDto, ExecutionConfirmationRevisionDto, ExecutionConfirmationSegmentInput,
  ExecutionConfirmationSummaryRow, ExecutionContractLinkDto, ExecutionEventType, ExecutionLinkKind,
  ExecutionRegisterableResultStatus, ExecutionResultStatus, OccupationConversionAllocation, OccupationConversionMonth,
  PlanDeviationReport, PlanDeviationRow, RegisterConfirmationResultDto,
} from 'shared/midlong/execution.mjs'
export {
  EXECUTION_ERROR_LABELS, EXECUTION_EVENT_TYPE_LABELS, EXECUTION_LINK_KIND_LABELS, EXECUTION_NOTICES,
  EXECUTION_REGISTERABLE_RESULT_STATUSES, EXECUTION_RESULT_STATUSES, EXECUTION_RESULT_STATUS_LABELS,
  FORBIDDEN_EXECUTION_TERMS,
} from 'shared/midlong/execution.mjs'

// ── 合同调整（adjustments）：枚举与标签转发共享契约 ──────────────────────────

export type {
  AdjustmentDeltaRow, AdjustmentDirectionResolution, AdjustmentDirectionSource, AdjustmentPendingReason,
  AdjustmentPriceKind, AdjustmentSegmentInput, AdjustmentStatus, AdjustmentType, AllocationSnapshotRow,
  ObligationDirection,
} from 'shared/midlong/adjustment.mjs'
export {
  ADJUSTMENT_DIRECTION_SOURCE_LABELS, ADJUSTMENT_DIRECTION_SOURCES, ADJUSTMENT_NOTICES, ADJUSTMENT_PENDING_REASON_LABELS,
  ADJUSTMENT_PRICE_KIND_LABELS, ADJUSTMENT_PRICE_KINDS, ADJUSTMENT_STATUSES, ADJUSTMENT_STATUS_LABELS,
  ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_TYPES, FORBIDDEN_ADJUSTMENT_TERMS, OBLIGATION_DIRECTIONS,
  OBLIGATION_DIRECTION_LABELS, adjustableBalanceRows, applyAdjustmentToAllocations, resolveAdjustmentDirection,
} from 'shared/midlong/adjustment.mjs'

// ── 合同调整接口 DTO（与后端 midlong-p4-adjust-store-pg.mjs 响应一一对应）────────

/** 独立价款（转让价款/补偿/手续费）单项：金额必填为正，币种与含税口径默认 CNY/UNKNOWN；与原合同售电价分开记录。 */
export type AdjustmentPriceItem = { amount: string; currency: string; taxBasis: TaxBasis | 'UNKNOWN'; note: string | null }
export type AdjustmentPrices = Partial<Record<'transferPrice' | 'compensation' | 'handlingFee', AdjustmentPriceItem>>

/** 调整登记 / 修订的请求体。direction 可空 = 待核对（MA-02：不从字样或正负推断）。 */
export type AdjustmentInput = {
  contractId: number
  sourceNamespace: string
  externalAdjustmentNo: string
  externalRevisionNo?: number
  adjustmentType: AdjustmentType
  direction?: ObligationDirection | null
  externalProductCode?: string | null
  counterpartyName?: string | null
  businessEffectiveAt?: string | null
  reason: string
  note?: string | null
  prices?: AdjustmentPrices | null
  evidenceDocumentType?: string
  segments: Array<{ deliveryMonth: string; quantity: string }>
  changeReason?: string | null
  file?: { fileName: string; contentBase64: string; mediaType?: string | null } | null
}

export type AdjustmentWriteResult = {
  adjustmentId: number
  revisionNo: number
  status: AdjustmentStatus
  direction: ObligationDirection | null
  directionSource: AdjustmentDirectionSource | null
  pendingReason: AdjustmentPendingReason | null
  businessKeyReplay: boolean
  contractId: number
  baseRevisionNo: number
  rowVersion: number
  segments: Array<{ deliveryMonth: string; quantity: string }>
  prices: AdjustmentPrices
  notices: string[]
}

export type AdjustmentConfirmResult = {
  adjustmentId: number
  revisionNo: number
  status: 'EFFECTIVE'
  contractId: number
  contractRevisionNo: number
  baseRevisionNo: number
  direction: ObligationDirection
  months: AdjustmentDeltaRow[]
  totalDelta: string
  totalQuantityAfter: string
  prices: AdjustmentPrices
  effectuationId: number
  effectiveAt: string
  rowVersion: number
  notices: string[]
}

export type AdjustmentRevisionDto = {
  id: number
  revisionNo: number
  supersedesRevisionNo: number | null
  adjustmentType: AdjustmentType
  direction: ObligationDirection | null
  directionSource: AdjustmentDirectionSource | null
  directionSourceLabel: string | null
  pendingReason: AdjustmentPendingReason | null
  externalProductCode: string | null
  counterpartyName: string | null
  baseContractRevisionNo: number
  businessEffectiveAt: string | null
  reason: string
  note: string | null
  prices: AdjustmentPrices
  evidenceIds: number[]
  recordedAt: string
  recordedBy: string | null
  segments: Array<{ id: number; deliveryMonth: string; quantity: string }>
}

export type AdjustmentEffectuationDto = {
  id: number
  revisionNo: number
  contractId: number
  baseRevisionNo: number
  newRevisionNo: number
  direction: ObligationDirection
  totalDelta: string
  impact: {
    months?: AdjustmentDeltaRow[]
    totalDelta?: string
    before?: { revisionNo?: number; totalQuantity?: string | null }
    after?: { revisionNo?: number; totalQuantity?: string | null }
    prices?: AdjustmentPrices
    direction?: ObligationDirection
  }
  effectiveAt: string
  effectedBy: string | null
}

export type AdjustmentSummaryRow = {
  id: number
  companyId: string
  regionId: string
  contractId: number
  contractNo: string | null
  contractName: string | null
  subjectId: number | null
  subjectName: string | null
  sourceNamespace: string
  externalAdjustmentNo: string
  externalRevisionNo: number
  status: AdjustmentStatus
  currentRevisionNo: number
  rowVersion: number
  adjustmentType: AdjustmentType | null
  direction: ObligationDirection | null
  directionSource: AdjustmentDirectionSource | null
  pendingReason: AdjustmentPendingReason | null
  baseRevisionNo: number | null
  totalQuantity: string
  prices: AdjustmentPrices
  effective: { contractRevisionNo: number; totalDelta: string; effectiveAt: string } | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
}

export type AdjustmentDetailDto = AdjustmentSummaryRow & {
  revisions: AdjustmentRevisionDto[]
  effectuation: AdjustmentEffectuationDto | null
  notices: string[]
}

/** 可调余额（MA-03）：只按正式月度分解片段展示；未分解池不属于任何片段。 */
export type AdjustableBalanceReport = {
  contractId: number
  revisionNo: number
  totalQuantity: string | null
  unallocatedQuantity: string | null
  months: Array<{ deliveryMonth: string; adjustableQuantity: string; price: string | null; priceStatus: string; ended: boolean }>
  notice: string
}

/** 受影响的 P3 计划与方案占用（只读，不改 P3）。 */
export type AffectedPlanRow = { planId: number; periodType: 'YEAR' | 'MONTH'; periodKey: string; revisionNo: number | null; targetQuantity: string | null }
export type AffectedProposalRow = {
  proposalId: number
  status: string
  ownerName: string | null
  months: Array<{ deliveryMonth: string; occupiedQuantity: string; openQuantity: string }>
}

export type AdjustmentImpactSnapshot = {
  frozen: boolean
  months: AdjustmentDeltaRow[]
  totalDelta: string | null
  beforeRevisionNo: number
  afterRevisionNo: number | null
  beforeTotalQuantity: string | null
  afterTotalQuantity: string | null
}

/** 调整影响查询（MA-05）：已生效取生效台账冻结快照，未生效给基线 + 拟变化（after/delta 为 null = 方向待核对）。 */
export type AdjustmentImpactReport = {
  adjustmentId: number
  status: AdjustmentStatus
  adjustmentType: AdjustmentType
  direction: ObligationDirection | null
  contractId: number
  contractNo: string | null
  contractName: string | null
  externalKey: { sourceNamespace: string; externalAdjustmentNo: string; externalRevisionNo: number }
  months: string[]
  snapshot: AdjustmentImpactSnapshot
  prices: AdjustmentPrices
  affectedPlans: AffectedPlanRow[]
  affectedProposals: AffectedProposalRow[]
  asOfExplanation: string
  endedMonths: string[]
  notices: string[]
}

/** 合同版本（更正或调整产生）影响查询：与更正版本同一条时间线上的钻取入口共用。 */
export type RevisionImpactReport = {
  contractId: number
  contractNo: string | null
  contractName: string | null
  revisionNo: number
  revisionKind: string
  changeReason: string | null
  recordedAt: string | null
  confirmedAt: string | null
  businessEffectiveAt: string | null
  evidenceIds: number[]
  adjustment: { adjustmentId: number; direction: ObligationDirection; prices: AdjustmentPrices } | null
  snapshot: { frozen: true; beforeRevisionNo: number; afterRevisionNo: number; beforeTotalQuantity: string | null; afterTotalQuantity: string | null; months: AdjustmentDeltaRow[] }
  months: string[]
  affectedPlans: AffectedPlanRow[]
  affectedProposals: AffectedProposalRow[]
  asOfExplanation: string
  endedMonths: string[]
  notices: string[]
}

export type AdjustmentMappingDto = {
  id: number
  sourceNamespace: string
  externalProductCode: string
  adjustmentType: AdjustmentType
  direction: ObligationDirection
  basisNote: string
  rowVersion: number
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export type AdjustmentMappingInput = {
  sourceNamespace: string
  externalProductCode: string
  adjustmentType: AdjustmentType
  direction: ObligationDirection
  basisNote: string
  note?: string | null
}

export type AdjustmentMappingWriteResult = { mappingId: number; updated: boolean; rowVersion: number; notice: string }
