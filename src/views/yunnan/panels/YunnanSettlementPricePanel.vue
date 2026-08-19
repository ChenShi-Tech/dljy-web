<script setup lang="ts">
// 云南结算价分析面板（xhjy/yunnan/settlement-price）：日前-实时-结算三价对比 + 峰谷价差水位。
// 属父 Epic #376（现货接入），任务 #381。
//
// 两路真实数据源（非 Mock）：
//   ① 结算三价：loadSettlementPrices() ← fetchCaptured('yn_spot_settlement','yn_settlement_daily')
//      yn-fact-pnl.mjs 已 filter result_type==='formal'（temp 不进 family），字段 daPrice/rtPrice/
//      avgPrice(结算均价)/ltmPrice(中长期参照)。按日跨电厂等权均值，可再聚合周/月。
//   ② 峰谷价差水位 + 最高/最低/均价/负价占比：fetchDailySummary()（spotClient /v1/spot/node-price/daily）
//      全节点日聚合（avg/max/min/neg_share_pct），单日水位 + 日期范围趋势；水位带=Top N 节点 min~max 范围。
//
// 呈现纪律（用户强制）：三价用出清实线（smooth:false·连续量直线），中长期价虚线（合约参照·非主序列）；
// 缺测用 null 不连线（connectNulls:false）。严格地区 yunnan「真实或空」：无数据走空态、不回退山西。
import { computed, onMounted, ref } from 'vue'
import { Coins, Activity, BarChart3, TableProperties, Waves } from 'lucide-vue-next'
import ChartCard from '../../../components/common/ChartCard.vue'
import DataQualityBadge from '../../../components/common/DataQualityBadge.vue'
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

type DateRange = [string, string]
type PriceField = 'daPrice' | 'rtPrice' | 'avgPrice' | 'ltmPrice'
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

// 控件状态
// 三价序列默认演示月 2026-05（与现有云南 panel 一致；yn_spot_settlement 当前覆盖该月）。
const DEFAULT_SETTLE_RANGE: DateRange = ['2026-05-01', '2026-05-31']
const DEFAULT_NODE_DATE = '2026-05-31'
const spotSelection = useSpotSelection()
const initialSelection = spotSelection.snapshot()

function normalizeRange(value: readonly [string, string] | DateRange | undefined): DateRange {
  if (!value?.[0] || !value?.[1]) return [...DEFAULT_SETTLE_RANGE]
  return [value[0], value[1]]
}

function initialRange(value: readonly [string, string] | DateRange | undefined): DateRange {
  const range = normalizeRange(value)
  return range[0] === range[1] ? [...DEFAULT_SETTLE_RANGE] : range
}

const dateRange = ref<DateRange>(initialRange(initialSelection.dateRange))
// 节点电价快照日（峰谷水位/KPI 用）：默认范围末尾，单独可改。
const nodeDate = ref(
  initialSelection.dateRange[0] === initialSelection.dateRange[1]
    ? dateRange.value[1]
    : initialSelection.date || dateRange.value[1] || DEFAULT_NODE_DATE
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

// 加载/错误态
const settleLoading = ref(false)
const dailyLoading = ref(false)
// 版本守卫：loadSettle/loadDaily 各自维护 seq，切日期/厂站/节点/market 旧响应丢弃（#405 同族，#545）
const settleSeq = ref(0)
const dailySeq = ref(0)
const settleErrorMsg = ref('')
const dailyErrorMsg = ref('')
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

// 当前筛选+聚合后的三价序列。
const aggregatedPoints = computed(() => aggregatePoints(settlePoints.value, aggregation.value))
const rangeDates = computed(() => daysBetween(dateRange.value))
const hasSettleData = computed(() => aggregatedPoints.value.length > 0)
const hasDailySnapshot = computed(() => peakValleyRows.value.length > 0)
const hasPeakValleyTrend = computed(() => peakValleyTrend.value.some((p) => p.spread !== null))
const errorMsg = computed(() => settleErrorMsg.value || dailyErrorMsg.value)

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
  return parts.length ? parts.join('；') : '云南严格地区真实或空'
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
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [...DEFAULT_SETTLE_RANGE]
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
  const values = aggregatedPoints.value.flatMap((p) => [p.daPrice, p.rtPrice, p.avgPrice])
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
    const negative = [p.daPrice, p.rtPrice, p.avgPrice].some((v) => v !== null && v < 0)
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

// 三价对比曲线（出清实线 + 中长期虚线）
function buildPriceOption() {
  const cc = chartChrome()
  const pts = aggregatedPoints.value
  const x = pts.map((p) => p.date)
  const empty = !pts.length
  const markArea = priceMarkArea()
  const markLine = priceThresholdMarkLine()
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
        name: '日前结算价',
        markArea,
        markLine,
        markPoint: priceExtremaMarkPoint('daPrice', '#0f766e')
      },
      {
        ...line('rtPrice', '#ED7D31'),
        name: '实时结算价',
        markPoint: priceExtremaMarkPoint('rtPrice', '#ED7D31')
      },
      {
        ...line('avgPrice', '#2563eb'),
        name: '综合结算价',
        markPoint: priceExtremaMarkPoint('avgPrice', '#2563eb')
      },
      // 中长期电价为合约参照（非出清主序列）→ 虚线。
      {
        ...line('ltmPrice', '#9333ea'),
        name: '中长期电价(参照)',
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

// 明细表（按聚合粒度的三价 + 电厂数）
const settleLabels: Record<string, string> = {
  date: '日期',
  daPrice: '日前结算价(元/MWh)',
  rtPrice: '实时结算价(元/MWh)',
  avgPrice: '综合结算价(元/MWh)',
  ltmPrice: '中长期电价(元/MWh)',
  plantCount: '厂站数'
}
const settleRows = computed(() =>
  aggregatedPoints.value.map((p) => ({
    date: p.date,
    daPrice: p.daPrice === null ? '—' : fmtNum(p.daPrice, 2),
    rtPrice: p.rtPrice === null ? '—' : fmtNum(p.rtPrice, 2),
    avgPrice: p.avgPrice === null ? '—' : fmtNum(p.avgPrice, 2),
    ltmPrice: p.ltmPrice === null ? '—' : fmtNum(p.ltmPrice, 2),
    plantCount: p.plantCount
  }))
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
  settleIngestHint.value = false
  nodeIngestHint.value = false
  await Promise.all([loadSettle(), loadDaily()])
}

function setSharedSelection(patch: Parameters<typeof spotSelection.setSelection>[0]) {
  spotSelection.setSelection(patch)
}

function onDateRangeChange(next?: DateRange) {
  if (next) dateRange.value = next
  nodeDate.value = dateRange.value[1] || dateRange.value[0] || nodeDate.value
  setSharedSelection({ dateRange: dateRange.value, date: nodeDate.value })
  void Promise.all([loadSettle(), loadDaily()])
}
function onPlantChange(next?: string) {
  if (next) selectedPlant.value = next
  setSharedSelection({ plant: selectedPlant.value })
  void loadSettle()
}
function onAggregationChange() {
  // 仅前端重聚合，无需重拉。
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
    if (settleChanged) void loadSettle()
    if (settleChanged || dailyChanged) void loadDaily()
  },
  { fields: ['date', 'dateRange', 'plant', 'node', 'market'] }
)

onMounted(async () => {
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

    <section class="sp-hero">
      <div class="sp-kicker"><Coins :size="16" /><span>云南 · 现货结算价分析</span></div>
      <p>
        日前-实时-结算三价对比 + 中长期电价参照（左路，yn_spot_settlement 真实结算，result_type=formal 权威行）；
        节点电价峰谷价差水位与最高/最低/均价/负价占比（右路，现货权威后端 /v1/spot/node-price/daily）。
        严格地区 yunnan「真实或空」，无数据走空态、不回退山西。
      </p>
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
    <el-alert
      v-else-if="settleIngestHint"
      type="warning"
      :closable="false"
      class="sp-alert"
      show-icon
      title="后端暂无 yn_spot_settlement 结算数据"
      description="请先在主仓库运行现货结算导出 ETL（scripts/private-cache-adapters/yn-fact-pnl.mjs + import-spot-export）落 capture-raw/yunnan/，或更换为已摄取的日期范围。"
    />
    <el-alert
      v-if="nodeIngestHint && !errorMsg"
      type="warning"
      :closable="false"
      class="sp-alert"
      show-icon
      title="后端暂无该日节点电价数据（峰谷水位/KPI 不可用）"
      description="请先在主仓库摄取节点电价 Parquet（现货权威后端 /api/v1/spot 数据源），或更换为已摄取的日期/市场。"
    />

    <!-- KPI 行（当日跨节点聚合）-->
    <DataState :loading="dailyLoading" :error="dailyErrorMsg">
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
      <DataState
        :loading="settleLoading"
        :error="settleErrorMsg"
        :empty="!hasSettleData"
        empty-text="该筛选条件下暂无 formal 结算数据"
      >
        <template #skeleton>
          <SpotSkeleton variant="chart" :height="340" />
        </template>
        <ChartCard
          title="结算三价对比曲线（日前 / 实时 / 综合 / 中长期参照）"
          :height="340"
          :build-option="buildPriceOption"
          fullscreen
          png-export
          png-name="yn-settlement-price"
        >
          <template #actions>
            <span class="sp-chart-sub">
              {{ plantLabel }} · {{ aggregation === 'day' ? '按日' : aggregation === 'week' ? '按周' : '按月' }}
            </span>
          </template>
        </ChartCard>
      </DataState>

      <DataState
        :loading="dailyLoading"
        :error="dailyErrorMsg"
        :empty="!hasDailySnapshot"
        empty-text="当日暂无节点电价（峰谷水位需节点级 max/min）"
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
        :error="dailyErrorMsg"
        :empty="!hasPeakValleyTrend"
        empty-text="该日期范围暂无峰谷价差趋势数据"
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
        <h3><TableProperties :size="16" /> 结算三价明细（按聚合粒度）</h3>
        <span class="sp-table-sub">
          {{ plantLabel }} · {{ dateRange[0] }} ~ {{ dateRange[1] }} · 共 {{ settleRows.length }} 行
        </span>
      </div>
      <DataState
        :loading="settleLoading"
        :error="settleErrorMsg"
        :empty="!settleRows.length"
        empty-text="当前筛选下暂无结算三价明细"
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
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #eef7f3 55%, #f7fbff 100%);
}

.sp-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: 13px;
  font-weight: 650;
}

.sp-hero p {
  margin: 8px 0 0;
  color: #5c6b76;
  line-height: 1.7;
  font-size: 13px;
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
  font-size: 12px;
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
  font-size: 12px;
  font-weight: 650;
}

.sp-kpi-value {
  margin-top: 6px;
  color: #172b3a;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}

.sp-kpi-unit {
  margin-top: 4px;
  color: #909399;
  font-size: 11px;
}

.sp-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.sp-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
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
  font-size: 15px;
}

.sp-table-sub {
  color: #687987;
  font-size: 12px;
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
