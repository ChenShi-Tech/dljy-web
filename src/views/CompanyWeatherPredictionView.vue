<script setup lang="ts">
// 公司气象预测 (zgnrx/qxyc) — 精修版,对照 E7.png:数据范围+运行日期筛选,三张图(风速/辐照/温度),
//  每图 其他日平均(蓝) vs 运行日平均(黄,高亮)。是新能源出力预测的气象输入对比。
// 数据:GET /sdpt/zgnrx/qxyc -> {fs,fz,wd} 各 {nameList(逐15min,一年), legendList[其他日平均,运行日平均], valueList[2]}。
//  NOTE(内部): 模型气象输入,后续专项优化;界面正常自信展示。源: capture-raw/sdpt_zgnrx/ (qxyc_wide)
import { onMounted, ref, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import { currentRegion } from '@/services/region/regionContext'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import ForecastIntro from '@/components/forecast/ForecastIntro.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, sliderZoom } from '@/services/chart/chartOptions'
import { exportCsv as downloadCsv } from '../utils/exportCsv'

const PANELS = [
  { key: 'fs', label: '风速', unit: 'm/s' },
  { key: 'fz', label: '辐照', unit: 'W/m²' },
  { key: 'wd', label: '温度', unit: '℃' }
]
const loading = ref(true)
const error = ref('')
const data = ref<any>(null)
const range = ref<[string, string] | null>(null)
const runDate = ref('')
const route = useRoute()
const qDate = typeof route.query.date === 'string' ? route.query.date : ''
const refs: Record<string, any> = { fs: ref(null), fz: ref(null), wd: ref(null) }
// 三张图各建一个 handle:主题切换/容器伸缩自动跟随,卸载自动 dispose
const charts: Record<string, ReturnType<typeof useEChart>> = Object.fromEntries(
  PANELS.map((p) => [p.key, useEChart(refs[p.key], { render: () => renderPanel(p) })])
)
let loadGeneration = 0
// 运行日期 ⇄ 路由 query 同步(刷新/分享可还原;date 键兼容旧跳转链接)
useQuerySync({ date: runDate })

const allDates = computed(() => {
  const nl = data.value?.fs?.nameList || []
  return [...new Set(nl.map((s: string) => s.slice(0, 10)))] as string[]
})

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyPanels()
  PANELS.forEach((p) => charts[p.key].showLoading())
  try {
    if (currentRegion.value.id === 'yunnan') {
      // 先落局部变量、generation 校验后再赋 data.value——await 后直接赋值会让
      // 切地区时旧云南慢响应覆盖当前地区状态（roborev job454）。
      const yunnanData = await loadYunnanWeather()
      if (generation !== loadGeneration) return
      data.value = yunnanData
    } else {
      const res = await fetchCaptured<any>('sdpt_zgnrx', 'qxyc_wide')
      if (generation !== loadGeneration) return
      data.value = res?.data || {}
    }
    if (generation !== loadGeneration) return
    const ds = allDates.value
    if (ds.length) { range.value = [ds[Math.max(0, ds.length - 37)], ds[ds.length - 1]]; runDate.value = (qDate && ds.includes(qDate)) ? qDate : ds[ds.length - 1] }
    await nextTick()
    if (generation !== loadGeneration) return
    renderAll()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyPanels(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      PANELS.forEach((p) => charts[p.key].hideLoading())
    }
  }
}
function reset() { const ds = allDates.value; if (ds.length) { range.value = [ds[Math.max(0, ds.length - 37)], ds[ds.length - 1]]; runDate.value = ds[ds.length - 1] }; renderAll() }

function clearViewState() {
  data.value = null
  range.value = null
  runDate.value = ''
}

function renderEmptyPanels(text = '暂无数据') {
  PANELS.forEach((p) => {
    charts[p.key].setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
  })
}

async function loadYunnanWeather() {
  const [meteo, irradiance] = await Promise.all([
    fetchCaptured<any>('yn_meteo', 'yn_meteo_hourly'),
    fetchCaptured<any>('yn_irradiance', 'yn_irradiance_hourly')
  ])
  return {
    fs: buildHourlyPanel(meteo?.rows || meteo?.data || [], 'windSpeed'),
    fz: buildHourlyPanel(irradiance?.rows || irradiance?.data || [], 'ghi'),
    wd: buildHourlyPanel(meteo?.rows || meteo?.data || [], 'temp')
  }
}

function buildHourlyPanel(rows: any[], field: string) {
  const byDatetime = new Map<string, { total: number; count: number; date: string; time: string }>()
  for (const row of rows) {
    const datetime = String(row.datetime ?? (row.date && row.time ? `${row.date}T${row.time}` : '')).replace(' ', 'T')
    const date = String(row.date ?? datetime.slice(0, 10))
    const time = String(row.time ?? datetime.slice(11, 16))
    // 缺测口径（null/undefined/空串）显式跳过，不得被 Number() 折成真实 0 值
    // 混入均值聚合（roborev job468；真实呈现纪律）。
    const raw = row[field]
    if (raw === null || raw === undefined || raw === '') continue
    const value = Number(raw)
    if (!datetime || !date || !time || !Number.isFinite(value)) continue
    const cur = byDatetime.get(datetime) ?? { total: 0, count: 0, date, time }
    cur.total += value
    cur.count += 1
    byDatetime.set(datetime, cur)
  }
  const points = Array.from(byDatetime.entries())
    .map(([datetime, item]) => ({ datetime, date: item.date, time: item.time, value: item.total / item.count }))
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
  const byTime = new Map<string, Array<{ date: string; value: number }>>()
  for (const point of points) {
    const list = byTime.get(point.time) ?? []
    list.push({ date: point.date, value: point.value })
    byTime.set(point.time, list)
  }
  const peerAvg = points.map((point) => {
    const peers = (byTime.get(point.time) ?? []).filter((item) => item.date !== point.date).map((item) => item.value)
    const source = peers.length ? peers : [point.value]
    return +(source.reduce((a, b) => a + b, 0) / source.length).toFixed(3)
  })
  return {
    nameList: points.map((point) => `${point.date} ${point.time}`),
    legendList: ['其他日同小时平均', '当前小时'],
    valueList: [peerAvg, points.map((point) => +point.value.toFixed(3))]
  }
}

function renderPanel(p: { key: string; label: string; unit: string }) {
  const block = data.value?.[p.key]
  if (!block) return
  const [s, e] = range.value || ['', '']
  const nl: string[] = block.nameList || []
  let lo = nl.findIndex((n) => n.slice(0, 10) >= s)
  let hi = nl.findIndex((n) => n.slice(0, 10) > e)
  if (lo < 0) lo = 0; if (hi < 0) hi = nl.length
  const xs = nl.slice(lo, hi)
  const legend: string[] = block.legendList || []
  const colors = ['#5470c6', '#e6a23c']
  const cc = chartChrome()
  charts[p.key].setOption({
    ...emptyOverlay(!xs.length),
    tooltip: { ...axisTooltip({ unit: p.unit }), confine: true },
    // 底部布局:图例顶部居中 scroll,工具栏右下角;grid bottom 加大给 toolbox + sliderZoom 滑块共存
    legend: bottomLayoutLegend({ data: legend, textStyle: { fontSize: 11 } }),
    toolbox: bottomToolbox(`气象预测_${p.label}`, 8),
    dataZoom: sliderZoom(),
    grid: { left: 56, right: 20, top: 48, bottom: 64 },
    xAxis: { type: 'category', data: xs, boundaryGap: false,
      axisLabel: { fontSize: 9, color: cc.axisLabel, formatter: (v: string) => (v.slice(11) === '12:00' ? v.slice(5, 10) : '') } },
    yAxis: { type: 'value', name: p.unit, scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: (block.valueList || []).map((vals: number[], i: number) => ({
      name: legend[i] || `序列${i}`, type: 'line', smooth: false, showSymbol: false, connectNulls: true, sampling: 'lttb',
      lineStyle: { width: i === 1 ? 2.2 : 1.2, color: colors[i % 2] }, itemStyle: { color: colors[i % 2] },
      data: vals.slice(lo, hi)
    }))
  }, { notMerge: true })
}

function renderAll() {
  if (!data.value) return
  PANELS.forEach(renderPanel)
}

function exportCsv() {
  if (!data.value) return
  const [s, e] = range.value || ['', '']
  const fs = data.value.fs
  const fz = data.value.fz
  const wd = data.value.wd
  const nl: string[] = fs?.nameList || []
  let lo = nl.findIndex((n) => n.slice(0, 10) >= s); let hi = nl.findIndex((n) => n.slice(0, 10) > e)
  if (lo < 0) lo = 0; if (hi < 0) hi = nl.length
  const head = ['时间', '其他日平均风速', '运行日平均风速', '其他日平均辐照', '运行日平均辐照', '其他日平均温度', '运行日平均温度']
  const rows: (string | number | undefined)[][] = []
  for (let i = lo; i < hi; i++) {
    rows.push([nl[i], fs?.valueList?.[0]?.[i], fs?.valueList?.[1]?.[i], fz?.valueList?.[0]?.[i], fz?.valueList?.[1]?.[i], wd?.valueList?.[0]?.[i], wd?.valueList?.[1]?.[i]])
  }
  downloadCsv('气象预测', head, rows)
  ElMessage.success('已导出')
}

onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="qx" v-loading="loading">
    <ForecastIntro text="对比运行日与其他日的风速、辐照、温度走势，为新能源出力与负荷预测提供气象输入特征。" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <RegionDataBanner />
    <div class="toolbar">
      <span class="lbl">数据范围</span>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px" />
      <span class="lbl">运行日期</span>
      <el-select v-model="runDate" filterable size="small" style="width: 140px"><el-option v-for="d in allDates" :key="d" :label="d" :value="d" /></el-select>
      <el-button size="small" type="primary" @click="renderAll">搜索</el-button>
      <el-button size="small" @click="reset">重置</el-button>
      <span class="spacer" />
      <el-button size="small" color="#fc8452" @click="exportCsv">导出</el-button>
    </div>
    <el-card v-for="p in PANELS" :key="p.key" shadow="never" class="mb">
      <template #header><span style="font-weight:600;font-size:13px">{{ p.label }}（其他日平均 vs 运行日平均）</span></template>
      <div :ref="(el) => (refs[p.key].value = el)" class="chart chart-host"></div>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zgnrx/qxyc · 风速/辐照/温度 · 新能源出力的气象输入对比 -->
  </div>
</template>

<style scoped>
.qx { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: 13px; color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.chart { height: 220px; width: 100%; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
/* 移动端:筛选条纵排,控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar .spacer { display: none; }
}
</style>
