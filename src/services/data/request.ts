// ============================================================================
// data/request.ts — 统一取数基座 agentRequest()（Phase 0）
// ----------------------------------------------------------------------------
// 收敛通道 C（spotClient / quantClient / mlForecastClient / studioClient）将各自手写的
// header 注入 / 超时 / GET 重试 / applyRegionHeaders 到单一基座，复用 api.ts 的：
//   - requestHeaders()：统一身份 + 地区（x-region-id）+ token + governance 头
//   - timeoutSignal()：可中断的超时 AbortSignal
//   - applyRegionHeaders()：回读 x-region-served/x-region-fallback → regionDataStatus
//
// Phase 0 先提供能力（返回原始 Response），不强制现有 client 改用。#657 起契约层
// adapter 正式采纳本基座作为新增模块契约的统一取数入口；既有页面 client 不做批量迁移。
// Phase 2 在此把 Node ApiEnvelope / Python BaseResponse 的可信度元信息归一，供契约层
// 组合 UnifiedResult 或模块标准 view model。
// ============================================================================

import { applyRegionHeaders, requestHeaders, timeoutSignal } from '../api'
import { selectedRegionId } from '../region/regionContext'
import { unifyBasis } from './basis'
import type { DataSourceBasis, Provenance, SourceType } from './types'

export type AgentRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type AgentRequestOptions = {
  method?: AgentRequestMethod
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  signal?: AbortSignal
  timeoutMs?: number
  headers?: HeadersInit
  /** 是否回读地区命中头写入 regionDataStatus（默认 true，与 api.ts unwrap 行为一致） */
  applyRegionMeta?: boolean
}

// GET 幂等请求对网关瞬时故障（502/503/504）与网络抖动做有限次指数退避重试，与
// api.ts::fetchGetWithRetry 同语义；写请求不重试。
const GET_RETRY_ATTEMPTS = 2
const GET_RETRY_BASE_DELAY = 400

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(input: string, init: RequestInit, method: AgentRequestMethod): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init)
      if (method === 'GET' && attempt < GET_RETRY_ATTEMPTS && response.status >= 502 && response.status <= 504) {
        await delay(GET_RETRY_BASE_DELAY * 2 ** attempt)
        continue
      }
      return response
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (method !== 'GET' || attempt >= GET_RETRY_ATTEMPTS) throw error
      await delay(GET_RETRY_BASE_DELAY * 2 ** attempt)
    }
  }
}

function buildUrl(base: string, path: string, query?: AgentRequestOptions['query']): string {
  const url = new URL(`${base}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  const nativeAny = (AbortSignal as typeof AbortSignal & { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof nativeAny === 'function') return nativeAny(active)
  const controller = new AbortController()
  const onAbort = (event: Event) => {
    if (controller.signal.aborted) return
    try {
      controller.abort((event.target as AbortSignal).reason)
    } catch {
      controller.abort()
    }
  }
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
}

/**
 * 统一取数基座。新增模块契约 adapter 用此替换手写 fetch，获得统一身份+地区头、超时、
 * GET 幂等重试、applyRegionHeaders（RegionDataBanner 一致）。返回原始 Response，调用方
 * 自行解信封（Phase 2 起提供归一为 UnifiedResult / 模块契约 meta 的辅助）。
 *
 * @param base 端点基址（如 '/agent-api/v1/spot'，DEV/PROD 切换由调用方决定）
 * @param path 路径（如 '/node-price/series'）
 * @param options method/body/query/signal/timeoutMs/headers/applyRegionMeta
 */
export async function agentRequest(
  base: string,
  path: string,
  options: AgentRequestOptions = {}
): Promise<Response> {
  const method: AgentRequestMethod = options.method ?? 'GET'
  // 捕获发起时地区：响应头只在「本请求所属地区仍是当前地区」时才有资格更新全局
  // regionDataStatus（RegionDataBanner）——否则切地区后旧地区慢响应会污染新地区的
  // Mock/回退横幅，页面级 generation 守卫管不到这层全局状态（roborev job419）。
  const requestRegion = selectedRegionId.value
  const headers = new Headers(requestHeaders())
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
  }
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const signal = mergeSignals(options.signal, options.timeoutMs ? timeoutSignal(options.timeoutMs) : undefined)
  const init: RequestInit = {
    method,
    headers,
    ...(signal ? { signal } : {}),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  }
  const response = await fetchWithRetry(buildUrl(base, path, options.query), init, method)
  if (options.applyRegionMeta !== false && requestRegion === selectedRegionId.value) {
    applyRegionHeaders(response)
  }
  return response
}

/**
 * 可信度元信息（UnifiedResult 去掉 data）：供 client 解出 data 后组合成 UnifiedResult。
 * Phase 2 定义，Phase 3 通道 C 迁移到基座后统一消费。
 */
export type EnvelopeMeta = {
  basis?: DataSourceBasis
  mock?: boolean
  sourceType?: SourceType
  productionWrite?: boolean
  provenance?: Provenance
}

/**
 * 从后端响应体提取可信度元信息（不解 data——data 解包由各 client 按信封形态处理：
 * Node ApiEnvelope 取 .data/.rows，Python BaseResponse 取 .data，裸对象即自身）。
 * 统一收敛 Node provenance.sourceType / Python mock+sourceType / forecast basis 四套标注。
 */
export function extractEnvelopeMeta(body: unknown): EnvelopeMeta {
  const b = (body ?? {}) as Record<string, unknown>
  const provenance =
    b.provenance && typeof b.provenance === 'object' ? (b.provenance as Provenance) : undefined
  return {
    basis: unifyBasis(b),
    mock: typeof b.mock === 'boolean' ? b.mock : undefined,
    sourceType: typeof b.sourceType === 'string' ? (b.sourceType as SourceType) : undefined,
    productionWrite: typeof b.productionWrite === 'boolean' ? b.productionWrite : undefined,
    provenance
  }
}
