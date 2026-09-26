// 中长期合同经济内容规范化的类型侧伴随定义（#2938）。运行时见 economics.mjs。
import type {
  AllocationCompleteness, DeliveryCycle, DocumentKind, EnergyAttribute, MidlongAllocation, MidlongEconomicsInput,
  PriceComponent, PriceStatus, PriceType, QualityFlag, TaxBasis,
} from './contract.mjs'

export interface EconomicsIssue {
  field: string
  code: string
  message: string
  allocationIndex?: number
  value?: string
  difference?: string
  severity?: 'warning'
}

export interface NormalizedEconomics {
  totalQuantity: string | null
  sourceQuantity: string | null
  quantityUnit: 'MWh'
  sellerPrice: string | null
  priceStatus: PriceStatus
  sourcePrice: string | null
  priceUnit: '元/MWh'
  priceType: PriceType | null
  taxBasis: TaxBasis
  priceComponent: PriceComponent
  currency: 'CNY'
  environmentPrice: string | null
  deliveryStart: string | null
  deliveryEnd: string | null
  allocationDeclaredComplete: boolean
  allocationCompleteness: AllocationCompleteness
  allocations: Omit<MidlongAllocation, 'id' | 'revisionId'>[]
  formalAllocatedQuantity: string
  unallocatedQuantity: string | null
}

export declare function resolveUnit(raw: unknown, kind: 'energy' | 'price'): string | null
export declare function unitFromHeader(header: string, kind: 'energy' | 'price'): string | null
export declare function normalizeMeasure(raw: unknown, options: { field: string; unit: unknown; kind: 'energy' | 'price'; required?: boolean; acceptPrecisionRounding?: boolean }): { value: string | null; source: string | null; issues: EconomicsIssue[] }
export declare function deriveDeliveryCycle(deliveryStart: string | null, deliveryEnd: string | null): DeliveryCycle | null
export declare function normalizeEconomics(
  input: MidlongEconomicsInput & { documentKind?: DocumentKind | null; energyAttribute?: EnergyAttribute | null },
  options?: { acceptPrecisionRounding?: boolean; conservationTolerance?: string },
): { value: NormalizedEconomics; errors: EconomicsIssue[]; warnings: EconomicsIssue[] }
export declare function economicFingerprint(value: Partial<NormalizedEconomics>, identity?: Record<string, unknown>): string
export declare function economicDiff(existing: { value: Partial<NormalizedEconomics>; identity?: Record<string, unknown> }, incoming: { value: Partial<NormalizedEconomics>; identity?: Record<string, unknown> }): Array<{ field: string; existing: unknown; incoming: unknown }>
export declare function effectiveAllocationPrice(allocation: { priceStatus?: PriceStatus; price?: string | null } | null, revision: { priceType?: PriceType | null; priceStatus?: PriceStatus; sellerPrice?: string | null } | null): string | null
export declare function deriveQualityFlags(input: {
  documentKind?: DocumentKind
  subjectId?: number | null
  subjectUnitCode?: string | null
  stationId?: number | null
  verificationEvidenceCount?: number
  legacyBuyerPriceOnly?: boolean
  economics?: Partial<NormalizedEconomics>
}): QualityFlag[]
export declare function sumQuantities(values: Array<string | null | undefined>): string
