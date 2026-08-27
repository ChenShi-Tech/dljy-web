<script setup lang="ts">
// 云南披露明细：整年南网披露数据按日/周/月分页取数，以真实时序图为主视图。
// 所有请求固定 region=yunnan；行内 region 只是南网披露业务维度，不得与地区隔离键混用。
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, DatabaseZap, LineChart, TableProperties } from 'lucide-vue-next'
import DynamicTable from '@/components/common/DynamicTable.vue'
import { todayBeijing } from '@/utils/beijingDate'
import DataState from '@/components/common/DataState.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import { useEChart } from '@/composables/useEChart'
import { fetchCaptured } from '@/services/captured'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom, fmtNum } from '@/services/chart/chartOptions'
import { areaSeries, lineSeries, POWER, stepSeries, withAlpha } from '@/services/chart/chartStyle'
import { runDisclosureRequestPool } from '@/services/yunnan/disclosureRequestPool'
import {
  aggregateIntradayEnvelope,
  calculateDisclosureMape,
  dedupeInterProvincialForecastRows,
  disclosureRowDate,
  getDisclosurePeriodWindow,
  pairForecastActual,
  resolveDisclosureWindow,
  splitDisclosureWindow,
  shiftDisclosurePeriod,
  shiftDisclosureWindow,
  type DisclosureChartRow,
  type DisclosureGranularity
} from '@/services/yunnan/disclosureChart'

interface DisclosureRow extends DisclosureChartRow {
  id?: string
  apiFamily?: string
  module?: string
  sourceApi?: string
  operationFamily?: string
  status?: string
  metric?: string
  valuePrev?: number | null
  time?: string
  loadMWh?: number | null
  newEnergyMWh?: number | null
  hydropowerMWh?: number | null
}

interface Dataset {
  key: string
  label: string
  family: string
  pairKey?: string
  role?: 'forecast' | 'actual'
  unit: string
  price?: boolean
  supply?: boolean
}

const DATASETS: Array<{ group: string; items: Dataset[] }> = [
  {
    group: '官方 D-1 预测',
    items: [
      { key: 'load_forecast', label: '统调负荷预测（分区）', family: 'yn_system_forecast', pairKey: 'load_actual', role: 'forecast', unit: 'MW' },
      { key: 'new_energy_forecast_d1', label: '新能源出力预测（D-1 切片）', family: 'yn_system_forecast', pairKey: 'new_energy_actual', role: 'forecast', unit: 'MW' },
      { key: 'non_market_forecast', label: '非市场化机组出力预测', family: 'yn_system_forecast', pairKey: 'non_market_actual', role: 'forecast', unit: 'MW' },
      { key: 'total_generation_forecast', label: '全网总发电预测', family: 'yn_system_forecast', pairKey: 'total_generation_actual', role: 'forecast', unit: 'MW' },
      { key: 'inter_provincial_forecast', label: '省间断面送受电预测', family: 'yn_system_forecast', unit: 'MW' }
    ]
  },
  {
    group: '实际值',
    items: [
      { key: 'load_actual', label: '统调负荷实际（分区）', family: 'yn_system_forecast', pairKey: 'load_forecast', role: 'actual', unit: 'MW' },
      { key: 'new_energy_actual', label: '新能源出力实际', family: 'yn_system_forecast', pairKey: 'new_energy_forecast_d1', role: 'actual', unit: 'MW' },
      { key: 'hydro_actual', label: '水电出力实际', family: 'yn_system_forecast', unit: 'MW' },
      { key: 'non_market_actual', label: '非市场化机组出力实际', family: 'yn_system_forecast', pairKey: 'non_market_forecast', role: 'actual', unit: 'MW' },
      { key: 'total_generation_actual', label: '全网总发电实际', family: 'yn_system_forecast', pairKey: 'total_generation_forecast', role: 'actual', unit: 'MW' }
    ]
  },
  {
    group: '价格与供需',
    items: [
      { key: 'da_user_price', label: '日前用户侧统一电价（小时级）', family: 'yn_system_forecast', unit: '元/MWh', price: true },
      { key: 'rt_user_price', label: '实时用户侧统一电价（小时级）', family: 'yn_system_forecast', unit: '元/MWh', price: true },
      { key: 'yn_system_supply_demand', label: '云南系统供需实际（负荷/新能源/水电）', family: 'yn_system_supply', unit: 'MW', supply: true }
    ]
  }
]
const FLAT_DATASETS = DATASETS.flatMap((group) => group.items)

const REGION_LABELS: Record<string, string> = {
  all: '全区域', yn: '云南', gd: '广东', gx: '广西', gz: '贵州', hn: '海南'
}
const LABELS: Record<string, string> = {
  operateDate: '运行日', targetDate: '目标日', timePoint: '时点', metric: '指标',
  region: '地区/断面', value: '数值(MW·价格为元/MWh)', valuePrev: '上一快照值',
  date: '日期', time: '时点', loadMWh: '统调负荷(MW)', newEnergyMWh: '新能源出力(MW)',
  hydropowerMWh: '水电出力(MW)', area: '地区', product: '数据产品'
}
const MAX_ROWS = 8000
const EMPTY_TEXT = '所选数据集在该周期内无数据（云南严格地区·真实或空：请确认已执行 import:southern-export --write）'

const datasetKey = ref('load_forecast')
const granularity = ref<DisclosureGranularity>('day')
const dateFrom = ref('')
const dateTo = ref('')
const customWindow = ref(false)
const regionScope = ref<'yn_all' | 'all_regions'>('yn_all')
const loading = ref(false)
const errorMsg = ref('')
const rows = ref<DisclosureRow[]>([])
const pairedRows = ref<DisclosureRow[]>([])
const renderedWindow = ref<{ from: string; to: string; label: string } | null>(null)
const windowResolution = ref<ReturnType<typeof resolveDisclosureWindow> | null>(null)
interface CaptureFilterMeta {
  total: number
  returned: number
  truncated: boolean
}
const filterMeta = ref<{ main: CaptureFilterMeta | null; pair: CaptureFilterMeta | null }>({ main: null, pair: null })

const mainChartRef = ref<HTMLElement | null>(null)
const envelopeChartRef = ref<HTMLElement | null>(null)
const current = computed(() => FLAT_DATASETS.find((dataset) => dataset.key === datasetKey.value) ?? FLAT_DATASETS[0])
const isSupply = computed(() => current.value.supply === true)
const isPrice = computed(() => current.value.price === true)
// 与旧表格一致：断面和用户价没有省级 region 过滤，供需行形状也不使用该筛选。
const regionFilterable = computed(() => !isSupply.value && !['inter_provincial_forecast', 'da_user_price', 'rt_user_price'].includes(current.value.key))

const displayRows = computed(() => {
  let out = rows.value
  if (regionFilterable.value && regionScope.value === 'yn_all') {
    out = out.filter((row) => row.region === 'yn' || row.region === 'all')
  }
  // 保留原有展示层美化逻辑：只翻译 region，隐藏归一化管道字段。
  return out.map((row) => {
    const { id: _id, apiFamily: _apiFamily, module: _module, sourceApi: _sourceApi, operationFamily: _operationFamily, status: _status, ...rest } = row
    if (typeof rest.region === 'string' && REGION_LABELS[rest.region]) rest.region = REGION_LABELS[rest.region]
    return rest
  })
})

function rowDate(row: DisclosureRow): string | undefined {
  return disclosureRowDate(row)
}

const stats = computed(() => {
  const dates = rows.value.map(rowDate).filter((date): date is string => Boolean(date)).sort()
  return { rows: rows.value.length, dateMin: dates[0] ?? '—', dateMax: dates.at(-1) ?? '—' }
})

const periodLabel = computed(() => {
  if (!dateFrom.value || !dateTo.value) return '—'
  return granularity.value === 'day'
    ? dateFrom.value
    : granularity.value === 'month'
      ? dateFrom.value.slice(0, 7)
      : `${dateFrom.value} ~ ${dateTo.value}`
})
const visibleFrom = computed(() => renderedWindow.value?.from ?? dateFrom.value)
const visibleTo = computed(() => renderedWindow.value?.to ?? dateTo.value)

function regionText(region: string): string {
  if (REGION_LABELS[region]) return REGION_LABELS[region]
  return region.replaceAll('|', ' · ')
}

function dateInWindow(row: DisclosureRow): boolean {
  const date = rowDate(row)
  const window = renderedWindow.value
  return Boolean(date && (!window?.from || date >= window.from) && (!window?.to || date <= window.to))
}

function filterForKey(key: string, window: { from: string; to: string }) {
  const shift = key === 'new_energy_forecast_d1' ? -1 : 0
  return {
    dateFrom: addDays(window.from, shift),
    dateTo: addDays(window.to, shift),
    limit: MAX_ROWS,
    region: 'yunnan'
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

let loadSeq = 0
function summarizeFilterMeta(bodies: Array<{ _filter?: Partial<CaptureFilterMeta> }>): CaptureFilterMeta | null {
  const metas = bodies
    .map((body) => body?._filter)
    .filter((meta): meta is Partial<CaptureFilterMeta> => meta != null && typeof meta.total === 'number')
  if (!metas.length) return null
  return {
    total: metas.reduce((sum, meta) => sum + (meta.total ?? 0), 0),
    returned: metas.reduce((sum, meta) => sum + (meta.returned ?? 0), 0),
    truncated: metas.some((meta) => meta.truncated === true)
  }
}

interface DisclosureFetchPlan {
  dataset: Dataset
  chunks: Array<{ from: string; to: string; label: string }>
}

async function fetchDatasets(datasets: Dataset[], window: { from: string; to: string }, seq: number) {
  const plans: DisclosureFetchPlan[] = datasets.map((dataset) => ({
    dataset,
    chunks: splitDisclosureWindow(window.from, window.to, granularity.value)
  }))
  const jobs = plans.flatMap((plan) => plan.chunks.map((chunk) => () =>
    fetchCaptured<any>(plan.dataset.family, plan.dataset.key, filterForKey(plan.dataset.key, chunk))
  ))
  const bodies = await runDisclosureRequestPool(jobs, () => seq === loadSeq)
  if (seq !== loadSeq) return null
  let offset = 0
  return plans.map((plan) => {
    const planBodies = bodies.slice(offset, offset + plan.chunks.length).filter((body): body is any => body != null)
    offset += plan.chunks.length
    return {
      rows: planBodies.flatMap((body) => Array.isArray(body?.data) ? body.data : []) as DisclosureRow[],
      filter: summarizeFilterMeta(planBodies)
    }
  })
}

async function load() {
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  rows.value = []
  pairedRows.value = []
  filterMeta.value = { main: null, pair: null }
  renderedWindow.value = null
  windowResolution.value = null
  if (!dateFrom.value || !dateTo.value) {
    loading.value = false
    return
  }
  try {
    const selected = current.value
    const resolution = resolveDisclosureWindow(dateFrom.value, dateTo.value, granularity.value)
    const window = resolution.window
    renderedWindow.value = window
    windowResolution.value = resolution
    const results = await fetchDatasets(
      [selected, ...(selected.pairKey ? [{ ...selected, key: selected.pairKey }] : [])],
      window,
      seq
    )
    if (seq !== loadSeq) return
    if (!results) return
    const selectedResult = results[0]
    const pairedResult = results[1] ?? { rows: [] as DisclosureRow[], filter: null }
    rows.value = selectedResult.rows
    if (selected.key === 'inter_provincial_forecast') {
      rows.value = dedupeInterProvincialForecastRows(rows.value)
    }
    pairedRows.value = pairedResult.rows
    filterMeta.value = { main: selectedResult.filter, pair: pairedResult.filter }
  } catch (error) {
    if (seq !== loadSeq) return
    rows.value = []
    pairedRows.value = []
    errorMsg.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function datasetLabel(key?: string): string {
  return FLAT_DATASETS.find((dataset) => dataset.key === key)?.label ?? '配对数据'
}

const truncatedSides = computed(() => {
  const sides: string[] = []
  if (filterMeta.value.main?.truncated) sides.push(`当前数据「${current.value.label}」`)
  if (filterMeta.value.pair?.truncated) sides.push(`配对数据「${datasetLabel(current.value.pairKey)}」`)
  return sides
})

const truncationWarning = computed(() => {
  if (!truncatedSides.value.length) return ''
  const details = [
    filterMeta.value.main?.truncated ? `当前数据范围共 ${filterMeta.value.main.total} 行，返回 ${filterMeta.value.main.returned} 行` : '',
    filterMeta.value.pair?.truncated ? `配对数据范围共 ${filterMeta.value.pair.total} 行，返回 ${filterMeta.value.pair.returned} 行` : ''
  ].filter(Boolean).join('；')
  return `${truncatedSides.value.join('、')}仍被上限截断（${details}），图表数据不完整，请缩小日期范围`
})

const windowConvergenceWarning = computed(() => {
  const resolution = windowResolution.value
  if (!resolution?.constrained) return ''
  return `窗口过大，已收敛显示最近 ${resolution.retainedDays} 天，请用分页器浏览更早数据`
})

function rowValueMap(source: DisclosureRow[], region?: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const row of source) {
    if (region && row.region !== region) continue
    const date = rowDate(row)
    if (!date || !dateInWindow(row) || typeof row.timePoint !== 'string' || typeof row.value !== 'number') continue
    values.set(`${date} ${row.timePoint}`, row.value)
  }
  return values
}

function unionLabels(...maps: Map<string, number>[]): string[] {
  return [...new Set(maps.flatMap((map) => [...map.keys()]))].sort()
}

function dataForLabels(map: Map<string, number>, labels: string[]): Array<number | null> {
  return labels.map((label) => map.get(label) ?? null)
}

function selectedRegions(source: DisclosureRow[]): string[] {
  const values = [...new Set(source.map((row) => row.region).filter((region): region is string => Boolean(region)))]
  if (current.value.key === 'inter_provincial_forecast' && regionScope.value === 'yn_all') {
    return values.filter((region) => region.includes('云南'))
  }
  if (regionFilterable.value && regionScope.value === 'yn_all') return ['yn', 'all'].filter((region) => values.includes(region))
  return values
}

function pushDeviationSeries(series: Record<string, unknown>[], labels: string[], forecast: Map<string, number>, actual: Map<string, number>, region: string) {
  const lower = labels.map((label) => {
    const f = forecast.get(label); const a = actual.get(label)
    return f == null || a == null ? null : Math.min(f, a)
  })
  const width = labels.map((label) => {
    const f = forecast.get(label); const a = actual.get(label)
    return f == null || a == null ? null : Math.abs(f - a)
  })
  const stack = `deviation-${region}`
  series.push({ name: `${regionText(region)}偏差下界`, type: 'line', data: lower, stack, showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, tooltip: { show: false }, silent: true })
  series.push({ name: `${regionText(region)}偏差带`, type: 'line', data: width, stack, showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: withAlpha(POWER.deviation, 0.2) }, tooltip: { show: false }, silent: true })
}

function pairedSeriesOption(): Record<string, unknown> {
  const forecastRows = current.value.role === 'forecast' ? rows.value : pairedRows.value
  const actualRows = current.value.role === 'forecast' ? pairedRows.value : rows.value
  const regions = selectedRegions([...forecastRows, ...actualRows])
  const maps = regions.map((region) => ({ region, forecast: rowValueMap(forecastRows, region), actual: rowValueMap(actualRows, region) }))
  const labels = unionLabels(...maps.flatMap((item) => [item.forecast, item.actual]))
  const series: Record<string, unknown>[] = []
  for (const { region, forecast, actual } of maps) {
    if (!labels.length) continue
    series.push(lineSeries(`${regionText(region)}·预测`, dataForLabels(forecast, labels), POWER.forecast, { lineStyle: { color: POWER.forecast, type: 'dashed', width: 2 } }))
    series.push(lineSeries(`${regionText(region)}·实际`, dataForLabels(actual, labels), POWER.load, { lineStyle: { color: POWER.load, type: 'solid', width: 2.5 } }))
    pushDeviationSeries(series, labels, forecast, actual, region)
  }
  return { series, labels }
}

function groupedRows(source: DisclosureRow[]): Map<string, DisclosureRow[]> {
  const groups = new Map<string, DisclosureRow[]>()
  for (const row of source) {
    if (!dateInWindow(row) || typeof row.region !== 'string') continue
    const key = current.value.key === 'inter_provincial_forecast' ? `${row.region}|${row.metric ?? ''}` : row.region
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

function genericSeriesOption(): Record<string, unknown> {
  const groups = groupedRows(rows.value)
  const entries = [...groups.entries()].filter(([group]) => {
    const region = group.split('|')[0]
    return !(current.value.key === 'inter_provincial_forecast' && regionScope.value === 'yn_all' && !region.includes('云南'))
  })
  const allLabels = [...new Set(entries.flatMap(([, groupRows]) => groupRows.map((row) => {
    const date = rowDate(row)
    return date && row.timePoint ? `${date} ${row.timePoint}` : ''
  }).filter(Boolean)))].sort()
  const series: Record<string, unknown>[] = []
  for (const [group, groupRows] of entries) {
    const [region] = group.split('|')
    const values = new Map<string, number>()
    for (const row of groupRows) {
      const date = rowDate(row)
      if (!date || typeof row.timePoint !== 'string' || typeof row.value !== 'number') continue
      const key = `${date} ${row.timePoint}`
      // 同一断面+metric 的重复摄取行不是不同物理点；去重后仍保持最后一条覆盖，绝不求和。
      values.set(key, current.value.key === 'inter_provincial_forecast' ? row.value : (values.get(key) ?? 0) + row.value)
    }
    if (values.size) series.push(lineSeries(`${regionText(region)}${group.includes('|') && group.split('|')[1] ? ` · ${group.split('|')[1]}` : ''}`, dataForLabels(values, allLabels), POWER.hydro))
  }
  return { series, labels: allLabels }
}

function priceSeriesOption(): Record<string, unknown> {
  const groups = groupedRows(rows.value)
  const series: Record<string, unknown>[] = []
  const labels = new Set<string>()
  for (const [region, groupRows] of groups) {
    const values = rowValueMap(groupRows, region)
    if (!values.size) continue
    values.forEach((_, key) => labels.add(key))
    series.push(stepSeries(regionText(region), dataForLabels(values, [...labels].sort()), POWER.price, { step: 'end' }))
  }
  const xLabels = [...new Set([...groups.values()].flatMap((items) => items.map((row) => {
    const date = rowDate(row)
    return date && row.timePoint ? `${date} ${row.timePoint}` : ''
  }).filter(Boolean)))].sort()
  for (const item of series) {
    const region = Object.keys(REGION_LABELS).find((key) => item.name === REGION_LABELS[key]) ?? String(item.name)
    const values = rowValueMap(groups.get(region) ?? [], region)
    item.data = dataForLabels(values, xLabels)
  }
  return { series, labels: xLabels }
}

function supplySeriesOption(): Record<string, unknown> {
  const labels = [...new Set(rows.value.filter(dateInWindow).map((row) => row.date && row.time ? `${row.date} ${row.time}` : '').filter(Boolean))].sort()
  const valueFor = (field: 'loadMWh' | 'newEnergyMWh' | 'hydropowerMWh') => new Map(rows.value.filter(dateInWindow).map((row) => [row.date && row.time ? `${row.date} ${row.time}` : '', row[field]]).filter(([key, value]) => Boolean(key) && typeof value === 'number') as Array<[string, number]>)
  const load = valueFor('loadMWh'); const newEnergy = valueFor('newEnergyMWh'); const hydro = valueFor('hydropowerMWh')
  return {
    series: [
      lineSeries('统调负荷', dataForLabels(load, labels), POWER.load, { z: 3 }),
      areaSeries('新能源', dataForLabels(newEnergy, labels), POWER.newEnergy, { stack: 'supply', areaStyle: { color: withAlpha(POWER.newEnergy, 0.3) } }),
      areaSeries('水电', dataForLabels(hydro, labels), POWER.hydro, { stack: 'supply', areaStyle: { color: withAlpha(POWER.hydro, 0.3) } })
    ].filter((item) => Array.isArray(item.data) && item.data.some((value) => value != null)),
    labels
  }
}

function buildMainOption(): Record<string, unknown> {
  const content = current.value.supply
    ? supplySeriesOption()
    : current.value.pairKey
      ? pairedSeriesOption()
      : current.value.price
        ? priceSeriesOption()
        : genericSeriesOption()
  const series = content.series as Record<string, unknown>[]
  return {
    tooltip: axisTooltip({ unit: current.value.unit, digits: current.value.price ? 2 : 0 }),
    toolbox: chartToolbox(`云南披露-${current.value.key}`),
    legend: { top: 4, type: 'scroll', data: series.filter((item) => !String(item.name).includes('偏差')).map((item) => item.name) },
    grid: { left: 66, right: 22, top: 38, bottom: 42 },
    dataZoom: insideZoom(),
    xAxis: { type: 'category', data: content.labels, boundaryGap: false },
    yAxis: { type: 'value', name: current.value.unit, scale: true },
    series,
    ...emptyOverlay(!series.length, EMPTY_TEXT)
  }
}

function buildEnvelopeOption(): Record<string, unknown> {
  const source = rows.value.filter(dateInWindow)
  const all = source.some((row) => row.region === 'all') ? source.filter((row) => row.region === 'all') : source
  const envelope = aggregateIntradayEnvelope(all.map((row) => ({ date: rowDate(row), timePoint: row.timePoint, region: row.region, value: row.value })))
  const labels = envelope.map((point) => point.timePoint)
  const min = envelope.map((point) => point.min)
  const band = envelope.map((point) => point.max - point.min)
  const mean = envelope.map((point) => point.mean)
  const series = envelope.length ? [
    { name: '包络下界', type: 'line', data: min, stack: 'envelope', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    { name: '日内 min~max', type: 'line', data: band, stack: 'envelope', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: withAlpha(POWER.price, 0.18) }, tooltip: { show: false }, silent: true },
    lineSeries('跨天均值', mean, POWER.price)
  ] : []
  return {
    title: { text: '日内形态均值包络（跨天 min / mean / max）', left: 0, textStyle: { fontSize: 13, fontWeight: 600 } },
    tooltip: axisTooltip({ unit: current.value.unit, digits: 2 }),
    legend: { top: 4, right: 0, data: ['跨天均值', '日内 min~max'] },
    grid: { left: 66, right: 22, top: 34, bottom: 30 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', name: current.value.unit, scale: true },
    series,
    ...emptyOverlay(!series.length, EMPTY_TEXT)
  }
}

const mapeKpi = computed(() => {
  if (!current.value.pairKey) return null
  const forecast = current.value.role === 'forecast' ? rows.value : pairedRows.value
  const actual = current.value.role === 'forecast' ? pairedRows.value : rows.value
  const pairs = pairForecastActual(forecast.filter(dateInWindow), actual.filter(dateInWindow))
  return { value: truncatedSides.value.length ? null : calculateDisclosureMape(pairs), points: pairs.length, incomplete: truncatedSides.value.length > 0 }
})

const mainChart = useEChart(mainChartRef, { render: renderCharts })
const envelopeChart = useEChart(envelopeChartRef, { render: renderCharts })

function renderCharts() {
  mainChart.setOption(buildMainOption(), { notMerge: true })
  if (isPrice.value) envelopeChart.setOption(buildEnvelopeOption(), { notMerge: true })
}

function applyWindow(window: { from: string; to: string }, custom = false) {
  customWindow.value = custom
  dateFrom.value = window.from
  dateTo.value = window.to
}

function movePeriod(direction: -1 | 1) {
  if (!dateFrom.value || !dateTo.value) return
  const baseWindow = windowResolution.value?.constrained && renderedWindow.value
    ? renderedWindow.value
    : { from: dateFrom.value, to: dateTo.value, label: periodLabel.value }
  const next = customWindow.value
    ? shiftDisclosureWindow(baseWindow.from, baseWindow.to, granularity.value, direction)
    : shiftDisclosurePeriod(baseWindow, granularity.value, direction)
  applyWindow(next, customWindow.value)
}

function onGranularityChanged() {
  if (!dateFrom.value) return
  applyWindow(getDisclosurePeriodWindow(dateFrom.value, granularity.value), false)
}

function onDateChanged() {
  customWindow.value = true
}

watch([datasetKey, dateFrom, dateTo], load)
watch([rows, pairedRows, regionScope, dateFrom, dateTo], renderCharts, { flush: 'post' })

onMounted(async () => {
  try {
    const probe = await fetchCaptured<any>(current.value.family, current.value.key, { limit: 1, region: 'yunnan' })
    const latest = (Array.isArray(probe?.data) ? probe.data : []).map((row: DisclosureRow) => rowDate(row)).filter(Boolean).sort().at(-1)
    if (latest) {
      applyWindow(getDisclosurePeriodWindow(latest, granularity.value))
      return
    }
  } catch { /* 历史包或空库探测失败时仍诚实回退到浏览器日期，后端缺数据即空态。 */ }
  const today = todayBeijing()
  applyWindow(getDisclosurePeriodWindow(today, granularity.value))
})
</script>

<template>
  <div class="disclosure-panel">
    <RegionDataBanner />
    <section class="dp-hero">
      <div class="dp-hero-main">
        <h2><DatabaseZap :size="18" /> 披露明细 · 南网整年真实数据</h2>
        <p>官方 D-1 预测 / 实际值 / 用户侧电价 / 系统供需——13 个数据集统一按周期浏览，云南严格真实或空。</p>
      </div>
      <DataBasisBadge basis="captured" />
    </section>

    <section class="dp-toolbar">
      <el-select v-model="datasetKey" placeholder="选择数据集" style="width: 300px">
        <el-option-group v-for="group in DATASETS" :key="group.group" :label="group.group">
          <el-option v-for="dataset in group.items" :key="dataset.key" :label="dataset.label" :value="dataset.key" />
        </el-option-group>
      </el-select>
      <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="起始日" style="width: 150px" @change="onDateChanged" />
      <span class="dp-sep">~</span>
      <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="截止日" style="width: 150px" @change="onDateChanged" />
      <el-radio-group v-model="granularity" size="small" @change="onGranularityChanged">
        <el-radio-button value="day">日</el-radio-button>
        <el-radio-button value="week">周</el-radio-button>
        <el-radio-button value="month">月</el-radio-button>
      </el-radio-group>
      <el-radio-group v-if="regionFilterable" v-model="regionScope" size="small">
        <el-radio-button value="yn_all">云南+全区域</el-radio-button>
        <el-radio-button value="all_regions">全部地区</el-radio-button>
      </el-radio-group>
      <div class="dp-pager">
        <el-button text :disabled="loading || !dateFrom" title="上一周期" @click="movePeriod(-1)"><ChevronLeft :size="16" /> 上一周期</el-button>
        <span class="dp-period">{{ periodLabel }}</span>
        <el-button text :disabled="loading || !dateTo" title="下一周期" @click="movePeriod(1)">下一周期 <ChevronRight :size="16" /></el-button>
      </div>
      <span class="dp-stats">
        {{ stats.rows }} 行 · {{ stats.dateMin }} ~ {{ stats.dateMax }}
        <template v-if="truncatedSides.length">
          · <b class="dp-trunc">已截断：{{ truncatedSides.join('、') }}，请缩小日期范围</b>
        </template>
      </span>
    </section>

    <DataState :loading="loading" :error="errorMsg">
      <section class="dp-chart-card">
        <div class="dp-chart-head">
          <div>
            <h3><LineChart :size="16" /> {{ current.label }}</h3>
            <span class="dp-chart-sub">{{ visibleFrom }} ~ {{ visibleTo }} · captured 真实回放 · 不做平滑</span>
          </div>
          <div v-if="mapeKpi" class="dp-kpi">本周期 MAPE <b>{{ mapeKpi.incomplete ? '—（数据不完整）' : mapeKpi.value == null ? '—' : `${fmtNum(mapeKpi.value, 2)}%` }}</b> · {{ mapeKpi.points }} 个配对点</div>
        </div>
        <p v-if="windowConvergenceWarning" class="dp-trunc-warning">⚠ {{ windowConvergenceWarning }}</p>
        <p v-if="truncationWarning" class="dp-trunc-warning">⚠ {{ truncationWarning }}；本周期 MAPE 已停用。</p>
        <div ref="mainChartRef" class="dp-chart dp-main-chart" />
        <div v-if="isPrice" ref="envelopeChartRef" class="dp-chart dp-envelope-chart" />
        <p v-if="!loading && !errorMsg && !rows.length" class="dp-empty-note">{{ EMPTY_TEXT }}</p>
      </section>
    </DataState>

    <details class="dp-table-wrap">
      <summary><TableProperties :size="16" /> 查看明细表（每页 20 行）</summary>
      <section class="dp-table-card">
        <div class="dp-table-head">
          <h3>{{ current.label }} · 明细</h3>
          <span class="dp-table-sub">{{ visibleFrom }} ~ {{ visibleTo }} · {{ loading ? '加载中，暂不可导出' : 'CSV 导出可用' }}</span>
        </div>
        <DynamicTable :rows="displayRows" :labels="LABELS" :page-size="20" :exportable="!loading" :export-name="`yn-disclosure-${current.key}`" />
      </section>
    </details>
  </div>
</template>

<style scoped>
.disclosure-panel { display: flex; flex-direction: column; gap: 14px; }
.dp-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border: 1px solid var(--border, #dfe7eb); border-radius: 12px; background: var(--panel, #fff); }
.dp-hero-main h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: var(--font-xl); }
.dp-hero-main p { margin: 0; color: var(--text-2, #6b7a85); font-size: var(--font-md); }
.dp-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--border, #dfe7eb); border-radius: 12px; background: var(--panel, #fff); }
.dp-sep { color: var(--text-2, #8a99a5); }
.dp-pager { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.dp-pager .el-button { display: inline-flex; align-items: center; gap: 3px; }
.dp-period { min-width: 112px; text-align: center; color: var(--text, #27343b); font-size: var(--font-12-5); font-variant-numeric: tabular-nums; }
.dp-stats { color: var(--text-2, #6b7a85); font-size: var(--font-12-5); }
.dp-trunc { color: #c96a00; }
.dp-chart-card, .dp-table-card { padding: 14px 16px; border: 1px solid var(--border, #dfe7eb); border-radius: 12px; background: var(--panel, #fff); }
.dp-chart-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dp-chart-head h3, .dp-table-head h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: var(--font-15); }
.dp-chart-sub, .dp-table-sub { display: block; margin-top: 4px; color: var(--text-2, #6b7a85); font-size: var(--font-12-5); }
.dp-kpi { padding: 7px 10px; border-radius: 8px; background: color-mix(in srgb, var(--primary, #0f9d8a) 9%, transparent); color: var(--text-2, #6b7a85); font-size: var(--font-12-5); }
.dp-kpi b { color: var(--primary, #0f9d8a); font-size: var(--font-15); }
.dp-trunc-warning { margin: 10px 0 0; padding: 9px 11px; border: 1px solid color-mix(in srgb, #c96a00 35%, var(--border, #dfe7eb)); border-radius: 8px; background: color-mix(in srgb, #c96a00 8%, transparent); color: #a65300; font-size: var(--font-12-5); }
.dp-chart { width: 100%; height: 390px; }
.dp-envelope-chart { height: 250px; margin-top: 8px; border-top: 1px solid var(--border, #edf1f3); }
.dp-empty-note { margin: -12px 0 0; color: var(--text-2, #6b7a85); text-align: center; font-size: var(--font-md); }
.dp-table-wrap { overflow: hidden; border: 1px solid var(--border, #dfe7eb); border-radius: 12px; background: var(--panel, #fff); }
.dp-table-wrap summary { display: flex; align-items: center; gap: 7px; padding: 13px 16px; cursor: pointer; color: var(--text, #27343b); font-size: var(--font-lg); font-weight: 600; list-style-position: inside; }
.dp-table-wrap summary::marker { color: var(--primary, #0f9d8a); }
.dp-table-card { border: 0; border-top: 1px solid var(--border, #dfe7eb); border-radius: 0; }
.dp-table-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
@media (max-width: 900px) { .dp-pager { width: 100%; margin-left: 0; justify-content: space-between; } .dp-stats { width: 100%; } }
@media (max-width: 768px) { .dp-hero { flex-direction: column; } .dp-chart-head { flex-direction: column; } .dp-chart { height: 330px; } }
</style>
