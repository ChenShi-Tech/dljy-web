<script setup lang="ts">
// 云南现货交易驾驶舱（xhjy/yunnan/cockpit）：自包含深色交易终端面板。
//
// 移植 prototype/spot-cockpit.html 的布局 + scoped CSS + ECharts option builder，
// 把「拟真数据」换成真实数据服务 cockpitData.loadCockpit 返回（中广核云南厂侧私有 PG 节点电价
// + 损益/结算 captured）。七大模块：① 市场态势 KPI、② 价格热力场、③ 选定节点基差、
// ④ 负价雷达+弃发建议、⑤ 损益归因瀑布、⑥ 申报偏差体检、⑦ 预测精度擂台/损失诊断 + 决策清单/持仓敞口。
//
// 纪律：云南严格地区 · 真实或空。无真实数据 → ingest-hint 空态（提示 import:spot-export --write），
// 绝不伪造、绝不标「模拟数据」冒充、绝不回退别地区。视觉跟随 app 全局主题（classic/neon/paper/arc）：
// scoped --ck-* 令牌映射主题变量、图表 chrome 走 chartChrome() 按 render 取色；数据语义色不随主题变。
//
// 诚实标注：③ 基差为「选定节点」(非自有，capture 无 self-owned 维度)；⑦ 默认展示
// yn_plant_output 厂站 8 源 vs 实际功率 MAPE 擂台，yn_loss_attribution 厂站损失排行保留为互补视图。
import { computed, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import { Gauge } from 'lucide-vue-next'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import type { DataBasis } from '@/services/dataBasis'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { useEChart } from '@/composables/useEChart'
import { chartChrome } from '@/composables/useTheme'
import { onRegionChange } from '@/composables/useRegionReload'
import { COCKPIT_PRIVATE_FAMILIES, loadCockpit, type CockpitData, type DecisionItem } from '@/services/cockpitData'
import { hasCgnYunnanPriceEntitlement } from '@/services/market/cgnYunnanLivePrice'
import type { PlantForecastArena } from '@/services/market/plantForecastArena'
import type { SpotMarket } from '@/services/market/spotClient'
import { exportCsv } from '@/utils/exportCsv'
import { exportBundleCsv, type CsvTable } from '@/utils/exportBundle'
import { ElMessage } from 'element-plus'

// 宿主注入:融合页 /dashboard(embedded=true,内嵌去边框)与云南工作台 cockpit tab
// (embedded=false,standalone 终端)共用此组件。regionName/regionId 由宿主从
// currentRegion 传入,组件不再自读全局地区;onRegionChange 仍触发 reload 读最新 prop。
const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
  regionName: string
  regionId: string
  initialDate?: string
  initialMarket?: SpotMarket
  embedded?: boolean
}>(), {
  title: '云南现货作战台',
  subtitle: 'DLJY Spot Decision Terminal',
  initialDate: '2026-05-01',
  initialMarket: 'da',
  embedded: false
})

const WAN = 10000

// ── 节点价来源标注（必须与实际取数路径同源）──────────────────────────────
// spotClient 的改写规则是「云南 + /node-price/ + 账号属中广核云南」才走厂侧专属
// 端点，否则**静默落到公共节点价端点**（刻意设计，避免向专属端点制造 403）。
// 标注若写死成「厂侧 PG」，非中广核账号读到的是公共数据、页面却宣称是某家公司的
// 私有经营数据——来源错标（#1791）。判定复用 spotClient 同一个谓词，不另立一套。
const usesCgnPrivatePrice = computed(
  () => props.regionId === 'yunnan' && hasCgnYunnanPriceEntitlement(),
)
// 厂侧链路是上游实时推送 → real；公共节点价是已入库的历史行情回放 → captured。
// 两者都是决策级口径，切换不改变任何权限或功能，只让标签说实话。
const nodePriceBasis = computed<DataBasis>(() => (usesCgnPrivatePrice.value ? 'real' : 'captured'))

// ── 控件状态 ──
const date = ref(props.initialDate) // 默认 2026-05-01,宿主可经 initialDate 注入
const market = ref<SpotMarket>(props.initialMarket)
const marketOptions = [
  { value: 'da' as SpotMarket, label: '日前 DA' },
  { value: 'rt' as SpotMarket, label: '实时 RT' }
]

// ── 数据 / 态 ──
const data = ref<CockpitData | null>(null)
const loading = ref(false)
let reloadReqId = 0
const errorMsg = ref('')
const ingestHint = ref(false)

// ── ECharts chrome（轴/网格/文字/tooltip）随当前主题 ──
// 每个 builder 在 render 内调用 axisX/axisY/tt/ttfix，函数体内取 chartChrome()，故 useEChart
// 主题切换 dispose 重建并重调 render 时自动拿到新色。数据系列语义色（青/琥珀/绿/红/金）不走此层。
const baseGrid = { left: 46, right: 18, top: 18, bottom: 26 }
function axisX(data: string[], opt: Record<string, unknown> = {}) {
  const c = chartChrome()
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: c.splitLine } },
    axisLabel: { color: c.axisLabel, fontSize: 10 },
    axisTick: { show: false },
    ...opt
  }
}
function axisY(opt: Record<string, unknown> = {}) {
  const c = chartChrome()
  return {
    type: 'value',
    splitLine: { lineStyle: { color: c.splitLine } },
    axisLabel: { color: c.axisLabel, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    ...opt
  }
}
function tt() {
  const c = chartChrome()
  return {
    backgroundColor: c.tooltipBg,
    borderColor: c.tooltipBorder,
    textStyle: { color: c.tooltipText, fontSize: 11 },
    axisPointer: { lineStyle: { color: c.neutralLine }, crossStyle: { color: c.neutralLine } }
  }
}
function ttfix() {
  const c = chartChrome()
  return { backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, textStyle: { color: c.tooltipText, fontSize: 11 } }
}

function hourLabel(i: number) {
  return String(i).padStart(2, '0') + ':00'
}

// ── 图表容器 + 实例（每图一个 useEChart；主题切换由 useEChart dispose 重建 + 重调 render 跟随）──
const heatmapEl = ref<HTMLElement | null>(null)
const basisEl = ref<HTMLElement | null>(null)
const negEl = ref<HTMLElement | null>(null)
const waterfallEl = ref<HTMLElement | null>(null)
const deviationEl = ref<HTMLElement | null>(null)
const forecastEl = ref<HTMLElement | null>(null)
const exposureEl = ref<HTMLElement | null>(null)

const heatChart = useEChart(heatmapEl, { render: () => renderHeatmap() })
const basisChart = useEChart(basisEl, { render: () => renderBasis() })
const negChart = useEChart(negEl, { render: () => renderNeg() })
const waterfallChart = useEChart(waterfallEl, { render: () => renderWaterfall() })
const deviationChart = useEChart(deviationEl, { render: () => renderDeviation() })
// ⑦ 双视图：arena=厂站 8 源 MAPE 擂台（默认，yn_plant_output）/ loss=厂站预测损失排行
const diagMode = ref<'arena' | 'loss'>('arena')
const arena = ref<PlantForecastArena | null>(null)
const arenaLoading = ref(false)
const selectedArenaSource = ref<string | null>(null)
const forecastChart = useEChart(forecastEl, { render: () => renderDiag() })
const exposureChart = useEChart(exposureEl, { render: () => renderExposure() })

const selectedArenaTrend = computed(() => {
  const a = arena.value
  if (!a) return { source: null, times: [], actual: [], forecast: [] }
  const source = selectedArenaSource.value
  return source ? a.trends[source] ?? a.trend : a.trend
})
const selectedArenaMetric = computed(() => {
  const source = selectedArenaSource.value
  if (!source) return null
  return arena.value?.sources.find((item) => item.source === source) ?? null
})

function syncArenaSelection(next: PlantForecastArena | null) {
  if (!next?.hasData || !next.sources.length) {
    selectedArenaSource.value = null
    return
  }
  const sourceSet = new Set(next.sources.map((item) => item.source))
  if (selectedArenaSource.value && sourceSet.has(selectedArenaSource.value)) return
  selectedArenaSource.value = next.trend.source ?? next.sources[0]?.source ?? null
}

function selectArenaSource(source: string) {
  selectedArenaSource.value = source
  renderDiag()
}

function onArenaSourceChange() {
  renderDiag()
}

// ── ② 价格热力场（节点 × 时段，piecewise 发散配色）──
function renderHeatmap() {
  const m = data.value?.heatmap
  if (!m || !m.hasData) {
    heatChart.setOption({ title: emptyTitle('当日暂无节点电价热力数据') }, { notMerge: true })
    return
  }
  const nodes = m.nodes
  const times = m.timePoints
  // 矩阵展平为 [timeIdx, nodeIdx, value]，null 跳过。
  const points: Array<[number, number, number]> = []
  for (let r = 0; r < m.matrix.length; r++) {
    const row = m.matrix[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue
      points.push([c, r, Math.round(Number(v))])
    }
  }
  // x 轴只标整点（每 4 个 15min 点 = 1 小时，96 点）。
  const xLabel = (v: string) => (String(v).endsWith(':00') ? String(v) : '')
  heatChart.setOption(
    {
      tooltip: {
        ...ttfix(),
        formatter: (p: { value?: [number, number, number] }) => {
          const val = p.value
          if (!val) return ''
          const [c, r, v] = val
          return `${nodes[r] ?? ''}　${times[c] ?? ''}<br/>电价 <b style="color:${v < 0 ? '#fb5e7e' : '#34d399'}">${v} 元/MWh</b>`
        }
      },
      grid: { left: 110, right: 16, top: 12, bottom: 56, containLabel: false },
      xAxis: axisX(times, {
        splitArea: { show: false },
        axisLabel: { color: chartChrome().axisLabel, fontSize: 9, interval: 0, formatter: xLabel }
      }),
      yAxis: { ...axisY(), type: 'category', data: nodes, axisLabel: { color: chartChrome().axisLabel, fontSize: 10, width: 96, overflow: 'truncate' } },
      visualMap: {
        type: 'piecewise',
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 8,
        itemWidth: 13,
        itemHeight: 11,
        textStyle: { color: chartChrome().axisLabel, fontSize: 10 },
        pieces: [
          { lt: -30, color: '#8c1733', label: '≤−30' },
          { gte: -30, lt: 0, color: '#d04668', label: '−30~0' },
          { gte: 0, lt: 120, color: '#26354a', label: '0~120' },
          { gte: 120, lt: 280, color: '#1f7a72', label: '120~280' },
          { gte: 280, lt: 480, color: '#2fa06f', label: '280~480' },
          { gte: 480, lt: 720, color: '#41c486', label: '480~720' },
          { gte: 720, color: '#85e6ad', label: '≥720' }
        ]
      },
      series: [
        {
          type: 'heatmap',
          data: points,
          progressive: 2000,
          itemStyle: { borderColor: chartChrome().tooltipBg, borderWidth: 0.5 },
          emphasis: { itemStyle: { borderColor: chartChrome().axisLabel, borderWidth: 1 } }
        }
      ]
    },
    { notMerge: true }
  )
}

// ── ③ 基差（选定节点价 vs 系统均价 + 面积 + 0 线）──
function renderBasis() {
  const b = data.value?.basis
  if (!b || !b.hasData) {
    basisChart.setOption({ title: emptyTitle('该节点当日暂无序列') }, { notMerge: true })
    return
  }
  const labels = b.timePoints
  const nodeLabel = (b.node ?? '选定节点') + '价'
  basisChart.setOption(
    {
      tooltip: { ...tt(), trigger: 'axis', valueFormatter: (v: unknown) => `${v} 元` },
      legend: {
        data: [nodeLabel, '系统均价'],
        right: 10,
        top: 4,
        textStyle: { color: chartChrome().axisLabel, fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8
      },
      grid: { ...baseGrid, top: 30 },
      xAxis: axisX(labels, { axisLabel: { color: chartChrome().axisLabel, fontSize: 9, interval: 11 } }),
      yAxis: axisY({ scale: true }),
      series: [
        { name: '系统均价', type: 'line', step: 'end', data: b.systemAvg, symbol: 'none', lineStyle: { width: 1.5, color: '#38bdf8' } },
        {
          name: nodeLabel,
          type: 'line',
          step: 'end',
          data: b.nodePrices,
          symbol: 'none',
          lineStyle: { width: 1.8, color: '#34d399' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(52,211,153,.22)' },
              { offset: 1, color: 'rgba(52,211,153,0)' }
            ])
          }
        },
        { type: 'line', data: b.nodePrices.map(() => 0), symbol: 'none', lineStyle: { width: 1, color: '#fb5e7e', type: 'dashed', opacity: 0.5 } }
      ]
    },
    { notMerge: true }
  )
}

// ── ④ 负价雷达（红线 + markArea 高亮弃发窗口；移除与 markArea 冲突的 visualMap）──
function renderNeg() {
  const n = data.value?.negRadar
  if (!n || !n.hasData) {
    negChart.setOption({ title: emptyTitle('该节点当日暂无序列') }, { notMerge: true })
    return
  }
  const markArea = n.window
    ? {
        itemStyle: { color: 'rgba(251,94,126,.12)', borderColor: 'rgba(251,94,126,.4)', borderWidth: 1 },
        data: [
          [
            { xAxis: n.window.startTime, label: { show: true, position: 'top', color: '#fb5e7e', fontSize: 10, formatter: '建议弃发' } },
            { xAxis: n.window.endTime }
          ]
        ]
      }
    : undefined
  negChart.setOption(
    {
      tooltip: { ...tt(), trigger: 'axis', valueFormatter: (v: unknown) => `${v} 元` },
      grid: { ...baseGrid, top: 16 },
      xAxis: axisX(n.timePoints, { axisLabel: { color: chartChrome().axisLabel, fontSize: 9, interval: 11 } }),
      yAxis: axisY({ scale: true }),
      series: [
        {
          type: 'line',
          step: 'end',
          data: n.prices,
          symbol: 'none',
          lineStyle: { width: 1.8, color: '#fb5e7e' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(251,94,126,.28)' },
              { offset: 0.5, color: 'rgba(251,94,126,.05)' },
              { offset: 1, color: 'rgba(91,107,133,0)' }
            ])
          },
          ...(markArea ? { markArea } : {}),
          markLine: { symbol: 'none', data: [{ yAxis: 0, lineStyle: { color: '#fb5e7e', type: 'solid', opacity: 0.6 } }], label: { show: false } }
        }
      ]
    },
    { notMerge: true }
  )
}

// ── ⑤ 损益归因瀑布（transparent-stack；原始价值 → 减三段 → 实现）──
function renderWaterfall() {
  const w = data.value?.waterfall
  if (!w || !w.hasData) {
    waterfallChart.setOption({ title: emptyTitle('当前范围暂无损益归因数据') }, { notMerge: true })
    return
  }
  // 万元口径。瀑布：理论(原始价值) → 策略/预测/电网损失(下降) → 实现(从0起)。
  const wf = [
    { n: '原始价值', v: w.originalValue == null ? 0 : w.originalValue / WAN, t: 'total' as const },
    { n: '策略损失', v: w.strategyLoss == null ? 0 : -(w.strategyLoss / WAN), t: 'loss' as const },
    { n: '预测损失', v: w.forecastLoss == null ? 0 : -(w.forecastLoss / WAN), t: 'loss' as const },
    { n: '电网损失', v: w.gridLoss == null ? 0 : -(w.gridLoss / WAN), t: 'loss' as const },
    { n: '实现损益', v: w.realized == null ? 0 : w.realized / WAN, t: 'final' as const }
  ]
  const base: number[] = []
  const up: (number | string)[] = []
  const down: (number | string)[] = []
  let run = 0
  wf.forEach((d) => {
    if (d.t === 'total') {
      base.push(0)
      up.push(+d.v.toFixed(2))
      down.push('-')
      run = d.v
    } else if (d.t === 'final') {
      base.push(0)
      up.push(+d.v.toFixed(2))
      down.push('-')
    } else if (d.v >= 0) {
      base.push(run)
      up.push(+d.v.toFixed(2))
      down.push('-')
      run += d.v
    } else {
      run += d.v
      base.push(run)
      down.push(+(-d.v).toFixed(2))
      up.push('-')
    }
  })
  waterfallChart.setOption(
    {
      tooltip: {
        ...ttfix(),
        formatter: (p: Array<{ dataIndex?: number }>) => {
          const d = wf[p[0]?.dataIndex ?? 0]
          const color = d.v < 0 ? '#fb5e7e' : d.t === 'loss' ? '#93a1b8' : '#34d399'
          const sign = d.v > 0 && d.t !== 'loss' ? '+' : ''
          return `${d.n}<br/><b style="color:${color}">${sign}${d.v.toFixed(2)} 万元</b>`
        }
      },
      grid: { ...baseGrid, top: 14, bottom: 24 },
      xAxis: axisX(wf.map((d) => d.n), { axisLabel: { color: chartChrome().axisLabel, fontSize: 10, interval: 0 } }),
      yAxis: axisY({ axisLabel: { color: chartChrome().axisLabel, fontSize: 10, formatter: '{value}万' } }),
      series: [
        { type: 'bar', stack: 't', itemStyle: { color: 'transparent' }, data: base, silent: true, barWidth: '46%' },
        {
          type: 'bar',
          stack: 't',
          barWidth: '46%',
          data: up.map((v, i) => ({ value: v, itemStyle: { color: wf[i].t === 'total' ? '#38bdf8' : '#34d399' } })),
          label: { show: true, position: 'top', color: '#34d399', fontSize: 10, formatter: (p: { value?: number | string }) => (p.value === '-' ? '' : '+' + p.value) }
        },
        {
          type: 'bar',
          stack: 't',
          barWidth: '46%',
          data: down.map((v) => ({ value: v, itemStyle: { color: '#fb5e7e' } })),
          label: { show: true, position: 'bottom', color: '#fb5e7e', fontSize: 10, formatter: (p: { value?: number | string }) => (p.value === '-' ? '' : '−' + p.value) }
        }
      ]
    },
    { notMerge: true }
  )
}

// ── ⑥ 申报偏差体检（双轴：偏差电量柱 + 偏差电费线）──
function renderDeviation() {
  const dev = data.value?.deviation
  if (!dev || !dev.hasData) {
    deviationChart.setOption({ title: emptyTitle('当前范围暂无申报偏差数据') }, { notMerge: true })
    return
  }
  const days = dev.days
  const x = days.map((d) => d.date.slice(5))
  const worstIdx = dev.worstDay ? days.findIndex((d) => d.date === dev.worstDay!.date) : -1
  deviationChart.setOption(
    {
      tooltip: { ...tt(), trigger: 'axis' },
      legend: {
        data: ['日前偏差电量', '实时偏差电量', '日前偏差电费', '实时偏差电费'],
        top: 2,
        textStyle: { color: chartChrome().axisLabel, fontSize: 9 },
        itemWidth: 11,
        itemHeight: 7
      },
      grid: { ...baseGrid, top: 30, right: 48 },
      xAxis: axisX(x),
      yAxis: [
        axisY({ name: 'MWh', nameTextStyle: { color: chartChrome().axisLabel, fontSize: 9 } }),
        axisY({ name: '万元', position: 'right', nameTextStyle: { color: chartChrome().axisLabel, fontSize: 9 }, splitLine: { show: false } })
      ],
      series: [
        // #1755：缺测 null → ECharts 断点（曲线断开、柱不显示），不按假零 0 绘制。
        { name: '日前偏差电量', type: 'bar', data: days.map((d) => (d.daDevEnergy == null ? null : +d.daDevEnergy.toFixed(1))), barWidth: 7, itemStyle: { color: '#38bdf8' } },
        {
          name: '实时偏差电量',
          type: 'bar',
          barWidth: 7,
          data: days.map((d, i) => ({ value: d.rtDevEnergy == null ? null : +d.rtDevEnergy.toFixed(1), itemStyle: { color: i === worstIdx ? '#fb5e7e' : '#fbbf24' } }))
        },
        { name: '日前偏差电费', type: 'line', yAxisIndex: 1, data: days.map((d) => (d.daDevFee == null ? null : +(d.daDevFee / WAN).toFixed(2))), smooth: false, symbol: 'circle', symbolSize: 4, lineStyle: { color: '#38bdf8', width: 1.3 }, itemStyle: { color: '#38bdf8' } },
        { name: '实时偏差电费', type: 'line', yAxisIndex: 1, data: days.map((d) => (d.rtDevFee == null ? null : +(d.rtDevFee / WAN).toFixed(2))), smooth: false, symbol: 'circle', symbolSize: 4, lineStyle: { color: '#fbbf24', width: 1.3 }, itemStyle: { color: '#fbbf24' } }
      ]
    },
    { notMerge: true }
  )
}

// ── ⑦ 预测诊断分发（arena 厂站 8 源 MAPE 擂台 / loss 厂站损失排行）──
function renderDiag() {
  if (diagMode.value === 'arena') renderArena()
  else renderForecast()
}

async function setDiagMode(mode: 'arena' | 'loss') {
  diagMode.value = mode
  if (mode === 'arena' && !arena.value && !arenaLoading.value) await ensureArena()
  renderDiag()
}

async function ensureArena() {
  const loaded = data.value?.forecastArena
  if (loaded) {
    arena.value = loaded
  } else {
    arena.value = {
      hasData: false,
      date: date.value,
      sourceCount: 0,
      actualSource: null,
      sources: [],
      trends: {},
      trend: { source: null, times: [], actual: [], forecast: [] }
    }
  }
  arenaLoading.value = false
  syncArenaSelection(arena.value)
  renderDiag()
}

// ── ⑦a 厂站 8 源 MAPE 擂台（柱：源排行；线：最佳预测源 vs 实际功率）──
function renderArena() {
  const a = arena.value
  if (arenaLoading.value) {
    forecastChart.setOption({ title: emptyTitle('计算 8 源预测 MAPE…') }, { notMerge: true })
    return
  }
  if (!a || !a.hasData) {
    forecastChart.setOption({ title: emptyTitle('暂无厂站 8 源出力数据（yn_plant_output）') }, { notMerge: true })
    return
  }
  const rank = [...a.sources].reverse()
  const names = rank.map((m) => m.source)
  const mape = rank.map((m) => m.mape)
  const trend = selectedArenaTrend.value
  const actualName = `实际 · ${a.actualSource ?? '实际功率'}`
  const forecastName = `对比 · ${trend.source ?? '手选源'}`
  const hourly = (v: string) => (String(v).endsWith(':00') ? String(v) : '')
  const rankHeight = Math.min(106, Math.max(72, rank.length * 13))
  const lineTop = rankHeight + 52
  const barWidth = rank.length > 7 ? 8 : 10
  forecastChart.setOption(
    {
      tooltip: {
        ...ttfix(),
        trigger: 'axis',
        formatter: (ps: Array<{ seriesName?: string; name?: string; value?: number | null; dataIndex?: number }> | { seriesName?: string; name?: string; value?: number | null; dataIndex?: number }) => {
          const list = Array.isArray(ps) ? ps : [ps]
          const head = list[0]?.name ?? ''
          const bar = list.find((p) => p.seriesName === 'MAPE排行')
          if (bar?.dataIndex !== undefined) {
            const row = rank[bar.dataIndex]
            if (row) {
              const mapeText = row.mape == null ? '—' : `${row.mape}%`
              const rmseText = row.rmseMw == null ? '—' : `${row.rmseMw} MW`
              const biasText = row.biasMw == null ? '—' : `${row.biasMw} MW`
              return `${row.source}（${row.roleLabel}）<br/>MAPE <b>${mapeText}</b><br/>RMSE <b>${rmseText}</b><br/>平均偏差 <b>${biasText}</b><br/>有效点 ${row.samples} / MAPE点 ${row.mapeSamples}`
            }
          }
          return `${head}<br/>` + list.map((p) => `${p.seriesName}: <b>${p.value == null ? '—' : p.value + ' MW'}</b>`).join('<br/>')
        }
      },
      legend: {
        data: ['MAPE排行', actualName, forecastName],
        top: 0,
        right: 2,
        textStyle: { color: chartChrome().axisLabel, fontSize: 9 },
        itemWidth: 10,
        itemHeight: 8
      },
      grid: [
        { left: 76, right: 18, top: 24, height: rankHeight },
        { left: 42, right: 18, top: lineTop, height: 72 }
      ],
      xAxis: [
        {
          type: 'value',
          gridIndex: 0,
          axisLabel: { color: chartChrome().axisLabel, fontSize: 9, formatter: '{value}%' },
          splitLine: { lineStyle: { color: chartChrome().splitLine, type: 'dashed' as const } },
          axisLine: { show: false },
          axisTick: { show: false }
        },
        {
          type: 'category',
          gridIndex: 1,
          data: trend.times,
          axisLine: { lineStyle: { color: chartChrome().splitLine } },
          axisTick: { show: false },
          axisLabel: { color: chartChrome().axisLabel, fontSize: 9, interval: 7, formatter: hourly }
        }
      ],
      yAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: names,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: chartChrome().axisLabel, fontSize: 10, width: 66, overflow: 'truncate' }
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'MW',
          nameTextStyle: { color: chartChrome().axisLabel, fontSize: 9 },
          axisLabel: { color: chartChrome().axisLabel, fontSize: 9 },
          splitLine: { lineStyle: { color: chartChrome().splitLine, type: 'dashed' as const } },
          axisLine: { show: false },
          axisTick: { show: false },
          scale: true
        }
      ],
      series: [
        {
          name: 'MAPE排行',
          type: 'bar',
          xAxisIndex: 0,
          yAxisIndex: 0,
          barWidth,
          data: mape.map((v, i) => ({
            value: v,
            itemStyle: { color: i === rank.length - 1 ? '#34d399' : '#3a587a', borderRadius: [0, 3, 3, 0] }
          })),
          label: { show: true, position: 'right', color: chartChrome().axisLabel, fontSize: 9, formatter: (p: { value?: number | null }) => p.value == null ? '—' : `${p.value}%` }
        },
        {
          name: actualName,
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          step: 'end',
          smooth: false,
          connectNulls: false,
          showSymbol: false,
          data: trend.actual,
          lineStyle: { width: 2, color: '#34d399', type: 'solid' },
          itemStyle: { color: '#34d399' }
        },
        {
          name: forecastName,
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          step: 'end',
          smooth: false,
          connectNulls: false,
          showSymbol: false,
          data: trend.forecast,
          lineStyle: { width: 1.8, color: '#38bdf8', type: 'dashed' },
          itemStyle: { color: '#38bdf8' }
        }
      ]
    },
    { notMerge: true }
  )
}

// ── ⑦b 预测损失诊断（横向条，大者红色靠前）──
function renderForecast() {
  const f = data.value?.forecastDiag
  if (!f || !f.hasData) {
    forecastChart.setOption({ title: emptyTitle('暂无预测损失数据') }, { notMerge: true })
    return
  }
  // 横向条 inverse：大者在上；万元口径。
  const ranking = [...f.ranking].slice(0, 6).reverse() // 反转使最大值在顶部（inverse:true 配合）
  const names = ranking.map((r) => r.plant)
  const vals = ranking.map((r) => +(r.value / WAN).toFixed(2))
  const maxIdx = vals.reduce((mi, v, i, arr) => (v > arr[mi] ? i : mi), 0)
  forecastChart.setOption(
    {
      tooltip: { ...ttfix(), formatter: (p: { name?: string; value?: number }) => `${p.name}<br/>预测损失 <b style="color:#fb5e7e">${p.value} 万元</b>` },
      grid: { left: 76, right: 40, top: 8, bottom: 8 },
      xAxis: axisY({ axisLabel: { show: false }, splitLine: { show: false } }),
      yAxis: axisX(names, { axisLabel: { color: chartChrome().axisLabel, fontSize: 10 }, inverse: true }),
      series: [
        {
          type: 'bar',
          barWidth: 11,
          data: vals.map((v, i) => ({ value: v, itemStyle: { color: i === maxIdx ? '#fb5e7e' : '#3a587a', borderRadius: [0, 3, 3, 0] } })),
          label: { show: true, position: 'right', color: chartChrome().axisLabel, fontSize: 10, formatter: '{c}万' }
        }
      ]
    },
    { notMerge: true }
  )
}

function emptyTitle(text: string) {
  return {
    text,
    left: 'center',
    top: 'middle',
    textStyle: { color: chartChrome().axisLabel, fontSize: 12, fontWeight: 'normal' as const }
  }
}

// ── 持仓敞口曲线（逐日敞口 + 套保率，captured 真实派生）──
function renderExposure() {
  const s = data.value?.exposureSeries ?? []
  if (!s.length) {
    exposureChart.setOption({ title: emptyTitle('暂无结算敞口序列') }, { notMerge: true })
    return
  }
  const c = chartChrome()
  const dates = s.map((p) => p.date.slice(5)) // MM-DD
  exposureChart.setOption(
    {
      tooltip: { ...tt(), trigger: 'axis' },
      legend: { data: ['敞口', '套保率'], textStyle: { color: c.axisLabel, fontSize: 10 }, top: 0, right: 8 },
      grid: { ...baseGrid, right: 44, top: 26 },
      xAxis: axisX(dates),
      yAxis: [
        axisY({ name: 'MWh' }),
        axisY({ name: '套保率%', position: 'right', splitLine: { show: false } })
      ],
      series: [
        {
          name: '敞口',
          type: 'bar',
          data: s.map((p) => ({
            value: p.openMwh,  // #1755：null → ECharts 断点（缺测不画 0 柱）
            itemStyle: { color: p.openMwh != null && p.openMwh >= 0 ? 'rgba(251,94,126,0.6)' : 'rgba(52,211,153,0.6)' }
          }))
        },
        {
          name: '套保率',
          type: 'line',
          yAxisIndex: 1,
          smooth: false,
          showSymbol: false,
          lineStyle: { color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          data: s.map((p) => +(p.coverage * 100).toFixed(1))
        }
      ]
    },
    { notMerge: true }
  )
}

function renderAll() {
  renderHeatmap()
  renderBasis()
  renderNeg()
  renderWaterfall()
  renderDeviation()
  renderDiag()
  renderExposure()
}

// ── 导出（CSV / XLSX；瀑布/申报偏差/敞口序列/预测损失排行四表，captured 真实数据）──
function buildExportSheets() {
  const d = data.value
  const wf = d?.waterfall
  const waterfallRows: (string | number)[][] = [['项目', '金额(万元)']]
  if (wf?.hasData) {
    waterfallRows.push(['原始价值', wf.originalValue == null ? '' : +(wf.originalValue / WAN).toFixed(2)])
    waterfallRows.push(['策略损失', wf.strategyLoss == null ? '' : -+(wf.strategyLoss / WAN).toFixed(2)])
    waterfallRows.push(['预测损失', wf.forecastLoss == null ? '' : -+(wf.forecastLoss / WAN).toFixed(2)])
    waterfallRows.push(['电网损失', wf.gridLoss == null ? '' : -+(wf.gridLoss / WAN).toFixed(2)])
    waterfallRows.push(['实现价值', wf.realized == null ? '' : +(wf.realized / WAN).toFixed(2)])
  }
  const devRows: (string | number)[][] = [
    ['日期', '日前偏差电量(MWh)', '实时偏差电量(MWh)', '日前偏差电费(元)', '实时偏差电费(元)']
  ]
  for (const day of d?.deviation.days ?? []) {
    // #1755：缺测 null → 空串（不写假零 0）
    devRows.push([day.date, day.daDevEnergy ?? '', day.rtDevEnergy ?? '', day.daDevFee ?? '', day.rtDevFee ?? ''])
  }
  const expRows: (string | number)[][] = [
    ['日期', '中长期电量(MWh)', '总电量(MWh)', '敞口(MWh)', '套保率(%)']
  ]
  for (const p of d?.exposureSeries ?? []) {
    // #1755：缺测 null → 空串（不写假零 0）
    expRows.push([p.date, p.ltm ?? '', p.total ?? '', p.openMwh ?? '', +(p.coverage * 100).toFixed(1)])
  }
  const rankRows: (string | number)[][] = [['厂站', '预测损失(万元)']]
  for (const r of d?.forecastDiag.ranking ?? []) rankRows.push([r.plant, +(r.value / WAN).toFixed(2)])
  return { waterfallRows, devRows, expRows, rankRows }
}

function exportCockpitCsv() {
  if (!data.value?.hasAnyData) {
    ElMessage.warning('暂无可导出的数据')
    return
  }
  const { waterfallRows, devRows, expRows, rankRows } = buildExportSheets()
  const tag = `云南现货驾驶舱_${date.value}`
  if (waterfallRows.length > 1) exportCsv(`${tag}_损益瀑布`, waterfallRows[0] as string[], waterfallRows.slice(1))
  if (devRows.length > 1) exportCsv(`${tag}_申报偏差`, devRows[0] as string[], devRows.slice(1))
  if (expRows.length > 1) exportCsv(`${tag}_敞口序列`, expRows[0] as string[], expRows.slice(1))
  if (rankRows.length > 1) exportCsv(`${tag}_预测损失排行`, rankRows[0] as string[], rankRows.slice(1))
  ElMessage.success('已导出 CSV')
}

async function exportCockpitXlsx() {
  if (!data.value?.hasAnyData) {
    ElMessage.warning('暂无可导出的数据')
    return
  }
  const { waterfallRows, devRows, expRows, rankRows } = buildExportSheets()
  const { exportWorkbook } = await import('@/utils/exportExcel')
  exportWorkbook(`云南现货驾驶舱_${date.value}`, [
    { name: '损益瀑布', rows: waterfallRows },
    { name: '申报偏差', rows: devRows },
    { name: '敞口序列', rows: expRows },
    { name: '预测损失排行', rows: rankRows }
  ])
  ElMessage.success('已导出 Excel')
}

// B4 批量导出打包：四表 CSV 打包成一个 .zip（jszip 懒加载）
async function exportCockpitZip() {
  if (!data.value?.hasAnyData) {
    ElMessage.warning('暂无可导出的数据')
    return
  }
  const { waterfallRows, devRows, expRows, rankRows } = buildExportSheets()
  const tables: CsvTable[] = []
  const push = (name: string, rows: (string | number)[][]) => {
    if (rows.length > 1) tables.push({ name, header: rows[0] as string[], rows: rows.slice(1) })
  }
  push('损益瀑布', waterfallRows)
  push('申报偏差', devRows)
  push('敞口序列', expRows)
  push('预测损失排行', rankRows)
  await exportBundleCsv(`云南现货驾驶舱_${date.value}`, tables)
  ElMessage.success('已导出 ZIP（四表打包）')
}

function onExportCmd(c: string) {
  if (c === 'csv') exportCockpitCsv()
  else if (c === 'xlsx') exportCockpitXlsx()
  else if (c === 'zip') exportCockpitZip()
}

// ── KPI / 决策清单展示派生 ──
const kpis = computed(() => data.value?.kpis ?? null)
const decisions = computed<DecisionItem[]>(() => data.value?.decisions ?? [])
const position = computed(() => data.value?.position ?? null)

function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const decisionIcon: Record<DecisionItem['kind'], string> = {
  risk: '⚑',
  tune: '📉',
  opp: '🎯',
  audit: '⚖'
}

// ── 加载 ──
async function reload() {
  const reqId = ++reloadReqId
  loading.value = true
  errorMsg.value = ''
  ingestHint.value = false
  try {
    const result = await loadCockpit({
      regionName: props.regionName,
      regionId: props.regionId,
      date: date.value,
      market: market.value
    })
    if (reqId !== reloadReqId) return
    data.value = result
    arena.value = result.forecastArena
    syncArenaSelection(result.forecastArena)
    if (result.errors.length) errorMsg.value = result.errors.join('；')
    if (!result.hasAnyData && !result.errors.length) ingestHint.value = true
    renderAll()
  } catch (e) {
    if (reqId !== reloadReqId) return
    data.value = null
    arena.value = null
    syncArenaSelection(null)
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (reqId === reloadReqId) loading.value = false
  }
}

function onMarketChange() {
  void reload()
}
function onDateChange() {
  void reload()
}

onMounted(() => {
  void reload()
})

onRegionChange(() => {
  void reload()
})
</script>

<template>
  <div class="cockpit" :class="{ embedded: props.embedded }">
    <div class="cockpit-banner">
      <RegionDataBanner :families="COCKPIT_PRIVATE_FAMILIES" />
    </div>

    <!-- Header -->
    <header class="ck-header">
      <div class="brand">
        <div class="logo">闪</div>
        <div>
          <h1>{{ props.title }}</h1>
          <div class="sub">{{ props.subtitle }}</div>
        </div>
      </div>
      <div class="spacer"></div>
      <div class="ctrls">
        <span class="basis-wrap"><DataBasisBadge :basis="nodePriceBasis" prefix="节点价" /></span>
        <span
          v-if="usesCgnPrivatePrice"
          class="private-price-source"
          title="cgn-yunnan-data-api-v1；固定中广核云南账号/主体/地区，不回落公共节点价"
        >
          厂侧 PG · 非电网官方
        </span>
        <span class="basis-wrap"><DataBasisBadge basis="captured" prefix="结算/损益" /></span>
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          size="small"
          :clearable="false"
          class="ck-date"
          @change="onDateChange"
        />
        <div class="seg">
          <button
            v-for="m in marketOptions"
            :key="m.value"
            :class="{ on: market === m.value }"
            type="button"
            @click="((market = m.value), onMarketChange())"
          >
            {{ m.label }}
          </button>
        </div>
        <span class="pill"><span class="k">视角</span>全自有厂站</span>
        <el-button :loading="loading" size="small" class="ck-reload" @click="reload">重新加载</el-button>
        <el-dropdown
          size="small"
          trigger="click"
          @command="onExportCmd"
        >
          <el-button size="small" class="ck-reload">导出 ▾</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="csv">导出 CSV（四表分别下载）</el-dropdown-item>
              <el-dropdown-item command="xlsx">导出 Excel（多 sheet）</el-dropdown-item>
              <el-dropdown-item command="zip">导出 ZIP（四表打包）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- 空态 / 错误提示 -->
    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="ck-alert" show-icon />
    <el-alert
      v-else-if="ingestHint"
      type="warning"
      :closable="false"
      class="ck-alert"
      show-icon
      title="云南现货数据暂未摄取"
      description="请先在具备受管数据根的采集环境摄取月度现货导出（节点电价 Parquet + 运行 import:spot-export --write），或更换为已摄取的日期/市场后重试。"
    />

    <!-- 市场态势条 -->
    <section class="pulse">
      <div class="kpi">
        <div class="lab">全市场{{ market === 'da' ? '日前' : '实时' }}均价</div>
        <div class="val da num">{{ fmt(kpis?.marketAvg, 0) }}<small>元/MWh</small></div>
      </div>
      <div class="kpi">
        <div class="lab">结算均价</div>
        <div class="val gold num">{{ fmt(kpis?.settlementAvgPrice, 0) }}<small>元/MWh</small></div>
        <div v-if="kpis?.settlementDaPrice != null || kpis?.settlementRtPrice != null" class="delta">
          DA {{ fmt(kpis?.settlementDaPrice, 0) }} / RT {{ fmt(kpis?.settlementRtPrice, 0) }}
        </div>
      </div>
      <div class="kpi">
        <div class="lab">峰谷价差</div>
        <div class="val num">{{ fmt(kpis?.peakValleySpread, 0) }}<small>元</small></div>
      </div>
      <div class="kpi" :class="{ alert: (kpis?.negNodeSharePct ?? 0) > 0 }">
        <div class="lab">负价节点占比 <span v-if="(kpis?.negNodeSharePct ?? 0) > 0" class="chip warn">风险</span></div>
        <div class="val neg num">{{ fmt(kpis?.negNodeSharePct, 1) }}<small>%</small></div>
      </div>
      <div class="kpi">
        <div class="lab">最低 / 最高节点价</div>
        <div class="val num">
          <span class="neg">{{ fmt(kpis?.minNodePrice, 0) }}</span>
          <span style="color: var(--ck-txt-3)"> / </span>
          <span class="pos">{{ fmt(kpis?.maxNodePrice, 0) }}</span>
        </div>
      </div>
      <div class="kpi">
        <div class="lab">中长期覆盖率</div>
        <div class="val num">{{ kpis?.coverageRate != null ? fmt(kpis.coverageRate * 100, 0) : '—' }}<small>%</small></div>
        <div v-if="kpis?.openExposurePct != null" class="delta gold">现货敞口 {{ fmt(kpis.openExposurePct, 0) }}%</div>
      </div>
      <div class="kpi">
        <div class="lab">实现损益（区间合计）</div>
        <div class="val pos num">{{ fmt(kpis?.expectedRevenueWan, 1) }}<small>万元</small></div>
      </div>
      <div class="kpi" :class="{ alert: kpis?.plantOutputCompletionPct != null && (kpis.plantOutputCompletionPct < 95 || kpis.plantOutputCompletionPct > 105) }">
        <div class="lab">出力完成率</div>
        <div class="val num" :class="{ pos: kpis?.plantOutputCompletionPct != null && kpis.plantOutputCompletionPct >= 95 && kpis.plantOutputCompletionPct <= 105, neg: kpis?.plantOutputCompletionPct != null && (kpis.plantOutputCompletionPct < 95 || kpis.plantOutputCompletionPct > 105) }">
          {{ fmt(kpis?.plantOutputCompletionPct, 1) }}<small>%</small>
        </div>
        <div v-if="kpis?.plantOutputTargetSource" class="delta">对齐 {{ kpis.plantOutputTargetSource }} · {{ kpis.plantOutputPointCount }} 点</div>
      </div>
      <div class="kpi" :class="{ alert: (kpis?.forecastMapePct ?? 0) > 10 }">
        <div class="lab">MAPE <span v-if="(kpis?.forecastMapePct ?? 0) > 10" class="chip warn">关注</span></div>
        <div class="val num" :class="{ pos: kpis?.forecastMapePct != null && kpis.forecastMapePct <= 10, neg: (kpis?.forecastMapePct ?? 0) > 10 }">
          {{ fmt(kpis?.forecastMapePct, 2) }}<small>%</small>
        </div>
        <div v-if="kpis?.forecastMapeSource" class="delta">{{ kpis.forecastMapeSource }} · {{ kpis.forecastMapeSamples }} MAPE点</div>
      </div>
      <div class="kpi">
        <div class="lab">竞价空间（日均·外送未入）</div>
        <div class="val num">{{ fmt(kpis?.biddingSpaceMWh, 0) }}<small>MW</small></div>
      </div>
      <div class="kpi">
        <div class="lab">水电占比（日均）</div>
        <div class="val num">{{ fmt(kpis?.hydroSharePct, 1) }}<small>%</small></div>
      </div>
    </section>

    <div class="wrap">
      <!-- 主区 -->
      <div class="col-main">
        <!-- ② 价格热力场 -->
        <div class="panel">
          <div class="head">
            <span class="bar"></span>
            <h3>价格热力场</h3>
            <span class="meta">节点 × 时段 · 96点/15min</span>
            <div class="right">
              <span class="chip live">● /api/v1/spot/heatmap</span>
              <span class="chip">{{ data?.heatmap.nodes.length ?? 0 }} 节点</span>
            </div>
          </div>
          <div ref="heatmapEl" class="chart" style="height: 320px"></div>
        </div>

        <div class="row2">
          <!-- ③ 选定节点基差 -->
          <div class="panel">
            <div class="head">
              <span class="bar" style="background: var(--ck-pos)"></span>
              <h3>选定节点 vs 系统 · 基差</h3>
              <div class="right"><span class="chip">{{ data?.basis.node ?? '—' }}</span></div>
            </div>
            <div ref="basisEl" class="chart" style="height: 236px"></div>
            <div class="insight">
              <span class="ic">💡</span>
              <span class="tx">
                <b>当前基差
                  <span :class="(data?.basis.currentBasis ?? 0) >= 0 ? 'hl-neg' : 'hl-pos'" class="num">{{ (data?.basis.currentBasis ?? 0) >= 0 ? '+' : '' }}{{ fmt(data?.basis.currentBasis, 0) }} 元/MWh</span>
                </b>
                （选定节点 vs 系统均价，非自有节点口径）。
              </span>
            </div>
          </div>

          <!-- ④ 负价雷达 + 弃发建议 -->
          <div class="panel">
            <div class="head">
              <span class="bar" style="background: var(--ck-neg)"></span>
              <h3>负价雷达 · 弃发建议</h3>
              <div class="right">
                <span v-if="data?.negRadar.window" class="chip warn">连续负价 {{ data.negRadar.window.count }} 点</span>
                <span v-else class="chip">无连续负价</span>
              </div>
            </div>
            <div ref="negEl" class="chart" style="height: 236px"></div>
            <div class="insight">
              <span class="ic">⚑</span>
              <span class="tx" v-if="data?.negRadar.window">
                <b class="hl-neg">弃发建议：</b>
                <span class="num">{{ data.negRadar.window.startTime }}–{{ data.negRadar.window.endTime }}</span>
                连续负价（谷值 <span class="num">{{ fmt(data.negRadar.window.minPrice, 0) }} 元</span>），节点 <b>{{ data.negRadar.node }}</b>，按可调电量估算
                <b class="hl-pos">规避损失 ≈ ¥{{ fmt(data.negRadar.avoidLossYuan ? data.negRadar.avoidLossYuan / WAN : null, 1) }}万</b>（估算口径）。
              </span>
              <span class="tx" v-else>当前选定节点当日无连续负价段。</span>
            </div>
          </div>
        </div>

        <div class="row2">
          <!-- ⑤ 损益归因瀑布 -->
          <div class="panel">
            <div class="head">
              <span class="bar" style="background: var(--ck-gold)"></span>
              <h3>损益归因</h3>
              <span class="meta">{{ date.slice(0, 7) }} 区间 · 全厂站</span>
              <div class="right"><span class="chip live">● yn_loss_attribution</span></div>
            </div>
            <div ref="waterfallEl" class="chart" style="height: 236px"></div>
            <div class="insight" v-if="data?.waterfall.hasData">
              <span class="ic">💡</span>
              <span class="tx">
                预测损失 <span class="hl-neg num">{{ fmt(data.waterfall.forecastLoss == null ? null : data.waterfall.forecastLoss / WAN, 1) }}万</span> /
                策略损失 <span class="num">{{ fmt(data.waterfall.strategyLoss == null ? null : data.waterfall.strategyLoss / WAN, 1) }}万</span> ·
                实现损益 <b class="hl-pos num">{{ fmt(data.waterfall.realized == null ? null : data.waterfall.realized / WAN, 1) }}万</b>。
              </span>
            </div>
          </div>

          <!-- ⑥ 申报偏差体检 -->
          <div class="panel">
            <div class="head">
              <span class="bar" style="background: var(--ck-rt)"></span>
              <h3>申报偏差体检</h3>
              <span class="meta">区间 · 日前/实时</span>
              <div class="right">
                <span v-if="data?.deviation.worstDay" class="chip warn">{{ data.deviation.worstDay.date.slice(5) }} 预警</span>
              </div>
            </div>
            <div ref="deviationEl" class="chart" style="height: 236px"></div>
            <div class="insight" v-if="data?.deviation.worstDay">
              <span class="ic">⚖</span>
              <span class="tx">
                <b>{{ data.deviation.worstDay.date }} 实时偏差 <span class="hl-neg num">{{ fmt(data.deviation.worstDay.rtDevEnergy, 0) }} MWh</span></b>，
                偏差电费规模最大（<span class="num">¥{{ fmt(data.deviation.worstDay.rtDevFee == null ? null : Math.abs(data.deviation.worstDay.rtDevFee) / WAN, 1) }}万</span>）。
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧决策栏 -->
      <div class="rail">
        <div class="panel">
          <div class="head">
            <span class="bar"></span>
            <h3>决策清单</h3>
            <div class="right"><span class="chip warn">{{ decisions.length }} 待办</span></div>
          </div>
          <div v-if="decisions.length" class="dec-list">
            <div v-for="(d, i) in decisions" :key="i" class="dec" :class="d.kind">
              <div class="top">
                <span class="ico">{{ decisionIcon[d.kind] }}</span>
                <span class="t">{{ d.title }}</span>
              </div>
              <div class="desc">{{ d.desc }}</div>
              <div class="impact">{{ d.impactLabel }} <b :class="d.kind === 'audit' || d.kind === 'risk' ? 'neg' : 'pos'">≈ {{ fmt(d.impactWan, 1) }} 万</b></div>
            </div>
          </div>
          <div v-else class="rail-empty">暂无可派生决策（数据未摄取或当日无异常）。</div>
        </div>

        <div class="panel">
          <div class="head">
            <span class="bar" style="background: var(--ck-da)"></span>
            <h3>持仓与敞口</h3>
            <div class="right"><span class="chip live">● 真实结算</span></div>
          </div>
          <div class="pos-grid">
            <div class="pos-cell">
              <div class="l">中长期电量</div>
              <div class="v num">{{ fmt(position?.ltmEnergy, 0) }}<small> MWh</small></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${Math.min((position?.coverageRate ?? 0) * 100, 100)}%`, background: 'var(--ck-da)' }"></div></div>
            </div>
            <div class="pos-cell">
              <div class="l">总电量</div>
              <div class="v num">{{ fmt(position?.totalEnergy, 0) }}<small> MWh</small></div>
              <div class="bar-track"><div class="bar-fill" style="width: 100%; background: var(--ck-pos)"></div></div>
            </div>
            <div class="pos-cell">
              <div class="l">中长期覆盖率</div>
              <div class="v num">{{ position?.hasData ? fmt(position.coverageRate * 100, 0) : '—' }}<small>%</small></div>
            </div>
            <div class="pos-cell">
              <div class="l">现货敞口</div>
              <div class="v num neg">{{ position?.hasData ? fmt(position.openExposurePct, 0) : '—' }}<small>%</small></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${Math.min(position?.openExposurePct ?? 0, 100)}%`, background: 'var(--ck-neg)' }"></div></div>
            </div>
          </div>
          <div ref="exposureEl" class="chart" style="height: 150px"></div>
          <div class="insight">
            <span class="ic">ℹ</span>
            <span class="tx">逐日敞口（柱：正=净卖出红 / 负=净买入绿）+ 套保率（线），按 <b>yn_spot_settlement</b> 结算日聚合（captured 真实）。</span>
          </div>
        </div>

        <div class="panel">
          <div class="head">
            <span class="bar" style="background: var(--ck-pos)"></span>
            <h3>{{ diagMode === 'arena' ? '厂站 8 源精度擂台' : '预测损失诊断 · 厂站' }}</h3>
            <div class="seg">
              <button :class="{ on: diagMode === 'arena' }" @click="setDiagMode('arena')">MAPE 擂台</button>
              <button :class="{ on: diagMode === 'loss' }" @click="setDiagMode('loss')">厂站损失</button>
            </div>
            <select
              v-if="diagMode === 'arena' && arena?.sources.length"
              v-model="selectedArenaSource"
              class="arena-source-select"
              @change="onArenaSourceChange"
            >
              <option v-for="source in arena.sources" :key="source.source" :value="source.source">
                {{ source.source }}
              </option>
            </select>
          </div>
          <div ref="forecastEl" class="chart" style="height: 258px"></div>
          <div class="insight">
            <span class="ic">ℹ</span>
            <span v-if="diagMode === 'arena'" class="tx">
              按 <b>yn_plant_output</b> 的 {{ arena?.sourceCount ?? 0 }} 类出力源对齐 <b>{{ arena?.actualSource ?? '实际功率' }}</b>；当前趋势对比 <b>{{ selectedArenaSource ?? '最佳源' }}</b>
              <template v-if="selectedArenaMetric">（MAPE {{ fmt(selectedArenaMetric.mape, 2) }}%，RMSE {{ fmt(selectedArenaMetric.rmseMw, 2) }} MW）</template>，预测虚线、实际实线、缺测断点。
            </span>
            <span v-else class="tx">按 <b>yn_loss_attribution.forecastLoss</b> 厂站排行（厂站维度损失口径，与 8 源 MAPE 精度互补）。</span>
          </div>
          <details v-if="diagMode === 'arena' && arena?.sources.length" class="arena-source-details">
            <summary>全部源 {{ arena.sources.length }} 项 · RMSE / 偏差 / 样本下钻</summary>
            <div class="arena-source-table-wrap">
              <table class="arena-source-table">
                <thead>
                  <tr>
                    <th>源</th>
                    <th>角色</th>
                    <th>MAPE</th>
                    <th>RMSE</th>
                    <th>偏差</th>
                    <th>样本</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="source in arena.sources" :key="source.source" :class="{ selected: source.source === selectedArenaSource }">
                    <td>
                      <button type="button" class="source-link" @click="selectArenaSource(source.source)">
                        {{ source.source }}
                      </button>
                    </td>
                    <td>{{ source.roleLabel }}</td>
                    <td>{{ source.mape == null ? '—' : `${fmt(source.mape, 2)}%` }}</td>
                    <td>{{ source.rmseMw == null ? '—' : `${fmt(source.rmseMw, 2)} MW` }}</td>
                    <td :class="{ pos: (source.biasMw ?? 0) < 0, neg: (source.biasMw ?? 0) > 0 }">
                      {{ source.biasMw == null ? '—' : `${fmt(source.biasMw, 2)} MW` }}
                    </td>
                    <td>{{ source.samples }} / {{ source.mapeSamples }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </div>

    <div class="ck-footer">
      <Gauge :size="13" style="vertical-align: -2px" />
      云南现货作战台 · 真实数据（节点电价{{ usesCgnPrivatePrice ? '中广核厂侧私有 PostgreSQL' : '平台公共节点电价' }}
      + yn_loss_attribution / yn_spot_settlement 结算导出）· region=云南严格隔离 · 真实或空
    </div>
  </div>
</template>

<style scoped>
/* 交易终端样式（移植自 prototype/spot-cockpit.html）：作用域内 --ck-* 令牌现映射到
   app 全局主题变量，随 classic/neon/paper/arc 四主题切换。useEChart 主题切换会 dispose
   重建并重调 render，图表 chrome 经 chartChrome() 在 render 内取色，无需手加 watch(theme)。 */
.cockpit {
  --ck-bg: var(--bg);
  --ck-panel: var(--panel);
  --ck-panel-2: var(--panel-sub, var(--panel));
  --ck-panel-hi: var(--surface-hover, var(--el-fill-color-light, var(--panel)));
  --ck-border: var(--line);
  --ck-border-hi: var(--line-soft, var(--line));
  --ck-txt: var(--text);
  --ck-txt-2: var(--text-body, var(--muted));
  --ck-txt-3: var(--muted);
  --ck-da: var(--primary);
  --ck-rt: var(--warning);
  --ck-pos: var(--success);
  --ck-neg: var(--danger);
  --ck-gold: var(--warning);
  --ck-mono: 'SF Mono', 'JetBrains Mono', 'Roboto Mono', ui-monospace, monospace;

  background: var(--panel);
  color: var(--ck-txt);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  border: 1px solid var(--ck-border);
  border-radius: var(--radius, 12px);
  padding-bottom: 12px;
  overflow: hidden;
}

/* embedded:融合页 /dashboard 内嵌时去外层边框/圆角/底 padding,平滑融入 page-stack;
   standalone(工作台 tab,embedded=false)保留原终端边框。--ck-* 仍映射全局主题变量,
   classic/paper 下本就浅色、neon/arc 下深色,主题切换自动跟随(useEChart dispose+重调 render)。*/
.cockpit.embedded {
  border: 0;
  border-radius: 0;
  padding-bottom: 0;
  background: transparent;
}
.cockpit.embedded > .ck-header {
  border-radius: 8px 8px 0 0;
}

.cockpit-banner {
  padding: 12px 16px 0;
}

.num {
  font-family: var(--ck-mono);
  font-variant-numeric: tabular-nums;
}
.cockpit .pos {
  color: var(--ck-pos);
}
.cockpit .neg {
  color: var(--ck-neg);
}
.cockpit .da {
  color: var(--ck-da);
}
.cockpit .rt {
  color: var(--ck-rt);
}
.cockpit .gold {
  color: var(--ck-gold);
}

/* Header */
.ck-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  background: var(--ck-panel);
  border-bottom: 1px solid var(--ck-border-hi);
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: conic-gradient(from 140deg, #0ea5e9, #22d3ee, #34d399, #0ea5e9);
  display: grid;
  place-items: center;
  font-weight: 800;
  color: #03121f;
  box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35), 0 4px 14px rgba(14, 165, 233, 0.25);
}
.brand h1 {
  font-size: 16px;
  letter-spacing: 0.5px;
  font-weight: 700;
  margin: 0;
  color: var(--ck-txt);
}
.brand .sub {
  font-size: 10.5px;
  color: var(--ck-txt-3);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.spacer {
  flex: 1;
}
.ctrls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.basis-wrap {
  display: inline-flex;
}
.private-price-source {
  padding: 3px 8px;
  border: 1px solid var(--ck-border-hi);
  border-radius: 10px;
  color: var(--ck-warn);
  font-size: 11px;
  white-space: nowrap;
}
.seg {
  display: inline-flex;
  background: var(--ck-panel-2);
  border: 1px solid var(--ck-border);
  border-radius: 8px;
  overflow: hidden;
}
.seg button {
  background: transparent;
  border: 0;
  color: var(--ck-txt-2);
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 600;
}
.seg button.on {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0.08));
  color: var(--ck-da);
}
.arena-source-select {
  min-width: 132px;
  max-width: 100%;
  height: 30px;
  border: 1px solid var(--ck-border-hi);
  border-radius: 6px;
  background: var(--ck-panel-2);
  color: var(--ck-txt);
  font-size: 11px;
  padding: 0 8px;
}
.pill {
  padding: 6px 12px;
  background: var(--ck-panel-2);
  border: 1px solid var(--ck-border);
  border-radius: 8px;
  color: var(--ck-txt);
  font-size: 12px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.pill .k {
  color: var(--ck-txt-3);
  font-size: 11px;
}
.ck-date {
  width: 140px;
}

.ck-alert {
  margin: 12px 16px 0;
  width: auto;
}

/* Pulse bar */
.pulse {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1px;
  background: var(--ck-border);
  border-bottom: 1px solid var(--ck-border);
}
.kpi {
  background: var(--ck-panel-2);
  padding: 13px 18px;
  position: relative;
  overflow: hidden;
  min-width: 0;
}
.kpi .lab {
  font-size: 11px;
  color: var(--ck-txt-3);
  letter-spacing: 0;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.kpi .val {
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.kpi .val small {
  font-size: 12px;
  color: var(--ck-txt-3);
  font-weight: 500;
  margin-left: 3px;
}
.kpi .delta {
  font-size: 11px;
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.kpi.alert::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--ck-neg);
}

/* Layout */
.wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  padding: 14px 16px;
}
.col-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.panel {
  background: linear-gradient(180deg, var(--ck-panel), var(--ck-panel-2));
  border: 1px solid var(--ck-border);
  border-radius: 12px;
  overflow: hidden;
}
.panel > .head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--ck-border);
  flex-wrap: wrap;
}
.panel > .head .bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--ck-da);
}
.panel > .head h3 {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  margin: 0;
  color: var(--ck-txt);
}
.panel > .head .meta {
  color: var(--ck-txt-3);
  font-size: 11px;
}
.panel > .head .right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.chip {
  font-size: 10.5px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--ck-border-hi);
  color: var(--ck-txt-2);
}
.chip.live {
  color: var(--ck-pos);
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.07);
}
.chip.warn {
  color: var(--ck-neg);
  border-color: rgba(251, 94, 126, 0.3);
  background: rgba(251, 94, 126, 0.08);
}
.chart {
  width: 100%;
}

.insight {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 16px;
  border-top: 1px dashed var(--ck-border-hi);
  background: rgba(240, 180, 41, 0.035);
}
.insight .ic {
  color: var(--ck-gold);
  font-size: 15px;
  line-height: 1.2;
}
.insight .tx {
  font-size: 12px;
  color: var(--ck-txt);
  line-height: 1.55;
}
.insight .tx b {
  color: var(--ck-gold);
  font-weight: 700;
}
.insight .tx .hl-neg {
  color: var(--ck-neg);
  font-weight: 700;
}
.insight .tx .hl-pos {
  color: var(--ck-pos);
  font-weight: 700;
}

.arena-source-details {
  border-top: 1px solid var(--ck-border);
  background: var(--ck-panel-2);
}
.arena-source-details summary {
  cursor: pointer;
  padding: 10px 14px;
  color: var(--ck-txt-2);
  font-size: 11.5px;
  user-select: none;
}
.arena-source-table-wrap {
  max-height: 220px;
  overflow: auto;
  border-top: 1px dashed var(--ck-border-hi);
}
.arena-source-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 520px;
  font-size: 11px;
}
.arena-source-table th,
.arena-source-table td {
  padding: 7px 9px;
  border-bottom: 1px solid var(--ck-border);
  text-align: right;
  white-space: nowrap;
}
.arena-source-table th:first-child,
.arena-source-table td:first-child {
  text-align: left;
}
.arena-source-table th {
  color: var(--ck-txt-3);
  font-weight: 600;
  background: var(--ck-panel);
  position: sticky;
  top: 0;
}
.arena-source-table tr.selected td {
  background: rgba(56, 189, 248, 0.08);
}
.source-link {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ck-da);
  padding: 0;
  font: inherit;
  cursor: pointer;
  max-width: 128px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Decision rail */
.rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rail .panel > .head .bar {
  background: var(--ck-gold);
}
.dec-list {
  display: flex;
  flex-direction: column;
}
.dec {
  padding: 13px 15px;
  border-bottom: 1px solid var(--ck-border);
  display: flex;
  flex-direction: column;
  gap: 7px;
  transition: background 0.15s;
}
.dec:hover {
  background: var(--ck-panel-hi);
}
.dec:last-child {
  border-bottom: 0;
}
.dec .top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dec .ico {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 12px;
  flex: none;
}
.dec.risk .ico {
  background: rgba(251, 94, 126, 0.14);
  color: var(--ck-neg);
}
.dec.opp .ico {
  background: rgba(52, 211, 153, 0.14);
  color: var(--ck-pos);
}
.dec.tune .ico {
  background: rgba(56, 189, 248, 0.14);
  color: var(--ck-da);
}
.dec.audit .ico {
  background: rgba(240, 180, 41, 0.14);
  color: var(--ck-gold);
}
.dec .t {
  font-size: 12.5px;
  font-weight: 700;
}
.dec .desc {
  font-size: 11.5px;
  color: var(--ck-txt-2);
  line-height: 1.5;
}
.dec .impact {
  font-size: 12px;
}
.dec .impact b {
  font-family: var(--ck-mono);
  font-size: 14px;
}
.rail-empty {
  padding: 18px 16px;
  color: var(--ck-txt-3);
  font-size: 12px;
}

/* positions */
.pos-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.pos-cell {
  padding: 12px 15px;
  border-bottom: 1px solid var(--ck-border);
  border-right: 1px solid var(--ck-border);
}
.pos-cell:nth-child(2n) {
  border-right: 0;
}
.pos-cell .l {
  font-size: 11px;
  color: var(--ck-txt-3);
  margin-bottom: 5px;
}
.pos-cell .v {
  font-size: 18px;
  font-weight: 700;
}
.pos-cell .v small {
  font-size: 11px;
  color: var(--ck-txt-3);
  font-weight: 500;
}
.bar-track {
  height: 5px;
  border-radius: 3px;
  background: var(--ck-panel-hi);
  margin-top: 7px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px;
}

.ck-footer {
  text-align: center;
  color: var(--ck-txt-3);
  font-size: 11px;
  padding: 14px 16px 4px;
}

/* 深色控件覆盖（Element Plus 在深色面板内的最小适配） */
.cockpit :deep(.el-input__wrapper) {
  background: var(--ck-panel-2);
  box-shadow: 0 0 0 1px var(--ck-border) inset;
}
.cockpit :deep(.el-input__inner) {
  color: var(--ck-txt);
}
.cockpit :deep(.el-button) {
  background: var(--ck-panel-2);
  border-color: var(--ck-border-hi);
  color: var(--ck-txt);
}

@media (max-width: 1180px) {
  .wrap {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 860px) {
  .pulse {
    grid-template-columns: repeat(2, 1fr);
  }
  .row2 {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .ck-header {
    flex-wrap: wrap;
    gap: 10px;
  }
  .spacer {
    display: none;
  }
  .ctrls {
    flex-wrap: wrap;
    width: 100%;
  }
  .pulse {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .pulse {
    grid-template-columns: 1fr;
  }
}
</style>
