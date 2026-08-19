<script setup lang="ts">
// 日前电量预估 (zptqx, type4=预估电量) — 精修版,对照 C2:可勾选表格 + 多选联动折线。
//  筛选:运行日期区间 + 搜索/重置(类型固定预估电量,公司固定默认公司)。
//  表格:复选/序号/售电公司/日期/类型/合计/96点;日期·合计·各时点可排序。
//  图表:勾选行→对应预估电量折线(96点),多选多条,纵轴自适应。
// 数据:GET /sdpt/zptqx/list(最大文件含全类型 888 行,前端按 type='4' 过滤=65天)。源 capture-raw/sdpt_zptqx/。
import { computed, onMounted, ref, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { fetchSpotDayAheadEnergyContract, SPOT_DAY_AHEAD_ENERGY_FAMILY } from '@/services/data/contracts'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import CapabilityDegradedCard from '../components/CapabilityDegradedCard.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'

const POINTS_96 = Array.from({ length: 96 }, (_, i) => { const m = (i + 1) * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
const PTS = Array.from({ length: 96 }, (_, i) => `p${i + 1}`)

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const route = useRoute()
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
const range = ref<[string, string] | null>(urlRange)
const selected = ref<any[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const tableRef = ref()
const energyChart = useEChart(chartRef, { render })
const routeCapability = computed(() => getRegionCapabilityForPath('/xhjy/zptqx', currentRegion.value.id))
const capabilitySupports = computed(() =>
  routeCapability.value?.route?.dataSupportByRegion?.[currentRegion.value.id]
  ?? routeCapability.value?.module.dataSupportByRegion[currentRegion.value.id]
  ?? []
)
const isCapabilityDegraded = computed(() => routeCapability.value?.status === 'degraded' || routeCapability.value?.status === 'hidden' || routeCapability.value?.status === 'not-configured')
const capabilityNote = computed(() =>
  routeCapability.value?.route?.note
  ?? capabilitySupports.value.find((item) => item.expectation === 'missing')?.note
  ?? null
)
let loadGeneration = 0

const filtered = computed(() => {
  if (!range.value) return rows.value
  const [s, e] = range.value
  return rows.value.filter((r) => r.date >= s && r.date <= e)
})

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  if (isCapabilityDegraded.value) {
    await nextTick()
    if (generation !== loadGeneration) return
    renderEmptyChart('当前地区暂无日前电量预估真实源')
    loading.value = false
    return
  }
  energyChart.showLoading()
  try {
    const contract = await fetchSpotDayAheadEnergyContract({ region: currentRegion.value.id })
    if (generation !== loadGeneration) return
    rows.value = contract.blocks.day_ahead_energy.rows
      .sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
      .map((r: any, i: number) => ({ ...r, _idx: i + 1 }))
    await nextTick()
    if (generation !== loadGeneration) return
    render()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyChart(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      energyChart.hideLoading()
    }
  }
}
function reset() { range.value = null; tableRef.value?.clearSelection() }
function onSel(rs: any[]) { selected.value = rs; render() }

function clearViewState() {
  rows.value = []
  selected.value = []
  tableRef.value?.clearSelection?.()
}

function renderEmptyChart(text = '暂无数据') {
  energyChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function exportTable() {
  const tag = range.value ? `${range.value[0]}_${range.value[1]}` : '全部日期'
  exportCsv(
    `日前电量预估_${tag}`,
    ['序号', '售电公司', '日期', '类型', '合计', ...POINTS_96],
    filtered.value.map((r: any) => [r._idx, r.sdgs, r.date, '预估电量', r.total, ...PTS.map((p) => r[p] ?? '')])
  )
}

function render() {
  if (!chartRef.value) return
  const cc = chartChrome()
  // 96 点预估电量按 15min 时段恒定，阶梯线真实呈现（平滑样条会画出不存在的假峰谷）
  const series = selected.value.map((r) => ({ name: r.date, type: 'line', step: 'start' as const, showSymbol: false, connectNulls: true, lineStyle: { width: 1.6 }, emphasis: { focus: 'series' as const }, data: PTS.map((p) => r[p] ?? null) }))
  energyChart.setOption({
    ...emptyOverlay(!series.length, '勾选表格行查看其 96 点预估电量曲线（可多选）'),
    // 底部布局:图例顶部居中 scroll,工具栏右下角
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ unit: 'MWh' }), confine: true },
    toolbox: bottomToolbox('预估电量曲线', 8),
    dataZoom: insideZoom(),
    grid: { left: 60, right: 20, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: POINTS_96, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 11 } },
    yAxis: { type: 'value', name: '预估电量 MWh', scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

onMounted(() => { load() })

onRegionChange(load)
</script>

<template>
  <div class="en" v-loading="loading">
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <RegionDataBanner :families="[SPOT_DAY_AHEAD_ENERGY_FAMILY]" />
    <CapabilitySupportBadge path="/xhjy/zptqx" />
    <CapabilityDegradedCard
      v-if="isCapabilityDegraded"
      title="日前电量预估暂未接入当前地区真实源"
      :region-name="currentRegion.name"
      :note="capabilityNote"
      :supports="capabilitySupports"
    />
    <template v-else>
      <div class="toolbar">
        <span class="lbl">运行日期</span>
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px" />
        <span class="lbl">售电公司</span>
        <el-select model-value="默认公司" size="small" style="width: 120px" disabled><el-option label="默认公司" value="默认公司" /></el-select>
        <el-button size="small" type="primary" @click="load">搜索</el-button>
        <el-button size="small" @click="reset">重置</el-button>
        <el-button size="small" :disabled="!filtered.length" @click="exportTable">导出CSV</el-button>
      </div>

      <el-card shadow="never" class="mb">
        <el-table ref="tableRef" :data="filtered" border size="default" height="320" class="big" @selection-change="onSel">
          <el-table-column type="selection" width="44" fixed />
          <el-table-column prop="_idx" label="序号" width="64" fixed align="center" />
          <el-table-column prop="sdgs" label="售电公司" width="110" />
          <el-table-column prop="date" label="日期" width="120" sortable />
          <el-table-column label="类型" width="100"><template #default>预估电量</template></el-table-column>
          <el-table-column prop="total" label="合计" width="110" align="right" sortable />
          <el-table-column v-for="(p, i) in PTS" :key="p" :prop="p" :label="POINTS_96[i]" width="78" align="right" sortable />
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header><span style="font-weight:600;font-size: var(--font-md)">预估电量曲线 · 已选 {{ selected.length }} 天（96 点）</span></template>
        <div ref="chartRef" class="chart chart-host"></div>
      </el-card>
    </template>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zptqx/list · type4 预估电量 · 天 -->
  </div>
</template>

<style scoped>
.en { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.big :deep(.el-table__cell) { font-size: var(--font-md); }
.big :deep(th .cell) { font-weight: 600; color: var(--el-text-color-primary); }
.chart { height: 480px; width: 100%; }
.mb { margin-bottom: 12px; }
/* 移动端：筛选工具条纵排，控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
}
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
</style>
