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

import { apiGet, apiPost } from '@/services/api'
import { INSIGHT_ENDPOINTS } from 'shared/insight/analyses.mjs'
import {
  INSIGHT_ERRORS,
  InsightContractError,
  type InsightContextInput,
} from 'shared/insight/contract.mjs'
import { InsightRequestError, isAbortError, toInsightError } from './insightClient'

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

// ── 研究定义保存/列表/取回/按新源重算（dljy#3094，OpenSpec 任务 14.4；RS06、D9 保存方式段）──
// 与 #3020 复盘材料同一套冻结协议，不另起第二套：浏览器只提交「定义与源引用 + 期望版本」，
// 服务端按同一研究内核重算核对一致才冻结；源已变化返回 409（提示先重新运行，不自动接受新值）。
// 定义与运行版本只存服务端（迁移 059），前端零持久化；请求夹带任何未登记字段直接 400。

/** 一次研究定义保存请求（形状 = shared/insight/research.mjs 的 parseResearchDefinitionSaveBody）。 */
export type ResearchDefinitionSaveRequest = {
  presetId: string
  /** 与预览同形状的上下文；调用方应剥掉 contextVersion（导航概念），保证同口径重复保存幂等键稳定。 */
  context: InsightContextInput
  filters?: { groupBy?: string }
  transformations?: Record<string, unknown>
  /** 用户看到的版本（resultVersion/readSetRef）：服务端重算核对一致才保存，不一致 409。 */
  expected: { resultVersion: string; readSetRef: string }
  /** 可选标题；缺省由服务端取预设标题。 */
  title?: string
  /** 幂等键必填：同键同内容重试返回原条目（replay），不重复创建。 */
  idempotencyKey: string
}

/** 运行版本元数据（版本清单行）。 */
export type ResearchRunMeta = {
  runNo: number
  resultVersion: string
  readSetRef?: string
  createdBy?: string | null
  createdAt: string
}

/** 运行版本的完整冻结产物（服务端冻结，前端只读展示，不重算）。 */
export type ResearchRunContent = ResearchRunMeta & {
  content: {
    schemaVersion: string
    topic: string
    title: string
    frozenAt: string
    definition: Record<string, unknown>
    note: string
    /** 冻结的运行结果（insight-research/v1，与预览同一形状）：来源引用与样本说明原文都在这里。 */
    result: ResearchPreviewResult
  }
  contentHash?: string
}

/** 取回响应：定义摘要 + 版本清单 + 最新（或指定）运行版本完整产物。 */
export type ResearchDefinitionDetail = {
  definitionId: string
  regionId: string
  presetId: string
  presetVersion?: string
  title: string
  businessWindow?: { start: string; end: string }
  mode?: string
  methodVersion?: string
  runCount: number
  runs: ResearchRunMeta[]
  latestRun: ResearchRunContent | null
  /** 幂等命中：同键同内容重试读回原条目，未重复创建。 */
  replay?: boolean
  note?: string
  mock: false
  productionWrite: false
}

/** 列表行（公司隔离由后端会话决定，前端不做二次过滤）。 */
export type ResearchDefinitionRow = {
  definitionId: string
  regionId: string
  presetId: string
  title: string
  businessWindow: { start: string; end: string }
  mode: string
  runCount: number
  latestRun: { runNo: number; resultVersion: string; createdAt: string } | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type ResearchDefinitionListResult = {
  rows: ResearchDefinitionRow[]
  hasMore: boolean
  offset: number
  mock: false
  productionWrite: false
}

/** 按新源重算响应：changed=false 表示源未变化读回既有版本，不重复建版本。 */
export type ResearchDefinitionRunResult = {
  definitionId: string
  regionId: string
  title: string
  changed: boolean
  run: ResearchRunContent | null
  runs: ResearchRunMeta[]
  note?: string
  mock: false
  productionWrite: false
}

/** 形状自检：定义/运行响应必须声明 mock:false 与 productionWrite:false，结构不合规按 422 处理。 */
function assertResearchDefinitionDetail(value: unknown): ResearchDefinitionDetail {
  const detail = value as ResearchDefinitionDetail | null
  if (
    !detail || typeof detail !== 'object' || Array.isArray(detail)
    || typeof detail.definitionId !== 'string' || typeof detail.presetId !== 'string'
    || typeof detail.title !== 'string' || !Array.isArray(detail.runs)
    || (detail.latestRun !== null && (!detail.latestRun || typeof detail.latestRun !== 'object' || !detail.latestRun.content))
    || detail.mock !== false || detail.productionWrite !== false
  ) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '研究定义响应格式不正确')
  }
  return detail
}

function assertResearchDefinitionList(value: unknown): ResearchDefinitionListResult {
  const page = value as ResearchDefinitionListResult | null
  if (
    !page || typeof page !== 'object' || Array.isArray(page)
    || !Array.isArray(page.rows) || typeof page.hasMore !== 'boolean' || typeof page.offset !== 'number'
    || page.mock !== false || page.productionWrite !== false
  ) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '研究定义列表格式不正确')
  }
  return page
}

function assertResearchDefinitionRunResult(value: unknown): ResearchDefinitionRunResult {
  const result = value as ResearchDefinitionRunResult | null
  if (
    !result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.definitionId !== 'string' || typeof result.changed !== 'boolean'
    || !Array.isArray(result.runs)
    || (result.run !== null && (!result.run || !result.run.content))
    || result.mock !== false || result.productionWrite !== false
  ) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '研究重算响应格式不正确')
  }
  return result
}

/** 端点路径里的 {id} 占位（契约镜像为唯一来源，这里只做替换）。 */
function definitionPath(path: string, definitionId: string): string {
  return path.replace('{id}', encodeURIComponent(definitionId))
}

/** POST research/definitions：保存/更新研究定义（服务端重算核验一致才冻结）。 */
export function saveResearchDefinition(
  request: ResearchDefinitionSaveRequest,
  options?: { signal?: AbortSignal }
): Promise<ResearchDefinitionDetail> {
  return call(async () => {
    const payload = await apiPost<ResearchDefinitionDetail>(INSIGHT_ENDPOINTS.researchDefinitionSave.path, request, {
      signal: options?.signal,
    })
    return assertResearchDefinitionDetail(payload.data)
  })
}

/** GET research/definitions：本公司、当前地区已保存列表（分页默认 50、最多 200）。 */
export function listResearchDefinitions(
  options?: { offset?: number; limit?: number; signal?: AbortSignal }
): Promise<ResearchDefinitionListResult> {
  return call(async () => {
    const payload = await apiGet<ResearchDefinitionListResult>(INSIGHT_ENDPOINTS.researchDefinitionList.path, {
      ...(options?.offset !== undefined ? { offset: options.offset } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    }, { signal: options?.signal })
    return assertResearchDefinitionList(payload.data)
  })
}

/** GET research/definitions/{id}：取回定义 + 版本清单 + 运行产物；runNo 指定历史版本（查看原结果）。 */
export function getResearchDefinition(
  definitionId: string,
  options?: { runNo?: number | null; signal?: AbortSignal }
): Promise<ResearchDefinitionDetail> {
  return call(async () => {
    const payload = await apiGet<ResearchDefinitionDetail>(definitionPath(INSIGHT_ENDPOINTS.researchDefinitionGet.path, definitionId), {
      ...(options?.runNo !== undefined && options.runNo !== null ? { runNo: options.runNo } : {}),
    }, { signal: options?.signal })
    return assertResearchDefinitionDetail(payload.data)
  })
}

/** POST research/definitions/{id}/run：按新源重算，追加新版本不可变产物；源未变化读回既有版本。 */
export function runResearchDefinition(
  definitionId: string,
  options?: { signal?: AbortSignal }
): Promise<ResearchDefinitionRunResult> {
  return call(async () => {
    const payload = await apiPost<ResearchDefinitionRunResult>(definitionPath(INSIGHT_ENDPOINTS.researchDefinitionRun.path, definitionId), {}, {
      signal: options?.signal,
    })
    return assertResearchDefinitionRunResult(payload.data)
  })
}

/**
 * 保存失败文案折叠：409 是「你看到的版本已经不在了」，固定提示先重新运行，不展示成系统故障；
 * 403 透传后端原因原文（无写权限的处置说明）；其余给服务端原文或兜底文案。
 */
export function researchSaveError(error: unknown, fallback: string): string {
  if (error instanceof InsightRequestError) {
    if (error.status === 409) return '资料已更新，请先重新运行再保存'
    return error.message || fallback
  }
  return fallback
}
