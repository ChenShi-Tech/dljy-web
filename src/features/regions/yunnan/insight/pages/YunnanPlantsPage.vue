<script setup lang="ts">
// 云南场站市场表现页（dljy#3083 / dljy#3029 / dljy#3032，OpenSpec build-yunnan-regional-market-insight
// 任务 11.5/11.6 与 12.5）
// ----------------------------------------------------------------------------
// /insight/plants 的云南实现：五个页签（组合总览 / 价格出力 / 预测执行 / 申报出清实际 /
// 结算表现）。口径要点（specs yunnan-plant-market-performance、yunnan-settlement-insight，
// 本页只呈现、不计算）：
//   - 组合覆盖摘要按日报宽表六字段独立统计有效样本与覆盖天数：一个字段缺测不代表其他
//     字段缺测；覆盖分母固定为「所选获权资料对象」，分母文案按后端原文呈现，不称全集团；
//   - 捕获参考价 = Σ(电量×节点价)/Σ电量，是「电量加权平均节点价参考」：不是收入、不含
//     电网损失；按节点分列、不合并；量价参考乘积只是参考乘积，不是实际结算电费；
//   - 出力曲线与捕获表共用对象选择与同步时间轴：两者是并列对照，本期不做逐时乘积画线；
//   - 供应商比较按「同一场站、同一曲线家族、不同供应商/预测源」分组，只用共同有效时段
//     比较；共同样本不足只并列展示、不比较不排名；单源标单源；夜间零值是真实值照常呈现；
//   - 申报、出清、上网、集控实发、分时结算与中长期引用语义不同：不相加、不差值、不分摊；
//     缺失口径显示「—」（该口径本窗口无资料），不用其他口径填充；页面不提供派生偏差列
//    （「偏差对照将在口径确认后提供」，任务 11.6 完整验收另行处理）；
//   - 结算页签（specs yunnan-settlement-insight ST01—ST06）：正式/暂结是显式状态轴，默认正式，
//     暂结必须显式切换且以「正式/暂结并排对照」呈现（两态都在才算差异、永不相加）；只有暂结的
//     期间按后端 notes 原文说明，不静默用暂结顶替正式；总量/总费/加权均价按成对有效记录口径
//     （后端算好、页面只呈现）；策略/预测损失是源系统披露值，电网损失全空保持「来源未提供」，
//     「未解释差额」单列并标注不是损失认定，完整瀑布只在后端判定数据齐备时出现；单据与核对是
//     只读红线：洞察不提供任何修改电费或自动结算的入口；
//   - 获权分析按能力目录判定可见性：公共账号整页给「获权数据需开通」说明，不发任何请求；
//   - 对象选项来自覆盖接口（coverage）各来源的 objects 清单：字段缺失（老后端）显示
//    「无法列出」且不发查询；为空如实说明窗口内没有对象；未选对象前置拦截不发请求；
//   - 业务模块只读深链（dljy#3096，任务 15.5）：结算页签「前往结算业务」、申报出清实际
//    页签「前往中长期模块」、区块空态「前往资料维护」——显隐经 governance 既有口径判定，
//    跳转只带期间/对象名/from 标记，不自动创建/提交任何单据（design D11 / CH04 / PP07）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'
import type { InsightContextInput } from 'shared/insight/contract.mjs'
import {
  fetchInsightCapabilities,
  fetchInsightCoverage,
  queryInsight,
  type InsightBlockResult,
  type InsightCapabilities,
  type InsightCoverageSource,
  type InsightRequestError,
  type InsightSeriesMeta,
} from '@/services/insight/insightClient'
import { useInsightContext } from '@/composables/useInsightContext'
import {
  DEEP_LINK_TARGETS,
  businessDeepLinkQuery,
  canFollowDeepLink,
  openBusinessDeepLink,
  openDataMaintenanceLink,
} from '../businessLinks'
import { insightAiBlockOf, useInsightAiPage, type InsightAiEvidenceBlock } from '@/features/regions/yunnan/insight/useInsightAiPage'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightEvidenceDrawer from '@/components/insight/InsightEvidenceDrawer.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightObjectPicker, { type InsightObjectOption } from '@/components/insight/InsightObjectPicker.vue'
import InsightResultTable from '@/components/insight/InsightResultTable.vue'
import InsightSeriesChart from '@/components/insight/chart/InsightSeriesChart.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import { formatBeijingDateTime, insightSourceTitle, type InsightSourceTitle } from '@/components/insight/insightText'

// ── 分析与固定文案 ───────────────────────────────────────────────────────────────────────

const PLANTS_DAILY_METRICS = 'plants.daily-metrics'
const PLANTS_SETTLEMENT_DAILY = 'plants.settlement-daily'
const PLANTS_SETTLEMENT_STATUS_DIFF = 'plants.settlement-status-diff'
const PLANTS_SETTLEMENT_INTERVAL = 'plants.settlement-interval'
const PLANTS_SETTLEMENT_DOCS = 'plants.settlement-docs'
const PLANTS_SETTLEMENT_RECONCILE = 'plants.settlement-reconcile'
const PLANTS_PRICE_CAPTURE = 'plants.price-capture'
const PLANTS_OUTPUT_SERIES = 'plants.output-series'
const PLANTS_CLEARING_ACTUAL = 'plants.clearing-actual'
const PLANTS_BUSINESS_FORECAST = 'plants.business-forecast'

/** 需要对象清单（coverage.objects）的获权分析：组合摘要 / 价格捕获 / 出力曲线 / 语义对照 /
 *  结算日结与状态对照（同一对象组）/ 分时结算统计。 */
const OBJECT_COVERAGE_ANALYSES = [
  PLANTS_DAILY_METRICS,
  PLANTS_PRICE_CAPTURE,
  PLANTS_OUTPUT_SERIES,
  PLANTS_CLEARING_ACTUAL,
  PLANTS_SETTLEMENT_DAILY,
  PLANTS_SETTLEMENT_STATUS_DIFF,
  PLANTS_SETTLEMENT_INTERVAL,
] as const
type ObjectCoverageAnalysis = (typeof OBJECT_COVERAGE_ANALYSES)[number]

const PLANTS_TABS = [
  { view: 'overview', label: '组合总览' },
  { view: 'price-output', label: '价格出力' },
  { view: 'forecast', label: '预测执行' },
  { view: 'clearing', label: '申报出清实际' },
  { view: 'settlement', label: '结算表现' },
] as const

type PlantsTab = (typeof PLANTS_TABS)[number]['view']

// 视图固定说明（口径来自 specs 与后端 plants 视图，改文案要同步 docs/market-insight-plants.md）
const STAGE_TEXT = '场站市场表现只呈现获权资料的分析结果：页面不计算、不派生，口径以后端分析视图为准'
const PICK_PLANT_TEXT = '请先选择场站对象（选项来自所选窗口的覆盖清单）；未选不发请求'
const OBJECTS_UNAVAILABLE_TEXT = '对象清单需要新版洞察服务，当前无法列出'
const OBJECTS_EMPTY_TEXT = '所选窗口内没有可选对象：可换一个日期窗或确认数据接入情况'
const ENTITLEMENT_OVERVIEW_TEXT = '获权数据需开通：当前公司没有场站日报指标与正式日结明细的查看授权'
const ENTITLEMENT_PRICE_TEXT = '获权数据需开通：当前公司没有价格捕获参考与场站出力曲线的查看授权'
const ENTITLEMENT_FORECAST_TEXT = '获权数据需开通：当前公司没有场站出力供应商比较的查看授权'
const ENTITLEMENT_CLEARING_TEXT = '获权数据需开通：当前公司没有申报出清实发对照与一体化预测的查看授权'
const ENTITLEMENT_SETTLEMENT_TEXT = '获权数据需开通：当前公司没有结算表现相关分析的查看授权'
const SETTLEMENT_STATUS_TEXT = '正式/暂结是显式状态轴：默认看正式读模型；暂结必须显式切换，且以正式/暂结并排对照呈现——两态都在才算差异、永不相加、不双计（ST01）'
const SETTLEMENT_FORMAL_TEXT = '正式日结口径：读正式读模型；暂结不混进正式口径，要看暂结请显式切换到「暂结对照」'
const SETTLEMENT_TEMP_TEXT = '正式/暂结对照：同对象×同业务日两态都在才给差异列（正式 − 暂结）；差异不是更正，哪一方为准由结算业务确认；只有暂结的期间按下方说明原文展示，不静默用暂结顶替正式（A08）'
const SETTLEMENT_STATS_TEXT = '结算均价 = 成对有效记录 Σ电费/Σ电量（量费加权）：只有电量与电费同时有效的记录进分子分母；正式与暂结按来源分别统计、不相加不互加；电费不是利润（ST02）'
const SETTLEMENT_LOSS_TEXT = '策略损失与预测损失是源系统披露值，照常展示、保留源符号；「未解释差额」= 源收入 − 已知分项合计，只是未解释差额，不是损失认定，不自动归到电网、策略或预测损失（ST03）'
const SETTLEMENT_DOCS_TEXT = '单据是记录不是数值时序：账单索引≠账单原件；有索引不等于文件可下载（下载记录是历史行为，不生成当前可下载承诺）；单元格只是原件转录，无模板语义不得计算合计（ST06）'
const SETTLEMENT_READONLY_TEXT = '只读红线：审批、对账处置、账单维护与正式确认留在结算业务模块——洞察只读，不提供任何修改电费或自动结算的入口（ST06）'
const SETTLEMENT_RECONCILE_TEXT = '日报（日）、日结（日）、月结（月）是不同周期/证据层级：不相加、不跨周期互比；差异列只在同对象同业务日双方齐备时给出（日报收入 − 日结电费），差异不是判错（ST05）'
const COVERAGE_FIELDS_TEXT = '日报宽表各字段独立统计有效样本与覆盖天数：一个字段缺测不代表其他字段缺测，也不用其他字段补齐或折算'
const CAPTURE_TEXT = '电量加权平均节点价参考，不是收入、不含电网损失'
const PRODUCT_TEXT = '节点量价参考乘积只是电量×节点价的参考乘积，不是实际结算电费'
const LINKAGE_TEXT = '捕获表电量口径为实际上网电量（经营汇总口径）；出力曲线是厂站功率曲线。两者同步时间轴、并列对照：本期不做逐时乘积画线'
const COMPARE_TEXT = '按「同一场站、同一曲线家族、不同供应商/预测源」分组，只用共同有效时段比较；比较是并列观察，不是供应商考核，也不判定预测责任'
const NIGHT_ZERO_TEXT = '夜间零值是真实值：照常呈现、参与统计，不剔除、不标注异常'
const SEMANTICS_TEXT = '申报、出清、上网、集控实发、分时结算与中长期引用语义不同：不相加、不差值、不分摊；本页不提供派生偏差列——偏差对照将在口径确认后提供'
const FOLLOW_OVERVIEW_TEXT = '与上方同一组场站对象；未选或对象清单不可用时本区块不查询'
const FOLLOW_PRICE_TEXT = '与上方价格捕获表同一组场站对象；未选或对象清单不可用时本区块不查询'
const FOLLOW_CLEARING_TEXT = '与上方对照表同一组场站对象；未选或对象清单不可用时本区块不查询'

/** 日报宽表六字段 → 业务名（字段登记见 shared/insight/sources.mjs，界面不透出内部字段原文）。 */
const DAILY_FIELD_LABELS: Record<string, string> = {
  totalGeneration: '总发电量',
  marketGeneration: '市场化电量',
  dayAheadDeclared: '日前申报电量',
  integratedForecast: '一体化预测电量',
  settlementRevenue: '结算电费',
  marketPrice: '市场均价',
}

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)

/** 契约镜像里的分析登记（views / limits），不依赖后端 capabilities 是否下发。 */
const dailyMetricsDef = getInsightAnalysis(PLANTS_DAILY_METRICS)
const priceCaptureDef = getInsightAnalysis(PLANTS_PRICE_CAPTURE)
const outputSeriesDef = getInsightAnalysis(PLANTS_OUTPUT_SERIES)
const clearingDef = getInsightAnalysis(PLANTS_CLEARING_ACTUAL)
const settlementDailyDef = getInsightAnalysis(PLANTS_SETTLEMENT_DAILY)
const statusDiffDef = getInsightAnalysis(PLANTS_SETTLEMENT_STATUS_DIFF)
const settlementIntervalDef = getInsightAnalysis(PLANTS_SETTLEMENT_INTERVAL)
const maxDays = computed(() => dailyMetricsDef?.limits.maxDays ?? 31)

/** 获权分析按公司授权可见（capabilities 只返回当前公司可用的分析）。 */
function hasAnalysis(analysisId: string): boolean {
  return capabilities.value?.analyses.some((analysis) => analysis.analysisId === analysisId) ?? false
}
const hasDailyMetrics = computed(() => hasAnalysis(PLANTS_DAILY_METRICS))
const hasSettlementDaily = computed(() => hasAnalysis(PLANTS_SETTLEMENT_DAILY))
const hasStatusDiff = computed(() => hasAnalysis(PLANTS_SETTLEMENT_STATUS_DIFF))
const hasSettlementInterval = computed(() => hasAnalysis(PLANTS_SETTLEMENT_INTERVAL))
const hasSettlementDocs = computed(() => hasAnalysis(PLANTS_SETTLEMENT_DOCS))
const hasSettlementReconcile = computed(() => hasAnalysis(PLANTS_SETTLEMENT_RECONCILE))
const hasPriceCapture = computed(() => hasAnalysis(PLANTS_PRICE_CAPTURE))
const hasOutputSeries = computed(() => hasAnalysis(PLANTS_OUTPUT_SERIES))
const hasClearingActual = computed(() => hasAnalysis(PLANTS_CLEARING_ACTUAL))
const hasBusinessForecast = computed(() => hasAnalysis(PLANTS_BUSINESS_FORECAST))
/** 结算页签是否有任何可看区块：一个都没有才给整页「获权数据需开通」。 */
const hasAnySettlement = computed(
  () => hasSettlementDaily.value || hasStatusDiff.value || hasSettlementInterval.value || hasSettlementDocs.value || hasSettlementReconcile.value
)

/** 结算页签日结组的对象清单归属：状态对照优先，未获权时回落到日结自身清单（两者上限一致 ≤200）。 */
const settlementCoverageOwner = computed<ObjectCoverageAnalysis>(() =>
  hasStatusDiff.value ? PLANTS_SETTLEMENT_STATUS_DIFF : PLANTS_SETTLEMENT_DAILY
)

/** 价格出力页签的对象清单归属：价格捕获优先，未获权时回落到出力曲线自身清单。 */
const priceTabOwner = computed<ObjectCoverageAnalysis>(() => (hasPriceCapture.value ? PLANTS_PRICE_CAPTURE : PLANTS_OUTPUT_SERIES))

/** 能力目录来源 → 业务标题目录（区块标签、证据抽屉、表格与说明共用）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

async function loadCapabilities(): Promise<void> {
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (!result) return
    capabilities.value = result
    // 能力目录就绪后补一次当前页签（之前被「目录未就绪」拦住的查询与对象清单）。
    ensureTab(activeTab.value)
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
}

// ── 查询状态（页签懒加载 + queriedKey 去重 + 代次作废）────────────────────────────────────

/** 查询名：组合摘要 / 正式日结 / 价格捕获 / 出力曲线 / 供应商比较 / 语义对照 / 一体化预测 /
 *  结算页签（正式日结、正式暂结对照、分时结算统计、损失解释、单据记录、核对）。 */
type QueryName =
  | 'overview-coverage'
  | 'settlement-daily'
  | 'capture'
  | 'output-series'
  | 'supplier-comparison'
  | 'semantics'
  | 'business-forecast'
  | 'settlement-formal'
  | 'settlement-status-diff'
  | 'settlement-stats'
  | 'settlement-loss'
  | 'settlement-docs'
  | 'settlement-reconcile'

type ViewState = {
  result: InsightBlockResult | null
  error: InsightRequestError | null
  loading: boolean
  /** 最近一次成功/失败查询的签名；与当前签名不同即口径过期 */
  queriedKey: string
}

function blankState(): ViewState {
  return { result: null, error: null, loading: false, queriedKey: '' }
}

const viewStates = reactive<Record<QueryName, ViewState>>({
  'overview-coverage': blankState(),
  'settlement-daily': blankState(),
  capture: blankState(),
  'output-series': blankState(),
  'supplier-comparison': blankState(),
  semantics: blankState(),
  'business-forecast': blankState(),
  'settlement-formal': blankState(),
  'settlement-status-diff': blankState(),
  'settlement-stats': blankState(),
  'settlement-loss': blankState(),
  'settlement-docs': blankState(),
  'settlement-reconcile': blankState(),
})

const activeTab = ref<PlantsTab>('overview')
const visitedTabs = reactive(new Set<PlantsTab>(['overview']))

/** 结算页签的正式/暂结显式切换：默认正式；暂结以正式/暂结并排对照呈现，不静默顶替。 */
const settlementStatusMode = ref<'formal' | 'temp'>('formal')

/** 对象选择：各页签独立持有；价格出力页签内两个区块共用、申报出清页签内两个区块共用、
 *  结算页签内日结组（对照/损失/核对）共用、分时统计单列（上限 50 与日结组 200 不同）。 */
const overviewObjects = ref<string[]>([])
const captureObjects = ref<string[]>([])
const comparisonObjects = ref<string[]>([])
const clearingObjects = ref<string[]>([])
const settlementObjects = ref<string[]>([])
const intervalObjects = ref<string[]>([])

// ── 对象清单（coverage.objects）：获权区块的选项来源 ─────────────────────────────────────

type ObjectsState = {
  loading: boolean
  error: InsightRequestError | null
  /** 该分析的覆盖清单是否已经取回（无论结果如何）：防重复请求 */
  loaded: boolean
  /** null = coverage 未给对象清单（新版洞察服务未部署，无法列出）；[] = 窗口内没有对象 */
  objects: string[] | null
  /** 后端对清单的补充说明原文（如清单被截断）。 */
  note: string
}

function blankObjects(): ObjectsState {
  return { loading: false, error: null, loaded: false, objects: null, note: '' }
}

const objectStates = reactive<Record<ObjectCoverageAnalysis, ObjectsState>>({
  [PLANTS_DAILY_METRICS]: blankObjects(),
  [PLANTS_PRICE_CAPTURE]: blankObjects(),
  [PLANTS_OUTPUT_SERIES]: blankObjects(),
  [PLANTS_CLEARING_ACTUAL]: blankObjects(),
  [PLANTS_SETTLEMENT_DAILY]: blankObjects(),
  [PLANTS_SETTLEMENT_STATUS_DIFF]: blankObjects(),
  [PLANTS_SETTLEMENT_INTERVAL]: blankObjects(),
})

/** 清单 → 选择器选项（保持覆盖清单的名称顺序）。 */
function optionsOf(analysisId: ObjectCoverageAnalysis): InsightObjectOption[] {
  return (objectStates[analysisId].objects ?? []).map((object) => ({ id: object, label: object }))
}

type ObjectsPhase = 'loading' | 'error' | 'unavailable' | 'empty' | 'ready'

/** 清单状态机：页面据此渲染提示并决定是否拦截查询。 */
function objectsPhase(analysisId: ObjectCoverageAnalysis): ObjectsPhase {
  const entry = objectStates[analysisId]
  if (entry.loading) return 'loading'
  if (entry.error) return 'error'
  if (!entry.loaded) return 'loading'
  if (entry.objects === null) return 'unavailable'
  if (!entry.objects.length) return 'empty'
  return 'ready'
}

/** 拉取对象清单：对该分析发覆盖请求（filters 不带 objectIds），各来源 objects 取并集。 */
async function loadObjectOptions(analysisId: ObjectCoverageAnalysis): Promise<void> {
  if (!capabilities.value || capabilitiesError.value) return
  if (!hasAnalysis(analysisId)) return
  const entry = objectStates[analysisId]
  if (entry.loading || entry.loaded || entry.error) return
  entry.loading = true
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => fetchInsightCoverage({ analysisId, context: ctx.toQueryContext() }, { signal }))
    if (!result) return // 作废/迟到：不写状态
    const union = new Set<string>()
    let provided = false
    let note = ''
    for (const source of result.sources as InsightCoverageSource[]) {
      if (Array.isArray(source.objects)) {
        provided = true
        for (const object of source.objects) union.add(object)
      }
      if (source.objectsNote) note = source.objectsNote
    }
    entry.objects = provided ? [...union] : null
    entry.note = note
    entry.loaded = true
    // 清单就绪后补发当前页签里被「清单未就绪」拦住的查询。
    ensureTab(activeTab.value)
  } catch (error) {
    entry.error = error as InsightRequestError
  } finally {
    entry.loading = false
  }
}

/** 清单读取失败后的手动重试。 */
function retryObjects(analysisId: ObjectCoverageAnalysis): void {
  const entry = objectStates[analysisId]
  entry.error = null
  entry.loaded = false
  void loadObjectOptions(analysisId)
}

function onOverviewObjectsChange(ids: string[]): void {
  overviewObjects.value = [...ids]
}

function onCaptureObjectsChange(ids: string[]): void {
  captureObjects.value = [...ids]
}

function onComparisonObjectsChange(ids: string[]): void {
  comparisonObjects.value = [...ids]
}

function onClearingObjectsChange(ids: string[]): void {
  clearingObjects.value = [...ids]
}

function onSettlementObjectsChange(ids: string[]): void {
  settlementObjects.value = [...ids]
}

function onIntervalObjectsChange(ids: string[]): void {
  intervalObjects.value = [...ids]
}

/** 查询签名：上下文代次（窗口/地区/公司都在代次里）+ 各查询自身的对象选择。 */
function queryKeyOf(name: QueryName): string {
  switch (name) {
    case 'overview-coverage':
    case 'settlement-daily':
      return [name, ctx.contextVersion.value, overviewObjects.value.join(',')].join('|')
    case 'capture':
    case 'output-series':
      return [name, ctx.contextVersion.value, captureObjects.value.join(',')].join('|')
    case 'supplier-comparison':
      return [name, ctx.contextVersion.value, comparisonObjects.value.join(',')].join('|')
    case 'semantics':
    case 'business-forecast':
      return [name, ctx.contextVersion.value, clearingObjects.value.join(',')].join('|')
    case 'settlement-formal':
    case 'settlement-status-diff':
    case 'settlement-loss':
    case 'settlement-reconcile':
      return [name, ctx.contextVersion.value, settlementObjects.value.join(',')].join('|')
    case 'settlement-stats':
      return [name, ctx.contextVersion.value, intervalObjects.value.join(',')].join('|')
    case 'settlement-docs':
      return [name, ctx.contextVersion.value].join('|')
  }
}

// 上下文变化（窗口/地区/公司）：全部查询结果与对象清单都属于另一份读取，全部作废重查。
watch(
  () => ctx.contextVersion.value,
  () => {
    for (const name of Object.keys(viewStates) as QueryName[]) Object.assign(viewStates[name], blankState())
    for (const analysisId of OBJECT_COVERAGE_ANALYSES) objectStates[analysisId] = blankObjects()
    ensureTab(activeTab.value)
  }
)
// 局部对象选择变化：只作废对应的查询（不重列覆盖清单）。
watch(overviewObjects, () => {
  Object.assign(viewStates['overview-coverage'], blankState())
  Object.assign(viewStates['settlement-daily'], blankState())
  ensureQuery('overview-coverage')
  ensureQuery('settlement-daily')
})
watch(captureObjects, () => {
  Object.assign(viewStates.capture, blankState())
  Object.assign(viewStates['output-series'], blankState())
  ensureQuery('capture')
  ensureQuery('output-series')
})
watch(comparisonObjects, () => {
  Object.assign(viewStates['supplier-comparison'], blankState())
  ensureQuery('supplier-comparison')
})
watch(clearingObjects, () => {
  Object.assign(viewStates.semantics, blankState())
  Object.assign(viewStates['business-forecast'], blankState())
  ensureQuery('semantics')
  ensureQuery('business-forecast')
})
watch(settlementObjects, () => {
  for (const name of ['settlement-formal', 'settlement-status-diff', 'settlement-loss', 'settlement-reconcile'] as QueryName[]) {
    Object.assign(viewStates[name], blankState())
    ensureQuery(name)
  }
})
watch(intervalObjects, () => {
  Object.assign(viewStates['settlement-stats'], blankState())
  ensureQuery('settlement-stats')
})
// 正式/暂结显式切换：只补发当前模式的查询（另一模式的既有结果保留，切回不重查）。
watch(settlementStatusMode, () => {
  ensureQuery(settlementStatusMode.value === 'formal' ? 'settlement-formal' : 'settlement-status-diff')
})

function onTabChange(name: string | number): void {
  activeTab.value = name as PlantsTab
  visitedTabs.add(activeTab.value)
  ensureTab(activeTab.value)
}

function onWindowChange(next: { start: string; end: string }): void {
  ctx.setBusinessWindow(next.start, next.end)
}

// ── 查询编排 ─────────────────────────────────────────────────────────────────────────────

/** 页签首次激活（或口径变化后重查）需要的覆盖清单与查询集合。 */
function ensureTab(tab: PlantsTab): void {
  if (tab === 'overview') {
    void loadObjectOptions(PLANTS_DAILY_METRICS)
    ensureQuery('overview-coverage')
    ensureQuery('settlement-daily')
  } else if (tab === 'price-output') {
    void loadObjectOptions(priceTabOwner.value)
    ensureQuery('capture')
    ensureQuery('output-series')
  } else if (tab === 'forecast') {
    void loadObjectOptions(PLANTS_OUTPUT_SERIES)
    ensureQuery('supplier-comparison')
  } else if (tab === 'clearing') {
    void loadObjectOptions(PLANTS_CLEARING_ACTUAL)
    ensureQuery('semantics')
    ensureQuery('business-forecast')
  } else if (tab === 'settlement') {
    // 结算页签：日结组清单（状态对照/日结共用）与分时统计清单各自拉取；
    // 单据记录不需要对象清单（记录来源对象可选，按全部获权对象查询）。
    void loadObjectOptions(settlementCoverageOwner.value)
    void loadObjectOptions(PLANTS_SETTLEMENT_INTERVAL)
    ensureQuery(settlementStatusMode.value === 'formal' ? 'settlement-formal' : 'settlement-status-diff')
    ensureQuery('settlement-stats')
    ensureQuery('settlement-loss')
    ensureQuery('settlement-docs')
    ensureQuery('settlement-reconcile')
  }
}

/** 对象清单是否可用（null=无法列出、[]=窗口内没有对象都不可用；不看 loading——
 *  覆盖清单就绪回调先于 loading 复位触发，此处若看 phase 会把就绪误判成加载中）。 */
function objectsAvailableFor(analysisId: ObjectCoverageAnalysis): boolean {
  const objects = objectStates[analysisId].objects
  return objects !== null && objects.length > 0
}

/** 前置拦截（能力未就绪 / 无授权 / 清单不可用 / 未选对象）+ 同签名去重后发查询。 */
function ensureQuery(name: QueryName): void {
  if (!capabilities.value || capabilitiesError.value) return
  if (viewStates[name].loading) return // 同名查询在飞：不叠加重复请求（结果写回前 key 尚未落账）
  if (name === 'overview-coverage') {
    if (!(hasDailyMetrics.value && objectsAvailableFor(PLANTS_DAILY_METRICS) && overviewObjects.value.length)) return
  }
  if (name === 'settlement-daily') {
    if (!(hasSettlementDaily.value && objectsAvailableFor(PLANTS_DAILY_METRICS) && overviewObjects.value.length)) return
  }
  if (name === 'capture') {
    if (!(hasPriceCapture.value && objectsAvailableFor(priceTabOwner.value) && captureObjects.value.length)) return
  }
  if (name === 'output-series') {
    if (!(hasOutputSeries.value && objectsAvailableFor(priceTabOwner.value) && captureObjects.value.length)) return
  }
  if (name === 'supplier-comparison') {
    if (!(hasOutputSeries.value && objectsAvailableFor(PLANTS_OUTPUT_SERIES) && comparisonObjects.value.length)) return
  }
  if (name === 'semantics') {
    if (!(hasClearingActual.value && objectsAvailableFor(PLANTS_CLEARING_ACTUAL) && clearingObjects.value.length)) return
  }
  if (name === 'business-forecast') {
    if (!(hasBusinessForecast.value && objectsAvailableFor(PLANTS_CLEARING_ACTUAL) && clearingObjects.value.length)) return
  }
  if (name === 'settlement-formal') {
    if (!(hasSettlementDaily.value && objectsAvailableFor(settlementCoverageOwner.value) && settlementObjects.value.length)) return
  }
  if (name === 'settlement-status-diff') {
    // 暂结对照只在显式切换到暂结时查询：正式模式绝不静默发暂结视角的请求（ST01、A08）。
    if (settlementStatusMode.value !== 'temp') return
    if (!(hasStatusDiff.value && objectsAvailableFor(settlementCoverageOwner.value) && settlementObjects.value.length)) return
  }
  if (name === 'settlement-stats') {
    if (!(hasSettlementInterval.value && objectsAvailableFor(PLANTS_SETTLEMENT_INTERVAL) && intervalObjects.value.length)) return
  }
  if (name === 'settlement-loss') {
    if (!(hasSettlementDaily.value && objectsAvailableFor(settlementCoverageOwner.value) && settlementObjects.value.length)) return
  }
  if (name === 'settlement-docs') {
    if (!hasSettlementDocs.value) return
  }
  if (name === 'settlement-reconcile') {
    if (!(hasSettlementReconcile.value && objectsAvailableFor(settlementCoverageOwner.value) && settlementObjects.value.length)) return
  }
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  if (entry.queriedKey === key) return // 有结果或已按此键失败过：不自动重查（重试由用户触发）
  void runQuery(name)
}

/** 各查询的 analysisId / context / filters：单视图分析（日结、一体化预测）不送 view 筛选。 */
function buildRequest(name: QueryName): {
  analysisId: string
  context: InsightContextInput
  filters: Record<string, unknown>
} {
  if (name === 'overview-coverage') {
    return { analysisId: PLANTS_DAILY_METRICS, context: ctx.toQueryContext(), filters: { view: 'coverage-summary', objectIds: [...overviewObjects.value] } }
  }
  if (name === 'settlement-daily') {
    return { analysisId: PLANTS_SETTLEMENT_DAILY, context: ctx.toQueryContext(), filters: { objectIds: [...overviewObjects.value] } }
  }
  if (name === 'capture') {
    return { analysisId: PLANTS_PRICE_CAPTURE, context: ctx.toQueryContext(), filters: { view: 'capture', objectIds: [...captureObjects.value] } }
  }
  if (name === 'output-series') {
    return { analysisId: PLANTS_OUTPUT_SERIES, context: ctx.toQueryContext(), filters: { view: 'series', objectIds: [...captureObjects.value] } }
  }
  if (name === 'supplier-comparison') {
    return { analysisId: PLANTS_OUTPUT_SERIES, context: ctx.toQueryContext(), filters: { view: 'supplier-comparison', objectIds: [...comparisonObjects.value] } }
  }
  if (name === 'semantics') {
    return { analysisId: PLANTS_CLEARING_ACTUAL, context: ctx.toQueryContext(), filters: { view: 'semantics', objectIds: [...clearingObjects.value] } }
  }
  if (name === 'settlement-formal') {
    // 正式视角（默认）：正式读模型明细（series 视图，显式声明）。
    return { analysisId: PLANTS_SETTLEMENT_DAILY, context: ctx.toQueryContext(), filters: { view: 'series', objectIds: [...settlementObjects.value] } }
  }
  if (name === 'settlement-status-diff') {
    // 暂结视角（显式切换）：正式/暂结同键并排差异；两态都在才算差异、不相加。
    return { analysisId: PLANTS_SETTLEMENT_STATUS_DIFF, context: ctx.toQueryContext(), filters: { view: 'status-diff', objectIds: [...settlementObjects.value] } }
  }
  if (name === 'settlement-stats') {
    // 量费加权统计：后端按来源（正式/暂结）分别算，页面只呈现。
    return { analysisId: PLANTS_SETTLEMENT_INTERVAL, context: ctx.toQueryContext(), filters: { view: 'settlement-stats', objectIds: [...intervalObjects.value] } }
  }
  if (name === 'settlement-loss') {
    // 损失解释：源损失值 + 电网损失未提供态 + 未解释差额；页面不拼瀑布。
    return { analysisId: PLANTS_SETTLEMENT_DAILY, context: ctx.toQueryContext(), filters: { view: 'loss-explain', objectIds: [...settlementObjects.value] } }
  }
  if (name === 'settlement-docs') {
    // 单据记录：记录来源对象可选，不带 objectIds 查全部获权对象。
    return { analysisId: PLANTS_SETTLEMENT_DOCS, context: ctx.toQueryContext(), filters: { view: 'records' } }
  }
  if (name === 'settlement-reconcile') {
    // 核对：日报/日结/月结同周期差异，不同周期不相加不互比。
    return { analysisId: PLANTS_SETTLEMENT_RECONCILE, context: ctx.toQueryContext(), filters: { view: 'reconcile', objectIds: [...settlementObjects.value] } }
  }
  return { analysisId: PLANTS_BUSINESS_FORECAST, context: ctx.toQueryContext(), filters: { objectIds: [...clearingObjects.value] } }
}

async function runQuery(name: QueryName): Promise<void> {
  const key = queryKeyOf(name)
  const entry = viewStates[name]
  const request = buildRequest(name)
  entry.loading = true
  entry.error = null
  try {
    const result = await ctx.request.run((signal) => queryInsight(request, { signal }))
    if (!result || queryKeyOf(name) !== key) return // 作废/迟到：不写状态
    entry.result = result
    entry.queriedKey = key
  } catch (error) {
    if (queryKeyOf(name) !== key) return
    entry.error = error as InsightRequestError
    entry.queriedKey = key // 失败也记键：同样条件下不自动反复重试
  } finally {
    if (queryKeyOf(name) === key) entry.loading = false
  }
}

/** 手动重试 / 刷新（错误区块按钮）：清键重发。 */
function retryQuery(name: QueryName): void {
  viewStates[name].queriedKey = ''
  ensureQuery(name)
}

// ── 结果读取辅助（宽松形状：plants 视图字段见 dljy 仓 plants-views.mjs）──────────────────

type MetricRow = { seriesId: string; metricId: string; value: string | null; atIntervalStart?: string | null; timeOfDay?: string | null; groupId?: string | null }

type DataView = {
  rows?: Array<Record<string, unknown>>
  series?: Array<Record<string, unknown>>
  notes?: Array<{ note?: string }>
  unpaired?: Array<{ seriesId: string; reason: string }>
  excluded?: Array<{ seriesId: string; reason: string }>
  unavailableMetrics?: Array<{ metricId: string; reason: string }>
  coverage?: { denominatorNote?: string; observedNote?: string; objects?: Array<{ objectId: string; observed: number }> }
  groups?: Array<Record<string, unknown>>
  tables?: Record<string, { rows?: Array<Record<string, unknown>>; columns?: Array<Record<string, unknown>>; rule?: string }>
  /** 损失解释视图（loss-explain）独有：电网损失提供态与完整瀑布判定（后端决定，页面不拼）。 */
  gridLoss?: { provided?: boolean; note?: string }
  waterfall?: { complete?: boolean; missingComponents?: string[]; note?: string }
  /** 核对视图（reconcile）独有：缺测质量剔除逐条说明。 */
  qualityExcluded?: Array<{ objectId?: string; date?: string; sourceId?: string; reason?: string }>
}

function dataOf(result: InsightBlockResult | null): DataView {
  return (result?.data ?? {}) as DataView
}

/** 长表行索引：seriesId → metricId → 行（值与出现时段）。 */
function metricIndexOf(result: InsightBlockResult | null): Map<string, Map<string, MetricRow>> {
  const index = new Map<string, Map<string, MetricRow>>()
  for (const row of (dataOf(result).rows ?? []) as unknown as MetricRow[]) {
    const own = index.get(row.seriesId) ?? new Map<string, MetricRow>()
    own.set(row.metricId, row)
    index.set(row.seriesId, own)
  }
  return index
}

/** 指标值 → 业务文本：名称/单位/精度取共享登记；缺数「—」，不显示 0。 */
function metricTextOf(metricId: string, value: string | null | undefined): string {
  const shown = value === undefined ? null : formatMetricValue(metricId, value)
  return shown === null || shown === undefined ? '—' : String(shown)
}

function metricLabelOf(metricId: string): string {
  return getMetricDefinition(metricId)?.label ?? metricId
}

function metricUnitOf(metricId: string): string {
  const definition = getMetricDefinition(metricId)
  return !definition || definition.unit === 'count' ? '' : definition.unit
}

/** 后端 notes 原文（口径说明不转述）。 */
function notesOf(result: InsightBlockResult | null): string[] {
  return (dataOf(result).notes ?? []).map((item) => item.note ?? '').filter(Boolean)
}

// ── 组合总览：六字段独立覆盖卡片 ─────────────────────────────────────────────────────────

type CoverageCardRow = { objectId: string; validCount: string; coveredDays: string }
type CoverageCard = { key: string; title: string; rows: CoverageCardRow[] }

const overviewCoverageCards = computed<CoverageCard[]>(() => {
  const result = viewStates['overview-coverage'].result
  const data = dataOf(result)
  if (!result || !data.series?.length) return []
  const metrics = metricIndexOf(result)
  const cards: CoverageCard[] = []
  const byField = new Map<string, CoverageCard>()
  for (const meta of data.series as Array<InsightSeriesMeta & { kind?: string }>) {
    const own = metrics.get(meta.seriesId)
    if (!own) continue
    const fieldId = String(meta.fieldId ?? '')
    let card = byField.get(fieldId)
    if (!card) {
      card = { key: fieldId, title: DAILY_FIELD_LABELS[fieldId] ?? '其他字段', rows: [] }
      byField.set(fieldId, card)
      cards.push(card)
    }
    card.rows.push({
      objectId: String(meta.dimensions?.plant ?? '—'),
      validCount: metricTextOf('sample.valid-count', own.get('sample.valid-count')?.value),
      coveredDays: metricTextOf('sample.covered-days', own.get('sample.covered-days')?.value),
    })
  }
  // 组合排序：每个字段内按有效样本数从多到少（计数直读，不做跨字段汇总）。
  for (const card of cards) card.rows.sort((a, b) => Number(b.validCount) - Number(a.validCount) || a.objectId.localeCompare(b.objectId))
  return cards
})

const overviewDenominatorNote = computed(() => dataOf(viewStates['overview-coverage'].result).coverage?.denominatorNote ?? '')
const overviewNotes = computed(() => notesOf(viewStates['overview-coverage'].result))

// ── 价格出力：捕获参考价（按节点分列）+ 负价暴露卡 + 小时分桶图 ───────────────────────────

type CaptureSeriesEntry = {
  seriesId: string
  kind?: string
  objectId?: string
  weightNote?: string
  pairedSlots?: number
  zeroEnergySlots?: number
  negativeEnergySlots?: number
  captureUnavailableReason?: string
  priceDimensions?: Record<string, unknown>
}

function captureCatalogOf(result: InsightBlockResult | null): CaptureSeriesEntry[] {
  return (dataOf(result).series ?? []).filter((meta): meta is CaptureSeriesEntry => (meta as CaptureSeriesEntry).kind === 'capture-reference')
}

/** 捕获条目的业务标签：场站 × 节点（多节点分列，不合并）。 */
function captureLabelOf(entry: CaptureSeriesEntry): string {
  const node = entry.priceDimensions?.nodeName ? String(entry.priceDimensions.nodeName) : '节点参考价'
  return `${entry.objectId ?? '—'}·${node}`
}

type CaptureTableRow = { key: string; objectId: string; node: string; capturePrice: string; pairedEnergy: string; product: string; validCount: string }

const captureTableRows = computed<CaptureTableRow[]>(() => {
  const result = viewStates.capture.result
  if (!result) return []
  const metrics = metricIndexOf(result)
  return captureCatalogOf(result).map((entry) => {
    const own = metrics.get(entry.seriesId)
    return {
      key: entry.seriesId,
      objectId: String(entry.objectId ?? '—'),
      node: entry.priceDimensions?.nodeName ? String(entry.priceDimensions.nodeName) : '—',
      capturePrice: metricTextOf('plant.capture-price', own?.get('plant.capture-price')?.value),
      pairedEnergy: metricTextOf('plant.capture-paired-energy', own?.get('plant.capture-paired-energy')?.value),
      product: metricTextOf('plant.capture-reference-product', own?.get('plant.capture-reference-product')?.value),
      validCount: metricTextOf('sample.valid-count', own?.get('sample.valid-count')?.value),
    }
  })
})

type StatCardRow = { label: string; text: string; unit: string; note: string }
type ExposureCard = { key: string; title: string; rows: StatCardRow[] }

/** 负价电量暴露卡：暴露电量、占比、负价时段数（条数单列，不并进参考价）。 */
const captureExposureCards = computed<ExposureCard[]>(() => {
  const result = viewStates.capture.result
  if (!result) return []
  const metrics = metricIndexOf(result)
  return captureCatalogOf(result).map((entry) => {
    const own = metrics.get(entry.seriesId)
    return {
      key: entry.seriesId,
      title: `${captureLabelOf(entry)} · 负价电量暴露`,
      rows: [
        { label: metricLabelOf('plant.negative-price-energy'), text: metricTextOf('plant.negative-price-energy', own?.get('plant.negative-price-energy')?.value), unit: metricUnitOf('plant.negative-price-energy'), note: '' },
        { label: metricLabelOf('price.negative-energy-ratio'), text: metricTextOf('price.negative-energy-ratio', own?.get('price.negative-energy-ratio')?.value), unit: metricUnitOf('price.negative-energy-ratio'), note: '' },
        { label: '负价时段数', text: entry.negativeEnergySlots === undefined ? '—' : String(entry.negativeEnergySlots), unit: '', note: '负电量时段不进捕获价、按条数单列' },
      ],
    }
  })
})

/** 小时分桶图：该小时配对时段的电量加权均价（后端 tables.distribution 原样成柱）。 */
const captureDistributionOption = computed<Record<string, unknown>>(() => {
  const result = viewStates.capture.result
  const distribution = dataOf(result).tables?.distribution?.rows ?? []
  const rows = distribution as unknown as MetricRow[]
  if (!rows.length) return { series: [] }
  const hours = [...new Set(rows.map((row) => row.timeOfDay ?? ''))].filter(Boolean).sort()
  const labels = new Map(captureCatalogOf(result).map((entry) => [entry.seriesId, captureLabelOf(entry)]))
  const bySeries = new Map<string, Map<string, string | null>>()
  for (const row of rows) {
    const own = bySeries.get(row.seriesId) ?? new Map<string, string | null>()
    own.set(row.timeOfDay ?? '', row.value)
    bySeries.set(row.seriesId, own)
  }
  const series = captureCatalogOf(result)
    .filter((entry) => bySeries.has(entry.seriesId))
    .map((entry) => ({
      name: labels.get(entry.seriesId) ?? '捕获参考价',
      type: 'bar',
      data: hours.map((hour) => {
        const value = bySeries.get(entry.seriesId)?.get(hour)
        return value === null || value === undefined ? null : Number(value)
      }),
    }))
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 64, right: 24, top: 36, bottom: 48 },
    xAxis: { type: 'category', data: hours, name: '时刻' },
    yAxis: { type: 'value', name: 'yuan/MWh' },
    series,
  }
})

const captureDenominatorNote = computed(() => dataOf(viewStates.capture.result).coverage?.denominatorNote ?? '')
const captureNotes = computed(() => notesOf(viewStates.capture.result))
const captureUnpaired = computed(() => (dataOf(viewStates.capture.result).unpaired ?? []).map((item) => item.reason))
const captureUnavailable = computed(() => (dataOf(viewStates.capture.result).unavailableMetrics ?? []).map((item) => item.reason))

/** 捕获价无效的逐条说明（配对时段电量为零或没有共同有效时段等）。 */
const captureInvalidReasons = computed<string[]>(() => {
  const result = viewStates.capture.result
  if (!result) return []
  const metrics = metricIndexOf(result)
  return captureCatalogOf(result)
    .filter((entry) => metrics.get(entry.seriesId)?.get('plant.capture-price')?.value == null && entry.captureUnavailableReason)
    .map((entry) => `${captureLabelOf(entry)}：${entry.captureUnavailableReason}`)
})

// ── 预测执行：供应商比较分组表 + 共同样本均值极值 ─────────────────────────────────────────

type PlantCurveEntry = { seriesId: string; kind?: string; groupId?: string; objectId?: string; unitName?: string | null; dataType?: string; unit?: string }
type CompareGroup = {
  groupId: string
  objectId?: string
  unitName?: string | null
  members?: Array<{ seriesId: string; dataType?: string; validSamples?: number }>
  commonSlots?: number
  singleSource?: boolean
  comparable?: boolean
  note?: string
}

/** 组状态说明：单源换成业务话术（后端单源原文含内部记号，不透出）；其余按后端原文。 */
function compareStatusOf(group: CompareGroup): string {
  if (group.singleSource) return '单源：只有一个供应商/预测源，没有可比较对象'
  return group.note ?? ''
}

type CompareMemberRow = { key: string; objectId: string; family: string; dataType: string; validCount: string; coveredDays: string; commonSlots: string; status: string }

const compareMemberRows = computed<CompareMemberRow[]>(() => {
  const result = viewStates['supplier-comparison'].result
  const data = dataOf(result)
  if (!result) return []
  const metrics = metricIndexOf(result)
  const rows: CompareMemberRow[] = []
  for (const group of (data.groups ?? []) as CompareGroup[]) {
    const family = group.unitName ? String(group.unitName) : '全场站'
    for (const member of group.members ?? []) {
      const own = metrics.get(member.seriesId)
      rows.push({
        key: `${group.groupId}|${member.seriesId}`,
        objectId: String(group.objectId ?? '—'),
        family,
        dataType: String(member.dataType ?? '—'),
        validCount: metricTextOf('sample.valid-count', own?.get('sample.valid-count')?.value),
        coveredDays: metricTextOf('sample.covered-days', own?.get('sample.covered-days')?.value),
        commonSlots: String(group.commonSlots ?? 0),
        status: compareStatusOf(group),
      })
    }
  }
  return rows
})

type CompareStatRow = { key: string; objectId: string; dataType: string; commonHours: string; mean: string; min: string; minAt: string; max: string; maxAt: string }

/** 共同样本均值与极值：只在可比（comparable）分组给出（后端保证），单源/不足组不出现。 */
const compareStatsRows = computed<CompareStatRow[]>(() => {
  const result = viewStates['supplier-comparison'].result
  const data = dataOf(result)
  if (!result) return []
  const common = (data.tables?.common?.rows ?? []) as unknown as MetricRow[]
  if (!common.length) return []
  const groupOf = new Map<string, CompareGroup>()
  for (const group of (data.groups ?? []) as CompareGroup[]) groupOf.set(group.groupId, group)
  const catalog = new Map<string, PlantCurveEntry>()
  for (const meta of (data.series ?? []) as PlantCurveEntry[]) catalog.set(meta.seriesId, meta)
  const groupHours = new Map<string, string>()
  const perMember = new Map<string, Map<string, MetricRow>>()
  for (const row of common) {
    if (row.metricId === 'sample.common-hours') {
      groupHours.set(row.groupId ?? row.seriesId, row.value ?? '—')
      continue
    }
    const own = perMember.get(row.seriesId) ?? new Map<string, MetricRow>()
    own.set(row.metricId, row)
    perMember.set(row.seriesId, own)
  }
  const rows: CompareStatRow[] = []
  for (const [seriesId, own] of perMember) {
    const meta = catalog.get(seriesId)
    const group = meta?.groupId ? groupOf.get(meta.groupId) : undefined
    const minRow = own.get('supply.minimum')
    const maxRow = own.get('supply.maximum')
    rows.push({
      key: `${meta?.groupId ?? ''}|${seriesId}`,
      objectId: String(group?.objectId ?? meta?.objectId ?? '—'),
      dataType: String(meta?.dataType ?? '—'),
      commonHours: metricTextOf('sample.common-hours', groupHours.get(meta?.groupId ?? '') ?? null),
      mean: metricTextOf('supply.mean-power', own.get('supply.mean-power')?.value),
      min: metricTextOf('supply.minimum', minRow?.value),
      minAt: minRow?.atIntervalStart ? `${formatBeijingDateTime(minRow.atIntervalStart)} 出现` : '',
      max: metricTextOf('supply.maximum', maxRow?.value),
      maxAt: maxRow?.atIntervalStart ? `${formatBeijingDateTime(maxRow.atIntervalStart)} 出现` : '',
    })
  }
  return rows
})

const comparisonNotes = computed(() => notesOf(viewStates['supplier-comparison'].result))

// ── 申报出清实际：语义对照表（列固定、语义随列说明，null 显示「—」）──────────────────────

type SemanticColumn = { id: string; label?: string; semantic?: string; sourceId?: string }
type SemanticRow = { objectId: string; date: string; cells: Record<string, string> }

const semanticsColumns = computed<SemanticColumn[]>(() => {
  const columns = dataOf(viewStates.semantics.result).tables?.semantics?.columns ?? []
  return columns as SemanticColumn[]
})

const semanticsRows = computed<SemanticRow[]>(() => {
  const wide = (dataOf(viewStates.semantics.result).tables?.semantics?.rows ?? []) as Array<Record<string, unknown>>
  return wide.map((row) => {
    const cells: Record<string, string> = {}
    for (const column of semanticsColumns.value) {
      const value = row[column.id]
      cells[column.id] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return { objectId: String(row.objectId ?? '—'), date: String(row.date ?? '—'), cells }
  })
})

const semanticsDenominatorNote = computed(() => dataOf(viewStates.semantics.result).coverage?.denominatorNote ?? '')
const semanticsNotes = computed(() => notesOf(viewStates.semantics.result))
const semanticsExcluded = computed(() => (dataOf(viewStates.semantics.result).excluded ?? []).map((item) => item.reason))

// ── 结算表现：正式/暂结对照、量费加权统计、损失解释、单据记录与核对（ST01—ST06）────────────

type StatusDiffColumn = { id: string; label?: string; sourceId?: string }
type StatusDiffWideRow = Record<string, unknown>

/** 正式/暂结对照宽表：列与行取后端 tables.diff 原样（差异列只由后端在两态都在时给出）。 */
const statusDiffColumns = computed<StatusDiffColumn[]>(
  () => (dataOf(viewStates['settlement-status-diff'].result).tables?.diff?.columns ?? []) as StatusDiffColumn[]
)
const statusDiffRows = computed<Array<{ key: string; objectId: string; date: string; cells: Record<string, string> }>>(() => {
  const rows = (dataOf(viewStates['settlement-status-diff'].result).tables?.diff?.rows ?? []) as StatusDiffWideRow[]
  return rows.map((row, index) => {
    const cells: Record<string, string> = {}
    for (const column of statusDiffColumns.value) {
      const value = row[column.id]
      cells[column.id] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return { key: `${String(row.objectId ?? '')}|${String(row.date ?? '')}|${index}`, objectId: String(row.objectId ?? '—'), date: String(row.date ?? '—'), cells }
  })
})
const statusDiffNotes = computed(() => notesOf(viewStates['settlement-status-diff'].result))

/** 分时结算统计卡的状态标签：正式/暂结按来源分列（界面只出现业务语言，不透出来源标识）。 */
function settlementStatusLabelOf(sourceId: string): string {
  return sourceId.endsWith('-temp') ? '暂结' : '正式'
}

const SETTLEMENT_STAT_METRICS = [
  'settlement.total-energy',
  'settlement.total-fee',
  'settlement.weighted-average-price',
  'settlement.paired-count',
  'settlement.missing-fee-count',
  'settlement.missing-energy-count',
] as const

type StatsEntry = { seriesId: string; kind?: string; sourceId?: string; objectId?: string | null; averagePriceUnavailableReason?: string }

type StatsCard = { key: string; title: string; unavailableReason: string; rows: StatCardRow[] }

/** 合计卡：同一有效记录集合的 Σ电费/Σ电量（量费加权），按正式/暂结分卡、不相加。 */
const settlementStatsCards = computed<StatsCard[]>(() => {
  const result = viewStates['settlement-stats'].result
  if (!result) return []
  const metrics = metricIndexOf(result)
  return ((dataOf(result).series ?? []) as StatsEntry[])
    .filter((entry) => entry.kind === 'settlement-stats-total')
    .map((entry) => {
      const own = metrics.get(entry.seriesId)
      const rows = SETTLEMENT_STAT_METRICS.map((metricId) => ({
        label: metricLabelOf(metricId),
        text: metricTextOf(metricId, own?.get(metricId)?.value),
        unit: metricUnitOf(metricId),
        note: metricId === 'settlement.weighted-average-price' ? '成对有效记录 Σ电费/Σ电量' : '',
      }))
      return {
        key: entry.seriesId,
        title: `${settlementStatusLabelOf(String(entry.sourceId ?? ''))} · 所选记录合计`,
        unavailableReason: entry.averagePriceUnavailableReason ?? '',
        rows,
      }
    })
})

type StatsObjectRow = {
  key: string
  objectId: string
  status: string
  totalEnergy: string
  totalFee: string
  averagePrice: string
  pairedCount: string
  missingFee: string
  missingEnergy: string
}

/** 逐对象统计行：正式/暂结各自成行，同场站两态并排、不相加。 */
const settlementStatsObjectRows = computed<StatsObjectRow[]>(() => {
  const result = viewStates['settlement-stats'].result
  if (!result) return []
  const metrics = metricIndexOf(result)
  return ((dataOf(result).series ?? []) as StatsEntry[])
    .filter((entry) => entry.kind === 'settlement-stats')
    .map((entry) => {
      const own = metrics.get(entry.seriesId)
      const textOf = (metricId: string) => metricTextOf(metricId, own?.get(metricId)?.value)
      return {
        key: entry.seriesId,
        objectId: String(entry.objectId ?? '—'),
        status: settlementStatusLabelOf(String(entry.sourceId ?? '')),
        totalEnergy: textOf('settlement.total-energy'),
        totalFee: textOf('settlement.total-fee'),
        averagePrice: textOf('settlement.weighted-average-price'),
        pairedCount: textOf('settlement.paired-count'),
        missingFee: textOf('settlement.missing-fee-count'),
        missingEnergy: textOf('settlement.missing-energy-count'),
      }
    })
})

const settlementStatsNotes = computed(() => notesOf(viewStates['settlement-stats'].result))

type LossWideRow = Record<string, unknown>
type LossColumn = { id: string; label: string; note?: string }

/** 损失解释表列：未解释差额列头自带「不是损失认定」边界。 */
const LOSS_COLUMNS: LossColumn[] = [
  { id: 'revenueYuan', label: '结算电费（源收入）' },
  { id: 'strategyLossYuan', label: '策略损失（源系统披露）' },
  { id: 'forecastLossYuan', label: '预测损失（源系统披露）' },
  { id: 'gridLossYuan', label: '电网损失（源系统披露）' },
  { id: 'unexplainedDifferenceYuan', label: '未解释差额（不是损失认定）' },
]

const lossGridNote = computed(() => (dataOf(viewStates['settlement-loss'].result).gridLoss?.note ?? ''))
const lossGridProvided = computed(() => dataOf(viewStates['settlement-loss'].result).gridLoss?.provided === true)
const lossWaterfallNote = computed(() => (dataOf(viewStates['settlement-loss'].result).waterfall?.note ?? ''))
const lossWaterfallComplete = computed(() => dataOf(viewStates['settlement-loss'].result).waterfall?.complete === true)

const lossRows = computed<Array<{ key: string; objectId: string; date: string; cells: Record<string, string> }>>(() => {
  const rows = (dataOf(viewStates['settlement-loss'].result).tables?.losses?.rows ?? []) as LossWideRow[]
  return rows.map((row, index) => {
    const cells: Record<string, string> = {}
    for (const column of LOSS_COLUMNS) {
      const value = row[column.id]
      cells[column.id] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return { key: `${String(row.objectId ?? '')}|${String(row.date ?? '')}|${index}`, objectId: String(row.objectId ?? '—'), date: String(row.date ?? '—'), cells }
  })
})

const lossNotes = computed(() => notesOf(viewStates['settlement-loss'].result))

/** 单据记录表：列=记录维度并集（保持出现顺序），来源借业务标题，值与日期按原文。 */
type DocsRecordRow = { key: string; date: string; source: string; cells: Record<string, string>; value: string }

/** 记录维度 → 业务名（登记见 shared/insight/sources.mjs；未登记的键回退原文）。 */
const DOCS_DIMENSION_TEXT: Record<string, string> = {
  plant_name: '场站',
  电厂名: '场站',
  name: '场站',
  bill_type: '单据类型',
  settle_month: '账期月',
  settlemonth: '账期月',
  company_name: '交易相对方',
  file_name: '文件名',
  file_ext: '文件格式',
  sheet_name: '工作表',
  row_index: '行号',
  col_index: '列号',
  type: '记录类型',
  result_type: '结算状态',
  pdfstatus: '原件状态',
}

function docsDimensionText(key: string): string {
  return DOCS_DIMENSION_TEXT[key] ?? key
}

const docsColumns = computed<string[]>(() => {
  const rows = (viewStates['settlement-docs'].result?.data?.rows ?? []) as Array<Record<string, unknown>>
  const keys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === 'sourceId' || key === 'date' || key === 'value') continue
      if (!keys.includes(key)) keys.push(key)
    }
  }
  return keys
})

const docsRows = computed<DocsRecordRow[]>(() => {
  const result = viewStates['settlement-docs'].result
  if (!result?.data) return []
  return ((result.data.rows ?? []) as Array<Record<string, unknown>>).map((row, index) => {
    const cells: Record<string, string> = {}
    for (const key of docsColumns.value) {
      const value = row[key]
      cells[key] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return {
      key: `${String(row.sourceId ?? '')}|${String(row.date ?? '')}|${docsColumns.value.map((key) => cells[key]).join('|')}|${index}`,
      date: String(row.date ?? ''),
      source: insightSourceTitle(String(row.sourceId ?? ''), sourceTitles.value)?.title ?? '—',
      cells,
      value: row.value === null || row.value === undefined || row.value === '' ? '—' : String(row.value),
    }
  })
})

type ReconcileDailyRow = { key: string; objectId: string; date: string; cells: Record<string, string>; missingText: string; qualityText: string }

/** 核对日报/日结（同周期日）：缺失一侧显示「—」并说明缺哪侧；质量剔除逐行标注。 */
function reconcileMissingTextOf(missingSide: unknown): string {
  if (missingSide === 'daily-report') return '缺日报收入（该侧本窗口无资料）'
  if (missingSide === 'settlement-daily') return '缺日结电费（该侧本窗口无资料）'
  return ''
}

function reconcileQualityTextOf(quality: unknown): string {
  if (quality === 'excluded-missing-flagged') return '质量剔除：日报缺测说明标缺「结算收入」'
  if (quality === 'missing') return '缺日报'
  return ''
}

const reconcileDailyRows = computed<ReconcileDailyRow[]>(() => {
  const rows = (dataOf(viewStates['settlement-reconcile'].result).tables?.daily?.rows ?? []) as Array<Record<string, unknown>>
  const cellIds = ['dailyReportRevenueYuan', 'settlementDailyFeeYuan', 'differenceYuan']
  return rows.map((row, index) => {
    const cells: Record<string, string> = {}
    for (const id of cellIds) {
      const value = row[id]
      cells[id] = value === null || value === undefined || value === '' ? '—' : String(value)
    }
    return {
      key: `${String(row.objectId ?? '')}|${String(row.date ?? '')}|${index}`,
      objectId: String(row.objectId ?? '—'),
      date: String(row.date ?? '—'),
      cells,
      missingText: reconcileMissingTextOf(row.missingSide),
      qualityText: reconcileQualityTextOf(row.dailyReportQuality),
    }
  })
})

type ReconcileMonthlyRow = { key: string; objectId: string; settleMonth: string; fee: string }

const reconcileMonthlyRows = computed<ReconcileMonthlyRow[]>(() => {
  const rows = (dataOf(viewStates['settlement-reconcile'].result).tables?.monthly?.rows ?? []) as Array<Record<string, unknown>>
  return rows.map((row, index) => ({
    key: `${String(row.objectId ?? '')}|${String(row.settleMonth ?? '')}|${index}`,
    objectId: String(row.objectId ?? '—'),
    settleMonth: String(row.settleMonth ?? '—'),
    fee: row.monthlyFeeYuan === null || row.monthlyFeeYuan === undefined || row.monthlyFeeYuan === '' ? '—' : String(row.monthlyFeeYuan),
  }))
})

const reconcileQualityExcluded = computed(() =>
  ((dataOf(viewStates['settlement-reconcile'].result).qualityExcluded ?? []) as Array<{ reason?: string }>).map((item) => item.reason ?? '').filter(Boolean)
)
const reconcileNotes = computed(() => notesOf(viewStates['settlement-reconcile'].result))

/** 月结缺失说明（后端约定由页面按窗口月份给出）：所选日结组对象里本窗口月份没有月结行的，如实列出。 */
const reconcileMonthlyMissingText = computed(() => {
  if (!settlementObjects.value.length) return ''
  const present = new Set(reconcileMonthlyRows.value.map((row) => row.objectId))
  const missing = settlementObjects.value.filter((objectId) => !present.has(objectId))
  if (!missing.length) return ''
  const month = ctx.businessWindow.value.start.slice(0, 7)
  return `「${missing.join('、')}」在 ${month} 没有月结记录：月结按月周期单独展示，缺失如实说明，不拿日值凑月份。`
})


// ── 业务模块只读深链（dljy#3096，任务 15.5，design D11 / CH04 / PP07）────────────────────
// 洞察只传证据引用（期间/对象名）与授权入口：显隐经 governance 既有口径判定（无权限不渲染），
// 跳转是查看不是操作——不自动创建/提交任何单据，不更改合同与电费（写入只在目标业务模块）。

const router = useRouter()

/** 结算业务入口：复盘中心（结算复盘、日报核验）对当前账号可访问才显示。 */
const canOpenSettlement = computed(() => canFollowDeepLink(DEEP_LINK_TARGETS.settlementReview))
/** 中长期模块入口：月度持仓（只读台账）对当前账号可访问才显示。 */
const canOpenMidlong = computed(() => canFollowDeepLink(DEEP_LINK_TARGETS.midlongPositions))
/** 资料维护入口：上传中心沿数据运维岗的既有权限（admin-only），原权限决定是否可维护。 */
const canMaintainData = computed(() => canFollowDeepLink(DEEP_LINK_TARGETS.dataMaintenance))

/** 语义对照出现「中长期电量（合同口径引用）」列时才给中长期入口：引用在场，入口才有意义。 */
const hasMidlongReference = computed(() =>
  semanticsColumns.value.some((column) => column.id === 'midlongContractReference')
)

/** 前往结算业务：携带期间与对象名（非敏感 ID）+ from 标记；不创建/提交任何单据。 */
function openSettlementBusiness(): void {
  openBusinessDeepLink(router, {
    path: DEEP_LINK_TARGETS.settlementReview,
    query: businessDeepLinkQuery({
      window: ctx.businessWindow.value,
      from: 'insight-plants',
      objectId: overviewObjects.value[0] ?? null,
    }),
  })
}

/** 前往中长期模块：同上，只带期间与对象名；合同维护、成交等操作一律留在目标模块。 */
function openMidlongModule(): void {
  openBusinessDeepLink(router, {
    path: DEEP_LINK_TARGETS.midlongPositions,
    query: businessDeepLinkQuery({
      window: ctx.businessWindow.value,
      from: 'insight-plants',
      objectId: clearingObjects.value[0] ?? null,
    }),
  })
}

/** 前往资料维护：跳上传中心面板，携带缺口期间与 from 标记；返回后由 contextVersion 机制重查。 */
function openDataMaintenance(): void {
  openDataMaintenanceLink(router, { window: ctx.businessWindow.value, from: 'insight-plants' })
}

// ── 证据抽屉与历史候选 ───────────────────────────────────────────────────────────────────

const evidenceVisible = ref(false)
const evidenceTarget = ref<InsightBlockResult | null>(null)

function openEvidence(name: QueryName): void {
  evidenceTarget.value = viewStates[name].result
  evidenceVisible.value = true
}

const candidatesVisible = ref(false)

function openCandidates(): void {
  candidatesVisible.value = true
}

function onCandidateSelect(range: { start: string; end: string }): void {
  ctx.setBusinessWindow(range.start, range.end)
}

/** 历史候选：场站出力曲线分析（获权账号才可达本页区块）；候选只按来源覆盖求交集。 */
const candidatesFilters = computed<Record<string, unknown>>(() => ({ view: 'series' }))

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 只收「当前签名一致」的已就绪查询结果，过期区块不进上下文；只传摘要与版本引用
// （含场站对象组等筛选摘要），不传原始行数据。

const PLANTS_AI_BLOCKS: Record<QueryName, { title: string; analysisId: string; view?: string }> = {
  'overview-coverage': { title: '组合覆盖摘要', analysisId: PLANTS_DAILY_METRICS, view: 'coverage-summary' },
  'settlement-daily': { title: '场站日结算', analysisId: PLANTS_SETTLEMENT_DAILY },
  capture: { title: '价格捕获', analysisId: PLANTS_PRICE_CAPTURE, view: 'capture' },
  'output-series': { title: '出力曲线', analysisId: PLANTS_OUTPUT_SERIES, view: 'series' },
  'supplier-comparison': { title: '报价供应商比较', analysisId: PLANTS_OUTPUT_SERIES, view: 'supplier-comparison' },
  semantics: { title: '申报语义对照', analysisId: PLANTS_CLEARING_ACTUAL, view: 'semantics' },
  'business-forecast': { title: '业务预测', analysisId: PLANTS_BUSINESS_FORECAST },
  'settlement-formal': { title: '正式结算明细', analysisId: PLANTS_SETTLEMENT_DAILY, view: 'series' },
  'settlement-status-diff': { title: '正式/暂结状态对照', analysisId: PLANTS_SETTLEMENT_STATUS_DIFF, view: 'status-diff' },
  'settlement-stats': { title: '量费加权统计', analysisId: PLANTS_SETTLEMENT_INTERVAL, view: 'settlement-stats' },
  'settlement-loss': { title: '损失解释', analysisId: PLANTS_SETTLEMENT_DAILY, view: 'loss-explain' },
  'settlement-docs': { title: '结算单据', analysisId: PLANTS_SETTLEMENT_DOCS, view: 'records' },
  'settlement-reconcile': { title: '周期核对', analysisId: PLANTS_SETTLEMENT_RECONCILE, view: 'reconcile' },
}

const insightAi = useInsightAiPage({
  pageId: 'plants',
  label: '云南场站表现',
  collect: () => {
    const blocks: InsightAiEvidenceBlock[] = []
    for (const name of Object.keys(viewStates) as QueryName[]) {
      const entry = viewStates[name]
      const block = PLANTS_AI_BLOCKS[name]
      const aiBlock = insightAiBlockOf({
        blockId: name,
        title: block.title,
        analysisId: block.analysisId,
        view: block.view ?? name,
        currentKey: queryKeyOf(name),
        queriedKey: entry.queriedKey,
        result: entry.result,
        objects:
          name === 'overview-coverage' || name === 'settlement-daily' ? [...overviewObjects.value]
          : name === 'capture' || name === 'output-series' ? [...captureObjects.value]
          : name === 'supplier-comparison' ? [...comparisonObjects.value]
          : name === 'semantics' || name === 'business-forecast' ? [...clearingObjects.value]
          : name === 'settlement-stats' ? [...intervalObjects.value]
          : name === 'settlement-formal' || name === 'settlement-status-diff' || name === 'settlement-loss' || name === 'settlement-reconcile' ? [...settlementObjects.value]
          : undefined,
      })
      if (aiBlock) blocks.push(aiBlock)
    }
    return blocks
  },
  currentSignature: () => String(ctx.contextVersion.value),
})

const onAiInterpret = (): void => {
  void insightAi.interpret()
}

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <div class="ypp">
    <!-- 顶部：日期窗与固定口径说明 -->
    <section class="ypp__controls">
      <label class="ypp__field">
        <span>业务日期窗</span>
        <InsightDateRange
          :model-value="ctx.businessWindow.value"
          :max-days="maxDays"
          @update:model-value="onWindowChange"
        />
      </label>
      <!-- AI 入口（15.3）：模型离线只隐藏入口，数据页不受影响（D9） -->
      <el-button
        v-if="insightAi.aiAvailable.value"
        type="primary"
        data-testid="ypp-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
    </section>

    <p class="ypp__meta">{{ STAGE_TEXT }}</p>

    <el-alert v-if="capabilitiesError" type="error" show-icon :closable="false" title="能力目录读取失败">
      <p class="ypp__hint">当前看不到可用的场站分析；可重试，不影响已就绪区块的展示。</p>
      <el-button size="small" :loading="capabilitiesLoading" @click="loadCapabilities">重试</el-button>
    </el-alert>

    <!-- 五页签：懒加载（首次激活渲染），签名不变时切回不重查；结算页签按获权分析与对象选择编排查询 -->
    <el-tabs :model-value="activeTab" class="ypp__tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in PLANTS_TABS" :key="tab.view" :name="tab.view" :label="tab.label">
        <template v-if="visitedTabs.has(tab.view)">
          <!-- 组合总览：六字段独立覆盖卡片 + 正式日结明细（可选加） -->
          <template v-if="tab.view === 'overview'">
            <el-alert
              v-if="!hasDailyMetrics && !hasSettlementDaily"
              type="info"
              :closable="false"
              :title="ENTITLEMENT_OVERVIEW_TEXT"
              data-testid="ypp-overview-entitlement"
            />
            <template v-if="hasDailyMetrics || hasSettlementDaily">
              <div class="ypp__bar">
                <label class="ypp__field">
                  <span>场站对象（多选，最多 {{ dailyMetricsDef?.limits.maxObjects ?? 200 }} 个）</span>
                  <InsightObjectPicker
                    :model-value="overviewObjects"
                    :options="optionsOf(PLANTS_DAILY_METRICS)"
                    :max-objects="dailyMetricsDef?.limits.maxObjects ?? 200"
                    requires-objects
                    :disabled="objectsPhase(PLANTS_DAILY_METRICS) !== 'ready'"
                    data-testid="ypp-overview-objects"
                    @update:model-value="onOverviewObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(PLANTS_DAILY_METRICS) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(PLANTS_DAILY_METRICS)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(PLANTS_DAILY_METRICS) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
                data-testid="ypp-objects-unavailable"
              />
              <el-alert v-else-if="objectsPhase(PLANTS_DAILY_METRICS) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <p v-if="objectStates[PLANTS_DAILY_METRICS].note" class="ypp__hint">{{ objectStates[PLANTS_DAILY_METRICS].note }}</p>
            </template>

            <InsightBlock
              v-if="hasDailyMetrics"
              title="组合覆盖摘要（获权）"
              :result="viewStates['overview-coverage'].result"
              :error="viewStates['overview-coverage'].error"
              :loading="viewStates['overview-coverage'].loading"
              :on-retry="() => retryQuery('overview-coverage')"
              :on-refresh="() => retryQuery('overview-coverage')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('overview-coverage')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" :title="COVERAGE_FIELDS_TEXT" />
              <el-empty v-if="!overviewObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <template v-else>
                <el-alert v-if="overviewDenominatorNote" type="info" :closable="false" :title="overviewDenominatorNote" data-testid="ypp-denominator-note" />
                <div class="ypp__cards">
                  <div v-for="card in overviewCoverageCards" :key="card.key" class="ypp__card" :data-testid="`ypp-field-card-${card.key}`">
                    <h4 class="ypp__card-title">{{ card.title }}</h4>
                    <div v-for="row in card.rows" :key="row.objectId" class="ypp__card-row">
                      <span class="ypp__card-object">{{ row.objectId }}</span>
                      <span class="ypp__card-value">有效样本 {{ row.validCount }} 个 · 覆盖 {{ row.coveredDays }} 天</span>
                    </div>
                  </div>
                </div>
                <el-alert v-for="(note, index) in overviewNotes" :key="`on-${index}`" type="info" :closable="false" :title="note" />
              </template>
            </InsightBlock>

            <InsightBlock
              v-if="hasSettlementDaily"
              title="正式日结明细（获权）"
              :result="viewStates['settlement-daily'].result"
              :error="viewStates['settlement-daily'].error"
              :loading="viewStates['settlement-daily'].loading"
              :on-retry="() => retryQuery('settlement-daily')"
              :on-refresh="() => retryQuery('settlement-daily')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('settlement-daily')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" title="正式日结口径：现有读模型只含正式日结，暂结走结算原件通道单独读取，不混进正式口径" />
              <el-empty v-if="!overviewObjects.length" :description="FOLLOW_OVERVIEW_TEXT" :image-size="72" />
              <InsightResultTable
                v-else
                :result="viewStates['settlement-daily'].result"
                :selection="null"
                :source-titles="sourceTitles"
                @row-click="() => {}"
              />
            </InsightBlock>
          </template>

          <!-- 价格出力：捕获参考价（获权）+ 出力曲线（共用对象选择、并列对照） -->
          <template v-else-if="tab.view === 'price-output'">
            <el-alert v-if="!hasPriceCapture && !hasOutputSeries" type="info" :closable="false" :title="ENTITLEMENT_PRICE_TEXT" data-testid="ypp-price-entitlement" />
            <template v-if="hasPriceCapture || hasOutputSeries">
              <div class="ypp__bar">
                <label class="ypp__field">
                  <span>场站对象（多选，最多 {{ (hasPriceCapture ? priceCaptureDef : outputSeriesDef)?.limits.maxObjects ?? 50 }} 个）</span>
                  <InsightObjectPicker
                    :model-value="captureObjects"
                    :options="optionsOf(priceTabOwner)"
                    :max-objects="(hasPriceCapture ? priceCaptureDef : outputSeriesDef)?.limits.maxObjects ?? 50"
                    requires-objects
                    :disabled="objectsPhase(priceTabOwner) !== 'ready'"
                    data-testid="ypp-price-objects"
                    @update:model-value="onCaptureObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(priceTabOwner) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(priceTabOwner)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(priceTabOwner) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
              />
              <el-alert v-else-if="objectsPhase(priceTabOwner) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <p v-if="objectStates[priceTabOwner].note" class="ypp__hint">{{ objectStates[priceTabOwner].note }}</p>
            </template>

            <InsightBlock
              v-if="hasPriceCapture"
              title="价格捕获参考（获权）"
              :result="viewStates.capture.result"
              :error="viewStates.capture.error"
              :loading="viewStates.capture.loading"
              :on-retry="() => retryQuery('capture')"
              :on-refresh="() => retryQuery('capture')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('capture')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" :title="CAPTURE_TEXT" />
              <el-alert type="info" :closable="false" :title="PRODUCT_TEXT" />
              <el-empty v-if="!captureObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <template v-else>
                <el-alert v-if="captureDenominatorNote" type="info" :closable="false" :title="captureDenominatorNote" />
                <el-table v-if="captureTableRows.length" :data="captureTableRows" size="small" border max-height="360" data-testid="ypp-capture-table">
                  <el-table-column prop="objectId" label="场站" min-width="140" show-overflow-tooltip />
                  <el-table-column prop="node" label="节点" min-width="140" show-overflow-tooltip />
                  <el-table-column prop="capturePrice" label="价格捕获参考价（yuan/MWh）" width="180" align="right" />
                  <el-table-column prop="pairedEnergy" label="配对电量（MWh）" width="140" align="right" />
                  <el-table-column prop="product" label="节点量价参考乘积（元）" width="160" align="right" />
                  <el-table-column prop="validCount" label="有效样本数" width="100" align="right" />
                </el-table>
                <el-alert
                  v-for="(item, index) in captureInvalidReasons"
                  :key="`ci-${index}`"
                  type="warning"
                  :closable="false"
                  :title="item"
                />
                <div v-if="captureExposureCards.length" class="ypp__cards" data-testid="ypp-negative-cards">
                  <div v-for="card in captureExposureCards" :key="card.key" class="ypp__card">
                    <h4 class="ypp__card-title">{{ card.title }}</h4>
                    <dl class="ypp__card-grid">
                      <template v-for="row in card.rows" :key="row.label">
                        <dt>{{ row.label }}</dt>
                        <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                      </template>
                    </dl>
                  </div>
                </div>
                <ChartCard title="捕获参考价小时分桶（该小时电量加权均价）" :height="300" :build-option="() => captureDistributionOption" />
                <el-alert
                  v-for="(item, index) in captureUnpaired"
                  :key="`cu-${index}`"
                  type="warning"
                  :closable="false"
                  :title="`未配对：${item}`"
                />
                <el-alert v-for="(item, index) in captureUnavailable" :key="`ce-${index}`" type="info" :closable="false" :title="item" />
                <el-alert v-for="(note, index) in captureNotes" :key="`cn-${index}`" type="info" :closable="false" :title="note" />
              </template>
            </InsightBlock>

            <InsightBlock
              v-if="hasOutputSeries"
              title="场站出力曲线（获权）"
              :result="viewStates['output-series'].result"
              :error="viewStates['output-series'].error"
              :loading="viewStates['output-series'].loading"
              :on-retry="() => retryQuery('output-series')"
              :on-refresh="() => retryQuery('output-series')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('output-series')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" :title="LINKAGE_TEXT" />
              <p class="ypp__hint">{{ FOLLOW_PRICE_TEXT }}</p>
              <el-empty v-if="!captureObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <template v-else>
                <InsightSeriesChart
                  :result="viewStates['output-series'].result"
                  :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                  :height="300"
                  @select="() => {}"
                />
                <InsightResultTable
                  :result="viewStates['output-series'].result"
                  :selection="null"
                  :source-titles="sourceTitles"
                  @row-click="() => {}"
                />
              </template>
            </InsightBlock>
          </template>

          <!-- 预测执行：供应商比较（共同样本不足只并列展示） -->
          <template v-else-if="tab.view === 'forecast'">
            <el-alert v-if="!hasOutputSeries" type="info" :closable="false" :title="ENTITLEMENT_FORECAST_TEXT" data-testid="ypp-forecast-entitlement" />
            <template v-if="hasOutputSeries">
              <div class="ypp__bar">
                <label class="ypp__field">
                  <span>场站对象（多选，最多 {{ outputSeriesDef?.limits.maxObjects ?? 50 }} 个）</span>
                  <InsightObjectPicker
                    :model-value="comparisonObjects"
                    :options="optionsOf(PLANTS_OUTPUT_SERIES)"
                    :max-objects="outputSeriesDef?.limits.maxObjects ?? 50"
                    requires-objects
                    :disabled="objectsPhase(PLANTS_OUTPUT_SERIES) !== 'ready'"
                    data-testid="ypp-forecast-objects"
                    @update:model-value="onComparisonObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(PLANTS_OUTPUT_SERIES) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(PLANTS_OUTPUT_SERIES)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(PLANTS_OUTPUT_SERIES) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
              />
              <el-alert v-else-if="objectsPhase(PLANTS_OUTPUT_SERIES) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <p v-if="objectStates[PLANTS_OUTPUT_SERIES].note" class="ypp__hint">{{ objectStates[PLANTS_OUTPUT_SERIES].note }}</p>
            </template>

            <InsightBlock
              v-if="hasOutputSeries"
              title="供应商比较（获权）"
              :result="viewStates['supplier-comparison'].result"
              :error="viewStates['supplier-comparison'].error"
              :loading="viewStates['supplier-comparison'].loading"
              :on-retry="() => retryQuery('supplier-comparison')"
              :on-refresh="() => retryQuery('supplier-comparison')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('supplier-comparison')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" :title="COMPARE_TEXT" />
              <el-alert type="info" :closable="false" :title="NIGHT_ZERO_TEXT" />
              <el-empty v-if="!comparisonObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <template v-else>
                <el-table v-if="compareMemberRows.length" :data="compareMemberRows" size="small" border max-height="420" data-testid="ypp-compare-table">
                  <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                  <el-table-column prop="family" label="曲线家族" min-width="110" show-overflow-tooltip />
                  <el-table-column prop="dataType" label="供应商/预测源" min-width="120" show-overflow-tooltip />
                  <el-table-column prop="validCount" label="有效样本数" width="100" align="right" />
                  <el-table-column prop="coveredDays" label="覆盖天数" width="90" align="right" />
                  <el-table-column prop="commonSlots" label="共同有效时段" width="110" align="right" />
                  <el-table-column prop="status" label="比较状态" min-width="220" show-overflow-tooltip />
                </el-table>
                <template v-if="compareStatsRows.length">
                  <h4 class="ypp__section-title">共同样本均值与极值（仅可比分组）</h4>
                  <el-table :data="compareStatsRows" size="small" border max-height="360" data-testid="ypp-common-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="dataType" label="供应商/预测源" min-width="120" show-overflow-tooltip />
                    <el-table-column prop="commonHours" label="共同有效时长（h）" width="140" align="right" />
                    <el-table-column prop="mean" label="平均功率（MW）" width="130" align="right" />
                    <el-table-column prop="min" label="最低（MW）" width="110" align="right" />
                    <el-table-column prop="minAt" label="最低出现" width="150" />
                    <el-table-column prop="max" label="最高（MW）" width="110" align="right" />
                    <el-table-column prop="maxAt" label="最高出现" width="150" />
                  </el-table>
                </template>
                <el-alert v-for="(note, index) in comparisonNotes" :key="`mn-${index}`" type="info" :closable="false" :title="note" />
              </template>
            </InsightBlock>
          </template>

          <!-- 申报出清实际：语义对照表（不相加不差值）+ 一体化预测曲线 -->
          <template v-else-if="tab.view === 'clearing'">
            <el-alert v-if="!hasClearingActual && !hasBusinessForecast" type="info" :closable="false" :title="ENTITLEMENT_CLEARING_TEXT" data-testid="ypp-clearing-entitlement" />
            <template v-if="hasClearingActual || hasBusinessForecast">
              <div class="ypp__bar">
                <label class="ypp__field">
                  <span>场站对象（多选，最多 {{ clearingDef?.limits.maxObjects ?? 50 }} 个）</span>
                  <InsightObjectPicker
                    :model-value="clearingObjects"
                    :options="optionsOf(PLANTS_CLEARING_ACTUAL)"
                    :max-objects="clearingDef?.limits.maxObjects ?? 50"
                    requires-objects
                    :disabled="objectsPhase(PLANTS_CLEARING_ACTUAL) !== 'ready'"
                    data-testid="ypp-clearing-objects"
                    @update:model-value="onClearingObjectsChange"
                  />
                </label>
              </div>
              <template v-if="objectsPhase(PLANTS_CLEARING_ACTUAL) === 'error'">
                <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                  <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                  <el-button size="small" @click="retryObjects(PLANTS_CLEARING_ACTUAL)">重试</el-button>
                </el-alert>
              </template>
              <el-alert
                v-else-if="objectsPhase(PLANTS_CLEARING_ACTUAL) === 'unavailable'"
                type="info"
                :closable="false"
                :title="OBJECTS_UNAVAILABLE_TEXT"
              />
              <el-alert v-else-if="objectsPhase(PLANTS_CLEARING_ACTUAL) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              <p v-if="objectStates[PLANTS_CLEARING_ACTUAL].note" class="ypp__hint">{{ objectStates[PLANTS_CLEARING_ACTUAL].note }}</p>
            </template>

            <InsightBlock
              v-if="hasClearingActual"
              title="申报出清实发对照（获权）"
              :result="viewStates.semantics.result"
              :error="viewStates.semantics.error"
              :loading="viewStates.semantics.loading"
              :on-retry="() => retryQuery('semantics')"
              :on-refresh="() => retryQuery('semantics')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('semantics')"
              @open-maintenance="openDataMaintenance"
            >
              <el-alert type="info" :closable="false" :title="SEMANTICS_TEXT" />
              <el-empty v-if="!clearingObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <template v-else>
                <el-alert v-if="semanticsDenominatorNote" type="info" :closable="false" :title="semanticsDenominatorNote" />
                <el-table v-if="semanticsRows.length" :data="semanticsRows" size="small" border max-height="420" data-testid="ypp-semantics-table">
                  <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                  <el-table-column prop="date" label="业务日" width="110" />
                  <el-table-column
                    v-for="column in semanticsColumns"
                    :key="column.id"
                    :prop="`cells.${column.id}`"
                    :label="column.label ?? '对照电量'"
                    min-width="130"
                    align="right"
                    show-overflow-tooltip
                  />
                </el-table>
                <ul class="ypp__legend">
                  <li v-for="column in semanticsColumns" :key="`lg-${column.id}`">{{ column.label }}：{{ column.semantic }}</li>
                </ul>
                <!-- 中长期引用在场时给只读深链入口（15.5）：跳月度持仓，维护留在目标模块 -->
                <div v-if="hasMidlongReference && canOpenMidlong" class="ypp__deeplink" data-testid="ypp-midlong-row">
                  <span class="ypp__hint">中长期电量是合同口径的只读引用；合同与持仓的维护在中长期模块办理。</span>
                  <el-button link type="primary" size="small" data-testid="ypp-open-midlong" @click="openMidlongModule">
                    前往中长期模块
                  </el-button>
                </div>
                <el-alert
                  v-for="(item, index) in semanticsExcluded"
                  :key="`se-${index}`"
                  type="warning"
                  :closable="false"
                  :title="`未纳入对照：${item}`"
                />
                <el-alert v-for="(note, index) in semanticsNotes" :key="`sn-${index}`" type="info" :closable="false" :title="note" />
              </template>
            </InsightBlock>

            <InsightBlock
              v-if="hasBusinessForecast"
              title="一体化预测出力（获权）"
              :result="viewStates['business-forecast'].result"
              :error="viewStates['business-forecast'].error"
              :loading="viewStates['business-forecast'].loading"
              :on-retry="() => retryQuery('business-forecast')"
              :on-refresh="() => retryQuery('business-forecast')"
              :source-titles="sourceTitles"
              :maintenance="canMaintainData"
              @open-candidates="openCandidates"
              @open-evidence="openEvidence('business-forecast')"
              @open-maintenance="openDataMaintenance"
            >
              <p class="ypp__hint">{{ FOLLOW_CLEARING_TEXT }}</p>
              <el-empty v-if="!clearingObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
              <InsightSeriesChart
                v-else
                :result="viewStates['business-forecast'].result"
                :current="{ regionId: ctx.regionId.value, companyId: ctx.companyId.value, contextVersion: ctx.contextVersion.value }"
                :height="300"
                @select="() => {}"
              />
            </InsightBlock>
          </template>

          <!-- 结算表现（ST01—ST06）：正式/暂结显式切换、量费加权统计、损失解释、单据记录与核对；「前往结算业务」为只读深链入口（15.5） -->
          <template v-else-if="tab.view === 'settlement'">
            <section class="ypp__settlement" data-testid="ypp-settlement-section">
              <p class="ypp__hint">结算确认与电费修正在结算/复盘业务模块办理；这里只提供获权查看入口，不创建或提交任何单据。</p>
            <el-alert
              v-if="!hasAnySettlement"
              type="info"
              :closable="false"
              :title="ENTITLEMENT_SETTLEMENT_TEXT"
              data-testid="ypp-settlement-entitlement"
            />
            <template v-if="hasAnySettlement">
              <el-alert type="info" :closable="false" :title="SETTLEMENT_STATUS_TEXT" />
              <div v-if="canOpenSettlement" class="ypp__bar" data-testid="ypp-settlement-entry-bar">
                <el-button link type="primary" size="small" data-testid="ypp-open-settlement" @click="openSettlementBusiness">前往结算业务</el-button>
              </div>
              <div v-if="hasSettlementDaily || hasStatusDiff || hasSettlementReconcile" class="ypp__bar">
                <label class="ypp__field">
                  <span>场站对象（多选，最多 {{ (hasStatusDiff ? statusDiffDef : settlementDailyDef)?.limits.maxObjects ?? 200 }} 个）</span>
                  <InsightObjectPicker
                    :model-value="settlementObjects"
                    :options="optionsOf(settlementCoverageOwner)"
                    :max-objects="(hasStatusDiff ? statusDiffDef : settlementDailyDef)?.limits.maxObjects ?? 200"
                    requires-objects
                    :disabled="objectsPhase(settlementCoverageOwner) !== 'ready'"
                    data-testid="ypp-settlement-objects"
                    @update:model-value="onSettlementObjectsChange"
                  />
                </label>
                <label class="ypp__field">
                  <span>结算状态（默认正式；暂结显式切换）</span>
                  <el-radio-group v-model="settlementStatusMode" data-testid="ypp-status-mode">
                    <el-radio-button value="formal">正式</el-radio-button>
                    <el-radio-button value="temp">暂结对照</el-radio-button>
                  </el-radio-group>
                </label>
              </div>
              <template v-if="hasSettlementDaily || hasStatusDiff || hasSettlementReconcile">
                <template v-if="objectsPhase(settlementCoverageOwner) === 'error'">
                  <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                    <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                    <el-button size="small" @click="retryObjects(settlementCoverageOwner)">重试</el-button>
                  </el-alert>
                </template>
                <el-alert
                  v-else-if="objectsPhase(settlementCoverageOwner) === 'unavailable'"
                  type="info"
                  :closable="false"
                  :title="OBJECTS_UNAVAILABLE_TEXT"
                />
                <el-alert v-else-if="objectsPhase(settlementCoverageOwner) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
                <p v-if="objectStates[settlementCoverageOwner].note" class="ypp__hint">{{ objectStates[settlementCoverageOwner].note }}</p>
              </template>

              <!-- 正式（默认）：正式读模型明细 -->
              <InsightBlock
                v-if="settlementStatusMode === 'formal' && hasSettlementDaily"
                title="正式日结明细（获权）"
                :result="viewStates['settlement-formal'].result"
                :error="viewStates['settlement-formal'].error"
                :loading="viewStates['settlement-formal'].loading"
                :on-retry="() => retryQuery('settlement-formal')"
                :on-refresh="() => retryQuery('settlement-formal')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-formal')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_FORMAL_TEXT" data-testid="ypp-settlement-formal-note" />
                <el-empty v-if="!settlementObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
                <InsightResultTable
                  v-else
                  :result="viewStates['settlement-formal'].result"
                  :selection="null"
                  :source-titles="sourceTitles"
                  @row-click="() => {}"
                />
              </InsightBlock>

              <!-- 暂结（显式切换）：正式/暂结并排对照，两态都在才给差异列 -->
              <InsightBlock
                v-else-if="settlementStatusMode === 'temp' && hasStatusDiff"
                title="正式/暂结对照（获权）"
                :result="viewStates['settlement-status-diff'].result"
                :error="viewStates['settlement-status-diff'].error"
                :loading="viewStates['settlement-status-diff'].loading"
                :on-retry="() => retryQuery('settlement-status-diff')"
                :on-refresh="() => retryQuery('settlement-status-diff')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-status-diff')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_TEMP_TEXT" data-testid="ypp-settlement-temp-note" />
                <el-empty v-if="!settlementObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
                <template v-else>
                  <el-table v-if="statusDiffRows.length" :data="statusDiffRows" size="small" border max-height="420" data-testid="ypp-status-diff-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="date" label="业务日" width="110" />
                    <el-table-column
                      v-for="column in statusDiffColumns"
                      :key="column.id"
                      :prop="`cells.${column.id}`"
                      :label="column.label ?? column.id"
                      min-width="130"
                      align="right"
                      show-overflow-tooltip
                    />
                  </el-table>
                  <el-alert v-for="(note, index) in statusDiffNotes" :key="`sdn-${index}`" type="info" :closable="false" :title="note" />
                </template>
              </InsightBlock>
              <el-alert
                v-else-if="settlementStatusMode === 'temp' && !hasStatusDiff"
                type="info"
                :closable="false"
                title="当前公司没有正式/暂结对照的查看授权：暂结对照需开通后查看，不静默用暂结顶替正式"
              />

              <!-- 量费加权统计：总量/总费/均价卡（后端按正式/暂结分来源算，页面只呈现） -->
              <template v-if="hasSettlementInterval">
                <div class="ypp__bar">
                  <label class="ypp__field">
                    <span>分时结算对象（多选，最多 {{ settlementIntervalDef?.limits.maxObjects ?? 50 }} 个；统计按自然月，跨月窗口后端拒绝）</span>
                    <InsightObjectPicker
                      :model-value="intervalObjects"
                      :options="optionsOf(PLANTS_SETTLEMENT_INTERVAL)"
                      :max-objects="settlementIntervalDef?.limits.maxObjects ?? 50"
                      requires-objects
                      :disabled="objectsPhase(PLANTS_SETTLEMENT_INTERVAL) !== 'ready'"
                      data-testid="ypp-settlement-interval-objects"
                      @update:model-value="onIntervalObjectsChange"
                    />
                  </label>
                </div>
                <template v-if="objectsPhase(PLANTS_SETTLEMENT_INTERVAL) === 'error'">
                  <el-alert type="error" show-icon :closable="false" title="对象清单读取失败">
                    <p class="ypp__hint">列不出场站清单就无法选择查询范围；可重试。</p>
                    <el-button size="small" @click="retryObjects(PLANTS_SETTLEMENT_INTERVAL)">重试</el-button>
                  </el-alert>
                </template>
                <el-alert
                  v-else-if="objectsPhase(PLANTS_SETTLEMENT_INTERVAL) === 'unavailable'"
                  type="info"
                  :closable="false"
                  :title="OBJECTS_UNAVAILABLE_TEXT"
                />
                <el-alert v-else-if="objectsPhase(PLANTS_SETTLEMENT_INTERVAL) === 'empty'" type="info" :closable="false" :title="OBJECTS_EMPTY_TEXT" />
              </template>
              <InsightBlock
                v-if="hasSettlementInterval"
                title="总量、总费与量费加权均价（获权）"
                :result="viewStates['settlement-stats'].result"
                :error="viewStates['settlement-stats'].error"
                :loading="viewStates['settlement-stats'].loading"
                :on-retry="() => retryQuery('settlement-stats')"
                :on-refresh="() => retryQuery('settlement-stats')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-stats')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_STATS_TEXT" data-testid="ypp-settlement-stats-note" />
                <el-empty v-if="!intervalObjects.length" :description="PICK_PLANT_TEXT" :image-size="72" />
                <template v-else>
                  <div v-if="settlementStatsCards.length" class="ypp__cards" data-testid="ypp-settlement-stats-cards">
                    <div v-for="card in settlementStatsCards" :key="card.key" class="ypp__card">
                      <h4 class="ypp__card-title">{{ card.title }}</h4>
                      <el-alert v-if="card.unavailableReason" type="warning" :closable="false" :title="card.unavailableReason" />
                      <dl class="ypp__card-grid">
                        <template v-for="row in card.rows" :key="row.label">
                          <dt>{{ row.label }}</dt>
                          <dd>{{ row.text }}{{ row.unit ? ` ${row.unit}` : '' }}{{ row.note ? `（${row.note}）` : '' }}</dd>
                        </template>
                      </dl>
                    </div>
                  </div>
                  <el-table v-if="settlementStatsObjectRows.length" :data="settlementStatsObjectRows" size="small" border max-height="360" data-testid="ypp-settlement-stats-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="status" label="结算状态" width="90" />
                    <el-table-column prop="totalEnergy" :label="metricLabelOf('settlement.total-energy') + '（MWh）'" width="150" align="right" />
                    <el-table-column prop="totalFee" :label="metricLabelOf('settlement.total-fee') + '（元）'" width="150" align="right" />
                    <el-table-column prop="averagePrice" :label="metricLabelOf('settlement.weighted-average-price') + '（yuan/MWh）'" width="170" align="right" />
                    <el-table-column prop="pairedCount" :label="metricLabelOf('settlement.paired-count')" width="130" align="right" />
                    <el-table-column prop="missingFee" :label="metricLabelOf('settlement.missing-fee-count')" width="120" align="right" />
                    <el-table-column prop="missingEnergy" :label="metricLabelOf('settlement.missing-energy-count')" width="120" align="right" />
                  </el-table>
                  <el-alert v-for="(note, index) in settlementStatsNotes" :key="`ssn-${index}`" type="info" :closable="false" :title="note" />
                </template>
              </InsightBlock>

              <!-- 分项覆盖与损失解释：源损失值 + 电网损失未提供态 + 未解释差额（页面不拼瀑布） -->
              <InsightBlock
                v-if="hasSettlementDaily"
                title="分项覆盖与损失解释（获权）"
                :result="viewStates['settlement-loss'].result"
                :error="viewStates['settlement-loss'].error"
                :loading="viewStates['settlement-loss'].loading"
                :on-retry="() => retryQuery('settlement-loss')"
                :on-refresh="() => retryQuery('settlement-loss')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-loss')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_LOSS_TEXT" data-testid="ypp-settlement-loss-note" />
                <el-empty v-if="!settlementObjects.length" :description="FOLLOW_OVERVIEW_TEXT" :image-size="72" />
                <template v-else>
                  <el-alert
                    v-if="lossGridNote"
                    :type="lossGridProvided ? 'info' : 'warning'"
                    :closable="false"
                    :title="lossGridNote"
                    data-testid="ypp-grid-loss-note"
                  />
                  <el-alert
                    v-if="lossWaterfallNote"
                    :type="lossWaterfallComplete ? 'info' : 'warning'"
                    :closable="false"
                    :title="lossWaterfallNote"
                    data-testid="ypp-waterfall-note"
                  />
                  <el-table v-if="lossRows.length" :data="lossRows" size="small" border max-height="420" data-testid="ypp-loss-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="date" label="业务日" width="110" />
                    <el-table-column
                      v-for="column in LOSS_COLUMNS"
                      :key="column.id"
                      :prop="`cells.${column.id}`"
                      :label="column.label"
                      min-width="150"
                      align="right"
                      show-overflow-tooltip
                    />
                  </el-table>
                  <el-alert v-for="(note, index) in lossNotes" :key="`ln-${index}`" type="info" :closable="false" :title="note" />
                </template>
              </InsightBlock>

              <!-- 单据记录（获权）：账单索引/下载/单元格/月结载荷/拆分审批，只读红线 -->
              <InsightBlock
                v-if="hasSettlementDocs"
                title="结算单据与原件引用（获权）"
                :result="viewStates['settlement-docs'].result"
                :error="viewStates['settlement-docs'].error"
                :loading="viewStates['settlement-docs'].loading"
                :on-retry="() => retryQuery('settlement-docs')"
                :on-refresh="() => retryQuery('settlement-docs')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-docs')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_DOCS_TEXT" data-testid="ypp-settlement-docs-note" />
                <el-alert type="warning" :closable="false" :title="SETTLEMENT_READONLY_TEXT" data-testid="ypp-settlement-readonly-note" />
                <p class="ypp__hint">单据记录按全部获权对象查询：记录来源的对象可选，这里不单设对象选择。</p>
                <el-table v-if="docsRows.length" :data="docsRows" size="small" border max-height="420" data-testid="ypp-docs-table">
                  <el-table-column prop="date" label="业务日/账期" width="110" />
                  <el-table-column prop="source" label="单据类型" min-width="200" show-overflow-tooltip />
                  <el-table-column
                    v-for="key in docsColumns"
                    :key="key"
                    :prop="`cells.${key}`"
                    :label="docsDimensionText(key)"
                    min-width="110"
                    show-overflow-tooltip
                  />
                  <el-table-column prop="value" label="记录内容" min-width="140" show-overflow-tooltip />
                </el-table>
                <p v-else-if="!viewStates['settlement-docs'].loading" class="ypp__hint">所选窗口没有单据记录。</p>
              </InsightBlock>

              <!-- 核对（获权）：日报/日结/月结同周期差异，缺失周期「—」+说明 -->
              <InsightBlock
                v-if="hasSettlementReconcile"
                title="日报、日结与月结核对（获权）"
                :result="viewStates['settlement-reconcile'].result"
                :error="viewStates['settlement-reconcile'].error"
                :loading="viewStates['settlement-reconcile'].loading"
                :on-retry="() => retryQuery('settlement-reconcile')"
                :on-refresh="() => retryQuery('settlement-reconcile')"
                :source-titles="sourceTitles"
                @open-candidates="openCandidates"
                @open-evidence="openEvidence('settlement-reconcile')"
              >
                <el-alert type="info" :closable="false" :title="SETTLEMENT_RECONCILE_TEXT" data-testid="ypp-settlement-reconcile-note" />
                <el-empty v-if="!settlementObjects.length" :description="FOLLOW_OVERVIEW_TEXT" :image-size="72" />
                <template v-else>
                  <h4 class="ypp__section-title">日报 vs 日结（同周期：日）</h4>
                  <el-table v-if="reconcileDailyRows.length" :data="reconcileDailyRows" size="small" border max-height="420" data-testid="ypp-reconcile-daily-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="date" label="业务日" width="110" />
                    <el-table-column prop="cells.dailyReportRevenueYuan" label="日报结算收入（元）" width="160" align="right" />
                    <el-table-column prop="cells.settlementDailyFeeYuan" label="日结电费（元）" width="150" align="right" />
                    <el-table-column prop="cells.differenceYuan" label="差异（日报−日结，元）" width="170" align="right" />
                    <el-table-column prop="missingText" label="缺失说明" min-width="200" show-overflow-tooltip />
                    <el-table-column prop="qualityText" label="质量说明" min-width="200" show-overflow-tooltip />
                  </el-table>
                  <el-alert
                    v-for="(reason, index) in reconcileQualityExcluded"
                    :key="`rq-${index}`"
                    type="warning"
                    :closable="false"
                    :title="reason"
                  />
                  <h4 class="ypp__section-title">月结汇总（月周期，单独展示不与日值互比）</h4>
                  <el-table v-if="reconcileMonthlyRows.length" :data="reconcileMonthlyRows" size="small" border max-height="300" data-testid="ypp-reconcile-monthly-table">
                    <el-table-column prop="objectId" label="场站" min-width="130" show-overflow-tooltip />
                    <el-table-column prop="settleMonth" label="账期月" width="110" />
                    <el-table-column prop="fee" label="月结电费合计（元）" width="170" align="right" />
                  </el-table>
                  <el-alert
                    v-if="reconcileMonthlyMissingText"
                    type="info"
                    :closable="false"
                    :title="reconcileMonthlyMissingText"
                    data-testid="ypp-reconcile-monthly-missing"
                  />
                  <el-alert v-for="(note, index) in reconcileNotes" :key="`rn-${index}`" type="info" :closable="false" :title="note" />
                </template>
              </InsightBlock>
            </template>
            </section>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 证据抽屉与历史候选 -->
    <InsightEvidenceDrawer v-model="evidenceVisible" :result="evidenceTarget" :source-titles="sourceTitles" />

    <InsightHistoryCandidates
      v-model="candidatesVisible"
      :analysis-id="PLANTS_OUTPUT_SERIES"
      :context="ctx.toQueryContext()"
      :filters="candidatesFilters"
      :required-source-ids="[...(outputSeriesDef?.sourceIds ?? [])]"
      :source-titles="sourceTitles"
      @select="onCandidateSelect"
    />
  </div>
</template>

<style scoped>
.ypp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ypp__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  background: var(--panel, #fff);
}

.ypp__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ypp__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.ypp__field :deep(.el-select),
.ypp__field :deep(.el-date-editor) {
  width: 260px;
}

.ypp__meta {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
}

.ypp__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}

.ypp__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin: 8px 0;
}

.ypp__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.ypp__card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--panel-sub, #f8fafc);
}

.ypp__card-title {
  margin: 0 0 8px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.ypp__card-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 0;
  font-size: var(--font-sm, 13px);
}

.ypp__card-object {
  color: var(--text, #1f2a37);
}

.ypp__card-value {
  color: var(--muted, #64748b);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.ypp__card-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}

.ypp__card-grid dt {
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

.ypp__card-grid dd {
  margin: 0;
  font-size: var(--font-sm, 13px);
  font-variant-numeric: tabular-nums;
  color: var(--text, #1f2a37);
  text-align: right;
}

.ypp__section-title {
  margin: 8px 0 6px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.ypp__legend {
  margin: 4px 0 0;
  padding: 0 0 0 18px;
  color: var(--muted, #64748b);
  font-size: var(--font-xs, 12px);
}

/* 结算页签占位区块：头部（标题 + 只读深链入口）+ 占位说明 */
.ypp__settlement {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--panel, #fff);
}

.ypp__settlement-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ypp__block-title {
  margin: 0;
  font-size: var(--font-lg, 16px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

/* 深链入口行（中长期引用等）：说明 + 链接按钮 */
.ypp__deeplink {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
</style>
