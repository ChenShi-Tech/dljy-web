// 市场洞察 HTTP 客户端（dljy#2996，OpenSpec build-yunnan-regional-market-insight D4）
// ----------------------------------------------------------------------------
// 前端消费 /api/v1/market-insight/* 三个接口的唯一通道：能力目录、区块查询、覆盖与候选。
// 纪律：
//   - 成功结果一律过共享契约校验（query 用 assertInsightResult；capabilities/coverage 做
//     形状自检），形状不合规按 422 处理、不渲染——「能画出来」不等于「口径可信」。
//   - 错误统一折叠成 InsightRequestError{status, errorCode, message, details}：页面按
//     status 映射业务文案，绝不把 403/409/503 吞成空图（D4：无资料是带原因的成功，
//     失败是失败）。网络/超时一律 503 UNAVAILABLE。
//   - AbortError 原样向上抛：由 useInsightRequestGeneration 的代次机制静默丢弃，
//     客户端不猜测取消原因。
//   - 零缓存、不写 localStorage：洞察结果含公司私有资料，落盘即越权面扩大。
//
// 接口路径与请求形状来自 shared/insight/analyses.mjs 的 INSIGHT_ENDPOINTS（契约镜像，
// 由 dljy 主仓 sync:web 单向同步，本仓只读）。请求头（鉴权、x-region-id、幂等键）
// 由 @/services/api 的 apiGet/apiPost 统一附带，这里不重复造。

import { apiGet, apiPost, ApiError } from '@/services/api'
import {
  INSIGHT_ENDPOINTS,
} from 'shared/insight/analyses.mjs'
import {
  assertInsightResult,
  INSIGHT_ERRORS,
  InsightContractError,
  type InsightContextInput,
  type InsightResult,
} from 'shared/insight/contract.mjs'
import type { AnalysisCandidates, DateRange } from 'shared/insight/coverage.mjs'
import type { ResultData } from 'shared/insight/handoff.mjs'

// ── 类型（后端真实形状见 dljy 仓 docs/api/market-insight-contract.md）──────────────────

/** 一次区块查询请求（POST /query 的 body）；context 由 useInsightContext 组装。 */
export type InsightQueryRequest = {
  analysisId: string
  context: InsightContextInput
  filters?: Record<string, unknown>
  page?: { size?: number; cursor?: string | null }
  expected?: { resultVersion: string; readSetRef: string } | null
}

/** 一次覆盖与候选请求（POST /coverage 的 body）。 */
export type InsightCoverageRequest = {
  analysisId: string
  context: InsightContextInput
  filters?: Record<string, unknown>
  requiredSourceIds?: string[]
}

/** 能力目录里的来源描述（describeSource 的出参；前端只消费标题与访问范围等语义字段）。 */
export type InsightCapabilitySource = {
  sourceId: string
  title: string
  businessScope: string
  accessScope: 'public' | 'company'
  measureKind: string
  fields: Array<{ id: string; unit: string; kind: string }>
  nativeResolutionMinutes: number
  priceObject: string | null
  marketPhase: string | null
  variant: string | null
  freshness: string
  objectDimension: string | null
  note: string | null
}

/** 能力目录里的分析条目（analyses.mjs 登记项的投影）。 */
export type InsightCapabilityAnalysis = {
  analysisId: string
  version: string
  title: string
  pageIds: string[]
  access: 'public' | 'company'
  sourceIds: string[]
  limits: { maxDays: number; maxObjects: number; requiresObjects: boolean }
}

export type InsightCapabilities = {
  regionId: string
  registered: boolean
  analyses: InsightCapabilityAnalysis[]
  sources: InsightCapabilitySource[]
  endpoints: Record<string, { method: string; path: string }>
  mock: false
  productionWrite: false
}

/** 覆盖接口的单来源完整度（按必需/可选区分，逐日完整与连续区段）。 */
export type InsightCoverageSource = {
  sourceId: string
  required: boolean
  status: 'ok' | 'source-disabled'
  seriesCount: number
  expectedSlotsPerDay?: number
  completeDates: string[]
  partialDates: string[]
  ranges: DateRange[]
}

export type InsightCoverageResult = {
  schemaVersion: string
  analysisId: string
  regionId: string
  businessWindow: { start: string; end: string }
  sources: InsightCoverageSource[]
  candidates: AnalysisCandidates
  note: string
  mock: false
  productionWrite: false
}

/** insight-result-data/v1 的序列目录：每条序列的业务身份（来源、字段、维度、粒度）。 */
export type InsightSeriesMeta = {
  seriesId: string
  sourceId: string
  fieldId: string
  unit: string
  measureKind: string
  dimensions: Record<string, string | null>
  businessScope: string
  resolutionMinutes: number
  nativeResolutionMinutes: number
  priceObject: string | null
  marketPhase: string | null
  variant: string | null
}

/**
 * query 结果的 data 部分：长表行 + 序列目录（rows 值为十进制字符串，interval 为北京时间 ISO）。
 * 共享契约里 series 是按视图各异的宽松类型（统计视图还有集合、价差对等条目）；明细视图
 * 用这里的严格目录类型替换它，不做交叉（数组交叉会让 map/find 退回宽松元素类型）。
 */
export type InsightResultData = Omit<ResultData, 'series'> & {
  series: InsightSeriesMeta[]
}

/** query 结果顶层的分页说明：不带 page 请求返回全量；带 page 只切明细行（版本仍按全量计算）。 */
export type InsightPageInfo =
  | { scope: 'all'; totalRows: number }
  | { scope: 'page'; size: number; offset: number; returnedRows: number; totalRows: number; nextCursor: string | null }

/** 校验后的区块结果（data 部分已窄化为洞察长表）。 */
export type InsightBlockResult = InsightResult<InsightResultData> & { page: InsightPageInfo }

// ── 错误类型 ─────────────────────────────────────────────────────────────────────────────

/** 洞察请求失败：页面据此按 status 映射业务文案（见 InsightBlock），不渲染任何数据。 */
export class InsightRequestError extends Error {
  readonly status: number
  readonly errorCode: string
  readonly details: unknown

  constructor(args: { status: number; errorCode: string; message: string; details?: unknown }) {
    super(args.message)
    this.name = 'InsightRequestError'
    this.status = args.status
    this.errorCode = args.errorCode
    this.details = args.details
  }
}

/** AbortError 透传判定：取消不是失败，由请求代次层消化。 */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
}

function toInsightError(error: unknown): InsightRequestError {
  if (error instanceof InsightRequestError) return error
  if (error instanceof InsightContractError) {
    // 契约校验失败（含 assertInsightResult）：按契约给出的 status/code 上抛，缺省 422。
    return new InsightRequestError({
      status: error.status,
      errorCode: error.code,
      message: error.message,
      details: error.details,
    })
  }
  if (error instanceof ApiError) {
    // 统一信封错误：data = { errorCode, details }，msg 为面向用户的原因。
    const data = (error.payload as { data?: { errorCode?: string; details?: unknown } } | undefined)?.data
    return new InsightRequestError({
      status: error.status,
      errorCode: typeof data?.errorCode === 'string' ? data.errorCode : 'UNAVAILABLE',
      message: error.message,
      details: data?.details,
    })
  }
  // 网络/超时/未知异常：一律 503，不吞成空结果。
  return new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' })
}

/** 统一包一层：AbortError 原样抛，其余折叠为 InsightRequestError。 */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isAbortError(error)) throw error
    throw toInsightError(error)
  }
}

// ── 三个接口 ─────────────────────────────────────────────────────────────────────────────

/** GET /capabilities：当前地区、当前公司可用的分析与来源目录。 */
export function fetchInsightCapabilities(options?: { signal?: AbortSignal }): Promise<InsightCapabilities> {
  return call(async () => {
    const payload = await apiGet<InsightCapabilities>(INSIGHT_ENDPOINTS.capabilities.path, undefined, { signal: options?.signal })
    const data = payload.data
    if (!data || typeof data !== 'object' || !Array.isArray(data.analyses) || !Array.isArray(data.sources)) {
      throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '能力目录格式不正确')
    }
    return data
  })
}

/** POST /query：一次区块查询；成功结果经 assertInsightResult 校验后返回。 */
export function queryInsight(request: InsightQueryRequest, options?: { signal?: AbortSignal }): Promise<InsightBlockResult> {
  return call(async () => {
    const payload = await apiPost<InsightBlockResult>(INSIGHT_ENDPOINTS.query.path, request, { signal: options?.signal })
    // 形状不合规按 422 处理：宁可块报错，不渲染口径不明的数据。
    // assertInsightResult 的返回类型未声明后端随结果下发的 page 字段，此处窄化补齐。
    return assertInsightResult(payload.data) as InsightBlockResult
  })
}

/** POST /coverage：各来源逐日完整度与可分析历史候选。 */
export function fetchInsightCoverage(request: InsightCoverageRequest, options?: { signal?: AbortSignal }): Promise<InsightCoverageResult> {
  return call(async () => {
    const payload = await apiPost<InsightCoverageResult>(INSIGHT_ENDPOINTS.coverage.path, request, { signal: options?.signal })
    const data = payload.data
    const candidates = data?.candidates
    if (
      !data || typeof data !== 'object' || !Array.isArray(data.sources)
      || !candidates || typeof candidates !== 'object' || !Array.isArray(candidates.ranges)
      || typeof candidates.discrete !== 'boolean'
    ) {
      throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '覆盖与候选格式不正确')
    }
    return data
  })
}
