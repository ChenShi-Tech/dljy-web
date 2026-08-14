<script setup lang="ts">
// 省间中长期交易电量计划 (zptjg tag92) — 精修版,对照 D1(与 C2 同形,加 24/96 点切换 + 导出)。
//  筛选:运行日期区间 + 数据点(24/96) + 搜索/重置 + 橙色导出。
//  表格:复选/序号/日期/导入日期/均值/(24 或 96)点。图表:勾选行→对应 24/96 点曲线。
// 数据:中长期契约读取 sdpt_zptjg/list_tag92_full -> {date, importDate, averageMwh, points96}。
//  24点=每小时取 4 个 15min 点的均值。源 capture-raw/sdpt_zptjg/list_tag92_full。
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchMidlongInterProvincialContract,
  type MidlongInterProvincialPlanRow
} from '@/services/data/contracts'
import { onRegionChange } from '@/composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '@/components/CapabilitySupportBadge.vue'
import { chartChrome } from '@/composables/useTheme'
import { useEChart } from '@/composables/useEChart'
import { useQuerySync } from '@/composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv } from '@/utils/exportCsv'

const L96 = Array.from({ length: 96 }, (_, i) => { const m = (i + 1) * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
const L24 = Array.from({ length: 24 }, (_, i) => `${String(i + 1).padStart(2, '0')}:00`)
type PlanRow = MidlongInterProvincialPlanRow & { _idx: number }
const get96 = (r: PlanRow) => r.points96
const get24 = (r: PlanRow) => Array.from({ length: 24 }, (_, h) => {
  const v = [0, 1, 2, 3].map((j) => r.points96[h * 4 + j]).filter((x): x is number => x != null)
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null
})

const loading = ref(true)
const error = ref('')
const rows = ref<PlanRow[]>([])
const range = ref<[string, string] | null>(null)
const route = useRoute()
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
const npts = ref<24 | 96>(96)
const selected = ref<PlanRow[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const tableRef = ref()
const chart = useEChart(chartRef, { render })
let loadGeneration = 0
// 运行日期区间 ⇄ 路由 query(from/to):刷新或分享链接后筛选状态可还原
const qFrom = ref(typeof route.query.from === 'string' ? route.query.from : '')
const qTo = ref(typeof route.query.to === 'string' ? route.query.to : '')
useQuerySync({ from: qFrom, to: qTo })
watch(range, (v) => { qFrom.value = v?.[0] || ''; qTo.value = v?.[1] || '' })

const labels = computed(() => (npts.value === 24 ? L24 : L96))
const cols = computed(() => Array.from({ length: npts.value }, (_, i) => i))
const valsOf = (r: PlanRow) => (npts.value === 24 ? get24(r) : get96(r))
const filtered = computed(() => { if (!range.value) return rows.value; const [s, e] = range.value; return rows.value.filter((r) => r.date >= s && r.date <= e) })

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyChart()
  try {
    const contract = await fetchMidlongInterProvincialContract({ region: currentRegion.value.id })
    if (generation !== loadGeneration) return
    const all = contract.blocks.inter_provincial.rows
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((r, i) => ({ ...r, _idx: i + 1 }))
    rows.value = all
    if (all.length) range.value = urlRange ?? [all[Math.min(all.length - 1, 30)].date, all[0].date] // 默认最近约31天
    await nextTick()
    if (generation !== loadGeneration) return
    render()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyChart(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
function reset() { range.value = rows.value.length ? [rows.value[Math.min(rows.value.length - 1, 30)].date, rows.value[0].date] : null; npts.value = 96; tableRef.value?.clearSelection() }
function onSel(rs: PlanRow[]) { selected.value = rs; render() }

function clearViewState() {
  rows.value = []
  selected.value = []
  range.value = null
  tableRef.value?.clearSelection?.()
}

function renderEmptyChart(text = '暂无省间电量计划数据') {
  chart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function render() {
  const cc = chartChrome()
  const series = selected.value.map((r) => ({ name: r.date, type: 'line', step: 'start' as const, showSymbol: false, connectNulls: true, data: valsOf(r) }))
  chart.setOption({
    ...emptyOverlay(!series.length, `勾选表格行查看其 ${npts.value} 点曲线（可多选）`),
    // 底部布局:图例顶部居中 scroll,工具栏右下角
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ unit: 'MWh' }), confine: true },
    toolbox: bottomToolbox('省间电量计划', 8),
    grid: { left: 64, right: 20, top: 48, bottom: 48 },
    // 96 点曲线提供滚轮/双指缩放查看局部时段
    dataZoom: npts.value === 96 ? insideZoom() : [],
    xAxis: { type: 'category', data: labels.value, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: npts.value === 24 ? 1 : 11 } },
    yAxis: { type: 'value', name: '电量', scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

// 导出走公共 exportCsv 工具(自动转义 + UTF-8 BOM)
function exportTable() {
  const rs = selected.value.length ? selected.value : filtered.value
  if (!rs.length) { ElMessage.warning('无可导出的数据'); return }
  exportCsv(
    `省间电量计划_${npts.value}点`,
    ['序号', '日期', '导入日期', '均值', ...labels.value],
    rs.map((r) => [r._idx, r.date, r.importDate, r.averageMwh, ...valsOf(r)])
  )
  ElMessage.success(`已导出 ${rs.length} 行 · ${npts.value} 点`)
}

onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="ip" v-loading="loading">
    <RegionDataBanner />
    <CapabilitySupportBadge path="/sjxh/zjzzt" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px" />
      <span class="lbl">数据点</span>
      <el-radio-group v-model="npts" size="small" @change="render"><el-radio-button :value="24">24 点</el-radio-button><el-radio-button :value="96">96 点</el-radio-button></el-radio-group>
      <el-button size="small" type="primary" @click="load">搜索</el-button>
      <el-button size="small" @click="reset">重置</el-button>
      <span class="spacer" />
      <el-button size="small" color="#fc8452" @click="exportTable">导出</el-button>
    </div>

    <el-card shadow="never" class="mb">
      <el-table ref="tableRef" :data="filtered" border size="default" height="320" class="big" @selection-change="onSel">
        <el-table-column type="selection" width="44" fixed />
        <el-table-column prop="_idx" label="序号" width="64" fixed align="center" />
        <el-table-column prop="date" label="日期" width="118" fixed sortable />
        <el-table-column prop="importDate" label="导入日期" width="118" sortable />
        <el-table-column prop="averageMwh" label="均值" width="110" align="right" sortable />
        <el-table-column v-for="i in cols" :key="i" :label="labels[i]" width="78" align="right" sortable :sort-by="(r:PlanRow) => valsOf(r)[i]">
          <template #default="{ row }">{{ valsOf(row)[i] ?? '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size:13px">电量计划曲线 · 已选 {{ selected.length }} 行（{{ npts }} 点）</span></template>
      <div ref="chartRef" class="chart chart-host"></div>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zptjg/list?tag=92 · 行 · 24点=每小时均值 -->
  </div>
</template>

<style scoped>
.ip { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: 13px; color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.big :deep(.el-table__cell) { font-size: 13px; }
.big :deep(th .cell) { font-weight: 600; color: var(--el-text-color-primary); }
.chart { height: 300px; width: 100%; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }

/* 移动端:筛选条纵向堆叠,控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar :deep(.el-date-editor),
  .toolbar :deep(.el-radio-group),
  .toolbar .el-button { width: 100% !important; margin-left: 0; }
  .toolbar .spacer { display: none; }
}
</style>
