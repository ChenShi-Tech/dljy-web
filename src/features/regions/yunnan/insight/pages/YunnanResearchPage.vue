<script setup lang="ts">
// 云南研究工作台页（dljy#3080，OpenSpec insight-research-workbench 任务 13.5/13.6）
// ----------------------------------------------------------------------------
// /insight/research 的云南实现。口径要点（design D6、RS01—RS07，本页只呈现、不计算）：
//   - 预设是唯一入口：只运行 shared/insight/research.mjs 登记的预设（镜像为准）；每个预设
//     带缺口原因原文——「什么情况下算不出或样本变少」，不承诺替代数据。输入资格不足的预设
//     可见但不可运行（能力目录缺所需分析 → 标「输入不足」）；未登记地区没有预设，整页空态。
//   - 受控自定义不是 SQL 控制台：指标输入面只有「预设登记项的只读下拉」（选项=白名单本身），
//     自由文本框不存在；变换只有有限的几档（分组、显式滞后、窗口长度、阈值、同类日目标日），
//     滞后/窗口/阈值全部显式给出，内核不搜索最优参数。
//   - 事前/事后模式固定在运行面板上方：事后带「事后对照」标注；事前必须显式给出截止时点
//     （asOf），四类不可用场景由后端拒绝、页面按原因原文展示，绝不运行后补标「事前」。
//   - 结果只呈现后端算好的统计量与样本说明（n / 覆盖率 / 方法版本），相关不写因果、
//     同类日不以相似度承诺价格预测；无置信区间（未处理时序自相关）按后端声明原文透出。
//   - 值直接渲染后端十进制原值：坐标与表格都不设固定上限——合法值再大也完整呈现，
//     超限请求被前置拦截或按后端原因原文拒绝，绝不截断冒充完整（RS02、RS07）。
//   - 切换预设/参数/模式/窗口即作废旧结果（代次签名变化立即清空，在途请求由代次机制作废）。
//   - 保存分析走后端定义冻结（任务 14.4，RS06；与复盘材料同一冻结协议）：只提交「定义与
//     源引用 + 期望版本」，服务端按同一研究内核重算核对一致才保存；源已更新返回 409 →
//     提示「资料已更新，请先重新运行再保存」，未保存、不自动接受新值，未成功绝不提示成功。
//     公司写权限决定保存入口显隐（后端闸门才是权威）；运行预览与已保存列表查看不受限。
//   - 旧关系图（价格×新能源/负荷散点）与旧综合分析的适用视图迁入本页：结果呈现形式与
//     预设登记对齐（相关统计、滞后对比、异常窗口时间线、同类日候选表），数据面统一走
//     research/preview，旧页本期保留不删（D6.1）。
// 多指标分面与选区承接（dljy#3114，任务 13.7，RS08、DE10）：
//   - 统计型结果（相关/滞后/同进度）的统计行按云南登记目录的量纲分面：一个量纲一张图
//     一根轴，不同量纲各拆一张图并列，颜色/图例区分——不共轴、不做双 Y 轴混标
//     （沿用 useInsightSeriesChart 分组纪律）；序列显隐/分面顺序是运行面板的会话内
//     视图状态：不进请求、不改结果，后端定义未登记视图字段，保存定义不含它（如实说明）。
//   - 参考日明示：同类日目标日本就是显式日期选择；同进度比较的参考日按登记固定为
//     业务日前一日（reference.days=1），运行面板明示映射，不发明后端未登记的变换字段。
//   - 承接洞察选区（价格/电网/场站页图表语义选区 → 本页）：经地址参数白名单只带窗口
//     起止日+对象/来源引用+来源页（时段数组、原始数据不进 URL）；窗口/对象/来源由
//     useInsightContext 还原，预设按承接来源建议预填（可更换），并给返回原页入口。
//   - 红线：价格响应类预设（竞价空间×价格拟合/弹性）未登记开放——缺已登记的模型输入、
//     方法与验证结果就明确不可用；剩余需求代理是分析代理量，不是官方竞价空间，不写因果。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'
import { RESEARCH_MAX_LAG_SLOTS, RESEARCH_MAX_WINDOW_SLOTS, listResearchPresets } from 'shared/insight/research.mjs'
import { calendarDayMs, type InsightContextInput } from 'shared/insight/contract.mjs'
import { buildResearchStatFacets, statFacetTitleOf } from '../researchFacets'
import {
  RESEARCH_HANDOFF_ORIGIN_LABELS,
  handoffReturnLocation,
  parseResearchHandoffOrigin,
  suggestResearchPresetId,
  type ResearchHandoffOrigin,
} from '../researchHandoff'
import ResearchStatFacet from './ResearchStatFacet.vue'
import { idempotencyKeyOf } from '@/services/api'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import {
  fetchInsightCapabilities,
  type InsightCapabilities,
  type InsightRequestError,
} from '@/services/insight/insightClient'
import {
  runResearchPreview,
  saveResearchDefinition,
  researchSaveError,
  type ResearchPreviewResult,
  type ResearchRow,
  type ResearchSeriesMeta,
} from '@/services/insight/researchClient'
import { useInsightContext } from '@/composables/useInsightContext'
import { useInsightAiPage, type InsightAiEvidenceBlock, type InsightAiEvidenceItem } from '@/features/regions/yunnan/insight/useInsightAiPage'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightResearchSavedDialog from '@/components/insight/InsightResearchSavedDialog.vue'
import { insightSourceTitle, type InsightSourceTitle } from '@/components/insight/insightText'

// ── 契约镜像的预设（页面不二次定义口径）──────────────────────────────────────────────────

type ResearchPreset = {
  presetId: string
  title: string
  kind: string
  gapReason: string
  analysisIds: readonly string[]
  limits: { maxDays: number }
  sample: { minSamples: number; minCoverageRatio?: string }
  inputs: Record<string, { role: string; label: string; resolutionMinutes: number | null }>
  features?: ReadonlyArray<{ id: string; label: string; weight: string; transform: string }>
  groupings?: readonly string[]
}

/** 研究类型的业务名（登记名不透出界面）。 */
const KIND_LABELS: Record<string, string> = {
  correlation: '共同样本相关',
  'lag-comparison': '明确滞后比较',
  'anomaly-window': '异常窗口扫描',
  'similar-day': '同类日',
  'progress-comparison': '同进度比较',
}

const EX_POST_BADGE = '事后对照'
const EX_ANTE_BADGE = '事前 · 截至时点'
const STAGE_TEXT = '研究工作台只运行登记过的预设：结果保留样本、覆盖与方法说明；统计关联不等于因果，同类日不以相似度承诺价格预测'
const NO_PRESET_TEXT = '当前地区暂未开通研究预设：研究入口按地区登记，未登记地区不借用其他地区的预设'
const SAVE_HINT_NO_RESULT = '运行预览后才能保存：保存提交的是研究定义与版本，不是结果本身'
const SAVE_HINT_READY = '保存会把定义与期望版本交给服务端核验：按同口径重算一致才冻结；资料已更新时会要求先重新运行再保存'

// ── 上下文与能力目录 ─────────────────────────────────────────────────────────────────────

const ctx = useInsightContext()
const route = useRoute()
const router = useRouter()

/** 视图选择的会话边界说明（后端定义未登记视图字段，保存不携带——如实说明，不发明字段）。 */
const VIEW_SCOPE_NOTE =
  '视图选择（序列显隐、分面顺序）仅本会话生效：保存的研究定义携带预设、窗口、模式与显式变换参数，不包含视图选择（后端定义未登记视图字段，不发明未登记字段）'

/** 价格响应类预设的不可用说明（竞价空间×价格未登记：缺模型输入/方法/验证结果不开放）。 */
const PRICE_RESPONSE_NOTE =
  '价格响应类研究预设未登记开放：竞价空间价格响应需要已登记的模型输入、方法与验证结果才可运行；剩余需求代理是分析代理量，不是官方竞价空间，也不构成因果或套利结论'

// ── 承接洞察选区（任务 13.7，RS08）：来源页白名单 + 预设建议预填 ─────────────────────────

const handoffOrigin = ref<ResearchHandoffOrigin | null>(parseResearchHandoffOrigin(route.query))

const handoffOriginLabel = computed(() =>
  handoffOrigin.value ? RESEARCH_HANDOFF_ORIGIN_LABELS[handoffOrigin.value] : ''
)

/** 承接来源对应的预设建议（登记输入来源 ∩ 承接来源最大者；无交集不预填、不假装承接）。 */
const handoffSuggestedPresetId = computed(() =>
  suggestResearchPresetId(presets.value, ctx.sourceIds.value)
)

const handoffBanner = computed(() => {
  const origin = handoffOrigin.value
  if (!origin) return ''
  const parts = [`窗口 ${ctx.businessWindow.value.start} ~ ${ctx.businessWindow.value.end}`]
  if (ctx.objectIds.value.length) parts.push(`对象 ${ctx.objectIds.value.length} 个`)
  if (ctx.sourceIds.value.length) parts.push(`来源 ${ctx.sourceIds.value.length} 项`)
  // 预填文案只认实际生效的选择：建议存在 ≠ 预填成功（目录未就绪/失败/所需分析未开放时
  // selectPreset 会拒绝，界面不得声称已预填一个空预设）。
  const suggested = handoffSuggestedPresetId.value
  const prefill = !suggested
    ? '承接来源未对应已登记预设，请手动选择研究问题'
    : selectedPresetId.value === suggested
      ? '研究预设已按承接来源预填（可更换）'
      : capabilitiesLoading.value
        ? '承接预设待能力目录就绪后预填'
        : capabilitiesError.value
          ? '能力目录读取失败，承接预设未能预填，请手动选择研究问题'
          : '承接来源对应的预设当前不可运行（所需分析未开放），请手动选择研究问题'
  return `已承接「${RESEARCH_HANDOFF_ORIGIN_LABELS[origin]}」的选区范围：${parts.join('、')}；承接只携带窗口与对象/来源引用，不带原始数据；${prefill}`
})

/** 能力目录就绪后按承接来源预填一次（用户已选预设时不覆盖）。 */
function applyHandoffPrefill(): void {
  if (!handoffOrigin.value || selectedPresetId.value) return
  const suggested = handoffSuggestedPresetId.value
  if (suggested) selectPreset(suggested)
}

function returnToOrigin(): void {
  const origin = handoffOrigin.value
  if (!origin) return
  const location = handoffReturnLocation(origin, ctx.businessWindow.value, ctx.objectIds.value, ctx.sourceIds.value)
  void router.push({ path: location.path, query: location.query })
}

const capabilities = ref<InsightCapabilities | null>(null)
const capabilitiesError = ref<InsightRequestError | null>(null)
const capabilitiesLoading = ref(false)

async function loadCapabilities(): Promise<void> {
  capabilitiesLoading.value = true
  capabilitiesError.value = null
  let loaded = false
  try {
    const result = await ctx.request.run((signal) => fetchInsightCapabilities({ signal }))
    if (!result) return
    capabilities.value = result
    loaded = true
  } catch (error) {
    capabilitiesError.value = error as InsightRequestError
  } finally {
    capabilitiesLoading.value = false
  }
  // 承接选区时按来源预填预设（资格面就绪才接得住；用户已选预设时不覆盖）。
  if (loaded) applyHandoffPrefill()
}

onMounted(() => {
  // 没有预设的地区（未登记）不需要输入资格面：不读能力目录、不发任何请求
  if (presets.value.length) void loadCapabilities()
})

/** 能力目录来源 → 业务标题目录（事前逐来源说明等场景）。 */
const sourceTitles = computed(() => {
  const map: Record<string, InsightSourceTitle> = {}
  for (const source of capabilities.value?.sources ?? []) {
    map[source.sourceId] = { title: source.title, accessScope: source.accessScope }
  }
  return map
})

function sourceTitleOf(sourceId: string): string {
  return insightSourceTitle(sourceId, sourceTitles.value)?.title ?? '相关来源'
}

// ── 预设入口（按当前地区取登记；其他地区为空）────────────────────────────────────────────

const presets = computed<ResearchPreset[]>(() => [...listResearchPresets(ctx.regionId.value)] as ResearchPreset[])

const selectedPresetId = ref('')
const activePreset = computed<ResearchPreset | null>(
  () => presets.value.find((preset) => preset.presetId === selectedPresetId.value) ?? null
)

watch(
  () => ctx.regionId.value,
  () => {
    selectedPresetId.value = ''
  }
)

/** 输入资格：能力目录列出该预设需要的全部分析才可运行（目录未就绪/失败一律不可运行）。 */
function inputEligibilityOf(preset: ResearchPreset): { eligible: boolean; reason: string } {
  if (capabilitiesLoading.value) return { eligible: false, reason: '输入资格确认中：能力目录读取中，暂不能运行' }
  if (capabilitiesError.value) return { eligible: false, reason: '输入不足：能力目录读取失败，暂不能运行' }
  if (!capabilities.value) return { eligible: false, reason: '输入不足：能力目录未就绪，暂不能运行' }
  const missing = preset.analysisIds
    .filter((analysisId) => !capabilities.value!.analyses.some((analysis) => analysis.analysisId === analysisId))
    .map((analysisId) => getInsightAnalysis(analysisId)?.title ?? '')
  if (missing.length) return { eligible: false, reason: `输入不足：该预设需要的分析当前不可用（${missing.join('、')}）` }
  return { eligible: true, reason: '' }
}

function selectPreset(presetId: string): void {
  const preset = presets.value.find((item) => item.presetId === presetId)
  if (!preset) return
  const eligibility = inputEligibilityOf(preset)
  if (!eligibility.eligible) {
    // 资格不足的预设可见、可选看，但不可置为运行对象。
    selectedPresetId.value = ''
    ineligibleNotice.value = `${preset.title}：${eligibility.reason}`
    return
  }
  ineligibleNotice.value = ''
  selectedPresetId.value = presetId
}

const ineligibleNotice = ref('')

// ── 运行面板（问题/方法/期间/事前事后固定在上方）────────────────────────────────────────

const mode = ref<'ex-post' | 'ex-ante'>('ex-post')
const asOfLocal = ref('')
/** 截止时点：北京时间 ISO（带时区），契约要求事前模式必须显式给出。 */
const asOfIso = computed(() => (asOfLocal.value ? `${asOfLocal.value.replace(' ', 'T')}:00+08:00` : null))

// 变换参数（每类预设只开放它的那一档；全部显式给出，不猜默认）。
const groupBy = ref<'none' | 'month'>('none')
const lagSlots = ref<number | null>(null)
const windowSlots = ref<number | null>(24)
const thresholdKind = ref<'absolute' | 'quantile'>('absolute')
const thresholdValue = ref<number | null>(null)
const thresholdQuantile = ref<number | null>(null)
const targetDate = ref('')
const minCandidates = ref<number | null>(8)

watch(selectedPresetId, () => {
  // 换预设回到该类变换的中性初值：上一预设的滞后/阈值不悄悄带进下一预设。
  groupBy.value = 'none'
  lagSlots.value = null
  windowSlots.value = 24
  thresholdKind.value = 'absolute'
  thresholdValue.value = null
  thresholdQuantile.value = null
  targetDate.value = ''
  minCandidates.value = 8
  asOfLocal.value = ''
  mode.value = 'ex-post'
})

const activeKind = computed(() => activePreset.value?.kind ?? '')

/** 运行前拦截：资格、事前 asOf、该类变换的显式参数、窗口长度。全部通过才发请求。 */
const runBlocker = computed(() => {
  const preset = activePreset.value
  if (!preset) return ''
  const eligibility = inputEligibilityOf(preset)
  if (!eligibility.eligible) return eligibility.reason
  const days =
    Math.round((Date.parse(`${ctx.businessWindow.value.end}T00:00:00Z`) - Date.parse(`${ctx.businessWindow.value.start}T00:00:00Z`)) / 86_400_000) + 1
  if (days > preset.limits.maxDays) return `该研究预设一次最多 ${preset.limits.maxDays} 天，请缩小日期范围`
  if (mode.value === 'ex-ante' && !asOfIso.value) return '事前分析必须给出截止时点'
  if (preset.kind === 'lag-comparison') {
    if (lagSlots.value === null || lagSlots.value === 0) {
      return `滞后槽位必须显式给出非零整数（含方向），最多 ±${RESEARCH_MAX_LAG_SLOTS}`
    }
    if (Math.abs(lagSlots.value) > RESEARCH_MAX_LAG_SLOTS) return `滞后槽位最多 ±${RESEARCH_MAX_LAG_SLOTS}（一个日历日），请明确给出研究假设的滞后量`
  }
  if (preset.kind === 'anomaly-window') {
    if (windowSlots.value === null || windowSlots.value < 1) return '窗口长度必须是正整数槽位数'
    if (windowSlots.value > RESEARCH_MAX_WINDOW_SLOTS) return `窗口长度最多 ${RESEARCH_MAX_WINDOW_SLOTS} 个槽位（一个日历日）`
    if (thresholdKind.value === 'absolute' && thresholdValue.value === null) return '阈值必须显式给出：绝对值或该序列自身的分位数'
    if (thresholdKind.value === 'quantile' && (thresholdQuantile.value === null || thresholdQuantile.value <= 0 || thresholdQuantile.value > 1)) {
      return '分位数阈值必须在 (0, 1] 之间'
    }
  }
  if (preset.kind === 'similar-day') {
    if (!targetDate.value) return '同类日需要显式给出目标日'
    if (targetDate.value < ctx.businessWindow.value.start || targetDate.value > ctx.businessWindow.value.end) {
      return '目标日必须在业务日期范围内'
    }
    if (minCandidates.value === null || minCandidates.value < 2) return '最小候选数必须是 ≥2 的整数'
  }
  return ''
})

const canRun = computed(() => Boolean(activePreset.value) && !runBlocker.value)

/** 该预设的登记指标面：下拉选项就是白名单本身，没有自由文本。 */
const inputOptions = computed<Array<{ key: string; label: string; note: string }>>(() => {
  const preset = activePreset.value
  if (!preset) return []
  const entries = Object.entries(preset.inputs).map(([key, input]) => ({
    key,
    label: input.label,
    note: input.resolutionMinutes ? `按 ${input.resolutionMinutes} 分钟对齐` : '按原生粒度',
  }))
  for (const feature of preset.features ?? []) {
    entries.push({ key: `feature:${feature.id}`, label: feature.label, note: '同类日特征（完整日才有效）' })
  }
  return entries
})

function buildTransformations(preset: ResearchPreset): Record<string, unknown> | undefined {
  if (preset.kind === 'lag-comparison') return { lagSlots: lagSlots.value }
  if (preset.kind === 'anomaly-window') {
    const threshold =
      thresholdKind.value === 'absolute'
        ? { kind: 'absolute', value: String(thresholdValue.value) }
        : { kind: 'quantile', p: String(thresholdQuantile.value) }
    return { windowSlots: windowSlots.value, threshold }
  }
  if (preset.kind === 'similar-day') return { targetDate: targetDate.value, minCandidates: minCandidates.value }
  return undefined
}

// ── 运行状态与代次作废 ───────────────────────────────────────────────────────────────────

const runState = reactive<{ result: ResearchPreviewResult | null; error: InsightRequestError | null; loading: boolean; runKey: string }>({
  result: null,
  error: null,
  loading: false,
  runKey: '',
})

// ── 保存分析（任务 14.4，RS06）与已保存列表入口 ──────────────────────────────────────────
// 权限语义分离（同 #151 材料口径）：保存是公司写入，按 governance 既有口径只对公司管理员级
// 账号显示入口（后端写入闸门才是权威）；运行预览与已保存列表查看不受影响。

const canWriteCompany = computed(() => {
  try {
    return hasCompanyAdmin(getCurrentUser())
  } catch {
    return false
  }
})

const saveState = reactive<{ saving: boolean; savedVersion: number | null; error: string }>({
  saving: false,
  savedVersion: null,
  error: '',
})

/** 已保存分析窗口：查看（列表/原样只读）对所有人开放；重算入口由窗口按权限另行显隐。 */
const savedVisible = ref(false)

/** 配置签名：任一参数变化旧结果立即失效（清空展示，在途请求由代次机制作废）。 */
const configSignature = computed(() =>
  JSON.stringify([
    selectedPresetId.value,
    ctx.regionId.value,
    ctx.businessWindow.value.start,
    ctx.businessWindow.value.end,
    mode.value,
    asOfIso.value,
    groupBy.value,
    lagSlots.value,
    windowSlots.value,
    thresholdKind.value,
    thresholdValue.value,
    thresholdQuantile.value,
    targetDate.value,
    minCandidates.value,
  ])
)

watch(configSignature, () => {
  runState.result = null
  runState.error = null
  runState.runKey = ''
  saveState.savedVersion = null
  saveState.error = ''
})

async function runPreview(): Promise<void> {
  const preset = activePreset.value
  if (!preset || !canRun.value || runState.loading) return
  const context: InsightContextInput = { ...ctx.toQueryContext(), mode: mode.value, asOf: asOfIso.value }
  const filters = preset.kind === 'correlation' ? { groupBy: groupBy.value } : undefined
  const transformations = buildTransformations(preset)
  const key = configSignature.value
  runState.loading = true
  runState.error = null
  try {
    const result = await ctx.request.run(
      (signal) => runResearchPreview({ presetId: preset.presetId, context, filters, transformations }, { signal })
    )
    if (!result || configSignature.value !== key) return // 作废/迟到：不写状态
    // 新一次运行回到默认视图（序列显隐/分面顺序绑定当前结果，是会话内状态）。
    hiddenMetricIds.value = new Set()
    facetOrder.value = []
    runState.result = result
    runState.runKey = key
  } catch (error) {
    if (configSignature.value !== key) return
    runState.error = error as InsightRequestError
    runState.runKey = key
  } finally {
    if (configSignature.value === key) runState.loading = false
  }
}

// ── 保存动作：只提交定义与源引用 + 期望版本，服务端重算核对一致才冻结（RS06）────────────

const canSave = computed(() => canWriteCompany.value && Boolean(runState.result?.resultVersion && runState.result?.readSetRef))

const saveHint = computed(() => (runState.result ? SAVE_HINT_READY : SAVE_HINT_NO_RESULT))

async function saveDefinition(): Promise<void> {
  const preset = activePreset.value
  const current = runState.result
  if (!preset || !current || saveState.saving) return
  if (!current.resultVersion || !current.readSetRef) {
    saveState.error = '当前结果缺少版本标记，无法保存：请重新运行预览'
    return
  }
  // 上下文剥掉代次（导航概念，同 #151 材料保存）：同口径重复保存幂等键稳定。
  const { contextVersion: _generation, ...context } = ctx.toQueryContext()
  const expected = { resultVersion: current.resultVersion, readSetRef: current.readSetRef }
  const filters = preset.kind === 'correlation' ? { groupBy: groupBy.value } : undefined
  const transformations = buildTransformations(preset)
  // 幂等键按业务内容派生：同定义同版本重复保存/重试同键 → 服务端返回原条目，不重复创建。
  const idempotencyKey = idempotencyKeyOf('research-definition', {
    region: ctx.regionId.value,
    presetId: preset.presetId,
    context,
    filters: filters ?? null,
    transformations: transformations ?? null,
    expected,
  })
  saveState.saving = true
  saveState.error = ''
  saveState.savedVersion = null
  try {
    const detail = await saveResearchDefinition({ presetId: preset.presetId, context, filters, transformations, expected, idempotencyKey })
    const version = detail.latestRun?.runNo ?? 1
    saveState.savedVersion = version
    ElMessage.success(detail.replay ? `已保存（版本 ${version}）；该定义此前已保存，未重复创建` : `已保存（版本 ${version}）`)
  } catch (error) {
    // 409（源已更新）→ 固定提示先重新运行；其余透传后端原因原文。未保存，绝不提示成功。
    saveState.error = researchSaveError(error, '保存未完成：研究页其余功能不受影响，请稍后重试')
  } finally {
    saveState.saving = false
  }
}

// ── 结果读取（宽松形状 + 展示辅助；值按登记精度或原文呈现，无任何裁剪）──────────────────

function metricLabelOf(metricId: string): string {
  return getMetricDefinition(metricId)?.label ?? metricId
}

function metricUnitOf(metricId: string): string {
  const definition = getMetricDefinition(metricId)
  return !definition || definition.unit === 'count' ? '' : definition.unit
}

function metricTextOf(metricId: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (!getMetricDefinition(metricId)) return String(value)
  try {
    return String(formatMetricValue(metricId, value))
  } catch {
    return String(value)
  }
}

function percentTextOf(ratio: string | null | undefined): string {
  if (ratio === null || ratio === undefined || ratio === '') return '—'
  const numeric = Number(ratio)
  if (!Number.isFinite(numeric)) return '—'
  return `${(numeric * 100).toFixed(1)}%`
}

const result = computed(() => runState.result)
const seriesMeta = computed<ResearchSeriesMeta | null>(() => result.value?.data.series[0] ?? null)

// ── 多指标量纲分面（任务 13.7，RS08、D6.1）：统计行按登记量纲拆面并列 ────────────────────
// 序列显隐/分面顺序是会话内视图状态：不进 configSignature（切换视图不清结果、不重查）、
// 不进保存请求（后端定义未登记视图字段）；新一次运行（新结果）回到默认视图。

/** 统计型内核（相关/滞后/同进度）才做统计分面；异常窗口是时间线、同类日是候选表。 */
const facetEligible = computed(() => ['correlation', 'lag-comparison', 'progress-comparison'].includes(activeKind.value))

const hiddenMetricIds = ref<ReadonlySet<string>>(new Set())
const facetOrder = ref<readonly string[]>([])

/** 图表分面：随显隐过滤（隐藏的序列不进图、整面隐藏时不出图）。 */
const statFacets = computed(() => {
  if (!facetEligible.value || !result.value) return []
  return buildResearchStatFacets(result.value.data.rows, {
    hiddenMetricIds: hiddenMetricIds.value,
    facetOrder: facetOrder.value,
  })
})

/** 控制面分面：同一套拆面与排序，但不做显隐过滤——显隐控件要一直在场，
 * 否则取消勾选后控件随序列一起消失，唯一序列被隐藏时整面都找不回（只能重跑）。 */
const statFacetControls = computed(() => {
  if (!facetEligible.value || !result.value) return []
  return buildResearchStatFacets(result.value.data.rows, {
    facetOrder: facetOrder.value,
  })
})

/** 可见图按单位索引：控制面渲染图表面时按单位取对应过滤后分面（无可见序列则不出图）。 */
const statFacetByUnit = computed(
  () => new Map(statFacets.value.map((facet) => [facet.unit, facet]))
)

/** 序列显隐：只改当前视图，不重新请求（同签名不重查），结果不清空。 */
function toggleMetricVisibility(metricId: string, visible: boolean): void {
  const next = new Set(hiddenMetricIds.value)
  if (visible) next.delete(metricId)
  else next.add(metricId)
  hiddenMetricIds.value = next
}

/** 分面顺序（上移/下移）：会话内视图状态，同样不触发请求。按控制面全集排序——
 * 被整面隐藏的分面也保持次序，重新勾回时不跳位。 */
function moveFacet(index: number, delta: number): void {
  const units = statFacetControls.value.map((facet) => facet.unit)
  const target = index + delta
  if (target < 0 || target >= units.length) return
  ;[units[index], units[target]] = [units[target], units[index]]
  facetOrder.value = units
}

/** 同进度比较的参考日：登记固定为业务日前一日（reference.days=1）——明示映射，不发明变换字段。 */
const progressReferenceDay = computed(() => {
  if (activeKind.value !== 'progress-comparison') return ''
  const start = ctx.businessWindow.value.start
  if (!start) return ''
  return new Date(calendarDayMs(start) - 86_400_000).toISOString().slice(0, 10)
})

const methodNotes = computed(() => result.value?.method.notes ?? [])
const exAnteInfo = computed(() => result.value?.exAnte ?? null)

/** 事前模式的逐来源排除说明（排除行数大于 0 的来源才列出）。 */
const exAnteExclusions = computed(() => {
  const info = exAnteInfo.value
  if (!info) return []
  return Object.entries(info.perSource)
    .filter(([, detail]) => detail.excludedAfterAsOf > 0 || detail.missingKnownAt > 0)
    .map(([sourceId, detail]) => {
      const parts = [`${sourceTitleOf(sourceId)}`]
      if (detail.excludedAfterAsOf > 0) parts.push(`截止时点之后取得的 ${detail.excludedAfterAsOf} 行未参与`)
      if (detail.missingKnownAt > 0) parts.push(`${detail.missingKnownAt} 行没有可解析的已知时间被排除`)
      return parts.join('：')
    })
})

// ── 相关：汇总统计 + 分月分组（不画散点：预览契约不下发点数据，前端不重算口径）──────────

type CorrelationMeta = {
  x?: string
  y?: string
  coverage?: { aValid: number; bValid: number; common: number; expectedSlots: number | null }
  overall?: {
    samples: number
    r: string | null
    covariance: string | null
    coverageRatio: string
    window?: { start: string; end: string } | null
    meanX?: string
    meanY?: string
    reason?: string
  }
}

const correlationMeta = computed<CorrelationMeta | null>(() =>
  activeKind.value === 'correlation' ? (seriesMeta.value as unknown as CorrelationMeta | null) : null
)

type CorrelationGroupRow = { key: string; r: string; covariance: string; samples: string }

const correlationGroupRows = computed<CorrelationGroupRow[]>(() => {
  const byGroup = new Map<string, CorrelationGroupRow>()
  for (const row of (result.value?.data.rows ?? []) as ResearchRow[]) {
    const group = row.group
    if (!group || group === 'all') continue
    const entry = byGroup.get(group) ?? { key: group, r: '—', covariance: '—', samples: '—' }
    if (row.metricId === 'research.pearson-r') entry.r = metricTextOf('research.pearson-r', row.value)
    else if (row.metricId === 'research.covariance') entry.covariance = metricTextOf('research.covariance', row.value)
    else if (row.metricId === 'sample.valid-count') entry.samples = metricTextOf('sample.valid-count', row.value)
    byGroup.set(group, entry)
  }
  return [...byGroup.values()]
})

// ── 滞后比较：方向、配对窗口、平均差与绝对值均值差 ────────────────────────────────────────

type LagMeta = { lagSlots?: number; direction?: string; window?: { start: string; end: string } | null }

const lagMeta = computed<LagMeta | null>(() => (activeKind.value === 'lag-comparison' ? (seriesMeta.value as unknown as LagMeta | null) : null))

type LagRow = { label: string; unit: string; text: string }

const lagStatRows = computed<LagRow[]>(() => {
  if (activeKind.value !== 'lag-comparison') return []
  const byMetric = new Map<string, string | null>()
  for (const row of (result.value?.data.rows ?? []) as ResearchRow[]) byMetric.set(row.metricId ?? '', row.value ?? null)
  return (['research.lag-mean-difference', 'research.lag-absolute-mean', 'sample.valid-count'] as const)
    .filter((metricId) => byMetric.has(metricId))
    .map((metricId) => ({
      label: metricLabelOf(metricId),
      unit: metricUnitOf(metricId),
      text: metricId === 'sample.valid-count' ? metricTextOf(metricId, byMetric.get(metricId) ?? null) : metricTextOf(metricId, byMetric.get(metricId) ?? null),
    }))
})

// ── 异常窗口：扫描规模 + 超阈窗口时间线（按时间顺序全量列出，不截断）────────────────────

type AnomalyMeta = {
  windowSlots?: number
  threshold?: { kind: string; value?: string; p?: string; resolvedValue?: string }
  scannedWindows?: number
  anomalousWindows?: number
}

const anomalyMeta = computed<AnomalyMeta | null>(() =>
  activeKind.value === 'anomaly-window' ? (seriesMeta.value as unknown as AnomalyMeta | null) : null
)

const anomalyThresholdText = computed(() => {
  const threshold = anomalyMeta.value?.threshold
  if (!threshold) return ''
  const resolved = threshold.resolvedValue === undefined ? '' : `（解析值 ${String(threshold.resolvedValue)}）`
  return threshold.kind === 'absolute' ? `绝对值阈值 ${threshold.value ?? ''}${resolved}` : `该序列自身分位数阈值 P=${threshold.p ?? ''}${resolved}`
})

type AnomalyWindowRow = { start: string; mean: string }

const anomalyWindowRows = computed<AnomalyWindowRow[]>(() => {
  if (activeKind.value !== 'anomaly-window') return []
  return ((result.value?.data.rows ?? []) as ResearchRow[])
    .filter((row) => row.metricId === 'research.anomaly-window-mean')
    .map((row) => ({
      start: String(row.windowStart ?? '—'),
      mean: metricTextOf('research.anomaly-window-mean', row.value ?? null),
    }))
})

// ── 同类日：目标日特征、候选排名（距离 + 逐特征贡献）、排除原因与不足原因 ────────────────

type SimilarDayMeta = {
  targetDate?: string
  targetValues?: Record<string, string | null>
  sufficient?: boolean
  availableCandidates?: number
  minCandidates?: number
  excluded?: Array<{ date: string; reason: string; detail: string }>
  features?: Array<{ id: string; weight: string; mean: string; std: string; zeroVariance: boolean; completeCandidates: number }>
  candidateWindow?: { first: string; last: string } | null
  insufficientReason?: string | null
}

const similarMeta = computed<SimilarDayMeta | null>(() =>
  activeKind.value === 'similar-day' ? (seriesMeta.value as unknown as SimilarDayMeta | null) : null
)

/** 同类日距离与标准化方法说明（随结果返回，方法版本随结果头展示）。 */
const similarMethod = computed<{ distance?: string; standardization?: string } | null>(() => {
  if (activeKind.value !== 'similar-day') return null
  const meta = seriesMeta.value as unknown as { method?: { distance?: string; standardization?: string } } | null
  return meta?.method ?? null
})

function featureLabelOf(featureId: string): string {
  return activePreset.value?.features?.find((feature) => feature.id === featureId)?.label ?? featureId
}

type SimilarTargetRow = { label: string; value: string }

const similarTargetRows = computed<SimilarTargetRow[]>(() => {
  const values = similarMeta.value?.targetValues
  if (!values) return []
  return Object.entries(values).map(([featureId, value]) => ({ label: featureLabelOf(featureId), value: value === null || value === undefined ? '—' : String(value) }))
})

type SimilarRankRow = { date: string; distance: string; contributions: Array<{ label: string; text: string }> }

const similarRankRows = computed<SimilarRankRow[]>(() => {
  if (activeKind.value !== 'similar-day') return []
  const distances = new Map<string, string>()
  const contributions = new Map<string, Map<string, string>>()
  for (const row of (result.value?.data.rows ?? []) as ResearchRow[]) {
    const date = String(row.candidateDate ?? '')
    if (!date) continue
    if (row.metricId === 'research.similar-day-distance') distances.set(date, metricTextOf('research.similar-day-distance', row.value ?? null))
    else if (row.metricId === 'research.feature-contribution') {
      const own = contributions.get(date) ?? new Map<string, string>()
      own.set(String(row.featureId ?? ''), metricTextOf('research.feature-contribution', row.value ?? null))
      contributions.set(date, own)
    }
  }
  return [...distances.entries()].map(([date, distance]) => ({
    date,
    distance,
    contributions: [...(contributions.get(date) ?? new Map<string, string>())].map(([featureId, text]) => ({
      label: featureLabelOf(featureId),
      text,
    })),
  }))
})

// ── 同进度比较：当日 vs 前一日同段 ────────────────────────────────────────────────────────

type ProgressMeta = {
  date?: string
  referenceDate?: string
  publishedSlots?: number
  comparedSlots?: number
  missingReferenceSlots?: number
  referenceMean?: string | null
}

const progressMeta = computed<ProgressMeta | null>(() =>
  activeKind.value === 'progress-comparison' ? (seriesMeta.value as unknown as ProgressMeta | null) : null
)

type ProgressRow = { label: string; unit: string; text: string }

const progressStatRows = computed<ProgressRow[]>(() => {
  if (activeKind.value !== 'progress-comparison') return []
  const byMetric = new Map<string, string | null>()
  for (const row of (result.value?.data.rows ?? []) as ResearchRow[]) byMetric.set(row.metricId ?? '', row.value ?? null)
  return (['supply.progress-change', 'supply.mean-power', 'sample.valid-count'] as const)
    .filter((metricId) => byMetric.has(metricId))
    .map((metricId) => ({ label: metricLabelOf(metricId), unit: metricUnitOf(metricId), text: metricTextOf(metricId, byMetric.get(metricId) ?? null) }))
})

// ── AI 解读（任务 15.3）：统一侧栏注册 + 取材纪律（CH03/D9）──────────────────────────────
// 研究结果与区块结果形状不同（无 runtime 六维），按同一纪律在页内构造：runKey 与当前
// 配置签名不一致的旧结果不进上下文；只传预设/方法/版本/样本摘要，不传 rows。

function researchAiBlock(): InsightAiEvidenceBlock | null {
  const preset = activePreset.value
  const res = runState.result
  if (!preset || !res) return null
  if (runState.runKey !== configSignature.value) return null // 过期结果：属于另一组参数，绝不提交
  const evidence: InsightAiEvidenceItem[] = [
    {
      id: 'research.result',
      text: `研究预设 ${preset.presetId}（${preset.title}）的结果版本 ${res.resultVersion}（读取版本集 ${res.readSetRef}，方法版本 ${res.methodVersion}）；` +
        `业务窗 ${res.businessWindow.start}~${res.businessWindow.end}；模式 ${res.mode}${res.asOf ? `（截止时点 ${res.asOf}）` : ''}；` +
        `样本 ${res.sample.observed} 条（资格${res.sample.eligibilityMet ? '已满足' : '未满足'}）`,
    },
  ]
  const filterParts = [
    res.mode === 'ex-ante' ? '模式：事前（显式截止时点）' : '模式：事后对照',
    ...(res.data.sampling ? [`抽样：${res.data.sampling.method}（总体 ${res.data.sampling.population}）`] : []),
  ]
  evidence.push({ id: 'research.filters', text: `筛选摘要：${filterParts.join('；')}` })
  if (res.method.notes.length) {
    evidence.push({ id: 'research.method', text: `方法说明（原文）：${res.method.notes.slice(0, 4).join('；')}` })
  }
  const excluded = Object.entries(res.exAnte?.perSource ?? {}).filter(([, d]) => d.excludedAfterAsOf > 0 || d.missingKnownAt > 0)
  if (excluded.length) {
    evidence.push({
      id: 'research.exante',
      text: `事前排除说明：${excluded.map(([sourceId, d]) => `${sourceId} 事后行排除 ${d.excludedAfterAsOf}、缺已知时间 ${d.missingKnownAt}`).join('；')}；这些数据不得表述为当时可得`,
    })
  }
  return {
    blockId: 'research',
    title: preset.title,
    sourceRefs: res.sourceRefs.map((ref) => ref.sourceId),
    evidence,
    runtime: {
      access: 'granted',
      availability: { state: 'complete' },
      // 研究统计不追踪数据新鲜度：诚实按 unknown 传入（AI 不得把统计表述为当前事实）。
      freshness: { state: 'unknown' },
    },
  }
}

const insightAi = useInsightAiPage({
  pageId: 'research',
  label: '云南研究工作台',
  collect: () => {
    const block = researchAiBlock()
    return block ? [block] : []
  },
  currentSignature: () => configSignature.value,
})

const onAiInterpret = (): void => {
  void insightAi.interpret()
}
</script>

<template>
  <div class="yr">
    <section class="yr__controls">
      <label class="yr__field">
        <span>业务日期窗</span>
        <InsightDateRange
          :model-value="ctx.businessWindow.value"
          :max-days="activePreset?.limits.maxDays ?? 0"
          data-testid="yr-window"
          @update:model-value="(next: { start: string; end: string }) => ctx.setBusinessWindow(next.start, next.end)"
        />
      </label>
      <label class="yr__field">
        <span>研究预设（只列已登记项）</span>
        <select class="yr-select" data-testid="yr-preset-select" :value="selectedPresetId" @change="selectPreset(($event.target as HTMLSelectElement).value)">
          <option value="">请选择研究问题</option>
          <option v-for="preset in presets" :key="preset.presetId" :value="preset.presetId" :disabled="!inputEligibilityOf(preset).eligible">
            {{ preset.title }}
          </option>
        </select>
      </label>
      <!-- AI 入口（15.3）：模型离线只隐藏入口，数据页不受影响（D9） -->
      <el-button
        v-if="insightAi.aiAvailable.value"
        type="primary"
        data-testid="yr-ai-entry"
        @click="onAiInterpret"
      >✨ AI 解读本页</el-button>
      <div class="yr__field yr__saved">
        <span>已保存分析（本公司，可查看与按新源重算）</span>
        <el-button plain data-testid="yr-saved-open" @click="savedVisible = true">查看已保存分析</el-button>
      </div>
    </section>

    <p class="yr__meta">{{ STAGE_TEXT }}</p>

    <!-- 红线（任务 13.7，RS08/D6.1）：价格响应类预设未登记——缺模型输入/方法/验证结果明确不可用；
         剩余需求代理沿用供需页口径：分析代理量，不是官方竞价空间，不构成因果或套利结论 -->
    <p class="yr__meta" data-testid="yr-price-response-note">{{ PRICE_RESPONSE_NOTE }}</p>

    <el-alert v-if="!presets.length" type="info" show-icon :closable="false" :title="NO_PRESET_TEXT" data-testid="yr-no-preset" />

    <!-- 承接洞察选区（RS08）：范围说明 + 返回原页（带回窗口/对象/来源恢复口径） -->
    <el-alert v-if="handoffBanner" type="info" show-icon :closable="false" :title="handoffBanner" data-testid="yr-handoff">
      <div class="yr__handoff-actions">
        <el-button size="small" plain data-testid="yr-handoff-return" @click="returnToOrigin">返回「{{ handoffOriginLabel }}」</el-button>
      </div>
    </el-alert>

    <el-alert v-if="ineligibleNotice" type="warning" show-icon :closable="false" :title="ineligibleNotice" data-testid="yr-ineligible" />

    <!-- 预设入口：名称 + 问题 + 缺口原因原文；资格不足可见但不可运行 -->
    <section v-if="presets.length" class="yr__presets" data-testid="yr-preset-list">
      <article
        v-for="preset in presets"
        :key="preset.presetId"
        class="yr__preset"
        :class="{ 'yr__preset--active': preset.presetId === selectedPresetId }"
      >
        <header class="yr__preset-head">
          <h3 class="yr__preset-title">{{ preset.title }}</h3>
          <span class="yr__tag">{{ KIND_LABELS[preset.kind] ?? preset.kind }}</span>
        </header>
        <p class="yr__preset-reason">{{ preset.gapReason }}</p>
        <p class="yr__preset-sample">
          最低样本 {{ preset.sample.minSamples }} 条<template v-if="preset.sample.minCoverageRatio"> · 最低覆盖率 {{ percentTextOf(preset.sample.minCoverageRatio) }}</template>
          · 一次最多 {{ preset.limits.maxDays }} 天
        </p>
        <p v-if="!inputEligibilityOf(preset).eligible" class="yr__preset-block" data-testid="yr-preset-ineligible">{{ inputEligibilityOf(preset).reason }}</p>
        <el-button size="small" type="primary" plain :disabled="!inputEligibilityOf(preset).eligible" @click="selectPreset(preset.presetId)">
          {{ inputEligibilityOf(preset).eligible ? '进入运行面板' : '输入不足' }}
        </el-button>
      </article>
    </section>

    <template v-if="activePreset">
      <!-- 运行面板：方法/期间/事前事后固定在上方 -->
      <section class="yr__panel" data-testid="yr-panel">
        <header class="yr__panel-head">
          <h3 class="yr__panel-title">{{ activePreset.title }}</h3>
          <span class="yr__tag">{{ KIND_LABELS[activePreset.kind] ?? activePreset.kind }}</span>
        </header>
        <blockquote class="yr__gap" data-testid="yr-gap">{{ activePreset.gapReason }}</blockquote>

        <div class="yr__config">
          <label class="yr__field">
            <span>分析模式</span>
            <span data-testid="yr-mode">
              <el-radio-group v-model="mode">
                <el-radio-button value="ex-post">事后（对照）</el-radio-button>
                <el-radio-button value="ex-ante">事前（截至时点）</el-radio-button>
              </el-radio-group>
            </span>
          </label>
          <label v-if="mode === 'ex-ante'" class="yr__field">
            <span>截止时点（该时点前已取得的资料才可用）</span>
            <span data-testid="yr-asof">
              <el-date-picker
                v-model="asOfLocal"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm"
                placeholder="选择截止时点"
              />
            </span>
          </label>

          <label class="yr__field">
            <span>指标（只可选预设登记项）</span>
            <span class="yr__inputs">
              <select v-for="input in inputOptions" :key="input.key" class="yr-select" disabled :data-testid="`yr-input-${input.key.replace(/[:.]/g, '-')}`" :aria-label="input.label">
                <option :value="input.label">{{ input.label }}（{{ input.note }}）</option>
              </select>
            </span>
          </label>

          <label v-if="activeKind === 'correlation'" class="yr__field">
            <span>分组维度（分组分别计算、组间不合并）</span>
            <select v-model="groupBy" class="yr-select" data-testid="yr-groupby">
              <option value="none">不分组（全样本汇总）</option>
              <option value="month">按日历月分组</option>
            </select>
          </label>

          <label v-if="activeKind === 'lag-comparison'" class="yr__field">
            <span>滞后槽位数（非零整数，正数把右侧序列向早处对齐）</span>
            <el-input-number v-model="lagSlots" :min="-RESEARCH_MAX_LAG_SLOTS" :max="RESEARCH_MAX_LAG_SLOTS" :step="1" data-testid="yr-lag" />
          </label>

          <template v-if="activeKind === 'anomaly-window'">
            <label class="yr__field">
              <span>窗口长度（槽位）</span>
              <el-input-number v-model="windowSlots" :min="1" :max="RESEARCH_MAX_WINDOW_SLOTS" :step="1" data-testid="yr-window-slots" />
            </label>
            <label class="yr__field">
              <span>阈值类型</span>
              <select v-model="thresholdKind" class="yr-select" data-testid="yr-threshold-kind">
                <option value="absolute">绝对值</option>
                <option value="quantile">该序列自身分位数</option>
              </select>
            </label>
            <label v-if="thresholdKind === 'absolute'" class="yr__field">
              <span>绝对阈值</span>
              <el-input-number v-model="thresholdValue" :step="1" data-testid="yr-threshold-value" />
            </label>
            <label v-else class="yr__field">
              <span>分位数 P（0 到 1 之间）</span>
              <el-input-number v-model="thresholdQuantile" :min="0.01" :max="1" :step="0.05" data-testid="yr-threshold-p" />
            </label>
          </template>

          <template v-if="activeKind === 'similar-day'">
            <label class="yr__field">
              <span>目标日（须在业务日期窗内）</span>
              <span data-testid="yr-target-date">
                <el-date-picker v-model="targetDate" type="date" value-format="YYYY-MM-DD" placeholder="选择目标日" />
              </span>
            </label>
            <label class="yr__field">
              <span>最小候选数（完整候选不足时如实说明）</span>
              <el-input-number v-model="minCandidates" :min="2" :step="1" data-testid="yr-min-candidates" />
            </label>
          </template>

          <!-- 参考日明示（任务 13.7）：同类日目标日是显式日期选择；同进度比较的参考日
               按登记固定为业务日前一日（reference.days=1）——运行前明示映射，换参考日
               请改业务日期窗；后端未登记参考日变换字段，本页不发明 -->
          <p v-if="activeKind === 'progress-comparison'" class="yr__hint" data-testid="yr-reference-day">
            参考日 {{ progressReferenceDay }}（按登记固定为业务日前一日，不自动另选参考日；换参考日请改上方业务日期窗）
          </p>
        </div>

        <div class="yr__run">
          <el-button type="primary" :disabled="!canRun || runState.loading" :loading="runState.loading" data-testid="yr-run" @click="runPreview">
            运行预览
          </el-button>
          <span class="yr__hint">{{ runBlocker || '运行只做预览：结果不落库、不保存' }}</span>
        </div>
      </section>

      <!-- 保存分析（任务 14.4，RS06）：写权限才显示入口；只提交定义与期望版本，服务端重算
           核对一致才冻结；409 提示先重新运行，未保存、绝不提示成功 -->
      <section v-if="canWriteCompany" class="yr__save" data-testid="yr-save-area">
        <el-button
          type="primary"
          plain
          data-testid="yr-save"
          :disabled="!canSave"
          :loading="saveState.saving"
          @click="saveDefinition"
        >
          保存分析
        </el-button>
        <span class="yr__hint" data-testid="yr-save-hint">{{ saveHint }}</span>
        <el-alert
          v-if="saveState.savedVersion !== null"
          type="success"
          show-icon
          :closable="false"
          :title="`已保存（版本 ${saveState.savedVersion}）`"
          data-testid="yr-save-success"
        />
        <el-alert
          v-if="saveState.error"
          type="error"
          show-icon
          :closable="false"
          :title="saveState.error"
          data-testid="yr-save-error"
        />
      </section>

      <!-- 结果：样本说明 + 图表/表 + 方法与口径原文 -->
      <section v-if="runState.error" class="yr__error" data-testid="yr-error">
        <el-alert type="error" show-icon :closable="false" title="研究预览未能运行">
          <p class="yr__reason" data-testid="yr-error-reason">{{ runState.error.message }}</p>
        </el-alert>
      </section>

      <section v-else-if="result" class="yr__result" data-testid="yr-result">
        <header class="yr__result-head">
          <h3 class="yr__panel-title">{{ KIND_LABELS[result.method.kind] ?? result.method.kind }}结果</h3>
          <span class="yr__tag" data-testid="yr-mode-badge">{{ result.mode === 'ex-post' ? EX_POST_BADGE : EX_ANTE_BADGE }}</span>
        </header>

        <p class="yr__sample" data-testid="yr-sample">
          样本 {{ result.sample.primarySamples }} 条（最低要求 {{ result.sample.conditions.minSamples }} 条<template v-if="result.sample.conditions.minCoverageRatio"> · 最低覆盖率 {{ percentTextOf(result.sample.conditions.minCoverageRatio) }}</template>）
          · 观测 {{ result.sample.observed }} 个 · 方法版本 {{ result.methodVersion }}
        </p>

        <el-alert
          v-if="!result.sample.eligibilityMet"
          type="warning"
          show-icon
          :closable="false"
          title="样本资格未满足：结果只按实际共同样本给出，未补齐、未截断"
          data-testid="yr-eligibility"
        />

        <el-alert
          v-if="exAnteInfo"
          type="info"
          show-icon
          :closable="false"
          :title="`事前模式：${exAnteInfo.note}`"
          data-testid="yr-exante-note"
        />
        <el-alert v-for="(text, index) in exAnteExclusions" :key="`xa-${index}`" type="warning" show-icon :closable="false" :title="text" />

        <div class="yr__inputs-summary">
          <div v-for="input in result.inputs" :key="input.id" class="yr__input-summary">
            <span class="yr__input-label">{{ input.label }}</span>
            <span>有效槽位 {{ input.validSlots }}<template v-if="input.expectedSlots !== null"> / 期望 {{ input.expectedSlots }}</template>
              · 覆盖 {{ percentTextOf(input.coverageRatio) }}</span>
          </div>
        </div>

        <!-- 相关：汇总 + 分月（预览契约不下发散点数据，前端不重算口径） -->
        <template v-if="activeKind === 'correlation' && correlationMeta?.overall">
          <div class="yr__cards">
            <div class="yr__card">
              <h4>汇总{{ metricLabelOf('research.pearson-r') }}</h4>
              <p class="yr__card-value" data-testid="yr-correlation-r">
                {{ metricTextOf('research.pearson-r', correlationMeta.overall.r) }}<span v-if="metricUnitOf('research.pearson-r')" class="yr__unit">（{{ metricUnitOf('research.pearson-r') }}）</span>
              </p>
              <p class="yr__card-note">
                {{ metricLabelOf('research.covariance') }} {{ metricTextOf('research.covariance', correlationMeta.overall.covariance) }} · 共同样本 {{ correlationMeta.overall.samples }} 条 · 覆盖 {{ percentTextOf(correlationMeta.overall.coverageRatio) }}
              </p>
              <p v-if="correlationMeta.overall.window" class="yr__card-note">配对窗口 {{ correlationMeta.overall.window.start }} 至 {{ correlationMeta.overall.window.end }}</p>
              <p v-if="correlationMeta.overall.reason" class="yr__card-note" data-testid="yr-correlation-reason">{{ correlationMeta.overall.reason }}</p>
            </div>
          </div>
          <table v-if="correlationGroupRows.length" class="yr__table" data-testid="yr-correlation-groups">
            <caption>按日历月分组（组间不合并；与汇总方向不同时以方法说明提示结构差异）</caption>
            <thead>
              <tr><th>月份</th><th>{{ metricLabelOf('research.pearson-r') }}</th><th>{{ metricLabelOf('research.covariance') }}</th><th>{{ metricLabelOf('sample.valid-count') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in correlationGroupRows" :key="row.key">
                <td>{{ row.key }}</td><td>{{ row.r }}</td><td>{{ row.covariance }}</td><td>{{ row.samples }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- 滞后比较 -->
        <template v-else-if="activeKind === 'lag-comparison'">
          <div class="yr__cards">
            <div class="yr__card">
              <h4>滞后方向（显式给出，不搜索最优滞后）</h4>
              <p class="yr__card-note" data-testid="yr-lag-direction">{{ lagMeta?.direction }}</p>
              <p v-if="lagMeta?.window" class="yr__card-note">配对窗口 {{ lagMeta.window?.start }} 至 {{ lagMeta.window?.end }}</p>
            </div>
            <div v-for="row in lagStatRows" :key="row.label" class="yr__card">
              <h4>{{ row.label }}</h4>
              <p class="yr__card-value">{{ row.text }}<span v-if="row.unit" class="yr__unit">（{{ row.unit }}）</span></p>
            </div>
          </div>
        </template>

        <!-- 异常窗口：时间线全量列出 -->
        <template v-else-if="activeKind === 'anomaly-window' && anomalyMeta">
          <p class="yr__card-note" data-testid="yr-anomaly-summary">
            扫描窗口 {{ anomalyMeta.scannedWindows }} 个（窗口长度 {{ anomalyMeta.windowSlots }} 槽位），达到阈值 {{ anomalyMeta.anomalousWindows }} 个 · {{ anomalyThresholdText }}
            <template v-if="result.data.sampling"> · {{ result.data.sampling.method }}（总体 {{ result.data.sampling.population }}）</template>
          </p>
          <el-alert v-if="!anomalyWindowRows.length" type="info" :closable="false" title="所选窗口内没有达到阈值的窗口" />
          <table v-else class="yr__table" data-testid="yr-anomaly-table">
            <caption>超阈窗口时间线（全部列出，不截断；窗口均值为算术平均）</caption>
            <thead>
              <tr><th>窗口起点</th><th>{{ metricLabelOf('research.anomaly-window-mean') }}（{{ metricUnitOf('research.anomaly-window-mean') }}）</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in anomalyWindowRows" :key="row.start">
                <td>{{ row.start }}</td><td>{{ row.mean }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- 同类日：目标日特征 + 候选表 + 排除与不足原因 -->
        <template v-else-if="activeKind === 'similar-day' && similarMeta">
          <div class="yr__cards">
            <div class="yr__card">
              <h4>目标日 {{ similarMeta.targetDate }} 的特征值（完整日才有效）</h4>
              <p v-for="row in similarTargetRows" :key="row.label" class="yr__card-note">{{ row.label }}：{{ row.value }}</p>
            </div>
            <div class="yr__card">
              <h4>特征与标准化（只在完整候选集合内计算）</h4>
              <p v-for="feature in similarMeta.features" :key="feature.id" class="yr__card-note">
                {{ featureLabelOf(feature.id) }}：权重 {{ feature.weight }} · 候选均值 {{ feature.mean }} · 标准差 {{ feature.std }}<template v-if="feature.zeroVariance"> · 零方差（z 记 0）</template>
              </p>
              <p class="yr__card-note">距离方法：{{ similarMethod?.distance ?? '加权绝对距离' }}</p>
              <p class="yr__card-note">标准化方法：{{ similarMethod?.standardization ?? 'z-score' }}</p>
            </div>
          </div>
          <p class="yr__card-note" data-testid="yr-similar-summary">
            完整候选 {{ similarMeta.availableCandidates }} 个（最少需要 {{ similarMeta.minCandidates }} 个）
            <template v-if="similarMeta.candidateWindow"> · 候选窗 {{ similarMeta.candidateWindow.first }} 至 {{ similarMeta.candidateWindow.last }}</template>
          </p>
          <el-alert
            v-if="!similarMeta.sufficient && similarMeta.insufficientReason"
            type="warning"
            show-icon
            :closable="false"
            :title="similarMeta.insufficientReason"
            data-testid="yr-similar-insufficient"
          />
          <table v-if="similarRankRows.length" class="yr__table" data-testid="yr-similar-table">
            <caption>同类日候选（按加权距离升序；距离只是形态相似度，不承诺价格预测）</caption>
            <thead>
              <tr>
                <th>候选日</th>
                <th>{{ metricLabelOf('research.similar-day-distance') }}</th>
                <th v-for="feature in activePreset.features ?? []" :key="feature.id">{{ metricLabelOf('research.feature-contribution') }}·{{ feature.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in similarRankRows" :key="row.date">
                <td>{{ row.date }}</td>
                <td>{{ row.distance }}</td>
                <td v-for="feature in activePreset.features ?? []" :key="feature.id">
                  {{ row.contributions.find((item) => item.label === feature.label)?.text ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="similarMeta.excluded?.length" data-testid="yr-similar-excluded">
            <h4>被排除的候选日（缺特征不补值）</h4>
            <ul class="yr__list">
              <li v-for="item in similarMeta.excluded" :key="item.date">{{ item.date }}：{{ item.detail }}</li>
            </ul>
          </div>
        </template>

        <!-- 同进度比较 -->
        <template v-else-if="activeKind === 'progress-comparison' && progressMeta">
          <div class="yr__cards">
            <div class="yr__card">
              <h4>{{ progressMeta.date }} 较 {{ progressMeta.referenceDate }} 同进度</h4>
              <p v-for="row in progressStatRows" :key="row.label" class="yr__card-value">
                {{ row.label }}：{{ row.text }}<span v-if="row.unit" class="yr__unit">（{{ row.unit }}）</span>
              </p>
              <p class="yr__card-note" data-testid="yr-progress-summary">
                当日已发布 {{ progressMeta.publishedSlots }} 段 · 参与 {{ progressMeta.comparedSlots }} 段 · 前一日缺参照 {{ progressMeta.missingReferenceSlots }} 段
              </p>
            </div>
          </div>
        </template>

        <!-- 多指标量纲分面（任务 13.7，RS08、D6.1）：统计行按登记量纲拆面并列——
             一个量纲一张图一根轴，不同量纲各拆一张图（不共轴、不做双 Y 轴混标）；
             面内序列显隐、分面顺序是会话内视图状态（不进请求、不进保存定义） -->
        <template v-if="statFacetControls.length">
          <div class="yr__facets">
            <!-- 分面骨架按控制面（不过滤显隐）渲染：图有可见序列才出图，控件永远在场 -->
            <section v-for="(facet, index) in statFacetControls" :key="facet.unit" class="yr__facet" data-testid="yr-facet">
              <header class="yr__facet-head">
                <h4>{{ statFacetTitleOf(facet.unit) }}</h4>
                <span class="yr__facet-actions">
                  <el-button size="small" text :disabled="index === 0" data-testid="yr-facet-move-up" @click="moveFacet(index, -1)">上移</el-button>
                  <el-button size="small" text :disabled="index === statFacetControls.length - 1" data-testid="yr-facet-move-down" @click="moveFacet(index, 1)">下移</el-button>
                </span>
              </header>
              <div class="yr__facet-toggles">
                <label v-for="item in facet.items" :key="item.metricId" class="yr__facet-toggle">
                  <input
                    type="checkbox"
                    :checked="!hiddenMetricIds.has(item.metricId)"
                    :data-testid="`yr-facet-series-${item.metricId.replace(/\./g, '-')}`"
                    @change="toggleMetricVisibility(item.metricId, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ item.label }}
                </label>
              </div>
              <ResearchStatFacet v-if="statFacetByUnit.get(facet.unit)" :facet="statFacetByUnit.get(facet.unit)!" />
            </section>
          </div>
          <p class="yr__hint" data-testid="yr-view-scope-note">{{ VIEW_SCOPE_NOTE }}</p>
        </template>

        <!-- 方法与口径说明（后端原文，含无置信区间与无因果声明） -->
        <div class="yr__notes" data-testid="yr-method-notes">
          <h4>方法与口径（后端原文）</h4>
          <ul class="yr__list">
            <li v-for="(note, index) in methodNotes" :key="index">{{ note }}</li>
          </ul>
        </div>
      </section>
    </template>

    <!-- 已保存分析：列表/查看对所有人开放（公司隔离、原样只读）；重算入口按写权限显隐 -->
    <InsightResearchSavedDialog v-model="savedVisible" :can-write="canWriteCompany" />
  </div>
</template>

<style scoped>
.yr {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.yr__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.yr__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 240px;
}
.yr__field > span:first-child {
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
}
.yr__saved {
  justify-content: flex-end;
}
.yr__meta {
  margin: 0;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
}
.yr__presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.yr__preset {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.yr__preset--active {
  border-color: var(--el-color-primary);
}
.yr__preset-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.yr__preset-title {
  margin: 0;
  font-size: var(--font-md);
}
.yr__tag {
  flex: none;
  font-size: var(--font-tb-12);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 4px;
  padding: 0 6px;
}
.yr__preset-reason {
  margin: 0;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-regular);
}
.yr__preset-sample,
.yr__preset-block {
  margin: 0;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
}
.yr__preset-block {
  color: var(--el-color-warning);
}
.yr__panel,
.yr__save,
.yr__error,
.yr__result {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.yr__panel-head,
.yr__result-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.yr__panel-title {
  margin: 0;
  font-size: var(--font-lg);
}
.yr__gap {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid var(--el-color-info-light-5);
  background: var(--el-fill-color-lighter);
  font-size: var(--font-tb-12);
  color: var(--el-text-color-regular);
}
.yr__config {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
}
.yr__inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.yr-select {
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 0 8px;
  font-size: var(--font-sm);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
}
.yr-select:disabled {
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  cursor: not-allowed;
}
.yr__run,
.yr__save {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.yr__save {
  border-style: dashed;
}
.yr__hint {
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
}
.yr__reason {
  margin: 0;
  white-space: pre-wrap;
}
.yr__sample {
  margin: 0;
  font-size: var(--font-sm);
}
.yr__inputs-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.yr__input-summary {
  display: flex;
  flex-direction: column;
  font-size: var(--font-tb-12);
}
.yr__input-label {
  font-weight: 600;
}
.yr__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.yr__card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.yr__card h4 {
  margin: 0;
  font-size: var(--font-sm);
}
.yr__card-value {
  margin: 0;
  font-size: var(--font-xl);
}
.yr__card-note {
  margin: 0;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}
.yr__unit {
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
}
.yr__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-sm);
}
.yr__table caption {
  text-align: left;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-secondary);
  padding-bottom: 4px;
}
.yr__table th,
.yr__table td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px 8px;
  text-align: left;
}
.yr__list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--font-tb-12);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.yr__notes h4 {
  margin: 0 0 4px;
  font-size: var(--font-sm);
}
/* 量纲分面：不同量纲各拆一张图并列（窄屏纵排），面内一套显隐开关 + 单轴图 */
.yr__facets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}
@media (max-width: 760px) {
  .yr__facets {
    grid-template-columns: 1fr;
  }
}
.yr__facet {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.yr__facet-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.yr__facet-head h4 {
  margin: 0;
  font-size: var(--font-sm);
}
.yr__facet-actions {
  display: flex;
  gap: 4px;
}
.yr__facet-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.yr__facet-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-tb-12);
  color: var(--el-text-color-regular);
}
.yr__handoff-actions {
  margin-top: 8px;
}
</style>
