<script setup lang="ts">
// 云南结算价分析面板（xhjy/yunnan/settlement-price）：日前-实时-结算三价对比 + 峰谷价差水位。
// 属父 Epic #376（现货接入），任务 #381；#2992 量费加权均价 + 默认日期改当天。
//
// 三路真实数据源（非 Mock）：
//   ① 综合结算均价（集团口径）：fetchWeightedSettlementAvg() ← POST /api/v1/review/analysis/settlement
//      服务端「成对有效记录 Σ电费/Σ电量」量费加权（dljy#2998 契约）。前端不实现第二套加权公式，
//      服务端失败显示中文原因、绝不回退等权（#2992 红线）。按日走 current.daily、周/月走 current.buckets。
//   ② 样站等权三价：loadSettlementPrices() ← fetchCaptured('yn_spot_settlement','yn_settlement_daily')
//      yn-fact-pnl.mjs 已 filter result_type==='formal'，字段 daPrice/rtPrice/
//      sampleAvgPrice(样站等权平均电价)/ltmPrice(中长期参照)。按日跨电厂等权，可再聚合周/月（日均等权）。
//      全部厂站时展示名带「样站等权」并注明「不是集团结算均价」；单厂保持原名（无跨厂平均）。
//   ③ 峰谷价差水位 + 最高/最低/均价/负价占比：fetchDailySummary()（spotClient /v1/spot/node-price/daily）
//      全节点日聚合（avg/max/min/neg_share_pct），单日水位 + 日期范围趋势；水位带=Top N 节点 min~max 范围。
//
// 默认日期纪律（#2992）：首次进入默认北京时间「当天」；所选范围无已入库资料时给
// 「查看历史资料」入口（按 /api/real-coverage 实时覆盖区间）；用户主动选历史后顶部
// 显示「历史资料：起 至 止」。不再写死 2026-05，不自动跳月。
//
// 呈现纪律（用户强制）：出清实线（smooth:false·连续量直线），中长期价虚线（合约参照·非主序列）；
// 缺测用 null 不连线（connectNulls:false）。严格地区 yunnan「真实或空」：无数据走空态、不回退山西。
import { computed, onMounted, ref, watch } from 'vue'
import { Coins, Activity, BarChart3, TableProperties, Waves, History } from 'lucide-vue-next'
import ChartCard from '../../../components/common/ChartCard.vue'
import DataQualityBadge from '../../../components/common/DataQualityBadge.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'
import DataState from '../../../components/common/DataState.vue'
import { mapWithConcurrency } from '../../../utils/concurrency'
import DynamicTable from '../../../components/common/DynamicTable.vue'
import SpotSkeleton from '../../../components/common/SpotSkeleton.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import SpotFilterBar from '../../../components/spot/SpotFilterBar.vue'
import { onRegionChange } from '../../../composables/useRegionReload'
import { chartChrome } from '../../../composables/useTheme'
import { onSelectionChange, useSpotSelection } from '@/composables/useSpotSelection'
import { ALL_PLANTS, ALL_UNITS, usePlantUnitFilter, type PlantUnitFilterRow } from '@/composables/usePlantUnitFilter'
import { axisTooltip, chartToolbox, fmtNum, emptyOverlay, sliderZoom } from '@/services/chart/chartOptions'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchSettlementCoverage } from '@/services/market/captureCoverage'
import {
  fetchDailySummary,
  type SpotMarket,
  type DailySummaryItem
} from '@/services/market/spotClient'
import {
  SETTLEMENT_PRIVATE_FAMILIES,
  loadSettlementPrices,
  aggregatePoints,
  type SettlementPricePoint,
  type Aggregation
} from '@/services/market/settlementClient'
import {
  fetchWeightedSettlementAvg,
  weightedAvgSeries,
  describeWeightedFailure,
  isHistoryRange,
  resolveInitialNodeDate,
  resolveInitialSettleRange,
  settleToday,
  historyJumpRange,
  type SettlementAnalysis,
  type WeightedAvgPoint
} from '@/services/market/yunnanSettlementAnalysis'
import { DEFAULT_SPOT_SELECTION_DATE, DEFAULT_SPOT_SELECTION_DATE_RANGE } from '@/stores/spotSelection'

type DateRange = [string, string]
type PriceField = 'daPrice' | 'rtPrice' | 'ltmPrice'
type PriceBandRange = { start: number; end: number }
type PeakValleyTrendPoint = {
  date: string
  max: number | null
  min: number | null
  avg: number | null
  spread: number | null
  negShare: number | null
  nodeCount: number
}

// 控件状态（#2992）：默认北京时间「当天」；store 出厂默认（写死 2026-05-01，非用户选择）不采用；
// 用户/其它面板主动选过的范围（含单日）一律尊重，不再强制拉回五月。
const spotSelection = useSpotSelection()
const initialSelection = spotSelection.snapshot()

function normalizeRange(value: readonly [string, string] | DateRange | undefined): DateRange {
  if (!value?.[0] || !value?.[1]) return [...dateRange.value]
  return [value[0], value[1]]
}

const initialRangeValue = resolveInitialSettleRange(
  initialSelection.dateRange,
  DEFAULT_SPOT_SELECTION_DATE_RANGE,
  settleToday()
)
const dateRange = ref<DateRange>(initialRangeValue)
// 节点电价快照日（峰谷水位/KPI 用）：默认范围末日（#2992 起不再写死五月），store 里
// 用户主动选过的日优先。
const nodeDate = ref(
  initialSelection.date && initialSelection.date !== DEFAULT_SPOT_SELECTION_DATE
    ? initialSelection.date
    : resolveInitialNodeDate(initialRangeValue)
)
const selectedPlant = ref<string>(initialSelection.plant || ALL_PLANTS)
const selectedUnit = ref<string>(ALL_UNITS)
const selectedNode = ref(initialSelection.node)
const aggregation = ref<Aggregation>('day')
const market = ref<SpotMarket>(initialSelection.market || 'da')

const aggOptions: { value: Aggregation; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' }
]
const marketOptions = [
  { value: 'da' as SpotMarket, label: '日前' },
  { value: 'rt' as SpotMarket, label: '实时' }
]

// 数据
const settlePoints = ref<SettlementPricePoint[]>([])
const settlePlantOptions = ref<string[]>([])
const dailyItems = ref<DailySummaryItem[]>([])
const peakValleyTrend = ref<PeakValleyTrendPoint[]>([])
// 综合结算均价（服务端量费加权）：analysis 原样持有，序列按聚合粒度派生。
const weightedAnalysis = ref<SettlementAnalysis | null>(null)
// 已入库结算覆盖区间（查看历史资料入口用）；取不到为 null → 只说暂无资料。
const settlementCoverage = ref<{ start: string; end: string } | null>(null)

// 加载/错误态
const settleLoading = ref(false)
const dailyLoading = ref(false)
const weightedLoading = ref(false)
// 版本守卫：loadSettle/loadDaily/loadWeightedAvg 各自维护 seq，切日期/厂站/聚合旧响应丢弃（#405 同族，#545）
const settleSeq = ref(0)
const dailySeq = ref(0)
const weightedSeq = ref(0)
let weightedController: AbortController | null = null
const settleErrorMsg = ref('')
const dailyErrorMsg = ref('')
const weightedErrorMsg = ref('')
// 两族独立空态提示：结算族未摄取 / 节点电价族未摄取 Parquet。
const settleIngestHint = ref(false)
const nodeIngestHint = ref(false)

const isAllPlants = computed(() => selectedPlant.value === ALL_PLANTS)

const emptyPlantRows = computed<PlantUnitFilterRow[]>(() => [])
const plantFilter = usePlantUnitFilter({
  rows: emptyPlantRows,
  selectedPlant,
  selectedUnit,
  plantOptions: settlePlantOptions,
  allPlantsLabel: '全部厂站'
})
const plantOptions = plantFilter.plantOptions
const plantLabel = plantFilter.plantLabel

// 当前筛选+聚合后的样站等权三价序列。
const aggregatedPoints = computed(() => aggregatePoints(settlePoints.value, aggregation.value))
const rangeDates = computed(() => daysBetween(dateRange.value))
const hasSettleData = computed(() => aggregatedPoints.value.length > 0)
const hasDailySnapshot = computed(() => peakValleyRows.value.length > 0)
const hasPeakValleyTrend = computed(() => peakValleyTrend.value.some((p) => p.spread !== null))
const errorMsg = computed(() => settleErrorMsg.value || dailyErrorMsg.value)

// ---- 综合结算均价（服务端量费加权，#2992）----
// 图 x 轴标签由 aggregatePoints 的 labelOf 生成（周=`YYYY-MM-DD 周`、月=`YYYY-MM 月`）；
// 服务端 bucket.key 是 ISO 周一日期 / YYYY-MM，与 weekKey/monthKey 分组键一致，直接映射。
function weightedLabel(key: string, agg: Aggregation): string {
  if (agg === 'week') return `${key} 周`
  if (agg === 'month') return `${key} 月`
  return key
}

const weightedPoints = computed<WeightedAvgPoint[]>(() =>
  weightedAvgSeries(weightedAnalysis.value, aggregation.value)
)
const weightedByLabel = computed(() => {
  const m = new Map<string, number | null>()
  for (const p of weightedPoints.value) m.set(weightedLabel(p.key, aggregation.value), p.price)
  return m
})
// 「查看历史资料（起—止）」入口：仅当拿到真实覆盖区间才出现（取不到只说暂无资料，不编造覆盖）。
const coverageJump = computed(() => historyJumpRange(settlementCoverage.value))
// 空态兜底：加载结束且 x 轴无样站点即进空态分支。加载失败（settleErrorMsg）也落在这里，
// 由模板把文案切换成「加载失败」并指向顶部页面级错误提示——错误整条只在顶部 alert 出现
// 一次，区块内不再重复渲染（对齐 YunnanNodePricePanel 的单点报错惯例）。
const showSettleEmpty = computed(
  () => !settleLoading.value && !weightedLoading.value && !hasSettleData.value
)
// 历史资料提示：所选范围整体早于今天（完整日期）。
const historyNotice = computed(() =>
  isHistoryRange(dateRange.value, settleToday())
    ? `历史资料：${dateRange.value[0]} 至 ${dateRange.value[1]}`
    : ''
)

// hero ⓘ 全文（#2992 口径一字不减，只降呈现层级；端点/公式原文保留于此）
const HERO_INFO = [
  '综合结算均价：服务端结算统计按「成对有效记录 Σ电费/Σ电量」量费加权（集团口径，前端不做二次计算），失败时不提供替代算法。',
  '日前/实时/中长期：样站等权参照线（全部厂站时为按厂站等权），中长期为合约虚线。',
  '节点电价峰谷价差水位：来自节点电价权威后端（/v1/spot/node-price/daily）。',
  '云南缺真实数据时如实为空，不回退他省口径。'
].join('\n')

// 展示名（#2992）：综合结算均价只认服务端量费加权口径；样站三条线在「全部厂站」时
// 明示等权口径，单厂时保持原名（无跨厂平均）。
const seriesNames = computed(() => ({
  da: isAllPlants.value ? '样站等权日前价' : '日前结算价',
  rt: isAllPlants.value ? '样站等权实时价' : '实时结算价',
  avg: '综合结算均价（量费加权）',
  ltm: isAllPlants.value ? '样站等权中长期价(参照)' : '中长期电价(参照)'
}))
// 图例旁的口径说明：全部厂站明示「按厂站等权，不是集团结算均价」；周/月再说明「日均等权」。
const equalWeightNote = computed(() => {
  const weekly = aggregation.value !== 'day' ? '（日均等权）' : ''
  if (!isAllPlants.value) return aggregation.value === 'day' ? '' : `样站按日均等权${weekly}`
  return `日前/实时/中长期按厂站等权${weekly}，不是集团结算均价`
})

// KPI（当日跨节点聚合，单日快照）
const kpi = computed(() => {
  const items = dailyItems.value
  const maxs = items.map((i) => i.max).filter((v): v is number => v !== null && v !== undefined)
  const mins = items.map((i) => i.min).filter((v): v is number => v !== null && v !== undefined)
  const avgs = items.map((i) => i.avg).filter((v): v is number => v !== null && v !== undefined)
  const negs = items
    .map((i) => i.neg_share_pct)
    .filter((v): v is number => v !== null && v !== undefined)
  const max = maxs.length ? Math.max(...maxs) : null
  const min = mins.length ? Math.min(...mins) : null
  const avg = avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null
  // 负价节点占比%：取节点级 neg_share_pct 均值（每节点当日负价时段占比的跨节点均值）。
  const negShare = negs.length ? negs.reduce((s, v) => s + v, 0) / negs.length : null
  return { max, min, avg, negShare, nodeCount: items.length }
})

const dataCompleteness = computed(() => {
  const expectedDays = Math.max(1, rangeDates.value.length)
  const settleRatio = Math.min(1, aggregatedPoints.value.length / expectedDays)
  const trendRatio = Math.min(
    1,
    peakValleyTrend.value.filter((p) => p.spread !== null).length / expectedDays
  )
  return (settleRatio + trendRatio) / 2
})
const dataQualityNote = computed(() => {
  const parts: string[] = []
  if (settleIngestHint.value) parts.push('结算族空态')
  if (nodeIngestHint.value) parts.push('节点电价空态')
  return parts.length ? parts.join('；') : '云南真实或空（不回退他省）'
})

function daysBetween(range: DateRange): string[] {
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN
    return Date.UTC(year, month - 1, day)
  }
  const format = (ts: number) => {
    const d = new Date(ts)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const start = parse(range[0])
  const end = parse(range[1])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [] // 非法日期不猜默认范围（#2992）
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const out: string[] = []
  for (let ts = from; ts <= to; ts += 24 * 60 * 60 * 1000) out.push(format(ts))
  return out
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base])
}

const priceThresholds = computed(() => {
  // Q25/Q75 水位带只描述样站等权三条线的分布（综合结算均价是服务端口径，不参与）。
  const values = aggregatedPoints.value.flatMap((p) => [p.daPrice, p.rtPrice, p.sampleAvgPrice])
    .filter((v): v is number => v !== null && Number.isFinite(v))
  const q25 = quantile(values, 0.25)
  const q75 = quantile(values, 0.75)
  return {
    q25,
    q75,
    usable: q25 !== null && q75 !== null && Math.abs(q75 - q25) > 1e-9
  }
})

const negativePriceRanges = computed<PriceBandRange[]>(() => {
  const pts = aggregatedPoints.value
  const ranges: PriceBandRange[] = []
  let start = -1
  for (let index = 0; index < pts.length; index += 1) {
    const p = pts[index]
    const negative = [p.daPrice, p.rtPrice, p.sampleAvgPrice].some((v) => v !== null && v < 0)
    if (negative && start < 0) start = index
    if ((!negative || index === pts.length - 1) && start >= 0) {
      ranges.push({ start, end: negative && index === pts.length - 1 ? index : index - 1 })
      start = -1
    }
  }
  return ranges
})

function priceMarkArea() {
  const pts = aggregatedPoints.value
  if (!pts.length) return undefined
  const data: unknown[] = []
  const thresholds = priceThresholds.value
  if (thresholds.usable) {
    data.push([
      {
        yAxis: thresholds.q25,
        itemStyle: { color: 'rgba(100, 116, 139, 0.08)' },
        label: {
          show: true,
          formatter: 'Q25-Q75',
          color: 'rgba(71, 85, 105, 0.82)',
          fontSize: 10,
          position: 'insideTop'
        }
      },
      { yAxis: thresholds.q75 }
    ])
  }
  for (const range of negativePriceRanges.value) {
    const start = pts[range.start]?.date
    const end = pts[Math.min(range.end + 1, pts.length - 1)]?.date ?? pts[range.end]?.date
    if (!start || !end) continue
    data.push([
      {
        xAxis: start,
        itemStyle: { color: 'rgba(220, 38, 38, 0.08)' },
        label: {
          show: true,
          formatter: '负电价',
          color: 'rgba(185, 28, 28, 0.88)',
          fontSize: 10,
          position: 'insideTop'
        }
      },
      { xAxis: end }
    ])
  }
  return data.length ? { silent: true, data } : undefined
}

function priceThresholdMarkLine() {
  const thresholds = priceThresholds.value
  if (!thresholds.usable) return undefined
  return {
    silent: true,
    symbol: 'none',
    label: { color: '#64748b', fontSize: 10, formatter: ({ name }: { name: string }) => name },
    lineStyle: { color: 'rgba(100, 116, 139, 0.55)', type: 'dashed', width: 1 },
    data: [
      { name: 'Q25', yAxis: thresholds.q25 },
      { name: 'Q75', yAxis: thresholds.q75 }
    ]
  }
}

function priceExtremaMarkPoint(field: Exclude<PriceField, 'ltmPrice'>, color: string) {
  const values = aggregatedPoints.value
    .map((p, index) => ({ index, date: p.date, value: p[field] }))
    .filter((p): p is { index: number; date: string; value: number } => p.value !== null && Number.isFinite(p.value))
  if (!values.length) return undefined
  const max = values.reduce((best, item) => (item.value > best.value ? item : best), values[0])
  const min = values.reduce((best, item) => (item.value < best.value ? item : best), values[0])
  const data = [
    {
      name: '异常高',
      coord: [max.date, max.value],
      value: +max.value.toFixed(2),
      itemStyle: { color },
      label: { formatter: '高' }
    }
  ]
  if (min.index !== max.index) {
    data.push({
      name: '异常低',
      coord: [min.date, min.value],
      value: +min.value.toFixed(2),
      itemStyle: { color: '#2563eb' },
      label: { formatter: '低' }
    })
  }
  return {
    symbol: 'pin',
    symbolSize: 42,
    label: { color: '#fff', fontSize: 10, fontWeight: 700 },
    data
  }
}

// 综合结算均价（服务端量费加权）的极值标注：值序列按 x 轴标签从 weightedByLabel 对齐。
function weightedExtremaMarkPoint(color: string) {
  const values = aggregatedPoints.value
    .map((p) => ({ date: p.date, value: weightedByLabel.value.get(p.date) ?? null }))
    .filter((p): p is { date: string; value: number } => p.value !== null && Number.isFinite(p.value))
  if (!values.length) return undefined
  const max = values.reduce((best, item) => (item.value > best.value ? item : best), values[0])
  const min = values.reduce((best, item) => (item.value < best.value ? item : best), values[0])
  const data = [
    {
      name: '异常高',
      coord: [max.date, max.value],
      value: +max.value.toFixed(2),
      itemStyle: { color },
      label: { formatter: '高' }
    }
  ]
  if (min.date !== max.date || min.value !== max.value) {
    data.push({
      name: '异常低',
      coord: [min.date, min.value],
      value: +min.value.toFixed(2),
      itemStyle: { color: '#2563eb' },
      label: { formatter: '低' }
    })
  }
  return {
    symbol: 'pin',
    symbolSize: 42,
    label: { color: '#fff', fontSize: 10, fontWeight: 700 },
    data
  }
}

// 三价对比曲线（样站等权三价 + 服务端量费加权综合均价 + 中长期虚线）
function buildPriceOption() {
  const cc = chartChrome()
  const pts = aggregatedPoints.value
  const x = pts.map((p) => p.date)
  const empty = !pts.length
  const markArea = priceMarkArea()
  const markLine = priceThresholdMarkLine()
  const names = seriesNames.value
  // 出清实线（连续量直线）：smooth:false、不连线缺测（null）。
  const line = (field: PriceField, color: string) => ({
    type: 'line',
    smooth: false,
    showSymbol: pts.length <= 1,
    sampling: 'lttb',
    connectNulls: false,
    lineStyle: { width: 1.8, color },
    itemStyle: { color },
    data: pts.map((p) => (p[field] as number | null) ?? null)
  })
  // 综合结算均价：数据只来自服务端结算统计（weightedByLabel），无等权回退；
  // x 轴上没有对应桶/日的位置即缺测 → null 断开。
  const weightedLine = {
    type: 'line',
    smooth: false,
    showSymbol: pts.length <= 1,
    sampling: 'lttb',
    connectNulls: false,
    lineStyle: { width: 2, color: '#2563eb' },
    itemStyle: { color: '#2563eb' },
    data: pts.map((p) => weightedByLabel.value.get(p.date) ?? null)
  }
  return {
    tooltip: { ...axisTooltip({ unit: '元/MWh', digits: 2 }), confine: true },
    toolbox: chartToolbox('结算三价对比'),
    legend: { top: 4, right: 80, itemWidth: 16, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 24, top: 40, bottom: 48, containLabel: false },
    dataZoom: sliderZoom(0),
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        ...line('daPrice', '#0f766e'),
        name: names.da,
        markArea,
        markLine,
        markPoint: priceExtremaMarkPoint('daPrice', '#0f766e')
      },
      {
        ...line('rtPrice', '#ED7D31'),
        name: names.rt,
        markPoint: priceExtremaMarkPoint('rtPrice', '#ED7D31')
      },
      {
        ...weightedLine,
        name: names.avg,
        markPoint: weightedExtremaMarkPoint('#2563eb')
      },
      // 中长期电价为合约参照（非出清主序列）→ 虚线。
      {
        ...line('ltmPrice', '#9333ea'),
        name: names.ltm,
        lineStyle: { width: 1.4, color: '#9333ea', type: 'dashed' }
      }
    ],
    ...emptyOverlay(empty, '该筛选条件下暂无 formal 结算数据')
  }
}

// 峰谷价差水位（当日 Top N 节点 min~max 范围 + 均价标点）
// stack 水位柱：底层透明垫片=min，上层有色 range=max-min；scatter 叠加 avg。
const TOP_NODES = 20
const peakValleyRows = computed(() => {
  const items = dailyItems.value
    .filter(
      (i) =>
        i.avg !== null && i.max !== null && i.min !== null && Number.isFinite(Number(i.avg))
    )
    .map((i) => ({
      name: i.node_name,
      avg: Number(i.avg),
      max: Number(i.max),
      min: Number(i.min),
      spread: Number(i.max) - Number(i.min)
    }))
    .sort((a, b) => b.spread - a.spread) // 按峰谷价差降序，突出波动大的节点
    .slice(0, TOP_NODES)
  return items
})

function peakValleyExtremaMarkPoint() {
  const rows = peakValleyRows.value
  if (!rows.length) return undefined
  const maxRow = rows.reduce((best, item) => (item.max > best.max ? item : best), rows[0])
  const minRow = rows.reduce((best, item) => (item.min < best.min ? item : best), rows[0])
  const data = [
    {
      name: '最高',
      coord: [maxRow.name, maxRow.max],
      value: +maxRow.max.toFixed(2),
      itemStyle: { color: '#dc2626' },
      label: { formatter: '高' }
    }
  ]
  if (minRow.name !== maxRow.name || minRow.min !== maxRow.max) {
    data.push({
      name: '最低',
      coord: [minRow.name, minRow.min],
      value: +minRow.min.toFixed(2),
      itemStyle: { color: '#2563eb' },
      label: { formatter: '低' }
    })
  }
  return {
    symbol: 'pin',
    symbolSize: 42,
    label: { color: '#fff', fontSize: 10, fontWeight: 700 },
    data
  }
}

function buildPeakValleyOption() {
  const cc = chartChrome()
  const rows = peakValleyRows.value
  const names = rows.map((r) => r.name)
  const empty = !rows.length
  return {
    tooltip: {
      ...axisTooltip({ unit: '元/MWh', digits: 2 }),
      confine: true,
      trigger: 'item',
      formatter: (p: { name?: string; dataIndex?: number; seriesName?: string }) => {
        const idx = p.dataIndex ?? 0
        const r = rows[idx]
        if (!r) return ''
        return `${r.name}<br/>峰谷价差：<b>${fmtNum(r.spread, 2)}</b> 元/MWh<br/>最高 ${fmtNum(r.max, 2)} · 最低 ${fmtNum(r.min, 2)} · 均价 ${fmtNum(r.avg, 2)}`
      }
    },
    toolbox: chartToolbox('峰谷价差水位'),
    legend: { top: 4, right: 80, data: ['峰谷价差范围', '均价'], textStyle: { fontSize: 11 } },
    grid: { left: 8, right: 24, top: 40, bottom: 56, containLabel: true },
    xAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 9,
        interval: 0,
        rotate: 38,
        width: 90,
        overflow: 'truncate'
      },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      // 底层透明垫片 = min（水位起点）。
      {
        name: '底',
        type: 'bar',
        stack: 'water',
        barWidth: '56%',
        silent: true,
        itemStyle: { borderColor: 'transparent', color: 'transparent' },
        emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
        data: rows.map((r) => r.min)
      },
      // 上层有色范围 = max - min（峰谷价差水位带）。
      {
        name: '峰谷价差范围',
        type: 'bar',
        stack: 'water',
        barWidth: '56%',
        itemStyle: { color: 'rgba(37, 99, 235, 0.55)', borderColor: '#2563eb', borderWidth: 0.6 },
        data: rows.map((r) => r.spread),
        markPoint: peakValleyExtremaMarkPoint()
      },
      // 均价标点（散点 overlay）。
      {
        name: '均价',
        type: 'scatter',
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: '#dc2626' },
        data: rows.map((r) => r.avg)
      }
    ],
    ...emptyOverlay(empty, '当日暂无节点电价（峰谷水位需节点级 max/min）')
  }
}

function peakValleyTrendMarkPoint() {
  const rows = peakValleyTrend.value.filter((p): p is PeakValleyTrendPoint & { spread: number } => (
    p.spread !== null && Number.isFinite(p.spread)
  ))
  if (!rows.length) return undefined
  const max = rows.reduce((best, item) => (item.spread > best.spread ? item : best), rows[0])
  const min = rows.reduce((best, item) => (item.spread < best.spread ? item : best), rows[0])
  const data = [
    {
      name: '最高价差',
      coord: [max.date, max.spread],
      value: +max.spread.toFixed(2),
      itemStyle: { color: '#dc2626' },
      label: { formatter: '高' }
    }
  ]
  if (min.date !== max.date || min.spread !== max.spread) {
    data.push({
      name: '最低价差',
      coord: [min.date, min.spread],
      value: +min.spread.toFixed(2),
      itemStyle: { color: '#2563eb' },
      label: { formatter: '低' }
    })
  }
  return {
    symbol: 'pin',
    symbolSize: 42,
    label: { color: '#fff', fontSize: 10, fontWeight: 700 },
    data
  }
}

function buildPeakValleyTrendOption() {
  const cc = chartChrome()
  const rows = peakValleyTrend.value
  const empty = !hasPeakValleyTrend.value
  return {
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'cross', crossStyle: { opacity: 0.4 }, label: { precision: 2 } },
      formatter: (params: Array<{ dataIndex?: number; marker?: string; seriesName?: string; value?: unknown }> | { dataIndex?: number; marker?: string; seriesName?: string; value?: unknown }) => {
        const first = Array.isArray(params) ? params[0] : params
        const row = rows[first?.dataIndex ?? 0]
        if (!row) return ''
        return `<div style="font-weight:600;margin-bottom:2px">${row.date}</div>` +
          `<div style="line-height:1.7">${first?.marker ?? ''}${first?.seriesName ?? '峰谷价差'}：<b>${fmtNum(row.spread, 2)} 元/MWh</b></div>` +
          `<div style="line-height:1.7">最高 ${fmtNum(row.max, 2)} · 最低 ${fmtNum(row.min, 2)} · 均价 ${fmtNum(row.avg, 2)}</div>` +
          `<div style="line-height:1.7">负价占比 ${fmtNum(row.negShare, 1)}% · 节点 ${row.nodeCount}</div>`
      }
    },
    toolbox: chartToolbox('峰谷价差日期趋势'),
    legend: { top: 4, right: 80, data: ['峰谷价差'], textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 24, top: 40, bottom: 48, containLabel: false },
    dataZoom: sliderZoom(0),
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.date),
      boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '峰谷价差',
        type: 'line',
        smooth: false,
        showSymbol: rows.length <= 45,
        connectNulls: false,
        sampling: 'lttb',
        lineStyle: { width: 2, color: '#0f766e' },
        itemStyle: { color: '#0f766e' },
        areaStyle: { color: 'rgba(15, 118, 110, 0.08)' },
        data: rows.map((r) => r.spread),
        markPoint: peakValleyTrendMarkPoint()
      }
    ],
    ...emptyOverlay(empty, '该日期范围暂无峰谷价差趋势数据')
  }
}

// 明细表（按聚合粒度的样站等权三价 + 服务端量费加权综合均价 + 电厂数）
const settleLabels = computed<Record<string, string>>(() => ({
  date: '日期',
  daPrice: `${seriesNames.value.da}(元/MWh)`,
  rtPrice: `${seriesNames.value.rt}(元/MWh)`,
  avgPrice: '综合结算均价(元/MWh·量费加权)',
  ltmPrice: `${seriesNames.value.ltm}(元/MWh)`,
  plantCount: '厂站数'
}))
const settleRows = computed(() =>
  aggregatedPoints.value.map((p) => {
    const weighted = weightedByLabel.value.get(p.date)
    return {
      date: p.date,
      daPrice: p.daPrice === null ? '—' : fmtNum(p.daPrice, 2),
      rtPrice: p.rtPrice === null ? '—' : fmtNum(p.rtPrice, 2),
      // 只认服务端量费加权值：无对应桶/日（undefined）或无成对记录（null）都如实「—」。
      avgPrice: weighted === null || weighted === undefined ? '—' : fmtNum(weighted, 2),
      ltmPrice: p.ltmPrice === null ? '—' : fmtNum(p.ltmPrice, 2),
      plantCount: p.plantCount
    }
  })
)

// 加载
function isEmptyResultError(message: string): boolean {
  return /未摄取|parquet|no data|暂无数据|not found|空/i.test(message)
}

function summarizeDaily(date: string, items: DailySummaryItem[]): PeakValleyTrendPoint {
  const maxs = items.map((i) => i.max).filter((v): v is number => v !== null && v !== undefined)
  const mins = items.map((i) => i.min).filter((v): v is number => v !== null && v !== undefined)
  const avgs = items.map((i) => i.avg).filter((v): v is number => v !== null && v !== undefined)
  const negs = items.map((i) => i.neg_share_pct).filter((v): v is number => v !== null && v !== undefined)
  const max = maxs.length ? Math.max(...maxs) : null
  const min = mins.length ? Math.min(...mins) : null
  return {
    date,
    max,
    min,
    avg: avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null,
    spread: max === null || min === null ? null : max - min,
    negShare: negs.length ? negs.reduce((s, v) => s + v, 0) / negs.length : null,
    nodeCount: items.length
  }
}

async function fetchDailyItems(date: string, mkt: SpotMarket): Promise<DailySummaryItem[]> {
  try {
    const data = await fetchDailySummary(date, mkt, 200, '云南')
    return data.items ?? []
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败'
    if (isEmptyResultError(message)) return []
    throw error
  }
}

async function loadSettle() {
  const seq = ++settleSeq.value
  settleLoading.value = true
  settleErrorMsg.value = ''
  try {
    const r = await loadSettlementPrices({
      dateRange: dateRange.value,
      plant: isAllPlants.value ? undefined : selectedPlant.value
    })
    if (seq !== settleSeq.value) return // 新轮已发起，丢弃旧响应（#405 同族，#545）
    settlePoints.value = r.points
    settlePlantOptions.value = r.plantOptions
    const ensured = plantFilter.ensureSelections()
    if (ensured.plantChanged) {
      spotSelection.setPlant(selectedPlant.value)
      // 厂站被自动纠正（所选厂不在 capture 族中）→ 综合结算均价随新厂名重取（#2992）。
      void loadWeightedAvg()
      return await loadSettle()
    }
    settleIngestHint.value = !r.hasData
  } catch (e) {
    if (seq !== settleSeq.value) return // 旧轮的错误不覆盖新轮（#405）
    settlePoints.value = []
    const msg = e instanceof Error ? e.message : '加载失败'
    if (isEmptyResultError(msg)) {
      settleIngestHint.value = true
    } else {
      settleErrorMsg.value = msg
    }
  } finally {
    if (seq === settleSeq.value) settleLoading.value = false // 只有最新轮才关 loading（#405）
  }
}

// 综合结算均价（服务端量费加权，#2992）：AbortController 取消上一次 + 代次守卫，
// 切日期/厂站/聚合/公司时旧响应丢弃。失败显示中文原因（describeWeightedFailure），
// 绝不回退到前端等权平均。
async function loadWeightedAvg() {
  const seq = ++weightedSeq.value
  weightedController?.abort()
  weightedController = new AbortController()
  weightedLoading.value = true
  weightedErrorMsg.value = ''
  try {
    const analysis = await fetchWeightedSettlementAvg({
      company: selectedCompanyId.value,
      plants: isAllPlants.value ? [] : [selectedPlant.value],
      dateRange: dateRange.value,
      aggregation: aggregation.value,
      signal: weightedController.signal
    })
    if (seq !== weightedSeq.value) return // 新轮已发起，丢弃旧响应
    weightedAnalysis.value = analysis
  } catch (e) {
    if (seq !== weightedSeq.value) return // 旧轮的错误不覆盖新轮
    if (e instanceof DOMException && e.name === 'AbortError') return // 主动取消不算失败
    weightedAnalysis.value = null
    weightedErrorMsg.value = describeWeightedFailure(e)
  } finally {
    if (seq === weightedSeq.value) weightedLoading.value = false
  }
}

// 已入库结算覆盖区间（/api/real-coverage，yn_spot_settlement/yn_settlement_daily）：
// 供「查看历史资料」入口；取不到（无权/未登记/接口失败）保持 null，只说暂无资料。
async function loadCoverage() {
  settlementCoverage.value = await fetchSettlementCoverage('yunnan')
}

/** 「查看历史资料」点击：把范围设为覆盖区间并重拉（用户主动选择历史后才显示历史提示之外的数据）。 */
function applyCoverageRange() {
  const next = coverageJump.value
  if (!next) return
  dateRange.value = [...next]
  nodeDate.value = next[1]
  setSharedSelection({ dateRange: [...next], date: next[1] })
  void reloadAll()
}

const DAILY_REQUEST_CONCURRENCY = 4

async function loadDaily() {
  const seq = ++dailySeq.value
  const mkt = market.value // 快照，防 worker 读响应式 .value 在切 market 后混数据（#545）
  dailyLoading.value = true
  dailyErrorMsg.value = ''
  try {
    const dates = Array.from(new Set([nodeDate.value, ...rangeDates.value].filter(Boolean)))
    // 并发上限拉逐日聚合，避免整月范围 ~31 请求同时打后端（与联动面板 F6 一致，见 #473）
    const pairs = await mapWithConcurrency(dates, DAILY_REQUEST_CONCURRENCY, async (date) => [date, await fetchDailyItems(date, mkt)] as const)
    if (seq !== dailySeq.value) return // 新轮已发起，丢弃旧响应（#405 同族，#545）
    const byDate = new Map(pairs)
    dailyItems.value = byDate.get(nodeDate.value) ?? []
    peakValleyTrend.value = rangeDates.value.map((date) => summarizeDaily(date, byDate.get(date) ?? []))
    nodeIngestHint.value = dailyItems.value.length === 0 && !hasPeakValleyTrend.value
  } catch (e) {
    if (seq !== dailySeq.value) return // 旧轮的错误不覆盖新轮（#405）
    dailyItems.value = []
    peakValleyTrend.value = []
    const msg = e instanceof Error ? e.message : '加载失败'
    if (isEmptyResultError(msg)) {
      nodeIngestHint.value = true
    } else {
      dailyErrorMsg.value = msg
    }
  } finally {
    if (seq === dailySeq.value) dailyLoading.value = false // 只有最新轮才关 loading（#405）
  }
}

async function reloadAll() {
  settleErrorMsg.value = ''
  dailyErrorMsg.value = ''
  weightedErrorMsg.value = ''
  settleIngestHint.value = false
  nodeIngestHint.value = false
  await Promise.all([loadSettle(), loadDaily(), loadWeightedAvg()])
}

function setSharedSelection(patch: Parameters<typeof spotSelection.setSelection>[0]) {
  spotSelection.setSelection(patch)
}

function onDateRangeChange(next?: DateRange) {
  if (next) dateRange.value = next
  nodeDate.value = dateRange.value[1] || dateRange.value[0] || nodeDate.value
  setSharedSelection({ dateRange: dateRange.value, date: nodeDate.value })
  void Promise.all([loadSettle(), loadDaily(), loadWeightedAvg()])
}
function onPlantChange(next?: string) {
  if (next) selectedPlant.value = next
  setSharedSelection({ plant: selectedPlant.value })
  void Promise.all([loadSettle(), loadWeightedAvg()])
}
function onAggregationChange() {
  // 样站等权三条线仅前端重聚合；综合结算均价的粒度由服务端 buckets 决定 → 重拉。
  void loadWeightedAvg()
}
function onNodeDateChange(next?: string) {
  if (next) nodeDate.value = next
  setSharedSelection({ date: nodeDate.value })
  void loadDaily()
}
function onMarketChange() {
  setSharedSelection({ market: market.value })
  void loadDaily()
}

function applyExternalRange(next: DateRange): boolean {
  if (dateRange.value[0] === next[0] && dateRange.value[1] === next[1]) return false
  dateRange.value = [next[0], next[1]]
  return true
}

onSelectionChange(
  ({ selection }) => {
    const settleChanged = applyExternalRange(normalizeRange(selection.dateRange))
      || selectedPlant.value !== selection.plant
    const dailyChanged = nodeDate.value !== selection.date || market.value !== selection.market
    selectedPlant.value = selection.plant || ALL_PLANTS
    selectedNode.value = selection.node
    nodeDate.value = selection.date || nodeDate.value
    market.value = selection.market
    if (settleChanged) {
      void loadSettle()
      void loadWeightedAvg()
    }
    if (settleChanged || dailyChanged) void loadDaily()
  },
  { fields: ['date', 'dateRange', 'plant', 'node', 'market'] }
)

// 公司上下文变化（管理员/集团切公司）→ 综合结算均价随公司重取（结算统计按公司授权）。
watch(selectedCompanyId, () => {
  void loadWeightedAvg()
})

onMounted(async () => {
  void loadCoverage()
  await reloadAll()
})

// 切地区：云南严格隔离，View 层 RegionScopedNotice 已挡非云南；此处监听仍兜底重拉。
onRegionChange(() => {
  void reloadAll()
})
</script>

<template>
  <div class="settle-panel">
    <RegionDataBanner :families="SETTLEMENT_PRIVATE_FAMILIES" />

    <!-- hero 一行化（slim-and-fix-market-insight-pages R5）：公式/端点/口径全文经 ⓘ 渐进披露 -->
    <section class="sp-hero">
      <div class="sp-hero-main">
        <div class="sp-kicker"><Coins :size="16" /><span>云南 · 现货结算价分析</span></div>
        <InfoHint :text="HERO_INFO" label="口径" />
        <el-tag size="small" type="info" effect="plain">真实或空 · 不回退他省</el-tag>
      </div>
    </section>

    <div class="sp-quality">
      <DataQualityBadge
        basis="captured"
        cadence="monthly"
        :completeness="dataCompleteness"
        source="yn_spot_settlement + node-price/daily"
        :note="dataQualityNote"
      />
    </div>

    <SpotFilterBar
      date-mode="range"
      date-label="结算价日期范围"
      :date-range="dateRange"
      plant-label="厂站"
      all-plants-label="全部厂站"
      :plant="selectedPlant"
      :plant-options="plantOptions"
      :loading="settleLoading || dailyLoading"
      show-refresh
      @update:date-range="onDateRangeChange"
      @update:plant="onPlantChange"
      @refresh="reloadAll"
    >
      <template #after-plant>
        <label class="sp-field">
          <span>聚合粒度</span>
          <el-radio-group v-model="aggregation" @change="onAggregationChange">
            <el-radio-button v-for="a in aggOptions" :key="a.value" :value="a.value">{{ a.label }}</el-radio-button>
          </el-radio-group>
        </label>
      </template>
      <label class="sp-field">
        <span>峰谷水位日期</span>
        <el-date-picker
          v-model="nodeDate"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          placeholder="选择日期"
          @change="onNodeDateChange"
        />
      </label>
      <label class="sp-field">
        <span>市场</span>
        <el-radio-group v-model="market" @change="onMarketChange">
          <el-radio-button v-for="m in marketOptions" :key="m.value" :value="m.value">{{ m.label }}</el-radio-button>
        </el-radio-group>
      </label>
    </SpotFilterBar>

    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="sp-alert" show-icon />
    <!-- #2992：服务端结算统计失败/无权时明示原因，不回退等权 -->
    <el-alert
      v-if="weightedErrorMsg && !errorMsg"
      type="warning"
      :closable="false"
      class="sp-alert"
      show-icon
      :title="weightedErrorMsg"
      description="综合结算均价只认服务端结算统计（量费加权），失败时不提供替代算法。可稍后重试或联系管理员确认公司/地区权限。"
    />
    <!-- #2992：用户主动选择历史范围后，明示这是历史资料（完整日期） -->
    <el-alert
      v-if="historyNotice && !errorMsg"
      type="info"
      :closable="false"
      class="sp-alert"
      show-icon
      :title="historyNotice"
    />
    <!-- 摄取指引降层（R5，同 spot-degradation-honesty 呈现层级）：事实一行可见，完整命令展开可达 -->
    <DataStatusLine
      v-if="!errorMsg && !weightedErrorMsg && settleIngestHint"
      class="sp-statusline"
      summary="后端暂无云南结算数据"
      :items="[{ tone: 'caveat', text: '请先在主仓库运行现货结算导出 ETL（scripts/private-cache-adapters/yn-fact-pnl.mjs + import-spot-export）落 capture-raw/yunnan/，或更换为已摄取的日期范围。' }]"
    />
    <DataStatusLine
      v-if="nodeIngestHint && !errorMsg"
      class="sp-statusline"
      summary="后端暂无该日节点电价数据（峰谷水位/KPI 不可用）"
      :items="[{ tone: 'caveat', text: '请先在主仓库摄取节点电价 Parquet（现货权威后端 /api/v1/spot 数据源），或更换为已摄取的日期/市场。' }]"
    />

    <!-- KPI 行（当日跨节点聚合）-->
    <DataState
      :loading="dailyLoading"
      :empty="!!dailyErrorMsg"
      empty-text="节点电价加载失败，原因见顶部错误提示"
    >
      <template #skeleton>
        <SpotSkeleton variant="rows" :rows="4" />
      </template>
      <section class="sp-kpi-row">
        <div class="sp-kpi">
          <div class="sp-kpi-label"><Activity :size="13" /> 最高价</div>
          <div class="sp-kpi-value">{{ kpi.max === null ? '—' : fmtNum(kpi.max, 2) }}</div>
          <div class="sp-kpi-unit">元/MWh · {{ market === 'da' ? '日前' : '实时' }}</div>
        </div>
        <div class="sp-kpi">
          <div class="sp-kpi-label"><Activity :size="13" /> 最低价</div>
          <div class="sp-kpi-value">{{ kpi.min === null ? '—' : fmtNum(kpi.min, 2) }}</div>
          <div class="sp-kpi-unit">元/MWh</div>
        </div>
        <div class="sp-kpi">
          <div class="sp-kpi-label"><BarChart3 :size="13" /> 均价</div>
          <div class="sp-kpi-value">{{ kpi.avg === null ? '—' : fmtNum(kpi.avg, 2) }}</div>
          <div class="sp-kpi-unit">元/MWh · 跨 {{ kpi.nodeCount }} 节点</div>
        </div>
        <div class="sp-kpi">
          <div class="sp-kpi-label"><Waves :size="13" /> 负价占比</div>
          <div class="sp-kpi-value">{{ kpi.negShare === null ? '—' : fmtNum(kpi.negShare, 1) }}</div>
          <div class="sp-kpi-unit">% · 节点级均值</div>
        </div>
      </section>
    </DataState>

    <section class="sp-charts">
      <DataState :loading="settleLoading">
        <template #skeleton>
          <SpotSkeleton variant="chart" :height="340" />
        </template>
        <!-- #2992：诚实空态 + 「查看历史资料」入口（仅当拿到真实覆盖区间才出现）；
             加载失败时文案切换为「加载失败」，不把失败伪装成「暂无资料」，覆盖入口一并隐藏 -->
        <div v-if="showSettleEmpty" class="sp-settle-empty">
          <p v-if="settleErrorMsg">结算数据加载失败，原因见顶部错误提示。</p>
          <p v-else>所选日期（{{ dateRange[0] }} 至 {{ dateRange[1] }}）暂无已入库结算资料。</p>
          <template v-if="!settleErrorMsg && coverageJump">
            <p class="sp-settle-empty-cov">
              已入库结算资料覆盖：{{ settlementCoverage?.start }} 至 {{ settlementCoverage?.end }}
            </p>
            <el-button type="primary" plain size="small" @click="applyCoverageRange">
              <History :size="14" style="margin-right: 4px" />
              查看历史资料（{{ coverageJump[0] }}—{{ coverageJump[1] }}）
            </el-button>
          </template>
        </div>
        <ChartCard
          v-else
          title="结算三价对比（样站等权 + 综合结算均价）"
          :height="340"
          :build-option="buildPriceOption"
          fullscreen
          png-export
          png-name="yn-settlement-price"
        >
          <template #actions>
            <span class="sp-chart-sub">
              {{ plantLabel }} · {{ aggregation === 'day' ? '按日' : aggregation === 'week' ? '按周' : '按月' }}
              <template v-if="equalWeightNote"> · {{ equalWeightNote }}</template>
            </span>
          </template>
        </ChartCard>
      </DataState>

      <DataState
        :loading="dailyLoading"
        :empty="!hasDailySnapshot || !!dailyErrorMsg"
        :empty-text="dailyErrorMsg ? '节点电价数据不可用' : '当日暂无节点电价（峰谷水位需节点级 max/min）'"
      >
        <template #skeleton>
          <SpotSkeleton variant="chart" :height="420" />
        </template>
        <ChartCard
          title="峰谷价差水位（当日 Top 20 节点 · min~max 范围 + 均价）"
          :height="420"
          :build-option="buildPeakValleyOption"
          fullscreen
          png-export
          png-name="yn-peak-valley-waterline"
        >
          <template #actions>
            <span class="sp-chart-sub">{{ nodeDate }} · {{ market === 'da' ? '日前' : '实时' }}</span>
          </template>
        </ChartCard>
      </DataState>

      <DataState
        :loading="dailyLoading"
        :empty="!hasPeakValleyTrend || !!dailyErrorMsg"
        :empty-text="dailyErrorMsg ? '节点电价数据不可用' : '该日期范围暂无峰谷价差趋势数据'"
      >
        <template #skeleton>
          <SpotSkeleton variant="chart" :height="300" />
        </template>
        <ChartCard
          title="峰谷价差随日期变化"
          :height="300"
          :build-option="buildPeakValleyTrendOption"
          fullscreen
          png-export
          png-name="yn-peak-valley-trend"
        >
          <template #actions>
            <span class="sp-chart-sub">{{ dateRange[0] }} ~ {{ dateRange[1] }} · {{ market === 'da' ? '日前' : '实时' }}</span>
          </template>
        </ChartCard>
      </DataState>
    </section>

    <section class="sp-table-card">
      <div class="sp-table-head">
        <h3><TableProperties :size="16" /> 结算价明细（按聚合粒度）</h3>
        <span class="sp-table-sub">
          {{ plantLabel }} · {{ dateRange[0] }} ~ {{ dateRange[1] }} · 共 {{ settleRows.length }} 行
        </span>
      </div>
      <DataState
        :loading="settleLoading"
        :empty="!settleRows.length"
        :empty-text="settleErrorMsg ? '结算数据加载失败，原因见顶部错误提示' : '当前筛选下暂无结算三价明细'"
      >
        <template #skeleton>
          <SpotSkeleton variant="table" :rows="8" :columns="6" />
        </template>
        <DynamicTable :rows="settleRows" :labels="settleLabels" :page-size="20" export-name="yn-settlement-price" />
      </DataState>
    </section>
  </div>
</template>

<style scoped>
.settle-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sp-hero {
  padding: 10px 14px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #eef7f3 55%, #f7fbff 100%);
}

.sp-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: var(--font-md);
  font-weight: 650;
}

.sp-hero-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.sp-statusline {
  margin-bottom: 10px;
}

.sp-quality {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sp-field > span {
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.sp-field :deep(.el-select),
.sp-field :deep(.el-date-editor) {
  width: 180px;
}

.sp-alert {
  margin: 0;
}

.sp-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.sp-kpi {
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.sp-kpi-value {
  margin-top: 6px;
  color: #172b3a;
  font-size: var(--font-24);
  font-weight: 700;
  line-height: 1.2;
}

.sp-kpi-unit {
  margin-top: 4px;
  color: #909399;
  font-size: var(--font-xs);
}

.sp-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

/* #2992：所选范围无已入库结算资料的诚实空态 + 查看历史资料入口 */
.sp-settle-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 16px;
  border: 1px dashed #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-settle-empty p {
  margin: 0;
  color: #687987;
  font-size: var(--font-md);
}

.sp-settle-empty-cov {
  color: #909399;
  font-size: var(--font-sm);
}

.sp-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-xs);
  color: var(--muted, #909399);
}

.sp-table-card {
  padding: 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-table-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sp-table-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #172b3a;
  font-size: var(--font-15);
}

.sp-table-sub {
  color: #687987;
  font-size: var(--font-sm);
}

@media (max-width: 900px) {
  .sp-kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .sp-field,
  .sp-field :deep(.el-select),
  .sp-field :deep(.el-date-editor) {
    width: 100%;
  }
}
</style>
