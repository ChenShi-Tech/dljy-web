// 中长期合同经济内容的规范化与校验（#2938）。草稿录入、文件导入、录入更正、存量纳管
// 四条写路径共用这一份规则——口径只有一处，任何一条路径都不能比另一条宽松。
//
// 关键红线（specs MC-02 / MP-02 / MI-03 / design D3）：
// - 空值不转零：未提供价格 = UNKNOWN，明确填 0 = KNOWN 的 0，两者不同。
// - 买方价格永远不代替售电价格（本模块根本不接收买方价）。
// - 电量必须有明确单位；不能确定单位就报错，不默认。
// - 月分解：正式资料合计不得超过合同总量；声明完整时必须守恒（规范精度后严格相等，
//   模板声明容差才放宽）；不完整时暴露剩余未分解量。内部估算行保存但不计入正式分解。
// - 不按比例缩放、不均摊。

import {
  ALLOCATION_COMPLETENESS, CANONICAL_ENERGY_UNIT, CANONICAL_PRICE_UNIT, CURRENCIES, ENERGY_UNIT_FACTORS,
  EVIDENCE_BASES, MAX_IMPORT_DECIMALS, PRICE_COMPONENTS, PRICE_TYPES, PRICE_UNIT_FACTORS, TAX_BASES,
} from './contract.mjs'
import {
  decimalCompare, decimalIsZero, decimalMul, decimalRound, decimalSub, decimalSum, parseDecimal,
} from './decimal.mjs'
import { deliveryMonths, isIsoDate, monthKeyOf, monthLastDay, normalizeDate, normalizeMonth } from './dates.mjs'

const NUMBER_ERROR_MESSAGES = {
  NOT_A_NUMBER: '不是有效数字',
  NEGATIVE: '不能为负数',
  PRECISION_EXCEEDED: `小数位超过 ${MAX_IMPORT_DECIMALS} 位，请确认是否按 ${MAX_IMPORT_DECIMALS} 位四舍五入保存`,
}

function issue(field, code, message, extra = {}) {
  return { field, code, message, ...extra }
}

/** 从「合同电量（MWh）」这类表头或单位列中识别单位；无法识别返回 null。 */
export function resolveUnit(raw, kind) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const table = kind === 'price' ? PRICE_UNIT_FACTORS : ENERGY_UNIT_FACTORS
  if (Object.hasOwn(table, text)) return text
  const lower = text.toLowerCase().replace(/\s+/g, '')
  for (const unit of Object.keys(table)) {
    if (unit.toLowerCase() === lower) return unit
  }
  return null
}

/** 表头括号里的单位：「合同电量（MWh）」→ MWh。 */
export function unitFromHeader(header, kind) {
  const m = /[（(]([^）)]+)[）)]\s*$/.exec(String(header ?? '').trim())
  return m ? resolveUnit(m[1], kind) : null
}

/**
 * 数量/价格字段：解析 → 精度处理 → 单位换算。
 * @returns {{ value: string|null, source: string|null, issues: object[] }}
 *   value 为换算到规范单位后的十进制字符串；未提供为 null（不是 '0'）。
 */
export function normalizeMeasure(raw, { field, unit, kind, required = false, acceptPrecisionRounding = false }) {
  const issues = []
  const parsed = parseDecimal(raw, { maxScale: acceptPrecisionRounding ? null : MAX_IMPORT_DECIMALS })
  if (!parsed.ok) {
    if (parsed.code === 'EMPTY') {
      if (required) issues.push(issue(field, 'REQUIRED', '必填'))
      return { value: null, source: null, issues }
    }
    issues.push(issue(field, parsed.code, NUMBER_ERROR_MESSAGES[parsed.code] ?? '数值无效', { value: String(raw) }))
    return { value: null, source: null, issues }
  }
  const factors = kind === 'price' ? PRICE_UNIT_FACTORS : ENERGY_UNIT_FACTORS
  const resolvedUnit = resolveUnit(unit, kind)
  if (!resolvedUnit) {
    issues.push(issue(field, 'UNIT_REQUIRED', unit
      ? `无法识别的${kind === 'price' ? '价格' : '电量'}单位「${unit}」`
      : `未声明${kind === 'price' ? '价格' : '电量'}单位，请在单位列或导入映射中明确后重新预览`))
    return { value: null, source: parsed.value, issues }
  }
  let sourceValue = parsed.value
  if (acceptPrecisionRounding && parsed.scale > MAX_IMPORT_DECIMALS) {
    sourceValue = decimalRound(parsed.value, MAX_IMPORT_DECIMALS)
    issues.push(issue(field, 'PRECISION_ROUNDED', `原值 ${parsed.value} 已按确认四舍五入为 ${sourceValue}`, { severity: 'warning' }))
  }
  return {
    value: decimalMul(sourceValue, factors[resolvedUnit]),
    source: `${parsed.value} ${resolvedUnit}`,
    issues,
  }
}

function enumOrIssue(value, allowed, field, { required = false, fallback = null } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) return { value: null, issues: [issue(field, 'REQUIRED', '必填')] }
    return { value: fallback, issues: [] }
  }
  if (!allowed.includes(value)) return { value: null, issues: [issue(field, 'INVALID_ENUM', `不支持的取值「${value}」`)] }
  return { value, issues: [] }
}

/** 按交割期派生交割周期（确定性推导，不是猜测）。 */
export function deriveDeliveryCycle(deliveryStart, deliveryEnd) {
  if (!isIsoDate(deliveryStart) || !isIsoDate(deliveryEnd) || deliveryEnd < deliveryStart) return null
  const months = deliveryMonths(deliveryStart, deliveryEnd)
  const fullMonths = deliveryStart.endsWith('-01') && deliveryEnd === monthLastDay(monthKeyOf(deliveryEnd))
  if (months.length === 1) return fullMonths ? 'MONTH' : 'WITHIN_MONTH'
  if (months.length === 12 && fullMonths && deliveryStart.slice(5) === '01-01') return 'YEAR'
  return 'MULTI_MONTH'
}

/**
 * 经济内容规范化与校验。
 *
 * @param {object} input
 *   documentKind, totalQuantity, quantityUnit, sellerPrice, priceUnit, priceType, taxBasis, priceComponent,
 *   currency, environmentPrice, deliveryStart, deliveryEnd, allocationDeclaredComplete,
 *   allocations: [{ deliveryMonth, quantity, quantityUnit?, price?, priceUnit?, evidenceBasis }]
 * @param {{ acceptPrecisionRounding?: boolean, conservationTolerance?: string }} [options]
 *   conservationTolerance 为模板声明的舍入容差（MWh），未核实模板为 '0'（严格相等）。
 * @returns {{ value: object, errors: object[], warnings: object[] }}
 */
export function normalizeEconomics(input, { acceptPrecisionRounding = false, conservationTolerance = '0' } = {}) {
  const all = []
  const src = input ?? {}
  const obligation = src.documentKind !== 'FRAMEWORK'

  const deliveryStart = src.deliveryStart ? normalizeDate(src.deliveryStart) : null
  const deliveryEnd = src.deliveryEnd ? normalizeDate(src.deliveryEnd) : null
  if (src.deliveryStart && !deliveryStart) all.push(issue('deliveryStart', 'INVALID_DATE', '日期无效（应为 YYYY-MM-DD）', { value: String(src.deliveryStart) }))
  if (src.deliveryEnd && !deliveryEnd) all.push(issue('deliveryEnd', 'INVALID_DATE', '日期无效（应为 YYYY-MM-DD）', { value: String(src.deliveryEnd) }))
  if (deliveryStart && deliveryEnd && deliveryEnd < deliveryStart) {
    all.push(issue('deliveryEnd', 'DATE_RANGE_INVERTED', '交割结束日期早于开始日期'))
  }

  const quantity = normalizeMeasure(src.totalQuantity, {
    field: 'totalQuantity', unit: src.quantityUnit, kind: 'energy', acceptPrecisionRounding,
  })
  all.push(...quantity.issues)

  const price = normalizeMeasure(src.sellerPrice, {
    field: 'sellerPrice', unit: src.priceUnit, kind: 'price', acceptPrecisionRounding,
  })
  all.push(...price.issues)
  const environment = normalizeMeasure(src.environmentPrice, {
    field: 'environmentPrice', unit: src.priceUnit, kind: 'price', acceptPrecisionRounding,
  })
  all.push(...environment.issues)

  const priceKnown = price.value !== null
  const priceType = enumOrIssue(src.priceType || null, PRICE_TYPES, 'priceType', { fallback: priceKnown ? 'FIXED' : null })
  const taxBasis = enumOrIssue(src.taxBasis || null, TAX_BASES, 'taxBasis', { fallback: 'UNKNOWN' })
  const priceComponent = enumOrIssue(src.priceComponent || null, PRICE_COMPONENTS, 'priceComponent', {
    fallback: src.energyAttribute === 'GREEN' ? 'UNVERIFIED' : 'ENERGY_ONLY',
  })
  const currency = enumOrIssue(src.currency || null, CURRENCIES, 'currency', { fallback: 'CNY' })
  all.push(...priceType.issues, ...taxBasis.issues, ...priceComponent.issues, ...currency.issues)
  if (priceType.value === 'TIME_OF_USE' && priceKnown) {
    all.push(issue('sellerPrice', 'TIME_OF_USE_SINGLE_PRICE', '分时价合同不能用单一售电价格代表，请在月度分解中填写各月价格或留空待 P2 分时资料'))
  }

  // ── 月度分解 ──
  const months = deliveryStart && deliveryEnd && deliveryEnd >= deliveryStart ? deliveryMonths(deliveryStart, deliveryEnd) : []
  const monthSet = new Set(months)
  const allocations = []
  const seen = new Set()
  const rows = Array.isArray(src.allocations) ? src.allocations : []
  rows.forEach((row, index) => {
    const rowIssues = []
    const deliveryMonth = normalizeMonth(row?.deliveryMonth)
    if (!deliveryMonth) rowIssues.push(issue('deliveryMonth', row?.deliveryMonth ? 'INVALID_MONTH' : 'REQUIRED', row?.deliveryMonth ? '月份无效（应为 YYYY-MM）' : '必填'))
    else if (months.length && !monthSet.has(deliveryMonth)) rowIssues.push(issue('deliveryMonth', 'MONTH_OUT_OF_RANGE', `月份 ${deliveryMonth} 不在交割期内`))
    const basis = enumOrIssue(row?.evidenceBasis || null, EVIDENCE_BASES, 'evidenceBasis', { required: true })
    rowIssues.push(...basis.issues)
    const key = `${deliveryMonth}|${basis.value}`
    if (deliveryMonth && basis.value && seen.has(key)) rowIssues.push(issue('deliveryMonth', 'DUPLICATE_MONTH', `月份 ${deliveryMonth} 重复出现`))
    seen.add(key)
    const qty = normalizeMeasure(row?.quantity, {
      field: 'quantity', unit: row?.quantityUnit ?? src.quantityUnit, kind: 'energy', required: true, acceptPrecisionRounding,
    })
    const rowPrice = normalizeMeasure(row?.price, {
      field: 'price', unit: row?.priceUnit ?? src.priceUnit, kind: 'price', acceptPrecisionRounding,
    })
    rowIssues.push(...qty.issues, ...rowPrice.issues)
    for (const it of rowIssues) all.push({ ...it, allocationIndex: index })
    if (!rowIssues.some((it) => it.severity !== 'warning')) {
      allocations.push({
        deliveryMonth,
        quantity: qty.value,
        sourceQuantity: qty.source,
        price: rowPrice.value,
        priceStatus: rowPrice.value === null ? 'UNKNOWN' : 'KNOWN',
        sourcePrice: rowPrice.source,
        evidenceBasis: basis.value,
        derivation: 'SOURCE_ROW',
      })
    }
  })

  const formal = allocations.filter((a) => a.evidenceBasis === 'FORMAL')
  let formalAllocated = decimalSum(formal.map((a) => a.quantity))
  const declaredComplete = src.allocationDeclaredComplete === true
  const total = quantity.value

  // 单月交割且未给出分解：月份由合同条款本身确定，不是均摊（MP-01/02）。
  if (obligation && total !== null && months.length === 1 && rows.length === 0) {
    allocations.push({
      deliveryMonth: months[0],
      quantity: total,
      sourceQuantity: quantity.source,
      price: null,
      priceStatus: 'UNKNOWN',
      sourcePrice: null,
      evidenceBasis: 'FORMAL',
      derivation: 'SINGLE_MONTH_TERMS',
    })
    formalAllocated = total
  }

  let completeness = 'NONE'
  let unallocated = null
  if (total !== null) {
    const over = decimalCompare(formalAllocated, total) > 0
    const gap = decimalSub(total, formalAllocated)
    if (over) {
      all.push(issue('allocations', 'ALLOCATION_EXCEEDS_TOTAL',
        `正式月度分解合计 ${formalAllocated} MWh 超过合同电量 ${total} MWh（差额 ${decimalSub(formalAllocated, total)} MWh）`,
        { difference: decimalSub(formalAllocated, total) }))
    } else if (decimalIsZero(gap)) {
      completeness = formal.length || allocations.some((a) => a.derivation === 'SINGLE_MONTH_TERMS') ? 'COMPLETE' : 'NONE'
    } else if (declaredComplete && decimalCompare(gap, conservationTolerance) <= 0) {
      completeness = 'COMPLETE'
      all.push(issue('allocations', 'ALLOCATION_WITHIN_TOLERANCE', `分解与合同电量相差 ${gap} MWh，在模板容差 ${conservationTolerance} MWh 内`, { severity: 'warning' }))
    } else if (declaredComplete) {
      all.push(issue('allocations', 'ALLOCATION_NOT_CONSERVED',
        `声明分解完整，但正式月度分解合计 ${formalAllocated} MWh 与合同电量 ${total} MWh 相差 ${gap} MWh`,
        { difference: gap }))
    } else {
      completeness = formal.length ? 'PARTIAL' : 'NONE'
    }
    if (!over) unallocated = decimalSub(total, completeness === 'COMPLETE' ? total : formalAllocated)
  } else if (formal.length) {
    completeness = 'PARTIAL'
  }

  if (obligation && total !== null && decimalIsZero(total)) {
    all.push(issue('totalQuantity', 'ZERO_QUANTITY', '电量合同的合同电量为 0，请核对', { severity: 'warning' }))
  }

  const errors = all.filter((it) => it.severity !== 'warning')
  const warnings = all.filter((it) => it.severity === 'warning')
  return {
    value: {
      totalQuantity: total,
      sourceQuantity: quantity.source,
      quantityUnit: CANONICAL_ENERGY_UNIT,
      sellerPrice: price.value,
      priceStatus: priceKnown ? 'KNOWN' : 'UNKNOWN',
      sourcePrice: price.source,
      priceUnit: CANONICAL_PRICE_UNIT,
      priceType: priceType.value,
      taxBasis: taxBasis.value ?? 'UNKNOWN',
      priceComponent: priceComponent.value ?? 'UNVERIFIED',
      currency: currency.value ?? 'CNY',
      environmentPrice: environment.value,
      deliveryStart,
      deliveryEnd,
      allocationDeclaredComplete: declaredComplete,
      allocationCompleteness: ALLOCATION_COMPLETENESS.includes(completeness) ? completeness : 'NONE',
      allocations: allocations.sort((a, b) => (a.deliveryMonth < b.deliveryMonth ? -1 : a.deliveryMonth > b.deliveryMonth ? 1 : 0)),
      formalAllocatedQuantity: formalAllocated,
      unallocatedQuantity: unallocated,
    },
    errors,
    warnings,
  }
}

/**
 * 经济内容指纹：用于导入去重「同身份同内容 → 跳过；不同内容 → 冲突」。
 * 只比较业务含义（规范单位下的值），不比较原文写法——「1 GWh」与「1000 MWh」同内容。
 */
export function economicFingerprint(value, identity = {}) {
  const v = value ?? {}
  const allocations = (v.allocations ?? [])
    .filter((a) => a.derivation !== 'SINGLE_MONTH_TERMS')
    .map((a) => [a.deliveryMonth, canonicalOrNull(a.quantity), canonicalOrNull(a.price), a.evidenceBasis])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return JSON.stringify({
    documentKind: identity.documentKind ?? null,
    productKind: identity.productKind ?? null,
    tradeMethod: identity.tradeMethod ?? null,
    marketScope: identity.marketScope ?? null,
    energyAttribute: identity.energyAttribute ?? null,
    stationId: identity.stationId ?? null,
    deliveryStart: v.deliveryStart ?? null,
    deliveryEnd: v.deliveryEnd ?? null,
    totalQuantity: canonicalOrNull(v.totalQuantity),
    sellerPrice: canonicalOrNull(v.sellerPrice),
    priceType: v.priceType ?? null,
    taxBasis: v.taxBasis ?? null,
    priceComponent: v.priceComponent ?? null,
    environmentPrice: canonicalOrNull(v.environmentPrice),
    allocationDeclaredComplete: Boolean(v.allocationDeclaredComplete),
    allocations,
  })
}

/** 两份经济内容的字段级差异（给冲突核对页展示）。 */
export function economicDiff(existing, incoming) {
  const a = JSON.parse(economicFingerprint(existing.value, existing.identity))
  const b = JSON.parse(economicFingerprint(incoming.value, incoming.identity))
  const diffs = []
  for (const key of Object.keys(b)) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) diffs.push({ field: key, existing: a[key], incoming: b[key] })
  }
  return diffs
}

function canonicalOrNull(value) {
  if (value === null || value === undefined) return null
  const parsed = parseDecimal(value, { allowNegative: true })
  return parsed.ok ? parsed.value : String(value)
}

/**
 * 有效售电价格（持仓计价用）：月分解行价格优先，其次合同级固定售电价格；都未知返回 null。
 * 分时价合同没有合同级单一价格，只能用月分解价格。
 */
export function effectiveAllocationPrice(allocation, revision) {
  if (allocation?.priceStatus === 'KNOWN' && allocation.price !== null && allocation.price !== undefined) return allocation.price
  if (revision?.priceType !== 'TIME_OF_USE' && revision?.priceStatus === 'KNOWN' && revision.sellerPrice !== null && revision.sellerPrice !== undefined) {
    return revision.sellerPrice
  }
  return null
}

/**
 * 质量缺口集合（MC-03：可并存、多值）。价格或分解缺失不抹除已证明的义务，只作提示。
 * @param {{ documentKind, subjectId, subjectUnitCode, stationId, verificationEvidenceCount, legacyBuyerPriceOnly, economics }} input
 */
export function deriveQualityFlags(input) {
  const flags = []
  const e = input?.economics ?? {}
  const obligation = input?.documentKind !== 'FRAMEWORK'
  if (!input?.subjectId) flags.push('MISSING_SUBJECT')
  else if (!input?.subjectUnitCode) flags.push('SUBJECT_UNIT_CODE_MISSING')
  if (obligation && !input?.stationId) flags.push('STATION_UNALLOCATED')
  if (!input?.verificationEvidenceCount) flags.push('MISSING_EVIDENCE')
  if (!obligation) return flags
  if (e.totalQuantity === null || e.totalQuantity === undefined) flags.push('MISSING_QUANTITY')
  if (!e.deliveryStart || !e.deliveryEnd) flags.push('MISSING_DELIVERY_PERIOD')
  const formal = (e.allocations ?? []).filter((a) => a.evidenceBasis === 'FORMAL')
  const priced = formal.length
    ? formal.every((a) => effectiveAllocationPrice(a, e) !== null)
    : effectiveAllocationPrice(null, e) !== null
  if (!priced) flags.push('MISSING_PRICE')
  if ((e.priceStatus === 'KNOWN' || formal.some((a) => a.priceStatus === 'KNOWN')) && e.taxBasis === 'UNKNOWN') flags.push('TAX_BASIS_UNKNOWN')
  if (e.priceComponent === 'UNVERIFIED') flags.push('PRICE_COMPONENT_UNVERIFIED')
  if (e.allocationCompleteness === 'NONE') flags.push('MISSING_MONTHLY_ALLOCATION')
  if (e.allocationCompleteness === 'PARTIAL') flags.push('PARTIAL_MONTHLY_ALLOCATION')
  if ((e.allocations ?? []).some((a) => a.evidenceBasis === 'INTERNAL_ESTIMATE')) flags.push('ESTIMATED_ALLOCATION_EXCLUDED')
  if (input?.legacyBuyerPriceOnly) flags.push('LEGACY_BUYER_PRICE_ONLY')
  return flags
}

/** 有效义务电量合计（给列表统计用）：只数正式口径、不做任何均摊。 */
export function sumQuantities(values) {
  return decimalSum(values.filter((v) => v !== null && v !== undefined))
}

