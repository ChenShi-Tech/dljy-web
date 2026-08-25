<script setup lang="ts">
// S7 日报收尾（16:30–17:30）—— 一日闭环的收口
//
// 两件事，缺一不可：
//   ① 决策日志（T7，append-only + 哈希链）：当日每个决策点都必须留痕，填写率是一票否决 KPI。
//      理由不在管理考核而在监管质询时它是唯一能自证报价形成过程的材料——所以记下去就改不了。
//   ② 当日日报：从各阶段写回产出自动汇总（市场判断 / 方向 / 中标 / 补仓），交易员补一句
//      总体小结后写回 preflight.dailyClose——它把今日单据的七段产出盖一个收口戳。
//
// ⚠️ 决策日志双模式（#2037 前端切换）：端点已部署时走服务端权威台账（追加写落库 +
// 服务端 SHA-256 哈希链，决策人由登录身份落名）；端点不存在（404/405）时诚实回落
// 浏览器原型（localStorage + FNV 哈希，警示常驻显示）——模式由探针决定，页面如实标注。
import { computed, onMounted, reactive, ref } from 'vue'
import { CalendarClock, ClipboardCopy, Download, NotebookPen, ShieldAlert, Link2, RefreshCw, Save, FileText, Upload } from 'lucide-vue-next'
import { coverageOf, hitRate, validateDraft, verifyChain, type ChainVerdict, type DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import { REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import { getMarketTiming } from 'shared/trading-rules/market-timing.mjs'
import { getTradingCalendar, shiftIsoDate, workdayView } from 'shared/trading-rules/trading-calendar.mjs'
import { buildMarketDigest } from '@/services/trading/marketDigest'
import { backfillAssistActual, linkAssistToDecision, listAssistTrace } from '@/services/trading/assistTraceStore'
import AssistTracePanel from '@/components/trading/AssistTracePanel.vue'
import { currentRegion } from '@/services/region/regionContext'
import {
  appendAndPersistAsync,
  backfillAndPersistAsync,
  clearLog,
  correctAndPersistAsync,
  fetchServerVerdict,
  importLocalPrototypeToServer,
  loadLogAsync,
  localPrototypeCount,
  storageNoticeFor,
  type DecisionLogMode
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
/** 存储模式（探针决定）：server=服务端权威台账；local=浏览器原型降级 */
const mode = ref<DecisionLogMode>('local')
const loadError = ref('')
/** server 模式的链校验结论（SHA-256 服务端权威，前端不重算）；null=校验服务不可用 */
const serverVerdict = ref<{ engine: string; verdict: ChainVerdict } | null>(null)
/** 浏览器原型条数：server 模式下据此展示「导入原型」入口（导入是显式操作，不自动搬） */
const localCount = ref(0)
const importDone = ref(false)
const importing = ref(false)
const importMsg = ref('')
const submitting = ref(false)
const storageNotice = computed(() => storageNoticeFor(mode.value))

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

/** 决策时点（#2049 追涨/杀跌判定前置，迁移 044 非哈希列）：可空=时点未知不打标 */
const decisionTime = ref('')

/**
 * 日志归属标的日（手册异常分支：当日未写 → 次日晨会强制补写）。默认当前标的日；
 * 改成昨日即进入「补写模式」——写入的条目归属补写日，填写率按归属日统计。
 */
const logTargetDate = ref(props.targetDate)

/**
 * 链完整性视图：local 模式本地 FNV 重算；server 模式取服务端 /verify 结论
 * （浏览器没有 node:crypto，不重算 SHA-256）。unavailable=校验服务暂不可达，如实展示。
 */
type ChainView = { unavailable: boolean; intact: boolean; brokenAtSeq: number | null; reason: string | null }
const chain = computed<ChainView>(() => {
  if (mode.value === 'server') {
    const v = serverVerdict.value?.verdict
    return v ? { unavailable: false, ...v } : { unavailable: true, intact: false, brokenAtSeq: null, reason: null }
  }
  return { unavailable: false, ...verifyChain(log.value) }
})
const coverage = computed(() => coverageOf(log.value, props.targetDate, expectedPoints.value))
const hits = computed(() => hitRate(log.value))
const issues = computed(() => {
  let list = validateDraft({ at: new Date().toISOString(), targetDate: props.targetDate, ...form })
  // server 模式决策人由会话身份落名（服务端强制）：本地 author 校验在此模式无意义
  if (mode.value === 'server') list = list.filter((i) => i.field !== 'author')
  return list
})

onMounted(async () => {
  const snap = await loadLogAsync()
  mode.value = snap.mode
  log.value = snap.log
  loadError.value = snap.error ?? ''
  if (snap.mode === 'server') serverVerdict.value = await fetchServerVerdict(snap.mode)
  localCount.value = localPrototypeCount()
})

async function submit() {
  if (submitting.value) return
  errorMsg.value = ''
  submitting.value = true
  try {
    const { correctionOf, ...fields } = form
    const draft = { at: new Date().toISOString(), targetDate: logTargetDate.value, ...fields }
    log.value = correctionOf
      ? await correctAndPersistAsync(correctionOf, draft)
      : await appendAndPersistAsync({ ...draft, correctionOf: null }, decisionTime.value || null)
    if (mode.value === 'server') serverVerdict.value = await fetchServerVerdict(mode.value)
    form.decisionPoint = ''
    form.judgement = ''
    form.rationale = ''
    form.correctionOf = null
    decisionTime.value = ''
    // AI 建议采纳后写入链 → 留痕关联日志条目（T+2 回填时同步命中判断）
    if (adoptedTraceId) {
      const last = log.value[log.value.length - 1]
      if (last) linkAssistToDecision(adoptedTraceId, last.id)
      adoptedTraceId = ''
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '写入失败'
  } finally {
    submitting.value = false
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

async function doBackfill() {
  if (!backfillTarget.value || backfillValue.value === null || submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    log.value = await backfillAndPersistAsync(backfillTarget.value, backfillValue.value, backfillLesson.value || undefined)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '回填失败'
    return
  } finally {
    submitting.value = false
  }
  // 关联的 AI 建议同步回填实际值（回溯命中判断用）
  for (const t of listAssistTrace()) {
    if (t.decisionLogId === backfillTarget.value && t.kind === 'decision_log') {
      backfillAssistActual(t.id, backfillValue.value as number)
    }
  }
  backfillTarget.value = ''
  backfillValue.value = null
  backfillLesson.value = ''
}

function reset() { log.value = clearLog() }

/** 浏览器原型 → 服务端台账的一次性迁移（显式触发）。成功后禁用重导（追加链不可去重）。 */
async function importLocal() {
  if (importing.value || importDone.value) return
  importing.value = true
  importMsg.value = ''
  try {
    const outcome = await importLocalPrototypeToServer()
    if (outcome.error) {
      // 追加链无法去重：中断后点重试会把已导入条目再落一遍——明确劝止，先核对已落条目
      importMsg.value = `导入中断：${outcome.error}（前 ${outcome.imported} 条已落链；追加链不可去重，请勿直接重试，先核对台账）`
      return
    }
    importDone.value = true
    log.value = outcome.log
    serverVerdict.value = await fetchServerVerdict('server')
    importMsg.value = `已导入 ${outcome.imported} 条（补回填 ${outcome.backfilled} 条）。本地原型保留，核对无误后可手动清空`
  } catch (e) {
    importMsg.value = e instanceof Error ? e.message : '导入失败'
  } finally {
    importing.value = false
  }
}

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
/** 采纳的 AI 建议留痕 id——写入链后与日志条目关联，回填实际值时同步命中判断 */
let adoptedTraceId = ''
function applyAssist(s: Record<string, unknown>, traceId?: string) {
  adoptedTraceId = traceId ?? ''
  if (typeof s.judgement === 'string' && s.judgement.trim()) form.judgement = s.judgement.trim()
  if (typeof s.rationale === 'string' && s.rationale.trim()) form.rationale = s.rationale.trim()
  for (const k of ['p10', 'p50', 'p90', 'confidence'] as const) {
    const v = s[k]
    if (typeof v === 'number' && Number.isFinite(v)) form[k] = Math.round(v)
  }
}

// ── 市场概况（会议要求：总成交量/时段量价/开高低收）+ 口径诚实标注 ───────────
// 全市场侧量价无活源（#1968/#1981）——用本单可得口径（出清优先，无出清用申报）
// 给同构统计，sourceBasis 随日报呈现，不把本单口径冒充全市场。
const marketDigest = computed(() =>
  buildMarketDigest(decl.value?.clearing?.clearedCurveMwh96, decl.value?.energyCurveMwh96, decl.value?.priceCurve96)
)

// ── ③ 明日提醒（手册 S7 步骤③）─────────────────────────────────────────────
const customReminders = ref('')
const tomorrowReminders = computed<string[]>(() => {
  const items: string[] = []
  const rid = currentRegion.value.id
  const timing = getMarketTiming(rid)
  const cal = getTradingCalendar(rid)
  const tomorrowIso = shiftIsoDate(props.targetDate, 1)
  if (timing) items.push(`明日申报截止 ${timing.bidDeadline}（${currentRegion.value.shortName || rid} 规则包）——截止前 60 分钟备妥审批链`)
  if (cal) {
    const v = workdayView(cal, tomorrowIso)
    items.push(`明天主要做 D+${cal.primarySpotTarget}（${v.primarySpot.date}）的现货交易`)
  }
  if (pf.value.morningReview?.pendingAnalysis) items.push('S1 偏差主因仍挂「待分析」——晨会补定后回填主因')
  if (pf.value.clearingReview?.needsRealtimeAction) items.push('实时调整指令已记录——明晨核对执行结果与实时价差')
  if (pf.value.contract && pf.value.contract.gapMwh > 0) items.push(`月度中长期缺口 ${Math.round(pf.value.contract.gapMwh)} MWh 未平——关注挂牌价动向`)
  if (!coverage.value.meetsVeto) items.push('今日决策日志未达标——按手册次日晨会强制补写')
  const custom = customReminders.value.split('\n').map((x) => x.trim()).filter(Boolean)
  return [...items, ...custom]
})

// ── ④ 日报导出（Markdown 落文件 + 剪贴板复制）───────────────────────────────
const reportMarkdown = computed(() => {
  const lines = [`# 交易日日报 ${props.targetDate}`, '', ...reportLines.value]
  const md = marketDigest.value
  if (md) {
    lines.push('', `## 市场概况（口径：${md.sourceBasis === 'cleared' ? '本单出清' : '本单申报'}——全市场概况待数据活源 #1968）`)
    lines.push(`总电量 ${md.totalVolumeMwh} MWh；开 ${md.openYuanPerMwh ?? '—'} / 收 ${md.closeYuanPerMwh ?? '—'} / 高 ${md.highYuanPerMwh ?? '—'}（${md.highHour ?? '—'} 时）/ 低 ${md.lowYuanPerMwh ?? '—'}（${md.lowHour ?? '—'} 时）；量加权均价 ${md.weightedAvgYuanPerMwh ?? '—'} 元/MWh`)
  }
  if (tomorrowReminders.value.length) {
    lines.push('', '## 明日提醒', ...tomorrowReminders.value.map((x) => `- ${x}`))
  }
  if (summary.value.trim()) lines.push('', '## 总体小结', summary.value.trim())
  return lines.join('\n')
})

function downloadReport() {
  const blob = new Blob([reportMarkdown.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `交易日日报-${props.targetDate}.md`
  a.click()
  URL.revokeObjectURL(url)
}

const copyState = ref('')
async function copyReport() {
  try {
    await navigator.clipboard.writeText(reportMarkdown.value)
    copyState.value = '已复制到剪贴板'
  } catch {
    copyState.value = '复制失败（浏览器未授权剪贴板）——用导出落文件'
  }
  setTimeout(() => { copyState.value = '' }, 3000)
}

// ── ② 自动日报（从各阶段产出汇总）────────────────────────────────────────────
const reportLines = computed<string[]>(() => {
  const lines: string[] = []
  const d = decl.value
  if (!d) return ['未绑定作业单据——日报无从汇总。']
  lines.push(`标的日 ${d.targetDate}，状态 ${STATUS_LABEL[d.status]}，单据 ${d.id}。`)
  const mr = pf.value.morningReview
  lines.push(mr
    ? `S1 复盘：${mr.cause}${mr.responsibility ? `（责任归属 ${mr.responsibilityLabel ?? mr.responsibility}）` : ''}，今日要点「${mr.lessons}」。昨日偏差成本${mr.deviationCostYuan != null ? ` ${mr.deviationCostYuan.toFixed(0)} 元（偏差率 ${mr.deviationRate != null ? mr.deviationRate.toFixed(2) + '%' : '—'}）` : '未取到'}。`
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
        coverageOk: coverage.value.meetsVeto,
        // 市场概况（本单口径，见 marketDigest 注释）与明日提醒（手册 S7 步骤③④）
        marketDigest: marketDigest.value
          ? {
              sourceBasis: marketDigest.value.sourceBasis,
              totalVolumeMwh: marketDigest.value.totalVolumeMwh,
              highYuanPerMwh: marketDigest.value.highYuanPerMwh,
              lowYuanPerMwh: marketDigest.value.lowYuanPerMwh,
              weightedAvgYuanPerMwh: marketDigest.value.weightedAvgYuanPerMwh
            }
          : null,
        tomorrowReminders: tomorrowReminders.value,
        // 当日 AI 建议采纳清单（#1969 留痕：哪些字段是 AI 建议后采纳的）
        aiAdopted: listAssistTrace(props.targetDate)
          .filter((t) => t.adopted)
          .map((t) => ({ kind: t.kind, fields: t.adoptedFields, at: t.at, confidence: t.confidence }))
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
    <p class="dc7-warning" :class="{ server: mode === 'server' }"><ShieldAlert :size="14" /> {{ storageNotice }}</p>
    <p v-if="loadError" class="dc7-broken">{{ loadError }}</p>

    <div class="dc7-grid">
      <!-- 决策日志 -->
      <section class="dc7-panel">
        <div class="dc7-head">
          <h3><NotebookPen :size="14" /> 决策日志（T7）</h3>
          <div class="dc7-stats">
            <span :class="coverage.meetsVeto ? 'ok' : 'bad'">{{ coverage.recorded }}/{{ coverage.expected }} 当日填写率</span>
            <span v-if="!chain.unavailable" :class="chain.intact ? 'ok' : 'bad'">
              <Link2 :size="12" /> 哈希链 {{ chain.intact ? '完整' : '已断' }}（{{ mode === 'server' ? '服务端 SHA-256' : '原型 FNV' }}）
            </span>
            <span v-else class="bad"><Link2 :size="12" /> 哈希链校验服务不可用</span>
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
        <p v-if="!chain.unavailable && !chain.intact" class="dc7-broken">链在第 {{ chain.brokenAtSeq }} 条断开：{{ chain.reason }}</p>

        <div class="dc7-logdate" :class="{ backfill: logTargetDate !== targetDate }">
          <label>日志归属标的日<input v-model="logTargetDate" type="date" /></label>
          <em v-if="logTargetDate !== targetDate">补写模式：条目归属 {{ logTargetDate }}（次日晨会强制补写的落点）</em>
        </div>
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
          <label>决策时点（选填，情绪化识别用）
            <input v-model="decisionTime" type="datetime-local" title="不参与哈希链；缺省=时点未知（追涨/杀跌不打标）" />
          </label>
          <label v-if="mode === 'local'">决策人（不可代签）<input v-model="form.author" type="text" /></label>
          <span v-else class="dc7-author-note">决策人：由登录身份落名（服务端强制，不可代签）</span>
        </div>
        <ul v-if="issues.length" class="dc7-issues">
          <li v-for="i in issues" :key="i.field">{{ i.message }}</li>
        </ul>
        <p v-if="errorMsg" class="dc7-error">{{ errorMsg }}</p>
        <div class="dc7-actions">
          <button type="button" :disabled="issues.length > 0 || submitting" @click="submit">
            {{ submitting ? '写入中…' : form.correctionOf ? '追加更正' : '写入链' }}
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
          <span class="dc7-list-tools">
            <button
              v-if="mode === 'server' && localCount > 0"
              type="button"
              class="ghost"
              :disabled="importing || importDone"
              :title="'把浏览器原型链按序落进服务端台账（作者改为当前登录身份，落链时间为准）'"
              @click="importLocal"
            >
              <Upload :size="11" /> {{ importDone ? '已导入' : `导入浏览器原型（${localCount} 条）` }}
            </button>
            <button v-if="mode === 'local'" type="button" class="ghost" @click="reset"><RefreshCw :size="11" /> 清空（仅原型）</button>
          </span>
        </div>
        <p v-if="importMsg" class="dc7-import-msg">{{ importMsg }}</p>
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
        <!-- AI 建议回溯（建议 vs 实际，判断该不该信它） -->
        <AssistTracePanel :target-date="targetDate" />
      </section>

      <!-- 自动日报 + 市场概况 + 明日提醒 + 收口 -->
      <section class="dc7-panel">
        <h3><FileText :size="14" /> 当日日报（自动汇总）</h3>
        <div class="dc7-report">
          <p v-for="(line, i) in reportLines" :key="i">{{ line }}</p>
        </div>

        <!-- 市场概况（会议要求；口径=本单，诚实标注） -->
        <div v-if="marketDigest" class="dc7-market">
          <h4>市场概况</h4>
          <div class="dc7-market-stats">
            <span>总电量 <strong>{{ marketDigest.totalVolumeMwh }}</strong> MWh</span>
            <span>开 <strong>{{ marketDigest.openYuanPerMwh ?? '—' }}</strong></span>
            <span>收 <strong>{{ marketDigest.closeYuanPerMwh ?? '—' }}</strong></span>
            <span>高 <strong>{{ marketDigest.highYuanPerMwh ?? '—' }}</strong>（{{ marketDigest.highHour ?? '—' }} 时）</span>
            <span>低 <strong>{{ marketDigest.lowYuanPerMwh ?? '—' }}</strong>（{{ marketDigest.lowHour ?? '—' }} 时）</span>
            <span>量加权均价 <strong>{{ marketDigest.weightedAvgYuanPerMwh ?? '—' }}</strong> 元/MWh</span>
          </div>
          <details class="dc7-market-hours">
            <summary>逐时段量价（24 小时）<em>口径：{{ marketDigest.sourceBasis === 'cleared' ? '本单出清' : '本单申报' }}——全市场概况待数据活源 #1968</em></summary>
            <table class="dc7-table">
              <thead><tr><th>时</th><th>电量 MWh</th><th>价格 元/MWh</th></tr></thead>
              <tbody>
                <tr v-for="h in marketDigest.hourly" :key="h.hour" :class="{ 'dc7-peak': h.hour === marketDigest.highHour, 'dc7-valley': h.hour === marketDigest.lowHour }">
                  <td>{{ String(h.hour).padStart(2, '0') }}</td>
                  <td>{{ h.volumeMwh ?? '—' }}</td>
                  <td>{{ h.priceYuanPerMwh ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </div>

        <!-- 明日提醒（手册 S7 步骤③） -->
        <div class="dc7-reminders">
          <h4><CalendarClock :size="13" /> 明日提醒</h4>
          <ul>
            <li v-for="(r, i) in tomorrowReminders" :key="i">{{ r }}</li>
            <li v-if="!tomorrowReminders.length" class="dc7-empty-li">无自动提醒——下方自行补充。</li>
          </ul>
          <textarea v-model="customReminders" rows="2" class="dc7-summary" placeholder="自行补充的明日提醒（一行一条）" />
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
          <button type="button" class="ghost" @click="downloadReport"><Download :size="13" /> 导出日报（Markdown）</button>
          <button type="button" class="ghost" @click="copyReport"><ClipboardCopy :size="13" /> 复制全文</button>
          <span v-if="copyState" class="dc7-ok">{{ copyState }}</span>
          <span v-if="saveMsg" class="dc7-ok">{{ saveMsg }}</span>
          <span v-if="saveError" class="dc7-error">{{ saveError }}</span>
        </div>
        <p class="dc7-send-note">
          导出为 Markdown 落文件 / 复制粘贴自取；定时发送通道（邮件/钉钉）未接——日报发送以人工转发为主，
          不伪造「已发送」状态。
        </p>
        <p v-if="coverage.recorded > 0 && !coverage.meetsVeto" class="dc7-veto-warn">
          决策日志填写率未达一票否决线（{{ coverage.recorded }}/{{ coverage.expected }}）——收口时如实标注「未达标」。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dc7 { display: flex; flex-direction: column; gap: 12px; }
.dc7-warning { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 8px 12px; border: 1px dashed #f59e0b; border-radius: 8px; background: #fffbeb; font-size: var(--font-xs); line-height: 1.6; color: #92400e; }
.dc7-warning.server { border-color: #86efac; background: #f0fdf4; color: #166534; }
.dc7-author-note { align-self: end; padding: 4px 0; font-size: var(--font-10-5); color: #0369a1; line-height: 1.5; }
.dc7-list-tools { display: inline-flex; gap: 6px; align-items: center; }
.dc7-import-msg { margin: 6px 0 0; font-size: var(--font-xs); color: #166534; line-height: 1.6; }

.dc7-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 980px) { .dc7-grid { grid-template-columns: 1fr; } }

.dc7-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dc7-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.dc7-head h3 { display: flex; align-items: center; gap: 5px; margin: 0; font-size: var(--font-md); }
.dc7-panel h3 { display: flex; align-items: center; gap: 5px; margin: 10px 0 6px; font-size: var(--font-md); }
.dc7-panel h3:first-of-type { margin-top: 0; }
.dc7-stats { display: flex; gap: 10px; font-size: var(--font-xs); }
.dc7-stats span { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; }
.dc7-stats .ok { background: #dcfce7; color: #15803d; }
.dc7-stats .bad { background: #fee2e2; color: #991b1b; }
.dc7-sub { margin: 4px 0 8px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc7-broken { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); }

.dc7-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px 8px; }
.dc7-form label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-10); color: var(--el-text-color-secondary, #667); }
.dc7-form label.full { grid-column: 1 / -1; }
.dc7-form input { padding: 4px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-sm); }
.dc7-issues { margin: 6px 0 0; padding-left: 16px; font-size: var(--font-xs); color: #b45309; line-height: 1.7; }
.dc7-error { margin: 6px 0 0; font-size: var(--font-sm); color: #b91c1c; }
.dc7-actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
.dc7-actions button { padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: var(--font-sm); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.dc7-actions button:disabled { opacity: .45; cursor: not-allowed; }
.dc7-actions button.ghost { background: #fff; color: inherit; border-color: var(--el-border-color, #dcdfe6); }
button.ghost { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; background: #fff; color: inherit; font-size: var(--font-xs); cursor: pointer; }

.dc7-backfill { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); }
.dc7-backfill select, .dc7-backfill input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.dc7-backfill button { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: var(--font-sm); cursor: pointer; }
.dc7-backfill button:disabled { opacity: .45; cursor: not-allowed; }

.dc7-list-head { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); font-size: var(--font-sm); }
.dc7-empty { padding: 8px 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.dc7-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
.dc7-table th, .dc7-table td { padding: 4px 5px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; vertical-align: top; }
.dc7-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc7-table tr.correction { background: #fffbeb; }
.dc7-judge { max-width: 140px; }
.dc7-corr { display: block; font-style: normal; font-size: var(--font-10); color: #b45309; }
.hit { color: #15803d; }
.miss { color: #b91c1c; }

.dc7-report { padding: 10px 12px; border-radius: 8px; background: #f8fafc; font-size: var(--font-sm); line-height: 1.9; }
.dc7-report p { margin: 0; }
.dc7-written { margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: var(--font-sm); }
.dc7-written em { font-style: normal; color: #4d7c0f; }
.dc7-summary { width: 100%; padding: 6px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); font-family: inherit; resize: vertical; }
.dc7-ok { font-size: var(--font-sm); color: #15803d; }
.dc7-veto-warn { margin: 6px 0 0; font-size: var(--font-xs); color: #b45309; }

.dc7-logdate { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; font-size: var(--font-xs); }
.dc7-logdate label { display: flex; align-items: center; gap: 5px; color: var(--el-text-color-secondary, #667); }
.dc7-logdate input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-xs); }
.dc7-logdate.backfill { padding: 5px 8px; border-radius: 6px; background: #fffbeb; }
.dc7-logdate.backfill em { font-style: normal; color: #92400e; font-size: var(--font-xs); }

.dc7-market { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; }
.dc7-market h4 { margin: 0 0 6px; font-size: var(--font-sm); }
.dc7-market-stats { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.dc7-market-hours { margin-top: 6px; }
.dc7-market-hours summary { display: flex; align-items: center; gap: 8px; font-size: var(--font-xs); font-weight: 600; cursor: pointer; }
.dc7-market-hours summary em { font-style: normal; font-weight: 400; font-size: var(--font-10); color: #92400e; }
.dc7-peak td { background: #fef2f2; }
.dc7-valley td { background: #f0fdf4; }

.dc7-reminders { margin-top: 10px; padding: 8px 10px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; }
.dc7-reminders h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 4px; font-size: var(--font-sm); }
.dc7-reminders ul { margin: 0 0 6px; padding-left: 18px; font-size: var(--font-sm); line-height: 1.8; }
.dc7-empty-li { color: var(--el-text-color-secondary, #667); list-style: none; }
.dc7-send-note { margin: 6px 0 0; font-size: var(--font-10); color: var(--el-text-color-secondary, #889); }
@media (max-width: 760px) {
  .dc7-table { display: block; overflow-x: auto; }
}
</style>
