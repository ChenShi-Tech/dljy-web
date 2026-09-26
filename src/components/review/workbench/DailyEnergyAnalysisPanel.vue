<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { beijingDay } from '@/utils/beijingDate'
import { formatValue } from '@/services/review/decisionWorkbench'
import { dailyEnergySelectionFromQuery, type DailyEnergySelection, captureDailyEnergy, fetchDailyEnergy, type DailyEnergyAnalysis, type DailyEnergyInput } from '@/services/review/dailyEnergy'
import type { ReportEvidence } from '@/services/review/workpapers'
import ReviewCallout from './ReviewCallout.vue'
import MetricTile from '../MetricTile.vue'
const props = defineProps<{ company: string; region: string; date: string; selection?: DailyEnergySelection }>()
const emit = defineEmits<{ period: [value: { start: string; end: string } | null]; material: [value: ReportEvidence]; maintenance: []; selection: [value: DailyEnergySelection] }>()
const initial = props.selection ?? dailyEnergySelectionFromQuery({},props.date)
const periodDate = ref(initial.date), cadence = ref(initial.cadence), basis = ref(initial.basis), actual = ref(initial.actual)
const manual = ref(initial.manual), referenceStart = ref(initial.referenceStart), referenceEnd = ref(initial.referenceEnd), plants = ref<string[]>([...initial.plants]), availablePlants = ref<string[]>([]), days = ref<string[]>([...initial.days])
const result = ref<DailyEnergyAnalysis | null>(null), loading = ref(false), capturing = ref(false), error = ref(''), chartEl = ref<HTMLElement | null>(null)
watch(result, value => emit('period', value?.periods.current ?? null), { flush: 'sync' })

let generation = 0, controller: AbortController | null = null, completed: DailyEnergyInput | null = null
const chart = useEChart(chartEl, { render, onInit(instance) { instance.on('brushEnd', (event: unknown) => {
  const areas = (event as { areas?: Array<{ coordRange?: number[] }> }).areas ?? []
  days.value = (result.value?.daily ?? []).filter((_row,index) => areas.some(area => area.coordRange?.length === 2 && area.coordRange.every(Number.isFinite) && index >= Math.min(...area.coordRange) && index <= Math.max(...area.coordRange))).map(row => row.date)
  void load()
}) } })
function render() {
  const rows = result.value?.daily ?? [], labels = result.value?.labels ?? ['比较电量','实际电量']
  chart.setOption({ animation:false, tooltip:{trigger:'axis',valueFormatter:(value:unknown)=>formatValue(value)},legend:{data:labels},brush:{xAxisIndex:0,brushMode:'multiple',toolbox:['lineX','clear']},grid:{left:75,right:25,top:45,bottom:60},xAxis:{type:'category',data:rows.map(row=>row.date)},yAxis:{type:'value',name:'MWh'},series:labels.map((name,i)=>({name,type:'line',connectNulls:false,data:rows.map(row=>i?row.actualMwh:row.baselineMwh)})) },{replaceMerge:['series']})
}
function invalidate() { ++generation; controller?.abort(); result.value=null; completed=null; loading.value=false; error.value=''; render() }
watch([periodDate,cadence,manual,referenceStart,referenceEnd],()=>{invalidate();plants.value=[];availablePlants.value=[];days.value=[]},{flush:'sync'})
watch([basis,actual,plants],()=>{invalidate();days.value=[]},{flush:'sync'})
watch(()=>[props.company,props.region,props.date],(_next,previous)=>{if(previous?.length){invalidate();periodDate.value=props.date;plants.value=[];availablePlants.value=[];days.value=[]}void load()}, {immediate:true,flush:'post'})
watch([periodDate,cadence,basis,actual,manual,referenceStart,referenceEnd,plants,days],()=>emit('selection',{date:periodDate.value,cadence:cadence.value,basis:basis.value,actual:actual.value,manual:manual.value,referenceStart:referenceStart.value,referenceEnd:referenceEnd.value,plants:[...plants.value],days:[...days.value]}))
async function load() {
  const selectedDays=[...days.value];invalidate();const ticket=generation
  if(manual.value&&(!referenceStart.value||!referenceEnd.value||referenceStart.value>referenceEnd.value)){error.value='请填写有效的参考期';return}
  const input:DailyEnergyInput={region:props.region,period:{date:periodDate.value,cadence:cadence.value,asOf:beijingDay(0)},basis:basis.value,actual:actual.value,...(plants.value.length?{plants:[...plants.value]}:{}),...(selectedDays.length?{days:selectedDays}:{}),...(manual.value?{referencePeriod:{start:referenceStart.value,end:referenceEnd.value}}:{})}
  controller=new AbortController();loading.value=true
  try { const response=await fetchDailyEnergy(props.company,input,controller.signal);if(ticket!==generation)return;result.value=response;availablePlants.value=response.availablePlants;completed=input;render() }
  catch {if(ticket===generation)error.value='电量统计未完成，请核对资料接入、当前范围和访问权限后重试。'}
  finally {if(ticket===generation)loading.value=false}
}
async function capture(){if(!completed||capturing.value)return;const ticket=generation,input=structuredClone(completed);capturing.value=true;error.value='';try{const material=await captureDailyEnergy(props.company,input);if(ticket===generation)emit('material',material)}catch{if(ticket===generation)error.value='电量材料尚未保存，请重试。'}finally{capturing.value=false}}
function toggle(day:string){days.value=days.value.includes(day)?days.value.filter(value=>value!==day):[...days.value,day];void load()}
onBeforeUnmount(()=>{++generation;controller?.abort()})
</script>
<template>
<section class="daily-energy" aria-label="公司周期电量偏差">
  <div class="filters"><label>周期<select v-model="cadence"><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label><label>日期<input v-model="periodDate" type="date" /></label><label>比较基准<select v-model="basis"><option value="forecast">综合预测电量</option><option value="declared">日前申报电量</option></select></label><label>实际口径<select v-model="actual"><option value="market">市场电量</option><option value="generation">总发电量</option></select></label><label><input v-model="manual" type="checkbox" />指定参考期</label><template v-if="manual"><input v-model="referenceStart" type="date" aria-label="电量参考起日" /><input v-model="referenceEnd" type="date" aria-label="电量参考止日" /></template><button :disabled="loading" @click="load">重新统计</button><button @click="emit('maintenance')">维护电量资料</button></div>
  <details v-if="availablePlants.length"><summary>选择厂站（不选则统计资料中的全部厂站）</summary><div class="plants"><label v-for="plant in availablePlants" :key="plant"><input v-model="plants" type="checkbox" :value="plant" />{{plant}}</label></div></details>
  <p v-if="loading" role="status">正在统计电量…</p><p v-if="error" role="alert">{{error}}</p>
  <template v-if="result"><p>本期 {{result.periods.current.start}}—{{result.periods.current.end}} · 参考期 {{result.periods.reference.start}}—{{result.periods.reference.end}}</p>
    <div class="metric-grid"><MetricTile label="净偏差" :value="formatValue(result.current.netDeviationMwh)" unit="MWh" /><MetricTile label="逐厂站日绝对偏差" :value="formatValue(result.current.absoluteDeviationMwh)" unit="MWh" /><MetricTile label="绝对偏差率" :value="formatValue(result.current.absoluteDeviationPct)" unit="%" /><MetricTile label="可比较" :value="String(result.current.coverage.paired)" unit="厂站日" :sub="`完整周期应有 ${result.expectedPlantDays} 厂站日`" /><MetricTile label="本期绝对偏差（共同覆盖）" :value="formatValue(result.comparison.current.absoluteDeviationMwh)" unit="MWh" :sub="`共同 ${result.comparison.matchedPlantDays} 厂站日`" /><MetricTile label="参考期绝对偏差（共同覆盖）" :value="formatValue(result.comparison.reference.absoluteDeviationMwh)" unit="MWh" :sub="`共同 ${result.comparison.matchedPlantDays} 厂站日`" /></div>
    <ReviewCallout>当前范围读到 <b>{{result.current.coverage.records}}</b> 条，其中质量说明不明 {{result.current.coverage.unknownQuality}} 条、未纳入日报 {{result.current.coverage.excluded}} 条。两项电量都有效才计入偏差。</ReviewCallout>
    <ReviewCallout>{{result.notice}}</ReviewCallout>
    <p v-if="days.length">已选择 {{days.length}} 天；图表保留完整周期，统计及取材针对所选日期。</p>
    <div class="filters"><button :disabled="capturing||!result.current.coverage.paired" @click="capture">{{capturing?'正在保存…':'加入复盘底稿'}}</button><button v-if="days.length" @click="days=[];load()">清除日期选择</button></div>
    <details><summary>厂站偏差明细</summary><div class="table-scroll"><table><thead><tr><th>厂站</th><th>净偏差（MWh）</th><th>绝对偏差（MWh）</th><th>有效天数</th></tr></thead><tbody><tr v-for="row in result.plants" :key="row.plant"><th>{{row.plant}}</th><td>{{formatValue(row.netDeviationMwh)}}</td><td>{{formatValue(row.absoluteDeviationMwh)}}</td><td>{{row.coverage.paired}}</td></tr></tbody></table></div></details>
    <details v-if="result.exceptions.length"><summary>偏差日期（选中日期会统计所有所选厂站）</summary><div class="exceptions"><label v-for="row in result.exceptions" :key="`${row.plant}:${row.date}`"><input type="checkbox" :checked="days.includes(row.date)" @change="toggle(row.date)" />{{row.date}} · {{row.plant}} · {{formatValue(row.differenceMwh)}} MWh</label></div></details>
  </template>
  <div v-show="result" ref="chartEl" class="chart" />
</section>
</template>
<style scoped>
.daily-energy{display:grid;gap:14px;min-width:0}.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.filters,.plants{display:flex;gap:12px;align-items:center;flex-wrap:wrap}label{display:inline-flex;gap:6px;align-items:center}.chart{height:320px}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:right;border-bottom:1px solid var(--line)}th:first-child{text-align:left}.exceptions{display:grid;gap:8px;max-height:240px;overflow:auto}button,input,select{font:inherit;font-size:var(--font-sm);padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text)}button,summary{cursor:pointer}button:disabled{opacity:.5}p{margin:0;line-height:1.7;color:var(--muted)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
