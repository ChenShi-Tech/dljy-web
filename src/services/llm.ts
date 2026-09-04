// 大模型调用：统一走服务端 gateway（/api/agent/llm/*）。前端不持密钥、不持供应商与型号清单（#2668）。
// 开发态经 vite 代理 /agent-api → :8000，生产态 /api/agent（基址与 agentClient 同源）。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const LLM_BASE = `${AGENT_API_BASE}/llm`
const LLM_CONFIG_TIMEOUT_MS = 10000
const LLM_WRITE_TIMEOUT_MS = 30000
const LLM_CHAT_TIMEOUT_MS = 45000

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// ---------------------------------------------------------------------------
// 模型服务（Epic #2661 · #2668 · #2701）：前端不持有供应商 / 型号，也不落密钥明文。
// 后端网关模式下 GET /llm/services 给出「能力档位」清单（中文标签 + 能力位），用户只做三件事：
// 在「接入凭据」处填写供应方下发的网关地址与密钥（明文只随 PUT 直传服务端，GET 只回显尾号）、
// 勾选启用哪些档位、把角色路由到已启用档位。密钥也可由我方在安装时预置（source === 'env'）。
// ---------------------------------------------------------------------------
export type LlmServiceTier = {
  id: string
  label: string
  description: string
  capabilities: string[]
  context_window: number | null
  available: boolean
  enabled: boolean
}
export type LlmServiceRole = {
  role: string
  default_tier: string
  tier: string | null
  override: boolean
  requires: string[]
}
// 接入凭据状态（GET 只回显：是否已配、来源、网关地址、密钥尾号——**明文永不回传**）
export type LlmCredential = {
  configured: boolean
  source: 'ui' | 'env' | null
  url: string
  key_hint: string
  updated_at: string | null
}
// 联网搜索开通状态（网关统一提供，前端不再自己配搜索引擎）
export type LlmSearchStatus = {
  granted: boolean
  available: boolean
  reason: string | null
}
export type LlmServices = {
  available: boolean
  gateway: boolean
  reason: string | null
  tiers: LlmServiceTier[]
  roles: LlmServiceRole[]
  credential?: LlmCredential
  search?: LlmSearchStatus
}

// 模块级缓存：大模型是否可用（网关档位可用，或内部档直连已配 key），供同步 isLlmConfigured 读取；
// 档位快照供斜杠命令 /model 同步列出（它的参数补全是同步函数）。
let _configured = false
let _tiers: LlmServiceTier[] = []

export function isLlmConfigured(): boolean {
  return _configured
}

/** 最近一次 refreshLlmStatus / getServices 拿到的档位快照（可能为空） */
export function getCachedTiers(): LlmServiceTier[] {
  return _tiers
}

// 管理令牌：我方运维令牌（服务端 HARNESS_ADMIN_TOKEN），写配置时随请求头发送；存本机浏览器。
// 交付档下写端点也接受登录态里的 ADMIN/BOSS，客户管理员不需要这个令牌。
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

export async function getServices(): Promise<LlmServices> {
  const res = await fetch(`${LLM_BASE}/services`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`services ${res.status}`)
  const data = (await res.json()) as Partial<LlmServices>
  const out: LlmServices = {
    available: !!data.available,
    gateway: !!data.gateway,
    reason: data.reason ?? null,
    tiers: Array.isArray(data.tiers) ? data.tiers : [],
    roles: Array.isArray(data.roles) ? data.roles : []
  }
  // 凭据 / 搜索状态是 #2700 起新增的 OPTIONAL 字段：老后端不给时不造空对象，
  // 保留 undefined 让 UI 落「未配置 / 未开通」分支，接口对不上时也不误导。
  const c = data.credential
  if (c) {
    out.credential = {
      configured: !!c.configured,
      source: c.source ?? null,
      url: c.url ?? '',
      key_hint: c.key_hint ?? '',
      updated_at: c.updated_at ?? null
    }
  }
  if (data.search) {
    out.search = {
      granted: !!data.search.granted,
      available: !!data.search.available,
      reason: data.search.reason ?? null
    }
  }
  _tiers = out.tiers
  return out
}

/** 勾选启用档位 / 角色→档位路由。`roles` 里值为空串 = 恢复该角色默认路由。 */
export async function putServices(body: {
  enabled?: string[]
  roles?: Record<string, string>
}): Promise<{ ok: boolean; msg?: string; services?: LlmServices }> {
  try {
    const res = await fetch(`${LLM_BASE}/services`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify(body),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, msg: err.detail || `HTTP ${res.status}` }
    }
    const data = (await res.json()) as LlmServices
    _tiers = Array.isArray(data.tiers) ? data.tiers : []
    _configured = !!data.available
    return { ok: true, services: data }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

/**
 * 保存接入凭据（供应方下发的网关地址 + 密钥）：明文只随这次 PUT 直传服务端，浏览器不落盘、
 * 之后任何 GET / 列表请求都不再携带。成功时服务端回传最新 services，据此刷新整页。
 */
export async function putCredential(body: {
  url?: string
  key: string
}): Promise<{ ok: boolean; msg?: string; services?: LlmServices }> {
  try {
    const res = await fetch(`${LLM_BASE}/services/credential`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify(body),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, msg: err.detail || `HTTP ${res.status}` }
    }
    const data = (await res.json()) as LlmServices
    _tiers = Array.isArray(data.tiers) ? data.tiers : []
    _configured = !!data.available
    return { ok: true, services: data }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

/** 清除「界面填写」的凭据（安装预置的 source==='env' 由服务端拒绝，前端也不给它出口）。 */
export async function deleteCredential(): Promise<{ ok: boolean; msg?: string; services?: LlmServices }> {
  try {
    const res = await fetch(`${LLM_BASE}/services/credential`, {
      method: 'DELETE',
      headers: { ...identityHeaders(), ...adminHeaders() },
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { detail?: string }
      return { ok: false, msg: err.detail || `HTTP ${res.status}` }
    }
    const data = (await res.json()) as LlmServices
    _tiers = Array.isArray(data.tiers) ? data.tiers : []
    _configured = !!data.available
    return { ok: true, services: data }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
  }
}

// 模型服务额度（服务端透出，前端只做展示）。available:false = 服务端暂时给不出额度（如未配凭据），
// reason 里给原因；UI 显示灰字、不弹错误。
export type LlmServicesUsage = {
  today: { day: string; requests: number; total_tokens: number; usage_unknown: number }
  quota: { requests_per_day: number | null; tokens_per_day: number | null }
  remaining: { requests: number | null; tokens: number | null }
  resets_at: string
  rows: Array<{ day: string; tier: string; requests: number; failed: number; total_tokens: number }>
}

export async function getServicesUsage(
  from?: string,
  to?: string
): Promise<{ available: boolean; reason?: string; usage?: LlmServicesUsage }> {
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetch(`${LLM_BASE}/services/usage${suffix}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`services usage ${res.status}`)
  return (await res.json()) as { available: boolean; reason?: string; usage?: LlmServicesUsage }
}

/** 联网搜索连通测试（网关统一提供的搜索，不需要前端带任何供应商 / 密钥参数）。 */
export async function testSearchService(): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${LLM_BASE}/services/search/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders(), ...adminHeaders() },
      body: JSON.stringify({}),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; msg?: string; detail?: string }
    return { ok: !!data.ok, msg: data.detail || data.msg || (res.ok ? '' : `HTTP ${res.status}`) }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误' }
  }
}

/** 对某个档位做一次最小连通测试（经服务端网关，前端不持任何密钥）。 */
export async function testService(tier: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${LLM_BASE}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      // provider 字段是接口契约上的必填位；网关模式下服务端忽略它，只认 model（档位 id）。
      body: JSON.stringify({ provider: 'gateway', model: tier }),
      signal: timeoutSignal(LLM_WRITE_TIMEOUT_MS)
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; msg?: string }
    return { ok: !!data.ok, msg: data.msg ?? (res.ok ? '' : `HTTP ${res.status}`) }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络错误' }
  }
}

// 内部档直连（未配网关）时，「已配置」= 服务端任一供应商已有 key。只问 has_key 这一位，
// 不把供应商清单带进前端；交付档下该端点 404，自然落为 false。
async function anyProviderKeyed(): Promise<boolean> {
  const res = await fetch(`${LLM_BASE}/providers`, {
    headers: identityHeaders(),
    signal: timeoutSignal(LLM_CONFIG_TIMEOUT_MS)
  })
  if (!res.ok) return false
  const data = (await res.json().catch(() => ({}))) as { providers?: { has_key?: boolean }[] }
  return (data.providers ?? []).some((p) => !!p.has_key)
}

export async function refreshLlmStatus(): Promise<boolean> {
  try {
    const svc = await getServices()
    _configured = svc.available || (!svc.gateway && (await anyProviderKeyed()))
  } catch {
    _configured = false
  }
  return _configured
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

// 联网搜索配置（/llm/search；web_search 工具按此取供应商 + key）
// 与 LLM 密钥同源同鉴权（admin token）。明文 key 不回传，GET 只给 provider + has_key。
export type SearchConfig = {
  provider: string
  has_key: boolean
  env_keyed: boolean
  supported: string[]
  model?: string   // 部分搜索引擎需要附带模型 / 接入点名（UI 回显）
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

// agent 出网访问黑名单（/llm/denylist）
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
