import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { beijingToday } from 'shared/midlong/dates.mjs'
import {
  parseInsightContext,
  InsightContractError,
  type InsightContextInput,
} from 'shared/insight/contract.mjs'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  hasInsightDrilldownParams,
  parseInsightDrilldownQuery,
  type InsightDrilldownRestore,
} from '@/services/region/insightHandoff'
import { useInsightRequestGeneration } from './useInsightRequestGeneration'

// 市场洞察统一查询上下文（dljy#2996，OpenSpec 任务 5.4/5.6，design D3）
// ----------------------------------------------------------------------------
// 页面状态 = 「上下文 → 结果」纯函数的上下文部分：地区 × 公司 × 业务日期窗 × 对象 × 来源。
// 本 composable 负责四件事：
//   1. 状态与地址参数互转：start / end（YYYY-MM-DD）、objects / sources（逗号分隔、
//      逐项 URL 编码）。进页面按 query 还原（刷新/后退可恢复），字段变化用 router.replace
//      写回（不产生历史堆积）。解析经共享契约 parseInsightContext 校验，非法参数丢弃
//      并给一条「已忽略不合法参数：…」提示——宁可回到默认值，不带着口径不明的条件查询。
//   2. 默认窗口为北京时间当日：不自动跳到「有数据的日子」——有没有数据由区块的
//      可用性说明与「查看可分析日期」候选入口表达（A02）。
//   3. 地区或公司变化时清空对象选择（对象属于原地区/公司，跨地区沿用等于串读），日期保留。
//   4. 任一业务字段变化 contextVersion +1，并同步给 useInsightRequestGeneration
//      （作废在途请求，迟到响应不写入新状态）。
// 另提供可选「下钻恢复」入口（dljy#3087，任务 15.1）：URL 带 hx_ 前缀的下钻参数
//（buildInsightDrilldownQuery 写入，见 src/services/region/insightHandoff.ts）时，
// 进页面解析并暴露 drilldownRestore（view/priceObject/marketPhase/from 交给页面落状态）；
// 共享四键与下钻解析同规则、四键语义为准，ignored 合并进同一条一次性提示。
//
// 必须在组件 setup 中调用（useRoute/useRouter 依赖注入）。objectIds 不进 context，
// 由调用方放进 filters.objectIds 组装请求（后端按分析的 requiresObjects 校验）。

/** 地址参数名（写进 URL 的唯一一组洞察上下文键；其余 query 键原样保留）。 */
const QUERY_KEYS = ['start', 'end', 'objects', 'sources'] as const

type ParsedQuery = {
  window: { start: string; end: string } | null
  objects: string[] | null
  sources: string[] | null
}

/** 单项对象/来源引用是否可被契约接受（借 parseInsightContext 的完整校验，不含窗口）。 */
function validIds(ids: string[], kind: 'objects' | 'sources'): boolean {
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

/**
 * 解析地址参数。逐参数校验、逐参数丢弃：窗口（start+end 成对且为合法业务窗）、
 * objects / sources（逐项经契约校验）。返回 null 的项表示「该参数非法或缺失，
 * 回落默认值」；ignored 汇总被丢弃的参数名供提示。
 */
export function parseInsightQuery(rawQuery: LocationQuery): { parsed: ParsedQuery; ignored: string[] } {
  const ignored: string[] = []
  const start = typeof rawQuery.start === 'string' ? rawQuery.start : null
  const end = typeof rawQuery.end === 'string' ? rawQuery.end : null

  let window: { start: string; end: string } | null = null
  if (start !== null || end !== null) {
    let ok = false
    if (start !== null && end !== null) {
      try {
        parseInsightContext({
          regionId: 'yunnan',
          businessWindow: { start, end },
        })
        ok = true
      } catch {
        ok = false
      }
    }
    if (ok && start !== null && end !== null) window = { start, end }
    else ignored.push(start !== null && end !== null ? 'start、end' : start !== null ? 'start' : 'end')
  }

  const decodeList = (value: unknown): string[] | null => {
    if (typeof value !== 'string' || !value) return null
    try {
      return value.split(',').map(decodeURIComponent)
    } catch {
      // 手改 URL 留下的非法百分号编码：按参数非法处理，交给调用方丢弃。
      return null
    }
  }

  let objects: string[] | null = null
  const rawObjects = decodeList(rawQuery.objects)
  if (rawQuery.objects !== undefined) {
    if (rawObjects && rawObjects.length && validIds(rawObjects, 'objects')) objects = rawObjects
    else ignored.push('objects')
  }

  let sources: string[] | null = null
  const rawSources = decodeList(rawQuery.sources)
  if (rawQuery.sources !== undefined) {
    if (rawSources && rawSources.length && validIds(rawSources, 'sources')) sources = rawSources
    else ignored.push('sources')
  }

  return { parsed: { window, objects, sources }, ignored }
}

/** 当前状态 → 地址 query（保留其它键；空集合删键；逐项编码防对象名含逗号）。 */
function buildQuery(state: { window: { start: string; end: string }; objects: string[]; sources: string[] }, current: LocationQuery): LocationQuery {
  const next: LocationQuery = { ...current }
  next.start = state.window.start
  next.end = state.window.end
  if (state.objects.length) next.objects = state.objects.map(encodeURIComponent).join(',')
  else delete next.objects
  if (state.sources.length) next.sources = state.sources.map(encodeURIComponent).join(',')
  else delete next.sources
  return next
}

/** query 中的洞察键是否与状态序列化一致（写回自检，防「应用→写回」循环）。 */
function sameInsightQuery(a: LocationQuery, b: LocationQuery): boolean {
  return QUERY_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null))
}

export function useInsightContext() {
  const route = useRoute()
  const router = useRouter()

  // 初始化：先按 query 解析出初值再注册 watch，避免初始化被当成一次上下文变化。
  const today = beijingToday()
  const initial = parseInsightQuery(route.query)
  const businessWindow = ref(initial.parsed.window ?? { start: today, end: today })
  const objectIds = ref<string[]>(initial.parsed.objects ?? [])
  const sourceIds = ref<string[]>(initial.parsed.sources ?? [])

  // 下钻恢复（任务 15.1，可选入口）：URL 带 hx_ 下钻参数（buildInsightDrilldownQuery 写入）
  // 时解析并应用。共享四键（窗口/对象/来源）与下钻解析同规则，已由上面 parseInsightQuery
  // 还原、四键语义为准；这里只把 hx_ 扩展字段（view/priceObject/marketPhase/from）交给
  // 页面落状态，ignored 与四键解析合并成同一条一次性提示。价格/供需页签名不受影响。
  let drilldownIgnored: string[] = []
  const drilldownRestore = ref<InsightDrilldownRestore | null>(null)
  if (hasInsightDrilldownParams(route.query)) {
    const drilldown = parseInsightDrilldownQuery(route.query)
    drilldownRestore.value = {
      from: drilldown.payload.from,
      view: drilldown.payload.view,
      priceObject: drilldown.payload.priceObject,
      marketPhase: drilldown.payload.marketPhase,
    }
    drilldownIgnored = drilldown.ignored
  }

  /** 一次性提示：进页面时被丢弃的不合法参数（用户手改 URL 的场景）。 */
  const ignoredParamsNotice = ref<string | null>(
    [...initial.ignored, ...drilldownIgnored].length
      ? `已忽略不合法参数：${[...new Set([...initial.ignored, ...drilldownIgnored])].join('、')}`
      : null
  )

  /** 全局地区（只读引用，切换经全局地区选择器）。 */
  const regionId = computed(() => selectedRegionId.value)
  /** 当前公司；公司空态（未选择）发请求时按无公司上下文处理。 */
  const companyId = computed(() => selectedCompanyId.value || null)

  /** 上下文代次：任一业务字段（含地区/公司）变化 +1，随请求发给后端。 */
  const contextVersion = ref(0)

  const requestGeneration = useInsightRequestGeneration()

  /** 业务身份签名：变化即上下文变化（地区/公司也在内，故无需单独为其递增）。 */
  const signature = computed(() =>
    JSON.stringify([regionId.value, companyId.value, businessWindow.value.start, businessWindow.value.end, objectIds.value, sourceIds.value])
  )

  watch(signature, () => {
    contextVersion.value += 1
    // 同步给请求代次：在途请求全部作废，迟到响应不写入新状态（RW04）。
    requestGeneration.updateContext({
      regionId: regionId.value,
      companyId: companyId.value ?? undefined,
      businessWindow: { start: businessWindow.value.start, end: businessWindow.value.end },
      objects: [...objectIds.value],
      source: sourceIds.value.join(','),
    })
    // 写回地址（replace，不产生历史堆积）；query 与状态一致时是 no-op。
    const target = buildQuery(
      { window: businessWindow.value, objects: objectIds.value, sources: sourceIds.value },
      route.query
    )
    if (!sameInsightQuery(target, route.query)) router.replace({ query: target })
  })

  // 浏览器后退/前进或外部改 query：与当前状态不一致时按 query 恢复（触发签名 watch
  // 统一递增代次）；自己刚写回的 query 与状态一致，跳过，不会形成循环。
  watch(
    () => route.query,
    (query) => {
      if (sameInsightQuery(query, buildQuery({ window: businessWindow.value, objects: objectIds.value, sources: sourceIds.value }, query))) return
      const restored = parseInsightQuery(query)
      businessWindow.value = restored.parsed.window ?? { start: today, end: today }
      objectIds.value = restored.parsed.objects ?? []
      sourceIds.value = restored.parsed.sources ?? []
    }
  )

  // 地区或公司变化：清空对象（对象属于原地区/公司），保留日期。清空本身会触发签名
  // watch 递增代次；对象本就为空时地区/公司仍在签名里，同样递增一次。
  watch([selectedRegionId, selectedCompanyId], () => {
    if (objectIds.value.length) objectIds.value = []
  })

  function setBusinessWindow(start: string, end: string): void {
    businessWindow.value = { start, end }
  }

  function setObjectIds(ids: string[]): void {
    objectIds.value = [...ids]
  }

  function setSourceIds(ids: string[]): void {
    sourceIds.value = [...ids]
  }

  function dismissNotice(): void {
    ignoredParamsNotice.value = null
  }

  /**
   * 组装发给后端的 context（objectIds 不在此列，由调用方放 filters.objectIds）。
   * 经 parseInsightContext 校验：状态不合法（UI 约束被绕过等）直接抛中文错误，
   * 不带口径不明的条件发请求。
   */
  function toQueryContext(): InsightContextInput {
    const input: InsightContextInput = {
      regionId: regionId.value,
      companyId: companyId.value,
      subjectId: null,
      objectRefs: [],
      businessWindow: { start: businessWindow.value.start, end: businessWindow.value.end, timeZone: 'Asia/Shanghai' },
      marketPhase: null,
      priceObject: null,
      sourceIds: [...sourceIds.value],
      mode: 'ex-post',
      asOf: null,
      contextVersion: contextVersion.value,
    }
    try {
      parseInsightContext(input)
    } catch (error) {
      if (error instanceof InsightContractError) throw error
      throw new InsightContractError({ status: 400, code: 'BAD_REQUEST' }, '查询上下文不完整，请检查日期与来源选择')
    }
    return input
  }

  return {
    regionId,
    companyId,
    businessWindow,
    objectIds,
    sourceIds,
    contextVersion,
    ignoredParamsNotice,
    /** 下钻恢复（任务 15.1）：URL 带 hx_ 参数时非 null，页面按需消费 view/priceObject/marketPhase/from。 */
    drilldownRestore,
    dismissNotice,
    setBusinessWindow,
    setObjectIds,
    setSourceIds,
    toQueryContext,
    /** 请求代次（页面发请求一律经 run，自动丢弃迟到/作废响应）。 */
    request: requestGeneration,
  }
}

export type InsightContextState = ReturnType<typeof useInsightContext>
