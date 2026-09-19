// 中长期售电 P4 前端服务层（dljy#3014，后端契约 dljy#3013 `/api/v1/midlong/{executions,adjustments}`）。
//
// 与 P1/P3 客户端同一约束（见 midlongApi.ts / midlongP3Api.ts）：
// 1. 读请求带 `company` 查询参数，未选有效公司直接报「未选择公司」，不发请求；写请求未选公司直接抛错。
// 2. 写请求的幂等键由「动作 + 对象 + 提交内容」派生：同一内容的重试、双击只执行一次；附件只按
//    文件名、长度与完整内容指纹参与（不把整份 base64 拼进键）。
// 3. 错误保留服务端错误码与 details（SUBJECT_MISMATCH、ADJUSTABLE_BALANCE_EXCEEDED 逐月「请求/可调」、
//    BASE_REVISION_MOVED 等），由 midlongP4Format 翻成可操作提示，不吞成空数据。
// 本文件只有读取与明确的业务动作；不自动登录或操作外部交易平台（MT-02）。
import { apiGet, apiPost } from '@/services/api'
import { companyUnselected } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { CompanyNotSelectedError, actionKey, contentFingerprint } from './midlongApi'
import type { MidlongCapabilities, PriceComponent, ProductKind, TaxBasis, TradeMethod } from './midlongTypes'
import type {
  ExecutionConfirmationDetailDto, ExecutionConfirmationSummaryRow, ExecutionLinkKind, ExecutionRegisterableResultStatus,
  RegisterConfirmationResultDto,
} from 'shared/midlong/execution.mjs'
import type {
  AdjustmentConfirmResult, AdjustmentDetailDto, AdjustmentImpactReport, AdjustmentInput, AdjustmentMappingDto,
  AdjustmentMappingInput, AdjustmentMappingWriteResult, AdjustmentPrices, AdjustmentSummaryRow, AdjustmentWriteResult,
  AdjustableBalanceReport, RevisionImpactReport,
} from './midlongP4Types'
import type { PageResult } from './midlongP3Types'

const BASE = '/api/v1/midlong'

type Query = Record<string, string | number | boolean | null | undefined>
type Envelope<T> = { data?: T }
type UploadFile = { fileName: string; contentBase64: string; mediaType?: string | null }

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

/**
 * P4 能力开关读取：capabilities.modules 的类型侧尚未列出 P4 两项（后端运行时按模块表展开），
 * 与 P2 的 p2ModuleOn 同一策略——按名称读取，缺省视为未开通。
 */
export function p4ModuleOn(caps: MidlongCapabilities | null | undefined, name: 'executions' | 'adjustments'): boolean {
  return Boolean(caps?.enabled && caps.regionSupported && (caps.modules as Record<string, boolean | undefined>)[name] === true)
}

// ── 执行确认（executions，MT-03..06 / MS-04）─────────────────────────────────

/** 确认单登记 / 修订的请求体：结果状态、来源与编号、逐交割段量价、依据文件（确认成交必填）。 */
export type ConfirmationInput = {
  subjectId: number
  sourceNamespace: string
  confirmationNo: string
  proposalId?: number | null
  resultStatus: ExecutionRegisterableResultStatus
  productKind?: ProductKind | null
  tradeMethod?: TradeMethod | null
  unsupportedProduct?: string | null
  priceTaxBasis?: TaxBasis | null
  priceComponent?: PriceComponent | null
  externalConfirmedAt?: string | null
  sourceName?: string | null
  note?: string | null
  counterpartyName?: string | null
  contractName?: string | null
  linkContractId?: number | null
  segments: Array<{ deliveryMonth: string; quantity: string; price?: string | null }>
  file?: UploadFile | null
}

export type ConfirmationQuery = {
  page?: number
  pageSize?: number
  subjectId?: string
  proposalId?: string
  sourceNamespace?: string
  confirmationNo?: string
  resultStatus?: string
  pendingReview?: boolean
}

export async function fetchExecutions(query: ConfirmationQuery = {}): Promise<PageResult<ExecutionConfirmationSummaryRow>> {
  return dataOf(await apiGet<Envelope<PageResult<ExecutionConfirmationSummaryRow>>>(`${BASE}/executions`, readQuery(query)))
}

function confirmationKeyPart(input: ConfirmationInput) {
  return { ...input, file: fileKeyPart(input.file) }
}

export async function registerConfirmation(input: ConfirmationInput): Promise<RegisterConfirmationResultDto> {
  return dataOf(await apiPost<Envelope<RegisterConfirmationResultDto>>(
    writePath(`${BASE}/executions/confirmations`), input, withKey(actionKey('confirmation-register', confirmationKeyPart(input)))))
}

export async function fetchConfirmation(confirmationId: number): Promise<ExecutionConfirmationDetailDto> {
  return dataOf(await apiGet<Envelope<ExecutionConfirmationDetailDto>>(`${BASE}/executions/confirmations/${confirmationId}`, readQuery()))
}

/** 修订必填 changeReason 与依据文件（确认成交时）；内容变化生成新版本，旧版本保留（MT-04）。 */
export async function reviseConfirmation(confirmationId: number, input: ConfirmationInput & { expectedRowVersion: number; changeReason: string }): Promise<RegisterConfirmationResultDto> {
  return dataOf(await apiPost<Envelope<RegisterConfirmationResultDto>>(
    writePath(`${BASE}/executions/confirmations/${confirmationId}/revisions`), input, withKey(actionKey('confirmation-revise', [confirmationId, confirmationKeyPart(input)]))))
}

export type RevokeConfirmationInput = { expectedRowVersion: number; reason: string; externalRevokedAt?: string | null; file?: UploadFile | null }

/** 外部撤销冲正（MT-04）：旧成交记录保留、合同生成更正版本；占用不因冲正恢复。 */
export async function revokeConfirmation(confirmationId: number, input: RevokeConfirmationInput): Promise<RegisterConfirmationResultDto & { reversalId: number; contractRevisionNo: number | null }> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<RegisterConfirmationResultDto & { reversalId: number; contractRevisionNo: number | null }>>(
    writePath(`${BASE}/executions/confirmations/${confirmationId}/revoke`), input, withKey(actionKey('confirmation-revoke', [confirmationId, keyPart]))))
}

export type LinkConfirmationInput = { contractId?: number | null; externalContractNo?: string | null; sourceNamespace?: string | null; note: string }

/** 关联既有合同（补纸质合同）：只新增关联记录，不新增同一义务（持仓不变）。 */
export async function linkConfirmationContract(confirmationId: number, input: LinkConfirmationInput): Promise<{ confirmationId: number; contractId: number; linkKind: ExecutionLinkKind; notice: string; pendingReview: boolean }> {
  return dataOf(await apiPost<Envelope<{ confirmationId: number; contractId: number; linkKind: ExecutionLinkKind; notice: string; pendingReview: boolean }>>(
    writePath(`${BASE}/executions/confirmations/${confirmationId}/link`), input, withKey(actionKey('confirmation-link', [confirmationId, input]))))
}

// ── 合同调整（adjustments，MA-01..05）────────────────────────────────────────

export type AdjustmentQuery = {
  page?: number
  pageSize?: number
  contractId?: string
  subjectId?: string
  status?: string
  adjustmentType?: string
  direction?: string
  pendingDirection?: boolean
  sourceNamespace?: string
  externalAdjustmentNo?: string
}

export async function fetchAdjustments(query: AdjustmentQuery = {}): Promise<PageResult<AdjustmentSummaryRow>> {
  return dataOf(await apiGet<Envelope<PageResult<AdjustmentSummaryRow>>>(`${BASE}/adjustments`, readQuery(query)))
}

function adjustmentKeyPart(input: AdjustmentInput) {
  return { ...input, prices: pricesKeyPart(input.prices), file: fileKeyPart(input.file) }
}

function pricesKeyPart(prices?: AdjustmentPrices | null) {
  if (!prices) return null
  return Object.fromEntries(Object.entries(prices).map(([kind, item]) => [kind, item ? [item.amount, item.currency, item.taxBasis, item.note] : null]))
}

export async function registerAdjustment(input: AdjustmentInput): Promise<AdjustmentWriteResult> {
  return dataOf(await apiPost<Envelope<AdjustmentWriteResult>>(writePath(`${BASE}/adjustments`), input, withKey(actionKey('adjustment-register', adjustmentKeyPart(input)))))
}

export async function fetchAdjustment(adjustmentId: number): Promise<AdjustmentDetailDto> {
  return dataOf(await apiGet<Envelope<AdjustmentDetailDto>>(`${BASE}/adjustments/${adjustmentId}`, readQuery()))
}

/** 修订（人工核对补方向 / 内容修正 / 基线移动后按原内容重新对准）：未生效调整专用。 */
export async function reviseAdjustment(adjustmentId: number, input: AdjustmentInput & { expectedRowVersion: number; changeReason: string }): Promise<AdjustmentWriteResult> {
  return dataOf(await apiPost<Envelope<AdjustmentWriteResult>>(
    writePath(`${BASE}/adjustments/${adjustmentId}/revisions`), input, withKey(actionKey('adjustment-revise', [adjustmentId, adjustmentKeyPart(input)]))))
}

export type ConfirmAdjustmentInput = { expectedRowVersion: number; note?: string | null; evidenceDocumentType?: string; file?: UploadFile | null }

/** 确认生效（MA-04 原子）：合同新版本 + 生效台账 + 解释事件单事务；返回逐月 before/after/delta。 */
export async function confirmAdjustment(adjustmentId: number, input: ConfirmAdjustmentInput): Promise<AdjustmentConfirmResult> {
  const keyPart = { ...input, file: fileKeyPart(input.file) }
  return dataOf(await apiPost<Envelope<AdjustmentConfirmResult>>(
    writePath(`${BASE}/adjustments/${adjustmentId}/confirm`), input, withKey(actionKey('adjustment-confirm', [adjustmentId, keyPart]))))
}

/** 可调余额（MA-03）：当前版本各正式分解月份的可调量、价格状态、是否已结束、未分解池。 */
export async function fetchAdjustableBalance(contractId: number): Promise<AdjustableBalanceReport> {
  return dataOf(await apiGet<Envelope<AdjustableBalanceReport>>(`${BASE}/adjustments/balance`, readQuery({ contractId })))
}

/** 调整影响查询（MA-05）：受影响月份、冻结/拟变更快照、受影响 P3 计划与方案占用、asOf 解释。 */
export async function fetchAdjustmentImpact(adjustmentId: number): Promise<AdjustmentImpactReport> {
  return dataOf(await apiGet<Envelope<AdjustmentImpactReport>>(`${BASE}/adjustments/${adjustmentId}/impact`, readQuery()))
}

/** 合同版本影响查询（MA-05）：录入更正与调整产生的变更版本均可查（初始/基线版本 422）。 */
export async function fetchRevisionImpact(contractId: number, revisionNo: number): Promise<RevisionImpactReport> {
  return dataOf(await apiGet<Envelope<RevisionImpactReport>>(`${BASE}/adjustments/impact`, readQuery({ contractId, revisionNo })))
}

/** 显式映射登记（MA-02）：(来源, 外部产品代码) → (类型, 方向)，带依据；同键同内容幂等。 */
export async function registerMapping(input: AdjustmentMappingInput): Promise<AdjustmentMappingWriteResult> {
  return dataOf(await apiPost<Envelope<AdjustmentMappingWriteResult>>(writePath(`${BASE}/adjustments/mappings`), input, withKey(actionKey('adjustment-mapping', input))))
}

export async function fetchMappings(query: { sourceNamespace?: string; externalProductCode?: string } = {}): Promise<{ rows: AdjustmentMappingDto[]; notice: string }> {
  return dataOf(await apiGet<Envelope<{ rows: AdjustmentMappingDto[]; notice: string }>>(`${BASE}/adjustments/mappings`, readQuery(query)))
}
