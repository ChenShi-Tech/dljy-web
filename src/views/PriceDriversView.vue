<script setup lang="ts">
// 价格驱动分析（/sjfx/price-drivers，dljy#3390）：合并旧「现货价格×新能源」（zrxgx）与
// 「现货价格×统调负荷」（zrxgx2）两页。同一份 relation_scatter 契约（kind: renewable|load），
// 从上到下：驱动分段工具条 → 指标卡 → 热力图 + 双驱动敏感度对比（同屏）→ 单小时散点+拟合。
// 派生量全部走纯计算层 relationInsight.ts（口径不改，本页只做呈现）。
// 页面整洁纪律（用户 2026-09-28 拍板）：不写任何系统生成的结论句，
// 口径说明一律「缩略标题 + el-tooltip 悬浮」，不放大段说明框。
// ⚠️ 模板必须保持单根：fragment 根会让 AppLayout 的 <Transition mode="out-in"> 卡死（先例见两个旧薄壳）。
import { Sparkles } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { fetchMarketInsightRelationScatterContract } from '@/services/data/contracts'
import type {
  MarketInsightRelationKind,
  RelationScatterDataset
} from '@/services/data/contracts/relationScatterAdapter'
import { getCurrentUser } from '@/services/auth'
import { canAccessPriceDriver } from '@/services/governance'
import { clampToCoverage, fetchCaptureCoverage } from '@/services/market/captureCoverage'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '@/composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import MetricTile from '@/components/common/MetricTile.vue'
import { chartChrome } from '@/composables/useTheme'
import { useEChart, type EChartHandle } from '@/composables/useEChart'
import { useQuerySync } from '@/composables/useQuerySync'
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
import { normalizeContractBasis } from '@/services/data/contracts'

/** 参考竖线配置（沿用旧两页：山西 xnyzd/xnyg/xnygd 数组按小时取值，云南契约为空数组自然不画）。 */
type ReferenceLine = {
  array: 'xnyzd' | 'xnyg' | 'xnygd'
  arrayIndex: number
  color: string
  width: number
  legendLabel?: string
  /** 地区能力门控维度 id（status !== 'hidden' 才显示）；不填则不门控。 */
  dimensionId?: string
}

const RENEWABLE_REF_LINES: ReferenceLine[] = [
  { array: 'xnyzd', arrayIndex: 0, color: '#ED7D31', width: 2.5, legendLabel: '新能源总低价', dimensionId: 'zrxgx.xnyzd' },
  { array: 'xnyg', arrayIndex: 0, color: '#70AD1F', width: 2.5, legendLabel: '光伏均值', dimensionId: 'zrxgx.xnyg' },
  { array: 'xnygd', arrayIndex: 0, color: '#934294', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 1, color: '#A349A4', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 2, color: '#3399FF', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 3, color: '#487c05', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 4, color: '#4472C4', width: 1, dimensionId: 'zrxgx.xnygd' }
]
const LOAD_REF_LINES: ReferenceLine[] = [
  { array: 'xnyzd', arrayIndex: 0, color: '#ED7D31', width: 2.5, legendLabel: '统调负荷' }
]

const DATE_COLORS = ['#c0392b', '#8e44ad', '#2980b9', '#16a085', '#27ae60', '#f39c12',
  '#d35400', '#7f8c8d', '#2c3e50', '#e84393', '#0984e3', '#6ab04c']

function shanghaiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// ---------------------------------------------------------------------------
// 筛选状态：driver（renewable|load）经 query 同步；旧地址 zrxgx/zrxgx2 由路由 redirect
// 预选 driver 并透传 date/days/mode，旧书签不失效。
// ---------------------------------------------------------------------------
const driver = ref<string>('renewable')
// 默认运行日落在该地区最新有数日（dljy#3390）：山西走 captureCoverage 静态表（price 区间），
// 云南挂载后由 fetchCaptureCoverage 实时区间校正（数据受上游发布节奏限制恒滞后数日）。
// 取不到时保持今天，由空态诚实说明。只钳默认值，不限制手选。
const runDate = ref(
  currentRegion.value.id === 'yunnan'
    ? shanghaiToday()
    : clampToCoverage(currentRegion.value.id, 'price', shanghaiToday())
)
const initialRunDate = runDate.value
const days = ref(12)
const mode = ref<'rq' | 'ss'>('rq')

useQuerySync({ driver, date: runDate, days, mode })

const activeKind = computed<MarketInsightRelationKind>(() => (driver.value === 'load' ? 'load' : 'renewable'))
const otherKind = computed<MarketInsightRelationKind>(() => (activeKind.value === 'renewable' ? 'load' : 'renewable'))

// 驱动元数据（X 轴范围/分箱/文案/参考线），与旧两页薄壳的注入一致。
// X 轴不再写死 14000 上界：该值按早年山西量级标定，2026 年云南/山西午间新能源出力
// 实测已达 20~33GW，固定上限会把午间主力散点整段裁出轴外（回归/KPI 用全量数据，
// 图与数字口径分裂），热力图顶箱也混入数倍越界值。改为数据自适应，新能源保持 0 锚。
const DRIVER_META: Record<MarketInsightRelationKind, {
  label: string
  unit: string
  /** 散点 X 轴/热力图分箱锚 0 下界：新能源出力物理非负；负荷留空走样本自适应。 */
  xAnchorZero?: boolean
  refLines: ReferenceLine[]
}> = {
  renewable: { label: '新能源出力', unit: 'MW', xAnchorZero: true, refLines: RENEWABLE_REF_LINES },
  load: { label: '统调负荷', unit: 'MW', refLines: LOAD_REF_LINES }
}
const meta = computed(() => DRIVER_META[activeKind.value])
const otherMeta = computed(() => DRIVER_META[otherKind.value])

// ---------------------------------------------------------------------------
// 驱动选项显隐（dljy#3390）：每个驱动因素按各自旧路径授权判定（governance.canAccessPriceDriver，
// 口径见 priceDriverAccessPaths 注释）；管理员角色全放行。
// ---------------------------------------------------------------------------
function driverAllowed(kind: MarketInsightRelationKind): boolean {
  return canAccessPriceDriver(kind, getCurrentUser())
}
const driverOptions = computed(() => (['renewable', 'load'] as const)
  .map((kind) => ({ kind, label: DRIVER_META[kind].label, allowed: driverAllowed(kind) }))
  .filter((o) => o.allowed))
// 旧书签/异常 query 预选了无权限（或非法）的驱动时，回落到第一个可用驱动。
if (driverOptions.value.length && !driverOptions.value.some((o) => o.kind === activeKind.value)) {
  driver.value = driverOptions.value[0].kind
}

// ---------------------------------------------------------------------------
// 取数：主驱动（整页状态）+ 另一驱动（仅敏感度对比柱，无权限不发请求、失败静默降级）。
// 版本守卫：切筛选/驱动/地区旧响应丢弃（#405 同族）。
// ---------------------------------------------------------------------------
const loading = ref(true)
const error = ref('')
const data = ref<RelationScatterDataset | null>(null)
const otherData = ref<RelationScatterDataset | null>(null)
const dates = ref<string[]>([])
const loadSeq = ref(0)

async function loadData() {
  const seq = ++loadSeq.value
  loading.value = true; error.value = ''
  const params = () => ({
    region: currentRegion.value.id,
    runDate: runDate.value,
    days: days.value,
    priceMode: mode.value
  })
  // 另一驱动请求失败只降级对比柱，不让整页报错（dljy#3390 验收项）。
  const otherAllowed = driverAllowed(otherKind.value)
  const otherPromise = otherAllowed
    ? fetchMarketInsightRelationScatterContract({ kind: otherKind.value, ...params() })
      .then((c) => c.blocks.relation_scatter.dataset as RelationScatterDataset)
      .catch(() => null)
    : Promise.resolve(null)
  try {
    const contract = await fetchMarketInsightRelationScatterContract({ kind: activeKind.value, ...params() })
    if (seq !== loadSeq.value) return
    data.value = routeAvailable.value ? contract.blocks.relation_scatter.dataset : null
    // 契约口径元数据（ModuleContractMeta）：AI 解读上下文按此标注，不硬编码 captured
    dataBasis.value = normalizeContractBasis(contract.basis)
  } catch {
    if (seq !== loadSeq.value) return
    // 清空旧数据并重绘空态，避免 ECharts 仍持上一轮画布被误读为当前地区真实。
    data.value = null
    dataBasis.value = 'synthetic'
    dates.value = []
    error.value = `${currentRegion.value.name}价格驱动数据加载失败（运行日 ${runDate.value}）`
  } finally {
    // 先等对比请求落地再判代次：等待期间若已发起新一轮，旧结果不得写回、也不得提前收起加载态。
    const other = await otherPromise
    if (seq === loadSeq.value) {
      otherData.value = other
      loading.value = false
    }
  }
  await nextTick()
  if (seq === loadSeq.value) renderAll()
}

// 地区能力门控（沿用旧页：routePath 判 hidden + 参考线维度判 hidden）
const routeAvailable = computed(() =>
  getRegionCapabilityForPath('/sjfx/price-drivers', currentRegion.value.id)?.status !== 'hidden')
function dimensionVisible(id?: string) {
  if (!id) return true
  const status = getRegionCapabilityForPath('/sjfx/price-drivers', currentRegion.value.id)
    ?.module.subCapabilities
    ?.find((item) => item.id === id)
    ?.statusByRegion[currentRegion.value.id]
  return status !== 'hidden'
}
const visibleRefLines = computed(() => meta.value.refLines.filter((l) => dimensionVisible(l.dimensionId)))
const legendRefLines = computed(() => visibleRefLines.value.filter((l) => l.legendLabel))

// 取数契约的口径（captured/synthetic）；取数失败/未取到时保守 synthetic（R4 宁严勿谎）
const dataBasis = ref<'captured' | 'synthetic'>('synthetic')
// KPI 摘要（relationInsight.summaryKpis，口径不改）
const kpi = computed(() => summaryKpis(data.value?.xd ?? [], days.value))
function fmtSlope(perMw: number | null) {
  return perMw == null ? '—' : (perMw * 1000).toFixed(1) // 元/MWh per MW → per GW；空样本显示缺测
}

// ---------------------------------------------------------------------------
// 选中小时：默认最敏感时段；点热力图小时列或敏感度柱切换单小时散点（dljy#3390 联动）。
// ---------------------------------------------------------------------------
const selectedHour = ref<number | null>(null)
watch(kpi, (k) => {
  // 只在无手选时跟随最新数据的最敏感时段（切驱动/取数后重置为默认）。
  selectedHour.value = k.strongestHour ?? null
}, { immediate: true })

// ---------------------------------------------------------------------------
// 图表句柄：热力图 / 敏感度对比 / 单小时散点
// ---------------------------------------------------------------------------
const heatmapRef = ref<HTMLElement | null>(null)
const heatmapChart = useEChart(heatmapRef, { render: renderHeatmap })
const sensRef = ref<HTMLElement | null>(null)
const sensChart = useEChart(sensRef, { render: renderSensitivity })
const scatterRef = ref<HTMLElement | null>(null)
const scatterChart = useEChart(scatterRef, { render: renderScatter })

function bindClick(handle: EChartHandle, onClick: (params: { dataIndex?: number; value?: unknown }) => void) {
  const inst = handle.instance()
  inst?.off('click')
  inst?.on('click', (p: any) => onClick(p))
}

// 视图①：小时 × 驱动量分档 → 平均电价 热力图；点击小时列联动单小时散点。
function renderHeatmap() {
  const xd = data.value?.xd ?? []
  const m = heatmapMatrix(xd, { days: days.value, binCount: 10, binMin: meta.value.xAnchorZero ? 0 : undefined })
  const cc = chartChrome()
  const hi = selectedHour.value != null ? m.xHours.indexOf(selectedHour.value) : -1
  heatmapChart.setOption({
    ...emptyOverlay(!m.cells.length),
    tooltip: {
      position: 'top',
      formatter: (p: any) => {
        const [hourIdx, binIdx, v] = p.value
        const cnt = m.counts[p.dataIndex]
        return `${m.xHours[hourIdx]}:00 · ${meta.value.label} ${m.yBins[binIdx]} ${meta.value.unit}<br/>平均电价 ${Math.round(v)} 元/MWh（${cnt} 天）`
      }
    },
    grid: { top: 12, bottom: 70, left: 100, right: 20 },
    xAxis: {
      type: 'category', data: m.xHours.map((h) => `${h}:00`), name: '小时', nameGap: 24,
      axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 1 }
    },
    yAxis: {
      type: 'category', data: m.yBins, name: `${meta.value.label}(${meta.value.unit})`, nameGap: 74,
      axisLabel: { fontSize: 10, color: cc.axisLabel }
    },
    visualMap: {
      // calculable 关闭（沿用 #200 对旧关系页的修复）：拖拽手柄的数值标签会压在 X 轴刻度上；色条 + 低/电价高 文案已够表达映射
      min: m.min, max: m.max, calculable: false, orient: 'horizontal', left: 'center', bottom: 8,
      itemHeight: 100, inRange: { color: seqColors() }, text: ['电价高', '低'], textStyle: { color: cc.axisLabel }
    },
    series: [{
      type: 'heatmap',
      progressive: 2000,
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 6 } },
      data: m.cells.map((c, i) => (c[0] === hi
        ? { value: c, itemStyle: { borderColor: cc.axisLabel, borderWidth: 1.5 }, id: `hl-${i}` }
        : c))
    }]
  }, { notMerge: true })
  bindClick(heatmapChart, (p) => {
    const hourIdx = Array.isArray(p.value) ? p.value[0] : undefined
    if (hourIdx == null) return
    const hour = m.xHours[hourIdx]
    if (hour != null) selectedHour.value = hour
  })
}

// 视图②：24 小时边际敏感度柱图，当前驱动与另一驱动并排对比（另一驱动无权限/失败时只画当前）。
function renderSensitivity() {
  const bars = sensitivityBars(data.value?.xd ?? [], days.value)
  const other = otherData.value ? sensitivityBars(otherData.value.xd, days.value) : null
  const cc = chartChrome()
  const curName = `${meta.value.label}敏感度`
  const otherName = `${otherMeta.value.label}敏感度`
  sensChart.setOption({
    ...emptyOverlay(!bars.some((b) => b.n >= 2) && !(other?.some((b) => b.n >= 2))),
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const lines = [`${bars[ps[0].dataIndex].hour}:00`]
        for (const p of ps) {
          const src = p.seriesName === curName ? bars : other
          const b = src?.[p.dataIndex]
          if (b && b.n >= 2) {
            lines.push(`${p.marker}${p.seriesName} ${fmtSlope(b.slope)} 元/(MWh·GW)（r=${b.r.toFixed(2)}，${b.n} 天）`)
          }
        }
        return lines.join('<br/>')
      }
    },
    legend: { bottom: 0, textStyle: { color: cc.axisLabel, fontSize: 11 } },
    grid: { left: 64, right: 16, top: 20, bottom: 52 },
    xAxis: { type: 'category', data: bars.map((b) => `${b.hour}:00`), axisLabel: { fontSize: 10, color: cc.axisLabel, rotate: 45 } },
    yAxis: { type: 'value', name: '元/(MWh·GW)', nameTextStyle: { color: cc.axisLabel }, axisLabel: { color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: [
      {
        name: curName,
        type: 'bar',
        data: bars.map((b) => ({
          value: b.n >= 2 ? Number(fmtSlope(b.slope)) : 0,
          itemStyle: { color: b.slope >= 0 ? '#c0392b' : '#2980b9', opacity: b.n >= 2 ? 1 : 0.25 }
        })),
        // 选中小时竖标线（category 轴按类目名定位）
        markLine: selectedHour.value != null
          ? { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: cc.axisLabel, width: 1, type: 'dashed' }, data: [{ xAxis: `${selectedHour.value}:00` }] }
          : undefined
      },
      ...(other ? [{
        name: otherName,
        type: 'bar',
        // 对比系列用中性灰：正负只看 0 轴上下，视觉焦点留在当前驱动（数值进 tooltip）。
        data: other.map((b) => ({
          value: b.n >= 2 ? Number(fmtSlope(b.slope)) : 0,
          itemStyle: { color: '#b1b3b8', opacity: b.n >= 2 ? 0.9 : 0.25 }
        }))
      }] : [])
    ]
  }, { notMerge: true })
  bindClick(sensChart, (p) => {
    const hour = p.dataIndex != null ? RELATION_HOURS[p.dataIndex] : undefined
    if (hour != null) selectedHour.value = hour
  })
}

// 视图③：单小时散点 + 最小二乘拟合线；r²/斜率在卡片头部以简写 + 悬浮说明呈现。
function renderScatter() {
  const d = data.value
  const h = selectedHour.value
  if (!d || h == null) {
    scatterChart.setOption({ ...emptyOverlay(true) }, { notMerge: true })
    return
  }
  const xd = (d.xd || []).slice(-days.value)
  const series: any[] = xd.map((row, di: number) => ({
    name: row.date, type: 'scatter', symbolSize: 9, z: 3,
    itemStyle: { color: DATE_COLORS[di % DATE_COLORS.length] },
    data: row['p' + h] ? [row['p' + h]] : []
  }))
  // 参考竖线（能力门控后；云南契约为空数组自然不画）
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
  const reg = hourlyRegression(d.xd || [], h, days.value)
  if (reg.n >= 2) {
    const xs = pointsForHour(d.xd || [], h, days.value).map((p) => p[0])
    const xMin = meta.value.xAnchorZero ? 0 : (xs.length ? Math.min(...xs) : 0)
    const xMax = xs.length ? Math.max(...xs) : 1
    series.push({
      name: '拟合', type: 'line', showSymbol: false, silent: true, z: 2,
      lineStyle: { color: '#606266', width: 1.5, type: 'dashed' },
      data: [[xMin, reg.slope * xMin + reg.intercept], [xMax, reg.slope * xMax + reg.intercept]]
    })
  }
  const cc = chartChrome()
  scatterChart.setOption({
    ...emptyOverlay(!series.some((s: any) => s.type === 'scatter' && s.data.length)),
    grid: { left: 64, right: 24, top: 20, bottom: 44 },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => p.seriesName === '拟合'
        ? `拟合线`
        : `${p.seriesName}<br/>${meta.value.label} ${p.value[0]} ${meta.value.unit} / 电价 ${p.value[1]} 元/MWh`
    },
    // X 轴自适应：新能源锚 0 下界（出力非负、量级随地区差异大），负荷 scale 自适应；
    // 不再写死上界（原 14000 已被 2026 年两地区实际出力越界，见 DRIVER_META 注释）。
    xAxis: meta.value.xAnchorZero
      ? { type: 'value', min: 0, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } }
      : { type: 'value', scale: true, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    // 电价轴自适应：负价时段的「驱动-价格」关系恰是本页最关心的场景，
    // 写死 min:0/max:1500 会系统性裁掉负价散点与拟合线负值端
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

function renderAll() {
  dates.value = ((data.value?.xd || []) as Array<{ date: string }>).slice(-days.value).map((r) => r.date)
  renderHeatmap()
  renderSensitivity()
  renderScatter()
}

// 散点卡头部的拟合读数（r²/β 简写 + 悬浮说明）
const hourReg = computed(() => selectedHour.value == null || !data.value
  ? null
  : hourlyRegression(data.value.xd || [], selectedHour.value, days.value))

// AI 解读上下文（dljy#3390）：当前驱动 + 选中小时 + KPI 摘要，仍不传逐点全量。
const ai = useAiSidebar()
function insightContext(): Record<string, unknown> {
  const k = kpi.value
  return {
    page: `价格驱动分析 (price-drivers)`,
    driver: meta.value.label,
    run_date: runDate.value,
    days: days.value,
    price_caliber: mode.value === 'rq' ? '日前价' : '实时价',
    selected_hour: selectedHour.value,
    dates_shown: dates.value,
    days_loaded: k.sampleDays,
    summary: {
      overall_r: k.overallR == null ? null : Number(k.overallR.toFixed(3)),
      strongest_hour: k.strongestHour,
      weakest_hour: k.weakestHour,
      mean_marginal_sensitivity_yuan_per_mwh_gw: k.meanSlope == null ? null : Number((k.meanSlope * 1000).toFixed(1))
    },
    chart: `X=${meta.value.label}(${meta.value.unit})、Y=电价(元/MWh)；热力图(小时×驱动量分档→均价)/双驱动敏感度柱/单小时散点+拟合`,
    // R4：AI 上下文消费取数契约口径（captured/synthetic），不再硬编码真实采集；
    // 契约元数据缺失时保守按 synthetic（宁严勿谎——广东/四川后端合成口径不被当成真实采集）。
    basis: dataBasis.value
  }
}
defineAiPage({ label: '价格驱动分析', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function askInsight() {
  ai.interpret()
}

// 云南默认运行日校正（仅当用户尚未动过日期）：优先 fetchCaptureCoverage 实时区间。
// 兜底尾行探针：覆盖接口按 region 精确聚合 DB 行，云南价格数据集以 region='all' 归档时
// 不会出现在覆盖返回里（实测 da/rt_user_price 缺席）→ fetchCaptureCoverage 得 null、
// 默认日停在今天、首屏 12 天 0 点。此时取价格与两类驱动量四个「尾行日期」(limit=1)
// 的最小值钳默认日——仍是数据事实，不是猜的日期。
async function datasetTailDate(datasetKey: string): Promise<string | null> {
  try {
    const body = await fetchCaptured<{ data?: Array<{ operateDate?: unknown }> }>('yn_system_forecast', datasetKey, { limit: 1 })
    const tail = body?.data?.[0]
    return typeof tail?.operateDate === 'string' ? tail.operateDate : null
  } catch {
    return null
  }
}
async function syncCoverageDefault() {
  if (runDate.value !== initialRunDate) return
  const range = await fetchCaptureCoverage(currentRegion.value.id, 'price')
  let end: string | null = range?.end ?? null
  if (!range && currentRegion.value.id === 'yunnan') {
    const tails = await Promise.all([
      datasetTailDate('da_user_price'),
      datasetTailDate('rt_user_price'),
      datasetTailDate('new_energy_actual'),
      datasetTailDate('load_actual')
    ])
    end = tails.filter((t): t is string => t != null).sort()[0] ?? null
  }
  if (!end || runDate.value !== initialRunDate) return
  if (runDate.value !== end) runDate.value = end // 变更由 watch 触发重载
}

onMounted(() => {
  void loadData()
  void syncCoverageDefault()
})
watch(runDate, loadData)
watch(days, loadData)
watch(mode, loadData)
watch(driver, loadData)      // 切驱动 → 按新 kind 重查（含另一驱动对比柱）
watch(selectedHour, () => {
  renderHeatmap()            // 选中列高亮 + 敏感度 markLine + 单小时散点联动
  renderSensitivity()
  renderScatter()
})
onRegionChange(loadData)
</script>

<template>
  <div class="pd" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />

    <div class="toolbar">
      <el-radio-group v-if="driverOptions.length > 1" v-model="driver" size="small">
        <el-radio-button v-for="o in driverOptions" :key="o.kind" :value="o.kind">{{ o.label }}</el-radio-button>
      </el-radio-group>
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="runDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" style="width: 150px" />
      <span class="lbl">天数</span>
      <el-input-number v-model="days" :min="1" :max="30" size="small" controls-position="right" style="width: 110px" />
      <el-radio-group v-model="mode" size="small" style="margin-left: 8px">
        <el-radio-button value="rq">日前</el-radio-button>
        <el-radio-button value="ss">实时</el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-button size="small" type="primary" @click="loadData">查询</el-button>
      <el-button size="small" type="success" plain :icon="Sparkles" @click="askInsight">解读本页</el-button>
    </div>

    <!-- 指标卡：口径说明一律 ⓘ 悬浮（MetricTile.info），页面不写结论句 -->
    <div class="kpis">
      <MetricTile
        label="相关系数 r"
        :value="kpi.overallR == null ? '—' : kpi.overallR.toFixed(3)"
        info="全时段散点汇成一池计算的 Pearson 相关系数，衡量电价与驱动量的线性相关方向与强度（-1~1）。"
      />
      <MetricTile
        label="平均边际敏感度"
        :value="fmtSlope(kpi.meanSlope)"
        unit="元/(MWh·GW)"
        info="24 个小时各自做最小二乘回归的斜率均值：驱动量每增 1 GW，电价平均变动的元/MWh 数。"
      />
      <MetricTile
        label="最敏感时段"
        :value="kpi.strongestHour != null ? `${kpi.strongestHour}:00` : '—'"
        info="|r| 最大的小时：该小时电价与驱动量的线性关系最强。"
      />
      <MetricTile
        label="最弱时段"
        :value="kpi.weakestHour != null ? `${kpi.weakestHour}:00` : '—'"
        info="|r| 最小（样本 n≥2）的小时：该小时线性关系最弱。"
      />
      <MetricTile
        label="样本"
        :value="`${kpi.sampleDays} 天 / ${kpi.totalPoints} 点`"
        info="参与统计的天数（近 N 天）与有效散点数（每天 24 小时、缺值剔除）。"
      />
    </div>

    <!-- 同屏两图：左热力图、右双驱动敏感度对比 -->
    <div class="duo">
      <div class="card">
        <div class="card-head">
          <span class="card-title">小时 × {{ meta.label }}分档 → 平均电价</span>
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              横轴小时 × 纵轴{{ meta.label }}分档，格值为该组合的平均电价，色阶由低到高；
              点击某一小时列可切换下方单小时散点。
            </template>
            <span class="hint" tabindex="0">ⓘ</span>
          </el-tooltip>
        </div>
        <div ref="heatmapRef" class="chart-host"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <span class="card-title">24 小时边际敏感度</span>
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              各小时电价对驱动量的边际敏感度 = 该小时散点最小二乘回归的斜率（元/(MWh·GW)），
              红柱为正、蓝柱为负；灰色系列为另一驱动并排对比（无权限或取数失败时自动隐藏）。
              点击柱子可切换下方单小时散点。
            </template>
            <span class="hint" tabindex="0">ⓘ</span>
          </el-tooltip>
        </div>
        <div ref="sensRef" class="chart-host"></div>
      </div>
    </div>

    <!-- 单小时散点 + 拟合 -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">{{ selectedHour != null ? `${selectedHour}:00` : '—' }} 散点与拟合</span>
        <template v-if="hourReg && hourReg.n >= 2">
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              r²（判定系数）：该小时电价方差中可被{{ meta.label }}线性解释的比例（0~1）。
            </template>
            <span class="chip" tabindex="0">r² {{ hourReg.r2.toFixed(2) }}</span>
          </el-tooltip>
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              β（回归斜率）：该小时{{ meta.label }}每增 1 GW，电价变动的元/MWh 数；虚线为最小二乘拟合线。
            </template>
            <span class="chip" tabindex="0">β {{ fmtSlope(hourReg.slope) }}</span>
          </el-tooltip>
        </template>
        <span class="spacer" />
        <span v-for="l in legendRefLines" :key="l.legendLabel" class="vlg"><i :style="{ background: l.color }"></i>{{ l.legendLabel }}</span>
      </div>
      <div class="legend">
        <span v-for="(d, i) in dates" :key="d" class="lg">
          <span class="dot" :style="{ background: DATE_COLORS[i % DATE_COLORS.length] }"></span>{{ d.slice(5) }}
        </span>
        <span class="lg"><span class="fit-line"></span>拟合线</span>
      </div>
      <div ref="scatterRef" class="chart-host scatter"></div>
    </div>
  </div>
</template>

<style scoped>
.pd { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.kpis > * { flex: 1 1 160px; }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 10px 12px 8px; margin-top: 12px; }
.duo .card { margin-top: 0; }
.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-title { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-primary); }
.card-head .spacer { flex: 1; }
.hint {
  display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%;
  color: var(--el-text-color-secondary); cursor: help; font-size: var(--font-xs); border: 1px solid var(--el-border-color);
}
.chip {
  font-size: var(--font-sm); color: var(--el-text-color-regular); background: var(--el-fill-color);
  border-radius: 4px; padding: 1px 8px; cursor: help; font-variant-numeric: tabular-nums;
}
.legend { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 6px 2px 2px; }
.lg { font-size: var(--font-sm); color: var(--el-text-color-regular); display: inline-flex; align-items: center; }
.dot { width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
.fit-line { width: 16px; height: 0; border-top: 1.5px dashed #606266; margin-right: 4px; display: inline-block; }
.vlg { font-size: var(--font-sm); color: var(--el-text-color-regular); display: inline-flex; align-items: center; }
.vlg i { width: 14px; height: 3px; margin-right: 4px; display: inline-block; }
.chart-host { height: 400px; }
.chart-host.scatter { height: 360px; }
.mb { margin-bottom: 12px; }

@media (max-width: 992px) {
  .duo { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar .spacer { display: none; }
}
</style>
