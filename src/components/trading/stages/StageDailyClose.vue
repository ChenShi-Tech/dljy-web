<script setup lang="ts">
// S7 日报收尾（16:30–17:30）—— 一日闭环的收口
//
// 两件事，缺一不可：
//   ① 决策日志（T7，append-only + 哈希链）：当日每个决策点都必须留痕，填写率是一票否决 KPI。
//      理由不在管理考核而在监管质询时它是唯一能自证报价形成过程的材料——所以记下去就改不了。
//   ② 当日日报：从各阶段写回产出自动汇总（市场判断 / 方向 / 中标 / 补仓），交易员补一句
//      总体小结后写回 preflight.dailyClose——它把今日单据的七段产出盖一个收口戳。
//
// ⚠️ 决策日志为原型态：链存浏览器本地、哈希前端计算，能检出误改但不防蓄意篡改，
// 也不具备 ≥5 年留存——这条限制常驻显示。生产化方向是服务端存储 + 服务端哈希。
import { computed, onMounted, reactive, ref } from 'vue'
import { NotebookPen, ShieldAlert, Link2, RefreshCw, Save, FileText } from 'lucide-vue-next'
import { coverageOf, hitRate, validateDraft, verifyChain, type DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import { REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import {
  PROTOTYPE_STORAGE_NOTICE,
  appendAndPersist,
  backfillAndPersist,
  clearLog,
  correctAndPersist,
  loadLog
} from '@/services/trading/decisionLogStore'
import { savePreflight, STATUS_LABEL, type DeclarationOrder } from '@/services/declarations'
import { GAP_SUGGESTION_LABEL } from '@/services/trading/contractGap'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})

// ── ① 决策日志 ──────────────────────────────────────────────────────────────
const log = ref<DecisionLogEntry[]>([])
const errorMsg = ref('')
const expectedPoints = ref(3)

const form = reactive({
  decisionPoint: '',
  judgement: '',
  rationale: '',
  p10: 180,
  p50: 240,
  p90: 380,
  confidence: 70,
  author: '',
  correctionOf: null as string | null
})

const chain = computed(() => verifyChain(log.value))
const coverage = computed(() => coverageOf(log.value, props.targetDate, expectedPoints.value))
const hits = computed(() => hitRate(log.value))
const issues = computed(() =>
  validateDraft({ at: new Date().toISOString(), targetDate: props.targetDate, ...form })
)

onMounted(() => { log.value = loadLog() })

function submit() {
  errorMsg.value = ''
  try {
    const { correctionOf, ...fields } = form
    const draft = { at: new Date().toISOString(), targetDate: props.targetDate, ...fields }
    log.value = correctionOf
      ? correctAndPersist(correctionOf, draft)
      : appendAndPersist({ ...draft, correctionOf: null })
    form.decisionPoint = ''
    form.judgement = ''
    form.rationale = ''
    form.correctionOf = null
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '写入失败'
  }
}

function startCorrection(entry: DecisionLogEntry) {
  form.correctionOf = entry.id
  form.decisionPoint = entry.decisionPoint
  form.judgement = ''
  form.rationale = ''
  form.p10 = entry.p10
  form.p50 = entry.p50
  form.p90 = entry.p90
  form.confidence = entry.confidence
}

const backfillTarget = ref('')
const backfillValue = ref<number | null>(null)
const backfillLesson = ref('')

function doBackfill() {
  if (!backfillTarget.value || backfillValue.value === null) return
  log.value = backfillAndPersist(backfillTarget.value, backfillValue.value, backfillLesson.value || undefined)
  backfillTarget.value = ''
  backfillValue.value = null
  backfillLesson.value = ''
}

function reset() { log.value = clearLog() }

// ── AI 辅助填报：决策日志的判断/理由/概率分位全是**人工经验判断**──────────────
// 这是全链最典型的辅助场景：P10/P50/P90 是交易员对价格分布的主观估计（没有数据库
// 可查），判断结论与理由要把当日各步产出串成一句话。AI 拿到当日全部已算好的产出
// （S1–S6 写回 + 决策点名称），给出结构化建议；采纳后仍可手改，写入哈希链的是人确认的值。
const ASSIST_LABELS = {
  judgement: '判断结论', rationale: '理由', p10: 'P10', p50: 'P50', p90: 'P90', confidence: '置信度'
}
const assistContext = computed(() => ({
  targetDate: props.targetDate,
  decisionPoint: form.decisionPoint,
  dayOutputs: {
    morningReview: pf.value.morningReview ?? null,
    marketJudgement: pf.value.dataGate
      ? {
          regime: pf.value.dataGate.regime,
          priceCenterLow: pf.value.dataGate.priceCenterLow,
          priceCenterHigh: pf.value.dataGate.priceCenterHigh,
          gate: pf.value.dataGate.gate
        }
      : null,
    direction: pf.value.forecast
      ? { direction: pf.value.forecast.direction, confidence: pf.value.forecast.confidence, biasRatio: pf.value.forecast.biasRatio, rationale: pf.value.forecast.rationale }
      : null,
    storagePlan: pf.value.storagePlan ?? null,
    clearingReview: pf.value.clearingReview ?? null,
    contract: pf.value.contract ?? null
  },
  constraint: 'P10 < P50 < P90 必须成立；分位是对该决策点标的价格分布的估计'
}))
function applyAssist(s: Record<string, unknown>) {
  if (typeof s.judgement === 'string' && s.judgement.trim()) form.judgement = s.judgement.trim()
  if (typeof s.rationale === 'string' && s.rationale.trim()) form.rationale = s.rationale.trim()
  for (const k of ['p10', 'p50', 'p90', 'confidence'] as const) {
    const v = s[k]
    if (typeof v === 'number' && Number.isFinite(v)) form[k] = Math.round(v)
  }
}

// ── ② 自动日报（从各阶段产出汇总）────────────────────────────────────────────
const reportLines = computed<string[]>(() => {
  const lines: string[] = []
  const d = decl.value
  if (!d) return ['未绑定作业单据——日报无从汇总。']
  lines.push(`标的日 ${d.targetDate}，状态 ${STATUS_LABEL[d.status]}，单据 ${d.id}。`)
  const mr = pf.value.morningReview
  lines.push(mr
    ? `S1 复盘：${mr.cause}，今日要点「${mr.lessons}」。`
    : 'S1 复盘：未写回。')
  const dg = pf.value.dataGate
  lines.push(dg?.regime
    ? `S2 早间分析：市场${REGIME_LABEL[dg.regime as keyof typeof REGIME_LABEL]}，均价指引 ${dg.priceCenterLow ?? '—'}–${dg.priceCenterHigh ?? '—'} 元/MWh。`
    : 'S2 早间分析：未产出市场判断。')
  const fc = pf.value.forecast
  lines.push(fc?.direction
    ? `S3 方向判断：${{ add: '增持', reduce: '减持', hold: '观望' }[fc.direction]}（置信 ${fc.confidence ?? '—'}），偏置 ${((fc.biasRatio ?? 0) * 100).toFixed(1)}%。`
    : 'S3 方向判断：未产出。')
  lines.push(['SUBMITTED', 'ACKNOWLEDGED', 'CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED'].includes(d.status)
    ? `S4 申报：已提交（${d.energyCurveMwh96.reduce((a, b) => a + b, 0).toFixed(1)} MWh）。`
    : `S4 申报：${STATUS_LABEL[d.status]}（未出门）。`)
  const cr = pf.value.clearingReview
  lines.push(cr
    ? `S5 出清：中标率 ${cr.clearRate === null ? '—' : (cr.clearRate * 100).toFixed(1) + '%'}${cr.needsRealtimeAction ? '，有时段需实时调整' : '，无需实时调整'}。`
    : 'S5 出清：未分析。')
  const ct = pf.value.contract
  lines.push(ct
    ? `S6 补仓：${GAP_SUGGESTION_LABEL[ct.suggestion as keyof typeof GAP_SUGGESTION_LABEL]}（${ct.action}）。`
    : 'S6 补仓：未写回。')
  lines.push(`决策日志：${coverage.value.recorded}/${coverage.value.expected} 条，P10–P90 命中率 ${hits.value.rate === null ? '—' : (hits.value.rate * 100).toFixed(0) + '%'}。`)
  return lines
})

// ── 日报写回 ────────────────────────────────────────────────────────────────
const summary = ref('')
const summaryValid = computed(() => summary.value.trim().length >= 6)
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => pf.value.dailyClose ?? null)

async function writeBack() {
  if (!decl.value || !summaryValid.value) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const updated = await savePreflight(
      decl.value.id,
      'dailyClose',
      {
        reportSummary: summary.value.trim(),
        decisionsLogged: coverage.value.recorded,
        coverageOk: coverage.value.meetsVeto
      },
      `S7 日报收尾：${coverage.value.meetsVeto ? '决策日志达标' : '决策日志未达标'}`
    )
    emit('updated', updated)
    saveMsg.value = '日报已收口，一日闭环完成'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dc7">
    <p class="dc7-warning"><ShieldAlert :size="14" /> {{ PROTOTYPE_STORAGE_NOTICE }}</p>

    <div class="dc7-grid">
      <!-- 决策日志 -->
      <section class="dc7-panel">
        <div class="dc7-head">
          <h3><NotebookPen :size="14" /> 决策日志（T7）</h3>
          <div class="dc7-stats">
            <span :class="coverage.meetsVeto ? 'ok' : 'bad'">{{ coverage.recorded }}/{{ coverage.expected }} 当日填写率</span>
            <span :class="chain.intact ? 'ok' : 'bad'"><Link2 :size="12" /> 哈希链 {{ chain.intact ? '完整' : '已断' }}</span>
          </div>
        </div>
        <p class="dc7-sub">写后不可改，更正只能追加。填写率 100% 是一票否决 KPI。</p>
        <AiAssistFill
          kind="decision_log"
          :context="assistContext"
          :field-labels="ASSIST_LABELS"
          label="AI 帮我起草本条日志"
          :disabled-reason="form.decisionPoint.trim() ? '' : '先填「决策点」——AI 需要知道给哪个决策写日志'"
          @apply="applyAssist"
        />
        <p v-if="!chain.intact" class="dc7-broken">链在第 {{ chain.brokenAtSeq }} 条断开：{{ chain.reason }}</p>

        <div class="dc7-form">
          <label>当日应记录决策点数<input v-model.number="expectedPoints" type="number" min="1" /></label>
          <label class="full">决策点<input v-model="form.decisionPoint" type="text" placeholder="如：储能充放时段选择" /></label>
          <label class="full">判断结论<input v-model="form.judgement" type="text" placeholder="如：低谷 02-05 充、尖峰 19-20 放" /></label>
          <label class="full">理由（须可追溯到成本或机会成本的具体数值）
            <input v-model="form.rationale" type="text" placeholder="如：尖谷价差 340，要求价差 109，安全倍数 3.1" />
          </label>
          <label>P10<input v-model.number="form.p10" type="number" /></label>
          <label>P50<input v-model.number="form.p50" type="number" /></label>
          <label>P90<input v-model.number="form.p90" type="number" /></label>
          <label>置信度<input v-model.number="form.confidence" type="number" min="0" max="100" /></label>
          <label>决策人（不可代签）<input v-model="form.author" type="text" /></label>
        </div>
        <ul v-if="issues.length" class="dc7-issues">
          <li v-for="i in issues" :key="i.field">{{ i.message }}</li>
        </ul>
        <p v-if="errorMsg" class="dc7-error">{{ errorMsg }}</p>
        <div class="dc7-actions">
          <button type="button" :disabled="issues.length > 0" @click="submit">
            {{ form.correctionOf ? '追加更正' : '写入链' }}
          </button>
          <button v-if="form.correctionOf" type="button" class="ghost" @click="form.correctionOf = null">取消更正</button>
        </div>

        <!-- T+2 回填 -->
        <div class="dc7-backfill">
          <select v-model="backfillTarget">
            <option value="">选择待回填条目…</option>
            <option v-for="e in log.filter((x) => x.actual === null)" :key="e.id" :value="e.id">#{{ e.seq }} {{ e.decisionPoint }}</option>
          </select>
          <input v-model.number="backfillValue" type="number" placeholder="实际结算价" />
          <input v-model="backfillLesson" type="text" placeholder="事后心得（可选）" />
          <button type="button" :disabled="!backfillTarget || backfillValue === null" @click="doBackfill">回填</button>
        </div>

        <!-- 链上记录 -->
        <div class="dc7-list-head">
          <span>链上记录（{{ log.length }}）</span>
          <button type="button" class="ghost" @click="reset"><RefreshCw :size="11" /> 清空（仅原型）</button>
        </div>
        <p v-if="!log.length" class="dc7-empty">尚无记录。</p>
        <table v-else class="dc7-table">
          <thead><tr><th>#</th><th>决策点</th><th>判断</th><th>P10/50/90</th><th>置信</th><th>实际</th><th>命中</th><th></th></tr></thead>
          <tbody>
            <tr v-for="e in log" :key="e.id" :class="{ correction: e.correctionOf }">
              <td>{{ e.seq }}</td>
              <td>{{ e.decisionPoint }}<em v-if="e.correctionOf" class="dc7-corr">更正 {{ e.correctionOf }}</em></td>
              <td class="dc7-judge">{{ e.judgement }}</td>
              <td>{{ e.p10 }}/{{ e.p50 }}/{{ e.p90 }}</td>
              <td>{{ e.confidence }}</td>
              <td>{{ e.actual ?? '—' }}</td>
              <td>
                <span v-if="e.actual === null">—</span>
                <span v-else :class="e.actual >= e.p10 && e.actual <= e.p90 ? 'hit' : 'miss'">
                  {{ e.actual >= e.p10 && e.actual <= e.p90 ? '命中' : '偏离' }}
                </span>
              </td>
              <td><button type="button" class="ghost" @click="startCorrection(e)">更正</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 自动日报 + 收口 -->
      <section class="dc7-panel">
        <h3><FileText :size="14" /> 当日日报（自动汇总）</h3>
        <div class="dc7-report">
          <p v-for="(line, i) in reportLines" :key="i">{{ line }}</p>
        </div>

        <h3>总体小结 → 写回收口</h3>
        <div v-if="written" class="dc7-written">
          已收口：{{ written.reportSummary }}<em>（{{ written.writtenBy }}）</em>
        </div>
        <textarea v-model="summary" rows="3" class="dc7-summary" placeholder="一句话总体小结（≥6 字），如：今日判断偏紧正确，储能单循环获利，明日关注外送检修。" />
        <div class="dc7-actions">
          <button type="button" class="primary" :disabled="!decl || !summaryValid || saving" @click="writeBack">
            <Save :size="13" /> {{ written ? '更新收口' : '写回收口，完成一日闭环' }}
          </button>
          <span v-if="saveMsg" class="dc7-ok">{{ saveMsg }}</span>
          <span v-if="saveError" class="dc7-error">{{ saveError }}</span>
        </div>
        <p v-if="coverage.recorded > 0 && !coverage.meetsVeto" class="dc7-veto-warn">
          决策日志填写率未达一票否决线（{{ coverage.recorded }}/{{ coverage.expected }}）——收口时如实标注「未达标」。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dc7 { display: flex; flex-direction: column; gap: 12px; }
.dc7-warning { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 8px 12px; border: 1px dashed #f59e0b; border-radius: 8px; background: #fffbeb; font-size: 11px; line-height: 1.6; color: #92400e; }

.dc7-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 980px) { .dc7-grid { grid-template-columns: 1fr; } }

.dc7-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dc7-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.dc7-head h3 { display: flex; align-items: center; gap: 5px; margin: 0; font-size: 13px; }
.dc7-panel h3 { display: flex; align-items: center; gap: 5px; margin: 10px 0 6px; font-size: 13px; }
.dc7-panel h3:first-of-type { margin-top: 0; }
.dc7-stats { display: flex; gap: 10px; font-size: 11px; }
.dc7-stats span { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; }
.dc7-stats .ok { background: #dcfce7; color: #15803d; }
.dc7-stats .bad { background: #fee2e2; color: #991b1b; }
.dc7-sub { margin: 4px 0 8px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc7-broken { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }

.dc7-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px 8px; }
.dc7-form label { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--el-text-color-secondary, #667); }
.dc7-form label.full { grid-column: 1 / -1; }
.dc7-form input { padding: 4px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }
.dc7-issues { margin: 6px 0 0; padding-left: 16px; font-size: 11px; color: #b45309; line-height: 1.7; }
.dc7-error { margin: 6px 0 0; font-size: 12px; color: #b91c1c; }
.dc7-actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
.dc7-actions button { padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.dc7-actions button:disabled { opacity: .45; cursor: not-allowed; }
.dc7-actions button.ghost { background: #fff; color: inherit; border-color: var(--el-border-color, #dcdfe6); }
button.ghost { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; background: #fff; color: inherit; font-size: 11px; cursor: pointer; }

.dc7-backfill { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); }
.dc7-backfill select, .dc7-backfill input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.dc7-backfill button { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.dc7-backfill button:disabled { opacity: .45; cursor: not-allowed; }

.dc7-list-head { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); font-size: 12px; }
.dc7-empty { padding: 8px 0; font-size: 12px; color: var(--el-text-color-secondary, #667); }
.dc7-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.dc7-table th, .dc7-table td { padding: 4px 5px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; vertical-align: top; }
.dc7-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc7-table tr.correction { background: #fffbeb; }
.dc7-judge { max-width: 140px; }
.dc7-corr { display: block; font-style: normal; font-size: 10px; color: #b45309; }
.hit { color: #15803d; }
.miss { color: #b91c1c; }

.dc7-report { padding: 10px 12px; border-radius: 8px; background: #f8fafc; font-size: 12px; line-height: 1.9; }
.dc7-report p { margin: 0; }
.dc7-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: 12px; }
.dc7-written em { font-style: normal; color: #4d7c0f; }
.dc7-summary { width: 100%; padding: 6px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 12px; font-family: inherit; resize: vertical; }
.dc7-ok { font-size: 12px; color: #15803d; }
.dc7-veto-warn { margin: 6px 0 0; font-size: 11px; color: #b45309; }
</style>
