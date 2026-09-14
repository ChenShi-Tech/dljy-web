<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { ApiError } from '@/services/api'
import { formatValue } from '@/services/review/decisionWorkbench'
import { fetchSettlementAnalysis, type SettlementAnalysis, type SettlementAnalysisInput } from '@/services/review/settlementAnalysis'
import { captureSettlementReportEvidence, type ReportEvidence } from '@/services/review/workpapers'
import type { SettlementSelection } from '@/services/review/reviewTopics'

const props = defineProps<{ company: string; region: string; date: string; companyLabel?: string; selection?: SettlementSelection }>()
const emit = defineEmits<{ material: [value: ReportEvidence]; selection: [value: SettlementSelection] }>()
const capturing = ref(false), lastInput = ref<SettlementAnalysisInput | null>(null)
const date = ref(props.selection?.date ?? props.date), cadence = ref<'day' | 'week' | 'month'>(props.selection?.cadence ?? 'day')
const manual = ref(props.selection?.manual ?? false), referenceStart = ref(props.selection?.referenceStart ?? ''), referenceEnd = ref(props.selection?.referenceEnd ?? '')
const plants = ref<string[]>([...(props.selection?.plants ?? [])]), availablePlants = ref<string[]>([])
watch([date, cadence, manual, referenceStart, referenceEnd, plants], () => emit('selection', { date: date.value, cadence: cadence.value, manual: manual.value, referenceStart: referenceStart.value, referenceEnd: referenceEnd.value, plants: [...plants.value] }), { deep: true })
const result = ref<SettlementAnalysis | null>(null), loading = ref(false), error = ref('')
const el = ref<HTMLElement | null>(null), chart = useEChart(el, { render })
let sequence = 0, controller: AbortController | null = null
function render() {
  const rows = result.value?.current.daily ?? []
  chart.setOption({ animation: false, tooltip: { trigger: 'axis' }, legend: { data: ['结算电量', '结算电费'] },
    grid: { left: 75, right: 80, top: 50, bottom: 65 },
    xAxis: { type: 'category', data: rows.map(row => row.date) },
    yAxis: [{ type: 'value', name: 'MWh' }, { type: 'value', name: '元' }],
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0 }],
    series: [{ name: '结算电量', type: 'bar', data: rows.map(row => row.energyMwh) }, { name: '结算电费', type: 'line', yAxisIndex: 1, connectNulls: false, data: rows.map(row => row.feeYuan) }],
  }, { replaceMerge: ['series'] })
}
function invalidate() { sequence++; controller?.abort(); loading.value = false; result.value = null; lastInput.value = null; error.value = ''; render() }
watch([date, cadence, manual, referenceStart, referenceEnd, () => props.company, () => props.region], () => { invalidate(); plants.value = []; availablePlants.value = [] })
watch(plants, invalidate, { flush: 'sync' })
async function load() {
  invalidate(); const ticket = sequence
  if (manual.value && (!referenceStart.value || !referenceEnd.value || referenceStart.value > referenceEnd.value)) { error.value = '请填写有效的参考期起止日期'; return }
  loading.value = true; controller = new AbortController()
  const input: SettlementAnalysisInput = { region: props.region, period: { date: date.value, cadence: cadence.value, asOf: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) }, ...(plants.value.length ? { plants: [...plants.value] } : {}), ...(manual.value ? { referencePeriod: { start: referenceStart.value, end: referenceEnd.value } } : {}) }
  try {
    const value = await fetchSettlementAnalysis(props.company, input, controller.signal)
    if (ticket !== sequence) return
    result.value = value; lastInput.value = input; availablePlants.value = value.availablePlants; render()
  } catch (e) {
    if (ticket === sequence) error.value = e instanceof ApiError && e.code === 404 ? '当前公司和地区尚未接入这类日结算资料。可通过统一数据维护补充。' : '结算统计未完成，请核对日期、资料状态和当前权限后重试。'
  } finally { if (ticket === sequence) loading.value = false }
}
async function capture() {
  if (!lastInput.value || capturing.value) return
  const ticket = sequence, input = JSON.parse(JSON.stringify(lastInput.value)) as SettlementAnalysisInput
  capturing.value = true; error.value = ''
  try { const material = await captureSettlementReportEvidence(props.company, input); if (ticket === sequence) emit('material', material) }
  catch { if (ticket === sequence) error.value = '材料未能保存，请检查资料服务与当前权限后重试。' }
  finally { capturing.value = false }
}
function choosePlant(plant: string) { plants.value = [plant]; void load() }
onMounted(() => { void load() })
onBeforeUnmount(() => { sequence++; controller?.abort() })
</script>

<template>
  <section class="settlement-analysis">
    <p>{{ companyLabel || '当前公司' }} · 公司周期复盘 · 结算与历史比较</p>
    <div class="controls"><label>周期<select v-model="cadence" aria-label="分析周期"><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label><label>日期<input v-model="date" type="date" aria-label="分析日期" /></label><label><input v-model="manual" type="checkbox" />指定参考期</label><template v-if="manual"><label>参考起日<input v-model="referenceStart" type="date" /></label><label>参考止日<input v-model="referenceEnd" type="date" /></label></template><button type="button" :disabled="loading" @click="load">{{ loading ? '正在统计…' : '重新统计' }}</button><button v-if="plants.length" type="button" @click="plants = []; load()">查看全部已入库厂站</button></div>
    <details v-if="availablePlants.length"><summary>选择厂站（未勾选表示全部已入库厂站）</summary><div class="plant-picker"><label v-for="plant in availablePlants" :key="plant"><input v-model="plants" type="checkbox" :value="plant" />{{ plant }}</label></div></details>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="result?.current.coverage.records" type="button" :disabled="capturing || loading" @click="capture">{{ capturing ? '正在保存材料…' : '保存材料并加入底稿' }}</button>
    <template v-if="result">
      <p>本期 {{ result.periods.current.start }}—{{ result.periods.current.end }} · 参考期 {{ result.periods.reference.start }}—{{ result.periods.reference.end }}<span v-if="result.periods.incomplete"> · 本期尚未结束</span></p>
      <div class="metrics"><span>结算电量<b>{{ formatValue(result.current.energyMwh) }} MWh</b><small>有效 {{ result.current.coverage.energy }} 条</small></span><span>结算电费<b>{{ formatValue(result.current.feeYuan) }} 元</b><small>有效 {{ result.current.coverage.fee }} 条</small></span><span>电量加权均价<b>{{ formatValue(result.current.averagePrice) }} 元/MWh</b><small>电量、电费齐全 {{ result.current.coverage.paired }} 条</small></span><span>资料覆盖<b>{{ result.current.coverage.records }} / {{ result.current.expectedPlantDays }} 厂站日</b><small>已入库范围 {{ result.selectedPlants.length }} 座</small></span></div>
      <p>中长期 {{ formatValue(result.current.longTermMwh) }} MWh（{{ result.current.coverage.longTerm }} 条） · 日前增量 {{ formatValue(result.current.dayAheadIncrementMwh) }} MWh（{{ result.current.coverage.dayAhead }} 条） · 实时增量 {{ formatValue(result.current.realTimeIncrementMwh) }} MWh（{{ result.current.coverage.realTime }} 条）。各项按有值记录汇总。</p>
    </template>
    <div ref="el" class="plot" role="img" aria-label="所选周期逐日结算电量与电费" />
    <template v-if="result">
      <h3>共同覆盖下的历史比较</h3><p>仅比较同厂站、相同日序且电量和电费均齐全的 {{ result.comparison.matchedPlantDays }} 个厂站日。</p>
      <div class="table-scroll"><table><thead><tr><th>指标</th><th>本期共同范围</th><th>参考期共同范围</th></tr></thead><tbody><tr><th>结算电量（MWh）</th><td>{{ formatValue(result.comparison.currentEnergyMwh) }}</td><td>{{ formatValue(result.comparison.referenceEnergyMwh) }}</td></tr><tr><th>结算电费（元）</th><td>{{ formatValue(result.comparison.currentFeeYuan) }}</td><td>{{ formatValue(result.comparison.referenceFeeYuan) }}</td></tr></tbody></table></div>
      <details><summary>厂站明细与下钻</summary><div class="table-scroll"><table><thead><tr><th>厂站</th><th>结算电量（MWh）</th><th>结算电费（元）</th><th>有效记录</th><th>分析</th></tr></thead><tbody><tr v-for="plant in result.current.plants" :key="plant.plant"><td>{{ plant.plant }}</td><td>{{ formatValue(plant.energyMwh) }}</td><td>{{ formatValue(plant.feeYuan) }}</td><td>{{ plant.coverage.records }}</td><td><button type="button" @click="choosePlant(plant.plant)">查看厂站</button></td></tr></tbody></table></div></details>
      <p v-if="!result.current.coverage.records">所选范围没有可用结算记录，缺失资料未按零统计。</p><details><summary>资料范围与计算口径</summary><p>{{ result.notice }}</p></details>
    </template>
  </section>
</template>
<style scoped>
.controls,.metrics,.plant-picker{display:flex;gap:16px;flex-wrap:wrap}.controls{align-items:center}.controls label{display:flex;align-items:center;gap:8px}.metrics{margin:18px 0}.metrics b,.metrics small{display:block;margin-top:6px}.plot{height:310px}p,small,summary{color:var(--muted);line-height:1.7}p,label,button,select,input,table{font-size:var(--font-sm)}button,select,input{font-family:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px}button,summary{cursor:pointer}details{padding:12px 0;border-top:1px solid var(--line)}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:10px;border-bottom:1px solid var(--line)}h3{font-size:var(--font-lg)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.plant-picker{margin-top:12px}.plant-picker label{display:flex;align-items:center;gap:6px}@media(max-width:700px){.controls label{width:100%}.plot{height:260px}}
</style>
