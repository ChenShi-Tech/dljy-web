<script setup lang="ts">
// S1 晨会复盘（08:00–08:30）—— 一天从收口昨日开始，5 分钟内完成。
//
// 定位（#2033 review-center-foundation §一.1）：晨会是**复盘中心产物的摘要消费者**，
// 不承担完整结算、策略验证和历史研究。主脸四块：
//   ① 状态行（窗口提示等说明性口径收纳）；
//   ② 昨日偏差结论卡——中标情况（申报 vs 出清，analyzeClearing 前端纯函数）与执行偏差
//      （申报 vs 实际，后端 quant /review 权威实现）各给结论行，口径警示紧邻数字；
//   ③ 昨日复盘摘要块——重要发现（昨日风险事件）/ 昨夜复盘报告 / 本日适用措施 / 待办入口；
//   ④ 复盘结论写回卡——偏差主因 + 今日不重犯要点写回**今日**单据的 preflight.morningReview。
// 深度明细（分层明细、决策日志条目调阅、策略/市场复盘、角色表、三问）不在 S1 承载：
// 经带参数深链（goReview：date + declarationId + task）落到复盘中心对应任务承接。
//
// ①②是**两个不同的量，不可互相替代**：中标率答「我报的量中了多少」，执行偏差答
// 「我实际干的和我报的差多少、要交多少考核费」。只看中标率会漏掉「全中但执行跑偏」的那类亏损。
// 没有昨单就如实说「无可复盘对象」，仍允许写要点（首个交易日也要开工）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Save, TriangleAlert } from 'lucide-vue-next'
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
import { beijingDayStartUtc, eventsInWindow } from '@/services/review/morningRiskReview'
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

// ── 风险复盘（六维⑤ · #2015 第 2 期）：重要发现的承载面板（slim-s1 升入摘要块）──
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
    <!-- 数据与口径状态行（降噪 4.2/4.3）：窗口提示等说明性内容收进一行，展开看原文。
         主脸四块在其后：昨日偏差结论卡 → 决策日志摘要行 → 昨日复盘摘要块 → ④结论写回。 -->
    <DataStatusLine :items="statusItems" />

    <!-- 异常分支：昨日决策日志缺失 → 强制补写（KPI 100% 必填），未补不收口今日复盘 -->
    <p v-if="yesterdayLogMissing" class="mr-backfill-block">
      <TriangleAlert :size="13" />
      昨日（{{ yesterdayIso }}）有申报单但决策日志为空——按手册「当日未写日志，次日晨会强制补写」，
      今日复盘暂不可写回。
      <button type="button" class="mr-jump" @click="emit('go', 'daily-close')">去 S7 补写昨日日志（归属日期切昨日）</button>
    </p>

    <!-- 昨日偏差（①+②合并）：结论行上脸——中标率/偏差率/罚款即晨会要拿走的数字。
         分层明细、最坏时段、补充数字等深度内容经深链落复盘中心结果核验，不在 S1 展开。 -->
    <section class="mr-panel mr-dev">
      <h3>昨日偏差 · 中标与执行（标的日 {{ reviewedDate }}）</h3>
      <p v-if="loading" class="mr-muted">读取昨日申报单…</p>
      <p v-else-if="loadError" class="mr-err">{{ loadError }}</p>
      <p v-else-if="!reviewed" class="mr-muted">
        {{ reviewedDate }} 无申报单——无可复盘对象（首个交易日或昨日未作业）。仍可在下方写下今日要点后开工。
      </p>
      <template v-else>
        <div class="mr-dev-grid">
          <div class="mr-dev-col">
            <h4>中标情况 · 申报 vs 出清</h4>
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
          </div>
          <div class="mr-dev-col">
            <h4>执行偏差 · 申报 vs 实际（考核口径）</h4>
            <p v-if="execLoading" class="mr-muted">取实际电量并计算偏差…</p>
            <template v-else-if="execFailure">
              <p class="mr-empty">{{ execFailure.title }}</p>
              <p class="mr-muted">{{ execFailure.description }}</p>
            </template>
            <template v-else-if="execReview">
              <div class="mr-facts">
                <span>偏差 {{ execReview.deviation.total_abs_deviation_mwh.toFixed(2) }} MWh</span>
                <span :class="execDeviationPct !== null && execDeviationPct > 0.05 ? 'mr-bad' : 'mr-ok'">
                  偏差率 {{ execDeviationPct === null ? '—' : (execDeviationPct * 100).toFixed(2) + '%' }}
                </span>
                <span :class="execReview.deviation.estimated_penalty_yuan > 0 ? 'mr-bad' : ''">
                  罚款估算 {{ execReview.deviation.estimated_penalty_yuan.toFixed(0) }} 元
                </span>
              </div>
              <p v-if="execReview.deviation.worst_point?.datetime" class="mr-summary">
                最坏点 {{ execReview.deviation.worst_point.datetime }}，偏差
                {{ execReview.deviation.worst_point.deviation.toFixed(2) }} MWh（免罚带
                {{ (execReview.deviation.tolerance_pct * 100).toFixed(0) }}%）
              </p>
              <!-- 口径边界由后端随响应下发，原样呈现并紧邻数字（trading-day.md §S1①：
                   数字本身不带口径，不显示等于把「按平台实时电量自算」悄悄当成电网结算结论）。 -->
              <details v-if="execReview.caliber_caveats?.length" class="mr-caveat">
                <summary>口径边界 · 这份偏差不能当作什么（{{ execReview.caliber_caveats.length }} 条）</summary>
                <ul><li v-for="(c, i) in execReview.caliber_caveats" :key="i">{{ c }}</li></ul>
              </details>
            </template>
            <p v-else class="mr-muted">昨单无申报曲线，执行偏差无基准。</p>
          </div>
        </div>
        <div class="mr-dev-more">
          <button type="button" class="link" @click="goReview('result')">分层明细 · 最坏时段 · 完整复盘 →</button>
        </div>
      </template>
    </section>

    <!-- 昨日决策日志摘要行（spec「决策日志回顾为摘要行」）：条目调阅与逐条三问在
         复盘中心决策评价承接；此处只报数量、填写率异常与存储模式（原型态标识不折叠）。 -->
    <p class="mr-logline">
      <strong>昨日决策日志</strong>
      <template v-if="reviewedEntryCount">
        <span>{{ reviewedEntryCount }} 条 · 填写率 {{ logCoverage.recorded }}/{{ logCoverage.expected }}</span>
        <span v-if="!logCoverage.meetsVeto" class="mr-bad"><TriangleAlert :size="12" /> 未达一票否决线</span>
      </template>
      <span v-else class="mr-muted">{{ reviewedDate }} 无决策日志条目</span>
      <el-tooltip placement="top" :show-after="150" :content="logNotice">
        <em class="mr-logmode">{{ logMode === 'local' ? '原型态（本地日志）' : '服务端台账' }}</em>
      </el-tooltip>
      <button type="button" class="link" @click="goReview('decision')">去复盘中心回顾 →</button>
    </p>

    <!-- 昨日复盘摘要（#2033 foundation 模块协作表：晨会只带重要发现、未解决问题与
         本日适用措施）：风险事件（重要发现）升入本块置顶；其余三类入口只读/跳转，
         不给 S1 增加填写负担（<5 分钟红线）。 -->
    <section class="mr-summary">
      <h3>昨日复盘摘要</h3>
      <MorningRiskPanel
        :events="yesterdayRiskEvents"
        :available="riskFeedAvailable"
        :window-label="`昨日 ${reviewedDate}`"
        @go-risk-library="goReview('result')"
      />
      <div class="mr-summary-row">
        <div class="mr-report-slot"><OvernightReportCard /></div>
        <ReviewTodoBadge />
      </div>
      <MorningSummaryCard :target-date="targetDate" />
    </section>

    <!-- 复盘结论 → 写回今日单据（S1 唯一写回产出；立场焦点一行并入卡头，
         写回契约与锁定期说明收进 ⓘ tooltip——不再常驻成段） -->
    <section class="mr-panel">
      <h3>
        复盘结论 → 写回今日单据
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
          偏差主因（为什么发生）
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
            责任归属（谁该负责）<template v-if="cause === 'none'"><span class="mr-opt">主因「无明显偏差」时可免</span></template>
            <select v-model="responsibility" :disabled="cause === 'none'">
              <option value="">选择…</option>
              <option v-for="r in DEVIATION_RESPONSIBILITY" :key="r.id" :value="r.id">{{ r.label }}</option>
            </select>
          </label>
        </el-tooltip>
        <label class="mr-full">
          今日不重犯要点（≥4 字，会随单据留痕）
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
      <p class="mr-note">
        复盘结论写回今日申报单（preflight.morningReview），S7 日报收尾会把它带进当日闭环记录。
        提交申报后本段锁定，不接受事后改写。归因判不了就选「待分析」——随手挑一个主因比留空更坏。
      </p>
    </section>
  </div>
</template>

<style scoped>
.mr { display: flex; flex-direction: column; gap: 12px; }
/* 昨日偏差合并卡：左右两栏结论 + 深链入口行 */
.mr-dev-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px 18px; }
.mr-dev-col h4 { margin: 0 0 6px; font-size: var(--font-sm); color: var(--el-text-color-regular, #606266); }
.mr-dev-more { display: flex; gap: 14px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); flex-wrap: wrap; }
/* 昨日复盘摘要块：四类摘要入口统一收纳 */
.mr-summary { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.mr-summary h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--font-md); }
.mr-summary-row { display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; }
.mr-report-slot { flex: 1 1 320px; min-width: 0; display: flex; }
.mr-report-slot > * { flex: 1; }
.mr-backfill-block { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 7px 12px; border: 1px solid #f87171; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); line-height: 1.6; }
.mr-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
/* 决策日志摘要行（条目调阅移交复盘中心）：单行呈现数量/填写率/存储模式/深链 */
.mr-logline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 0; padding: 6px 14px; border: 1px dashed var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fcfcfd; font-size: var(--font-sm); }
.mr-logline strong { font-size: var(--font-md); }
.mr-logmode { font-style: normal; font-size: var(--font-xs); color: #a16207; cursor: help; }
/* 立场焦点一行（并入写回卡头） */
.mr-focus-line { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; background: #f8fbff; font-size: var(--font-sm); line-height: 1.7; }
.mr-focus-line strong { color: #075985; }
.mr-focus-line span { color: #475569; font-size: var(--font-xs); }
.mr-muted { color: var(--el-text-color-secondary, #909399); font-size: var(--font-sm); }
.mr-s1-slow { color: #b45309; }
.mr-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.mr-panel h3 { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 8px; font-size: var(--font-md); flex-wrap: wrap; }
.mr-muted { margin: 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.mr-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); }
.mr-err-inline { font-size: var(--font-sm); color: #b91c1c; }
.mr-empty { margin: 0 0 4px; padding: 6px 10px; border-radius: 6px; background: #f8fafc; color: #475569; font-size: var(--font-sm); }
.mr-ok { font-size: var(--font-sm); color: #15803d; }
.mr-bad { color: #b91c1c; display: inline-flex; align-items: center; gap: 3px; }
.mr-facts { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.mr-decl { font-family: ui-monospace, monospace; }
.mr-decl em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; }
.mr-summary { margin: 8px 0 0; font-size: var(--font-sm); line-height: 1.6; }
.mr-caveat { margin-top: 8px; font-size: var(--font-xs); color: #a16207; }
.mr-caveat summary { cursor: pointer; }
.mr-caveat ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.6; }
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
/* 写回契约说明：恢复卡内下方常驻段落（点位单一且是操作前提，比 tooltip 更可达） */
.mr-note { margin: 8px 0 0; font-size: var(--font-xs); line-height: 1.6; color: #a16207; }
/* 立场焦点行 ⓘ（第五轮订正：样式块在第五轮换回 .mr-note 时被一并替换掉，此处补回，与风险面板 .mrp-info 同款） */
.mr-title-info { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 50%; background: #f8fafc; color: var(--el-text-color-secondary, #667); font-size: var(--font-10); font-style: normal; cursor: help; user-select: none; }
.mr-opt { margin-left: 6px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); }
</style>
