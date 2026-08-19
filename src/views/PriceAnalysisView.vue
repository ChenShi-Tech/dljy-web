<script setup lang="ts">
// 价格分析 (zrsjg / zcqxhdl listrs) — 精修版,对照线上 A8.png:左大 3D 电价图 + 右上时点切面 + 右下日期切面。
// 顶部:运行日期(区间) + 日前价/实时价 勾选(控制三图显示哪类)。
// 数据经市场洞察价格分析契约归一为 averageCurves / dayCurves / dailyStats。
//   3D: 选定日期区间内每天的 96 点价格曲线(时间×日期×价格);时点切面=平均日内;日期切面=按天 max/min/avg。
import { onMounted, onBeforeUnmount, onActivated, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import 'echarts-gl'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchMarketInsightPriceAnalysisContract,
  type PriceCurveViewModel,
  type PriceDailyStatViewModel,
  type PriceMarket
} from '@/services/data/contracts'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { usePageInsight } from '../composables/usePageInsight'
import { PAGE_PROMPT_KEYS } from '@/prompts'

const POINTS_96 = Array.from({ length: 96 }, (_, i) => {
  const m = (i + 1) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})
const curve = (row: PriceCurveViewModel) => row.points
const TYPE: Record<'rq' | 'ss', PriceMarket> = { rq: 'rq', ss: 'ss' } // 日前出清 / 实时出清

const loading = ref(true)
const error = ref('')
const showRq = ref(true)
const showSs = ref(true)
const dateRange = ref<[string, string] | null>(null)
const route = useRoute()
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
// 与 from/to 同模式补充还原:rq=0/ss=0 表示隐藏对应价类
if (route.query.rq === '0') showRq.value = false
if (route.query.ss === '0') showSs.value = false
const allDates = ref<string[]>([])
const averageCurves = ref<PriceCurveViewModel[]>([]) // 平均日内(日前/实时,96点) → 时点切面
const dailyStats = ref<PriceDailyStatViewModel[]>([]) // 逐日汇总(max/min/avg) → 日期切面
const dayCurves = ref<PriceCurveViewModel[]>([]) // 逐日明细(96点价格曲线/日) → 3D
const d3Ref = ref<HTMLDivElement | null>(null)
const tRef = ref<HTMLDivElement | null>(null)
const dRef = ref<HTMLDivElement | null>(null)
let d3Chart: echarts.ECharts | null = null // 3D 图(echarts-gl)保留手动管理
let d3Ro: ResizeObserver | null = null // 容器尺寸变化（侧栏折叠/列宽变化）触发 echarts-gl resize；window.resize 不覆盖这些场景
// 两个 2D 切面图迁入 useEChart,同组 connect:tooltip/缩放跨图联动
const tHandle = useEChart(tRef, { render: renderTimeSlice, group: 'price-analysis' })
const dHandle = useEChart(dRef, { render: renderDateSlice, group: 'price-analysis' })
// 防止切地区时旧地区慢响应覆盖新地区价格状态（roborev job415）。
let loadGeneration = 0

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyCharts()
  tHandle.showLoading(); dHandle.showLoading()
  try {
    const contract = await fetchMarketInsightPriceAnalysisContract({ region: currentRegion.value.id })
    if (generation !== loadGeneration) return
    const block = contract.blocks.price_analysis
    averageCurves.value = block.averageCurves
    dailyStats.value = block.dailyStats
    dayCurves.value = block.dayCurves
    allDates.value = block.dates
    const n = allDates.value.length
    if (!n) {
      error.value = '暂无可用日期数据'
      clearViewState()
      renderEmptyCharts('暂无可用日期数据')
      return
    }
    dateRange.value = urlRange ?? [allDates.value[Math.max(0, n - 7)], allDates.value[n - 1]]
    await nextTick()
    if (generation !== loadGeneration) return
    renderAll()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyCharts(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      tHandle.hideLoading(); dHandle.hideLoading()
    }
  }
}

function clearViewState() {
  dateRange.value = null
  allDates.value = []
  averageCurves.value = []
  dailyStats.value = []
  dayCurves.value = []
}

function renderEmptyCharts(text = '暂无数据') {
  if (d3Ref.value) {
    if (!d3Chart || d3Chart.isDisposed()) d3Chart = echarts.init(d3Ref.value)
    d3Chart.setOption({ ...emptyOverlay(true, text) }, true)
  } else if (d3Chart && !d3Chart.isDisposed()) {
    d3Chart.clear()
  }
  tHandle.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
  dHandle.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function selectedDates(): string[] {
  if (!dateRange.value) return allDates.value
  const [s, e] = dateRange.value
  return allDates.value.filter((d) => d >= s && d <= e)
}
function renderAll() { render3D(); renderTimeSlice(); renderDateSlice() }

// 每条线一个独立颜色(按色相均匀分布)
function palette(n: number) {
  return Array.from({ length: n }, (_, i) => `hsl(${Math.round((i * 360) / Math.max(1, n))}, 68%, 48%)`)
}

// 左:3D 电价图(时间×日期×价格)。每个"日期-类型"=一条独立颜色的线。
function render3D() {
  if (!d3Ref.value) return
  if (!d3Chart) d3Chart = echarts.init(d3Ref.value)
  const dates = selectedDates()
  // 按日期分组:每天先日前后实时,保证图例顺序 + 每条独立颜色。
  const items: { row: any; label: string }[] = []
  dates.forEach((dt) => {
    if (showRq.value) { const r = dayCurves.value.find((x) => x.market === TYPE.rq && x.date === dt); if (r) items.push({ row: r, label: '日前价' }) }
    if (showSs.value) { const r = dayCurves.value.find((x) => x.market === TYPE.ss && x.date === dt); if (r) items.push({ row: r, label: '实时价' }) }
  })
  const colors = palette(items.length)
  // 轴交换(对照线上):X=日期(category) Y=时间(value 0-24) Z=价格;每条线沿时间在某一天扫出当日价格曲线
  const series = items.map((it, i) => {
    const di = dates.indexOf(it.row.date)
    return {
      name: `${it.row.date}-${it.label}`, type: 'line3D', lineStyle: { width: 2, color: colors[i] },
      data: curve(it.row).map((v, k) => [di, (k + 1) * 0.25, v]) // [日期idx, 小时, 价格]
    }
  })
  const legend = series.map((s) => s.name)
  d3Chart.setOption({
    color: colors,
    tooltip: {},
    legend: { type: 'plain', top: 4, left: 8, right: 8, data: legend, itemWidth: 16, itemHeight: 8, textStyle: { fontSize: 10 } },
    xAxis3D: { type: 'category', name: '日期', data: dates, axisLabel: { fontSize: 9 } },
    yAxis3D: { type: 'value', name: '时间', min: 0, max: 24, interval: 4, axisLabel: { formatter: '{value}:00' } },
    zAxis3D: { type: 'value', name: '价格', min: 0 },
    grid3D: { boxWidth: 90, boxDepth: 90, boxHeight: 88, top: 64,
      viewControl: { alpha: 18, beta: 30, distance: 180, autoRotate: false },
      light: { main: { intensity: 1.1 }, ambient: { intensity: 0.4 } } },
    series,
    ...emptyOverlay(!series.length || !dates.length)
  }, true)
}

// 右上:时点切面(日前均价/实时均价,96 点)
function renderTimeSlice() {
  const cc = chartChrome()
  const series: any[] = []
  const rq = averageCurves.value.find((r) => r.market === TYPE.rq)
  const ss = averageCurves.value.find((r) => r.market === TYPE.ss)
  if (showRq.value && rq) series.push({ name: '日前均价', type: 'line', step: 'start', showSymbol: false, lineStyle: { color: '#4472C4', width: 2 }, itemStyle: { color: '#4472C4' }, data: curve(rq) })
  if (showSs.value && ss) series.push({ name: '实时均价', type: 'line', step: 'start', showSymbol: false, lineStyle: { color: '#70AD1F', width: 2 }, itemStyle: { color: '#70AD1F' }, data: curve(ss) })
  tHandle.setOption({
    title: { text: '时点切面 · 日内均价', left: 8, top: 4, textStyle: { fontSize: 12, color: '#303133' } },
    legend: { top: 26, left: 'center', type: 'scroll', data: series.map((s) => s.name), textStyle: { fontSize: 11 } },
    toolbox: bottomToolbox('时点切面-日内均价', 8),
    tooltip: axisTooltip({ unit: '元/MWh' }),
    dataZoom: insideZoom(),
    grid: { left: 52, right: 16, top: 56, bottom: 48 },
    xAxis: { type: 'category', data: POINTS_96, boundaryGap: false, axisLabel: { interval: 15, fontSize: 9, color: cc.axisLabel } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series,
    ...emptyOverlay(!series.length)
  }, { notMerge: true })
}

// 右下:日期切面(按天 日前/实时 的 最大/最小/平均)
function renderDateSlice() {
  const cc = chartChrome()
  const dates = selectedDates()
  const stat = (type: PriceMarket, pk: 'max' | 'min' | 'avg') =>
    dates.map((dt) => {
      const row = dailyStats.value.find((r) => r.market === type && r.date === dt)
      return row ? (row[pk] ?? null) : null
    })
  const series: any[] = []
  const add = (cond: boolean, name: string, type: PriceMarket, pk: 'max' | 'min' | 'avg', color: string, dash = false) => {
    if (cond) series.push({ name, type: 'line', smooth: false, showSymbol: false, lineStyle: { color, width: 1.8, type: dash ? 'dashed' : 'solid' }, itemStyle: { color }, data: stat(type, pk) })
  }
  add(showRq.value, '日前价-最大', TYPE.rq, 'max', '#4472C4', true)
  add(showRq.value, '日前价-最小', TYPE.rq, 'min', '#9bc2e6', true)
  add(showRq.value, '日前价-平均', TYPE.rq, 'avg', '#2e4d8e')
  add(showSs.value, '实时价-最大', TYPE.ss, 'max', '#70AD1F', true)
  add(showSs.value, '实时价-最小', TYPE.ss, 'min', '#a9d18e', true)
  add(showSs.value, '实时价-平均', TYPE.ss, 'avg', '#375623')
  dHandle.setOption({
    title: { text: '日期切面 · 逐日极值/均值', left: 8, top: 4, textStyle: { fontSize: 12, color: '#303133' } },
    legend: { top: 26, left: 'center', type: 'scroll', data: series.map((s) => s.name), textStyle: { fontSize: 10 } },
    toolbox: bottomToolbox('日期切面-逐日极值均值', 8),
    tooltip: axisTooltip({ unit: '元/MWh' }),
    dataZoom: insideZoom(),
    grid: { left: 52, right: 16, top: 70, bottom: 48 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 9, color: cc.axisLabel, formatter: (v: string) => v.slice(5) } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series,
    ...emptyOverlay(!series.length || !dates.length)
  }, { notMerge: true })
}

const { askPage } = usePageInsight(PAGE_PROMPT_KEYS.marketDataAnalysis)
// 「✨ 解读本页」：当前日期区间 + 勾选价类 + 日前/实时逐日极值均值统计作摘要（勿传逐日96点全量）。
function askInsight() {
  const dates = selectedDates()
  const set = new Set(dates)
  const summarize = (type: PriceMarket) => {
    const rows = dailyStats.value.filter((r) => r.market === type && set.has(r.date))
    const nums = (k: 'max' | 'min' | 'avg') => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number')
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null)
    const maxes = nums('max'); const mins = nums('min'); const avgs = nums('avg')
    return {
      avg_of_daily_avg: avg(avgs),
      peak_of_daily_max: maxes.length ? Math.round(Math.max(...maxes)) : null,
      trough_of_daily_min: mins.length ? Math.round(Math.min(...mins)) : null,
      unit: '元/MWh'
    }
  }
  askPage('价格分析', {
    page: '价格分析 (zrsjg)',
    date_range: dateRange.value,
    days_selected: dates.length,
    show: { dayahead: showRq.value, realtime: showSs.value },
    dayahead_price: showRq.value ? summarize(TYPE.rq) : null,
    realtime_price: showSs.value ? summarize(TYPE.ss) : null,
    basis: 'captured'
  })
}

// 3D 图(echarts-gl)保留手动 resize/dispose;两个切面图由 useEChart 托管
function onResize() { d3Chart?.resize() }
onMounted(() => {
  load()
  window.addEventListener('resize', onResize)
  // 高度改为 flex 撑满后，侧栏折叠/列宽变化不触发 window.resize，用 ResizeObserver 兜底
  d3Ro = new ResizeObserver(() => d3Chart?.resize())
  if (d3Ref.value) d3Ro.observe(d3Ref.value)
})
// keep-alive 缓存（AppLayout :max=20）切回时若尺寸已变，触发一次 resize（2D 切面图由 useEChart 已自带）
onActivated(() => { nextTick(() => d3Chart?.resize()) })
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  d3Ro?.disconnect(); d3Ro = null
  d3Chart?.dispose()
})
watch([showRq, showSs, dateRange], renderAll, { deep: true })

onRegionChange(load)
</script>

<template>
  <div class="pa" v-loading="loading">
    <RegionDataBanner />
    <CapabilitySupportBadge path="/sjfx/zrsjg" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~"
        start-placeholder="开始" end-placeholder="结束" size="small" :clearable="false" style="width: 240px" />
      <el-checkbox v-model="showRq" label="日前价" border size="small" style="margin-left: 8px" />
      <el-checkbox v-model="showSs" label="实时价" border size="small" />
      <span class="spacer" />
      <el-button size="small" type="primary" @click="renderAll">查询</el-button>
      <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
    </div>
    <div class="body">
      <div class="card big">
        <div class="ctitle">3D 电价图（时间 × 日期 × 价格）</div>
        <div ref="d3Ref" class="chart3d chart-host"></div>
      </div>
      <div class="side">
        <div class="card"><div ref="tRef" class="chart-s chart-host"></div></div>
        <div class="card"><div ref="dRef" class="chart-s chart-host"></div></div>
      </div>
    </div>
    <!-- 数据源(内部参考,勿对外展示)：市场洞察价格分析契约 ｜ 日前/实时出清价 ｜ ~ -->
  </div>
</template>

<style scoped>
.pa { padding: 12px 16px; background: var(--el-fill-color-light); height: calc(100vh - 100px); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.body { display: grid; grid-template-columns: 7fr 3fr; gap: 12px; margin-top: 12px; flex: 1; min-height: 0; }
.card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px 12px; }
.ctitle { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-primary); padding: 2px 0 4px; }
.big { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.chart3d { flex: 1; width: 100%; min-height: 0; }
.side { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.side .card { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.chart-s { flex: 1; width: 100%; min-height: 0; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
.mb { margin-bottom: 12px; }
/* 窄屏:左右布局退化为上下;移动端筛选条纵排。
   桌面定高+overflow:hidden 会截断单列内容，窄屏恢复页面自然滚动。 */
@media (max-width: 1024px) {
  .pa { height: auto; min-height: calc(100vh - 100px); overflow: visible; }
  .body { grid-template-columns: 1fr; flex: none; }
  /* 单列下 3D 图与切面图给回固定高度，避免 flex 拉伸异常 */
  .chart3d { height: 560px; }
  .chart-s { height: 274px; }
}
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
}
</style>
