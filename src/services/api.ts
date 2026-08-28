import { ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// agent-backend（Python/FastAPI）前端基址根。默认相对前缀 /agent-api：开发态由 vite 代理转发到
// :8000，生产/现场部署由现场 nginx 同源反代到中心 agent 服务。前后端分离部署下，Node 的 /api
// 与 Python 的 /api/v1 前缀大面积重叠（forecast/market/weather 双方都有），必须靠 /agent-api
// 独立前缀分流，详见 docs/deploy/split-deployment.md。所有 agent-backend 客户端统一派生自此常量，
// 禁止再写 `import.meta.env.DEV ? '/agent-api...' : '/api...'` 的生产折叠（verify:api-base 拦截）。
// 仅当前端纯静态直连后端绝对地址（绕过 nginx）时才用 VITE_AGENT_API_BASE 覆盖（需后端开 CORS）。
export const AGENT_API_BASE_ROOT = (import.meta.env.VITE_AGENT_API_BASE || '/agent-api').replace(/\/+$/, '')
const TOKEN_KEY = 'dljy_restore_token'
const USER_KEY = 'dljy_governance_user'

// 地区数据命中状态：记录最近一次数据请求「请求地区 / 实际服务地区 / 是否回退基线」。
// 由 applyRegionHeaders 从响应头 x-region-served / x-region-fallback 写入，
// 供 RegionDataBanner 决定是否显示「基线数据」提示。单例 ref，Node 后端单线程、
// 前端按页加载，以最近一次回放为准。放 api 层（而非 captured.ts）避免与
// captured↔api 的循环依赖；captured.ts 与 quantClient.ts 共享同一份。
export type RegionDataStatus = {
  requested: string | null
  served: string | null
  fallback: boolean
  // 接口级 Mock 命中：本次取数走了 mockReplay 合成（响应头 x-data-mock），供 RegionDataBanner
  // 对任一地区（含真实数据地区缺某 family 时）诚实显「模拟数据」，不因地区整体标真实而漏标（#348 P1）。
  mock: boolean
  // Sub-2(#518)：最近一次回放族的数据可见性分级（响应头 x-data-visibility）
  // company=公司私有族（如中广核云南场站结算/损益），public=全网披露。
  visibility: 'public' | 'company' | null
  // 私有族访问被拒：401=未登录 / 403=账号无该公司授权。由 fetchCaptured 捕获拒绝响应后写入
  // （错误响应不走 applyRegionHeaders 成功路径），供无权限空态横幅（Sub-4）消费。
  accessDenied: 401 | 403 | null
}
export const regionDataStatus = ref<RegionDataStatus>({
  requested: null, served: null, fallback: false, mock: false, visibility: null, accessDenied: null
})

// #1350：请求序号守卫。发请求前取号，unwrap 只应用「序号不小于已应用序号」响应的地区头
// 快速切换数据族/地区时较早发起的请求若最后返回，其过期地区头会覆盖 RegionDataBanner 状态，
// 使横幅描述的来源与当前展示数据不一致。与 PR shell#68 的请求序号守卫同模式，此处扩到
// 共享 fetch 层（apiGet/apiPost/fetchCaptured 等全部取号路径）。
// 仅「带地区头的响应」参与序号比较：无头请求（/auth、/dashboard 等）不应用
// 也不推进已应用序号，不会作废更早的带地区头取数响应。
let regionHeaderSeq = 0
let lastAppliedRegionSeq = 0
export function nextRegionHeaderSeq(): number {
  regionHeaderSeq += 1
  return regionHeaderSeq
}

// 响应是否携带地区命中头（x-region-served/x-region-fallback/x-data-mock/x-data-visibility）。
function hasRegionHeaders(res: Response): boolean {
  return ['x-region-served', 'x-region-fallback', 'x-data-mock', 'x-data-visibility']
    .some((name) => res.headers.get(name) !== null)
}

// 从响应头读取地区命中信息并更新 regionDataStatus。只有明确带地区命中头的
// 响应才更新；普通 /auth、/dashboard 等接口没有这些头，不能清空页面上一次
// 真实数据回放/量化请求留下的基线回退提示。
export function applyRegionHeaders(res: Response) {
  const served = res.headers.get('x-region-served')
  const fallback = res.headers.get('x-region-fallback')
  const mock = res.headers.get('x-data-mock')
  const visibility = res.headers.get('x-data-visibility')
  if (served === null && fallback === null && mock === null && visibility === null) return
  regionDataStatus.value = {
    requested: currentRegion.value.id,
    served,
    fallback: fallback === 'true',
    mock: mock === 'true',
    visibility: visibility === 'company' || visibility === 'public' ? visibility : null,
    // accessDenied 有独立生命周期（按被拒 family 记账，见下），成功响应不得直接清空
    // 混合面板（私有族 403 + 公共族成功）里后续成功请求会把无权限横幅冲掉。
    accessDenied: regionDataStatus.value.accessDenied
  }
}

// 无权限状态按被拒 family 记账（Sub-4 #520 Medium 修复）
// 「最近一次请求」全局语义对混合面板/多 tab 工作台都不成立（公共请求冲掉私有拒绝、切 tab
// 粘滞）。改为响应式记录「当前被拒的私有 family 集合」，由 RegionDataBanner 按自己关心的
// family 过滤显示（opt-in，见组件），无权限横幅严格等价于「你正在看的这块数据被拒」，
// 不依赖任何清账时机。被拒入账、同 family 成功出账、切区/换路由统一清账。
export const deniedCaptureFamilies = ref<string[]>([])

// 私有族访问被拒（401/403）时由 fetchCaptured 调用（错误响应不经 applyRegionHeaders 成功路径）。
export function markCaptureAccessDenied(status: 401 | 403, visibility: 'public' | 'company' | null, family: string) {
  if (!deniedCaptureFamilies.value.includes(family)) {
    deniedCaptureFamilies.value = [...deniedCaptureFamilies.value, family]
  }
  regionDataStatus.value = {
    ...regionDataStatus.value,
    requested: currentRegion.value.id,
    visibility: visibility ?? 'company',
    accessDenied: status
  }
}

// 同 family 后续取数成功（如管理员授权后页面重试）→ 出账；账清空才熄横幅。
export function clearCaptureAccessDenied(family: string) {
  if (!deniedCaptureFamilies.value.includes(family)) return
  deniedCaptureFamilies.value = deniedCaptureFamilies.value.filter((f) => f !== family)
  if (deniedCaptureFamilies.value.length === 0) {
    regionDataStatus.value = { ...regionDataStatus.value, accessDenied: null }
  }
}

// 路由切换清账：新页面的取数会重新记账，避免上一页的拒绝状态跨页粘滞（router.afterEach 调用）。
export function resetCaptureAccessDenied() {
  if (deniedCaptureFamilies.value.length === 0 && regionDataStatus.value.accessDenied === null) return
  deniedCaptureFamilies.value = []
  regionDataStatus.value = { ...regionDataStatus.value, accessDenied: null }
}

// 切换地区时立即重置回退状态：applyRegionHeaders 只在带地区头的响应上更新，
// 故切到新地区后、其首个地区数据响应到达前，需主动清掉上一个地区残留的基线回退
// 提示，避免横幅「粘滞」在旧状态（消除条件写入带来的唯一副作用）。
// 放在 api 层订阅 currentRegion，regionContext 不反向依赖 api，无循环依赖。
watch(
  () => currentRegion.value.id,
  (id) => {
    deniedCaptureFamilies.value = []
    regionDataStatus.value = { requested: id, served: null, fallback: false, mock: false, visibility: null, accessDenied: null }
  }
)

// 数据溯源标注：让前端可区分演示/真实数据并据此提示，支撑 mock→真实数据的可追溯替换。
export type Provenance = {
  sourceType: 'MOCK' | 'DEMO' | 'CAPTURE' | 'DB'
  realDataConnected: boolean
  family?: string
  capturedAt?: string
}

export type ApiEnvelope<T> = {
  code: number
  data?: T
  rows?: T
  provenance?: Provenance
  total?: number
  token?: string
  user?: T extends { user: infer U } ? U : unknown
  roles?: string[]
  permissions?: string[]
  resetPwdFlag?: boolean
  session?: T extends { session?: infer S } ? S : unknown
  access?: T extends { access?: infer A } ? A : unknown
  msg?: string
  traceId?: string
  lockedUntil?: string
  remainingAttempts?: number
}

export class ApiError extends Error {
  status: number
  code: number
  payload: ApiEnvelope<unknown>

  constructor(message: string, options: { status: number; code: number; payload: ApiEnvelope<unknown> }) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.payload = options.payload
  }

  get lockedUntil() {
    return this.payload.lockedUntil
  }

  get remainingAttempts() {
    return this.payload.remainingAttempts
  }
}

export type ApiRequestOptions = {
  signal?: AbortSignal
  timeout?: number
  timeoutMs?: number
  headers?: HeadersInit
}

export function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

/**
 * 内容派生幂等键（FNV-1a 32 位）：同一逻辑操作（同内容）跨重试/双击同键，服务端可去重；
 * 内容不同则键不同，不误伤新操作。随机键做不到这点——超时重试会换键，双写防不住。
 * canonical 为参与业务语义的字段（JSON 序列化后哈希），prefix 区分端点族。
 */
export function idempotencyKeyOf(prefix: string, canonical: unknown): string {
  const s = JSON.stringify(canonical) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}-${(h >>> 0).toString(16).padStart(8, '0')}`
}

// GET 是幂等请求，对网络抖动（fetch 抛错）和网关瞬时故障（502/503/504）
// 做有限次指数退避重试，避免偶发抖动直接把错误抛到页面。写请求不重试。
const GET_RETRY_ATTEMPTS = 2
const GET_RETRY_BASE_DELAY = 400

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchGetWithRetry(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init)
      if (attempt < GET_RETRY_ATTEMPTS && response.status >= 502 && response.status <= 504) {
        await delay(GET_RETRY_BASE_DELAY * 2 ** attempt)
        continue
      }
      return response
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (attempt >= GET_RETRY_ATTEMPTS) throw error
      await delay(GET_RETRY_BASE_DELAY * 2 ** attempt)
    }
  }
}

export async function apiGet<T>(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
  options?: ApiRequestOptions
): Promise<T & ApiEnvelope<T>> {
  const seq = nextRegionHeaderSeq() // #1350：过期响应守卫（见 nextRegionHeaderSeq 注释）
  const response = await fetchGetWithRetry(buildUrl(path, query), {
    headers: withRequestHeaders(options?.headers),
    signal: requestSignal(options)
  })
  return unwrap<T>(response, path, seq)
}

// 返回原始 Response，供需要读响应头的调用方使用（如 captured.ts 读地区命中头
// x-region-served / x-region-fallback）。复用统一鉴权头与 URL 构造。
export async function fetchRaw(path: string, query?: Record<string, string | number | boolean | null | undefined>, init?: RequestInit): Promise<Response> {
  return fetchGetWithRetry(buildUrl(path, query), {
    ...init,
    headers: withRequestHeaders(init?.headers)
  })
}

export async function apiPost<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T & ApiEnvelope<T>> {
  const seq = nextRegionHeaderSeq() // #1350：过期响应守卫（见 nextRegionHeaderSeq 注释）
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: jsonRequestHeaders(options?.headers),
    body: JSON.stringify(body),
    signal: requestSignal(options)
  })
  return unwrap<T>(response, path, seq)
}

export async function apiPut<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T & ApiEnvelope<T>> {
  const seq = nextRegionHeaderSeq() // #1350：过期响应守卫（见 nextRegionHeaderSeq 注释）
  const response = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: jsonRequestHeaders(options?.headers),
    body: JSON.stringify(body),
    signal: requestSignal(options)
  })
  return unwrap<T>(response, path, seq)
}

export async function apiPatch<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T & ApiEnvelope<T>> {
  const seq = nextRegionHeaderSeq() // #1350：过期响应守卫（见 nextRegionHeaderSeq 注释）
  const response = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: jsonRequestHeaders(options?.headers),
    body: JSON.stringify(body),
    signal: requestSignal(options)
  })
  return unwrap<T>(response, path, seq)
}

export async function apiDelete<T>(path: string, options?: ApiRequestOptions): Promise<T & ApiEnvelope<T>> {
  const seq = nextRegionHeaderSeq() // #1350：过期响应守卫（见 nextRegionHeaderSeq 注释）
  const response = await fetch(buildUrl(path), {
    method: 'DELETE',
    headers: idempotentRequestHeaders(options?.headers),
    signal: requestSignal(options)
  })
  return unwrap<T>(response, path, seq)
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const url = new URL(pathBase(path), window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function pathBase(path: string) {
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(path)) return path
  // #2169 P2-2a：数据管理路径族统一改道 data-service（/data-svc 代理 → :8190）。
  // 调用方零改动（裸 /v1/... 与 /api/v1/... 两种形态都识别）。
  const dataSvc = dataServicePath(path)
  if (dataSvc) return dataSvc
  if (isExplicitApiPath(path)) return path
  return `${API_BASE}${path}`
}

function isExplicitApiPath(path: string) {
  return path === '/api' || path.startsWith('/api/')
    || path === '/agent-api' || path.startsWith('/agent-api/')
    || path === '/dify-api' || path.startsWith('/dify-api/')
    || path === '/dify-sso' || path.startsWith('/dify-sso/')
    || path === '/dify-studio' || path.startsWith('/dify-studio/')
}

// #2169 P2-2a：数据管理路径族 → data-service（:8190）
// 判定逻辑与路径族清单抽在 dataServiceRoutes.ts（纯函数，独立单测覆盖）。
import { dataServicePath } from './dataServiceRoutes'
export { DATA_SVC_ROOT, dataServicePath } from './dataServiceRoutes'
// 立场切换意图（#2193）：服务端校验 ∈ 允许集合，缺头=home；未选择/未登录不发。
import { currentStanceHeader } from './stance/stanceContext'

// 统一身份 + 地区请求头构造（Phase 0 起导出）：data/request.ts 的 agentRequest() 基座
// 复用此函数，收敛通道 C（agentClient/quantClient/spotClient/mlForecastClient）各自手写的
// 身份头为单一来源，消除两套实现漂移。语义不变，仅由内部函数改为导出。
export function requestHeaders() {
  const headers: Record<string, string> = {
    'x-request-id': createRequestId(),
    // 统一地区下传：所有走 apiGet/apiPost/.../fetchRaw 的请求自动带当前地区，
    // 后端据此做 region 过滤/回放（/api/real、declarations 等）。
    'x-region-id': currentRegion.value.id
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  // 立场意图（#2193）：与地区同款「意图头 + 服务端权威校验」。值为空时不发，
  // 服务端按 home 立场处理（与历史行为一致）。
  const stanceHeader = currentStanceHeader()
  if (stanceHeader) {
    headers['x-stance-id'] = stanceHeader
  }
  const user = readStoredGovernanceUser()
  if (user) {
    headers['x-user-id'] = String(user.username ?? user.userId ?? 'LOCAL-DEMO-USER')
    headers['x-decision-role'] = String(user.roleCode ?? 'TRADE_LEAD')
    headers['x-area-code'] = String(user.areaCode ?? 'YN')
    headers['x-subject-id'] = String(user.subjectId ?? 'GEN-YN-001')
    headers['x-subject-type'] = String(user.subjectType ?? 'GENERATOR')
    // 租户键统一：companyId === tenantId。后端 /api/company/* 以会话解析的 companyId 为准，
    // 此头仅供 admin/group 显式切换视图（后端再经下属公司白名单校验）。
    const companyId = String(user.companyId ?? user.tenantId ?? 'dljy-demo')
    headers['x-company-id'] = companyId
    headers['x-tenant-id'] = companyId
  }
  return headers
}

function withRequestHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers)
  for (const [key, value] of Object.entries(requestHeaders())) {
    if (!merged.has(key)) merged.set(key, value)
  }
  return merged
}

function idempotentRequestHeaders(headers?: HeadersInit) {
  const merged = withRequestHeaders(headers)
  if (!merged.has('idempotency-key')) merged.set('idempotency-key', createRequestId())
  return merged
}

function jsonRequestHeaders(headers?: HeadersInit) {
  const merged = idempotentRequestHeaders(headers)
  if (!merged.has('content-type')) merged.set('content-type', 'application/json')
  return merged
}

function requestSignal(options?: ApiRequestOptions): AbortSignal | undefined {
  const timeoutMs = options?.timeoutMs ?? options?.timeout
  const timeout = typeof timeoutMs === 'number' ? timeoutSignal(timeoutMs) : undefined
  return mergeAbortSignals(options?.signal, timeout)
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  const nativeAny = (AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }).any
  if (typeof nativeAny === 'function') return nativeAny(active)

  const controller = new AbortController()
  const cleanup = () => {
    for (const signal of active) signal.removeEventListener('abort', onAbort)
  }
  const abort = (signal: AbortSignal) => {
    if (controller.signal.aborted) return
    try {
      controller.abort(signal.reason)
    } catch {
      controller.abort()
    }
    cleanup()
  }
  const onAbort = (event: Event) => abort(event.target as AbortSignal)

  for (const signal of active) {
    if (signal.aborted) {
      abort(signal)
      return controller.signal
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  return controller.signal
}

function createRequestId() {
  const random = Math.random().toString(36).slice(2, 10)
  return `REQ-${Date.now().toString(36)}-${random}`
}

function readStoredGovernanceUser(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function unwrap<T>(response: Response, path: string, seq?: number): Promise<T & ApiEnvelope<T>> {
  if (response.status === 204) {
    return { code: 204 } as T & ApiEnvelope<T>
  }
  const payload = await parseResponsePayload<T>(response)
  if (!response.ok || payload.code >= 400) {
    const code = Number(payload.code || response.status || 500)
    handleApiStatus(code, path, payload)
    throw new ApiError(payload.msg ?? `API request failed: ${response.status}`, {
      status: response.status,
      code,
      payload: payload as ApiEnvelope<unknown>
    })
  }
  // 成功响应统一记录地区命中（失败响应头不可靠，跳过）。使不走 fetchCaptured 的
  // 页面（走 apiGet/apiPost 的 declarations 等）的 RegionDataBanner 也能正确显示。
  // #1350：seq 守卫，仅「序号不小于已应用序号」的带地区头响应应用；较早发起、较晚返回
  // 的过期响应（快速切换数据族/地区时常见）不得覆盖横幅状态。无地区头请求不推进已应用
  // 序号（不会作废更早的有效取数响应）。seq 缺省（历史调用）则保持原行为。
  if (seq === undefined || (hasRegionHeaders(response) && seq >= lastAppliedRegionSeq)) {
    applyRegionHeaders(response)
    if (seq !== undefined) lastAppliedRegionSeq = seq
  }
  return payload as T & ApiEnvelope<T>
}

async function parseResponsePayload<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return await response.json() as ApiEnvelope<T>
  } catch {
    return {
      code: response.status || 500,
      msg: response.statusText || '接口响应无法解析'
    }
  }
}

function handleApiStatus<T>(code: number, path: string, payload: ApiEnvelope<T>) {
  if (code === 401 && !isLoginRequest(path) && !isBusinessProxy(path)) {
    clearLocalAuthState()
    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { path, message: payload.msg } }))
    if (window.location.pathname !== '/login') {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`)
    }
  }

  if (code === 403) {
    window.dispatchEvent(new CustomEvent('auth-forbidden', { detail: { path, message: payload.msg } }))
  }

  if (code === 423) {
    window.dispatchEvent(new CustomEvent('auth-locked', { detail: { path, lockedUntil: payload.lockedUntil } }))
  }
}

function isLoginRequest(path: string) {
  return path === '/auth/login' || path === '/auth/login-options'
}

// 业务代理端点:它们的 401 来自上游(和风/南网)或本地登录态门控,不是 dljy 自身会话过期,
// 且前端对其有专门降级(和风→Open-Meteo、CSG→占位 Mock)。这类 401 不该触发全局登出,
// 否则上游配额/密钥问题会把用户莫名踢出登录(假钥联调已踩坑)。登录引导由路由守卫和
// /auth/* 等核心接口负责,不依赖这些代理。
// (LLM 代理 /agent-api/agent/llm/chat 走原生 fetch、不经此封装,其 401 本就不触发这里,无需登记。)
function isBusinessProxy(path: string) {
  return path === '/qweather' || path === '/csg/disclosure'
}

function clearLocalAuthState() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
