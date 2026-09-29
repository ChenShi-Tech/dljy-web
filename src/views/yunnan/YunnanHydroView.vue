<script setup lang="ts">
// 云南水电分析（dljy#3389，并入旧版体系，仅云南显示）
// ----------------------------------------------------------------------------
// /sjfx/hydro 的单页实现：工具条（业务日期窗 + AI 解读）→ 指标卡一行 → 主图
// （水电实际与统调负荷、新能源同轴叠线）→ 获权两卡（周出力预测 / 机组群构成）。
// 口径要点（从云南供需页水电段抽取重写，逻辑同源、代码独立，不 import 已封存目录）：
//   - 负荷、水电、新能源不是互斥分量：主图同轴叠线比较，不堆叠、不相加成「总供给」；
//   - 数据只经洞察后端三接口（capabilities / query / coverage）+ shared/insight 契约镜像；
//   - 缺值显示「—」不显示 0；缺测时段断线不插值；按来源登记精度显示；
//   - 获权两分析按能力目录判定可见性：无权整卡不渲染、不发请求，只留「需开通」短标签；
//   - 机组群来源只披露组成与占比，没有电量或出力上限值，不展示也不推算上限；
//   - 页面整洁纪律（2026-09-28）：不写系统生成的结论句，必要说明一律
//     「缩略标题 + el-tooltip 悬浮提示」，不放大段说明框。
// 入口锚定复用 useInsightEntryAnchor（公开 capture 分析覆盖查询，不写死日期）；
// 本页不依赖 VITE_YUNNAN_INSIGHT_WORKSPACE 工作区装配，开关关闭时完整可用。

import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Info } from 'lucide-vue-next'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { formatMetricValue } from 'shared/insight/metrics.mjs'
import { compareText, type InsightContextInput } from 'shared/insight/contract.mjs'
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
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import { currentRegion } from '@/services/region/regionContext'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightObjectPicker from '@/components/insight/InsightObjectPicker.vue'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import {
  buildInsightChartGroups,
  type InsightChartPoint,
} from '@/components/insight/chart/useInsightSeriesChart'
import {
  formatBeijingDateTime,
  formatInsightValue,
  insightPrecision,
  insightSourceTitle,
  type InsightSourceTitle,
} from '@/components/insight/insightText'
import MetricTile from '@/components/common/MetricTile.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import RegionScopedNotice from '@/components/region/RegionScopedNotice.vue'

// ── 分析、来源与固定文案 ─────────────────────────────────────────────────────────────────

const SYSTEM_ANALYSIS = 'supply.system-series'
const HYDRO_WEEKLY_ANALYSIS = 'supply.hydro-weekly-output'
const HYDRO_GROUPS_ANALYSIS = 'supply.hydro-unit-groups'

/** 主图三条云南实际曲线的来源白名单（series 视图按来源裁剪，预测与南网背景不进主图）。 */
const MAINLINE_SOURCES = [
  'yn.system.hydro.actual',
  'yn.system.load.actual',
  'yn.system.new-energy.actual',
] as const

/** 水电序列的来源（summary 指标卡取该来源的平均/最高/最低）。 */
const HYDRO_SOURCE = 'yn.system.hydro.actual'

/** 指标卡（summary）只需要水电与总发电两个来源：水电占比 = 水电 / 总发电。 */
const SUMMARY_SOURCES = [HYDRO_SOURCE, 'yn.system.total-generation.actual'] as const

const SHARE_PREFIX = 'share:hydro:'

/** 说明一律缩略标题 + 悬浮提示（2026-09-28 页面整洁纪律），文案集中在此。 */
const TIPS = {
  notStack: '负荷、水电、新能源不是互斥分量：同轴叠线比较，不堆叠、不相加成「总供给」',
  gaps: '缺测时段断开显示，不插值；窗口内没有观测的时段不画线',
  share: '同一业务范围内：水电 / 总发电（共同有效时段按时长加权）',
  asOf: '窗口内云南实际曲线的最新观测日期；采集断供时停留在最后有数日',
  mean: '所选窗口内有效时段的时长加权平均功率',
  extreme: '窗口内的极值；并列取最早时段',
  weekly: '逐日平均出力（MW），按区域分列、不相加；云南与其他省不可加总',
  groups: '来源只披露机组群组成与出力占比，没有电量或出力上限值，不展示也不推算上限',
  entitlement: '水电周出力预测与机组群构成为获权数据，需开通后查看；未获授权的区块不渲染、不发请求',
  noSource: '来水、库容、弃水暂无数据来源，本页不展示，也不推算',
} as const

/** 水电周出力的区域选项（数据基线：按区域分列，默认只选云南）。 */
const HYDRO_REGION_OPTIONS = ['云南', '广东', '广西', '贵州', '海南'].map((region) => ({ id: region, label: region }))

/** 云南水电机组群选项（数据基线当前只有「31 家水电」一个群）。 */
const UNIT_GROUP_OPTIONS = [{ id: '31 家水电', label: '31 家水电' }]

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)
/** 当前目录是按哪个「地区|公司」拉取的：目录按公司授权返回，二者变了就必须重拉，不能沿用。 */
const capabilitiesScope = ref('')
function currentScope(): string {
  return `${ctx.regionId.value}|${ctx.companyId.value ?? ''}`
}

// 入口锚定：能力目录就绪（含公开系统曲线分析）后扫描最新有数日；失败静默保持当日默认。
const anchorReady = computed(() => capabilities.value?.analyses.some((entry) => entry.analysisId === SYSTEM_ANALYSIS) ?? false)
// 锚定扫描只按主图三条来源求交集：与本页历史候选同口径，且不必读满整套 17 个来源。
const entryAnchor = useInsightEntryAnchor(ctx, { ready: anchorReady, sourceIds: MAINLINE_SOURCES })

/** 契约镜像里的系统曲线分析登记（maxDays / sourceIds），不依赖后端 capabilities 是否下发。 */
const systemAnalysisDef = getInsightAnalysis(SYSTEM_ANALYSIS)
const maxDays = computed(() => systemAnalysisDef?.limits.maxDays ?? 31)

/** 获权两分析按公司授权可见（capabilities 只返回当前公司可用的分析）。 */
const hasHydroWeekly = computed(() => capabilities.value?.analyses.some((a) => a.analysisId === HYDRO_WEEKLY_ANALYSIS) ?? false)
const hasHydroGroups = computed(() => capabilities.value?.analyses.some((a) => a.analysisId === HYDRO_GROUPS_ANALYSIS) ?? false)
/** 能力目录就绪后，仍缺任一获权分析 → 显示一个「需开通」短标签（不渲染空框）。 */
const entitlementMissing = computed(() =>
  capabilities.value !== null && capabilitiesError.value === null && (!hasHydroWeekly.value || !hasHydroGroups.value)
)

/** 能力目录来源 → 业务标题目录（序列命名、证据抽屉共用）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

/** 目录拉取序号：只认最新一次，被新一轮取代的旧拉取不写状态、不自行重拉。 */
let capabilitiesLoadSeq = 0

async function loadCapabilities(): Promise<void> {
  const seq = ++capabilitiesLoadSeq
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  capabilitiesScope.value = currentScope()
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (seq !== capabilitiesLoadSeq) return
    if (!result) {
      // 在途请求被业务代次作废（如只改了日期窗口）且没有更新的拉取：重拉一次恢复。
      void loadCapabilities()
      return
    }
    capabilities.value = result
    ensureAll()
  } catch (error) {
    if (seq !== capabilitiesLoadSeq) return
    capabilitiesError.value = error as InsightRequestError
  } finally {
    if (seq === capabilitiesLoadSeq) capabilitiesLoading.value = false
  }
}

// ── 查询状态（签名去重 + 代次作废，逻辑同云南供需页水电段）──────────────────────────────

type QueryName = 'series' | 'summary' | 'hydro-weekly' | 'hydro-groups'

type ViewState = {
  result: InsightBlockResult | null
  error: InsightRequestError | null
  loading: boolean
  /** 最近一次成功/失败查询的签名；与当前签名不同即口径过期 */
  queriedKey: string
  /** 在途查询的签名：同签名在途时不重复发请求 */
  inflightKey: string
}

function blankState(): ViewState {
  return { result: null, error: null, loading: false, queriedKey: '', inflightKey: '' }
}

const viewStates = reactive<Record<QueryName, ViewState>>({
  series: blankState(),
  summary: blankState(),
  'hydro-weekly': blankState(),
  'hydro-groups': blankState(),
})

/** 水电周出力的区域选择：默认只选「云南」，区域分列不相加。 */
const hydroRegions = ref<string[]>(['云南'])
/** 机组群选择：数据基线只有一个群，默认选中它（获权才会发请求）；清空后不发请求。 */
const unitGroupChoice = ref(UNIT_GROUP_OPTIONS[0]?.id ?? '')

function queryKeyOf(name: QueryName): string {
  if (name === 'hydro-weekly') return ['hydro-weekly', ctx.contextVersion.value, hydroRegions.value.join(',')].join('|')
  if (name === 'hydro-groups') return ['hydro-groups', ctx.contextVersion.value, unitGroupChoice.value].join('|')
  return [name, ctx.contextVersion.value].join('|')
}

// 上下文变化（窗口/地区/公司）：所有旧结果属于另一份读取，全部作废并重查就绪的查询。
// 地区或公司变了：能力目录也属于旧主体，先清空再重拉，拿到新目录后才发查询——
// 否则会按旧公司的授权渲染获权卡、发出注定被拒的请求，或一直藏着新公司已获权的卡。
watch(
  () => ctx.contextVersion.value,
  () => {
    for (const name of Object.keys(viewStates) as QueryName[]) {
      // 签名已与新上下文一致的在途查询（如锚定落定的同一拍已被另一路 watcher 发出）原样保留，避免重复请求。
      const entry = viewStates[name]
      if (entry.loading && entry.inflightKey === queryKeyOf(name)) continue
      Object.assign(entry, blankState())
    }
    if (capabilitiesScope.value !== currentScope()) {
      capabilities.value = null
      void loadCapabilities()
      return
    }
    ensureAll()
  }
)
// 入口锚定落定（窗口已改到最新有数据日，或确认无需改）：发出被暂缓的首轮查询。
watch(
  () => entryAnchor.pending.value,
  (pending) => {
    if (!pending) ensureAll()
  }
)
// 局部选择变化：只作废对应的获权查询（系统曲线与它们无关，不重发）。
watch(hydroRegions, () => {
  Object.assign(viewStates['hydro-weekly'], blankState())
  ensureQuery('hydro-weekly')
})
watch(unitGroupChoice, () => {
  Object.assign(viewStates['hydro-groups'], blankState())
  ensureQuery('hydro-groups')
})

function onWindowChange(next: { start: string; end: string }): void {
  ctx.setBusinessWindow(next.start, next.end)
}

function onHydroRegionsChange(ids: string[]): void {
  hydroRegions.value = [...ids]
}

/** 目录就绪后页面的全部查询：公开两视图恒查，获权两查询各自带前置拦截。 */
function ensureAll(): void {
  ensureQuery('series')
  ensureQuery('summary')
  ensureQuery('hydro-weekly')
  ensureQuery('hydro-groups')
}

/** 前置拦截（能力未就绪 / 未选对象 / 无授权）+ 同签名去重后发查询。 */
function ensureQuery(name: QueryName): void {
  if (!capabilities.value || capabilitiesError.value) return
  // 入口锚定尚未落定：窗口随时会被改到最新有数据日，此刻发查询必被作废重发，等落定后再发。
  if (anchorReady.value && entryAnchor.pending.value) return
  if (name === 'hydro-weekly' && !(hasHydroWeekly.value && hydroRegions.value.length)) return
  if (name === 'hydro-groups' && !(hasHydroGroups.value && unitGroupChoice.value)) return
  const key = queryKeyOf(name)
  if (viewStates[name].queriedKey === key) return // 有结果或已按此键失败过：重试由用户触发
  if (viewStates[name].loading && viewStates[name].inflightKey === key) return // 同签名已在途
  void runQuery(name)
}

function buildRequest(name: QueryName): { analysisId: string; context: InsightContextInput; filters: Record<string, unknown> } {
  if (name === 'hydro-weekly') {
    return { analysisId: HYDRO_WEEKLY_ANALYSIS, context: ctx.toQueryContext(), filters: { objectIds: [...hydroRegions.value] } }
  }
  if (name === 'hydro-groups') {
    return { analysisId: HYDRO_GROUPS_ANALYSIS, context: ctx.toQueryContext(), filters: { objectIds: [unitGroupChoice.value] } }
  }
  // 系统曲线分析登记了 17 个来源，本页只用其中几个：显式限定来源，服务端就只读这几个。
  const sourceIds = name === 'series' ? MAINLINE_SOURCES : SUMMARY_SOURCES
  return { analysisId: SYSTEM_ANALYSIS, context: { ...ctx.toQueryContext(), sourceIds: [...sourceIds] }, filters: { view: name } }
}

async function runQuery(name: QueryName): Promise<void> {
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  entry.loading = true
  entry.inflightKey = key
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => queryInsight(buildRequest(name), { signal }))
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

/** 手动重试 / 刷新：清键重发。 */
function retryQuery(name: QueryName): void {
  viewStates[name].queriedKey = ''
  ensureQuery(name)
}

// ── 主图：云南水电实际 + 统调负荷 + 新能源出力（同轴叠线，不堆叠）────────────────────────

/** series 结果裁剪：目录、明细行与 sourceRefs 同步裁掉（主图与证据抽屉只列各自来源）。 */
function filterSeriesResult(result: InsightBlockResult | null, predicate: (meta: InsightSeriesMeta) => boolean): InsightBlockResult | null {
  const data = result?.data
  if (!result || !data) return null
  const kept = ((data.series ?? []) as InsightSeriesMeta[]).filter(predicate)
  const keptIds = new Set(kept.map((meta) => meta.seriesId))
  const rows = ((data.rows ?? []) as Array<{ seriesId: string }>).filter((row) => keptIds.has(String(row.seriesId)))
  const keptSourceIds = new Set(kept.map((meta) => meta.sourceId))
  const sourceRefs = (result.sourceRefs ?? []).filter((ref) => keptSourceIds.has(String(ref.sourceId)))
  return { ...result, sourceRefs, data: { ...data, rows, series: kept } }
}

/** 序列业务名：系统曲线无对象维度，用来源标题承载展示身份。 */
function seriesLabelOf(meta: InsightSeriesMeta): string {
  return insightSourceTitle(meta.sourceId, sourceTitles.value)?.title ?? meta.sourceId
}

/** 主图结果：三条云南实际曲线（来源白名单裁剪，预测与南网背景不进）。 */
const mainSeriesResult = computed(() =>
  filterSeriesResult(
    viewStates.series.result,
    (meta) =>
      meta.businessScope === 'yunnan' &&
      meta.variant !== 'forecast' &&
      (MAINLINE_SOURCES as readonly string[]).includes(meta.sourceId)
  )
)

type PlainChartSeries = { name: string; unit: string; points: InsightChartPoint[]; sourceId: string }

/** 一条序列 → ECharts 阶梯线（step end、缺测断开、无平滑；不堆叠、无面积）。 */
function plainLineOf(series: PlainChartSeries): Record<string, unknown> {
  return {
    name: series.name,
    type: 'line',
    step: 'end',
    connectNulls: false,
    smooth: false,
    symbol: 'none',
    data: series.points.map((point) => ({
      value: [point.ts, point.value] as [number, number | null],
      end: point.end,
      ...(point.edge ? { edge: true } : {}),
    })),
  }
}

/** 北京时间 MM-DD HH:mm（tooltip 用；显式换算，不依赖浏览器本地时区）。 */
function beijingMDHM(ms: number): string {
  const beijing = new Date(ms + 8 * 3_600_000).toISOString()
  return `${beijing.slice(5, 10)} ${beijing.slice(11, 16)}`
}

/** 主图 option：单 MW 轴；tooltip 按来源精度显示，边界点不是观测不进 tooltip。 */
const mainOption = computed<Record<string, unknown>>(() => {
  const charts = mainSeriesResult.value
    ? buildInsightChartGroups(mainSeriesResult.value).flatMap((group) =>
        group.series.map((chart): PlainChartSeries => ({
          name: seriesLabelOf(chart.meta),
          unit: chart.unit,
          points: chart.points,
          sourceId: chart.meta.sourceId,
        }))
      )
    : []
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? (raw as Array<{ marker?: string; seriesName?: string; data?: { value?: [number, number | null]; end?: string; edge?: true } }>) : []
        const lines: string[] = []
        for (const param of params) {
          const value = param.data?.value
          if (!value || param.data?.edge) continue
          const [ts, val] = value
          const endMs = param.data?.end ? Date.parse(param.data.end) : Number.NaN
          const slot = Number.isFinite(endMs) ? `~${beijingMDHM(endMs)}` : ''
          const precision = insightPrecision(charts.find((chart) => chart.name === param.seriesName)?.sourceId ?? '')
          const shown = val === null || val === undefined || !Number.isFinite(val) ? '缺测' : formatInsightValue(String(val), precision)
          lines.push(`${param.marker ?? ''}${param.seriesName ?? ''}　${beijingMDHM(ts)}${slot}　${shown} MW`)
        }
        return lines.join('<br/>')
      },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 64, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: 'MW', scale: true },
    series: charts.map(plainLineOf),
  }
})

/** 数据截至：窗口内主图曲线最后一个有观测时段所属的日期（北京时间）。
 *  取时段起点而非终点：当日末个 15 分钟时段的终点是次日 00:00，按终点取日期会多算一天。 */
const dataAsOf = computed<string | null>(() => {
  const rows = (mainSeriesResult.value?.data?.rows ?? []) as Array<{ intervalStart?: string }>
  let latest = ''
  for (const row of rows) {
    const start = typeof row.intervalStart === 'string' ? row.intervalStart : ''
    if (start > latest) latest = start
  }
  return latest ? latest.slice(0, 10) : null
})

// ── 指标卡：水电平均/最高/最低 + 水电占比（云南）+ 数据截至 ─────────────────────────────

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null }

function summaryIndexOf(result: InsightBlockResult | null): Map<string, Map<string, MetricRow>> {
  const map = new Map<string, Map<string, MetricRow>>()
  for (const row of ((result?.data?.rows ?? []) as unknown as MetricRow[])) {
    const own = map.get(row.seriesId) ?? new Map<string, MetricRow>()
    own.set(row.metricId, row)
    map.set(row.seriesId, own)
  }
  return map
}

const summaryIndex = computed(() => summaryIndexOf(viewStates.summary.result))

/** 水电序列的 summary 行（目录按来源定位，没有该序列时为 undefined → 全部显示「—」）。 */
const hydroSummaryRows = computed(() => {
  const catalog = ((viewStates.summary.result?.data?.series ?? []) as InsightSeriesMeta[]).find((meta) => meta.sourceId === HYDRO_SOURCE)
  return catalog ? summaryIndex.value.get(catalog.seriesId) : undefined
})

/** 云南口径水电占比行（share 目录条目 businessScope=yunnan）。 */
const hydroShareRow = computed(() => {
  const catalog = ((viewStates.summary.result?.data?.series ?? []) as InsightSeriesMeta[])
    .find((meta) => String(meta.seriesId).startsWith(SHARE_PREFIX) && meta.businessScope === 'yunnan')
  return catalog ? summaryIndex.value.get(catalog.seriesId)?.get('supply.hydro-share') : undefined
})

function metricText(metricId: string, row: MetricRow | undefined): string {
  const shown = row ? formatMetricValue(metricId, row.value) : null
  return shown === null || shown === undefined ? '—' : String(shown)
}

/** 极值出现时段（北京时间，原文口径：并列取最早时段）。 */
function extremeSub(row: MetricRow | undefined): string {
  return row?.atIntervalStart ? `${formatBeijingDateTime(row.atIntervalStart)} 出现` : ''
}

const tiles = computed(() => {
  const rows = hydroSummaryRows.value
  const share = hydroShareRow.value
  return [
    { key: 'mean', label: '水电平均出力', value: metricText('supply.mean-power', rows?.get('supply.mean-power')), unit: 'MW', sub: '', info: TIPS.mean },
    { key: 'max', label: '最高出力', value: metricText('supply.maximum', rows?.get('supply.maximum')), unit: 'MW', sub: extremeSub(rows?.get('supply.maximum')), info: TIPS.extreme },
    { key: 'min', label: '最低出力', value: metricText('supply.minimum', rows?.get('supply.minimum')), unit: 'MW', sub: extremeSub(rows?.get('supply.minimum')), info: TIPS.extreme },
    { key: 'share', label: '水电占比（云南）', value: metricText('supply.hydro-share', share), unit: '%', sub: '', info: TIPS.share },
    { key: 'as-of', label: '数据截至', value: dataAsOf.value ?? '—', unit: '', sub: '', info: TIPS.asOf },
  ]
})

// ── 获权两卡：周出力预测（区域分列）与机组群构成（占比表，无上限）────────────────────────

const weeklyCurrent = computed(() => ({
  regionId: ctx.regionId.value,
  companyId: ctx.companyId.value,
  contextVersion: ctx.contextVersion.value,
}))

/** 机组群结果 → 表格行：逐日组成与占比（无上限值，不画上限线）。 */
const unitGroupRows = computed(() => {
  const result = viewStates['hydro-groups'].result
  const data = result?.data
  if (!result || !data) return []
  const catalog = new Map(((data.series ?? []) as InsightSeriesMeta[]).map((meta) => [meta.seriesId, meta]))
  const first = [...catalog.values()][0]
  const places = first ? insightPrecision(first.sourceId) : 1
  return ((data.rows ?? []) as Array<{ seriesId: string; intervalStart: string; value: string }>)
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
    // 用码位比较而非 localeCompare：后者随运行环境语言区域变化，排序不稳定。
    .sort((a, b) => compareText(a.raw, b.raw) || compareText(a.plant, b.plant) || compareText(a.unit, b.unit))
})

// ── 历史候选 ─────────────────────────────────────────────────────────────────────────────

const candidatesVisible = ref(false)

function onCandidateSelect(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

/** 历史候选按主图三条云南实际来源求交集（预测与南网背景不参与）。 */
const candidateSourceIds = computed(() => {
  const declared = systemAnalysisDef?.sourceIds ?? []
  return declared.filter((sourceId) => (MAINLINE_SOURCES as readonly string[]).includes(sourceId))
})

// ── AI 解读：旧页 defineAiPage 做法，切片只传摘要不传原始行 ──────────────────────────────

const ai = useAiSidebar()

function insightContext(): Record<string, unknown> {
  const rows = hydroSummaryRows.value
  const share = hydroShareRow.value
  return {
    page: '云南水电分析',
    window: `${ctx.businessWindow.value.start} ~ ${ctx.businessWindow.value.end}`,
    metrics: {
      mean: metricText('supply.mean-power', rows?.get('supply.mean-power')),
      max: metricText('supply.maximum', rows?.get('supply.maximum')),
      min: metricText('supply.minimum', rows?.get('supply.minimum')),
      share: metricText('supply.hydro-share', share),
      asOf: dataAsOf.value ?? '—',
      unit: 'MW / %',
    },
    mainSeries: mainSeriesResult.value ? (((mainSeriesResult.value.data?.series ?? []) as InsightSeriesMeta[]).map(seriesLabelOf)) : [],
    entitlement: {
      weekly: hasHydroWeekly.value,
      groups: hasHydroGroups.value,
      regions: hasHydroWeekly.value ? [...hydroRegions.value] : undefined,
      unitGroup: hasHydroGroups.value && unitGroupChoice.value ? unitGroupChoice.value : undefined,
    },
    note: '主图为同轴叠线不堆叠；获权两块未授权时不渲染；本摘要只含窗口与统计值，不含逐时行数据',
  }
}

defineAiPage({ label: '水电分析', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function onAiInterpret(): void {
  ai.interpret()
}

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <main class="ynh">
    <RegionScopedNotice
      v-if="currentRegion.id !== 'yunnan'"
      module-title="水电分析"
      expected-region-label="云南"
      :current-region-label="currentRegion.name"
    />

    <template v-else>
      <!-- 工具条：业务日期窗（单次 ≤31 天）+ AI 解读 -->
      <section class="ynh__controls">
        <div class="ynh__date">
          <label class="ynh__field">
            <span>分析日期</span>
            <InsightDateRange :model-value="ctx.businessWindow.value" :max-days="maxDays" @update:model-value="onWindowChange" />
          </label>
          <!-- 入口定位：今日无数据时自动落到最新有数日；只留短标签 + 悬浮说明，不放整句横幅 -->
          <span v-if="entryAnchor.anchorNotice.value" class="ynh__hint-term" tabindex="0" data-testid="ynh-anchor-tag">
            已定位最新有数日
            <el-tooltip
              :content="`今日（${entryAnchor.anchorNotice.value.requested}）暂无数据，已定位到最新有数据日 ${entryAnchor.anchorNotice.value.anchoredTo}`"
              placement="top"
              :show-after="150"
            >
              <span class="ynh__hint-icon" aria-label="日期定位说明"><Info :size="12" /></span>
            </el-tooltip>
            <el-button link type="primary" size="small" data-testid="ynh-anchor-back-today" @click="entryAnchor.backToToday">切回今天</el-button>
          </span>
        </div>
        <el-button type="primary" data-testid="ynh-ai-entry" @click="onAiInterpret">✨ AI 解读本页</el-button>
      </section>

      <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="能力目录读取失败">
        <p class="ynh__hint">当前看不到可用的水电分析；可重试。</p>
        <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
      </el-alert>

      <template v-if="capabilities">
        <!-- 指标卡一行：数值取 summary 视图与 share 行，按登记精度显示，缺值「—」不显示 0 -->
        <InsightBlock
          title="水电概况"
          hide-sources
          :result="viewStates.summary.result"
          :error="viewStates.summary.error"
          :loading="viewStates.summary.loading"
          :source-titles="sourceTitles"
          :on-retry="() => retryQuery('summary')"
          :on-refresh="() => retryQuery('summary')"
          @open-candidates="candidatesVisible = true"
        >
          <div class="ynh__tiles" data-testid="ynh-tiles">
            <MetricTile
              v-for="tile in tiles"
              :key="tile.key"
              :label="tile.label"
              :value="tile.value"
              :unit="tile.unit"
              :sub="tile.sub"
              :info="tile.info"
              :tone="tile.value === '—' ? 'muted' : 'default'"
            />
          </div>
        </InsightBlock>

        <!-- 主图：同轴叠线（不堆叠不相加）；缺测断线；说明为缩略标签 + 悬浮提示 -->
        <InsightBlock
          title="云南水电与系统曲线"
          hide-sources
          :result="mainSeriesResult"
          :error="viewStates.series.error"
          :loading="viewStates.series.loading"
          :source-titles="sourceTitles"
          :on-retry="() => retryQuery('series')"
          :on-refresh="() => retryQuery('series')"
          @open-candidates="candidatesVisible = true"
        >
          <div class="ynh__hints">
            <span class="ynh__hint-term" tabindex="0">
              同轴叠线
              <el-tooltip :content="TIPS.notStack" placement="top" :show-after="150">
                <span class="ynh__hint-icon" aria-label="同轴叠线口径说明"><Info :size="12" /></span>
              </el-tooltip>
            </span>
            <span class="ynh__hint-term" tabindex="0">
              缺测断线
              <el-tooltip :content="TIPS.gaps" placement="top" :show-after="150">
                <span class="ynh__hint-icon" aria-label="缺测断线口径说明"><Info :size="12" /></span>
              </el-tooltip>
            </span>
          </div>
          <ChartCard
            title="水电 · 统调负荷 · 新能源（实际，MW）"
            :height="340"
            :build-option="() => mainOption"
          />
        </InsightBlock>

        <!-- 获权两卡：无权整卡不渲染、不发请求，只留一个「需开通」短标签 -->
        <section class="ynh__entitled">
          <InsightBlock
            v-if="hasHydroWeekly"
            title="水电周出力预测"
            hide-sources
            class="ynh__entitled-card"
            :result="viewStates['hydro-weekly'].result"
            :error="viewStates['hydro-weekly'].error"
            :loading="viewStates['hydro-weekly'].loading"
            :source-titles="sourceTitles"
            :on-retry="() => retryQuery('hydro-weekly')"
            :on-refresh="() => retryQuery('hydro-weekly')"
            @open-candidates="candidatesVisible = true"
          >
            <div class="ynh__bar">
              <label class="ynh__field">
                <span>区域（多选，默认云南）</span>
                <InsightObjectPicker
                  :model-value="hydroRegions"
                  :options="HYDRO_REGION_OPTIONS"
                  :max-objects="10"
                  data-testid="ynh-hydro-regions"
                  @update:model-value="onHydroRegionsChange"
                />
              </label>
              <span class="ynh__hint-term" tabindex="0">
                区域分列
                <el-tooltip :content="TIPS.weekly" placement="top" :show-after="150">
                  <span class="ynh__hint-icon" aria-label="区域分列口径说明"><Info :size="12" /></span>
                </el-tooltip>
              </span>
            </div>
            <InsightSeriesChart :result="viewStates['hydro-weekly'].result" :current="weeklyCurrent" :height="280" @select="() => {}" />
          </InsightBlock>

          <InsightBlock
            v-if="hasHydroGroups"
            title="机组群构成"
            hide-sources
            class="ynh__entitled-card"
            :result="viewStates['hydro-groups'].result"
            :error="viewStates['hydro-groups'].error"
            :loading="viewStates['hydro-groups'].loading"
            :source-titles="sourceTitles"
            :on-retry="() => retryQuery('hydro-groups')"
            :on-refresh="() => retryQuery('hydro-groups')"
            @open-candidates="candidatesVisible = true"
          >
            <div class="ynh__bar">
              <label class="ynh__field">
                <span>机组群</span>
                <el-select v-model="unitGroupChoice" placeholder="选择机组群" data-testid="ynh-unit-group">
                  <el-option v-for="option in UNIT_GROUP_OPTIONS" :key="option.id" :value="option.id" :label="option.label" />
                </el-select>
              </label>
              <span class="ynh__hint-term" tabindex="0">
                仅组成与占比
                <el-tooltip :content="TIPS.groups" placement="top" :show-after="150">
                  <span class="ynh__hint-icon" aria-label="机组群口径说明"><Info :size="12" /></span>
                </el-tooltip>
              </span>
            </div>
            <el-empty v-if="!unitGroupChoice" description="请选择机组群" :image-size="72" />
            <el-table v-else-if="unitGroupRows.length" :data="unitGroupRows" size="small" border max-height="360">
              <el-table-column prop="date" label="业务日" width="110" />
              <el-table-column prop="plant" label="电厂" min-width="160" show-overflow-tooltip />
              <el-table-column prop="unit" label="机组" min-width="120" show-overflow-tooltip />
              <el-table-column prop="shareText" label="出力占比（%）" width="120" align="right" />
            </el-table>
          </InsightBlock>

          <span v-if="entitlementMissing" class="ynh__entitlement" data-testid="ynh-entitlement-tag">
            <el-tooltip :content="TIPS.entitlement" placement="top" :show-after="150">
              <el-tag type="warning" effect="plain">需开通</el-tag>
            </el-tooltip>
          </span>
        </section>

        <!-- 来水、库容、弃水：只一个短标签 + 悬浮说明，不画空图 -->
        <div class="ynh__footer-hints">
          <span class="ynh__hint-term" tabindex="0" data-testid="ynh-no-source-tag">
            来水·库容·弃水
            <el-tooltip :content="TIPS.noSource" placement="top" :show-after="150">
              <span class="ynh__hint-icon" aria-label="来水库容弃水说明"><Info :size="12" /></span>
            </el-tooltip>
          </span>
        </div>
      </template>
    </template>

    <!-- 历史候选 -->
    <InsightHistoryCandidates
      v-model="candidatesVisible"
      :analysis-id="'supply.system-series'"
      :context="ctx.toQueryContext()"
      :filters="{ view: 'series' }"
      :required-source-ids="candidateSourceIds"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />
  </main>
</template>

<style scoped>
.ynh {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--bg);
  color: var(--text);
}

.ynh__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.ynh__date {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.ynh__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ynh__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.ynh__field :deep(.el-select) {
  width: 220px;
}

.ynh__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.ynh__hints,
.ynh__footer-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.ynh__hint-term {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--line, #e2e8f0);
  background: var(--panel-sub, #f8fafc);
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
  cursor: help;
}

.ynh__hint-icon {
  display: inline-grid;
  place-items: center;
  color: var(--muted, #94a3b8);
  cursor: help;
}

.ynh__hint-icon:hover,
.ynh__hint-icon:focus-visible,
.ynh__hint-term:hover .ynh__hint-icon {
  color: var(--text, #1f2a37);
}

.ynh__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.ynh__entitled {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(430px, 100%), 1fr));
  gap: 12px;
  align-items: start;
}

.ynh__entitled-card {
  min-width: 0;
}

.ynh__entitlement {
  display: inline-flex;
  align-self: center;
  justify-self: center;
  cursor: help;
}

.ynh__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}
</style>
