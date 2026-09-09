<script setup lang="ts">
// 接现有真实接口的设计验证版；不把公司汇总数据拼成单笔交易结果。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, FileText, RefreshCw, ArrowUpRight } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { getDeclaration, listDeclarationsPage, type DeclarationOrder } from '@/services/declarations'
import { fetchDecisionLogFeed, postBackfill } from '@/services/trading/decisionLogClient'
import type { DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'
import { fetchReview, fetchSettlementReview, classifyReviewError, type ReviewResult, type ReviewFailure, type SettlementReviewResult } from '@/services/quant/quantClient'
import { clampToCoverage } from '@/services/market/captureCoverage'
import { beijingDay } from '@/utils/beijingDate'
import { isRealCalendarDate } from '@/utils/calendarDate'
import { shiftDate } from '@/services/review/reviewDashboard'
import { declarationLabel, matchesReviewScope, orderIntervals, platformIntervals, orderDecisionEvidence, reviewGap, reviewTaskOf } from '@/services/review/decisionWorkbench'
import IntervalEvidencePanel from '@/components/review/workbench/IntervalEvidencePanel.vue'
import SettlementEvidencePanel from '@/components/review/workbench/SettlementEvidencePanel.vue'
import ImprovementWorkbench from '@/components/review/workbench/ImprovementWorkbench.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'

const route = useRoute(), router = useRouter()
const region = computed(() => currentRegion.value.id)
const date = computed(() => typeof route.query.date === 'string' && isRealCalendarDate(route.query.date) ? route.query.date : clampToCoverage(region.value, 'review', beijingDay(-1)))
const task = computed(() => reviewTaskOf(route.query.task ?? (['strategy', 'decision'].includes(String(route.query.dim)) ? 'decision' : route.query.todo === '1' ? 'improvement' : 'result')))
const selectedKey = computed(() => typeof route.query.declarationId === 'string' && route.query.declarationId ? `order:${route.query.declarationId}` : typeof route.query.decisionId === 'string' && route.query.decisionId ? `decision:${route.query.decisionId}` : '')
const orders = ref<DeclarationOrder[]>([]), decisions = ref<DecisionLogEntry[]>([])
const extraOrder = ref<DeclarationOrder | null>(null)
const orderLoading = ref(false), decisionLoading = ref(false), evidenceLoading = ref(false), selectionLoading = ref(false)
const orderError = ref(''), decisionError = ref(''), selectionError = ref(''), settlementError = ref('')
const orderTotal = ref(0), orderOffset = ref(0)
const result = ref<ReviewResult | null>(null), failure = ref<ReviewFailure | null>(null), settlement = ref<SettlementReviewResult | null>(null)
const selectedOrder = computed(() => !selectionLoading.value && !selectionError.value && extraOrder.value?.id === selectedKey.value.slice(6) && selectedKey.value.startsWith('order:') && matchesReviewScope(extraOrder.value, date.value, region.value, selectedCompanyId.value) ? extraOrder.value : null)
const selectedDecision = computed(() => selectedKey.value.startsWith('decision:') ? decisions.value.find(d => d.id === selectedKey.value.slice(9)) ?? null : null)
const objectLabel = computed(() => selectedOrder.value ? declarationLabel(selectedOrder.value) : selectedDecision.value ? selectedDecision.value.decisionPoint : selectedKey.value ? '指定记录待核实' : '当日资料总览')
const context = computed(() => `${date.value} · ${objectLabel.value}${selectedOrder.value ? `（申报编号 ${selectedOrder.value.id}）` : selectedDecision.value ? `（决策记录 ${selectedDecision.value.seq}）` : ''}`)
const points = computed(() => selectedOrder.value ? orderIntervals(selectedOrder.value) : selectedKey.value ? [] : platformIntervals(result.value, date.value))
const simulated = computed(() => selectedOrder.value ? selectedOrder.value.mode === 'REHEARSAL' || !!selectedOrder.value.receipt?.mock || ['synthetic', 'illustrative'].includes(selectedOrder.value.basis) : /mock|synthetic/i.test(result.value?.source ?? ''))
const evidence = computed(() => selectedOrder.value ? orderDecisionEvidence(selectedOrder.value) : [])
const focus = ref(''), lesson = ref(''), savingLesson = ref(false)
watch(selectedKey, () => { focus.value = ''; lesson.value = '' })
watch(selectedDecision, d => { lesson.value = d?.lesson ?? '' })
function changeDate(value: string) {
  if (isRealCalendarDate(value)) void router.replace({ query: { ...route.query, date: value, declarationId: undefined, decisionId: undefined } })
}
function choose(value: string) {
  void router.replace({ query: { ...route.query, declarationId: value.startsWith('order:') ? value.slice(6) : undefined, decisionId: value.startsWith('decision:') ? value.slice(9) : undefined } })
}
function setTask(value: string) { void router.replace({ query: { ...route.query, task: value, dim: undefined, todo: undefined } }) }
function investigate(label: string) { focus.value = label; setTask('improvement') }
function openOriginal() {
  if (selectedOrder.value) void router.push({ path: '/xhjy/desk', query: { declarationId: selectedOrder.value.id, targetDate: selectedOrder.value.targetDate } })
}
function openArchive() { void router.push({ query: { ...route.query, layout: undefined, task: undefined, decisionId: undefined } }) }
let scopeSequence = 0, selectionSequence = 0, pageSequence = 0
async function loadOrders(seq: number, day: string, rid: string, offset = 0) {
  const page = ++pageSequence, company = selectedCompanyId.value
  orderLoading.value = true; orderError.value = ''
  try {
    const out = await listDeclarationsPage({ date: day, limit: 50, offset })
    if (seq !== scopeSequence || page !== pageSequence) return
    orders.value = out.rows.filter(o => matchesReviewScope(o, day, rid, company))
    orderTotal.value = out.total; orderOffset.value = offset
  } catch { if (seq === scopeSequence && page === pageSequence) orderError.value = '申报记录暂时无法读取，请重试。' }
  finally { if (seq === scopeSequence && page === pageSequence) orderLoading.value = false }
}
async function loadSelection() {
  const seq = ++selectionSequence, key = selectedKey.value, day = date.value, rid = region.value, company = selectedCompanyId.value
  extraOrder.value = null; selectionError.value = ''; selectionLoading.value = key.startsWith('order:')
  if (!key.startsWith('order:') || !company) { selectionLoading.value = false; return }
  try {
    const order = await getDeclaration(key.slice(6))
    if (seq !== selectionSequence) return
    if (!matchesReviewScope(order, day, rid, company)) { selectionError.value = '这笔申报的公司、交易日或地区与当前范围不一致，请重新选择。'; return }
    extraOrder.value = order
  } catch { if (seq === selectionSequence) selectionError.value = '指定申报暂时无法读取或无权访问。请重试或重新选择复盘对象。' }
  finally { if (seq === selectionSequence) selectionLoading.value = false }
}
async function reload() {
  const seq = ++scopeSequence, day = date.value, rid = region.value
  result.value = null; failure.value = null; settlement.value = null; settlementError.value = ''
  decisions.value = []; orders.value = []; extraOrder.value = null; orderTotal.value = 0; decisionError.value = ''; orderError.value = ''; selectionError.value = ''
  ++selectionSequence
  if (!selectedCompanyId.value) { evidenceLoading.value = false; decisionLoading.value = false; orderLoading.value = false; selectionLoading.value = false; return }
  evidenceLoading.value = true; decisionLoading.value = true
  void loadOrders(seq, day, rid); void loadSelection()
  void fetchDecisionLogFeed({ targetDate: day }).then(feed => {
    if (seq !== scopeSequence) return
    decisionLoading.value = false
    if (feed.available) decisions.value = feed.entries.filter(d => d.targetDate === day)
    else decisionError.value = feed.reason === 'unauthorized' ? '当前账号无权查看决策日志。' : '决策日志暂时无法读取，尚不能确认当天记录数量。'
  })
  // 结算与分时两条路径独立。云南公司分时实际侧尚未登记，不发送注定失败的查询。
  await Promise.allSettled([
    rid === 'yunnan' ? fetchSettlementReview(day).then(out => {
      if (seq !== scopeSequence) return
      if (out.date !== day || out.region !== rid) { settlementError.value = '返回的结算资料与当前范围不一致，请重试。'; return }
      settlement.value = out
    }).catch(() => { if (seq === scopeSequence) settlementError.value = '本日结算资料暂时无法读取。请核实日期、数据到达情况或当前授权后重试。' }) : Promise.resolve(),
    rid === 'yunnan' ? Promise.resolve().then(() => { if (seq === scopeSequence) failure.value = { kind: 'data-not-onboarded', title: '', description: '' } }) : fetchReview({ date: day }).then(out => {
      if (seq !== scopeSequence) return
      if (out.date !== day) { failure.value = { kind: 'load-failed', title: '', description: '' }; return }
      result.value = out
    }).catch(e => { if (seq === scopeSequence) failure.value = classifyReviewError(e) })
  ])
  if (seq === scopeSequence) evidenceLoading.value = false
}
watch([date, region, selectedCompanyId], (_next, previous) => {
  if (previous?.length && (previous[1] !== region.value || previous[2] !== selectedCompanyId.value) && selectedKey.value) choose('')
  focus.value = ''; void reload()
}, { immediate: true })
watch(selectedKey, loadSelection)
async function saveLesson() {
  const d = selectedDecision.value
  if (!d || !lesson.value.trim() || savingLesson.value) return
  const scope = scopeSequence; savingLesson.value = true
  try {
    const saved = await postBackfill(d.id, { lesson: lesson.value.trim() })
    if (scope !== scopeSequence) return
    decisions.value = decisions.value.map(item => item.id === saved.id ? saved : item)
    ElMessage.success('复盘结论已保存；原始判断保持留存。')
  } catch { ElMessage.warning('保存结果暂未确认，请重新读取该记录核实后重试。') }
  finally { savingLesson.value = false }
}
</script>

<template>
  <div class="review-workbench page-stack">
    <RegionDataBanner />
    <header class="heading"><div class="title"><h1>复盘中心</h1><span>{{ currentRegion.shortName || currentRegion.name }}</span></div><div class="date-control"><button type="button" aria-label="前一天" @click="changeDate(shiftDate(date, -1))"><ArrowLeft :size="14" /></button><input type="date" aria-label="复盘交易日" :value="date" @change="changeDate(($event.target as HTMLInputElement).value)" /><button type="button" aria-label="后一天" @click="changeDate(shiftDate(date, 1))"><ArrowRight :size="14" /></button></div><div class="header-actions"><button type="button" @click="openArchive"><FileText :size="14" />报告与历史专题</button><button type="button" @click="reload"><RefreshCw :size="14" />刷新</button></div></header>
    <p v-if="!selectedCompanyId" class="notice" role="alert">请先在顶部选择有权查看的公司，再进行复盘。</p>
    <template v-else>
    <section class="object-bar panel"><div><label for="review-object">复盘对象</label><select id="review-object" :value="selectedKey" @change="choose(($event.target as HTMLSelectElement).value)"><option value="">当日资料总览</option><option v-if="selectedKey && !selectedOrder && !selectedDecision" :value="selectedKey">指定记录待核实</option><option v-if="extraOrder && !orders.some(o => o.id === extraOrder?.id)" :value="`order:${extraOrder.id}`">{{ declarationLabel(extraOrder) }}</option><optgroup v-if="orders.length" label="申报记录"><option v-for="o in orders" :key="o.id" :value="`order:${o.id}`">{{ declarationLabel(o) }}</option></optgroup><optgroup v-if="decisions.length" label="决策日志"><option v-for="d in decisions" :key="d.id" :value="`decision:${d.id}`">{{ d.decisionPoint }} · {{ d.author || '决策记录' }}</option></optgroup></select></div><span v-if="orderLoading" class="muted">正在读取记录…</span><span v-else class="muted">沿同一对象查看依据与结果。</span><button v-if="selectedOrder" type="button" @click="openOriginal">打开这笔申报 <ArrowUpRight :size="14" /></button><div v-if="orderTotal > 50" class="pagination"><button type="button" :disabled="orderOffset === 0 || orderLoading" @click="loadOrders(scopeSequence, date, region, orderOffset - 50)">上一批</button><span>{{ orderOffset + 1 }}–{{ Math.min(orderOffset + 50, orderTotal) }} / {{ orderTotal }}</span><button type="button" :disabled="orderOffset + 50 >= orderTotal || orderLoading" @click="loadOrders(scopeSequence, date, region, orderOffset + 50)">下一批</button></div></section>
    <p v-if="orderError || decisionError || selectionError" class="notice" role="alert">{{ [orderError, decisionError, selectionError].filter(Boolean).join(' ') }}</p>
    <nav class="tasks" aria-label="复盘任务"><button v-for="item in [{ key: 'result', title: '结果核验', question: '发生了什么' }, { key: 'decision', title: '决策评价', question: '当时为什么这样做' }, { key: 'improvement', title: '改进验证', question: '下一次如何改进' }]" :key="item.key" type="button" :aria-pressed="task === item.key" @click="setTask(item.key)"><b>{{ item.title }}</b><span>{{ item.question }}</span></button></nav>
    <template v-if="task === 'result'">
      <section v-if="selectedKey" class="panel object-summary"><div><span class="eyebrow">当前复盘对象</span><h2>{{ objectLabel }}</h2><p>{{ selectedOrder ? '申报、出清与作业留痕来自同一笔记录。' : selectedDecision ? '这是一条决策判断记录；目前未与具体成交及结算逐笔关联。' : '正在核实指定记录，其他对象的数据不会补到这里。' }}</p></div><div v-if="selectedOrder" class="summary-facts"><span>交易日 <b>{{ selectedOrder.targetDate }}</b></span><span>申报时段 <b>{{ selectedOrder.energyCurveMwh96.length }} 个</b></span><span>{{ simulated ? '模拟演练' : '单据留存记录' }}</span></div><button v-if="selectedOrder || selectedDecision" class="primary" type="button" @click="setTask('decision')">查看当时依据</button></section>
      <SettlementEvidencePanel v-if="!selectedKey && settlement" :settlement="settlement" />
      <p v-if="!selectedKey && settlementError" class="notice" role="alert">{{ settlementError }}</p>
      <IntervalEvidencePanel v-if="points.length" :points="points" :basis="selectedOrder ? 'order' : 'platform'" :date="date" :simulated="simulated" @investigate="investigate" />
      <section v-else-if="!selectedKey" class="panel compact-gap"><h2>分时偏差核验</h2><p>{{ evidenceLoading ? '正在核实本日可用资料…' : reviewGap(failure) }}</p><p>结算增量不能替代实际分时电量。选择有出清记录的申报，仍可核查申报与出清差异。</p></section>
      <section v-if="!selectedKey" class="panel next"><div><h2>从结果进入具体决策</h2><p>选中申报或决策日志，还原当时的理由；也可以针对结算资料记录待核实的问题。</p></div><button type="button" @click="setTask('decision')">查看决策记录</button><button type="button" @click="setTask('improvement')">记录改进事项</button></section>
    </template>
    <template v-else-if="task === 'decision'">
      <section v-if="!selectedKey" class="panel decision-list"><p v-if="orderLoading || decisionLoading">正在读取当天决策记录…</p><header><h2>当天留下了哪些决策</h2><p>一次申报与一次判断分别作为复盘对象；同一天不代表已建立逐笔关联。</p></header><p v-if="!orderLoading && !decisionLoading && !orders.length && !decisions.length">{{ orderError || decisionError ? '记录暂不可读，不能确认当天是否留存了决策。' : '当天尚无可查看的申报或决策日志。可先核验结算资料，再记录需补证的问题。' }}</p><button v-for="o in orders" :key="o.id" type="button" class="decision-row" @click="choose(`order:${o.id}`)"><span><b>{{ declarationLabel(o) }}</b><small>{{ o.quoteRationale || '未留存报价依据' }}</small></span><ArrowUpRight :size="16" /></button><button v-for="d in decisions" :key="d.id" type="button" class="decision-row" @click="choose(`decision:${d.id}`)"><span><b>{{ d.decisionPoint }}</b><small>{{ d.judgement || '未记录判断摘要' }}</small></span><ArrowUpRight :size="16" /></button></section>
      <section v-else-if="selectedOrder" class="panel decision-detail"><header><h2>{{ objectLabel }}</h2><button type="button" @click="openOriginal">核对原始申报 <ArrowUpRight :size="14" /></button></header><p class="notice">以下为单据当前保存的作业留痕。尚无完整的事前版本验证，不能把后补记录当作决策时已知信息，也不按最终盈亏给当时的决策打分。</p><ol class="timeline"><li v-for="e in evidence" :key="e.title"><div><h3>{{ e.title }}</h3><time v-if="e.recordedAt">留存于 {{ new Date(e.recordedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }}</time><span v-else class="muted">留存时点未核实</span></div><p>{{ e.text }}</p></li></ol><div class="next"><p>需补证或改变申报方法时，写清下一次的触发条件与验证办法。</p><button class="primary" type="button" @click="setTask('improvement')">形成改进措施</button></div></section>
      <section v-else-if="selectedDecision" class="panel decision-detail"><h2>{{ selectedDecision.decisionPoint }}</h2><p class="notice">原始判断与复盘结论分开展示。当前尚未关联具体申报和结算，不显示单笔收益或胜率。</p><div class="original"><h3>当时的判断</h3><p>{{ selectedDecision.judgement || '未记录' }}</p><h3>判断依据</h3><p>{{ selectedDecision.rationale || '未记录' }}</p><span class="muted">{{ selectedDecision.author || '作者未记录' }} · 留存于 {{ selectedDecision.at ? new Date(selectedDecision.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时点未核实' }}</span></div><form @submit.prevent="saveLesson"><label>这次判断应保留或改进什么<textarea v-model="lesson" rows="5" placeholder="分别说明：当时信息是否充分、推理是否合理、哪些结论仍需验证。不要仅用事后涨跌评价判断。" /></label><div class="form-actions"><button type="button" @click="setTask('improvement')">形成改进措施</button><button class="primary" type="submit" :disabled="savingLesson || !lesson.trim()">{{ savingLesson ? '保存中…' : '保存复盘结论' }}</button></div></form></section>
      <section v-else class="panel compact-gap"><h2>{{ selectionLoading ? '正在读取记录' : '该记录暂不可用' }}</h2><p>请核实交易日与当前授权，或重新选择复盘对象。</p></section>
    </template>
    <ImprovementWorkbench v-else-if="!selectedKey || selectedOrder || selectedDecision" :key="`${selectedCompanyId}:${region}:${date}:${selectedKey}`" :context="context" :focus="focus" />
    <section v-else class="panel compact-gap"><h2>请先核实复盘对象</h2><p>指定记录尚不可用，不能将改进措施挂到其他对象。</p></section>
    </template>
  </div>
</template>

<style scoped>
.review-workbench { gap: 16px; max-width: 1520px; margin: 0 auto; width: 100%; min-width: 0; font-size: var(--font-md); }
.heading, .title, .header-actions, .date-control, .object-bar, .pagination, .object-summary, .summary-facts, .next, header, .form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.heading { gap: 18px; padding: 4px 0; } .title h1 { margin: 0; font-size: var(--font-xl); } .title > span { font-size: var(--font-sm); padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); } .header-actions { margin-left: auto; } button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; } button, input, select, textarea { font: inherit; font-size: var(--font-sm); color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; } button:hover { color: var(--primary); border-color: var(--primary); } button:disabled { opacity: .45; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; } .date-control { gap: 0; } .date-control input { border-radius: 0; } .date-control button { padding: 10px; } .primary { background: var(--primary); border-color: var(--primary); color: white; } .primary:hover { color: white; background: var(--primary-strong); }
.object-bar { padding: 14px 18px; } .object-bar > div:first-child { display: flex; align-items: center; gap: 12px; min-width: 0; } .object-bar label { font-size: var(--font-sm); font-weight: 600; white-space: nowrap; } .object-bar select { width: min(430px, 58vw); } .object-bar > button { margin-left: auto; } .pagination { font-size: var(--font-sm); } .muted, .eyebrow { color: var(--muted); font-size: var(--font-sm); } .notice { padding: 12px 16px; border-radius: 8px; background: var(--panel-sub); margin: 0; font-size: var(--font-sm); color: var(--muted); line-height: 1.75; } .tasks { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line); } .tasks button { justify-content: flex-start; padding: 14px 18px; border: 0; border-radius: 8px 8px 0 0; background: transparent; gap: 12px; border-bottom: 2px solid transparent; } .tasks button span { color: var(--muted); font-size: var(--font-sm); } .tasks button[aria-pressed=true] { border-bottom-color: var(--primary); background: var(--primary-tint); color: var(--primary); }
h2 { font-size: var(--font-lg); margin: 0; } h3 { font-size: var(--font-md); margin: 0; } p { line-height: 1.75; font-size: var(--font-sm); color: var(--muted); } .object-summary, .compact-gap, .decision-list, .decision-detail { padding: 20px; } .object-summary > div:first-child { flex: 1; min-width: 230px; } .object-summary h2 { margin-top: 8px; } .object-summary p { margin-bottom: 0; } .summary-facts { font-size: var(--font-sm); gap: 18px; } .summary-facts b { display: block; margin-top: 6px; } .next { justify-content: space-between; } section.next { padding: 20px; } .next > div, .next > p { flex: 1; min-width: 250px; } header { justify-content: space-between; } .decision-list header { display: block; } .decision-row { padding: 16px 0; width: 100%; justify-content: space-between; text-align: left; border: 0; border-top: 1px solid var(--line); border-radius: 0; } .decision-row span { min-width: 0; } .decision-row b, .decision-row small { display: block; } .decision-row small { font-size: var(--font-sm); color: var(--muted); margin-top: 6px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.decision-detail .notice { margin-top: 16px; } .timeline { list-style: none; padding: 0; margin: 20px 0; } .timeline li { position: relative; padding: 0 0 20px 24px; border-left: 1px solid var(--line); margin-left: 5px; } .timeline li::before { content: ''; position: absolute; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); left: -4px; top: 5px; } .timeline li > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px; } .timeline time { color: var(--muted); font-size: var(--font-xs); } .timeline p, .original p { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); } .original { padding: 20px 0; } form { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--line); } form label { display: flex; flex-direction: column; gap: 10px; } textarea { resize: vertical; line-height: 1.7; } .form-actions { justify-content: flex-end; margin-top: 12px; }
@media(max-width: 850px) { .tasks button { flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; } .heading { gap: 10px; } .object-bar > button { margin-left: 0; } } @media(max-width: 520px) { .header-actions { margin-left: 0; } .tasks button span { display: none; } .object-bar > div:first-child { flex-direction: column; align-items: stretch; width: 100%; } .object-bar select { width: 100%; } .date-control input { max-width: 155px; } .decision-row { gap: 16px; } }
</style>
