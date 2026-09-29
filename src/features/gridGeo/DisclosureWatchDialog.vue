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
  WATCH_LEVEL_LABELS, attentionLabel, buildWatchTimeline, formatBeijingTime, groupWatchItems, hasModelJudgement, modeBadge, runStatusLabel,
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
            <p class="scope" data-testid="watch-scope">研判范围：{{ regionLabel }} · 目标日 {{ validTarget ? targetDate : '未选择' }} · 全部机组披露（不受列表筛选影响）</p>
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
                <legend>研判模式</legend>
                <label><input v-model="mode" type="radio" name="disclosure-watch-mode" value="live" data-testid="watch-mode-live">真实日前<small>目标日 {{ liveDate }}（北京时间次日，只读）</small></label>
                <label><input v-model="mode" type="radio" name="disclosure-watch-mode" value="review" data-testid="watch-mode-review">历史资料审阅<small>非当时已知回放</small></label>
                <label v-if="mode === 'review'" class="review-date">审阅日期<input v-model="reviewDate" type="date" :max="liveDate" data-testid="watch-review-date"></label>
              </fieldset>
              <button type="button" class="run" :disabled="!canRun" data-testid="watch-run" @click="startRun">{{ runLabel }}</button>
            </div>
            <template v-if="ready">
              <p v-if="!validTarget" class="notice warn" role="status">请选择合法的审阅日期。</p>
              <p v-if="modelMissing" class="notice" data-testid="watch-model-missing">模型未配置：仍可运行；非计划停运原因不做研判，相关事项转待核。</p>
              <div v-if="mode === 'live' && gaps.allMissing" class="notice warn" role="status" data-testid="watch-live-missing">
                <strong>明日资料未到</strong>：目标日 {{ liveDate }} 的{{ gaps.missing.join('、') }}尚未收到。结果会如实标注缺失，不会用其他日期补位。
                <button type="button" class="text" data-testid="watch-switch-review" @click="switchToReview">改为历史资料审阅</button>
              </div>
              <p v-else-if="gaps.missing.length" class="notice warn">目标日 {{ targetDate }} 尚未收到：{{ gaps.missing.join('、') }}。</p>
              <details v-if="capabilityRows.length" class="readiness">
                <summary>资料就绪情况</summary>
                <table><thead><tr><th>资料</th><th>目标日</th><th>最近一份</th></tr></thead><tbody><tr v-for="row in capabilityRows" :key="row.dataset"><td>{{ row.label }}</td><td :class="{ missing: row.missingForTradeDate }">{{ row.forTradeDate }}</td><td>{{ row.latest }}</td></tr></tbody></table>
              </details>
            </template>
            <div v-if="runPhase === 'running'" class="state" role="status" data-testid="watch-running"><RefreshCw :size="16" class="spinning" />正在研判…（每 2 秒查询一次，最长等待 60 秒）</div>
            <div v-else-if="runPhase === 'waiting'" class="state" role="status" data-testid="watch-still-running">仍在运行，可稍后查看。<button type="button" class="text" @click="continueWaiting">继续查看</button></div>
            <div v-else-if="runPhase === 'error' && runError" class="state error" role="alert" data-testid="watch-run-error">研判请求失败：{{ runError.message }}</div>

            <section v-if="run" class="result" data-testid="watch-result">
              <div class="result-head">
                <p v-if="body?.summary" class="summary" data-testid="watch-summary">{{ body.summary }}</p>
                <div class="badges">
                  <span :class="['badge', 'mode', run.mode]" data-testid="watch-mode-badge">{{ modeBadge(run.mode) }}</span>
                  <span v-if="trial" class="badge trial" data-testid="watch-trial-badge">试验研判</span>
                  <span :class="['badge', 'status', run.status]">{{ runStatusLabel(run.status) }}</span>
                  <span class="asof" data-testid="watch-asof">资料截至 {{ asOfText }}（北京时间）</span>
                </div>
                <p v-if="headline" class="counts" data-testid="watch-counts">{{ attentionLabel(body?.attention) }} · 重点 {{ headline.focus }} · 一般 {{ headline.general }} · 待核 {{ headline.review }} · 未处理 {{ headline.unprocessed }}</p>
                <p v-if="run.status === 'partial'" class="notice warn">部分完成：仍有事项未处理，结果不代表全天全量研判。</p>
                <p v-if="!body && run.status !== 'running'" class="notice warn" data-testid="watch-head-only">本次运行没有可展示的结果（{{ runStatusLabel(run.status) }}），可重新研判。</p>
                <ul v-if="runErrors.length" class="errors" role="alert" data-testid="watch-result-errors"><li v-for="error in runErrors" :key="error.key">{{ error.text }}</li></ul>
                <p v-if="body" class="coverage-summary">{{ coverageSummary }}</p>
              </div>
              <template v-if="body">
                <section class="top" aria-label="重点核对前三项">
                  <h3>重点核对 · 前 {{ top.length }} 项<small v-if="groups.focus.length > top.length">（共 {{ groups.focus.length }} 项，其余见“全部事项”）</small></h3>
                  <div v-if="top.length" class="top-grid"><DisclosureWatchItemCard v-for="item in top" :key="item.itemId" :item="item" variant="card" :feedback="feedback[item.itemId]" :can-feedback="canFeedback" @feedback="submitFeedback" @locate="emit('locate', $event)" /></div>
                  <p v-else class="empty" data-testid="watch-no-focus">本次没有符合重点核对条件的事项；请查看待核实与资料覆盖，这不表示明日没有风险。</p>
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
.watch-overlay{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--bg) 40%,rgba(15,23,42,.55))}
.watch-panel{display:flex;flex-direction:column;width:min(980px,100%);max-height:calc(100vh - 48px);border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);box-shadow:var(--shadow);font-size:var(--font-sm);outline:none}
.watch-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
.head-icon{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border-radius:8px;color:var(--primary);background:var(--primary-tint);border:1px solid var(--primary-tint-border)}
.head-text{flex:1;min-width:0}
h2{margin:0;font-size:var(--font-lg)}
.scope{margin:3px 0 0;color:var(--text-soft);font-size:var(--font-xs);line-height:1.5}
.close{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--line);border-radius:6px;background:var(--panel-sub);color:var(--text-soft);cursor:pointer}
.watch-body{display:grid;gap:12px;padding:14px 16px 18px;overflow:auto;min-height:0}
.state{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-sub);color:var(--text-body);font-size:var(--font-sm)}
.state p{flex-basis:100%;margin:0;color:var(--muted);font-size:var(--font-xs)}
.state.error{color:var(--danger);background:var(--danger-tint);border-color:transparent}
.controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}
.modes{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0;padding:8px 12px;border:1px solid var(--line);border-radius:8px;flex:1;min-width:0}
.modes legend{padding:0 4px;color:var(--muted);font-size:var(--font-xs)}
.modes label{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:var(--font-sm);color:var(--text-body)}
.modes small{color:var(--muted);font-size:var(--font-xs)}
.review-date input{border:1px solid var(--line);border-radius:6px;padding:4px 8px;background:var(--panel);color:var(--text);font:inherit;font-size:var(--font-sm)}
.run{border:1px solid var(--primary);border-radius:7px;padding:8px 16px;background:var(--primary);color:#fff;cursor:pointer;font-size:var(--font-sm)}
.run:disabled{opacity:.5;cursor:default}
.notice{margin:0;padding:8px 10px;border-radius:6px;background:var(--panel-sub);color:var(--text-body);font-size:var(--font-xs);line-height:1.6}
.notice.warn{background:var(--warning-tint);color:var(--text)}
.text{border:0;padding:0;margin-left:6px;background:transparent;color:var(--primary);cursor:pointer;text-decoration:underline;font-size:var(--font-xs)}
.readiness summary,.fold summary{cursor:pointer;font-size:var(--font-sm);color:var(--text-soft)}
table{width:100%;border-collapse:collapse;margin-top:6px;font-size:var(--font-xs)}
th,td{padding:5px 6px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:500}
td.missing,tr.missing td,tr.invalid td{color:var(--danger)}
tr.partial td{color:var(--warning)}
td small{margin-left:4px;color:var(--muted)}
.result{display:grid;gap:12px}
.result-head{display:grid;gap:6px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-sub)}
.summary{margin:0;font-size:var(--font-lg);font-weight:600;line-height:1.5}
.badges{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.badge{display:inline-flex;padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:var(--font-xs)}
.badge.mode.live{color:var(--primary);background:var(--primary-tint);border-color:var(--primary-tint-border)}
.badge.mode.review{color:var(--warning);background:var(--warning-tint);border-color:var(--warning)}
.badge.trial{color:var(--warning);border-color:var(--warning)}
.badge.status.failed,.badge.status.interrupted{color:var(--danger);border-color:var(--danger)}
.badge.status.partial{color:var(--warning)}
.asof,.counts,.coverage-summary,.versions{margin:0;color:var(--text-soft);font-size:var(--font-xs);line-height:1.6}
.errors{margin:0;padding-left:18px;color:var(--danger);font-size:var(--font-xs)}
h3{margin:0 0 8px;font-size:var(--font-sm)}
h3 small{margin-left:6px;font-weight:400;color:var(--muted);font-size:var(--font-xs)}
h4{margin:6px 0 0;font-size:var(--font-xs);color:var(--muted)}
.top-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.empty{margin:0;color:var(--muted);font-size:var(--font-xs)}
.fold{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.item-list{display:grid;gap:8px;margin-top:8px}
.coverage{display:grid;gap:8px}
.numbers{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0}
.numbers dt{color:var(--muted);font-size:var(--font-xs)}
.numbers dd{margin:0;font-size:var(--font-sm)}
.spinning{animation:watch-spin 1.3s linear infinite}
@keyframes watch-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
@media(max-width:700px){.watch-overlay{padding:0}.watch-panel{width:100%;height:100%;max-height:none;border-radius:0;border:0}.watch-head{padding:12px}.watch-body{padding:12px}.controls{flex-direction:column;align-items:stretch}.run{width:100%}}
</style>
