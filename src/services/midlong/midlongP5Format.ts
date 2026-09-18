// 中长期售电 P5 页面的展示口径（dljy#3016）：纯函数，页面与单测共用。
//
// 红线（specs MR-01..06，与 shared 契约的固定文案一致）：
// - 复盘只陈述中长期量价事实：不推断现货择时收益、套保收益或实际利润（FORBIDDEN_REVIEW_TERMS 测试红线），
//   不读取现货、预测数据；不可比价格分组分列展示、不给统一均价与排名。
// - 三种金额分离（MR-02）：名义/账单/收款逐项附来源与覆盖状态；无凭证不显示到账；
//   independentlyRecomputed=NOT_PERFORMED 只能显示「未独立复算」，绝不显示「复算通过」类结论（FORBIDDEN_SETTLEMENT_TERMS）。
// - 综合账单（UNITEMIZED）只归档标未分项：不按比例猜分、不产生臆造中长期收入（MR-03）。
// - 差值如实显示（外部 − 台账：1000 对 980 显示 −20）；登记不自动改台账；关闭必须有处理说明（MR-04）。
// - 未知显示「未知/待核对/未分项/缺资料」，不显示 0；负差量原样显示（减少就是减少）。
import { fmtAmount, fmtPrice, fmtQuantity } from './midlongFormat'
import {
  BILL_KIND_LABELS, DISCREPANCY_STATUS_LABELS, REVIEW_REPORT_SCOPE_LABELS, SETTLEMENT_ERROR_LABELS, SETTLEMENT_NOTICES,
  type BillKind, type DiscrepancyStatus, type SettlementAmountCoverageRow, type SettlementAmounts,
} from './midlongP5Types'

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

// ── 三种金额分离（MR-02）────────────────────────────────────────────────────

export const COVERAGE_LABELS: Record<SettlementAmountCoverageRow['coverage'], string> = {
  COMPLETE: '覆盖完整',
  PARTIAL: '部分覆盖',
  MISSING: '缺资料',
}

export function coverageLabel(coverage: SettlementAmountCoverageRow['coverage']): string {
  return COVERAGE_LABELS[coverage] ?? coverage
}

export type SettlementAmountViewRow = {
  key: 'nominal' | 'billed' | 'received'
  title: string
  amountText: string
  sourceLabel: string
  coverageText: string
  extra: string
}

/**
 * 三种金额的展示行（MR-02）：名义（持仓口径）/ 账单（当前有效版本分项）/ 收款（仅有凭证部分）。
 * - 收款 null（无凭证）显示「无凭证（未显示到账）」，不显示 0；
 * - 账单行附未分项归档计数；名义行多口径不可比时不给汇总（分组见持仓价格分组表）；
 * - 复算状态恒为 NOT_PERFORMED：只显示「未独立复算」，不出现「复算通过」类结论。
 */
export function settlementAmountRows(settlement: SettlementAmounts | null | undefined): SettlementAmountViewRow[] {
  if (!settlement) return []
  const nominal = settlement.nominalAmount
  const billed = settlement.billedAmount
  const received = settlement.receivedAmount
  return [
    {
      key: 'nominal',
      title: '合同名义量价金额',
      amountText: nominal.amount === null
        ? (nominal.groups.length > 1 ? '口径不可比（见分组，不给汇总）' : '缺资料（无已知价格）')
        : `${fmtAmount(nominal.amount)} 元`,
      sourceLabel: nominal.sourceLabel,
      coverageText: coverageLabel(nominal.coverage),
      extra: nominal.groups.length > 1 ? SETTLEMENT_NOTICES.comparableGroupsOnly : '',
    },
    {
      key: 'billed',
      title: '外部中长期账单金额',
      amountText: billed.amount === null ? '缺资料（未登记分项）' : `${fmtAmount(billed.amount)} 元`,
      sourceLabel: billed.sourceLabel,
      coverageText: coverageLabel(billed.coverage),
      extra: [billed.quantity !== null ? `分项电量 ${fmtQuantity(billed.quantity)} MWh` : '', billed.unitemizedBillCount > 0 ? `另有 ${billed.unitemizedBillCount} 张综合账单仅归档（未分项）` : ''].filter(Boolean).join(' · '),
    },
    {
      key: 'received',
      title: '有凭证的收款金额',
      amountText: received.amount === null ? '无凭证（未显示到账）' : `${fmtAmount(received.amount)} 元`,
      sourceLabel: received.sourceLabel,
      coverageText: coverageLabel(received.coverage),
      extra: `凭证 ${received.voucherCount} 张`,
    },
  ]
}

/**
 * 复算状态（MR-02）：只可能是 NOT_PERFORMED——缺完整结算参数只登记外部结果，
 * 从不宣称已独立复算；来源一致性核对与完整结算复算严格区分。
 */
export function recomputeStatusLabel(status: { status: string; reason: string } | null | undefined): string {
  if (!status) return ''
  if (status.status !== 'NOT_PERFORMED') return status.status
  return `未独立复算（${SETTLEMENT_NOTICES.notIndependentlyRecomputed}）`
}

// ── 账单（MR-03）────────────────────────────────────────────────────────────

export function billKindTag(kind: BillKind | null | undefined): { label: string; type: TagType } {
  if (!kind) return { label: '未知', type: 'info' }
  return kind === 'ITEMIZED'
    ? { label: BILL_KIND_LABELS.ITEMIZED, type: 'success' }
    : { label: BILL_KIND_LABELS.UNITEMIZED, type: 'warning' }
}

export function billPeriodLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '期间未知'
  return start === end ? start : `${start} — ${end}`
}

/** 账单行金额口径：当前有效版本（两版不双计）；未分项账单金额不产生中长期收入、只归档。 */
export function billAmountText(row: { billKind: BillKind | null; amount: string | null; lineItemAmount: string | null }): string {
  if (row.billKind === 'UNITEMIZED') return row.amount === null ? '未知' : `${fmtAmount(row.amount)} 元（整单归档，未分项不进中长期金额）`
  if (row.lineItemAmount === null) return row.amount === null ? '未知' : `${fmtAmount(row.amount)} 元（无分项金额）`
  return `${fmtAmount(row.lineItemAmount)} 元分项 / 整单 ${fmtAmount(row.amount)} 元`
}

/** 凭证状态：无凭证不显示到账（null 不当 0）；有凭证给「金额 / N 张」。 */
export function voucherText(row: { voucherCount: number; voucherAmount: string | null }): string {
  if (row.voucherCount === 0) return '无凭证（未显示到账）'
  return row.voucherAmount === null ? `${row.voucherCount} 张（金额未知）` : `${fmtAmount(row.voucherAmount)} 元 / ${row.voucherCount} 张`
}

// ── 差异（MR-04）────────────────────────────────────────────────────────────

/** 差值口径固定文案（与 shared computeQuantityPriceDelta 的 basis 一致）：外部 − 台账，同主体同交割期同单位。 */
export const DISCREPANCY_BASIS_TEXT = '外部账单 − 中长期台账（同主体、同交割期、规范单位 MWh；价格须同币种与税口径）'

export function discrepancyStatusTag(status: DiscrepancyStatus | null | undefined): { label: string; type: TagType } {
  if (!status) return { label: '未知', type: 'info' }
  const type: Record<DiscrepancyStatus, TagType> = { OPEN: 'warning', RECHECK_REQUIRED: 'danger', RESOLVED: 'success' }
  return { label: DISCREPANCY_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

/** 带符号差量（MWh / 元每 MWh）：负数原样显示（外部 − 台账，减少就是减少）。 */
export function signedDeltaLabel(delta: string | null | undefined, unit: 'MWh' | '元/MWh' = 'MWh'): string {
  if (delta === null || delta === undefined || delta === '') return '未知'
  return `${Number(delta) > 0 ? '+' : ''}${unit === 'MWh' ? fmtQuantity(delta) : fmtPrice(delta)} ${unit}`
}

/** 价格可比性：不可比时只给电量差并标注原因，不算价差（不做口径折算）。 */
export function priceDeltaText(discrepancy: { priceComparable: boolean; priceDelta: string | null }): string {
  if (!discrepancy.priceComparable) return '价格不可比（币种或含税口径不一致/未知，只核对电量）'
  return signedDeltaLabel(discrepancy.priceDelta, '元/MWh')
}

/** 差异两侧快照一行（外部侧与台账侧各自数字，不互相覆盖）。 */
export function discrepancySidesLines(d: {
  ledger: { quantity: string | null; price: string | null; notional: string | null }
  external: { quantity: string | null; price: string | null; amount: string | null }
}): string[] {
  return [
    `台账侧（持仓口径）：电量 ${fmtQuantity(d.ledger.quantity)} MWh · 均价 ${d.ledger.price === null ? '不可比/未知' : `${fmtPrice(d.ledger.price)} 元/MWh`}`,
    `外部侧（账单分项）：电量 ${fmtQuantity(d.external.quantity)} MWh · 单价 ${d.external.price === null ? '未知' : `${fmtPrice(d.external.price)} 元/MWh`} · 金额 ${d.external.amount === null ? '未知' : `${fmtAmount(d.external.amount)} 元`}`,
  ]
}

// ── 复盘报告（MR-05）────────────────────────────────────────────────────────

/** 绿电价格组成形态（MR-06）：总价已含环境价值按总价计名义、分项展示不重复相加。 */
export function greenCompositionLabel(composition: string | null | undefined): string {
  if (composition === 'TOTAL_INCLUDES_ENVIRONMENT') return '总价已含环境价值'
  if (composition === 'ENERGY_PLUS_ENVIRONMENT') return '电能量价 + 环境价值（另列）'
  return '环境价值构成未知（待核对）'
}

/** 绿电分项一行：单位合计与两分项分别展示（总价已含时不再次相加）。 */
export function greenUnitLine(row: { unitTotal: string | null; energyUnit: string | null; environmentUnit: string | null }): string {
  const parts = [`合计 ${row.unitTotal === null ? '未知' : `${fmtPrice(row.unitTotal)} 元/MWh`}`]
  parts.push(`电能量 ${row.energyUnit === null ? '未知' : `${fmtPrice(row.energyUnit)} 元/MWh`}`)
  parts.push(`环境价值 ${row.environmentUnit === null ? '未知' : `${fmtPrice(row.environmentUnit)} 元/MWh`}`)
  return parts.join(' · ')
}

export function reportScopeLabel(scope: 'SUBJECT' | 'COMPANY' | string | null | undefined, subjectName?: string | null): string {
  if (!scope) return '未知'
  const base = REVIEW_REPORT_SCOPE_LABELS[scope as keyof typeof REVIEW_REPORT_SCOPE_LABELS] ?? scope
  return scope === 'SUBJECT' && subjectName ? `${base} · ${subjectName}` : base
}

/** 报告版本差异说明：迟到修订产生新版本，changeReason 已列出变化输入（如 PLAN#7 v1→v2）。 */
export function reportChangeLine(change: { kind: string; id: number; from: number | null; to: number | null }): string {
  return `${change.kind}#${change.id} v${change.from ?? '无'}→v${change.to ?? '无'}`
}

// ── 错误信封翻译（P5 专属错误码 + 沿用 P1—P4 通用码的可操作提示）────────────

/**
 * P5 写操作失败的可读原因：
 * - DUPLICATE_BILL_CONTENT：同号异内容必须走修订（给当前版本号）；
 * - UNITEMIZED_BILL_NO_SPLIT：综合账单不能带分项，归档路径引导；
 * - DISCREPANCY_ALREADY_OPEN / NO_DIFFERENCE / RESOLUTION_NOTE_REQUIRED：闭环引导（含差异 id）；
 * - REPORT_INPUTS_UNCHANGED：输入版本未变化不生成空新版本；
 * - INCOMPLETE_BASIS / SUBJECT_MISMATCH / VERSION_CONFLICT：保留服务端事实，不在前端自行判定通过。
 */
export function settlementFailureText(errorCode: string, message: string, details: unknown): string {
  const d = (details ?? {}) as {
    billId?: number; currentRevisionNo?: number; discrepancyId?: number; reportId?: number; notice?: string
    reason?: string; field?: string; billKind?: string; missing?: string[]; currentRowVersion?: number
  }
  if (errorCode === 'DUPLICATE_BILL_CONTENT') {
    return `${SETTLEMENT_ERROR_LABELS.DUPLICATE_BILL_CONTENT}（账单 #${d.billId ?? '？'} 当前版本 v${d.currentRevisionNo ?? '？'}）`
  }
  if (errorCode === 'UNITEMIZED_BILL_NO_SPLIT') {
    return `${SETTLEMENT_ERROR_LABELS.UNITEMIZED_BILL_NO_SPLIT}。${SETTLEMENT_NOTICES.unitemizedArchive}`
  }
  if (errorCode === 'DISCREPANCY_ALREADY_OPEN') {
    return `${SETTLEMENT_ERROR_LABELS.DISCREPANCY_ALREADY_OPEN}（差异 #${d.discrepancyId ?? '？'}）`
  }
  if (errorCode === 'DISCREPANCY_NO_DIFFERENCE') {
    return SETTLEMENT_ERROR_LABELS.DISCREPANCY_NO_DIFFERENCE
  }
  if (errorCode === 'DISCREPANCY_RESOLUTION_NOTE_REQUIRED') {
    return `${SETTLEMENT_ERROR_LABELS.DISCREPANCY_RESOLUTION_NOTE_REQUIRED}（说明原因、依据与处理结果）`
  }
  if (errorCode === 'REPORT_INPUTS_UNCHANGED') {
    return `${SETTLEMENT_ERROR_LABELS.REPORT_INPUTS_UNCHANGED}（报告 #${d.reportId ?? '？'} 当前版本 v${d.currentRevisionNo ?? '？'}）`
  }
  if (errorCode === 'INCOMPLETE_BASIS' && d.billKind === 'UNITEMIZED') {
    return `该账单为综合账单（未分项）：没有可比的中长期分项，无法计算量价差异；原单已按未分项归档`
  }
  if (errorCode === 'INCOMPLETE_BASIS' && d.missing?.length) return `登记前请补齐：${d.missing.join('、')}`
  if (d.reason === 'SUBJECT_MISMATCH' || errorCode === 'SUBJECT_MISMATCH') {
    return '所比对账单的交易主体与登记主体不一致，不能跨主体比对（不同主体同号各自独立）'
  }
  if (d.reason === 'ROW_VERSION_CHANGED' || errorCode === 'VERSION_CONFLICT') {
    return `记录已被他人更新（当前行版本 ${d.currentRowVersion ?? '？'}），请刷新核对后再提交`
  }
  if (errorCode === 'VALIDATION_FAILED' && d.field) return `${message}${d.field ? `（字段：${d.field}）` : ''}`
  return d.notice ?? message ?? SETTLEMENT_ERROR_LABELS[errorCode] ?? message
}
