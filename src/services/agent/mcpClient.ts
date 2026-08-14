// 外部 MCP server 配置客户端（C1）：对接后端 /api/agent/llm/mcp-servers/*（CRUD + 连通测试）。
// 写操作（增改删/测试）复用 LLM 同款管理令牌（adminHeaders：identityHeaders + x-admin-token）；
// 服务端未配 HARNESS_ADMIN_TOKEN 时返回空头，后端放行（单机/演示）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'

const BASE = `${AGENT_API_BASE}/llm/mcp-servers`
const TIMEOUT_MS = 15_000

export type McpTransport = 'stdio' | 'sse' | 'streamable_http'

export type McpServerSummary = {
  name: string
  transport: McpTransport
  command: string
  args: string[]
  url: string
  has_env: boolean
  enabled: boolean
  allowed_domains: string[]
}

export type McpServerBody = {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled?: boolean
  allowed_domains?: string[]
}

function adminHeaders(): Record<string, string> {
  const headers = identityHeaders()
  const t = getAdminToken()
  if (t) headers['x-admin-token'] = t
  return headers
}

function adminJsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', ...adminHeaders() }
}

async function errDetail(res: Response): Promise<string> {
  try {
    return (await res.json())?.detail ?? ''
  } catch {
    return ''
  }
}

const enc = encodeURIComponent

export async function listMcpServers(): Promise<McpServerSummary[]> {
  const res = await fetch(BASE, { headers: identityHeaders(), signal: timeoutSignal(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`获取 MCP server 列表失败: ${res.status}`)
  return ((await res.json()).servers ?? []) as McpServerSummary[]
}

export async function saveMcpServer(body: McpServerBody): Promise<void> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: adminJsonHeaders(),
    body: JSON.stringify(body),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
}

export async function deleteMcpServer(name: string): Promise<void> {
  const res = await fetch(`${BASE}/${enc(name)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
    signal: timeoutSignal(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `删除失败: ${res.status}`)
}

export async function testMcpServer(name: string): Promise<{ ok: boolean; tools: string[]; msg?: string }> {
  const res = await fetch(`${BASE}/${enc(name)}/test`, {
    method: 'POST',
    headers: adminHeaders(),
    signal: timeoutSignal(30_000),
  })
  if (!res.ok) return { ok: false, tools: [], msg: `HTTP ${res.status}` }
  return (await res.json()) as { ok: boolean; tools: string[]; msg?: string }
}
