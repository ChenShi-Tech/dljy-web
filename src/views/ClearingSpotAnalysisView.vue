<script setup lang="ts">
// 出清现货电量分析 (zcqxhdl) — 精修版。是「数据分析」的出清现货放大版:连续时序、多轴叠加。
// 市场洞察出清契约返回 timePoints + series[]，保持连续时序、多轴叠加。
// 4 轴:0 电量(左,MWh) | 1 价格(右,0-1500) | 2 比率(右,0-2) | 3 价格差(右,-1500~1500)。
// 差异点(对照线上):运行日期=区间(控横轴) / 对比日期=单日(竖线对比) / 价格差用红柱 / 主策略用圆点标值 / Y轴可隐藏。
import { computed, onMounted, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchMarketInsightClearingSpotContract,
  type MarketInsightClearingSpotBlock
} from '@/services/data/contracts'
import { getRegionCapabilityForPath, type RegionCapabilityDataSupport } from '@/services/region/regionModules'
import { onRegionChange } from '../composables/useRegionReload'
import { isMockActive } from '@/services/mock/session'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilityDegradedCard from '../components/CapabilityDegradedCard.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import TrustBadge from '@/components/common/TrustBadge.vue'
import type { DataSourceBasis } from '@/services/data/types'

const COLOR: Record<string, string> = {
  '日前价出清': '#4472C4', '实时价出清': '#70AD1F', '主策略': '#ED7D31',
  '日前出清现货电量': '#934294', '实时出清现货电量': '#ED7D31', '日前负荷预测': '#9bc2e6',
  '系统负荷实际值': '#70ad47', '市场日前申报策略': '#ED1C24', '实际与负荷比值': '#7f7f7f', '价格差': '#ec0000'
}
// 4 轴配置(固定坐标范围对照线上)
const AXES = [
  { name: '电量', pos: 'left', off: 0, fixed: null as any },
  { name: '价格', pos: 'right', off: 0, fixed: [0, 1500], interval: 150 },
  { name: '比率', pos: 'right', off: 58, fixed: [0, 2], interval: 0.2 },
  { name: '价格差', pos: 'right', off: 116, fixed: [-1500, 1500], interval: 300 }
]

// tooltip 单位按 yAxisIndex 映射:0 电量 / 1 价格 / 2 比率(无量纲) / 3 价格差
const AXIS_UNITS = ['MWh', '元/MWh', '', '元/MWh']

const loading = ref(true)
const error = ref('')
const chartRef = ref<HTMLDivElement | null>(null)
const mainChart = useEChart(chartRef, { render })

const clearing = ref<MarketInsightClearingSpotBlock | null>(null)
// 决策口径（trustGate）：从回放信封 provenance/mock 归一出 basis，供 TrustBadge 与 askInsight 同源。
const dataBasis = ref<DataSourceBasis>('captured')
const allDates = ref<string[]>([]) // 数据覆盖的日期(去重)
const runRange = ref<[string, string] | null>(null) // 运行日期(区间)
const route = useRoute()
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
const compareDate = ref('') // 对比日期(单日)
const fixedAxis = ref(true)
const hideAxis = ref(false)
// 精简视角（U7）：默认只显示 电量(0)+价格(1) 轴与其系列，比率(2)/价格差(3) 收进「完整视角」开关
const compactAxes = ref(true)
// 对比日期同步至 URL(运行日期区间沿用上方手写 from/to 还原逻辑)
useQuerySync({ compare: compareDate })

const dateOf = (s: string) => String(s).slice(0, 10)
// #2991：sdpt_zcqxhdl/__list__ 是山西公司专属清单（后端注册表 datasetOwners），只有山西
// 可以读。非山西地区（云南/广东/四川…）本页停用：不发请求、不画空图，显示停用说明卡。
const isClearingRegionSupported = computed(() => currentRegion.value.id === 'shanxi')
const CLEARING_DISABLED_NOTE =
  '旧出清电量实现已停用：原实现读取的是山西公司专属清单，不代表云南全省出清（本页在所有非山西地区停用，不再跨地区读取）。获权场站的申报、出清与实际对照将在「场站市场表现」中提供。'
const routeCapability = computed(() => getRegionCapabilityForPath('/sjfx/zcqxhdl', currentRegion.value.id))
const clearingDegradedSupports = computed<RegionCapabilityDataSupport[]>(() => {
  const cap = routeCapability.value
  if (!cap) return []
  const supports = cap.route?.dataSupportByRegion?.[currentRegion.value.id]
    ?? cap.module.dataSupportByRegion[currentRegion.value.id]
    ?? []
  return supports.filter((item) => item.expectation !== 'real')
})
// 防止切地区时旧地区慢响应覆盖新地区出清状态（#415）。
let loadGeneration = 0

async function load(range?: { dateFrom?: string; dateTo?: string }) {
  const generation = ++loadGeneration
  error.value = ''
  // #2991：非山西地区直接进停用态——不发请求（客户端层也有一道防御），不渲染图表。
  if (!isClearingRegionSupported.value) {
    loading.value = false
    clearViewState()
    // 停用态没有任何数据：诚实空态，不是合成数据。
    dataBasis.value = 'empty'
    renderEmptyChart()
    return
  }
  loading.value = true
  clearViewState()
  renderEmptyChart()
  mainChart.showLoading()
  try {
    const contract = await fetchMarketInsightClearingSpotContract({
      region: currentRegion.value.id,
      dateFrom: range?.dateFrom,
      dateTo: range?.dateTo
    })
    if (generation !== loadGeneration) return
    dataBasis.value = contract.basis
    clearing.value = contract.blocks.clearing_spot
    if (!clearing.value.series.length) {
      clearViewState()
      renderEmptyChart('无 series 数据')
      throw new Error('无 series 数据')
    }
    const ds = Array.from(new Set(clearing.value.timePoints.map(dateOf))).sort() as string[]
    allDates.value = ds
    // 默认展示最近 14 天；按所选区间重取时保留用户选择
    if (range?.dateFrom && range?.dateTo) {
      runRange.value = [range.dateFrom, range.dateTo]
    } else if (!range) {
      const endD = ds[ds.length - 1]
      const startD = ds[Math.max(0, ds.length - 14)]
      runRange.value = urlRange ?? [startD, endD]
    }
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
      mainChart.hideLoading()
    }
  }
}

function clearViewState() {
  clearing.value = null
  dataBasis.value = 'captured'
  allDates.value = []
  runRange.value = null
}

function renderEmptyChart(text = '暂无数据') {
  mainChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function disabledOut(date: Date) {
  // 演示会话：日期不限于采集窗——窗外区间由合成分支按 dateFrom/dateTo 补数
  if (isMockActive()) return false
  if (!allDates.value.length) return false
  const s = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return s < allDates.value[0] || s > allDates.value[allDates.value.length - 1]
}

// 演示会话：所选运行区间/对比日超出当前数据覆盖时，按区间向 mock 重取
// （__list__ 合成分支按 dateFrom/dateTo 生成，单次上限 90 天，超宽向前钳制）
watch([runRange, compareDate], () => {
  if (!isMockActive()) return
  const picks = [runRange.value?.[0], runRange.value?.[1], compareDate.value || ''].filter(Boolean) as string[]
  if (!picks.length || !allDates.value.length) return
  const lo = picks.reduce((a, b) => (b < a ? b : a))
  const hi = picks.reduce((a, b) => (b > a ? b : a))
  if (lo >= allDates.value[0] && hi <= allDates.value[allDates.value.length - 1]) return
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const end = new Date(`${hi}T00:00:00`)
  const start = new Date(`${lo}T00:00:00`)
  const clamped = new Date(end.getTime() - 85 * 86400000)
  void load({ dateFrom: fmt(start < clamped ? clamped : start), dateTo: hi })
})

function render() {
  if (!clearing.value) return
  const cc = chartChrome()
  const d = clearing.value
  const names = d.series.map((item) => item.name)
  const axOf = d.series.map((item) => item.yAxisIndex)
  const nameList = d.timePoints

  // 按运行日期区间裁剪
  let lo = 0, hi = nameList.length
  if (runRange.value) {
    const [s, e] = runRange.value
    lo = nameList.findIndex((n) => dateOf(n) >= s)
    hi = nameList.findIndex((n) => dateOf(n) > e)
    if (lo < 0) lo = 0
    if (hi < 0) hi = nameList.length
  }
  const xs = nameList.slice(lo, hi)

  // 精简视角（U7）：默认只保留 电量(0)+价格(1) 轴，比率(2)/价格差(3) 轴与其系列隐藏
  const axisVisible = (ax: number) => !hideAxis.value && (!compactAxes.value || ax === 0 || ax === 1)

  // Y 轴
  const yAxis = AXES.map((a, i) => {
    const base: any = {
      type: 'value', name: hideAxis.value ? '' : a.name,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      position: a.pos, offset: a.off,
      show: axisVisible(i),
      axisLine: { show: !hideAxis.value, lineStyle: { color: cc.splitLine } },
      axisTick: { show: !hideAxis.value },
      axisLabel: { show: !hideAxis.value, color: cc.axisLabel, fontSize: 10 },
      splitLine: { show: i === 0 && !hideAxis.value, lineStyle: { color: cc.splitLine } }
    }
    if (fixedAxis.value && a.fixed) { base.min = a.fixed[0]; base.max = a.fixed[1]; base.interval = a.interval }
    else base.scale = true
    return base
  })

  // 对比日期竖线
  let markLine: any = undefined
  if (compareDate.value) {
    const idx = xs.findIndex((n) => n === `${compareDate.value} 12:00`)
    const idx2 = idx >= 0 ? idx : xs.findIndex((n) => dateOf(n) === compareDate.value)
    if (idx2 >= 0) markLine = { silent: true, symbol: 'none', lineStyle: { color: '#ff9800', type: 'dashed', width: 1.5 },
      label: { formatter: `对比 ${compareDate.value.slice(5)}`, color: '#ff9800', fontSize: 10, position: 'insideEndTop' },
      data: [{ xAxis: idx2 }] }
  }

  const series = names.map((name, i) => {
    const ax = Number(axOf[i] ?? 0)
    const color = COLOR[name] || '#888'
    const data = (d.series[i]?.values || []).slice(lo, hi)
    if (name === '价格差') {
      // 价格差:红色柱状(正负同色,对照线上)
      return { name, type: 'bar', yAxisIndex: ax, itemStyle: { color }, large: true, barMaxWidth: 6,
        data, ...(markLine ? { markLine } : {}) }
    }
    if (name === '主策略') {
      // 主策略:圆点标值(类似水滴)
      return { name, type: 'line', yAxisIndex: ax, showSymbol: true, symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 1, color, opacity: 0.5 }, itemStyle: { color }, data }
    }
    return { name, type: 'line', yAxisIndex: ax, showSymbol: false, sampling: 'lttb',
      lineStyle: { width: 1.6, color }, itemStyle: { color }, data,
      ...(markLine && i === 0 ? { markLine } : {}) }
  })

  // 系列单位按其所属 Y 轴推导(电量/价格/比率/价格差)
  const units: Record<string, string> = {}
  names.forEach((nm, i) => { units[nm] = AXIS_UNITS[Number(axOf[i] ?? 0)] || '' })

  // 精简视角：隐藏轴上的系列一并移出绘图与图例（tooltip units 仍保留全量映射）
  const visibleIdx = names.map((_, i) => i).filter((i) => axisVisible(Number(axOf[i] ?? 0)))
  const visibleNames = visibleIdx.map((i) => names[i])
  const visibleSeries = visibleIdx.map((i) => series[i])

  mainChart.setOption({
    tooltip: { ...axisTooltip({ units }), confine: true },
    // 底部布局:工具栏右下角,图例顶部居中 scroll
    toolbox: bottomToolbox('出清现货电量分析', 8),
    legend: bottomLayoutLegend({ data: visibleNames, itemWidth: 18, itemHeight: 8, textStyle: { fontSize: 11 } }),
    grid: { left: hideAxis.value ? 16 : 64, right: hideAxis.value ? 24 : (compactAxes.value ? 64 : 178), top: 56, bottom: 56, containLabel: hideAxis.value },
    dataZoom: [{ type: 'inside' }],
    xAxis: {
      type: 'category', data: xs, boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 10,
        // U1：interval 回调强制只在每天 12:00 的类目打刻度，日期标签按天稳定显示
        // （原实现只靠 formatter 放行 12:00，自动抽稀几乎不落在 12:00 → 整条轴无标签）
        interval: (index: number, value: string) => String(value).slice(11) === '12:00',
        formatter: (v: string) => (String(v).slice(11) === '12:00' ? String(v).slice(5, 10) : '') },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis, series: visibleSeries,
    ...emptyOverlay(!xs.length)
  }, { notMerge: true })
}

const ai = useAiSidebar()
// 「✨ 解读本页」：当前运行区间/对比日 + 序列图例 + 区间天数作摘要（勿传全量 series）。
function insightContext(): Record<string, unknown> {
  const d = clearing.value
  const names = d?.series.map((item) => item.name) || []
  const dates = allDates.value
  let inRange = dates.length
  if (runRange.value) { const [s, e] = runRange.value; inRange = dates.filter((x) => x >= s && x <= e).length }
  return {
    page: '出清现货电量分析 (zcqxhdl)',
    run_range: runRange.value,
    compare_date: compareDate.value || null,
    days_in_range: inRange,
    series: names,
    axes: ['电量(MWh)', '价格(元/MWh)', '实际/负荷比值', '价格差(元/MWh)'],
    axis_mode: fixedAxis.value ? '坐标固定' : '坐标自动',
    basis: dataBasis.value
  }
}

// 页面接入 AI 侧边栏：悬浮球、「✨ 解读本页」按钮共用这份声明与切片（点击时刻求值）。
defineAiPage({ label: '出清现货电量分析', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function askInsight() {
  ai.interpret()
}

onMounted(load)
watch([runRange, compareDate, fixedAxis, hideAxis, compactAxes], render, { deep: true })

onRegionChange(load)
</script>

<template>
  <div class="a3" v-loading="loading">
    <RegionDataBanner />
    <!-- #2991：非山西地区显示停用说明卡（不发请求、不画空图），山西保持原出清图不动 -->
    <CapabilityDegradedCard
      v-if="!isClearingRegionSupported"
      title="出清电量分析在当前地区已停用"
      :region-name="currentRegion.name"
      :note="CLEARING_DISABLED_NOTE"
      :supports="clearingDegradedSupports"
    />
    <template v-else>
      <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
      <div class="toolbar">
        <span class="lbl">运行日期</span>
        <el-date-picker v-model="runRange" type="daterange" value-format="YYYY-MM-DD" unlink-panels
          range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small"
          :clearable="false" :disabled-date="disabledOut" style="width: 240px" />
        <span class="lbl">对比日期</span>
        <el-date-picker v-model="compareDate" type="date" value-format="YYYY-MM-DD" size="small"
          placeholder="选择对比日" clearable :disabled-date="disabledOut" style="width: 150px" />
        <span class="spacer" />
        <el-button size="small" type="primary" @click="fixedAxis = !fixedAxis">{{ fixedAxis ? '坐标自动' : '坐标固定' }}</el-button>
        <el-button size="small" type="primary" @click="hideAxis = !hideAxis">{{ hideAxis ? '显示Y轴' : '隐藏Y轴' }}</el-button>
        <el-button size="small" :type="compactAxes ? 'default' : 'primary'" @click="compactAxes = !compactAxes">{{ compactAxes ? '完整视角' : '精简视角' }}</el-button>
        <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
        <TrustBadge :basis="dataBasis" prefix="决策口径" />
      </div>
      <div class="chart-card">
        <div ref="chartRef" class="chart chart-host"></div>
        <!-- 数据源(内部参考,勿对外展示)：市场洞察出清现货契约 ｜ 4 轴：电量(左)·价格·比率·价格差(右) ｜ ~ -->
      </div>
    </template>
  </div>
</template>

<style scoped>
.a3 { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.chart-card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px 12px; margin-top: 12px;
  height: 640px; display: flex; flex-direction: column; }
.chart { flex: 1; width: 100%; min-height: 0; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 4px 0 0; }
.src code { color: var(--el-color-primary); }
.mb { margin-bottom: 12px; }
/* 移动端:筛选条纵排,图表卡片降高 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .chart-card { height: 320px; }
}
</style>
