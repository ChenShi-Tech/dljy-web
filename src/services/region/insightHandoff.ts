// 市场洞察统一下钻上下文与返回状态（dljy#3087，OpenSpec build-yunnan-regional-market-insight 任务 15.1，
// 规格 insight-context-handoff CH01「跨页上下文一致」+ A15，design D11.1 交接最小结构的 URL 承载层）
// ----------------------------------------------------------------------------
// 职责：下钻上下文 ↔ URL query 的纯函数编解码 + 返回状态（returnStateOf）。零 Vue 依赖
//（不用 vue-router 类型、不 import 带 Vue 运行时的模块），node 档单测直接跑。
//
// URL 键命名空间设计（本切片的设计决策，改前先同步 docs/market-insight-common-components.md）：
//   1. 业务窗与对象/来源沿用 useInsightContext 的共享四键 start / end / objects / sources——
//      这两层语义本来就该一致（CH01：日期/来源/对象一致），同一信息只写一处，目标页既有的
//      四键还原免费生效；「下钻参数与四键同名时以四键语义为准」由此成立：下钻层不另造
//      hx_start / hx_objects 之类的重复键，解析时遇到这类键一律丢弃并提示。
//   2. 扩展字段带 hx_ 前缀（handoff）：hx_priceObject / hx_marketPhase / hx_view / hx_from，
//      camelCase 与 D11.1 契约字段名一一对应。前缀避免与目标页自有 query 键（如未来的
//      view / phase 键）撞名；解析时未登记的 hx_* 键进 ignored 提示（CH06：不静默忽略
//      影响口径的未知字段），非 hx_ 的其他 query 键（分页、页签等）不归本层管、原样保留。
//   3. 红线（D3/D11.1）：只放可验证 ID 与非敏感筛选——原始数据数组、行数据、凭据一律不进
//      URL。列表值逐项 encodeURIComponent（与 useInsightContext 同规则），数组序列化为逗号
//      分隔的 ID 串，绝不 JSON 化（值中不会出现 "["）。
//
// 超长丢弃策略：序列化后的 query 估长（URLSearchParams 口径，对已编码值偏保守）超过
// MAX_QUERY_LENGTH 时，按「业务影响从小到大」丢弃可选字段：view → marketPhase →
// priceObject → objects → sources；被丢弃字段名进 dropped 清单返回（不静默截断），
// 窗口与 from 是必需字段不参与丢弃。
//
// 解析校验（parseInsightDrilldownQuery，CH01「不支持字段明确提示」）：
//   - 窗口与对象/来源沿用四键同规则（useInsightContext.parseInsightQuery 同语义）：
//     窗口成对且经共享契约 parseInsightContext 校验；objects / sources 整参数校验——
//     逐项都要过契约，任一项非法则整参数丢弃进 ignored（宁缺毋错，不悄悄缩窄选区）。
//   - hx_ 扩展字段逐字段校验、逐字段丢弃：priceObject / marketPhase / view / from 必须
//     是已登记枚举；非法字段进 ignored，其余字段照常还原。
//   - 共享四键语义为准：校验结果与 useInsightContext.parseInsightQuery 完全一致，
//     两层在同一 URL 上不会各说各话。

import {
  InsightContractError,
  MARKET_PHASES,
  PRICE_OBJECTS,
  parseInsightContext,
} from 'shared/insight/contract.mjs'
import { INSIGHT_ANALYSES, type InsightView } from 'shared/insight/analyses.mjs'

/** 下钻发起/返回页 id（与 src/services/region/insightWorkspace.ts 的 InsightPageId 同一规范；
 *  本文件为保持零 Vue 依赖不直接 import 它——insightWorkspace 顶层加载 lucide 图标，
 *  同步关系由 insightHandoff.spec.ts 的静态断言守住）。 */
export const INSIGHT_HANDOFF_PAGE_IDS = ['overview', 'prices', 'supply', 'grid-boundaries', 'plants', 'research'] as const
export type InsightHandoffPageId = (typeof INSIGHT_HANDOFF_PAGE_IDS)[number]

/** 已登记页签/视图枚举：数据驱动自共享分析目录（views 联集），不复制枚举、目录更新自动跟随。 */
export const INSIGHT_HANDOFF_VIEW_IDS: readonly InsightView[] = Object.freeze(
  [...new Set(INSIGHT_ANALYSES.flatMap((entry) => entry.views))].sort()
)

/** 规范页面路径（与 insightWorkspace.INSIGHT_PAGE_PATHS 的 `/insight/<pageId>` 约定一致）。 */
export function insightHandoffPagePath(pageId: InsightHandoffPageId): string {
  return `/insight/${pageId}`
}

/** hx_ 命名空间前缀与 URL 键。 */
const NAMESPACE = 'hx_'
export const DRILLDOWN_QUERY_KEYS = Object.freeze({
  priceObject: `${NAMESPACE}priceObject`,
  marketPhase: `${NAMESPACE}marketPhase`,
  view: `${NAMESPACE}view`,
  from: `${NAMESPACE}from`,
})

/** 共享四键（与 useInsightContext.QUERY_KEYS 一致；导出供测试断言命名空间不冲突）。 */
export const DRILLDOWN_SHARED_KEYS = ['start', 'end', 'objects', 'sources'] as const

/** query 估长上限（字符）：留足浏览器/网关余量（约 2000 上限的 9 折）。 */
export const INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH = 1800

/** 超长时的可选字段丢弃顺序（业务影响从小到大；窗口与 from 必需不丢）。 */
const DROP_ORDER = ['view', 'marketPhase', 'priceObject', 'objects', 'sources'] as const

/** build 入参：发起页构造的下钻请求（start/end 必填；可选字段缺省不进 URL）。 */
export type InsightDrilldownRequest = {
  start: string
  end: string
  objects?: string[]
  sources?: string[]
  priceObject?: string
  marketPhase?: string
  view?: InsightView | string
  from?: InsightHandoffPageId | string
}

/** parse 出参：逐字段校验后的下钻上下文；null = 未提供或非法（已进 ignored）。 */
export type InsightDrilldownPayload = {
  start: string | null
  end: string | null
  objects: string[] | null
  sources: string[] | null
  priceObject: string | null
  marketPhase: string | null
  view: InsightView | null
  from: InsightHandoffPageId | null
}

/** build 出参：query 直接喂 router.push 的 query；dropped 非空即「部分下钻上下文没带上」。 */
export type InsightDrilldownQuery = {
  query: Record<string, string>
  dropped: string[]
}

/** 目标页「返回」用的发起页位置（CH01 返回闭环：返回恢复发起页可验证筛选）。 */
export type InsightReturnState = {
  pageId: InsightHandoffPageId
  path: string
  query: Record<string, string>
}

/** useInsightContext 下钻恢复入口暴露给页面的 hx_ 扩展字段（共享四键已由四键还原覆盖）。 */
export type InsightDrilldownRestore = {
  from: InsightHandoffPageId | null
  view: InsightView | null
  priceObject: string | null
  marketPhase: string | null
}

/** URL query 的最小结构化视图（vue-router LocationQuery 结构兼容，但不依赖其类型）。 */
export type InsightQueryLike = Record<string, unknown>

function readString(query: InsightQueryLike, key: string): string | null {
  const value = query[key]
  return typeof value === 'string' ? value : null
}

/** 单个列表能否整体过共享契约（与 useInsightContext 内部 validIds 同规则：全过才合法）。 */
function validIdList(ids: string[], kind: 'objects' | 'sources'): boolean {
  try {
    parseInsightContext({
      regionId: 'yunnan',
      objectRefs: kind === 'objects' ? ids.map((id) => ({ type: 'object', id })) : [],
      sourceIds: kind === 'sources' ? ids : [],
      businessWindow: { start: '2026-01-01', end: '2026-01-01' },
    })
    return true
  } catch {
    return false
  }
}

/** 校验请求的业务范围与枚举字段：非法直接抛中文契约错误（坏请求不写进 URL，保留原因）。 */
function assertValidRequest(payload: InsightDrilldownRequest): void {
  // 窗口成对校验 + 对象/来源逐项契约校验 + priceObject/marketPhase 枚举：一个调用全覆盖，
  // InsightContractError 的中文消息（如「结束日期不能早于开始日期」「对象标识不正确」）原样上抛。
  parseInsightContext({
    regionId: 'yunnan',
    objectRefs: (payload.objects ?? []).map((id) => ({ type: 'object', id })),
    sourceIds: payload.sources ?? [],
    businessWindow: { start: payload.start, end: payload.end },
    marketPhase: payload.marketPhase ?? null,
    priceObject: payload.priceObject ?? null,
  })
  if (payload.view !== undefined && !(INSIGHT_HANDOFF_VIEW_IDS as readonly string[]).includes(payload.view)) {
    throw new InsightContractError(
      { status: 400, code: 'BAD_REQUEST' },
      `下钻目标视图未登记：${String(payload.view)}（已知视图：${INSIGHT_HANDOFF_VIEW_IDS.join('、')}）`
    )
  }
  if (payload.from !== undefined && !(INSIGHT_HANDOFF_PAGE_IDS as readonly string[]).includes(payload.from)) {
    throw new InsightContractError(
      { status: 400, code: 'BAD_REQUEST' },
      `下钻发起页未登记：${String(payload.from)}（已知页面：${INSIGHT_HANDOFF_PAGE_IDS.join('、')}）`
    )
  }
}

/** 列表 → 逗号分隔 ID 串（逐项编码，防对象名含分隔符）；空列表不进 URL。 */
function encodeList(ids: string[]): string {
  return ids.map(encodeURIComponent).join(',')
}

/** 序列化后的 query 估长（URLSearchParams 口径；对已编码值轻微高估，作上限判断偏安全）。 */
function queryLength(query: Record<string, string>): number {
  return new URLSearchParams(query).toString().length
}

/** 可选字段是否出现在 query（丢弃循环只记录真的被丢掉的字段）。 */
function dropKeyOf(field: (typeof DROP_ORDER)[number]): string | null {
  if (field === 'view') return DRILLDOWN_QUERY_KEYS.view
  if (field === 'marketPhase') return DRILLDOWN_QUERY_KEYS.marketPhase
  if (field === 'priceObject') return DRILLDOWN_QUERY_KEYS.priceObject
  return field // objects / sources 用共享键
}

/**
 * 下钻上下文 → URL query。共享四键直写（业务窗 + 对象/来源），扩展字段带 hx_ 前缀。
 * 序列化后超过 MAX_QUERY_LENGTH 时按 DROP_ORDER 丢弃可选字段并返回 dropped 清单；
 * 仍超长（窗口/from 本身超限，正常载荷不可能）抛 InsightContractError，不静默截断。
 */
export function buildInsightDrilldownQuery(payload: InsightDrilldownRequest): InsightDrilldownQuery {
  assertValidRequest(payload)

  const query: Record<string, string> = {
    start: payload.start,
    end: payload.end,
  }
  const objects = payload.objects ?? []
  const sources = payload.sources ?? []
  if (objects.length) query.objects = encodeList(objects)
  if (sources.length) query.sources = encodeList(sources)
  if (payload.priceObject) query[DRILLDOWN_QUERY_KEYS.priceObject] = payload.priceObject
  if (payload.marketPhase) query[DRILLDOWN_QUERY_KEYS.marketPhase] = payload.marketPhase
  if (payload.view) query[DRILLDOWN_QUERY_KEYS.view] = payload.view
  if (payload.from) query[DRILLDOWN_QUERY_KEYS.from] = payload.from

  const dropped: string[] = []
  for (const field of DROP_ORDER) {
    if (queryLength(query) <= INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH) break
    const key = dropKeyOf(field)
    if (key === null || query[key] === undefined) continue
    delete query[key]
    dropped.push(field)
  }
  if (queryLength(query) > INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH) {
    throw new InsightContractError(
      { status: 400, code: 'BAD_REQUEST' },
      `下钻地址超过长度上限（${INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH} 字符）且必需字段无法再缩减，请缩小对象/来源选择`
    )
  }
  return { query, dropped }
}

/** URL 是否带下钻参数（任意 hx_ 键）；useInsightContext 据此启用「下钻恢复」入口。 */
export function hasInsightDrilldownParams(query: InsightQueryLike): boolean {
  return Object.keys(query).some((key) => key.startsWith(NAMESPACE))
}

/**
 * URL query → 下钻上下文 + ignored 清单（CH01/A15：非法与不支持字段明确提示，不静默改默认）。
 * 窗口与对象/来源沿用四键同规则；hx_ 扩展字段逐字段校验逐字段丢弃；未登记的 hx_* 键
 * （含 hx_start 等命名空间重复键）进 ignored——四键语义为准。
 */
export function parseInsightDrilldownQuery(query: InsightQueryLike): { payload: InsightDrilldownPayload; ignored: string[] } {
  const ignored: string[] = []

  // 命名空间边界：hx_ 键里只认已登记的四个扩展键；其余（含 hx_start/hx_objects 等与四键
  // 重名的重复键、未来未登记键）一律提示丢弃。非 hx_ 键不属于本层，不标记。
  const knownNamespaced = new Set<string>(Object.values(DRILLDOWN_QUERY_KEYS))
  for (const key of Object.keys(query)) {
    if (key.startsWith(NAMESPACE) && !knownNamespaced.has(key)) ignored.push(key)
  }

  // 窗口：与四键同规则（成对 + 共享契约校验；非字符串视为未提供）。
  const start = readString(query, 'start')
  const end = readString(query, 'end')
  let window: { start: string; end: string } | null = null
  if (start !== null || end !== null) {
    let ok = false
    if (start !== null && end !== null) {
      try {
        parseInsightContext({ regionId: 'yunnan', businessWindow: { start, end } })
        ok = true
      } catch {
        ok = false
      }
    }
    if (ok && start !== null && end !== null) window = { start, end }
    else ignored.push(start !== null && end !== null ? 'start、end' : start !== null ? 'start' : 'end')
  }

  // 对象/来源：与四键同规则（逐项过契约，任一项非法整参数丢弃进 ignored）。
  const decodeList = (value: unknown): string[] | null => {
    if (typeof value !== 'string' || !value) return null
    try {
      return value.split(',').map(decodeURIComponent)
    } catch {
      // 手改 URL 留下的非法百分号编码：按参数非法处理。
      return null
    }
  }

  let objects: string[] | null = null
  const rawObjects = decodeList(query.objects)
  if (query.objects !== undefined) {
    if (rawObjects && rawObjects.length && validIdList(rawObjects, 'objects')) objects = rawObjects
    else ignored.push('objects')
  }

  let sources: string[] | null = null
  const rawSources = decodeList(query.sources)
  if (query.sources !== undefined) {
    if (rawSources && rawSources.length && validIdList(rawSources, 'sources')) sources = rawSources
    else ignored.push('sources')
  }

  // hx_ 扩展字段：逐字段校验、逐字段丢弃（不支持的字段明确提示，其余照常还原）。
  const enumField = (key: string, allowed: readonly string[]): string | null => {
    const raw = query[key]
    if (raw === undefined) return null
    if (typeof raw === 'string' && allowed.includes(raw)) return raw
    ignored.push(key)
    return null
  }
  const priceObject = enumField(DRILLDOWN_QUERY_KEYS.priceObject, PRICE_OBJECTS)
  const marketPhase = enumField(DRILLDOWN_QUERY_KEYS.marketPhase, MARKET_PHASES)
  const view = enumField(DRILLDOWN_QUERY_KEYS.view, INSIGHT_HANDOFF_VIEW_IDS) as InsightView | null
  const from = enumField(DRILLDOWN_QUERY_KEYS.from, INSIGHT_HANDOFF_PAGE_IDS) as InsightHandoffPageId | null

  return {
    payload: {
      start: window?.start ?? null,
      end: window?.end ?? null,
      objects,
      sources,
      priceObject,
      marketPhase,
      view,
      from,
    },
    ignored,
  }
}

/**
 * 返回状态（D11.1 returnContext 的 URL 层）：from 页 + 其可恢复上下文。
 * 共享四键（窗口/对象/来源）原样带回——它们在下钻前后是同一份上下文；view / priceObject /
 * marketPhase 是目标页视角的口径，不带回发起页。from 缺失或未登记 → null（没有可验证的
 * 返回位置，目标页不显示返回入口，不猜）。
 */
export function returnStateOf(payload: InsightDrilldownPayload): InsightReturnState | null {
  const from = payload.from
  if (!from || !(INSIGHT_HANDOFF_PAGE_IDS as readonly string[]).includes(from)) return null
  const query: Record<string, string> = {}
  if (payload.start && payload.end) {
    query.start = payload.start
    query.end = payload.end
  }
  if (payload.objects?.length) query.objects = encodeList(payload.objects)
  if (payload.sources?.length) query.sources = encodeList(payload.sources)
  return { pageId: from, path: insightHandoffPagePath(from), query }
}
