// 市场洞察研究预览客户端（dljy#3080，OpenSpec insight-research-workbench 任务 13.5/13.6）
// ----------------------------------------------------------------------------
// 前端消费 POST /api/v1/market-insight/research/preview 的唯一通道（研究工作台页专用）。
// 纪律与 insightClient 完全一致（复用同一套错误折叠，不另造第二套约定）：
//   - 请求体只含 presetId / context / filters / transformations；预设白名单住在契约镜像
//     shared/insight/research.mjs，未知指标、自由表达式没有对应的请求形状可发。
//   - 错误统一折叠成 InsightRequestError{status, errorCode, message, details}：页面展示后端
//     原因原文（四类事前拒绝、超限、资格不足都按原文展示，不转述不改写）；
//     网络/超时一律 503 UNAVAILABLE。AbortError 原样上抛，由代次机制静默丢弃。
//   - 成功结果做形状自检（schemaVersion / mock:false / productionWrite:false / 必备字段），
//     形状不合规按 422 处理、不渲染。
//   - 零缓存、不写 localStorage：研究结果含公司获权资料的派生统计，落盘即越权面扩大。
//
// 响应形状对照 dljy 仓 insight-research.mjs 的 runResearchPreview（insight-research/v1）。

import { apiPost } from '@/services/api'
import { INSIGHT_ENDPOINTS } from 'shared/insight/analyses.mjs'
import {
  INSIGHT_ERRORS,
  InsightContractError,
  type InsightContextInput,
} from 'shared/insight/contract.mjs'
import { isAbortError, toInsightError } from './insightClient'

// ── 请求类型（形状来自 shared/insight/research.mjs 的 parseResearchPreviewRequest）────────

/** 一次研究预览请求；mode/asOf 住在 context 里（parseInsightContext 强制事前必须带 asOf）。 */
export type ResearchPreviewRequest = {
  presetId: string
  context: InsightContextInput
  /** 相关分析的唯一筛选：分组维度（none/month），其余分析不带 filters。 */
  filters?: { groupBy?: string }
  /** 有限变换：滞后槽位 / 异常窗口与阈值 / 同类日目标日与候选数（按预设类型，见镜像白名单）。 */
  transformations?: Record<string, unknown>
}

// ── 结果类型（insight-research/v1；只声明页面实际消费的形状）────────────────────────────

/** 单个输入的样本规模与覆盖（覆盖率分母为对齐粒度的期望槽位）。 */
export type ResearchInputSummary = {
  id: string
  label: string
  sourceIds: string[]
  resolutionMinutes: number | null
  validSlots: number
  expectedSlots: number | null
  coverageRatio: string | null
}

/** 阈值（异常窗口）：显式绝对值或该序列自身分位数。 */
export type ResearchThreshold = { kind: 'absolute' | 'quantile'; value?: string; p?: string; resolvedValue?: string }

/** 结果主表的一行（长表：维度列 + 指标 + 十进制值）。 */
export type ResearchRow = Record<string, string | null>

/** 结果主表的序列元数据（每类内核一张，含方法与解释字段）。 */
export type ResearchSeriesMeta = Record<string, unknown> & { seriesId: string; kind: string }

export type ResearchPreviewResult = {
  schemaVersion: string
  queryId: string
  presetId: string
  presetVersion: string
  methodVersion: string
  regionId: string
  businessWindow: { start: string; end: string; timeZone: string; days: number }
  mode: 'ex-post' | 'ex-ante'
  asOf: string | null
  mock: false
  productionWrite: false
  generatedAt: string
  sourceRefs: Array<{ sourceId: string; accessScope: string; versionToken: string; channel?: string }>
  readSetRef: string
  resultVersion: string
  inputs: ResearchInputSummary[]
  sample: {
    conditions: { minSamples: number; minCoverageRatio?: string }
    primarySamples: number
    eligibilityMet: boolean
    observed: number
  }
  method: { kind: string; kernel: string; notes: string[] }
  /** 事前模式随结果返回的已知时间口径说明（事后对照没有该字段）。 */
  exAnte?: {
    basis: string
    perSource: Record<string, { basis: string; usableRows: number; excludedAfterAsOf: number; missingKnownAt: number }>
    note: string
  }
  data: {
    schemaVersion: string
    view: string
    dimensions: Array<{ id: string; kind: string }>
    measures: Array<{ id: string; unit: string }>
    rows: ResearchRow[]
    series: ResearchSeriesMeta[]
    sampling?: { method: string; population: number }
  }
  /** 可保存的研究定义草稿（保存能力另行切片，页面当前不提供保存入口）。 */
  definitionDraft: Record<string, unknown> & { presetId: string; note: string }
}

// ── 客户端 ───────────────────────────────────────────────────────────────────────────────

/** 统一包一层：AbortError 原样抛，其余折叠为 InsightRequestError（与 insightClient 同约定）。 */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (isAbortError(error)) throw error
    throw toInsightError(error)
  }
}

/** 结果形状自检：不合规按 422 处理——宁可区块报错，不渲染口径不明的数据。 */
function assertResearchPreviewResult(value: unknown): ResearchPreviewResult {
  const result = value as ResearchPreviewResult | null
  if (
    !result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.schemaVersion !== 'string' || !result.schemaVersion.startsWith('insight-research/')
    || typeof result.presetId !== 'string' || typeof result.methodVersion !== 'string'
    || !result.businessWindow || typeof result.businessWindow.start !== 'string'
    || (result.mode !== 'ex-post' && result.mode !== 'ex-ante')
    || !Array.isArray(result.inputs) || !Array.isArray(result.method?.notes)
    || !result.sample || typeof result.sample.primarySamples !== 'number' || typeof result.sample.eligibilityMet !== 'boolean'
    || !result.data || !Array.isArray(result.data.rows) || !Array.isArray(result.data.series)
    || result.mock !== false || result.productionWrite !== false
  ) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '研究预览结果格式不正确')
  }
  return result
}

/** POST research/preview：运行一次登记过的预设（只读预览，不保存任何定义或结果）。 */
export function runResearchPreview(
  request: ResearchPreviewRequest,
  options?: { signal?: AbortSignal }
): Promise<ResearchPreviewResult> {
  return call(async () => {
    const payload = await apiPost<ResearchPreviewResult>(INSIGHT_ENDPOINTS.researchPreview.path, request, {
      signal: options?.signal,
    })
    return assertResearchPreviewResult(payload.data)
  })
}
