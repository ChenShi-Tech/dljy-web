<script setup lang="ts">
// 云南跨省与电网边界页（dljy#3024 第一部分，OpenSpec build-yunnan-regional-market-insight 任务 10.5）
// ----------------------------------------------------------------------------
// /insight/grid-boundaries 的云南实现：三个页签（送受电 / 通道断面 / 备用机组）。
// 口径要点（specs grid-boundary-analysis，本页只呈现、不计算）：
//   - 送受电与通道潮流的正负号是方向：负值是反方向，原样保留、不取绝对值；
//   - 限值与实际只在同名通道、同方向、同一时段配对（后端 gridLimitMatch）；
//     没有配对时逐条展示后端给出的具体解释，绝不显示虚假的输电裕度；
//   - 限值对比是实测与披露限值的对比，不是可用输电能力，也不等于调度认定的越限；
//   - 是否调峰、必开必停是记录不是时序：只按业务日列表呈现，不画成曲线；
//   - 对象选择器的选项来自覆盖接口（coverage）各来源的 objects 清单并集：
//     字段缺失（运行实例未部署新后端）时显示「无法列出」说明且不发查询，绝不伪造选项；
//     字段在但为空是「窗口内没有对象」，同样如实说明；
//   - 获权四分析按能力目录判定可见性：公共账号不渲染获权区块、不发获权请求。
// 未选对象 / 对象清单不可用 / 窗口超限的前置拦截在页面层完成（不发请求），后端校验是第二道防线。

import InsightNote from '@/components/insight/InsightNote.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'
import type { InsightContextInput } from 'shared/insight/contract.mjs'
import {
  fetchInsightCapabilities,
  fetchInsightCoverage,
  queryInsight,
  type InsightBlockResult,
  type InsightCapabilities,
  type InsightCoverageSource,
  type InsightRequestError,
} from '@/services/insight/insightClient'
import { useInsightContext } from '@/composables/useInsightContext'
import { useInsightEntryAnchor } from '@/composables/useInsightEntryAnchor'
import { insightAiBlockOf, useInsightAiPage, type InsightAiEvidenceBlock } from '@/features/regions/yunnan/insight/useInsightAiPage'
import {
  SPATIAL_LINK_TARGETS,
  keywordSpatialLinkQuery,
  openSpatialViewLink,
  spatialEntryVisible,
} from '../spatialLinks'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightAnchorNotice from '@/components/insight/InsightAnchorNotice.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightObjectPicker, { type InsightObjectOption } from '@/components/insight/InsightObjectPicker.vue'
import InsightResultTable from '@/components/insight/InsightResultTable.vue'
import { GRID_GEO_DISCLOSURE_ROLES } from 'shared/schema/grid-geo-contract.mjs'
import { getCurrentUser } from '@/services/auth'
import { ApiError } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchGridDisclosureEvents,
  fetchGridDisclosureOverview,
  fetchGridObject,
} from '@/features/gridGeo/client'
import {
  maintenanceListSummary,
  maintenanceTimeBasis,

} from '@/features/gridGeo/disclosureMaintenance'
import { disclosureEventWindow, parseDisclosureTime } from '@/features/gridGeo/disclosureTime'
import type { GridDisclosureEvent } from '@/features/gridGeo/types'
import type { GridObjectDetail } from '@/features/gridGeo/objectNavigation'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import {
  formatBeijingDateTime,
  insightSourceTitle,
  type InsightSourceTitle,
} from '@/components/insight/insightText'

// ── 分析与固定文案 ───────────────────────────────────────────────────────────────────────

const BOUNDARY_SERIES_ANALYSIS = 'grid.boundary-series'
const TRANSFER_DAILY_ANALYSIS = 'grid.transfer-daily'
const CHANNEL_FLOWS_ANALYSIS = 'grid.channel-flows'
const RESERVE_UNITS_ANALYSIS = 'grid.reserve-units'
const UNIT_LISTS_ANALYSIS = 'grid.unit-lists'

/** 需要对象清单（coverage.objects）的获权分析：通道断面 / 备用机组 / 是否与清单。 */
const OBJECT_COVERAGE_ANALYSES = [CHANNEL_FLOWS_ANALYSIS, RESERVE_UNITS_ANALYSIS, UNIT_LISTS_ANALYSIS] as const
type ObjectCoverageAnalysis = (typeof OBJECT_COVERAGE_ANALYSES)[number]

const GRID_TABS = [
  { view: 'transfer', label: '送受电' },
  { view: 'channel', label: '通道断面' },
  { view: 'reserve', label: '备用机组' },
  { view: 'maintenance', label: '检修干预' },
] as const

type GridTab = (typeof GRID_TABS)[number]['view']

// 视图固定说明（口径来自 specs 与后端电网边界视图，改文案要同步 docs/market-insight-grid.md）
const SIGN_TEXT = '送受电与通道潮流的正负号是方向：负值是反方向，原样保留、不取绝对值'
const DAILY_NOTE = '逐日口径：送电电量（兆瓦时）与通道能力（兆瓦）、负载率（%）分列，不互相换算'
const LIMIT_PAIR_TEXT = '限值与实际只在同名通道、同方向、同一时段配对；配对上的时段给出裕度与负载率，配不上的按原因说明'
const LIMIT_NOT_ATC_TEXT = '这是实测与披露限值的对比，不是可用输电能力，也不等于调度认定的越限'
const RECORDS_NOTE = '记录不是时序曲线：是否开展调峰与必开必停清单按业务日列表呈现，不画曲线、不换算出力'
const OBJECTS_UNAVAILABLE_TEXT = '对象清单需要新版洞察服务，当前无法列出'
const OBJECTS_EMPTY_TEXT = '所选窗口内没有可选对象：可换一个日期窗或确认数据接入情况'
const PICK_CHANNEL_TEXT = '请选择通道或断面'
const PICK_RESERVE_TEXT = '请选择区域或机组群对象'
const PICK_LIST_TEXT = '请选择区域或电厂对象'
const CHANNEL_WINDOW_TEXT = '通道断面分析一次最多查 7 天：请把分析日期缩短后再查'
const LIMIT_MATCH_FOLLOW_TEXT = '与上方同一组对象；对象未选或窗口超限时本区块不查询'
const ENTITLEMENT_TRANSFER_TEXT = '获权数据需开通：当前公司没有逐日送电电量与通道能力的查看授权'
const ENTITLEMENT_CHANNEL_TEXT = '获权数据需开通：当前公司没有省间联络线与断面限值的查看授权'
const ENTITLEMENT_RESERVE_TEXT = '获权数据需开通：当前公司没有备用容量与机组清单的查看授权'

/** 记录视图的维度列名 → 业务语言（来源维度登记是内部名，界面上不透出）。 */
const DIMENSION_TEXT: Record<string, string> = {
  region: '区域',
  channel: '通道',
  section: '断面',
  tieLine: '联络线',
  category: '送电类别',
  group: '机组群',
  plant: '电厂',
  unit: '机组',
  mode: '必开/必停',
  flag: '是否调峰',
}

function dimensionText(key: string): string {
  return DIMENSION_TEXT[key] ?? key
}

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)
// 入口锚定（dljy#3134）：能力目录就绪且存在获权分析才扫描——公共账号零请求红线保持。
const anchorReady = computed(() => (capabilities.value?.analyses?.some((entry) => entry.access === 'company') ?? false))
const entryAnchor = useInsightEntryAnchor(ctx, { ready: anchorReady })

/** 契约镜像里的分析登记（views / limits），不依赖后端 capabilities 是否下发。 */
const boundaryDef = getInsightAnalysis(BOUNDARY_SERIES_ANALYSIS)
const channelDef = getInsightAnalysis(CHANNEL_FLOWS_ANALYSIS)
const reserveDef = getInsightAnalysis(RESERVE_UNITS_ANALYSIS)
const unitListsDef = getInsightAnalysis(UNIT_LISTS_ANALYSIS)
const maxDays = computed(() => boundaryDef?.limits.maxDays ?? 31)
/** 通道断面分析一次最多 7 天（后端 limits 登记），页面在发请求前拦截。 */
const channelMaxDays = computed(() => channelDef?.limits.maxDays ?? 7)

/** 获权四分析按公司授权可见（capabilities 只返回当前公司可用的分析）。 */
function hasAnalysis(analysisId: string): boolean {
  return capabilities.value?.analyses.some((analysis) => analysis.analysisId === analysisId) ?? false
}
const hasTransferDaily = computed(() => hasAnalysis(TRANSFER_DAILY_ANALYSIS))
const hasChannelFlows = computed(() => hasAnalysis(CHANNEL_FLOWS_ANALYSIS))
const hasReserveUnits = computed(() => hasAnalysis(RESERVE_UNITS_ANALYSIS))
const hasUnitLists = computed(() => hasAnalysis(UNIT_LISTS_ANALYSIS))

/** 能力目录来源 → 业务标题目录（区块标签、证据抽屉、表格与说明共用）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

async function loadCapabilities(): Promise<void> {
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (!result) return
    capabilities.value = result
    // 能力目录就绪后补一次当前页签（之前被「目录未就绪」拦住的查询与对象清单）。
    ensureTab(activeTab.value)
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
}

// ── 查询状态（页签懒加载 + queriedKey 去重 + 代次作废）────────────────────────────────────

/** 查询名：公开背景曲线 + 获权四分析的两视图拆分。 */
type QueryName =
  | 'boundary-series'
  | 'transfer-daily'
  | 'channel-series'
  | 'channel-limit-match'
  | 'reserve-units'
  | 'unit-lists'

type ViewState = {
  result: InsightBlockResult | null
  error: InsightRequestError | null
  loading: boolean
  /** 最近一次成功/失败查询的签名；与当前签名不同即口径过期 */
  queriedKey: string
}

function blankState(): ViewState {
  return { result: null, error: null, loading: false, queriedKey: '' }
}

const viewStates = reactive<Record<QueryName, ViewState>>({
  'boundary-series': blankState(),
  'transfer-daily': blankState(),
  'channel-series': blankState(),
  'channel-limit-match': blankState(),
  'reserve-units': blankState(),
  'unit-lists': blankState(),
})

const activeTab = ref<GridTab>('transfer')
const visitedTabs = reactive(new Set<GridTab>(['transfer']))

/** 对象选择：三个获权分析各自持有（选项来自各自分析的覆盖清单，不跨分析混用）。 */
const channelObjects = ref<string[]>([])
const reserveObjects = ref<string[]>([])
const listObjects = ref<string[]>([])

// ── 对象清单（coverage.objects）：获权区块的选项来源 ─────────────────────────────────────

type ObjectsState = {
  loading: boolean
  error: InsightRequestError | null
  /** 该分析的覆盖清单是否已经取回（无论结果如何）：防重复请求 */
  loaded: boolean
  /** null = coverage 未给对象清单（新版洞察服务未部署，无法列出）；[] = 窗口内没有对象 */
  objects: string[] | null
  /** 后端对清单的补充说明原文（如清单被截断）。 */
  note: string
}

function blankObjects(): ObjectsState {
  return { loading: false, error: null, loaded: false, objects: null, note: '' }
}

const objectStates = reactive<Record<ObjectCoverageAnalysis, ObjectsState>>({
  [CHANNEL_FLOWS_ANALYSIS]: blankObjects(),
  [RESERVE_UNITS_ANALYSIS]: blankObjects(),
  [UNIT_LISTS_ANALYSIS]: blankObjects(),
})

/** 清单 → 选择器选项（并集，保持覆盖清单的名称顺序）。 */
function optionsOf(analysisId: ObjectCoverageAnalysis): InsightObjectOption[] {
  return (objectStates[analysisId].objects ?? []).map((object) => ({ id: object, label: object }))
}

type ObjectsPhase = 'loading' | 'error' | 'unavailable' | 'empty' | 'ready'

/** 清单状态机：页面据此渲染提示并决定是否拦截查询。 */
function objectsPhase(analysisId: ObjectCoverageAnalysis): ObjectsPhase {
  const entry = objectStates[analysisId]
  if (entry.loading) return 'loading'
  if (entry.error) return 'error'
  if (!entry.loaded) return 'loading'
  if (entry.objects === null) return 'unavailable'
  if (!entry.objects.length) return 'empty'
  return 'ready'
}

/** 拉取对象清单：对该分析发覆盖请求（filters 不带 objectIds），各来源 objects 取并集。 */
async function loadObjectOptions(analysisId: ObjectCoverageAnalysis): Promise<void> {
  if (!capabilities.value || capabilitiesError.value) return
  if (!hasAnalysis(analysisId)) return
  const entry = objectStates[analysisId]
  if (entry.loading || entry.loaded || entry.error) return
  entry.loading = true
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCoverage({ analysisId, context: ctx.toQueryContext() }, { signal }))
    if (!result) return // 作废/迟到：不写状态
    const union = new Set<string>()
    let provided = false
    let note = ''
    for (const source of result.sources as InsightCoverageSource[]) {
      if (Array.isArray(source.objects)) {
        provided = true
        for (const object of source.objects) union.add(object)
      }
      if (source.objectsNote) note = source.objectsNote
    }
    entry.objects = provided ? [...union] : null
    entry.note = note
    entry.loaded = true
    // 清单就绪后补发当前页签里被「清单未就绪」拦住的查询。
    ensureTab(activeTab.value)
  } catch (error) {
    entry.error = error as InsightRequestError
  } finally {
    entry.loading = false
  }
}

/** 清单读取失败后的手动重试。 */
function retryObjects(analysisId: ObjectCoverageAnalysis): void {
  const entry = objectStates[analysisId]
  entry.error = null
  entry.loaded = false
  void loadObjectOptions(analysisId)
}

function onChannelObjectsChange(ids: string[]): void {
  channelObjects.value = [...ids]
}

// ── 空间查阅入口（dljy#3106 D6.1「三维地形/空间」未就绪项补齐）─────────────────────────
// 通道断面页签选中**单个**通道/断面后，可跳入既有「公开披露空间层」（grid-geo 模块原地
// 复用，洞察不复制 Cesium）。通道/断面在 grid-geo 无独立对象类型，不伪造对象绑定，以披露
// 检索词承接（对象名预填搜索，输电主题按名过滤）。权限显隐沿用 spatialLinks 登记
// （canAccessPath 既有口径，无权限不渲染）；query 白名单只带单个对象名 + 窗口末日
//（objectDate）+ 来源标记，多选不渲染（对象名数组不进 URL），公司未选不渲染
//（grid-geo 按 地区+公司 校验归属）。

const router = useRouter()
const DISCLOSURE_SPATIAL_TARGET = SPATIAL_LINK_TARGETS.disclosureSpatial

const channelSpatialVisible = computed(() =>
  spatialEntryVisible({
    path: DISCLOSURE_SPATIAL_TARGET,
    objectName: channelObjects.value.length === 1 ? channelObjects.value[0] : null,
    companyId: ctx.companyId.value,
  })
)

function onChannelToSpatialView(): void {
  const name = channelObjects.value.length === 1 ? channelObjects.value[0] : ''
  if (!name || !ctx.companyId.value) return
  openSpatialViewLink(router, {
    path: DISCLOSURE_SPATIAL_TARGET,
    query: keywordSpatialLinkQuery({ keyword: name, date: ctx.businessWindow.value.end, from: 'insight-grid-boundaries' }),
  })
}

function onReserveObjectsChange(ids: string[]): void {
  reserveObjects.value = [...ids]
}

function onListObjectsChange(ids: string[]): void {
  listObjects.value = [...ids]
}

function windowDaysOf(window: { start: string; end: string }): number {
  const days = (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000 + 1
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0
}

/** 通道断面窗口超限：不发查询（对象清单仍可列出）；后端第二道防线会拒绝超窗查询。 */
const channelWindowTooLarge = computed(() => windowDaysOf(ctx.businessWindow.value) > channelMaxDays.value)

/** 查询签名：上下文代次（窗口/地区/公司都在代次里）+ 各查询自身的对象选择。 */
function queryKeyOf(name: QueryName): string {
  switch (name) {
    case 'channel-series':
    case 'channel-limit-match':
      return [name, ctx.contextVersion.value, channelObjects.value.join(',')].join('|')
    case 'reserve-units':
      return [name, ctx.contextVersion.value, reserveObjects.value.join(',')].join('|')
    case 'unit-lists':
      return [name, ctx.contextVersion.value, listObjects.value.join(',')].join('|')
    default:
      return [name, ctx.contextVersion.value].join('|')
  }
}

// 上下文变化（窗口/地区/公司）：全部查询结果与对象清单都属于另一份读取，全部作废重查。
watch(
  () => ctx.contextVersion.value,
  () => {
    for (const name of Object.keys(viewStates) as QueryName[]) Object.assign(viewStates[name], blankState())
    for (const analysisId of OBJECT_COVERAGE_ANALYSES) objectStates[analysisId] = blankObjects()
    resetMaintenanceStates()
    ensureTab(activeTab.value)
  }
)
// 局部对象选择变化：只作废对应分析的查询（不重列覆盖清单）。
watch(channelObjects, () => {
  Object.assign(viewStates['channel-series'], blankState())
  Object.assign(viewStates['channel-limit-match'], blankState())
  ensureQuery('channel-series')
  ensureQuery('channel-limit-match')
})
watch(reserveObjects, () => {
  Object.assign(viewStates['reserve-units'], blankState())
  ensureQuery('reserve-units')
})
watch(listObjects, () => {
  Object.assign(viewStates['unit-lists'], blankState())
  ensureQuery('unit-lists')
})

function onTabChange(name: string | number): void {
  activeTab.value = name as GridTab
  visitedTabs.add(activeTab.value)
  ensureTab(activeTab.value)
}

function onWindowChange(next: { start: string; end: string }): void {
  ctx.setBusinessWindow(next.start, next.end)
}

// ── 查询编排 ─────────────────────────────────────────────────────────────────────────────

/** 页签首次激活（或口径变化后重查）需要的覆盖清单与查询集合。 */
function ensureTab(tab: GridTab): void {
  if (tab === 'transfer') {
    ensureQuery('boundary-series')
    ensureQuery('transfer-daily')
  } else if (tab === 'channel') {
    void loadObjectOptions(CHANNEL_FLOWS_ANALYSIS)
    ensureQuery('channel-series')
    ensureQuery('channel-limit-match')
  } else if (tab === 'maintenance') {
    ensureMaintenanceTab()
  } else {
    void loadObjectOptions(RESERVE_UNITS_ANALYSIS)
    void loadObjectOptions(UNIT_LISTS_ANALYSIS)
    ensureQuery('reserve-units')
    ensureQuery('unit-lists')
  }
}

/** 前置拦截（能力未就绪 / 无授权 / 清单不可用 / 未选对象 / 窗口超限）+ 同签名去重后发查询。 */
function ensureQuery(name: QueryName): void {
  if (!capabilities.value || capabilitiesError.value) return
  if (name === 'transfer-daily' && !hasTransferDaily.value) return
  if (name === 'channel-series' || name === 'channel-limit-match') {
    if (!hasChannelFlows.value || channelWindowTooLarge.value) return
    const objects = objectStates[CHANNEL_FLOWS_ANALYSIS].objects
    if (!objects || !objects.length || !channelObjects.value.length) return
  }
  if (name === 'reserve-units') {
    if (!hasReserveUnits.value) return
    const objects = objectStates[RESERVE_UNITS_ANALYSIS].objects
    if (!objects || !objects.length || !reserveObjects.value.length) return
  }
  if (name === 'unit-lists') {
    if (!hasUnitLists.value) return
    const objects = objectStates[UNIT_LISTS_ANALYSIS].objects
    if (!objects || !objects.length || !listObjects.value.length) return
  }
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  if (entry.queriedKey === key) return // 有结果或已按此键失败过：不自动重查（重试由用户触发）
  void runQuery(name)
}

/** 各查询的 analysisId / context / filters：限值对比与记录视图显式给 view，其余默认明细。 */
function buildRequest(name: QueryName): {
  analysisId: string
  context: InsightContextInput
  filters: Record<string, unknown>
} {
  if (name === 'channel-series') {
    return { analysisId: CHANNEL_FLOWS_ANALYSIS, context: ctx.toQueryContext(), filters: { view: 'series', objectIds: [...channelObjects.value] } }
  }
  if (name === 'channel-limit-match') {
    return { analysisId: CHANNEL_FLOWS_ANALYSIS, context: ctx.toQueryContext(), filters: { view: 'limit-match', objectIds: [...channelObjects.value] } }
  }
  if (name === 'reserve-units') {
    return { analysisId: RESERVE_UNITS_ANALYSIS, context: ctx.toQueryContext(), filters: { view: 'series', objectIds: [...reserveObjects.value] } }
  }
  if (name === 'unit-lists') {
    return { analysisId: UNIT_LISTS_ANALYSIS, context: ctx.toQueryContext(), filters: { view: 'records', objectIds: [...listObjects.value] } }
  }
  const analysisId = name === 'transfer-daily' ? TRANSFER_DAILY_ANALYSIS : BOUNDARY_SERIES_ANALYSIS
  return { analysisId, context: ctx.toQueryContext(), filters: { view: 'series' } }
}

async function runQuery(name: QueryName): Promise<void> {
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  const request = buildRequest(name)
  entry.loading = true
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => queryInsight(request, { signal }))
    if (!result || queryKeyOf(name) !== key) return // 作废/迟到：不写状态
    entry.result = result
    entry.queriedKey = key
  } catch (error) {
    if (queryKeyOf(name) !== key) return
    entry.error = error as InsightRequestError
    entry.queriedKey = key // 失败也记键：同样条件下不自动反复重试
  } finally {
    if (queryKeyOf(name) === key) entry.loading = false
  }
}

/** 手动重试 / 刷新（错误区块按钮）：清键重发。 */
function retryQuery(name: QueryName): void {
  viewStates[name].queriedKey = ''
  ensureQuery(name)
}

// ── 限值配对：配对行、按通道统计卡与未配对说明 ───────────────────────────────────────────

/** limit-match 目录条目（宽松形状：channel / flowSeriesId 等是电网视图字段）。 */
type LimitMatchEntry = {
  seriesId: string
  kind?: string
  channel?: string
  flowSeriesId?: string
  unit?: string
}

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null; bindingSide?: string | null }

/** 限值目录里 kind=limit-match 的通道条目。 */
function limitCatalogOf(result: InsightBlockResult | null): LimitMatchEntry[] {
  return ((result?.data?.series ?? []) as LimitMatchEntry[]).filter((meta) => meta.kind === 'limit-match')
}

/** 未配对条目的业务名：流量序列借来源标题，限值独有通道写「断面〈名〉」。 */
function limitLabelOf(seriesId: string): string {
  if (seriesId.startsWith('limit:')) return `断面「${seriesId.slice('limit:'.length)}」`
  const sourceId = seriesId.split('|')[0] ?? ''
  return insightSourceTitle(sourceId, sourceTitles.value)?.title ?? seriesId
}

const LIMIT_SUMMARY_METRICS = [
  'sample.matched-hours',
  'grid.outside-limit-hours',
  'sample.no-limit-hours',
  'sample.invalid-limit-hours',
  'grid.limit-margin-minimum',
  'grid.limit-load-rate-maximum',
] as const

type SummaryCardRow = { metricId: string; label: string; text: string; unit: string; note: string }
type LimitSummaryCard = { key: string; channel: string; rows: SummaryCardRow[] }

/** 配对行：通道、时段、实际与上下界、裕度（可负）与约束侧、负载率。 */
type LimitRow = {
  key: string
  channel: string
  start: string
  end: string
  flow: string
  upper: string
  lower: string
  margin: string
  bindingSide: string
  loadRate: string
}

function limitRowsOf(result: InsightBlockResult | null): LimitRow[] {
  const data = result?.data
  if (!result || !data) return []
  const catalog = new Map(limitCatalogOf(result).map((meta) => [meta.seriesId, meta]))
  const text = (value: unknown): string => (value === null || value === undefined || value === '' ? '—' : String(value))
  return ((data.rows ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const meta = catalog.get(String(row.seriesId ?? ''))
      if (!meta) return null
      const side = String(row.bindingSide ?? '')
      return {
        key: `${String(row.seriesId)}@${String(row.intervalStart)}`,
        channel: meta.channel ?? '—',
        start: formatBeijingDateTime(String(row.intervalStart ?? '')),
        end: formatBeijingDateTime(String(row.intervalEnd ?? '')),
        flow: text(row.flow),
        upper: text(row.upperLimit),
        lower: text(row.lowerLimit),
        // 裕度 = 上界裕度与下界裕度中较小者；为负表示超出限值区间（正负号原样）。
        margin: text(row.value),
        bindingSide: side === 'upper' ? '上界' : side === 'lower' ? '下界' : '—',
        loadRate: text(row.loadRate),
      }
    })
    .filter((row): row is LimitRow => row !== null)
}

const limitRows = computed<LimitRow[]>(() => limitRowsOf(viewStates['channel-limit-match'].result))

/** 按通道统计卡：配对时长、超出限值区间时长、缺限值/区间不成立时长、最小裕度、最高负载率。 */
const limitSummaryCards = computed<LimitSummaryCard[]>(() => {
  const result = viewStates['channel-limit-match'].result
  if (!result?.data) return []
  const tables = result.data.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined
  const rows = (tables?.summary?.rows ?? []) as unknown as MetricRow[]
  const bySeries = new Map<string, Map<string, MetricRow>>()
  for (const row of rows) {
    const map = bySeries.get(row.seriesId) ?? new Map<string, MetricRow>()
    map.set(row.metricId, row)
    bySeries.set(row.seriesId, map)
  }
  const cards: LimitSummaryCard[] = []
  for (const meta of limitCatalogOf(result)) {
    const own = bySeries.get(meta.seriesId)
    if (!own) continue
    cards.push({
      key: meta.seriesId,
      channel: meta.channel ?? '—',
      rows: LIMIT_SUMMARY_METRICS.map((metricId) => {
        const definition = getMetricDefinition(metricId)
        const metricRow = own.get(metricId)
        const shown = metricRow ? formatMetricValue(metricId, metricRow.value) : null
        return {
          metricId,
          label: definition?.label ?? metricId,
          text: shown === null || shown === undefined ? '—' : String(shown),
          unit: definition?.unit === 'count' || !definition?.unit ? '' : definition.unit,
          note: metricRow?.atIntervalStart ? `${formatBeijingDateTime(metricRow.atIntervalStart)} 出现` : '',
        }
      }),
    })
  }
  return cards
})

/** 未配对逐条解释（后端原因原文 + 条目业务名），不显示虚假裕度。 */
const limitUnpaired = computed<string[]>(() => {
  const unpaired = (viewStates['channel-limit-match'].result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => `${limitLabelOf(item.seriesId)}：${item.reason}`)
})

const limitNotes = computed<string[]>(() => {
  const notes = (viewStates['channel-limit-match'].result?.data?.notes ?? []) as Array<{ note?: string }>
  return notes.map((item) => item.note ?? '').filter(Boolean)
})

// ── 记录视图：是否调峰与必开必停清单（表格，不画曲线）────────────────────────────────────

type RecordRow = { key: string; date: string; source: string; cells: Record<string, string>; value: string }

/** 记录行的维度列（并集，保持出现顺序）。 */
const unitListColumns = computed<string[]>(() => {
  const rows = (viewStates['unit-lists'].result?.data?.rows ?? []) as Array<Record<string, unknown>>
  const keys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === 'sourceId' || key === 'date' || key === 'value') continue
      if (!keys.includes(key)) keys.push(key)
    }
  }
  return keys
})

/** 记录行：来源借业务标题，维度值与记录内容（是/否、必开/必停）按原文。 */
const unitListRows = computed<RecordRow[]>(() => {
  const result = viewStates['unit-lists'].result
  if (!result?.data) return []
  return ((result.data.rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const cells: Record<string, string> = {}
    for (const key of unitListColumns.value) {
      const value = row[key]
      cells[key] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return {
      key: `${String(row.sourceId)}|${String(row.date)}|${unitListColumns.value.map((key) => cells[key]).join('|')}`,
      date: String(row.date ?? ''),
      source: insightSourceTitle(String(row.sourceId ?? ''), sourceTitles.value)?.title ?? '—',
      cells,
      value: row.value === null || row.value === undefined || row.value === '' ? '—' : String(row.value),
    }
  })
})

// ── 证据抽屉与历史候选 ───────────────────────────────────────────────────────────────────

// ── 检修干预页签（#3092，任务 10.6，GB04—GB06、CH01）──────────────────────────────────
// 数据来自 grid-geo 披露事件接口（grid.disclosure_events，10.1 基线：检修四表不登记
// 洞察度量来源，事件消费走 disclosure-read-model 的身份归并与对象关系），不经洞察查询。
//   - 计划检修（category=maintenance，含检修计划与电网检修信息）与实际干预
//     （intervention+outage，人工干预与非计划停运）两组分列，不混排；
//   - identity=annotate：同一事件被重复披露时逐行带「第 N 版/共 M 版」，页首计数区分
//     原始记录与独立事件，身份不足的保留未归并提示（GB04）；
//   - 只有业务日的记录如实标注时间口径，不推断精确停复电时刻（GB04）；
//   - 联看同期价格只携带事件窗口跳价格页（start/end query），同期变化不自动归因损失，
//     返回恢复由浏览器后退承担（15.x 统一 insightHandoff）；已关联场站只来自对象接口
//     的明确关系（relations.plants），无关系不选同名/近似场站（GB05、GB06、CH01）。

/** 角色门控与后端 GRID_GEO_DISCLOSURE_ROLES 同源（shared 契约镜像）；授权由服务端裁决。 */
const canReadMaintenance = computed(() => GRID_GEO_DISCLOSURE_ROLES.includes(getCurrentUser().roleCode))

const MAINTENANCE_NOTE_TEXT = '检修与干预是披露事件记录：计划检修与实际干预分组展示，同一事件重复披露只计一次并标注版本；只有业务日的记录不推断精确起止时刻'
const MAINTENANCE_ROLE_TEXT = '检修干预取自公开披露事件库：当前账号角色没有披露读取权限，无法展示'
const MAINTENANCE_COMPARE_TEXT = '联看同期价格只携带事件窗口；事件同期变化不自动归因价格或收益损失，返回本页请用浏览器后退'
const MAINTENANCE_NO_WINDOW_TEXT = '该事件没有可用的业务日期或起止时间，无法联看同期价格'
const MAINTENANCE_RELATION_TEXT = '该事件没有已登记的场站对象关系：同名或近似名称不作为关联依据'
const MAINTENANCE_PLAN_TITLE = '计划检修（检修计划与电网检修信息，披露）'
const MAINTENANCE_ACTUAL_TITLE = '实际干预（人工干预与非计划停运，披露）'

const MAINTENANCE_PAGE_SIZE = 100

/** 单组事件列表状态：三态（有数/窗口内无数/未接入）+ 单块错误与手动重试。 */
type MaintenanceGroupState = {
  loading: boolean
  error: string | null
  errorCode: number | null
  availability: 'available' | 'missing' | 'not-configured' | null
  rows: GridDisclosureEvent[]
  total: number | null
  /** 完成时（成功或失败）的口径签名；同签名不自动重查，重试由用户触发。 */
  queriedKey: string
}

function blankMaintenanceGroup(): MaintenanceGroupState {
  return { loading: false, error: null, errorCode: null, availability: null, rows: [], total: null, queriedKey: '' }
}

const maintenancePlan = reactive(blankMaintenanceGroup())
const maintenanceActual = reactive(blankMaintenanceGroup())
const maintenanceCounts = reactive({
  loading: false,
  error: null as string | null,
  raw: null as number | null,
  distinct: null as number | null,
  unidentified: null as number | null,
  queriedKey: '',
})
const maintenanceRelation = reactive({
  eventId: null as string | null,
  loading: false,
  error: null as string | null,
  plants: null as GridObjectDetail['relations']['plants'] | null,
})
const selectedMaintenanceId = ref<string | null>(null)

function maintenanceKey(): string {
  return ['maintenance', ctx.contextVersion.value].join('|')
}

function resetMaintenanceStates(): void {
  Object.assign(maintenancePlan, blankMaintenanceGroup())
  Object.assign(maintenanceActual, blankMaintenanceGroup())
  Object.assign(maintenanceCounts, { loading: false, error: null, raw: null, distinct: null, unidentified: null, queriedKey: '' })
  Object.assign(maintenanceRelation, { eventId: null, loading: false, error: null, plants: null })
  selectedMaintenanceId.value = null
}

/** 时间列：ISO 文本格式化为北京时间，解析不了或缺失如实「未提供」。 */
function maintenanceTimeText(value: string | null | undefined): string {
  return value && parseDisclosureTime(value) !== null ? formatBeijingDateTime(value) : '未提供'
}

function maintenanceVersionText(event: GridDisclosureEvent): string {
  const identity = event.identity
  if (!identity || !(identity.versions > 1)) return '—'
  return `第 ${identity.version} 版 / 共 ${identity.versions} 版`
}

type MaintenanceRow = {
  key: string
  businessDate: string
  title: string
  reason: string
  start: string
  end: string
  basis: string
  version: string
  event: GridDisclosureEvent
}

function maintenanceRowsOf(state: MaintenanceGroupState): MaintenanceRow[] {
  return state.rows.map((event, index) => ({
    key: `${event.eventId}#${index}`,
    businessDate: event.businessDate ?? '未提供',
    title: event.title,
    reason: maintenanceListSummary(event) || '原因未提供',
    start: maintenanceTimeText(event.effectiveAt),
    end: maintenanceTimeText(event.expiresAt),
    basis: maintenanceTimeBasis(event),
    version: maintenanceVersionText(event),
    event,
  }))
}

const maintenancePlanRows = computed<MaintenanceRow[]>(() => maintenanceRowsOf(maintenancePlan))
const maintenanceActualRows = computed<MaintenanceRow[]>(() => maintenanceRowsOf(maintenanceActual))

/** 页首计数（GB04）：原始记录 vs 独立事件；身份不足保留未归并提示。 */
const maintenanceCountText = computed<string>(() => {
  if (maintenanceCounts.raw === null || maintenanceCounts.distinct === null) return ''
  const parts = [`窗口内原始记录 ${maintenanceCounts.raw} 条`, `独立事件 ${maintenanceCounts.distinct} 条`]
  if ((maintenanceCounts.unidentified ?? 0) > 0) parts.push(`${maintenanceCounts.unidentified} 条身份不足、保留未归并`)
  return parts.join('；')
})

/** 联看窗口：业务日为基准，精确区间换算成北京时间业务日；推不出窗口不给入口。 */
function maintenanceCompareWindow(event: GridDisclosureEvent): { start: string; end: string } | null {
  const beijingDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10)
  const precise = disclosureEventWindow(event)
  const start = event.businessDate ?? (precise ? beijingDay(precise.from) : null)
  if (!start) return null
  const endCandidate = precise?.to ? beijingDay(precise.to) : null
  const end = endCandidate && endCandidate >= start ? endCandidate : start
  return { start, end }
}

function ensureMaintenanceTab(): void {
  if (!canReadMaintenance.value) return
  void loadMaintenanceCounts()
  void loadMaintenanceGroup('plan')
  void loadMaintenanceGroup('actual')
}

async function loadMaintenanceCounts(): Promise<void> {
  const key = maintenanceKey()
  if (maintenanceCounts.queriedKey === key || maintenanceCounts.loading) return
  maintenanceCounts.loading = true
  maintenanceCounts.error = null
  try {
    const result = await fetchGridDisclosureOverview({
      category: 'maintenance,intervention,outage',
      identity: 'annotate',
      from: ctx.businessWindow.value.start,
      to: ctx.businessWindow.value.end,
    })
    if (maintenanceKey() !== key) return
    maintenanceCounts.raw = result.identity?.rawCount ?? null
    maintenanceCounts.distinct = result.identity?.distinctCount ?? null
    maintenanceCounts.unidentified = result.identity?.unidentifiedCount ?? null
    maintenanceCounts.queriedKey = key
  } catch (error) {
    if (maintenanceKey() !== key) return
    maintenanceCounts.error = error instanceof Error ? error.message : String(error)
    maintenanceCounts.queriedKey = key
  } finally {
    if (maintenanceKey() === key) maintenanceCounts.loading = false
  }
}

async function loadMaintenanceGroup(kind: 'plan' | 'actual'): Promise<void> {
  const target = kind === 'plan' ? maintenancePlan : maintenanceActual
  const key = maintenanceKey()
  if (target.queriedKey === key || target.loading) return
  target.loading = true
  target.error = null
  try {
    const result = await fetchGridDisclosureEvents({
      category: kind === 'plan' ? 'maintenance' : 'intervention,outage',
      identity: 'annotate',
      from: ctx.businessWindow.value.start,
      to: ctx.businessWindow.value.end,
      pageSize: MAINTENANCE_PAGE_SIZE,
    })
    if (maintenanceKey() !== key) return
    target.rows = result.items ?? []
    target.total = result.total ?? target.rows.length
    target.availability = result.dataAvailability?.status ?? (target.rows.length ? 'available' : 'missing')
    target.queriedKey = key
  } catch (error) {
    if (maintenanceKey() !== key) return
    target.error = error instanceof Error ? error.message : String(error)
    target.errorCode = error instanceof ApiError ? error.status : null
    target.queriedKey = key
  } finally {
    if (maintenanceKey() === key) target.loading = false
  }
}

function retryMaintenanceCounts(): void {
  maintenanceCounts.queriedKey = ''
  void loadMaintenanceCounts()
}

function retryMaintenanceGroup(kind: 'plan' | 'actual'): void {
  const target = kind === 'plan' ? maintenancePlan : maintenanceActual
  target.queriedKey = ''
  void loadMaintenanceGroup(kind)
}

const selectedMaintenanceEvent = computed<GridDisclosureEvent | null>(() => {
  if (!selectedMaintenanceId.value) return null
  return [...maintenancePlan.rows, ...maintenanceActual.rows].find((event) => event.eventId === selectedMaintenanceId.value) ?? null
})

const selectedMaintenanceWindow = computed(() => {
  const event = selectedMaintenanceEvent.value
  return event ? maintenanceCompareWindow(event) : null
})

function selectMaintenanceEvent(event: GridDisclosureEvent): void {
  selectedMaintenanceId.value = event.eventId
  void loadMaintenanceRelation(event)
}

/** 已关联场站只认对象接口的明确关系（relations.plants）；404/无关系是正常事实不是错误。 */
async function loadMaintenanceRelation(event: GridDisclosureEvent): Promise<void> {
  Object.assign(maintenanceRelation, { eventId: event.eventId, loading: true, error: null, plants: null })
  try {
    const detail = await fetchGridObject({ kind: 'disclosure', id: event.eventId, regionId: currentRegion.value.id })
    if (maintenanceRelation.eventId !== event.eventId) return
    maintenanceRelation.plants = detail.relations.plants
  } catch (error) {
    if (maintenanceRelation.eventId !== event.eventId) return
    if (error instanceof ApiError && (error.status === 404 || error.code === 404)) {
      maintenanceRelation.plants = []
    } else {
      maintenanceRelation.error = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (maintenanceRelation.eventId === event.eventId) maintenanceRelation.loading = false
  }
}

/** 同期联看（GB05、CH01）：只带窗口不带任何归因；价格页由 start/end query 恢复口径。 */
function openMaintenanceCompare(event: GridDisclosureEvent): void {
  const win = maintenanceCompareWindow(event)
  if (!win) return
  void router.push({ path: '/insight/prices', query: { start: win.start, end: win.end } })
}

// ── 证据抽屉与历史候选 ───────────────────────────────────────────────────────────────────

const evidenceVisible = ref(false)
const evidenceTarget = ref<InsightBlockResult | null>(null)

function openEvidence(name: QueryName): void {
  evidenceTarget.value = viewStates[name].result
  evidenceVisible.value = true
}

const candidatesVisible = ref(false)

function openCandidates(): void {
  candidatesVisible.value = true
}

function onCandidateSelect(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

/** 历史候选：公开背景曲线分析的三条公开来源求交集（获权来源不参与候选）。 */
const candidateSourceIds = computed<string[]>(() => [...(boundaryDef?.sourceIds ?? [])])

/** 历史候选的 filters：候选只按来源覆盖求交集，统一用 series 视图口径。 */
const candidatesFilters = computed<Record<string, unknown>>(() => ({ view: 'series' }))

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 只收「当前签名一致」的已就绪查询结果，过期区块不进上下文；只传摘要与版本引用
// （含通道/机组对象清单等筛选摘要），不传原始行数据。

const GRID_AI_BLOCKS: Record<QueryName, { title: string; analysisId: string; view: string }> = {
  'boundary-series': { title: '电网边界曲线', analysisId: BOUNDARY_SERIES_ANALYSIS, view: 'series' },
  'transfer-daily': { title: '送受电日统计', analysisId: TRANSFER_DAILY_ANALYSIS, view: 'series' },
  'channel-series': { title: '通道断面曲线', analysisId: CHANNEL_FLOWS_ANALYSIS, view: 'series' },
  'channel-limit-match': { title: '断面限值对比', analysisId: CHANNEL_FLOWS_ANALYSIS, view: 'limit-match' },
  'reserve-units': { title: '备用机组', analysisId: RESERVE_UNITS_ANALYSIS, view: 'series' },
  'unit-lists': { title: '必开必停机组清单', analysisId: UNIT_LISTS_ANALYSIS, view: 'records' },
}

const insightAi = useInsightAiPage({
  pageId: 'grid-boundaries',
  label: '云南电网边界',
  collect: () => {
    const blocks: InsightAiEvidenceBlock[] = []
    for (const name of Object.keys(viewStates) as QueryName[]) {
      const entry = viewStates[name]
      const aiBlock = insightAiBlockOf({
        blockId: name,
        title: GRID_AI_BLOCKS[name].title,
        analysisId: GRID_AI_BLOCKS[name].analysisId,
        view: GRID_AI_BLOCKS[name].view,
        currentKey: queryKeyOf(name),
        queriedKey: entry.queriedKey,
        result: entry.result,
        objects:
          name === 'channel-series' || name === 'channel-limit-match' ? [...channelObjects.value]
          : name === 'reserve-units' ? [...reserveObjects.value]
          : name === 'unit-lists' ? [...listObjects.value]
          : undefined,
      })
      if (aiBlock) blocks.push(aiBlock)
    }
    return blocks
  },
  currentSignature: () => String(ctx.contextVersion.value),
})

const onAiInterpret = (): void => {
  void insightAi.interpret()
}

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <div class="ygb">
    <!-- 顶部：日期窗 -->

    <InsightAnchorNotice
      v-if="entryAnchor.anchorNotice.value"
      :notice="entryAnchor.anchorNotice.value"
      @back-today="entryAnchor.backToToday"
      @dismiss="entryAnchor.dismissAnchorNotice"
    />
    <section class="ygb__controls">
      <label class="ygb__field">
        <span>分析日期</span>
        <InsightDateRange
          :model-value="ctx.businessWindow.value"
          :max-days="maxDays"
          @update:model-value="onWindowChange"
        />
      </label>
      <!-- AI 入口（15.3）：模型离线只隐藏入口，数据页不受影响（D9） -->
      <el-button
        v-if="insightAi.aiAvailable.value"
        type="primary"
        data-testid="ygb-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
    </section>

    <InsightNote label="送受电方向" :text="SIGN_TEXT" />

    <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="能力目录读取失败">
      <p class="ygb__hint">当前看不到可用的电网边界分析；可重试，不影响已就绪区块的展示。</p>
      <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
    </el-alert>

    <!-- 三页签：懒加载（首次激活渲染），签名不变时切回不重查 -->
    <el-tabs :model-value="activeTab" class="ygb__tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in GRID_TABS" :key="tab.view" :name="tab.view" :label="tab.label">
        <template v-if="visitedTabs.has(tab.view)">
          <!-- 送受电：公开背景曲线 + 获权逐日送电与通道能力 -->
          <template v-if="tab.view === 'transfer'">
            <InsightBlock
              title="跨省送受电（公开披露）"
              :result="viewStates['boundary-series'].result"
              :error="viewStates['boundary-series'].error"
              :loading="viewStates['boundary-series'].loading"
              :on-retry="() => retryQuery('boundary-series')"
              :on-refresh="() => retryQuery('boundary-series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('boundary-series')"
            >
              <el-alert type="info" :closable="false" :title="SIGN_TEXT" />
              <InsightSeriesChart
                :result="viewStates['boundary-series'].result"
                :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                :height="300"
                @select="() => {}"
              />
            </InsightBlock>

            <el-alert v-if="!hasTransferDaily" type="info" :closable="false" :title="ENTITLEMENT_TRANSFER_TEXT" />

            <InsightBlock
              v-if="hasTransferDaily"
              title="逐日送电电量与通道能力（获权）"
              :result="viewStates['transfer-daily'].result"
              :error="viewStates['transfer-daily'].error"
              :loading="viewStates['transfer-daily'].loading"
              :on-retry="() => retryQuery('transfer-daily')"
              :on-refresh="() => retryQuery('transfer-daily')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('transfer-daily')"
            >
              <InsightNote label="电量与容量口径" :text="DAILY_NOTE" />
              <el-alert type="info" :closable="false" :title="SIGN_TEXT" />
              <InsightSeriesChart
                :result="viewStates['transfer-daily'].result"
                :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                :height="300"
                @select="() => {}"
              />
              <InsightResultTable
                :result="viewStates['transfer-daily'].result"
                :selection="null"
                :source-titles="sourceTitles"
                @row-click="() => {}"
              />
            </InsightBlock>
          </template>

          <!-- 通道断面：对象清单来自覆盖接口；series 曲线 + limit-match 配对表 -->
          <template v-else-if="tab.view === 'channel'">
            <el-alert v-if="!hasChannelFlows" type="info" :closable="false" :title="ENTITLEMENT_CHANNEL_TEXT" />

            <InsightBlock
              v-if="hasChannelFlows"
              title="通道潮流（获权）"
              :result="viewStates['channel-series'].result"
              :error="viewStates['channel-series'].error"
              :loading="viewStates['channel-series'].loading"
              :on-retry="() => retryQuery('channel-series')"
              :on-refresh="() => retryQuery('channel-series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('channel-series')"
            >
              <div class="ygb__bar">
                <label class="ygb__field">
                  <span>通道与断面（多选，最多 30 个）</span>
                  <InsightObjectPicker
                    :model-value="channelObjects"
                    :options="optionsOf(CHANNEL_FLOWS_ANALYSIS)"
                    :max-objects="channelDef?.limits.maxObjects ?? 30"
                    :disabled="objectsPhase(CHANNEL_FLOWS_ANALYSIS) !== 'ready'"
                    data-testid="ygb-channel-objects"
                    @update:model-value="onChannelObjectsChange"
                  />
                </label>
                <el-button
                  v-if="channelSpatialVisible"
                  data-testid="ygb-channel-spatial"
                  @click="onChannelToSpatialView"
                >
                  在空间视图查看
                </el-button>
              </div>
              <el-alert v-if="channelWindowTooLarge" type="warning" :closable="false" :title="CHANNEL_WINDOW_TEXT" />
              <template v-else-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ygb__hint">列不出通道清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(CHANNEL_FLOWS_ANALYSIS)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
                data-testid="ygb-objects-unavailable"
              />
              <el-alert v-else-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <p v-if="objectStates[CHANNEL_FLOWS_ANALYSIS].note" class="ygb__hint">{{ objectStates[CHANNEL_FLOWS_ANALYSIS].note }}</p>
              <el-empty v-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'ready' && !channelObjects.length" :description="PICK_CHANNEL_TEXT" :image-size="72" />
              <template v-else-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'ready' && channelObjects.length">
                <el-alert type="info" :closable="false" :title="SIGN_TEXT" />
                <InsightSeriesChart
                  :result="viewStates['channel-series'].result"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="300"
                  @select="() => {}"
                />
              </template>
            </InsightBlock>

            <InsightBlock
              v-if="hasChannelFlows"
              title="限值配对与裕度（获权）"
              :result="viewStates['channel-limit-match'].result"
              :error="viewStates['channel-limit-match'].error"
              :loading="viewStates['channel-limit-match'].loading"
              :on-retry="() => retryQuery('channel-limit-match')"
              :on-refresh="() => retryQuery('channel-limit-match')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('channel-limit-match')"
            >
              <InsightNote label="限值配对口径" :text="LIMIT_PAIR_TEXT" />
              <InsightNote label="披露限值对比" :text="LIMIT_NOT_ATC_TEXT" />
              <template v-if="objectsPhase(CHANNEL_FLOWS_ANALYSIS) === 'ready' && channelObjects.length && !channelWindowTooLarge">
                <el-table
                  v-if="limitRows.length"
                  :data="limitRows"
                  size="small"
                  border
                  max-height="420"
                  data-testid="ygb-limit-table"
                >
                  <el-table-column prop="start" label="时段起" width="130" />
                  <el-table-column prop="end" label="时段止" width="130" />
                  <el-table-column prop="channel" label="通道" min-width="160" show-overflow-tooltip />
                  <el-table-column prop="flow" label="实际（MW）" width="110" align="right" />
                  <el-table-column prop="upper" label="正向限值（MW）" width="130" align="right" />
                  <el-table-column prop="lower" label="反向限值（MW）" width="130" align="right" />
                  <el-table-column prop="margin" label="裕度（MW，负为超出）" width="160" align="right" />
                  <el-table-column prop="bindingSide" label="约束侧" width="90" />
                  <el-table-column prop="loadRate" label="负载率（%）" width="110" align="right" />
                </el-table>
                <p v-else-if="!viewStates['channel-limit-match'].loading" class="ygb__hint">没有配对上的时段：见下方逐条原因。</p>
                <div v-if="limitSummaryCards.length" class="ygb__cards">
                  <div v-for="card in limitSummaryCards" :key="card.key" class="ygb__card">
                    <h4 class="ygb__card-title">{{ card.channel }} · 限值对比统计</h4>
                    <dl class="ygb__card-grid">
                      <template v-for="row in card.rows" :key="row.metricId">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                      </template>
                    </dl>
                  </div>
                </div>
              </template>
              <p v-else class="ygb__hint">{{ LIMIT_MATCH_FOLLOW_TEXT }}</p>
              <el-alert
                v-for="(item, index) in limitUnpaired"
                :key="`lu-${index}`"
                type="warning"
                :closable="false"
                :title="`未配对：${item}`"
              />
              <el-alert v-for="(note, index) in limitNotes" :key="`ln-${index}`" type="info" :closable="false" :title="note" />
            </InsightBlock>
          </template>

          <!-- 检修干预（#3092，GB04—GB06、CH01）：披露事件两组分列 + 版本/计数 + 联看窗口 + 明确对象关系 -->
          <template v-else-if="tab.view === 'maintenance'">
            <el-alert v-if="!canReadMaintenance" type="info" :closable="false" :title="MAINTENANCE_ROLE_TEXT" data-testid="ygb-maintenance-gated" />
            <template v-else>
              <InsightNote label="事件统计口径" :text="MAINTENANCE_NOTE_TEXT" />
              <p v-if="maintenanceCountText" class="ygb__hint" data-testid="ygb-maintenance-counts">{{ maintenanceCountText }}</p>
              <el-alert v-else-if="maintenanceCounts.error" type="error" show-icon :closable="false" title="披露计数读取失败">
                <p class="ygb__hint">独立事件与原始记录计数不可用；其余区块不受影响。</p>
                <el-button size="small" @click="retryMaintenanceCounts">重试</el-button>
              </el-alert>

              <div class="ygb__cards">
                <section
                  v-for="group in ([
                    ['plan', MAINTENANCE_PLAN_TITLE, maintenancePlan, maintenancePlanRows],
                    ['actual', MAINTENANCE_ACTUAL_TITLE, maintenanceActual, maintenanceActualRows],
                  ] as const)"
                  :key="group[0]"
                  class="ygb__card"
                  :data-testid="`ygb-maintenance-${group[0]}`"
                >
                  <h4 class="ygb__card-title">{{ group[1] }}</h4>
                  <el-alert v-if="group[2].error" type="error" show-icon :closable="false" title="披露事件读取失败">
                    <p class="ygb__hint">{{ group[2].error }}</p>
                    <el-button size="small" @click="retryMaintenanceGroup(group[0])">重试</el-button>
                  </el-alert>
                  <el-alert v-else-if="group[2].availability === 'not-configured'" type="info" :closable="false" title="公开披露事件库未接入当前地区数据源：无法展示该组披露" />
                  <el-alert v-else-if="group[2].availability === 'missing'" type="info" :closable="false" title="所选窗口内没有已导入的该组披露记录：可调整日期窗" />
                  <p v-else-if="group[2].loading" class="ygb__hint">正在读取披露事件…</p>
                  <template v-else-if="group[3].length">
                    <el-table
                      :data="group[3]"
                      size="small"
                      border
                      max-height="360"
                      :row-class-name="({ row }: { row: MaintenanceRow }) => (row.event.eventId === selectedMaintenanceId ? 'ygb__row-selected' : '')"
                      @row-click="(row: MaintenanceRow) => selectMaintenanceEvent(row.event)"
                    >
                      <el-table-column prop="businessDate" label="业务日" width="100" />
                      <el-table-column prop="title" label="事件" min-width="170" show-overflow-tooltip />
                      <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
                      <el-table-column prop="start" label="起" width="120" />
                      <el-table-column prop="end" label="止" width="120" />
                      <el-table-column prop="basis" label="时间口径" width="110" />
                      <el-table-column prop="version" label="披露版本" width="130" />
                      <el-table-column label="操作" width="90">
                        <template #default="{ row }">
                          <el-button size="small" link data-testid="ygb-maintenance-detail-open" @click.stop="selectMaintenanceEvent(row.event)">详情</el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                    <p v-if="group[2].total !== null && group[2].total > group[3].length" class="ygb__hint">
                      已显示前 {{ group[3].length }} 条（共 {{ group[2].total }} 条）：缩小窗口或加筛选可查看更多
                    </p>
                  </template>
                  <p v-else class="ygb__hint">所选窗口内没有该组披露记录。</p>
                </section>
              </div>

              <div v-if="selectedMaintenanceEvent" class="ygb__card" data-testid="ygb-maintenance-detail">
                <h4 class="ygb__card-title">{{ selectedMaintenanceEvent.title }}</h4>
                <p class="ygb__hint">{{ selectedMaintenanceEvent.summary || '原因未提供' }}</p>
                <p class="ygb__hint">
                  时间口径：{{ maintenanceTimeBasis(selectedMaintenanceEvent) }}；披露版本：{{ maintenanceVersionText(selectedMaintenanceEvent) }}
                </p>
                <div class="ygb__bar">
                  <el-button
                    v-if="selectedMaintenanceWindow"
                    size="small"
                    type="primary"
                    data-testid="ygb-maintenance-compare"
                    @click="openMaintenanceCompare(selectedMaintenanceEvent)"
                  >
                    联看同期价格（{{ selectedMaintenanceWindow.start }} 至 {{ selectedMaintenanceWindow.end }}）
                  </el-button>
                  <span v-else class="ygb__hint">{{ MAINTENANCE_NO_WINDOW_TEXT }}</span>
                </div>
                <InsightNote label="同期联看口径" :text="MAINTENANCE_COMPARE_TEXT" />
                <p v-if="maintenanceRelation.loading" class="ygb__hint">正在读取对象关系…</p>
                <p v-else-if="maintenanceRelation.error" class="ygb__hint">对象关系读取失败：{{ maintenanceRelation.error }}</p>
                <p
                  v-else-if="maintenanceRelation.plants && maintenanceRelation.plants.length"
                  class="ygb__hint"
                  data-testid="ygb-maintenance-plants"
                >
                  已关联场站（仅明确关系）：{{ maintenanceRelation.plants.map((plant) => plant.name).join('、') }}
                </p>
                <p v-else-if="maintenanceRelation.plants" class="ygb__hint" data-testid="ygb-maintenance-no-plants">
                  {{ MAINTENANCE_RELATION_TEXT }}
                </p>
              </div>
            </template>
          </template>

          <!-- 备用机组：备用容量序列 + 是否/清单记录表 -->
          <template v-else>
            <el-alert v-if="!hasReserveUnits && !hasUnitLists" type="info" :closable="false" :title="ENTITLEMENT_RESERVE_TEXT" />

            <InsightBlock
              v-if="hasReserveUnits"
              title="备用与检修容量（获权）"
              :result="viewStates['reserve-units'].result"
              :error="viewStates['reserve-units'].error"
              :loading="viewStates['reserve-units'].loading"
              :on-retry="() => retryQuery('reserve-units')"
              :on-refresh="() => retryQuery('reserve-units')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('reserve-units')"
            >
              <div class="ygb__bar">
                <label class="ygb__field">
                  <span>区域与机组群对象（多选，最多 50 个）</span>
                  <InsightObjectPicker
                    :model-value="reserveObjects"
                    :options="optionsOf(RESERVE_UNITS_ANALYSIS)"
                    :max-objects="reserveDef?.limits.maxObjects ?? 50"
                    :disabled="objectsPhase(RESERVE_UNITS_ANALYSIS) !== 'ready'"
                    data-testid="ygb-reserve-objects"
                    @update:model-value="onReserveObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(RESERVE_UNITS_ANALYSIS) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ygb__hint">列不出对象清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(RESERVE_UNITS_ANALYSIS)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(RESERVE_UNITS_ANALYSIS) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
              />
              <el-alert v-else-if="objectsPhase(RESERVE_UNITS_ANALYSIS) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <el-empty v-else-if="!reserveObjects.length" :description="PICK_RESERVE_TEXT" :image-size="72" />
              <template v-else>
                <InsightSeriesChart
                  :result="viewStates['reserve-units'].result"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="300"
                  @select="() => {}"
                />
                <InsightResultTable
                  :result="viewStates['reserve-units'].result"
                  :selection="null"
                  :source-titles="sourceTitles"
                  @row-click="() => {}"
                />
              </template>
            </InsightBlock>

            <InsightBlock
              v-if="hasUnitLists"
              title="是否开展调峰与必开必停清单（获权）"
              :result="viewStates['unit-lists'].result"
              :error="viewStates['unit-lists'].error"
              :loading="viewStates['unit-lists'].loading"
              :on-retry="() => retryQuery('unit-lists')"
              :on-refresh="() => retryQuery('unit-lists')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('unit-lists')"
            >
              <InsightNote label="机组清单口径" :text="RECORDS_NOTE" />
              <div class="ygb__bar">
                <label class="ygb__field">
                  <span>区域与电厂对象（多选，最多 50 个）</span>
                  <InsightObjectPicker
                    :model-value="listObjects"
                    :options="optionsOf(UNIT_LISTS_ANALYSIS)"
                    :max-objects="unitListsDef?.limits.maxObjects ?? 50"
                    :disabled="objectsPhase(UNIT_LISTS_ANALYSIS) !== 'ready'"
                    data-testid="ygb-list-objects"
                    @update:model-value="onListObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(UNIT_LISTS_ANALYSIS) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ygb__hint">列不出对象清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(UNIT_LISTS_ANALYSIS)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(UNIT_LISTS_ANALYSIS) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
              />
              <el-alert v-else-if="objectsPhase(UNIT_LISTS_ANALYSIS) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <el-empty v-else-if="!listObjects.length" :description="PICK_LIST_TEXT" :image-size="72" />
              <el-table
                v-else-if="unitListRows.length"
                :data="unitListRows"
                size="small"
                border
                max-height="420"
                data-testid="ygb-records-table"
              >
                <el-table-column prop="date" label="业务日" width="110" />
                <el-table-column prop="source" label="清单" min-width="200" show-overflow-tooltip />
                <el-table-column
                  v-for="key in unitListColumns"
                  :key="key"
                  :prop="`cells.${key}`"
                  :label="dimensionText(key)"
                  min-width="110"
                  show-overflow-tooltip
                />
                <el-table-column prop="value" label="内容" min-width="140" show-overflow-tooltip />
              </el-table>
              <p v-else-if="!viewStates['unit-lists'].loading" class="ygb__hint">所选窗口与对象没有清单记录。</p>
            </InsightBlock>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 证据抽屉与历史候选 -->
    <InsightEvidenceDrawer v-model="evidenceVisible" :result="evidenceTarget" :source-titles="sourceTitles" />

    <InsightHistoryCandidates
      v-model="candidatesVisible"
      :analysis-id="BOUNDARY_SERIES_ANALYSIS"
      :context="ctx.toQueryContext()"
      :filters="candidatesFilters"
      :required-source-ids="candidateSourceIds"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />
  </div>
</template>

<style scoped>
.ygb {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ygb__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.ygb__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ygb__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.ygb__field :deep(.el-select),
.ygb__field :deep(.el-date-editor) {
  width: 220px;
}

.ygb__meta {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
}

.ygb__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}

.ygb__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin: 8px 0;
}

.ygb__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.ygb__card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.ygb__card-title {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.ygb__card-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}

.ygb__card-grid dt {
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

.ygb__card-grid dd {
  margin: 0;
  font-size: var(--font-sm, 13px);
  font-variant-numeric: tabular-nums;
  color: var(--text, #1f2a37);
  text-align: right;
}
</style>
