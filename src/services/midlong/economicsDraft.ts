// 中长期合同经济内容的表单草稿（dljy#2939）：表单里一律是字符串，提交时空串转 null（未填 = 未知，不是 0）。
import type { EvidenceBasis, MidlongEconomicsInput, MidlongRevision } from './midlongTypes'

export type AllocationRow = { uid: number; deliveryMonth: string; quantity: string; price: string; evidenceBasis: EvidenceBasis }
export type EconomicsDraft = {
  totalQuantity: string
  quantityUnit: string
  sellerPrice: string
  priceUnit: string
  priceType: string
  taxBasis: string
  priceComponent: string
  environmentPrice: string
  deliveryStart: string
  deliveryEnd: string
  allocationDeclaredComplete: boolean
  allocations: AllocationRow[]
}

let uidSeed = 0
export function nextRowUid(): number {
  uidSeed += 1
  return uidSeed
}

export function emptyEconomicsDraft(): EconomicsDraft {
  return {
    totalQuantity: '', quantityUnit: 'MWh', sellerPrice: '', priceUnit: '元/MWh', priceType: '', taxBasis: '', priceComponent: '',
    environmentPrice: '', deliveryStart: '', deliveryEnd: '', allocationDeclaredComplete: false, allocations: [],
  }
}

/** 从版本（规范单位 MWh、元/MWh）回填表单；「单月交割期」推导行不回填，保存时会重新推导。 */
export function draftFromRevision(revision: MidlongRevision): EconomicsDraft {
  return {
    totalQuantity: revision.totalQuantity ?? '',
    quantityUnit: 'MWh',
    sellerPrice: revision.sellerPrice ?? '',
    priceUnit: '元/MWh',
    priceType: revision.priceType ?? '',
    taxBasis: revision.taxBasis ?? '',
    priceComponent: revision.priceComponent ?? '',
    environmentPrice: revision.environmentPrice ?? '',
    deliveryStart: revision.deliveryStart ?? '',
    deliveryEnd: revision.deliveryEnd ?? '',
    allocationDeclaredComplete: revision.allocationDeclaredComplete,
    allocations: revision.allocations
      .filter((a) => a.derivation !== 'SINGLE_MONTH_TERMS')
      .map((a) => ({ uid: nextRowUid(), deliveryMonth: a.deliveryMonth, quantity: a.quantity, price: a.price ?? '', evidenceBasis: a.evidenceBasis })),
  }
}

export function toEconomicsInput(draft: EconomicsDraft): MidlongEconomicsInput {
  const text = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    totalQuantity: text(draft.totalQuantity),
    quantityUnit: text(draft.quantityUnit),
    sellerPrice: text(draft.sellerPrice),
    priceUnit: text(draft.priceUnit),
    priceType: (text(draft.priceType) as MidlongEconomicsInput['priceType']) ?? null,
    taxBasis: (text(draft.taxBasis) as MidlongEconomicsInput['taxBasis']) ?? null,
    priceComponent: (text(draft.priceComponent) as MidlongEconomicsInput['priceComponent']) ?? null,
    environmentPrice: text(draft.environmentPrice),
    deliveryStart: text(draft.deliveryStart),
    deliveryEnd: text(draft.deliveryEnd),
    allocationDeclaredComplete: draft.allocationDeclaredComplete,
    allocations: draft.allocations
      .filter((row) => row.deliveryMonth || row.quantity.trim() || row.price.trim())
      .map((row) => ({
        deliveryMonth: row.deliveryMonth, quantity: row.quantity.trim(), price: text(row.price), evidenceBasis: row.evidenceBasis,
        quantityUnit: text(draft.quantityUnit), priceUnit: text(draft.priceUnit),
      })),
  }
}
