/**
 * agent/* 子客户端的 HTTP 基座（#538 阶段 1）。
 *
 * 历史问题：src/services/agent/ 下 15 个子客户端（jobsClient/scheduleClient/notifyClient/
 * mcpClient/agentConfig/agentSkills/subAgents 等）各自直 fetch + 复制 adminHeaders()（9 处）
 * + 各自 TIMEOUT_MS 常量（15 处，10000~45000 散落）+ 各自 errDetail/put/get 样板。
 *
 * 抽出本 factory 后，子客户端只需：
 *   const http = createAgentClient('/llm', { timeoutMs: 10_000 })
 *   await http.get<ParamsConfig>('/params')
 *   await http.tryPut('/params', body)  // → { ok, msg? }
 *
 * 收口内容：
 *   - adminHeaders()（管理令牌，调 llm.ts getAdminToken）
 *   - identityHeaders()（登录身份 + 公司 + 地区，复用 agentClient.ts）
 *   - timeoutSignal()（调 api.ts）
 *   - errDetail()（FastAPI HTTPException {detail} 解析）
 *   - get/post/put/patch/delete（统一信封 + 错误处理）
 *
 * 设计：与 api.ts 的 apiGet/apiPost 同模式（错误抛带 detail 的 Error），但 base 是
 * AGENT_API_BASE（/agent-api/agent），并多带 adminHeaders + identityHeaders。
 *
 * 阶段 1：抽 factory + 迁移 2-3 个最简客户端（agentConfig/usageClient）作为示范；
 * 其余 13 个子客户端留阶段 2 渐进迁移。
 */
import { AGENT_API_BASE_ROOT, timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'
import { identityHeaders, AGENT_API_BASE } from '@/services/agent/agentClient'

/** 默认请求超时（ms）。子客户端可覆盖（原 15 处散落 8000~45000，取保守上界）。 */
export const DEFAULT_AGENT_TIMEOUT_MS = 10_000

/** FastAPI HTTPException 错误体 {detail} 提取。 */
export async function errDetail(res: Response): Promise<string> {
  try {
    return (await res.json())?.detail ?? ''
  } catch {
    return ''
  }
}

/** 软写入结果：网络错误/非 2xx 不抛，返回 { ok, msg }。供配置保存类端点用（不希望整页崩）。 */
export type SaveResult = { ok: boolean; msg?: string }

/** agent/* 客户端工厂：返回绑定 base path + timeout 的 HTTP 方法集。 */
export interface AgentHttpClient {
  /** GET 读请求（带 identityHeaders，不带 adminToken）—— 业务读端点。非 2xx 抛 Error（含 detail）。 */
  get<T>(path: string, init?: RequestInit): Promise<T>
  /** GET 管理读请求（带 identityHeaders + adminToken）—— 调度/配置等需管理员鉴权的读端点。 */
  getAdmin<T>(path: string, init?: RequestInit): Promise<T>
  /** POST 写请求（带 adminHeaders + identityHeaders + content-type）。非 2xx 抛 Error。 */
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  /** FormData POST（带 adminHeaders + identityHeaders，不手设 content-type）。非 2xx 抛 Error。 */
  postForm<T>(path: string, body: FormData, init?: RequestInit): Promise<T>
  /** PUT 写请求（带 adminHeaders + identityHeaders + content-type）。非 2xx 抛 Error。 */
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  /** PATCH 写请求（带 adminHeaders + identityHeaders + content-type）。非 2xx 抛 Error。 */
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  /** DELETE 写请求（带 adminHeaders + identityHeaders）。非 2xx 抛 Error。 */
  delete<T>(path: string, init?: RequestInit): Promise<T>
  /** 软 PUT：网络错误/非 2xx 不抛，返回 { ok, msg }。供配置保存类端点用。 */
  tryPut(path: string, body?: unknown): Promise<SaveResult>
  /** 软 POST：同 tryPut 但方法为 POST。 */
  tryPost(path: string, body?: unknown): Promise<SaveResult>
}

/**
 * 创建绑定 base path 的 agent HTTP 客户端。
 *
 * @param basePath 相对 AGENT_API_BASE 的路径前缀，如 '/llm'、'/schedules'
 * @param opts.timeoutMs 超时（默认 10s）
 * @param opts.rootBase true 时从 AGENT_API_BASE_ROOT（/agent-api）派生，供非 /agent 路由使用。
 */
export function createAgentClient(basePath: string, opts: { timeoutMs?: number; rootBase?: boolean; rawBase?: boolean } = {}): AgentHttpClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS
  // rawBase（#2174 P2-2c-3）：basePath 即完整基址（如 /data-svc/api/v1/... 代理形态），
  // 不再拼 AGENT_API_BASE——管理面端点改道 data-service 时零侵入复用本 factory。
  const base = basePath.startsWith('http') || opts.rawBase
    ? basePath
    : `${opts.rootBase ? AGENT_API_BASE_ROOT : AGENT_API_BASE}${basePath}`

  function adminHeaders(): Record<string, string> {
    const t = getAdminToken()
    return t ? { 'x-admin-token': t } : {}
  }
  function readHeaders(): Record<string, string> {
    return identityHeaders()
  }
  let writeSeq = 0
  function idempotencyKey(): string {
    writeSeq += 1
    return globalThis.crypto?.randomUUID?.() ?? `agent-hc-${Date.now()}-${writeSeq}`
  }
  function writeHeaders(): Record<string, string> {
    // Idempotency-Key（#2174 P2-2c-3）：经 /data-svc（data-service 网关）的写请求受平台
    // 幂等门（缺键 428）；走 /agent-api 的旧路径多带此头无副作用。
    return { 'content-type': 'application/json', 'idempotency-key': idempotencyKey(), ...identityHeaders(), ...adminHeaders() }
  }
  function formHeaders(): Record<string, string> {
    return { 'idempotency-key': idempotencyKey(), ...identityHeaders(), ...adminHeaders() }
  }

  // 硬请求：非 2xx 抛 Error（带 detail）；网络错误 rethrow
  async function hard<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    headers: Record<string, string>,
    init?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(timeoutMs),
      ...init,
    })
    if (!res.ok) throw new Error((await errDetail(res)) || `HTTP ${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  // 软请求：非 2xx/网络错误不抛，返回 { ok, msg }
  async function soft(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown | undefined
  ): Promise<SaveResult> {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: writeHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: timeoutSignal(timeoutMs),
      })
      if (!res.ok) return { ok: false, msg: (await errDetail(res)) || `HTTP ${res.status}` }
      return { ok: true }
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : '网络错误（后端未运行？）' }
    }
  }

  return {
    get: (path, init) => hard('GET', path, undefined, readHeaders(), init),
    getAdmin: (path, init) => hard('GET', path, undefined, writeHeaders(), init),
    post: (path, body, init) => hard('POST', path, body, writeHeaders(), init),
    postForm: (path, body, init) => hard('POST', path, undefined, formHeaders(), { ...init, body }),
    put: (path, body, init) => hard('PUT', path, body, writeHeaders(), init),
    patch: (path, body, init) => hard('PATCH', path, body, writeHeaders(), init),
    delete: (path, init) => hard('DELETE', path, undefined, writeHeaders(), init),
    tryPut: (path, body) => soft('PUT', path, body),
    tryPost: (path, body) => soft('POST', path, body),
  }
}
