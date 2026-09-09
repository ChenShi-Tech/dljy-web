<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { formatValue } from '@/services/review/decisionWorkbench'
import { comparisonLabels, previewTopicAnalysis, type ComparisonBasis, type TopicAnalysisResult } from '@/services/review/topicAnalysis'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'

const props = defineProps<{ snapshot: ReviewEvidenceSnapshot }>()
const basis = ref<ComparisonBasis>(props.snapshot.scope.objectKey.startsWith('order:') ? 'declared_cleared' : 'forecast_actual')
const full = ref<TopicAnalysisResult | null>(null), current = ref<TopicAnalysisResult | null>(null)
const selected = ref<string[]>([]), loading = ref(false), error = ref(''), threshold = ref('')
const chartEl = ref<HTMLElement | null>(null)
const labels = computed(() => comparisonLabels[basis.value])
const timeLabel = (time: string) => new Date(time).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
const chart = useEChart(chartEl, { render })
let sequence = 0, controller: AbortController | null = null
function render() {
  const rows = full.value?.intervals ?? []
  chart.setOption({
    tooltip: { trigger: 'axis' }, legend: { data: labels.value },
    grid: { left: 65, right: 20, top: 45, bottom: 65 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0 }],
    xAxis: { type: 'category', data: rows.map(row => timeLabel(row.start)) },
    yAxis: { type: 'value', name: 'MWh' },
    series: [
      { name: labels.value[0], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row.baselineMwh) },
      { name: labels.value[1], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row.actualMwh) },
    ],
  }, { replaceMerge: ['series'] })
}
async function load(reset = false) {
  controller?.abort(); controller = new AbortController()
  const ticket = ++sequence
  loading.value = true; error.value = ''; current.value = null
  if (reset) { selected.value = []; full.value = null; render() }
  const value = threshold.value.trim() === '' ? undefined : Number(threshold.value)
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) { error.value = '请输入非负的电量门槛'; loading.value = false; return }
  try {
    const result = await previewTopicAnalysis(props.snapshot, basis.value, selected.value.length ? selected.value : undefined, value === undefined ? {} : { absoluteMwh: value }, controller.signal)
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
watch([() => props.snapshot, basis], () => { void load(true) }, { immediate: true })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <section class="topic-analysis">
    <p>{{ snapshot.scope.day }} · {{ snapshot.scope.objectLabel }} <strong v-if="snapshot.simulated">模拟演练</strong></p>
    <div class="controls">
      <label>比较基准 <select v-model="basis"><option v-for="(names, key) in comparisonLabels" :key="key" :value="key">{{ names.join('与') }}</option></select></label>
      <label>差异门槛（MWh） <input v-model="threshold" type="number" min="0" step="any" placeholder="不限" /></label>
      <button type="button" @click="load()">重新统计</button>
      <button v-if="selected.length" type="button" @click="selected = []; load()">清除选区</button>
    </div>
    <p v-if="loading" role="status">正在统计{{ selected.length ? `所选 ${selected.length} 个时段` : '完整资料范围' }}…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="current" class="metrics">
      <span>净差异 <b>{{ formatValue(current.energy.netDeviationMwh) }} MWh</b></span>
      <span>绝对差异 <b>{{ formatValue(current.energy.absoluteDeviationMwh) }} MWh</b></span>
      <span>绝对差异率 <b>{{ formatValue(current.energy.absoluteDeviationPct) }}%</b></span>
      <span>可比较时长 <b>{{ current.coverage.comparableMinutes }} / {{ current.coverage.expectedMinutes }} 分钟</b></span>
    </div>
    <div ref="chartEl" class="plot" role="img" :aria-label="`${labels.join('与')}分时对比图`" />
    <p v-if="current && !current.coverage.comparableMinutes">当前基准缺少可比较资料，请选择其他基准或补充对应数据。缺失时段未按零计算。</p>
    <details v-if="full"><summary>选择异常时段（{{ selected.length }} 项已选）</summary><div class="interval-list"><label v-for="row in full.anomalies" :key="row.start"><input type="checkbox" :checked="selected.includes(row.start)" @change="selectInterval(row.start)" />{{ timeLabel(row.start) }}—{{ timeLabel(row.end) }}　差异 {{ formatValue(row.differenceMwh) }} MWh</label><p v-if="!full.anomalies.length">当前没有符合筛选条件的可比较时段。</p></div></details>
    <details v-if="current"><summary>计算口径与资料范围</summary><p>{{ current.methodology }}</p><p>{{ current.notice }}</p></details>
  </section>
</template>

<style scoped>
.topic-analysis{min-width:0}.controls,.metrics{display:flex;gap:16px;flex-wrap:wrap;align-items:center}.controls label{display:flex;gap:8px;align-items:center}.metrics{padding:16px 0}.metrics b{display:block;margin-top:6px}.plot{height:320px}p,summary,label,button,select,input{font-size:var(--font-sm)}p{color:var(--muted);line-height:1.7}button,select,input{font-family:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px}button,summary{cursor:pointer}details{padding:12px 0;border-top:1px solid var(--line)}.interval-list{max-height:240px;overflow:auto;display:grid;gap:8px;padding:12px 0}.interval-list label{display:flex;align-items:center;gap:8px}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:720px){.controls label{width:100%}.plot{height:260px}}
</style>
