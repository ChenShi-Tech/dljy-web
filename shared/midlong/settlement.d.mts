// 中长期售电 P5 业务复盘、账单与差异共享契约的类型侧伴随定义（#3015）。运行时见 settlement.mjs。
// 接口 DTO 形状与 server/midlong/midlong-p5-api.mjs、midlong-p5-*-store-pg.mjs 的响应一一对应。
// 电量、价格、金额、比率一律是规范十进制字符串（不是 number）；未知为 null，不是 0。
import type { PriceComponent, TaxBasis } from './contract.mjs'

export type BillKind = 'ITEMIZED' | 'UNITEMIZED'
export type DiscrepancyStatus = 'OPEN' | 'RECHECK_REQUIRED' | 'RESOLVED'
export type DiscrepancySide = 'POSITION_LEDGER' | 'EXTERNAL_BILL'
export type SettlementAttachmentPurpose = 'BILL_DOCUMENT' | 'PAYMENT_VOUCHER' | 'DISCREPANCY_EVIDENCE'
export type SettlementEventType =
  | 'BILL_REGISTERED' | 'BILL_REVISED' | 'BILL_VOUCHER_ADDED'
  | 'DISCREPANCY_REGISTERED' | 'DISCREPANCY_UPDATED' | 'DISCREPANCY_RESOLVED' | 'DISCREPANCY_RECHECK_REQUIRED'
  | 'REVIEW_REPORT_GENERATED'
export type ReviewReportScope = 'SUBJECT' | 'COMPANY'
export type GreenComposition = 'TOTAL_INCLUDES_ENVIRONMENT' | 'ENERGY_PLUS_ENVIRONMENT' | 'ENVIRONMENT_UNKNOWN'
export type ReportInputKind = 'CONTRACT' | 'PLAN' | 'CONFIRMATION' | 'BILL'

export declare const BILL_KINDS: readonly BillKind[]
export declare const DISCREPANCY_STATUSES: readonly DiscrepancyStatus[]
export declare const DISCREPANCY_SIDES: readonly DiscrepancySide[]
export declare const SETTLEMENT_ATTACHMENT_PURPOSES: readonly SettlementAttachmentPurpose[]
export declare const SETTLEMENT_EVENT_TYPES: readonly SettlementEventType[]
export declare const REVIEW_REPORT_SCOPES: readonly ReviewReportScope[]
export declare const SETTLEMENT_ERROR_CODES: readonly string[]
export declare const SETTLEMENT_ERROR_LABELS: Readonly<Record<string, string>>

export declare const BILL_KIND_LABELS: Readonly<Record<BillKind, string>>
export declare const DISCREPANCY_STATUS_LABELS: Readonly<Record<DiscrepancyStatus, string>>
export declare const DISCREPANCY_SIDE_LABELS: Readonly<Record<DiscrepancySide, string>>
export declare const SETTLEMENT_ATTACHMENT_PURPOSE_LABELS: Readonly<Record<SettlementAttachmentPurpose, string>>
export declare const SETTLEMENT_EVENT_TYPE_LABELS: Readonly<Record<SettlementEventType, string>>
export declare const REVIEW_REPORT_SCOPE_LABELS: Readonly<Record<ReviewReportScope, string>>
export declare const SETTLEMENT_NOTICES: Readonly<{
  threeAmounts: string
  nominalNotSettlement: string
  billedCurrentRevision: string
  unitemizedArchive: string
  noVoucherNoReceipt: string
  notIndependentlyRecomputed: string
  consistencyNotRecompute: string
  discrepancyNoAutoLedger: string
  resolutionNoteRequired: string
  billRevisionRecheck: string
  comparableGroupsOnly: string
  reviewScopeOnly: string
  greenTotalIncludesEnvironment: string
  greenEnvironmentMissing: string
  reportFrozen: string
  reportSuperseded: string
}>
export declare const FORBIDDEN_REVIEW_TERMS: readonly string[]
export declare const FORBIDDEN_SETTLEMENT_TERMS: readonly string[]

export interface BillLineItemInput {
  deliveryMonth?: string | null
  quantity?: string | null
  price?: string | null
  amount?: string | null
  note?: string | null
}

export declare function billContentFingerprint(value: {
  billKind: BillKind
  sourceName?: string | null
  externalRevisionLabel?: string | null
  periodStartMonth?: string
  periodEndMonth?: string
  currency?: string
  taxBasis?: TaxBasis | null
  priceComponent?: PriceComponent | null
  amount?: string
  lineItems?: BillLineItemInput[]
}): string

export interface QuantityPriceDelta {
  quantityDelta: string | null
  priceDelta: string | null
  priceComparable: boolean
  basis: string
  comparableSides: string[]
}
export declare function computeQuantityPriceDelta(input: {
  ledgerQuantity?: string | null
  ledgerPrice?: string | null
  ledgerCurrency?: string
  ledgerTaxBasis?: TaxBasis
  externalQuantity?: string | null
  externalPrice?: string | null
  externalCurrency?: string
  externalTaxBasis?: TaxBasis
}): QuantityPriceDelta

export interface SettlementAmountCoverageRow {
  amount: string | null
  source: string
  sourceLabel: string
  coverage: 'COMPLETE' | 'PARTIAL' | 'MISSING'
}
export interface SettlementAmounts {
  month: string
  nominalAmount: SettlementAmountCoverageRow & {
    groups: Array<{ currency: string; taxBasis: string; priceComponent: string; knownQuantity: string; notionalAmount: string }>
    notice: string
  }
  billedAmount: SettlementAmountCoverageRow & {
    quantity: string | null
    unitemizedBillCount: number
    currentRevisionOnly: boolean
    notice: string
  }
  receivedAmount: SettlementAmountCoverageRow & { voucherCount: number; notice: string }
  independentlyRecomputed: { status: 'NOT_PERFORMED'; reason: string }
  notice: string
}
export declare function buildSettlementAmounts(input: {
  month: string
  nominal: { amount: string | null; complete: boolean; groups?: Array<{ currency: string; taxBasis: string; priceComponent: string; knownQuantity: string; notionalAmount: string }>; unknownPriceQuantity?: string; coverageRatio?: string | null }
  bills?: Array<{ billId: number; currentRevisionNo: number; billKind: BillKind; currency: string; inPeriod: boolean; monthItemAmount: string | null; monthItemQuantity: string | null }>
  unitemizedBillCount?: number
  voucherAmount?: string | null
  voucherCount?: number
}): SettlementAmounts

export interface GreenPricingComposition {
  unitTotal: string | null
  energyUnit: string | null
  environmentUnit: string | null
  notionalAmount: string | null
  composition: GreenComposition
  gaps: string[]
}
export declare function greenPricingComposition(input: {
  quantity?: string | null
  sellerPrice?: string | null
  environmentPrice?: string | null
  priceComponent?: PriceComponent | null
}): GreenPricingComposition

export interface ReportInputChange {
  kind: ReportInputKind
  id: number
  from: number | null
  to: number | null
}
export interface ReportInputFreeze {
  asOf?: string | null
  contracts?: Record<string, number>
  plans?: Record<string, number>
  confirmations?: Record<string, number>
  bills?: Record<string, number>
  [key: string]: unknown
}
export declare function reportInputChanges(previous?: ReportInputFreeze, next?: ReportInputFreeze): ReportInputChange[]
export declare function reportContentFingerprint(input: { inputFreeze?: ReportInputFreeze | null; metrics?: object | null }): string

export interface ComparableGroupSummary {
  groups: Array<{ currency: string; taxBasis: string; priceComponent: string; knownQuantity: string; notionalAmount: string; averagePrice: string | null }>
  comparable: boolean
  averagePrice: string | null
  notionalAmount: string | null
  ranking: null
  rankingNotice: string | null
}
export declare function summarizeComparableGroups(groups?: Array<{ currency: string; taxBasis: string; priceComponent: string; knownQuantity: string; notionalAmount: string }>): ComparableGroupSummary
