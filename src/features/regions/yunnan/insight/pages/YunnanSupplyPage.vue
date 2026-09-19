<script setup lang="ts">
// 云南供需与水电页（dljy#3008，OpenSpec build-yunnan-regional-market-insight 任务 7.5/7.6）
// ----------------------------------------------------------------------------
// /insight/supply 的云南实现：四个页签（供需全景 / 水电 / 预测与实际 / 历史比较）。
// 口径要点（specs yunnan-supply-hydro-analysis，本页只呈现、不计算）：
//   - 负荷、水电、新能源、非市场与总发电不是互斥分量：只叠线比较，不堆叠、不相加；
//   - 云南与南方电网整体口径分开表达：南网整体只作单独背景区块，不进云南主图、
//     不计入云南任何汇总（含水电占比卡的分母）；
//   - 电量类指标（供电量、电量误差、MAPE）没有电量来源支撑，按后端 notDerived /
//     unavailableMetrics 原文如实说明，不显示 0；
//   - 预测误差是事后对照（来源只有发布日期没有发布时刻），不能当事前回测；
//     未达门槛的预测「可查看，不参与排名」；
//   - 剩余需求代理是分析代理量，不是官方竞价空间，也不是出清供需量；
//   - 历史窗口比较由用户显式选参考窗口（不自动选去年同期），只比较两边都有
//     平均功率的序列；窗口变化后旧对比作废不显示；
//   - 获权两分析（水电周出力 / 云南机组群占比）按能力目录判定可见性：公共账号
//     不渲染空区块、不发请求；机组群来源只披露组成与占比，没有上限值，不画上限线。
// 未选参考窗口 / 未选机组群的前置拦截在页面层完成（不发请求），后端校验是第二道防线。

import { computed, onMounted, reactive, ref, watch } from 'vue'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { getInsightSource } from 'shared/insight/sources.mjs'
import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'
import type { InsightContextInput } from 'shared/insight/contract.mjs'
import {
  fetchInsightCapabilities,
  queryInsight,
  type InsightBlockResult,
  type InsightCapabilities,
  type InsightRequestError,
  type InsightSeriesMeta,
} from '@/services/insight/insightClient'
import { useInsightContext } from '@/composables/useInsightContext'
import { insightAiBlockOf, useInsightAiPage, type InsightAiEvidenceBlock } from '@/features/regions/yunnan/insight/useInsightAiPage'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightObjectPicker, { type InsightObjectOption } from '@/components/insight/InsightObjectPicker.vue'
import InsightResultTable from '@/components/insight/InsightResultTable.vue'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import {
  buildInsightChartGroups,
  type InsightChartPoint,
  type InsightChartSeries,
} from '@/components/insight/chart/useInsightSeriesChart'
import {
  formatBeijingDateTime,
  formatInsightValue,
  insightPrecision,
  insightSeriesName,
  insightSourceTitle,
  type InsightSourceTitle,
} from '@/components/insight/insightText'

// ── 分析与固定文案 ───────────────────────────────────────────────────────────────────────

const SUPPLY_SYSTEM_ANALYSIS = 'supply.system-series'
const HYDRO_WEEKLY_ANALYSIS = 'supply.hydro-weekly-output'
const HYDRO_GROUPS_ANALYSIS = 'supply.hydro-unit-groups'

const SUPPLY_TABS = [
  { view: 'overview', label: '供需全景' },
  { view: 'hydro', label: '水电' },
  { view: 'forecast', label: '预测与实际' },
  { view: 'history', label: '历史比较' },
] as const

type SupplyTab = (typeof SUPPLY_TABS)[number]['view']

// 视图固定说明（口径来自 specs 与后端供应视图，改文案要同步 docs/market-insight-supply.md）
const STAGE_TEXT = '本页是系统运行数据（负荷与出力），不是市场价格'
const SCOPE_TEXT = '云南与南方电网整体口径分开表达；南网整体只作背景，不计入云南'
const RESOLUTION_TEXT = '原生粒度 15 分钟；云南总送出预测为 60 分钟'
const NOT_STACK_TEXT = '负荷、水电、新能源、非市场与总发电不是互斥分量：只叠线比较，不堆叠、不相加成「总供给」'
const FORECAST_TOGGLE_TEXT = '预测曲线以虚线显示，可与实际曲线同图开关'
const CSG_BLOCK_TITLE = '南方电网整体口径（背景，不计入云南）'
const HYDRO_SHARE_NOTE = '同一业务范围内：水电 / 总发电（共同有效时段按时长加权）'
const HYDRO_NO_SOURCE_TEXT = '库容、来水、弃水等暂无来源，不展示'
const ENTITLEMENT_TEXT = '获权数据需开通：当前公司没有水电周出力与云南机组群占比的查看授权'
const HYDRO_WEEKLY_NOTE = '逐日平均出力（MW），按区域分列、不相加；云南与其他省不可加总'
const HYDRO_GROUPS_NOTE = '来源只披露组成与占比，未提供电量或出力上限，不画上限线'
const PICK_UNIT_GROUP_TEXT = '请先选择机组群；未选不发请求'
const FORECAST_MODE_TEXT = '事后对照（只有发布日期，没有发布时刻，不能当事前回测）'
const NEW_ENERGY_ALIGN_TEXT = '新能源日前预测按目标日对齐（发布日次日）'
const ERROR_DIRECTION_TEXT = '误差 = 预测 − 实际（共同有效时段；跨范围的序列不计算误差）'
const ELIGIBILITY_BELOW_TEXT = '可查看，不参与排名'
const RESIDUAL_PROXY_TEXT = '剩余需求代理是分析代理量，不是官方竞价空间，也不是出清供需量'
const COMPARE_PICK_TEXT = '请先选择参考窗口（不自动选去年同期）；未选不发请求'
const COMPARE_DAYS_TEXT = '两个窗口天数不同，平均值可比、合计不可比'
const COMPARE_SCOPE_TEXT = '只比较两边窗口都有平均功率的序列；不同业务范围不互相比较'

/** 预测条目的类别 → 业务名（选项标签与固定顺序）。 */
const FORECAST_CATEGORY_TEXT: Record<string, string> = {
  load: '负荷预测',
  'new-energy': '新能源日前预测',
  'non-market': '非市场预测',
}

/** 剩余需求代理 unavailable 的 item → 业务名（后端条目原文是内部标识）。 */
const PROXY_ITEM_TEXT: Record<string, string> = {
  'residual-demand-proxy.forecast': '剩余需求代理（预测）',
  'residual-demand-proxy.actual': '剩余需求代理（实际）',
}

/** 水电周出力的区域选项（数据基线：forecast_hydro_weekly_output 的区域集合）。 */
const HYDRO_REGION_OPTIONS: InsightObjectOption[] = ['云南', '广东', '广西', '贵州', '海南'].map((region) => ({
  id: region,
  label: region,
}))

/** 云南水电机组群选项（数据基线：forecast_yn_hydro_group_energy_limit 只有「31 家水电」一个群）。 */
const UNIT_GROUP_OPTIONS: InsightObjectOption[] = [{ id: '31 家水电', label: '31 家水电' }]

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)

/** 契约镜像里的系统曲线分析登记（views / limits / sourceIds），不依赖后端 capabilities 是否下发。 */
const systemAnalysisDef = getInsightAnalysis(SUPPLY_SYSTEM_ANALYSIS)
const hydroWeeklyDef = getInsightAnalysis(HYDRO_WEEKLY_ANALYSIS)
const maxDays = computed(() => systemAnalysisDef?.limits.maxDays ?? 31)

/** 获权两分析按公司授权可见（capabilities 只返回当前公司可用的分析）。 */
const hasHydroWeekly = computed(() => capabilities.value?.analyses.some((a) => a.analysisId === HYDRO_WEEKLY_ANALYSIS) ?? false)
const hasHydroGroups = computed(() => capabilities.value?.analyses.some((a) => a.analysisId === HYDRO_GROUPS_ANALYSIS) ?? false)

/** 能力目录来源 → 业务标题目录（区块标签、证据抽屉、序列命名共用）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

/** 序列的业务名：系统曲线无对象维度、字段也无业务名，用来源标题承载展示身份。 */
function seriesLabelOf(meta: InsightSeriesMeta): string {
  return insightSourceTitle(meta.sourceId, sourceTitles.value)?.title ?? insightSeriesName(meta)
}

/** 预测序列 id（「来源|字段|维度」）→ 预测来源的业务标题（未配对条目显示用）。 */
function forecastLabelOf(seriesId: string): string {
  const sourceId = seriesId.split('|')[0] ?? ''
  return insightSourceTitle(sourceId, sourceTitles.value)?.title ?? insightSeriesName({ sourceId } as InsightSeriesMeta)
}

async function loadCapabilities(): Promise<void> {
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (!result) return
    capabilities.value = result
    // 能力目录就绪后补一次查询（之前被「目录未就绪」拦住的当前页签）。
    ensureTab(activeTab.value)
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
}

// ── 查询状态（页面级共享：overview/hydro 共用 series 与 summary，同键不重发）────────────

/** 查询名：系统曲线四个视图 + 获权两分析 + 窗口对比的参考侧。 */
type QueryName = 'series' | 'summary' | 'forecast-error' | 'residual-proxy' | 'hydro-weekly' | 'hydro-groups' | 'compare-reference'

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
  series: blankState(),
  summary: blankState(),
  'forecast-error': blankState(),
  'residual-proxy': blankState(),
  'hydro-weekly': blankState(),
  'hydro-groups': blankState(),
  'compare-reference': blankState(),
})

const activeTab = ref<SupplyTab>('overview')
const visitedTabs = reactive(new Set<SupplyTab>(['overview']))

/** 预测曲线同图开关（只影响主图渲染，不改变查询口径）。 */
const showForecast = ref(false)
/** 水电周出力的区域选择：默认只选云南（云南页的口径），跨省序列只并列不相加。 */
const hydroRegions = ref<string[]>(['云南'])
/** 云南机组群选择：默认不选，未选不发请求。 */
const unitGroupChoice = ref('')
/** 窗口对比的参考窗口：默认不选（不自动选去年同期），未选不发请求。 */
const referenceWindow = ref<{ start: string; end: string } | null>(null)

/** 查询签名：上下文代次（窗口/地区/公司都在代次里）+ 各查询自身的对象选择。 */
function queryKeyOf(name: QueryName): string {
  switch (name) {
    case 'hydro-weekly':
      return ['hydro-weekly', ctx.contextVersion.value, hydroRegions.value.join(',')].join('|')
    case 'hydro-groups':
      return ['hydro-groups', ctx.contextVersion.value, unitGroupChoice.value].join('|')
    case 'compare-reference':
      return ['compare', ctx.contextVersion.value, referenceWindow.value?.start ?? '', referenceWindow.value?.end ?? ''].join('|')
    default:
      return [name, ctx.contextVersion.value].join('|')
  }
}

// 上下文变化（窗口/地区/公司）：所有旧结果属于另一份读取，全部作废（含参考侧对比）。
watch(
  () => ctx.contextVersion.value,
  () => {
    for (const name of Object.keys(viewStates) as QueryName[]) Object.assign(viewStates[name], blankState())
    if (visitedTabs.has(activeTab.value)) ensureTab(activeTab.value)
  }
)
// 局部选择变化：只作废对应的获权/参考查询（系统曲线与它们无关，不重发）。
watch(hydroRegions, () => {
  Object.assign(viewStates['hydro-weekly'], blankState())
  ensureQuery('hydro-weekly')
})
watch(unitGroupChoice, () => {
  Object.assign(viewStates['hydro-groups'], blankState())
  ensureQuery('hydro-groups')
})
watch(referenceWindow, () => {
  Object.assign(viewStates['compare-reference'], blankState())
  ensureQuery('compare-reference')
})

function onTabChange(name: string | number): void {
  activeTab.value = name as SupplyTab
  visitedTabs.add(activeTab.value)
  ensureTab(activeTab.value)
}

function onWindowChange(next: { start: string; end: string }): void {
  ctx.setBusinessWindow(next.start, next.end)
}

function onReferenceWindowChange(next: { start: string; end: string }): void {
  // InsightDateRange 只在完整窗时上报；不完整值不落参考窗（保持未选状态不发请求）。
  if (!next.start || !next.end) return
  referenceWindow.value = { start: next.start, end: next.end }
}

function onHydroRegionsChange(ids: string[]): void {
  hydroRegions.value = [...ids]
}

/** 页签首次激活（或口径变化后重查）需要的查询集合。 */
function ensureTab(tab: SupplyTab): void {
  if (tab === 'overview') {
    ensureQuery('series')
    ensureQuery('summary')
  } else if (tab === 'hydro') {
    ensureQuery('series')
    ensureQuery('summary')
    ensureQuery('hydro-weekly')
    ensureQuery('hydro-groups')
  } else if (tab === 'forecast') {
    ensureQuery('series')
    ensureQuery('forecast-error')
  } else {
    ensureQuery('summary')
    ensureQuery('residual-proxy')
    ensureQuery('compare-reference')
  }
}

/** 前置拦截（能力未就绪 / 未选对象 / 无授权）+ 同签名去重后发查询。 */
function ensureQuery(name: QueryName): void {
  if (!capabilities.value || capabilitiesError.value) return
  if (name === 'hydro-weekly' && !(hasHydroWeekly.value && hydroRegions.value.length)) return
  if (name === 'hydro-groups' && !(hasHydroGroups.value && unitGroupChoice.value)) return
  if (name === 'compare-reference' && !referenceWindow.value) return
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  if (entry.queriedKey === key) return // 有结果或已按此键失败过：不自动重查（重试由用户触发）
  void runQuery(name)
}

/** 各查询的 analysisId / context / filters：系统曲线四视图共用一个分析，参考侧覆盖窗口。 */
function buildRequest(name: QueryName): {
  analysisId: string
  context: InsightContextInput
  filters: Record<string, unknown>
} {
  if (name === 'hydro-weekly') {
    return { analysisId: HYDRO_WEEKLY_ANALYSIS, context: ctx.toQueryContext(), filters: { objectIds: [...hydroRegions.value] } }
  }
  if (name === 'hydro-groups') {
    return { analysisId: HYDRO_GROUPS_ANALYSIS, context: ctx.toQueryContext(), filters: { objectIds: [unitGroupChoice.value] } }
  }
  if (name === 'compare-reference') {
    // 参考侧是同一 summary 视图、另一业务窗口：仍经 ctx.request.run（拿到代次作废），
    // 只覆盖 businessWindow，其余上下文（地区/公司/来源）与当前口径一致。
    const window = referenceWindow.value ?? { start: '', end: '' }
    return {
      analysisId: SUPPLY_SYSTEM_ANALYSIS,
      context: { ...ctx.toQueryContext(), businessWindow: { start: window.start, end: window.end, timeZone: 'Asia/Shanghai' } },
      filters: { view: 'summary' },
    }
  }
  return { analysisId: SUPPLY_SYSTEM_ANALYSIS, context: ctx.toQueryContext(), filters: { view: name } }
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

// ── 序列目录与结果裁剪 ───────────────────────────────────────────────────────────────────

/** 系统曲线目录条目（宽松形状：后端另带 category / categoryGroup / kind 等视图字段）。 */
type SupplySeriesEntry = InsightSeriesMeta & {
  category?: string | null
  categoryGroup?: string | null
  kind?: string
}

function seriesCatalogOf(result: InsightBlockResult | null): SupplySeriesEntry[] {
  return (result?.data?.series ?? []) as SupplySeriesEntry[]
}

/**
 * series 结果裁剪：按目录条目过滤序列，明细行与 sourceRefs 同步裁掉
 * （南网整体背景区块、云南主图各持一份互不混入的结果，证据抽屉也只列各自的来源）。
 */
function filterSeriesResult(result: InsightBlockResult | null, predicate: (meta: SupplySeriesEntry) => boolean): InsightBlockResult | null {
  const data = result?.data
  if (!result || !data) return null
  const kept = seriesCatalogOf(result).filter(predicate)
  const keptIds = new Set(kept.map((meta) => meta.seriesId))
  const rows = (data.rows ?? []).filter((row) => keptIds.has(String(row.seriesId)))
  const keptSourceIds = new Set(kept.map((meta) => meta.sourceId))
  const sourceRefs = (result.sourceRefs ?? []).filter((ref) => keptSourceIds.has(String(ref.sourceId)))
  return { ...result, sourceRefs, data: { ...data, rows, series: kept } }
}

// ── 供需全景：云南主图（ChartCard 自绘：实线实际 + 虚线预测，不堆叠）────────────────────

/** 裁剪结果 → 图表序列（点集来自公共分组器：阶梯、缺测断开、边界点口径与明细图一致）。 */
function scopedChartSeries(
  result: InsightBlockResult | null,
  predicate: (meta: SupplySeriesEntry) => boolean
): Array<{ seriesId: string; name: string; unit: string; points: InsightChartPoint[]; sourceId: string }> {
  const filtered = filterSeriesResult(result, predicate)
  if (!filtered) return []
  const out: Array<{ seriesId: string; name: string; unit: string; points: InsightChartPoint[]; sourceId: string }> = []
  for (const group of buildInsightChartGroups(filtered)) {
    for (const chart of group.series) {
      out.push({ seriesId: chart.meta.seriesId, name: seriesLabelOf(chart.meta), unit: chart.unit, points: chart.points, sourceId: chart.meta.sourceId })
    }
  }
  return out
}

/** 北京时间 MM-DD HH:mm（tooltip 用；显式换算，不依赖浏览器本地时区）。 */
function beijingMDHM(ms: number): string {
  const beijing = new Date(ms + 8 * 3_600_000).toISOString()
  return `${beijing.slice(5, 10)} ${beijing.slice(11, 16)}`
}

type PlainChartSeries = { name: string; unit: string; points: InsightChartPoint[]; sourceId?: string }

/** 一条序列 → ECharts 线（阶梯 end、缺测断开、无平滑；预测虚线由调用方指定）。 */
function plainLineOf(series: PlainChartSeries, dashed: boolean): Record<string, unknown> {
  return {
    name: series.name,
    type: 'line',
    step: 'end',
    connectNulls: false,
    smooth: false,
    symbol: 'none',
    ...(dashed ? { lineStyle: { type: 'dashed' } } : {}),
    data: series.points.map((point) => ({
      value: [point.ts, point.value] as [number, number | null],
      end: point.end,
      ...(point.edge ? { edge: true } : {}),
    })),
  }
}

/** 一组线 → 基础 option（时间轴、双轴语义由公共分组器保证单一单位，这里单 MW 轴；metas 供 tooltip 按来源精度取值）。 */
function baseChartOption(series: Array<Record<string, unknown>>, metas: Array<{ name: string; sourceId?: string }> = []): Record<string, unknown> {
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? (raw as Array<{ marker?: string; seriesName?: string; data?: { value?: [number, number | null]; end?: string; edge?: true } }>) : []
        const lines: string[] = []
        for (const param of params) {
          const value = param.data?.value
          if (!value || param.data?.edge) continue // 边界点只补画，不是观测
          const [ts, val] = value
          const endMs = param.data?.end ? Date.parse(param.data.end) : Number.NaN
          const slot = Number.isFinite(endMs) ? `~${beijingMDHM(endMs)}` : ''
          const precision = insightPrecision(metas.find((meta) => meta.name === param.seriesName)?.sourceId ?? '')
          const shown = val === null || val === undefined || !Number.isFinite(val) ? '缺测' : formatInsightValue(String(val), precision)
          lines.push(`${param.marker ?? ''}${param.seriesName ?? ''}　${beijingMDHM(ts)}${slot}　${shown}`)
        }
        return lines.join('<br/>')
      },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 64, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: 'MW', scale: true },
    series,
  }
}

/** 系统曲线图 option：实际实线；预测按开关以虚线同图（时间轴天然对齐）。 */
function buildSystemOption(result: InsightBlockResult | null, scope: 'yunnan' | 'csg-aggregate', includeForecast: boolean): Record<string, unknown> {
  const actual = scopedChartSeries(result, (meta) => meta.businessScope === scope && meta.variant !== 'forecast')
  const forecast = includeForecast
    ? scopedChartSeries(result, (meta) => meta.businessScope === scope && meta.variant === 'forecast')
    : []
  const series = [
    ...actual.map((chart) => plainLineOf(chart, false)),
    ...forecast.map((chart) => plainLineOf(chart, true)),
  ]
  return baseChartOption(series, [...actual, ...forecast])
}

const overviewOption = computed(() => buildSystemOption(viewStates.series.result, 'yunnan', showForecast.value))
const csgOverviewOption = computed(() => buildSystemOption(viewStates.series.result, 'csg-aggregate', showForecast.value))
/** 南网整体背景区块的裁剪结果（区块与证据抽屉共用，云南主图绝不混入）。 */
const csgSeriesResult = computed(() =>
  filterSeriesResult(viewStates.series.result, (meta) => meta.businessScope === 'csg-aggregate')
)

// ── 供需全景：统计摘要（summary 视图：均值/最低/最高/有效时长 + 水电占比行）────────────

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null }

/** 统计卡（供需全景摘要与水电占比共用一套卡片结构，渲染见模板 yns-supply__cards）。 */
type StatCardRow = { metricId: string; label: string; text: string; unit: string; note: string }
type StatCard = { key: string; title: string; note: string; rows: StatCardRow[] }

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

const SUMMARY_METRICS = ['supply.mean-power', 'supply.minimum', 'supply.maximum', 'sample.valid-hours'] as const
const SHARE_METRICS = ['supply.hydro-share', 'sample.common-hours'] as const

/** summary 结果 → 统计卡：普通序列一张卡（序列名 = 来源标题）；水电占比行单独成卡。 */
const overviewSummaryCards = computed<StatCard[]>(() => {
  const result = viewStates.summary.result
  const data = result?.data
  if (!result || !data) return []
  const rows = (data.rows ?? []) as unknown as MetricRow[]
  const bySeries = new Map<string, Map<string, MetricRow>>()
  for (const row of rows) {
    const map = bySeries.get(row.seriesId) ?? new Map<string, MetricRow>()
    map.set(row.metricId, row)
    bySeries.set(row.seriesId, map)
  }
  const scopeLabel = (scope: string) => (scope === 'yunnan' ? '云南' : '南方电网整体口径')
  const cards: StatCard[] = []
  for (const meta of seriesCatalogOf(result)) {
    const own = bySeries.get(meta.seriesId)
    if (!own) continue
    if (meta.seriesId.startsWith('share:hydro:')) {
      const scope = meta.businessScope ?? 'yunnan'
      cards.push({
        key: meta.seriesId,
        title: `水电占比（${scopeLabel(scope)}）`,
        note: HYDRO_SHARE_NOTE,
        rows: SHARE_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
      })
      continue
    }
    cards.push({
      key: meta.seriesId,
      title: seriesLabelOf(meta),
      note: '',
      rows: SUMMARY_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    })
  }
  return cards
})

/** 后端声明的不推导项（总发电 − 水电 − 新能源 等）：逐条原文，不显示 0。 */
const notDerived = computed(() => (viewStates.summary.result?.data?.notDerived ?? []) as Array<{ label: string; reason: string }>)

/** 后端声明的不可用指标（供电量：功率口径没有电量支撑）：逐条原文，不显示 0。 */
const summaryUnavailable = computed(
  () => (viewStates.summary.result?.data?.unavailableMetrics ?? []) as Array<{ metricId: string; reason: string }>
)

function unavailableText(item: { metricId: string; reason: string }): string {
  const label = getMetricDefinition(item.metricId)?.label ?? item.metricId
  return `${label} 不可用：${item.reason}`
}

// ── 水电页签：云南水电实际 + 占比 + 获权两区块 ───────────────────────────────────────────

/** 云南水电实际曲线（只取水电类别；南网整体已在业务范围上排除）。 */
const hydroChartResult = computed(() =>
  filterSeriesResult(viewStates.series.result, (meta) => meta.businessScope === 'yunnan' && meta.category === 'hydro')
)

/** 水电占比卡：云南口径的 share 行（同一业务范围、共同有效时段）。 */
const hydroShareCards = computed<StatCard[]>(() => overviewSummaryCards.value.filter((card) => card.key === 'share:hydro:yunnan'))

/** 机组群结果 → 表格行：逐日组成与占比（无上限值，不画上限线）。 */
const unitGroupRows = computed(() => {
  const result = viewStates['hydro-groups'].result
  const data = result?.data
  if (!result || !data) return []
  const catalog = new Map(seriesCatalogOf(result).map((meta) => [meta.seriesId, meta]))
  const places = catalog.size ? insightPrecision([...catalog.values()][0]!.sourceId) : 1
  const rows = (data.rows ?? []) as Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }>
  return rows
    .map((row) => {
      const meta = catalog.get(row.seriesId)
      if (!meta) return null
      const num = Number(row.value)
      return {
        date: row.intervalStart.slice(0, 10),
        plant: meta.dimensions.plant ?? '—',
        unit: meta.dimensions.unit ?? '—',
        shareText: Number.isFinite(num) ? num.toFixed(places) : '—',
        raw: row.intervalStart,
      }
    })
    .filter((row): row is { date: string; plant: string; unit: string; shareText: string; raw: string } => row !== null)
    .sort((a, b) => a.raw.localeCompare(b.raw) || a.plant.localeCompare(b.plant) || a.unit.localeCompare(b.unit))
})

// ── 预测与实际：配对条目、原始曲线、误差曲线与资格说明 ───────────────────────────────────

/** forecast-error 目录的配对条目（宽松形状，字段见 docs/api/market-insight-contract.md）。 */
type ForecastPairEntry = SupplySeriesEntry & {
  direction?: string
  forecastSeriesId?: string
  actualSeriesId?: string
  mode?: string
  eligibility?: {
    samples?: number
    expectedSamples?: number
    coverageRatio?: number
    eligible?: boolean
    required?: { minSamples?: number; minCoverageRatio?: number }
  }
}

/** 预测条目的业务名：类别优先（负荷预测/新能源日前预测/非市场预测），兜底预测来源标题。 */
function pairLabelOf(pair: ForecastPairEntry): string {
  if (pair.category && FORECAST_CATEGORY_TEXT[pair.category]) return FORECAST_CATEGORY_TEXT[pair.category]!
  return pair.forecastSeriesId ? forecastLabelOf(pair.forecastSeriesId) : pair.seriesId
}

/** 配对条目（kind forecast-error）：来自 series 目录的配对，值 = 预测 − 实际。 */
const forecastPairs = computed<ForecastPairEntry[]>(() =>
  seriesCatalogOf(viewStates['forecast-error'].result).filter((meta) => meta.kind === 'forecast-error')
)

/** 预测选择：默认取第一个配对，之后只随用户显式切换变化。 */
const forecastChoice = ref('')
watch(forecastPairs, (pairs) => {
  if (!pairs.length) {
    forecastChoice.value = ''
    return
  }
  if (!pairs.some((pair) => pair.seriesId === forecastChoice.value)) forecastChoice.value = pairs[0]!.seriesId
})

const currentPair = computed(() => forecastPairs.value.find((pair) => pair.seriesId === forecastChoice.value) ?? null)

/** 原始曲线图：所选配对的预测（虚线）与实际（实线）两条，来自 series 视图、时间轴对齐。 */
const rawCompareOption = computed(() => {
  const pair = currentPair.value
  if (!pair) return baseChartOption([])
  const ids = new Set([pair.forecastSeriesId, pair.actualSeriesId].filter(Boolean) as string[])
  // 虚线只加在预测序列上（series 目录的 variant 字段判定）。
  const dashedIds = new Set(
    seriesCatalogOf(viewStates.series.result)
      .filter((meta) => meta.variant === 'forecast' && ids.has(meta.seriesId))
      .map((meta) => meta.seriesId)
  )
  const scoped = scopedChartSeries(viewStates.series.result, (meta) => ids.has(meta.seriesId))
  const lines = scoped.map((chart) =>
    plainLineOf(chart, dashedIds.has(chart.seriesId))
  )
  return baseChartOption(lines, scoped)
})

/**
 * 误差曲线：配对条目的 rows（值 = 预测 − 实际）。序列无来源字段，借同范围实际来源
 * 承载展示身份（精度与阶梯粒度），名称固定「预测 − 实际」。
 */
const errorChartOption = computed(() => {
  const pair = currentPair.value
  const result = viewStates['forecast-error'].result
  const data = result?.data
  if (!pair || !result || !data) return baseChartOption([])
  const actualSourceId = pair.actualSeriesId?.split('|')[0] ?? ''
  const resolution = pair.resolutionMinutes ?? 15
  const adapted: InsightBlockResult = {
    ...result,
    data: {
      ...data,
      series: [
        {
          seriesId: pair.seriesId,
          sourceId: actualSourceId,
          fieldId: 'value',
          unit: pair.unit,
          measureKind: 'power',
          dimensions: {},
          businessScope: pair.businessScope ?? 'yunnan',
          resolutionMinutes: resolution,
          nativeResolutionMinutes: resolution,
          priceObject: null,
          marketPhase: null,
          variant: null,
        } satisfies InsightSeriesMeta,
      ],
    },
  }
  const lines = buildInsightChartGroups(adapted)
    .flatMap((group) => group.series)
    .map((chart: InsightChartSeries) => plainLineOf({ name: '预测 − 实际', unit: chart.unit, points: chart.points }, false))
  return baseChartOption(lines, [{ name: '预测 − 实际', sourceId: actualSourceId }])
})

/** 配对统计卡（MAE、平均偏差、三口径时长）：tables.summary 里所选配对的行。 */
const PAIR_SUMMARY_METRICS = ['forecast.mae', 'forecast.bias', 'sample.common-hours', 'sample.forecast-valid-hours', 'sample.actual-valid-hours'] as const

const pairSummaryCards = computed<StatCard[]>(() => {
  const pair = currentPair.value
  const result = viewStates['forecast-error'].result
  if (!pair || !result?.data) return []
  const tables = result.data.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined
  const rows = (tables?.summary?.rows ?? []) as unknown as MetricRow[]
  const own = new Map(rows.filter((row) => row.seriesId === pair.seriesId).map((row) => [row.metricId, row]))
  return [
    {
      key: pair.seriesId,
      title: `${pairLabelOf(pair)} · 误差统计`,
      note: ERROR_DIRECTION_TEXT,
      rows: PAIR_SUMMARY_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    },
  ]
})

/** 资格说明：样本/覆盖率/门槛按后端数值陈述；未达门槛固定「可查看，不参与排名」。 */
const pairEligibilityText = computed(() => {
  const eligibility = currentPair.value?.eligibility
  if (!eligibility) return ''
  const samples = eligibility.samples ?? 0
  const expected = eligibility.expectedSamples ?? 0
  const coverage = Math.round((eligibility.coverageRatio ?? 0) * 100)
  const standing = eligibility.eligible ? '达到排名门槛' : `未达排名门槛：${ELIGIBILITY_BELOW_TEXT}`
  const required = eligibility.required
  const threshold = required ? `；门槛：有效样本 ≥ ${required.minSamples ?? '—'} 个 15 分钟点、覆盖率 ≥ ${Math.round((required.minCoverageRatio ?? 0) * 100)}%` : ''
  return `有效样本 ${samples}/${expected}，覆盖率 ${coverage}%，${standing}${threshold}`
})

/** 未配对的预测（没有可比的实际等）：逐条原因，不悄悄丢弃；名称用预测来源标题。 */
const forecastUnpaired = computed(() => {
  const unpaired = (viewStates['forecast-error'].result?.data?.unpaired ?? []) as Array<{ seriesId: string; reason: string }>
  return unpaired.map((item) => `${forecastLabelOf(item.seriesId)}：${item.reason}`)
})

const forecastNotes = computed(() => {
  const notes = (viewStates['forecast-error'].result?.data?.notes ?? []) as Array<{ note?: string }>
  return notes.map((item) => item.note ?? '').filter(Boolean)
})

const forecastUnavailable = computed(
  () => (viewStates['forecast-error'].result?.data?.unavailableMetrics ?? []) as Array<{ metricId: string; reason: string }>
)

// ── 历史比较：剩余需求代理 + 窗口对比 ───────────────────────────────────────────────────

const proxyChartOption = computed(() => {
  const result = viewStates['residual-proxy'].result
  const data = result?.data
  if (!result || !data) return baseChartOption([])
  const catalog = seriesCatalogOf(result)
  const entry = catalog[0]
  if (!entry) return baseChartOption([])
  // 代理序列无来源字段，借云南负荷预测来源承载展示身份（阶梯与精度），名称固定业务名。
  const resolution = entry.resolutionMinutes ?? 60
  const adapted: InsightBlockResult = {
    ...result,
    data: {
      ...data,
      series: [
        {
          seriesId: entry.seriesId,
          sourceId: 'yn.system.load.forecast',
          fieldId: 'value',
          unit: entry.unit,
          measureKind: 'power',
          dimensions: {},
          businessScope: entry.businessScope ?? 'yunnan',
          resolutionMinutes: resolution,
          nativeResolutionMinutes: resolution,
          priceObject: null,
          marketPhase: null,
          variant: null,
        } satisfies InsightSeriesMeta,
      ],
    },
  }
  const lines = buildInsightChartGroups(adapted)
    .flatMap((group) => group.series)
    .map((chart: InsightChartSeries) => plainLineOf({ name: '剩余需求代理（预测）', unit: chart.unit, points: chart.points }, false))
  return baseChartOption(lines, [{ name: '剩余需求代理（预测）', sourceId: 'yn.system.load.forecast' }])
})

/** 代理统计卡：代理均值、最低/最高（带出现时段）、共同有效时长。 */
const PROXY_METRICS = ['supply.residual-demand-proxy', 'supply.minimum', 'supply.maximum', 'sample.common-hours'] as const

const proxySummaryCards = computed<StatCard[]>(() => {
  const result = viewStates['residual-proxy'].result
  if (!result?.data) return []
  const tables = result.data.tables as Record<string, { rows?: Array<Record<string, string | null>> }> | undefined
  const rows = (tables?.summary?.rows ?? []) as unknown as MetricRow[]
  if (!rows.length) return []
  const own = new Map(rows.map((row) => [row.metricId, row]))
  return [
    {
      key: 'proxy-summary',
      title: '剩余需求代理（逐小时）',
      note: RESIDUAL_PROXY_TEXT,
      rows: PROXY_METRICS.map((metricId) => metricCardRow(metricId, own.get(metricId))),
    },
  ]
})

const proxyFormula = computed(() => {
  const formula = (viewStates['residual-proxy'].result?.data as { formula?: string } | undefined)?.formula
  return typeof formula === 'string' ? formula : ''
})

const proxyNotes = computed(() => {
  const notes = (viewStates['residual-proxy'].result?.data?.notes ?? []) as Array<{ note?: string }>
  return notes.map((item) => item.note ?? '').filter(Boolean)
})

/** 代理缺输入：逐条 unavailable 原因（item 映射业务名），不画空线。 */
const proxyUnavailable = computed(() => {
  const unavailable = (viewStates['residual-proxy'].result?.data?.unavailable ?? []) as Array<{ item?: string; reason?: string }>
  return unavailable.map((item) => `${PROXY_ITEM_TEXT[item.item ?? ''] ?? '该口径'} 不可用：${item.reason ?? ''}`)
})

// ── 窗口对比：当前窗口 vs 用户显式选择的参考窗口（同一 summary 视图各查一次）──────────

/** 两侧结果都存在且各自键都是当前口径时，对比才有效（旧口径/迟到结果不显示）。 */
const compareReady = computed(() =>
  Boolean(
    viewStates.summary.result &&
      viewStates['compare-reference'].result &&
      viewStates.summary.queriedKey === queryKeyOf('summary') &&
      viewStates['compare-reference'].queriedKey === queryKeyOf('compare-reference')
  )
)

const windowDays = (window: { start: string; end: string }): number => {
  const days = (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000 + 1
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0
}

/** 两个窗口天数不同：平均值可比、合计不可比（明示，不静默接受）。 */
const compareDaysDifferent = computed(() => {
  const reference = referenceWindow.value
  if (!reference || !compareReady.value) return false
  return windowDays(ctx.businessWindow.value) !== windowDays(reference)
})

function metricTextOf(rows: Map<string, MetricRow>, metricId: string): string {
  const row = rows.get(metricId)
  const shown = row ? formatMetricValue(metricId, row.value) : null
  return shown === null || shown === undefined ? '—' : String(shown)
}

/** 对比表：按同一 seriesId 交集并排（只比较两边都有平均功率的序列；share 行天然被排除）。 */
type CompareRow = {
  key: string
  name: string
  currentMean: string
  currentMin: string
  currentMax: string
  referenceMean: string
  referenceMin: string
  referenceMax: string
}

const compareRows = computed<CompareRow[]>(() => {
  if (!compareReady.value) return []
  const current = viewStates.summary.result
  const reference = viewStates['compare-reference'].result
  if (!current?.data || !reference?.data) return []
  const index = (result: InsightBlockResult): Map<string, Map<string, MetricRow>> => {
    const map = new Map<string, Map<string, MetricRow>>()
    for (const row of (result.data?.rows ?? []) as unknown as MetricRow[]) {
      const own = map.get(row.seriesId) ?? new Map<string, MetricRow>()
      own.set(row.metricId, row)
      map.set(row.seriesId, own)
    }
    return map
  }
  const currentRows = index(current)
  const referenceRows = index(reference)
  const rows: CompareRow[] = []
  for (const meta of seriesCatalogOf(current)) {
    // 只比较两边都有平均功率的序列；水电占比行没有平均功率，不进对比。
    if (!currentRows.get(meta.seriesId)?.has('supply.mean-power')) continue
    if (!referenceRows.get(meta.seriesId)?.has('supply.mean-power')) continue
    const cur = currentRows.get(meta.seriesId)!
    const ref = referenceRows.get(meta.seriesId)!
    rows.push({
      key: meta.seriesId,
      name: seriesLabelOf(meta),
      currentMean: metricTextOf(cur, 'supply.mean-power'),
      currentMin: metricTextOf(cur, 'supply.minimum'),
      currentMax: metricTextOf(cur, 'supply.maximum'),
      referenceMean: metricTextOf(ref, 'supply.mean-power'),
      referenceMin: metricTextOf(ref, 'supply.minimum'),
      referenceMax: metricTextOf(ref, 'supply.maximum'),
    })
  }
  return rows
})

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

/** 历史候选：系统曲线分析按云南 5 条实际来源求交集（南网背景与预测不参与候选）。 */
const candidateSourceIds = computed(() =>
  (systemAnalysisDef?.sourceIds ?? []).filter((sourceId) => {
    const source = getInsightSource(sourceId)
    return source?.businessScope === 'yunnan' && source.variant === 'actual'
  })
)

/** 历史候选的 filters：候选只按来源覆盖求交集，统一用 series 视图口径。 */
const candidatesFilters = computed<Record<string, unknown>>(() => ({ view: 'series' }))

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 只收「当前签名一致」的已就绪查询结果，过期区块不进上下文；只传摘要与版本引用
// （含水电区域/机组群/参考窗等筛选摘要），不传原始行数据。

const SUPPLY_AI_BLOCK_TITLES: Record<QueryName, string> = {
  series: '云南供需全景',
  summary: '统计摘要',
  'forecast-error': '预测与实际',
  'residual-proxy': '剩余需求代理',
  'hydro-weekly': '云南水电周出力',
  'hydro-groups': '水电机组群出力',
  'compare-reference': '历史比较参考侧',
}

const insightAi = useInsightAiPage({
  pageId: 'supply',
  label: '云南供需与水电',
  collect: () => {
    const blocks: InsightAiEvidenceBlock[] = []
    for (const name of Object.keys(viewStates) as QueryName[]) {
      const entry = viewStates[name]
      const aiBlock = insightAiBlockOf({
        blockId: name,
        title: SUPPLY_AI_BLOCK_TITLES[name],
        analysisId:
          name === 'hydro-weekly' ? HYDRO_WEEKLY_ANALYSIS
          : name === 'hydro-groups' ? HYDRO_GROUPS_ANALYSIS
          : SUPPLY_SYSTEM_ANALYSIS,
        view: name === 'compare-reference' ? 'summary' : name,
        currentKey: queryKeyOf(name),
        queriedKey: entry.queriedKey,
        result: entry.result,
        objects:
          name === 'hydro-weekly' ? [...hydroRegions.value]
          : name === 'hydro-groups' && unitGroupChoice.value ? [unitGroupChoice.value]
          : undefined,
        filterSummary: {
          ...(name === 'hydro-weekly' && hydroRegions.value.length ? { 水电区域: [...hydroRegions.value] } : {}),
          ...(name === 'hydro-groups' && unitGroupChoice.value ? { 机组群: unitGroupChoice.value } : {}),
          ...(name === 'compare-reference' && referenceWindow.value
            ? { 参考窗: `${referenceWindow.value.start}~${referenceWindow.value.end}` }
            : {}),
        },
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
  <div class="yns-supply">
    <!-- 顶部：日期窗与固定口径说明 -->
    <section class="yns-supply__controls">
      <label class="yns-supply__field">
        <span>业务日期窗</span>
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
        data-testid="yns-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
    </section>

    <p class="yns-supply__meta">
      {{ STAGE_TEXT }} · {{ SCOPE_TEXT }} · {{ RESOLUTION_TEXT }}
    </p>

    <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="能力目录读取失败">
      <p class="yns-supply__hint">当前看不到可用的供需分析；可重试，不影响已就绪区块的展示。</p>
      <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
    </el-alert>

    <!-- 四页签：懒加载（首次激活渲染），签名不变时切回不重查 -->
    <el-tabs :model-value="activeTab" class="yns-supply__tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in SUPPLY_TABS" :key="tab.view" :name="tab.view" :label="tab.label">
        <template v-if="visitedTabs.has(tab.view)">
          <!-- 供需全景：云南主图（不堆叠）+ 明细表 + 统计摘要 + 南网背景 -->
          <template v-if="tab.view === 'overview'">
            <InsightBlock
              title="云南供需全景"
              :result="viewStates.series.result"
              :error="viewStates.series.error"
              :loading="viewStates.series.loading"
              :on-retry="() => retryQuery('series')"
              :on-refresh="() => retryQuery('series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('series')"
            >
              <el-alert type="info" :closable="false" :title="NOT_STACK_TEXT" />
              <div class="yns-supply__bar">
                <el-checkbox v-model="showForecast" data-testid="yns-forecast-toggle">预测曲线（虚线同图）</el-checkbox>
                <span class="yns-supply__hint">{{ FORECAST_TOGGLE_TEXT }}</span>
              </div>
              <ChartCard title="云南系统曲线（实际实线；预测虚线）" :height="340" :build-option="() => overviewOption" />
              <InsightResultTable
                :result="viewStates.series.result"
                :selection="null"
                :source-titles="sourceTitles"
                @row-click="() => {}"
              />
            </InsightBlock>

            <InsightBlock
              title="统计摘要"
              :result="viewStates.summary.result"
              :error="viewStates.summary.error"
              :loading="viewStates.summary.loading"
              :on-retry="() => retryQuery('summary')"
              :on-refresh="() => retryQuery('summary')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('summary')"
            >
              <template #default>
                <el-alert
                  v-for="(item, index) in notDerived"
                  :key="`nd-${index}`"
                  type="info"
                  :closable="false"
                  :title="`不推导：${item.label}——${item.reason}`"
                />
                <el-alert
                  v-for="(item, index) in summaryUnavailable"
                  :key="`un-${index}`"
                  type="info"
                  :closable="false"
                  :title="unavailableText(item)"
                />
                <div class="yns-supply__cards">
                  <div v-for="card in overviewSummaryCards" :key="card.key" class="yns-supply__card" :class="{ 'yns-supply__card--share': card.key.startsWith('share:') }">
                    <h4 class="yns-supply__card-title">{{ card.title }}</h4>
                    <dl class="yns-supply__card-grid">
                      <template v-for="row in card.rows" :key="row.metricId">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                      </template>
                    </dl>
                    <p v-if="card.note" class="yns-supply__card-note">{{ card.note }}</p>
                  </div>
                </div>
              </template>
            </InsightBlock>

            <!-- 南网整体：单独背景区块（默认折叠），不进云南主图、不计入云南汇总 -->
            <el-collapse class="yns-supply__csg">
              <el-collapse-item name="csg">
                <template #title>
                  <span class="yns-supply__csg-title">{{ CSG_BLOCK_TITLE }}</span>
                </template>
                <InsightBlock
                  :title="CSG_BLOCK_TITLE"
                  :result="csgSeriesResult"
                  :error="viewStates.series.error"
                  :loading="viewStates.series.loading"
                  :on-retry="() => retryQuery('series')"
                  :on-refresh="() => retryQuery('series')"
                  :source-titles="sourceTitles"
                  @open-candidates="openCandidates"
                  @open-evidence="openEvidence('series')"
                >
                  <el-alert type="info" :closable="false" :title="NOT_STACK_TEXT" />
                  <ChartCard title="南方电网整体口径系统曲线（背景）" :height="300" :build-option="() => csgOverviewOption" />
                </InsightBlock>
              </el-collapse-item>
            </el-collapse>
          </template>

          <!-- 水电：云南水电实际 + 占比 + 获权两区块 -->
          <template v-else-if="tab.view === 'hydro'">
            <InsightBlock
              title="云南水电"
              :result="hydroChartResult"
              :error="viewStates.series.error"
              :loading="viewStates.series.loading"
              :on-retry="() => retryQuery('series')"
              :on-refresh="() => retryQuery('series')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('series')"
            >
              <InsightSeriesChart
                :result="hydroChartResult"
                :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                :height="300"
                @select="() => {}"
              />
              <div v-if="hydroShareCards.length" class="yns-supply__cards">
                <div v-for="card in hydroShareCards" :key="card.key" class="yns-supply__card yns-supply__card--share">
                  <h4 class="yns-supply__card-title">{{ card.title }}</h4>
                  <dl class="yns-supply__card-grid">
                    <template v-for="row in card.rows" :key="row.metricId">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                    </template>
                  </dl>
                  <p v-if="card.note" class="yns-supply__card-note">{{ card.note }}</p>
                </div>
              </div>
              <p class="yns-supply__hint">{{ HYDRO_NO_SOURCE_TEXT }}</p>
            </InsightBlock>

            <el-alert v-if="!hasHydroWeekly && !hasHydroGroups" type="info" :closable="false" :title="ENTITLEMENT_TEXT" />

            <InsightBlock
              v-if="hasHydroWeekly"
              title="水电周出力预测（获权）"
              :result="viewStates['hydro-weekly'].result"
              :error="viewStates['hydro-weekly'].error"
              :loading="viewStates['hydro-weekly'].loading"
              :on-retry="() => retryQuery('hydro-weekly')"
              :on-refresh="() => retryQuery('hydro-weekly')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('hydro-weekly')"
            >
              <div class="yns-supply__bar">
                <label class="yns-supply__field">
                  <span>区域（多选，默认云南）</span>
                  <InsightObjectPicker
                    :model-value="hydroRegions"
                    :options="HYDRO_REGION_OPTIONS"
                    :max-objects="hydroWeeklyDef?.limits.maxObjects ?? 10"
                    data-testid="yns-hydro-regions"
                    @update:model-value="onHydroRegionsChange"
                  />
                </label>
              </div>
              <el-alert type="info" :closable="false" :title="HYDRO_WEEKLY_NOTE" />
              <InsightSeriesChart
                :result="viewStates['hydro-weekly'].result"
                :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                :height="280"
                @select="() => {}"
              />
            </InsightBlock>

            <InsightBlock
              v-if="hasHydroGroups"
              title="云南水电机组群组成与占比（获权）"
              :result="viewStates['hydro-groups'].result"
              :error="viewStates['hydro-groups'].error"
              :loading="viewStates['hydro-groups'].loading"
              :on-retry="() => retryQuery('hydro-groups')"
              :on-refresh="() => retryQuery('hydro-groups')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('hydro-groups')"
            >
              <div class="yns-supply__bar">
                <label class="yns-supply__field">
                  <span>机组群</span>
                  <el-select
                    v-model="unitGroupChoice"
                    placeholder="选择机组群"
                    data-testid="yns-unit-group"
                  >
                    <el-option v-for="option in UNIT_GROUP_OPTIONS" :key="option.id" :value="option.id" :label="option.label" />
                  </el-select>
                </label>
              </div>
              <el-alert type="info" :closable="false" :title="HYDRO_GROUPS_NOTE" />
              <el-empty v-if="!unitGroupChoice" :description="PICK_UNIT_GROUP_TEXT" :image-size="72" />
              <el-table v-else-if="unitGroupRows.length" :data="unitGroupRows" size="small" border max-height="360">
                <el-table-column prop="date" label="业务日" width="110" />
                <el-table-column prop="plant" label="电厂" min-width="160" show-overflow-tooltip />
                <el-table-column prop="unit" label="机组" min-width="120" show-overflow-tooltip />
                <el-table-column prop="shareText" label="出力占比（%）" width="120" align="right" />
              </el-table>
            </InsightBlock>
          </template>

          <!-- 预测与实际：原始曲线 + 误差曲线 + 统计与资格说明 -->
          <template v-else-if="tab.view === 'forecast'">
            <InsightBlock
              title="预测与实际"
              :result="viewStates['forecast-error'].result"
              :error="viewStates['forecast-error'].error"
              :loading="viewStates['forecast-error'].loading"
              :on-retry="() => retryQuery('forecast-error')"
              :on-refresh="() => retryQuery('forecast-error')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('forecast-error')"
            >
              <div class="yns-supply__bar">
                <label class="yns-supply__field">
                  <span>预测</span>
                  <el-select
                    v-model="forecastChoice"
                    placeholder="选择预测"
                    data-testid="yns-forecast-choice"
                  >
                    <el-option
                      v-for="pair in forecastPairs"
                      :key="pair.seriesId"
                      :value="pair.seriesId"
                      :label="pairLabelOf(pair)"
                    />
                  </el-select>
                </label>
              </div>
              <el-alert type="info" :closable="false" :title="FORECAST_MODE_TEXT" />
              <el-alert type="info" :closable="false" :title="NEW_ENERGY_ALIGN_TEXT" />
              <el-alert type="info" :closable="false" :title="ERROR_DIRECTION_TEXT" />
              <template v-if="currentPair">
                <ChartCard title="预测与实际（预测虚线、实际实线）" :height="300" :build-option="() => rawCompareOption" />
                <ChartCard title="误差（预测 − 实际）" :height="260" :build-option="() => errorChartOption" />
                <div v-if="pairSummaryCards.length" class="yns-supply__cards">
                  <div v-for="card in pairSummaryCards" :key="card.key" class="yns-supply__card">
                    <h4 class="yns-supply__card-title">{{ card.title }}</h4>
                    <dl class="yns-supply__card-grid">
                      <template v-for="row in card.rows" :key="row.metricId">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                      </template>
                    </dl>
                    <p v-if="card.note" class="yns-supply__card-note">{{ card.note }}</p>
                  </div>
                </div>
                <p v-if="pairEligibilityText" class="yns-supply__hint">{{ pairEligibilityText }}</p>
              </template>
              <el-alert
                v-for="(item, index) in forecastUnpaired"
                :key="`up-${index}`"
                type="warning"
                :closable="false"
                :title="`未配对：${item}`"
              />
              <el-alert v-for="(note, index) in forecastNotes" :key="`fn-${index}`" type="info" :closable="false" :title="note" />
              <el-alert
                v-for="(item, index) in forecastUnavailable"
                :key="`fu-${index}`"
                type="info"
                :closable="false"
                :title="unavailableText(item)"
              />
            </InsightBlock>
          </template>

          <!-- 历史比较：剩余需求代理 + 窗口对比 -->
          <template v-else>
            <InsightBlock
              title="剩余需求代理"
              :result="viewStates['residual-proxy'].result"
              :error="viewStates['residual-proxy'].error"
              :loading="viewStates['residual-proxy'].loading"
              :on-retry="() => retryQuery('residual-proxy')"
              :on-refresh="() => retryQuery('residual-proxy')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('residual-proxy')"
            >
              <el-alert type="info" :closable="false" :title="RESIDUAL_PROXY_TEXT" />
              <el-alert v-if="proxyFormula" type="info" :closable="false" :title="`计算口径：${proxyFormula}`" />
              <el-alert v-for="(note, index) in proxyNotes" :key="index" type="info" :closable="false" :title="note" />
              <el-alert
                v-for="(item, index) in proxyUnavailable"
                :key="`pu-${index}`"
                type="warning"
                :closable="false"
                :title="item"
              />
              <ChartCard title="剩余需求代理（逐小时，预测口径）" :height="280" :build-option="() => proxyChartOption" />
              <div v-if="proxySummaryCards.length" class="yns-supply__cards">
                <div v-for="card in proxySummaryCards" :key="card.key" class="yns-supply__card">
                  <h4 class="yns-supply__card-title">{{ card.title }}</h4>
                  <dl class="yns-supply__card-grid">
                    <template v-for="row in card.rows" :key="row.metricId">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                    </template>
                  </dl>
                  <p v-if="card.note" class="yns-supply__card-note">{{ card.note }}</p>
                </div>
              </div>
            </InsightBlock>

            <InsightBlock
              title="窗口对比"
              :result="viewStates['compare-reference'].result"
              :error="viewStates['compare-reference'].error"
              :loading="viewStates['compare-reference'].loading"
              :on-retry="() => retryQuery('compare-reference')"
              :on-refresh="() => retryQuery('compare-reference')"
              :source-titles="sourceTitles"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('compare-reference')"
            >
              <div class="yns-supply__bar">
                <label class="yns-supply__field">
                  <span>参考窗口（与当前窗口比较）</span>
                  <InsightDateRange
                    :model-value="referenceWindow ?? { start: '', end: '' }"
                    :max-days="maxDays"
                    data-testid="yns-reference-window"
                    @update:model-value="onReferenceWindowChange"
                  />
                </label>
              </div>
              <el-alert type="info" :closable="false" :title="COMPARE_SCOPE_TEXT" />
              <el-empty v-if="!referenceWindow" :description="COMPARE_PICK_TEXT" :image-size="72" />
              <template v-else>
                <p class="yns-supply__hint">
                  当前窗口 {{ ctx.businessWindow.value.start }} ~ {{ ctx.businessWindow.value.end }}；参考窗口
                  {{ referenceWindow.start }} ~ {{ referenceWindow.end }}
                </p>
                <el-alert v-if="compareDaysDifferent" type="warning" :closable="false" :title="COMPARE_DAYS_TEXT" />
                <el-table v-if="compareRows.length" :data="compareRows" size="small" border max-height="360" data-testid="yns-compare-table">
                  <el-table-column prop="name" label="序列" min-width="200" show-overflow-tooltip />
                  <el-table-column prop="currentMean" label="平均功率（当前，MW）" width="150" align="right" />
                  <el-table-column prop="currentMin" label="最低（当前）" width="110" align="right" />
                  <el-table-column prop="currentMax" label="最高（当前）" width="110" align="right" />
                  <el-table-column prop="referenceMean" label="平均功率（参考，MW）" width="150" align="right" />
                  <el-table-column prop="referenceMin" label="最低（参考）" width="110" align="right" />
                  <el-table-column prop="referenceMax" label="最高（参考）" width="110" align="right" />
                </el-table>
                <p v-else-if="compareReady" class="yns-supply__hint">两个窗口没有共同序列的平均功率，无法对比。</p>
              </template>
            </InsightBlock>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 证据抽屉与历史候选 -->
    <InsightEvidenceDrawer v-model="evidenceVisible" :result="evidenceTarget" :source-titles="sourceTitles" />

    <InsightHistoryCandidates
      v-model="candidatesVisible"
      :analysis-id="SUPPLY_SYSTEM_ANALYSIS"
      :context="ctx.toQueryContext()"
      :filters="candidatesFilters"
      :required-source-ids="candidateSourceIds"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />
  </div>
</template>

<style scoped>
.yns-supply {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yns-supply__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.yns-supply__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yns-supply__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.yns-supply__field :deep(.el-select),
.yns-supply__field :deep(.el-date-editor) {
  width: 220px;
}

.yns-supply__field--wide :deep(.el-select) {
  width: 300px;
}

.yns-supply__meta {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
}

.yns-supply__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}

.yns-supply__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin: 8px 0;
}

.yns-supply__bar .yns-supply__hint {
  align-self: center;
}

.yns-supply__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.yns-supply__card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.yns-supply__card--share {
  border-style: dashed;
  border-color: var(--accent-soft, #94a3b8);
}

.yns-supply__card-title {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.yns-supply__card-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}

.yns-supply__card-grid dt {
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

.yns-supply__card-grid dd {
  margin: 0;
  font-size: var(--font-sm, 13px);
  font-variant-numeric: tabular-nums;
  color: var(--text, #1f2a37);
  text-align: right;
}

.yns-supply__card-note {
  margin: 8px 0 0;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}

.yns-supply__csg {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.yns-supply__csg-title {
  font-weight: 600;
  color: var(--muted, #50616e);
}
</style>
