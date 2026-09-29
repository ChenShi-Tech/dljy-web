<script setup lang="ts">
// 公开披露页“日前盯盘”弹窗（Epic ChenShi-Tech/dljy#3478 · C1 #3484；规格 DW-09～DW-14，设计 D8）。
// - 研判范围只由地区、公司与单个目标日决定；页面关键词、主题、分页、选区一律不进入请求。
// - 默认真实日前（目标日 = 北京时间次日，只读）；历史资料审阅须显式选择日期并点击“开始研判”。
// - 公司、地区、目标日或模式变化时，中止在途请求并以代次丢弃旧响应，旧结果不写进新界面。
// - 没有任何模拟数据：接口失败就显示失败；review 标识在结果区常驻，不可隐藏。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Radar, RefreshCw, X } from 'lucide-vue-next'
import { DISCLOSURE_WATCH_REGION_ID, beijingDate, isBusinessDate, liveTradeDate } from 'shared/schema/disclosure-watch-contract.mjs'
import {
  DisclosureWatchRequestError,
  awaitDisclosureWatchRun,
  describeDisclosureWatchError,
  fetchDisclosureWatchCapabilities,
  hasRunBody,
  isAbortError,
  newDisclosureWatchIdempotencyKey,
  runDisclosureWatch,
  submitDisclosureWatchFeedback,
  type DisclosureWatchFailureCode,
  type DisclosureWatchOutcome,
  type DisclosureWatchRunData,
} from '@/services/gridGeo/disclosureWatch'
import {
  WATCH_LEVEL_LABELS, attentionLabel, buildWatchTimeline, countText, formatBeijingTime, groupWatchItems, hasModelJudgement, modeBadge, runStatusLabel,
  watchCapabilityRows, watchCountRows, watchCoverageRows, watchCoverageSummary, watchHeadlineCounts, watchProcessingRows, watchSubmittedVerdicts,
  watchTargetDateGaps, watchTopFocus,
  type DisclosureWatchCapabilities, type DisclosureWatchFeedbackVerdict, type DisclosureWatchMode,
} from './disclosureWatchModel'
import DisclosureWatchItemCard, { type WatchFeedbackState } from './DisclosureWatchItemCard.vue'
import DisclosureWatchTimeline from './DisclosureWatchTimeline.vue'

const props = defineProps<{ regionId: string; regionLabel: string; companyId: string | null; initialReviewDate: string }>()
const emit = defineEmits<{ close: []; locate: [eventId: string] }>()

const LEVELS = ['focus', 'general', 'review'] as const
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
const panel = ref<HTMLElement | null>(null)
const liveDate = ref(liveTradeDate())
const mode = ref<DisclosureWatchMode>('live')
const reviewDate = ref(isBusinessDate(props.initialReviewDate) ? props.initialReviewDate : beijingDate())
const targetDate = computed(() => mode.value === 'live' ? liveDate.value : reviewDate.value)
const validTarget = computed(() => isBusinessDate(targetDate.value))
const scope = computed(() => ({ regionId: props.regionId, companyId: props.companyId }))
const scopeKey = computed(() => `${props.regionId}:${props.companyId ?? ''}`)

const capState = ref<'idle' | 'loading' | 'error' | 'ready'>('idle')
const capabilities = shallowRef<DisclosureWatchCapabilities | null>(null)
const capError = ref('')
const runPhase = ref<'idle' | 'running' | 'waiting' | 'error'>('idle')
const runError = ref<{ code: DisclosureWatchFailureCode; message: string; retryable: boolean } | null>(null)
const run = shallowRef<DisclosureWatchRunData | null>(null)
const waitingRunId = ref<string | null>(null)
const feedback = ref<Record<string, WatchFeedbackState>>({})
const openSections = ref<Record<string, boolean>>({})
let generation = 0
let capAbort: AbortController | null = null
let runAbort: AbortController | null = null
const feedbackAborts = new Set<AbortController>()
// 一次“开始研判”一个幂等键；传输失败重试沿用，拿到终态或参数变化后作废。
let pendingKey: { key: string; signature: string } | null = null

const unsupported = computed(() => props.regionId !== DISCLOSURE_WATCH_REGION_ID || capabilities.value?.supportedRegion === false)
const disabled = computed(() => capabilities.value?.enabled === false)
const ready = computed(() => !unsupported.value && capState.value === 'ready' && !disabled.value)
const modelMissing = computed(() => ready.value && capabilities.value?.modelReady === false)
const gaps = computed(() => watchTargetDateGaps(capabilities.value))
const capabilityRows = computed(() => watchCapabilityRows(capabilities.value))
const canRun = computed(() => ready.value && validTarget.value && runPhase.value !== 'running')
const body = computed(() => hasRunBody(run.value) ? run.value : null)
const runLabel = computed(() => runPhase.value === 'error' && runError.value?.retryable ? '重试' : run.value ? '重新研判' : '开始研判')
const top = computed(() => watchTopFocus(body.value))
const groups = computed(() => groupWatchItems(body.value?.items))
const trial = computed(() => hasModelJudgement(body.value))
const headline = computed(() => body.value ? watchHeadlineCounts(body.value) : null)
const timeline = computed(() => body.value ? buildWatchTimeline(body.value) : null)
const coverageRows = computed(() => body.value ? watchCoverageRows(body.value) : [])
const processingRows = computed(() => body.value ? watchProcessingRows(body.value) : [])
const countRows = computed(() => body.value ? watchCountRows(body.value) : null)
const coverageSummary = computed(() => body.value ? watchCoverageSummary(body.value) : '')
const runErrors = computed(() => (run.value?.errors ?? []).map((error) => {
  const text = describeDisclosureWatchError(error.code)
  return { key: `${error.code}:${error.message}`, text: error.message && error.message !== text ? `${text}：${error.message}` : text }
}))
const asOfText = computed(() => formatBeijingTime(run.value?.asOf) ?? '未知')
const canFeedback = computed(() => Boolean(body.value && body.value.status !== 'running'))
// 资料短名：就绪与覆盖用短标签呈现，完整说明进悬浮提示（界面不放说明长句）。
const DATASET_SHORT: Record<string, string> = { forecast_maintenance_plan: '检修', actual_unplanned_unit_outage: '停运', forecast_must_run_stop_unit_list: '名单', load_forecast: '负荷' }
const shortName = (dataset: string) => DATASET_SHORT[dataset] ?? dataset
const metrics = computed(() => {
  if (!headline.value || !body.value) return []
  const p = body.value.processingCoverage
  const judged = typeof p?.modelRequired === 'number' && p.modelRequired > 0 ? `${countText(p.evaluated)}/${countText(p.modelRequired)}` : '—'
  return [
    { key: 'focus', label: '重点核对', value: String(headline.value.focus), tone: headline.value.focus ? 'focus' : '' },
    { key: 'general', label: '一般关注', value: String(headline.value.general), tone: '' },
    { key: 'review', label: '待核实', value: String(headline.value.review), tone: headline.value.review ? 'warn' : '' },
    { key: 'unprocessed', label: '超预算未处理', value: headline.value.unprocessed, tone: headline.value.unprocessed !== '0' ? 'warn' : '' },
    { key: 'judged', label: '停运原因研判', value: judged, tone: '' },
  ]
})

function errorOf(error: unknown) {
  if (error instanceof DisclosureWatchRequestError) return { code: error.code, message: error.message, retryable: error.retryable }
  return { code: 'unknown' as const, message: error instanceof Error && error.message ? error.message : describeDisclosureWatchError('unknown'), retryable: true }
}

function invalidate() {
  generation += 1
  capAbort?.abort(); capAbort = null
  runAbort?.abort(); runAbort = null
  for (const controller of feedbackAborts) controller.abort()
  feedbackAborts.clear()
}

function resetForContext() {
  invalidate()
  pendingKey = null
  capabilities.value = null; capState.value = 'idle'; capError.value = ''
  runPhase.value = 'idle'; runError.value = null; run.value = null; waitingRunId.value = null
  feedback.value = {}; openSections.value = {}
}

async function loadCapabilities() {
  const current = generation
  capAbort?.abort(); capAbort = new AbortController()
  if (props.regionId !== DISCLOSURE_WATCH_REGION_ID || !validTarget.value) { capState.value = 'idle'; return }
  capState.value = 'loading'; capError.value = ''
  try {
    const result = await fetchDisclosureWatchCapabilities(scope.value, targetDate.value, { signal: capAbort.signal })
    if (current !== generation) return
    capabilities.value = result; capState.value = 'ready'
  } catch (error) {
    if (current !== generation || isAbortError(error)) return
    capState.value = 'error'; capError.value = errorOf(error).message
  }
}

function applyRun(data: DisclosureWatchRunData) {
  run.value = data
  const submitted = hasRunBody(data) ? watchSubmittedVerdicts(data.feedback) : {}
  feedback.value = Object.fromEntries(Object.entries(submitted).map(([itemId, verdict]) => [itemId, { status: 'done', verdict }]))
}

function applyOutcome(outcome: DisclosureWatchOutcome) {
  if (outcome.settled) {
    applyRun(outcome.result)
    runPhase.value = 'idle'; waitingRunId.value = null; pendingKey = null
  } else {
    waitingRunId.value = outcome.runId; runPhase.value = 'waiting'
  }
}

async function execute(task: (signal: AbortSignal, current: number) => Promise<DisclosureWatchOutcome>) {
  const current = generation
  runAbort?.abort(); runAbort = new AbortController()
  runPhase.value = 'running'; runError.value = null
  try {
    const outcome = await task(runAbort.signal, current)
    if (current === generation) applyOutcome(outcome)
  } catch (error) {
    if (current !== generation || isAbortError(error)) return
    const failure = errorOf(error)
    if (!failure.retryable) pendingKey = null
    runPhase.value = 'error'; runError.value = failure
  }
}

function startRun() {
  if (!canRun.value) return
  if (mode.value === 'live' && liveTradeDate() !== liveDate.value) { liveDate.value = liveTradeDate(); return }
  const signature = JSON.stringify([scopeKey.value, mode.value, targetDate.value])
  if (!pendingKey || pendingKey.signature !== signature) pendingKey = { key: newDisclosureWatchIdempotencyKey(), signature }
  const key = pendingKey.key
  const request = { tradeDate: targetDate.value, mode: mode.value }
  run.value = null; feedback.value = {}; openSections.value = {}
  void execute((signal, current) => runDisclosureWatch(scope.value, request, key, { signal, onRunning: (head) => { if (current === generation) waitingRunId.value = head.runId } }))
}

function continueWaiting() {
  const runId = waitingRunId.value
  if (!runId || runPhase.value === 'running') return
  void execute((signal) => awaitDisclosureWatchRun(scope.value, runId, { signal }))
}

async function submitFeedback(payload: { itemId: string; verdict: DisclosureWatchFeedbackVerdict; note: string | null }) {
  const current = run.value
  if (!current || !hasRunBody(current)) return
  const token = generation
  const controller = new AbortController()
  feedbackAborts.add(controller)
  feedback.value = { ...feedback.value, [payload.itemId]: { status: 'submitting', verdict: payload.verdict } }
  try {
    await submitDisclosureWatchFeedback(scope.value, current.runId, payload, { signal: controller.signal })
    if (token !== generation || run.value !== current) return
    feedback.value = { ...feedback.value, [payload.itemId]: { status: 'done', verdict: payload.verdict } }
  } catch (error) {
    if (token !== generation || run.value !== current || isAbortError(error)) return
    // 评价失败只提示错误，不改动已有研判结果。
    feedback.value = { ...feedback.value, [payload.itemId]: { status: 'error', verdict: payload.verdict, message: errorOf(error).message } }
  } finally { feedbackAborts.delete(controller) }
}

function switchToReview() { mode.value = 'review' }
function toggleSection(name: string, event: Event) { openSections.value = { ...openSections.value, [name]: (event.target as HTMLDetailsElement).open } }
function close() { emit('close') }

function reachable(element: HTMLElement) {
  let details = element.closest('details')
  while (details) {
    if (!details.open && !(element.tagName === 'SUMMARY' && element.parentElement === details)) return false
    details = details.parentElement?.closest('details') ?? null
  }
  return true
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const focusable = Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(reachable)
  const first = focusable[0], last = focusable.at(-1)
  if (!first || !last) { event.preventDefault(); panel.value?.focus(); return }
  const active = document.activeElement as HTMLElement | null
  const inside = active ? focusable.includes(active) : false
  if (event.shiftKey && (active === first || !inside)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (active === last || !inside)) { event.preventDefault(); first.focus() }
}
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  close()
}

watch([scopeKey, mode, targetDate], () => { resetForContext(); void loadCapabilities() }, { immediate: true })
onMounted(() => { document.addEventListener('keydown', onDocumentKeydown); void nextTick(() => panel.value?.focus()) })
onBeforeUnmount(() => { invalidate(); document.removeEventListener('keydown', onDocumentKeydown) })
</script>

<template>
  <Teleport to="body">
    <div class="watch-overlay">
      <section ref="panel" class="watch-panel" role="dialog" aria-modal="true" aria-labelledby="disclosure-watch-title" tabindex="-1" data-testid="disclosure-watch-dialog" @keydown="trapFocus">
        <header class="watch-head">
          <span class="head-icon"><Radar :size="18" /></span>
          <div class="head-text">
            <h2 id="disclosure-watch-title">日前盯盘</h2>
            <p class="scope" data-testid="watch-scope">
              <span>研判范围：{{ regionLabel }}</span><span class="date">目标日 {{ validTarget ? targetDate : '未选择' }}</span>
              <el-tooltip content="研判覆盖该地区目标日的全部机组披露，不受页面列表的关键词、主题和分页筛选影响" placement="bottom" :show-after="150"><span class="chip hint" tabindex="0" aria-label="全部机组披露（不受列表筛选影响）" data-testid="watch-scope-all">全部机组</span></el-tooltip>
            </p>
          </div>
          <button type="button" class="close" aria-label="关闭日前盯盘" data-testid="watch-close" @click="close"><X :size="17" /></button>
        </header>
        <div class="watch-body">
          <div v-if="unsupported" class="state" role="status" data-testid="watch-unsupported"><strong>当前地区不支持日前盯盘</strong><p>首版仅覆盖云南机组披露；{{ regionLabel }}不回退读取云南资料。</p></div>
          <template v-else>
            <div v-if="capState === 'loading'" class="state" role="status" data-testid="watch-cap-loading"><RefreshCw :size="16" class="spinning" />正在读取功能状态…</div>
            <div v-else-if="capState === 'error'" class="state error" role="alert" data-testid="watch-cap-error">功能状态读取失败：{{ capError }}<button type="button" class="text" @click="loadCapabilities">重试</button></div>
            <div v-else-if="disabled" class="state" role="status" data-testid="watch-disabled"><strong>日前盯盘功能未开通</strong><p>服务端功能开关关闭，暂不能运行；原披露浏览不受影响。</p></div>
            <div v-if="ready || capState === 'loading'" class="controls">
              <fieldset class="modes" :disabled="runPhase === 'running'">
                <legend class="sr-only">研判模式</legend>
                <div class="segmented" role="presentation">
                  <label :class="{ on: mode === 'live' }" :title="`目标日 ${liveDate}，北京时间次日，只读`"><input v-model="mode" type="radio" name="disclosure-watch-mode" value="live" data-testid="watch-mode-live">真实日前</label>
                  <label :class="{ on: mode === 'review' }" title="按今天可见的资料审阅历史某日，非当时已知回放"><input v-model="mode" type="radio" name="disclosure-watch-mode" value="review" data-testid="watch-mode-review">历史资料审阅</label>
                </div>
                <span v-if="mode === 'live'" class="live-date">{{ liveDate }}</span>
                <label v-else class="review-date"><span class="sr-only">审阅日期</span><input v-model="reviewDate" type="date" :max="liveDate" aria-label="审阅日期" data-testid="watch-review-date"></label>
              </fieldset>
              <button type="button" class="run" :disabled="!canRun" data-testid="watch-run" @click="startRun">{{ runLabel }}</button>
            </div>
            <template v-if="ready">
              <p v-if="!validTarget" class="notice warn" role="status">请选择合法的审阅日期。</p>
              <p v-if="modelMissing" class="notice" data-testid="watch-model-missing">模型未配置：非计划停运原因不做研判，相关事项转待核</p>
              <div v-if="mode === 'live' && gaps.allMissing" class="notice warn" role="status" data-testid="watch-live-missing">
                <el-tooltip :content="`目标日 ${liveDate} 的${gaps.missing.join('、')}尚未收到。仍可运行，结果会如实标注缺失，不会用其他日期补位。`" placement="bottom" :show-after="150"><strong class="hint" tabindex="0">明日资料未到</strong></el-tooltip>：{{ gaps.missing.join('、') }}
                <button type="button" class="text" data-testid="watch-switch-review" @click="switchToReview">改为历史资料审阅</button>
              </div>
              <p v-else-if="gaps.missing.length" class="notice warn">目标日 {{ targetDate }} 尚未收到：{{ gaps.missing.join('、') }}。</p>
              <ul v-if="capabilityRows.length" class="readiness" aria-label="目标日资料就绪情况">
                <li v-for="row in capabilityRows" :key="row.dataset">
                  <el-tooltip :content="`${row.label}｜目标日：${row.forTradeDate}｜最近一份：${row.latest}`" placement="bottom" :show-after="150">
                    <span :class="['ready-chip', row.missingForTradeDate ? 'missing' : 'ok']" tabindex="0" :aria-label="`${row.label}：目标日 ${row.forTradeDate}`"><i />{{ shortName(row.dataset) }}</span>
                  </el-tooltip>
                </li>
              </ul>
            </template>
            <div v-if="runPhase === 'running'" class="state" role="status" data-testid="watch-running"><RefreshCw :size="16" class="spinning" />正在研判…（每 2 秒查询一次，最长等待 60 秒）</div>
            <div v-else-if="runPhase === 'waiting'" class="state" role="status" data-testid="watch-still-running">仍在运行，可稍后查看。<button type="button" class="text" @click="continueWaiting">继续查看</button></div>
            <div v-else-if="runPhase === 'error' && runError" class="state error" role="alert" data-testid="watch-run-error">研判请求失败：{{ runError.message }}</div>

            <section v-if="run" class="result" data-testid="watch-result">
              <div class="result-head">
                <div class="verdict">
                  <el-tooltip :disabled="!body?.summary" :content="body?.summary ?? ''" placement="top" :show-after="150">
                    <span v-if="body" :class="['attention', body.attention]" tabindex="0" :title="body.summary" data-testid="watch-summary">{{ attentionLabel(body.attention) }}</span>
                  </el-tooltip>
                  <span :class="['badge', 'mode', run.mode]" data-testid="watch-mode-badge">{{ modeBadge(run.mode) }}</span>
                  <span v-if="trial" class="badge trial" data-testid="watch-trial-badge">试验研判</span>
                  <span :class="['badge', 'status', run.status]">{{ runStatusLabel(run.status) }}</span>
                  <span class="asof" data-testid="watch-asof">资料截至 {{ asOfText }}（北京时间）</span>
                </div>
                <dl v-if="metrics.length" class="metrics" data-testid="watch-counts">
                  <div v-for="metric in metrics" :key="metric.key" :class="metric.tone"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div>
                </dl>
                <ul v-if="body" class="coverage-chips" aria-label="资料覆盖">
                  <li v-for="row in coverageRows" :key="row.dataset">
                    <el-tooltip :content="`${row.label}：${row.statusLabel}｜资料日期 ${row.coverageDate}｜接收 ${row.receivedAt}${row.note ? `｜${row.note}` : ''}`" placement="top" :show-after="150">
                      <span :class="['cov', row.status]" tabindex="0"><i />{{ shortName(row.dataset) }}<b>{{ row.statusLabel }}</b></span>
                    </el-tooltip>
                  </li>
                </ul>
                <p v-if="run.status === 'partial'" class="notice warn">部分完成：仍有事项未处理，结果不代表全天全量研判</p>
                <p v-if="!body && run.status !== 'running'" class="notice warn" data-testid="watch-head-only">本次运行没有可展示的结果（{{ runStatusLabel(run.status) }}），可重新研判</p>
                <ul v-if="runErrors.length" class="errors" role="alert" data-testid="watch-result-errors"><li v-for="error in runErrors" :key="error.key">{{ error.text }}</li></ul>
                <p v-if="body" class="sr-only">{{ coverageSummary }}</p>
              </div>
              <template v-if="body">
                <section class="top" aria-label="重点核对前三项">
                  <h3>重点核对<small v-if="groups.focus.length > top.length">共 {{ groups.focus.length }} 项，其余见“全部事项”</small></h3>
                  <div v-if="top.length" class="top-grid"><DisclosureWatchItemCard v-for="item in top" :key="item.itemId" :item="item" variant="card" :feedback="feedback[item.itemId]" :can-feedback="canFeedback" @feedback="submitFeedback" @locate="emit('locate', $event)" /></div>
                  <p v-else class="empty" data-testid="watch-no-focus">没有符合重点核对条件的事项，请看待核实与资料覆盖（不表示明日没有风险）</p>
                </section>
                <DisclosureWatchTimeline v-if="timeline" :timeline="timeline" />
                <details class="fold" data-testid="watch-review-section" @toggle="toggleSection('review', $event)">
                  <summary>待核实（{{ groups.review.length }} 项）</summary>
                  <div v-if="openSections.review" class="item-list"><DisclosureWatchItemCard v-for="item in groups.review" :key="item.itemId" :item="item" :feedback="feedback[item.itemId]" :can-feedback="canFeedback" @feedback="submitFeedback" @locate="emit('locate', $event)" /><p v-if="!groups.review.length" class="empty">没有待核实事项。</p></div>
                </details>
                <details class="fold" data-testid="watch-all-section" @toggle="toggleSection('all', $event)">
                  <summary>全部事项（{{ body.items.length }} 项）</summary>
                  <div v-if="openSections.all" class="item-list">
                    <template v-for="level in LEVELS" :key="level">
                      <h4 v-if="groups[level].length">{{ WATCH_LEVEL_LABELS[level] }}（{{ groups[level].length }}）</h4>
                      <DisclosureWatchItemCard v-for="item in groups[level]" :key="item.itemId" :item="item" :feedback="feedback[item.itemId]" :can-feedback="canFeedback" @feedback="submitFeedback" @locate="emit('locate', $event)" />
                    </template>
                    <p v-if="!body.items.length" class="empty">本次没有整理出事项。</p>
                  </div>
                </details>
                <details class="fold" data-testid="watch-coverage-section" @toggle="toggleSection('coverage', $event)">
                  <summary>资料覆盖</summary>
                  <div v-if="openSections.coverage" class="coverage">
                    <table><thead><tr><th>资料</th><th>状态</th><th>资料日期</th><th>接收时间（北京）</th><th>说明</th></tr></thead>
                      <tbody><tr v-for="row in coverageRows" :key="row.dataset" :class="row.status"><td>{{ row.label }}<small v-if="row.group === 'background'">背景</small></td><td>{{ row.statusLabel }}</td><td>{{ row.coverageDate }}</td><td>{{ row.receivedAt }}</td><td>{{ row.note ?? '—' }}</td></tr></tbody>
                    </table>
                    <dl class="numbers"><div v-for="row in processingRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl>
                    <dl v-if="countRows" class="numbers"><div v-for="row in [...countRows.totals, ...countRows.dispositions, ...countRows.levels]" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl>
                    <p class="versions">冻结输入 {{ body.inputVersion?.snapshots?.length ?? '未知' }} 份快照 · 哈希 {{ body.inputVersion?.hash ? body.inputVersion.hash.slice(0, 12) : '未知' }} · 规则 {{ body.versions?.ruleset ?? '未知' }} · 问题集 {{ body.versions?.questionSet ?? '未知' }} · 模型 {{ body.versions?.modelVersions?.length ? body.versions.modelVersions.join('、') : '未调用' }} · 校准 {{ body.calibrationStatus === 'calibrated' ? '已校准' : '未校准' }}</p>
                  </div>
                </details>
              </template>
            </section>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 日前盯盘：运行日前一晚的核对单。颜色只承载语义——主色=重点、琥珀=待核与缺口、红=错误；
   历史审阅用虚线描边（档案态），与真实日前一眼区分。说明文字进悬浮提示，界面只留数字与状态。 */
.watch-overlay{position:fixed;inset:0;z-index:2000;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:24px;background:color-mix(in srgb,var(--bg) 40%,rgba(15,23,42,.55))}
.watch-panel{display:flex;flex-direction:column;width:min(1000px,100%);min-width:0;max-width:100%;max-height:calc(100vh - 48px);border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);box-shadow:var(--shadow);font-size:var(--font-sm);outline:none;overflow:hidden}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.watch-head{display:flex;align-items:center;gap:12px;padding:14px 18px 12px}
.head-icon{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:8px;color:var(--primary);background:var(--primary-tint)}
.head-text{flex:1;min-width:0}
h2{margin:0;font-size:var(--font-xl);font-weight:650;letter-spacing:.01em;color:var(--text)}
.scope{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:3px 0 0;color:var(--text-soft);font-size:var(--font-xs)}
.scope .date{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
.chip{display:inline-flex;align-items:center;padding:0 7px;border-radius:4px;line-height:18px;background:var(--panel-sub);color:var(--text-soft)}
.hint{cursor:help;border-bottom:1px dotted currentColor}
.close{display:grid;place-items:center;width:30px;height:30px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--text-soft);cursor:pointer}
.close:hover{border-color:var(--line);background:var(--panel-sub)}

.watch-body{display:grid;gap:12px;padding:0 18px 18px;overflow:auto;min-width:0}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:10px 12px;border-radius:8px;background:var(--panel-sub)}
.modes{display:flex;align-items:center;gap:10px;margin:0;padding:0;border:0;min-width:0}
.segmented{display:inline-flex;padding:2px;border-radius:7px;background:var(--panel);border:1px solid var(--line)}
.segmented label{position:relative;display:inline-flex;align-items:center;padding:4px 12px;border-radius:5px;color:var(--text-soft);cursor:pointer;white-space:nowrap;font-size:var(--font-sm)}
.segmented label.on{background:var(--primary);color:#fff}
.segmented input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.segmented label:focus-within{outline:2px solid var(--primary);outline-offset:1px}
.live-date{font-variant-numeric:tabular-nums;color:var(--text);font-weight:600}
.review-date input{height:30px;padding:0 8px;border:1px dashed var(--line);border-radius:6px;background:var(--panel);color:var(--text);font:inherit;font-variant-numeric:tabular-nums}
.readiness{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.ready-chip,.cov{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;background:var(--panel);border:1px solid var(--line-soft);color:var(--text-soft);font-size:var(--font-xs);cursor:help}
.ready-chip i,.cov i{width:7px;height:7px;border-radius:50%;background:var(--muted)}
.ready-chip.ok i,.cov.complete i{background:var(--success)}
.ready-chip.missing,.cov.missing,.cov.invalid{color:var(--warning);border-color:color-mix(in srgb,var(--warning) 35%,transparent)}
.ready-chip.missing i,.cov.missing i{background:transparent;border:1.5px solid var(--warning)}
.cov.partial i{background:linear-gradient(90deg,var(--warning) 50%,transparent 50%);border:1px solid var(--warning)}
.cov.invalid i{background:var(--danger)}
.cov b{font-weight:500;color:var(--text-body)}
.run{margin-left:auto;height:32px;padding:0 18px;border:0;border-radius:6px;background:var(--primary);color:#fff;font-weight:600;cursor:pointer}
.run:disabled{opacity:.45;cursor:default}

.state{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 14px;border-radius:8px;background:var(--panel-sub);color:var(--text-soft)}
.state strong{color:var(--text)}
.state p{flex-basis:100%;margin:0;font-size:var(--font-xs)}
.state.error{color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,transparent)}
.notice{margin:0;padding:6px 10px;border-left:3px solid var(--line);font-size:var(--font-xs);color:var(--text-soft)}
.notice.warn{border-left-color:var(--warning);color:var(--text-body);background:color-mix(in srgb,var(--warning) 8%,transparent)}
.text{border:0;padding:0;background:transparent;color:var(--primary);cursor:pointer;font-size:var(--font-xs);text-decoration:underline}
.spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.result{display:grid;gap:14px;min-width:0}
.result-head{display:grid;gap:10px}
.verdict{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.attention{display:inline-flex;align-items:center;height:26px;padding:0 12px;border-radius:13px;font-weight:600;font-size:var(--font-sm);cursor:help}
.attention.focus{background:var(--primary);color:#fff}
.attention.review{background:color-mix(in srgb,var(--warning) 16%,transparent);color:var(--warning)}
.attention.none-qualified{background:var(--panel-sub);color:var(--text-body)}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:var(--font-xs);background:var(--panel-sub);color:var(--text-soft)}
.badge.mode.live{color:var(--primary);background:var(--primary-tint)}
.badge.mode.review{color:var(--text-body);background:transparent;border:1px dashed var(--text-soft)}
.badge.trial{color:var(--warning);background:transparent;border:1px dashed var(--warning)}
.badge.status.failed,.badge.status.interrupted{color:var(--danger)}
.asof{margin-left:auto;color:var(--muted);font-size:var(--font-xs);font-variant-numeric:tabular-nums}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.metrics div{padding:8px 12px;border-left:1px solid var(--line-soft)}
.metrics div:first-child{border-left:0;padding-left:0}
.metrics dt{font-size:var(--font-xs);color:var(--muted)}
.metrics dd{margin:2px 0 0;font-size:var(--font-24);font-weight:600;line-height:1.15;color:var(--text);font-variant-numeric:tabular-nums}
.metrics .focus dd{color:var(--primary)}
.metrics .warn dd{color:var(--warning)}
.coverage-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.errors{margin:0;padding:6px 10px 6px 26px;border-left:3px solid var(--danger);color:var(--danger);font-size:var(--font-xs);background:color-mix(in srgb,var(--danger) 6%,transparent)}

.top{display:grid;gap:4px}
h3{display:flex;align-items:baseline;gap:10px;margin:0;font-size:var(--font-sm);font-weight:600;color:var(--text)}
h3 small{font-weight:400;color:var(--muted);font-size:var(--font-xs)}
h4{margin:10px 0 2px;font-size:var(--font-xs);font-weight:600;color:var(--text-soft)}
.top-grid{display:grid;gap:2px}
.empty{margin:0;padding:10px 0;color:var(--text-soft);font-size:var(--font-xs)}

.fold{border-bottom:1px solid var(--line-soft)}
.fold summary{display:flex;align-items:center;gap:8px;padding:9px 2px;cursor:pointer;font-weight:600;font-size:var(--font-sm);color:var(--text);list-style:none}
.fold summary::-webkit-details-marker{display:none}
.fold summary::before{content:'';width:6px;height:6px;border-right:1.5px solid var(--text-soft);border-bottom:1.5px solid var(--text-soft);transform:rotate(-45deg);transition:transform .15s}
.fold[open] summary::before{transform:rotate(45deg)}
.fold summary:focus-visible,.attention:focus-visible,.ready-chip:focus-visible,.cov:focus-visible,.hint:focus-visible,.run:focus-visible,.close:focus-visible,.text:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.item-list{display:grid;padding:0 0 10px}
.coverage{display:grid;gap:10px;padding:0 0 12px;min-width:0}
table{width:100%;border-collapse:collapse;font-size:var(--font-xs)}
th,td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--line-soft);vertical-align:top}
th{color:var(--muted);font-weight:500}
td small{margin-left:4px;color:var(--muted)}
tr.missing td:nth-child(2),tr.partial td:nth-child(2){color:var(--warning)}
tr.invalid td:nth-child(2){color:var(--danger)}
.numbers{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0}
.numbers dt{font-size:var(--font-xs);color:var(--muted)}
.numbers dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.versions{margin:0;color:var(--muted);font-size:var(--font-xs);overflow-wrap:anywhere}

@media(prefers-reduced-motion:reduce){.spinning{animation:none}.fold summary::before{transition:none}}
@media(max-width:700px){
  .watch-overlay{padding:0}
  .watch-panel{width:100%;height:100%;max-height:none;border-radius:0;border:0}
  .watch-head{padding:12px}
  .watch-body{padding:0 12px 16px}
  .controls{align-items:stretch}
  .modes{flex-wrap:wrap}
  .run{width:100%;margin-left:0}
  .asof{margin-left:0;flex-basis:100%}
  .metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
  .metrics div:nth-child(4){border-left:0;padding-left:0}
  .metrics dd{font-size:var(--font-20)}
  table{display:block;max-width:100%;overflow-x:auto}
}
</style>
