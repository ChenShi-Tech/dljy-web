// 数据运维台上传中心 client（Epic #2169 P1 · #2173）。
// 五步流对应：①契约与模板 ③预检 ④确认落库 ⑤批次台账/撤销。
// POST /api/v1/* 受网关幂等门：缺 Idempotency-Key → 428，与 ingestClient 同款注入。
import { apiGet, apiPost } from '../api'

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
  kind: 'checklist-delivery' | 'capture-family'
  regionPolicy: 'fixed' | 'choose'
  region: string | null
  granularity: string
  cadence: string
  key: string[]
  overlap: string
  notes: string
  columns: UploadContractColumn[]
  batchCount: number
  lastBatch: { id: string; createdAt: string; rowsValid: number; status: string } | null
}

export interface PrecheckReport {
  ok: boolean
  fatal?: string
  dataset: string
  region: string
  header: { colMatch: { name: string; via: string | null }[]; missingRequired: string[] }
  rows: { total: number; valid: number; invalid: number; errors: string[] }
  keyDupes: { count: number; samples: string[] }
  overlap: {
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

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `data-upload-${Date.now()}-${Math.random()}`
}

export async function fetchUploadContracts(): Promise<UploadContractSummary[]> {
  const res = await apiGet<{ contracts: UploadContractSummary[] }>('/api/v1/data-upload/contracts')
  return res.contracts ?? []
}

export async function fetchUploadTemplate(dataset: string, format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ fileName: string; contentBase64?: string; content?: string }> {
  const res = await apiGet<{ fileName: string; contentBase64?: string; content?: string }>(
    `/api/v1/data-upload/template/${dataset}`,
    { format }
  )
  return res
}

export async function precheckUpload(payload: {
  dataset: string
  fileName: string
  content: string
  isBinary: boolean
  region?: string
}): Promise<PrecheckReport & { msg?: string }> {
  return apiPost<PrecheckReport>('/api/v1/data-upload/precheck', payload, {
    headers: { 'Idempotency-Key': newIdempotencyKey() }
  })
}

export async function commitUpload(payload: {
  dataset: string
  fileName: string
  content: string
  isBinary: boolean
  region?: string
}): Promise<CommitResult> {
  return apiPost<CommitResult>('/api/v1/data-upload/commit', payload, {
    headers: { 'Idempotency-Key': newIdempotencyKey() }
  })
}

export async function fetchUploadBatches(dataset?: string): Promise<UploadBatchRow[]> {
  const res = await apiGet<{ rows: UploadBatchRow[] }>('/api/v1/data-upload/batches', dataset ? { dataset } : undefined)
  return res.rows ?? []
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
  const blob = new Blob([bytes], contentBase64 ? { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } : { type: 'text/csv' })
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
      // readAsDataURL 形如 data:...;base64,<payload>——base64 不含逗号，取末段即纯载荷。
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
