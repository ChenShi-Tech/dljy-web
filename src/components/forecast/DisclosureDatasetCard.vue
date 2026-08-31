<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import type { EChartsOption } from 'echarts'
import type { DisclosureDatasetResult, DisclosureSeries } from '@/services/forecast/dailyDisclosure'
import { useEChart } from '@/composables/useEChart'
import { buildColumnLabelsFromRows } from '@/data/captureColumnLabels'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'
import { POWER, catAxis, grid, legend, lineSeries, stepSeries, tooltipStyle, valueAxis } from '@/services/chart/chartStyle'

const props = defineProps<{
  dataset: DisclosureDatasetResult
}>()

interface SeriesGroup {
  key: string
  scope: string
  scopeLabel: string
  targetDate: string | null
  unit: string
  series: DisclosureSeries[]
  labels: string[]
  validPoints: number
  expectedPoints: number
  conflicts: number
}

const chartEl = ref<HTMLElement | null>(null)
const detailVisible = ref(false)
const detailPage = ref(1)
const pageSize = 20
const activeGroupKey = ref('')
const chart = useEChart(chartEl, { render: paint })

function toGroupKey(series: DisclosureSeries): string {
  return JSON.stringify([series.scope, series.targetDate, series.unit])
}

const seriesGroups = computed<SeriesGroup[]>(() => {
  const groups = new Map<string, SeriesGroup>()
  for (const series of props.dataset.series) {
    const key = toGroupKey(series)
    const existing = groups.get(key)
    if (existing) {
      existing.series.push(series)
      existing.validPoints = Math.max(existing.validPoints, series.validPoints)
      existing.expectedPoints = Math.max(existing.expectedPoints, series.expectedPoints)
      existing.conflicts += series.conflicts
      continue
    }
    groups.set(key, {
      key,
      scope: series.scope,
      scopeLabel: series.scopeLabel,
      targetDate: series.targetDate,
      unit: series.unit,
      series: [series],
      labels: [...series.labels],
      validPoints: series.validPoints,
      expectedPoints: series.expectedPoints,
      conflicts: series.conflicts,
    })
  }
  return [...groups.values()]
})

function preferredGroupKey(groups: SeriesGroup[]): string {
  return groups.find((group) => group.scope === 'yn')?.key ?? groups[0]?.key ?? ''
}

watch(seriesGroups, (groups) => {
  if (!groups.some((group) => group.key === activeGroupKey.value)) {
    activeGroupKey.value = preferredGroupKey(groups)
  }
}, { immediate: true })

const activeGroup = computed(() => seriesGroups.value.find((group) => group.key === activeGroupKey.value) ?? null)
const hasActivePoints = computed(() => activeGroup.value?.series.some((series) => series.validPoints > 0) ?? false)
const showScopeSelector = computed(() => seriesGroups.value.length > 1)
const detailColumns = computed(() => {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const row of props.dataset.rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        ordered.push(key)
      }
    }
  }
  return ordered
})
const declaredLabels = computed(() => buildColumnLabelsFromRows(
  props.dataset.rows,
  props.dataset.spec.family,
  props.dataset.spec.id,
))

const columnLabels = computed<Record<string, string>>(() => ({
  ...declaredLabels.value,
  operateDate: '数据日期',
  targetDate: '目标日期',
  timePoint: '时段',
  time: '时段',
  region: '统计范围',
  area: '统计范围',
  metric: '指标字段',
  value: props.dataset.spec.nature === 'price' ? '价格值' : '数值',
  valuePrev: '上一快照值',
  loadMWh: '统调负荷',
  newEnergyMWh: '新能源出力',
  hydropowerMWh: '水电出力',
  noMarketUnitMWh: '非市场机组出力',
  frequencyHz: '电网频率',
  volume: '源成交量字段',
  deviation: '源偏差字段',
  price: props.dataset.spec.nature === 'supply' ? '源价格字段' : '价格',
}))

const pagedRows = computed(() => {
  const start = (detailPage.value - 1) * pageSize
  return props.dataset.rows.slice(start, start + pageSize)
})

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

watch(() => props.dataset.rows.length, () => {
  detailPage.value = 1
})

function datasetColor(series: DisclosureSeries, index: number): string {
  const label = `${series.label} ${props.dataset.spec.id}`.toLowerCase()
  if (label.includes('负荷')) return POWER.load
  if (label.includes('新能源')) return POWER.newEnergy
  if (label.includes('水电')) return POWER.hydro
  if (label.includes('频率')) return '#b45309'
  if (label.includes('非市场')) return '#8b5cf6'
  if (label.includes('送受电') || label.includes('跨省')) return '#7c3aed'
  if (label.includes('发电')) return '#2563eb'
  if (props.dataset.spec.nature === 'price') return POWER.price
  return ['#2563eb', '#0f9d8a', '#f97316', '#8b5cf6', '#0891b2', '#16a34a'][index % 6]
}

function buildChartSeries(series: DisclosureSeries, index: number): Record<string, unknown> {
  const color = datasetColor(series, index)
  const data = series.points.map((value) => value ?? null)
  const base = props.dataset.spec.nature === 'price'
    ? stepSeries(series.label, data, color, { step: 'end' as const })
    : lineSeries(series.label, data, color)
  const lineStyle = props.dataset.spec.nature === 'forecast'
    ? { width: 2.2, type: 'dashed' as const, color }
    : { width: 2.2, color }
  return {
    ...base,
    lineStyle,
    itemStyle: { color },
    connectNulls: false,
    smooth: false,
    showSymbol: series.validPoints <= 1,
    symbolSize: series.validPoints <= 1 ? 7 : 5,
  }
}

function paint() {
  if (!activeGroup.value) {
    chart.setOption({
      title: { text: '暂无可绘制曲线', left: 'center', top: 'middle', textStyle: { fontSize: 14, fontWeight: 500 } },
    } as EChartsOption, { notMerge: true })
    return
  }
  const group = activeGroup.value
  const digits = props.dataset.spec.nature === 'price' ? 2 : 0
  chart.setOption({
    tooltip: {
      ...axisTooltip({
        digits,
        units: Object.fromEntries(group.series.map((series) => [series.label, series.unit])),
      }),
      ...tooltipStyle(),
    },
    legend: legend(),
    toolbox: chartToolbox(`${props.dataset.spec.title}-${group.scope}-${group.targetDate ?? props.dataset.date}`),
    grid: grid({ legend: true, right: 20 }),
    xAxis: catAxis(group.labels, { boundaryGap: props.dataset.spec.nature === 'price' }),
    yAxis: valueAxis(group.unit, { scale: true }),
    series: group.series.map((series, index) => buildChartSeries(series, index)),
  } as EChartsOption, { notMerge: true })
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  // 明细保留接口原数精度，不能用图表格式化器再次四舍五入。
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function resize() {
  chart.resize()
}

// 等DOM及容器ref完成更新后绘制，首次挂载/空态转曲线也遵守同一生命周期。
watchEffect(paint, { flush: 'post' })

defineExpose({ resize })
</script>

<template>
  <article class="disclosure-card">
    <header class="disclosure-card__head">
      <div class="disclosure-card__title-wrap">
        <h3 class="disclosure-card__title" :title="dataset.spec.title">{{ dataset.spec.title }}</h3>
        <span class="disclosure-card__status" :class="`is-${dataset.status}`">
          {{ dataset.status === 'partial' ? '部分可用' : '已导入' }}
        </span>
      </div>
      <div class="disclosure-card__actions">
        <el-select
          v-if="showScopeSelector"
          v-model="activeGroupKey"
          size="small"
          class="disclosure-card__scope-select"
        >
          <el-option
            v-for="group in seriesGroups"
            :key="group.key"
            :label="`${group.scopeLabel} · ${group.targetDate ?? '仅记录日'} · ${group.unit}`"
            :value="group.key"
          />
        </el-select>
        <el-button size="small" plain @click="detailVisible = true">查看明细</el-button>
      </div>
    </header>

    <div class="disclosure-card__meta">
      <span>数据日期：{{ dataset.date }}</span>
      <span>目标日：{{ activeGroup?.targetDate ?? '仅记录日' }}</span>
      <span>统计范围：{{ activeGroup?.scopeLabel ?? '—' }}</span>
      <span>有效点数：{{ activeGroup ? `${activeGroup.validPoints}/${activeGroup.expectedPoints}` : '—' }}</span>
    </div>

    <div class="disclosure-card__source">
      <span>{{ dataset.sourceLabel }}</span>
      <span v-if="dataset.capturedAt">采集时间：{{ dataset.capturedAt }}</span>
      <span v-else-if="dataset.ingestedAt">导入时间：{{ dataset.ingestedAt }}</span>
    </div>

    <p
      v-for="(warning, index) in dataset.warnings"
      :key="`${dataset.spec.id}-warning-${index}`"
      class="disclosure-card__warning"
    >
      {{ warning }}
    </p>

    <div v-if="hasActivePoints" ref="chartEl" class="disclosure-card__chart" />
    <p v-else class="disclosure-card__warning">有原始记录，但没有可安全绘制的有效曲线；请点击“查看明细”核查。</p>

    <el-dialog
      v-model="detailVisible"
      :title="`${dataset.spec.title} 原始明细`"
      width="min(1120px, 92vw)"
      append-to-body
    >
      <div class="disclosure-card__dialog-meta">
        <span>图表范围：{{ activeGroup?.scopeLabel ?? '—' }}</span>
        <span>目标日：{{ activeGroup?.targetDate ?? '仅记录日' }}</span>
        <span>曲线数：{{ activeGroup?.series.length ?? 0 }}</span>
      </div>
      <p class="disclosure-card__warning">下表保留该数据集当日全部统计范围和原始字段，不只限于上方选中的曲线。</p>

      <div v-if="activeGroup?.series.length" class="disclosure-card__series-list">
        <div
          v-for="series in activeGroup.series"
          :key="series.id"
          class="disclosure-card__series-chip"
        >
          <strong>{{ series.label }}</strong>
          <span>{{ series.validPoints }}/{{ series.expectedPoints }} 点</span>
          <span v-if="series.previous.some((value) => value !== null)">含上一快照值</span>
        </div>
      </div>

      <el-table :data="pagedRows" border size="small" max-height="420">
        <el-table-column
          v-for="column in detailColumns"
          :key="column"
          :prop="column"
          :label="columnLabels[column] ? `${columnLabels[column]}（${column}）` : column"
          min-width="124"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatCell(row[column]) }}
          </template>
        </el-table-column>
      </el-table>

      <div v-if="dataset.rows.length > pageSize" class="disclosure-card__pagination">
        <el-pagination
          layout="prev, pager, next"
          :total="dataset.rows.length"
          :page-size="pageSize"
          :current-page="detailPage"
          :pager-count="5"
          @current-change="detailPage = Math.min($event, pageCount(dataset.rows.length))"
        />
      </div>
    </el-dialog>
  </article>
</template>

<style scoped>
.disclosure-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
  padding: 16px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 6px;
}

.disclosure-card__head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.disclosure-card__title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.disclosure-card__title {
  margin: 0;
  overflow: hidden;
  color: var(--text, #1f2a37);
  font-size: var(--font-md);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disclosure-card__status {
  flex: none;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary, #0f9d8a) 12%, white 88%);
  color: var(--primary, #0f9d8a);
  font-size: var(--font-xs);
  font-weight: 600;
}

.disclosure-card__status.is-partial {
  background: color-mix(in srgb, #f59e0b 16%, white 84%);
  color: #b45309;
}

.disclosure-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  min-width: 0;
  justify-content: flex-end;
}

.disclosure-card__scope-select {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.disclosure-card__meta,
.disclosure-card__source,
.disclosure-card__dialog-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: var(--muted, #667085);
  font-size: var(--font-sm);
}

.disclosure-card__source {
  padding: 8px 10px;
  background: color-mix(in srgb, var(--panel-sub, #f8fafc) 88%, #eff9f7 12%);
  border-radius: 4px;
}

.disclosure-card__warning {
  margin: 0;
  color: var(--muted, #667085);
  font-size: var(--font-sm);
  line-height: 1.6;
}

.disclosure-card__chart {
  margin-top: auto;
  width: 100%;
  height: 18rem;
}

.disclosure-card__series-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.disclosure-card__series-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--panel-sub, #f8fafc) 88%, #eff9f7 12%);
  color: var(--text-body, #344054);
  font-size: var(--font-sm);
}

.disclosure-card__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

@media (max-width: 900px) {
  .disclosure-card__head,
  .disclosure-card__actions {
    flex-direction: column;
    align-items: stretch;
  }

  .disclosure-card__scope-select {
    width: 100%;
  }
}
</style>
