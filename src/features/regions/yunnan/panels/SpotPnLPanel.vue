<script setup lang="ts">
// 云南现货损益归因 + 申报偏差分析面板（xhjy/yunnan/spot-pnl）：消费两个真实回放 family。
// 三块展示：
//   1) 损益归因瀑布图（yn_loss_attribution：策略/预测/电网损失 → 合计损益，正=损失红、负=收益绿）；
//   2) 申报偏差分析（yn_spot_settlement：日前/实时 偏差电量 vs 偏差电费，按日双轴）；
//   3) 厂站 P&L 排行/明细（按电厂聚合，DynamicTable + CSV 导出）。
// 数据为真实导出（落 region=yunnan，云南严格地区不回退山西）；后端未摄取时给「请先摄取」友好空态，
// 不标「模拟数据」（真实数据页）。数据走 /api/real（fetchCaptured），损益已预计算，前端仅聚合/求和/排序，
// 不重算公式。金额口径：源单位为元；图表与明细统一换算为「万元」展示（除以 1e4），列名标注口径。
import { computed, onMounted, ref } from 'vue'
import { Coins, GitCompareArrows, Trophy, RefreshCcw } from 'lucide-vue-next'
import ChartCard from '@/components/common/ChartCard.vue'
import DynamicTable from '@/components/common/DynamicTable.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { onRegionChange } from '@/composables/useRegionReload'
import { chartChrome } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, fmtNum, sliderZoom, emptyOverlay } from '@/services/chart/chartOptions'
import { fetchCaptured } from '@/services/captured'
import { capturedAtFromProvenance } from '@/services/data/freshness'

// ── 行类型（来自数据层 capture-families.mjs 的 ROW_SCHEMAS）──
// #1755：数值字段 number | null——数据层缺测诚实落 null（#1746），前端不得用 Number(null)=0
// 拉回假零（全空段显示 0 会误导损益瀑布与厂站 P&L）；null 由 fmtNum 显示为「-」。
interface LossRow {
  id: string
  date: string
  plant: string
  area: string
  totalGenerationMwh: number | null
  strategyLossTotal: number | null
  strategyLossPerMwh: number | null
  forecastLossTotal: number | null
  forecastLossPerMwh: number | null
  gridLossTotal: number | null
  gridLossPerMwh: number | null
  originalValueTotal: number | null
}

interface SettlementRow {
  id: string
  date: string
  plant: string
  area: string
  ltmEnergy: number | null
  ltmPrice: number | null
  daClearedEnergy: number | null
  daDevEnergy: number | null
  daPrice: number | null
  daDevFee: number | null
  rtDevEnergy: number | null
  rtPrice: number | null
  rtDevFee: number | null
  actualOnGridEnergy: number | null
  totalEnergy: number | null
  avgPrice: number | null
  totalFee: number | null
}

const ALL_PLANTS = '__all__'
const WAN = 10000 // 元 → 万元

// ── 控件状态 ──
const selectedPlant = ref<string>(ALL_PLANTS)
// 数据为 2026-05 全月；日期范围默认覆盖整月（按日聚合 / 排序）。
const dateRange = ref<[string, string]>(['2026-05-01', '2026-05-31'])

// ── 原始数据 ──
const lossRows = ref<LossRow[]>([])
const settleRows = ref<SettlementRow[]>([])
// 数据时间：真实回放的采集/写入时刻（来自 provenance.capturedAt），非取数时刻。
// 两族数据时间分开维护：损益归因图跟 yn_loss_attribution、申报偏差图跟 yn_spot_settlement——
// 共用一个时间会在两族独立导入/一族缺 provenance 时，用较新一族的时间掩盖另一族已过期。
const lossUpdatedAt = ref<string | number | null>(null)
const settleUpdatedAt = ref<string | number | null>(null)

// ── 加载/错误态 ──
const loading = ref(false)
let reloadReqId = 0
const errorMsg = ref('')
const ingestHint = ref(false) // 后端未摄取两族时的友好提示

// ── 工具：从 fetchCaptured 信封里取数组 ──
function pickRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data as T[]
  return []
}

// #1755：求和跟踪器——null 不参与求和但计数；全部 null 时返回 null（诚实「无数据」，
// 由 fmtNum 显示「-」），部分 null 时返回有效值之和（null 等价跳过，对 SUM 无害）。
function trackedSum() {
  let sum = 0
  let valid = 0
  return {
    add(v: number | null | undefined) { if (v != null) { sum += v; valid += 1 } },
    value(): number | null { return valid > 0 ? sum : null }
  }
}

// ── 派生：电厂候选（两族 distinct plant 并集，按名排序）──
const plantOptions = computed(() => {
  const set = new Set<string>()
  for (const r of lossRows.value) if (r.plant) set.add(r.plant)
  for (const r of settleRows.value) if (r.plant) set.add(r.plant)
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

function inDateRange(date: string): boolean {
  const [from, to] = dateRange.value ?? []
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function plantMatch(plant: string): boolean {
  return selectedPlant.value === ALL_PLANTS || plant === selectedPlant.value
}

// 当前筛选（电厂 + 日期范围）后的损益行 / 结算行。
const filteredLoss = computed(() =>
  lossRows.value.filter((r) => plantMatch(r.plant) && inDateRange(r.date))
)
const filteredSettle = computed(() =>
  settleRows.value.filter((r) => plantMatch(r.plant) && inDateRange(r.date))
)

// ── ① 损益归因瀑布（策略/预测/电网 → 合计）──
// #1755：整段全 null → 该段落 null（瀑布段不显示、表格显示「-」），不再按假零 0 展示。
const lossBreakdown = computed(() => {
  const strategy = trackedSum()
  const forecast = trackedSum()
  const grid = trackedSum()
  for (const r of filteredLoss.value) {
    strategy.add(r.strategyLossTotal)
    forecast.add(r.forecastLossTotal)
    grid.add(r.gridLossTotal)
  }
  const s = strategy.value()
  const f = forecast.value()
  const g = grid.value()
  // 合计 = 有效段之和；全部段 null → 合计 null。
  const total = s == null && f == null && g == null ? null : (s ?? 0) + (f ?? 0) + (g ?? 0)
  return { strategy: s, forecast: f, grid: g, total }
})

const hasLoss = computed(() => filteredLoss.value.length > 0)

// ── ② 申报偏差（按日聚合）──
// #1755：指标全 null → null（ECharts 断点，不显示为 0）。
const deviationByDate = computed(() => {
  const map = new Map<string, { daDevEnergy: ReturnType<typeof trackedSum>; daDevFee: ReturnType<typeof trackedSum>; rtDevEnergy: ReturnType<typeof trackedSum>; rtDevFee: ReturnType<typeof trackedSum> }>()
  for (const r of filteredSettle.value) {
    let cur = map.get(r.date)
    if (!cur) {
      cur = { daDevEnergy: trackedSum(), daDevFee: trackedSum(), rtDevEnergy: trackedSum(), rtDevFee: trackedSum() }
      map.set(r.date, cur)
    }
    cur.daDevEnergy.add(r.daDevEnergy)
    cur.daDevFee.add(r.daDevFee)
    cur.rtDevEnergy.add(r.rtDevEnergy)
    cur.rtDevFee.add(r.rtDevFee)
  }
  return Array.from(map.entries())
    .map(([date, v]) => ({ date, daDevEnergy: v.daDevEnergy.value(), daDevFee: v.daDevFee.value(), rtDevEnergy: v.rtDevEnergy.value(), rtDevFee: v.rtDevFee.value() }))
    .sort((a, b) => a.date.localeCompare(b.date))
})

const hasDeviation = computed(() => deviationByDate.value.length > 0)

// ── ③ 厂站 P&L 排行/明细（按电厂聚合）──
// #1755：数值字段 number | null——整段全 null 的指标落 null（表格显示「-」），
// avgPrice 在 fee/energy 全 null 时落 null（不产出 0 均价、防 0 除）。
interface PlantAgg {
  plant: string
  totalGenerationMwh: number | null
  strategyLossTotal: number | null
  forecastLossTotal: number | null
  gridLossTotal: number | null
  lossTotal: number | null
  totalFee: number | null
  avgPrice: number | null
  days: number
}

const plantAggregation = computed<PlantAgg[]>(() => {
  const map = new Map<string, {
    plant: string
    totalGenerationMwh: ReturnType<typeof trackedSum>
    strategyLossTotal: ReturnType<typeof trackedSum>
    forecastLossTotal: ReturnType<typeof trackedSum>
    gridLossTotal: ReturnType<typeof trackedSum>
    totalFee: ReturnType<typeof trackedSum>
    lossTotal: number | null
    avgPrice: number | null
    days: number
  }>()
  const ensure = (plant: string) => {
    let cur = map.get(plant)
    if (!cur) {
      cur = {
        plant,
        totalGenerationMwh: trackedSum(),
        strategyLossTotal: trackedSum(),
        forecastLossTotal: trackedSum(),
        gridLossTotal: trackedSum(),
        totalFee: trackedSum(),
        lossTotal: null,
        avgPrice: null,
        days: 0
      }
      map.set(plant, cur)
    }
    return cur
  }

  for (const r of filteredLoss.value) {
    const a = ensure(r.plant)
    a.totalGenerationMwh.add(r.totalGenerationMwh)
    a.strategyLossTotal.add(r.strategyLossTotal)
    a.forecastLossTotal.add(r.forecastLossTotal)
    a.gridLossTotal.add(r.gridLossTotal)
  }

  // 结算侧：总电费求和；平均电价按总电费/总电量加权（避免直接平均 avgPrice 失真）。
  const feeWeighted = new Map<string, { fee: ReturnType<typeof trackedSum>; energy: ReturnType<typeof trackedSum>; days: number }>()
  for (const r of filteredSettle.value) {
    const a = ensure(r.plant)
    a.totalFee.add(r.totalFee)
    let w = feeWeighted.get(r.plant)
    if (!w) {
      w = { fee: trackedSum(), energy: trackedSum(), days: 0 }
      feeWeighted.set(r.plant, w)
    }
    w.fee.add(r.totalFee)
    w.energy.add(r.totalEnergy)
    w.days += 1
  }

  for (const a of map.values()) {
    const s = a.strategyLossTotal.value()
    const f = a.forecastLossTotal.value()
    const g = a.gridLossTotal.value()
    a.lossTotal = s == null && f == null && g == null ? null : (s ?? 0) + (f ?? 0) + (g ?? 0)
    const w = feeWeighted.get(a.plant)
    a.days = w?.days ?? 0
    // 平均电价：fee 或 energy 全 null → null（「无数据」而非 0 均价）；energy 全 null 防 0 除。
    const fee = w?.fee.value()
    const energy = w?.energy.value()
    a.avgPrice = fee != null && energy != null && energy !== 0 ? fee / energy : null
  }

  // 映射为 PlantAgg（trackedSum 取 value）并按损益降序（损失大者靠前，便于定位问题厂站）。
  return Array.from(map.values())
    .map((a) => ({
      plant: a.plant,
      totalGenerationMwh: a.totalGenerationMwh.value(),
      strategyLossTotal: a.strategyLossTotal.value(),
      forecastLossTotal: a.forecastLossTotal.value(),
      gridLossTotal: a.gridLossTotal.value(),
      lossTotal: a.lossTotal,
      totalFee: a.totalFee.value(),
      avgPrice: a.avgPrice,
      days: a.days
    }))
    .sort((x, y) => (y.lossTotal ?? 0) - (x.lossTotal ?? 0))
})

const tableSummary = computed(() => {
  const rows = plantAggregation.value
  // #1755（codex P2）：trackedSum 语义——全 null 时合计 null（fmtNum 显示「-」），
  // 不把「缺测」reduce 成假零 0 的「合计损益 0 万元」。
  const sum = trackedSum()
  for (const r of rows) sum.add(r.lossTotal)
  return { count: rows.length, loss: sum.value() }
})

// ── 加载 ──
function isEmptyResultError(message: string): boolean {
  return /未摄取|无数据|no data|暂无数据|not found|空|404/i.test(message)
}

async function reloadAll() {
  const reqId = ++reloadReqId
  loading.value = true
  errorMsg.value = ''
  ingestHint.value = false
  try {
    const [lossBody, settleBody] = await Promise.all([
      fetchCaptured<unknown>('yn_loss_attribution', 'yn_loss_daily'),
      fetchCaptured<unknown>('yn_spot_settlement', 'yn_settlement_daily')
    ])
    if (reqId !== reloadReqId) return
    lossRows.value = pickRows<LossRow>(lossBody)
    settleRows.value = pickRows<SettlementRow>(settleBody)
    // 真实数据时间取自信封 provenance（capturedAt 优先 / ingestedAt 兜底），非取数时刻；
    // 两族各自独立维护。MOCK/空态无 provenance → null（新鲜度落 unknown，不显时间）。
    lossUpdatedAt.value = capturedAtFromProvenance(lossBody)
    settleUpdatedAt.value = capturedAtFromProvenance(settleBody)
    // 两族都空 → 判定后端未摄取（import:spot-export --write 未跑）。
    if (!lossRows.value.length && !settleRows.value.length) {
      ingestHint.value = true
    } else if (selectedPlant.value !== ALL_PLANTS && !plantOptions.value.includes(selectedPlant.value)) {
      // 切地区后已选电厂不在新数据集里 → 回退全部。
      selectedPlant.value = ALL_PLANTS
    }
  } catch (e) {
    if (reqId !== reloadReqId) return
    lossRows.value = []
    settleRows.value = []
    // 清空数据时间——否则重载失败/切地区 404 后，ChartCard 仍显上一次（甚至上一地区）
    // 的数据时间与新鲜度，掩盖当前空态/失败状态（与 rows 同步置空）。
    lossUpdatedAt.value = null
    settleUpdatedAt.value = null
    const message = e instanceof Error ? e.message : '加载失败'
    if (isEmptyResultError(message)) {
      ingestHint.value = true
    } else {
      errorMsg.value = message
    }
  } finally {
    if (reqId === reloadReqId) loading.value = false
  }
}

function onPlantChange() {
  // 纯前端筛选，computed 自动重算，无需重拉。
}
function onDateChange() {
  // 同上，computed 响应。
}

// ── 图表 option（buildOption 函数式，ChartCard 自动追踪响应式重绘）──
const LOSS_RED = '#dc2626'
const GAIN_GREEN = '#16a34a'

function buildWaterfallOption() {
  const cc = chartChrome()
  const b = lossBreakdown.value
  // #1755（codex P2）：空态判定含「全 null」——有行但三段全空时走空态，不渲染 0 柱。
  const empty = !hasLoss.value || (b.strategy == null && b.forecast == null && b.grid == null)
  // 瀑布：三段分项 + 合计；用透明「占位柱」+ 「数值柱」实现升降台阶。
  // 单位换算为万元。
  // #1755：全 null 段 → 0（该段在瀑布中不显示；表格侧由 fmtNum 显示「-」）。
  const segments = [
    { name: '策略损失', value: b.strategy == null ? 0 : b.strategy / WAN },
    { name: '预测损失', value: b.forecast == null ? 0 : b.forecast / WAN },
    { name: '电网损失', value: b.grid == null ? 0 : b.grid / WAN }
  ]
  const categories = [...segments.map((s) => s.name), '合计损益']
  // 累计起点（占位柱底部）。合计柱从 0 起。
  const placeholder: number[] = []
  const positive: (number | string)[] = []
  const negative: (number | string)[] = []
  let running = 0
  for (const seg of segments) {
    const v = seg.value
    if (v >= 0) {
      placeholder.push(running)
      positive.push(v)
      negative.push('-')
    } else {
      placeholder.push(running + v)
      positive.push('-')
      negative.push(-v)
    }
    running += v
  }
  // 合计柱：从 0 起，整段表示净损益；全部段 null 时合计 null → 0（无数据不显示柱）。
  const totalWan = b.total == null ? 0 : b.total / WAN
  placeholder.push(0)
  if (totalWan >= 0) {
    positive.push(totalWan)
    negative.push('-')
  } else {
    positive.push('-')
    negative.push(-totalWan)
  }

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
      formatter: (params: Array<{ name?: string; dataIndex?: number }>) => {
        const idx = params[0]?.dataIndex ?? 0
        const name = categories[idx] ?? ''
        const raw = idx < segments.length ? segments[idx].value : totalWan
        const sign = raw >= 0 ? '损失' : '收益'
        return `<div style="font-weight:600;margin-bottom:2px">${name}</div>` +
          `<div style="display:flex;justify-content:space-between;gap:18px"><span>${sign}</span><b>${fmtNum(Math.abs(raw), 2)} 万元</b></div>`
      }
    },
    toolbox: chartToolbox('云南损益归因瀑布'),
    grid: { left: 64, right: 24, top: 24, bottom: 36, containLabel: false },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: cc.axisLabel, fontSize: 11, interval: 0 },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '万元',
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '占位',
        type: 'bar',
        stack: 'wf',
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        tooltip: { show: false },
        data: placeholder
      },
      {
        name: '损失',
        type: 'bar',
        stack: 'wf',
        barWidth: '52%',
        itemStyle: { color: LOSS_RED, borderRadius: [3, 3, 0, 0] },
        label: {
          show: true,
          position: 'top',
          fontSize: 10,
          color: LOSS_RED,
          formatter: (p: { value?: number | string }) =>
            typeof p.value === 'number' ? fmtNum(p.value, 1) : ''
        },
        data: positive
      },
      {
        name: '收益',
        type: 'bar',
        stack: 'wf',
        barWidth: '52%',
        itemStyle: { color: GAIN_GREEN, borderRadius: [3, 3, 0, 0] },
        label: {
          show: true,
          position: 'bottom',
          fontSize: 10,
          color: GAIN_GREEN,
          formatter: (p: { value?: number | string }) =>
            typeof p.value === 'number' ? `-${fmtNum(p.value, 1)}` : ''
        },
        data: negative
      }
    ],
    ...emptyOverlay(empty, '当前筛选下暂无损益归因数据')
  }
}

function buildDeviationOption() {
  const cc = chartChrome()
  const rows = deviationByDate.value
  const empty = !hasDeviation.value
  const x = rows.map((r) => r.date.slice(5)) // MM-DD
  return {
    tooltip: {
      ...axisTooltip({
        units: {
          日前偏差电量: 'MWh',
          实时偏差电量: 'MWh',
          日前偏差电费: '元',
          实时偏差电费: '元'
        },
        digits: 1,
        pointer: 'cross'
      }),
      confine: true
    },
    toolbox: chartToolbox('云南申报偏差'),
    legend: {
      top: 4,
      type: 'scroll',
      itemWidth: 16,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: cc.axisLabel },
      data: ['日前偏差电量', '实时偏差电量', '日前偏差电费', '实时偏差电费']
    },
    grid: { left: 60, right: 64, top: 44, bottom: 48, containLabel: false },
    dataZoom: sliderZoom(),
    xAxis: {
      type: 'category',
      data: x,
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: [
      {
        type: 'value',
        name: '电量(MWh)',
        position: 'left',
        nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
        axisLabel: { color: cc.axisLabel, fontSize: 10 },
        splitLine: { lineStyle: { color: cc.splitLine } }
      },
      {
        type: 'value',
        name: '电费(元)',
        position: 'right',
        nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
        axisLabel: { color: cc.axisLabel, fontSize: 10 },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '日前偏差电量',
        type: 'bar',
        yAxisIndex: 0,
        barMaxWidth: 14,
        itemStyle: { color: '#2563eb' },
        data: rows.map((r) => r.daDevEnergy)
      },
      {
        name: '实时偏差电量',
        type: 'bar',
        yAxisIndex: 0,
        barMaxWidth: 14,
        itemStyle: { color: '#0f766e' },
        data: rows.map((r) => r.rtDevEnergy)
      },
      {
        name: '日前偏差电费',
        type: 'line',
        yAxisIndex: 1,
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 1.8, color: '#ED7D31' },
        itemStyle: { color: '#ED7D31' },
        data: rows.map((r) => r.daDevFee)
      },
      {
        name: '实时偏差电费',
        type: 'line',
        yAxisIndex: 1,
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 1.8, color: '#dc2626', type: 'dashed' },
        itemStyle: { color: '#dc2626' },
        data: rows.map((r) => r.rtDevFee)
      }
    ],
    ...emptyOverlay(empty, '当前筛选下暂无申报偏差数据')
  }
}

// ── ③ 厂站 P&L 明细表（DynamicTable 列标签 + 行映射）──
const plantLabels: Record<string, string> = {
  plant: '电厂',
  totalGenerationMwh: '总发电(MWh)',
  strategyLossTotal: '策略损失(万元)',
  forecastLossTotal: '预测损失(万元)',
  gridLossTotal: '电网损失(万元)',
  lossTotal: '合计损益(万元)',
  totalFee: '总电费(万元)',
  avgPrice: '平均电价(元/MWh)',
  days: '天数'
}
const plantTableRows = computed(() =>
  plantAggregation.value.map((a) => ({
    plant: a.plant,
    // #1755：null 字段直接透传 fmtNum → 显示「-」；非 null 才做 /WAN 换算（null/WAN=0 会吞掉「无数据」）。
    totalGenerationMwh: fmtNum(a.totalGenerationMwh, 1),
    strategyLossTotal: fmtNum(a.strategyLossTotal == null ? null : a.strategyLossTotal / WAN, 2),
    forecastLossTotal: fmtNum(a.forecastLossTotal == null ? null : a.forecastLossTotal / WAN, 2),
    gridLossTotal: fmtNum(a.gridLossTotal == null ? null : a.gridLossTotal / WAN, 2),
    lossTotal: fmtNum(a.lossTotal == null ? null : a.lossTotal / WAN, 2),
    totalFee: fmtNum(a.totalFee == null ? null : a.totalFee / WAN, 2),
    avgPrice: fmtNum(a.avgPrice, 2),
    days: a.days
  }))
)

onMounted(() => {
  void reloadAll()
})

// 切地区时重拉（云南严格地区，数据天然按云南隔离）。
onRegionChange(() => {
  void reloadAll()
})
</script>

<template>
  <div class="spot-pnl-panel">
    <RegionDataBanner :families="['yn_loss_attribution', 'yn_spot_settlement']" />

    <section class="sp-hero">
      <div class="sp-hero-main">
        <div class="sp-kicker"><Coins :size="16" /><span>云南 · 现货损益归因 + 申报偏差</span></div>
        <p>按电厂与日期范围，拆解策略/预测/电网三段损失合计损益、追踪日前与实时申报偏差，并对厂站 P&amp;L 排行。数据来自真实月度结算导出（已预计算损益，前端仅聚合）。</p>
      </div>
    </section>

    <section class="sp-controls">
      <label class="sp-field">
        <span>电厂</span>
        <el-select v-model="selectedPlant" filterable :disabled="!plantOptions.length" @change="onPlantChange">
          <el-option label="全部电厂" :value="ALL_PLANTS" />
          <el-option v-for="p in plantOptions" :key="p" :label="p" :value="p" />
        </el-select>
      </label>
      <label class="sp-field sp-field--range">
        <span>日期范围</span>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :clearable="false"
          @change="onDateChange"
        />
      </label>
      <div class="sp-field sp-field--action">
        <span>&nbsp;</span>
        <el-button :loading="loading" @click="reloadAll">
          <RefreshCcw :size="14" style="margin-right: 4px" /> 重新加载
        </el-button>
      </div>
    </section>

    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="sp-alert" show-icon />
    <el-alert
      v-else-if="ingestHint"
      type="warning"
      :closable="false"
      class="sp-alert"
      show-icon
      title="后端暂无云南损益/结算数据"
      description="请先在主仓库摄取月度结算导出（运行 import:spot-export --write 落 capture-raw/yunnan/），或确认当前地区为云南后重试。"
    />

    <section class="sp-charts">
      <ChartCard
        title="损益归因瀑布（策略 / 预测 / 电网 → 合计损益）"
        :height="360"
        :loading="loading"
        :updated-at="lossUpdatedAt"
        cadence="monthly"
        :build-option="buildWaterfallOption"
        fullscreen
      >
        <template #actions>
          <span class="sp-chart-sub">
            <Coins :size="13" />
            合计 {{ fmtNum(lossBreakdown.total == null ? null : lossBreakdown.total / WAN, 2) }} 万元 ·
            {{ selectedPlant === ALL_PLANTS ? '全部电厂' : selectedPlant }}
          </span>
        </template>
      </ChartCard>

      <ChartCard
        title="申报偏差分析（日前 / 实时 · 偏差电量 vs 偏差电费）"
        :height="380"
        :loading="loading"
        :updated-at="settleUpdatedAt"
        cadence="monthly"
        :build-option="buildDeviationOption"
        brush-stats
        fullscreen
      >
        <template #actions>
          <span class="sp-chart-sub"><GitCompareArrows :size="13" /> {{ deviationByDate.length }} 个交易日</span>
        </template>
      </ChartCard>
    </section>

    <section class="sp-table-card">
      <div class="sp-table-head">
        <h3><Trophy :size="16" /> 厂站 P&amp;L 排行 / 明细</h3>
        <span class="sp-table-sub">
          {{ tableSummary.count }} 个电厂 · 合计损益 {{ fmtNum(tableSummary.loss == null ? null : tableSummary.loss / WAN, 2) }} 万元 · 按损益降序
        </span>
      </div>
      <div v-loading="loading">
        <DynamicTable
          :rows="plantTableRows"
          :labels="plantLabels"
          :page-size="20"
          export-name="yn-spot-pnl-by-plant"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.spot-pnl-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sp-hero {
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #eef7f3 55%, #f7fbff 100%);
}

.sp-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: var(--font-md);
  font-weight: 650;
}

.sp-hero p {
  margin: 8px 0 0;
  color: #5c6b76;
  line-height: 1.7;
}

.sp-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sp-field > span {
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.sp-field :deep(.el-select) {
  width: 220px;
}

.sp-field--range :deep(.el-date-editor) {
  width: 300px;
}

.sp-alert {
  margin: 0;
}

.sp-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.sp-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-xs);
  color: var(--muted, #909399);
}

.sp-table-card {
  padding: 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-table-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sp-table-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #172b3a;
  font-size: var(--font-15);
}

.sp-table-sub {
  color: #687987;
  font-size: var(--font-sm);
}

@media (max-width: 768px) {
  .sp-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .sp-field :deep(.el-select),
  .sp-field--range :deep(.el-date-editor) {
    width: 100%;
  }
}
</style>
