// 大模型调用：统一走服务端 gateway（/api/agent/llm/*），API Key 落服务端（不再存浏览器）。
// 开发态经 vite 代理 /agent-api → :8000，生产态 /api/agent（基址与 agentClient 同源）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const LLM_BASE = `${AGENT_API_BASE}/llm`
const LLM_CONFIG_TIMEOUT_MS = 10000
const LLM_WRITE_TIMEOUT_MS = 30000
const LLM_CHAT_TIMEOUT_MS = 45000

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmModelInfo = { model: string; ref: string; tier?: string; vision?: boolean }
export type LlmProviderInfo = {
  provider: string
  base_url: string
  models: LlmModelInfo[]
  has_key: boolean
  base_url_override?: string | null
}

// 模块级缓存：是否已有任一 provider 在服务端配了 key（供同步 isLlmConfigured 读取）。
let _configured = false

export function isLlmConfigured(): boolean {
  return _configured
}

// 管理令牌：仅当服务端设置了 HARNESS_ADMIN_TOKEN 时，写/删密钥才需要（存本机浏览器）。
const ADMIN_TOKEN_KEY = 'dljy_llm_admin_token'
export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setAdminToken(token: string) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token)
    else localStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}
function adminHeaders(): Record<string, string> {
  const t = getAdminToken()
  return t ? { 'x-admin-token': t } : {}
}

export async function refreshLlmStatus(): Promise<boolean> {
  try {
    _configured = (await listProviders()).some((p) => p.has_key)
  } catch {
    _configured = false
  }
  return _configured
}

export async function listProviders(): Promise<LlmProviderInfo[]> {
  const res = await fetch(`${LLM_BASE}/providers`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`providers ${res.status}`)
  const data = await res.json()
  return (data?.providers ?? []) as LlmProviderInfo[]
}

export async function saveProviderKey(
  provider: string,
  apiKey: string,
  baseUrl = ''
): Promise<{ ok: boolean; msg?: string }> {
  // 失败原因区分：403=管理令牌错误、400=未知 provider、网络异常=后端未运行。
  // 此前只返回 boolean，丢失后端 detail，UI 永远显示「后端未运行/令牌不正确」误导用户。
  try {
    const res = await fetch(`${LLM_BASE}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, msg: body.detail || `HTTP ${res.status}` }
    }
    await refreshLlmStatus()
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

export async function deleteProviderKey(provider: string): Promise<boolean> {
  const res = await fetch(`${LLM_BASE}/keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: { ...identityHeaders(), ...adminHeaders() },
    signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
  })
  await refreshLlmStatus()
  return res.ok
}

export async function testProviderKey(args: {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
}): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${LLM_BASE}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      body: JSON.stringify({
        provider: args.provider,
        model: args.model,
        api_key: args.apiKey ?? '',
        base_url: args.baseUrl ?? ''
      }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    const data = await res.json().catch(() => ({}))
    return { ok: !!data.ok, msg: data.msg ?? (res.ok ? '' : `HTTP ${res.status}`) }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误' }
  }
}

type ChatResult = { ok?: boolean; content?: string; msg?: string; detail?: string }

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { json?: boolean; signal?: AbortSignal; modelRef?: string; timeoutMs?: number }
): Promise<string> {
  const res = await fetch(`${LLM_BASE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({
      messages,
      json_mode: opts?.json ?? false,
      model_ref: opts?.modelRef ?? ''
    }),
    signal: opts?.signal ?? timeoutSignal(opts?.timeoutMs ?? LLM_CHAT_TIMEOUT_MS)
  })
  const data = (await res.json().catch(() => ({}))) as ChatResult
  // 限流(429)/校验失败等走 FastAPI HTTPException，错误信息在 detail 而非 {ok,msg}；
  // 不查 res.ok 会把「调用过于频繁」吞成通用「大模型请求失败」。
  if (!res.ok) throw new Error(data.detail || data.msg || `请求失败: ${res.status}`)
  if (!data.ok) throw new Error(data.msg || '大模型请求失败')
  return data.content ?? ''
}

// ── 联网搜索配置（/llm/search；web_search 工具按此取供应商 + key）──
// 与 LLM 密钥同源同鉴权（admin token）。明文 key 不回传，GET 只给 provider + has_key。
export type SearchConfig = {
  provider: string
  has_key: boolean
  env_keyed: boolean
  supported: string[]
  model?: string   // volcengine 等：doubao 模型名（UI 回显）
}

export async function getSearchConfig(): Promise<SearchConfig> {
  const res = await fetch(`${LLM_BASE}/search`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`搜索配置获取失败: ${res.status}`)
  return (await res.json()) as SearchConfig
}

export async function saveSearchConfig(
  provider: string,
  apiKey: string,
  model?: string
): Promise<{ ok: boolean; msg?: string }> {
  try {
    const res = await fetch(`${LLM_BASE}/search`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify({ provider, api_key: apiKey, ...(model ? { model } : {}) }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, msg: body.detail || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

export async function deleteSearchConfig(): Promise<boolean> {
  const res = await fetch(`${LLM_BASE}/search`, {
    method: 'DELETE',
    headers: { ...identityHeaders(), ...adminHeaders() },
    signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
  })
  return res.ok
}

// ── agent 出网访问黑名单（/llm/denylist）────────────────────────────────────
// web_fetch/web_search 与 browser_* 共用：默认全放行，只拒绝名单内域名。
// 默认表由 agent runtime 只读提供（env HARNESS_DOMAIN_DENYLIST）；用户增补经管理员鉴权保存并即时生效。
export type Denylist = {
  defaults: string[]
  extra: string[]
  effective: string[]
}

export async function getDenylist(): Promise<Denylist> {
  const res = await fetch(`${LLM_BASE}/denylist`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`黑名单获取失败: ${res.status}`)
  return (await res.json()) as Denylist
}

export async function addDenylist(domain: string): Promise<{ ok: boolean; msg?: string; view?: Denylist }> {
  try {
    const res = await fetch(`${LLM_BASE}/denylist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify({ domain }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    const body = (await res.json().catch(() => ({}))) as Denylist & { detail?: string }
    if (!res.ok) return { ok: false, msg: body.detail || `HTTP ${res.status}` }
    return { ok: true, view: body }
  } catch (error) {
    return { ok: false, msg: error instanceof Error ? error.message : '网络错误（后端未运行？）' }
  }
}

// 删除走查询参数：CIDR 条目（10.0.0.0/8）编码进路径段时会被服务端提前解码成真斜杠而 404。
export async function removeDenylist(domain: string): Promise<Denylist | null> {
  const res = await fetch(`${LLM_BASE}/denylist?domain=${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    headers: { ...identityHeaders(), ...adminHeaders() },
    signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
  })
  return res.ok ? ((await res.json()) as Denylist) : null
}

export async function testSearchConfig(args: {
  provider: string
  apiKey?: string
  model?: string
}): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${LLM_BASE}/search/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify({
        provider: args.provider,
        api_key: args.apiKey ?? '',
        ...(args.model ? { model: args.model } : {})
      }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; msg?: string; detail?: string }
    return { ok: !!data.ok, msg: data.detail || data.msg || (res.ok ? '' : `HTTP ${res.status}`) }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误' }
  }
}
