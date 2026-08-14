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
  causeIdOfLabel,
  causeLabelOf,
  DEVIATION_CAUSES,
  isPendingCause,
  morningWindowState,
  MORNING_WINDOW_NOTE,
  validateMorningReview
} from 'shared/trading-rules/morning-review.mjs'
import { onRegionChange } from '@/composables/useRegionReload'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
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
const cause = ref<string>('')
const lessons = ref('')
const validation = computed(() => validateMorningReview({ cause: cause.value, lessons: lessons.value }))
const causeHint = computed(() => DEVIATION_CAUSES.find((c) => c.id === cause.value) ?? null)

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

async function writeBack() {
  if (!props.declaration || !validation.value.ok) return
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

    <section class="mr-panel">
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
      </template>
    </section>

    <section class="mr-panel">
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

    <section class="mr-panel">
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
      </div>
      <p v-if="!reviewedEntries.length" class="mr-muted">{{ reviewedDate }} 无决策日志条目——昨日决策未留痕，无从回顾。</p>
      <table v-else-if="showEntries" class="mr-table mr-entries">
        <thead><tr><th>#</th><th>决策点</th><th>结论</th><th>P10–P90</th><th>实际</th><th>心得</th></tr></thead>
        <tbody>
          <tr v-for="e in reviewedEntries" :key="e.id">
            <td>{{ e.seq }}</td>
            <td>{{ e.decisionPoint }}</td>
            <td class="mr-wrap">{{ e.judgement }}</td>
            <td>{{ e.p10 }}–{{ e.p90 }}</td>
            <td :class="e.actual === null ? 'mr-muted' : ''">{{ e.actual === null ? '未回填' : e.actual }}</td>
            <td class="mr-wrap">{{ e.lesson || '—' }}</td>
          </tr>
        </tbody>
      </table>
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
        已写回：{{ causeLabelOf(written.cause) }} —— {{ written.lessons }}
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
          :disabled="!declaration || !validation.ok || saving"
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
.mr-window { margin: 0; padding: 6px 12px; border-radius: 8px; font-size: 12px; }
.mr-window-within { background: #f0fdf4; color: #166534; }
.mr-window-before { background: #f8fafc; color: #475569; }
.mr-window-after { background: #fffbeb; color: #a16207; }
.mr-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.mr-panel h3 { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 8px; font-size: 13px; flex-wrap: wrap; }
.mr-muted { margin: 0; font-size: 12px; color: var(--el-text-color-secondary, #667); }
.mr-detail { margin-top: 4px; font-family: ui-monospace, monospace; font-size: 11px; }
.mr-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.mr-err-inline { font-size: 12px; color: #b91c1c; }
.mr-empty { margin: 0 0 4px; padding: 6px 10px; border-radius: 6px; background: #f8fafc; color: #475569; font-size: 12px; }
.mr-warn { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; background: #fffbeb; color: #a16207; font-size: 12px; }
.mr-ok { font-size: 12px; color: #15803d; }
.mr-bad { color: #b91c1c; display: inline-flex; align-items: center; gap: 3px; }
.mr-facts { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; font-size: 12px; font-variant-numeric: tabular-nums; }
.mr-decl { font-family: ui-monospace, monospace; }
.mr-decl em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; }
.mr-summary { margin: 8px 0 0; font-size: 12px; line-height: 1.6; }
.mr-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; margin-top: 6px; }
.mr-table th, .mr-table td { padding: 3px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.mr-table th:first-child, .mr-table td:first-child { text-align: left; }
.mr-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.mr-entries td, .mr-entries th { text-align: left; }
.mr-wrap { max-width: 220px; white-space: normal; line-height: 1.5; }
.mr-caveat { margin-top: 8px; font-size: 11px; color: #a16207; }
.mr-caveat summary { cursor: pointer; }
.mr-caveat ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.6; }
.mr-log { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; }
.mr-proto { margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); font-size: 11px; line-height: 1.6; color: #a16207; }
.mr-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: 12px; }
.mr-written em { font-style: normal; color: #4d7c0f; }
.mr-pending { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 8px; background: #fffbeb; color: #a16207; font-weight: 600; }
.mr-form { display: flex; gap: 10px; flex-wrap: wrap; }
.mr-form label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.mr-form .mr-full { flex: 1; min-width: 320px; }
.mr-form select, .mr-form input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.mr-hint { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.mr-hint em { font-style: normal; color: #1d4ed8; }
.mr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.mr-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }
.mr-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.mr-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.mr-invalid { margin: 8px 0 0; padding-left: 18px; font-size: 11px; line-height: 1.7; color: #b91c1c; }
.link { padding: 0; border: 0; background: none; color: #2563eb; font-size: 12px; cursor: pointer; }
.mr-note { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: #a16207; }
</style>
