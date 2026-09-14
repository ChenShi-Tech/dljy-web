<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { analyzeImportedIntervals, captureImportedIntervals, type ImportedChoice, type ImportedInput, type ImportedResult } from '@/services/review/importedIntervals'
import type { ReportEvidence } from '@/services/review/workpapers'
import ReportEvidenceChart from './ReportEvidenceChart.vue'
const props = defineProps<{ company: string; region: string; view: ImportedInput['view']; date: string; topic: 'energy' | 'price' }>()
const emit = defineEmits<{ material: [value: ReportEvidence]; maintenance: []; period: [value: { start: string; end: string } | null] }>()
const opened = ref(false), simulated = ref(false), cadence = ref<ImportedInput['period']['cadence']>('day'), date = ref(props.date)
const deviationThreshold = ref<number | ''>(''), priceThreshold = ref<number | ''>('')
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
const threshold = computed(() => props.topic === 'energy' ? deviationThreshold.value : priceThreshold.value)
const manualReference = ref(false), referenceStart = ref(''), referenceEnd = ref('')
const choices = ref<ImportedChoice[]>([]), choice = ref(''), result = ref<ImportedResult | null>(null), selected = ref<string[]>([])
const loading = ref(false), saving = ref(false), error = ref('')
let sequence = 0
const choiceKey = (item: ImportedChoice) => JSON.stringify([item.seriesKey, item.objectId])
function input(): ImportedInput { const item = choices.value.find(value => choiceKey(value) === choice.value); return { region: props.region, view: props.view, simulated: simulated.value, period: { date: date.value, cadence: cadence.value, asOf: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) }, ...(item ? { seriesKey: item.seriesKey, objectId: item.objectId } : {}), topic: props.topic, ...(threshold.value !== '' ? { thresholds: props.topic === 'energy' ? { absolutePct: Number(threshold.value) } : { spreadYuan: Number(threshold.value) } } : {}), ...(manualReference.value ? { referencePeriod: { start: referenceStart.value, end: referenceEnd.value } } : {}), ...(selected.value.length ? { selections: [...selected.value] } : {}) } }
function invalidate() { ++sequence; result.value = null; error.value = ''; emit('period', null) }
watch(() => [props.company, props.region, props.view, props.date], () => { invalidate(); choices.value = []; choice.value = ''; selected.value = []; date.value = props.date })
watch([date, cadence, simulated, manualReference, referenceStart, referenceEnd], () => { invalidate(); choices.value = []; choice.value = ''; selected.value = [] })
watch([deviationThreshold, priceThreshold], () => { invalidate(); selected.value = [] })
watch(choice, () => { invalidate(); selected.value = [] })
watch(() => props.topic, () => { invalidate(); selected.value = [] })
onBeforeUnmount(() => ++sequence)
async function load() {
  if (loading.value || saving.value) return
  invalidate(); if (threshold.value !== '' && (!Number.isFinite(Number(threshold.value)) || Number(threshold.value) < 0)) { error.value = '筛选门槛须为非负数字。'; return } if (manualReference.value && (!referenceStart.value || !referenceEnd.value || referenceEnd.value < referenceStart.value)) { error.value = '请填写完整且顺序正确的参考日期。'; return } const ticket = sequence, query = input(); loading.value = true
  try { const data = await analyzeImportedIntervals(props.company, query); if (ticket !== sequence) return; if (!query.seriesKey) choices.value = data.choices; result.value = data; emit('period', data.periods.current) }
  catch { if (ticket === sequence) error.value = '补充资料暂时无法统计，请核对所选范围或先维护资料。' }
  finally { loading.value = false }
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
const anomalies = computed(() => props.topic === 'price' ? result.value?.analysis?.priceAnomalies ?? [] : result.value?.analysis?.anomalies ?? [])
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
function toggle(event: Event) { const next = (event.target as HTMLDetailsElement).open; if (opened.value === next) return; opened.value = next; if (next) void load() }
</script>
<template>
  <details class="imported-analysis" @toggle="toggle"><summary>分析交易员补充的分时资料</summary>
    <div class="controls"><label>资料性质<select v-model="simulated" :disabled="loading || saving"><option :value="false">业务资料</option><option :value="true">模拟演练</option></select></label><label>周期<select v-model="cadence" :disabled="loading || saving"><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label><label>日期<input v-model="date" type="date" :disabled="loading || saving" /></label><button :disabled="loading || saving" @click="load">{{ loading ? '正在统计…' : '重新统计' }}</button><button :disabled="saving" @click="emit('maintenance')">补充资料</button></div>
    <details><summary>历史比较设置</summary><label><input v-model="manualReference" type="checkbox" :disabled="loading || saving" />自行选择参考期</label><template v-if="manualReference"><label>参考开始<input v-model="referenceStart" type="date" :disabled="loading || saving" /></label><label>参考结束<input v-model="referenceEnd" type="date" :disabled="loading || saving" /></label></template><p v-else>日对上周同日，周、月对上一周期；未结束周期按相同进度比较。</p></details>
    <details><summary>时段筛选</summary><label v-if="topic === 'energy'">绝对偏差率至少（%）<input v-model="deviationThreshold" type="number" min="0" step="0.1" :disabled="loading || saving" placeholder="留空查看全部可比较时段" /></label><label v-else>日前实时价差绝对值至少（元/MWh）<input v-model="priceThreshold" type="number" min="0" step="0.1" :disabled="loading || saving" placeholder="留空查看全部价格时段" /></label><p>设置后点击重新统计。门槛仅筛选待核查时段，不代表原因已确认，也不改变全周期指标。勾选后入报告才统计所选时段。</p></details>
    <p v-if="simulated" role="status">模拟数据，仅供演练。</p>
    <label v-if="choices.length">业务对象与比较口径<select v-model="choice" :disabled="loading || saving"><option value="">请选择</option><option v-for="item in choices" :key="choiceKey(item)" :value="choiceKey(item)">{{ item.objectId }} · {{ item.basisLabel }}与{{ item.actualLabel }}</option></select></label>
    <p v-else-if="!loading">当前范围没有补充资料，可先通过统一维护流程导入。</p>
    <template v-if="result?.analysis"><p>本期 {{ result.periods.current.start }}—{{ result.periods.current.end }} · 对比 {{ result.periods.reference.start }}—{{ result.periods.reference.end }}</p><p v-if="topic === 'energy'">净偏差 {{ number(result.analysis.energy.netDeviationMwh) }} MWh · 绝对偏差 {{ number(result.analysis.energy.absoluteDeviationMwh) }} MWh · 成对覆盖 {{ result.analysis.coverage.comparableMinutes }} / {{ result.analysis.coverage.expectedMinutes }} 分钟</p><p v-else>日前均价 {{ number(result.analysis.prices.daAverage) }} 元/MWh · 实时均价 {{ number(result.analysis.prices.rtAverage) }} 元/MWh</p><p v-if="topic === 'energy' && result.analysis.comparison?.coverage.energyMinutes !== undefined">历史共同覆盖 {{ result.analysis.comparison.coverage.energyMinutes }} 分钟 · 净偏差变化 {{ number(result.analysis.comparison.changes.netDeviationMwh) }} MWh · 绝对偏差变化 {{ number(result.analysis.comparison.changes.absoluteDeviationMwh) }} MWh</p><ReportEvidenceChart v-if="chartMaterial" :evidence="chartMaterial" /><details v-if="anomalies.length"><summary>选择待核查时段取材（{{ anomalies.length }}）</summary><label v-for="point in anomalies.slice(0,100)" :key="point.start"><input v-model="selected" type="checkbox" :value="point.start" :disabled="saving" />{{ time(point.start) }}—{{ time(point.end) }}</label><p v-if="anomalies.length > 100">仅列前 100 个待核查时段，请缩小日期范围查看其余时段。</p></details><p>{{ result.notice }}</p><button :disabled="loading || saving" @click="save">{{ saving ? '正在保存材料…' : selected.length ? `将所选 ${selected.length} 个时段加入报告` : '将图表加入报告' }}</button></template>
    <p v-if="error" role="alert">{{ error }}</p>
  </details>
</template>
<style scoped>
.imported-analysis{padding:16px;border:1px solid var(--line);border-radius:8px;min-width:0}summary{cursor:pointer;padding:6px 0}.controls,label{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.controls{margin:14px 0}select,input,button{font:inherit;padding:7px;border:1px solid var(--line);border-radius:5px;background:var(--panel);color:var(--text);max-width:100%}p{line-height:1.6}details label{margin:8px 0}button:disabled{opacity:.5}[role=alert]{color:var(--danger)}
</style>
