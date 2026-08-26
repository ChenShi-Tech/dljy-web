// 南洋推理服务管理代理客户端（dljy#2465 · Epic dljy#2455 4.3.11）。
// 全部经 agent-backend `/api/v1/forecast/remote/*`（主仓 dljy#2479）：平台是唯一管理面，前端不直连南洋；
// 服务端按平台登录会话校验 ADMIN/BOSS（前端 adminOnlyRoutes 只是页面级便利，不是安全边界）。
// 三个契约坑（实测）：① 目录里 available:true 可同时带 unavailableReason（零样本懒加载）——判可用只看 available；
// ② 字段按来源分裂（bundle 有 bundleId/evidenceLevel 无 activeVersion，native/zeroshot 反之）；
// ③ 信封分裂——本代理的 /models 是契约投影数组、写操作是南洋裸 JSON，错误走 FastAPI {detail}。
import { AGENT_API_BASE_ROOT, timeoutSignal } from '@/services/api'
import { identityHeaders } from '@/services/agent/agentClient'
import { normalizeModelRegistryEntry, type ForecastModel } from '@/services/forecast/modelContract'

const BASE = `${AGENT_API_BASE_ROOT}/v1/forecast/remote`
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000   // rescan 会重扫全部来源

export type RemoteHealthState = 'ok' | 'unauthorized' | 'unreachable'
export interface RemoteHealth {
  state: RemoteHealthState
  url?: string
  reason?: string
  contractVersion?: string | null
  version?: string | null
  device?: string | null
  modelCount?: number | null
}
export interface RemoteModelVersion {
  version: string
  active?: boolean
  trainedAt?: string | null
  trainWindow?: string[] | null
  checksum?: string
  hasCheckpoint?: boolean
  bundleManaged?: boolean
  mock?: boolean
}
export interface RemoteFieldsReport { registry: Record<string, unknown>; drift: string[]; platformSnapshotUpdatedAt?: string | null }

/** 目录里的 id 是 `remote:<modelId>`；南洋管理端点用裸 id。 */
export function bareModelId(id: string): string {
  return id.startsWith('remote:') ? id.slice('remote:'.length) : id
}

async function request<T>(method: 'GET' | 'POST', path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...identityHeaders() },
    signal: timeoutSignal(timeoutMs),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = String((await res.json())?.detail ?? '') } catch { /* 非 JSON 错误体 */ }
    throw new Error(detail || `请求失败: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchRemoteHealth(): Promise<RemoteHealth> {
  return request<RemoteHealth>('GET', '/health', READ_TIMEOUT_MS)
}

/** 南洋全部模型（不按 target/region 过滤），经契约归一化（io/paramsSchema/lineage 可用）。 */
export async function fetchRemoteModels(): Promise<ForecastModel[]> {
  const raw = await request<unknown[]>('GET', '/models', READ_TIMEOUT_MS)
  const out: ForecastModel[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const rec = (item ?? {}) as Record<string, unknown>
    const m = normalizeModelRegistryEntry(item, {
      target: String(rec.target ?? ''), regionId: String(rec.regionId ?? ''),
    })
    if (m) out.push(m)
  }
  return out
}

export function fetchRemoteVersions(modelId: string): Promise<RemoteModelVersion[]> {
  return request<RemoteModelVersion[]>('GET', `/models/${encodeURIComponent(bareModelId(modelId))}/versions`, READ_TIMEOUT_MS)
}

export function fetchRemoteFields(): Promise<RemoteFieldsReport> {
  return request<RemoteFieldsReport>('GET', '/fields', READ_TIMEOUT_MS)
}

export function setRemoteModelEnabled(modelId: string, enabled: boolean): Promise<Record<string, unknown>> {
  return request('POST', `/models/${encodeURIComponent(bareModelId(modelId))}/${enabled ? 'enable' : 'disable'}`, WRITE_TIMEOUT_MS)
}

export function reloadRemoteModel(modelId: string): Promise<Record<string, unknown>> {
  return request('POST', `/models/${encodeURIComponent(bareModelId(modelId))}/reload`, WRITE_TIMEOUT_MS)
}

export function unloadRemoteModel(modelId: string): Promise<Record<string, unknown>> {
  return request('POST', `/models/${encodeURIComponent(bareModelId(modelId))}/unload`, WRITE_TIMEOUT_MS)
}

export function activateRemoteVersion(modelId: string, version: string): Promise<Record<string, unknown>> {
  return request('POST', `/models/${encodeURIComponent(bareModelId(modelId))}/activate/${encodeURIComponent(version)}`, WRITE_TIMEOUT_MS)
}

export function rescanRemote(): Promise<{ ok: boolean; modelCount: number; availableCount: number }> {
  return request('POST', '/rescan', WRITE_TIMEOUT_MS)
}
