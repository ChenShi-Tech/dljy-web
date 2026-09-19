// 研究承接洞察语义选区（dljy#3114，OpenSpec insight-research-workbench 任务 13.7，RS08、DE10）
// ----------------------------------------------------------------------------
// 价格/电网/场站页的图表语义选区（insight-selection/v1，useInsightSelection 构建）可以
// 交接给研究工作台预填研究范围。交接纪律（D6「图表点选、时段选区和对象选取只改变已明确的
// 研究范围」+ DE10 只传业务身份）：
//   - 地址参数白名单只有：窗口起止业务日（时段选区**折叠**为起止日）+ 来源引用
//     + 来源页标识；时段数组、原始数据、版本令牌一律不进 URL；
//   - **对象引用不进研究承接**：研究预览请求没有对象范围字段（toQueryContext 恒发
//     objectRefs: []，预览过滤也不消费对象），把对象名带过去就是假承接——横幅声称
//     范围含对象、结果却比所选更宽；
//   - 窗口/来源三个参数的完整校验由研究页 useInsightContext 完成（本模块不重复实现，
//     两边共用契约镜像的同一套口径）；本模块只负责来源页白名单与预设建议；
//   - 预设建议按「预设登记输入的来源与承接来源的交集」计算，交集为空不预填——
//     研究预设是登记白名单，没有来源对应的预设就不假装能承接。

import type { InsightSelection } from 'shared/insight/handoff.mjs'
import { researchPresetSources } from 'shared/insight/research.mjs'

/** 承接来源页白名单 → 返回路径（返回原页并带回窗口/对象/来源，恢复原口径）。 */
export const RESEARCH_HANDOFF_ORIGINS = Object.freeze({
  prices: '/insight/prices',
  'grid-boundaries': '/insight/grid-boundaries',
  plants: '/insight/plants',
} as const)

export type ResearchHandoffOrigin = keyof typeof RESEARCH_HANDOFF_ORIGINS

/** 来源页业务名（界面不出现路由标识）。 */
export const RESEARCH_HANDOFF_ORIGIN_LABELS: Record<ResearchHandoffOrigin, string> = {
  prices: '价格与价差',
  'grid-boundaries': '跨省与电网边界',
  plants: '场站市场表现',
}

/** 选区 → 承接地址参数。返回 null 表示没有可承接的范围（空选区或来源页不在白名单）。 */
export function buildResearchHandoffQuery(
  selection: InsightSelection | null | undefined,
  from: string
): Record<string, string> | null {
  if (!Object.prototype.hasOwnProperty.call(RESEARCH_HANDOFF_ORIGINS, from)) return null
  const intervals = selection?.timeIntervals ?? []
  const sourceIds = selection?.sourceIds ?? []
  // 只有时段（窗口）才构成研究范围：对象引用不进承接（研究预览不消费对象范围）。
  if (!intervals.length) return null
  const query: Record<string, string> = { from }
  // 时段选区折叠为起止业务日（北京时间 ISO 的日期部分；起止分别取最小/最大）。
  const days = intervals
    .flatMap((interval) => intervalEndpointDays(String(interval.start), String(interval.end)))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort()
  if (days.length) {
    query.start = days[0]
    query.end = days[days.length - 1]
  }
  if (sourceIds.length) {
    query.sources = [...new Set(sourceIds)].map(encodeURIComponent).join(',')
  }
  return query
}

/**
 * 一段半开区间 [start, end) 的起止 → 业务日（北京时间 ISO 字符串日期部分，沿用本模块口径）：
 * end 恰为当日零点（00:00[:00[.000]]，剥掉时区后缀后比对）时该端点属于前一天——
 * 把零点端点并进次峰会悄悄放宽研究窗口，单日预设会越过 maxDays 约束。
 */
function intervalEndpointDays(start: string, end: string): [string, string] {
  const startDay = start.slice(0, 10)
  const endText = end.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '')
  const endDay = endText.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDay) && /^00:00(:00(\.\d+)?)?$/.test(endText.slice(11))) {
    const previous = new Date(`${endDay}T00:00:00Z`)
    previous.setUTCDate(previous.getUTCDate() - 1)
    return [startDay, previous.toISOString().slice(0, 10)]
  }
  return [startDay, endDay]
}

/** 解析承接来源页：白名单外（含缺失）返回 null——不认识的来源不假装承接。 */
export function parseResearchHandoffOrigin(query: { from?: unknown }): ResearchHandoffOrigin | null {
  const from = query.from
  return typeof from === 'string' && Object.prototype.hasOwnProperty.call(RESEARCH_HANDOFF_ORIGINS, from)
    ? (from as ResearchHandoffOrigin)
    : null
}

/** 返回原页的位置：带回窗口与对象/来源（useInsightContext 同一套参数名，可恢复口径）。 */
export function handoffReturnLocation(
  origin: ResearchHandoffOrigin,
  businessWindow: { start: string; end: string },
  objectIds: readonly string[],
  sourceIds: readonly string[]
): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = { start: businessWindow.start, end: businessWindow.end }
  if (objectIds.length) query.objects = [...objectIds].map(encodeURIComponent).join(',')
  if (sourceIds.length) query.sources = [...sourceIds].map(encodeURIComponent).join(',')
  return { path: RESEARCH_HANDOFF_ORIGINS[origin], query }
}

/** 预设建议的最小形状（镜像登记项是超集，运行时值含 inputs[].parts 与 features）。 */
type SuggestablePreset = { presetId: string }

/**
 * 按承接来源建议预设：预设登记输入引用的来源与承接来源交集最大者；
 * 并列（含同分）取登记顺序靠前者；无交集返回 null（不预填）。
 */
export function suggestResearchPresetId(presets: readonly SuggestablePreset[], sourceIds: readonly string[]): string | null {
  if (!sourceIds.length) return null
  const wanted = new Set(sourceIds)
  let bestId: string | null = null
  let bestHits = 0
  for (const preset of presets) {
    const hits = researchPresetSources(preset as unknown as Parameters<typeof researchPresetSources>[0]).filter(
      (part) => wanted.has(part.sourceId)
    ).length
    if (hits > bestHits) {
      bestId = preset.presetId
      bestHits = hits
    }
  }
  return bestId
}
