<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { ApiError } from '@/services/api'
import { formatValue } from '@/services/review/decisionWorkbench'
import { beijingDay } from '@/utils/beijingDate'
import { displayAnalysisIntervals } from '@/services/review/reportPresentation'
import { captureMarketPrices, fetchMarketPrices, type MarketPriceInput, type MarketPriceResult } from '@/services/review/marketPrices'
import { priceSelectionFromQuery, type PriceSelection } from '@/services/review/reviewTopics'
import type { ReportEvidence } from '@/services/review/workpapers'
import ReviewCallout from './ReviewCallout.vue'
import MetricTile from '../MetricTile.vue'
const props = defineProps<{ company: string; region: string; date: string; selection?: PriceSelection }>()
const emit = defineEmits<{ period: [value: { start: string; end: string } | null]; material: [value: ReportEvidence]; selection: [value: PriceSelection] }>()
const initial = props.selection ?? priceSelectionFromQuery({}, props.date)
const periodDate = ref(initial.date), cadence = ref(initial.cadence), subject = ref(initial.plant && initial.node ? JSON.stringify({ plant: initial.plant, node: initial.node }) : ''), threshold = ref(initial.threshold)
const manual = ref(initial.manual), referenceStart = ref(initial.referenceStart), referenceEnd = ref(initial.referenceEnd)
const subjects = ref<MarketPriceResult['subjects']>([]), current = ref<MarketPriceResult | null>(null), full = ref<MarketPriceResult | null>(null)
const selected = ref<string[]>([...initial.intervals]), loading = ref(false), capturing = ref(false), error = ref('')
const comparisonRows = computed(() => {
  const value = current.value?.analysis?.comparison
  return value ? [
    { label: '日前均价', current: value.current.prices.daAverage, reference: value.reference.prices.daAverage, change: value.changes.daPrice, minutes: value.current.prices.da?.minutes },
    { label: '实时均价', current: value.current.prices.rtAverage, reference: value.reference.prices.rtAverage, change: value.changes.rtPrice, minutes: value.current.prices.rt?.minutes },
    { label: '日前减实时', current: value.current.prices.spreadAverage, reference: value.reference.prices.spreadAverage, change: value.changes.spread, minutes: value.coverage.priceMinutes },
  ] : []
})
const el = ref<HTMLElement | null>(null)
const chart = useEChart(el, { render, onInit(instance) { instance.on('brushEnd', (event: unknown) => {
  const areas = (event as { areas?: Array<{ coordRange?: number[] }> }).areas ?? []
  selected.value = displayAnalysisIntervals(full.value?.analysis?.intervals ?? []).flatMap((row, index) => row && areas.some(area => area.coordRange?.length === 2 && area.coordRange.every(Number.isFinite) && index >= Math.min(...area.coordRange) && index <= Math.max(...area.coordRange)) ? [row.start] : [])
  void load()
}) } })
watch(current, value => emit('period', value?.periods.current ?? null), { flush: 'sync' })

let sequence = 0, controller: AbortController | null = null, lastInput: MarketPriceInput | null = null
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function render() {
  const rows = displayAnalysisIntervals(full.value?.analysis?.intervals ?? [])
  chart.setOption({ animation: false, tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => formatValue(value) }, legend: { data: ['日前价格', '实时价格'] }, grid: { left: 75, right: 25, top: 50, bottom: 60 },
    brush: { xAxisIndex: 0, brushMode: 'multiple', toolbox: ['lineX', 'clear'] }, dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0 }],
    xAxis: { type: 'category', data: rows.map(row => row ? time(row.start) : '缺资料时段') }, yAxis: { type: 'value', name: '元/MWh' },
    series: [{ name: '日前价格', type: 'line', connectNulls: false, data: rows.map(row => row?.daPrice ?? null) }, { name: '实时价格', type: 'line', connectNulls: false, data: rows.map(row => row?.rtPrice ?? null) }],
  }, { replaceMerge: ['series'] })
}
function invalidate(reset = false) { ++sequence; controller?.abort(); loading.value = false; current.value = null; lastInput = null; error.value = ''; if (reset) { selected.value = []; full.value = null; render() } }
watch([periodDate, cadence, manual, referenceStart, referenceEnd, () => props.company, () => props.region], () => { invalidate(true); subjects.value = []; subject.value = '' })
watch(subject, () => invalidate(true))
watch(threshold, () => invalidate(true))
async function load() {
  invalidate(); const ticket = sequence
  const spreadYuan = threshold.value === '' ? undefined : Number(threshold.value)
  if (spreadYuan !== undefined && (!Number.isFinite(spreadYuan) || spreadYuan < 0)) { error.value = '请输入非负价差门槛'; return }
  if (manual.value && (!referenceStart.value || !referenceEnd.value || referenceStart.value > referenceEnd.value)) { error.value = '请填写有效的参考期'; return }
  const selection = subjects.value.find(item => JSON.stringify(item) === subject.value)
  const input: MarketPriceInput = { region: props.region, period: { date: periodDate.value, cadence: cadence.value, asOf: beijingDay(0) }, ...(selection ? { selection } : {}), ...(selected.value.length ? { selections: [...selected.value] } : {}), ...(spreadYuan !== undefined ? { thresholds: { spreadYuan } } : {}), ...(manual.value ? { referencePeriod: { start: referenceStart.value, end: referenceEnd.value } } : {}) }
  controller = new AbortController(); loading.value = true
  try { const result = await fetchMarketPrices(props.company, input, controller.signal); if (ticket !== sequence) return; current.value = result; subjects.value = result.subjects; lastInput = input; if (!selected.value.length) { full.value = result; render() } }
  catch (e) { if (ticket === sequence) error.value = e instanceof ApiError && e.code === 404 ? '当前公司尚未接入厂站节点价格，可先查看本次申报留存价格。' : '价格统计未完成，请核对资料版本、周期和访问权限后重试。' }
  finally { if (ticket === sequence) loading.value = false }
}
async function capture() {
  if (!lastInput || !current.value?.analysis || capturing.value) return
  const input = JSON.parse(JSON.stringify(lastInput)) as MarketPriceInput, ticket = sequence
  capturing.value = true
  try { const item = await captureMarketPrices(props.company, input); if (ticket === sequence) emit('material', item) }
  catch { if (ticket === sequence) error.value = '价格材料尚未保存，请稍后重试。' }
  finally { capturing.value = false }
}
function toggle(start: string) { selected.value = selected.value.includes(start) ? selected.value.filter(item => item !== start) : [...selected.value, start]; void load() }
watch([periodDate, cadence, manual, referenceStart, referenceEnd, subject, threshold, selected], () => {
  const choice = subjects.value.find(item => JSON.stringify(item) === subject.value)
  emit('selection', { date: periodDate.value, cadence: cadence.value, manual: manual.value, referenceStart: referenceStart.value, referenceEnd: referenceEnd.value, plant: choice?.plant ?? '', node: choice?.node ?? '', threshold: threshold.value, intervals: [...selected.value] })
})
onMounted(async () => {
  const desired = subject.value
  // Resolve a deep link against the authorized catalog before querying its prices.
  await load()
  if (desired && subject.value === desired && subjects.value.some(item => JSON.stringify(item) === desired)) {
    const saved = [...selected.value]
    selected.value = []
    await load()
    if (saved.length && subject.value === desired) { selected.value = saved; await load() }
  }
})
onBeforeUnmount(() => { ++sequence; controller?.abort() })
</script>
<template>
  <section class="market-price-panel" aria-label="厂站真实价格分析">
    <div class="controls"><label>周期<select v-model="cadence" aria-label="价格分析周期"><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label><label>日期<input v-model="periodDate" type="date" aria-label="价格分析日期" /></label><label><input v-model="manual" type="checkbox" />指定参考期</label><template v-if="manual"><input v-model="referenceStart" aria-label="价格参考起日" type="date" /><input v-model="referenceEnd" aria-label="价格参考止日" type="date" /></template><button :disabled="loading" @click="load">{{ loading ? '正在统计…' : '重新统计' }}</button></div>
    <label v-if="subjects.length">厂站与节点<select v-model="subject" aria-label="价格分析对象"><option value="">请选择厂站与节点</option><option v-for="item in subjects" :key="JSON.stringify(item)" :value="JSON.stringify(item)">{{ item.plant }} · {{ item.node }}</option></select></label>
    <label v-if="subject">价差门槛（元/MWh）<input v-model="threshold" type="number" min="0" placeholder="不限" /></label>
    <p v-if="error" role="alert">{{ error }}</p><ReviewCallout v-if="current">{{ current.notice }}</ReviewCallout><ReviewCallout v-if="current && !current.analysis" :tone="subjects.length ? 'note' : 'warn'">{{ subjects.length ? '选择节点后点击重新统计，价格分别计算，不合成为公司均价。' : '当前两期没有可用的厂站节点价格资料。' }}</ReviewCallout>
    <template v-if="current?.analysis">
      <p>本期 {{ current.periods.current.start }}—{{ current.periods.current.end }} · 参考期 {{ current.periods.reference.start }}—{{ current.periods.reference.end }}</p>
      <div class="metric-grid"><MetricTile label="日前均价" :value="formatValue(current.analysis.prices.daAverage)" unit="元/MWh" :sub="`有价 ${current.analysis.prices.da?.minutes ?? 0} 分钟`" /><MetricTile label="实时均价" :value="formatValue(current.analysis.prices.rtAverage)" unit="元/MWh" :sub="`有价 ${current.analysis.prices.rt?.minutes ?? 0} 分钟`" /><MetricTile label="日前减实时" :value="formatValue(current.analysis.prices.spreadAverage)" unit="元/MWh" :sub="`共同覆盖 ${current.analysis.prices.comparableMinutes} 分钟`" /></div>
      <ReviewCallout>历史比较仅取两期共同有值的时段。价格单位：元/MWh；不同指标的共同覆盖可能不同。</ReviewCallout>
      <div class="table-scroll"><table><thead><tr><th>指标</th><th>本期共同范围</th><th>参考期共同范围</th><th>变化</th><th>可比分钟</th></tr></thead><tbody><tr v-for="row in comparisonRows" :key="row.label"><th>{{ row.label }}</th><td>{{ formatValue(row.current) }}</td><td>{{ formatValue(row.reference) }}</td><td>{{ formatValue(row.change) }}</td><td>{{ formatValue(row.minutes) }}</td></tr></tbody></table></div>
      <details><summary>查看价格极值与负电价时长</summary><p>日前：最低 {{ formatValue(current.analysis.prices.da?.minimum) }}、最高 {{ formatValue(current.analysis.prices.da?.maximum) }} 元/MWh；负电价 {{ formatValue(current.analysis.prices.da?.negativeMinutes) }} 分钟。</p><p>实时：最低 {{ formatValue(current.analysis.prices.rt?.minimum) }}、最高 {{ formatValue(current.analysis.prices.rt?.maximum) }} 元/MWh；负电价 {{ formatValue(current.analysis.prices.rt?.negativeMinutes) }} 分钟。</p></details>
      <div class="controls"><button :disabled="capturing || !current.analysis.intervals.length" @click="capture">{{ capturing ? '正在保存…' : '加入复盘底稿' }}</button><button v-if="selected.length" @click="selected = []; load()">清除所选时段</button></div>
    </template>
    <div v-show="current?.analysis && full?.analysis" ref="el" class="chart" />
    <details v-if="current?.analysis && full?.analysis?.priceAnomalies?.length"><summary>异常价差时段（可多选后重新统计）</summary><div class="intervals"><label v-for="row in full.analysis.priceAnomalies" :key="row.start"><input type="checkbox" :checked="selected.includes(row.start)" @change="toggle(row.start)" />{{ time(row.start) }} · 日前 {{ formatValue(row.daPrice) }} / 实时 {{ formatValue(row.rtPrice) }}</label></div></details>
  </section>
</template>
<style scoped>
.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:var(--font-sm)}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child{text-align:left}thead{background:var(--panel-sub)}.market-price-panel{display:grid;gap:14px}.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap}label{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}p,small,summary{color:var(--muted);line-height:1.7;margin:0}button,input,select{font:inherit;font-size:var(--font-sm);padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}button,summary{cursor:pointer}.chart{height:340px}.intervals{display:grid;gap:8px;max-height:240px;overflow:auto;padding-top:12px}button:disabled{opacity:.5}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
