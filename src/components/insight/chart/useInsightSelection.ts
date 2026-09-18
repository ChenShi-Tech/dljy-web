// 市场洞察图表语义选区（dljy#2996，OpenSpec 任务 5.8，design DE09—DE10）
// ----------------------------------------------------------------------------
// 图表点击 / 框选 → insight-selection/v1 语义选区。原则（DE10）：
//   - 选区里只放业务身份（对象引用、时段、来源、市场阶段、价格对象、上下文代次、
//     结果版本引用），绝不出现 dataIndex / seriesIndex / 像素 / 下标——数组下标会随
//     数据更新漂移，图形坐标离了这张图就无处解读；
//   - 时段必须带时区（北京时间，+08:00）；相邻时段合并成连续区段，上限 2000 段；
//   - 事件回调先经 isSelectionCurrent 比对当前上下文（地区 / 公司 / 代次 / 结果版本），
//     不一致直接丢弃——迟到事件、A→B→A 切换回来的旧事件都这样作废；
//   - 防回环：与上一次相同（规范化后）的选区不重复上抛，图表↔表格联动来回触发时
//     第二跳被吞掉。
// 构建出的选区经 parseSelection 全量校验（未登记字段、下标键、缺时段时区都在这里拦）。

import { SELECTION_SCHEMA, isSelectionCurrent, parseSelection } from 'shared/insight/handoff.mjs'
import type { InsightSelection, TimeInterval } from 'shared/insight/handoff.mjs'
import type { ObjectRef } from 'shared/insight/contract.mjs'
import { getInsightSource } from 'shared/insight/sources.mjs'
import type { InsightBlockResult, InsightSeriesMeta } from '@/services/insight/insightClient'

/** 事件发生时刻页面认定的「当前」：选区与它不一致即作废。 */
export type InsightSelectionCurrent = {
  regionId: string
  companyId: string | null
  contextVersion: number
  /** 页面当前显示结果的结果版本（事件必须来自这份结果） */
  resultVersion: string
}

/** 一次事件涉及的点：哪条序列（目录元数据）的哪个时段。 */
export type InsightSelectionHit = {
  series: InsightSeriesMeta
  point: { ts: number; end: string }
}

const MAX_INTERVALS = 2000

/** 契约对象标识形态（contract.mjs 的 ID_RE）：序列目录里的维度值可能是中文显示名，
 *  形态不合法的身份不进 objectRefs（时段仍承载选区），不让整条选区被校验拒绝。 */
const OBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,199}$/

/** 毫秒 → 北京时间 ISO（秒级，带时区，时段要求）。 */
function beijingIso(ms: number): string {
  const iso = new Date(ms + 8 * 3_600_000).toISOString()
  return `${iso.slice(0, 19)}+08:00`
}

/**
 * 把事件点集按时段合并：ts 排序后，起点不晚于上一段终点即视为同段连续。
 * 框选跨序列、跨日时得到的是少数几段连续区间，而不是几千个单格时段。
 */
function mergeIntervals(hits: InsightSelectionHit[]): TimeInterval[] {
  const slots = hits
    .flatMap((hit) => {
      const endMs = Date.parse(hit.point.end)
      return Number.isFinite(endMs) ? [{ startMs: hit.point.ts, endMs }] : []
    })
    .sort((a, b) => a.startMs - b.startMs)
  const merged: TimeInterval[] = []
  for (const slot of slots) {
    const last = merged[merged.length - 1]
    if (last && slot.startMs <= Date.parse(last.end)) {
      if (slot.endMs > Date.parse(last.end)) last.end = beijingIso(slot.endMs)
    } else {
      merged.push({ start: beijingIso(slot.startMs), end: beijingIso(slot.endMs) })
    }
    if (merged.length >= MAX_INTERVALS) break
  }
  return merged
}

/** 序列 → 对象引用：取来源登记的对象维度值（如 nodeName / plant），去重；无对象维度则空。 */
function objectRefsOf(hits: InsightSelectionHit[]): ObjectRef[] {
  const seen = new Set<string>()
  const refs: ObjectRef[] = []
  for (const hit of hits) {
    const dimension = getInsightSource(hit.series.sourceId)?.objectDimension
    if (!dimension) continue
    const id = String(hit.series.dimensions?.[dimension] ?? '')
    if (!id || seen.has(id) || !OBJECT_ID_RE.test(id)) continue
    seen.add(id)
    refs.push({ type: 'object', id })
  }
  return refs
}

/** 多序列取唯一值：全部相同才返回该值，混着不同值返回 null（不硬造单一口径）。 */
function unanimous<T>(values: Array<T | null | undefined>): T | null {
  const first = values.find((value) => value !== null && value !== undefined) ?? null
  return values.every((value) => (value ?? null) === first) ? first : null
}

/** 选区规范化键（防回环比对用）：版本 + 对象 + 时段 + 来源。 */
function selectionKey(selection: InsightSelection): string {
  return JSON.stringify([
    selection.resultRef.resultVersion,
    selection.objectRefs.map((ref) => `${ref.type}:${ref.id}`),
    selection.timeIntervals,
    [...selection.sourceIds].sort(),
    selection.marketPhase,
    selection.priceObject,
  ])
}

/**
 * 语义选区构建器。用法：
 *   const buildSelection = useInsightSelection(() => ({ regionId, companyId, contextVersion, resultVersion }))
 *   const selection = buildSelection(result, hits)   // null = 丢弃（过期 / 重复 / 数据不完整）
 * 返回的选区已通过契约校验，可直接 emit 给页面或装进交接。
 */
export function useInsightSelection(getCurrent: () => InsightSelectionCurrent) {
  let lastKey: string | null = null

  /** 结果或上下文更换时清掉「同一选区」记忆，允许用户重选同一段。 */
  function reset(): void {
    lastKey = null
  }

  function build(result: InsightBlockResult, hits: InsightSelectionHit[]): InsightSelection | null {
    if (!hits.length) return null
    if (!result.resultVersion || !result.readSetRef) return null
    const scope = result.resolvedScope as { regionId?: unknown; companyId?: unknown }
    if (typeof scope.regionId !== 'string' || !scope.regionId) return null

    const timeIntervals = mergeIntervals(hits)
    const objectRefs = objectRefsOf(hits)
    // 契约要求：对象 / 时段 / 记录至少一项。无对象维度的来源（如全省序列）靠时段承载。
    if (!objectRefs.length && !timeIntervals.length) return null

    const marketPhases = hits.map((hit) => hit.series.marketPhase ?? null)
    const priceObjects = hits.map((hit) => hit.series.priceObject ?? null)

    let selection: InsightSelection
    try {
      selection = parseSelection({
        schemaVersion: SELECTION_SCHEMA,
        resultRef: {
          queryId: result.queryId,
          resultVersion: result.resultVersion,
          readSetRef: result.readSetRef,
          expiresAt: result.expiresAt ?? null,
        },
        regionId: scope.regionId,
        companyId: scope.companyId ?? null,
        objectRefs,
        timeIntervals,
        metricRefs: [],
        recordRefs: [],
        priceObject: unanimous(priceObjects),
        marketPhase: unanimous(marketPhases),
        sourceIds: [...new Set(hits.map((hit) => hit.series.sourceId))],
        contextVersion: result.contextVersion,
      })
    } catch {
      // 结果本体不完整（缺版本、维度缺失等）：这条事件无法成为合法选区，丢弃。
      return null
    }

    // 迟到事件守卫：选区来自结果快照，当前上下文（地区 / 公司 / 代次 / 结果版本）
    // 已经不是它所属的那一版 → 直接丢弃，不让旧上下文的选择改写新页面。
    if (!isSelectionCurrent(selection, getCurrent())) {
      reset()
      return null
    }

    const key = selectionKey(selection)
    if (key === lastKey) return null
    lastKey = key
    return selection
  }

  return { build, reset }
}
