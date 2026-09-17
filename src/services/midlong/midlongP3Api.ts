// 中长期售电 P3 前端服务层（dljy#2973，后端契约 dljy#2972 `/api/v1/midlong/{plans,proposals,windows,...}`）。
//
// 与 P1 客户端同一约束（见 midlongApi.ts）：
// 1. 读请求带 `company` 查询参数，未选有效公司直接报「未选择公司」，不发请求；写请求未选公司直接抛错。
// 2. 写请求的幂等键由「动作 + 对象 + 提交内容」派生：同一内容的重试、双击只执行一次。
// 3. 错误保留服务端错误码与 details（余额冲突带最新余额、公告已更正带差异），不吞成空数据。
// 本文件只有读取与明确的业务动作；导出申报材料是只读 GET，不会改变方案状态，也不会操作外部交易平台。
import { apiGet, apiPatch, apiPost } from '@/services/api'
import { companyUnselected } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { CompanyNotSelectedError, actionKey, contentFingerprint } from './midlongApi'
import type {
  PlanPeriodType, PlanProgressReport, PlanningAttachment, ProposalCloseKind, ProposalComparison, ProposalExport, ProposalStatus,
  SalesPlanDetail, SalesPlanListRow, SalesPlanRevision, SubmissionRegistrationResult, TradeProposalDetail, TradeProposalInput,
  TradingWindowDetail, TradingWindowInput, TradingWindowListRow, WindowCalendarReport, WindowRevisionChange,
} from './midlongP3Types'
import type { TaxBasis } from './midlongTypes'

const BASE = '/api/v1/midlong'

type Query = Record<string, string | number | boolean | null | undefined>
type Envelope<T> = { data?: T }

function readQuery(extra: Query = {}): Query {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return { company: selectedCompanyId.value, ...extra }
}

function writePath(path: string): string {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return `${path}?${new URLSearchParams({ company: selectedCompanyId.value })}`
}

function withKey(key: string) {
  return { headers: { 'Idempotency-Key': key } }
}

function dataOf<T>(res: Envelope<T>): T {
  if (res.data === undefined || res.data === null) throw new Error('接口响应缺少数据')
  return res.data
}

/** 附件在幂等键里只按文件名、长度与完整内容指纹参与，不把整份 base64 拼进键。 */
function fileKeyPart(file?: { fileName: string; contentBase64: string } | null) {
  return file ? [file.fileName, file.contentBase64.length, contentFingerprint(file.contentBase64)] : null
}

// ── 售电目标 ─────────────────────────────────────────────────────────────────

export type PlanRevisionInput = {
  targetQuantity?: string | null
  targetPriceLow?: string | null
  targetPriceHigh?: string | null
  priceTaxBasis?: TaxBasis
  basisNote?: string | null
  ownerName?: string | null
  changeReason?: string | null
}
export type PlanQuery = { subjectId?: string; periodType?: PlanPeriodType | ''; year?: string }

export async function fetchPlans(query: PlanQuery = {}): Promise<SalesPlanListRow[]> {
  return dataOf(await apiGet<Envelope<{ rows: SalesPlanListRow[] }>>(`${BASE}/plans`, readQuery(query))).rows
}

export async function fetchPlanProgress(query: PlanQuery & { planId?: string; asOf?: string } = {}): Promise<PlanProgressReport> {
  return dataOf(await apiGet<Envelope<PlanProgressReport>>(`${BASE}/plans/progress`, readQuery(query)))
}

export async function fetchPlan(planId: number): Promise<SalesPlanDetail> {
  return dataOf(await apiGet<Envelope<SalesPlanDetail>>(`${BASE}/plans/${planId}`, readQuery()))
}

export type PlanWriteResult = { planId: number; revisionNo: number; status: 'DRAFT' | 'CONFIRMED'; confirmedAt?: string; previousRevisionNo?: number | null }

export async function createPlan(input: PlanRevisionInput & { subjectId: number; periodType: PlanPeriodType; periodKey: string }): Promise<PlanWriteResult> {
  return dataOf(await apiPost<Envelope<PlanWriteResult>>(writePath(`${BASE}/plans`), input, withKey(actionKey('plan-create', input))))
}

export async function updatePlanDraft(planId: number, input: PlanRevisionInput & { expectedRowVersion: number }): Promise<PlanWriteResult> {
  return dataOf(await apiPatch<Envelope<PlanWriteResult>>(writePath(`${BASE}/plans/${planId}`), input, withKey(actionKey('plan-update', [planId, input]))))
}

export async function createPlanRevision(planId: number, input: PlanRevisionInput & { expectedRowVersion: number; changeReason: string }): Promise<PlanWriteResult> {
  return dataOf(await apiPost<Envelope<PlanWriteResult>>(writePath(`${BASE}/plans/${planId}/revisions`), input, withKey(actionKey('plan-revise', [planId, input]))))
}

export async function confirmPlan(planId: number, expectedRowVersion: number): Promise<PlanWriteResult> {
  const body = { expectedRowVersion }
  return dataOf(await apiPost<Envelope<PlanWriteResult>>(writePath(`${BASE}/plans/${planId}/confirm`), body, withKey(actionKey('plan-confirm', [planId, body]))))
}

export async function fetchPlanRevisions(planId: number): Promise<SalesPlanRevision[]> {
  return dataOf(await apiGet<Envelope<{ rows: SalesPlanRevision[] }>>(`${BASE}/plans/${planId}/revisions`, readQuery())).rows
}

// ── 交易方案 ─────────────────────────────────────────────────────────────────

export type ProposalQuery = { status?: ProposalStatus | ''; subjectId?: string; windowId?: string }

export async function fetchProposals(query: ProposalQuery = {}): Promise<TradeProposalDetail[]> {
  return dataOf(await apiGet<Envelope<{ rows: TradeProposalDetail[] }>>(`${BASE}/proposals`, readQuery(query))).rows
}

export async function fetchProposal(proposalId: number): Promise<TradeProposalDetail> {
  return dataOf(await apiGet<Envelope<TradeProposalDetail>>(`${BASE}/proposals/${proposalId}`, readQuery()))
}

export type ProposalWriteResult = { proposalId: number; status: ProposalStatus; rowVersion: number }

export async function createProposal(input: TradeProposalInput): Promise<ProposalWriteResult> {
  return dataOf(await apiPost<Envelope<ProposalWriteResult>>(writePath(`${BASE}/proposals`), input, withKey(actionKey('proposal-create', input))))
}

export async function updateProposalDraft(proposalId: number, input: TradeProposalInput & { expectedRowVersion: number }): Promise<ProposalWriteResult> {
  return dataOf(await apiPatch<Envelope<ProposalWriteResult>>(writePath(`${BASE}/proposals/${proposalId}`), input, withKey(actionKey('proposal-update', [proposalId, input]))))
}

export async function fetchProposalComparison(proposalId: number): Promise<ProposalComparison> {
  return dataOf(await apiGet<Envelope<ProposalComparison>>(`${BASE}/proposals/${proposalId}/comparison`, readQuery()))
}

export type ProposalConfirmInput = { expectedRowVersion: number; expectedPlanRevisions: Array<{ planId: number; revisionNo: number }> }
export async function confirmProposal(proposalId: number, input: ProposalConfirmInput): Promise<ProposalWriteResult & { confirmedAt: string }> {
  return dataOf(await apiPost<Envelope<ProposalWriteResult & { confirmedAt: string }>>(writePath(`${BASE}/proposals/${proposalId}/confirm`), input, withKey(actionKey('proposal-confirm', [proposalId, input]))))
}

export async function cancelProposal(proposalId: number, input: { expectedRowVersion: number; reason: string }): Promise<ProposalWriteResult> {
  return dataOf(await apiPost<Envelope<ProposalWriteResult>>(writePath(`${BASE}/proposals/${proposalId}/cancel`), input, withKey(actionKey('proposal-cancel', [proposalId, input]))))
}

export async function closeProposal(proposalId: number, input: { expectedRowVersion: number; closeKind: ProposalCloseKind; reason: string }): Promise<ProposalWriteResult> {
  return dataOf(await apiPost<Envelope<ProposalWriteResult>>(writePath(`${BASE}/proposals/${proposalId}/close`), input, withKey(actionKey('proposal-close', [proposalId, input]))))
}

/** 申报材料导出：只读，不改方案状态、不登记提交。 */
export async function exportProposal(proposalId: number): Promise<ProposalExport> {
  return dataOf(await apiGet<Envelope<ProposalExport>>(`${BASE}/proposals/${proposalId}/export`, readQuery()))
}

export async function recheckProposalWindow(proposalId: number, input: { expectedRowVersion: number; windowRevisionNo: number; note: string }): Promise<{ proposalId: number; windowRevisionNo: number; rowVersion: number }> {
  return dataOf(await apiPost<Envelope<{ proposalId: number; windowRevisionNo: number; rowVersion: number }>>(writePath(`${BASE}/proposals/${proposalId}/window-recheck`), input, withKey(actionKey('proposal-recheck', [proposalId, input]))))
}

export type ReceiptInput = { externalReference?: string | null; receiptAt?: string | null; note?: string | null; file?: { fileName: string; contentBase64: string; mediaType?: string | null } | null }

export async function registerSubmission(proposalId: number, input: { expectedRowVersion: number; submittedAt: string; submittedByName: string; channel?: string | null; note?: string | null; receipt?: ReceiptInput | null }): Promise<SubmissionRegistrationResult> {
  const keyPart = { ...input, receipt: input.receipt ? { ...input.receipt, file: fileKeyPart(input.receipt.file) } : null }
  return dataOf(await apiPost<Envelope<SubmissionRegistrationResult>>(writePath(`${BASE}/proposals/${proposalId}/submissions`), input, withKey(actionKey('proposal-submission', [proposalId, keyPart]))))
}

export async function addReceipt(submissionId: number, input: ReceiptInput): Promise<Omit<SubmissionRegistrationResult, 'status' | 'rowVersion'>> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<Omit<SubmissionRegistrationResult, 'status' | 'rowVersion'>>>(writePath(`${BASE}/submissions/${submissionId}/receipts`), input, withKey(actionKey('submission-receipt', [submissionId, keyPart]))))
}

export async function markAwaitingResult(proposalId: number, input: { expectedRowVersion: number; note?: string | null }): Promise<ProposalWriteResult> {
  return dataOf(await apiPost<Envelope<ProposalWriteResult>>(writePath(`${BASE}/proposals/${proposalId}/await-result`), input, withKey(actionKey('proposal-await', [proposalId, input]))))
}

// ── 交易窗口（公告）与日历 ───────────────────────────────────────────────────

export async function fetchWindows(query: { fromMonth?: string; toMonth?: string } = {}): Promise<TradingWindowListRow[]> {
  return dataOf(await apiGet<Envelope<{ rows: TradingWindowListRow[] }>>(`${BASE}/windows`, readQuery(query))).rows
}

export async function fetchWindow(windowId: number): Promise<TradingWindowDetail> {
  return dataOf(await apiGet<Envelope<TradingWindowDetail>>(`${BASE}/windows/${windowId}`, readQuery()))
}

export async function fetchWindowCalendar(query: { fromMonth: string; toMonth: string }): Promise<WindowCalendarReport> {
  return dataOf(await apiGet<Envelope<WindowCalendarReport>>(`${BASE}/windows/calendar`, readQuery(query)))
}

export type WindowWriteResult = { windowId: number; revisionNo: number; changes?: WindowRevisionChange[]; affectedProposals?: Array<{ proposalId: number; status: ProposalStatus; referencedRevisionNo: number }> }

export async function registerWindow(input: TradingWindowInput): Promise<WindowWriteResult> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<WindowWriteResult>>(writePath(`${BASE}/windows`), input, withKey(actionKey('window-register', keyPart))))
}

export async function correctWindow(windowId: number, input: TradingWindowInput & { expectedRowVersion: number; changeReason: string; keepAttachment?: boolean }): Promise<WindowWriteResult> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<WindowWriteResult>>(writePath(`${BASE}/windows/${windowId}/revisions`), input, withKey(actionKey('window-correct', [windowId, keyPart]))))
}

export async function fetchPlanningAttachment(attachmentId: number): Promise<{ attachment: PlanningAttachment; contentBase64: string }> {
  return dataOf(await apiGet<Envelope<{ attachment: PlanningAttachment; contentBase64: string }>>(`${BASE}/planning-attachments/${attachmentId}`, readQuery()))
}
