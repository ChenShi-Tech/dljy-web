// 子智能体工作室客户端：对接 agent-backend 的 /api/agent/sub-agents/*。
// 与 agentSkills.ts 同源（共用 agentClient 的 AGENT_API_BASE / identityHeaders /
// 管理令牌鉴权）。写操作复用 LLM 同款 x-admin-token；读操作不需令牌。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'

const SUB_AGENTS_BASE = `${AGENT_API_BASE}/sub-agents`

export type AgentSource = 'builtin' | 'user'

// 列表摘要（不含 prompt 大文本）
export type SubAgentSummary = {
  role: string
  name: string
  description: string
  char: string
  model_ref: string
  requires: string[]
  tool_categories: string[]
  delegate_desc: string
  owner_supervisor: string[]
  bound_modules: string[]
  enabled: boolean
  source: AgentSource
}

// 详情（含 prompt 全文，供编辑）
export type SubAgentDetail = SubAgentSummary & {
  prompt: string
}

export type AgentModel = {
  ref: string
  provider: string
  model: string
  capabilities: string[]
  has_key: boolean
}

export type AgentModule = { key: string; name: string }

// 写操作携带管理令牌（未配置 HARNESS_ADMIN_TOKEN 时返回空头，后端放行）
function adminHeaders(): Record<string, string> {
  const headers = identityHeaders()
  const t = getAdminToken()
  if (t) headers['x-admin-token'] = t
  return headers
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', ...adminHeaders() }
}

function readHeaders(): Record<string, string> {
  return identityHeaders()
}

// FastAPI HTTPException 的错误体为 {detail: string|object}
async function errDetail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const d = body?.detail
    if (typeof d === 'string') return d
    if (d?.message) return d.message
    return JSON.stringify(d) ?? ''
  } catch {
    return ''
  }
}

const enc = encodeURIComponent
const TIMEOUT_MS = 10_000

function signal(): AbortSignal | undefined {
  return timeoutSignal(TIMEOUT_MS)
}

export async function listSubAgents(): Promise<SubAgentSummary[]> {
  const res = await fetch(SUB_AGENTS_BASE, { headers: readHeaders(), signal: signal() })
  if (!res.ok) throw new Error(`子智能体列表获取失败: ${res.status}`)
  return (await res.json()).agents ?? []
}

export async function getSubAgent(role: string): Promise<SubAgentDetail> {
  const res = await fetch(`${SUB_AGENTS_BASE}/${enc(role)}`, { headers: readHeaders(), signal: signal() })
  if (!res.ok) throw new Error((await errDetail(res)) || `子智能体详情获取失败: ${res.status}`)
  return (await res.json()) as SubAgentDetail
}

export type SubAgentUpsert = {
  name: string
  description: string
  char: string
  prompt: string
  tool_categories: string[]
  model_ref: string
  requires: string[]
  delegate_desc: string
  owner_supervisor: string[]
  bound_modules: string[]
  enabled: boolean
}

export async function saveSubAgent(role: string, payload: SubAgentUpsert): Promise<SubAgentSummary> {
  const res = await fetch(`${SUB_AGENTS_BASE}/${enc(role)}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal: signal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
  return (await res.json()) as SubAgentSummary
}

export async function deleteSubAgent(role: string): Promise<boolean> {
  const res = await fetch(`${SUB_AGENTS_BASE}/${enc(role)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
    signal: signal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `删除失败: ${res.status}`)
  return true
}

export async function setSubAgentEnabled(role: string, enabled: boolean): Promise<boolean> {
  const res = await fetch(`${SUB_AGENTS_BASE}/${enc(role)}/enabled`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({ enabled }),
    signal: signal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `启停失败: ${res.status}`)
  return true
}

export async function importSubAgentZip(file: File, overwrite = false): Promise<SubAgentSummary> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${SUB_AGENTS_BASE}/import?overwrite=${overwrite}`, {
    method: 'POST',
    headers: adminHeaders(), // 不设 content-type，由浏览器为 FormData 设 multipart 边界
    body: form,
    signal: signal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `导入失败: ${res.status}`)
  return (await res.json()) as SubAgentSummary
}

// 导出为下载链接（GET 直接返回 zip，组件用 <a download> 触发）
export function exportSubAgentUrl(role: string): string {
  return `${SUB_AGENTS_BASE}/${enc(role)}/export`
}

// 可用模型清单（model_ref 下拉）
export async function listAgentModels(): Promise<AgentModel[]> {
  const res = await fetch(`${SUB_AGENTS_BASE}/models`, { headers: readHeaders(), signal: signal() })
  if (!res.ok) throw new Error(`模型列表获取失败: ${res.status}`)
  return (await res.json()).models ?? []
}

// 业务模块 + 工具类别清单（bound_modules 多选 + tool_categories 多选）
export type AgentModuleMeta = { modules: AgentModule[]; tool_categories: string[] }
export async function listAgentModules(): Promise<AgentModuleMeta> {
  const res = await fetch(`${SUB_AGENTS_BASE}/modules`, { headers: readHeaders(), signal: signal() })
  if (!res.ok) throw new Error(`模块清单获取失败: ${res.status}`)
  return await res.json()
}
