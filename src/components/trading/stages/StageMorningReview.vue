<script setup lang="ts">
// S1 晨会复盘（08:00–08:30）—— 一天从收口昨日开始，5 分钟内完成。
//
// 定位（#2033 review-center-foundation §一.1）：晨会是**复盘中心产物的摘要消费者**，
// 不承担完整结算、策略验证和历史研究。主脸四块：
//   ① 状态行（窗口提示等说明性口径收纳）；
//   ② 昨日偏差 KPI 带——中标情况（申报 vs 出清，analyzeClearing 前端纯函数）与执行偏差
//      （申报 vs 实际，后端 quant /review 权威实现）的核心数字放大呈现，口径警示紧邻数字；
//   ③ 复盘材料块——风险事件 / 昨夜报告 / 本日适用措施 / 决策台账收进一张平铺列表：
//      各分区首屏内容直接可见（零点击），仅清单超长时就地截断给「展开全部」；
//   ④ 复盘结论写回卡——偏差主因 + 今日不重犯要点写回**今日**单据的 preflight.morningReview。
// 深度明细（分层明细、决策日志条目调阅、策略/市场复盘、角色表、三问）不在 S1 承载：
// 经带参数深链（goReview：date + declarationId + task）落到复盘中心对应任务承接。
//
// ①②是**两个不同的量，不可互相替代**：中标率答「我报的量中了多少」，执行偏差答
// 「我实际干的和我报的差多少、要交多少考核费」。只看中标率会漏掉「全中但执行跑偏」的那类亏损。
// 没有昨单就如实说「无可复盘对象」，仍允许写要点（首个交易日也要开工）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, CircleAlert, ClipboardList, MoonStar, Save, ShieldAlert, Target, TriangleAlert } from 'lucide-vue-next'
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
import { loadLogAsync, storageNoticeFor, type DecisionLogMode } from '@/services/trading/decisionLogStore'
import { fetchRiskEvents } from '@/services/review/reviewStoreClient'
import type { RiskEventSummary } from '@/services/review/reviewStoreApi'
import MorningSummaryCard from './MorningSummaryCard.vue'
import DataStatusLine, { type DataStatusItem } from './DataStatusLine.vue'
import MorningRiskPanel from './MorningRiskPanel.vue'
import { beijingDayStartUtc, eventsInWindow, NODE_PRICE_SPIKE_DATA_GAP_NOTE, STOP_LOSS_DATA_GAP_NOTE } from '@/services/review/morningRiskReview'
import { markS1Started, s1TimerView, type S1TimerView } from '@/services/trading/stageTimer'
import { coverageOf, hitRate, type DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import {
  causeIdOfLabel,
  causeLabelOf,
  DEVIATION_CAUSES,
  DEVIATION_RESPONSIBILITY,
  isPendingCause,
  morningWindowState,
  MORNING_WINDOW_NOTE,
  responsibilityLabelOf,
  validateMorningReview
} from 'shared/trading-rules/morning-review.mjs'
import { shiftIsoDate } from 'shared/trading-rules/trading-calendar.mjs'
import { reviewFocusOf } from 'shared/trading-rules/position-review.mjs'
import { activeStanceType } from '@/services/stance/stanceContext'
import { onRegionChange } from '@/composables/useRegionReload'
import { useSaveState } from '@/composables/useSaveState'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
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

// ── 深链（spec「S1 深链定位复盘对象」）：统一带所复盘交易日 + 昨单标识 + 任务参数。
// 昨单缺失时不带 declarationId——复盘中心落当日总览，不猜关联对象。
type ReviewTask = 'result' | 'decision' | 'improvement'
function goReview(task: ReviewTask) {
  void router.push({
    path: '/xhjy/review',
    query: {
      date: reviewedDate.value,
      ...(reviewed.value ? { declarationId: reviewed.value.id } : {}),
      task
    }
  })
}

// ── 作业窗口提示（公司内控规范，非市场规则：只提示、不拦）───────────────────
const now = new Date()
const windowState = morningWindowState(now.getHours() * 60 + now.getMinutes())

// 窗口提示收纳进「数据与口径状态」行（降噪任务 4.2/4.3）：三态都是说明性文案
// （窗口只提示不硬拦，trading-day.md §S1⑤），不再是常驻横幅。
const statusItems = computed<DataStatusItem[]>(() => [
  { tone: windowState === 'after' ? 'caveat' : 'info', text: MORNING_WINDOW_NOTE[windowState] }
])

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
onMounted(() => {
  loadReviewed()
  void loadLogAsync().then((snap) => {
    logMode.value = snap.mode
    log.value = snap.log
  })
  void loadYesterdayRiskEvents()
  // #2040 S1 实机计时：进入即记时间戳（刷新不重计）；零写回（不进单据字段）
  if (props.declaration) markS1Started(props.declaration.id, props.targetDate)
  refreshS1View()
  s1Ticker.value = window.setInterval(refreshS1View, 30_000)
})
watch(reviewedDate, () => {
  loadReviewed()
  void loadYesterdayRiskEvents()
})

// ── 风险复盘（六维⑤ · #2015 第 2 期）：重要发现的承载行（升入复盘材料列表置顶）──
// 昨日窗口（复盘对象日）事件 + near_miss 标注 + 回顾提醒；取数与探针降级留在这里。
const riskFeedAvailable = ref(false)
const yesterdayRiskEvents = ref<RiskEventSummary[]>([])
async function loadYesterdayRiskEvents() {
  // 「昨日」按北京日界取窗口（beijingDayStartUtc）——UTC 零点会把窗口后移 8 小时
  const since = beijingDayStartUtc(reviewedDate.value)
  const until = beijingDayStartUtc(props.targetDate)
  const feed = await fetchRiskEvents({ since, until })
  riskFeedAvailable.value = feed.available
  yesterdayRiskEvents.value = feed.available ? eventsInWindow(feed.events, since, until) : []
}

// ── 复盘材料平铺列表：各分区首屏内容直接可见，无折叠态 ────────────────────────
// 子组件取数不动；行上摘要由父层（风险/台账）或子组件 status 事件喂。
const riskNearCount = computed(() => yesterdayRiskEvents.value.filter((e) => e.nearMiss).length)
/** 风险分区摘要：服务态 / 昨日无风险事件记录 / N 条（· M 条侥幸）。 */
const riskRowStatus = computed(() => {
  if (!riskFeedAvailable.value) return '事件服务未上线'
  const n = yesterdayRiskEvents.value.length
  if (!n) return '昨日无风险事件记录'
  return riskNearCount.value ? `${n} 条 · ${riskNearCount.value} 条侥幸` : `${n} 条`
})
const reportRowStatus = ref('')
const actionsRowStatus = ref('')

// ── S1 实机计时（#2040）：只呈现，不写回（U4 红线） ──────────────────────────
const s1View = ref<S1TimerView>({ startedAt: null, elapsedMinutes: null, slow: false })
const s1Ticker = ref<number | null>(null)
const s1ElapsedFinal = ref<number | null>(null)
function refreshS1View() {
  s1View.value = props.declaration
    ? s1TimerView(props.declaration.id, props.targetDate)
    : { startedAt: null, elapsedMinutes: null, slow: false }
}
onBeforeUnmount(() => {
  if (s1Ticker.value) window.clearInterval(s1Ticker.value)
})

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
const declaredTotalMwh = computed(() => reviewed.value?.energyCurveMwh96?.reduce((a, b) => a + b, 0) ?? 0)
const clearRateBad = computed(() => analysis.value?.clearRate !== null && (analysis.value?.clearRate ?? 1) < 0.85)

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
const execPctBad = computed(() => execDeviationPct.value !== null && execDeviationPct.value > 0.05)
/** 最坏点的紧凑时刻（MM-dd HH:mm），与风险面板同款切片。 */
const worstPointLabel = computed(() => {
  const dt = execReview.value?.deviation.worst_point?.datetime
  return dt ? dt.slice(5, 16).replace('T', ' ') : ''
})

// ── 昨日决策日志：摘要行（条目调阅移交复盘中心决策评价，spec「决策日志回顾为摘要行」）──
// 双模式（#2037）：服务端台账优先，端点未部署回落浏览器原型——原型态标识保持可见（诚实边界）。
// 取数必须保留：强制补写拦截（yesterdayLogMissing）与 AI 辅助上下文都依赖它。
const log = ref<DecisionLogEntry[]>([])
const logMode = ref<DecisionLogMode>('local')
const logNotice = computed(() => storageNoticeFor(logMode.value))
const logCoverage = computed(() => coverageOf(log.value, reviewedDate.value, 3))
const logHits = computed(() => hitRate(log.value))
/** 昨日标的日的条目数——晨会摘要行只报数量与填写率，回顾经深链去复盘中心。 */
const reviewedEntryCount = computed(
  () => log.value.filter((e) => e.targetDate === reviewedDate.value).length
)

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
// 写回三态走 useSaveState 单源（spot-trading-module-hygiene 收口六份逐字副本）
const { saving, saveMsg, saveError, runSave } = useSaveState()

const written = computed(() => props.declaration?.preflight?.morningReview ?? null)

// ── 立场复盘焦点（#2005）：同一张偏差表，三类身份问的问题不同（并入写回卡头一行）──
const reviewFocus = computed(() => reviewFocusOf(activeStanceType.value))
const stanceLabel = computed(() =>
  activeStanceType.value === 'GENERATOR' ? '电厂侧' : activeStanceType.value === 'STORAGE' ? '储能' : '用户侧'
)

// ── 异常分支（手册：当日未写日志 → 次日晨会强制补写）─────────────────────────
// 判据：昨日有申报单可复盘（reviewed 存在）但决策日志链上没有归属昨日标的日的条目。
// 拦截写回（不是提示完就算）——补写入口在 S7（日志归属日期切到昨日即补写模式）。
const yesterdayIso = computed(() => shiftIsoDate(props.targetDate, -1))
const yesterdayLogMissing = computed(() => {
  if (!reviewed.value) return false
  return !log.value.some((e) => e.targetDate === yesterdayIso.value)
})

async function writeBack() {
  if (!props.declaration || !validation.value.ok || yesterdayLogMissing.value) return
  const declaration = props.declaration
  await runSave(async () => {
    const updated = await savePreflight(
      declaration.id,
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
        lessons: lessons.value.trim()
      },
      `S1 晨会复盘：${causeLabelOf(cause.value)}`
    )
    emit('updated', updated)
    // #2040 收口读数：writeBack 成功时的实机用时（>5 分钟黄标口径见 stageTimer）；
    // 只呈现不写回（U4：实测数值不进单据字段）。
    s1ElapsedFinal.value = props.declaration
      ? s1TimerView(props.declaration.id, props.targetDate).elapsedMinutes
      : null
    return isPendingCause(cause.value)
      ? '已记为待分析并写回，晨会人工讨论后回填主因；可进入 S2'
      : '复盘结论已写回，进入 S2 早间分析'
  })
}
</script>

<template>
  <div class="mr">
    <!-- 数据与口径状态行（降噪 4.2/4.3）：独立一行，展开看原文——与容器阶段卡头（S1 标题
         + 进行中胶囊）保持分工，组件内不再重复页头 -->
    <DataStatusLine :items="statusItems" />

    <!-- 异常分支：昨日决策日志缺失 → 强制补写（KPI 100% 必填），未补不收口今日复盘 -->
    <p v-if="yesterdayLogMissing" class="mr-backfill-block">
      <TriangleAlert :size="13" />
      昨日（{{ yesterdayIso }}）有申报单但决策日志为空——按手册「当日未写日志，次日晨会强制补写」，
      今日复盘暂不可写回。
      <button type="button" class="mr-jump" @click="emit('go', 'daily-close')">去 S7 补写昨日日志（归属日期切昨日）</button>
    </p>

    <!-- ② 昨日偏差 KPI 带：晨会要拿走的三个数字放大呈现（中标率 / 偏差率 / 罚款估算）。
         分层明细、最坏时段、补充数字等深度内容经深链落复盘中心结果核验，不在 S1 展开。 -->
    <section class="mr-panel mr-dev">
      <div class="mr-head">
        <h3>昨日偏差<em>标的日 {{ reviewedDate }}</em></h3>
        <button v-if="reviewed" type="button" class="link" @click="goReview('result')">完整复盘 →</button>
      </div>
      <p v-if="loading" class="mr-muted">读取昨日申报单…</p>
      <p v-else-if="loadError" class="mr-err">{{ loadError }}</p>
      <p v-else-if="!reviewed" class="mr-muted">
        {{ reviewedDate }} 无申报单，无可复盘对象（昨日未作业）；仍可写今日要点后开工。
      </p>
      <template v-else>
        <div class="mr-kpis">
          <div class="mr-kpi">
            <span class="mr-kpi-label"><Target :size="12" /> 中标率</span>
            <span class="mr-kpi-value" :class="{ 'is-bad': analysis && clearRateBad, 'is-empty': !analysis || analysis.clearRate === null }">
              {{ analysis && analysis.clearRate !== null ? (analysis.clearRate * 100).toFixed(1) + '%' : '—' }}
            </span>
            <span class="mr-kpi-sub">
              <template v-if="analysis">申报 {{ declaredTotalMwh.toFixed(1) }} · 出清 {{ analysis.totalClearedMwh.toFixed(1) }} MWh</template>
              <template v-else>出清未登记</template>
            </span>
          </div>
          <div class="mr-kpi">
            <span class="mr-kpi-label"><Activity :size="12" /> 执行偏差率</span>
            <span class="mr-kpi-value" :class="{ 'is-bad': execPctBad, 'is-empty': execDeviationPct === null }">
              {{ execDeviationPct !== null ? (execDeviationPct * 100).toFixed(2) + '%' : '—' }}
            </span>
            <span class="mr-kpi-sub">
              <template v-if="execLoading">取实际电量并计算偏差…</template>
              <template v-else-if="execFailure">{{ execFailure.title }}</template>
              <template v-else-if="execReview">
                偏差 {{ execReview.deviation.total_abs_deviation_mwh.toFixed(2) }} MWh<template v-if="worstPointLabel"> · 最坏点 {{ worstPointLabel }}</template>
              </template>
              <template v-else>无申报曲线基准</template>
            </span>
          </div>
          <div class="mr-kpi">
            <span class="mr-kpi-label"><CircleAlert :size="12" /> 罚款估算</span>
            <span class="mr-kpi-value" :class="{ 'is-bad': execReview && execReview.deviation.estimated_penalty_yuan > 0, 'is-empty': !execReview }">
              <template v-if="execReview">{{ execReview.deviation.estimated_penalty_yuan.toFixed(0) }}<i>元</i></template>
              <template v-else>—</template>
            </span>
            <span class="mr-kpi-sub">
              <template v-if="execReview">免罚带 ±{{ (execReview.deviation.tolerance_pct * 100).toFixed(0) }}% · 考核口径</template>
              <template v-else-if="execFailure">口径未接入</template>
              <template v-else>—</template>
            </span>
          </div>
        </div>
        <!-- 口径与诚实空态：异常说明一行带出，不藏在折叠里 -->
        <p v-if="execFailure" class="mr-story mr-muted">{{ execFailure.description }}</p>
        <p v-if="analysis" class="mr-story">
          单据 {{ reviewed.id }}（{{ STATUS_LABEL[reviewed.status] }}）· {{ analysis.summary }}
        </p>
        <!-- 口径边界由后端随响应下发，原样呈现并紧邻数字（trading-day.md §S1①：
             数字本身不带口径，不显示等于把「按平台实时电量自算」悄悄当成电网结算结论）。 -->
        <details v-if="execReview?.caliber_caveats?.length" class="mr-caveat">
          <summary>口径边界 · 这份偏差不能当作什么（{{ execReview.caliber_caveats.length }} 条）</summary>
          <ul><li v-for="(c, i) in execReview.caliber_caveats" :key="i">{{ c }}</li></ul>
        </details>
      </template>
    </section>

    <!-- 主区双栏：左复盘材料（行式列表）· 右复盘结论写回（视觉主角，S1 唯一写回产出）。
         窄屏（≤1240px）退化为单栏，顺序保持材料在前、写回在后。 -->
    <div class="mr-main">
      <!-- ③ 复盘材料：一张平铺列表——各分区首屏内容直接可见（零点击），
           只有清单超长时在子组件内就地截断（风险>4 行 / 措施>3 条给「展开全部」）。
           「重要发现优先」：风险置顶；待办与台账是直达行。 -->
      <section class="mr-summary">
        <h3>复盘材料<em>昨日 {{ reviewedDate }}</em></h3>
        <div class="mr-mat-list">
          <div class="mr-mat">
            <div class="mr-sec-head">
              <ShieldAlert :size="14" class="mr-mat-ico" />
              <b>风险复盘</b>
              <!-- data_gap 口径说明挂分区头 ⓘ（诚实标注不折叠，悬浮即达） -->
              <el-tooltip placement="top" :show-after="150">
                <template #content>
                  <p>{{ NODE_PRICE_SPIKE_DATA_GAP_NOTE }}</p>
                  <p>{{ STOP_LOSS_DATA_GAP_NOTE }}</p>
                </template>
                <span class="mr-title-info" tabindex="0">ⓘ</span>
              </el-tooltip>
              <span class="mr-mat-status" :class="{ 'is-warn': riskFeedAvailable && yesterdayRiskEvents.length > 0 }">{{ riskRowStatus }}</span>
            </div>
            <div class="mr-mat-body">
              <MorningRiskPanel
                bare
                :events="yesterdayRiskEvents"
                :available="riskFeedAvailable"
                :window-label="`昨日 ${reviewedDate}`"
                @go-risk-library="goReview('result')"
              />
            </div>
          </div>

          <div class="mr-mat">
            <div class="mr-sec-head">
              <MoonStar :size="14" class="mr-mat-ico" />
              <b>昨夜智能体报告</b>
              <span class="mr-mat-status" :class="{ 'is-warn': reportRowStatus === '昨夜未生成' }">{{ reportRowStatus }}</span>
            </div>
            <div class="mr-mat-body">
              <OvernightReportCard bare @status="reportRowStatus = $event" />
            </div>
          </div>

          <div class="mr-mat">
            <div class="mr-sec-head">
              <ClipboardList :size="14" class="mr-mat-ico" />
              <b>本日适用措施</b>
              <span class="mr-mat-status">{{ actionsRowStatus }}</span>
            </div>
            <div class="mr-mat-body">
              <MorningSummaryCard bare :target-date="targetDate" @status="actionsRowStatus = $event" />
            </div>
          </div>

          <!-- 复盘待办：直达行（点击进待办箱），无展开态 -->
          <ReviewTodoBadge variant="row" />

          <!-- 决策台账：直达行——条数/填写率/存储模式一行呈现，回顾经深链落复盘中心 -->
          <p class="mr-logline">
            <b>决策台账</b>
            <template v-if="reviewedEntryCount">
              <span>{{ reviewedEntryCount }} 条 · 填写率 {{ logCoverage.recorded }}/{{ logCoverage.expected }}</span>
              <span v-if="!logCoverage.meetsVeto" class="is-warn"><TriangleAlert :size="12" /> 未达一票否决线</span>
            </template>
            <span v-else class="mr-mat-status">{{ reviewedDate }} 无条目</span>
            <el-tooltip placement="top" :show-after="150" :content="logNotice">
              <em class="mr-logmode">{{ logMode === 'local' ? '原型态（本地日志）' : '服务端台账' }}</em>
            </el-tooltip>
            <button type="button" class="link" @click="goReview('decision')">去复盘中心回顾 →</button>
          </p>
        </div>
      </section>

      <!-- ④ 复盘结论 → 写回今日单据（S1 唯一写回产出；立场焦点一行并入卡头，
           写回契约与锁定期说明收进标题 ⓘ——视觉重排后不再常驻成段） -->
      <section class="mr-panel mr-write">
        <h3 class="mr-write-head">
          <span class="mr-head-title">复盘结论 → 写回今日单据</span>
          <!-- 写回契约与锁定期说明收进 ⓘ（视觉重排：说明文字不再常驻成段，观感优先；悬浮即达） -->
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              <p>复盘结论写回今日申报单（preflight.morningReview），S7 日报收尾会把它带进当日闭环记录。</p>
              <p>提交申报后本段锁定，不接受事后改写。</p>
              <p>归因判不了就选「待分析」——随手挑一个主因比留空更坏。</p>
            </template>
            <span class="mr-title-info" tabindex="0">ⓘ</span>
          </el-tooltip>
          <AiAssistFill
            kind="morning_review"
            :context="assistContext"
            :field-labels="ASSIST_LABELS"
            label="AI 帮我归因"
            :disabled-reason="analysis || execReview || reviewed ? '' : '昨日无申报单与偏差数据，AI 无判断依据'"
            @apply="applyAssist"
          />
        </h3>
        <p v-if="reviewFocus" class="mr-focus-line">
          <strong>{{ stanceLabel }}复盘目标：{{ reviewFocus.goal }}</strong>
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              <p v-for="(pt, i) in reviewFocus.reviewPoints" :key="i">{{ pt }}</p>
            </template>
            <span class="mr-title-info" tabindex="0">ⓘ</span>
          </el-tooltip>
        </p>
        <div v-if="written" class="mr-written">
          已写回：{{ causeLabelOf(written.cause) }}<template v-if="written.responsibility"> · 责任归属 {{ responsibilityLabelOf(written.responsibility) }}</template><template v-if="written.deviationCostYuan != null"> · 偏差成本 {{ written.deviationCostYuan.toFixed(0) }} 元</template> —— {{ written.lessons }}
          <em>（{{ written.writtenBy }}）</em>
          <strong v-if="written.pendingAnalysis" class="mr-pending">待晨会讨论后回填主因</strong>
        </div>
        <div class="mr-form">
          <label>
            偏差主因
            <select v-model="cause">
              <option value="">选择…</option>
              <option v-for="c in DEVIATION_CAUSES" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </label>
          <el-tooltip
            placement="top"
            :show-after="150"
            :disabled="!responsibilityHint"
            :content="responsibilityHint ? `责任归属 · ${responsibilityHint.label}：${responsibilityHint.hint}` : ''"
          >
            <label>
              责任归属<template v-if="cause === 'none'"><span class="mr-opt">「无明显偏差」时可免</span></template>
              <select v-model="responsibility" :disabled="cause === 'none'">
                <option value="">选择…</option>
                <option v-for="r in DEVIATION_RESPONSIBILITY" :key="r.id" :value="r.id">{{ r.label }}</option>
              </select>
            </label>
          </el-tooltip>
          <label class="mr-full">
            今日不重犯要点
            <input v-model="lessons" type="text" placeholder="如：晚高峰段预测系统性偏低，今日上调 5% 再核" />
          </label>
        </div>
        <p v-if="causeHint" class="mr-hint">
          <strong>{{ causeHint.label }}</strong>：{{ causeHint.hint }} → <em>{{ causeHint.nextAction }}</em>
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
          <!-- #2040 S1 实机计时（呈现only，零写回） -->
          <span v-if="s1ElapsedFinal !== null" class="mr-ok" :class="{ 'mr-s1-slow': s1View.slow }">
            本次 S1 用时 {{ s1ElapsedFinal }} 分钟{{ s1View.slow ? '（超过 5 分钟，流程观察项——不影响写回）' : '' }}
          </span>
          <span v-else-if="s1View.elapsedMinutes !== null" class="mr-muted" :class="{ 'mr-s1-slow': s1View.slow }">
            S1 已进行 {{ s1View.elapsedMinutes }} 分钟{{ s1View.slow ? '（超过 5 分钟）' : '' }}
          </span>
        </div>
        <ul v-if="!validation.ok && (cause || lessons)" class="mr-invalid">
          <li v-for="(e, i) in validation.errors" :key="i">{{ e }}</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ── S1 视觉重排（s1-visual-redesign 方案 B）───────────────────────────────────
 * 纪律：一套卡片配方（12px 圆角 / 1px var(--line) / var(--panel) 底 / 无阴影）；
 * 层级靠「字号跳变 + 字重 + 颜色」三杠杆（KPI 26px 大数字 vs 11.5px 灰标签）；
 * 颜色配给——红=越限事实、琥珀=待人处理、绿=完成态、accent=链接、primary=唯一主动作。 */
.mr { display: flex; flex-direction: column; gap: 12px; }

/* 卡片统一配方 */
.mr-panel { padding: 14px 16px 12px; border: 1px solid var(--line, #d9e2ec); border-radius: 12px; background: var(--panel, #fff); }
.mr-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.mr-head h3, .mr-summary h3 { margin: 0; font-size: var(--font-lg, 15px); font-weight: 600; color: var(--text, #1f2a37); display: flex; align-items: center; min-width: 0; }
/* 区块标题主色竖条：扫读锚点 */
.mr-head h3::before, .mr-summary h3::before { content: ''; flex: none; width: 3px; height: 14px; border-radius: 2px; background: var(--primary, #0f766e); margin-right: 8px; }
.mr-head h3 em, .mr-summary h3 em { font-style: normal; margin-left: 6px; font-size: var(--font-xs, 11.5px); font-weight: 400; color: var(--muted, #667085); }
.mr-head .link { margin-left: auto; white-space: nowrap; }

/* ② KPI 带：眉题标签（图标+小灰字）→ 大号粗体数字 → 灰副标题；发丝竖线分格 */
.mr-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mr-kpi { display: flex; flex-direction: column; gap: 3px; padding: 6px 18px 4px 0; min-width: 0; }
.mr-kpi + .mr-kpi { padding-left: 18px; border-left: 1px solid var(--line-faint, #f0f2f5); }
.mr-kpi-label { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-xs, 11.5px); color: var(--muted, #667085); letter-spacing: 0.05em; }
.mr-kpi-label :deep(svg) { flex: none; }
.mr-kpi-value { font-size: var(--font-28, 28px); font-weight: 700; line-height: 1.25; color: var(--text, #1f2a37); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.mr-kpi-value.is-bad { color: var(--danger, #dc2626); }
.mr-kpi-value.is-empty { color: var(--line, #d9e2ec); font-weight: 600; }
.mr-kpi-value i { font-style: normal; margin-left: 3px; font-size: var(--font-sm, 13px); font-weight: 500; color: var(--muted, #667085); }
.mr-kpi-sub { font-size: var(--font-xs, 11.5px); color: var(--muted, #667085); font-variant-numeric: tabular-nums; }
.mr-story { margin: 10px 0 0; font-size: var(--font-sm, 13px); line-height: 1.7; color: var(--text-soft, #475467); }

/* 口径边界折叠（原样呈现后端下发内容，紧邻数字） */
.mr-caveat { margin-top: 8px; font-size: var(--font-xs, 11.5px); color: var(--warning, #d97706); }
.mr-caveat summary { cursor: pointer; }
.mr-caveat ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.6; }

/* 主区双栏：左材料 / 右写回（≥1240px）；各栏独立高度（右栏后续长高不带动左栏），
   左栏 min-height 对齐右栏初始高度，窄屏单栏 */
.mr-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); gap: 12px; align-items: start; }
@media (max-width: 1240px) { .mr-main { grid-template-columns: 1fr; } .mr-summary { min-height: auto; } }
@media (min-width: 1241px) { .mr-summary { min-height: 313px; } }

/* ③ 复盘材料：一张列表卡，分区发丝线分隔；分区头 = 图标 + 标题 + 状态摘要（非按钮，无折叠）。
   行距放宽（与右栏等高对齐的呼吸感） */
.mr-summary { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--line, #d9e2ec); border-radius: 12px; background: var(--panel, #fff); }
.mr-mat-list { display: flex; flex-direction: column; flex: 1; border: 1px solid var(--line-faint, #f0f2f5); border-radius: 8px; overflow: hidden; }
.mr-mat-list > * + * { border-top: 1px solid var(--line-faint, #f0f2f5); }
.mr-sec-head { display: flex; align-items: center; gap: 8px; padding: 11px 12px 3px; font-size: var(--font-sm, 13px); }
.mr-sec-head b { font-weight: 600; color: var(--text, #1f2a37); }
.mr-mat-ico { flex: none; color: var(--muted, #667085); }
.mr-mat-status { margin-left: auto; padding-left: 8px; font-size: var(--font-xs, 11.5px); color: var(--muted, #667085); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-mat-status.is-warn, .is-warn { color: var(--warning, #d97706); }
.mr-mat-body { padding: 4px 12px 10px 34px; }

/* 决策台账直达行（mr-logline 语义保留）：与材料行同款高度与排布 */
.mr-logline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; padding: 10px 12px; font-size: var(--font-sm, 13px); color: var(--text-soft, #475467); }
.mr-logline b { font-weight: 600; color: var(--text, #1f2a37); }
.mr-logline .link { margin-left: auto; }
.mr-logmode { font-style: normal; font-size: var(--font-xs, 11.5px); color: var(--warning, #d97706); cursor: help; }

/* 强制补写横幅（合法阻断态，保持常驻可见） */
.mr-backfill-block { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 8px 14px; border: 1px solid var(--danger, #f87171); border-radius: 12px; background: var(--danger-tint, #fde8e4); color: var(--danger, #991b1b); font-size: var(--font-sm, 13px); line-height: 1.6; }
.mr-jump { padding: 0; border: none; background: none; color: var(--danger, #dc2626); font: inherit; font-size: var(--font-sm, 13px); font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

/* ④ 写回卡：视觉主角——主色顶线 + 标题区主色浅底渐变；唯一实心主按钮。
   标题行 = 标题 → ⓘ → AI 控件，全部左对齐自然排布（AI 禁用提示跟在按钮后，不推右）。 */
.mr-write { border-color: var(--primary-tint-border, #d7f0ea); border-top: 3px solid var(--primary, #0f766e); }
.mr-write-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: -14px -16px 10px; padding: 10px 16px 8px; font-size: var(--font-lg, 15px); font-weight: 600; background: linear-gradient(180deg, var(--primary-tint, #ecfdf5), rgba(255, 255, 255, 0)); border-bottom: 1px solid var(--line-faint, #f0f2f5); border-radius: 9px 9px 0 0; }
.mr-write-head .mr-head-title { flex: none; }
.mr-write-head > :deep(.aaf) { margin-left: 0; font-weight: 400; }
/* 复盘目标行：小字紧凑，文字带 ⓘ 尽量一行放下（ⓘ 跟随文字末尾，不掉到第二行孤行） */
.mr-focus-line { margin: 0 0 8px; padding: 4px 8px; border-radius: 8px; background: var(--panel-sub, #f8fafc); font-size: var(--font-11, 11px); line-height: 1.6; }
.mr-focus-line strong { color: var(--primary-strong, #0b5f59); }
.mr-focus-line span { color: var(--muted, #667085); font-size: var(--font-xs, 11.5px); }
.mr-title-info { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 1px solid var(--line, #d9e2ec); border-radius: 50%; background: var(--panel-sub, #f8fafc); color: var(--muted, #667085); font-size: var(--font-10, 10px); font-style: normal; cursor: help; user-select: none; }
.mr-written { margin-bottom: 10px; padding: 7px 10px; border-radius: 8px; background: var(--primary-tint, #f0fdf4); color: var(--success, #166534); font-size: var(--font-sm, 13px); line-height: 1.7; }
.mr-written em { font-style: normal; color: var(--success, #4d7c0f); }
.mr-pending { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: var(--warning-tint, #fff8e8); color: var(--warning, #d97706); font-weight: 600; }
.mr-form { display: flex; flex-direction: column; gap: 7px; }
.mr-form label { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-xs, 11.5px); color: var(--text-soft, #475467); }
.mr-form .mr-opt { margin-left: 6px; font-size: var(--font-xs, 11.5px); color: var(--muted, #667085); }
.mr-form select, .mr-form input { padding: 6px 10px; border: 1px solid var(--line, #d9e2ec); border-radius: 6px; font-size: var(--font-md, 13px); font-family: inherit; color: var(--text, #1f2a37); background: var(--panel, #fff); transition: border-color 0.15s ease; }
.mr-form select:focus, .mr-form input:focus { outline: 2px solid var(--primary-tint-border, #d7f0ea); border-color: var(--primary, #0f766e); }
.mr-hint { margin: 10px 0 0; font-size: var(--font-xs, 11.5px); line-height: 1.6; color: var(--muted, #667085); }
.mr-hint em { font-style: normal; color: var(--accent, #2563eb); }
.mr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.mr-actions .primary { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border: 1px solid var(--primary, #0f766e); border-radius: 6px; background: var(--primary, #0f766e); color: #fff; font-size: var(--font-md, 13px); font-weight: 600; cursor: pointer; transition: background 0.15s ease; }
.mr-actions .primary:hover:not(:disabled) { background: var(--primary-strong, #0b5f59); border-color: var(--primary-strong, #0b5f59); }
.mr-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.mr-actions .ghost { padding: 7px 12px; border: 1px solid var(--line, #d9e2ec); border-radius: 6px; background: transparent; color: var(--text-soft, #475467); font-size: var(--font-md, 13px); cursor: pointer; transition: color 0.15s ease, border-color 0.15s ease; }
.mr-actions .ghost:hover { color: var(--text, #1f2a37); border-color: var(--muted, #667085); }
.mr-invalid { margin: 8px 0 0; padding-left: 18px; font-size: var(--font-xs, 11.5px); line-height: 1.7; color: var(--danger, #dc2626); }

/* 通用状态文字 */
.mr-muted { margin: 0; font-size: var(--font-sm, 13px); color: var(--muted, #667085); line-height: 1.7; }
.mr-err { margin: 0; padding: 6px 10px; border-radius: 8px; background: var(--danger-tint, #fde8e4); color: var(--danger, #991b1b); font-size: var(--font-sm, 13px); }
.mr-err-inline { font-size: var(--font-sm, 13px); color: var(--danger, #dc2626); }
.mr-ok { font-size: var(--font-sm, 13px); color: var(--success, #16803c); }
.mr-s1-slow { color: var(--warning, #d97706); }
.link { padding: 0; border: 0; background: none; color: var(--accent, #2563eb); font-size: var(--font-sm, 13px); cursor: pointer; }
.link:hover { text-decoration: underline; text-underline-offset: 2px; }
</style>
