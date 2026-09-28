<script setup lang="ts">
// 关系分析共享工作台，zrxgx（价格×新能源）/ zrxgx2（价格×统调负荷）共用。
// 同一份 relation_scatter 契约数据，三视图切换：
// ① 总览热力图（默认）：小时 × 驱动量分箱 → 平均电价，一屏看价–量地形；
// ② 散点矩阵：24 张小时子图，每图叠最小二乘拟合线 + r²/斜率角标（保留原参考竖线）；
// ③ 敏感度概览条：24 根柱=各小时电价对驱动量的边际敏感度（元/(MWh·GW)）。
// 顶部 KPI 摘要（整体相关系数 / 最强·最弱相关时段 / 平均边际敏感度）先给结论。
// 差异（X 轴范围/参考线/能力门控/文案）经 props 注入；派生量走纯计算层 relationInsight.ts（带单测）。
import { computed, onMounted, ref, nextTick, watch, type ComponentPublicInstance } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { fetchMarketInsightRelationScatterContract } from '@/services/data/contracts'
import type { MarketInsightRelationKind } from '@/services/data/contracts/relationScatterAdapter'
import { onRegionChange } from '../../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { chartChrome } from '../../composables/useTheme'
import { useEChart } from '../../composables/useEChart'
import { useQuerySync } from '../../composables/useQuerySync'
import { emptyOverlay } from '@/services/chart/chartOptions'
import { seqColors } from '@/services/chart/chartStyle'
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import {
  RELATION_HOURS,
  heatmapMatrix,
  hourlyRegression,
  pointsForHour,
  sensitivityBars,
  summaryKpis
} from '@/services/analysis/relationInsight'
import type { RelationReferenceLine } from './relationTypes'

const props = defineProps<{
  kind: MarketInsightRelationKind
  routePath: string
  /** 驱动量轴名，如「新能源出力」「统调负荷」。 */
  xLabel: string
  /** 驱动量单位，如「MW」。 */
  xUnit: string
  /** 驱动量固定上界（新能源 14000）；不传则散点/热力自适应。 */
  xFixedMax?: number
  /** 热力图分箱数，默认 10。 */
  binCount?: number
  referenceLines: RelationReferenceLine[]
  /** AI 解读用页面标签。 */
  promptLabel: string
  /** AI 解读 payload 的 page 标识。 */
  promptPage: string
}>()

const DATE_COLORS = ['#c0392b', '#8e44ad', '#2980b9', '#16a085', '#27ae60', '#f39c12',
  '#d35400', '#7f8c8d', '#2c3e50', '#e84393', '#0984e3', '#6ab04c']

const loading = ref(true)
const error = ref('')
const runDate = ref('2026-06-02')
const days = ref(12)
const cols = ref(3)
const mode = ref<'rq' | 'ss'>('rq') // 日前 / 实时
const view = ref<'heatmap' | 'scatter' | 'sensitivity'>('heatmap')
const data = ref<any>(null)
const dates = ref<string[]>([])
// 版本守卫：切运行日/天数/口径/地区（或快速点两次「查询」）旧响应丢弃（#405 同族，#547）
const loadSeq = ref(0)

// 运行日/天数/列数/口径/视图 ⇄ 路由 query，刷新或分享链接后可还原
useQuerySync({ date: runDate, days, cols, mode, view })

// 24 张小时子图 + 热力图 + 敏感度条各一个 useEChart 句柄
const cellRefs = RELATION_HOURS.map(() => ref<HTMLElement | null>(null))
const cellCharts = RELATION_HOURS.map((_, i) => useEChart(cellRefs[i], { render: () => renderHour(i) }))
function setCellRef(i: number, el: Element | ComponentPublicInstance | null) {
  cellRefs[i].value = el as HTMLElement | null
}
const heatmapRef = ref<HTMLElement | null>(null)
const heatmapChart = useEChart(heatmapRef, { render: renderHeatmap })
const sensRef = ref<HTMLElement | null>(null)
const sensChart = useEChart(sensRef, { render: renderSensitivity })

const routeCapability = computed(() => getRegionCapabilityForPath(props.routePath, currentRegion.value.id))
const routeAvailable = computed(() => routeCapability.value?.status !== 'hidden')
function dimensionVisible(id?: string) {
  if (!id) return true
  const status = routeCapability.value?.module.subCapabilities
    ?.find((item) => item.id === id)
    ?.statusByRegion[currentRegion.value.id]
  return status !== 'hidden'
}
// 可见参考线（能力门控后）
const visibleRefLines = computed(() => props.referenceLines.filter((l) => dimensionVisible(l.dimensionId)))
const legendRefLines = computed(() => visibleRefLines.value.filter((l) => l.legendLabel))

// KPI 摘要
const kpi = computed(() => summaryKpis(data.value?.xd ?? [], days.value))
function fmtSlope(perMw: number) {
  return (perMw * 1000).toFixed(1) // 元/MWh per MW → per GW，读数更直观
}

async function loadData() {
  const seq = ++loadSeq.value
  loading.value = true; error.value = ''
  try {
    const contract = await fetchMarketInsightRelationScatterContract({
      kind: props.kind,
      region: currentRegion.value.id,
      runDate: runDate.value,
      days: days.value,
      priceMode: mode.value
    })
    if (seq !== loadSeq.value) return // 新轮已发起，丢弃旧响应（#405 同族，#547）
    data.value = routeAvailable.value ? contract.blocks.relation_scatter.dataset : null
    await nextTick()
    renderAll()
  } catch {
    if (seq !== loadSeq.value) return // 旧轮的错误不覆盖新轮（#405）
    // 失败时清空旧数据并重绘为空态，避免 ECharts 仍持上一轮（其它地区/日期）画布
    // 被误读为当前地区真实（清 data 后必须刷新三视图，否则旧散点残留）
    data.value = null
    dates.value = []
    error.value = `${currentRegion.value.name}关系数据加载失败（运行日 ${runDate.value}）`
    renderAll()
  } finally {
    if (seq === loadSeq.value) loading.value = false // 只有最新轮才关 loading（#405）
  }
}

// 视图① 热力图
function renderHeatmap() {
  const xd = data.value?.xd ?? []
  const m = heatmapMatrix(xd, { days: days.value, binCount: props.binCount ?? 10, binMax: props.xFixedMax })
  const cc = chartChrome()
  heatmapChart.setOption({
    ...emptyOverlay(!m.cells.length),
    tooltip: {
      position: 'top',
      formatter: (p: any) => {
        const [hi, bi, v] = p.value
        const cnt = m.counts[p.dataIndex]
        return `${m.xHours[hi]}:00 · ${props.xLabel} ${m.yBins[bi]} ${props.xUnit}<br/>平均电价 ${Math.round(v)} 元/MWh（${cnt} 天）`
      }
    },
    grid: { top: 12, bottom: 70, left: 100, right: 20 },
    xAxis: {
      type: 'category', data: m.xHours.map((h) => `${h}:00`), name: '小时', nameGap: 24,
      axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 1 }
    },
    yAxis: {
      type: 'category', data: m.yBins, name: `${props.xLabel}(${props.xUnit})`, nameGap: 74,
      axisLabel: { fontSize: 10, color: cc.axisLabel }
    },
    visualMap: {
      // calculable 关闭：拖拽手柄的数值标签会压在 X 轴刻度上（U8）；色条 + 低/电价高 文案已够表达映射
      min: m.min, max: m.max, calculable: false, orient: 'horizontal', left: 'center', bottom: 8,
      itemHeight: 100, inRange: { color: seqColors() }, text: ['电价高', '低'], textStyle: { color: cc.axisLabel }
    },
    series: [{ type: 'heatmap', data: m.cells, progressive: 2000, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 6 } } }]
  }, { notMerge: true })
}

// 视图② 散点矩阵（叠拟合线 + r²/斜率角标）
function renderHour(idx: number) {
  const d = data.value
  if (!d) { cellCharts[idx].setOption({ ...emptyOverlay(true) }, { notMerge: true }); return }
  const h = RELATION_HOURS[idx]
  const xd = (d.xd || []).slice(-days.value)
  const series: any[] = xd.map((row: any, di: number) => ({
    name: row.date, type: 'scatter', symbolSize: 9, z: 3,
    itemStyle: { color: DATE_COLORS[di % DATE_COLORS.length] },
    data: row['p' + h] ? [row['p' + h]] : []
  }))
  // 参考竖线（能力门控后）
  const lines = visibleRefLines.value
    .map((l) => {
      const src = (d[l.array] || [])[l.arrayIndex] || {}
      const x = src['p' + h]
      return x == null ? null : { xAxis: x, lineStyle: { color: l.color, width: l.width, type: 'solid' as const } }
    })
    .filter(Boolean)
  if (series.length && lines.length) {
    series[0].markLine = { symbol: 'none', silent: true, label: { show: false }, data: lines }
  }
  // 最小二乘拟合线
  const reg = hourlyRegression(d.xd || [], h, days.value)
  if (reg.n >= 2) {
    const xs = pointsForHour(d.xd || [], h, days.value).map((p) => p[0])
    const xMin = props.xFixedMax != null ? 0 : Math.min(...xs)
    const xMax = props.xFixedMax != null ? props.xFixedMax : Math.max(...xs)
    series.push({
      name: '拟合', type: 'line', showSymbol: false, silent: true, z: 2,
      lineStyle: { color: '#606266', width: 1.5, type: 'dashed' },
      data: [[xMin, reg.slope * xMin + reg.intercept], [xMax, reg.slope * xMax + reg.intercept]]
    })
  }
  const cc = chartChrome()
  const fitText = reg.n >= 2 ? `r²=${reg.r2.toFixed(2)}` : ''
  cellCharts[idx].setOption({
    ...emptyOverlay(!series.some((s: any) => s.type === 'scatter' && s.data.length)),
    title: [
      { text: `${h}:00`, left: 6, top: 2, textStyle: { fontSize: 12, color: '#303133' } },
      { text: fitText, right: 6, top: 2, textStyle: { fontSize: 11, fontWeight: 400 as const, color: reg.r >= 0 ? '#c0392b' : '#2980b9' } }
    ],
    grid: { left: 46, right: 12, top: 26, bottom: 20 },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => p.seriesName === '拟合'
        ? `拟合线`
        : `${p.seriesName}<br/>${props.xLabel} ${p.value[0]} ${props.xUnit} / 电价 ${p.value[1]} 元/MWh`
    },
    xAxis: props.xFixedMax != null
      ? { type: 'value', min: 0, max: props.xFixedMax, interval: props.xFixedMax / 4, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } }
      : { type: 'value', scale: true, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    yAxis: { type: 'value', min: 0, max: 1500, interval: 300, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

// 视图③ 敏感度概览条
function renderSensitivity() {
  const bars = sensitivityBars(data.value?.xd ?? [], days.value)
  const cc = chartChrome()
  sensChart.setOption({
    ...emptyOverlay(!bars.some((b) => b.n >= 2)),
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const b = bars[ps[0].dataIndex]
        return `${b.hour}:00<br/>边际敏感度 ${fmtSlope(b.slope)} 元/(MWh·GW)<br/>相关系数 r=${b.r.toFixed(2)}（${b.n} 天）`
      }
    },
    grid: { left: 64, right: 16, top: 20, bottom: 44 },
    xAxis: { type: 'category', data: bars.map((b) => `${b.hour}:00`), axisLabel: { fontSize: 10, color: cc.axisLabel, rotate: 45 } },
    yAxis: { type: 'value', name: '元/(MWh·GW)', nameTextStyle: { color: cc.axisLabel }, axisLabel: { color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: [{
      type: 'bar',
      data: bars.map((b) => ({
        value: b.n >= 2 ? Number(fmtSlope(b.slope)) : 0,
        itemStyle: { color: b.slope >= 0 ? '#c0392b' : '#2980b9', opacity: b.n >= 2 ? 1 : 0.25 }
      }))
    }]
  }, { notMerge: true })
}

function renderAll() {
  dates.value = ((data.value?.xd || []) as any[]).slice(-days.value).map((r: any) => r.date)
  renderHeatmap()
  RELATION_HOURS.forEach((_, i) => renderHour(i))
  renderSensitivity()
}

const ai = useAiSidebar()
// 「✨ 解读本页」：筛选切片 + 当前视图 + KPI 摘要（勿传 xd 逐日逐时散点全量）。
function insightContext(): Record<string, unknown> {
  const k = kpi.value
  return {
    page: `${props.promptLabel} (${props.promptPage})`,
    run_date: runDate.value,
    days: days.value,
    price_caliber: mode.value === 'rq' ? '日前价' : '实时价',
    active_view: view.value === 'heatmap' ? '总览热力图' : view.value === 'scatter' ? '散点矩阵' : '敏感度概览',
    dates_shown: dates.value,
    days_loaded: k.sampleDays,
    summary: {
      overall_r: Number(k.overallR.toFixed(3)),
      strongest_hour: k.strongestHour,
      weakest_hour: k.weakestHour,
      mean_marginal_sensitivity_yuan_per_mwh_gw: Number(fmtSlope(k.meanSlope))
    },
    chart: `X=${props.xLabel}(${props.xUnit})、Y=电价(元/MWh)；三视图：热力图(小时×出力→均价)/散点矩阵(叠拟合线)/敏感度条`,
    basis: 'captured'
  }
}

// 页面接入 AI 侧边栏：悬浮球、「✨ 解读本页」按钮共用这份声明与切片（点击时刻求值）。
defineAiPage({ label: props.promptLabel, promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function askInsight() {
  ai.interpret()
}

onMounted(loadData)
watch(runDate, loadData)                       // 换运行日 → 重新取数
watch(days, loadData)
watch(cols, () => nextTick(renderAll))         // 列数：纯布局，仅重绘
watch(mode, loadData)
// 切视图：被隐藏容器显示后 useEChart 的 ResizeObserver 会补 init，这里再显式重绘一次兜底
watch(view, () => nextTick(renderAll))
onRegionChange(loadData)
</script>

<template>
  <div class="rel" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="runDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" style="width: 150px" />
      <span class="lbl">天数</span>
      <el-input-number v-model="days" :min="1" :max="30" size="small" controls-position="right" style="width: 110px" />
      <span v-if="view === 'scatter'" class="lbl">列数</span>
      <el-input-number v-if="view === 'scatter'" v-model="cols" :min="1" :max="3" size="small" controls-position="right" style="width: 100px" />
      <el-radio-group v-model="mode" size="small" style="margin-left: 8px">
        <el-radio-button value="rq">日前</el-radio-button>
        <el-radio-button value="ss">实时</el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-radio-group v-model="view" size="small">
        <el-radio-button value="heatmap">总览热力图</el-radio-button>
        <el-radio-button value="scatter">散点矩阵</el-radio-button>
        <el-radio-button value="sensitivity">敏感度概览</el-radio-button>
      </el-radio-group>
      <el-button size="small" type="primary" @click="loadData">查询</el-button>
      <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
    </div>

    <!-- KPI 摘要：先给结论 -->
    <div class="kpis">
      <div class="kpi">
        <span class="k-lbl">整体相关系数 r</span>
        <span class="k-val" :class="kpi.overallR >= 0 ? 'up' : 'down'">{{ kpi.overallR.toFixed(3) }}</span>
      </div>
      <div class="kpi">
        <span class="k-lbl">最强相关时段</span>
        <span class="k-val">{{ kpi.strongestHour != null ? kpi.strongestHour + ':00' : '—' }}</span>
      </div>
      <div class="kpi">
        <span class="k-lbl">最弱相关时段</span>
        <span class="k-val">{{ kpi.weakestHour != null ? kpi.weakestHour + ':00' : '—' }}</span>
      </div>
      <div class="kpi">
        <span class="k-lbl">平均边际敏感度</span>
        <span class="k-val">{{ fmtSlope(kpi.meanSlope) }} <em>元/(MWh·GW)</em></span>
      </div>
      <div class="kpi">
        <span class="k-lbl">样本</span>
        <span class="k-val">{{ kpi.sampleDays }} 天 / {{ kpi.totalPoints }} 点</span>
      </div>
    </div>

    <!-- 图例：散点矩阵显示逐日色点；参考线图例三视图共用 -->
    <div class="legend" v-if="view === 'scatter' || legendRefLines.length">
      <template v-if="view === 'scatter'">
        <span v-for="(d, i) in dates" :key="d" class="lg">
          <span class="dot" :style="{ background: DATE_COLORS[i % DATE_COLORS.length] }"></span>{{ d.slice(5) }}
        </span>
        <span class="lg"><span class="fit-line"></span>拟合线</span>
      </template>
      <span v-for="l in legendRefLines" :key="l.legendLabel" class="vlg"><i :style="{ background: l.color }"></i>{{ l.legendLabel }}</span>
    </div>

    <!-- 视图①总览热力图 -->
    <div v-show="view === 'heatmap'" ref="heatmapRef" class="single chart-host"></div>
    <!-- 视图②散点矩阵 -->
    <div v-show="view === 'scatter'" class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
      <div v-for="(h, i) in RELATION_HOURS" :key="h" :ref="(el) => setCellRef(i, el)" class="subplot chart-host"></div>
    </div>
    <!-- 视图③敏感度概览条 -->
    <div v-show="view === 'sensitivity'" ref="sensRef" class="single chart-host"></div>
  </div>
</template>

<style scoped>
.rel { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.kpi { flex: 1 1 150px; background: var(--panel); border-radius: 8px; padding: 10px 14px; box-shadow: 0 1px 4px rgba(0,0,0,.04); display: flex; flex-direction: column; gap: 4px; }
.kpi .k-lbl { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.kpi .k-val { font-size: var(--font-18); font-weight: 700; color: var(--el-text-color-primary); }
.kpi .k-val em { font-size: var(--font-xs); font-weight: 400; font-style: normal; color: var(--el-text-color-secondary); }
.kpi .k-val.up { color: #c0392b; }
.kpi .k-val.down { color: #2980b9; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 14px; background: var(--panel); border-radius: 8px; padding: 8px 12px; margin-top: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.lg { font-size: var(--font-sm); color: var(--el-text-color-regular); display: inline-flex; align-items: center; }
.dot { width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
.fit-line { width: 16px; height: 0; border-top: 1.5px dashed #606266; margin-right: 4px; display: inline-block; }
.vlg { font-size: var(--font-sm); color: var(--el-text-color-regular); display: inline-flex; align-items: center; }
.vlg i { width: 14px; height: 3px; margin-right: 4px; display: inline-block; }
.single { background: var(--panel); border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.04); height: 560px; margin-top: 12px; padding: 8px; }
.grid { display: grid; gap: 10px; margin-top: 12px; }
.subplot { background: var(--panel); border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.04); height: 220px; }
.mb { margin-bottom: 12px; }

@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar .spacer { display: none; }
  .grid { grid-template-columns: 1fr !important; }
}
</style>
