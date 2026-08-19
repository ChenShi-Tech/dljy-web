<script setup lang="ts">
// 云南电厂出力分析面板（xhjy/yunnan/plant-output）。
// 数据只读 yn_plant_output（plant_integrated_power_forecast_actual.csv 归一化后 /api/real 回放）。
// 图表纪律：actual/plan/forecast 一律阶梯线，smooth=false，connectNulls=false；MOCK 只提示不上屏。
import { computed, onMounted, ref } from 'vue'
import { Activity, AlertTriangle, Factory, Gauge, TableProperties } from 'lucide-vue-next'
import ChartCard from '@/components/common/ChartCard.vue'
import DataQualityBadge from '@/components/common/DataQualityBadge.vue'
import DataState from '@/components/common/DataState.vue'
import DynamicTable from '@/components/common/DynamicTable.vue'
import SpotSkeleton from '@/components/common/SpotSkeleton.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import SpotFilterBar from '@/components/spot/SpotFilterBar.vue'
import { usePlantUnitFilter } from '@/composables/usePlantUnitFilter'
import { onRegionChange } from '@/composables/useRegionReload'
import { onSelectionChange, useSpotSelection } from '@/composables/useSpotSelection'
import { chartChrome } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay, fmtNum, insideZoom } from '@/services/chart/chartOptions'
import {
  POWER,
  animation,
  barSeries,
  catAxis,
  grid,
  legend,
  palette,
  signColorItem,
  stepSeries,
  tooltipStyle,
  valueAxis
} from '@/services/chart/chartStyle'
import type { DataSourceBasis } from '@/services/data/types'
import {
  ALL_PLANTS,
  ALL_UNITS,
  PLANT_OUTPUT_FAMILY,
  PLANT_OUTPUT_PRIVATE_FAMILIES,
  availableForecastTypes,
  buildPlantOutputSeries,
  detectPlantOutputAnomalies,
  loadPlantOutputPayload,
  summarizePlantOutput,
  type CapturedEnvelopeMeta,
  type PlantDimRow,
  type PlantOutputAggregation,
  type PlantOutputRow,
  type PlantOutputSeries
} from '@/services/market/plantOutputClient'

type DateRange = [string, string]
type Aggregation = Exclude<PlantOutputAggregation, 'slot'>
type ComparisonGroup = { key: string; label: string; rows: readonly PlantOutputRow[] }

const DEFAULT_DATE_RANGE: DateRange = ['2026-05-01', '2026-05-31']
const AGG_OPTIONS: { value: Aggregation; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' }
]

const spotSelection = useSpotSelection()
const initialSelection = spotSelection.snapshot()

const dateRange = ref<DateRange>(initialDateRange())
const aggregation = ref<Aggregation>('day')
const selectedPlant = ref<string>(initialSelection.plant || ALL_PLANTS)
const selectedPlants = ref<string[]>(selectedPlant.value === ALL_PLANTS ? [ALL_PLANTS] : [selectedPlant.value])
const selectedUnit = ref<string>(initialSelection.unit || ALL_UNITS)
const forecastType = ref('')
const deviationPctThreshold = ref(10)
const deviationMwThreshold = ref(20)

const rows = ref<PlantOutputRow[]>([])
const plants = ref<PlantDimRow[]>([])
const loading = ref(false)
// reloadAll 版本守卫：快速切日期/地区时旧响应丢弃，防覆盖新（#405 同族，#488）
const reloadSeq = ref(0)
const errorMsg = ref('')
const ingestHint = ref(false)
const meta = ref<CapturedEnvelopeMeta>({ hasRealData: false, mock: false, sourceType: '', updatedAt: null })

const {
  plantOptions,
  unitOptions,
  filteredRows: singleFilteredRows,
  unitLabel,
  ensureSelections: ensureSingleSelections
} = usePlantUnitFilter<PlantOutputRow>({
  rows,
  plants,
  selectedPlant,
  selectedUnit
})

function initialDateRange(): DateRange {
  const [from, to] = normalizeDateRangeValue(initialSelection.dateRange)
  if (from === DEFAULT_DATE_RANGE[0] && to === DEFAULT_DATE_RANGE[0]) return [...DEFAULT_DATE_RANGE]
  return [from, to]
}

function normalizeDateRangeValue(value: unknown): DateRange {
  if (Array.isArray(value) && value.length >= 2) {
    const from = String(value[0] || DEFAULT_DATE_RANGE[0])
    const to = String(value[1] || from)
    return from <= to ? [from, to] : [to, from]
  }
  return [...DEFAULT_DATE_RANGE]
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

function plantOf(row: PlantOutputRow): string {
  return clean(row.standardPlant) || clean(row.plant)
}

function unitOf(row: PlantOutputRow): string {
  return clean(row.unitName) || '厂站汇总'
}

function sameRange(a: DateRange, b: DateRange): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function rowMatchesPlant(row: PlantOutputRow, plant: string): boolean {
  return row.plant === plant || row.standardPlant === plant
}

function sortCn(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function normalizeSelectedPlants(values: string[], previous: string[] = selectedPlants.value): string[] {
  const valid = new Set(plantOptions.value)
  const next = Array.from(new Set(values.filter(Boolean)))
  if (!next.length) return [ALL_PLANTS]
  const nonAll = next.filter((value) => value !== ALL_PLANTS)
  if (next.includes(ALL_PLANTS)) {
    if (previous.includes(ALL_PLANTS) && nonAll.length) {
      return valid.size ? nonAll.filter((value) => valid.has(value)) : nonAll
    }
    return [ALL_PLANTS]
  }
  if (!valid.size) return nonAll.length ? nonAll : [ALL_PLANTS]
  const filtered = nonAll.filter((value) => valid.has(value))
  return filtered.length ? filtered : [ALL_PLANTS]
}

function syncSelectedPlantForComposable() {
  const normalized = normalizeSelectedPlants(selectedPlants.value)
  selectedPlants.value = normalized
  selectedPlant.value = normalized.length === 1 ? normalized[0] : ALL_PLANTS
}

function isEmptyResultError(message: string): boolean {
  return /未摄取|no data|暂无数据|not found|capture family not found|no captured file|404|空/i.test(message)
}

const selectedPlantValues = computed(() => {
  const normalized = normalizeSelectedPlants(selectedPlants.value)
  return normalized.includes(ALL_PLANTS) ? [] : normalized
})

const filteredRows = computed(() => {
  const selected = selectedPlantValues.value
  if (selected.length <= 1) return singleFilteredRows.value
  const set = new Set(selected)
  return rows.value.filter((row) => set.has(plantOf(row)) && (selectedUnit.value === ALL_UNITS || unitOf(row) === selectedUnit.value))
})

const forecastOptions = computed(() => availableForecastTypes(filteredRows.value))
const aggregationLabel = computed(() => AGG_OPTIONS.find((item) => item.value === aggregation.value)?.label ?? '按日')
const dateRangeLabel = computed(() => `${dateRange.value[0]} ~ ${dateRange.value[1]}`)

const plantLabel = computed(() => {
  const selected = selectedPlantValues.value
  if (!selected.length) return '全部电厂'
  if (selected.length <= 2) return selected.join('、')
  return `${selected[0]}等 ${selected.length} 个电厂`
})

const targetLabel = computed(() => series.value.targetKind === 'plan' ? '计划' : '预测')

function aggregateGroup(): ComparisonGroup {
  return {
    key: 'aggregate',
    label: `${plantLabel.value} · ${unitLabel.value}`,
    rows: filteredRows.value
  }
}

function groupRowsBy(rowsForGroup: readonly PlantOutputRow[], keyOf: (row: PlantOutputRow) => string): ComparisonGroup[] {
  const map = new Map<string, PlantOutputRow[]>()
  for (const row of rowsForGroup) {
    const key = keyOf(row)
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return sortCn(Array.from(map.keys())).map((key) => ({ key, label: key, rows: map.get(key) ?? [] }))
}

const comparisonGroups = computed<ComparisonGroup[]>(() => {
  const base = filteredRows.value
  if (!base.length) return []
  const selected = selectedPlantValues.value
  if (selected.length > 1) {
    return selected
      .map((plant) => ({ key: `plant:${plant}`, label: plant, rows: base.filter((row) => rowMatchesPlant(row, plant)) }))
      .filter((group) => group.rows.length)
  }
  if (selected.length === 1 && selectedUnit.value === ALL_UNITS) {
    const byUnit = groupRowsBy(base, unitOf)
    return byUnit.length > 1 ? byUnit : [aggregateGroup()]
  }
  if (!selected.length && selectedUnit.value !== ALL_UNITS) {
    const byPlant = groupRowsBy(base, plantOf)
    return byPlant.length > 1 ? byPlant : [aggregateGroup()]
  }
  return [aggregateGroup()]
})

const series = computed(() => buildPlantOutputSeries(filteredRows.value, forecastType.value || undefined, aggregation.value))

const comparisonSeries = computed(() =>
  comparisonGroups.value.map((group) => {
    const itemSeries = buildPlantOutputSeries(group.rows, forecastType.value || undefined, aggregation.value)
    return {
      ...group,
      series: itemSeries,
      anomalies: detectPlantOutputAnomalies(itemSeries, {
        deviationPct: deviationPctThreshold.value,
        deviationMw: deviationMwThreshold.value
      }, comparisonGroups.value.length > 1 ? group.label : undefined)
    }
  })
)

const anomalies = computed(() => {
  if (comparisonSeries.value.length > 1) return comparisonSeries.value.flatMap((item) => item.anomalies)
  return detectPlantOutputAnomalies(series.value, {
    deviationPct: deviationPctThreshold.value,
    deviationMw: deviationMwThreshold.value
  })
})

const summary = computed(() => summarizePlantOutput(series.value, anomalies.value))
const hasData = computed(() => meta.value.hasRealData && !meta.value.mock && filteredRows.value.length > 0 && summary.value.pointCount > 0)

const qualityBasis = computed<DataSourceBasis | null>(() => {
  if (meta.value.hasRealData && !meta.value.mock) return 'captured'
  if (meta.value.mock) return 'synthetic'
  return null
})

const qualityCompleteness = computed(() => {
  const groups = comparisonSeries.value
  const expected = groups.reduce((sum, item) => sum + item.series.times.length, 0)
  if (!expected) return null
  const actual = groups.reduce((sum, item) => sum + item.series.actual.filter((value) => value !== null).length, 0)
  return actual / expected
})

const qualityNote = computed(() => `${aggregationLabel.value} · ${filteredRows.value.length} 行`)
const emptyText = computed(() => meta.value.mock ? '模拟数据已拦截，未上屏' : '该筛选条件暂无真实出力序列')

const kpis = computed(() => [
  { label: '实际均值', value: summary.value.actualAvg, unit: 'MW', icon: Activity },
  { label: `${targetLabel.value}均值`, value: summary.value.targetAvg, unit: 'MW', icon: Factory },
  { label: '平均完成率', value: summary.value.completionAvg, unit: '%', icon: Gauge },
  { label: '最大绝对偏差', value: summary.value.maxAbsDeviation, unit: 'MW', icon: AlertTriangle }
])

const anomalyLabels: Record<string, string> = {
  group: '对比对象',
  timePoint: '聚合时段',
  actualMwText: '实际(MW)',
  targetMwText: '目标(MW)',
  deviationMwText: '偏差(MW)',
  deviationPctText: '偏差率(%)',
  completionPctText: '完成率(%)'
}

const anomalyRows = computed<Record<string, unknown>[]>(() =>
  anomalies.value.map((row) => ({
    ...(row.groupLabel ? { group: row.groupLabel } : {}),
    timePoint: row.timePoint,
    actualMwText: fmtNum(row.actualMw, 2),
    targetMwText: fmtNum(row.targetMw, 2),
    deviationMwText: fmtNum(row.deviationMw, 2),
    deviationPctText: fmtNum(row.deviationPct, 1),
    completionPctText: fmtNum(row.completionPct, 1)
  }))
)

function ensureSelections() {
  syncSelectedPlantForComposable()
  ensureSingleSelections()
  if (!forecastType.value || !forecastOptions.value.includes(forecastType.value)) {
    forecastType.value = forecastOptions.value[0] ?? ''
  }
}

function syncSpotSelection(includeDate = false) {
  const selected = selectedPlantValues.value
  spotSelection.setSelection({
    ...(includeDate ? { dateRange: dateRange.value, date: dateRange.value[1] } : {}),
    plant: selected.length === 1 ? selected[0] : ALL_PLANTS,
    unit: selectedUnit.value
  })
}

async function reloadAll() {
  const seq = ++reloadSeq.value
  loading.value = true
  errorMsg.value = ''
  ingestHint.value = false
  try {
    const payload = await loadPlantOutputPayload(dateRange.value)
    if (seq !== reloadSeq.value) return // 新轮已发起，丢弃旧响应（#405 同族，#488）
    rows.value = payload.rows
    plants.value = payload.plants
    meta.value = payload.meta
    ensureSelections()
    if (payload.meta.mock) {
      ingestHint.value = false
    } else if (!payload.rows.length) {
      ingestHint.value = true
    }
    if (payload.meta.error && !isEmptyResultError(payload.meta.error)) {
      errorMsg.value = payload.meta.error
    }
  } catch (error) {
    if (seq !== reloadSeq.value) return // 旧轮的错误不覆盖新轮（#405）
    rows.value = []
    plants.value = []
    const message = error instanceof Error ? error.message : '加载失败'
    if (isEmptyResultError(message)) ingestHint.value = true
    else errorMsg.value = message
  } finally {
    if (seq === reloadSeq.value) loading.value = false // 只有最新轮才关 loading（#405）
  }
}

function onDateRangeChange(value: unknown) {
  dateRange.value = normalizeDateRangeValue(value)
  syncSpotSelection(true)
  void reloadAll()
}

function onPlantsChange(value: unknown) {
  const values = Array.isArray(value) ? value.map((item) => String(item)) : []
  selectedPlants.value = normalizeSelectedPlants(values, selectedPlants.value)
  ensureSelections()
  syncSpotSelection()
}

function onUnitChange(value: unknown) {
  selectedUnit.value = typeof value === 'string' && value ? value : ALL_UNITS
  ensureSelections()
  syncSpotSelection()
}

function onAggregationChange(value: unknown) {
  if (value === 'day' || value === 'week' || value === 'month') {
    aggregation.value = value
  }
}

function onForecastTypeChange(value: unknown) {
  forecastType.value = typeof value === 'string' ? value : ''
  ensureSelections()
}

function onThresholdChange() {
  ensureSelections()
}

function formatMetric(value: number | null | undefined, unit: string, digits = 1) {
  if (value === null || value === undefined) return '—'
  return `${fmtNum(value, digits)} ${unit}`
}

function axisLabels(): string[] {
  return series.value.times
}

function formatAxisLabel(value: string): string {
  const text = String(value)
  if (aggregation.value === 'day') return text.slice(5)
  return text
}

function alignSeries(item: PlantOutputSeries, values: Array<number | null>): Array<number | null> {
  const byTime = new Map(item.times.map((time, index) => [time, values[index] ?? null]))
  return axisLabels().map((time) => byTime.get(time) ?? null)
}

function anomalyMarkArea() {
  const axis = axisLabels()
  const seen = new Set<string>()
  const data: Array<[{ xAxis: string }, { xAxis: string }]> = []
  for (const row of anomalies.value) {
    if (seen.has(row.timePoint)) continue
    seen.add(row.timePoint)
    const index = axis.indexOf(row.timePoint)
    const end = index >= 0 ? axis[Math.min(index + 1, axis.length - 1)] : row.timePoint
    data.push([{ xAxis: row.timePoint }, { xAxis: end }])
    if (data.length >= 48) break
  }
  if (!data.length) return undefined
  return {
    silent: true,
    itemStyle: { color: 'rgba(220, 38, 38, 0.08)' },
    data
  }
}

// 主图 anomalyMarkArea 最多高亮 48 段（见上），去重异常时点超此数即截断——供表头提示避免误读（#473）
const anomalyMarkAreaTruncated = computed(() => {
  const seen = new Set<string>()
  for (const row of anomalies.value) seen.add(row.timePoint)
  return seen.size > 48
})

function buildOutputOption() {
  const cc = chartChrome()
  const empty = !hasData.value
  const colors = palette()
  const groups = comparisonSeries.value.length ? comparisonSeries.value : [{ label: plantLabel.value, series: series.value }]
  const multi = groups.length > 1
  const chartSeries = groups.flatMap((item, index) => {
    const baseColor = colors[index % colors.length]
    const actualColor = multi ? baseColor : POWER.newEnergy
    const planColor = multi ? baseColor : POWER.forecast
    const forecastColor = multi ? baseColor : POWER.price
    const prefix = multi ? `${item.label} · ` : ''
    return [
      stepSeries(`${prefix}实际 · ${item.series.actualSource}`, alignSeries(item.series, item.series.actual), actualColor, {
        step: 'end',
        connectNulls: false,
        lineStyle: { width: multi ? 1.9 : 2.4, color: actualColor, type: 'solid' },
        markArea: index === 0 ? anomalyMarkArea() : undefined
      }),
      stepSeries(`${prefix}计划 · ${item.series.targetKind === 'plan' ? item.series.targetSource : '未命中'}`, alignSeries(item.series, item.series.plan), planColor, {
        step: 'end',
        connectNulls: false,
        lineStyle: { width: multi ? 1.4 : 1.8, color: planColor, type: 'dashed', opacity: multi ? 0.58 : 1 }
      }),
      stepSeries(`${prefix}预测 · ${item.series.forecastSource}`, alignSeries(item.series, item.series.forecast), forecastColor, {
        step: 'end',
        connectNulls: false,
        lineStyle: { width: multi ? 1.4 : 1.8, color: forecastColor, type: 'dashed', opacity: multi ? 0.82 : 1 }
      })
    ]
  })
  return {
    tooltip: { ...axisTooltip({ unit: 'MW', digits: 2 }), ...tooltipStyle(), confine: true },
    toolbox: chartToolbox('云南电厂出力实际计划预测'),
    legend: legend({ top: 2, right: 92 }),
    grid: grid({ legend: true, zoom: true, right: 24 }),
    dataZoom: insideZoom(),
    ...animation(),
    xAxis: catAxis(axisLabels(), {
      boundaryGap: false,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        formatter: formatAxisLabel
      }
    }),
    yAxis: valueAxis('MW', { scale: true }),
    series: chartSeries,
    ...emptyOverlay(empty, emptyText.value)
  }
}

function buildDeviationOption() {
  const completionColor = '#2563eb'
  const empty = !hasData.value
  return {
    tooltip: {
      ...axisTooltip({
        units: { 偏差: 'MW', 完成率: '%' },
        digits: 2
      }),
      ...tooltipStyle(),
      confine: true
    },
    toolbox: chartToolbox('云南电厂出力偏差完成率'),
    legend: legend({ top: 2, right: 92 }),
    grid: grid({ legend: true, zoom: true, right: 52 }),
    dataZoom: insideZoom(),
    ...animation(),
    xAxis: catAxis(series.value.times, {
      axisLabel: { fontSize: 10, formatter: formatAxisLabel }
    }),
    yAxis: [
      valueAxis('MW', { scale: true }),
      valueAxis('%', {
        scale: true,
        axisLabel: { formatter: '{value}%' },
        splitLine: { show: false }
      })
    ],
    series: [
      barSeries('偏差', series.value.deviation, undefined, {
        itemStyle: signColorItem(),
        barMaxWidth: 18
      }),
      stepSeries('完成率', series.value.completion, completionColor, {
        yAxisIndex: 1,
        step: 'end',
        connectNulls: false,
        lineStyle: { width: 1.8, color: completionColor, type: 'solid' }
      })
    ],
    ...emptyOverlay(empty, '暂无可计算的完成率/偏差')
  }
}

onSelectionChange(
  ({ selection, changed }) => {
    let shouldReload = false
    if (changed.includes('dateRange') || changed.includes('date')) {
      const nextRange = changed.includes('dateRange')
        ? normalizeDateRangeValue(selection.dateRange)
        : normalizeDateRangeValue([selection.date, selection.date])
      if (!sameRange(nextRange, dateRange.value)) {
        dateRange.value = nextRange
        shouldReload = true
      }
    }
    if (changed.includes('plant')) {
      const nextPlants = selection.plant === ALL_PLANTS ? [ALL_PLANTS] : [selection.plant]
      if (!sameStringArray(nextPlants, selectedPlants.value)) {
        selectedPlants.value = nextPlants
      }
    }
    if (changed.includes('unit') && selection.unit !== selectedUnit.value) {
      selectedUnit.value = selection.unit || ALL_UNITS
    }
    ensureSelections()
    if (shouldReload) void reloadAll()
  },
  { fields: ['date', 'dateRange', 'plant', 'unit'] }
)

onMounted(() => {
  syncSpotSelection(true)
  void reloadAll()
})

onRegionChange(() => {
  void reloadAll()
})
</script>

<template>
  <div class="plant-output-panel">
    <RegionDataBanner :families="PLANT_OUTPUT_PRIVATE_FAMILIES" />

    <section class="po-hero">
      <div>
        <div class="po-kicker"><Factory :size="16" /><span>云南 · 电厂出力分析</span></div>
        <p>实际出力、计划/预测出力、完成率、偏差和异常时段按日期范围与日/周/月粒度聚合展示，支持多电厂与机组对比。</p>
      </div>
      <DataQualityBadge
        :basis="qualityBasis"
        :updated-at="meta.updatedAt"
        cadence="monthly"
        :completeness="qualityCompleteness"
        :source="meta.sourceType || PLANT_OUTPUT_FAMILY"
        :note="qualityNote"
      />
    </section>

    <SpotFilterBar
      date-mode="range"
      :date-range="dateRange"
      plant-mode="multiple"
      :plants="selectedPlants"
      :plant-options="plantOptions"
      show-unit
      :unit="selectedUnit"
      :unit-options="unitOptions"
      show-refresh
      :loading="loading"
      refresh-label="刷新"
      @update:date-range="onDateRangeChange"
      @update:plants="onPlantsChange"
      @update:unit="onUnitChange"
      @refresh="reloadAll"
    >
      <template #after-unit>
        <label class="po-field po-field--radio">
          <span>聚合粒度</span>
          <el-radio-group v-model="aggregation" @change="onAggregationChange">
            <el-radio-button v-for="item in AGG_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </label>
      </template>
      <label class="po-field">
        <span>预测源</span>
        <el-select
          v-model="forecastType"
          :disabled="!forecastOptions.length"
          filterable
          @change="onForecastTypeChange"
        >
          <el-option v-for="source in forecastOptions" :key="source" :label="source" :value="source" />
        </el-select>
      </label>
      <label class="po-field po-field--number">
        <span>偏差率阈值</span>
        <el-input-number
          v-model="deviationPctThreshold"
          :min="1"
          :max="100"
          :step="1"
          controls-position="right"
          @change="onThresholdChange"
        />
      </label>
      <label class="po-field po-field--number">
        <span>偏差MW阈值</span>
        <el-input-number
          v-model="deviationMwThreshold"
          :min="1"
          :max="1000"
          :step="5"
          controls-position="right"
          @change="onThresholdChange"
        />
      </label>
    </SpotFilterBar>

    <el-alert
      v-if="meta.mock"
      type="warning"
      :closable="false"
      class="po-alert"
      show-icon
      title="检测到模拟回放，已禁止上屏"
      description="该响应标记 mock:true / sourceType:MOCK / productionWrite:false。请先运行 import:spot-export --write 摄取 yn_plant_output 真实数据。"
    />
    <el-alert
      v-else-if="ingestHint"
      type="warning"
      :closable="false"
      class="po-alert"
      show-icon
      title="后端暂无 yn_plant_output 厂站出力数据"
      description="请在主仓库用云南月度导出包运行 import:spot-export --write，确认 plant_integrated_power_forecast_actual.csv 已落入 capture-raw/yunnan/yn_plant_output/。"
    />

    <DataState :loading="loading" :error="errorMsg" :empty="!hasData" :empty-text="emptyText">
      <template #skeleton>
        <section class="po-kpi-row">
          <SpotSkeleton v-for="index in 4" :key="index" variant="rows" :rows="2" card />
        </section>
        <section class="po-charts">
          <SpotSkeleton variant="chart" :height="350" />
          <SpotSkeleton variant="chart" :height="330" />
        </section>
        <section class="po-table-card">
          <SpotSkeleton variant="table" :rows="8" :columns="6" />
        </section>
      </template>

      <section class="po-kpi-row">
        <div v-for="item in kpis" :key="item.label" class="po-kpi">
          <div class="po-kpi-label"><component :is="item.icon" :size="13" /> {{ item.label }}</div>
          <div class="po-kpi-value">{{ formatMetric(item.value, item.unit, item.unit === '%' ? 1 : 2) }}</div>
          <div class="po-kpi-unit">{{ plantLabel }} · {{ unitLabel }} · {{ aggregationLabel }}</div>
        </div>
      </section>

      <section class="po-charts">
        <ChartCard
          title="实际 vs 计划/预测出力（阶梯线）"
          :height="350"
          :updated-at="meta.updatedAt"
          cadence="monthly"
          :build-option="buildOutputOption"
          fullscreen
          png-export
          png-name="yn-plant-output-series"
        >
          <template #actions>
            <span class="po-chart-sub">{{ plantLabel }} · {{ dateRangeLabel }} · {{ aggregationLabel }}</span>
          </template>
        </ChartCard>

        <ChartCard
          title="偏差与完成率（汇总口径）"
          :height="330"
          :build-option="buildDeviationOption"
          fullscreen
          brush-stats
          png-export
          png-name="yn-plant-output-deviation"
        >
          <template #actions>
            <span class="po-chart-sub">{{ targetLabel }}口径 · 异常 {{ summary.anomalyCount }} 段</span>
          </template>
        </ChartCard>
      </section>

      <section class="po-table-card">
        <div class="po-table-head">
          <h3><TableProperties :size="16" /> 异常出力时段</h3>
          <span class="po-table-sub">
            {{ plantLabel }} · {{ dateRangeLabel }} · 阈值 {{ deviationPctThreshold }}% / {{ deviationMwThreshold }}MW · 共 {{ anomalyRows.length }} 条{{ anomalyMarkAreaTruncated ? ' · 主图仅高亮前 48 段，完整见下表' : '' }}
          </span>
        </div>
        <DynamicTable
          :rows="anomalyRows"
          :labels="anomalyLabels"
          :page-size="20"
          export-name="yn-plant-output-anomalies"
        />
      </section>
    </DataState>
  </div>
</template>

<style scoped>
.plant-output-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.po-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.po-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: var(--font-md);
  font-weight: 650;
}

.po-hero p {
  margin: 8px 0 0;
  color: #5c6b76;
  font-size: var(--font-md);
  line-height: 1.7;
}

.po-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.po-field > span {
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.po-field :deep(.el-select),
.po-field :deep(.el-date-editor) {
  width: 190px;
}

.po-field--number :deep(.el-input-number) {
  width: 140px;
}

.po-field--radio :deep(.el-radio-group) {
  min-height: 32px;
}

.po-alert {
  border-radius: 8px;
}

.po-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.po-kpi {
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.po-kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #5c6b76;
  font-size: var(--font-sm);
  font-weight: 650;
}

.po-kpi-value {
  margin-top: 8px;
  color: #18212b;
  font-size: var(--font-22);
  font-weight: 760;
  line-height: 1.2;
}

.po-kpi-unit {
  margin-top: 5px;
  color: #7a8793;
  font-size: var(--font-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.po-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.95fr);
  gap: 14px;
}

.po-chart-sub {
  color: #64748b;
  font-size: var(--font-sm);
  white-space: nowrap;
}

.po-table-card {
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.po-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.po-table-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #1f2a37;
  font-size: var(--font-15);
}

.po-table-sub {
  color: #64748b;
  font-size: var(--font-sm);
}

@media (max-width: 1100px) {
  .po-kpi-row,
  .po-charts {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 760px) {
  .po-hero,
  .po-table-head {
    flex-direction: column;
    align-items: stretch;
  }

  .po-field :deep(.el-select),
  .po-field :deep(.el-date-editor),
  .po-field--number :deep(.el-input-number) {
    width: 100%;
  }

  .po-kpi-row,
  .po-charts {
    grid-template-columns: 1fr;
  }
}
</style>
