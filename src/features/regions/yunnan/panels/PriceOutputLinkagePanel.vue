<script setup lang="ts">
// 云南电价 × 自有机组物理出力联动面板（xhjy/yunnan/price-output-linkage）。
// 数据源：yn_plant_output 真实回放 + /api/v1/spot/node-price/series 现货权威后端。
// 图表纪律：价格出清实线；实际出力阶梯线；计划出力阶梯虚线；smooth=false，connectNulls=false。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ECharts } from 'echarts'
import { Activity, ArrowLeftRight, Factory, GitCompareArrows, TableProperties, Zap } from 'lucide-vue-next'
import ChartCard from '@/components/common/ChartCard.vue'
import DataQualityBadge from '@/components/common/DataQualityBadge.vue'
import SpotSkeleton from '@/components/common/SpotSkeleton.vue'
import { mapWithConcurrency } from '@/utils/concurrency'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import SpotFilterBar from '@/components/spot/SpotFilterBar.vue'
import { onRegionChange } from '@/composables/useRegionReload'
import { onSelectionChange, useSpotSelection } from '@/composables/useSpotSelection'
import { usePlantUnitFilter } from '@/composables/usePlantUnitFilter'
import { chartChrome } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay, fmtNum, sliderZoom } from '@/services/chart/chartOptions'
import {
  POWER,
  animation,
  catAxis,
  grid,
  legend,
  stepSeries,
  tooltipStyle,
  valueAxis,
  withAlpha
} from '@/services/chart/chartStyle'
import {
  ALL_PLANTS,
  ALL_UNITS,
  PLANT_OUTPUT_PRIVATE_FAMILIES,
  loadPlantOutputRangePayload,
  pointToTime,
  type CapturedEnvelopeMeta,
  type PlantDimRow,
  type PlantNodeRow,
  type PlantOutputRow
} from '@/services/market/plantOutputClient'
import {
  fetchNodePriceSeries,
  type NodePricePoint,
  type SpotMarket
} from '@/services/market/spotClient'

type DateRange = [string, string]
type LinkageSeries = {
  labels: string[]
  dates: string[]
  times: string[]
  actual: Array<number | null>
  plan: Array<number | null>
  actualSource: string
  planSource: string
}
type PriceBandKind = 'high' | 'low' | 'normal'
type PriceBand = { kind: Exclude<PriceBandKind, 'normal'>; start: number; end: number }
type ScatterPoint = {
  slotIndex: number
  date: string
  time: string
  price: number
  actual: number
  plan: number | null
  band: PriceBandKind
}
type SegmentRow = {
  slotIndex: number
  time: string
  bandText: string
  priceText: string
  actualText: string
  planText: string
  deviationText: string
  band: PriceBandKind
}
const DEFAULT_DATE = '2026-05-01'
const SEGMENT_PAGE_SIZE = 48
const PRICE_REQUEST_CONCURRENCY = 4
const LONG_SEQUENCE_SAMPLE_THRESHOLD = 96 * 7

function normalizeDateRangeValue(value: readonly [string, string] | string[] | undefined): DateRange {
  if (!Array.isArray(value) || value.length < 2) return [DEFAULT_DATE, DEFAULT_DATE]
  const [start, end] = value
  return [start || DEFAULT_DATE, end || start || DEFAULT_DATE]
}

const spotSelection = useSpotSelection()
const dateRange = ref<DateRange>(normalizeDateRangeValue(spotSelection.dateRange))
const market = ref<SpotMarket>(spotSelection.market)
const selectedPlant = ref<string>(spotSelection.plant || ALL_PLANTS)
const selectedUnit = ref<string>(spotSelection.unit || ALL_UNITS)
const selectedNode = ref(spotSelection.node || '')

const rows = ref<PlantOutputRow[]>([])
const plants = ref<PlantDimRow[]>([])
const plantNodes = ref<PlantNodeRow[]>([])
const priceByDate = ref<Record<string, Array<number | null>>>({})
const segmentPage = ref(1)
const selectedSlotIndex = ref<number | null>(null)
type ChartCardExpose = InstanceType<typeof ChartCard> & { instance: () => ECharts | null }
const mainChartRef = ref<ChartCardExpose | null>(null)
const scatterChartRef = ref<ChartCardExpose | null>(null)
let boundMainChart: ECharts | null = null
let boundScatterChart: ECharts | null = null
const loading = ref(false)
const priceLoading = ref(false)
// reloadAll 竞态守卫：日期范围/地区快速连续切换时，旧轮 await resolve 后用 seq 比对丢弃，
// 保证"最后发起者赢"（旧响应不再覆盖新数据）。详见 #405。
const reloadSeq = ref(0)
// loadPrice 独立竞态守卫：onPlantChange/onMarketChange/onNodeChange/onSelectionChange 不走 reloadAll，
// 需自身 seq 互斥，否则两个独立 loadPrice 并发 + worker 读响应式 .value 会写 A/B 混字典（#546 回归）。
const priceSeq = ref(0)
const errorMsg = ref('')
const outputIngestHint = ref(false)
const priceIngestHint = ref(false)
const meta = ref<CapturedEnvelopeMeta>({ hasRealData: false, mock: false, sourceType: '', updatedAt: null })

const marketOptions = [
  { value: 'da' as SpotMarket, label: '日前' },
  { value: 'rt' as SpotMarket, label: '实时' }
]

function isEmptyResultError(message: string): boolean {
  return /未摄取|parquet|no data|暂无数据|not found|capture family not found|no captured file|404|空/i.test(message)
}

function toNum(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

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
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [DEFAULT_DATE]
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const out: string[] = []
  for (let ts = from; ts <= to; ts += 24 * 60 * 60 * 1000) {
    out.push(format(ts))
  }
  return out
}

const rangeDates = computed(() => daysBetween(dateRange.value))
const isSingleDay = computed(() => rangeDates.value.length === 1)
const marketLabel = computed(() => (market.value === 'da' ? '日前' : '实时'))

const {
  plantOptions,
  unitOptions,
  filteredRows,
  plantLabel,
  unitLabel,
  ensureSelections: ensurePlantUnitSelections
} = usePlantUnitFilter<PlantOutputRow>({
  rows,
  plants,
  selectedPlant,
  selectedUnit
})

const nodeOptions = computed(() => {
  const set = new Set<string>()
  const selected = selectedPlant.value
  for (const row of plantNodes.value) {
    if (row.isActive === 0) continue
    if (!row.nodeName) continue
    if (selected !== ALL_PLANTS && row.standardName !== selected) continue
    set.add(row.nodeName)
  }
  if (!set.size) {
    for (const row of plantNodes.value) {
      if (row.isActive === 0) continue
      if (row.nodeName) set.add(row.nodeName)
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

function preferredByType(list: PlantOutputRow[], types: string[]): PlantOutputRow | null {
  for (const type of types) {
    const row = list.find((item) => item.dataType === type && toNum(item.valueMw) !== null)
    if (row) return row
  }
  return list.find((item) => toNum(item.valueMw) !== null) ?? null
}

const outputSeries = computed<LinkageSeries>(() => {
  const byKey = new Map<string, PlantOutputRow[]>()
  for (const row of filteredRows.value) {
    if (!Number.isFinite(Number(row.point)) || !row.date) continue
    const key = `${row.date}::${Number(row.point)}`
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
  }

  const labels: string[] = []
  const dates: string[] = []
  const times: string[] = []
  const actual: Array<number | null> = []
  const plan: Array<number | null> = []
  let actualSource = '子站回传'
  let planSource = '最终下发'

  for (const date of rangeDates.value) {
    for (let point = 1; point <= 96; point += 1) {
      const list = byKey.get(`${date}::${point}`) ?? []
      const time = list[0]?.timePoint ?? pointToTime(point)
      const actualRow = preferredByType(list.filter((row) => row.seriesRole === 'actual'), ['子站回传', '实际功率'])
      const planRow = preferredByType(list.filter((row) => row.seriesRole === 'plan'), ['最终下发'])
      if (actualRow?.dataType) actualSource = actualRow.dataType
      if (planRow?.dataType) planSource = planRow.dataType
      dates.push(date)
      times.push(time)
      labels.push(isSingleDay.value ? time : `${date.slice(5)} ${time}`)
      actual.push(toNum(actualRow?.valueMw))
      plan.push(toNum(planRow?.valueMw))
    }
  }

  return { labels, dates, times, actual, plan, actualSource, planSource }
})

const alignedPrice = computed<Array<number | null>>(() => {
  const out: Array<number | null> = []
  for (const date of rangeDates.value) {
    const list = priceByDate.value[date] ?? []
    for (let index = 0; index < 96; index += 1) out.push(list[index] ?? null)
  }
  return out
})

const hasOutputData = computed(() =>
  meta.value.hasRealData
  && !meta.value.mock
  && filteredRows.value.length > 0
  && outputSeries.value.actual.some((value) => value !== null)
)
const hasPriceData = computed(() => alignedPrice.value.some((value) => value !== null))
const hasMainData = computed(() => hasOutputData.value && hasPriceData.value)
const isLongSequence = computed(() => outputSeries.value.labels.length > LONG_SEQUENCE_SAMPLE_THRESHOLD)
const qualityBasis = computed(() => {
  if (meta.value.hasRealData && !meta.value.mock) return 'captured'
  if (meta.value.mock) return 'synthetic'
  return null
})
const seriesCompleteness = computed(() => {
  const expected = Math.max(1, rangeDates.value.length * 96 * 2)
  const actualCount = outputSeries.value.actual.filter((value) => value !== null).length
  const priceCount = alignedPrice.value.filter((value) => value !== null).length
  return (actualCount + priceCount) / expected
})
const qualityNote = computed(() => `${rangeDates.value.length}日 · ${marketLabel.value} · ${selectedNode.value || '未选节点'}`)
const selectedMainPoint = computed(() => {
  const index = selectedSlotIndex.value
  if (index === null) return null
  const label = outputSeries.value.labels[index]
  const price = alignedPrice.value[index]
  const actual = outputSeries.value.actual[index]
  if (!label || price === null || actual === null) return null
  return { index, label, price, actual }
})

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
  const values = alignedPrice.value.filter((value): value is number => value !== null && Number.isFinite(value))
  const low = quantile(values, 0.25)
  const high = quantile(values, 0.75)
  return {
    low,
    high,
    usable: low !== null && high !== null && Math.abs(high - low) > 1e-9
  }
})

function bandOf(price: number | null | undefined): PriceBandKind {
  const thresholds = priceThresholds.value
  if (!thresholds.usable || price === null || price === undefined) return 'normal'
  if (price >= Number(thresholds.high)) return 'high'
  if (price <= Number(thresholds.low)) return 'low'
  return 'normal'
}

const priceBands = computed<PriceBand[]>(() => {
  if (!priceThresholds.value.usable) return []
  const out: PriceBand[] = []
  const prices = alignedPrice.value
  let start = -1
  let current: Exclude<PriceBandKind, 'normal'> | null = null
  for (let i = 0; i < prices.length; i += 1) {
    const band = bandOf(prices[i])
    const typed = band === 'high' || band === 'low' ? band : null
    if (typed !== current) {
      if (current && start >= 0) out.push({ kind: current, start, end: i - 1 })
      start = typed ? i : -1
      current = typed
    }
  }
  if (current && start >= 0) out.push({ kind: current, start, end: prices.length - 1 })
  return out
})

function markAreaForPriceBands() {
  const labels = outputSeries.value.labels
  if (!labels.length || !priceBands.value.length) return undefined
  return {
    silent: true,
    data: priceBands.value.map((band) => {
      const color = band.kind === 'high' ? '#dc2626' : '#2563eb'
      const start = labels[band.start]
      // #408: 末段 band（end === labels.length - 1，如 23:45 持续高价/低价）不能再用
      // labels[Math.min(end+1, length-1)]，它会把右边界 clamp 回末类目中心，导致末段约半个
      // slot（~7.5min）着色被裁。改用越界数字索引 end+1（category 轴下 number 代表 index，
      // 越界 index 会被 ECharts 延伸到轴右边界），正好覆盖末段右边缘。中间段保留原类目名 +1 逻辑。
      const isTail = band.end === labels.length - 1
      const end = isTail ? band.end + 1 : labels[band.end + 1]
      return [
        {
          xAxis: start,
          itemStyle: { color: withAlpha(color, 0.08) },
          label: {
            show: true,
            formatter: band.kind === 'high' ? '高价' : '低价',
            color: withAlpha(color, 0.85),
            fontSize: 10,
            position: 'insideTop'
          }
        },
        { xAxis: end }
      ]
    })
  }
}

const scatterPoints = computed<ScatterPoint[]>(() => {
  const points: ScatterPoint[] = []
  const prices = alignedPrice.value
  const series = outputSeries.value
  for (let i = 0; i < series.labels.length; i += 1) {
    const price = prices[i]
    const actual = series.actual[i]
    if (price === null || actual === null || !Number.isFinite(price) || !Number.isFinite(actual)) continue
    points.push({
      slotIndex: i,
      date: series.dates[i],
      time: series.labels[i],
      price,
      actual,
      plan: series.plan[i],
      band: bandOf(price)
    })
  }
  return points
})

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  const ax = avg(xs.slice(0, n))
  const ay = avg(ys.slice(0, n))
  if (ax === null || ay === null) return null
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - ax
    const dy = ys[i] - ay
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx <= 1e-12 || vy <= 1e-12) return null
  return cov / Math.sqrt(vx * vy)
}

const relationStats = computed(() => {
  const points = scatterPoints.value
  const corr = pearson(points.map((p) => p.price), points.map((p) => p.actual))
  const highAvg = avg(points.filter((p) => p.band === 'high').map((p) => p.actual))
  const lowAvg = avg(points.filter((p) => p.band === 'low').map((p) => p.actual))
  const deltaPrice: number[] = []
  const deltaActual: number[] = []
  const prices = alignedPrice.value
  const actual = outputSeries.value.actual
  for (let i = 1; i < prices.length; i += 1) {
    if (prices[i] === null || prices[i - 1] === null || actual[i] === null || actual[i - 1] === null) continue
    deltaPrice.push(Number(prices[i]) - Number(prices[i - 1]))
    deltaActual.push(Number(actual[i]) - Number(actual[i - 1]))
  }
  return {
    corr,
    deltaCorr: pearson(deltaPrice, deltaActual),
    highAvg,
    lowAvg,
    highLowDiff: highAvg === null || lowAvg === null ? null : highAvg - lowAvg,
    pairCount: points.length
  }
})

const kpis = computed(() => [
  { label: '价量相关', value: relationStats.value.corr, unit: '', icon: GitCompareArrows, digits: 3 },
  { label: '变化相关', value: relationStats.value.deltaCorr, unit: '', icon: ArrowLeftRight, digits: 3 },
  { label: '高价实际均值', value: relationStats.value.highAvg, unit: 'MW', icon: Zap, digits: 2 },
  { label: '高低出力差', value: relationStats.value.highLowDiff, unit: 'MW', icon: Activity, digits: 2 }
])

function formatMetric(value: number | null | undefined, unit: string, digits = 2) {
  if (value === null || value === undefined) return '—'
  const suffix = unit ? ` ${unit}` : ''
  return `${fmtNum(value, digits)}${suffix}`
}

const emptyReason = computed(() => {
  if (meta.value.mock) return '模拟数据已拦截，未上屏'
  if (!hasOutputData.value) return '该筛选条件暂无真实出力序列'
  if (!hasPriceData.value) return selectedNode.value ? '该节点当日暂无现货电价序列' : '请先选择价格节点'
  return '暂无可绘制数据'
})

function buildMainOption() {
  const cc = chartChrome()
  const labels = outputSeries.value.labels
  const priceColor = POWER.price
  const actualColor = POWER.newEnergy
  const planColor = POWER.forecast
  const empty = !hasMainData.value
  const selected = selectedMainPoint.value
  return {
    tooltip: {
      ...axisTooltip({
        units: {
          [`${marketLabel.value}出清价`]: '元/MWh',
          [`实际出力 · ${outputSeries.value.actualSource}`]: 'MW',
          [`计划出力 · ${outputSeries.value.planSource}`]: 'MW'
        },
        digits: 2
      }),
      ...tooltipStyle(),
      confine: true
    },
    toolbox: chartToolbox('云南电价自有机组出力联动'),
    legend: legend({ top: 2, right: 92 }),
    grid: grid({ legend: true, zoom: true, right: 58 }),
    dataZoom: sliderZoom(),
    ...animation(),
    xAxis: catAxis(labels, {
      boundaryGap: false,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        formatter: (value: string) => {
          const text = String(value)
          return text.endsWith(':00') || /\d{2}-\d{2} 00:00$/.test(text) ? text : ''
        }
      }
    }),
    yAxis: [
      valueAxis('元/MWh', { scale: true }),
      valueAxis('MW', {
        scale: true,
        position: 'right',
        splitLine: { show: false }
      })
    ],
    series: [
      {
        name: `${marketLabel.value}出清价`,
        type: 'line',
        yAxisIndex: 0,
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        sampling: 'lttb',
        lineStyle: { width: 2.2, color: priceColor, type: 'solid' },
        itemStyle: { color: priceColor },
        data: alignedPrice.value,
        markArea: markAreaForPriceBands(),
        ...(selected
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#7c3aed', type: 'dashed', width: 1.4 },
                label: {
                  formatter: '回跳时段',
                  position: 'insideEndTop',
                  color: '#7c3aed',
                  fontSize: 10
                },
                data: [{ xAxis: selected.label }]
              },
              markPoint: {
                symbol: 'pin',
                symbolSize: 42,
                itemStyle: { color: '#7c3aed' },
                label: { color: '#fff', formatter: () => fmtNum(selected.price, 1), fontSize: 10 },
                data: [{ name: '回跳', xAxis: selected.label, yAxis: selected.price }]
              }
            }
          : {})
      },
      stepSeries(`实际出力 · ${outputSeries.value.actualSource}`, outputSeries.value.actual, actualColor, {
        yAxisIndex: 1,
        step: 'end',
        connectNulls: false,
        ...(isLongSequence.value ? { sampling: 'lttb' } : {}),
        lineStyle: { width: 2.2, color: actualColor, type: 'solid' }
      }),
      stepSeries(`计划出力 · ${outputSeries.value.planSource}`, outputSeries.value.plan, planColor, {
        yAxisIndex: 1,
        step: 'end',
        connectNulls: false,
        ...(isLongSequence.value ? { sampling: 'lttb' } : {}),
        lineStyle: { width: 1.8, color: planColor, type: 'dashed' }
      })
    ],
    ...emptyOverlay(empty, emptyReason.value)
  }
}

function regressionLine(points: ScatterPoint[]) {
  if (points.length < 2) return []
  const xs = points.map((p) => p.price)
  const ys = points.map((p) => p.actual)
  const ax = avg(xs)
  const ay = avg(ys)
  if (ax === null || ay === null) return []
  let cov = 0
  let vx = 0
  for (let i = 0; i < points.length; i += 1) {
    cov += (xs[i] - ax) * (ys[i] - ay)
    vx += (xs[i] - ax) ** 2
  }
  if (vx <= 1e-12) return []
  const slope = cov / vx
  const intercept = ay - slope * ax
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  return [[minX, slope * minX + intercept], [maxX, slope * maxX + intercept]]
}

function buildScatterOption() {
  const cc = chartChrome()
  const points = scatterPoints.value
  const empty = !points.length
  const selectedIndex = selectedSlotIndex.value
  const scatterData = points.map((p) => {
    const selected = selectedIndex === p.slotIndex
    const color = p.band === 'high' ? '#dc2626' : p.band === 'low' ? '#2563eb' : POWER.newEnergy
    return {
      value: [p.price, p.actual],
      itemStyle: {
        color,
        opacity: selected ? 1 : 0.78,
        borderColor: selected ? '#111827' : withAlpha(color, 0.18),
        borderWidth: selected ? 2 : 0
      }
    }
  })
  return {
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (param: { dataIndex?: number }) => {
        const p = points[param.dataIndex ?? 0]
        if (!p) return ''
        const band = p.band === 'high' ? '高价' : p.band === 'low' ? '低价' : '中位'
        return `${p.time}<br/>${band} · ${marketLabel.value}<br/>电价 <b>${fmtNum(p.price, 2)}</b> 元/MWh<br/>实际 <b>${fmtNum(p.actual, 2)}</b> MW<br/>计划 <b>${fmtNum(p.plan, 2)}</b> MW`
      },
      ...tooltipStyle()
    },
    toolbox: chartToolbox('价格出力散点关系'),
    legend: legend({ top: 2, right: 92 }),
    grid: grid({ legend: true, zoom: false, right: 24 }),
    ...animation(),
    xAxis: valueAxis('元/MWh', { scale: true }),
    yAxis: valueAxis('MW', { scale: true }),
    series: [
      {
        name: '价格-实际出力',
        type: 'scatter',
        symbolSize: (_value: unknown, param: { dataIndex: number }) =>
          selectedIndex === points[param.dataIndex]?.slotIndex ? 11 : 8,
        data: scatterData,
        emphasis: { focus: 'series' }
      },
      {
        name: '线性趋势',
        type: 'line',
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: { width: 1.4, color: cc.neutralLine || '#64748b', type: 'dashed' },
        data: regressionLine(points)
      }
    ],
    ...emptyOverlay(empty, '暂无可计算的价格-出力配对点')
  }
}

const allSegmentRows = computed<SegmentRow[]>(() =>
  scatterPoints.value
    .filter((point) => point.band === 'high' || point.band === 'low')
    .map((point) => ({
      slotIndex: point.slotIndex,
      time: point.time,
      bandText: point.band === 'high' ? '高价' : '低价',
      priceText: fmtNum(point.price, 2),
      actualText: fmtNum(point.actual, 2),
      planText: fmtNum(point.plan, 2),
      deviationText: point.plan === null ? '—' : fmtNum(point.actual - point.plan, 2),
      band: point.band
    }))
    .sort((a, b) => {
      if (a.band !== b.band) return a.band === 'high' ? -1 : 1
      return a.time.localeCompare(b.time)
    })
)
const segmentTotal = computed(() => allSegmentRows.value.length)
const segmentPageCount = computed(() => Math.max(1, Math.ceil(segmentTotal.value / SEGMENT_PAGE_SIZE)))
const segmentRows = computed(() => {
  const start = (segmentPage.value - 1) * SEGMENT_PAGE_SIZE
  return allSegmentRows.value.slice(start, start + SEGMENT_PAGE_SIZE)
})
const segmentPageStart = computed(() => (segmentTotal.value ? (segmentPage.value - 1) * SEGMENT_PAGE_SIZE + 1 : 0))
const segmentPageEnd = computed(() => Math.min(segmentTotal.value, segmentPage.value * SEGMENT_PAGE_SIZE))

// 筛选/日期范围变化导致分段数据刷新时，回到第 1 页。
// 数据按「高价优先 + 时间」排序，停在旧页码的中段会漏掉最相关的高价时段片段。
// 与 DynamicTable.vue 的 watch([keyword, rows], () => page.value = 1) 同模式。
watch(segmentTotal, () => {
  segmentPage.value = 1
})

function mergeMeta(metas: CapturedEnvelopeMeta[]): CapturedEnvelopeMeta {
  const updatedAt = metas
    .map((item) => item.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const sourceTypes = [...new Set(metas.map((item) => item.sourceType).filter(Boolean))]
  const error = metas.map((item) => item.error).filter(Boolean).join('；') || undefined
  return {
    hasRealData: metas.some((item) => item.hasRealData && !item.mock),
    mock: metas.some((item) => item.mock),
    sourceType: sourceTypes.join('+'),
    updatedAt,
    ...(error ? { error } : {})
  }
}

function ensureSelections(): boolean {
  const plantUnit = ensurePlantUnitSelections()
  const beforeNode = selectedNode.value
  if (!selectedNode.value || !nodeOptions.value.includes(selectedNode.value)) {
    selectedNode.value = nodeOptions.value[0] ?? ''
  }
  return plantUnit.changed || beforeNode !== selectedNode.value
}

function syncSpotSelection() {
  spotSelection.setSelection({
    date: dateRange.value[0],
    dateRange: dateRange.value,
    plant: selectedPlant.value,
    unit: selectedUnit.value,
    node: selectedNode.value,
    market: market.value
  })
}

function selectionEqualsLocal(selection: {
  date?: string
  dateRange: readonly [string, string]
  plant: string
  unit: string
  node: string
  market: SpotMarket
}): boolean {
  return selection.dateRange[0] === dateRange.value[0]
    && selection.dateRange[1] === dateRange.value[1]
    && (!selection.date || selection.date === dateRange.value[0])
    && selection.plant === selectedPlant.value
    && selection.unit === selectedUnit.value
    && selection.node === selectedNode.value
    && selection.market === market.value
}

function onSegmentPageChange(page: number) {
  segmentPage.value = Math.max(1, Math.min(page, segmentPageCount.value))
}

function onSegmentRowClick(row: SegmentRow) {
  focusSlot(row.slotIndex)
}

function priceArray(points: NodePricePoint[]): Array<number | null> {
  const byIndex = Array.from({ length: 96 }, (_, index) => toNum(points[index]?.price))
  return byIndex
}

async function loadPrice() {
  // 每次入口 bump priceSeq + 快照 node/mkt：独立调用（onPlantChange/onMarketChange/onNodeChange/onSelectionChange）
  // 不再依赖 reloadAll 传 bailSeq；worker 用快照而非响应式 .value，防单轮内切节点/market 造成 A/B 混字典（#405 同族，#546 回归）。
  const seq = ++priceSeq.value
  const node = selectedNode.value
  const mkt = market.value
  const stale = () => seq !== priceSeq.value
  if (stale()) return
  priceLoading.value = true
  priceIngestHint.value = false
  if (!node) {
    if (!stale()) {
      priceByDate.value = {}
      priceIngestHint.value = true
      priceLoading.value = false
    }
    return
  }
  try {
    const entries = await mapWithConcurrency(rangeDates.value, PRICE_REQUEST_CONCURRENCY, async (date) => {
      const payload = await fetchNodePriceSeries(date, node, mkt, '云南')
      return [date, priceArray(payload.series ?? [])] as const
    })
    if (stale()) return // 旧轮价格结果丢弃（#405）
    priceByDate.value = Object.fromEntries(entries)
    priceIngestHint.value = !Object.values(priceByDate.value).some((list) => list.some((value) => value !== null))
  } catch (error) {
    if (stale()) return // 旧轮错误不覆盖新轮（#405）
    priceByDate.value = {}
    const message = error instanceof Error ? error.message : '节点电价加载失败'
    if (isEmptyResultError(message)) {
      priceIngestHint.value = true
    } else {
      errorMsg.value = message
    }
  } finally {
    if (!stale()) priceLoading.value = false // 只有最新轮才关 priceLoading（#405）
  }
}

async function reloadAll() {
  const seq = ++reloadSeq.value
  // 入口即 bump priceSeq 取消所有在飞 loadPrice：新 reloadAll 的机组出力 payload 拉取期间，上一轮在飞的
  // loadPrice 不能等新 loadPrice 入口才被取消（payload 返回前 priceSeq 不变，旧 loadPrice 会写旧日期/旧节点
  // priceByDate）。入口同步失效，关闭该窗口（#546）。
  ++priceSeq.value
  loading.value = true
  errorMsg.value = ''
  outputIngestHint.value = false
  priceIngestHint.value = false
  selectedSlotIndex.value = null
  try {
    const dates = rangeDates.value
    const payload = await loadPlantOutputRangePayload(dates[0] ?? DEFAULT_DATE, dates.at(-1) ?? dates[0] ?? DEFAULT_DATE)
    if (seq !== reloadSeq.value) return // 新一轮已发起，丢弃本次旧结果（#405）
    rows.value = payload.rows
    plants.value = payload.plants
    plantNodes.value = payload.nodes
    meta.value = mergeMeta([payload.meta])
    ensureSelections()
    syncSpotSelection()
    if (meta.value.mock) {
      outputIngestHint.value = false
    } else if (!rows.value.length) {
      outputIngestHint.value = true
    }
    if (meta.value.error && !isEmptyResultError(meta.value.error)) {
      errorMsg.value = meta.value.error
    }
    await loadPrice()
    if (seq !== reloadSeq.value) return // loadPrice 期间又发起新轮，丢弃（#405）
  } catch (error) {
    if (seq !== reloadSeq.value) return // 旧轮的错误不覆盖新轮（#405）
    rows.value = []
    priceByDate.value = {}
    const message = error instanceof Error ? error.message : '加载失败'
    if (isEmptyResultError(message)) outputIngestHint.value = true
    else errorMsg.value = message
  } finally {
    if (seq === reloadSeq.value) loading.value = false // 只有最新轮才关 loading（#405）
  }
}

function onDateRangeChange(value: DateRange) {
  dateRange.value = normalizeDateRangeValue(value)
  syncSpotSelection()
  void reloadAll()
}

function onPlantChange(value: string) {
  selectedPlant.value = value || ALL_PLANTS
  ensureSelections()
  syncSpotSelection()
  void loadPrice()
}

function onUnitChange(value: string) {
  selectedUnit.value = value || ALL_UNITS
  ensureSelections()
  syncSpotSelection()
}

function onMarketChange(value?: SpotMarket) {
  if (value) market.value = value
  syncSpotSelection()
  void loadPrice()
}

function onNodeChange(value: string) {
  selectedNode.value = value
  syncSpotSelection()
  void loadPrice()
}

type ChartClickParams = { seriesType?: string; dataIndex?: number }
type EChartsEventHandler = (params: unknown) => void

function dispatchMainFocus(index: number) {
  const labels = outputSeries.value.labels
  const label = labels[index]
  const main = mainChartRef.value?.instance()
  if (!main || main.isDisposed() || !label) return

  if (labels.length > 96) {
    const windowSize = Math.min(192, Math.max(48, Math.floor(labels.length * 0.12)))
    const startIndex = Math.max(0, index - Math.floor(windowSize / 2))
    const endIndex = Math.min(labels.length - 1, startIndex + windowSize - 1)
    main.dispatchAction({
      type: 'dataZoom',
      startValue: labels[startIndex],
      endValue: labels[endIndex]
    })
  }
  main.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index })
  main.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: index })
}

function dispatchScatterFocus(slotIndex: number) {
  const scatterIndex = scatterPoints.value.findIndex((point) => point.slotIndex === slotIndex)
  const scatter = scatterChartRef.value?.instance()
  if (!scatter || scatter.isDisposed() || scatterIndex < 0) return
  scatter.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: scatterIndex })
  scatter.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: scatterIndex })
}

function focusSlot(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= outputSeries.value.labels.length) return
  selectedSlotIndex.value = index
  void nextTick(() => {
    dispatchMainFocus(index)
    dispatchScatterFocus(index)
  })
}

const handleMainChartClick: EChartsEventHandler = (payload) => {
  const params = payload as ChartClickParams
  if (typeof params.dataIndex !== 'number') return
  focusSlot(params.dataIndex)
}

const handleScatterChartClick: EChartsEventHandler = (payload) => {
  const params = payload as ChartClickParams
  if (params.seriesType !== 'scatter' || typeof params.dataIndex !== 'number') return
  const point = scatterPoints.value[params.dataIndex]
  if (point) focusSlot(point.slotIndex)
}

function bindChartClickHandlers() {
  const main = mainChartRef.value?.instance() ?? null
  if (main !== boundMainChart) {
    if (boundMainChart && !boundMainChart.isDisposed()) boundMainChart.off('click', handleMainChartClick)
    boundMainChart = main
    if (boundMainChart && !boundMainChart.isDisposed()) {
      boundMainChart.off('click', handleMainChartClick)
      boundMainChart.on('click', handleMainChartClick)
    }
  }

  const scatter = scatterChartRef.value?.instance() ?? null
  if (scatter !== boundScatterChart) {
    if (boundScatterChart && !boundScatterChart.isDisposed()) boundScatterChart.off('click', handleScatterChartClick)
    boundScatterChart = scatter
    if (boundScatterChart && !boundScatterChart.isDisposed()) {
      boundScatterChart.off('click', handleScatterChartClick)
      boundScatterChart.on('click', handleScatterChartClick)
    }
  }
}

function unbindChartClickHandlers() {
  if (boundMainChart && !boundMainChart.isDisposed()) boundMainChart.off('click', handleMainChartClick)
  if (boundScatterChart && !boundScatterChart.isDisposed()) boundScatterChart.off('click', handleScatterChartClick)
  boundMainChart = null
  boundScatterChart = null
}

onSelectionChange(
  ({ selection, changed }) => {
    if (selectionEqualsLocal(selection)) return
    const shouldReloadAll = changed.includes('date') || changed.includes('dateRange')
    const shouldReloadPrice = changed.includes('plant') || changed.includes('node') || changed.includes('market')
    dateRange.value = changed.includes('dateRange')
      ? normalizeDateRangeValue(selection.dateRange)
      : normalizeDateRangeValue([selection.date, selection.date])
    selectedPlant.value = selection.plant || ALL_PLANTS
    selectedUnit.value = selection.unit || ALL_UNITS
    selectedNode.value = selection.node || ''
    market.value = selection.market
    ensureSelections()
    syncSpotSelection()
    if (shouldReloadAll) {
      void reloadAll()
      return
    }
    if (shouldReloadPrice) void loadPrice()
  },
  { fields: ['date', 'dateRange', 'plant', 'unit', 'node', 'market'] }
)

watch(
  [() => loading.value, () => priceLoading.value, scatterPoints],
  () => {
    void nextTick(bindChartClickHandlers)
  },
  { flush: 'post' }
)

onMounted(() => {
  void reloadAll()
  void nextTick(bindChartClickHandlers)
})

onRegionChange(() => {
  void reloadAll()
})

onBeforeUnmount(() => {
  unbindChartClickHandlers()
})
</script>

<template>
  <div class="price-output-panel">
    <RegionDataBanner :families="PLANT_OUTPUT_PRIVATE_FAMILIES" />

    <section class="pol-hero">
      <div>
        <div class="pol-kicker"><Factory :size="16" /><span>云南 · 电价 × 自有机组出力</span></div>
        <p>同一时间轴对齐节点现货出清价与自有电厂/机组实际、计划物理出力，标注高价和低价时段。</p>
      </div>
      <div class="pol-hero__meta">
        <DataQualityBadge
          :basis="qualityBasis"
          :updated-at="meta.updatedAt"
          cadence="monthly"
          :completeness="seriesCompleteness"
          source="yn_plant_output + node-price"
          :note="qualityNote"
        />
        <el-tag v-if="meta.sourceType" :type="meta.hasRealData && !meta.mock ? 'success' : 'warning'" effect="plain">
          {{ meta.sourceType }}
        </el-tag>
      </div>
    </section>

    <SpotFilterBar
      :date-range="dateRange"
      :plant="selectedPlant"
      :plant-options="plantOptions"
      :unit="selectedUnit"
      :unit-options="unitOptions"
      :node="selectedNode"
      :node-options="nodeOptions"
      show-unit
      show-node
      show-refresh
      :loading="loading || priceLoading"
      @update:date-range="onDateRangeChange"
      @update:plant="onPlantChange"
      @update:unit="onUnitChange"
      @update:node="onNodeChange"
      @refresh="reloadAll"
    >
      <template #after-date>
        <label class="pol-field pol-field--market">
          <span>市场</span>
          <el-radio-group v-model="market" @change="onMarketChange">
            <el-radio-button v-for="item in marketOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
          </el-radio-group>
        </label>
      </template>
    </SpotFilterBar>

    <el-alert
      v-if="meta.mock"
      type="warning"
      :closable="false"
      class="pol-alert"
      show-icon
      title="检测到模拟出力回放，已禁止上屏"
      description="该响应标记 mock:true / sourceType:MOCK / productionWrite:false。请先摄取 yn_plant_output 真实数据。"
    />
    <el-alert v-else-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="pol-alert" show-icon />
    <el-alert
      v-else-if="outputIngestHint"
      type="warning"
      :closable="false"
      class="pol-alert"
      show-icon
      title="后端暂无 yn_plant_output 电厂出力数据"
      description="请在主仓库运行 import:spot-export --write 摄取云南月度导出包后重试。"
    />
    <el-alert
      v-else-if="priceIngestHint"
      type="warning"
      :closable="false"
      class="pol-alert"
      show-icon
      title="后端暂无该节点现货电价序列"
      description="请确认节点电价 Parquet 已摄取，或切换日期、市场、电厂/节点后重试。"
    />

    <section class="pol-kpi-row" v-loading="loading || priceLoading">
      <div v-for="item in kpis" :key="item.label" class="pol-kpi">
        <div class="pol-kpi-label"><component :is="item.icon" :size="13" /> {{ item.label }}</div>
        <div class="pol-kpi-value">{{ formatMetric(item.value, item.unit, item.digits) }}</div>
        <div class="pol-kpi-unit">{{ plantLabel }} · {{ unitLabel }} · 配对 {{ relationStats.pairCount }} 点</div>
      </div>
    </section>

    <section v-if="loading || priceLoading" class="pol-charts">
      <SpotSkeleton variant="chart" :height="390" />
      <SpotSkeleton variant="chart" :height="350" />
    </section>
    <section v-else class="pol-charts">
      <ChartCard
        ref="mainChartRef"
        title="现货出清价 × 实际/计划出力同轴曲线"
        :height="390"
        :loading="loading || priceLoading"
        :updated-at="meta.updatedAt"
        cadence="monthly"
        :build-option="buildMainOption"
        fullscreen
        png-export
        png-name="云南电价出力联动主图"
      >
        <template #actions>
          <span class="pol-chart-sub">{{ selectedNode || '未选节点' }} · {{ marketLabel }}</span>
        </template>
      </ChartCard>

      <ChartCard
        ref="scatterChartRef"
        title="价格-实际出力散点关系"
        :height="350"
        :loading="loading || priceLoading"
        :build-option="buildScatterOption"
        fullscreen
        png-export
        png-name="云南电价出力散点关系"
      >
        <template #actions>
          <span class="pol-chart-sub">r={{ formatMetric(relationStats.corr, '', 3) }}</span>
        </template>
      </ChartCard>
    </section>

    <section class="pol-table-card">
      <div class="pol-table-head">
        <h3><TableProperties :size="16" /> 高价/低价出力片段</h3>
        <span class="pol-table-sub">
          高价≥{{ formatMetric(priceThresholds.high, '元/MWh', 2) }} · 低价≤{{ formatMetric(priceThresholds.low, '元/MWh', 2) }}
          · 共 {{ segmentTotal }} 段
          <template v-if="segmentTotal"> · {{ segmentPageStart }}-{{ segmentPageEnd }}</template>
        </span>
      </div>
      <SpotSkeleton v-if="loading || priceLoading" variant="table" :rows="6" :columns="6" />
      <template v-else>
        <el-table :data="segmentRows" size="small" border stripe max-height="360" @row-click="onSegmentRowClick">
          <el-table-column prop="time" label="时段" width="120" />
          <el-table-column prop="bandText" label="价格带" width="88">
            <template #default="{ row }">
              <el-tag :type="row.band === 'high' ? 'danger' : 'primary'" effect="plain">{{ row.bandText }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="priceText" label="电价(元/MWh)" min-width="130" />
          <el-table-column prop="actualText" label="实际(MW)" min-width="110" />
          <el-table-column prop="planText" label="计划(MW)" min-width="110" />
          <el-table-column prop="deviationText" label="实际-计划(MW)" min-width="130" />
          <template #empty>当前筛选条件下暂无高价/低价出力片段。</template>
        </el-table>
        <div v-if="segmentTotal > SEGMENT_PAGE_SIZE" class="pol-pagination-row">
          <el-pagination
            small
            background
            layout="total, prev, pager, next"
            :current-page="segmentPage"
            :page-size="SEGMENT_PAGE_SIZE"
            :total="segmentTotal"
            @current-change="onSegmentPageChange"
          />
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.price-output-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pol-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.pol-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: var(--font-md);
  font-weight: 650;
}

.pol-hero p {
  margin: 8px 0 0;
  color: #5c6b76;
  font-size: var(--font-md);
  line-height: 1.7;
}

.pol-hero__meta {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 240px;
}

.pol-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.pol-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pol-field > span {
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.pol-field :deep(.el-select),
.pol-field :deep(.el-date-editor) {
  width: 190px;
}

.pol-field--range :deep(.el-date-editor) {
  width: 280px;
}

.pol-field--node :deep(.el-select) {
  width: 230px;
}

.pol-field--market :deep(.el-radio-group) {
  width: 132px;
}

.pol-alert {
  border-radius: 8px;
}

.pol-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.pol-kpi {
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.pol-kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #5c6b76;
  font-size: var(--font-sm);
  font-weight: 650;
}

.pol-kpi-value {
  margin-top: 8px;
  color: #18212b;
  font-size: var(--font-22);
  font-weight: 760;
  line-height: 1.2;
}

.pol-kpi-unit {
  margin-top: 5px;
  color: #7a8793;
  font-size: var(--font-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pol-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.9fr);
  gap: 14px;
}

.pol-chart-sub {
  color: #64748b;
  font-size: var(--font-sm);
  white-space: nowrap;
}

.pol-table-card {
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.pol-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.pol-table-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #1f2a37;
  font-size: var(--font-15);
}

.pol-table-sub {
  color: #64748b;
  font-size: var(--font-sm);
}

.pol-pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.pol-table-card :deep(.el-table__row) {
  cursor: pointer;
}

@media (max-width: 1180px) {
  .pol-kpi-row,
  .pol-charts {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 760px) {
  .pol-hero,
  .pol-table-head {
    flex-direction: column;
    align-items: stretch;
  }

  .pol-hero__meta {
    justify-content: flex-start;
    min-width: 0;
  }

  .pol-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .pol-field :deep(.el-select),
  .pol-field :deep(.el-date-editor),
  .pol-field--market :deep(.el-radio-group),
  .pol-field--range :deep(.el-date-editor),
  .pol-field--node :deep(.el-select) {
    width: 100%;
  }

  .pol-kpi-row,
  .pol-charts {
    grid-template-columns: 1fr;
  }
}
</style>
