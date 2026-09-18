// 中长期售电 P3 售电目标、交易窗口与交易方案共享契约的类型侧伴随定义（#2972）。运行时见 planning.mjs。
// 接口 DTO 形状与 server/midlong/midlong-p3-api.mjs、midlong-p3-store-pg.mjs 的响应一一对应。
// 电量、价格、金额、比率一律是规范十进制字符串（不是 number）；未知为 null，不是 0。
import type { PriceComponent, ProductKind, TaxBasis, TradeMethod } from './contract.mjs'

export type PlanPeriodType = 'YEAR' | 'MONTH'
export type PlanRevisionStatus = 'DRAFT' | 'CONFIRMED'
export type PlanVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'TARGET_UNKNOWN'
export type ProposalStatus = 'DRAFT' | 'EXECUTABLE' | 'SUBMITTED' | 'AWAITING_RESULT' | 'CANCELLED' | 'CLOSED'
export type ProposalAction = 'UPDATE_DRAFT' | 'CONFIRM' | 'CANCEL' | 'CLOSE' | 'REGISTER_SUBMISSION' | 'ADD_RECEIPT' | 'AWAIT_RESULT' | 'RECHECK_WINDOW'
export type ProposalCloseKind = 'NO_LONGER_NEEDED' | 'WINDOW_EXPIRED' | 'OTHER'
export type OccupationReleaseReason = 'CANCELLED' | 'CLOSED'
export type ReceiptCompleteness = 'NONE' | 'PARTIAL' | 'COMPLETE'
export type ReceiptElement = 'externalReference' | 'receiptAt' | 'attachment'
export type WindowReviewField =
  | 'sourceName' | 'publishedDate' | 'announcementVersion' | 'effectiveFrom' | 'effectiveTo' | 'applicability'
  | 'tradeMethod' | 'productKind' | 'deliveryStartMonth' | 'deliveryEndMonth' | 'declarationOpensAt' | 'declarationClosesAt' | 'confirmationAt'
export type CalendarEventKind = 'DECLARATION_OPENS' | 'DECLARATION_CLOSES' | 'CONFIRMATION'
export type PlanningAttachmentPurpose = 'WINDOW_ANNOUNCEMENT' | 'SUBMISSION_RECEIPT'
export type PlanningEventType =
  | 'PLAN_CREATED' | 'PLAN_DRAFT_UPDATED' | 'PLAN_REVISION_CREATED' | 'PLAN_CONFIRMED'
  | 'WINDOW_REGISTERED' | 'WINDOW_CORRECTED'
  | 'PROPOSAL_CREATED' | 'PROPOSAL_DRAFT_UPDATED' | 'PROPOSAL_CONFIRMED' | 'PROPOSAL_WINDOW_REVISED' | 'PROPOSAL_WINDOW_RECHECKED'
  | 'PROPOSAL_SUBMISSION_REGISTERED' | 'PROPOSAL_RECEIPT_ADDED' | 'PROPOSAL_AWAITING_RESULT' | 'PROPOSAL_CANCELLED' | 'PROPOSAL_CLOSED'

export declare const PLAN_PERIOD_TYPES: readonly PlanPeriodType[]
export declare const PLAN_REVISION_STATUSES: readonly PlanRevisionStatus[]
export declare const PLAN_VERIFICATION_STATUSES: readonly PlanVerificationStatus[]
export declare const PROPOSAL_STATUSES: readonly ProposalStatus[]
export declare const PROPOSAL_OCCUPYING_STATUSES: readonly ProposalStatus[]
export declare const PROPOSAL_TERMINAL_STATUSES: readonly ProposalStatus[]
export declare const DEFERRED_PROPOSAL_STATUSES: readonly string[]
export declare const PROPOSAL_ACTION_FROM: Readonly<Record<ProposalAction, readonly ProposalStatus[]>>
export declare function proposalActionAllowed(status: ProposalStatus, action: ProposalAction): boolean
export declare const PROPOSAL_CLOSE_KINDS: readonly ProposalCloseKind[]
export declare const OCCUPATION_RELEASE_REASONS: readonly OccupationReleaseReason[]
export declare const RECEIPT_COMPLETENESS: readonly ReceiptCompleteness[]
export declare const RECEIPT_ELEMENTS: readonly ReceiptElement[]
export declare const WINDOW_REVIEW_FIELDS: readonly WindowReviewField[]
export declare const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[]
export declare const PLANNING_ATTACHMENT_PURPOSES: readonly PlanningAttachmentPurpose[]
export declare const PLANNING_EVENT_TYPES: readonly PlanningEventType[]

export declare const PLAN_PERIOD_TYPE_LABELS: Readonly<Record<PlanPeriodType, string>>
export declare const PLAN_REVISION_STATUS_LABELS: Readonly<Record<PlanRevisionStatus, string>>
export declare const PLAN_VERIFICATION_STATUS_LABELS: Readonly<Record<PlanVerificationStatus, string>>
export declare const PROPOSAL_STATUS_LABELS: Readonly<Record<ProposalStatus, string>>
export declare const PROPOSAL_CLOSE_KIND_LABELS: Readonly<Record<ProposalCloseKind, string>>
export declare const OCCUPATION_RELEASE_REASON_LABELS: Readonly<Record<OccupationReleaseReason, string>>
export declare const RECEIPT_COMPLETENESS_LABELS: Readonly<Record<ReceiptCompleteness, string>>
export declare const RECEIPT_ELEMENT_LABELS: Readonly<Record<ReceiptElement, string>>
export declare const WINDOW_REVIEW_FIELD_LABELS: Readonly<Record<WindowReviewField, string>>
export declare const CALENDAR_EVENT_KIND_LABELS: Readonly<Record<CalendarEventKind, string>>
export declare const PLANNING_EVENT_TYPE_LABELS: Readonly<Record<PlanningEventType, string>>
export declare const PLANNING_NOTICES: Readonly<{
  targetNature: string
  unverified: string
  targetUnknown: string
  zeroTarget: string
  overPlan: string
  overCommitted: string
  occupation: string
  simulation: string
  priceNotAssessed: string
  exportNotSubmission: string
  submissionNotAccepted: string
  windowPending: string
  windowRevised: string
}>
export declare const FORBIDDEN_PLANNING_TERMS: readonly string[]

export declare function isYearKey(value: unknown): boolean
export declare function isPeriodKey(periodType: PlanPeriodType, periodKey: unknown): boolean
export declare function periodStartOf(periodType: PlanPeriodType, periodKey: string): string | null
export declare function periodKeyOf(periodType: PlanPeriodType, periodStart: string): string | null
export declare function monthsOfPeriod(periodType: PlanPeriodType, periodKey: string): string[]
export declare function periodContainsMonth(periodType: PlanPeriodType, periodKey: string, month: string): boolean

export interface PlanProgressCore {
  targetQuantity: string | null
  /** 已知的确认已售电量；soldComplete=false 时只是下限。 */
  knownSoldQuantity: string | null
  soldComplete: boolean
  remainingPlanQuantity: string | null
  /** 完成率（比值，1 = 100%）；目标为零/未知或已售未完成核验时为 null。 */
  completionRate: string | null
  openOccupationQuantity: string
  arrangeableQuantity: string | null
  overPlan: boolean
  /** 已售 + 未完成占用超过目标（可安排计划量为负，且有未完成占用）。 */
  overCommitted: boolean
  verificationStatus: PlanVerificationStatus
  notices: string[]
}
export declare function computePlanProgress(input?: {
  targetQuantity?: string | null
  soldQuantity?: string | null
  soldComplete?: boolean
  openOccupationQuantity?: string | null
}): PlanProgressCore

export declare function receiptCompletenessOf(receipts?: Array<Partial<PlanningReceipt>>): {
  completeness: ReceiptCompleteness
  missing: ReceiptElement[]
  present: Record<ReceiptElement, boolean>
}

export interface WindowPendingField {
  field: string
  label: string
  reason: 'MISSING' | 'UNSUPPORTED'
  raw?: string
}
export declare function windowPendingFields(revision: Partial<TradingWindowRevision>): WindowPendingField[]

export interface WindowCalendarEvent {
  kind: CalendarEventKind
  label: string
  at: string
}
export interface WindowCalendar {
  events: WindowCalendarEvent[]
  pendingTimes: Array<{ kind: CalendarEventKind; label: string }>
}
export declare function windowCalendarEvents(revision: Partial<TradingWindowRevision>): WindowCalendar

export interface WindowRevisionChange {
  field: string
  label: string
  previous: unknown
  next: unknown
}
export declare function windowRevisionDiff(previous: Partial<TradingWindowRevision>, next: Partial<TradingWindowRevision>): WindowRevisionChange[]
export type InstantInputReason = 'FORMAT' | 'DATE_ONLY' | 'MONTH' | 'DAY' | 'HOUR' | 'MINUTE' | 'SECOND' | 'OFFSET'
export declare const INSTANT_INPUT_REASONS: readonly InstantInputReason[]
export declare const INSTANT_INPUT_REASON_LABELS: Readonly<Record<InstantInputReason, string>>
export declare function inspectBeijingDateTime(value: unknown): { ok: true; date: Date } | { ok: false; reason: InstantInputReason }
export declare function parseBeijingDateTime(value: unknown): Date | null
export declare function formatBeijingDateTime(value: string | Date | null | undefined): string | null
export declare function isCompleteBeijingDateTimeInput(value: unknown): boolean

/** 分页结果：total 为筛选范围内总数，rows 只是当前页；页面据此显示分页，不静默截断。 */
export interface PageResult<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

// ── 接口 DTO ─────────────────────────────────────────────────────────────────

export interface PlanningEvent {
  id: number
  planId: number | null
  windowId: number | null
  proposalId: number | null
  eventType: PlanningEventType
  revisionNo: number | null
  occurredAt: string
  actor: string | null
  reason: string | null
  payload: Record<string, unknown>
}

export interface SalesPlanRevision {
  id: number
  planId: number
  revisionNo: number
  status: PlanRevisionStatus
  supersedesRevisionNo: number | null
  targetQuantity: string | null
  targetPriceLow: string | null
  targetPriceHigh: string | null
  priceTaxBasis: TaxBasis
  basisNote: string | null
  ownerName: string | null
  changeReason: string | null
  recordedAt: string
  recordedBy: string | null
  updatedAt: string
  confirmedAt: string | null
  confirmedBy: string | null
  /** 仅计划详情：被下一确认版本取代的时刻与该版本历史视图的认知时点。 */
  supersededAt?: string | null
  historyAsOf?: string | null
}

export interface SalesPlan {
  id: number
  companyId: string
  regionId: string
  subjectId: number
  subjectName: string | null
  subjectKey: string | null
  periodType: PlanPeriodType
  periodKey: string
  currentRevisionNo: number
  confirmedRevisionNo: number | null
  rowVersion: number
  createdAt: string
  createdBy: string | null
  updatedAt: string
  targetNature: 'BUSINESS_ARRANGEMENT'
  targetNatureNotice: string
}

export interface SalesPlanListRow extends SalesPlan {
  confirmedRevision: SalesPlanRevision | null
  draftRevision: SalesPlanRevision | null
}

export interface PlanOccupation {
  id: number
  proposalId: number
  subjectId: number
  deliveryMonth: string
  quantity: string
  open: boolean
  occupiedAt: string
  occupiedBy: string | null
  releasedAt: string | null
  releasedBy: string | null
  releaseReason: OccupationReleaseReason | null
  balanceSnapshot: Record<string, unknown>
  proposalStatus?: ProposalStatus
}

export interface SalesPlanDetail extends SalesPlan {
  revisions: SalesPlanRevision[]
  events: PlanningEvent[]
  occupations: PlanOccupation[]
}

export interface IncompleteSoldContract {
  contractId: number
  externalContractNo: string
  contractName: string
  deliveryStart: string | null
  deliveryEnd: string | null
  unallocatedQuantity: string | null
  reason: string
}

export interface PlanProgress extends PlanProgressCore {
  incompleteContracts: IncompleteSoldContract[]
  positionsAsOf: string
}

export interface PlanProgressRow extends SalesPlanListRow {
  progress: PlanProgress
}

export interface PlanProgressReport {
  view: 'CURRENT' | 'AS_OF'
  asOf: string
  regionId: string
  rows: PlanProgressRow[]
  total: number
  page: number
  pageSize: number
  notices: string[]
  generatedAt: string
}

export interface PlanningAttachment {
  id: number
  purpose: PlanningAttachmentPurpose
  sha256: string
  byteSize: number
  originalFileName: string
  mediaType: string | null
  uploadedAt: string
  uploadedBy: string | null
}

export interface TradingWindowRevision {
  id: number
  windowId: number
  revisionNo: number
  supersedesRevisionNo: number | null
  announcementName: string
  sourceName: string | null
  sourceReference: string | null
  publishedDate: string | null
  announcementVersion: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  applicableScope: string | null
  applicableSubjectIds: number[]
  tradeMethod: TradeMethod | null
  productKind: ProductKind | null
  deliveryStartMonth: string | null
  deliveryEndMonth: string | null
  declarationOpensAt: string | null
  declarationClosesAt: string | null
  confirmationAt: string | null
  unsupportedParams: Record<string, string>
  attachmentId: number | null
  attachment: PlanningAttachment | null
  changeReason: string | null
  recordedAt: string
  recordedBy: string | null
  pendingFields: WindowPendingField[]
  calendar: WindowCalendar
  changesFromPrevious?: WindowRevisionChange[]
}

export interface TradingWindowListRow {
  id: number
  companyId: string
  regionId: string
  currentRevisionNo: number
  rowVersion: number
  createdAt: string
  createdBy: string | null
  current: TradingWindowRevision
  proposalCount: number
  proposalsNeedingRecheck: number
}

export interface TradingWindowDetail {
  id: number
  companyId: string
  regionId: string
  currentRevisionNo: number
  rowVersion: number
  createdAt: string
  createdBy: string | null
  revisions: TradingWindowRevision[]
  proposals: Array<{ proposalId: number; status: ProposalStatus; subjectId: number; referencedRevisionNo: number; rowVersion: number; needsRecheck: boolean; notice: string | null }>
  events: PlanningEvent[]
  notice: string
}

export interface TradingWindowInput {
  announcementName: string
  sourceName?: string | null
  sourceReference?: string | null
  publishedDate?: string | null
  announcementVersion?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  applicableScope?: string | null
  applicableSubjectIds?: number[]
  tradeMethod?: TradeMethod | null
  productKind?: ProductKind | null
  deliveryStartMonth?: string | null
  deliveryEndMonth?: string | null
  declarationOpensAt?: string | null
  declarationClosesAt?: string | null
  confirmationAt?: string | null
  unsupportedParams?: Record<string, string>
  file?: { fileName: string; contentBase64: string; mediaType?: string | null } | null
}

export interface WindowCalendarReport {
  fromMonth: string
  toMonth: string
  /** 区间内相关公告总数与本次计入的数量；truncated=true 时页面必须提示缩小区间。 */
  windowTotal: number
  windowLimit: number
  truncated: boolean
  events: Array<WindowCalendarEvent & { windowId: number; revisionNo: number; announcementName: string }>
  pending: Array<{ windowId: number; revisionNo: number; announcementName: string; deliveryStartMonth: string | null; deliveryEndMonth: string | null; pendingTimes: WindowCalendar['pendingTimes'] }>
  notice: string
}

export interface ProposalSegment {
  id?: number
  deliveryMonth: string
  quantity: string
}

export interface PlanningReceipt {
  id: number
  submissionId: number
  externalReference: string | null
  receiptAt: string | null
  attachmentId: number | null
  attachment: PlanningAttachment | null
  note: string | null
  recordedAt: string
  recordedBy: string | null
}

export interface ProposalSubmission {
  id: number
  proposalId: number
  submittedAt: string
  submittedByName: string
  channel: string | null
  note: string | null
  registeredAt: string
  registeredBy: string | null
  receipts: PlanningReceipt[]
  receiptCompleteness: ReceiptCompleteness
  receiptMissing: ReceiptElement[]
  platformAcceptance: 'NOT_ASSERTED'
  notice: string
}

export interface ProposalWindowFitIssue {
  field: string
  /** MISSING：公告明确给出、方案留空；DIFFERENT：方案与公告不一致。两者都不可确认。 */
  kind?: 'MISSING' | 'DIFFERENT'
  message: string
}

export interface TradeProposalDetail {
  id: number
  companyId: string
  regionId: string
  subjectId: number
  subjectName: string | null
  windowId: number | null
  windowRevisionNo: number | null
  productKind: ProductKind | null
  tradeMethod: TradeMethod | null
  proposedPrice: string | null
  priceTaxBasis: TaxBasis
  priceComponent: PriceComponent
  ownerName: string | null
  rationale: string | null
  status: ProposalStatus
  rowVersion: number
  confirmedAt: string | null
  confirmedBy: string | null
  positionsAsOf: string | null
  awaitingResultAt: string | null
  awaitingResultBy: string | null
  endedAt: string | null
  endedBy: string | null
  endReason: string | null
  closeKind: ProposalCloseKind | null
  createdAt: string
  createdBy: string | null
  updatedAt: string
  segments: ProposalSegment[]
  totalQuantity: string
  planRefs: Array<{
    planId: number
    periodType: PlanPeriodType
    periodKey: string
    revisionNo: number
    targetQuantity: string | null
    confirmedAt: string | null
    currentConfirmedRevisionNo: number | null
    superseded: boolean
    capturedAt: string
  }>
  occupations: PlanOccupation[]
  openOccupationQuantity: string
  submissions: ProposalSubmission[]
  window: null | {
    windowId: number
    referencedRevisionNo: number
    currentRevisionNo: number
    needsRecheck: boolean
    notice: string | null
    referenced: TradingWindowRevision | null
    current: TradingWindowRevision | null
    changesSinceReferenced: WindowRevisionChange[]
  }
  readiness: null | {
    missing: string[]
    windowMismatches: ProposalWindowFitIssue[]
    windowUnverified: ProposalWindowFitIssue[]
    windowRevised: boolean
  }
  events?: PlanningEvent[]
  notices: string[]
  formalPosition: false
}

export interface TradeProposalInput {
  subjectId: number
  windowId?: number | null
  windowRevisionNo?: number | null
  productKind?: ProductKind | null
  tradeMethod?: TradeMethod | null
  proposedPrice?: string | null
  priceTaxBasis?: TaxBasis
  priceComponent?: PriceComponent
  ownerName?: string | null
  rationale?: string | null
  segments: Array<{ deliveryMonth: string; quantity: string }>
}

export interface PlanBalance {
  planId: number
  periodType: PlanPeriodType
  periodKey: string
  revisionNo: number
  targetQuantity: string | null
  soldQuantity: string | null
  soldComplete: boolean
  openOccupationQuantity: string
  arrangeableQuantity: string | null
  requestedQuantity: string
  verificationStatus: PlanVerificationStatus
}

export interface PriceGroupView {
  currency: string
  taxBasis: TaxBasis
  priceComponent: PriceComponent
  knownQuantity: string
  notionalAmount: string
  averagePrice?: string | null
}

export interface ProposalComparison {
  proposalId: number
  proposalStatus: ProposalStatus
  proposalRowVersion: number
  uncoveredMonths: string[]
  nature: 'SIMULATION'
  notices: string[]
  priceAssessment: { status: 'NOT_ASSESSED'; reason: 'NO_COMPARABLE_MIDLONG_QUOTE' }
  proposal: { totalQuantity: string; proposedPrice: string | null; priceTaxBasis: TaxBasis; priceComponent: PriceComponent; notionalAmount: string | null }
  months: Array<{
    month: string
    proposalQuantity: string
    proposalNotionalAmount: string | null
    before: null | {
      formalQuantity: string
      soldComplete: boolean
      affectedContractIds: number[]
      groups: PriceGroupView[]
      comparable: boolean
      averagePrice: string | null
      notionalAmount: string | null
      notionalAmountComplete: boolean
    }
    after: {
      quantity: string | null
      groups: PriceGroupView[]
      comparable: boolean
      averagePrice: string | null
      notionalAmount: string | null
      notionalAmountComplete: boolean
    }
  }>
  plans: Array<{
    planId: number
    periodType: PlanPeriodType
    periodKey: string
    currentRevisionNo: number | null
    referencedRevisionNo: number | null
    referencedTargetQuantity: string | null
    revisionSuperseded: boolean
    proposalQuantityInPeriod: string
    before: PlanProgress
    after: PlanProgress
  }>
  positionsAsOf: string | null
}

export interface ProposalExport {
  fileName: string
  contentType: 'text/csv'
  content: string
  proposalId: number
  proposalRowVersion: number
  proposalStatus: ProposalStatus
  notice: string
}

export interface SubmissionRegistrationResult {
  proposalId: number
  submissionId: number
  status: ProposalStatus
  rowVersion: number
  receiptCompleteness: ReceiptCompleteness
  receiptMissing: ReceiptElement[]
  platformAcceptance: 'NOT_ASSERTED'
  notice: string
}
