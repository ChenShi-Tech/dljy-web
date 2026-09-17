// 云南中长期售电合同 P1 前端服务层（dljy#2939，后端契约 dljy#2938 `/api/v1/midlong/*`）。
//
// 三条约束：
// 1. 公司维度与旧合同页同一口径：读请求带 `company` 查询参数，未选有效公司时直接返回「未选择公司」状态
//    （不发请求，避免服务端回退到会话主公司造成串读）；写请求未选公司直接抛错。
// 2. 写请求的幂等键由「动作 + 合同 + 提交内容」派生：同一内容的重试/双击用同一个键，服务端只执行一次；
//    内容改了键就不同。
// 3. 错误保留服务端错误码（VERSION_CONFLICT、PREVIEW_STALE 等），页面据此给出可操作提示；
//    存储故障与无权限不会被吞成空数据。
import { ApiError, apiGet, apiPatch, apiPost, idempotencyKeyOf } from '@/services/api'
import { companyUnselected } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import type {
  MidlongCapabilities, MidlongContractDetail, MidlongContractInput, MidlongContractListResult, MidlongContractQuery,
  MidlongCsvExport, MidlongErrorCode, MidlongEvidence, MidlongImportBatch, MidlongImportMapping, MidlongImportPreview,
  MidlongOnboardingPreview, MidlongPositionQuery, MidlongPositionReport, MidlongRevision, MidlongSubject,
  EvidenceDocumentType, MidlongEconomicsInput,
} from './midlongTypes'
import { MIDLONG_ERROR_LABELS } from './midlongTypes'

const BASE = '/api/v1/midlong'

type Query = Record<string, string | number | boolean | null | undefined>

/** 服务端错误的结构化视图。 */
export type MidlongFailure = {
  status: number
  errorCode: MidlongErrorCode | 'NETWORK' | 'UNKNOWN'
  message: string
  details: unknown
}

export function midlongFailureOf(error: unknown): MidlongFailure {
  if (error instanceof ApiError) {
    const data = (error.payload as { data?: { errorCode?: MidlongErrorCode; details?: unknown } }).data
    const errorCode = data?.errorCode ?? 'UNKNOWN'
    // HTTP 200 + 信封 code 403/404 这类业务失败：状态以信封 code 为准，否则页面会把无权限/不存在当成一般失败。
    const status = error.status >= 400 ? error.status : (error.code || error.status)
    return { status, errorCode, message: error.message || MIDLONG_ERROR_LABELS[errorCode as MidlongErrorCode] || '请求失败', details: data?.details ?? null }
  }
  if (error instanceof Error) return { status: 0, errorCode: 'NETWORK', message: `网络或服务不可达：${error.message}`, details: null }
  return { status: 0, errorCode: 'UNKNOWN', message: '请求失败', details: null }
}

export class CompanyNotSelectedError extends Error {
  constructor() {
    super('当前地区尚未选择有效公司，请先在公司切换器中选择本地区公司')
    this.name = 'CompanyNotSelectedError'
  }
}

function readQuery(extra: Query = {}): Query {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return { company: selectedCompanyId.value, ...extra }
}

function writePath(path: string): string {
  if (companyUnselected()) throw new CompanyNotSelectedError()
  return `${path}?${new URLSearchParams({ company: selectedCompanyId.value })}`
}

/**
 * 内容派生幂等键：动作 + 公司 + 内容。
 * 公共 idempotencyKeyOf 只有 32 位（FNV-1a），同长度的不同内容可能撞键，被服务端当成重放或「同键不同内容」拒绝；
 * 这里再拼上对同一份规范内容的 53 位指纹，键的有效位数不再被压回 32 位。
 */
export function actionKey(action: string, canonical: unknown): string {
  const scoped = [selectedCompanyId.value, canonical]
  const json = JSON.stringify(scoped) ?? ''
  return `${idempotencyKeyOf(`midlong-${action}`, scoped)}-${json.length.toString(36)}-${contentFingerprint(json)}`
}

/**
 * 完整内容指纹（cyrb53，公有领域算法，53 位）：逐字符覆盖全部内容，只改文件中间也会得到不同指纹。
 * 不用 crypto.subtle——它只在 HTTPS/localhost 安全上下文可用，内网 HTTP 部署下会让上传直接失败。
 */
export function contentFingerprint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`
}

function withKey(key: string) {
  return { headers: { 'Idempotency-Key': key } }
}

type Envelope<T> = { data?: T }
function dataOf<T>(res: Envelope<T>): T {
  if (res.data === undefined || res.data === null) throw new Error('接口响应缺少数据')
  return res.data
}

// ── 能力与主体 ────────────────────────────────────────────────────────────────

export async function fetchCapabilities(): Promise<MidlongCapabilities> {
  return dataOf(await apiGet<Envelope<MidlongCapabilities>>(`${BASE}/capabilities`, readQuery()))
}

export async function fetchSubjects(): Promise<MidlongSubject[]> {
  return dataOf(await apiGet<Envelope<{ rows: MidlongSubject[] }>>(`${BASE}/subjects`, readQuery())).rows
}

export type SubjectInput = { subjectKey: string; displayName: string; unitCode?: string | null; unitCodeSource?: string | null; verificationNote?: string | null; stationIds?: number[] }
export async function createSubject(input: SubjectInput): Promise<MidlongSubject> {
  const res = await apiPost<Envelope<{ subject: MidlongSubject }>>(writePath(`${BASE}/subjects`), input, withKey(actionKey('subject', input)))
  return dataOf(res).subject
}

// ── 合同 ─────────────────────────────────────────────────────────────────────

function contractQuery(query: MidlongContractQuery): Query {
  return { ...query } as Query
}

export async function fetchContracts(query: MidlongContractQuery): Promise<MidlongContractListResult> {
  return dataOf(await apiGet<Envelope<MidlongContractListResult>>(`${BASE}/contracts`, readQuery(contractQuery(query))))
}

export async function exportContracts(query: MidlongContractQuery): Promise<MidlongCsvExport & { rowCount: number }> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport & { rowCount: number }>>(`${BASE}/contracts/export`, readQuery(contractQuery(query))))
}

export async function fetchContract(contractId: number): Promise<MidlongContractDetail> {
  return dataOf(await apiGet<Envelope<MidlongContractDetail>>(`${BASE}/contracts/${contractId}`, readQuery()))
}

export async function createDraft(input: MidlongContractInput): Promise<{ contractId: number; warnings: unknown[] }> {
  return dataOf(await apiPost<Envelope<{ contractId: number; warnings: unknown[] }>>(writePath(`${BASE}/contracts`), input, withKey(actionKey('create', input))))
}

export async function updateDraft(contractId: number, input: MidlongContractInput & { expectedRowVersion: number }): Promise<{ contractId: number }> {
  return dataOf(await apiPatch<Envelope<{ contractId: number }>>(writePath(`${BASE}/contracts/${contractId}`), input, withKey(actionKey('update', [contractId, input]))))
}

export async function verifyContract(contractId: number, body: { expectedRowVersion: number; evidenceIds: number[]; note?: string }): Promise<{ contractId: number; confirmedAt: string }> {
  return dataOf(await apiPost<Envelope<{ contractId: number; confirmedAt: string }>>(writePath(`${BASE}/contracts/${contractId}/verify`), body, withKey(actionKey('verify', [contractId, body]))))
}

export type CorrectionInput = {
  expectedRowVersion: number
  changeType: 'CORRECTION'
  reason: string
  evidenceIds: number[]
  businessEffectiveAt?: string | null
  economics: MidlongEconomicsInput
}
export async function correctContract(contractId: number, body: CorrectionInput): Promise<{ contractId: number; revisionNo: number; affectedMonths: string[] }> {
  return dataOf(await apiPost<Envelope<{ contractId: number; revisionNo: number; affectedMonths: string[] }>>(writePath(`${BASE}/contracts/${contractId}/revisions`), body, withKey(actionKey('correct', [contractId, body]))))
}

export async function fetchRevisions(contractId: number): Promise<MidlongRevision[]> {
  return dataOf(await apiGet<Envelope<{ rows: MidlongRevision[] }>>(`${BASE}/contracts/${contractId}/revisions`, readQuery())).rows
}

export async function voidContract(contractId: number, body: { expectedRowVersion: number; reason: string; evidenceIds: number[] }): Promise<{ contractId: number }> {
  return dataOf(await apiPost<Envelope<{ contractId: number }>>(writePath(`${BASE}/contracts/${contractId}/void`), body, withKey(actionKey('void', [contractId, body]))))
}

export type EvidenceUpload = { fileName: string; contentBase64: string; documentType: Exclude<EvidenceDocumentType, 'IMPORT_SOURCE_FILE'>; note?: string; mediaType?: string }
export async function addEvidence(contractId: number, body: EvidenceUpload): Promise<MidlongEvidence> {
  const res = await apiPost<Envelope<{ evidence: MidlongEvidence }>>(writePath(`${BASE}/contracts/${contractId}/evidence`), body,
    withKey(actionKey('evidence', [contractId, body.documentType, body.fileName, body.note ?? '', body.contentBase64.length, contentFingerprint(body.contentBase64)])))
  return dataOf(res).evidence
}

export async function fetchEvidenceContent(contractId: number, evidenceId: number): Promise<{ evidence: MidlongEvidence; contentBase64: string }> {
  return dataOf(await apiGet<Envelope<{ evidence: MidlongEvidence; contentBase64: string }>>(`${BASE}/contracts/${contractId}/evidence/${evidenceId}`, readQuery()))
}

export async function linkAlias(contractId: number, body: { expectedRowVersion: number; sourceNamespace: string; externalObligationId: string; verificationNote: string }): Promise<{ contractId: number }> {
  return dataOf(await apiPost<Envelope<{ contractId: number }>>(writePath(`${BASE}/contracts/${contractId}/aliases`), body, withKey(actionKey('alias', [contractId, body]))))
}

// ── 导入 ─────────────────────────────────────────────────────────────────────

export type ImportTemplate = { format: 'xlsx' | 'csv'; files: Array<{ role: string; fileName: string; contentBase64?: string; content?: string }> }
export async function fetchImportTemplate(format: 'xlsx' | 'csv'): Promise<ImportTemplate> {
  return dataOf(await apiGet<Envelope<ImportTemplate>>(`${BASE}/imports/template`, readQuery({ format })))
}

export type ImportFileInput = { role: 'workbook' | 'contracts' | 'allocations'; fileName: string; contentBase64: string }
export async function createImportPreview(files: ImportFileInput[], mapping: MidlongImportMapping): Promise<MidlongImportPreview> {
  return dataOf(await apiPost<Envelope<MidlongImportPreview>>(writePath(`${BASE}/imports/previews`), { files, mapping }))
}

export async function commitImport(previewId: string): Promise<MidlongImportBatch> {
  // 同一预览的提交标识固定：超时重试、双击都落到同一个批次。
  return dataOf(await apiPost<Envelope<MidlongImportBatch>>(writePath(`${BASE}/imports/${encodeURIComponent(previewId)}/commit`), {}, withKey(actionKey('import-commit', previewId))))
}

export async function fetchImportBatches(): Promise<Array<{ batchId: string; previewId: string; createdCount: number; skippedCount: number; files: Array<{ role: string; fileName: string }>; committedAt: string; committedBy: string | null }>> {
  return dataOf(await apiGet<Envelope<{ rows: Array<{ batchId: string; previewId: string; createdCount: number; skippedCount: number; files: Array<{ role: string; fileName: string }>; committedAt: string; committedBy: string | null }> }>>(`${BASE}/imports/batches`, readQuery())).rows
}

// ── 月度持仓 ─────────────────────────────────────────────────────────────────

export async function fetchPositions(query: MidlongPositionQuery): Promise<MidlongPositionReport> {
  return dataOf(await apiGet<Envelope<MidlongPositionReport>>(`${BASE}/positions`, readQuery({ ...query } as Query)))
}

export async function exportPositions(query: MidlongPositionQuery): Promise<MidlongCsvExport> {
  return dataOf(await apiGet<Envelope<MidlongCsvExport>>(`${BASE}/positions/export`, readQuery({ ...query } as Query)))
}

// ── 存量纳管 ─────────────────────────────────────────────────────────────────

export async function fetchOnboardingPreview(): Promise<MidlongOnboardingPreview> {
  return dataOf(await apiGet<Envelope<MidlongOnboardingPreview>>(`${BASE}/onboarding/preview`, readQuery()))
}
