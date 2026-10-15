<script setup lang="ts">
// 云南价格与价差页（dljy#3007，OpenSpec build-yunnan-regional-market-insight 任务 6.5/6.6 第一部分）
// ----------------------------------------------------------------------------
// /insight/prices 的云南实现：四个页签（时段走势 / 日前实时价差 / 历史分布 / 节点基差），
// 每个页签是同一价格分析（prices.<对象>-series）的一种视图（filters.view）。
// 口径要点（specs yunnan-price-analysis，本页只呈现、不计算）：
//   - 价格对象来自能力目录：用户能看到哪些对象（用户侧 / 公开节点 / 获权厂侧节点 /
//     场站关联节点）由 capabilities 按公司授权决定；切换是用户显式操作，失败不自动回落；
//   - 视图与明细共用同一份读取（readSetRef），证据抽屉据此说明「不是另读一次数据」；
//   - 价差固定「日前 − 实时」，是价格差不是收益；基差必须显式选参考对象；
//   - 负价电量占比没有同对象电量支撑，按后端 unavailableMetrics 原文如实标注不可用；
//   - 历史分布只描述所选窗口，不冒充多年季节规律。
//   - 业务模块只读深链（dljy#3096，任务 15.5）：区块空态「前往资料维护」——显隐经
//    governance 既有口径判定，跳转只带期间/from 标记，不在洞察手填真实值；返回后重查。
// 未选对象 / 未选参考的前置拦截在页面层完成（不发请求），后端校验是第二道防线。

import InsightNote from '@/components/insight/InsightNote.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { isEditionRouteAvailable } from '@/services/region/regionModules'
import { useRouter } from 'vue-router'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { getInsightSource } from 'shared/insight/sources.mjs'
import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'
import {
  fetchInsightCapabilities,
  queryInsight,
  type InsightBlockResult,
  type InsightCapabilities,
  type InsightRequestError,
  type InsightSeriesMeta,
} from '@/services/insight/insightClient'
import { searchSpotNodes } from '@/services/market/spotClient'
import { fetchCgnYunnanPriceBundle } from '@/services/market/cgnYunnanLivePrice'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { useInsightContext } from '@/composables/useInsightContext'
import { useInsightEntryAnchor } from '@/composables/useInsightEntryAnchor'
import { insightAiBlockOf, useInsightAiPage, type InsightAiEvidenceBlock } from '@/features/regions/yunnan/insight/useInsightAiPage'
import { useInsightSelection } from '@/components/insight/chart/useInsightSelection'
import { canFollowDeepLink, DEEP_LINK_TARGETS, openDataMaintenanceLink } from '../businessLinks'
import { buildResearchHandoffQuery } from '../researchHandoff'
import {
  SPATIAL_LINK_TARGETS,
  objectSpatialLinkQuery,
  openSpatialViewLink,
  resolveSpatialObjectId,
  spatialEntryVisible,
} from '../spatialLinks'
import { fetchGridObject } from '@/features/gridGeo/client'
import { ElMessage } from 'element-plus'
import Price3DWorkspace from './prices/Price3DWorkspace.vue'
import { readPriceMode, writePriceMode, type PriceDisplayMode } from './prices/priceModeStorage'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightAnchorNotice from '@/components/insight/InsightAnchorNotice.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightMaterialDialog from '@/components/insight/InsightMaterialDialog.vue'
import InsightObjectPicker, { type InsightObjectOption } from '@/components/insight/InsightObjectPicker.vue'
import InsightResultTable from '@/components/insight/InsightResultTable.vue'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import {
  PRICE_OBJECT_TEXT,
  formatBeijingDateTime,
  insightSeriesName,
  type InsightSourceTitle,
} from '@/components/insight/insightText'

// ── 价格对象目录（固定顺序；可用性由能力目录决定）────────────────────────────────────────

type PriceObjectEntry = {
  analysisId: string
  priceObject: string
  /** 原生粒度（分钟）：用户侧价与场站关联价 60，节点价 15 */
  nativeMinutes: number
  /** 业务范围说明（顶部展示，不泄露来源标识） */
  scopeText: string
}

const PRICE_OBJECT_CATALOG: PriceObjectEntry[] = [
  {
    analysisId: 'prices.user-series',
    priceObject: 'user-price',
    nativeMinutes: 60,
    scopeText: '公开 · 云南全市场用户侧价格，无节点维度',
  },
  {
    analysisId: 'prices.public-node-series',
    priceObject: 'public-node',
    nativeMinutes: 15,
    scopeText: '公开 · 全网历史节点价格',
  },
  {
    analysisId: 'prices.company-node-series',
    priceObject: 'company-node',
    nativeMinutes: 15,
    scopeText: '获权 · 中广核云南厂侧节点价格',
  },
  {
    analysisId: 'prices.plant-node-series',
    priceObject: 'plant-node',
    nativeMinutes: 60,
    scopeText: '获权 · 场站关联节点价格（小时，绑定关系取当前快照）',
  },
]

const PRICE_TABS = [
  { view: 'series', label: '时段走势' },
  { view: 'spread', label: '日前实时价差' },
  { view: 'profile', label: '历史分布' },
  { view: 'basis', label: '节点基差' },
] as const

type PriceView = (typeof PRICE_TABS)[number]['view']

// 视图固定说明（口径来自 specs，改文案要同步 docs/market-insight-prices.md）
const SPREAD_DIRECTION_TEXT = '价差 = 日前 − 实时，正值表示日前高于实时；这是价格差，不是收益'
const BASIS_DIRECTION_TEXT = '基差 = 所选对象价格 − 参考对象价格，只在共同有效时段计算；参考对象由你显式指定'
const USER_PRICE_NO_BASIS_TEXT = '用户侧价格没有节点维度，不提供节点基差'
const BASIS_PICK_REFERENCE_TEXT = '请先选择参考节点或参考场站；未选参考不发请求'
const PROFILE_SAMPLE_TEXT = '只统计所选窗口内真实存在的时段；样本只有一年或更短时，不代表多年季节规律。暂不支持按季节、工作日筛选'

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)
// 入口锚定（dljy#3134）：能力目录就绪且存在获权分析才扫描——公共账号零请求红线保持。
const anchorReady = computed(() => (capabilities.value?.analyses?.some((entry) => entry.access === 'company') ?? false))
const entryAnchor = useInsightEntryAnchor(ctx, { ready: anchorReady })

/** 能力目录里可用（全部来源可访问）的价格对象，按目录固定顺序排列。 */
const availableObjects = computed(() =>
  PRICE_OBJECT_CATALOG.filter((entry) =>
    capabilities.value?.analyses.some((analysis) => analysis.analysisId === entry.analysisId)
  )
)

/** 当前选中的价格对象；默认取第一个可用，之后只随用户显式切换变化（不自动回落）。 */
const priceObjectChoice = ref('')

const currentEntry = computed(() =>
  PRICE_OBJECT_CATALOG.find((entry) => entry.analysisId === priceObjectChoice.value) ?? null
)

/** 契约镜像里的分析登记（views / limits），不依赖后端 capabilities 是否下发这些字段。 */
const analysisDef = computed(() => (priceObjectChoice.value ? getInsightAnalysis(priceObjectChoice.value) : null))
const requiresObjects = computed(() => Boolean(analysisDef.value?.limits.requiresObjects))
const maxObjects = computed(() => analysisDef.value?.limits.maxObjects ?? 0)
const maxDays = computed(() => analysisDef.value?.limits.maxDays ?? 366)
const supportsBasis = computed(() => Boolean(analysisDef.value?.views.includes('basis')))

/** 当前价格对象下的日前来源（价差/基差合成序列借它承载精度与对象维度，只用于展示身份）。 */
function dayAheadSourceIdOf(): string {
  const entry = currentEntry.value
  const analysis = analysisDef.value
  if (!entry || !analysis) return ''
  for (const sourceId of analysis.sourceIds) {
    const source = getInsightSource(sourceId)
    if (source?.priceObject === entry.priceObject && source?.marketPhase === 'day-ahead') return sourceId
  }
  return ''
}

/** 当前价格对象的对象维度（用户侧价无节点维度：立体/热力不需要选对象，直接画）。 */
const objectDimension = computed(() => {
  const sourceId = dayAheadSourceIdOf()
  return sourceId ? (getInsightSource(sourceId)?.objectDimension ?? null) : null
})

/**
 * 历史候选的 requiredSourceIds：当前价格对象的日前 + 实时两个价格来源
 * （场站关联价分析里的第三来源是场站清单，不是价格读取，不参与求交集）。
 */
const candidateSourceIds = computed(() => {
  const entry = currentEntry.value
  const analysis = analysisDef.value
  if (!entry || !analysis) return []
  return analysis.sourceIds.filter((sourceId) => {
    const source = getInsightSource(sourceId)
    return (
      source?.priceObject === entry.priceObject &&
      (source?.marketPhase === 'day-ahead' || source?.marketPhase === 'real-time')
    )
  })
})

/** 能力目录来源 → 业务标题目录（区块标签、证据抽屉、表格导出共用）。 */
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
    if (!result) {
      // 在途请求被业务代次作废（业务窗/公司/对象/来源切换）：能力目录不随这些业务维度变化，
      // 静默 return 会让「目录与错误均为 null」永久拦截查询。重拉一次恢复（dljy#3065）。
      void loadCapabilities()
      return
    }
    capabilities.value = result
    // 初始默认：第一个可用对象。此后选择只随用户显式操作变化（能力目录变化也不改选）。
    if (!priceObjectChoice.value) {
      priceObjectChoice.value = availableObjects.value[0]?.analysisId ?? ''
    }
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
}

// ── 页签状态（懒加载：首次激活才查询；签名不变时切回不重查）──────────────────────────────

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

const viewStates = reactive<Record<PriceView, ViewState>>({
  series: blankState(),
  spread: blankState(),
  profile: blankState(),
  basis: blankState(),
})
/** 时段走势页签的统计摘要（summary 视图，与 series 同一读取版本集合）。 */
const summaryState = reactive<ViewState>(blankState())

const activeTab = ref<PriceView>('series')
const visitedTabs = reactive(new Set<PriceView>(['series']))

/** 基差参考对象（只能从已选对象里选）。 */
const basisReference = ref('')
const basisOptions = computed<InsightObjectOption[]>(() =>
  ctx.objectIds.value.map((id) => ({ id, label: id }))
)
// 参考对象被移出已选集合时清空：留着会发出必然 422 的请求。
watch(basisOptions, () => {
  if (basisReference.value && !ctx.objectIds.value.includes(basisReference.value)) basisReference.value = ''
})

/** 查询签名：价格对象 + 上下文代次（窗口/对象/来源/地区/公司都在代次里）+ 基差参考。 */
function queryKey(view: PriceView): string {
  return [priceObjectChoice.value, ctx.contextVersion.value, view === 'basis' ? basisReference.value : ''].join('|')
}

/** 页面级总签名：任一部分变化即所有旧结果口径过期。 */
const globalSignature = computed(() => `${priceObjectChoice.value}|${ctx.contextVersion.value}|${basisReference.value}`)

watch(globalSignature, () => {
  // 口径变了：旧结果属于另一份读取，全部作废（不保留旧图冒充当前口径）。
  for (const tab of PRICE_TABS) Object.assign(viewStates[tab.view], blankState())
  Object.assign(summaryState, blankState())
  clearSpreadSelection()
  if (visitedTabs.has(activeTab.value)) ensureTab(activeTab.value)
  ensureSeriesModeQueries()
})

/** 切换价格对象：用户显式操作。清对象（对象属于原价格对象）、清参考、作废在途请求。 */
function onPriceObjectChange(analysisId: string): void {
  if (analysisId === priceObjectChoice.value) return
  basisReference.value = ''
  objectOptions.value = []
  if (ctx.objectIds.value.length) ctx.setObjectIds([])
  else ctx.request.invalidate() // 价格对象不在上下文签名里，显式作废在途请求
  priceObjectChoice.value = analysisId
}

function onTabChange(name: string | number): void {
  activeTab.value = name as PriceView
  visitedTabs.add(activeTab.value)
  ensureTab(activeTab.value)
  ensureSeriesModeQueries()
}

// ── 时段走势页签的展示模式（单日走势 / 多日立体 / 日期×时段热力）────────────────────────
// 模式按 用户+地区+价格对象 记 localStorage（try/catch，storage 异常不影响页面）；
// 三维/热力/双切面/证据表与「历史分布」页签共用同一份 profile 结果（不另发请求）。

const seriesMode = ref<PriceDisplayMode>('single')

/** storage 抛错（隐私模式/被禁用）时仍可用的用户名读取：读不到按匿名处理，不影响页面。 */
function currentUsername(): string {
  try {
    return getCurrentUser().username
  } catch {
    return 'anonymous'
  }
}

/** 按当前键恢复记忆的模式；只赋值不回写（恢复不是用户动作，不产生记忆）。 */
function restoreSeriesMode(): void {
  if (!priceObjectChoice.value) return
  const remembered = readPriceMode(currentUsername(), ctx.regionId.value, priceObjectChoice.value)
  if (seriesMode.value !== remembered) seriesMode.value = remembered
}

// 用户/地区/价格对象任一变化 → 换键恢复（旧键的记忆不跨对象串扰）。
watch([currentUsername, () => ctx.regionId.value, priceObjectChoice], () => {
  restoreSeriesMode()
})

/** 用户显式切换模式（分段控件或三维降级建议）：记忆 + 非 single 时确保 profile 查询。 */
function onModeChange(mode: PriceDisplayMode): void {
  if (seriesMode.value !== mode) seriesMode.value = mode
  if (priceObjectChoice.value) {
    writePriceMode(currentUsername(), ctx.regionId.value, priceObjectChoice.value, mode)
  }
  ensureSeriesModeQueries()
}

/** 非单日模式的数据面是 profile 视图（与「历史分布」页签同签名不重查）。 */
function ensureSeriesModeQueries(): void {
  if (activeTab.value === 'series' && seriesMode.value !== 'single') ensureTab('profile')
}

/** 单日窗口点了「改为 7 天」：用户显式扩窗（多日展示不悄悄扩窗）。 */
function onExtendWindow(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

/** 三维超限/降级时用户改看热力：与分段切换同一条路径（记忆 + 确保查询）。 */
function onSwitchMode(mode: 'heatmap'): void {
  onModeChange(mode)
}

function onWindowChange(next: { start: string; end: string }): void {
  ctx.setBusinessWindow(next.start, next.end)
}

function onObjectChange(ids: string[]): void {
  ctx.setObjectIds(ids)
}

/** 前置拦截 + 过期判定后发查询；同签名已有结果（或查询中）不重发。 */
function ensureTab(view: PriceView): void {
  if (!priceObjectChoice.value || capabilitiesError.value) return
  if (view === 'basis' && !supportsBasis.value) return // 用户侧价：模板显示固定说明，不查询
  if (requiresObjects.value && !ctx.objectIds.value.length) return // 未选对象：不发请求
  if (view === 'basis' && !basisReference.value) return // 未选参考：不发请求
  const key = queryKey(view)
  const entry = viewStates[view]
  if (entry.queriedKey === key) return // 有结果或已按此键失败过：不自动重查（重试由用户触发）
  void runView(view)
  if (view === 'series') {
    const summaryKey = queryKey('series')
    if (summaryState.queriedKey !== summaryKey) void runSummary(summaryKey)
  }
}

async function runView(view: PriceView): Promise<void> {
  const analysisId = priceObjectChoice.value
  const key = queryKey(view)
  const entry = viewStates[view]
  entry.loading = true
  entry.error = null
  const filters: Record<string, unknown> = { view }
  if (requiresObjects.value) filters.objectIds = [...ctx.objectIds.value]
  if (view === 'basis') filters.referenceObjectId = basisReference.value
  try {
    const result = await ctx.request.run((signal) =>
      queryInsight({ analysisId, context: ctx.toQueryContext(), filters }, { signal })
    )
    if (!result || queryKey(view) !== key) return // 作废/迟到：不写状态
    entry.result = result
    entry.queriedKey = key
  } catch (error) {
    if (queryKey(view) !== key) return
    entry.error = error as InsightRequestError
    entry.queriedKey = key // 失败也记键：同样条件下不自动反复重试
  } finally {
    if (queryKey(view) === key) entry.loading = false
  }
}

async function runSummary(key: string): Promise<void> {
  const analysisId = priceObjectChoice.value
  summaryState.loading = true
  summaryState.error = null
  const filters: Record<string, unknown> = { view: 'summary' }
  if (requiresObjects.value) filters.objectIds = [...ctx.objectIds.value]
  try {
    const result = await ctx.request.run((signal) =>
      queryInsight({ analysisId, context: ctx.toQueryContext(), filters }, { signal })
    )
    if (!result || queryKey('series') !== key) return
    summaryState.result = result
    summaryState.queriedKey = key
  } catch (error) {
    if (queryKey('series') !== key) return
    summaryState.error = error as InsightRequestError
    summaryState.queriedKey = key
  } finally {
    if (queryKey('series') === key) summaryState.loading = false
  }
}

/** 手动重试 / 刷新（错误区块按钮）：清键重发。 */
function retryView(view: PriceView): void {
  viewStates[view].queriedKey = ''
  if (view === 'series') summaryState.queriedKey = ''
  ensureTab(view)
}

// ── 对象选项（节点检索 / 场站快照）──────────────────────────────────────────────────────

const objectOptions = ref<InsightObjectOption[]>([])
const objectLoading = ref(false)

/** 节点类对象：remote 检索。公开节点强制公共端点（口径是公共维表）；厂侧节点按账号自动路由。 */
// 边输入边检索：只认最后一次输入的结果，先发后到的旧检索不覆盖新选项。
let objectSearchSeq = 0
async function searchObjects(query: string): Promise<void> {
  const priceObject = currentEntry.value?.priceObject
  if (priceObject !== 'public-node' && priceObject !== 'company-node') return
  const seq = ++objectSearchSeq
  objectLoading.value = true
  try {
    const data = await searchSpotNodes(query, '云南', 50, { publicOnly: priceObject === 'public-node' })
    if (seq !== objectSearchSeq) return
    objectOptions.value = (data.nodes ?? []).map((name) => ({ id: name, label: name }))
  } catch {
    if (seq === objectSearchSeq) objectOptions.value = [] // 检索失败如实空选项，不打断页面其它部分
  } finally {
    if (seq === objectSearchSeq) objectLoading.value = false
  }
}

// 场站关联价对象：场站清单来自当日价格快照（plants 的标准厂名）。
// 连续改日期或切对象时只认最后一次请求，迟到的旧日期清单不覆盖新的。
let plantOptionsSeq = 0
watch(
  [priceObjectChoice, () => ctx.businessWindow.value.start],
  async () => {
    const seq = ++plantOptionsSeq
    if (currentEntry.value?.priceObject !== 'plant-node') return
    objectLoading.value = true
    try {
      const bundle = await fetchCgnYunnanPriceBundle(ctx.businessWindow.value.start)
      if (seq !== plantOptionsSeq) return
      const names = [...new Set((bundle.plants?.items ?? []).map((item) => item.plantName))]
      objectOptions.value = names.map((name) => ({ id: name, label: name }))
    } catch {
      if (seq === plantOptionsSeq) objectOptions.value = []
    } finally {
      if (seq === plantOptionsSeq) objectLoading.value = false
    }
  }
)

// ── 价差 / 基差视图的图表适配 ─────────────────────────────────────────────────────────────

/** 配对/基差条目（data.series 里的宽松类型；无来源字段，见 docs/api/market-insight-contract.md）。 */
type PairedSeriesEntry = {
  seriesId: string
  kind: string
  unit: string
  priceObject: string | null
  marketPhase: string | null
  dimensions: Record<string, string | null>
  resolutionMinutes?: number
}

/**
 * 价差/基差结果 → 图表可读结果：合成序列借同价格对象的日前来源承载精度与对象维度
 * （展示身份用，不发额外请求）；fieldId 用 'spread'/'basis'（FIELD_TEXT 的业务名）。
 * 粒度：价差条目自带；基差条目从首行区间推（序列无该字段时）。
 */
function adaptPairedResult(result: InsightBlockResult, fieldId: 'spread' | 'basis'): InsightBlockResult {
  const data = result.data
  if (!data) return result
  const rows = (data.rows ?? []) as Array<{ seriesId: string; intervalStart: string; intervalEnd: string }>
  const sourceId = dayAheadSourceIdOf()
  const expectedKind = fieldId === 'spread' ? 'da-rt-spread' : 'node-basis'
  const adapted = (data.series as unknown as PairedSeriesEntry[])
    .filter((entry) => entry.kind === expectedKind)
    .map((entry) => {
      const own = rows.find((row) => row.seriesId === entry.seriesId)
      const minutes =
        entry.resolutionMinutes ??
        (own && Number.isFinite(Date.parse(own.intervalStart)) && Number.isFinite(Date.parse(own.intervalEnd))
          ? (Date.parse(own.intervalEnd) - Date.parse(own.intervalStart)) / 60_000
          : 60)
      return {
        seriesId: entry.seriesId,
        sourceId,
        fieldId,
        unit: entry.unit,
        measureKind: 'price',
        dimensions: entry.dimensions ?? {},
        // 业务范围跟着价格来源走：用户侧价是云南全市场，不能标成节点。
        businessScope: getInsightSource(sourceId)?.businessScope ?? 'node',
        resolutionMinutes: minutes,
        nativeResolutionMinutes: minutes,
        priceObject: entry.priceObject,
        marketPhase: fieldId === 'spread' ? null : entry.marketPhase,
        variant: null,
      } satisfies InsightSeriesMeta
    })
  return { ...result, data: { ...data, series: adapted } }
}

const spreadChartResult = computed(() => {
  const result = viewStates.spread.result
  return result ? adaptPairedResult(result, 'spread') : null
})
const basisChartResult = computed(() => {
  const result = viewStates.basis.result
  return result ? adaptPairedResult(result, 'basis') : null
})

/** 适配目录：seriesId → 对象名（统计表与异常表共用）。 */
function objectNameOf(seriesId: string, catalog: InsightSeriesMeta[] | undefined): string {
  const meta = catalog?.find((item) => item.seriesId === seriesId)
  if (!meta) return seriesId
  const dimension = getInsightSource(meta.sourceId)?.objectDimension
  const name = dimension ? meta.dimensions[dimension] : null
  return name || insightSeriesName(meta)
}

// ── 价差：配对统计与异常时段 ─────────────────────────────────────────────────────────────

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null }

/** 统计卡（时段走势摘要与价差/基差配对统计共用一套卡片结构，渲染见模板 ynp-prices__cards）。 */
type StatCardRow = { metricId: string; label: string; text: string; unit: string; note: string }
type StatCard = { key: string; title: string; isSet: boolean; weightNote: string; rows: StatCardRow[] }

/** 指标行 → 卡片行：名称/单位取登记，值按登记精度显示，极值带出现时段，缺数「—」。 */
function metricCardRow(metricId: string, row: MetricRow | undefined): StatCardRow {
  const definition = getMetricDefinition(metricId)
  const shown = row ? formatMetricValue(metricId, row.value) : null
  return {
    metricId,
    label: definition?.label ?? metricId,
    text: shown === null || shown === undefined ? '—' : String(shown),
    unit: definition?.unit === 'count' || !definition?.unit ? '' : definition.unit,
    note: row?.atIntervalStart ? `${formatBeijingDateTime(row.atIntervalStart)} 出现` : '',
  }
}

function tableRowsOf(result: InsightBlockResult | null, table: string): Array<Record<string, string | null>> {
  const tables = result?.data?.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined
  return tables?.[table]?.rows ?? []
}

const SPREAD_SUMMARY_METRICS = [
  'price.da-rt-spread',
  'price.da-rt-spread-abs-mean',
  'price.da-rt-spread-maximum',
  'price.da-rt-spread-minimum',
  'price.da-rt-spread-positive-share',
  'sample.common-hours',
] as const

const BASIS_SUMMARY_METRICS = ['price.node-basis', 'price.node-basis-minimum', 'price.node-basis-maximum', 'sample.common-hours'] as const

/** 配对统计卡：每对象一张卡，固定指标集；值按指标登记精度显示，缺数「—」。 */
function pairSummaryCards(
  result: InsightBlockResult | null,
  metrics: readonly string[],
  catalog: InsightSeriesMeta[] | undefined
): StatCard[] {
  const rows = tableRowsOf(result, 'summary') as unknown as MetricRow[]
  const bySeries = new Map<string, Map<string, MetricRow>>()
  for (const row of rows) {
    const map = bySeries.get(row.seriesId) ?? new Map<string, MetricRow>()
    map.set(row.metricId, row)
    bySeries.set(row.seriesId, map)
  }
  return [...bySeries.entries()].map(([seriesId, metricsOfSeries]) => ({
    key: seriesId,
    title: objectNameOf(seriesId, catalog),
    isSet: false,
    weightNote: '',
    rows: metrics.map((metricId) => metricCardRow(metricId, metricsOfSeries.get(metricId))),
  }))
}

const spreadSummaryCards = computed(() =>
  pairSummaryCards(viewStates.spread.result, SPREAD_SUMMARY_METRICS, spreadChartResult.value?.data?.series)
)
const basisSummaryCards = computed(() =>
  pairSummaryCards(viewStates.basis.result, BASIS_SUMMARY_METRICS, basisChartResult.value?.data?.series)
)

type AnomalyRow = { seriesId: string; intervalStart: string; intervalEnd: string; value: string | null; rank: string | null }

const spreadAnomalyRule = computed(() => {
  const tables = viewStates.spread.result?.data?.tables as { anomalies?: { rule?: string } } | undefined
  return tables?.anomalies?.rule ?? ''
})

const spreadAnomalies = computed(() =>
  (tableRowsOf(viewStates.spread.result, 'anomalies') as unknown as AnomalyRow[]).map((row) => ({
    ...row,
    name: objectNameOf(row.seriesId, spreadChartResult.value?.data?.series),
    valueText: row.value === null || row.value === undefined ? '—' : String(formatMetricValue('price.da-rt-spread', row.value)),
  }))
)

const spreadUnpaired = computed(() => {
  const unpaired = (viewStates.spread.result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => `${objectNameOf(item.seriesId, spreadChartResult.value?.data?.series)}：${item.reason}`)
})

/** 基差未配对（参考对象在来源里没有可用序列等）：逐条说明原因，不悄悄丢弃。 */
const basisUnpaired = computed(() => {
  const unpaired = (viewStates.basis.result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => `${objectNameOf(item.seriesId, basisChartResult.value?.data?.series)}：${item.reason}`)
})

// ── 选区（异常表行点击 → 图表定位；语义选区，不落下标）──────────────────────────────────

/** 图表句柄：只依赖暴露的 applySelection（异常行点击 → 图表定位）。 */
type InsightChartHandle = { applySelection: (selection: InsightSelection | null) => void }

const spreadChartRef = ref<InsightChartHandle | null>(null)
// 函数 ref：ref="…" 写在 v-for（页签循环）内会被编译器标记 refInFor、收集成数组；
// 函数 ref 直接给实例，语义就是单个图表。
function setSpreadChartRef(el: unknown): void {
  spreadChartRef.value = (el as InsightChartHandle | null) ?? null
}
const spreadSelection = ref<InsightSelection | null>(null)
const selectionBuilder = useInsightSelection(() => ({
  regionId: ctx.regionId.value,
  companyId: ctx.companyId.value,
  contextVersion: ctx.contextVersion.value,
  resultVersion: viewStates.spread.result?.resultVersion ?? '',
}))

function clearSpreadSelection(): void {
  spreadSelection.value = null
  selectionBuilder.reset()
  spreadChartRef.value?.applySelection(null)
}

function onAnomalyRowClick(row: { seriesId: string; intervalStart: string; intervalEnd: string }): void {
  const result = viewStates.spread.result
  const catalog = spreadChartResult.value?.data?.series
  if (!result || !catalog) return
  const meta = catalog.find((item) => item.seriesId === row.seriesId)
  const ts = Date.parse(row.intervalStart)
  if (!meta || !Number.isFinite(ts)) return
  const selection = selectionBuilder.build(result, [{ series: meta, point: { ts, end: row.intervalEnd } }])
  if (!selection) return
  spreadSelection.value = selection
  spreadChartRef.value?.applySelection(selection)
}

function onSpreadChartSelect(selection: InsightSelection | null): void {
  spreadSelection.value = selection
}

// ── 选区承接研究（任务 13.7，RS08）：语义选区 → 研究工作台预填研究范围 ──────────────────
// 经地址参数白名单只带窗口起止日 + 对象/来源引用（DE10：不携带时段数组/原始数据）；
// 研究页按同一套 useInsightContext 参数还原窗口与对象、来源，并按承接来源预填预设。

const router = useRouter()

const RESEARCH_HANDOFF_TO_TEXT = '把选区窗口与对象/来源引用交给研究工作台预填研究范围（不带原始数据）'

// 客户档封存工作区摘除（customer-edition-page-gating Requirement 2）：研究工作台入口
// 不可达时按钮隐藏、函数短路——不留点了落 catch-all 的死跳转。
const researchHandoffAvailable = isEditionRouteAvailable('/insight/research')
function onSpreadSelectionToResearch(): void {
  if (!researchHandoffAvailable) return
  const selection = spreadSelection.value
  if (!selection) return
  const query = buildResearchHandoffQuery(selection, 'prices')
  if (!query) return
  void router.push({ path: '/insight/research', query })
}

// ── 空间查阅入口（dljy#3106 D6.1「三维地形/空间」未就绪项补齐）─────────────────────────
// 节点基差页签选中参考对象后，可跳入既有「电力市场空间态势」（grid-geo 模块原地复用，
// 洞察不复制 Cesium）。权限显隐沿用 spatialLinks 登记（canAccessPath 既有口径，无权限
// 不渲染）；参考对象名先经 resolveSpatialObjectId 解析成网格资产 ID（objectId 契约是
// 不透明资产 ID，不得拿名字生成），解析失败如实说明不跳转；query 白名单只带资产 ID +
// 地区/公司归属 + 窗口末日（objectDate）+ 来源标记，时段数组与原始序列不进 URL。

const MARKET_SPATIAL_TARGET = SPATIAL_LINK_TARGETS.marketSpatial

const basisSpatialVisible = computed(() =>
  spatialEntryVisible({
    path: MARKET_SPATIAL_TARGET,
    objectName: basisReference.value || null,
    companyId: ctx.companyId.value,
  })
)

async function onBasisToSpatialView(): Promise<void> {
  if (!basisReference.value || !ctx.companyId.value) return
  // 参考对象先解析成网格资产 ID（objectId 契约是不透明资产 ID，名字直传会请求不存在的资产）。
  // 对象种类跟价格对象走：场站关联节点模式的参考是场站（plant），公司厂侧节点模式是节点（node）。
  const kind = currentEntry.value?.priceObject === 'plant-node' ? 'plant' : 'node'
  const assetId = await resolveSpatialObjectId(kind, basisReference.value)
  if (!assetId) {
    ElMessage.warning(
      kind === 'plant'
        ? `空间资产登记中未找到与「${basisReference.value}」唯一对应的场站，本次未跳转`
        : `空间资产登记中未找到与「${basisReference.value}」唯一对应的节点，本次未跳转`
    )
    return
  }
  if (kind === 'node') {
    // 市场空间态势只按对象的场站关联取景（detail.relations.plants）：无场站关联的独立节点
    // 跳过去只会得到「尚未关联场站」的报错——点击时确认关联，未关联/读取失败如实说明不跳转。
    try {
      const detail = await fetchGridObject({ kind: 'node', id: assetId, regionId: ctx.regionId.value })
      if (!detail.relations.plants.length) {
        ElMessage.warning(`「${basisReference.value}」在空间资产中未关联场站，市场空间态势暂无法聚焦独立节点，本次未跳转`)
        return
      }
    } catch {
      ElMessage.warning(`「${basisReference.value}」的空间资产关联读取失败，本次未跳转`)
      return
    }
  }
  openSpatialViewLink(router, {
    path: MARKET_SPATIAL_TARGET,
    query: objectSpatialLinkQuery({
      kind,
      objectId: assetId,
      regionId: ctx.regionId.value,
      companyId: ctx.companyId.value,
      date: ctx.businessWindow.value.end,
      from: 'insight-prices',
    }),
  })
}

/** 已定位时段的可读描述（「对象 · HH:mm~HH:mm」，语义身份，无下标）。 */
const spreadSelectionText = computed(() => {
  const selection = spreadSelection.value
  if (!selection) return ''
  const intervals = selection.timeIntervals
    .map((interval) => `${formatBeijingDateTime(interval.start).slice(11)}~${formatBeijingDateTime(interval.end).slice(11)}`)
    .join('、')
  const objects = selection.objectRefs.map((ref) => ref.id).join('、')
  return [objects, intervals].filter(Boolean).join(' · ')
})

// ── 统计摘要（summary 视图）──────────────────────────────────────────────────────────────

function summaryCardsOf(result: InsightBlockResult | null): StatCard[] {
  if (!result?.data) return []
  const rows = (result.data.rows ?? []) as unknown as MetricRow[]
  const bySeries = new Map<string, MetricRow[]>()
  for (const row of rows) {
    const list = bySeries.get(row.seriesId) ?? []
    list.push(row)
    bySeries.set(row.seriesId, list)
  }
  const cards: StatCard[] = []
  for (const meta of result.data.series as unknown as Array<InsightSeriesMeta & { kind?: string; weightNote?: string }>) {
    const own = bySeries.get(meta.seriesId) ?? []
    if (!own.length) continue
    const isSet = meta.kind === 'object-set' || meta.seriesId.startsWith('set:')
    cards.push({
      key: meta.seriesId,
      title: isSet ? '所选对象集合' : insightSeriesName(meta),
      isSet,
      weightNote: meta.weightNote ?? '',
      rows: own.map((row) => metricCardRow(row.metricId, row)),
    })
  }
  return cards
}

const summaryCards = computed(() => summaryCardsOf(summaryState.result))

/** 后端声明的不可用指标（负价电量占比：没有同对象电量，如实显示原因，不显示 0）。 */
const unavailableMetrics = computed(
  () => (summaryState.result?.data?.unavailableMetrics ?? []) as Array<{ metricId: string; reason: string }>
)

function unavailableText(item: { metricId: string; reason: string }): string {
  const label = getMetricDefinition(item.metricId)?.label ?? item.metricId
  return `${label} 不可用：${item.reason}`
}

// ── 历史分布（profile 视图）──────────────────────────────────────────────────────────────

const PROFILE_LINE_METRIC = 'price.time-weighted-average'

type ProfileStatRow = { seriesId: string; date?: string | null; timeOfDay?: string | null; metricId: string; value: string | null }

function profileSeriesCatalog(result: InsightBlockResult | null): InsightSeriesMeta[] {
  return (result?.data?.series ?? []) as InsightSeriesMeta[]
}

/** daily / timeOfDay 切面图：每条价格序列一条「时长加权均价」线（ChartCard 自绘）。 */
function buildProfileOption(result: InsightBlockResult | null, facet: 'daily' | 'timeOfDay'): Record<string, unknown> {
  const catalog = profileSeriesCatalog(result)
  const rows = tableRowsOf(result, facet) as unknown as ProfileStatRow[]
  const axisKey = facet === 'daily' ? 'date' : 'timeOfDay'
  const axisValues = [...new Set(rows.map((row) => String(row[axisKey] ?? '')))].sort()
  const series = catalog.map((meta) => {
    const points = axisValues.map((axis) => {
      const hit = rows.find((row) => row.seriesId === meta.seriesId && row.metricId === PROFILE_LINE_METRIC && String(row[axisKey] ?? '') === axis)
      const shown = hit ? formatMetricValue(PROFILE_LINE_METRIC, hit.value) : null
      return shown === null || shown === undefined ? null : Number(shown)
    })
    return { name: insightSeriesName(meta), type: 'line', connectNulls: false, smooth: false, showSymbol: false, data: points }
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 56, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'category', data: axisValues },
    yAxis: { type: 'value', name: '元/MWh', scale: true },
    series,
  }
}

const profileDailyOption = computed(() => buildProfileOption(viewStates.profile.result, 'daily'))
const profileTimeOfDayOption = computed(() => buildProfileOption(viewStates.profile.result, 'timeOfDay'))

/** 窗口天数与各序列有效天数（daily 切面里出现过的不同业务日数；如实报告，不装满窗）。 */
const windowDayCount = computed(() => {
  const { start, end } = ctx.businessWindow.value
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0
})

const profileCoverage = computed(() => {
  const result = viewStates.profile.result
  const rows = tableRowsOf(result, 'daily') as unknown as ProfileStatRow[]
  const bySeries = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.date) continue
    const set = bySeries.get(row.seriesId) ?? new Set<string>()
    set.add(row.date)
    bySeries.set(row.seriesId, set)
  }
  return profileSeriesCatalog(result).map((meta) => ({
    key: meta.seriesId,
    name: insightSeriesName(meta),
    days: bySeries.get(meta.seriesId)?.size ?? 0,
  }))
})

// ── 证据抽屉与历史候选 ───────────────────────────────────────────────────────────────────

const evidenceVisible = ref(false)
const evidenceTarget = ref<InsightBlockResult | null>(null)

function openEvidence(view: PriceView | 'summary'): void {
  evidenceTarget.value = view === 'summary' ? summaryState.result : viewStates[view].result
  evidenceVisible.value = true
}

/** 证据「与明细同一份读取」：读取版本集合与时段走势明细一致（后端 D4.1：同一读取的不同视图）。 */
const evidenceSameReadAsSeries = computed(() => {
  const target = evidenceTarget.value
  const seriesResult = viewStates.series.result
  return Boolean(target?.readSetRef && seriesResult?.readSetRef && target.readSetRef === seriesResult.readSetRef)
})

const candidatesVisible = ref(false)

function openCandidates(): void {
  candidatesVisible.value = true
}

function onCandidateSelect(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

/** 历史候选的 filters：与当前主查询同口径（view + 对象）。 */
const candidatesFilters = computed<Record<string, unknown>>(() => {
  const filters: Record<string, unknown> = { view: activeTab.value === 'series' ? 'series' : activeTab.value }
  if (requiresObjects.value && ctx.objectIds.value.length) filters.objectIds = [...ctx.objectIds.value]
  return filters
})

const basisNotes = computed(() => {
  const notes = (viewStates.basis.result?.data?.notes ?? []) as Array<{ sourceId: string; note: string }>
  return notes.map((item) => item.note)
})

// ── 导出与材料（dljy#3078，任务 15.2/14.5）────────────────────────────────────────────
// 权限语义分离：导出是只读动作，凡有结果者可用；「加入材料」是公司写入，按 governance 既有
// 口径只对公司管理员级账号显示（hasCompanyAdmin 只管显隐，后端复盘写入闸门才是权威）。
// 冻结协议是服务端既有契约（kind: 'market_insight'）：这里只组装「登记分析 + 上下文 + 筛选 +
// 期望版本」，服务端重算核验并冻结；409 冲突提示先重新运行，未成功绝不提示已保存。

/** 公司写入显隐：与公司档案等页面的 canWrite 判断同源（governance.hasCompanyAdmin）。
 *  用户读取的 storage 异常（隐私模式等）按无权限处理，不影响页面渲染。 */
const canWriteCompany = computed(() => {
  try {
    return hasCompanyAdmin(getCurrentUser())
  } catch {
    return false
  }
})

type MaterialView = 'series' | 'profile'

// ── 业务模块只读深链（dljy#3096，任务 15.5，design D11 / CH04 / PP07）────────────────────
// 价格页的深链面只有「前往资料维护」：区块空态原因为「未接入 / 超覆盖」且当前账号对
// 上传中心有权限时出现（显隐在页面，入口在 InsightBlock）。跳转只带期间与 from 标记，
// 不在洞察手填真实值；返回后由 contextVersion 机制重查——返回不视为已补齐。

const canMaintainData = computed(() => canFollowDeepLink(DEEP_LINK_TARGETS.dataMaintenance))

function openDataMaintenance(): void {
  openDataMaintenanceLink(router, { window: ctx.businessWindow.value, from: 'insight-prices' })
}

const materialVisible = ref(false)
const materialView = ref<MaterialView>('series')
const materialSubject = ref('')
const materialRequest = ref<{ analysisId: string; context: Record<string, unknown>; filters: Record<string, unknown> } | null>(null)

const materialResult = computed<InsightBlockResult | null>(() => viewStates[materialView.value].result)

/** 打开材料窗口：冻结请求与当前查询同口径；上下文剥掉代次（导航概念），同口径重复保存幂等键稳定。 */
function openMaterial(view: MaterialView): void {
  const result = viewStates[view].result
  if (!result?.resultVersion || !result.readSetRef) return
  const filters: Record<string, unknown> = { view }
  if (requiresObjects.value) filters.objectIds = [...ctx.objectIds.value]
  const { contextVersion: _generation, ...context } = ctx.toQueryContext()
  materialView.value = view
  materialRequest.value = { analysisId: priceObjectChoice.value, context, filters }
  materialSubject.value = view === 'profile' ? '历史分布' : '时段走势'
  materialVisible.value = true
}

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 只收「当前签名一致」的已就绪页签结果（含时段走势的 summary 摘要），过期区块不进上下文；
// 只传价格对象/参考对象等摘要与版本引用，不传原始行数据。

const insightAi = useInsightAiPage({
  pageId: 'prices',
  label: '云南价格分析',
  collect: () => {
    if (!priceObjectChoice.value) return []
    const blocks: InsightAiEvidenceBlock[] = []
    for (const tab of PRICE_TABS) {
      const entry = viewStates[tab.view]
      const aiBlock = insightAiBlockOf({
        blockId: tab.view,
        title: tab.label,
        analysisId: priceObjectChoice.value,
        view: tab.view,
        currentKey: queryKey(tab.view),
        queriedKey: entry.queriedKey,
        result: entry.result,
        objects: [...ctx.objectIds.value],
        filterSummary: {
          价格对象: PRICE_OBJECT_TEXT[currentEntry.value?.priceObject ?? ''] ?? null,
          ...(tab.view === 'basis' && basisReference.value ? { 参考对象: basisReference.value } : {}),
        },
      })
      if (aiBlock) blocks.push(aiBlock)
    }
    const summary = insightAiBlockOf({
      blockId: 'summary',
      title: '时段走势统计摘要',
      analysisId: priceObjectChoice.value,
      view: 'summary',
      currentKey: queryKey('series'),
      queriedKey: summaryState.queriedKey,
      result: summaryState.result,
      objects: [...ctx.objectIds.value],
      filterSummary: { 价格对象: PRICE_OBJECT_TEXT[currentEntry.value?.priceObject ?? ''] ?? null },
    })
    if (summary) blocks.push(summary)
    return blocks
  },
  currentSignature: () => globalSignature.value,
})

const onAiInterpret = (): void => {
  void insightAi.interpret()
}

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <div class="ynp-prices">
    <!-- 顶部：价格对象 / 日期窗 / 对象选择与口径说明 -->

    <InsightAnchorNotice
      v-if="entryAnchor.anchorNotice.value"
      :notice="entryAnchor.anchorNotice.value"
      @back-today="entryAnchor.backToToday"
      @dismiss="entryAnchor.dismissAnchorNotice"
    />
    <section class="ynp-prices__controls">
      <label class="ynp-prices__field">
        <span>价格对象</span>
        <el-select
          :model-value="priceObjectChoice"
          placeholder="选择价格对象"
          :loading="capabilitiesLoading"
          data-testid="ynp-price-object"
          @change="onPriceObjectChange"
        >
          <el-option
            v-for="entry in availableObjects"
            :key="entry.analysisId"
            :value="entry.analysisId"
            :label="PRICE_OBJECT_TEXT[entry.priceObject] ?? entry.priceObject"
          />
        </el-select>
      </label>

      <label class="ynp-prices__field">
        <span>分析日期</span>
        <InsightDateRange
          :model-value="ctx.businessWindow.value"
          :max-days="maxDays"
          @update:model-value="onWindowChange"
        />
      </label>

      <label v-if="requiresObjects" class="ynp-prices__field ynp-prices__field--wide">
        <span>分析对象</span>
        <InsightObjectPicker
          :model-value="ctx.objectIds.value"
          :options="objectOptions"
          :max-objects="maxObjects"
          :requires-objects="requiresObjects"
          :remote="currentEntry?.priceObject === 'public-node' || currentEntry?.priceObject === 'company-node'"
          :remote-method="searchObjects"
          :remote-loading="objectLoading"
          placeholder="输入节点名检索"
          @update:model-value="onObjectChange"
        />
      </label>

      <!-- AI 入口（15.3）：模型离线只隐藏入口，数据页不受影响（D9） -->
      <el-button
        v-if="insightAi.aiAvailable.value"
        type="primary"
        data-testid="ynp-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
    </section>

    <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="价格对象目录读取失败">
      <p class="ynp-prices__hint">当前看不到可选的价格对象；可重试，不影响已选对象的查询。</p>
      <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
    </el-alert>

    <p v-if="currentEntry" class="ynp-prices__meta">
      {{ PRICE_OBJECT_TEXT[currentEntry.priceObject] }} · {{ currentEntry.scopeText }} · 单位 元/MWh ·
      原生粒度 {{ currentEntry.nativeMinutes }} 分钟 · 含日前与实时两个市场阶段
    </p>

    <!-- 四页签：懒加载（首次激活渲染），签名不变时切回不重查 -->
    <el-tabs :model-value="activeTab" class="ynp-prices__tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in PRICE_TABS" :key="tab.view" :name="tab.view" :label="tab.label">
        <template v-if="visitedTabs.has(tab.view)">
          <!-- 时段走势：单日走势 / 多日立体 / 日期×时段热力（模式按 用户+地区+价格对象 记忆） + 统计摘要 -->
          <template v-if="tab.view === 'series'">
            <div class="ynp-prices__mode-row">
              <el-radio-group
                :model-value="seriesMode"
                size="small"
                data-testid="ynp-series-mode"
                @update:model-value="onModeChange"
              >
                <el-radio-button value="single">单日走势</el-radio-button>
                <el-radio-button value="multi3d">多日立体</el-radio-button>
                <el-radio-button value="heatmap">日期×时段热力</el-radio-button>
              </el-radio-group>
            </div>

            <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
              请选择分析对象
            </p>
            <template v-else>
              <!-- 多日立体 / 热力：与「历史分布」页签共用同一份 profile 结果 -->
              <Price3DWorkspace
                v-if="seriesMode !== 'single'"
                :mode="seriesMode"
                :visible="activeTab === 'series'"
                :result="viewStates.profile.result"
                :error="viewStates.profile.error"
                :loading="viewStates.profile.loading"
                :object-dimension="objectDimension"
                :window-day-count="windowDayCount"
                :business-window="ctx.businessWindow.value"
                @retry="retryView('profile')"
                @extend-window="onExtendWindow"
                @switch-mode="onSwitchMode"
              />

              <InsightBlock
                v-if="seriesMode === 'single'"
                title="时段走势"
                :result="viewStates.series.result"
                :error="viewStates.series.error"
                :loading="viewStates.series.loading"
                :on-retry="() => retryView('series')"
                :on-refresh="() => retryView('series')"
                :source-titles="sourceTitles"
                :exportable="true"
                :materializable="canWriteCompany"
                :maintenance="canMaintainData"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('series')"
                @add-material="openMaterial('series')"
                @open-maintenance="openDataMaintenance"
              >
                <InsightSeriesChart
                  :result="viewStates.series.result"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="320"
                  @select="() => {}"
                />
                <InsightResultTable
                  :result="viewStates.series.result"
                  :selection="null"
                  :source-titles="sourceTitles"
                  @row-click="() => {}"
                />
              </InsightBlock>
            </template>

            <InsightBlock
              title="统计摘要"
              :result="summaryState.result"
              :error="summaryState.error"
              :loading="summaryState.loading"
              :on-retry="() => retryView('series')"
              :on-refresh="() => retryView('series')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('summary')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert
                v-for="item in unavailableMetrics"
                :key="item.metricId"
                type="info"
                :closable="false"
                :title="unavailableText(item)"
              />
              <div class="ynp-prices__cards">
                <div v-for="card in summaryCards" :key="card.key" class="ynp-prices__card" :class="{ 'ynp-prices__card--set': card.isSet }">
                  <h4 class="ynp-prices__card-title">{{ card.title }}</h4>
                  <dl class="ynp-prices__card-grid">
                    <template v-for="row in card.rows" :key="row.metricId">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                    </template>
                  </dl>
                  <p v-if="card.weightNote" class="ynp-prices__card-note">{{ card.weightNote }}</p>
                </div>
              </div>
            </InsightBlock>
          </template>

          <!-- 日前实时价差 -->
          <template v-else-if="tab.view === 'spread'">
            <InsightBlock
              title="日前实时价差"
              :result="viewStates.spread.result"
              :error="viewStates.spread.error"
              :loading="viewStates.spread.loading"
              :on-retry="() => retryView('spread')"
              :on-refresh="() => retryView('spread')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('spread')"
              @open-maintenance="openDataMaintenance"
            >
              <InsightNote label="日前 − 实时 · 元/MWh" :text="SPREAD_DIRECTION_TEXT" />
              <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请选择分析对象
              </p>
              <template v-else>
                <InsightSeriesChart
                  :ref="setSpreadChartRef"
                  :result="spreadChartResult"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="300"
                  @select="onSpreadChartSelect"
                />
                <p v-if="spreadSelectionText" class="ynp-prices__hint">
                  已定位时段：{{ spreadSelectionText }}
                  <el-button
                    v-if="researchHandoffAvailable"
                    size="small"
                    type="primary"
                    plain
                    data-testid="ynp-spread-to-research"
                    :title="RESEARCH_HANDOFF_TO_TEXT"
                    @click="onSpreadSelectionToResearch"
                  >
                    以选区进入研究
                  </el-button>
                </p>
                <div v-if="spreadSummaryCards.length" class="ynp-prices__cards">
                  <div v-for="card in spreadSummaryCards" :key="card.key" class="ynp-prices__card">
                    <h4 class="ynp-prices__card-title">{{ card.title }}</h4>
                    <dl class="ynp-prices__card-grid">
                      <template v-for="row in card.rows" :key="row.metricId">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                      </template>
                    </dl>
                  </div>
                </div>
                <el-alert
                  v-if="spreadAnomalyRule"
                  class="ynp-prices__anomaly-rule"
                  type="info"
                  :closable="false"
                  :title="spreadAnomalyRule"
                />
                <el-table
                  v-if="spreadAnomalies.length"
                  :data="spreadAnomalies"
                  size="small"
                  border
                  max-height="320"
                  @row-click="onAnomalyRowClick"
                >
                  <el-table-column prop="rank" label="排序" width="60" align="right" />
                  <el-table-column prop="name" label="对象" min-width="140" show-overflow-tooltip />
                  <el-table-column label="时段起" width="120">
                    <template #default="{ row }">{{ formatBeijingDateTime(row.intervalStart) }}</template>
                  </el-table-column>
                  <el-table-column label="时段止" width="120">
                    <template #default="{ row }">{{ formatBeijingDateTime(row.intervalEnd) }}</template>
                  </el-table-column>
                  <el-table-column prop="valueText" label="价差（元/MWh）" width="130" align="right" />
                </el-table>
                <el-alert
                  v-for="(item, index) in spreadUnpaired"
                  :key="index"
                  type="warning"
                  :closable="false"
                  :title="`未配对：${item}`"
                />
              </template>
            </InsightBlock>
          </template>

          <!-- 历史分布 -->
          <template v-else-if="tab.view === 'profile'">
            <InsightBlock
              title="历史分布"
              :result="viewStates.profile.result"
              :error="viewStates.profile.error"
              :loading="viewStates.profile.loading"
              :on-retry="() => retryView('profile')"
              :on-refresh="() => retryView('profile')"
              :source-titles="sourceTitles"
              :exportable="true"
              :materializable="canWriteCompany"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('profile')"
              @add-material="openMaterial('profile')"
              @open-maintenance="openDataMaintenance"
            >
              <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请选择分析对象
              </p>
              <template v-else>
                <p class="ynp-prices__hint">
                  业务窗口 {{ ctx.businessWindow.value.start }} ~ {{ ctx.businessWindow.value.end }}（{{ windowDayCount }} 天）；各序列有效天数：
                  <template v-if="profileCoverage.length">
                    <span v-for="item in profileCoverage" :key="item.key">{{ item.name }} {{ item.days }} 天；</span>
                  </template>
                </p>
                <InsightNote label="历史样本范围" :text="PROFILE_SAMPLE_TEXT" />

                <ChartCard
                  title="逐日均价（时长加权）"
                  :height="280"
                  :build-option="() => profileDailyOption"
                />
                <ChartCard
                  title="各时段跨日均价（时长加权）"
                  :height="280"
                  :build-option="() => profileTimeOfDayOption"
                />
              </template>
            </InsightBlock>
          </template>

          <!-- 节点基差 -->
          <template v-else>
            <InsightBlock
              title="节点基差"
              :result="viewStates.basis.result"
              :error="viewStates.basis.error"
              :loading="viewStates.basis.loading"
              :on-retry="() => retryView('basis')"
              :on-refresh="() => retryView('basis')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('basis')"
              @open-maintenance="openDataMaintenance"
            >
              <el-empty v-if="!supportsBasis" :description="USER_PRICE_NO_BASIS_TEXT" :image-size="72" />
              <p v-else-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请先在上方选择分析对象，再选择参考对象。
              </p>
              <template v-else>
                <div class="ynp-prices__basis-bar">
                  <label class="ynp-prices__field">
                    <span>参考对象（只能从已选对象中选）</span>
                    <el-select
                      v-model="basisReference"
                      clearable
                      filterable
                      placeholder="选择参考对象"
                      data-testid="ynp-basis-reference"
                    >
                      <el-option v-for="option in basisOptions" :key="option.id" :label="option.label" :value="option.id" />
                    </el-select>
                  </label>
                  <el-button
                    v-if="basisSpatialVisible"
                    data-testid="ynp-basis-spatial"
                    @click="onBasisToSpatialView"
                  >
                    在空间视图查看
                  </el-button>
                </div>
                <InsightNote label="所选节点 − 参考节点" :text="BASIS_DIRECTION_TEXT" />
                <el-empty v-if="!basisReference" :description="BASIS_PICK_REFERENCE_TEXT" :image-size="72" />
                <template v-else>
                  <InsightSeriesChart
                    :result="basisChartResult"
                    :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                    :height="300"
                    @select="() => {}"
                  />
                  <div v-if="basisSummaryCards.length" class="ynp-prices__cards">
                    <div v-for="card in basisSummaryCards" :key="card.key" class="ynp-prices__card">
                      <h4 class="ynp-prices__card-title">{{ card.title }}</h4>
                      <dl class="ynp-prices__card-grid">
                        <template v-for="row in card.rows" :key="row.metricId">
                          <dt>{{ row.label }}</dt>
                          <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                        </template>
                      </dl>
                    </div>
                  </div>
                  <el-alert
                    v-for="(item, index) in basisUnpaired"
                    :key="index"
                    type="warning"
                    :closable="false"
                    :title="`未配对：${item}`"
                  />
                  <el-alert v-for="(note, index) in basisNotes" :key="index" type="info" :closable="false" :title="note" />
                </template>
              </template>
            </InsightBlock>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 证据抽屉：视图结果与明细同一份读取时补充说明 -->
    <InsightEvidenceDrawer v-model="evidenceVisible" :result="evidenceTarget" :source-titles="sourceTitles">
      <p v-if="evidenceSameReadAsSeries" class="ynp-prices__hint">
        该视图与「时段走势」明细来自同一份读取（读取版本集合一致），只是另一种呈现，不是另读一次数据。
      </p>
    </InsightEvidenceDrawer>

    <InsightHistoryCandidates
      v-model="candidatesVisible"
      :analysis-id="priceObjectChoice"
      :context="ctx.toQueryContext()"
      :filters="candidatesFilters"
      :required-source-ids="candidateSourceIds"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />

    <!-- 材料窗口（任务 14.5）：冻结 + 入稿全在窗口内完成，服务不可用只报错不阻断分析页 -->
    <InsightMaterialDialog
      v-model="materialVisible"
      :region="ctx.regionId.value"
      :company-id="ctx.companyId.value ?? ''"
      :subject="materialSubject"
      :request="materialRequest"
      :result="materialResult"
    />
  </div>
</template>

<style scoped>
.ynp-prices {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ynp-prices__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.ynp-prices__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ynp-prices__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.ynp-prices__field :deep(.el-select),
.ynp-prices__field :deep(.el-date-editor) {
  width: 220px;
}

.ynp-prices__field--wide :deep(.el-select) {
  width: 300px;
}

.ynp-prices__meta {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
}

.ynp-prices__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}

/* 时段走势页签的展示模式切换（单日走势 / 多日立体 / 日期×时段热力） */
.ynp-prices__mode-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.ynp-prices__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.ynp-prices__card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.ynp-prices__card--set {
  border-style: dashed;
}

.ynp-prices__card-title {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.ynp-prices__card-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}

.ynp-prices__card-grid dt {
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

.ynp-prices__card-grid dd {
  margin: 0;
  font-size: var(--font-sm, 13px);
  font-variant-numeric: tabular-nums;
  color: var(--text, #1f2a37);
  text-align: right;
}

.ynp-prices__card-note {
  margin: 8px 0 0;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}

.ynp-prices__anomaly-rule {
  margin-top: 10px;
}

.ynp-prices__basis-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
</style>
