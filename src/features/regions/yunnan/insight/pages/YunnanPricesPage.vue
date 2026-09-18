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
// 未选对象 / 未选参考的前置拦截在页面层完成（不发请求），后端校验是第二道防线。

import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import { useInsightContext } from '@/composables/useInsightContext'
import { useInsightSelection } from '@/components/insight/chart/useInsightSelection'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
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
const PROFILE_SAMPLE_TEXT = '只统计所选窗口内真实存在的时段；样本只有一年或更短时，不代表多年季节规律'
const PROFILE_NO_FILTER_TEXT = '暂不支持按季节、工作日筛选'

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)

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
    if (!result) return
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

/** 基差参考对象（只能从已选对象里选；未选不发请求）。 */
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

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <div class="ynp-prices">
    <!-- 顶部：价格对象 / 日期窗 / 对象选择与口径说明 -->
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
        <span>业务日期窗</span>
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
          <!-- 时段走势：明细序列 + 统计摘要 -->
          <template v-if="tab.view === 'series'">
            <InsightBlock
              title="时段走势"
              :result="viewStates.series.result"
              :error="viewStates.series.error"
              :loading="viewStates.series.loading"
              :on-retry="() => retryView('series')"
              :on-refresh="() => retryView('series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('series')"
            >
              <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请先在上方选择分析对象，再进行查询（未选对象不发请求）。
              </p>
              <template v-else>
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
              </template>
            </InsightBlock>

            <InsightBlock
              title="统计摘要"
              :result="summaryState.result"
              :error="summaryState.error"
              :loading="summaryState.loading"
              :on-retry="() => retryView('series')"
              :on-refresh="() => retryView('series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('summary')"
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
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('spread')"
            >
              <el-alert type="info" :closable="false" :title="SPREAD_DIRECTION_TEXT" />
              <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请先在上方选择分析对象，再进行查询（未选对象不发请求）。
              </p>
              <template v-else>
                <InsightSeriesChart
                  :ref="setSpreadChartRef"
                  :result="spreadChartResult"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="300"
                  @select="onSpreadChartSelect"
                />
                <p v-if="spreadSelectionText" class="ynp-prices__hint">已定位时段：{{ spreadSelectionText }}</p>
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
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('profile')"
            >
              <p v-if="requiresObjects && !ctx.objectIds.value.length" class="ynp-prices__hint">
                请先在上方选择分析对象，再进行查询（未选对象不发请求）。
              </p>
              <template v-else>
                <p class="ynp-prices__hint">
                  业务窗口 {{ ctx.businessWindow.value.start }} ~ {{ ctx.businessWindow.value.end }}（{{ windowDayCount }} 天）；各序列有效天数：
                  <template v-if="profileCoverage.length">
                    <span v-for="item in profileCoverage" :key="item.key">{{ item.name }} {{ item.days }} 天；</span>
                  </template>
                </p>
                <p class="ynp-prices__hint">{{ PROFILE_SAMPLE_TEXT }}</p>
                <p class="ynp-prices__hint">{{ PROFILE_NO_FILTER_TEXT }}</p>
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
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('basis')"
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
                </div>
                <el-alert type="info" :closable="false" :title="BASIS_DIRECTION_TEXT" />
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
