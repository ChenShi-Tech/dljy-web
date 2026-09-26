<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { displayAnalysisIntervals } from '@/services/review/reportPresentation'
import { formatValue } from '@/services/review/decisionWorkbench'
import { comparisonLabels, previewTopicAnalysis, type AnalysisThresholds, type ComparisonBasis, type TopicAnalysisResult } from '@/services/review/topicAnalysis'
import { captureReportEvidence, workpaperError, type ReportEvidence } from '@/services/review/workpapers'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'
import ReviewCallout from './ReviewCallout.vue'
import MetricTile from '../MetricTile.vue'

const props = defineProps<{ snapshot: ReviewEvidenceSnapshot; activeTopic?: 'energy' | 'price'; bases?: ComparisonBasis[] }>()
const emit = defineEmits<{ material: [value: ReportEvidence] }>()
const capturing = ref(false)
const topic = ref<'energy' | 'price'>(props.activeTopic ?? 'energy')
const basis = ref<ComparisonBasis>(props.bases?.[0] ?? (props.snapshot.scope.objectKey.startsWith('order:') ? 'declared_cleared' : 'forecast_actual'))
const basisOptions = computed(() => props.bases ?? Object.keys(comparisonLabels) as ComparisonBasis[])
const full = ref<TopicAnalysisResult | null>(null), current = ref<TopicAnalysisResult | null>(null)
const selected = ref<string[]>([]), loading = ref(false), error = ref(''), threshold = ref('')
const chartEl = ref<HTMLElement | null>(null)
const labels = computed(() => topic.value === 'price' ? ['日前价格', '实时价格'] : comparisonLabels[basis.value])
const anomalies = computed(() => topic.value === 'price' ? full.value?.priceAnomalies ?? [] : full.value?.anomalies ?? [])
const segments = computed(() => topic.value === 'price' ? full.value?.priceSegments ?? [] : full.value?.deviationSegments ?? [])
const timeLabel = (time: string) => new Date(time).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
const chart = useEChart(chartEl, { render, onInit(instance) {
  instance.on('brushEnd', (event: unknown) => {
    const areas = (event as { areas?: Array<{ coordRange?: number[] }> }).areas ?? []
    const rows = displayAnalysisIntervals(full.value?.intervals ?? [])
    selected.value = rows.flatMap((row, index) => row && areas.some(area => {
      const range = area.coordRange
      return range?.length === 2 && range.every(Number.isFinite) && index >= Math.min(...range) && index <= Math.max(...range)
    }) ? [row.start] : [])
    void load()
  })
} })
let sequence = 0, controller: AbortController | null = null
function render() {
  const rows = displayAnalysisIntervals(full.value?.intervals ?? [])
  chart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => formatValue(value) }, legend: { data: labels.value },
    brush: { xAxisIndex: 0, brushMode: 'multiple', toolbox: ['lineX', 'clear'] },
    toolbox: { feature: { brush: { type: ['lineX', 'clear'], title: { lineX: '框选时段', clear: '清除框选' } } } },
    grid: { left: 65, right: 20, top: 45, bottom: 65 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0 }],
    xAxis: { type: 'category', data: rows.map(row => row ? timeLabel(row.start) : '缺资料时段') },
    yAxis: { type: 'value', name: topic.value === 'price' ? '元/MWh' : 'MWh' },
    series: [
      { name: labels.value[0], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row ? (topic.value === 'price' ? row.daPrice : row.baselineMwh) : null) },
      { name: labels.value[1], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row ? (topic.value === 'price' ? row.rtPrice : row.actualMwh) : null) },
    ],
  }, { replaceMerge: ['series'] })
}
function thresholds(): AnalysisThresholds {
  const value = threshold.value.trim() === '' ? undefined : Number(threshold.value)
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error('请输入非负的筛选门槛')
  return value === undefined ? {} : topic.value === 'price' ? { spreadYuan: value } : { absoluteMwh: value }
}
async function load(reset = false) {
  controller?.abort(); controller = new AbortController()
  const ticket = ++sequence
  loading.value = true; error.value = ''; current.value = null
  if (reset) { selected.value = []; full.value = null; render() }
  let filters: AnalysisThresholds
  try { filters = thresholds() } catch { error.value = '请输入非负的筛选门槛'; loading.value = false; return }
  try {
    const result = await previewTopicAnalysis(props.snapshot, basis.value, selected.value.length ? selected.value : undefined, filters, controller.signal)
    if (ticket !== sequence) return
    current.value = result
    if (!selected.value.length) { full.value = result; render() }
  } catch {
    if (ticket === sequence) error.value = '分析暂未完成，请检查资料与当前权限后重试。已有资料不会被修改。'
  } finally { if (ticket === sequence) loading.value = false }
}
function selectInterval(start: string) {
  selected.value = selected.value.includes(start) ? selected.value.filter(value => value !== start) : [...selected.value, start]
  void load()
}
async function capture() {
  if (!current.value || loading.value || capturing.value) return
  const ticket = sequence
  capturing.value = true; error.value = ''
  try {
    const material = await captureReportEvidence(props.snapshot, basis.value, selected.value.length ? [...selected.value] : undefined, thresholds(), topic.value)
    if (ticket === sequence) emit('material', material)
  } catch (e) { if (ticket === sequence) error.value = workpaperError(e) }
  finally { capturing.value = false }
}
watch([() => props.snapshot, basis], () => { void load(true) }, { immediate: true })
watch(topic, () => { threshold.value = ''; void load(true) })
watch(threshold, () => { void load(true) })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <section class="topic-analysis">
    <p>{{ snapshot.scope.day }} · {{ snapshot.scope.objectLabel }} <strong v-if="snapshot.simulated">模拟演练</strong></p>
    <div v-if="!activeTopic" class="controls" role="group" aria-label="分析主题"><button type="button" :aria-pressed="topic === 'energy'" @click="topic = 'energy'">电量偏差</button><button type="button" :aria-pressed="topic === 'price'" @click="topic = 'price'">价格与市场</button></div>
    <div class="controls">
      <label v-if="topic === 'energy'">比较基准 <select v-model="basis"><option v-for="key in basisOptions" :key="key" :value="key">{{ comparisonLabels[key].join('与') }}</option></select></label>
      <label>{{ topic === 'price' ? '价差门槛（元/MWh）' : '差异门槛（MWh）' }} <input v-model="threshold" type="number" min="0" step="any" placeholder="不限" /></label>
      <button type="button" @click="load()">重新统计</button><button type="button" :disabled="!current || loading || capturing" @click="capture">{{ capturing ? '正在保存材料…' : '保存材料并加入底稿' }}</button>
      <button v-if="selected.length" type="button" @click="selected = []; load()">清除选区</button>
    </div>
    <p v-if="loading" role="status">正在统计{{ selected.length ? `所选 ${selected.length} 个时段` : '完整资料范围' }}…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ReviewCallout v-if="snapshot.simulated" tone="mock">本次决策留存资料为模拟演练，统计与图表不代表真实业务。</ReviewCallout>
    <div v-if="current && topic === 'energy'" class="metric-grid">
      <MetricTile label="净差异" :value="formatValue(current.energy.netDeviationMwh)" unit="MWh" />
      <MetricTile label="绝对差异" :value="formatValue(current.energy.absoluteDeviationMwh)" unit="MWh" />
      <MetricTile label="绝对差异率" :value="formatValue(current.energy.absoluteDeviationPct)" unit="%" />
      <MetricTile label="可比较时长" :value="`${current.coverage.comparableMinutes} / ${current.coverage.expectedMinutes}`" unit="分钟" />
    </div>
    <div v-if="current && topic === 'price'" class="metric-grid"><MetricTile label="日前均价" :value="formatValue(current.prices.daAverage)" unit="元/MWh" :sub="`有价 ${current.prices.da?.minutes ?? 0} 分钟`" /><MetricTile label="实时均价" :value="formatValue(current.prices.rtAverage)" unit="元/MWh" :sub="`有价 ${current.prices.rt?.minutes ?? 0} 分钟`" /><MetricTile label="同口径日前减实时" :value="formatValue(current.prices.spreadAverage)" unit="元/MWh" :sub="`共同覆盖 ${current.prices.comparableMinutes} / ${current.coverage.expectedMinutes} 分钟`" /><MetricTile label="实时负价时长" :value="String(current.prices.rt?.negativeMinutes ?? 0)" unit="分钟" /></div>
    <div ref="chartEl" class="plot" role="img" :aria-label="`${labels.join('与')}分时对比图`" />
    <p>可用图右上角框选多个时段，也可在下方勾选。缩放只改变显示范围；选区会重新统计。</p>
    <ReviewCallout v-if="current && !(topic === 'price' ? current.prices.comparableMinutes : current.coverage.comparableMinutes)" tone="warn">当前基准缺少可比较资料，请选择其他基准或补充对应数据。缺失时段未按零计算。</ReviewCallout>
    <details v-if="segments.length"><summary>连续同向偏离（{{ segments.length }} 段）</summary><div class="interval-list"><button v-for="segment in segments" :key="segment.start" type="button" @click="selected = [...new Set([...selected, ...segment.starts])]; load()">{{ timeLabel(segment.start) }}—{{ timeLabel(segment.end) }} · {{ segment.minutes }} 分钟 · {{ topic === 'price' ? '平均价差' : '累计偏差' }} {{ formatValue(topic === 'price' ? segment.average : segment.total) }} {{ topic === 'price' ? '元/MWh' : 'MWh' }} · 加入选区</button></div></details>
    <details v-if="full"><summary>选择异常时段（{{ selected.length }} 项已选）</summary><div class="interval-list"><label v-for="row in anomalies" :key="row.start"><input type="checkbox" :checked="selected.includes(row.start)" @change="selectInterval(row.start)" />{{ timeLabel(row.start) }}—{{ timeLabel(row.end) }}　{{ topic === 'price' ? '价差' : '差异' }} {{ formatValue(topic === 'price' ? (row.daPrice ?? 0) - (row.rtPrice ?? 0) : row.differenceMwh) }} {{ topic === 'price' ? '元/MWh' : 'MWh' }}</label><p v-if="!anomalies.length">当前没有符合筛选条件的可比较时段。</p></div></details>
    <details v-if="current"><summary>计算口径与资料范围</summary><p>{{ current.methodology }}</p><p>{{ current.notice }}</p></details>
  </section>
</template>

<style scoped>
.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:12px 0}
.review-callout{margin:10px 0}
.topic-analysis{min-width:0}.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center}.controls label{display:flex;gap:8px;align-items:center}.plot{height:320px}p,summary,label,button,select,input{font-size:var(--font-sm)}p{color:var(--muted);line-height:1.7}button,select,input{font-family:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px}button,summary{cursor:pointer}details{padding:12px 0;border-top:1px solid var(--line)}.interval-list{max-height:240px;overflow:auto;display:grid;gap:8px;padding:12px 0}.interval-list label{display:flex;align-items:center;gap:8px}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:720px){.controls label{width:100%}.plot{height:260px}}
</style>
