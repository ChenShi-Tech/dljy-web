// 中长期售电 P5 前端服务层（dljy#3016，后端契约 dljy#3015 `/api/v1/midlong/{review,reports,bills,discrepancies}`）。
//
// 与 P1—P4 客户端同一约束（见 midlongApi.ts / midlongP3Api.ts / midlongP4Api.ts）：
// 1. 读请求带 `company` 查询参数，未选有效公司直接报「未选择公司」，不发请求；写请求未选公司直接抛错。
// 2. 写请求的幂等键由「动作 + 对象 + 提交内容」派生：同一内容的重试、双击只执行一次；附件只按
//    文件名、长度与完整内容指纹参与（不把整份 base64 拼进键）。
// 3. 错误保留服务端错误码与 details（DUPLICATE_BILL_CONTENT、UNITEMIZED_BILL_NO_SPLIT、
//    DISCREPANCY_*、REPORT_INPUTS_UNCHANGED 等），由 midlongP5Format 翻成可操作提示，不吞成空数据。
// 本文件只有读取与明确的业务动作；不自动登录或操作外部交易平台，不读取现货、预测数据（MR-01）。
import { apiGet, apiPatch, apiPost } from '@/services/api'
import { companyUnselected } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { CompanyNotSelectedError, actionKey, contentFingerprint } from './midlongApi'
import type { MidlongCapabilities } from './midlongTypes'
import type { PageResult } from './midlongP3Types'
import type {
  AffectedReportInputKind, AffectedReportsResult, BillDetailDto, BillRegisterInput, BillRegisterResult, BillReviseResult,
  BillSummaryRow, DiscrepancyDetailDto, DiscrepancyRegisterInput, DiscrepancyRegisterResult, DiscrepancyResolveInput,
  DiscrepancySummaryRow, DiscrepancyUpdateInput, GenerateReportInput, GenerateReportResult, MidlongCsvExport,
  ReviewMetrics, ReviewReportDetail, ReviewReportSummaryRow, ReviewReportVersionSnapshot, SettlementAttachmentDto,
  UploadFile, VoucherInput, VoucherResult,
} from './midlongP5Types'

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
function fileKeyPart(file?: UploadFile | null) {
  return file ? [file.fileName, file.contentBase64.length, contentFingerprint(file.contentBase64)] : null
}

function filesKeyPart(files?: UploadFile[] | null) {
  return files?.length ? files.map((f) => fileKeyPart(f)) : []
}

/**
 * P5 能力开关读取：capabilities.modules 的类型侧尚未列出 P5 两项（后端运行时按模块表展开），
 * 与 P2/P4 的 p2ModuleOn/p4ModuleOn 同一策略——按名称读取，缺省视为未开通。
 */
export function p5ModuleOn(caps: MidlongCapabilities | null | undefined, name: 'review' | 'bills'): boolean {
  return Boolean(caps?.enabled && caps.regionSupported && (caps.modules as Record<string, boolean | undefined>)[name] === true)
}

// ── 业务复盘（review，MR-01/02/06）───────────────────────────────────────────

export async function fetchReviewMetrics(query: { month: string; subjectId?: number | null; asOf?: string | null }): Promise<ReviewMetrics> {
  return dataOf(await apiGet<Envelope<ReviewMetrics>>(`${BASE}/review/metrics`, readQuery(query)))
}

// ── 月度报告（reports，MR-05）───────────────────────────────────────────────

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  return dataOf(await apiPost<Envelope<GenerateReportResult>>(writePath(`${BASE}/reports`), input, withKey(actionKey('report-generate', input))))
}

export async function fetchReports(query: { month?: string; subjectId?: number | null; scope?: string; page?: number; pageSize?: number } = {}): Promise<PageResult<ReviewReportSummaryRow> & { notice: string | null }> {
  return dataOf(await apiGet<Envelope<PageResult<ReviewReportSummaryRow> & { notice: string | null }>>(`${BASE}/reports`, readQuery(query)))
}

export async function fetchReport(reportId: number): Promise<ReviewReportDetail> {
  return dataOf(await apiGet<Envelope<ReviewReportDetail>>(`${BASE}/reports/${reportId}`, readQuery()))
}

/** 冻结快照全文：旧报告数值不变（迟到修订产生新版本，旧版本不被当前数据覆盖）。 */
export async function fetchReportVersion(reportId: number, versionNo: number): Promise<ReviewReportVersionSnapshot> {
  return dataOf(await apiGet<Envelope<ReviewReportVersionSnapshot>>(`${BASE}/reports/${reportId}/versions/${versionNo}`, readQuery()))
}

/** CSV 导出（默认当前版本，可指定 versionNo）：从冻结快照渲染，与归档一致。 */
export async function exportReport(reportId: number, versionNo?: number | null): Promise<MidlongCsvExport & { reportId: number; versionNo: number; contentFingerprint: string | null; notice: string }> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport & { reportId: number; versionNo: number; contentFingerprint: string | null; notice: string }>>(
    `${BASE}/reports/${reportId}/export`, readQuery({ versionNo: versionNo ?? undefined })))
}

/** 受影响报告定位（MR-05/MA-05）：给定已变化的输入，列出冻结了旧版本的报告版本。 */
export async function fetchAffectedReports(input: { kind: AffectedReportInputKind; id: number }): Promise<AffectedReportsResult> {
  return dataOf(await apiGet<Envelope<AffectedReportsResult>>(`${BASE}/reports/affected`, readQuery({ [input.kind]: input.id })))
}

// ── 外部账单（bills，MR-03）─────────────────────────────────────────────────

export type BillQuery = {
  page?: number
  pageSize?: number
  subjectId?: number
  sourceNamespace?: string
  externalBillNo?: string
  billKind?: string
  month?: string
}

export async function fetchBills(query: BillQuery = {}): Promise<PageResult<BillSummaryRow> & { notice: string | null }> {
  return dataOf(await apiGet<Envelope<PageResult<BillSummaryRow> & { notice: string | null }>>(`${BASE}/bills`, readQuery(query)))
}

export async function fetchBill(billId: number): Promise<BillDetailDto> {
  return dataOf(await apiGet<Envelope<BillDetailDto>>(`${BASE}/bills/${billId}`, readQuery()))
}

function billKeyPart(input: BillRegisterInput) {
  return { ...input, file: fileKeyPart(input.file) }
}

export async function registerBill(input: BillRegisterInput): Promise<BillRegisterResult> {
  return dataOf(await apiPost<Envelope<BillRegisterResult>>(writePath(`${BASE}/bills`), input, withKey(actionKey('bill-register', billKeyPart(input)))))
}

/** 修订（旧版保留、金额聚合改按新当前版本、相关差异转需重新核对）：changeReason 与 expectedRowVersion 必填。 */
export async function reviseBill(billId: number, input: BillRegisterInput & { expectedRowVersion: number; changeReason: string }): Promise<BillReviseResult> {
  return dataOf(await apiPost<Envelope<BillReviseResult>>(
    writePath(`${BASE}/bills/${billId}/revisions`), input, withKey(actionKey('bill-revise', [billId, billKeyPart(input)]))))
}

export async function addVoucher(billId: number, input: VoucherInput): Promise<VoucherResult> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<VoucherResult>>(writePath(`${BASE}/bills/${billId}/vouchers`), input, withKey(actionKey('bill-voucher', [billId, keyPart]))))
}

export async function exportBills(query: BillQuery = {}): Promise<MidlongCsvExport & { rowCount: number; notice: string | null }> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport & { rowCount: number; notice: string | null }>>(`${BASE}/bills/export`, readQuery(query)))
}

// ── 差异闭环（discrepancies，MR-04）──────────────────────────────────────────

export type DiscrepancyQuery = {
  page?: number
  pageSize?: number
  subjectId?: number
  billId?: number
  month?: string
  status?: string
}

export async function fetchDiscrepancies(query: DiscrepancyQuery = {}): Promise<PageResult<DiscrepancySummaryRow> & { notices: string[] }> {
  return dataOf(await apiGet<Envelope<PageResult<DiscrepancySummaryRow> & { notices: string[] }>>(`${BASE}/discrepancies`, readQuery(query)))
}

export async function fetchDiscrepancy(discrepancyId: number): Promise<DiscrepancyDetailDto> {
  return dataOf(await apiGet<Envelope<DiscrepancyDetailDto>>(`${BASE}/discrepancies/${discrepancyId}`, readQuery()))
}

export async function registerDiscrepancy(input: DiscrepancyRegisterInput): Promise<DiscrepancyRegisterResult> {
  const keyPart = { ...input, evidence: filesKeyPart(input.evidence) }
  return dataOf(await apiPost<Envelope<DiscrepancyRegisterResult>>(writePath(`${BASE}/discrepancies`), input, withKey(actionKey('discrepancy-register', keyPart))))
}

/** 补充原因/负责人/证据（expectedRowVersion；已解决后 409 冻结）。 */
export async function updateDiscrepancy(discrepancyId: number, input: DiscrepancyUpdateInput): Promise<DiscrepancySummaryRow> {
  const keyPart = { ...input, evidence: filesKeyPart(input.evidence) }
  return dataOf(await apiPatch<Envelope<DiscrepancySummaryRow>>(writePath(`${BASE}/discrepancies/${discrepancyId}`), input, withKey(actionKey('discrepancy-update', [discrepancyId, keyPart]))))
}

/** 关闭差异：resolutionNote 必填（422 DISCREPANCY_RESOLUTION_NOTE_REQUIRED），关闭不改台账。 */
export async function resolveDiscrepancy(discrepancyId: number, input: DiscrepancyResolveInput): Promise<DiscrepancyDetailDto> {
  return dataOf(await apiPost<Envelope<DiscrepancyDetailDto>>(
    writePath(`${BASE}/discrepancies/${discrepancyId}/resolve`), input, withKey(actionKey('discrepancy-resolve', [discrepancyId, input]))))
}

export async function exportDiscrepancies(query: DiscrepancyQuery = {}): Promise<MidlongCsvExport & { rowCount: number; notice: string | null }> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport & { rowCount: number; notice: string | null }>>(`${BASE}/discrepancies/export`, readQuery(query)))
}

// ── 结算附件（账单原件 / 收款凭证文件 / 差异证据）────────────────────────────

export async function fetchSettlementAttachment(attachmentId: number): Promise<SettlementAttachmentDto> {
  return dataOf(await apiGet<Envelope<SettlementAttachmentDto>>(`${BASE}/settlement-attachments/${attachmentId}`, readQuery()))
}
