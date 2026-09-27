// 数据运维台上传中心 client（Epic #2169 P1 · #2173）。
// 五步流对应：①契约与模板 ③预检 ④确认落库 ⑤批次台账/撤销。
// POST /api/v1/* 受网关幂等门：缺 Idempotency-Key → 428，与 ingestClient 同款注入。
import { ApiError, apiGet, apiPost } from '../api'

export interface UploadContractColumn {
  name: string
  type: 'string' | 'number' | 'date' | 'time'
  unit: string | null
  format: string | null
  required: boolean
  aliases: string[]
}

export interface UploadContractSummary {
  dataset: string
  title: string
  kind: 'checklist-delivery' | 'capture-family' | 'cgn-mapping' | 'cgn-spot-export' | 'review-intervals'
  regionPolicy: 'fixed' | 'choose'
  region: string | null
  granularity: string
  cadence: string
  key: string[]
  overlap: string
  notes: string
  review?: { purpose: string; canWrite: boolean } | null
  columns: UploadContractColumn[]
  batchCount: number
  lastBatch: { id: string; createdAt: string; rowsValid: number; status: string } | null
}

export interface PrecheckReport {
  expectedToken?: string | null
  rowErrors?: { row: number; message: string }[]
  notice?: string
  ok: boolean
  fatal?: string
  dataset: string
  region: string
  header: { colMatch: { name: string; via: string | null }[]; missingRequired: string[] }
  rows: { total: number; valid: number; invalid: number; errors: string[] }
  keyDupes: { count: number; samples: string[] }
  overlap: {
    count?: number
    supported: boolean
    strategy?: string
    note?: string
    files?: { path: string; exists: boolean; existingRows?: number }[]
    window?: { from: string; to: string } | null
    catalog?: { family: string; datasetKey: string; rowCount: number; sourceType: string; ingestedAt: string } | null
  }
  canonicalHash: string
  canCommit: boolean
}

export interface UploadBatchRow {
  id: string
  dataset: string
  kind: string
  region: string
  company_id: string | null
  created_by: string
  file_name: string
  rows_total: number
  rows_valid: number
  rows_invalid: number
  overlap: string
  status: 'COMMITTED' | 'REVERTED'
  delivered: string
  created_at: string
  reverted_at: string | null
  revert_note: string | null
}

export interface CommitResult {
  code: number
  msg?: string
  idempotentReplay?: boolean
  batch?: UploadBatchRow
  delivered?: { paths: { path: string; rows: number }[]; hint: string; sqliteOk?: boolean; fileOk?: boolean }
  archiveDir?: string
  precheck?: PrecheckReport
}

export interface UploadScope { companyId: string; region: string }
export interface ReviewImportMetadata { view: 'generator' | 'retail' | 'storage'; simulated: boolean; basisLabel: string; actualLabel: string; sourceLabel: string; sourceVersion: string }

/**
 * 落库冲突（HTTP 409，#2890 / #2898）：同一 (天, 节点, 时刻, 市场) 库内已有**不同**价。
 * 冲突不是格式错误——两份数据都合法，需要人核对哪一边对。`detail` 是服务端逐字下发的
 * 裁决明细（含换行：改价明细「库内值 vs 来件值」逐条列出），必须按原文多行展示，
 * 不得压成单行 toast。
 */
export class UploadConflictError extends Error {
  readonly detail: string
  constructor(message: string, detail = message) {
    super(message)
    this.name = 'UploadConflictError'
    this.detail = detail
  }
}

function scopedOptions(scope?: UploadScope) {
  return scope ? { headers: { 'x-company-id': scope.companyId, 'x-tenant-id': scope.companyId, 'x-region-id': scope.region } } : undefined
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `data-upload-${Date.now()}-${Math.random()}`
}

// ── 信封层级（本文件所有取数函数共用的口径）────────────────────────────────
// data-service 的 /api/v1/data-upload/* **一律把业务载荷放在 `data` 下**
//   { code, msg, data: { contracts }, traceId }
// 而 apiGet/apiPost 的 unwrap() 返回的是**整个信封**（类型写作 T & ApiEnvelope<T>，
// 那是为平台上「载荷平铺在顶层」的另一半端点准备的，如 /api/company/list 的 rows）。
// 所以这些函数必须从 res.data 取，读顶层会恒得 undefined → 落到 [] / 空对象：
// 页面表格永远 "No Data"、模板下载拿不到文件名、预检报告没有 header/rows。
// 这正是上传中心长期「点了没反应、批次台账 0 行」的成因（dljy#2817 收尾时定位）。
function unwrapData<T>(res: { data?: T }): T | undefined {
  return res?.data
}

export async function fetchUploadContracts(scope?: UploadScope): Promise<UploadContractSummary[]> {
  const res = await apiGet<{ contracts: UploadContractSummary[] }>('/api/v1/data-upload/contracts', scope ? { companyId: scope.companyId } : undefined, scopedOptions(scope))
  return unwrapData(res)?.contracts ?? []
}

export async function fetchUploadTemplate(dataset: string, format: 'xlsx' | 'csv' = 'xlsx', scope?: UploadScope): Promise<{ fileName: string; contentBase64?: string; content?: string }> {
  const res = await apiGet<{ fileName: string; contentBase64?: string; content?: string }>(
    `/api/v1/data-upload/template/${dataset}`,
    { format, ...(scope ? { companyId: scope.companyId } : {}) }, scopedOptions(scope)
  )
  const data = unwrapData(res)
  if (!data?.fileName) throw new Error('模板响应缺 fileName（服务端信封形状异常）')
  return data
}

export async function precheckUpload(payload: {
  review?: ReviewImportMetadata
  dataset: string
  fileName: string
  content: string
  isBinary: boolean
  region?: string
}, scope?: UploadScope): Promise<PrecheckReport & { msg?: string }> {
  // 服务端把报告字段 spread 进 data；msg 留在信封顶层，两处合并后交页面。
  const res = await apiPost<PrecheckReport>('/api/v1/data-upload/precheck', { ...payload, ...(scope ? { companyId: scope.companyId } : {}) }, {
    headers: { ...scopedOptions(scope)?.headers, 'Idempotency-Key': newIdempotencyKey() }
  })
  const data = unwrapData(res)
  if (!data) throw new Error(res?.msg ?? '预检响应缺 data（服务端信封形状异常）')
  return { ...data, msg: res.msg }
}

export async function commitUpload(payload: {
  review?: ReviewImportMetadata
  expectedToken?: string | null
  confirmed?: boolean
  dataset: string
  fileName: string
  content: string
  isBinary: boolean
  region?: string
}, scope?: UploadScope): Promise<CommitResult> {
  // commit 的 data 就是完整 result（含 code/batch/delivered/msg）。
  try {
    const res = await apiPost<CommitResult>('/api/v1/data-upload/commit', { ...payload, ...(scope ? { companyId: scope.companyId } : {}) }, {
      headers: { ...scopedOptions(scope)?.headers, 'Idempotency-Key': newIdempotencyKey() }
    })
    const data = unwrapData(res)
    if (!data) throw new Error(res?.msg ?? '提交响应缺 data（服务端信封形状异常）')
    return data
  } catch (err) {
    // 409 = 库内已有不同价，需人裁决（#2890）——转成专用错误，视图层单独成档展示，
    // 不落「落库请求失败」通用档。HTTP status 与信封 code 双看：unwrap 以 code≥400 优先。
    if (err instanceof ApiError && (err.code === 409 || err.status === 409)) {
      throw new UploadConflictError(err.message)
    }
    throw err
  }
}

export async function fetchUploadBatches(dataset?: string, scope?: UploadScope): Promise<UploadBatchRow[]> {
  const res = await apiGet<{ rows: UploadBatchRow[] }>('/api/v1/data-upload/batches', { ...(dataset ? { dataset } : {}), ...(scope ? { companyId: scope.companyId } : {}) }, scopedOptions(scope))
  return unwrapData(res)?.rows ?? []
}

export async function revertUploadBatch(batchId: string, note: string): Promise<{ code: number; msg?: string }> {
  return apiPost(`/api/v1/data-upload/batches/${batchId}/revert`, { note }, {
    headers: { 'Idempotency-Key': newIdempotencyKey() }
  })
}

/** 模板下载：xlsx 走 base64→Blob；csv 直接文本 Blob。 */
export function downloadTemplateFile(fileName: string, contentBase64?: string, content?: string): void {
  const byteChars = contentBase64 ? atob(contentBase64) : (content ?? '')
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  const blob = new Blob([contentBase64 ? bytes : content ?? ''], contentBase64 ? { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } : { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 本地读文件：CSV 读文本；Excel 读 base64（服务端解码，前端不引 xlsx 解析依赖）。 */
export function readLocalFile(file: File): Promise<{ content: string; isBinary: boolean; fileName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    if (/\.xlsx?$/i.test(file.name)) {
      // readAsDataURL 形如 data:...;base64,<payload>，base64 不含逗号，取末段即纯载荷。
      reader.onload = () => resolve({ content: String(reader.result ?? '').split(',').pop() ?? '', isBinary: true, fileName: file.name })
      reader.onerror = () => reject(new Error('Excel 文件读取失败'))
      reader.readAsDataURL(file)
    } else {
      reader.onload = () => resolve({ content: String(reader.result ?? ''), isBinary: false, fileName: file.name })
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsText(file)
    }
  })
}
