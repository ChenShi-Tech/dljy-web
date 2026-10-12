<script setup lang="ts">
// 数据分析 (zsjfx) — 精修版,对照线上多曲线叠加分析器。
// 左:4 大分组标签(预测/策略与价格/电量/实际值,共63类型),勾选才进图例+绘线。
// 中:两列日期(自动联动上个月+本月),点某天看该天 96 点曲线。
// 右:6 个 Y 轴(负荷 左 | 比例%/电价/公司电量/出清电量/台数 右),坐标可固定/自动、Y轴可隐藏。
// 数据经市场洞察 zsjfx 契约归一为 meta(分组/轴/颜色/默认) + day(按日曲线) view model。
import { Sparkles, FolderOpen, Tag, ArrowLeftRight, TrendingUp, CalendarRange, Siren } from 'lucide-vue-next'
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchMarketInsightZsjfxDayContract,
  fetchMarketInsightZsjfxMetaContract,
  type ZsjfxMetaViewModel
} from '@/services/data/contracts'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, insideZoom, bottomToolbox, bottomLayoutLegend, emptyOverlay } from '@/services/chart/chartOptions'
import { useAnalysisStore } from '../stores/analysisData'
import DataState from '../components/common/DataState.vue'
import type { AnalysisView, ViewConfig } from '@/services/analysisClient'
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { normalizeContractBasis } from '@/services/data/contracts'
import { PAGE_PROMPT_KEYS } from '@/prompts'

import { POINTS_96 } from '@/utils/spotPoints96'
// S2（#3594）：对拍面板 / 衍生线 / 可用性热力 / 导出
import ZsjfxScorecardPanel from '@/components/analysis/ZsjfxScorecardPanel.vue'
import ZsjfxAvailabilityHeatmap from '@/components/analysis/ZsjfxAvailabilityHeatmap.vue'
import { fetchZsjfxScorecard, type ZsjfxScorecard } from '@/services/insight/zsjfxScorecardClient'
import { computeDerivedSeries, DERIVED_LABEL, normalizeDerivedSpecs, type DerivedKind, type DerivedSpec } from '@/utils/zsjfxDerived'
import { buildZsjfxCsv, downloadTextFile, zsjfxExportFilenames } from '@/utils/zsjfxExport'
// S3（#3595）：确定性 AI 素材与异动标记
import { buildAnomalyContext, buildAnomalyMarks, buildScorecardContext, segmentStats } from '@/utils/zsjfxAiContext'

const loading = ref(true)
const error = ref('')
const chartRef = ref<HTMLDivElement | null>(null)
const mainChart = useEChart(chartRef, { render, onInit: (instance) => { instance.on('brushEnd', onBrushEnd) } })

const meta = ref<ZsjfxMetaViewModel | null>(null)
const dateSet = ref<Set<string>>(new Set())
const selected = ref<string[]>([])
const currentDate = ref('')
const viewMonth = ref('') // YYYY-MM
const route = useRoute()
const qDate = typeof route.query.date === 'string' ? route.query.date : ''
// 当前日期同步至 URL(刷新/分享后还原所选日)
useQuerySync({ date: currentDate })
const fixedAxis = ref(true) // 坐标固定(默认) / 自动
const hideAxis = ref(false)
const activeGroups = ref<string[]>(['预测', '策略与价格', '电量', '实际值'])
const company = ref('默认公司')
const dayCache = ref<Record<string, Record<string, Array<number | null>>>>({})
// 取数契约的口径（captured/synthetic）；未取到/失败时保守 synthetic（R4 宁严勿谎）
const contractBasis = ref<'captured' | 'synthetic'>('synthetic')
// 防止切地区时旧地区慢响应覆盖新地区状态/日缓存（#415）。
let loadGeneration = 0

const groupEntries = computed<[string, string[]][]>(() => Object.entries(meta.value?.groups || {}))
const allTypes = computed<string[]>(() => Object.values(meta.value?.groups || {}).flat() as string[])

// 月份工具
const monthDays = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
const prevMonth = (ym: string) => { let [y, m] = ym.split('-').map(Number); m -= 1; if (m < 1) { m = 12; y -= 1 }; return `${y}-${String(m).padStart(2, '0')}` }
const cols = computed(() => {
  if (!viewMonth.value) return []
  return [prevMonth(viewMonth.value), viewMonth.value].map((ym) => ({
    ym,
    label: ym.split('-')[1] + '月',
    days: Array.from({ length: monthDays(ym) }, (_, i) => {
      const dd = String(i + 1).padStart(2, '0')
      const date = `${ym}-${dd}`
      return { dd, date, has: dateSet.value.has(date) }
    })
  }))
})

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  // 日缓存只按 date 键入，必须随 load（首次挂载/onRegionChange 切地区）清空
  // 否则切地区后同一天命中上一地区缓存，跨地区串读曲线（#411）。
  clearViewState()
  renderEmptyChart()
  mainChart.showLoading()
  try {
    const contract = await fetchMarketInsightZsjfxMetaContract({ region: currentRegion.value.id })
    contractBasis.value = normalizeContractBasis(contract.basis)
    if (generation !== loadGeneration) return
    meta.value = contract.blocks.zsjfx.meta ?? null
    if (!meta.value) throw new Error('暂无可用指标元数据')
    dateSet.value = new Set(meta.value.dates)
    selected.value = [...(meta.value.defaults ?? [])]
    const good: string[] = meta.value.goodDates?.length ? meta.value.goodDates : (meta.value.dates ?? [])
    if (!good.length) {
      error.value = '暂无可用日期数据'
      clearViewState()
      renderEmptyChart('暂无可用日期数据')
      return
    }
    currentDate.value = (qDate && good.includes(qDate)) ? qDate : good[good.length - 1]
    viewMonth.value = currentDate.value.slice(0, 7)
    const fetched = await fetchDay(currentDate.value, generation)
    if (generation !== loadGeneration || !fetched) return
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
  clearScorecardState()
  meta.value = null
  dateSet.value = new Set()
  selected.value = []
  currentDate.value = ''
  viewMonth.value = ''
  dayCache.value = {}
}

function renderEmptyChart(text = '暂无数据') {
  mainChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

async function fetchDay(date: string, generation = loadGeneration): Promise<boolean> {
  if (generation !== loadGeneration) return false
  if (dayCache.value[date]) return true
  try {
    const contract = await fetchMarketInsightZsjfxDayContract({ region: currentRegion.value.id, date })
    if (generation !== loadGeneration) return false
    dayCache.value[date] = contract.blocks.zsjfx.day?.series || {}
    return true
  } catch {
    if (generation !== loadGeneration) return false
    // 失败≠无数据（slim-and-fix-market-insight-pages R2）：不把失败缓存成「已加载且
    // 无数据」的成功态——不写 dayCache，该天保持可重试；热力图路径 loadHeat 自带
    // 失败三态，也不会再读到被污染的空缓存把失败日画成无数据灰格。
    ElMessage.warning(`${date} 当日数据加载失败`)
    return false
  }
}

async function pickDay(date: string, has: boolean) {
  if (!has) return
  const generation = loadGeneration
  currentDate.value = date
  mainChart.showLoading()
  try {
    const fetched = await fetchDay(date, generation)
    if (generation !== loadGeneration || !fetched) return
    render()
  } finally {
    if (generation === loadGeneration) mainChart.hideLoading()
  }
}

function colorOf(name: string, i: number) {
  const cm = meta.value?.colorMap || {}
  const fb = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4']
  return cm[name] || fb[i % fb.length]
}

// 按 Y 轴名推导该轴系列的 tooltip 单位
function axisUnit(name: string): string {
  if (name.includes('比例') || name.includes('%')) return '%'
  if (name.includes('价')) return '元/MWh'
  if (name.includes('负荷')) return 'MW'
  if (name.includes('电量')) return 'MWh'
  if (name.includes('台')) return '台'
  // 天气轴（#3592 S1 新增：辐照/风速/温度）
  if (name.includes('辐照')) return 'W/m²'
  if (name.includes('风速')) return 'm/s'
  if (name.includes('温度')) return '℃'
  return ''
}

// 类型粒度标注（ZW-02）：后端 meta.typeMeta 可选携带；周级类型呈阶梯线，非 96 点逐时口径
function granOf(name: string): string {
  return meta.value?.typeMeta?.[name]?.granularity ?? ''
}
const GRAN_LABEL: Record<string, string> = { weekly: '周级', daily: '日级', hourly: '小时' }
function granLabel(name: string): string {
  return GRAN_LABEL[granOf(name)] ?? ''
}
function granTitle(name: string): string {
  const tm = meta.value?.typeMeta?.[name]
  return tm ? `来源：${tm.source ?? '未标注'}｜粒度：${GRAN_LABEL[tm.granularity ?? ''] ?? tm.granularity ?? '未标注'}` : ''
}
function isStepKind(name: string): boolean {
  // 价格/持仓比例/策略类按时段恒定→阶梯线；周级披露口径恒定→阶梯线
  return /价|比例|策略/.test(name) || granOf(name) === 'weekly'
}

function render() {
  if (!meta.value) return
  const yz = meta.value.yzConfig || []
  const typeAxis = meta.value.typeAxis || {}
  const day = dayCache.value[currentDate.value] || {}
  const cc = chartChrome()

  // 6 个 Y 轴:轴0=负荷(左);轴1..5=右,依次外移
  const yAxis = yz.map((c: any, i: number) => {
    const right = i > 0
    const base: any = {
      type: 'value',
      name: hideAxis.value ? '' : c.name,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      position: right ? 'right' : 'left',
      offset: right ? (i - 1) * 54 : 0,
      axisLine: { show: !hideAxis.value, lineStyle: { color: cc.splitLine } },
      axisTick: { show: !hideAxis.value },
      axisLabel: { show: !hideAxis.value, color: cc.axisLabel, fontSize: 10 },
      splitLine: { show: i === 0 && !hideAxis.value, lineStyle: { color: cc.splitLine } }
    }
    if (fixedAxis.value) { base.min = c.min; base.max = c.max; base.interval = c.interval }
    else base.scale = true
    return base
  })

  // 只画"被勾选且当天有数据"的类型
  const drawn = selected.value.filter((t) => day[t] && day[t].some((v: any) => v != null))
  const series = drawn.map((name, i) => {
    const s: any = {
      name, type: 'line', ...(isStepKind(name) ? { step: 'start' } : {}), showSymbol: false, connectNulls: true,
      yAxisIndex: Number(typeAxis[name] ?? 0),
      lineStyle: { width: 1.6, color: colorOf(name, i) },
      itemStyle: { color: colorOf(name, i) },
      data: day[name]
    }
    // 持仓比例:加 100% 参考线(对照线上)
    if (name === '持仓比例') {
      s.markLine = { silent: true, symbol: ['none', 'arrow'], lineStyle: { type: 'dashed', color: colorOf(name, i) },
        label: { position: 'end', formatter: '100' }, data: [{ yAxis: 100 }] }
    }
    return s
  })

  // 各系列单位按其所属 Y 轴名推导
  // 衍生线（#3594 ZW-05）：当日两条已勾选曲线的确定性逐点运算；比值/覆盖率挂独立右轴
  const derivedBuilt = derivedSpecs.value
    .map((spec) => computeDerivedSeries(spec, day[spec.a] as Array<number | null> | undefined, day[spec.b] as Array<number | null> | undefined))
    .filter((d) => d.points.some((v) => v != null))
  const ratioKinds = derivedBuilt.filter((d) => d.kind !== 'diff')
  const derivedAxisIndex = yz.length
  const yAxisFinal = ratioKinds.length
    ? [...yAxis, {
        type: 'value', name: hideAxis.value ? '' : '比值/覆盖率', scale: true,
        nameTextStyle: { color: cc.axisLabel, fontSize: 11 }, position: 'right', offset: (yz.length - 1) * 54,
        axisLine: { show: !hideAxis.value, lineStyle: { color: cc.splitLine } },
        axisLabel: { show: !hideAxis.value, color: cc.axisLabel, fontSize: 10 },
        splitLine: { show: false }
      }]
    : yAxis
  const derivedSeries = derivedBuilt.map((d) => ({
    name: d.name, type: 'line', showSymbol: false, connectNulls: false,
    yAxisIndex: d.kind === 'diff' ? Number(typeAxis[d.a] ?? 0) : derivedAxisIndex,
    lineStyle: { width: 1.6, type: 'dashed', color: '#9a60b4' },
    itemStyle: { color: '#9a60b4' },
    data: d.points
  }))
  const legendData = [...drawn, ...derivedBuilt.map((d) => d.name)]

  // S3（#3595，ZW-08）：异动标记（口径对齐驾驶舱，服务端确定性派生）；开关关闭则不加任何标记，
  // 手动标注走 analysis store、与本渲染路径无关（关闭不影响其存取）。
  const freshSc = freshScorecard()
  const anomalyMarks = buildAnomalyMarks(freshSc?.anomalies ?? [], { show: showAnomalyMarks.value && !!freshSc })
  if (anomalyMarks.points.length || anomalyMarks.areas.length) {
    const attachPoint = (market: 'da' | 'rt') => {
      const name = market === 'da' ? '日前价出清' : '实时价出清'
      const target = [...series, ...derivedSeries].find((x: any) => x.name === name)
      if (target) {
        target.markPoint = {
          symbol: 'circle', symbolSize: 7,
          label: { show: true, formatter: '{b}', fontSize: 10, position: 'top' },
          // ZW-08：标记名带阈值口径（如「负价 <0」「逼近限价 ≥1080」），不依赖悬浮即可读
          data: anomalyMarks.points.filter((pt) => pt.market === market).map((pt) => ({ coord: pt.coord, name: pt.label, itemStyle: pt.itemStyle }))
        }
      }
    }
    attachPoint('da')
    attachPoint('rt')
    const first = [...series, ...derivedSeries][0]
    if (first && anomalyMarks.areas.length) {
      first.markArea = { silent: true, data: anomalyMarks.areas }
    }
  }

  const units: Record<string, string> = {}
  drawn.forEach((name) => { units[name] = axisUnit(String(yz[Number(typeAxis[name] ?? 0)]?.name || '')) })
  derivedBuilt.forEach((d) => { units[d.name] = d.kind === 'diff' ? axisUnit(String(yz[Number(typeAxis[d.a] ?? 0)]?.name || '')) : d.kind === 'coverage' ? '%' : '比值' })

  mainChart.setOption({
    tooltip: { ...axisTooltip({ units }), confine: true },
    // S3（#3595，ZW-07）：框选即问——lineX 框选槽位区间，brushEnd 生成确定性区段统计发 AI 侧栏
    brush: { toolbox: ['lineX'], xAxisIndex: 0, brushLink: 'all', throttleType: 'debounce', throttleDelay: 200, brushStyle: { borderColor: 'rgba(64,158,255,0.4)' }, title: '框选即问' },
    // 底部布局:工具栏右下角,图例顶部居中 scroll
    toolbox: { ...bottomToolbox('数据分析', 8), feature: { ...((bottomToolbox('数据分析', 8) as any).feature ?? {}), brush: { type: ['lineX'], title: '框选即问' } } },
    legend: bottomLayoutLegend({ data: legendData, itemWidth: 18, itemHeight: 8, textStyle: { fontSize: 11 } }),
    // 右侧留白随轴数伸缩（codex #235 R1：天气轴追加后固定 300 会把高位轴挤出画布）
    grid: { left: hideAxis.value ? 16 : 56, right: hideAxis.value ? 24 : Math.min(72 + yz.length * 54, 560),
      top: 64, bottom: 56, containLabel: hideAxis.value },
    dataZoom: insideZoom(),
    xAxis: { type: 'category', data: POINTS_96, boundaryGap: false,
      axisLabel: { interval: 8, color: cc.axisLabel, fontSize: 10 }, axisLine: { lineStyle: { color: cc.splitLine } } },
    yAxis: yAxisFinal,
    series: [...series, ...derivedSeries],
    ...emptyOverlay(!legendData.length, '暂无数据或未勾选数据项')
  }, { notMerge: true })
}

// 顶部按钮
function setDefaults() { selected.value = [...(meta.value?.defaults || [])]; render() }
function clearAll() { selected.value = []; render() }
function selectAll() { selected.value = [...allTypes.value]; render() }
function toggleFixed() { fixedAxis.value = !fixedAxis.value; render() }
function toggleHideAxis() { hideAxis.value = !hideAxis.value; render() }
function onQuery() { render() }
function onReset() {
  setDefaults()
  const g = meta.value?.goodDates || meta.value?.dates || []
  if (g.length) {
    const generation = loadGeneration
    currentDate.value = g[g.length - 1]
    viewMonth.value = currentDate.value.slice(0, 7)
    fetchDay(currentDate.value, generation).then((fetched) => {
      if (generation === loadGeneration && fetched) render()
    })
  }
}

// Phase 6 PR-B：分析视图/标注（analysis.sqlite 用户产物，/api/v1/analysis/*）
const analysis = useAnalysisStore()
const ROUTE_PATH = '/sjfx/singleZsjfx'
const viewsDrawer = ref(false)
const savingView = ref(false)
const viewNameInput = ref('')
const annoDialog = ref(false)
const annoContent = ref('')

// 序列化当前页面状态为可还原的 ViewConfig（不含瞬时数据缓存 dayCache/meta）
function currentConfig(): ViewConfig {
  return {
    kind: 'page-state',  // 判别式：区分于 agent 图表/仪表盘快照 config（对齐 contracts 1.12.0 analysis-view）
    selected: [...selected.value], currentDate: currentDate.value, viewMonth: viewMonth.value,
    fixedAxis: fixedAxis.value, hideAxis: hideAxis.value,
    activeGroups: [...activeGroups.value], company: company.value,
    derived: derivedSpecs.value.map((spec) => ({ kind: spec.kind, a: spec.a, b: spec.b }))
  }
}
// 应用已保存视图：回写各 ref → 触发 ECharts 重渲
function applyConfig(cfg: ViewConfig) {
  selected.value = [...(cfg.selected ?? [])]
  if (cfg.viewMonth) viewMonth.value = cfg.viewMonth
  if (cfg.currentDate) currentDate.value = cfg.currentDate
  fixedAxis.value = !!cfg.fixedAxis
  hideAxis.value = !!cfg.hideAxis
  activeGroups.value = [...(cfg.activeGroups ?? [])]
  if (cfg.company) company.value = cfg.company
  derivedSpecs.value = normalizeDerivedSpecs(cfg.derived)
  viewsDrawer.value = false
  // 应用视图后取当日数据再渲染（避免 fetchDay 完成前空图闪烁，复用 pickDay 的 loading 包裹）
  if (cfg.currentDate) {
    const generation = loadGeneration
    mainChart.showLoading()
    fetchDay(cfg.currentDate, generation).then((fetched) => {
      if (generation === loadGeneration && fetched) render()
    }).finally(() => {
      if (generation === loadGeneration) mainChart.hideLoading()
    })
  } else {
    render()
  }
}
async function onOpenViews() { viewsDrawer.value = true; await analysis.loadViews(ROUTE_PATH) }
async function onSaveView() {
  const name = viewNameInput.value.trim() || `视图 ${new Date().toLocaleString('zh-CN')}`
  savingView.value = true
  try { await analysis.saveView(name, ROUTE_PATH, currentConfig()); ElMessage.success('视图已保存'); viewNameInput.value = '' }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '保存失败') }
  finally { savingView.value = false }
}
async function onApplyView(v: AnalysisView) { applyConfig(v.config); ElMessage.success(`已应用视图：${v.name}`) }
async function onDeleteView(viewId: string) {
  try { await analysis.deleteView(viewId); ElMessage.success('视图已删除') }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '删除失败') }
}
async function onSaveAnnotation() {
  if (!annoContent.value.trim() || !currentDate.value) return
  try {
    await analysis.saveAnnotation('point', `sdpt_zsjfx_idx|${currentDate.value}`, annoContent.value.trim())
    ElMessage.success('标注已保存'); annoContent.value = ''; annoDialog.value = false
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '标注保存失败') }
}

// ── S3（#3595，ZW-07/08）：框选区段即问 + 异动标记开关 ──
// 框选：ECharts brush（lineX）选槽位区间 → 确定性区段统计 → AI 侧栏提问（素材为算好的数值）。
const segmentSelection = ref<{ from: number; to: number } | null>(null)
const showAnomalyMarks = ref(true)
try { showAnomalyMarks.value = localStorage.getItem('zsjfx.anomalyMarks') !== 'off' } catch { /* 无 localStorage 环境按默认开 */ }
function toggleAnomalyMarks() {
  showAnomalyMarks.value = !showAnomalyMarks.value
  try { localStorage.setItem('zsjfx.anomalyMarks', showAnomalyMarks.value ? 'on' : 'off') } catch { /* 忽略存储失败 */ }
  render()
}
function drawnSeriesMap(): Record<string, Array<number | null>> {
  const day = dayCache.value[currentDate.value] || {}
  const out: Record<string, Array<number | null>> = {}
  for (const t of selected.value) {
    if (day[t] && (day[t] as Array<number | null>).some((v) => v != null)) out[t] = day[t] as Array<number | null>
  }
  return out
}
function segmentContextSnapshot(): Record<string, unknown> {
  if (!segmentSelection.value) return {}
  const { from, to } = segmentSelection.value
  const stats = segmentStats(drawnSeriesMap(), from, to)
  return {
    slot_range: `${POINTS_96[from]}~${POINTS_96[to]}`,
    date: currentDate.value,
    series_stats: stats
  }
}
/** codex #239 R1-01：与当前地区+日期同时匹配的对拍结果才可被消费（上下文与标记同源）。 */
function freshScorecard() {
  const sc = scorecard.value
  return sc && sc.regionId === currentRegion.value.id && sc.dateTo === currentDate.value ? sc : null
}
function onBrushEnd(params: unknown) {
  const areas = (params as { areas?: Array<{ coordRange?: [number, number] }> })?.areas ?? []
  const range = areas[0]?.coordRange
  if (!Array.isArray(range) || range.length !== 2) return
  const from = Math.max(0, Math.round(Math.min(range[0], range[1])))
  const to = Math.min(95, Math.round(Math.max(range[0], range[1])))
  if (to <= from) return
  segmentSelection.value = { from, to }
  ai.ask(`请解读我在 ${currentDate.value} ${POINTS_96[from]}~${POINTS_96[to]} 选中的时段（各序列统计已附上，请基于数值分析不要自行计算）`, { context: segmentContextSnapshot() })
  mainChart.instance()?.dispatchAction({ type: 'brush', areas: [] })
}

// ── S2（#3594）：预测×实际对拍面板 ──
const scorecardDrawer = ref(false)
const scorecard = ref<ZsjfxScorecard | null>(null)
const scorecardLoading = ref(false)
const scorecardError = ref('')
const scorecardPair = ref('load-d1')
const scorecardWindow = ref<'day' | '30d'>('day')

function scorecardRange(): { dateFrom: string; dateTo: string } {
  const dateTo = currentDate.value
  if (scorecardWindow.value === 'day' || !dateTo) return { dateFrom: dateTo, dateTo }
  const from = new Date(Date.parse(`${dateTo}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10)
  return { dateFrom: from, dateTo }
}

let scorecardGeneration = 0
async function loadScorecard() {
  if (!currentDate.value) return
  // codex #238 R1-01：请求代次守卫——切地区/改日期/换配对后，过期响应不得覆盖新上下文
  const generation = ++scorecardGeneration
  const region = currentRegion.value.id
  scorecardLoading.value = true
  scorecardError.value = ''
  try {
    const { dateFrom, dateTo } = scorecardRange()
    const result = await fetchZsjfxScorecard({ pair: scorecardPair.value, dateFrom, dateTo })
    if (generation !== scorecardGeneration || region !== currentRegion.value.id) return
    scorecard.value = result
    if (result.pair.id !== scorecardPair.value) scorecardPair.value = result.pair.id
  } catch (e) {
    if (generation !== scorecardGeneration) return
    scorecardError.value = e instanceof Error ? e.message : '对拍加载失败'
  } finally {
    if (generation === scorecardGeneration) scorecardLoading.value = false
  }
}
// codex #238 R1-01：切地区时清空对拍状态（load 会重建），旧地区结果不进入新上下文
function clearScorecardState() {
  scorecardGeneration += 1
  scorecard.value = null
  scorecardError.value = ''
  scorecardLoading.value = false
}
async function openScorecard() {
  scorecardDrawer.value = true
  await loadScorecard()
}
function onScorecardPair(pairId: string) {
  scorecardPair.value = pairId
  loadScorecard()
}
function onScorecardWindow(win: 'day' | '30d') {
  scorecardWindow.value = win
  loadScorecard()
}

// ── S2（#3594）：衍生线生成器（差值/比值/覆盖率；空值传播、分母保护见 utils）──
const derivedSpecs = ref<DerivedSpec[]>([])
const derivedDialog = ref(false)
const derivedKind = ref<DerivedKind>('diff')
const derivedA = ref('')
const derivedB = ref('')
const derivedCandidates = computed(() => {
  const day = dayCache.value[currentDate.value] || {}
  return selected.value.filter((t) => day[t] && (day[t] as Array<number | null>).some((v) => v != null))
})
function openDerivedDialog() {
  const c = derivedCandidates.value
  if (c.length < 2) { ElMessage.info('衍生线需要至少勾选 2 条当日有数据的曲线'); return }
  derivedA.value = c[0]
  derivedB.value = c[1]
  derivedDialog.value = true
}
function addDerived() {
  if (!derivedA.value || !derivedB.value || derivedA.value === derivedB.value) { ElMessage.warning('请选择两条不同的曲线'); return }
  const spec: DerivedSpec = { kind: derivedKind.value, a: derivedA.value, b: derivedB.value }
  if (derivedSpecs.value.some((d) => d.kind === spec.kind && d.a === spec.a && d.b === spec.b)) { ElMessage.info('该衍生线已存在'); return }
  derivedSpecs.value = [...derivedSpecs.value, spec]
  derivedDialog.value = false
  render()
}
function removeDerived(name: string) {
  derivedSpecs.value = derivedSpecs.value.filter((d) => derivedNameOf(d) !== name)
  render()
}
function derivedNameOf(d: DerivedSpec): string {
  return computeDerivedSeries(d, [], []).name
}

// ── S2（#3594）：数据可用性热力（按月拉取逐日 series，真实非空判定）──
const heatDialog = ref(false)
const heatLoading = ref(false)
const heatMonth = ref('')
const heatDates = ref<string[]>([])
const heatGrid = ref<Record<string, Record<string, boolean | 'failed'>>>({})

async function openHeat() {
  heatMonth.value = viewMonth.value || (currentDate.value ? currentDate.value.slice(0, 7) : '')
  heatDialog.value = true
  await loadHeat()
}
let heatGeneration = 0
async function loadHeat() {
  if (!heatMonth.value || !meta.value) return
  const ym = heatMonth.value
  const days = monthDays(ym)
  // codex #238 R1-05：月份代次守卫——旧月份的迟到结果不得覆盖新月份网格
  const generation = ++heatGeneration
  heatLoading.value = true
  try {
    const grid: Record<string, Record<string, boolean | 'failed'>> = {}
    let failedDays = 0
    for (let i = 1; i <= days; i += 1) {
      const date = `${ym}-${String(i).padStart(2, '0')}`
      // codex R1-02：取数失败 ≠ 无数据——目录覆盖日直接取契约，失败日全类型标 'failed'
      // （三态格子：不计入无数据与覆盖分母，显示可重试提示；不污染日缓存）
      if (dateSet.value.has(date)) {
        if (!dayCache.value[date]) {
          try {
            const contract = await fetchMarketInsightZsjfxDayContract({ region: currentRegion.value.id, date })
            dayCache.value[date] = contract.blocks.zsjfx.day?.series || {}
          } catch {
            failedDays += 1
            for (const type of allTypes.value) {
              if (!grid[type]) grid[type] = {}
              grid[type][date] = 'failed'
            }
            continue
          }
        }
        const day = dayCache.value[date]
        if (!day) continue
        for (const type of allTypes.value) {
          const curve = day[type]
          const has = Array.isArray(curve) && curve.some((v: any) => v != null)
          if (!grid[type]) grid[type] = {}
          grid[type][date] = has
        }
      }
    }
    if (generation !== heatGeneration) return
    heatGrid.value = grid
    heatDates.value = Array.from({ length: days }, (_, k) => `${ym}-${String(k + 1).padStart(2, '0')}`)
    if (failedDays) ElMessage.warning(`${ym} 有 ${failedDays} 天取数失败，已跳过（未计为无数据，可重试）`)
  } finally {
    if (generation === heatGeneration) heatLoading.value = false
  }
}

// ── S2（#3594）：导出（图片=当前视口；CSV=当前绘制系列+衍生线，空值为空单元格）──
function currentUnits(name: string): string {
  const yz = (meta.value?.yzConfig || []) as Array<{ name?: string }>
  const idx = Number(meta.value?.typeAxis?.[name] ?? 0)
  return axisUnit(String(yz[idx]?.name || ''))
}
function exportCsv() {
  if (!currentDate.value) return
  const day = dayCache.value[currentDate.value] || {}
  const drawn = selected.value.filter((t) => day[t] && (day[t] as Array<number | null>).some((v) => v != null))
  if (!drawn.length && !derivedSpecs.value.length) { ElMessage.info('当前没有可导出的曲线'); return }
  const series = drawn.map((name) => ({ name, unit: currentUnits(name), points: day[name] as Array<number | null> }))
  for (const spec of derivedSpecs.value) {
    const d = computeDerivedSeries(spec, day[spec.a], day[spec.b])
    series.push({ name: `${d.name}（${DERIVED_LABEL[d.kind]}）`, unit: d.kind === 'diff' ? currentUnits(spec.a) : d.kind === 'coverage' ? '%' : '比值', points: d.points })
  }
  downloadTextFile(zsjfxExportFilenames(currentDate.value).csv, buildZsjfxCsv({ date: currentDate.value, series }))
}
function exportPng() {
  const url = mainChart.instance()?.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' })
  if (!url) { ElMessage.warning('图表尚未渲染'); return }
  const a = document.createElement('a')
  a.href = url
  a.download = zsjfxExportFilenames(currentDate.value || 'chart').png
  a.click()
}

const ai = useAiSidebar()
// 「解读本页」：当前日期 + 已勾选分组 + 当日实绘序列的极值/均值作摘要（勿传 dayCache 96 点逐点）。
function insightContext(): Record<string, unknown> {
  const day = dayCache.value[currentDate.value] || {}
  const drawn = selected.value.filter((t) => day[t] && day[t].some((v: any) => v != null))
  const stat = (arr: any[]) => {
    const nums = (arr || []).filter((v: any) => typeof v === 'number')
    if (!nums.length) return null
    return { min: Math.round(Math.min(...nums)), max: Math.round(Math.max(...nums)), avg: Math.round(nums.reduce((s, x) => s + x, 0) / nums.length) }
  }
  // S3（#3595，ZW-07）：AI 素材升级为确定性指标包——对拍结果/异动/可用性都是算好的数值，
  // LLM 只叙事不计算；区段统计在用户框选后由 segment_context 附加。
  // codex #239 R1-01：只消费与当前地区+日期同时匹配的对拍结果，过期结果不进 AI 上下文
  const scorecardFresh = freshScorecard()
  const scorecardCtx = buildScorecardContext(scorecardFresh) ?? null
  const anomalyCtx = buildAnomalyContext(scorecardFresh) ?? []
  return {
    page: '综合数据分析 (singleZsjfx)',
    current_date: currentDate.value,
    active_groups: activeGroups.value,
    selected_count: selected.value.length,
    drawn_series: drawn.map((name) => ({ name, stat: stat(day[name]) })),
    axis_mode: fixedAxis.value ? '坐标固定' : '坐标自动',
    type_granularities: Object.keys(meta.value?.typeMeta ?? {}).length
      ? Object.fromEntries(Object.entries(meta.value!.typeMeta!).map(([t, tm]) => [t, tm.granularity]))
      : undefined,
    scorecard: scorecardCtx ?? undefined,
    anomalies: anomalyCtx.length ? anomalyCtx : undefined,
    anomaly_notes: scorecard.value?.anomalyNotes?.length ? scorecard.value.anomalyNotes : undefined,
    segment_context: segmentSelection.value ? segmentContextSnapshot() : undefined,
    note: '本页可叠加目录内全部类型曲线；drawn_series/scorecard/anomalies 均为确定性统计（非 LLM 计算），96 点逐点未传',
    // R4：消费取数契约口径（captured/synthetic），不硬编码真实采集
    basis: contractBasis.value
  }
}

// 页面接入 AI 侧边栏：悬浮球、「解读本页」按钮共用这份声明与切片（点击时刻求值）。
defineAiPage({ label: '综合数据分析', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: insightContext } })
function askInsight() {
  ai.interpret()
}

onMounted(load)
watch(selected, render, { deep: true })
// codex #239 R1-02：对拍结果落地/失效后重绘，异动标记不依赖无关操作才出现
watch([scorecard, currentDate], render)

onRegionChange(load)
</script>

<template>
  <div class="a2" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />

    <!-- 顶部工具条 -->
    <div class="toolbar">
      <el-button-group class="mode">
        <el-button size="small" type="success">展示日期</el-button>
        <el-tooltip content="线上功能，暂未接入" placement="bottom"><span><el-button size="small" disabled>弹出日历</el-button></span></el-tooltip>
        <el-tooltip content="线上功能，暂未接入" placement="bottom"><span><el-button size="small" disabled>分别指定</el-button></span></el-tooltip>
      </el-button-group>
      <el-date-picker v-model="viewMonth" type="month" value-format="YYYY-MM" size="small"
        :clearable="false" placeholder="选择月份" style="width: 130px" />
      <el-select v-model="company" size="small" style="width: 130px">
        <el-option label="默认公司" value="默认公司" />
      </el-select>
      <span class="spacer" />
      <el-button size="small" type="warning" :icon="FolderOpen" @click="onOpenViews">我的视图</el-button>
      <el-button size="small" :icon="Tag" @click="annoDialog = true">标注</el-button>
      <el-button size="small" type="primary" @click="setDefaults">默认数据项</el-button>
      <el-button size="small" type="primary" @click="clearAll">清空数据项</el-button>
      <el-tooltip content="线上功能，暂未接入" placement="bottom"><span><el-button size="small" type="primary" plain disabled>纵向展示</el-button></span></el-tooltip>
      <el-button size="small" type="success" plain :icon="ArrowLeftRight" @click="openScorecard">对拍</el-button>
      <el-button size="small" type="success" plain :icon="TrendingUp" @click="openDerivedDialog">衍生线</el-button>
      <el-button size="small" type="success" plain :icon="CalendarRange" @click="openHeat">可用性</el-button>
      <el-button size="small" :type="showAnomalyMarks ? 'warning' : 'info'" plain :icon="Siren" @click="toggleAnomalyMarks">{{ showAnomalyMarks ? '异动开' : '异动关' }}</el-button>
      <el-button size="small" type="primary" @click="toggleFixed">{{ fixedAxis ? '坐标自动' : '坐标固定' }}</el-button>
      <el-button size="small" type="primary" @click="selectAll">所有数据</el-button>
      <el-button size="small" type="primary" @click="toggleHideAxis">{{ hideAxis ? '显示Y轴' : '隐藏Y轴' }}</el-button>
      <el-button size="small" type="success" plain :icon="Sparkles" @click="askInsight">解读本页</el-button>
    </div>

    <div class="body">
      <!-- 左:标签分组 -->
      <aside class="tags">
        <div class="tag-actions">
          <el-button size="small" type="primary" @click="onQuery">查询</el-button>
          <el-button size="small" @click="onReset">重置</el-button>
          <el-tooltip content="线上功能，暂未接入" placement="bottom"><span><el-button size="small" disabled>配置</el-button></span></el-tooltip>
          <el-button size="small" type="primary" @click="exportPng">导出图</el-button>
        <el-button size="small" type="primary" @click="exportCsv">导出CSV</el-button>
        </div>
        <el-checkbox-group v-model="selected" class="grp-wrap">
          <el-collapse v-model="activeGroups">
            <el-collapse-item v-for="[gname, types] in groupEntries" :key="gname" :name="gname">
              <template #title>
                <span class="grp-title">{{ gname }}<em>{{ types.length }}</em></span>
              </template>
              <div class="grp-items">
                <el-checkbox v-for="t in types" :key="t" :value="t" :label="t" class="tag-item">
                  <span class="dot" :style="{ background: colorOf(t, 0) }"></span>{{ t }}
                  <em v-if="granLabel(t)" class="gran" :title="granTitle(t)">{{ granLabel(t) }}</em>
                </el-checkbox>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-checkbox-group>
      </aside>

      <!-- 中:两列日期 -->
      <div class="dates">
        <div v-for="c in cols" :key="c.ym" class="datecol">
          <div class="dchead">{{ c.label }}</div>
          <div v-for="d in c.days" :key="d.date"
            class="dcell" :class="{ on: d.date === currentDate, has: d.has, off: !d.has }"
            @click="pickDay(d.date, d.has)">{{ d.dd }}</div>
        </div>
      </div>

      <!-- 右:图表 -->
      <div class="chart-wrap">
        <div ref="chartRef" class="chart chart-host"></div>
        <!-- 数据源(内部参考,勿对外展示)：市场洞察 zsjfx 契约 ｜ 已选 类 -->
      </div>
    </div>

    <!-- Phase 6 PR-B：我的分析视图（analysis.sqlite 用户产物，basis=user_saved）-->
    <el-drawer v-model="viewsDrawer" title="我的分析视图" direction="rtl" size="360px">
      <div class="save-row">
        <el-input v-model="viewNameInput" size="small" placeholder="视图名称（留空用默认名）" />
        <el-button size="small" type="primary" :loading="savingView" @click="onSaveView">保存当前</el-button>
      </div>
      <DataState :loading="analysis.loading" :error="analysis.error || undefined" :empty="!analysis.views.length" emptyText="暂无保存的视图">
        <div class="view-list">
          <div v-for="v in analysis.views" :key="v.viewId" class="view-item">
            <div class="view-head">
              <span class="view-name">{{ v.name }}</span>
              <el-tag size="small" type="info">我的视图</el-tag>
            </div>
            <div class="view-meta">{{ v.config?.selected?.length || 0 }} 项 · {{ v.config?.currentDate || '-' }} · {{ v.config?.company || '' }}</div>
            <div class="view-actions">
              <el-button size="small" @click="onApplyView(v)">应用</el-button>
              <el-button size="small" type="danger" plain @click="onDeleteView(v.viewId)">删除</el-button>
            </div>
          </div>
        </div>
      </DataState>
    </el-drawer>

    <!-- S2（#3594）：预测×实际对拍抽屉（服务端确定性指标，前端只渲染） -->
    <el-drawer v-model="scorecardDrawer" title="预测 × 实际对拍" direction="rtl" size="480px">
      <ZsjfxScorecardPanel
        :scorecard="scorecard"
        :loading="scorecardLoading"
        :error="scorecardError || undefined"
        :window="scorecardWindow"
        @pair-change="onScorecardPair"
        @window-change="onScorecardWindow"
        @interpret="ai.interpret()"
      />
    </el-drawer>

    <!-- S2（#3594）：衍生线对话框（空值传播/分母保护见 utils/zsjfxDerived） -->
    <el-dialog v-model="derivedDialog" title="生成衍生线" width="460px">
      <el-form label-width="90px" size="small">
        <el-form-item label="运算">
          <el-radio-group v-model="derivedKind">
            <el-radio-button value="diff">差值 A−B</el-radio-button>
            <el-radio-button value="ratio">比值 A÷B</el-radio-button>
            <el-radio-button value="coverage">覆盖率 B÷A</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="曲线 A">
          <el-select v-model="derivedA" filterable>
            <el-option v-for="t in derivedCandidates" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="曲线 B">
          <el-select v-model="derivedB" filterable>
            <el-option v-for="t in derivedCandidates" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="derivedDialog = false">取消</el-button>
        <el-button size="small" type="primary" @click="addDerived">生成</el-button>
      </template>
    </el-dialog>

    <!-- S2（#3594）：数据可用性热力（按月拉取逐日 series 的真实非空判定） -->
    <el-dialog v-model="heatDialog" title="数据可用性（类型 × 日期）" width="860px">
      <div class="heat-bar">
        <el-date-picker v-model="heatMonth" type="month" value-format="YYYY-MM" size="small" :clearable="false" @change="loadHeat" />
        <span v-if="heatLoading" class="heat-loading">加载中…</span>
      </div>
      <ZsjfxAvailabilityHeatmap
        :month="heatMonth"
        :types="allTypes"
        :dates="heatDates"
        :grid="heatGrid"
        :type-meta="meta?.typeMeta"
      />
    </el-dialog>

    <!-- 衍生线管理：已生成清单（可移除） -->
    <div v-if="derivedSpecs.length" class="derived-list">
      <el-tag
        v-for="spec in derivedSpecs"
        :key="spec.kind + spec.a + spec.b"
        size="small"
        closable
        @close="removeDerived(derivedNameOf(spec))"
      >{{ DERIVED_LABEL[spec.kind] }}：{{ spec.a }} / {{ spec.b }}</el-tag>
    </div>

    <el-dialog v-model="annoDialog" title="添加数据点标注" width="420px">
      <el-input v-model="annoContent" type="textarea" :rows="3" :placeholder="currentDate ? `对 ${currentDate} 添加标注（point · target=sdpt_zsjfx_idx|${currentDate}）` : '请先选择日期'" />
      <template #footer>
        <el-button size="small" @click="annoDialog = false">取消</el-button>
        <el-button size="small" type="primary" :disabled="!annoContent.trim() || !currentDate" @click="onSaveAnnotation">保存标注</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.a2 { padding: 12px 16px; background: var(--el-fill-color-light); height: calc(100vh - 100px); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .spacer { flex: 1; }
.body { display: grid; grid-template-columns: 232px 132px minmax(0, 1fr); gap: 12px; margin-top: 12px; flex: 1; min-height: 0; }

/* 左:标签分组 */
.tags { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 10px; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.tag-actions { display: flex; gap: 6px; margin-bottom: 8px; }
.tag-actions .el-button { flex: 1; padding: 6px 0; }
.grp-wrap { flex: 1; overflow: auto; }
.grp-title { font-weight: 600; font-size: var(--font-lg); color: var(--el-text-color-primary); }
.grp-title em { font-style: normal; color: var(--el-text-color-disabled); font-size: var(--font-sm); margin-left: 6px; }
.grp-items { display: flex; flex-direction: column; gap: 2px; }
.tag-item { height: auto; margin-right: 0; display: flex; align-items: center; }
.tag-item :deep(.el-checkbox__label) { font-size: var(--font-sm); color: var(--el-text-color-secondary); display: inline-flex; align-items: center; white-space: normal; line-height: 1.3; }
.tag-item.is-checked :deep(.el-checkbox__label) { color: var(--el-text-color-primary); font-weight: 600; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; flex: none; opacity: .35; }
.tag-item.is-checked .dot { opacity: 1; }
/* 粒度标注（ZW-02）：周级/日级/小时口径徽标，悬浮显示来源 */
.gran { font-style: normal; font-size: var(--font-xs); line-height: 1; padding: 1px 4px; border-radius: 3px; margin-left: 4px; flex: none;
  color: var(--el-color-primary); background: var(--primary-tint); cursor: help; }

/* 中:日期两列 */
.dates { display: flex; gap: 8px; background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px; height: 100%; min-height: 0; }
.datecol { flex: 1; overflow: auto; }
.dchead { position: sticky; top: 0; background: var(--panel-sub); color: var(--el-text-color-regular); font-weight: 600; font-size: var(--font-sm); text-align: center; padding: 4px 0; border-radius: 4px; margin-bottom: 4px; }
.dcell { text-align: center; font-size: var(--font-sm); padding: 3px 0; margin-bottom: 2px; border-radius: 4px; color: var(--el-text-color-disabled); cursor: default; user-select: none; }
.dcell.has { color: var(--el-text-color-regular); cursor: pointer; background: var(--el-fill-color-lighter); }
.dcell.has:hover { background: var(--primary-tint); color: var(--el-color-primary); }
.dcell.on { background: var(--el-color-primary); color: #fff; font-weight: 700; }
.dcell.off { color: var(--el-text-color-disabled); }

/* 右:图表 */
.chart-wrap { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px 12px; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.chart { flex: 1; width: 100%; min-height: 0; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 4px 0 0; }
.src code { color: var(--el-color-primary); }
.mb { margin-bottom: 12px; }
/* S2（#3594）：衍生线清单与热力工具条 */
.derived-list { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.heat-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.heat-loading { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
/* Phase 6 PR-B：我的视图抽屉 */
.save-row { display: flex; gap: 8px; margin-bottom: 12px; }
.save-row .el-input { flex: 1; }
.view-list { display: flex; flex-direction: column; gap: 8px; }
.view-item { background: var(--el-fill-color-light); border-radius: 8px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); }
.view-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.view-name { font-weight: 600; font-size: var(--font-md); color: var(--el-text-color-primary); word-break: break-all; }
.view-meta { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-bottom: 8px; }
.view-actions { display: flex; gap: 6px; }
/* 窄屏:三栏布局退化为单列;移动端筛选条纵排、图表卡片降高。
   桌面定高+overflow:hidden 会截断单列内容，窄屏恢复页面自然滚动。 */
@media (max-width: 1024px) {
  .a2 { height: auto; min-height: calc(100vh - 100px); overflow: visible; }
  .body { grid-template-columns: 1fr; flex: none; }
  .tags { height: auto; max-height: 320px; }
  .dates { height: 280px; }
}
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .chart-wrap { height: 320px; }
}
</style>
