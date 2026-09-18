// 中长期售电 P4 合同调整共享契约的类型侧伴随定义（#3013）。运行时见 adjustment.mjs。
// 接口 DTO 形状与 server/midlong/midlong-p4-api.mjs、midlong-p4-adjust-store-pg.mjs 的响应一一对应。
// 电量、价格、金额一律是规范十进制字符串（不是 number）；未知为 null，不是 0。
import type { TaxBasis } from './contract.mjs'

export type AdjustmentType = 'ADJUSTMENT' | 'TRANSFER' | 'PARTIAL_TERMINATION'
export type AdjustmentStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'EFFECTIVE'
export type ObligationDirection = 'OBLIGATION_INCREASE' | 'OBLIGATION_DECREASE'
export type AdjustmentDirectionSource = 'DOCUMENT_FIELD' | 'MAPPING_REGISTERED'
export type AdjustmentPendingReason = 'NO_DIRECTION'
export type AdjustmentPriceKind = 'transferPrice' | 'compensation' | 'handlingFee'

export declare const ADJUSTMENT_TYPES: readonly AdjustmentType[]
export declare const ADJUSTMENT_STATUSES: readonly AdjustmentStatus[]
export declare const OBLIGATION_DIRECTIONS: readonly ObligationDirection[]
export declare const ADJUSTMENT_DIRECTION_SOURCES: readonly AdjustmentDirectionSource[]
export declare const ADJUSTMENT_PENDING_REASONS: readonly AdjustmentPendingReason[]
export declare const ADJUSTMENT_PRICE_KINDS: readonly AdjustmentPriceKind[]

export declare const ADJUSTMENT_TYPE_LABELS: Readonly<Record<AdjustmentType, string>>
export declare const ADJUSTMENT_STATUS_LABELS: Readonly<Record<AdjustmentStatus, string>>
export declare const OBLIGATION_DIRECTION_LABELS: Readonly<Record<ObligationDirection, string>>
export declare const ADJUSTMENT_DIRECTION_SOURCE_LABELS: Readonly<Record<AdjustmentDirectionSource, string>>
export declare const ADJUSTMENT_PENDING_REASON_LABELS: Readonly<Record<AdjustmentPendingReason, string>>
export declare const ADJUSTMENT_PRICE_KIND_LABELS: Readonly<Record<AdjustmentPriceKind, string>>
export declare const ADJUSTMENT_NOTICES: Readonly<{
  directionNoInference: string
  directionPending: string
  directionFromMapping: string
  atomicEffect: string
  duplicateReplay: string
  segmentScopeOnly: string
  priceIndependent: string
  adjustableBalance: string
  baseMoved: string
  retroactive: string
  futureEffective: string
  unallocatedPool: string
  noVolumeChange: string
}>
export declare const FORBIDDEN_ADJUSTMENT_TERMS: readonly string[]

export interface AdjustmentSegmentInput {
  deliveryMonth: string
  quantity: string
}

export interface AdjustmentPriceInput {
  amount: string
  currency?: string
  taxBasis?: TaxBasis | 'UNKNOWN'
  note?: string | null
}

export declare function adjustmentContentFingerprint(value: {
  adjustmentType: AdjustmentType
  direction?: ObligationDirection | null
  externalProductCode?: string | null
  counterpartyName?: string | null
  businessEffectiveAt?: string | null
  prices?: Record<string, unknown> | null
  segments?: AdjustmentSegmentInput[]
}): string

export interface AdjustmentDirectionResolution {
  ok: boolean
  reason?: 'DIRECTION_CONFLICT'
  direction?: ObligationDirection | null
  source?: AdjustmentDirectionSource | null
  pendingReason?: AdjustmentPendingReason
  explicitDirection?: ObligationDirection
  mappingDirection?: ObligationDirection
  mappingType?: AdjustmentType
}

export declare function resolveAdjustmentDirection(input: {
  explicitDirection?: ObligationDirection | null
  mapping?: { direction: ObligationDirection; adjustmentType: AdjustmentType } | null
}): AdjustmentDirectionResolution

export interface AdjustableBalanceRow {
  deliveryMonth: string
  adjustableQuantity: string
  hasFormalAllocation: boolean
}

export declare function adjustableBalanceRows(input: {
  allocations?: Array<{ deliveryMonth: string; quantity: string; evidenceBasis: string }>
  months?: string[]
}): AdjustableBalanceRow[]

export interface AllocationSnapshotRow {
  deliveryMonth: string
  quantity: string
  price?: string | null
  priceStatus?: string
  evidenceBasis: string
  derivation?: string
}

export interface AdjustmentDeltaRow {
  deliveryMonth: string
  before: string
  after: string
  delta: string
}

export interface AdjustmentApplicationResult {
  ok: boolean
  exceeded?: Array<{ deliveryMonth: string; requested: string; adjustable: string }>
  missing?: string[]
  allocations?: AllocationSnapshotRow[]
  deltas?: AdjustmentDeltaRow[]
  totalDelta?: string
}

export declare function applyAdjustmentToAllocations(input: {
  allocations?: AllocationSnapshotRow[]
  direction?: ObligationDirection | null
  segments?: AdjustmentSegmentInput[]
}): AdjustmentApplicationResult
