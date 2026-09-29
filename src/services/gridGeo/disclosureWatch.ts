// 云南交易日前披露盯盘接口出口（Epic ChenShi-Tech/dljy#3478 · C1 #3484；规格 DW-10～DW-14，设计 D7/D8）。
// - 四个调用都显式带发起时刻的地区（x-region-id）与公司（?company=），不读页面筛选；
//   运行请求体只有 {tradeDate, mode}，关键词、主题、分页、asOf、模型名一律不进请求。
// - 一次点击一个 Idempotency-Key；传输失败重试沿用同一个，新发起换新的（由调用方持有）。
// - 202 = 仍在运行：每 2 秒查一次运行结果，最多 60 秒；超时交回 runId 让界面提示“仍在运行”。
// - 模型提供方鉴权失败由后端映射为结果 errors[]，不会是 HTTP 401；本文件不改全局登出逻辑。
import { ApiError, apiGet, apiPost, type ApiRequestOptions } from '@/services/api'
import { effectiveCompanyRegionId } from '@/services/company/practiceCompany'
import {
  DISCLOSURE_WATCH_ERROR_CODES,
  isBusinessDate,
  validateFeedbackRequest,
  validateRunRequest,
} from 'shared/schema/disclosure-watch-contract.mjs'
import type {
  DisclosureWatchCapabilities,
  DisclosureWatchErrorCode,
  DisclosureWatchFeedbackVerdict,
  DisclosureWatchMode,
  DisclosureWatchRunResult,
} from 'shared/schema/disclosure-watch-contract.mjs'

export const DISCLOSURE_WATCH_BASE = '/v1/grid/geo-assets/disclosures'
export const DISCLOSURE_WATCH_POLL_INTERVAL_MS = 2_000
export const DISCLOSURE_WATCH_POLL_MAX_WAIT_MS = 60_000

/** 发起时刻的上下文快照：切地区/公司后旧请求的结果不得写进新界面。 */
export interface DisclosureWatchScope {
  regionId: string
  companyId: string | null
}

/**
 * 运行头：HTTP 202（进行中）或 failed/interrupted 且无结果时，data 只有这些字段、没有 items。
 * 前端据 items 是否存在区分“有结果”与“只有运行头”。
 * TODO(契约同步)：shared 同步后改用契约导出的 DisclosureWatchRunHead。
 */
export type DisclosureWatchRunHead = Pick<DisclosureWatchRunResult,
  'contractVersion' | 'runId' | 'status' | 'mode' | 'tradeDate' | 'regionId' | 'asOf' | 'createdAt' | 'finishedAt' | 'deadlineAt' | 'scopeLabel' | 'errors'
> & { dataMeta?: Record<string, unknown>; items?: undefined }

/** 本人已提交的评价（GET /watch-runs/:runId 可选返回，重开历史运行时据此显示“已评价”）。 */
export interface DisclosureWatchFeedbackRecord {
  feedbackId: string
  runId: string
  itemId: string
  verdict: DisclosureWatchFeedbackVerdict
  note: string | null
  createdAt: string
}

export type DisclosureWatchRunBody = DisclosureWatchRunResult & { feedback?: DisclosureWatchFeedbackRecord[] }
export type DisclosureWatchRunData = DisclosureWatchRunBody | DisclosureWatchRunHead

export function hasRunBody(data: DisclosureWatchRunData | null | undefined): data is DisclosureWatchRunBody {
  return Boolean(data) && Array.isArray((data as { items?: unknown }).items)
}

/** 前端可见的失败码：契约错误码 + 传输层状态。 */
export type DisclosureWatchFailureCode =
  | DisclosureWatchErrorCode
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-scope'
  | 'network'
  | 'unknown'

export const DISCLOSURE_WATCH_ERROR_TEXT: Readonly<Record<DisclosureWatchFailureCode, string>> = Object.freeze({
  'feature-disabled': '日前盯盘功能未开通',
  'region-unsupported': '当前地区不支持日前盯盘（首版仅云南）',
  'invalid-request': '请求参数不合法',
  'idempotency-key-required': '缺少请求标识，请重新发起',
  'idempotency-conflict': '同一请求标识已用于不同参数，请重新发起研判',
  'run-not-found': '研判记录不存在或不属于当前账号',
  'item-not-found': '该事项不在本次研判结果中',
  'model-not-configured': '模型未配置，停运原因未做研判',
  'provider-auth-failed': '模型服务拒绝服务端凭据（模型配置错误，不影响本站登录）',
  'provider-rate-limited': '模型服务限流',
  'provider-timeout': '模型服务超时',
  'provider-error': '模型服务异常',
  'provider-invalid-response': '模型返回格式不合法，相关事项转待核',
  'model-all-failed': '需要模型判断的事项全部研判失败',
  'budget-exhausted': '运行预算用尽，部分事项未处理',
  'no-core-input': '没有可用的核心资料，未调用模型',
  interrupted: '运行超过执行期限已中断',
  'internal-error': '服务内部错误',
  unauthorized: '登录状态已失效，请重新登录',
  forbidden: '当前账号无权使用日前盯盘',
  'invalid-scope': '当前公司与地区不匹配',
  network: '网络异常，未能连接服务',
  unknown: '请求失败',
})

export class DisclosureWatchRequestError extends Error {
  readonly code: DisclosureWatchFailureCode
  readonly status: number | null

  constructor(code: DisclosureWatchFailureCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'DisclosureWatchRequestError'
    this.code = code
    this.status = status
  }

  /** 传输层失败（网络、5xx、未识别）才适合沿用同一幂等键重试；业务拒绝要重新发起。 */
  get retryable() {
    return this.code === 'network' || this.code === 'internal-error' || this.code === 'unknown'
  }
}

export function isAbortError(error: unknown) {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
}

export function describeDisclosureWatchError(code: string | null | undefined): string {
  return code && Object.hasOwn(DISCLOSURE_WATCH_ERROR_TEXT, code) ? DISCLOSURE_WATCH_ERROR_TEXT[code as DisclosureWatchFailureCode] : DISCLOSURE_WATCH_ERROR_TEXT.unknown
}

function knownCode(value: unknown): DisclosureWatchErrorCode | null {
  return typeof value === 'string' && (DISCLOSURE_WATCH_ERROR_CODES as readonly string[]).includes(value) ? value as DisclosureWatchErrorCode : null
}

/** 从错误信封里找契约错误码：后端约定 {code:<HTTP>, msg, errorCode}；兼容 {error:{code}} / {errors:[{code}]} / {data:{code|errors}}。 */
function payloadCode(payload: unknown): DisclosureWatchErrorCode | null {
  if (!payload || typeof payload !== 'object') return null
  const body = payload as Record<string, unknown>
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const firstCode = (list: unknown) => Array.isArray(list) ? knownCode((list[0] as { code?: unknown } | undefined)?.code) : null
  return knownCode(body.errorCode) ?? knownCode(body.error) ?? knownCode((body.error as { code?: unknown } | undefined)?.code)
    ?? knownCode(body.reason) ?? firstCode(body.errors) ?? knownCode(data.code) ?? knownCode(data.errorCode) ?? firstCode(data.errors)
}

function toRequestError(error: unknown, notFound: DisclosureWatchErrorCode = 'run-not-found'): unknown {
  if (isAbortError(error) || error instanceof DisclosureWatchRequestError) return error
  if (error instanceof ApiError) {
    const status = error.code >= 400 ? error.code : error.status
    const code: DisclosureWatchFailureCode = payloadCode(error.payload)
      ?? (status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? notFound : status === 422 ? 'invalid-request' : status === 428 ? 'idempotency-key-required' : status >= 500 ? 'internal-error' : 'unknown')
    const detail = typeof error.payload?.msg === 'string' && error.payload.msg.trim() ? error.payload.msg.trim() : ''
    const text = describeDisclosureWatchError(code)
    return new DisclosureWatchRequestError(code, detail && detail !== text && code !== 'unknown' ? `${text}：${detail}` : detail || `${text}（HTTP ${status}）`, status)
  }
  if (error instanceof TypeError) return new DisclosureWatchRequestError('network', DISCLOSURE_WATCH_ERROR_TEXT.network)
  return new DisclosureWatchRequestError('unknown', error instanceof Error && error.message ? error.message : DISCLOSURE_WATCH_ERROR_TEXT.unknown)
}

function scopedCompany(scope: DisclosureWatchScope) {
  const companyId = String(scope.companyId ?? '').trim()
  if (!companyId) throw new DisclosureWatchRequestError('invalid-scope', '请先选择当前地区的授权公司')
  const companyRegion = effectiveCompanyRegionId(companyId)
  if (companyRegion !== null && companyRegion !== scope.regionId) {
    throw new DisclosureWatchRequestError('invalid-scope', '当前公司不属于所选地区，请先切换到本地区的授权公司')
  }
  return companyId
}

function scopeHeaders(scope: DisclosureWatchScope, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-region-id': scope.regionId, ...extra }
}

function scopedPath(path: string, scope: DisclosureWatchScope) {
  return `${path}?company=${encodeURIComponent(scopedCompany(scope))}`
}

function unwrapData<T>(response: { data?: T }, label: string): T {
  if (!response.data || typeof response.data !== 'object') throw new DisclosureWatchRequestError('unknown', `${label}响应缺少数据`)
  return response.data
}

type RequestOptions = Pick<ApiRequestOptions, 'signal'>

/** 新发起研判用的幂等键：一次点击一个。 */
export function newDisclosureWatchIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `dw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export async function fetchDisclosureWatchCapabilities(scope: DisclosureWatchScope, tradeDate: string, options: RequestOptions = {}): Promise<DisclosureWatchCapabilities> {
  if (!isBusinessDate(tradeDate)) throw new DisclosureWatchRequestError('invalid-request', '目标日必须是合法日期')
  try {
    const response = await apiGet<DisclosureWatchCapabilities>(`${DISCLOSURE_WATCH_BASE}/watch-capabilities`, { tradeDate, company: scopedCompany(scope) }, { signal: options.signal, headers: scopeHeaders(scope) })
    return unwrapData(response, '功能状态')
  } catch (error) { throw toRequestError(error) }
}

/** POST /watch-runs：请求体只含 {tradeDate, mode}；返回 status='running' 的运行头即 HTTP 202。缺幂等键后端回 428。 */
export async function startDisclosureWatchRun(scope: DisclosureWatchScope, request: { tradeDate: string; mode: DisclosureWatchMode }, idempotencyKey: string, options: RequestOptions = {}): Promise<DisclosureWatchRunData> {
  const checked = validateRunRequest({ tradeDate: request.tradeDate, mode: request.mode })
  if (!checked.ok) throw new DisclosureWatchRequestError('invalid-request', `${DISCLOSURE_WATCH_ERROR_TEXT['invalid-request']}：${checked.errors.join('；')}`)
  if (!idempotencyKey) throw new DisclosureWatchRequestError('idempotency-key-required', DISCLOSURE_WATCH_ERROR_TEXT['idempotency-key-required'])
  try {
    const response = await apiPost<DisclosureWatchRunData>(scopedPath(`${DISCLOSURE_WATCH_BASE}/watch-runs`, scope), checked.value, { signal: options.signal, headers: scopeHeaders(scope, { 'Idempotency-Key': idempotencyKey }) })
    return unwrapData(response, '研判')
  } catch (error) { throw toRequestError(error) }
}

export async function fetchDisclosureWatchRun(scope: DisclosureWatchScope, runId: string, options: RequestOptions = {}): Promise<DisclosureWatchRunData> {
  try {
    const response = await apiGet<DisclosureWatchRunData>(`${DISCLOSURE_WATCH_BASE}/watch-runs/${encodeURIComponent(runId)}`, { company: scopedCompany(scope) }, { signal: options.signal, headers: scopeHeaders(scope) })
    return unwrapData(response, '研判结果')
  } catch (error) { throw toRequestError(error) }
}

export interface DisclosureWatchFeedbackReceipt { feedbackId: string; [key: string]: unknown }

export async function submitDisclosureWatchFeedback(scope: DisclosureWatchScope, runId: string, feedback: { itemId: string; verdict: DisclosureWatchFeedbackVerdict; note?: string | null }, options: RequestOptions = {}): Promise<DisclosureWatchFeedbackReceipt> {
  const checked = validateFeedbackRequest({ itemId: feedback.itemId, verdict: feedback.verdict, ...(feedback.note ? { note: feedback.note } : {}) })
  if (!checked.ok) throw new DisclosureWatchRequestError('invalid-request', `${DISCLOSURE_WATCH_ERROR_TEXT['invalid-request']}：${checked.errors.join('；')}`)
  const body = { itemId: checked.value.itemId, verdict: checked.value.verdict, ...(checked.value.note ? { note: checked.value.note } : {}) }
  try {
    const response = await apiPost<DisclosureWatchFeedbackReceipt>(scopedPath(`${DISCLOSURE_WATCH_BASE}/watch-runs/${encodeURIComponent(runId)}/feedback`, scope), body, { signal: options.signal, headers: scopeHeaders(scope) })
    return unwrapData(response, '评价')
  } catch (error) {
    // 404 在评价接口上可能是运行或事项不存在；有错误码时以错误码为准。
    throw toRequestError(error, 'item-not-found')
  }
}

export type DisclosureWatchOutcome =
  | { settled: true; result: DisclosureWatchRunData }
  | { settled: false; runId: string }

export interface DisclosureWatchPollOptions extends RequestOptions {
  pollIntervalMs?: number
  maxWaitMs?: number
  onRunning?: (head: DisclosureWatchRunData) => void
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 每 pollIntervalMs 查一次运行，直到非 running；超过 maxWaitMs 仍在运行则交回 runId（界面提示“仍在运行”）。 */
export async function awaitDisclosureWatchRun(scope: DisclosureWatchScope, runId: string, options: DisclosureWatchPollOptions = {}): Promise<DisclosureWatchOutcome> {
  const interval = options.pollIntervalMs ?? DISCLOSURE_WATCH_POLL_INTERVAL_MS
  const polls = Math.max(1, Math.floor((options.maxWaitMs ?? DISCLOSURE_WATCH_POLL_MAX_WAIT_MS) / interval))
  for (let attempt = 0; attempt < polls; attempt += 1) {
    await sleep(interval, options.signal)
    const latest = await fetchDisclosureWatchRun(scope, runId, { signal: options.signal })
    if (latest.status !== 'running') return { settled: true, result: latest }
    options.onRunning?.(latest)
  }
  return { settled: false, runId }
}

/** 发起（或按同一幂等键重试）并等待结果：200 直接返回；202 进入轮询。 */
export async function runDisclosureWatch(scope: DisclosureWatchScope, request: { tradeDate: string; mode: DisclosureWatchMode }, idempotencyKey: string, options: DisclosureWatchPollOptions = {}): Promise<DisclosureWatchOutcome> {
  const started = await startDisclosureWatchRun(scope, request, idempotencyKey, { signal: options.signal })
  if (started.status !== 'running') return { settled: true, result: started }
  options.onRunning?.(started)
  return awaitDisclosureWatchRun(scope, started.runId, options)
}
