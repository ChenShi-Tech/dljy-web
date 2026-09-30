<script setup lang="ts">
// 申报决策驾驶舱（#77 唯一决策出口）：消费 agent-backend 预测、风险量化、mean-CVaR 报价优化、
// 申报建议与决策概览端点。工作台可带上下文（?model/date/train_days）跳入。
// 页面仅做前端装配，不写入申报单，不作为结算依据。
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Activity,
  ClipboardList,
  Gauge,
  LineChart,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingUp
} from 'lucide-vue-next'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '@/components/CapabilitySupportBadge.vue'
import CockpitRegionLockedCard from '@/components/spot/cockpit/CockpitRegionLockedCard.vue'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import ForecastProvenanceTags from '@/components/forecast/ForecastProvenanceTags.vue'
import {
  isMockProvenance, isUnavailableProvenance, provenanceWarnings, type ForecastProvenance,
} from '@/services/forecast/forecastProvenance'
import TrustBadge from '@/components/common/TrustBadge.vue'
import { useEChart } from '@/composables/useEChart'
import { onRegionChange } from '@/composables/useRegionReload'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import {
  fetchBidAdvice,
  fetchCockpit,
  fetchOptimizeBid,
  fetchRiskQuantify,
  runForecastPredict,
  type BidAdviceResult,
  type CockpitResult,
  type ForecastModel,
  type ForecastResult,
  type OptimizeBidFrontierPoint,
  type OptimizeBidResult,
  type RiskQuantifyResult
} from '@/services/forecast/mlForecastClient'
import { ensureForecastCatalog, forecastCatalogState, isModelSelectableForTarget, isPredictSupported } from '@/services/forecast/forecastProviders'
import { latestBenchContext } from '@/services/forecast/forecastBenchContext'
import { predictionModelExclusionReason } from '@/services/forecast/predictionModelEligibility'
import { loadClearingCurve, type SpotCurve } from '@/services/market/spotPrice'
import { axisTooltip, chartToolbox, emptyOverlay, fmtNum, insideZoom } from '@/services/chart/chartOptions'
import {
  POWER,
  areaSeries,
  catAxis,
  grid,
  legend,
  lineSeries,
  stepSeries,
  tooltipStyle,
  valueAxis,
  withAlpha
} from '@/services/chart/chartStyle'

const ROUTE_PATH = '/ycsj/decision-cockpit'
const DEFAULT_LAMBDAS = [0, 1, 3]
const RISK_LEVEL_LABEL: Record<OptimizeBidFrontierPoint['risk_level'], string> = {
  aggressive: '激进',
  neutral: '中性',
  conservative: '保守'
}
const RISK_LEVEL_COLOR: Record<OptimizeBidFrontierPoint['risk_level'], string> = {
  aggressive: POWER.positive,
  neutral: POWER.price,
  conservative: POWER.deviation
}

// 工作台「在驾驶舱中使用此上下文」跳入时经 query 带 model/date/train_days（setup 期一次性消费，
// 避免 onMounted 里再赋值触发 watch 双发 loadCockpit）。非法值回退默认。
const route = useRoute()
function queryStr(key: string): string {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const benchInit = latestBenchContext.value
// 价格腿与负荷腿各自选模型（#2324）：remote:* 真实模型多为单 target 上架
// （只声明 price 或只声明 load），旧版一个 modelType 跑两腿把它们整体挡在选择之外。
// `?model=` 深链仍认，同时设两腿（向后兼容，行为与旧版一致）。
const priceModelType = ref(queryStr('priceModel') || queryStr('model') || benchInit?.modelId || 'xgboost')
const loadModelType = ref(queryStr('loadModel') || queryStr('model') || benchInit?.modelId || 'xgboost')
// 决策概览（/cockpit 聚合端点）后端用**同一个** model_type 跑 PRICE+LOAD 两腿，
// 两腿选了不同模型时它无法如实表达——此时不发请求、页内明示，不拿一条腿的模型冒充两腿。
const bothLegsSameModel = computed(() => priceModelType.value === loadModelType.value)
// 空 = 首屏用后端最近可用交易日（省略 target_date）；用户可手动选历史日回溯。
// 不预设未来日：/forecast/predict 对无基本面数据的未来日 raise ValueError→400（#546）。
const targetDate = ref(/^\d{4}-\d{2}-\d{2}$/.test(queryStr('date')) ? queryStr('date') : (benchInit?.targetDate ?? ''))
const queryTrainDays = Number(queryStr('train_days'))
const trainDays = ref(Number.isFinite(queryTrainDays) && queryTrainDays >= 30 && queryTrainDays <= 365 ? Math.round(queryTrainDays) : (benchInit && benchInit.trainDays >= 30 && benchInit.trainDays <= 365 ? benchInit.trainDays : 180))
const capacityMw = ref(100)
const selectedLambda = ref(1)
const alpha = ref(0.95)

const subjectType = ref<'retailer' | 'storage'>('retailer')

const loading = ref(false)
const optimizeLoading = ref(false)
const riskLoading = ref(false)
const adviceLoading = ref(false)
const overviewLoading = ref(false)
const errorMsg = ref('')
const advice = ref<BidAdviceResult | null>(null)
const decisionOverview = ref<CockpitResult | null>(null)
const actualCurveDate = ref('')
const actualCurve = ref<SpotCurve | null>(null)
const priceForecast = ref<ForecastResult | null>(null)
const optimizeResult = ref<OptimizeBidResult | null>(null)
const riskResult = ref<RiskQuantifyResult | null>(null)

const bandChartEl = ref<HTMLElement | null>(null)
const bidChartEl = ref<HTMLElement | null>(null)
const frontierChartEl = ref<HTMLElement | null>(null)
const bandChart = useEChart(bandChartEl, { render: renderBandChart })
const bidChart = useEChart(bidChartEl, { render: renderBidChart })
const frontierChart = useEChart(frontierChartEl, { render: renderFrontierChart })

let loadGeneration = 0

const routeCapability = computed(() => getRegionCapabilityForPath(ROUTE_PATH, currentRegion.value.id))
const isSupportedRegion = computed(() => routeCapability.value?.status === 'available')
const selectedPoint = computed(() => closestFrontierPoint(selectedLambda.value))
const frontierPoints = computed(() => [...(optimizeResult.value?.optimize_bid.frontier ?? [])].sort((a, b) => a.lambda - b.lambda))
// 「最近实际出清」是预测的对照基准，只有真实采集回放才有对照意义（#1459）：
// 该日无真实出清数据时不画线，而非画一条合成曲线再挂角标，合成线一旦入图，
// 视觉上仍会被读成「实际值」，与「宁可不显示也不用错数据顶替」的纪律相悖。
const actualIsCaptured = computed(() => actualCurve.value?.basis === 'captured')
const actualMissing = computed(() => Boolean(actualCurveDate.value) && actualCurve.value !== null && !actualIsCaptured.value)
const actualHourlySourced = computed(() => actualIsCaptured.value && actualCurve.value?.sourcePoints === 24)
const optimizeNote = computed(() => optimizeResult.value?.optimize_bid.note ?? '')
const riskNote = computed(() => riskResult.value?.risk_quantification.note ?? '')
// #764 校准标注：分位带来自 /predict（默认共形校准）；VaR/CVaR 来自 /risk-quantify（quantile_calibrated）
const bandCalibrated = computed(() => priceForecast.value?.metrics?.conformal === true)
const riskCalibrated = computed(() => riskResult.value?.quantile_calibrated === true)
const sourceSummary = computed(() => {
  const flags = [
    optimizeResult.value ? `optimize ${optimizeResult.value.source_type}${optimizeResult.value.mock ? ' mock' : ''}` : '',
    riskResult.value ? `risk ${riskResult.value.source_type}${riskResult.value.mock ? ' mock' : ''}` : ''
  ].filter(Boolean)
  return flags.join(' · ')
})

const riskMetrics = computed(() => {
  const r = riskResult.value?.risk_quantification
  if (!r) return []
  return [
    { label: '期望罚款', value: r.expected_penalty_yuan, unit: '元', tone: 'warn' },
    { label: `罚款 VaR ${Math.round(r.alpha * 100)}%`, value: r.var_penalty_yuan, unit: '元', tone: 'risk' },
    { label: `罚款 CVaR ${Math.round(r.alpha * 100)}%`, value: r.cvar_penalty_yuan, unit: '元', tone: 'risk' },
    { label: '净损失 VaR', value: r.var_net_loss_yuan, unit: '元', tone: 'risk' },
    { label: '净损失 CVaR', value: r.cvar_net_loss_yuan, unit: '元', tone: 'risk' },
    { label: '预测精度经济价值', value: r.forecast_value_yuan_per_10pct_tighter, unit: '元/10%收窄', tone: 'good' }
  ]
})

function fmtDate(d: Date): string {
  const local = new Date(d.getTime() + 8 * 3600 * 1000)
  return local.toISOString().slice(0, 10)
}

function previousDate(date: string): string {
  const ts = new Date(`${date}T00:00:00+08:00`).getTime()
  if (!Number.isFinite(ts)) return fmtDate(new Date(Date.now() - 86400000))
  return fmtDate(new Date(ts - 86400000))
}

function cleanSeries(values?: unknown[]): Array<number | null> {
  return (values ?? []).map((value) => {
    if (value === null || value === undefined || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  })
}

function avg(values?: number[]): number {
  // 无有效值返回 NaN（非 0）：调用方用 Number.isFinite 区分「真零价」与「无数据」，
  // 避免 `avg(...) || 400` 把合法 0 元/MWh 误判为缺失（#550）。
  const finite = (values ?? []).filter((value) => Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : NaN
}

function money(value: unknown, digits = 0): string {
  return fmtNum(value, digits)
}

function mw(value: unknown, digits = 1): string {
  return fmtNum(value, digits)
}

function lambdaText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function slotLabels(length: number): string[] {
  if (length <= 0) return []
  if (length === 96) {
    return Array.from({ length }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`)
  }
  if (length === 24) return Array.from({ length }, (_, index) => `${String(index).padStart(2, '0')}:00`)
  return Array.from({ length }, (_, index) => String(index))
}

function buildLambdaSet(): number[] {
  return [...new Set([...DEFAULT_LAMBDAS, Number(selectedLambda.value.toFixed(2))])]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
}

function snapshotContext() {
  return {
    regionId: currentRegion.value.id,
    targetDate: targetDate.value,
    priceModelType: priceModelType.value,
    loadModelType: loadModelType.value,
    trainDays: trainDays.value,
    capacityMw: capacityMw.value,
    alpha: alpha.value
  }
}

function isStale(gen: number, ctx: ReturnType<typeof snapshotContext>) {
  return gen !== loadGeneration
    || ctx.regionId !== currentRegion.value.id
    || ctx.targetDate !== targetDate.value
    || ctx.priceModelType !== priceModelType.value
    || ctx.loadModelType !== loadModelType.value
    || ctx.trainDays !== trainDays.value
    || ctx.capacityMw !== capacityMw.value
    || ctx.alpha !== alpha.value
}

function resetViewModel() {
  // loading 一并清零：不支持地区分支在 resetViewModel 后直接 return（不设 loading），
  // 而飞行中的旧请求 finally 因 isStale 跳过收敛，会让刷新按钮永久禁用（#538）。
  // 支持地区分支随后立即重设 loading=true，此处清零安全。
  loading.value = false
  optimizeLoading.value = false
  riskLoading.value = false
  adviceLoading.value = false
  overviewLoading.value = false
  priceForecast.value = null
  actualCurve.value = null
  actualCurveDate.value = ''
  optimizeResult.value = null
  riskResult.value = null
  advice.value = null
  decisionOverview.value = null
  errorMsg.value = ''
  void nextTick(() => {
    renderBandChart()
    renderBidChart()
    renderFrontierChart()
  })
}

async function loadCockpit() {
  const gen = ++loadGeneration
  const ctx = snapshotContext()
  resetViewModel()
  if (!isSupportedRegion.value) return
  if (!catalogBatchReady.value) return
  // catalog 已加载但选中模型不可选（不可用/非 /predict/被移除）→ 不发注定失败的请求（#570）。
  // 两腿分别校验：价格腿只看 price 声明，负荷腿只看 load 声明。
  const priceOk = priceCatalogModels.value.filter((m) => modelSelectableFor(m, 'price'))
  const loadOk = loadCatalogModels.value.filter((m) => modelSelectableFor(m, 'load'))
  if (!priceOk.length && !loadOk.length) {
    errorMsg.value = '当前地区没有可消费的模型目录产物'
    return
  }
  if (!priceOk.some((m) => m.modelId === ctx.priceModelType)) {
    errorMsg.value = '当前价格预测模型不可用，请另选模型'
    return
  }
  if (!loadOk.some((m) => m.modelId === ctx.loadModelType)) {
    errorMsg.value = '当前负荷预测模型不可用，请另选模型'
    return
  }
  loading.value = true
  try {
    // 目标日留空 → 省略 target_date，后端取最近可用交易日（forecast_service 未指定则选末日）。
    // 实际出清对比曲线仅在指定具体日时加载（首屏无固定日，避免 previousDate 取到无数据日）。
    const actualDate = ctx.targetDate ? previousDate(ctx.targetDate) : ''
    const [forecast, clearing] = await Promise.all([
      runForecastPredict({
        region_id: ctx.regionId,
        target: 'price',
        target_date: ctx.targetDate || undefined,
        model_type: ctx.priceModelType,
        train_days: ctx.trainDays,
        probabilistic: true
      }),
      actualDate ? loadClearingCurve(actualDate) : Promise.resolve(null)
    ])
    if (isStale(gen, ctx)) return
    priceForecast.value = forecast
    actualCurve.value = clearing
    actualCurveDate.value = actualDate
    await nextTick()
    renderBandChart()
    await recomputeOptimize(gen, ctx)
  } catch (error) {
    if (!isStale(gen, ctx)) {
      errorMsg.value = error instanceof Error ? error.message : '申报决策驾驶舱加载失败'
      resetChartsAfterFailure()
    }
  } finally {
    if (!isStale(gen, ctx)) loading.value = false
  }
}

function resetChartsAfterFailure() {
  optimizeResult.value = null
  riskResult.value = null
  void nextTick(() => {
    renderBandChart()
    renderBidChart()
    renderFrontierChart()
  })
}

async function recomputeFromControls() {
  if (!priceForecast.value?.points.length) {
    await loadCockpit()
    return
  }
  const gen = ++loadGeneration
  const ctx = snapshotContext()
  // 接管重算：递增 loadGeneration 使飞行中的旧 loadCockpit 请求 stale，其 finally 会跳过
  // loading 收敛，故此处显式清零，防刷新按钮长期禁用（#550，同 #538 loading 语义）。
  loading.value = false
  await recomputeOptimize(gen, ctx)
}

async function recomputeOptimize(gen: number, ctx: ReturnType<typeof snapshotContext>) {
  const priceP50 = priceForecast.value?.points ?? []
  optimizeResult.value = null
  riskResult.value = null
  riskLoading.value = false
  renderBidChart()
  renderFrontierChart()
  if (!priceP50.length) return
  optimizeLoading.value = true
  errorMsg.value = ''
  try {
    const result = await fetchOptimizeBid({
      region_id: ctx.regionId,
      target: 'load',
      target_date: ctx.targetDate || undefined,
      model_type: ctx.loadModelType,
      train_days: ctx.trainDays,
      probabilistic: true,
      capacity_mw: ctx.capacityMw,
      lambdas: buildLambdaSet(),
      n_scenarios: 40,
      alpha: ctx.alpha,
      price_forecast_p50: priceP50
    })
    if (isStale(gen, ctx)) return
    optimizeResult.value = result
    await nextTick()
    renderBidChart()
    renderFrontierChart()
    await recomputeRisk(gen, ctx)
  } catch (error) {
    if (!isStale(gen, ctx)) {
      errorMsg.value = error instanceof Error ? error.message : '报价优化失败'
      optimizeResult.value = null
      riskResult.value = null
      renderBidChart()
      renderFrontierChart()
    }
  } finally {
    if (!isStale(gen, ctx)) optimizeLoading.value = false
  }
}

async function recomputeRisk(gen: number, ctx: ReturnType<typeof snapshotContext>) {
  const point = closestFrontierPoint(selectedLambda.value)
  const quantityForecast = optimizeResult.value?.forecast
  if (!point || !quantityForecast) return
  riskLoading.value = true
  try {
    // 真零价（0 元/MWh）合法，只有无数据才回退 400，用 Number.isFinite 判缺失，勿用 truthy。
    const meanPrice = avg(priceForecast.value?.points)
    const clearingPrice = Number.isFinite(meanPrice) ? Math.round(meanPrice * 100) / 100 : 400
    const result = await fetchRiskQuantify({
      region_id: ctx.regionId,
      target: 'load',
      target_date: ctx.targetDate || undefined,
      model_type: ctx.loadModelType,
      train_days: ctx.trainDays,
      clearing_price: clearingPrice,
      n_scenarios: 1000,
      alpha: ctx.alpha,
      corr: 0.5,
      actual_points: quantityForecast.points,
      actual_lower: quantityForecast.lower,
      actual_upper: quantityForecast.upper,
      declared_mw: point.bid_curve_mw
    })
    if (isStale(gen, ctx)) return
    riskResult.value = result
  } catch (error) {
    if (!isStale(gen, ctx)) errorMsg.value = error instanceof Error ? error.message : '偏差风险量化失败'
  } finally {
    if (!isStale(gen, ctx)) riskLoading.value = false
  }
}

// 申报建议 / 决策概览（迁自工作台原「决策应用」tab，模型/目标日/训练窗口复用驾驶舱控件）
// 主体切换不重载整页（不进 isStale 上下文），结果写入用快照比对（含主体）丢弃跨上下文旧响应；
// loading 复位用各自独立世代（同 runSingle/backtest 模式，job538/550 语义）：无论响应是否 stale
// 都由最新一次请求收敛自己的 loading，杜绝切主体/改装机等旁路变更后按钮永久禁用。
let adviceGeneration = 0
async function runBidAdvice() {
  const myGen = ++adviceGeneration
  const gen = loadGeneration
  const ctx = snapshotContext()
  const subject = subjectType.value
  const fresh = () => gen === loadGeneration && !isStale(gen, ctx) && subject === subjectType.value
  adviceLoading.value = true
  errorMsg.value = ''
  try {
    const result = await fetchBidAdvice({
      region_id: ctx.regionId,
      target: 'price',
      target_date: ctx.targetDate || undefined,
      model_type: ctx.priceModelType,
      train_days: ctx.trainDays,
      subject_type: subject
    })
    if (!fresh()) return
    advice.value = result
  } catch (error) {
    if (fresh()) errorMsg.value = error instanceof Error ? error.message : '申报建议失败'
  } finally {
    if (myGen === adviceGeneration) adviceLoading.value = false
  }
}

let overviewGeneration = 0
async function runDecisionOverview() {
  const myGen = ++overviewGeneration
  const gen = loadGeneration
  const ctx = snapshotContext()
  const subject = subjectType.value
  const fresh = () => gen === loadGeneration && !isStale(gen, ctx) && subject === subjectType.value
  // /cockpit 是聚合端点，后端拿同一个 model_type 跑 PRICE+LOAD 两腿。两腿选了不同模型时
  // 传谁都是谎报（另一腿实际用的不是用户选的那个），故直接不发请求、页内明示原因——
  // 「不静默回落」：宁可这一块空着并说清为什么，也不给一个口径对不上的聚合结论。
  if (!bothLegsSameModel.value) {
    decisionOverview.value = null
    overviewLoading.value = false
    return
  }
  overviewLoading.value = true
  errorMsg.value = ''
  try {
    const result = await fetchCockpit({
      region_id: ctx.regionId,
      target_date: ctx.targetDate || undefined,
      model_type: ctx.priceModelType,
      train_days: ctx.trainDays,
      subject_type: subject
    })
    if (!fresh()) return
    decisionOverview.value = result
  } catch (error) {
    if (fresh()) errorMsg.value = error instanceof Error ? error.message : '决策概览失败'
  } finally {
    if (myGen === overviewGeneration) overviewLoading.value = false
  }
}

type OverviewCard = { label: string; value: string; provenance?: ForecastProvenance; hint?: string }

const overviewCards = computed(() => {
  const o = decisionOverview.value
  if (!o) return []
  const cards: OverviewCard[] = []
  const priceAvg = avg(o.price_forecast.points)
  cards.push({ label: '日均预测电价', value: Number.isFinite(priceAvg) ? `${priceAvg.toFixed(0)} 元/MWh` : '—', provenance: o.price_forecast })
  if (o.bid_advice.storage) {
    cards.push({ label: '储能预期套利', value: `${o.bid_advice.storage.expected_profit_yuan.toLocaleString()} 元` })
  } else if (o.bid_advice.retailer) {
    cards.push({ label: '售电预期成本', value: `${o.bid_advice.retailer.expected_cost_yuan.toLocaleString()} 元` })
  }
  cards.push({ label: '偏差最坏风险', value: `${o.deviation_risk.worst_penalty_yuan.toLocaleString()} 元`, provenance: o.deviation_risk })
  const mid = o.midterm_trend
  const midLabel = `未来 ${mid.horizon_days} 天均价`
  if (isUnavailableProvenance(mid)) {
    // 远端无南洋模型：给空态而不是 0/NaN 或报错，原因放悬浮提示。
    cards.push({ label: midLabel, value: '暂无南洋模型', hint: String(mid.reason ?? '').trim() || '中长期模型当前不可用' })
  } else {
    const midAvg = avg(mid.daily_avg_price)
    cards.push({ label: midLabel, value: Number.isFinite(midAvg) ? `${midAvg.toFixed(0)} 元/MWh` : '—', provenance: mid })
  }
  return cards
})
// 概览顶层的模拟标识与聚合提示；任一分区为模拟时后端顶层也会置 MOCK，这里取并集防旧/异常响应漏标。
const overviewIsMock = computed(() => {
  const o = decisionOverview.value
  return !!o && [o, o.price_forecast, o.deviation_risk, o.midterm_trend].some((p) => isMockProvenance(p))
})
const overviewProvenance = computed<ForecastProvenance | undefined>(() => {
  const o = decisionOverview.value
  if (!o) return undefined
  return { mock: overviewIsMock.value, sourceType: o.sourceType ?? o.source_type, warnings: provenanceWarnings(o) }
})

// 原「下发到实验室」按钮（把 96 点电价预测重采样为 24 点送交易策略实验室）
// 随该页删除一并移除（#1799），目标页不存在，pendingPriceCurve 已无读取方。

function closestFrontierPoint(lambda: number): OptimizeBidFrontierPoint | null {
  const frontier = optimizeResult.value?.optimize_bid.frontier ?? []
  if (!frontier.length) return null
  return frontier.reduce((best, point) =>
    Math.abs(point.lambda - lambda) < Math.abs(best.lambda - lambda) ? point : best
  , frontier[0])
}

function onLambdaChange(value: number | number[]) {
  selectedLambda.value = Array.isArray(value) ? Number(value[0] ?? 1) : Number(value)
  void recomputeFromControls()
}

function renderBandChart() {
  const forecast = priceForecast.value
  const lower = cleanSeries(forecast?.lower)
  const upper = cleanSeries(forecast?.upper)
  const p50 = cleanSeries(forecast?.points)
  const band = upper.map((value, index) => {
    const lo = lower[index]
    if (value === null || lo === null) return null
    return Math.max(0, value - lo)
  })
  // 只画真实采集回放的实际线；合成降级不入图（见 actualIsCaptured 注释）。
  const actual = cleanSeries(actualIsCaptured.value ? actualCurve.value?.points.map((point) => point.value) : undefined)
  const labels = slotLabels(Math.max(p50.length, actual.length, lower.length, upper.length))
  const hasData = p50.some((value) => value !== null) || actual.some((value) => value !== null)

  bandChart.setOption({
    ...emptyOverlay(!hasData, '暂无预测分位带'),
    legend: legend({ data: ['最近实际出清', 'P10-P90 分位带', 'P10 预测', 'P50 预测', 'P90 预测'], right: 116 }),
    tooltip: { ...axisTooltip({ unit: '元/MWh', digits: 1 }), ...tooltipStyle(), confine: true },
    toolbox: chartToolbox('申报决策分位带'),
    dataZoom: insideZoom(),
    grid: grid({ legend: true, right: 18 }),
    xAxis: catAxis(labels, { boundaryGap: false }),
    yAxis: valueAxis('元/MWh', { scale: true }),
    series: [
      lineSeries('P10 下沿', lower, POWER.forecast, {
        stack: 'band',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false }
      }),
      areaSeries('P10-P90 分位带', band, POWER.forecast, {
        stack: 'band',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color: withAlpha(POWER.forecast, 0.18) }
      }),
      lineSeries('最近实际出清', actual, POWER.price, {
        lineStyle: { width: 2.2, color: POWER.price, type: 'solid' }
      }),
      lineSeries('P10 预测', lower, POWER.forecast, {
        lineStyle: { width: 1.4, color: POWER.forecast, type: 'dashed' }
      }),
      lineSeries('P50 预测', p50, POWER.forecast, {
        lineStyle: { width: 2.4, color: POWER.forecast, type: 'dashed' }
      }),
      lineSeries('P90 预测', upper, POWER.forecast, {
        lineStyle: { width: 1.4, color: POWER.forecast, type: 'dashed' }
      })
    ]
  }, { notMerge: true })
}

function renderBidChart() {
  const frontier = frontierPoints.value
  const maxLen = frontier.reduce((max, point) => Math.max(max, point.bid_curve_mw.length), 0)
  const labels = slotLabels(maxLen)
  const hasData = frontier.length > 0

  bidChart.setOption({
    ...emptyOverlay(!hasData, '等待 mean-CVaR 报价优化结果'),
    legend: legend({ right: 116 }),
    tooltip: { ...axisTooltip({ unit: 'MW', digits: 1 }), ...tooltipStyle(), confine: true },
    toolbox: chartToolbox('申报曲线'),
    dataZoom: insideZoom(),
    grid: grid({ legend: true, right: 18 }),
    xAxis: catAxis(labels, { boundaryGap: false }),
    yAxis: valueAxis('MW', { min: 0 }),
    series: frontier.map((point) => {
      const isSelected = selectedPoint.value?.lambda === point.lambda
      const color = isSelected ? '#2563eb' : RISK_LEVEL_COLOR[point.risk_level]
      const label = DEFAULT_LAMBDAS.includes(point.lambda)
        ? `${RISK_LEVEL_LABEL[point.risk_level]} λ=${lambdaText(point.lambda)}`
        : `当前 λ=${lambdaText(point.lambda)}`
      return stepSeries(label, cleanSeries(point.bid_curve_mw), color, {
        step: 'end',
        lineStyle: { width: isSelected ? 3 : 2, color, type: isSelected ? 'solid' : 'dashed' },
        z: isSelected ? 5 : 2
      })
    })
  }, { notMerge: true })
}

function renderFrontierChart() {
  const frontier = frontierPoints.value
  const lineData = frontier.map((point) => [point.cvar_loss_yuan, point.expected_profit_yuan, point.lambda])
  const current = selectedPoint.value
  const hasData = frontier.length > 0

  frontierChart.setOption({
    ...emptyOverlay(!hasData, '等待利润-CVaR 前沿'),
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(),
      formatter: (param: { data?: unknown }) => {
        const data = Array.isArray(param.data) ? param.data : []
        const lambda = Number(data[2])
        return [
          `<b>λ=${lambdaText(lambda)}</b>`,
          `CVaR 损失 ${money(data[0])} 元`,
          `期望利润 ${money(data[1])} 元`
        ].join('<br/>')
      }
    },
    toolbox: chartToolbox('利润-CVaR前沿'),
    grid: { left: 58, right: 22, top: 28, bottom: 40, containLabel: true },
    xAxis: valueAxis('CVaR 损失（元）', { scale: true }),
    yAxis: valueAxis('期望利润（元）', { scale: true }),
    series: [
      lineSeries('前沿连线', lineData, POWER.forecast, {
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { width: 1.8, color: POWER.forecast, type: 'dashed' },
        itemStyle: { color: POWER.forecast }
      }),
      {
        name: '风险档位',
        type: 'scatter',
        data: lineData,
        symbolSize: 13,
        itemStyle: {
          color: (param: { dataIndex: number }) => {
            const point = frontier[param.dataIndex]
            return RISK_LEVEL_COLOR[point.risk_level] ?? POWER.price
          }
        }
      },
      ...(current ? [{
        name: '当前 λ',
        type: 'scatter',
        data: [[current.cvar_loss_yuan, current.expected_profit_yuan, current.lambda]],
        symbolSize: 22,
        itemStyle: { color: '#2563eb', borderColor: '#fff', borderWidth: 2 },
        z: 5
      }] : [])
    ]
  }, { notMerge: true })
}

watch([targetDate, priceModelType, loadModelType], () => {
  void loadCockpit()
})

const catalogBatchReady = ref(false)
let catalogGeneration = 0

// 首载与切区共享代次；地区相同也可能是 A→B→A 的旧请求，不能只比较地区 ID。
async function loadRegionCatalog(force = false) {
  const generation = ++catalogGeneration
  const regionId = currentRegion.value.id
  catalogBatchReady.value = false
  // 常规取数失败由目录服务写入对应地区/目标的错误状态，完成后仍须经过本页代次守卫。
  await ensureForecastCatalog(['price', 'load'], force, regionId)
  if (generation !== catalogGeneration || regionId !== currentRegion.value.id) return
  catalogBatchReady.value = true
  const normalized = normalizeSelectedModels({ allowEmptyClear: true })
  if (!normalized) void loadCockpit()  // 归一时由 watch 触发，不额外重跑。
}

onRegionChange(() => loadRegionCatalog(true))

// #762：模型下拉从后端 /forecast/models catalog 动态渲染；
// 当前页只展示“当前腿可执行的真实模型”。目录刷新未完成前不提前清空用户指定模型，
// 目录就绪后若该模型被移除/判为占位或原始零样本，则清空选择并提示用户重选，而不是回退默认项。
const priceCatalog = forecastCatalogState('price')
const loadCatalog = forecastCatalogState('load')
const priceCatalogModels = computed(() => priceCatalog.models.value.filter((model) =>
  predictionModelExclusionReason(model) === null && modelSelectableFor(model, 'price')))
const loadCatalogModels = computed(() => loadCatalog.models.value.filter((model) =>
  predictionModelExclusionReason(model) === null && modelSelectableFor(model, 'load')))
const catalogError = computed(() => [priceCatalog.error.value, loadCatalog.error.value].filter(Boolean).join('；'))
// 驾驶舱模型下拉可选性：available（后端能力位）且 /predict 直算支持（排除 naive/fm 等选中必失败项）。
// **按腿判 supportedTargets**（#2324）：价格腿只要求声明 price、负荷腿只要求声明 load。
// 旧版要求同一模型两腿全覆盖，把 remote:*/store: 这类单 target 上架的真实模型整体挡在外面
// （#1461/#1898）——那条限制来自 /cockpit 聚合端点的单 model_type，不该扩散到四个
// 带显式 target 的调用点上。未声明 supportedTargets 的（core 模型）视为两腿都支持。
const modelSelectableFor = isModelSelectableForTarget
const selectedPriceModel = computed(() => priceCatalogModels.value.find((model) => model.modelId === priceModelType.value) ?? null)
const selectedLoadModel = computed(() => loadCatalogModels.value.find((model) => model.modelId === loadModelType.value) ?? null)
const priceModelDisplay = computed(() => selectedPriceModel.value?.name ?? selectedPriceModel.value?.modelId ?? '')
const loadModelDisplay = computed(() => selectedLoadModel.value?.name ?? selectedLoadModel.value?.modelId ?? '')
/** 下拉项 title：说清这一项为什么不能选（能选时给 unavailableReason 备注）。 */
function modelOptionTitle(m: ForecastModel, target: 'price' | 'load'): string {
  if (!m.available) return m.unavailableReason || '当前不可用'
  if (!isPredictSupported(m)) return '非 /predict 直算端点（回测/专用端点）'
  const st = m.supportedTargets
  if (st && !st.includes(target)) {
    return `该模型按单一目标上架（声明：${st.join('/')}），不能用于${target === 'price' ? '价格' : '负荷'}腿`
  }
  return m.unavailableReason || ''
}
function modelOptionLabel(m: ForecastModel): string {
  const tags = [
    m.provenance.mock ? '占位' : '',
    !m.available ? `不可用${m.unavailableReason ? '·' + m.unavailableReason : ''}` : (!isPredictSupported(m) ? '非直算端点' : ''),
  ].filter(Boolean)
  return (m.name ?? m.modelId) + (tags.length ? `（${tags.join('·')}）` : '')
}
function normalizeSelectedModels(options?: { allowEmptyClear?: boolean }): boolean {
  if (!catalogBatchReady.value) return false
  const allowEmptyClear = options?.allowEmptyClear === true
  let changed = false
  if (priceCatalogModels.value.length) {
    if (priceModelType.value !== '' && !selectedPriceModel.value) {
      priceModelType.value = ''
      changed = true
    }
  } else if (allowEmptyClear && priceModelType.value !== '') {
    priceModelType.value = ''
    changed = true
  }
  if (loadCatalogModels.value.length) {
    if (loadModelType.value !== '' && !selectedLoadModel.value) {
      loadModelType.value = ''
      changed = true
    }
  } else if (allowEmptyClear && loadModelType.value !== '') {
    loadModelType.value = ''
    changed = true
  }
  return changed
}

// 预测中心同页上下文（#79，3620694192/3620694219）
// dirty：用户在本 tab 手动改过模型/目标日/训练窗后不再被建模上下文覆盖（深链 query 仍优先）。
let controlsDirty = false
function markControlsDirty() { controlsDirty = true }
let appliedBenchSeq = benchInit?.seq ?? 0

function applyDeepLinkQuery(): boolean {
  const model = queryStr('model')
  const date = queryStr('date')
  const trainDaysNum = Number(queryStr('train_days'))
  let changed = false
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  // `?model=` 同时设两腿（旧深链语义不变）；`?priceModel=`/`?loadModel=` 可单独覆盖某一腿。
  const priceModel = queryStr('priceModel') || model
  const loadModel = queryStr('loadModel') || model
  const watchWillReload = (priceModel !== '' && priceModel !== priceModelType.value)
    || (loadModel !== '' && loadModel !== loadModelType.value)
    || (dateValid && date !== targetDate.value)
  if (dateValid && date !== targetDate.value) { targetDate.value = date; changed = true }
  if (priceModel !== '' && priceModel !== priceModelType.value) { priceModelType.value = priceModel; changed = true }
  if (loadModel !== '' && loadModel !== loadModelType.value) { loadModelType.value = loadModel; changed = true }
  if (normalizeSelectedModels()) changed = true
  if (Number.isFinite(trainDaysNum) && trainDaysNum >= 30 && trainDaysNum <= 365
    && Math.round(trainDaysNum) !== trainDays.value) {
    trainDays.value = Math.round(trainDaysNum)
    changed = true
    if (!watchWillReload) void loadCockpit()
  }
  return changed
}

function applyBenchContext(): void {
  const ctx = latestBenchContext.value
  if (!ctx || ctx.seq === appliedBenchSeq || controlsDirty) return
  appliedBenchSeq = ctx.seq
  // 建模台一次只产出一个模型上下文，无法区分腿：两腿同设（与合并前语义一致）。
  const modelChanged = ctx.modelId !== undefined
    && (ctx.modelId !== priceModelType.value || ctx.modelId !== loadModelType.value)
  const watchWillReload = modelChanged || (ctx.targetDate !== targetDate.value)
  let trainDaysChanged = false
  if (ctx.targetDate !== targetDate.value) targetDate.value = ctx.targetDate
  if (ctx.modelId !== undefined) {
    if (ctx.modelId !== priceModelType.value) priceModelType.value = ctx.modelId
    if (ctx.modelId !== loadModelType.value) loadModelType.value = ctx.modelId
  }
  normalizeSelectedModels()
  if (ctx.trainDays >= 30 && ctx.trainDays <= 365 && ctx.trainDays !== trainDays.value) {
    trainDays.value = ctx.trainDays
    trainDaysChanged = true
  }
  if (trainDaysChanged && !watchWillReload) void loadCockpit()
}

// 本页挂在预测中心 tab 内且中心页被 KeepAlive 缓存：setup 只跑一次。onActivated 只覆盖
// 「从其他页面回到预测中心」（含旧路由深链 redirect）；同一中心实例内「建模再跑→切回
// 决策 tab」不触发路由级激活，故建模上下文用 watch 即时跟随（3621741656）。
// dirty 用户手改后不覆盖、seq 防重复应用的语义两条路径共用。
onActivated(() => {
  applyDeepLinkQuery()
})
watch(latestBenchContext, () => { applyBenchContext() })
watch([priceCatalogModels, loadCatalogModels], () => {
  normalizeSelectedModels({ allowEmptyClear: catalogBatchReady.value })
}, { immediate: true })

onMounted(() => loadRegionCatalog())
onBeforeUnmount(() => {
  ++catalogGeneration
  catalogBatchReady.value = false
})
</script>

<template>
  <div class="decision-cockpit page-stack">
    <RegionDataBanner />

    <section class="panel cockpit-alert">
      <div class="alert-main">
        <ShieldAlert :size="18" />
        <div>
          <h1>申报决策驾驶舱</h1>
          <p>决策支持，非结算依据。逐时段考核系数仍以正式结算规则文本为准，金额类指标为估算口径。</p>
        </div>
      </div>
      <div class="alert-badges">
        <TrustBadge basis="illustrative" prefix="决策口径" />
        <DataBasisBadge v-if="priceForecast" :basis="priceForecast.basis" prefix="预测数据" />
        <!-- 两腿模型不同时如实标注：结论由两个模型拼出来，不标注就等于让人以为是同一模型的一致口径 -->
        <span v-if="!bothLegsSameModel && priceModelDisplay && loadModelDisplay" class="source-chip split-models">
          两腿分选：价格 {{ priceModelDisplay }} · 负荷 {{ loadModelDisplay }}
        </span>
        <span v-if="sourceSummary" class="source-chip">{{ sourceSummary }}</span>
      </div>
    </section>

    <CapabilitySupportBadge :path="ROUTE_PATH" />

    <template v-if="isSupportedRegion">
      <section class="panel controls">
        <label class="field">
          <span>目标日</span>
          <input v-model="targetDate" type="date" title="留空=最近可用交易日；选未来日因无基本面数据会失败" @change="markControlsDirty" />
        </label>
        <label class="field">
          <span>价格模型</span>
          <!-- 模型清单从后端 /forecast/models（registry.catalog 单一权威）动态拉取（#762）：
               新模型上线自动出现，available:false 禁用+reason；不再硬编码防漂移。
               两腿各一个下拉（#2324）：单 target 上架的 remote:* 真实模型只会在它声明的那条腿里可选。 -->
          <select v-model="priceModelType" @change="markControlsDirty">
            <option disabled value="">请选择模型</option>
            <option v-for="m in priceCatalogModels" :key="m.modelId" :value="m.modelId"
              :title="modelOptionTitle(m, 'price')">
              {{ modelOptionLabel(m) }}
            </option>
          </select>
          <span v-if="catalogError" class="model-catalog-error" :title="catalogError">⚠ 模型目录加载失败</span>
        </label>
        <label class="field">
          <span>负荷模型</span>
          <select v-model="loadModelType" @change="markControlsDirty">
            <option disabled value="">请选择模型</option>
            <option v-for="m in loadCatalogModels" :key="m.modelId" :value="m.modelId"
              :title="modelOptionTitle(m, 'load')">
              {{ modelOptionLabel(m) }}
            </option>
          </select>
        </label>
        <label class="field compact">
          <span>训练窗口</span>
          <el-input-number v-model="trainDays" :min="30" :max="365" :step="30" controls-position="right" @change="() => { markControlsDirty(); void loadCockpit() }" />
        </label>
        <label class="field compact">
          <span>装机上限</span>
          <el-input-number v-model="capacityMw" :min="1" :max="2000" :step="10" controls-position="right" @change="recomputeFromControls" />
        </label>
        <button class="refresh-btn" :disabled="loading || optimizeLoading || riskLoading" @click="loadCockpit">
          <Loader2 v-if="loading || optimizeLoading || riskLoading" :size="14" class="spin" />
          <RefreshCcw v-else :size="14" />
          刷新
        </button>
      </section>

      <p v-if="errorMsg" class="error-strip">{{ errorMsg }}</p>

      <div class="cockpit-grid">
        <section class="panel chart-panel main-panel">
          <div class="panel-head">
            <h2><LineChart :size="16" /> 次日电价预测分位带</h2>
            <span class="muted">目标日 {{ targetDate || '最近可用交易日' }} · 历史实际 {{ actualCurveDate || '—' }}</span>
            <span v-if="actualMissing" class="demo-tag">该日无真实出清数据 · 不显示实际线</span>
            <span v-else-if="actualHourlySourced" class="demo-tag" title="该地区逐日采集切片只有 24 点（96 点曲线的逐小时均值），已按阶梯展开，不代表 15 分钟分辨率">实际线为小时级来源</span>
            <span v-if="bandCalibrated" class="calib-tag">共形校准</span>
          </div>
          <div ref="bandChartEl" class="chart-host band-chart" />
        </section>

        <div class="side-col">
          <section class="panel side-card">
            <div class="panel-head">
              <h2><SlidersHorizontal :size="15" /> λ 风险偏好</h2>
              <span class="lambda-value">{{ lambdaText(selectedLambda) }}</span>
            </div>
            <el-slider
              v-model="selectedLambda"
              :min="0"
              :max="3"
              :step="0.25"
              :marks="{ 0: '激进', 1: '中性', 3: '保守' }"
              :disabled="loading || optimizeLoading"
              @change="onLambdaChange"
            />
            <div v-if="selectedPoint" class="frontier-summary">
              <div><span>申报电量</span><b>{{ mw(selectedPoint.total_declared_mwh) }} MWh</b></div>
              <div><span>期望利润</span><b>{{ money(selectedPoint.expected_profit_yuan) }} 元</b></div>
              <div><span>CVaR 损失</span><b>{{ money(selectedPoint.cvar_loss_yuan) }} 元</b></div>
            </div>
          </section>

          <section class="panel side-card">
            <div class="panel-head"><h2><Gauge :size="15" /> 运行口径</h2></div>
            <div class="kv">
              <span>优化场景</span><b>{{ optimizeResult?.optimize_bid.n_scenarios ?? 40 }}</b>
              <span>风险场景</span><b>{{ riskResult?.risk_quantification.n_scenarios ?? 1000 }}</b>
              <span>置信水平</span><b>{{ Math.round(alpha * 100) }}%</b>
              <span>生产写入</span><b>{{ riskResult?.productionWrite === false || optimizeResult?.productionWrite === false ? '关闭' : '—' }}</b>
            </div>
          </section>
        </div>
      </div>

      <div class="lower-grid">
        <section class="panel chart-panel">
          <div class="panel-head">
            <h2><Sparkles :size="16" /> 保守 / 中性 / 激进申报曲线</h2>
            <span v-if="optimizeLoading" class="muted"><Loader2 :size="13" class="spin" /> 优化中</span>
          </div>
          <div ref="bidChartEl" class="chart-host sub-chart" />
        </section>

        <section class="panel chart-panel">
          <div class="panel-head">
            <h2><TrendingUp :size="16" /> 利润-CVaR 前沿</h2>
          </div>
          <div ref="frontierChartEl" class="chart-host sub-chart" />
        </section>
      </div>

      <section class="panel risk-panel">
        <div class="panel-head">
          <h2><Activity :size="16" /> 偏差风险聚合</h2>
          <span v-if="riskLoading" class="muted"><Loader2 :size="13" class="spin" /> 量化中</span>
          <span class="estimate-chip">金额为估算口径</span>
          <!-- #764 VaR/CVaR 消费校准后分位时显示标注（quantile_calibrated=true） -->
          <span v-if="riskCalibrated" class="estimate-chip">基于共形校准分位</span>
        </div>
        <div class="risk-grid">
          <div v-for="metric in riskMetrics" :key="metric.label" class="risk-card" :class="metric.tone">
            <span>{{ metric.label }}</span>
            <b>{{ money(metric.value) }}</b>
            <small>{{ metric.unit }}</small>
          </div>
        </div>
        <div v-if="riskResult" class="risk-foot">
          <span>期望收入 {{ money(riskResult.risk_quantification.expected_revenue_yuan) }} 元</span>
          <span>期望净值 {{ money(riskResult.risk_quantification.expected_net_yuan) }} 元</span>
          <span>高风险时段 {{ riskResult.risk_quantification.high_risk_slots }} 个</span>
          <span>容差 ±{{ fmtNum(riskResult.risk_quantification.tolerance_pct, 2) }}%</span>
        </div>
        <p v-if="riskNote || optimizeNote" class="note">
          {{ riskNote || optimizeNote }}
        </p>
      </section>

      <!-- 申报建议与决策概览（迁自工作台原「决策应用」tab；模型/训练窗口复用本页控件） -->
      <section class="panel risk-panel">
        <div class="panel-head">
          <h2><ClipboardList :size="16" /> 申报建议与决策概览</h2>
          <span class="estimate-chip">金额为估算口径</span>
        </div>
        <div class="advice-controls">
          <label class="field compact">
            <span>决策主体</span>
            <select v-model="subjectType">
              <option value="retailer">售电公司</option>
              <option value="storage">储能</option>
            </select>
          </label>
          <button class="refresh-btn" :disabled="adviceLoading || loading" @click="runBidAdvice">
            <Loader2 v-if="adviceLoading" :size="14" class="spin" />
            <template v-else>申报建议</template>
          </button>
          <button class="refresh-btn" :disabled="overviewLoading || loading" @click="runDecisionOverview">
            <Loader2 v-if="overviewLoading" :size="14" class="spin" />
            <template v-else>决策概览</template>
          </button>
          <span class="muted">基于后端 ML 概率预测的可执行建议；决策计算全部在 agent-backend。</span>
        </div>

        <template v-if="advice">
          <div class="advice-head">
            <b>申报决策建议（{{ advice.advice.subject_type === 'storage' ? '储能' : '售电公司' }}）</b>
            <DataBasisBadge :basis="advice.advice.basis" prefix="数据口径" />
          </div>
          <div class="risk-grid advice-grid">
            <div class="risk-card"><span>低谷阈值</span><b>{{ money(advice.advice.valley_threshold) }}</b><small>元/MWh</small></div>
            <div class="risk-card"><span>尖峰阈值</span><b>{{ money(advice.advice.peak_threshold) }}</b><small>元/MWh</small></div>
            <template v-if="advice.advice.storage">
              <div class="risk-card"><span>充电段数</span><b>{{ advice.advice.storage.charge_slots }}</b><small>段</small></div>
              <div class="risk-card"><span>放电段数</span><b>{{ advice.advice.storage.discharge_slots }}</b><small>段</small></div>
              <div class="risk-card" :class="advice.advice.storage.expected_profit_yuan > 0 ? 'good' : 'risk'">
                <span>预期套利</span><b>{{ advice.advice.storage.expected_profit_yuan.toLocaleString() }}</b><small>元</small>
              </div>
            </template>
            <template v-else-if="advice.advice.retailer">
              <div class="risk-card warn"><span>预期采购成本</span><b>{{ advice.advice.retailer.expected_cost_yuan.toLocaleString() }}</b><small>元</small></div>
              <div class="risk-card"><span>成本区间 [P10, P90]</span><b>{{ advice.advice.retailer.cost_range_yuan[0].toLocaleString() }} ~ {{ advice.advice.retailer.cost_range_yuan[1].toLocaleString() }}</b><small>元</small></div>
            </template>
          </div>
        </template>

        <div v-if="!bothLegsSameModel" class="overview-blocked">
          <b>决策概览已暂停</b>
          <p>
            决策概览是后端一次聚合出来的（价格预测 + 申报建议 + 偏差风险 + 中长期趋势），
            它只接受一个模型、用这一个模型跑价格与负荷两腿。当前价格腿用
            「{{ priceModelDisplay || '未选模型' }}」、负荷腿用「{{ loadModelDisplay || '未选模型' }}」，
            传任一个都会让另一腿实际用的模型与你选的不符，故本区块不出结果。
          </p>
          <p class="muted">
            上方的价格预测、报价优化、偏差风险、申报建议四块不受影响——它们各自带目标，
            已分别按你选的两个模型计算。要看决策概览，把两腿设成同一个模型即可。
          </p>
        </div>

        <template v-if="decisionOverview">
          <div class="advice-head">
            <b>决策概览（{{ decisionOverview.basis === 'captured' && !overviewIsMock ? '真实' : '合成验证' }}）</b>
            <DataBasisBadge :basis="decisionOverview.basis" prefix="数据口径" />
            <ForecastProvenanceTags :provenance="overviewProvenance" />
          </div>
          <div class="risk-grid advice-grid">
            <div v-for="card in overviewCards" :key="card.label" class="risk-card" :title="card.hint">
              <span>{{ card.label }}</span>
              <b :class="{ 'card-empty': card.hint }">{{ card.value }}</b>
              <ForecastProvenanceTags v-if="card.provenance" :provenance="card.provenance" hide-warnings />
            </div>
          </div>
        </template>
      </section>
    </template>

    <CockpitRegionLockedCard v-else />
  </div>
</template>

<style scoped>
.decision-cockpit { gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); }
.split-models { white-space: nowrap; }
.overview-blocked {
  border: 1px dashed var(--line, #d0d5dd); border-radius: 10px;
  padding: 12px 14px; margin-top: 10px; background: color-mix(in srgb, var(--muted) 5%, transparent);
}
.overview-blocked b { display: block; margin-bottom: 6px; }
.overview-blocked p { margin: 0 0 6px; font-size: var(--font-12-5); line-height: 1.6; }

.cockpit-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-color: color-mix(in srgb, var(--warning) 36%, var(--line));
  background: color-mix(in srgb, var(--warning) 7%, var(--panel));
}
.alert-main {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--warning);
}
.alert-main h1 {
  margin: 0 0 2px;
  color: var(--text);
  font-size: var(--font-18);
  line-height: 1.25;
}
.alert-main p {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-12-5);
}
.alert-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.source-chip,
.estimate-chip,
.demo-tag,
.calib-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--font-xs);
  white-space: nowrap;
}
.source-chip {
  border: 1px solid var(--line);
  color: var(--muted);
  background: var(--panel);
}
.demo-tag,
.estimate-chip {
  color: #a16207;
  background: #fff7ed;
  border: 1px solid rgba(245, 158, 11, 0.28);
}
/* #764 共形校准标注：蓝绿色区分于橙色的估算/降级提示 */
.calib-tag {
  color: #1f8a70;
  background: #e6f7f2;
  border: 1px solid rgba(31, 138, 112, 0.28);
}

.controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
}
.field {
  display: grid;
  gap: 5px;
  min-width: 160px;
  font-size: var(--font-sm);
  color: var(--muted);
}
.field.compact { min-width: 140px; }
.field input,
.field select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
}
.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
}
.refresh-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.error-strip {
  margin: 0;
  padding: 9px 12px;
  border: 1px solid rgba(220, 38, 38, 0.28);
  border-radius: 8px;
  color: #b91c1c;
  background: #fef2f2;
  font-size: var(--font-md);
}

.cockpit-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}
.lower-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
.chart-panel,
.side-card,
.risk-panel {
  padding: 14px 16px;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
}
.panel-head h2 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--font-lg);
  line-height: 1.4;
}
.panel-head .muted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.main-panel .panel-head {
  flex-wrap: wrap;
}
.band-chart {
  width: 100%;
  height: 380px;
}
.sub-chart {
  width: 100%;
  height: 300px;
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lambda-value {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 10px;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  font-size: var(--font-sm);
  font-weight: 700;
}
.frontier-summary {
  display: grid;
  gap: 8px;
  margin-top: 20px;
}
.frontier-summary div,
.kv {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: var(--font-12-5);
}
.frontier-summary span,
.kv span {
  color: var(--muted);
}
.frontier-summary b,
.kv b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.kv {
  row-gap: 9px;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.risk-card {
  min-height: 96px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}
.risk-card span {
  display: block;
  color: var(--muted);
  font-size: var(--font-sm);
}
.risk-card b {
  display: block;
  margin-top: 10px;
  color: var(--text);
  font-size: var(--font-19);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.risk-card small {
  display: block;
  margin-top: 5px;
  color: var(--muted);
}
.risk-card .fp-tags { display: flex; margin-top: 8px; }
.risk-card b.card-empty {
  color: var(--muted);
  font-size: var(--font-md);
  font-weight: 500;
}
.risk-card.risk {
  border-color: rgba(220, 38, 38, 0.25);
  background: rgba(220, 38, 38, 0.04);
}
.risk-card.warn {
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.06);
}
.risk-card.good {
  border-color: rgba(22, 163, 74, 0.25);
  background: rgba(22, 163, 74, 0.05);
}
.risk-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 10px;
  color: var(--muted);
  font-size: var(--font-12-5);
}
.note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-left: 3px solid var(--warning);
  color: var(--muted);
  background: color-mix(in srgb, var(--warning) 7%, transparent);
  font-size: var(--font-12-5);
  line-height: 1.6;
}
.main-panel .panel-head .muted { margin-left: 0; }

.advice-controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.advice-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 8px;
  font-size: var(--font-md);
}
.advice-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.spin {
  animation: cockpit-spin 0.9s linear infinite;
}
@keyframes cockpit-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1180px) {
  .cockpit-grid,
  .lower-grid {
    grid-template-columns: 1fr;
  }
  .risk-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .cockpit-alert {
    align-items: flex-start;
    flex-direction: column;
  }
  .alert-badges {
    justify-content: flex-start;
  }
  .risk-grid {
    grid-template-columns: 1fr;
  }
  .band-chart,
  .sub-chart {
    height: 300px;
  }
}
</style>
