<script setup lang="ts">
// 预测数据工作台（Phase 2-3 / PR-B+PR-C；#79 预测中心收编后为「建模工作台」一级 tab）。
// 融合主线：选目标→选算法→配该算法参数→出统一结果。
// 模式 A 单算法预测、模式 B 多算法同台对比、扩展预测、模式 D 多目标总览、附 tab 模型台账。
// 原模式 C「决策应用」与「下发实验室」能力位于预测中心「申报决策」一级 tab（同页切换）。
// 全部经 forecastProviders 统一契约；数据口径 basis 全程标注，不伪装 Mock。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import DataBasisBadge from '../../components/DataBasisBadge.vue'
import DynamicParamPanel from '../../components/forecast/DynamicParamPanel.vue'
import UnifiedForecastChart from '../../components/forecast/UnifiedForecastChart.vue'
import ForecastExtraPanel from '../../components/forecast/ForecastExtraPanel.vue'
import ForecastTargetCount from '../../components/forecast/ForecastTargetCount.vue'
import DailyDisclosureOverview from '../../components/forecast/DailyDisclosureOverview.vue'
import { selectedRegionId, setCurrentRegionId } from '@/services/region/regionContext'
import { getRegionById } from '../../data/regions'
import {
  providersForTarget, platformTargetsForRegion, getProvider, defaultParams,
  FORECAST_TARGET_OPTIONS, nativeSlotsForTarget, granularityForTarget,
  ensureForecastCatalog, forecastCatalogState,
  type UnifiedForecastResult, type ProviderKind, type ForecastProvider,
} from '@/services/forecast/forecastProviders'
import { fetchBacktest, type BacktestResult } from '@/services/forecast/mlForecastClient'
import { publishBenchContext } from '@/services/forecast/forecastBenchContext'
import { fetchOfficialBaseline, officialMae, hasOfficialBaseline } from '@/services/forecast/officialBaseline'
import { aggregate96to24 } from '@/services/forecast/forecastProviders'
import { summarizeForecastFailures, type ForecastFailure } from '@/services/forecast/failureSummary'
import { isForecastDate } from '@/services/forecast/onlineForecastResult'
import { predictionModelExclusionReason } from '@/services/forecast/predictionModelEligibility'

const REGION_IDS = ['shanxi', 'shandong', 'gansu', 'guangdong', 'sichuan', 'yunnan']
const regionOptions = REGION_IDS.map((id) => ({ id, name: getRegionById(id).name }))
// 标的发现仍从注册表全集出发，但工作台下拉只显示「当前地区有可见已接入模型」的目标。
const DISCOVERABLE_TARGETS = FORECAST_TARGET_OPTIONS.map((item) => item.id)
const route = useRoute()
function targetFromQuery(value: unknown): string {
  return typeof value === 'string' && DISCOVERABLE_TARGETS.includes(value) ? value : ''
}

// 共享任务栏
const regionId = ref(selectedRegionId.value || 'shanxi')
const target = ref(targetFromQuery(route.query.target))
const targetDate = ref(typeof route.query.date === 'string' ? route.query.date : '')
const granularity = ref<24 | 96>(96)
// 标的原生点数：60 分钟标的（用户侧结算电价）原生 24 点，粒度控件隐藏、请求粒度恒 24（dljy#2463）
const nativeSlots = computed(() => nativeSlotsForTarget(target.value))
const historyDays = ref(180)
const activeTab = ref('single')
const error = ref('')
const targetDiscoveryRequested = ref(false)
const targetDiscoverySettled = ref(false)
let targetDiscoveryGeneration = 0

function discoverTargetOptions(force: boolean, nextRegionId = regionId.value) {
  const generation = ++targetDiscoveryGeneration
  targetDiscoveryRequested.value = true
  targetDiscoverySettled.value = false
  void ensureForecastCatalog(DISCOVERABLE_TARGETS, force, nextRegionId).finally(() => {
    if (generation !== targetDiscoveryGeneration) return
    targetDiscoverySettled.value = true
  })
}

const targetCatalog = forecastCatalogState(computed(() => DISCOVERABLE_TARGETS), computed(() => regionId.value))
const currentTargetCatalog = forecastCatalogState(computed(() => target.value || 'price'), computed(() => regionId.value))
const targetCatalogError = computed(() => targetCatalog.error.value)
const targetOptionsLoading = computed(() => targetCatalog.loading.value)
function hasVisibleProviderForTarget(targetId: string, activeRegionId: string): boolean {
  return providersForTarget(targetId, activeRegionId).some((provider) =>
    predictionModelExclusionReason(provider) === null)
}
const targetOptions = computed(() => FORECAST_TARGET_OPTIONS.filter((item) =>
  hasVisibleProviderForTarget(item.id, regionId.value)))
const targetProviders = computed(() => target.value ? providersForTarget(target.value, regionId.value) : [])
const visibleTargetProviders = computed(() => targetProviders.value.filter((provider) =>
  predictionModelExclusionReason(provider) === null))
const hasVisibleTargetProviders = computed(() => visibleTargetProviders.value.length > 0)
const catalogError = computed(() => target.value ? currentTargetCatalog.error.value : '')
const targetCatalogNotice = computed(() => {
  if (!targetDiscoveryRequested.value) return ''
  if (targetOptionsLoading.value) return '预测目标目录加载中，请稍候…'
  if (targetCatalogError.value && !targetOptions.value.length) return `预测目标目录加载失败：${targetCatalogError.value}`
  if (targetCatalogError.value) return `部分预测目标目录加载失败：${targetCatalogError.value}`
  if (!targetOptions.value.length) return '当前地区暂无已接入预测目标'
  return ''
})
const singleModelEmptyText = computed(() => !targetDiscoveryRequested.value || !targetDiscoverySettled.value || targetOptionsLoading.value
  ? '预测目标目录加载中，请稍候'
  : !targetOptions.value.length
    ? (targetCatalogError.value ? '预测目标目录加载失败，请先处理目录错误' : '当前地区暂无已接入预测目标')
    : catalogError.value
  ? '模型目录加载失败，请先处理目录错误'
  : '当前预测中心没有可展示的模型（占位、未部署、原始零样本权重已隐藏）')
const compareModelEmptyText = computed(() => !targetDiscoveryRequested.value || !targetDiscoverySettled.value || targetOptionsLoading.value
  ? '预测目标目录加载中，请稍候'
  : !targetOptions.value.length
    ? (targetCatalogError.value ? '预测目标目录加载失败，请先处理目录错误' : '当前地区暂无已接入预测目标')
    : catalogError.value
  ? '模型目录加载失败，请先处理目录错误'
  : '当前预测中心没有可用于对比的模型（占位、未部署、原始零样本权重已隐藏）')

// 算法选项标签：附占位/不可用+原因（#762 available:false 禁用，原因随 label 与 title 可见）。
function providerOptionLabel(p: ForecastProvider): string {
  const kind = p.kind === 'replay' ? '回放' : '实时计算'
  const tags = [
    p.mock ? '占位' : '',
    p.available === false ? `不可用${p.reason ? '·' + p.reason : ''}` : '',
  ].filter(Boolean)
  return `${p.name}（${kind}${tags.length ? '·' + tags.join('·') : ''}）`
}
function buildCtx() {
  return {
    regionId: regionId.value, target: target.value, targetDate: targetDate.value || undefined,
    granularity: granularityForTarget(target.value, granularity.value), historyDays: historyDays.value,
  }
}

// 模式 A：单算法预测
const algoId = ref(visibleTargetProviders.value[0]?.id ?? '')
const params = ref<Record<string, unknown>>({})
const result = ref<UnifiedForecastResult | null>(null)
// 官方日前预测的来源标签与对照误差（#2371 后续）。只有云南新能源有——口径经 targetDate
// 显式声明，不靠推断；负荷的 targetDate 恒为 null、两段数据反推结论矛盾，故不接。
const officialLabel = ref('')
// 真实值替代预测（#2389）：有真值的时段裁掉预测线，形成 AEMO 式「实线接虚线」。
// 默认关——把两条线都画出来才看得出模型贴不贴，那正是建模工作台的用途。
const mergeActual = ref(false)
const officialCompare = computed(() => {
  const r = result.value
  const mae = officialMae(r?.baselines?.official, r?.actual)
  if (mae == null || r?.metrics?.mae == null) return null
  return { official: mae, model: r.metrics.mae, beats: r.metrics.mae < mae }
})
const loadingA = ref(false)
const chartA = ref<InstanceType<typeof UnifiedForecastChart> | null>(null)
const currentProvider = computed(() => visibleTargetProviders.value.find((p) => p.id === algoId.value))

function clearForecastState() {
  error.value = ''
  officialLabel.value = ''   // 不清会残留到没有官方基线的目标/地区上，标签指向一条不存在的线
  result.value = null
  backtestA.value = null
  compareRows.value = []
  compareResults.value = []
  overviewResults.value = []
}

function resetParams() {
  const p = currentProvider.value
  params.value = p ? defaultParams(p) : {}
}
// 页面级上下文世代（#468）：切地区/目标即作废一切在飞异步请求
// runCompare/决策动作/loadOverview 等在写入结果前校验，防旧上下文慢响应写回当前页面。
// 上下文切换会作废请求代次；每次finally只负责自己的加载状态。
let contextGeneration = 0
watch(target, () => {
  contextGeneration++
  if (target.value) void ensureForecastCatalog(target.value, false, regionId.value)
  if (!visibleTargetProviders.value.find((p) => p.id === algoId.value)) {
    algoId.value = visibleTargetProviders.value[0]?.id ?? ''
  }
  compareIds.value = compareIds.value.filter((id) => visibleTargetProviders.value.find((p) => p.id === id))
  clearForecastState()
  resetParams()
})
watch(regionId, (id) => {
  contextGeneration++
  discoverTargetOptions(true, id)
  if (!visibleTargetProviders.value.find((p) => p.id === algoId.value)) {
    algoId.value = visibleTargetProviders.value[0]?.id ?? ''
  }
  compareIds.value = compareIds.value.filter((id) => visibleTargetProviders.value.find((p) => p.id === id))
  clearForecastState()
  resetParams()
})
watch([targetOptions, targetOptionsLoading, targetDiscoverySettled, target], ([options, loading, settled]) => {
  if (!targetDiscoveryRequested.value || !settled || loading) return
  if (options.some((item) => item.id === target.value)) return
  target.value = options[0]?.id ?? ''
}, { immediate: true })
let providerWatchReady = false
// 目录异步返回后再选首个可用模型；不把上一个目标的选择留在新目录中。
watch(visibleTargetProviders, (providers) => {
  if (!providers.some((p) => p.id === algoId.value)) {
    algoId.value = providers[0]?.id ?? ''
  }
}, { immediate: true })
watch(visibleTargetProviders, (providers) => {
  const allowed = new Set(providers.map((provider) => provider.id))
  const next = compareIds.value.filter((id) => allowed.has(id))
  if (next.length !== compareIds.value.length) compareIds.value = next
})
watch(algoId, () => {
  if (providerWatchReady) {
    result.value = null
    backtestA.value = null
  }
  resetParams()
  providerWatchReady = true
}, { immediate: true })

let runGeneration = 0

async function runSingle() {
  const p = currentProvider.value
  if (!p) {
    error.value = singleModelEmptyText.value
    return
  }
  if (!requireTargetDate()) return
  // 发起前快照本次预测上下文；await 期间用户可能切地区/目标/算法，返回后仅当
  // ① 本请求仍是最新一次（generation）且 ② 快照仍与当前控件一致（stillCurrent）
  // 才写入结果，否则丢弃（#463：旧请求结果不得贴上新地区/目标标签）。
  // loading 复位只看 generation，切换控件而未重跑时旧请求结束仍需收起 loading。
  const generation = ++runGeneration
  const context = contextGeneration
  const snapshot = { regionId: regionId.value, target: target.value, algoId: algoId.value }
  const ctx = buildCtx()
  const stillCurrent = () =>
    context === contextGeneration && snapshot.regionId === regionId.value && snapshot.target === target.value && snapshot.algoId === algoId.value
  loadingA.value = true; error.value = ''
  result.value = null; backtestA.value = null; officialLabel.value = ''
  try {
    setCurrentRegionId(snapshot.regionId)
    // 官方日前预测与本次预测并行取（互不依赖）：取不到就是没有，不阻断预测结果展示。
    // 只有声明了官方数据源的地区+目标才发请求，避免对没有官方预测的组合空跑一次网络。
    const officialTask = hasOfficialBaseline(ctx.regionId, ctx.target)
      ? fetchOfficialBaseline(ctx.regionId, ctx.target, ctx.targetDate).catch(() => null)
      : Promise.resolve(null)
    const [res, official] = await Promise.all([p.run(ctx, { ...params.value, train_days: ctx.historyDays }), officialTask])
    if (generation !== runGeneration || !stillCurrent()) return
    if (official) {
      // 96 点 → 当前粒度，复用 provider 同一套聚合；漏掉会让官方线与横轴错位
      const pts = ctx.granularity === 24 ? aggregate96to24(official.points) : official.points
      res.baselines = { ...(res.baselines ?? {}), official: pts }
    }
    officialLabel.value = official?.label ?? ''
    result.value = res
    // 登记本次实验上下文供同页「申报决策」tab 跟随（回放算法不携带 model）。
    // 用请求时快照 ctx 的日期/历史窗（await期间变化已由contextGeneration守卫），
    // 保证登记的是本次成功预测真实使用的上下文（3621741658）。
    publishBenchContext({
      modelId: p.kind === 'compute' ? p.id : undefined,
      targetDate: ctx.targetDate ?? '',
      trainDays: ctx.historyDays,
    })
    await nextTick(); chartA.value?.resize()
  } catch (e) {
    if (generation !== runGeneration || !stillCurrent()) return
    error.value = (e as Error).message || '预测失败：后端不可达？请确认 agent-backend(:8000) 已启动。'
  } finally {
    if (generation === runGeneration) loadingA.value = false
  }
}

const chartResultsA = computed(() =>
  result.value ? [{ provider: currentProvider.value?.name ?? algoId.value, result: result.value }] : [])

// 模式 A 附：walk-forward 回测（仅后端计算型算法，从原 ML 实验室迁入）。
const backtestA = ref<BacktestResult | null>(null)
const backtestLoadingA = ref(false)
let backtestGeneration = 0
async function runBacktestA() {
  const p = currentProvider.value
  if (!p) {
    error.value = singleModelEmptyText.value
    return
  }
  if (p.kind !== 'compute') return
  // 与 runSingle 同款快照守卫（#463 同构）：旧地区/目标的慢回测结果不得覆盖当前控件下的状态。
  const generation = ++backtestGeneration
  const context = contextGeneration
  const snapshot = { regionId: regionId.value, target: target.value, algoId: p.id }
  const stillCurrent = () =>
    context === contextGeneration && snapshot.regionId === regionId.value && snapshot.target === target.value && currentProvider.value?.id === snapshot.algoId
  backtestLoadingA.value = true; error.value = ''
  try {
    setCurrentRegionId(snapshot.regionId)
    const res = await fetchBacktest(
      { region_id: snapshot.regionId, target: snapshot.target, model_type: snapshot.algoId, train_days: historyDays.value }, 15)
    if (generation !== backtestGeneration || !stillCurrent()) return
    backtestA.value = res
  } catch (e) {
    if (generation !== backtestGeneration || !stillCurrent()) return
    error.value = (e as Error).message || '回测失败：后端不可达？'
  } finally {
    if (generation === backtestGeneration) backtestLoadingA.value = false
  }
}

// 模式 B：多算法对比
const compareIds = ref<string[]>([])
const loadingB = ref(false)
type Row = { id: string; name: string; mae: number | null; rmse: number | null; mase: number | null; improve: number | null; passes: boolean | null; basis: UnifiedForecastResult['basis']; rank: number }
const compareRows = ref<Row[]>([])
const compareResults = ref<{ provider: string; result: UnifiedForecastResult }[]>([])
const chartB = ref<InstanceType<typeof UnifiedForecastChart> | null>(null)
let compareGeneration = 0

async function runCompare() {
  if (!visibleTargetProviders.value.length) { error.value = compareModelEmptyText.value; return }
  if (!compareIds.value.length) { error.value = '请至少选择一个算法'; return }
  if (!requireTargetDate()) return
  const generation = contextGeneration
  const requestId = ++compareGeneration
  loadingB.value = true; error.value = ''
  compareRows.value = []; compareResults.value = []
  // 逐算法失败原因（后端 detail 原样保留）：此前一律 .catch(() => null) 吞掉，全失败时
  // 只报「后端不可达？」——把「这一天没有基本面数据」「该品种本地区无真实列」这类可执行
  // 原因伪装成服务故障，用户无从下手。收集后由 summarizeForecastFailures 呈现。
  const failures: ForecastFailure[] = []
  try {
    setCurrentRegionId(regionId.value)
    const settled = await Promise.all(compareIds.value.map((id) => {
      const p = visibleTargetProviders.value.find((provider) => provider.id === id)
      if (!p) return Promise.resolve(null)
      return p.run(buildCtx(), { ...defaultParams(p), train_days: historyDays.value })
        .then((r) => ({ id, name: p.name, result: r }))
        .catch((e) => { failures.push({ name: p.name, reason: (e as Error).message || '预测失败' }); return null })
    }))
    if (generation !== contextGeneration || requestId !== compareGeneration) return
    const ok = settled.filter((x): x is { id: string; name: string; result: UnifiedForecastResult } => x !== null)
    if (!ok.length) {
      error.value = summarizeForecastFailures(failures) || '所有算法预测均失败：后端不可达？请确认 agent-backend(:8000) 已启动。'
      return
    }
    // 部分成功也须报出失败项——否则少了几条曲线却无任何提示，看起来像"这些算法没被选中"。
    if (failures.length) error.value = summarizeForecastFailures(failures)
    compareResults.value = ok.map((o) => ({ provider: o.name, result: o.result }))
    const rows: Row[] = ok.map((o) => ({
      id: o.id, name: o.name,
      mae: o.result.metrics?.mae ?? null, rmse: o.result.metrics?.rmse ?? null, mase: o.result.metrics?.mase ?? null,
      improve: o.result.metrics?.improve_vs_knn_pct ?? null, passes: o.result.metrics?.passes_gate ?? null,
      basis: o.result.basis, rank: 0,
    }))
    rows.sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity))
    rows.forEach((r, i) => { r.rank = r.mae != null ? i + 1 : 0 })
    compareRows.value = rows
    await nextTick(); chartB.value?.resize()
  } catch (e) {
    if (generation !== contextGeneration || requestId !== compareGeneration) return
    error.value = (e as Error).message
  } finally { if (requestId === compareGeneration) loadingB.value = false }
}

// 模式 D：多目标总览（平台官方回放）
const overviewTargets = computed(() => platformTargetsForRegion(regionId.value).map((id) => ({
  id, name: FORECAST_TARGET_OPTIONS.find((item) => item.id === id)?.name ?? id,
})))
const overviewResults = ref<{ id: string; name: string; result: UnifiedForecastResult }[]>([])
const overviewLoading = ref(false)
let overviewGeneration = 0
async function loadOverview() {
  if (!requireTargetDate()) return
  const generation = contextGeneration
  const requestId = ++overviewGeneration
  const region = regionId.value
  overviewLoading.value = true; error.value = ''
  overviewResults.value = []
  try {
    const platform = getProvider('platform')
    if (!platform) return
    setCurrentRegionId(region)
    const selectedOverviewTargets = overviewTargets.value
    if (!selectedOverviewTargets.length) {
      overviewResults.value = []
      error.value = '当前地区暂无平台官方真实采集预测总览'
      return
    }
    // 与 runCompare 同款：逐目标失败原因不再吞掉——全失败时页面此前只是空白无提示，
    // 看起来像"这个地区没有总览"，实则是后端给了可执行原因（日期超范围/缺列等）。
    const failures: ForecastFailure[] = []
    const settled = await Promise.all(selectedOverviewTargets.map((t) =>
      platform.run({ regionId: region, target: t.id, targetDate: targetDate.value || undefined, granularity: granularityForTarget(t.id, granularity.value), historyDays: historyDays.value }, {})
        .then((r) => ({ id: t.id, name: t.name, result: r }))
        .catch((e) => { failures.push({ name: t.name, reason: (e as Error).message || '取数失败' }); return null })))
    if (generation !== contextGeneration || requestId !== overviewGeneration) return
    overviewResults.value = settled.filter((x): x is { id: string; name: string; result: UnifiedForecastResult } => x !== null)
    if (failures.length) error.value = summarizeForecastFailures(failures)
  } catch (e) {
    if (generation !== contextGeneration || requestId !== overviewGeneration) return
    error.value = (e as Error).message
  } finally { if (requestId === overviewGeneration) overviewLoading.value = false }
}

// 附 tab：模型台账（provider 元信息，available/reason 已由 catalog 注入 provider，#762）
const kindLabel = (k: ProviderKind, capabilityKind: 'deployed' | 'runtime') => capabilityKind === 'runtime'
  ? '按请求训练/计算'
  : (k === 'replay' ? '回放真实采集' : '已部署权重推理')
// 台账也是业务界面：与选择器保持同一准入范围，清理明细仅留在独立审计报告。
const ledger = computed(() => visibleTargetProviders.value.filter((p) => p.id !== 'platform').map((p) => ({
  id: p.id, name: p.name, kind: p.kind, tier: p.tier, supportedTargets: [...new Set(p.supportedTargets)],
  supportedTargetsDeclared: p.supportedTargetsDeclared !== false,
  targetCapabilityKind: p.targetCapabilityKind ?? 'deployed',
  mock: !!p.mock,
  available: p.kind === 'replay' ? true : (p.available ?? null),
  reason: p.reason ?? '',
  stage: p.stage ?? null,
  shadowGate: p.shadowGate?.passed ?? null,
  skillGate: p.quality?.passesSkillGate ?? null,
  qualitySource: p.quality?.sourceRun ?? null,
})))

// 扩展预测子面板（迁自原 ML 实验室「扩展预测」tab）：tab 切回时需 resize 其内部 echarts。
const extraPanel = ref<InstanceType<typeof ForecastExtraPanel> | null>(null)
const disclosurePanel = ref<InstanceType<typeof DailyDisclosureOverview> | null>(null)
const disclosureMode = computed(() => activeTab.value === 'overview' && regionId.value === 'yunnan')
watch(activeTab, () => nextTick(() => { chartA.value?.resize(); chartB.value?.resize(); extraPanel.value?.resize(); disclosurePanel.value?.resize() }))
function requireTargetDate(): boolean {
  if (isForecastDate(targetDate.value)) return true
  error.value = '请选择有效的预测日期；不会自动改算其他日期'
  return false
}

function invalidateRequests() {
  ++contextGeneration; ++runGeneration; ++backtestGeneration; ++compareGeneration; ++overviewGeneration
  loadingA.value = false; backtestLoadingA.value = false; loadingB.value = false; overviewLoading.value = false
  clearForecastState()
}
// 覆盖日期/窗口/显示粒度/算法参数，防旧日期响应贴到新日期标签，包括A→B→A。
watch([target, regionId, targetDate, granularity, historyDays, params, compareIds], invalidateRequests, { deep: true, flush: 'sync' })
watch(selectedRegionId, (id) => { if (id) regionId.value = id })
watch(() => route.query.target, (value) => { target.value = targetFromQuery(value) })
watch(() => route.query.date, (value) => { targetDate.value = typeof value === 'string' ? value : '' })
onBeforeUnmount(invalidateRequests)
onMounted(() => { discoverTargetOptions(false, regionId.value) })
</script>

<template>
  <div class="workbench">
    <el-card>
      <template #header>
        <div class="hdr">
          <span class="title">ML 预测工作台</span>
          <span class="sub">选目标 → 选算法 → 配参数 → 统一结果 · 已接入模型与官方对照：单算法(含回测)/对比/扩展预测/总览/台账</span>
          <DataBasisBadge v-if="result && activeTab === 'single'" :basis="result.basis" prefix="数据口径" />
        </div>
      </template>

      <!-- 共享任务栏 -->
      <div class="controls shared">
        <span class="lbl">地区</span>
        <el-select v-model="regionId" style="width: 120px">
          <el-option v-for="r in regionOptions" :key="r.id" :label="r.name" :value="r.id" />
        </el-select>
        <span v-if="!disclosureMode" class="lbl">预测目标</span>
        <el-select v-if="!disclosureMode" v-model="target" style="width: 150px" :disabled="targetOptionsLoading || !targetOptions.length">
          <el-option v-for="t in targetOptions" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <span class="lbl">{{ disclosureMode ? '披露记录日期' : '预测日期' }}</span>
        <el-date-picker v-model="targetDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
        <template v-if="!disclosureMode">
        <span class="lbl">粒度</span>
        <el-radio-group v-if="nativeSlots === 96" v-model="granularity" size="small">
          <el-radio-button :value="96">96 点</el-radio-button>
          <el-radio-button :value="24">24 点</el-radio-button>
        </el-radio-group>
        <el-tag v-else size="small" type="info">{{ nativeSlots }} 点（标的原生粒度，不聚合）</el-tag>
        <span class="lbl">历史范围(天)</span>
        <el-input-number v-model="historyDays" :min="30" :max="365" :step="30" size="small" />
        </template>
      </div>

      <el-alert v-if="targetCatalogNotice" :title="targetCatalogNotice"
        :type="targetCatalogError ? 'warning' : 'info'" :closable="false" show-icon style="margin: 8px 0" />
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon style="margin: 8px 0" />

      <el-tabs v-model="activeTab" class="tabs">
        <!-- 模式 A：单算法预测 -->
        <el-tab-pane label="单算法预测" name="single">
          <div class="controls">
            <span class="lbl">算法</span>
            <el-select v-model="algoId" style="width: 260px">
              <el-option v-for="p in visibleTargetProviders" :key="p.id"
                :label="providerOptionLabel(p)" :value="p.id"
                :disabled="p.available === false"
                :title="p.available === false ? (p.reason || '当前不可用') : (p.reason || '')" />
            </el-select>
            <span v-if="catalogError" class="catalog-error" :title="catalogError">⚠ 模型目录加载失败</span>
            <el-button type="primary" :loading="loadingA" :disabled="!currentProvider" @click="runSingle">预测</el-button>
            <el-button v-if="currentProvider?.kind === 'compute'" :loading="backtestLoadingA" :disabled="!currentProvider" @click="runBacktestA">回测</el-button>
          </div>
          <el-empty v-if="!hasVisibleTargetProviders" :description="singleModelEmptyText" :image-size="72" />

          <div class="param-box">
            <!-- 历史窗口只由共享任务栏决定，不能被算法表单中的默认180天静默覆盖。 -->
            <DynamicParamPanel :schema="(currentProvider?.paramsSchema ?? []).filter((field) => field.key !== 'train_days')" v-model:params="params" />
          </div>

          <!-- 模型输入门槛（dljy#2464）：远端模型自述的 I/O × 平台供给——用户选模型时就知道差什么，不用选了才撞 -->
          <div v-if="currentProvider?.io" class="io-box">
            <span class="lbl">输入门槛</span>
            <el-tag size="small" type="info">{{ currentProvider.io.intervalMinutes }} 分钟</el-tag>
            <el-tag v-if="currentProvider.io.seqLen" size="small" type="info">回看 {{ currentProvider.io.seqLen }} 点</el-tag>
            <el-tag v-if="currentProvider.io.predLen" size="small" type="info">输出 {{ currentProvider.io.predLen }} 点</el-tag>
            <el-tag v-if="currentProvider.io.quantilesSupported.length" size="small" type="info">分位 {{ currentProvider.io.quantilesSupported.join('/') }}</el-tag>
            <template v-if="currentProvider.io.covariates.length">
              <span class="lbl">协变量</span>
              <el-tag v-for="c in currentProvider.io.covariates" :key="c.field" size="small"
                :type="c.platformStatus === 'available' ? 'success' : 'danger'"
                :title="c.platformStatus === 'available' ? c.field : `${c.field}：${c.blockedReason || '平台供不上'}`">
                {{ c.labelZh || c.field }}{{ c.platformStatus === 'available' ? '' : '（缺）' }}
              </el-tag>
            </template>
            <span v-else class="io-note">单变量（只用目标历史）</span>
            <span v-if="currentProvider.lineage" class="io-note">
              {{ currentProvider.source || '' }}
              {{ currentProvider.lineage.activeVersion ? '· 版本 ' + currentProvider.lineage.activeVersion : (currentProvider.lineage.version ? '· 版本 ' + currentProvider.lineage.version : '') }}
              {{ currentProvider.lineage.dataSeenThrough ? '· 数据见至 ' + currentProvider.lineage.dataSeenThrough : '' }}
              {{ currentProvider.lineage.lineageNote ? '· ' + currentProvider.lineage.lineageNote : '' }}
            </span>
          </div>

          <div class="view-toggles">
            <el-checkbox v-model="mergeActual" size="small">实际值替代该时段预测</el-checkbox>
          </div>
          <UnifiedForecastChart ref="chartA" :results="chartResultsA" :height="360"
            :merge-actual="mergeActual" v-loading="loadingA" />

          <div v-if="result" class="metrics">
            <el-descriptions :column="4" border size="small"
              :title="`结果指标（${result.basis === 'captured' || result.basis === 'real' ? '真实采集/计算' : '合成验证，仅验链路'}）`">
              <el-descriptions-item label="算法">{{ currentProvider?.name }}</el-descriptions-item>
              <el-descriptions-item label="数据口径"><DataBasisBadge :basis="result.basis" /></el-descriptions-item>
              <el-descriptions-item label="粒度">{{ result.granularity }} 点</el-descriptions-item>
              <el-descriptions-item label="单位">{{ result.unit || '—' }}</el-descriptions-item>
              <template v-if="result.metrics">
                <el-descriptions-item label="MAE">{{ result.metrics.mae?.toFixed(1) ?? '—' }}</el-descriptions-item>
                <el-descriptions-item label="RMSE">{{ result.metrics.rmse?.toFixed(1) ?? '—' }}</el-descriptions-item>
                <el-descriptions-item label="MASE(vs Naive)">
                  <el-tag v-if="result.metrics.mase != null" :type="result.metrics.mase < 1 ? 'success' : 'danger'">{{ result.metrics.mase.toFixed(3) }}</el-tag>
                  <span v-else>—</span>
                </el-descriptions-item>
                <el-descriptions-item label="较 KNN 提升">{{ result.metrics.improve_vs_knn_pct?.toFixed(1) ?? '—' }}%</el-descriptions-item>
                <!-- 官方日前预测对照：跑赢 naive/KNN 说明不了什么，跑赢官方才是能拿出去讲的结论 -->
                <el-descriptions-item v-if="officialCompare" :label="`vs ${officialLabel}`">
                  <el-tag :type="officialCompare.beats ? 'success' : 'danger'" size="small">
                    {{ officialCompare.beats ? '优于' : '劣于' }}官方 {{ Math.abs(officialCompare.model - officialCompare.official).toFixed(1) }}
                  </el-tag>
                  <span class="official-note">官方 MAE {{ officialCompare.official.toFixed(1) }}</span>
                </el-descriptions-item>
                <!-- #764 区间覆盖率对照（probabilistic 时 prob_metrics 产出 picp）；名义覆盖率一律由 nominal_coverage 计算 -->
                <el-descriptions-item v-if="result.metrics.picp != null" label="PICP 区间覆盖">
                  实测 {{ (result.metrics.picp * 100).toFixed(1) }}% / 名义 {{ result.metrics.nominal_coverage != null ? (result.metrics.nominal_coverage * 100).toFixed(0) : '—' }}%
                </el-descriptions-item>
              </template>
            </el-descriptions>
          </div>

          <div v-if="backtestA" class="metrics">
            <el-descriptions :column="4" border size="small"
              :title="`walk-forward 回测（${backtestA.aggregate.n_test_days} 天样本外平均，${backtestA.basis === 'captured' ? '真实' : '合成验证'}）`">
              <el-descriptions-item label="平均 MAE">{{ backtestA.aggregate.mae.toFixed(1) }}</el-descriptions-item>
              <el-descriptions-item label="平均 Naive MAE">{{ backtestA.aggregate.naive_mae.toFixed(1) }}</el-descriptions-item>
              <el-descriptions-item label="平均 MASE">
                <el-tag :type="backtestA.aggregate.beats_naive ? 'success' : 'danger'" size="small">{{ backtestA.aggregate.mase_vs_naive.toFixed(3) }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="较 KNN 提升">{{ backtestA.aggregate.improve_vs_knn_pct.toFixed(1) }}%</el-descriptions-item>
            </el-descriptions>
          </div>

          <el-alert v-for="(w, i) in (result?.warnings ?? [])" :key="i" :title="w" type="info" :closable="false" show-icon style="margin-top: 8px" />
        </el-tab-pane>

        <!-- 模式 B：多算法对比 -->
        <el-tab-pane label="多算法对比" name="compare">
          <div class="controls compare-controls">
            <span id="compare-algorithm-label" class="lbl">参与对比的算法</span>
            <el-checkbox-group v-model="compareIds" class="compare-checkboxes" aria-labelledby="compare-algorithm-label">
              <el-checkbox v-for="p in visibleTargetProviders" :key="p.id" :value="p.id" border class="compare-checkbox"
                :disabled="loadingB || p.available === false"
                :title="providerOptionLabel(p)">
                <span class="compare-model-name">{{ p.name }}</span>
              </el-checkbox>
            </el-checkbox-group>
            <el-button type="primary" :loading="loadingB" :disabled="!hasVisibleTargetProviders" @click="runCompare">运行对比</el-button>
          </div>
          <el-empty v-if="!hasVisibleTargetProviders" :description="compareModelEmptyText" :image-size="72" />
          <p class="hint">同地区/目标/日期/粒度下，对所选算法各自预测，叠加曲线；算法名保持单行省略、卡片等宽对齐。有评估指标的按 MAE 升序排名（平台官方/KNN 回放无监督指标，列为「—」）。</p>

          <UnifiedForecastChart ref="chartB" :results="compareResults" :height="360" v-loading="loadingB" />

          <el-table v-if="compareRows.length" :data="compareRows" size="small" border style="margin-top: 12px"
            :row-class-name="({ row }: { row: Row }) => (row.rank === 1 ? 'best-row' : '')">
            <el-table-column label="排名" width="64">
              <template #default="{ row }">
                <el-tag v-if="row.rank > 0" :type="row.rank === 1 ? 'success' : 'info'" size="small">{{ row.rank }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="算法" />
            <el-table-column label="数据口径" width="120">
              <template #default="{ row }"><DataBasisBadge :basis="row.basis" /></template>
            </el-table-column>
            <el-table-column label="MAE" width="100"><template #default="{ row }">{{ row.mae != null ? row.mae.toFixed(1) : '—' }}</template></el-table-column>
            <el-table-column label="RMSE" width="100"><template #default="{ row }">{{ row.rmse != null ? row.rmse.toFixed(1) : '—' }}</template></el-table-column>
            <el-table-column label="MASE(vs Naive)" width="140">
              <template #default="{ row }">
                <el-tag v-if="row.mase != null" :type="row.mase < 1 ? 'success' : 'danger'" size="small">{{ row.mase.toFixed(3) }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="较 KNN 提升" width="120">
              <template #default="{ row }">{{ row.improve != null ? `${row.improve.toFixed(1)}%` : '—' }}</template>
            </el-table-column>
            <el-table-column label="验收门槛" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.passes != null" :type="row.passes ? 'success' : 'warning'" size="small">{{ row.passes ? '通过' : '未过' }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 扩展预测：超短期/中长期/偏差；独立PatchTST序列演示已按用户要求移除。 -->
        <el-tab-pane label="扩展预测" name="extra">
          <ForecastExtraPanel ref="extraPanel" :region-id="regionId" :target="target" :train-days="historyDays" :target-date="targetDate" />
        </el-tab-pane>

        <!-- 模式 D：多目标总览 -->
        <el-tab-pane label="多目标总览" name="overview">
          <DailyDisclosureOverview v-if="regionId === 'yunnan' && activeTab === 'overview'" ref="disclosurePanel" :region-id="regionId" :date="targetDate" />
          <template v-else-if="regionId !== 'yunnan'">
          <div class="controls">
            <el-button type="primary" :loading="overviewLoading" @click="loadOverview">加载平台官方总览</el-button>
            <span class="hint">按共享预测日期加载已核实来源的官方预测；这是披露回放，不是南洋模型计算。</span>
          </div>
          <el-row :gutter="12">
            <el-col v-for="o in overviewResults" :key="o.id" :span="12" :xs="24">
              <div class="ov-card">
                <div class="ov-hd"><span>{{ o.name }}（{{ o.result.unit || '—' }}）</span><DataBasisBadge :basis="o.result.basis" /></div>
                <UnifiedForecastChart :results="[{ provider: o.name, result: o.result }]" :height="240" />
              </div>
            </el-col>
          </el-row>
          </template>
        </el-tab-pane>

        <!-- 附 tab：模型台账 -->
        <el-tab-pane label="模型台账" name="ledger">
          <p class="hint">当前目标下的真实可运行算法分两类：已部署权重显示其固定输出；KNN、XGBoost、PatchTST 等按请求算法显示可读取真实历史数据并即时训练/计算的目标。后者不是已保存权重或历史训练次数。占位和原始零样本模型仍不展示，协变量不计入目标数。</p>
          <el-table :data="ledger" size="small" border>
            <el-table-column prop="name" label="算法" />
            <el-table-column label="运行时" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.mock" type="warning" size="small">占位·Ridge</el-tag>
                <el-tag v-else type="success" size="small">真实算法</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="运行方式" width="150"><template #default="{ row }">{{ kindLabel(row.kind, row.targetCapabilityKind) }}</template></el-table-column>
            <el-table-column prop="tier" label="层级" width="110" />
            <el-table-column label="目标能力" width="120"><template #default="{ row }"><ForecastTargetCount :targets="row.supportedTargets" :declared="row.supportedTargetsDeclared" :model-name="row.name" :capability-kind="row.targetCapabilityKind" /></template></el-table-column>
            <el-table-column label="后端可用" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.available === true" type="success" size="small">可用</el-tag>
                <el-tag v-else-if="row.available === false" type="info" size="small">需依赖</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="阶段" width="100">
              <template #default="{ row }">{{ row.stage ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="影子门禁" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.shadowGate !== null" :type="row.shadowGate ? 'success' : 'warning'" size="small">{{ row.shadowGate ? '通过' : '未过' }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="Skill 门禁" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.skillGate !== null" :type="row.skillGate ? 'success' : 'danger'" size="small">{{ row.skillGate ? '通过' : '未过' }} · {{ row.qualitySource }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.view-toggles { display: flex; gap: 18px; align-items: center; margin: 4px 0 6px; }
.official-note { margin-left: 8px; color: var(--el-text-color-secondary); font-size: var(--font-sm); }
.workbench { padding: 12px; }
.hdr { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title { font-size: var(--font-16); font-weight: 600; }
.sub { color: var(--el-text-color-secondary); font-size: var(--font-sm); }
.controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.compare-controls { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 12px; }
.compare-controls > .el-button { justify-self: start; margin-left: 0; }
.compare-checkboxes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 8px 12px; width: 100%; min-width: 0; }
.compare-checkboxes :deep(.el-checkbox.is-bordered) {
  display: flex; box-sizing: border-box; width: 100%; min-width: 0; height: 40px;
  margin: 0; padding: 0 10px;
  align-items: center; border-radius: 6px; background: var(--el-bg-color);
}
.compare-checkboxes :deep(.el-checkbox__input) { flex: 0 0 auto; }
.compare-checkboxes :deep(.el-checkbox__label) { min-width: 0; padding-left: 8px; white-space: nowrap; text-align: left; overflow: hidden; }
.compare-model-name { display: block; color: var(--el-text-color-primary); font-size: var(--font-sm, 12px); line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.compare-checkboxes :deep(.el-checkbox.is-bordered:not(.is-disabled):hover) { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.compare-checkboxes :deep(.el-checkbox.is-bordered.is-checked) { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.compare-checkboxes :deep(.el-checkbox.is-checked) .compare-model-name { font-weight: 600; }
.compare-checkboxes :deep(.el-checkbox.is-bordered:focus-within) { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.compare-checkboxes :deep(.el-checkbox.is-disabled) { background: var(--el-fill-color-light); }
.controls.shared { padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter); }
.lbl { color: var(--el-text-color-secondary); font-size: var(--font-md); }
.hint { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 0 0 8px; }
.param-box { margin: 4px 0 12px; }
.metrics { margin-top: 14px; }
.ov-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
.ov-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 600; font-size: var(--font-lg); margin-bottom: 4px; }
:deep(.best-row) { background: var(--el-color-success-light-9); }
.io-box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 10px; }
.io-note { color: var(--el-text-color-secondary); font-size: var(--font-sm, 12px); }
</style>
