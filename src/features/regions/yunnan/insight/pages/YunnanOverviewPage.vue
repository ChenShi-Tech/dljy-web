<script setup lang="ts">
// 云南市场总览页（dljy#3009，OpenSpec build-yunnan-regional-market-insight 任务 8.3/8.4）
// ----------------------------------------------------------------------------
// /insight/overview 的云南实现。区块清单来自共享契约 OVERVIEW_BLOCKS（shared/insight/overview.mjs）：
// 每个区块就是某个已登记分析的某个视图，页面逐块独立查询、独立重试，一个区块失败不影响
// 其他区块（OV02）；总览不另写一套口径，任何数值都出自后端已登记视图（本页只呈现、不计算）。
// 口径要点（specs yunnan-market-overview）：
//   - 默认当日（北京时间）：不自动改日、不自动跳「最近有数据的日子」；当日缺数由各区块的
//     可用性说明与「查看可分析日期」候选入口表达（A02）；
//   - 重点事项最多五条，无满足条件就少于五条，不凑数；阈值是平台分析默认值，不是官方规则，
//     也不是交易建议；每条事项只陈述观测与阈值，不下因果；每条规则的评估状态（为什么没有）
//     原样展示（OV03）；
//   - 同进度比较只对单日窗口做；前一日同时段不完整时只说明原因，不显示假环比（OV04）；
//   - 下钻带同一业务日期到详情页（OV05）：价格/供需页已交付，未交付页由宿主渲染「正在建设」
//     占位，不借数据、不留死链；下钻 query 经 insightHandoff 统一编解码（共享四键 + hx_from
//     返回锚点，dljy#3087 任务 15.1）；
//   - 获权区块（场站）按能力目录判定可见性：公共账号不渲染空框、不发获权请求；
//   - 电网事件摘要（dljy#3102，任务 10.7）与电网边界页检修干预页签（10.6）消费同一批
//     grid-geo 披露事件接口（overview/events，identity 归并口径一致），不重建事件事实库、
//     不经洞察分析查询；可见性按接口实际语义（公开披露、公司级作用域），不按洞察能力
//     目录门控；下钻只带业务窗口（query start/end），明细以电网边界页完整筛选为准；
//   - 天气等旧驾驶舱大块不带入本页（收拢为各页自己的事）。

import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { beijingToday } from 'shared/midlong/dates.mjs'
import { OVERVIEW_BLOCKS } from 'shared/insight/overview.mjs'
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
import { useInsightContext } from '@/composables/useInsightContext'
import { useInsightEntryAnchor } from '@/composables/useInsightEntryAnchor'
import { insightAiBlockOf, useInsightAiPage } from '@/features/regions/yunnan/insight/useInsightAiPage'
import { INSIGHT_PAGE_PATHS, type InsightPageId } from '@/services/region/insightWorkspace'
import { buildInsightDrilldownQuery } from '@/services/region/insightHandoff'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightAnchorNotice from '@/components/insight/InsightAnchorNotice.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightResultTable from '@/components/insight/InsightResultTable.vue'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import { formatBeijingDateTime, insightSeriesName, insightSourceTitle, type InsightSourceTitle } from '@/components/insight/insightText'
import { fetchGridDisclosureOverview, fetchGridDisclosureEvents } from '@/features/gridGeo/client'
import { maintenanceTimeBasis } from '@/features/gridGeo/disclosureMaintenance'
import { parseDisclosureTime } from '@/features/gridGeo/disclosureTime'
import type { GridDisclosureEvent, GridDisclosureOverview } from '@/features/gridGeo/types'

// ── 固定文案（改文案要同步 docs/market-insight-overview.md）──────────────────────────────

const PAGE_NOTE_TEXT = '总览只汇总已登记分析的结果；每个区块独立读取、独立重试，一个来源失败只影响它自己的区块'
const NO_KEY_ITEMS_TEXT = '没有满足阈值的事项；每条规则的评估状态见下方「规则评估」，阈值是平台分析默认值，不是官方规则'
const SPREAD_IS_NOT_REVENUE_TEXT = '价差是价格差，不是收益'
const FORECAST_MODE_TEXT = '事后对照（只有发布日期，没有发布时刻，不能当事前回测）'
const PROGRESS_NO_FAKE_COMPARE_TEXT = '本期值见「供需与水电」区块；参考期不完整时不显示环比'
const PAGE_BUILDING_TEXT = '该详情页正在建设，尚未开通'

// 电网事件摘要（dljy#3102，任务 10.7）：与电网边界页完整筛选同源同口径；本区块不提供导出，
// 明细以电网边界页为准（页面级导出只覆盖洞察分析区块，披露摘要不伪造全量口径）。
const EVENTS_SUMMARY_NOTE_TEXT = '摘要与电网边界页完整筛选同源同口径；导出不等于当前页，明细以电网边界页为准'
const EVENTS_IDENTITY_MISSING_TEXT = '身份归并结果未提供：独立事件数暂缺，只显示原始记录数'
const EVENTS_EMPTY_TEXT = '当前窗口内没有计划检修、实际干预或故障的披露记录'
const EVENTS_PLAN_TITLE = '计划检修（检修计划与电网检修信息）'
const EVENTS_ACTUAL_TITLE = '实际干预（人工干预与非计划停运）'
const EVENTS_RECENT_TITLE = '最近 3 条（窗口内停电时间最晚）'
/** 与电网边界页检修干预页签同一批类别：计划=maintenance，实际=intervention+outage。 */
const EVENTS_CATEGORY = 'maintenance,intervention,outage'
const EVENTS_PAGE_SIZE = 100
/** 披露类别 → 业务名（与电网边界页检修干预页签一致）。 */
const DISCLOSURE_CATEGORY_TEXT: Record<string, string> = {
  maintenance: '计划检修',
  intervention: '人工干预',
  outage: '非计划停运',
}

/** 规则评估状态 → 业务话术（insufficient-data/not-applicable 带后端原因原文）。 */
const RULE_STATUS_TEXT: Record<string, string> = {
  triggered: '已触发',
  'not-triggered': '未达阈值',
  'insufficient-data': '数据不足',
  'not-applicable': '不适用',
}

/** 重点事项 coverage 键 → 业务名（其余键不展示，避免口径不明的数字）。 */
const COVERAGE_LABELS: Record<string, string> = {
  validHours: '有效小时',
  commonHours: '共同有效小时',
  comparedSlots: '对比时段数',
}

/** 预测条目的类别 → 业务名。 */
const FORECAST_CATEGORY_TEXT: Record<string, string> = {
  load: '负荷预测',
  'new-energy': '新能源日前预测',
  'non-market': '非市场预测',
}

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()
const router = useRouter()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)
// 入口锚定（dljy#3134）：能力目录就绪且存在获权分析才扫描——公共账号零请求红线保持。
const anchorReady = computed(() => (capabilities.value?.analyses?.some((entry) => entry.access === 'company') ?? false))
const entryAnchor = useInsightEntryAnchor(ctx, { ready: anchorReady })

/** 窗口上限取最紧的分析（overview.key-items 限 7 天）。 */
const keyItemsDef = getInsightAnalysis('overview.key-items')
const maxDays = computed(() => keyItemsDef?.limits.maxDays ?? 7)

/** 能力目录里没有的区块直接不显示（公共账号看不到获权区块，也不发请求）。 */
const visibleBlocks = computed(() =>
  OVERVIEW_BLOCKS.filter((block) => capabilities.value?.analyses.some((entry) => entry.analysisId === block.analysisId) ?? false)
)

function blockVisible(blockId: string): boolean {
  return visibleBlocks.value.some((block) => block.blockId === blockId)
}

/** 能力目录来源 → 业务标题目录（区块标签、证据抽屉、序列命名共用）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

function seriesLabelOf(meta: InsightSeriesMeta): string {
  return insightSourceTitle(meta.sourceId, sourceTitles.value)?.title ?? insightSeriesName(meta)
}

/** 当日/历史模式（OV01：恢复历史时显式显示完整日期）。 */
const windowModeText = computed(() => {
  const window = ctx.businessWindow.value
  const today = beijingToday()
  return window.start === today && window.end === today ? '当日模式' : `历史模式：${window.start} ~ ${window.end}`
})

async function loadCapabilities(): Promise<void> {
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (!result) return
    capabilities.value = result
    ensureAllBlocks()
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
}

// ── 逐块查询（同签名去重；上下文变化全部作废重查）──────────────────────────────────────

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

const viewStates = reactive<Record<string, ViewState>>(
  Object.fromEntries(OVERVIEW_BLOCKS.map((block) => [block.blockId, blankState()]))
)

function queryKeyOf(blockId: string): string {
  return [blockId, ctx.contextVersion.value].join('|')
}

/** 单视图分析不送 view 筛选（契约只在多视图分析上登记 view 校验）。 */
function filtersOf(block: { analysisId: string; view: string }): Record<string, unknown> {
  const def = getInsightAnalysis(block.analysisId)
  return def && def.views.length > 1 ? { view: block.view } : {}
}

function ensureAllBlocks(): void {
  for (const block of visibleBlocks.value) ensureQuery(block.blockId)
}

function ensureQuery(blockId: string): void {
  if (!capabilities.value || capabilitiesError.value) return
  if (!blockVisible(blockId)) return
  const key = queryKeyOf(blockId)
  const entry = viewStates[blockId]
  if (entry.queriedKey === key) return // 有结果或已按此键失败过：不自动重查（重试由用户触发）
  void runQuery(blockId)
}

async function runQuery(blockId: string): Promise<void> {
  const block = OVERVIEW_BLOCKS.find((entry) => entry.blockId === blockId)
  if (!block) return
  const key = queryKeyOf(blockId)
  const entry = viewStates[blockId]
  const request = { analysisId: block.analysisId, context: ctx.toQueryContext(), filters: filtersOf(block) }
  entry.loading = true
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => queryInsight(request, { signal }))
    if (!result || queryKeyOf(blockId) !== key) return // 作废/迟到：不写状态
    entry.result = result
    entry.queriedKey = key
  } catch (error) {
    if (queryKeyOf(blockId) !== key) return
    entry.error = error as InsightRequestError
    entry.queriedKey = key // 失败也记键：同样条件下不自动反复重试
  } finally {
    if (queryKeyOf(blockId) === key) entry.loading = false
  }
}

function retryQuery(blockId: string): void {
  viewStates[blockId].queriedKey = ''
  ensureQuery(blockId)
}

// 上下文变化（窗口/地区/公司）：所有旧结果属于另一份读取，全部作废重查；
// 电网事件摘要与洞察能力目录无关，单独作废重查（OV02：它不是洞察分析区块）。
watch(
  () => ctx.contextVersion.value,
  () => {
    for (const blockId of Object.keys(viewStates)) Object.assign(viewStates[blockId], blankState())
    Object.assign(eventsState, { overview: null, recent: [], loading: false, error: null, queriedKey: '' })
    if (capabilities.value) ensureAllBlocks()
    ensureEventsQuery()
  }
)

onMounted(() => {
  void loadCapabilities()
  ensureEventsQuery()
})

// ── 下钻（OV05：带同一业务日期到详情页）────────────────────────────────────────────────

type DrilldownTarget = { analysisId: string; view: string; window?: { start: string; end: string } }

/** 事项/区块的下钻目标页：按 OVERVIEW_BLOCKS 的同分析同视图条目解析，不猜。 */
function drilldownPageOf(target: DrilldownTarget): InsightPageId | null {
  const block = OVERVIEW_BLOCKS.find((entry) => entry.analysisId === target.analysisId && entry.view === target.view)
  return (block as { drilldownPageId?: InsightPageId } | undefined)?.drilldownPageId ?? null
}

function drilldown(pageId: InsightPageId, window?: { start: string; end: string }): void {
  const target = window ?? ctx.businessWindow.value
  // 统一下钻上下文（dljy#3087，任务 15.1）：业务窗 + 对象/来源（共享四键语义）+ hx_from
  // 返回锚点，由 insightHandoff 统一编码与校验（非法字段抛契约错误、超长丢弃可选字段）。
  // dropped 清单只可能出现在 URL 超长的极端场景；总览当前载荷（窗口/对象/来源/from）不含
  // 大列表，不接 UI。目标页经 useInsightContext 的下钻恢复入口解析（CH01 返回闭环）。
  const { query } = buildInsightDrilldownQuery({
    start: target.start,
    end: target.end,
    objects: [...ctx.objectIds.value],
    sources: [...ctx.sourceIds.value],
    from: 'overview',
  })
  void router.push({ path: INSIGHT_PAGE_PATHS[pageId], query })
}

function blockDrilldown(blockId: string): void {
  const block = OVERVIEW_BLOCKS.find((entry) => entry.blockId === blockId)
  const pageId = (block as { drilldownPageId?: InsightPageId } | undefined)?.drilldownPageId
  if (pageId) drilldown(pageId)
}

function onItemDrilldown(item: KeyItem): void {
  if (!item.drilldown) return
  const pageId = drilldownPageOf(item.drilldown)
  if (pageId) drilldown(pageId, item.drilldown.window)
}

// ── 重点事项（OV03）与同进度比较（OV04）─────────────────────────────────────────────────

type KeyItem = {
  itemId: string
  rank: number
  ruleId: string
  title: string
  statement: string
  interval: { start: string; end: string }
  observation: { metricId: string; value: string; unit: string }
  baseline: Record<string, unknown> | null
  coverage: Record<string, string> | null
  drilldown: DrilldownTarget | null
}

type KeyRule = {
  ruleId: string
  title: string
  status: string
  reason: string | null
  triggered: number
  description: string
}

type ProgressComparison = {
  status: string
  reason?: string
  progressEnd?: string
  current?: string
  previous?: string
  changePercent?: string
}

/** key-items 视图的特有字段（共享契约的 ResultData 是各视图并集的宽松类型，这里显式窄化）。 */
type KeyItemsData = {
  items?: KeyItem[]
  rules?: KeyRule[]
  comparisons?: ProgressComparison[]
  notes?: Array<{ note?: string }>
}

function keyItemsDataOf(): KeyItemsData {
  return (viewStates['key-items'].result?.data ?? {}) as unknown as KeyItemsData
}

const keyItems = computed(() => keyItemsDataOf().items ?? [])
const keyRules = computed(() => keyItemsDataOf().rules ?? [])
const keyNotes = computed(() =>
  (keyItemsDataOf().notes ?? [])
    .map((item) => item.note ?? '')
    .filter(Boolean)
)
const progressComparison = computed(() => keyItemsDataOf().comparisons?.[0] ?? null)

function ruleStatusText(rule: KeyRule): string {
  const base = RULE_STATUS_TEXT[rule.status] ?? rule.status
  if (rule.status === 'triggered') return `${base}（${rule.triggered} 条）`
  return rule.reason ? `${base}：${rule.reason}` : base
}

function observationText(item: KeyItem): string {
  const unit = getMetricDefinition(item.observation.metricId)?.unit ?? item.observation.unit
  const shown = formatMetricValue(item.observation.metricId, item.observation.value)
  return shown === null || shown === undefined ? '—' : `${shown}${unit && unit !== 'count' ? ` ${unit}` : ''}`
}

function baselineText(baseline: Record<string, unknown> | null): string {
  if (!baseline) return '—'
  if (baseline.kind === 'threshold') {
    return `阈值 ${String(baseline.value ?? '—')}${baseline.unit ? ` ${String(baseline.unit)}` : ''}`
  }
  if (baseline.kind === 'window-quantile') {
    return `窗口分位：价格 ≤ ${String(baseline.priceThreshold ?? '—')}，新能源 ≥ ${String(baseline.newEnergyThreshold ?? '—')}`
  }
  if (baseline.kind === 'previous-day-same-progress') {
    return `前一日同时段均值 ${String(baseline.value ?? '—')}${baseline.unit ? ` ${String(baseline.unit)}` : ''}`
  }
  return '—'
}

function coverageText(coverage: Record<string, string> | null): string {
  if (!coverage) return '—'
  const parts: string[] = []
  for (const [key, value] of Object.entries(coverage)) {
    if (COVERAGE_LABELS[key]) parts.push(`${COVERAGE_LABELS[key]} ${value}`)
  }
  return parts.length ? parts.join('；') : '—'
}

function intervalText(interval: { start: string; end: string } | null | undefined): string {
  if (!interval?.start) return '—'
  return interval.end ? `${formatBeijingDateTime(interval.start)} ~ ${formatBeijingDateTime(interval.end)}` : formatBeijingDateTime(interval.start)
}

/** 同进度比较卡：ok 给完整对比；否则只说明原因，不显示环比（本期值在供需区块）。 */
const progressText = computed(() => {
  const comparison = progressComparison.value
  if (!comparison) return ''
  if (comparison.status === 'ok' && comparison.current != null && comparison.previous != null && comparison.changePercent != null) {
    const change = Number(comparison.changePercent)
    const direction = change >= 0 ? '高' : '低'
    const abs = formatMetricValue('supply.progress-change', String(Math.abs(change)))
    return `截至 ${comparison.progressEnd ? formatBeijingDateTime(comparison.progressEnd) : '—'}，云南统调负荷平均 ${formatMetricValue('supply.mean-power', comparison.current)} MW；前一日同时段 ${formatMetricValue('supply.mean-power', comparison.previous)} MW，${direction} ${abs}%`
  }
  const reason = comparison.reason ?? '没有可比较的同时段'
  return `${comparison.progressEnd ? `本期已发布至 ${formatBeijingDateTime(comparison.progressEnd)}；` : ''}${reason}（不显示环比）`
})

// ── 摘要卡片（价格 / 价差 / 供需 / 预测：来自各视图的 rows 或 tables.summary）──────────

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null }

type StatCardRow = { metricId: string; label: string; text: string; unit: string; note: string }
type StatCard = { key: string; title: string; note: string; rows: StatCardRow[] }

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

/** rows（或 tables.summary.rows）→ seriesId → metricId → 行。 */
function indexMetricRows(result: InsightBlockResult | null, tableId?: string): Map<string, Map<string, MetricRow>> {
  const map = new Map<string, Map<string, MetricRow>>()
  if (!result?.data) return map
  const source = tableId
    ? ((result.data.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined)?.[tableId]?.rows ?? [])
    : (result.data.rows ?? [])
  for (const row of source as unknown as MetricRow[]) {
    const own = map.get(row.seriesId) ?? new Map<string, MetricRow>()
    own.set(row.metricId, row)
    map.set(row.seriesId, own)
  }
  return map
}

type LooseSeriesMeta = InsightSeriesMeta & { kind?: string | null; category?: string | null }

function seriesCatalogOf(result: InsightBlockResult | null): LooseSeriesMeta[] {
  return (result?.data?.series ?? []) as LooseSeriesMeta[]
}

const PRICE_METRICS = ['price.time-weighted-average', 'price.minimum', 'price.maximum', 'price.negative-duration', 'sample.valid-hours'] as const
const SPREAD_METRICS = [
  'price.da-rt-spread', 'price.da-rt-spread-abs-mean', 'price.da-rt-spread-maximum', 'price.da-rt-spread-minimum',
  'price.da-rt-spread-positive-share', 'sample.common-hours',
] as const
const SUPPLY_METRICS = ['supply.mean-power', 'supply.minimum', 'supply.maximum', 'sample.valid-hours'] as const
const SHARE_METRICS = ['supply.hydro-share', 'sample.common-hours'] as const
const FORECAST_METRICS = ['forecast.mae', 'forecast.bias', 'sample.common-hours'] as const

/** 价格概况卡：用户侧日前/实时各一张（summary 视图 rows）。 */
const priceCards = computed<StatCard[]>(() => {
  const result = viewStates['prices'].result
  if (!result?.data) return []
  const rows = indexMetricRows(result)
  const cards: StatCard[] = []
  for (const meta of seriesCatalogOf(result)) {
    const own = rows.get(meta.seriesId)
    if (!own) continue
    cards.push({
      key: meta.seriesId,
      title: seriesLabelOf(meta),
      note: '',
      rows: PRICE_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    })
  }
  return cards
})

const priceUnavailable = computed(
  () => (viewStates['prices'].result?.data?.unavailableMetrics ?? []) as Array<{ metricId: string; reason: string }>
)

/** 价差摘要卡：每个配对一张（tables.summary）；异常时段表取前五条。 */
const spreadCards = computed<StatCard[]>(() => {
  const result = viewStates['spread'].result
  if (!result?.data) return []
  const rows = indexMetricRows(result, 'summary')
  const cards: StatCard[] = []
  for (const meta of seriesCatalogOf(result)) {
    if (meta.kind !== 'da-rt-spread') continue
    const own = rows.get(meta.seriesId)
    if (!own) continue
    cards.push({
      key: meta.seriesId,
      title: '日前 − 实时价差（用户侧，共同有效时段）',
      note: SPREAD_IS_NOT_REVENUE_TEXT,
      rows: SPREAD_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    })
  }
  return cards
})

const spreadAnomalies = computed(() => {
  const result = viewStates['spread'].result
  const rows = (result?.data?.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined)?.anomalies?.rows ?? []
  return (rows as unknown as Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string; rank: string }>)
    .slice(0, 5)
    .map((row) => ({ rank: row.rank, time: intervalText({ start: row.intervalStart, end: row.intervalEnd }), value: row.value }))
})

const spreadUnpaired = computed(() => {
  const unpaired = (viewStates['spread'].result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => {
    const sourceId = item.seriesId.split('|')[0] ?? ''
    const title = insightSourceTitle(sourceId, sourceTitles.value)?.title ?? item.seriesId
    return `${title}：${item.reason}`
  })
})

/** 供需概况卡：云南实际序列（南网背景与预测不进总览卡）+ 水电占比卡。 */
const supplyCards = computed<StatCard[]>(() => {
  const result = viewStates['supply'].result
  if (!result?.data) return []
  const rows = indexMetricRows(result)
  const cards: StatCard[] = []
  for (const meta of seriesCatalogOf(result)) {
    const own = rows.get(meta.seriesId)
    if (!own) continue
    if (meta.seriesId.startsWith('share:hydro:')) {
      if (meta.businessScope !== 'yunnan') continue
      cards.push({
        key: meta.seriesId,
        title: '水电占比（云南，同一业务范围）',
        note: '水电 / 总发电（共同有效时段按时长加权）',
        rows: SHARE_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
      })
      continue
    }
    if (meta.businessScope !== 'yunnan' || meta.variant === 'forecast') continue
    cards.push({
      key: meta.seriesId,
      title: seriesLabelOf(meta),
      note: '',
      rows: SUPPLY_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    })
  }
  return cards
})

/** 预测配对条目（forecast-error 视图的目录形状：配对身份与资格字段）。 */
type ForecastPairEntry = LooseSeriesMeta & {
  direction?: string
  forecastSeriesId?: string
  actualSeriesId?: string
  mode?: string
  eligibility?: { samples?: number; expectedSamples?: number; coverageRatio?: number; eligible?: boolean }
}

/** 预测配对的业务名：类别优先（负荷预测/新能源日前预测），兜底配对来源标题。 */
function pairLabelOf(pair: ForecastPairEntry): string {
  if (pair.category && FORECAST_CATEGORY_TEXT[pair.category]) return FORECAST_CATEGORY_TEXT[pair.category]!
  const sourceId = pair.seriesId.split('|')[0] ?? ''
  return insightSourceTitle(sourceId, sourceTitles.value)?.title ?? insightSeriesName(pair)
}

/** 预测与实际卡：每个配对一张（MAE/偏差/共同时长）+ 资格说明。 */
type ForecastPairCard = StatCard & { eligibility: string }

const forecastCards = computed<ForecastPairCard[]>(() => {
  const result = viewStates['forecast'].result
  if (!result?.data) return []
  const rows = indexMetricRows(result, 'summary')
  const cards: ForecastPairCard[] = []
  for (const pair of seriesCatalogOf(result) as ForecastPairEntry[]) {
    if (pair.kind !== 'forecast-error') continue
    const own = rows.get(pair.seriesId)
    const eligibility = pair.eligibility
    const eligibilityText = eligibility
      ? `有效样本 ${eligibility.samples ?? 0}/${eligibility.expectedSamples ?? 0}，覆盖率 ${Math.round((eligibility.coverageRatio ?? 0) * 100)}%${eligibility.eligible ? '' : '；可查看，不参与排名'}`
      : ''
    cards.push({
      key: pair.seriesId,
      title: pairLabelOf(pair),
      note: FORECAST_MODE_TEXT,
      rows: FORECAST_METRICS.map((metricId) => metricCardRow(metricId, own?.get(metricId))),
      eligibility: eligibilityText,
    })
  }
  return cards
})

const forecastUnpaired = computed(() => {
  const unpaired = (viewStates['forecast'].result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => {
    const sourceId = item.seriesId.split('|')[0] ?? ''
    const title = insightSourceTitle(sourceId, sourceTitles.value)?.title ?? item.seriesId
    return `${title}：${item.reason}`
  })
})

// ── 电网事件摘要（dljy#3102，任务 10.7，GB04 + OV02/OV03）───────────────────────────────
// 与电网边界页检修干预页签（10.6）消费同一批 grid-geo 披露事件接口，不重建事件事实库、
// 不经洞察分析查询：计划（maintenance）与实际（intervention+outage）分组与该页一致；
// 独立事件数来自后端 identity 归并汇总（身份不足的保留未归并，不猜测合并），后端未返回
// 归并汇总时只显示原始数并如实说明（OV03：无事实不硬凑卡片）；最近三条取窗口内停电时间
// 最晚的记录；下钻只带业务窗口跳电网边界页（检修干预页签由该页承载）。

/** identity 归并汇总（新版读模型字段）：前向兼容收窄，缺失时诚实降级，不硬凑。 */
type DisclosureIdentityCounts = {
  rawCount?: number | null
  distinctCount?: number | null
  unidentifiedCount?: number | null
  byCategory?: Record<string, { rawCount?: number | null; distinctCount?: number | null; unidentifiedCount?: number | null } | null> | null
  note?: string | null
}

type DisclosureEventIdentity = { version?: number; versions?: number } | null

type EventsOverview = GridDisclosureOverview & { identity?: DisclosureIdentityCounts | null }
type EventsRecentRow = {
  eventId: string
  title: string
  categoryText: string
  timeBasisText: string
  startText: string
  endText: string
  versionText: string
}

const eventsState = reactive<{ overview: EventsOverview | null; recent: EventsRecentRow[]; loading: boolean; error: string | null; queriedKey: string }>({
  overview: null,
  recent: [],
  loading: false,
  error: null,
  queriedKey: '',
})

function eventsKeyOf(): string {
  return ['events-summary', ctx.contextVersion.value].join('|')
}

/** 时间列：解析不了的起止如实「未提供」，不推断精确停复电时刻（GB04）。 */
function disclosureTimeText(value: string | null | undefined): string {
  return value && parseDisclosureTime(value) !== null ? formatBeijingDateTime(value) : '未提供'
}

/** 同一事件被重复披露的版本标注（identity=annotate 返回）；只有一版不显示。 */
function disclosureVersionText(event: GridDisclosureEvent & { identity?: DisclosureEventIdentity }): string {
  const identity = event.identity
  if (!identity || !(Number(identity.versions) > 1)) return ''
  return `第 ${identity.version} 版 / 共 ${identity.versions} 版`
}

/** 最近三条：窗口内停电时间最晚（start-asc 排序取尾页尾部）；记录超过一页时取末页。 */
async function loadEventsRecent(key: string): Promise<void> {
  const window = ctx.businessWindow.value
  const baseParams = {
    category: EVENTS_CATEGORY,
    identity: 'annotate',
    sort: 'start-asc',
    from: window.start,
    to: window.end,
    pageSize: EVENTS_PAGE_SIZE,
  }
  const first = await fetchGridDisclosureEvents(baseParams)
  if (eventsKeyOf() !== key) return
  let items = first.items ?? []
  if (Number(first.total ?? items.length) > EVENTS_PAGE_SIZE) {
    const last = await fetchGridDisclosureEvents({ ...baseParams, page: Math.ceil(Number(first.total) / EVENTS_PAGE_SIZE) })
    if (eventsKeyOf() !== key) return
    items = last.items ?? items
  }
  eventsState.recent = items.slice(-3).reverse().map((event) => ({
    eventId: event.eventId,
    title: event.title,
    categoryText: DISCLOSURE_CATEGORY_TEXT[event.category] ?? event.category,
    timeBasisText: maintenanceTimeBasis(event),
    startText: disclosureTimeText(event.effectiveAt),
    endText: disclosureTimeText(event.expiresAt),
    versionText: disclosureVersionText(event),
  }))
}

async function runEventsQuery(): Promise<void> {
  const key = eventsKeyOf()
  eventsState.loading = true
  eventsState.error = null
  try {
    const window = ctx.businessWindow.value
    const overview = (await fetchGridDisclosureOverview({
      category: EVENTS_CATEGORY,
      identity: 'annotate',
      from: window.start,
      to: window.end,
    })) as EventsOverview
    if (eventsKeyOf() !== key) return // 作废/迟到：不写状态
    eventsState.overview = overview
    eventsState.queriedKey = key
    // 未接入 / 窗口内没有记录：诚实空态，不再拉明细（OV03）。
    const availability = overview.dataAvailability?.status ?? 'missing'
    if (availability !== 'available' || !overview.total) return
    await loadEventsRecent(key)
  } catch (error) {
    if (eventsKeyOf() !== key) return
    eventsState.error = error instanceof Error ? error.message : String(error)
    eventsState.queriedKey = key // 失败也记键：同口径不自动重查，重试由用户触发
  } finally {
    if (eventsKeyOf() === key) eventsState.loading = false
  }
}

function ensureEventsQuery(): void {
  if (eventsState.queriedKey === eventsKeyOf()) return
  void runEventsQuery()
}

function retryEventsQuery(): void {
  eventsState.queriedKey = ''
  ensureEventsQuery()
}

const eventsIdentity = computed<DisclosureIdentityCounts | null>(() => eventsState.overview?.identity ?? null)

/** 归并汇总返回了才有独立事件数；缺失时只显示原始数并说明（OV03）。 */
const eventsIdentityAvailable = computed(() => {
  const identity = eventsIdentity.value
  return Boolean(identity && typeof identity.rawCount === 'number')
})

const eventsCountsText = computed(() => {
  const overview = eventsState.overview
  if (!overview) return ''
  const identity = eventsIdentity.value
  const raw = typeof identity?.rawCount === 'number' ? identity.rawCount : (overview.total ?? null)
  if (raw === null) return ''
  const parts = [`原始记录 ${Number(raw).toLocaleString('zh-CN')} 条`]
  if (typeof identity?.distinctCount === 'number') parts.push(`独立事件 ${Number(identity.distinctCount).toLocaleString('zh-CN')} 条`)
  const unidentified = Number(identity?.unidentifiedCount ?? 0)
  if (unidentified > 0) parts.push(`${unidentified.toLocaleString('zh-CN')} 条身份不足、保留未归并`)
  return parts.join('；')
})

type EventsGroupCounts = { raw: number | null; distinct: number | null; unidentified: number | null }

/** 计划=maintenance；实际=intervention+outage（分组与电网边界页检修干预页签一致）。 */
function eventsGroupCountsOf(kind: 'plan' | 'actual'): EventsGroupCounts {
  const categories = kind === 'plan' ? ['maintenance'] : ['intervention', 'outage']
  const byCategory = eventsIdentity.value?.byCategory
  if (byCategory) {
    let raw = 0
    let distinct = 0
    let unidentified = 0
    let present = false
    for (const category of categories) {
      const entry = byCategory[category]
      if (!entry) continue
      present = true
      raw += entry.rawCount ?? 0
      distinct += entry.distinctCount ?? 0
      unidentified += entry.unidentifiedCount ?? 0
    }
    if (present) return { raw, distinct, unidentified }
  }
  // 归并汇总缺失：按类别的原始计数兜底（countsByCategory），独立事件数如实缺省。
  const counts = eventsState.overview?.countsByCategory
  if (!counts) return { raw: null, distinct: null, unidentified: null }
  const raw = categories.reduce((sum, category) => sum + (counts[category as keyof typeof counts] ?? 0), 0)
  return { raw, distinct: null, unidentified: null }
}

const eventsPlanCounts = computed(() => eventsGroupCountsOf('plan'))
const eventsActualCounts = computed(() => eventsGroupCountsOf('actual'))

/** 空态原因：未接入 / 未导入 / 窗口内没有披露事件；有原因就不渲染计数与最近列表（OV03）。 */
const eventsEmptyReason = computed(() => {
  const overview = eventsState.overview
  if (!overview) return ''
  const availability = overview.dataAvailability
  if ((availability?.status ?? 'missing') !== 'available') {
    const reason = availability?.reason ?? '披露事件读取结果不可用'
    return availability?.status === 'not-configured' ? `披露事件源未接入：${reason}` : `当前窗口内没有已导入的披露记录：${reason}`
  }
  if (!overview.total) return EVENTS_EMPTY_TEXT
  return ''
})

// ── 证据抽屉与历史候选（按区块所属分析求候选，不混五月与八月）──────────────────────────

const evidenceVisible = ref(false)
const evidenceTarget = ref<InsightBlockResult | null>(null)

function openEvidence(blockId: string): void {
  evidenceTarget.value = viewStates[blockId].result
  evidenceVisible.value = true
}

const candidatesVisible = ref(false)
const candidatesBlockId = ref<string | null>(null)

function openCandidates(blockId: string): void {
  candidatesBlockId.value = blockId
  candidatesVisible.value = true
}

const candidatesBlock = computed(() => OVERVIEW_BLOCKS.find((entry) => entry.blockId === candidatesBlockId.value) ?? null)

const candidatesFilters = computed(() => (candidatesBlock.value ? filtersOf(candidatesBlock.value) : {}))

/** 候选的必需来源：key-items 全量；供需摘要按云南实际；预测按负荷/新能源的预测+实际。 */
function requiredSourceIdsOf(block: { analysisId: string; view: string }): string[] {
  const def = getInsightAnalysis(block.analysisId)
  const ids = [...(def?.sourceIds ?? [])]
  if (block.analysisId === 'supply.system-series') {
    if (block.view === 'forecast-error') {
      const needed = new Set(['yn.system.load.forecast', 'yn.system.load.actual', 'yn.system.new-energy.forecast-d1', 'yn.system.new-energy.actual'])
      return ids.filter((id) => needed.has(id))
    }
    return ids.filter((id) => {
      const source = getInsightSource(id)
      return source?.businessScope === 'yunnan' && source.variant === 'actual'
    })
  }
  return ids
}

const candidatesRequiredSourceIds = computed(() => (candidatesBlock.value ? requiredSourceIdsOf(candidatesBlock.value) : []))

function onCandidateSelect(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 采集只收「当前签名一致」的已就绪区块（insightAiBlockOf 内拒绝过期与无权区块），只传
// 摘要与版本引用，不传原始行数据；组装期间上下文变化即作废，不带旧资料派发。

const insightAi = useInsightAiPage({
  pageId: 'overview',
  label: '云南市场总览',
  collect: () =>
    visibleBlocks.value.flatMap((block) => {
      const entry = viewStates[block.blockId]
      const aiBlock = insightAiBlockOf({
        blockId: block.blockId,
        title: block.title,
        analysisId: block.analysisId,
        view: block.view,
        currentKey: queryKeyOf(block.blockId),
        queriedKey: entry.queriedKey,
        result: entry.result,
      })
      return aiBlock ? [aiBlock] : []
    }),
  currentSignature: () => String(ctx.contextVersion.value),
})

const onAiInterpret = (): void => {
  void insightAi.interpret()
}
</script>

<template>
  <div class="yno-overview">
    <!-- 顶部：日期窗与模式说明 -->

    <InsightAnchorNotice
      v-if="entryAnchor.anchorNotice.value"
      :notice="entryAnchor.anchorNotice.value"
      @back-today="entryAnchor.backToToday"
      @dismiss="entryAnchor.dismissAnchorNotice"
    />
    <section class="yno-overview__controls">
      <label class="yno-overview__field">
        <span>业务日期窗</span>
        <InsightDateRange
          :model-value="ctx.businessWindow.value"
          :max-days="maxDays"
          @update:model-value="(next: { start: string; end: string }) => ctx.setBusinessWindow(next.start, next.end)"
        />
      </label>
      <span class="yno-overview__mode" data-testid="yno-window-mode">{{ windowModeText }}</span>
      <!-- AI 入口（15.3）：模型离线只隐藏入口，数据页不受影响（D9） -->
      <el-button
        v-if="insightAi.aiAvailable.value"
        type="primary"
        data-testid="yno-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
    </section>

    <p class="yno-overview__meta">{{ PAGE_NOTE_TEXT }}</p>

    <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="能力目录读取失败">
      <p class="yno-overview__hint">当前看不到可用的总览区块；可重试，不影响已就绪区块的展示。</p>
      <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
    </el-alert>

    <!-- 重点事项：最多五条 + 规则评估 + 同进度比较 -->
    <InsightBlock
      v-if="blockVisible('key-items')"
      title="重点事项（最多五条，无满足条件不凑数）"
      :result="viewStates['key-items'].result"
      :error="viewStates['key-items'].error"
      :loading="viewStates['key-items'].loading"
      :on-retry="() => retryQuery('key-items')"
      :on-refresh="() => retryQuery('key-items')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('key-items')"
      @open-evidence="openEvidence('key-items')"
    >
      <el-empty v-if="!keyItems.length" :description="NO_KEY_ITEMS_TEXT" :image-size="72" data-testid="yno-key-items-empty" />
      <ol v-else class="yno-overview__items">
        <li v-for="item in keyItems" :key="item.itemId" class="yno-overview__item" :data-testid="`yno-key-item-${item.rank}`">
          <div class="yno-overview__item-head">
            <span class="yno-overview__item-rank">#{{ item.rank }}</span>
            <span class="yno-overview__item-title">{{ item.title }}</span>
            <el-button
              v-if="item.drilldown && drilldownPageOf(item.drilldown)"
              size="small"
              text
              type="primary"
              :data-testid="`yno-key-item-drill-${item.rank}`"
              @click="onItemDrilldown(item)"
            >
              查看详情
            </el-button>
          </div>
          <p class="yno-overview__item-statement">{{ item.statement }}</p>
          <dl class="yno-overview__item-grid">
            <dt>时段</dt>
            <dd>{{ intervalText(item.interval) }}</dd>
            <dt>观测</dt>
            <dd>{{ observationText(item) }}</dd>
            <dt>基线</dt>
            <dd>{{ baselineText(item.baseline) }}</dd>
            <dt>覆盖</dt>
            <dd>{{ coverageText(item.coverage) }}</dd>
          </dl>
        </li>
      </ol>

      <!-- 同进度比较：参考期不完整时只说明原因，不显示环比 -->
      <div v-if="progressComparison" class="yno-overview__progress" data-testid="yno-progress">
        <h4>负荷同进度比较（与前一日同一时段）</h4>
        <p>{{ progressText }}</p>
        <p v-if="progressComparison.status !== 'ok'" class="yno-overview__hint">{{ PROGRESS_NO_FAKE_COMPARE_TEXT }}</p>
      </div>

      <!-- 规则评估：为什么没有这一条 -->
      <el-collapse class="yno-overview__rules">
        <el-collapse-item name="rules">
          <template #title>
            <span class="yno-overview__rules-title">规则评估（每条规则的触发状态与原因）</span>
          </template>
          <ul class="yno-overview__rule-list">
            <li v-for="rule in keyRules" :key="rule.ruleId" :data-testid="`yno-rule-${rule.ruleId}`">
              <span class="yno-overview__rule-name">{{ rule.title }}</span>
              <span class="yno-overview__rule-status">{{ ruleStatusText(rule) }}</span>
              <span class="yno-overview__rule-desc">{{ rule.description }}</span>
            </li>
          </ul>
        </el-collapse-item>
      </el-collapse>

      <el-alert v-for="(note, index) in keyNotes" :key="`kn-${index}`" type="info" :closable="false" :title="note" />
    </InsightBlock>

    <!-- 价格概况：用户侧日前/实时摘要卡，下钻价格页 -->
    <InsightBlock
      v-if="blockVisible('prices')"
      title="价格概况（用户侧日前/实时）"
      :result="viewStates['prices'].result"
      :error="viewStates['prices'].error"
      :loading="viewStates['prices'].loading"
      :on-retry="() => retryQuery('prices')"
      :on-refresh="() => retryQuery('prices')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('prices')"
      @open-evidence="openEvidence('prices')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-prices-drilldown" @click="blockDrilldown('prices')">进入价格与价差页</el-button>
      </div>
      <el-alert
        v-for="(item, index) in priceUnavailable"
        :key="`pu-${index}`"
        type="info"
        :closable="false"
        :title="`${getMetricDefinition(item.metricId)?.label ?? item.metricId} 不可用：${item.reason}`"
      />
      <div v-if="priceCards.length" class="yno-overview__cards">
        <div v-for="card in priceCards" :key="card.key" class="yno-overview__card">
          <h4 class="yno-overview__card-title">{{ card.title }}</h4>
          <dl class="yno-overview__card-grid">
            <template v-for="row in card.rows" :key="row.metricId">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
            </template>
          </dl>
        </div>
      </div>
    </InsightBlock>

    <!-- 日前实时价差：配对摘要 + 异常时段表，下钻价格页 -->
    <InsightBlock
      v-if="blockVisible('spread')"
      title="日前实时价差（共同有效时段）"
      :result="viewStates['spread'].result"
      :error="viewStates['spread'].error"
      :loading="viewStates['spread'].loading"
      :on-retry="() => retryQuery('spread')"
      :on-refresh="() => retryQuery('spread')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('spread')"
      @open-evidence="openEvidence('spread')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-spread-drilldown" @click="blockDrilldown('spread')">进入价格与价差页</el-button>
      </div>
      <el-alert v-for="(item, index) in spreadUnpaired" :key="`su-${index}`" type="warning" :closable="false" :title="`未配对：${item}`" />
      <div v-if="spreadCards.length" class="yno-overview__cards">
        <div v-for="card in spreadCards" :key="card.key" class="yno-overview__card">
          <h4 class="yno-overview__card-title">{{ card.title }}</h4>
          <dl class="yno-overview__card-grid">
            <template v-for="row in card.rows" :key="row.metricId">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
            </template>
          </dl>
          <p class="yno-overview__card-note">{{ card.note }}</p>
        </div>
      </div>
      <el-table v-if="spreadAnomalies.length" :data="spreadAnomalies" size="small" border max-height="240" data-testid="yno-spread-anomalies">
        <el-table-column prop="rank" label="序" width="60" />
        <el-table-column prop="time" label="时段" min-width="220" />
        <el-table-column prop="value" label="价差（元/MWh）" width="140" align="right" />
      </el-table>
    </InsightBlock>

    <!-- 供需与水电概况：云南实际序列摘要 + 水电占比，下钻供需页 -->
    <InsightBlock
      v-if="blockVisible('supply')"
      title="供需与水电概况（云南实际）"
      :result="viewStates['supply'].result"
      :error="viewStates['supply'].error"
      :loading="viewStates['supply'].loading"
      :on-retry="() => retryQuery('supply')"
      :on-refresh="() => retryQuery('supply')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('supply')"
      @open-evidence="openEvidence('supply')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-supply-drilldown" @click="blockDrilldown('supply')">进入供需与水电页</el-button>
      </div>
      <div v-if="supplyCards.length" class="yno-overview__cards">
        <div
          v-for="card in supplyCards"
          :key="card.key"
          class="yno-overview__card"
          :class="{ 'yno-overview__card--share': card.key.startsWith('share:') }"
        >
          <h4 class="yno-overview__card-title">{{ card.title }}</h4>
          <dl class="yno-overview__card-grid">
            <template v-for="row in card.rows" :key="row.metricId">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
            </template>
          </dl>
          <p v-if="card.note" class="yno-overview__card-note">{{ card.note }}</p>
        </div>
      </div>
    </InsightBlock>

    <!-- 预测与实际：配对误差卡（事后对照），下钻供需页 -->
    <InsightBlock
      v-if="blockVisible('forecast')"
      title="预测与实际（事后对照）"
      :result="viewStates['forecast'].result"
      :error="viewStates['forecast'].error"
      :loading="viewStates['forecast'].loading"
      :on-retry="() => retryQuery('forecast')"
      :on-refresh="() => retryQuery('forecast')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('forecast')"
      @open-evidence="openEvidence('forecast')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-forecast-drilldown" @click="blockDrilldown('forecast')">进入供需与水电页</el-button>
      </div>
      <el-alert v-for="(item, index) in forecastUnpaired" :key="`fu-${index}`" type="warning" :closable="false" :title="`未配对：${item}`" />
      <div v-if="forecastCards.length" class="yno-overview__cards">
        <div v-for="card in forecastCards" :key="card.key" class="yno-overview__card">
          <h4 class="yno-overview__card-title">{{ card.title }}</h4>
          <dl class="yno-overview__card-grid">
            <template v-for="row in card.rows" :key="row.metricId">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
            </template>
          </dl>
          <p v-if="card.eligibility" class="yno-overview__card-note">{{ card.eligibility }}</p>
          <p class="yno-overview__card-note">{{ card.note }}</p>
        </div>
      </div>
    </InsightBlock>

    <!-- 电网事件摘要（10.7）：与电网边界页检修干预页签同一批披露事件接口；
         计划/实际分组 + 最近三条 + 带业务窗口下钻；独立查询独立重试（OV02），
         未接入/无记录诚实空态（OV03） -->
    <InsightBlock
      title="电网事件摘要（计划检修 / 实际干预 / 故障）"
      :result="null"
      :error="null"
      :loading="eventsState.loading"
      :source-titles="sourceTitles"
    >
      <p class="yno-overview__hint" data-testid="yno-events-note">{{ EVENTS_SUMMARY_NOTE_TEXT }}</p>
      <template v-if="eventsState.overview">
        <el-empty v-if="eventsEmptyReason" :description="eventsEmptyReason" :image-size="72" data-testid="yno-events-empty" />
        <template v-else>
        <dl class="yno-overview__item-grid" data-testid="yno-events-counts">
          <dt>窗口内事件</dt>
          <dd>{{ eventsCountsText }}</dd>
        </dl>
        <p v-if="!eventsIdentityAvailable" class="yno-overview__hint" data-testid="yno-events-identity-missing">{{ EVENTS_IDENTITY_MISSING_TEXT }}</p>
        <div class="yno-overview__cards">
          <div class="yno-overview__card" data-testid="yno-events-plan">
            <h4 class="yno-overview__card-title">{{ EVENTS_PLAN_TITLE }}</h4>
            <dl class="yno-overview__card-grid">
              <dt>原始记录</dt>
              <dd>{{ eventsPlanCounts.raw === null ? '—' : `${eventsPlanCounts.raw.toLocaleString('zh-CN')} 条` }}</dd>
              <dt>独立事件</dt>
              <dd>{{ eventsPlanCounts.distinct === null ? '—' : `${eventsPlanCounts.distinct.toLocaleString('zh-CN')} 条` }}</dd>
              <template v-if="eventsPlanCounts.unidentified">
                <dt>身份不足</dt>
                <dd>{{ eventsPlanCounts.unidentified.toLocaleString('zh-CN') }} 条、保留未归并</dd>
              </template>
            </dl>
          </div>
          <div class="yno-overview__card" data-testid="yno-events-actual">
            <h4 class="yno-overview__card-title">{{ EVENTS_ACTUAL_TITLE }}</h4>
            <dl class="yno-overview__card-grid">
              <dt>原始记录</dt>
              <dd>{{ eventsActualCounts.raw === null ? '—' : `${eventsActualCounts.raw.toLocaleString('zh-CN')} 条` }}</dd>
              <dt>独立事件</dt>
              <dd>{{ eventsActualCounts.distinct === null ? '—' : `${eventsActualCounts.distinct.toLocaleString('zh-CN')} 条` }}</dd>
              <template v-if="eventsActualCounts.unidentified">
                <dt>身份不足</dt>
                <dd>{{ eventsActualCounts.unidentified.toLocaleString('zh-CN') }} 条、保留未归并</dd>
              </template>
            </dl>
          </div>
        </div>
        <!-- 明细（最近三条）读取失败只影响这一段：计数来自已就绪的 overview，照常展示（OV02） -->
        <template v-if="eventsState.error">
          <el-alert type="error" :closable="false" show-icon :title="`披露事件明细读取失败：${eventsState.error}`" data-testid="yno-events-error" />
          <div class="yno-overview__bar">
            <el-button size="small" data-testid="yno-events-retry" @click="retryEventsQuery">重试</el-button>
          </div>
        </template>
        <template v-else>
          <div v-if="eventsState.recent.length" class="yno-overview__events" data-testid="yno-events-recent">
          <h4>{{ EVENTS_RECENT_TITLE }}</h4>
          <ol>
            <li v-for="(row, index) in eventsState.recent" :key="row.eventId" :data-testid="`yno-events-recent-${index + 1}`">
              <span class="yno-overview__event-title">{{ row.title }}</span>
              <span class="yno-overview__event-status">{{ row.categoryText }} · {{ row.timeBasisText }}<template v-if="row.versionText"> · {{ row.versionText }}</template></span>
              <span class="yno-overview__event-time">{{ row.startText }} ~ {{ row.endText }}</span>
            </li>
          </ol>
        </div>
            <div class="yno-overview__bar">
              <el-button size="small" data-testid="yno-events-drilldown" @click="drilldown('grid-boundaries')">进入电网边界页检修干预页签</el-button>
            </div>
        </template>
        </template>
      </template>
      <template v-else-if="eventsState.error">
        <!-- overview 阶段失败：整块错误态（此时还没有任何已就绪内容可展示） -->
        <el-alert type="error" :closable="false" show-icon :title="`披露事件读取失败：${eventsState.error}`" data-testid="yno-events-error" />
        <div class="yno-overview__bar">
          <el-button size="small" data-testid="yno-events-retry" @click="retryEventsQuery">重试</el-button>
        </div>
      </template>
    </InsightBlock>

    <!-- 跨省与电网边界：背景曲线（详情页建设中） -->
    <InsightBlock
      v-if="blockVisible('grid')"
      title="跨省与电网边界（背景曲线）"
      :result="viewStates['grid'].result"
      :error="viewStates['grid'].error"
      :loading="viewStates['grid'].loading"
      :on-retry="() => retryQuery('grid')"
      :on-refresh="() => retryQuery('grid')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('grid')"
      @open-evidence="openEvidence('grid')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-grid-drilldown" @click="blockDrilldown('grid')">进入跨省与电网边界页</el-button>
        <span class="yno-overview__hint">{{ PAGE_BUILDING_TEXT }}</span>
      </div>
      <InsightSeriesChart
        :result="viewStates['grid'].result"
        :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
        :height="260"
        @select="() => {}"
      />
    </InsightBlock>

    <!-- 获权场站表现：能力目录判定可见；公共账号不渲染、不请求 -->
    <InsightBlock
      v-if="blockVisible('plants')"
      title="获权场站表现（场站日结算）"
      :result="viewStates['plants'].result"
      :error="viewStates['plants'].error"
      :loading="viewStates['plants'].loading"
      :on-retry="() => retryQuery('plants')"
      :on-refresh="() => retryQuery('plants')"
      :source-titles="sourceTitles"
      @open-candidates="openCandidates('plants')"
      @open-evidence="openEvidence('plants')"
    >
      <div class="yno-overview__bar">
        <el-button size="small" data-testid="yno-plants-drilldown" @click="blockDrilldown('plants')">进入场站市场表现页</el-button>
        <span class="yno-overview__hint">{{ PAGE_BUILDING_TEXT }}</span>
      </div>
      <InsightResultTable
        :result="viewStates['plants'].result"
        :selection="null"
        :source-titles="sourceTitles"
        @row-click="() => {}"
      />
    </InsightBlock>

    <!-- 证据抽屉与历史候选（按区块所属分析） -->
    <InsightEvidenceDrawer v-model="evidenceVisible" :result="evidenceTarget" :source-titles="sourceTitles" />

    <InsightHistoryCandidates
      v-if="candidatesBlock"
      v-model="candidatesVisible"
      :analysis-id="candidatesBlock.analysisId"
      :context="ctx.toQueryContext()"
      :filters="candidatesFilters"
      :required-source-ids="candidatesRequiredSourceIds"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />
  </div>
</template>

<style scoped>
.yno-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yno-overview__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.yno-overview__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yno-overview__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.yno-overview__mode {
  color: var(--text, #1f2a37);
  font-size: var(--font-sm, 13px);
  font-weight: 600;
}

.yno-overview__meta,
.yno-overview__hint {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
}

.yno-overview__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}

.yno-overview__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yno-overview__item {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.yno-overview__item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.yno-overview__item-rank {
  color: var(--muted, #909399);
  font-variant-numeric: tabular-nums;
}

.yno-overview__item-title {
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yno-overview__item-statement {
  margin: 6px 0;
  color: var(--text, #1f2a37);
  font-size: var(--font-sm, 13px);
}

.yno-overview__item-grid,
.yno-overview__card-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}

.yno-overview__item-grid dt,
.yno-overview__card-grid dt {
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

.yno-overview__item-grid dd,
.yno-overview__card-grid dd {
  margin: 0;
  font-size: var(--font-sm, 13px);
  font-variant-numeric: tabular-nums;
  color: var(--text, #1f2a37);
  text-align: right;
}

.yno-overview__item-grid dd {
  text-align: left;
}

.yno-overview__progress {
  border: 1px dashed var(--accent-soft, #94a3b8);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 10px 0 0;
}

.yno-overview__progress h4 {
  margin: 0 0 6px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yno-overview__progress p {
  margin: 0;
  color: var(--text, #1f2a37);
  font-size: var(--font-sm, 13px);
}

.yno-overview__rules {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  background: var(--panel, #fff);
  margin-top: 10px;
}

.yno-overview__rules-title {
  font-weight: 600;
  color: var(--muted, #50616e);
}

.yno-overview__rule-list {
  list-style: none;
  margin: 0;
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yno-overview__rule-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  font-size: var(--font-sm, 13px);
}

.yno-overview__rule-name {
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yno-overview__rule-status {
  color: var(--muted, #687987);
}

.yno-overview__rule-desc {
  flex-basis: 100%;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}

.yno-overview__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.yno-overview__card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.yno-overview__card--share {
  border-style: dashed;
  border-color: var(--accent-soft, #94a3b8);
}

.yno-overview__card-title {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yno-overview__card-note {
  margin: 8px 0 0;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}

.yno-overview__events {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  background: var(--panel-sub, #f8fafc);
  padding: 10px 12px;
}

.yno-overview__events h4 {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yno-overview__events ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yno-overview__events li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
  font-size: var(--font-sm, 13px);
}

.yno-overview__event-title {
  font-weight: 600;
  color: var(--text, #1f2a37);
  min-width: 0;
  overflow-wrap: anywhere;
}

.yno-overview__event-status {
  color: var(--muted, #687987);
  font-size: var(--font-xs, 12px);
}

.yno-overview__event-time {
  margin-left: auto;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
  font-variant-numeric: tabular-nums;
}

</style>
