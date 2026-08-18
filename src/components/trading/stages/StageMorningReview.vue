<script setup lang="ts">
// S1 晨会复盘（08:00–08:30）—— 一天从收口昨日开始
//
// 复盘对象是**昨天为「今天交割」申报的那张单**（标的日 = 今日作业标的日的前一天）：
// 它的出清结果昨晚已出，是今早唯一有完整事实可对的循环。本面板把四件事摆在一起：
//   ① 昨单的**中标情况**：申报 vs 出清（analyzeClearing 真算，前端纯函数）；
//   ② 昨单的**执行偏差**：申报 vs 实际（后端 quant /review 权威实现，含考核电量与罚款估算）；
//   ③ 昨日决策日志的条目调阅 + 填写率与 P10–P90 命中率（链上事实）；
//   ④ 交易员写下偏差主因 + 今日不重犯要点 → 写回**今日**单据的 preflight.morningReview。
// 没有昨单就如实说「无可复盘对象」，仍允许写要点（首个交易日也要开工）。
//
// ①②是**两个不同的量，不可互相替代**：中标率答「我报的量中了多少」，执行偏差答「我实际
// 干的和我报的差多少、要交多少考核费」。只看中标率会漏掉「全中但执行跑偏」的那类亏损。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { History, Save, Scale, TriangleAlert } from 'lucide-vue-next'
import {
  listDeclarations,
  savePreflight,
  STATUS_LABEL,
  type DeclarationOrder
} from '@/services/declarations'
import { analyzeClearing, type ClearingAnalysis } from '@/services/trading/clearingReview'
import {
  classifyReviewError,
  fetchReview,
  type ReviewFailure,
  type ReviewResult
} from '@/services/quant/quantClient'
import { loadLog, PROTOTYPE_STORAGE_NOTICE } from '@/services/trading/decisionLogStore'
import { coverageOf, hitRate } from 'shared/trading-rules/decision-log.mjs'
import {
  aggregatePeakFlatValley,
  causeIdOfLabel,
  causeLabelOf,
  DEVIATION_CAUSES,
  DEVIATION_RESPONSIBILITY,
  isPendingCause,
  morningWindowState,
  MORNING_WINDOW_NOTE,
  responsibilityLabelOf,
  validateMorningReview,
  type PeakFlatValleyResult
} from 'shared/trading-rules/morning-review.mjs'
import { getSettlementRuleSpec } from '@/rules'
import { shiftIsoDate } from 'shared/trading-rules/trading-calendar.mjs'
import { reviewFocusOf } from 'shared/trading-rules/position-review.mjs'
import { activeStanceType } from '@/services/stance/stanceContext'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '@/composables/useRegionReload'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import ReviewThreeQuestions from './ReviewThreeQuestions.vue'
import OvernightReportCard from './OvernightReportCard.vue'
import ReviewTodoBadge from './ReviewTodoBadge.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()
const router = useRouter()

/** 复盘对象的标的日 = 今日标的日的前一天。 */
const reviewedDate = computed(() => {
  const d = new Date(`${props.targetDate}T00:00:00+08:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

// ── 作业窗口提示（公司内控规范，非市场规则：只提示、不拦）───────────────────
const now = new Date()
const windowState = morningWindowState(now.getHours() * 60 + now.getMinutes())

const reviewed = ref<DeclarationOrder | null>(null)
const loading = ref(false)
const loadError = ref('')

let loadToken = 0
async function loadReviewed() {
  const token = ++loadToken
  loading.value = true
  loadError.value = ''
  reviewed.value = null
  try {
    const rows = await listDeclarations({ date: reviewedDate.value, limit: 20 })
    if (token !== loadToken) return
    reviewed.value = rows.length ? rows.reduce((a, c) => (c.updatedAt > a.updatedAt ? c : a)) : null
  } catch (e) {
    if (token !== loadToken) return
    loadError.value = e instanceof Error ? e.message : '昨日申报单读取失败'
  } finally {
    if (token === loadToken) loading.value = false
  }
}
onMounted(loadReviewed)
watch(reviewedDate, loadReviewed)

/** ① 中标情况：申报 vs 出清。两条曲线都在才算，缺一如实标注。 */
const analysis = computed<ClearingAnalysis | null>(() => {
  const r = reviewed.value
  if (!r?.energyCurveMwh96?.length || !r.clearing?.clearedCurveMwh96?.length) return null
  try {
    return analyzeClearing(r.energyCurveMwh96, r.clearing.clearedCurveMwh96)
  } catch {
    return null
  }
})

// ── ② 执行偏差：申报 vs 实际（后端权威实现）──────────────────────────────────
// 口径与复盘中心 /xhjy/review 完全一致：申报侧传昨单曲线快照，实际侧由后端按
// serving-route 的 actual_energy 路由取（Epic #1485：山西经 sdpt_zptqx type='2' 接入）。
// **未登记路由的地区诚实空态**——不回落、不串读，云南的三段式结算口径是另一个端点。
// 前端不自算第二套偏差：口径分歧比没有数字更贵。
const execReview = ref<ReviewResult | null>(null)
const execFailure = ref<ReviewFailure | null>(null)
const execLoading = ref(false)

let execToken = 0
async function loadExecDeviation() {
  const r = reviewed.value
  const token = ++execToken
  execReview.value = null
  execFailure.value = null
  if (!r?.energyCurveMwh96?.length) return
  execLoading.value = true
  try {
    const result = await fetchReview({
      date: reviewedDate.value,
      declared_mwh_96: r.energyCurveMwh96,
      declaration_id: r.id
    })
    if (token !== execToken) return
    execReview.value = result
  } catch (e) {
    if (token !== execToken) return
    execFailure.value = classifyReviewError(e)
  } finally {
    if (token === execToken) execLoading.value = false
  }
}
watch(reviewed, loadExecDeviation)
// 实际侧强地区相关（只有山西接线），切地区后不重载会把上一个地区的结论留在屏幕上。
onRegionChange(() => {
  void loadReviewed()
})

/** 偏差率 = 总偏差电量 / 申报总量；申报为 0 时无从计率。 */
const execDeviationPct = computed<number | null>(() => {
  const r = execReview.value
  const declaredTotal = reviewed.value?.energyCurveMwh96?.reduce((a, b) => a + b, 0) ?? 0
  if (!r || declaredTotal <= 0) return null
  return r.deviation.total_abs_deviation_mwh / declaredTotal
})

// ── ③ 昨日决策日志：条目调阅（不只是两个统计数字）────────────────────────────
const log = loadLog()
const logCoverage = computed(() => coverageOf(log, reviewedDate.value, 3))
const logHits = computed(() => hitRate(log))
/** 昨日标的日的条目，按序号排列——晨会要「回顾」，就得看得到写了什么。 */
const reviewedEntries = computed(() =>
  log.filter((e) => e.targetDate === reviewedDate.value).sort((a, b) => a.seq - b.seq)
)
const showEntries = ref(false)

// ── ④ 复盘结论录入与写回 ────────────────────────────────────────────────────
// 主因分类权威在 shared/trading-rules/morning-review.mjs（前后端与 AI 提示词同一份）。
// 双分类（需求 1）：cause 答「偏差为什么发生」（物理成因），responsibility 答
// 「偏差谁该负责」（模板七四分类）——两个维度都填，写回时同时留痕。
const cause = ref<string>('')
const responsibility = ref<string>('')
const lessons = ref('')
const validation = computed(() =>
  validateMorningReview({
    cause: cause.value,
    lessons: lessons.value,
    responsibility: responsibility.value || undefined
  })
)
const causeHint = computed(() => DEVIATION_CAUSES.find((c) => c.id === cause.value) ?? null)
const responsibilityHint = computed(
  () => DEVIATION_RESPONSIBILITY.find((r) => r.id === responsibility.value) ?? null
)

// ── AI 辅助填报：偏差归因与今日要点是**人工经验判断**（不是取数）──────────────
// 注入的是已算好的事实：中标情况（analyzeClearing）+ 执行偏差（后端 review）+ 决策日志覆盖。
// AI 据此判断「主因是什么、今天该注意什么」——这两个字段没有数据库可查，正是它该干的活。
const assistContext = computed(() => ({
  reviewedDate: reviewedDate.value,
  hasReviewedDeclaration: Boolean(reviewed.value),
  clearingAnalysis: analysis.value
    ? {
        clearRate: analysis.value.clearRate,
        totalDeclaredMwh: analysis.value.totalDeclaredMwh,
        totalClearedMwh: analysis.value.totalClearedMwh,
        worstSlots: analysis.value.worstSlots,
        needsRealtimeAction: analysis.value.needsRealtimeAction,
        summary: analysis.value.summary
      }
    : null,
  executionDeviation: execReview.value
    ? {
        points: execReview.value.deviation.points,
        totalAbsDeviationMwh: execReview.value.deviation.total_abs_deviation_mwh,
        assessedMwh: execReview.value.deviation.assessed_mwh,
        estimatedPenaltyYuan: execReview.value.deviation.estimated_penalty_yuan,
        worstPoint: execReview.value.deviation.worst_point,
        actualSource: execReview.value.actual_source,
        caliberCaveats: execReview.value.caliber_caveats
      }
    : null,
  executionDeviationUnavailable: execFailure.value
    ? { kind: execFailure.value.kind, title: execFailure.value.title }
    : null,
  decisionLog: {
    recorded: logCoverage.value.recorded,
    expected: logCoverage.value.expected,
    meetsVeto: logCoverage.value.meetsVeto,
    hitRate: logHits.value.rate
  },
  candidateCauses: DEVIATION_CAUSES.map((c) => ({ label: c.label, hint: c.hint }))
}))
const ASSIST_LABELS = { cause: '偏差主因', lessons: '今日要点' }

function applyAssist(s: Record<string, unknown>) {
  // AI 返回中文标签，落库前映射回 id；映射不中就不填（不猜、不模糊匹配）。
  const id = causeIdOfLabel(s.cause)
  if (id) cause.value = id
  if (typeof s.lessons === 'string' && s.lessons.trim()) lessons.value = s.lessons.trim()
}
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')

const written = computed(() => props.declaration?.preflight?.morningReview ?? null)

// ── 立场复盘焦点（#2005）：同一张偏差表，三类身份问的问题不同 ────────────────
const reviewFocus = computed(() => reviewFocusOf(activeStanceType.value))

// ── 复盘体系三件套（Epic #2033 · #2040，全部只读/跳转，零新写回口径）──────────
// 三问数字复用 ①② 既有取数；环比昨日读昨日晨会写回链（昨单 preflight.morningReview
// 记录的正是昨日 S1 复盘的执行偏差）；回测收益取 execReview.backtest 段。
const threeQuestionsPnl = computed(() =>
  execReview.value
    ? {
        daRevenueYuan: execReview.value.backtest.da_revenue_yuan,
        spreadPnlYuan: execReview.value.backtest.da_rt_spread_pnl_yuan ?? null
      }
    : null
)
/** 昨日晨会写回的执行偏差（挂在昨单 preflight 上，正是今天 reviewed 这张单）。 */
const prevDeviationMwh = computed(() => reviewed.value?.preflight?.morningReview?.executionDeviationMwh ?? null)
const prevReviewedDate = computed(() => shiftIsoDate(reviewedDate.value, -1))

// ── 异常分支（手册：当日未写日志 → 次日晨会强制补写）─────────────────────────
// 判据：昨日有申报单可复盘（reviewed 存在）但决策日志链上没有归属昨日标的日的条目。
// 拦截写回（不是提示完就算）——补写入口在 S7（日志归属日期切到昨日即补写模式）。
const yesterdayIso = computed(() => shiftIsoDate(props.targetDate, -1))
const yesterdayLogMissing = computed(() => {
  if (!reviewed.value) return false
  return !loadLog().some((e) => e.targetDate === yesterdayIso.value)
})

// ── 六维摘要（需求 5）：每维一行，数据从各面板 computed 汇总，不新增数据源 ────
// 首期 ①④⑥ 有真实数据；②策略/③市场/⑤风险 显示「待数据接入」占位（第 2 期 #2016/#2012/#2015）。
type SixDimState = { key: string; name: string; summary: string; ready: boolean; note?: string }

// ── 需求 4：决策三问状态（面板③逐条填写，写回 decisionReview）────────────────
type ThreeQ = { info: 'ok' | 'lacking'; logic: 'ok' | 'flawed'; emotion: 'calm' | 'biased'; note?: string }
/** 展开/填写复盘单的那条决策 id；表格里点行切换。 */
const openReviewId = ref<string>('')
const threeQ = ref<Record<string, ThreeQ>>({})
function toggleReview(id: string) {
  openReviewId.value = openReviewId.value === id ? '' : id
}
/** 取该条的三问状态；展开复盘单时惰性初始化（默认三态均为「正常」侧，交易员只需改存疑项）。 */
function qz(id: string): ThreeQ {
  if (!threeQ.value[id]) {
    threeQ.value = { ...threeQ.value, [id]: { info: 'ok', logic: 'ok', emotion: 'calm', note: '' } }
  }
  return threeQ.value[id]!
}
function entryThreeQ(id: string): ThreeQ | null {
  const q = threeQ.value[id]
  return q ? q : null
}
/** 三问图标态：ok→✓ calm→✓，lacking/flawed/biased→✗；未填→·。 */
function qMark(v: string | undefined, good: string): string {
  if (!v) return '·'
  return v === good ? '✓' : '✗'
}
/** 已复盘 = 三问三项均已作答。 */
const decisionReviewComputed = computed(() => {
  const entries = reviewedEntries.value
  const answered = entries.filter((e) => {
    const q = threeQ.value[e.id]
    return q?.info && q?.logic && q?.emotion
  })
  return {
    totalDecisions: entries.length,
    reviewedDecisions: answered.length,
    threeQuestions: answered.map((e) => ({ decisionId: e.id, ...threeQ.value[e.id]! }))
  }
})

// ── 需求 3：结果三层拆分（面板① 上方 tab）───────────────────────────────────
type LayerTab = 'product' | 'period' | 'trades'
const layerTab = ref<LayerTab>('product')
const LAYER_TABS: Array<{ id: LayerTab; label: string }> = [
  { id: 'product', label: '分品种' },
  { id: 'period', label: '分时段（峰平谷）' },
  { id: 'trades', label: '单笔 TOP5' }
]

/** 峰平谷时段定义取地区结算规则包 timeSegmentFactors——各省不同，不硬编码。 */
const peakFlatDef = computed(() => {
  const spec = getSettlementRuleSpec(currentRegion.value.id)
  return spec?.timeSegmentFactors ?? null
})
/** 云南的 timeSegmentFactors 是「零售目录电价分时参考，非现货结算乘子」——口径标注跟随规则包 notes。 */
const peakFlatNote = computed(() => {
  const spec = getSettlementRuleSpec(currentRegion.value.id)
  if (!spec) return '该地区峰平谷时段定义未登记（结算规则包无 timeSegmentFactors），分时段层不可用。'
  return `${spec.regionId} 峰平谷时段定义：${spec.timeSegmentFactors
    .map((s) => `${s.segment} ${s.hours.length} 小时`)
    .join(' / ')}。口径为${spec.notes.find((n) => n.includes('timeSegmentFactors')) ? '分时展示参考（非现货结算乘子）' : '结算规则包口径'}。`
})
const peakFlatRows = computed<PeakFlatValleyResult[]>(() => {
  const curve = reviewed.value?.energyCurveMwh96
  if (!curve?.length || !peakFlatDef.value) return []
  return aggregatePeakFlatValley(curve, peakFlatDef.value)
})

/**
 * 分品种层：日前现货有真实数据（回测口径日前收益）；其余品种无数据源，
 * 显示占位行并标 MOCK——不编造数字（需求 3 数据边界）。
 */
const byProductRows = computed(() => {
  const daRevenue = execReview.value?.backtest?.da_revenue_yuan
  return [
    {
      product: '日前现货',
      revenue: typeof daRevenue === 'number' ? daRevenue : null,
      share: typeof daRevenue === 'number' && daRevenue !== 0 ? 100 : null,
      sourceType: 'REAL' as const,
      note: typeof daRevenue === 'number' ? '回测口径日前收益（backtest.da_revenue_yuan）' : '待执行偏差取数（/review backtest 段）'
    },
    ...(['年度长协', '月度竞价', '旬度交易', '实时市场', '辅助服务'] as const).map((p) => ({
      product: p,
      revenue: null,
      share: null,
      sourceType: 'MOCK' as const,
      note: '待数据接入 #1968'
    }))
  ]
})

// ── 需求 6：角色分流（顶部角色 select + 角色专属区）───────────────────────────
type RoleId = 'retail' | 'storage' | 'renewable'
const role = ref<RoleId>('retail')
const ROLE_OPTIONS: Array<{ id: RoleId; label: string }> = [
  { id: 'retail', label: '售电公司' },
  { id: 'storage', label: '储能' },
  { id: 'renewable', label: '新能源电厂' }
]
/**
 * 售电角色专属（R1 代理购电偏差 + R4 考核成本）：现有偏差数据可复用（申报 vs 实际）。
 * 储能/新能源待数据接入 #1968——tab 可见但内容标待接入。
 */
const roleSpecificRows = computed(() => {
  if (role.value === 'retail') {
    const r = execReview.value
    return [
      { k: '申报电量', v: reviewed.value ? reviewed.value.energyCurveMwh96.reduce((a, b) => a + b, 0).toFixed(1) + ' MWh' : '—', real: Boolean(reviewed.value) },
      { k: '实际用电（R1）', v: r ? `偏差 ${r.deviation.total_abs_deviation_mwh.toFixed(2)} MWh 口径反推` : '—', real: Boolean(r) },
      { k: '偏差量（R1）', v: r ? r.deviation.total_abs_deviation_mwh.toFixed(2) + ' MWh' : '—', real: Boolean(r) },
      { k: '偏差率（R1）', v: execDeviationPct.value !== null ? (execDeviationPct.value * 100).toFixed(2) + '%' : '—', real: execDeviationPct.value !== null },
      { k: '考核费用（R4）', v: r && r.deviation.estimated_penalty_yuan > 0 ? r.deviation.estimated_penalty_yuan.toFixed(0) + ' 元' : '0 元（估算）', real: Boolean(r) },
      { k: '责任归属（R4）', v: responsibility.value ? responsibilityLabelOf(responsibility.value) : '未判定', real: true }
    ]
  }
  if (role.value === 'storage') {
    return [
      { k: '套利收益（E3/S1 模板）', v: '待数据接入', real: false },
      { k: 'SOC 健康（E1/E2 模板）', v: '待数据接入', real: false }
    ]
  }
  return [
    { k: '出力预测准确率（N1，24 时段逐时）', v: '待数据接入', real: false },
    { k: '弃电率 / 偏差考核（N2/N3）', v: '待数据接入', real: false }
  ]
})

/** 六维摘要行数据（需求 5）。 */
const sixDims = computed<SixDimState[]>(() => {
  const devMwh = execReview.value?.deviation.total_abs_deviation_mwh ?? null
  const dr = decisionReviewComputed.value
  return [
    {
      key: 'result',
      name: '① 结果',
      summary: analysis.value?.clearRate != null ? `中标率 ${(analysis.value.clearRate * 100).toFixed(1)}%，日前现货为主` : '中标率 —',
      ready: Boolean(reviewed.value),
      note: reviewed.value ? undefined : '昨日无申报单'
    },
    { key: 'strategy', name: '② 策略', summary: '待策略库接入', ready: false, note: '#2016（第 2 期）' },
    { key: 'market', name: '③ 市场', summary: '待 S2/S7 数据联动', ready: false, note: '#2012（第 2 期）' },
    {
      key: 'deviation',
      name: '④ 偏差',
      summary:
        devMwh != null
          ? `偏差 ${devMwh.toFixed(2)} MWh，主因：${cause.value ? causeLabelOf(cause.value) : written.value?.cause ? causeLabelOf(written.value.cause) : '未判定'}`
          : '偏差 —（执行偏差未取到）',
      ready: devMwh != null
    },
    { key: 'risk', name: '⑤ 风险', summary: '待风控事件库接入', ready: false, note: '#2015（第 2 期）' },
    {
      key: 'decision',
      name: '⑥ 决策',
      summary: dr.totalDecisions ? `${dr.totalDecisions} 条决策 · 已复盘 ${dr.reviewedDecisions} 条` : '无决策记录',
      ready: dr.totalDecisions > 0
    }
  ]
})
/** 六维摘要行点击展开对应区块（滚动定位，区块本身常驻——不折叠已有面板，保持现有作业动线）。 */
function jumpToDim(key: string) {
  const map: Record<string, string> = { result: 'mr-panel-result', deviation: 'mr-panel-deviation', decision: 'mr-panel-decision' }
  const id = map[key]
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function writeBack() {
  if (!props.declaration || !validation.value.ok || yesterdayLogMissing.value) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const updated = await savePreflight(
      props.declaration.id,
      'morningReview',
      {
        reviewedDate: reviewedDate.value,
        reviewedDeclarationId: reviewed.value?.id ?? null,
        clearRate: analysis.value?.clearRate ?? null,
        // 执行偏差摘要随复盘一起留痕；未取到就是 null，不用 0 冒充「无偏差」。
        executionDeviationMwh: execReview.value?.deviation.total_abs_deviation_mwh ?? null,
        assessedMwh: execReview.value?.deviation.assessed_mwh ?? null,
        actualSource: execReview.value?.actual_source ?? null,
        cause: cause.value,
        causeLabel: causeLabelOf(cause.value),
        // 归因未判定 → 挂待讨论标记，S7 日报收尾据此提醒补齐
        pendingAnalysis: isPendingCause(cause.value),
        // 需求 1：责任归属（偏差谁该负责）与物理成因同时留痕；「无明显偏差」无责可归
        responsibility:
          cause.value === 'none' ? null : ((responsibility.value || null) as 'forecast' | 'emergency' | 'strategy' | 'operation' | null),
        responsibilityLabel:
          cause.value !== 'none' && responsibility.value ? responsibilityLabelOf(responsibility.value) : undefined,
        // 需求 2：偏差成本（模板八）自动喂入——未取到为 null，不用 0 冒充「无成本」
        deviationCostYuan: execReview.value?.deviation.estimated_penalty_yuan ?? null,
        deviationRate: execDeviationPct.value !== null ? Number((execDeviationPct.value * 100).toFixed(2)) : null,
        // 需求 3：结果三层拆分快照（峰平谷为真算聚合；品种层仅日前现货 REAL；单笔待结算明细）
        resultLayers:
          peakFlatRows.value.length || byProductRows.value.length
            ? {
                byProduct: byProductRows.value.map((r) => ({
                  product: r.product,
                  // 未取到的品种保持 null 落库（UI 显「—」），不用 0 冒充「无收益」
                  revenue: r.revenue ?? null,
                  share: r.share ?? null,
                  sourceType: r.sourceType
                })),
                byPeriod: peakFlatRows.value,
                topTrades: null
              }
            : null,
        // 需求 4：决策三问结论（已作答的条目）
        decisionReview:
          decisionReviewComputed.value.totalDecisions > 0 ? decisionReviewComputed.value : null,
        // 需求 6：本次复盘角色与角色专属汇总
        role: role.value,
        roleSpecific:
          role.value === 'retail'
            ? {
                template: 'R1+R4',
                deviationMwh: execReview.value?.deviation.total_abs_deviation_mwh ?? null,
                deviationRatePct: execDeviationPct.value !== null ? Number((execDeviationPct.value * 100).toFixed(2)) : null,
                assessmentCostYuan: execReview.value?.deviation.estimated_penalty_yuan ?? null,
                responsibility: cause.value === 'none' ? null : responsibility.value || null
              }
            : null,
        lessons: lessons.value.trim()
      },
      `S1 晨会复盘：${causeLabelOf(cause.value)}`
    )
    emit('updated', updated)
    saveMsg.value = isPendingCause(cause.value)
      ? '已记为待分析并写回，晨会人工讨论后回填主因；可进入 S2'
      : '复盘结论已写回，进入 S2 早间分析'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mr">
    <p class="mr-window" :class="`mr-window-${windowState}`">{{ MORNING_WINDOW_NOTE[windowState] }}</p>

    <!-- 复盘体系三件套（#2040）：三问结论条 + 昨夜智能体报告卡 + 复盘待办徽标。
         全部只读/跳转，不给 S1 增加任何填写负担（<5 分钟红线）。 -->
    <section class="mr-system">
      <ReviewThreeQuestions
        :reviewed-date="reviewedDate"
        :has-reviewed="!!reviewed"
        :clear-rate="analysis?.clearRate ?? null"
        :deviation-mwh="execReview?.deviation.total_abs_deviation_mwh ?? null"
        :deviation-pct="execDeviationPct"
        :prev-deviation-mwh="prevDeviationMwh"
        :prev-reviewed-date="prevReviewedDate"
        :pnl="threeQuestionsPnl"
        :position="activeStanceType"
      />
      <div class="mr-system-row">
        <div class="mr-report-slot"><OvernightReportCard /></div>
        <ReviewTodoBadge />
      </div>
    </section>

    <!-- 六维摘要（需求 5）：每维一行；①④⑥ 有真实数据，②③⑤ 占位待数据接入。
         数据由下方各面板 computed 汇总，不新增数据源。 -->
    <section class="mr-panel mr-dims">
      <h3>六维摘要 <span class="mr-dims-sub">昨日 {{ reviewedDate }} · 点击已就绪维度定位到对应面板</span></h3>
      <div class="mr-dim-list">
        <button
          v-for="d in sixDims"
          :key="d.key"
          type="button"
          class="mr-dim"
          :class="{ 'mr-dim-ready': d.ready }"
          :title="d.note ?? ''"
          @click="jumpToDim(d.key)"
        >
          <strong>{{ d.name }}</strong>
          <span>{{ d.summary }}</span>
        </button>
      </div>
    </section>

    <!-- 角色分流（需求 6）：六维摘要不随角色变，只角色专属区变 -->
    <section class="mr-panel mr-role">
      <div class="mr-role-head">
        <label class="mr-role-select">
          复盘角色
          <select v-model="role">
            <option v-for="r in ROLE_OPTIONS" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
        </label>
        <span class="mr-role-note">
          售电=真实数据（R1 代理购电偏差 + R4 考核成本，复用现有偏差口径）；
          储能/新能源角色待数据接入 <code>#1968</code>（模板 E1–E3/S1、N1）。
        </span>
      </div>
      <table v-if="roleSpecificRows.length" class="mr-table mr-role-table">
        <thead><tr><th>指标（模板口径）</th><th>值</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-for="row in roleSpecificRows" :key="row.k">
            <td>{{ row.k }}</td>
            <td :class="row.real ? '' : 'mr-muted'">{{ row.v }}</td>
            <td>{{ row.real ? '真实（/review）' : '待数据接入' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 立场复盘焦点：用户侧问「买没买到」、电源侧问「卖没卖掉」、储能问「窗口吃到没」 -->
    <section v-if="reviewFocus" class="mr-focus">
      <strong>{{ activeStanceType === 'GENERATOR' ? '电厂侧' : activeStanceType === 'STORAGE' ? '储能' : '用户侧' }}复盘目标：{{ reviewFocus.goal }}</strong>
      <ul>
        <li v-for="(point, i) in reviewFocus.reviewPoints" :key="i">{{ point }}</li>
      </ul>
    </section>

    <!-- 异常分支：昨日决策日志缺失 → 强制补写（KPI 100% 必填），未补不收口今日复盘 -->
    <p v-if="yesterdayLogMissing" class="mr-backfill-block">
      <TriangleAlert :size="13" />
      昨日（{{ yesterdayIso }}）有申报单但决策日志为空——按手册「当日未写日志，次日晨会强制补写」，
      今日复盘暂不可写回。
      <button type="button" class="mr-jump" @click="emit('go', 'daily-close')">去 S7 补写昨日日志（归属日期切昨日）</button>
    </p>

    <section id="mr-panel-result" class="mr-panel">
      <h3><History :size="14" /> ① 中标情况 · 申报 vs 出清（标的日 {{ reviewedDate }}）</h3>
      <p v-if="loading" class="mr-muted">读取昨日申报单…</p>
      <p v-else-if="loadError" class="mr-err">{{ loadError }}</p>
      <p v-else-if="!reviewed" class="mr-muted">
        {{ reviewedDate }} 无申报单——无可复盘对象（首个交易日或昨日未作业）。仍可写下今日要点后开工。
      </p>
      <template v-else>
        <div class="mr-facts">
          <span class="mr-decl">{{ reviewed.id }} <em>{{ STATUS_LABEL[reviewed.status] }}</em></span>
          <span>申报 {{ reviewed.energyCurveMwh96.reduce((a, b) => a + b, 0).toFixed(1) }} MWh</span>
          <template v-if="analysis">
            <span>出清 {{ analysis.totalClearedMwh.toFixed(1) }} MWh</span>
            <span :class="analysis.clearRate !== null && analysis.clearRate < 0.85 ? 'mr-bad' : 'mr-ok'">
              中标率 {{ analysis.clearRate === null ? '—' : (analysis.clearRate * 100).toFixed(1) + '%' }}
            </span>
          </template>
          <span v-else class="mr-muted">出清结果未登记，中标情况无从对照</span>
        </div>
        <p v-if="analysis" class="mr-summary">{{ analysis.summary }}</p>

        <!-- 需求 3：三层拆分 tab（品种 / 峰平谷 / 单笔）——模板二口径的日级缩影 -->
        <div class="mr-layers">
          <div class="mr-layer-tabs" role="tablist">
            <button
              v-for="t in LAYER_TABS"
              :key="t.id"
              type="button"
              role="tab"
              :aria-selected="layerTab === t.id"
              class="mr-layer-tab"
              :class="{ on: layerTab === t.id }"
              @click="layerTab = t.id"
            >
              {{ t.label }}
            </button>
          </div>
          <!-- 第一层 分品种：日前现货真实（回测口径），其余标 MOCK 不编数 -->
          <table v-if="layerTab === 'product'" class="mr-table">
            <thead><tr><th>品种</th><th>收益（元）</th><th>占比</th><th>来源</th></tr></thead>
            <tbody>
              <tr v-for="p in byProductRows" :key="p.product">
                <td>{{ p.product }}</td>
                <td>{{ p.revenue === null ? '—' : p.revenue.toFixed(0) }}</td>
                <td>{{ p.share === null ? '—' : p.share + '%' }}</td>
                <td :class="p.sourceType === 'MOCK' ? 'mr-muted' : 'mr-ok'">
                  {{ p.sourceType === 'REAL' ? '真实' : 'MOCK' }}<em v-if="p.note" class="mr-layer-note">（{{ p.note }}）</em>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 第二层 分时段峰平谷：时段定义从地区结算规则包读，真算聚合 -->
          <template v-else-if="layerTab === 'period'">
            <p class="mr-muted">{{ peakFlatNote }}</p>
            <table v-if="peakFlatRows.length" class="mr-table">
              <thead><tr><th>时段</th><th>96点数</th><th>申报电量（MWh）</th><th>占比</th></tr></thead>
              <tbody>
                <tr v-for="row in peakFlatRows" :key="row.segment">
                  <td>{{ row.segment }}</td>
                  <td>{{ row.slots }}</td>
                  <td>{{ row.totalMwh.toFixed(1) }}</td>
                  <td>{{ row.sharePct === null ? '—' : row.sharePct + '%' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="mr-muted">无申报曲线或时段定义，峰平谷层不可算。</p>
          </template>
          <!-- 第三层 单笔 TOP5：待结算明细接入（#1968），框架先搭不编数 -->
          <p v-else class="mr-muted">
            单笔 TOP5 盈亏需结算明细，待数据接入 <code>#1968</code>——框架已就位，数据到位后此层自动可用。
          </p>
        </div>

        <details class="mr-worstslots">
          <summary>最坏时段明细（{{ analysis?.worstSlots.length ?? 0 }} 个）</summary>
          <table v-if="analysis?.worstSlots.length" class="mr-table">
            <thead><tr><th>时段</th><th>申报</th><th>出清</th><th>偏差</th><th>偏差率</th></tr></thead>
            <tbody>
              <tr v-for="w in analysis.worstSlots" :key="w.slot">
                <td>#{{ w.slot + 1 }}</td>
                <td>{{ w.declaredMwh }}</td>
                <td>{{ w.clearedMwh }}</td>
                <td :class="w.deltaMwh < 0 ? 'mr-bad' : ''">{{ w.deltaMwh }}</td>
                <td>{{ w.deltaPct === null ? '—' : (w.deltaPct * 100).toFixed(1) + '%' }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </template>
    </section>

    <section id="mr-panel-deviation" class="mr-panel">
      <h3><Scale :size="14" /> ② 执行偏差 · 申报 vs 实际（考核口径）</h3>
      <p v-if="execLoading" class="mr-muted">取实际电量并计算偏差…</p>
      <p v-else-if="!reviewed" class="mr-muted">无昨单，执行偏差无基准。</p>
      <template v-else-if="execFailure">
        <p class="mr-empty">{{ execFailure.title }}</p>
        <p class="mr-muted">{{ execFailure.description }}</p>
        <p v-if="execFailure.detail" class="mr-muted mr-detail">后端说明：{{ execFailure.detail }}</p>
      </template>
      <template v-else-if="execReview">
        <div class="mr-facts">
          <span>偏差点数 {{ execReview.deviation.points }}</span>
          <span>总偏差 {{ execReview.deviation.total_abs_deviation_mwh.toFixed(2) }} MWh</span>
          <span :class="execDeviationPct !== null && execDeviationPct > 0.05 ? 'mr-bad' : 'mr-ok'">
            偏差率 {{ execDeviationPct === null ? '—' : (execDeviationPct * 100).toFixed(2) + '%' }}
          </span>
          <span>被考核 {{ execReview.deviation.assessed_mwh.toFixed(2) }} MWh</span>
          <span :class="execReview.deviation.estimated_penalty_yuan > 0 ? 'mr-bad' : ''">
            罚款估算 {{ execReview.deviation.estimated_penalty_yuan.toFixed(0) }} 元
          </span>
        </div>
        <p v-if="execReview.deviation.worst_point?.datetime" class="mr-summary">
          最坏点 {{ execReview.deviation.worst_point.datetime }}，偏差
          {{ execReview.deviation.worst_point.deviation.toFixed(2) }} MWh（免罚带
          {{ (execReview.deviation.tolerance_pct * 100).toFixed(0) }}%）
        </p>
        <p v-if="execReview.warning" class="mr-warn">{{ execReview.warning }}</p>
        <!-- 口径边界由后端随响应下发，原样呈现：数字本身不带口径，不显示等于把
             「按平台实时电量自算」悄悄当成了「电网结算结论」。 -->
        <details v-if="execReview.caliber_caveats?.length" class="mr-caveat">
          <summary>口径边界 · 这份偏差不能当作什么（{{ execReview.caliber_caveats.length }} 条）</summary>
          <ul><li v-for="(c, i) in execReview.caliber_caveats" :key="i">{{ c }}</li></ul>
        </details>
        <button type="button" class="link" @click="router.push('/xhjy/review')">查看完整复盘 →</button>
      </template>
      <p v-else class="mr-muted">昨单无申报曲线，执行偏差无基准。</p>
    </section>

    <section id="mr-panel-decision" class="mr-panel">
      <h3>
        ③ 昨日决策日志
        <button v-if="reviewedEntries.length" type="button" class="link" @click="showEntries = !showEntries">
          {{ showEntries ? '收起条目' : `调阅 ${reviewedEntries.length} 条` }}
        </button>
      </h3>
      <div class="mr-log">
        <span>填写率：{{ logCoverage.recorded }}/{{ logCoverage.expected }} 条</span>
        <span v-if="!logCoverage.meetsVeto" class="mr-bad"><TriangleAlert :size="12" /> 未达一票否决线</span>
        <span>P10–P90 命中率 {{ logHits.rate === null ? '—（无可回填样本）' : (logHits.rate * 100).toFixed(0) + '%' }}</span>
        <span>三问复盘：{{ decisionReviewComputed.reviewedDecisions }}/{{ decisionReviewComputed.totalDecisions }} 条已复盘</span>
      </div>
      <p v-if="!reviewedEntries.length" class="mr-muted">{{ reviewedDate }} 无决策日志条目——昨日决策未留痕，无从回顾。</p>
      <template v-else-if="showEntries">
        <table class="mr-table mr-entries">
          <thead><tr><th>#</th><th>决策点</th><th>结论</th><th>P10–P90</th><th>实际</th><th>心得</th><th title="信息/逻辑/情绪">三问</th><th></th></tr></thead>
          <tbody>
            <template v-for="e in reviewedEntries" :key="e.id">
              <tr>
                <td>{{ e.seq }}</td>
                <td>{{ e.decisionPoint }}</td>
                <td class="mr-wrap">{{ e.judgement }}</td>
                <td>{{ e.p10 }}–{{ e.p90 }}</td>
                <td :class="e.actual === null ? 'mr-muted' : ''">{{ e.actual === null ? '未回填' : e.actual }}</td>
                <td class="mr-wrap">{{ e.lesson || '—' }}</td>
                <!-- 需求 4：三问状态（信息/逻辑/情绪），· 未填 / ✓ 正常 / ✗ 存疑 -->
                <td class="mr-threeq">
                  <span :title="'信息' + (qMark(entryThreeQ(e.id)?.info, 'ok') === '·' ? '未填' : entryThreeQ(e.id)!.info === 'ok' ? '充分' : '有缺')">{{ qMark(entryThreeQ(e.id)?.info, 'ok') }}</span>
                  <span :title="'逻辑' + (qMark(entryThreeQ(e.id)?.logic, 'ok') === '·' ? '未填' : entryThreeQ(e.id)!.logic === 'ok' ? '严密' : '有漏')">{{ qMark(entryThreeQ(e.id)?.logic, 'ok') }}</span>
                  <span :title="'情绪' + (qMark(entryThreeQ(e.id)?.emotion, 'calm') === '·' ? '未填' : entryThreeQ(e.id)!.emotion === 'calm' ? '稳定' : '受扰')">{{ qMark(entryThreeQ(e.id)?.emotion, 'calm') }}</span>
                </td>
                <td><button type="button" class="link" @click="toggleReview(e.id)">{{ openReviewId === e.id ? '收起' : '复盘单' }}</button></td>
              </tr>
              <!-- 需求 4：决策复盘单（模板一精简版 8 核心字段；结论随 S1 写回 decisionReview） -->
              <tr v-if="openReviewId === e.id" class="mr-review-form-row">
                <td colspan="8">
                  <div class="mr-review-form">
                    <p class="mr-review-title">决策复盘单（模板一精简版）· #{{ e.seq }} {{ e.decisionPoint }}</p>
                    <div class="mr-review-meta">
                      <span>品种/方向/量价：决策日志条目未记（模板一全量 17 字段留后续期）</span>
                    </div>
                    <div class="mr-review-qs">
                      <label>信息（够不够、有无遗漏）
                        <select v-model="qz(e.id).info">
                          <option value="ok">充分</option><option value="lacking">有缺</option>
                        </select>
                      </label>
                      <label>逻辑（推理有无漏洞）
                        <select v-model="qz(e.id).logic">
                          <option value="ok">严密</option><option value="flawed">有漏</option>
                        </select>
                      </label>
                      <label>情绪（追涨杀跌/过度自信/犹豫）
                        <select v-model="qz(e.id).emotion">
                          <option value="calm">稳定</option><option value="biased">受扰</option>
                        </select>
                      </label>
                      <label class="mr-review-note">改进措施
                        <input v-model="qz(e.id).note" type="text" placeholder="具体改进事项（选填，随三问结论写回）" />
                      </label>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
      <p class="mr-proto">{{ PROTOTYPE_STORAGE_NOTICE }}</p>
    </section>

    <section class="mr-panel">
      <h3>
        ④ 复盘结论 → 写回今日单据
        <AiAssistFill
          kind="morning_review"
          :context="assistContext"
          :field-labels="ASSIST_LABELS"
          label="AI 帮我归因"
          :disabled-reason="analysis || execReview || reviewed ? '' : '昨日无申报单与偏差数据，AI 无判断依据'"
          @apply="applyAssist"
        />
      </h3>
      <div v-if="written" class="mr-written">
        已写回：{{ causeLabelOf(written.cause) }}<template v-if="written.responsibility"> · 责任归属 {{ responsibilityLabelOf(written.responsibility) }}</template><template v-if="written.deviationCostYuan != null"> · 偏差成本 {{ written.deviationCostYuan.toFixed(0) }} 元</template> —— {{ written.lessons }}
        <em>（{{ written.writtenBy }}）</em>
        <strong v-if="written.pendingAnalysis" class="mr-pending">待晨会讨论后回填主因</strong>
      </div>
      <div class="mr-form">
        <label>
          偏差主因（为什么发生）
          <select v-model="cause">
            <option value="">选择…</option>
            <option v-for="c in DEVIATION_CAUSES" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
        </label>
        <label>
          责任归属（谁该负责）<template v-if="cause === 'none'"><span class="mr-opt">主因「无明显偏差」时可免</span></template>
          <select v-model="responsibility" :disabled="cause === 'none'">
            <option value="">选择…</option>
            <option v-for="r in DEVIATION_RESPONSIBILITY" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
        </label>
        <label class="mr-full">
          今日不重犯要点（≥4 字，会随单据留痕）
          <input v-model="lessons" type="text" placeholder="如：晚高峰段预测系统性偏低，今日上调 5% 再核" />
        </label>
      </div>
      <p v-if="causeHint" class="mr-hint">
        <strong>{{ causeHint.label }}</strong>：{{ causeHint.hint }} → <em>{{ causeHint.nextAction }}</em>
      </p>
      <p v-if="responsibilityHint" class="mr-hint">
        <strong>责任归属 · {{ responsibilityHint.label }}</strong>：{{ responsibilityHint.hint }}
      </p>
      <div class="mr-actions">
        <button
          type="button"
          class="primary"
          :disabled="yesterdayLogMissing || !declaration || !validation.ok || saving"
          @click="writeBack"
        >
          <Save :size="13" /> {{ written ? '更新复盘结论' : '写回并进入 S2' }}
        </button>
        <button type="button" class="ghost" @click="emit('go', 'market-analysis')">跳到 S2 早间分析</button>
        <span v-if="saveMsg" class="mr-ok">{{ saveMsg }}</span>
        <span v-if="saveError" class="mr-err-inline">{{ saveError }}</span>
      </div>
      <ul v-if="!validation.ok && (cause || lessons)" class="mr-invalid">
        <li v-for="(e, i) in validation.errors" :key="i">{{ e }}</li>
      </ul>
      <p class="mr-note">
        复盘结论写回今日申报单（preflight.morningReview），S7 日报收尾会把它带进当日闭环记录。
        提交申报后本段锁定，不接受事后改写。归因判不了就选「待分析」——随手挑一个主因比留空更坏。
      </p>
    </section>
  </div>
</template>

<style scoped>
.mr { display: flex; flex-direction: column; gap: 12px; }
/* 复盘体系三件套（#2040） */
.mr-system { display: flex; flex-direction: column; gap: 8px; }
.mr-system-row { display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; }
.mr-report-slot { flex: 1 1 320px; min-width: 0; display: flex; }
.mr-report-slot > * { flex: 1; }
.mr-backfill-block { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 7px 12px; border: 1px solid #f87171; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); line-height: 1.6; }
.mr-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.mr-focus { margin: 0; padding: 7px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; font-size: var(--font-sm); }
.mr-focus strong { color: #075985; }
.mr-focus ul { margin: 4px 0 0; padding-left: 18px; font-size: var(--font-xs); line-height: 1.7; color: #475569; }
.mr-window { margin: 0; padding: 6px 12px; border-radius: 8px; font-size: var(--font-sm); }
.mr-window-within { background: #f0fdf4; color: #166534; }
.mr-window-before { background: #f8fafc; color: #475569; }
.mr-window-after { background: #fffbeb; color: #a16207; }
.mr-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.mr-panel h3 { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 8px; font-size: var(--font-md); flex-wrap: wrap; }
.mr-muted { margin: 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.mr-detail { margin-top: 4px; font-family: ui-monospace, monospace; font-size: var(--font-xs); }
.mr-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); }
.mr-err-inline { font-size: var(--font-sm); color: #b91c1c; }
.mr-empty { margin: 0 0 4px; padding: 6px 10px; border-radius: 6px; background: #f8fafc; color: #475569; font-size: var(--font-sm); }
.mr-warn { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; background: #fffbeb; color: #a16207; font-size: var(--font-sm); }
.mr-ok { font-size: var(--font-sm); color: #15803d; }
.mr-bad { color: #b91c1c; display: inline-flex; align-items: center; gap: 3px; }
.mr-facts { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.mr-decl { font-family: ui-monospace, monospace; }
.mr-decl em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; }
.mr-summary { margin: 8px 0 0; font-size: var(--font-sm); line-height: 1.6; }
.mr-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); font-variant-numeric: tabular-nums; margin-top: 6px; }
.mr-table th, .mr-table td { padding: 3px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.mr-table th:first-child, .mr-table td:first-child { text-align: left; }
.mr-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.mr-entries td, .mr-entries th { text-align: left; }
.mr-wrap { max-width: 220px; white-space: normal; line-height: 1.5; }
.mr-caveat { margin-top: 8px; font-size: var(--font-xs); color: #a16207; }
.mr-caveat summary { cursor: pointer; }
.mr-caveat ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.6; }
.mr-log { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--font-sm); }
.mr-proto { margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); font-size: var(--font-xs); line-height: 1.6; color: #a16207; }
.mr-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: var(--font-sm); }
.mr-written em { font-style: normal; color: #4d7c0f; }
.mr-pending { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 8px; background: #fffbeb; color: #a16207; font-weight: 600; }
.mr-form { display: flex; gap: 10px; flex-wrap: wrap; }
.mr-form label { display: flex; flex-direction: column; gap: 3px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.mr-form .mr-full { flex: 1; min-width: 320px; }
.mr-form select, .mr-form input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.mr-hint { margin: 8px 0 0; font-size: var(--font-xs); line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.mr-hint em { font-style: normal; color: #1d4ed8; }
.mr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.mr-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: var(--font-sm); cursor: pointer; }
.mr-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.mr-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-sm); cursor: pointer; }
.mr-invalid { margin: 8px 0 0; padding-left: 18px; font-size: var(--font-xs); line-height: 1.7; color: #b91c1c; }
.link { padding: 0; border: 0; background: none; color: #2563eb; font-size: var(--font-sm); cursor: pointer; }
.mr-note { margin: 8px 0 0; font-size: var(--font-xs); line-height: 1.6; color: #a16207; }
/* 六维摘要（需求 5） */
.mr-dims h3 { margin-bottom: 6px; }
.mr-dims-sub { margin-left: auto; font-size: var(--font-sm); font-weight: 400; color: var(--el-text-color-secondary, #667); }
.mr-dim-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 6px; }
.mr-dim { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 10px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; background: #f8fafc; text-align: left; cursor: default; font-size: var(--font-md); }
.mr-dim-ready { background: #fff; border-color: #bfdbfe; cursor: pointer; }
.mr-dim-ready:hover { border-color: #2563eb; }
.mr-dim strong { font-size: var(--font-md); color: var(--el-text-color-primary, #303133); }
.mr-dim span { font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
/* 角色分流（需求 6） */
.mr-role-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.mr-role-select { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-md); color: var(--el-text-color-secondary, #667); }
.mr-role-select select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-md); }
.mr-role-note { font-size: var(--font-sm); line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.mr-role-note code { font-family: ui-monospace, monospace; font-size: var(--font-xs); }
.mr-role-table th, .mr-role-table td { text-align: left; }
/* 三层拆分（需求 3） */
.mr-layers { margin-top: 8px; }
.mr-layer-tabs { display: flex; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
.mr-layer-tab { padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 14px; background: #fff; color: var(--el-text-color-secondary, #667); font-size: var(--font-sm); cursor: pointer; }
.mr-layer-tab.on { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; font-weight: 600; }
.mr-layer-note { font-style: normal; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); }
.mr-layers code { font-family: ui-monospace, monospace; }
.mr-worstslots { margin-top: 8px; font-size: var(--font-sm); }
.mr-worstslots summary { cursor: pointer; color: var(--el-text-color-secondary, #667); }
/* 决策三问与复盘单（需求 4） */
.mr-threeq { letter-spacing: 3px; }
.mr-threeq span:last-child { margin-right: -3px; }
.mr-review-form-row > td { background: #f8fbff; }
.mr-review-form { padding: 8px 10px; }
.mr-review-title { margin: 0 0 6px; font-size: var(--font-md); font-weight: 600; color: #075985; }
.mr-review-meta { margin: 0 0 8px; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.mr-review-qs { display: flex; gap: 10px; flex-wrap: wrap; }
.mr-review-qs label { display: flex; flex-direction: column; gap: 3px; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.mr-review-qs select, .mr-review-qs input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-md); }
.mr-review-note { flex: 1; min-width: 240px; }
.mr-opt { margin-left: 6px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); }
</style>
