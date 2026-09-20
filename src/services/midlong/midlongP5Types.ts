// 中长期售电 P5（业务复盘 + 账单与差异）的类型与枚举出口（dljy-web#3016，后端契约 dljy#3015）。
// 页面经 services 取用共享契约，不直接依赖 shared/ 路径（契约由 dljy 主仓 shared/midlong 单向同步而来，本仓只读）。
// 接口 DTO 形状与后端 server/midlong/midlong-p5-review-store-pg.mjs、midlong-p5-bill-store-pg.mjs 的响应一一对应，
// 在下方按同构约定补齐（量价金额一律规范十进制字符串，未知为 null 不是 0）。
import type { PriceComponent, TaxBasis } from 'shared/midlong/contract.mjs'
import type { SettlementAmounts } from 'shared/midlong/settlement.mjs'

// ── 共享契约转发：枚举、标签、固定提示与纯函数规则 ─────────────────────────────

export type {
  BillKind, DiscrepancySide, DiscrepancyStatus, GreenComposition, ReportInputChange, ReportInputKind,
  ReportInputFreeze, ReviewReportScope, SettlementAmountCoverageRow, SettlementAmounts, SettlementAttachmentPurpose,
  SettlementEventType,
} from 'shared/midlong/settlement.mjs'
export {
  BILL_KINDS, BILL_KIND_LABELS, DISCREPANCY_SIDES, DISCREPANCY_SIDE_LABELS, DISCREPANCY_STATUSES,
  DISCREPANCY_STATUS_LABELS, FORBIDDEN_REVIEW_TERMS, FORBIDDEN_SETTLEMENT_TERMS, REVIEW_REPORT_SCOPES,
  REVIEW_REPORT_SCOPE_LABELS, SETTLEMENT_ATTACHMENT_PURPOSES, SETTLEMENT_ATTACHMENT_PURPOSE_LABELS,
  SETTLEMENT_ERROR_CODES, SETTLEMENT_ERROR_LABELS, SETTLEMENT_EVENT_TYPES, SETTLEMENT_EVENT_TYPE_LABELS,
  SETTLEMENT_NOTICES,
} from 'shared/midlong/settlement.mjs'

// ── 复盘指标（GET /review/metrics；MR-01/02/06）──────────────────────────────

/** 计划完成行（P3 planProgress 语义不改口径：版本选择、完成率、未知不按零计）。 */
export type ReviewPlanCompletionRow = {
  planId: number
  subjectId: number | null
  subjectName: string | null
  periodType: string
  periodKey: string
  confirmedRevisionNo: number | null
  targetQuantity: string | null
  knownSoldQuantity: string | null
  soldComplete: boolean
  remainingPlanQuantity: string | null
  completionRate: string | null
  verificationStatus: string
  overPlan: boolean
  positionsAsOf: string | null
}

/** 同口径价格分组行：不可比分列展示、不给统一均价与排名（MR-01）。 */
export type ReviewPriceGroupRow = {
  currency: string
  taxBasis: string
  priceComponent: string
  knownQuantity: string
  notionalAmount: string
  averagePrice: string | null
}

export type ReviewTradedVolumePrice = {
  month: string
  formalQuantity: string | null
  contractCount: number
  incomplete: boolean
  price: {
    groups: ReviewPriceGroupRow[]
    comparable: boolean
    averagePrice: string | null
    notionalAmount: string | null
    ranking: null
    rankingNotice: string | null
    knownPriceQuantity: string
    unknownPriceQuantity: string
    coverageRatio: string | null
    environmentValue: string | null
  }
  contributionCount: number
}

export type ReviewDistributionRow = { key: string; known: boolean; quantity: string; contractCount: number }
export type ReviewDistribution = { rows: ReviewDistributionRow[]; note: string }

/** 绿电价格组成行（MR-06）：310=300+10 按总价计名义，分项展示不重复相加。 */
export type ReviewGreenRow = {
  contractId: number
  contractName: string | null
  externalContractNo: string | null
  revisionNo: number
  quantity: string
  sellerPrice: string | null
  environmentPrice: string | null
  priceComponent: PriceComponent | null
  currency: string
  taxBasis: TaxBasis | 'UNKNOWN'
  unitTotal: string | null
  energyUnit: string | null
  environmentUnit: string | null
  notionalAmount: string | null
  composition: string
  gaps: string[]
}
export type ReviewGreenSection = {
  rows: ReviewGreenRow[]
  gaps: Array<{ contractId: number; gap: string }>
  notice: string | null
}

export type ReviewUntradedSection = {
  rows: Array<{ proposalId: number; subjectId: number | null; status: string; closeKind: string | null; ownerName: string | null; windowId: number | null; quantity: string | null }>
  statusesCounted: string[]
}

export type ReviewMissedWindowsSection = {
  asOf: string
  rows: Array<{
    proposalId: number; subjectId: number | null; status: string; closeKind: string | null; ownerName: string | null
    windowId: number | null; windowRevisionNo: number | null; announcementName: string | null; declarationClosesAt: string | null; quantityInMonth: string | null
  }>
}

export type ReviewChangesSection = {
  rows: Array<{ contractId: number; revisionNo: number; revisionKind: string; recordedAt: string | null; changeReason: string | null; affectedMonths: string[]; scopeLocated: boolean }>
  countByKind: Record<string, number>
}

export type ReviewDataGaps = {
  unallocatedContractCount: number
  unallocatedQuantity: string | null
  unknownPriceQuantity: string
  contracts: Array<{ contractId: number; flags: string[] }>
  pool: Array<{ contractId: number; externalContractNo: string | null; unallocatedQuantity: string | null; reason: string | null }>
}

export type ReviewMetrics = {
  nature: 'MIDLONG_FACTS_ONLY'
  month: string
  subjectId: number | null
  regionId: string
  view: 'CURRENT' | 'AS_OF'
  asOf: string | null
  caliber: { positions: string; priceGroups: string; amounts: string; conclusions: string }
  planCompletion: ReviewPlanCompletionRow[]
  tradedVolumePrice: ReviewTradedVolumePrice
  counterpartyDistribution: ReviewDistribution
  tradeMethodDistribution: ReviewDistribution
  green: ReviewGreenSection
  untraded: ReviewUntradedSection
  missedWindows: ReviewMissedWindowsSection
  changes: ReviewChangesSection
  dataGaps: ReviewDataGaps
  settlement: SettlementAmounts
  excluded: { draftCount: number; pendingVerificationCount: number; frameworkCount: number; voidedCount: number; estimatedQuantity: string; note: string }
  notices: string[]
  generatedAt: string
  inputs: { asOf: string | null; contracts: number; plans: number; confirmations: number; bills: number }
}

// ── 月度报告（/reports；MR-05）──────────────────────────────────────────────

export type ReviewReportSummaryRow = {
  id: number
  companyId: string
  regionId: string
  subjectId: number | null
  subjectName: string | null
  reportMonth: string
  scope: 'SUBJECT' | 'COMPANY'
  currentVersionNo: number
  versionCount: number
  currentChangeReason: string | null
  generatedAt: string | null
  generatedBy: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type ReviewReportVersionMeta = {
  versionNo: number
  supersedesVersionNo: number | null
  changeReason: string | null
  note: string | null
  contentFingerprint: string | null
  inputs: { asOf: string | null; contracts: number; plans: number; confirmations: number; bills: number }
  generatedAt: string
  generatedBy: string | null
}

export type SettlementEventDto = {
  id: number
  eventType: string
  revisionNo: number | null
  occurredAt: string
  actor: string | null
  reason: string | null
  payload: Record<string, unknown>
}

export type ReviewReportDetail = ReviewReportSummaryRow & {
  versions: ReviewReportVersionMeta[]
  events: SettlementEventDto[]
  notices: string[]
}

/** 冻结快照全文（GET /reports/{id}/versions/{versionNo}）：旧报告数值不变，导出与归档一致。 */
export type ReviewReportVersionSnapshot = {
  id: number
  reportMonth: string
  scope: 'SUBJECT' | 'COMPANY'
  subjectId: number | null
  versionNo: number
  supersedesVersionNo: number | null
  changeReason: string | null
  note: string | null
  contentFingerprint: string | null
  inputFreeze: Record<string, unknown> & {
    asOf?: string | null
    filters?: Record<string, unknown>
    contracts?: Record<string, number>
    plans?: Record<string, number>
    confirmations?: Record<string, number>
    bills?: Record<string, number>
  }
  metrics: Partial<ReviewMetrics>
  generatedAt: string
  generatedBy: string | null
  notices: string[]
}

export type GenerateReportInput = { month: string; subjectId?: number | null; note?: string | null }
export type GenerateReportResult = {
  reportId: number
  versionNo: number
  scope: 'SUBJECT' | 'COMPANY'
  month: string
  changeReason: string
  changes: Array<{ kind: string; id: number; from: number | null; to: number | null }>
  frozenInputs: { contracts: number; plans: number; confirmations: number; bills: number }
  notices: string[]
}

export type AffectedReportInputKind = 'contractId' | 'planId' | 'confirmationId' | 'billId'
export type AffectedReportsResult = {
  input: { kind: 'CONTRACT' | 'PLAN' | 'CONFIRMATION' | 'BILL'; id: number; currentRevisionNo: number }
  rows: Array<{
    reportId: number; reportMonth: string; scope: 'SUBJECT' | 'COMPANY'; subjectId: number | null
    versionNo: number; isCurrentVersion: boolean; frozenRevisionNo: number; changeReason: string | null; generatedAt: string
  }>
  notice: string
}

// ── 外部账单（/bills；MR-03）────────────────────────────────────────────────

export type UploadFile = { fileName: string; contentBase64: string; mediaType?: string | null }

/** 账单登记请求体：UNITEMIZED 不能携带分项（422 UNITEMIZED_BILL_NO_SPLIT）；分项交割月可空 = 期间合计。 */
export type BillRegisterInput = {
  subjectId: number
  sourceNamespace: string
  externalBillNo: string
  billKind: 'ITEMIZED' | 'UNITEMIZED'
  sourceName?: string | null
  externalRevisionLabel?: string | null
  periodStartMonth: string
  periodEndMonth: string
  currency?: string
  taxBasis?: TaxBasis | 'UNKNOWN'
  priceComponent?: PriceComponent | 'UNVERIFIED'
  amount: string
  note?: string | null
  changeReason?: string | null
  lineItems: Array<{ deliveryMonth?: string | null; quantity?: string | null; price?: string | null; amount?: string | null; note?: string | null }>
  file?: UploadFile | null
}

export type BillRevisionDto = {
  id: number
  revisionNo: number
  supersedesRevisionNo: number | null
  billKind: 'ITEMIZED' | 'UNITEMIZED'
  sourceName: string | null
  externalRevisionLabel: string | null
  periodStartMonth: string | null
  periodEndMonth: string | null
  currency: string
  taxBasis: TaxBasis | 'UNKNOWN'
  priceComponent: PriceComponent | 'UNVERIFIED'
  amount: string | null
  note: string | null
  changeReason: string | null
  attachmentId: number | null
  lineItemQuantity: string
  lineItemAmount: string | null
  lineItems: Array<{ id: number; deliveryMonth: string | null; quantity: string | null; price: string | null; amount: string | null; note: string | null }>
  recordedAt: string
  recordedBy: string | null
}

export type BillVoucherDto = {
  id: number
  voucherNo: string
  amount: string
  currency: string
  receivedAt: string
  attachmentId: number | null
  note: string | null
  createdAt: string
  createdBy: string | null
}

/** 账单汇总行（列表/详情共用）：金额一律当前有效版本，两版不双计；凭证合计与差异计数随行。 */
export type BillSummaryRow = {
  id: number
  companyId: string
  regionId: string
  subjectId: number
  subjectName: string | null
  sourceNamespace: string
  externalBillNo: string
  currentRevisionNo: number
  revisionCount: number
  rowVersion: number
  billKind: 'ITEMIZED' | 'UNITEMIZED' | null
  sourceName: string | null
  externalRevisionLabel: string | null
  periodStartMonth: string | null
  periodEndMonth: string | null
  currency: string
  taxBasis: TaxBasis | 'UNKNOWN'
  amount: string | null
  lineItemCount: number
  lineItemQuantity: string | null
  lineItemAmount: string | null
  voucherCount: number
  voucherAmount: string | null
  openDiscrepancyCount: number
  recheckDiscrepancyCount: number
  createdAt: string
  updatedAt: string
}

export type BillDetailDto = BillSummaryRow & {
  revisions: BillRevisionDto[]
  vouchers: BillVoucherDto[]
  discrepancies: Array<{ id: number; status: 'OPEN' | 'RECHECK_REQUIRED' | 'RESOLVED'; deliveryMonth: string | null; quantityDelta: string | null; priceDelta: string | null }>
  events: SettlementEventDto[]
  notices: string[]
}

export type BillRegisterResult = {
  billId: number
  revisionNo: number
  businessKeyReplay: boolean
  billKind: 'ITEMIZED' | 'UNITEMIZED'
  amount: string | null
  notices: string[]
}

export type BillReviseResult = {
  billId: number
  revisionNo: number
  businessKeyReplay: boolean
  recheckedDiscrepancies: Array<{ discrepancyId: number; deliveryMonth: string | null; wasResolved: boolean }>
  notices: string[]
}

export type VoucherInput = {
  voucherNo: string
  amount: string
  currency?: string
  receivedAt: string
  note?: string | null
  file?: UploadFile | null
}

export type VoucherResult = {
  billId: number
  voucherId: number
  voucherNo: string
  amount: string
  receivedAt: string
  notice: string
  billRowVersion: number
}

// ── 差异闭环（/discrepancies；MR-04）────────────────────────────────────────

/** 差异登记请求体：两侧快照与差值由服务端计算（外部 − 台账），前端只提交比对目标与处理线索。 */
export type DiscrepancyRegisterInput = {
  subjectId: number
  deliveryMonth: string
  billId: number
  reason?: string | null
  ownerName?: string | null
  evidence?: UploadFile[] | null
}

export type DiscrepancyRow = {
  id: number
  companyId: string
  regionId: string
  subjectId: number
  deliveryMonth: string | null
  billId: number
  billRevisionNo: number | null
  sides: { ledger: string; external: string }
  ledger: { quantity: string | null; price: string | null; notional: string | null }
  external: { quantity: string | null; price: string | null; amount: string | null }
  quantityDelta: string | null
  priceDelta: string | null
  priceComparable: boolean
  reason: string | null
  ownerName: string | null
  evidenceIds: number[]
  status: 'OPEN' | 'RECHECK_REQUIRED' | 'RESOLVED'
  resolutionNote: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type DiscrepancySummaryRow = DiscrepancyRow & { subjectName: string | null; billNo: string | null }

export type DiscrepancyRegisterResult = DiscrepancyRow & {
  basis: string
  comparableSides: string[]
  notices: string[]
}

export type DiscrepancyDetailDto = DiscrepancyRow & {
  subjectName: string | null
  events: SettlementEventDto[]
  notices: string[]
}

export type DiscrepancyUpdateInput = {
  expectedRowVersion: number
  reason?: string | null
  ownerName?: string | null
  evidence?: UploadFile[] | null
}

export type DiscrepancyResolveInput = {
  expectedRowVersion: number
  resolutionNote: string
}

// ── 导出与附件 ───────────────────────────────────────────────────────────────

/** CSV 导出结果（报告从冻结快照渲染、与归档一致；账单/差异台账同列表筛选）。 */
export type MidlongCsvExport = { fileName: string; contentType: string; content: string }

export type SettlementAttachmentDto = {
  attachmentId: number
  purpose: string
  fileName: string
  mediaType: string | null
  byteSize: number | null
  sha256: string
  contentBase64: string
}
