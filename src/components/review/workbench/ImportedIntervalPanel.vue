<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { analyzeImportedIntervals, captureImportedIntervals, type ImportedChoice, type ImportedInput, type ImportedResult, type ImportedSelection } from '@/services/review/importedIntervals'
import type { ReportEvidence } from '@/services/review/workpapers'
import ReportEvidenceChart from './ReportEvidenceChart.vue'
import ReviewCallout from './ReviewCallout.vue'
import MetricTile from '../MetricTile.vue'
import { segmentLabel } from '@/services/review/reportPresentation'
const props = defineProps<{ company: string; region: string; view: ImportedInput['view']; date: string; topic: 'energy' | 'price'; expanded?: boolean; selection?: ImportedSelection }>()
const emit = defineEmits<{ material: [value: ReportEvidence]; maintenance: []; period: [value: { start: string; end: string } | null]; selection: [value: ImportedSelection] }>()
const contextKey = () => JSON.stringify([props.company, props.region, props.view, props.date])
// 只在同一公司、地区、视角与复盘日期下恢复上次的筛选；初值直接取保存值，不触发下面的重置监听。
const saved = props.selection?.context === contextKey() ? props.selection : undefined
const opened = ref(false), simulated = ref(saved?.simulated ?? false), cadence = ref<ImportedInput['period']['cadence']>(saved?.cadence ?? 'day'), date = ref(saved?.date ?? props.date)
const deviationThreshold = ref<number | ''>(saved?.deviationThreshold ?? ''), priceThreshold = ref<number | ''>(saved?.priceThreshold ?? '')
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
const threshold = computed(() => props.topic === 'energy' ? deviationThreshold.value : priceThreshold.value)
const manualReference = ref(saved?.manual ?? false), referenceStart = ref(saved?.referenceStart ?? ''), referenceEnd = ref(saved?.referenceEnd ?? '')
const choices = ref<ImportedChoice[]>([]), choice = ref(''), result = ref<ImportedResult | null>(null), selected = ref<string[]>([])
const loading = ref(false), saving = ref(false), error = ref('')
let sequence = 0
const choiceKey = (item: ImportedChoice) => JSON.stringify([item.seriesKey, item.objectId])
const rollupIds = ref<string[]>([])
const currentChoice = computed(() => choices.value.find(value => choiceKey(value) === choice.value))
// 只有同一资料口径的对象能合计：口径不同（综合预测 vs 日前申报）相加就是混口径，服务端也会拒绝。
const sameSeries = computed(() => currentChoice.value ? choices.value.filter(item => item.seriesKey === currentChoice.value!.seriesKey) : [])
// 价格没有跨对象合计语义（既不能相加也不该等权平均），服务端在合计口径下拒绝保存价格图表，这里同样不开放。
const canRollup = computed(() => props.topic === 'energy' && sameSeries.value.length > 1)
// 下拉框选中的对象是锚点，恒在合计集合里：否则取消勾选锚点后，下拉框显示的是它、实际统计的却是别的对象。
// 勾选里残留的非同口径对象一并滤掉，请求只由「锚点 + 同口径勾选」推导。
const rollupSet = computed(() => {
  const anchor = currentChoice.value
  if (!anchor) return []
  const allowed = new Set(sameSeries.value.map(item => item.objectId))
  return [...new Set([anchor.objectId, ...rollupIds.value.filter(id => allowed.has(id))])]
})
const rollingUp = computed(() => canRollup.value && rollupSet.value.length > 1)
function input(): ImportedInput { const item = currentChoice.value; return { region: props.region, view: props.view, simulated: simulated.value, period: { date: date.value, cadence: cadence.value, asOf: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) }, ...(item ? { seriesKey: item.seriesKey, ...(rollingUp.value ? { objectIds: [...rollupSet.value] } : { objectId: item.objectId }) } : {}), topic: props.topic, ...(threshold.value !== '' ? { thresholds: props.topic === 'energy' ? { absolutePct: Number(threshold.value) } : { spreadYuan: Number(threshold.value) } } : {}), ...(manualReference.value ? { referencePeriod: { start: referenceStart.value, end: referenceEnd.value } } : {}), ...(selected.value.length ? { selections: [...selected.value] } : {}) } }
// 待恢复的勾选留到统计成功才套用：恢复时那次统计临时失败，交易员点「重新统计」成功后仍能找回，不会被空勾选覆盖。
let pendingSelected: string[] | null = null
function clearSelected() { selected.value = []; pendingSelected = null }
function invalidate() { ++sequence; result.value = null; error.value = ''; emit('period', null) }
watch(() => [props.company, props.region, props.view, props.date], () => { restore = null; invalidate(); choices.value = []; choice.value = ''; clearSelected(); rollupIds.value = []; date.value = props.date })
watch([date, cadence, simulated, manualReference, referenceStart, referenceEnd], () => { restore = null; invalidate(); choices.value = []; choice.value = ''; clearSelected(); rollupIds.value = [] })
watch([deviationThreshold, priceThreshold], () => { invalidate(); clearSelected() })
watch(rollupIds, () => { invalidate(); clearSelected() }, { deep: true })
watch(choice, () => { invalidate(); clearSelected(); rollupIds.value = currentChoice.value ? [currentChoice.value.objectId] : [] })
watch(() => props.topic, () => { invalidate(); clearSelected(); if (props.topic !== 'energy') rollupIds.value = currentChoice.value ? [currentChoice.value.objectId] : [] })
onBeforeUnmount(() => ++sequence)
onMounted(() => { if (props.expanded) { opened.value = true; void load() } })
// 对象、合计勾选与待核查时段要等对象清单读回后才能恢复；恢复期间的中间状态不回写上层，中途关窗也不会冲掉保存值。
let restore = saved?.seriesKey ? { seriesKey: saved.seriesKey, objectId: saved.objectId, rollupIds: [...saved.rollupIds], selected: saved.topic === props.topic ? [...saved.selected] : [] } : null
let restoring = false
function currentSelection(): ImportedSelection {
  const item = currentChoice.value
  return { context: contextKey(), topic: props.topic, simulated: simulated.value, cadence: cadence.value, date: date.value, manual: manualReference.value, referenceStart: referenceStart.value, referenceEnd: referenceEnd.value, deviationThreshold: deviationThreshold.value, priceThreshold: priceThreshold.value, seriesKey: item?.seriesKey ?? '', objectId: item?.objectId ?? '', rollupIds: [...rollupIds.value], selected: [...selected.value] }
}
watch([simulated, cadence, date, manualReference, referenceStart, referenceEnd, deviationThreshold, priceThreshold, choice, rollupIds, selected], () => { if (!restoring) emit('selection', currentSelection()) }, { deep: true })
async function applyRestore(pending: NonNullable<typeof restore>) {
  restoring = true
  try {
    const item = choices.value.find(value => value.seriesKey === pending.seriesKey && value.objectId === pending.objectId)
    if (!item) return
    choice.value = choiceKey(item); await nextTick()
    rollupIds.value = pending.rollupIds; await nextTick()
    pendingSelected = pending.selected
    await load()
  } finally {
    restoring = false
    // 统计没成功时不回写：上层保存值原样保留，重试成功后由 load 套用勾选再回写。
    if (pendingSelected === null) emit('selection', currentSelection())
  }
}
async function load() {
  if (loading.value || saving.value) return
  invalidate(); if (threshold.value !== '' && (!Number.isFinite(Number(threshold.value)) || Number(threshold.value) < 0)) { error.value = '筛选门槛须为非负数字。'; return } if (manualReference.value && (!referenceStart.value || !referenceEnd.value || referenceEnd.value < referenceStart.value)) { error.value = '请填写完整且顺序正确的参考日期。'; return } const ticket = sequence, query = input(); loading.value = true
  try {
    const data = await analyzeImportedIntervals(props.company, query); if (ticket !== sequence) return; if (!query.seriesKey) choices.value = data.choices; result.value = data; emit('period', data.periods.current)
    if (pendingSelected && query.seriesKey && data.analysis) {
      // 资料已修订、待核查时段不在新结果里时不勾选，宁可让交易员重新挑，也不带着对不上的时段取材。
      const available = new Set(anomalies.value.map(point => point.start)), restored = pendingSelected
      pendingSelected = null
      if (restored.every(start => available.has(start))) selected.value = restored
    }
  }
  catch { if (ticket === sequence) error.value = '补充资料暂时无法统计，请核对所选范围或先维护资料。' }
  finally { loading.value = false }
  if (restore && !query.seriesKey && choices.value.length) { const pending = restore; restore = null; await applyRestore(pending) }
}
async function save() {
  if (!result.value?.analysis || loading.value || saving.value) return
  const ticket = sequence, query = input(); saving.value = true
  try { const material = await captureImportedIntervals(props.company, { ...query, expectedVersion: result.value.source.version }); if (ticket === sequence) emit('material', material) }
  catch { if (ticket === sequence) error.value = '材料未保存，资料可能已有修订。请重新统计并核对图表后再取材。' }
  finally { saving.value = false }
}
const chartMaterial = computed<ReportEvidence | null>(() => {
  const data = result.value
  if (!data?.analysis || !data.input) return null
  return { id: 'preview', region: props.region, authorId: '', createdAt: '', sourceKind: 'imported', contentHash: data.source.version, content: { topic: props.topic, labels: props.topic === 'price' ? ['日前价格', '实时价格'] : data.labels ?? ['基准电量','实际电量'], objectLabel: data.objectLabel, capturedAt: '', sourceNotice: data.notice, input: data.input, result: data.analysis } }
})
// 参考期有时段但缺有效值时，只列时段数会让人以为它已覆盖，看不出为什么没进跨期比较。
function referenceCoverage(objectId: string) { return result.value?.rollup?.reference.objects.find(item => item.objectId === objectId) ?? { intervals: 0, baselineIntervals: 0, actualIntervals: 0 } }
const anomalies = computed(() => props.topic === 'price' ? result.value?.analysis?.priceAnomalies ?? [] : result.value?.analysis?.anomalies ?? [])
function toggle(event: Event) { const next = (event.target as HTMLDetailsElement).open; if (opened.value === next) return; opened.value = next; if (next) void load() }
</script>
<template>
  <details class="imported-analysis" :open="expanded" @toggle="toggle"><summary>分析交易员补充的分时资料</summary>
    <div class="controls"><label>资料性质<select v-model="simulated" :disabled="loading || saving"><option :value="false">业务资料</option><option :value="true">模拟演练</option></select></label><label>周期<select v-model="cadence" :disabled="loading || saving"><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label><label>日期<input v-model="date" type="date" :disabled="loading || saving" /></label><button :disabled="loading || saving" @click="load">{{ loading ? '正在统计…' : '重新统计' }}</button><button :disabled="saving" @click="emit('maintenance')">补充资料</button></div>
    <details><summary>历史比较设置</summary><label><input v-model="manualReference" type="checkbox" :disabled="loading || saving" />自行选择参考期</label><template v-if="manualReference"><label>参考开始<input v-model="referenceStart" type="date" :disabled="loading || saving" /></label><label>参考结束<input v-model="referenceEnd" type="date" :disabled="loading || saving" /></label></template><p v-else>日对上周同日，周、月对上一周期；未结束周期按相同进度比较。</p></details>
    <details><summary>时段筛选</summary><label v-if="topic === 'energy'">绝对偏差率至少（%）<input v-model="deviationThreshold" type="number" min="0" step="0.1" :disabled="loading || saving" placeholder="留空查看全部可比较时段" /></label><label v-else>日前实时价差绝对值至少（元/MWh）<input v-model="priceThreshold" type="number" min="0" step="0.1" :disabled="loading || saving" placeholder="留空查看全部价格时段" /></label><p>设置后点击重新统计。门槛仅筛选待核查时段，不代表原因已确认，也不改变全周期指标。勾选后入报告才统计所选时段。</p></details>
    <ReviewCallout v-if="simulated" tone="mock">仅供演练，统计与图表不代表真实业务。</ReviewCallout>
    <label v-if="choices.length">业务对象与比较口径<select v-model="choice" :disabled="loading || saving"><option value="">请选择</option><option v-for="item in choices" :key="choiceKey(item)" :value="choiceKey(item)">{{ item.objectId }} · {{ item.basisLabel }}与{{ item.actualLabel }}</option></select></label>
    <details v-if="canRollup"><summary>合计多个对象</summary><div class="objects"><label v-for="item in sameSeries" :key="item.objectId"><input v-model="rollupIds" type="checkbox" :value="item.objectId" :disabled="loading || saving || item.objectId === currentChoice?.objectId" />{{ item.objectId }}{{ item.objectId === currentChoice?.objectId ? '（当前对象）' : '' }}</label></div><ReviewCallout>勾选两个以上对象后按同一口径合计为公司表现。只统计所选对象都有资料的时段——少一个对象就按零合计，公司电量会凭空变小且看不出少了谁；缺口见下方逐对象覆盖。价格不作跨对象合计，需逐对象查看。</ReviewCallout></details>
    <p v-if="!choices.length && !loading">当前范围没有补充资料，可先通过统一维护流程导入。</p>
    <template v-if="result?.analysis"><p>本期 {{ result.periods.current.start }}—{{ result.periods.current.end }} · 对比 {{ result.periods.reference.start }}—{{ result.periods.reference.end }}</p><div v-if="topic === 'energy'" class="metric-grid"><MetricTile label="净偏差" :value="number(result.analysis.energy.netDeviationMwh)" unit="MWh" /><MetricTile :label="result.rollup ? '逐对象绝对偏差' : '绝对偏差'" :value="number(result.analysis.energy.absoluteDeviationMwh)" unit="MWh" :sub="result.rollup ? '各对象分别取绝对值后相加' : undefined" /><MetricTile label="成对覆盖" :value="`${result.analysis.coverage.comparableMinutes} / ${result.analysis.coverage.expectedMinutes}`" unit="分钟" /><template v-if="result.analysis.comparison?.coverage.energyMinutes !== undefined"><MetricTile label="净偏差变化" :value="number(result.analysis.comparison.changes.netDeviationMwh)" unit="MWh" :sub="`历史共同覆盖 ${result.analysis.comparison.coverage.energyMinutes} 分钟`" /><MetricTile label="绝对偏差变化" :value="number(result.analysis.comparison.changes.absoluteDeviationMwh)" unit="MWh" :sub="`历史共同覆盖 ${result.analysis.comparison.coverage.energyMinutes} 分钟`" /></template></div><div v-else class="metric-grid"><MetricTile label="日前均价" :value="number(result.analysis.prices.daAverage)" unit="元/MWh" /><MetricTile label="实时均价" :value="number(result.analysis.prices.rtAverage)" unit="元/MWh" /></div><details v-if="result.rollup"><summary>逐对象覆盖（{{ result.rollup.objectIds.length }} 个对象合计）</summary><ReviewCallout>本期 <b>{{ result.rollup.current.matchedIntervals }} / {{ result.rollup.current.observedIntervals }}</b> 个时段所有对象齐全，参考期 <b>{{ result.rollup.reference.matchedIntervals }} / {{ result.rollup.reference.observedIntervals }}</b>。只有齐全的时段参与合计；某个对象少了时段，合计与跨期比较都会相应变少。</ReviewCallout><div class="table-scroll"><table><thead><tr><th>业务对象</th><th>本期时段</th><th>本期有效基准</th><th>本期有效实际</th><th>参考期时段</th><th>参考期有效基准</th><th>参考期有效实际</th></tr></thead><tbody><tr v-for="row in result.rollup.current.objects" :key="row.objectId"><th>{{ row.objectId }}</th><td>{{ row.intervals }}</td><td>{{ row.baselineIntervals }}</td><td>{{ row.actualIntervals }}</td><td>{{ referenceCoverage(row.objectId).intervals }}</td><td>{{ referenceCoverage(row.objectId).baselineIntervals }}</td><td>{{ referenceCoverage(row.objectId).actualIntervals }}</td></tr></tbody></table></div></details><ReportEvidenceChart v-if="chartMaterial" :evidence="chartMaterial" /><details v-if="anomalies.length"><summary>选择待核查时段取材（{{ anomalies.length }}）</summary><label v-for="point in anomalies.slice(0,100)" :key="point.start"><input v-model="selected" type="checkbox" :value="point.start" :disabled="saving" />{{ segmentLabel(point) }}</label><p v-if="anomalies.length > 100">仅列前 100 个待核查时段，请缩小日期范围查看其余时段。</p></details><ReviewCallout>{{ result.notice }}</ReviewCallout><button :disabled="loading || saving" @click="save">{{ saving ? '正在保存材料…' : selected.length ? `将所选 ${selected.length} 个时段加入报告` : '将图表加入报告' }}</button></template>
    <p v-if="error" role="alert">{{ error }}</p>
  </details>
</template>
<style scoped>
.imported-analysis{padding:16px;border:1px solid var(--line);border-radius:8px;min-width:0}summary{cursor:pointer;padding:6px 0}.controls,label{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.controls{margin:14px 0}select,input,button{font:inherit;padding:7px;border:1px solid var(--line);border-radius:5px;background:var(--panel);color:var(--text);max-width:100%}p{line-height:1.6}details label{margin:8px 0}button:disabled{opacity:.5}[role=alert]{color:var(--danger)}
.objects{display:flex;flex-wrap:wrap;gap:8px 18px;margin:8px 0}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:12px 0}
.callout-box{margin:10px 0}
.table-scroll{overflow:auto;margin:8px 0}
.table-scroll table{border-collapse:collapse;width:100%}
.table-scroll th,.table-scroll td{padding:8px;text-align:right;border-bottom:1px solid var(--line);font-size:var(--font-sm)}
.table-scroll th:first-child{text-align:left}
</style>
