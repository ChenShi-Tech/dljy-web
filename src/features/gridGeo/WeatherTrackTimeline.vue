<script setup lang="ts">
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Pause, Play, RadioTower, ShieldCheck } from 'lucide-vue-next'
import { weatherPointEvidenceTitle, type WeatherTrack, type WeatherTrackId } from './weatherTracks'

type OutputSource = { sourceType?: string; basis?: string; mock?: boolean; matchedRows?: number; targetSource?: string; targetKind?: string }
type PriceSource = { sourceType?: string; basis?: string; mock?: boolean; daPoints?: number; rtPoints?: number }
type RiskSource = { sourceType?: string; basis?: string; mock?: boolean; formula?: string }

const props = defineProps<{
  tracks: WeatherTrack[]
  modelValue: WeatherTrackId
  hour: number
  date: string
  driverLabel: string
  actualOutput: Array<number | null>
  targetOutput: Array<number | null>
  targetOutputLabel: string
  dayAheadPrice: Array<number | null>
  realtimePrice: Array<number | null>
  riskExposure: Array<number | null>
  outputSource: OutputSource
  priceSource: PriceSource
  riskSource: RiskSource
}>()
const emit = defineEmits<{
  'update:modelValue': [value: WeatherTrackId]
  'update:hour': [value: number]
}>()

const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let playbackTimer: ReturnType<typeof setInterval> | null = null
const playing = ref(false)
const activeTrack = computed(() => props.tracks.find((track) => track.id === props.modelValue) ?? props.tracks.at(-1) ?? null)
const activePoint = computed(() => activeTrack.value?.points[props.hour] ?? null)
const visibleTargetOutput = computed(() => activeTrack.value?.id === 'actual' ? props.targetOutput : props.targetOutput.map(() => null))
const selectedHour = computed(() => `${String(props.hour).padStart(2, '0')}:00`)
const pointEvidenceTitle = computed(() => {
  if (!activeTrack.value || !activePoint.value) return ''
  return weatherPointEvidenceTitle(activeTrack.value.id, activePoint.value.status)
})

function formatValue(value: number | null | undefined, suffix = '') {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}${suffix}`
}

function sourceLabel(value: unknown) {
  return String(value || 'NOT_COLLECTED')
}

function cursorMarkLine() {
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: 'rgba(255,255,255,.34)', type: 'dashed' as const, width: 1 },
    label: { show: false },
    data: [{ xAxis: selectedHour.value }],
  }
}

function renderChart() {
  if (!chartEl.value || !activeTrack.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
  const xAxis = [0, 1, 2, 3].map((gridIndex) => ({
    type: 'category' as const,
    gridIndex,
    data: hours,
    boundaryGap: false,
    axisLine: { lineStyle: { color: '#26495a' } },
    axisTick: { show: false },
    axisLabel: { show: gridIndex === 3, color: '#628291', fontSize: 9, interval: 5 },
    splitLine: { show: true, lineStyle: { color: 'rgba(88,139,158,.08)' } },
  }))
  const axis = (gridIndex: number, name: string, color: string) => ({
    type: 'value' as const,
    gridIndex,
    name,
    nameTextStyle: { color, fontSize: 9, padding: [0, 0, 0, 8] },
    axisLabel: { color: '#628291', fontSize: 8 },
    axisLine: { show: false }, axisTick: { show: false },
    splitLine: { lineStyle: { color: 'rgba(88,139,158,.09)', type: 'dashed' as const } },
    scale: true,
  })
  const line = (name: string, data: Array<number | null>, color: string, xAxisIndex: number, options: Record<string, unknown> = {}) => ({
    name, type: 'line' as const, data, xAxisIndex, yAxisIndex: xAxisIndex,
    showSymbol: false, smooth: false, connectNulls: false,
    lineStyle: { width: 1.8, color }, itemStyle: { color }, emphasis: { focus: 'series' as const },
    ...options,
  })
  chart.setOption({
    animation: !reducedMotion,
    color: ['#5edfff', '#6ce2a9', '#8da4ff', '#f3c86a', '#ff936b', '#ff6685'],
    tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(3,17,29,.96)', borderColor: '#315d70', textStyle: { color: '#dff7ff', fontSize: 10 } },
    legend: [
      { top: 0, left: 72, textStyle: { color: '#789aa7', fontSize: 9 }, data: [activeTrack.value.label] },
      { top: 104, left: 72, textStyle: { color: '#789aa7', fontSize: 9 }, data: ['实际出力', props.targetOutputLabel] },
      { top: 208, left: 72, textStyle: { color: '#789aa7', fontSize: 9 }, data: ['日前节点价', '实时节点价'] },
      { top: 312, left: 72, textStyle: { color: '#789aa7', fontSize: 9 }, data: ['事后偏差暴露'] },
    ],
    grid: [
      { top: 26, height: 58, left: 58, right: 18 },
      { top: 130, height: 58, left: 58, right: 18 },
      { top: 234, height: 58, left: 58, right: 18 },
      { top: 338, height: 58, left: 58, right: 18 },
    ],
    xAxis,
    yAxis: [axis(0, props.driverLabel, '#5edfff'), axis(1, 'MW', '#6ce2a9'), axis(2, '元/MWh', '#f3c86a'), axis(3, '%', '#ff6685')],
    series: [
      line(activeTrack.value.label, activeTrack.value.values, '#5edfff', 0, {
        lineStyle: { width: 2, color: '#5edfff', type: activeTrack.value.id === 'actual' ? 'solid' : 'dashed' },
        markLine: cursorMarkLine(),
      }),
      line('实际出力', props.actualOutput, '#6ce2a9', 1, { step: 'end', markLine: cursorMarkLine() }),
      line(props.targetOutputLabel, visibleTargetOutput.value, '#8da4ff', 1, { step: 'end', lineStyle: { width: 1.8, color: '#8da4ff', type: 'dashed' } }),
      line('日前节点价', props.dayAheadPrice, '#f3c86a', 2, { step: 'end', lineStyle: { width: 1.6, color: '#f3c86a', type: 'dashed' }, markLine: cursorMarkLine() }),
      line('实时节点价', props.realtimePrice, '#ff936b', 2, { step: 'end' }),
      {
        name: '事后偏差暴露', type: 'bar', data: props.riskExposure, xAxisIndex: 3, yAxisIndex: 3,
        itemStyle: { color: '#ff6685', opacity: .74 }, barMaxWidth: 13, markLine: cursorMarkLine(),
      },
    ],
  }, { notMerge: true })
}

function stopPlayback() {
  if (playbackTimer) clearInterval(playbackTimer)
  playbackTimer = null
  playing.value = false
}

function togglePlayback() {
  if (playbackTimer) return stopPlayback()
  if (reducedMotion) return
  playing.value = true
  playbackTimer = setInterval(() => emit('update:hour', (props.hour + 1) % 24), 900)
}

function selectTrack(trackId: WeatherTrackId) {
  stopPlayback()
  emit('update:modelValue', trackId)
}

function updateHour(event: Event) {
  stopPlayback()
  emit('update:hour', Number((event.target as HTMLInputElement).value))
}

onMounted(() => {
  void nextTick(renderChart)
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})
watch(() => [props.modelValue, props.hour, props.tracks, props.actualOutput, props.targetOutput, props.dayAheadPrice, props.realtimePrice, props.riskExposure], () => void nextTick(renderChart), { deep: true })
onBeforeUnmount(() => { stopPlayback(); resizeObserver?.disconnect(); chart?.dispose(); chart = null })
</script>

<template>
  <section class="track-rail" aria-label="气象决策时点轨道">
    <button
      v-for="track in tracks" :key="track.id" type="button"
      :class="[{ active: modelValue === track.id }, track.status]"
      :aria-pressed="modelValue === track.id"
      @click="selectTrack(track.id)"
    >
      <span><i />{{ track.eyebrow }}</span><b>{{ track.label }}</b>
      <small v-if="track.status === 'unavailable'">UNAVAILABLE · 数据未采集</small>
      <small v-else>{{ track.availableHours }}/{{ track.expectedHours }} 小时 · {{ track.status === 'partial' ? '存在空段' : '已就绪' }}</small>
    </button>
  </section>

  <section v-if="activeTrack" class="timeline-card" :class="activeTrack.status">
    <div class="card-head">
      <span><RadioTower :size="14" />{{ activeTrack.label }} · {{ date }}</span>
      <small>决策截止 {{ activeTrack.decisionAt || '不适用（结果轨）' }}</small>
    </div>
    <div class="chart" ref="chartEl" role="img" :aria-label="`${activeTrack.label}气象、出力、节点价格与偏差风险统一时间轴`" />
    <div class="playback">
      <button type="button" :disabled="reducedMotion" :aria-label="playing ? '暂停时间轴' : '播放时间轴'" @click="togglePlayback"><Pause v-if="playing" :size="13" /><Play v-else :size="13" /></button>
      <input :value="hour" type="range" min="0" max="23" step="1" aria-label="选择小时" @input="updateHour" />
      <b>{{ selectedHour }}</b><small v-if="reducedMotion">已遵循减少动态效果</small>
    </div>
    <div class="hour-focus">
      <article><small>{{ activeTrack.label }} · {{ driverLabel }}</small><b>{{ formatValue(activeTrack.values[hour]) }}</b></article>
      <article><small>实现后实际出力</small><b>{{ formatValue(actualOutput[hour], ' MW') }}</b></article>
      <article><small>{{ targetOutputLabel }}</small><b>{{ formatValue(visibleTargetOutput[hour], ' MW') }}</b></article>
      <article><small>实现后实时节点价</small><b>{{ formatValue(realtimePrice[hour], ' 元/MWh') }}</b></article>
      <article><small>事后偏差暴露</small><b>{{ formatValue(riskExposure[hour], '%') }}</b></article>
    </div>
    <div v-if="activePoint" class="point-evidence" :class="activePoint.status">
      <RadioTower v-if="activeTrack.id === 'actual'" :size="15" />
      <AlertTriangle v-else-if="activePoint.status !== 'available'" :size="15" />
      <ShieldCheck v-else :size="15" />
      <div>
        <b>{{ pointEvidenceTitle }}</b>
        <p>{{ activePoint.reason }}</p>
        <small>sourceType={{ activePoint.sourceType }} · basis={{ activePoint.basis }} · forecastAt={{ activePoint.forecastAt || 'N/A' }} · validAt={{ activePoint.validAt }} · ingestedAt={{ activePoint.ingestedAt || 'N/A' }} · sourceRef={{ activePoint.sourceRef || 'N/A' }}</small>
        <small>provider={{ activePoint.provider || 'N/A' }} · modelVersion={{ activePoint.modelVersion || 'N/A' }} · featureVersion={{ activePoint.featureVersion || 'N/A' }}</small>
      </div>
    </div>
  </section>

  <section v-if="activeTrack" class="truth-grid" aria-label="序列来源与可得性">
    <article><b>{{ activeTrack.label }}</b><small>sourceType={{ activeTrack.sourceType }} · basis={{ activeTrack.basis }}</small><em>as-of={{ activeTrack.decisionAt || 'N/A（实况结果）' }} · {{ activeTrack.status }}</em></article>
    <article><b>实际出力</b><small>sourceType={{ sourceLabel(outputSource.sourceType) }} · basis={{ sourceLabel(outputSource.basis) }}</small><em>as-of=实现后结果 · {{ outputSource.matchedRows ? 'available' : 'missing' }}</em></article>
    <article><b>{{ targetOutputLabel }}</b><small>sourceType={{ sourceLabel(outputSource.sourceType) }} · basis={{ sourceLabel(outputSource.basis) }}</small><em v-if="activeTrack.id === 'actual'">as-of=发行时点未登记，仅在结果轨作事后对照 · {{ targetOutput.some((value) => value !== null) ? 'available' : 'missing' }}</em><em v-else>as-of=发行时点未登记 · withheld（决策快照拒绝显示）</em></article>
    <article><b>日前 / 实时节点价</b><small>sourceType={{ sourceLabel(priceSource.sourceType) }} · basis={{ sourceLabel(priceSource.basis) }}</small><em>as-of=实现后结果 · {{ priceSource.daPoints || priceSource.rtPoints ? 'available' : 'missing' }}</em></article>
    <article><b>事后偏差暴露</b><small>sourceType={{ sourceLabel(riskSource.sourceType) }} · basis={{ sourceLabel(riskSource.basis) }}</small><em>as-of=实现后派生 · {{ riskExposure.some((value) => value !== null) ? 'available' : 'missing' }}</em></article>
  </section>

  <section v-if="activeTrack" class="divergence-card" :class="activeTrack.divergence.status">
    <div><span><ShieldCheck :size="14" /> SOURCE DIVERGENCE</span><b>{{ activeTrack.divergence.status === 'available' ? `多源平均差 ${formatValue(activeTrack.divergence.meanSpread)}` : '暂无可比多源预报' }}</b></div>
    <p>{{ activeTrack.divergence.reason }}<template v-if="activeTrack.divergence.comparedHours"> · 对齐 {{ activeTrack.divergence.comparedHours }} 小时</template></p>
    <small>Provider：{{ activeTrack.providers.join(' / ') || '未配置' }} · latest forecastAt {{ activeTrack.forecastAt || '—' }}</small>
  </section>
</template>

<style scoped>
.track-rail{display:grid;margin-bottom:9px;grid-template-columns:repeat(4,1fr);gap:6px}.track-rail button{display:flex;min-width:0;padding:8px 9px;text-align:left;color:#7194a1;border:1px solid rgba(92,166,190,.13);border-radius:9px;background:rgba(5,25,39,.68);cursor:pointer;transition:transform .18s ease,border-color .18s ease,background .18s ease;flex-direction:column}.track-rail button:hover{transform:translateY(-1px);border-color:rgba(95,215,244,.3)}.track-rail button.active{color:#dff9ff;border-color:rgba(95,220,245,.52);background:linear-gradient(145deg,rgba(18,76,96,.68),rgba(6,28,43,.9));box-shadow:0 10px 28px rgba(0,8,17,.26),inset 0 1px rgba(255,255,255,.04)}.track-rail button.unavailable,.track-rail button.partial{border-style:dashed}.track-rail button>span{display:flex;align-items:center;gap:5px;color:#547987;font-size:14px;letter-spacing:.12em}.track-rail button>span i{width:5px;height:5px;border-radius:50%;background:#516d78}.track-rail button.available>span i{background:#58e1b5;box-shadow:0 0 9px rgba(88,225,181,.65)}.track-rail button.partial>span i{background:#e6b85c}.track-rail button b{margin-top:4px;font-size:14px}.track-rail button small{margin-top:2px;overflow:hidden;color:#52727f;font-size:6.5px;text-overflow:ellipsis;white-space:nowrap}
.timeline-card{margin-top:10px;padding:11px;border:1px solid rgba(85,180,210,.13);border-radius:10px;background:rgba(4,19,32,.68)}.timeline-card.unavailable,.timeline-card.partial{border-style:dashed}.card-head{display:flex;align-items:center;justify-content:space-between;color:#b3dce7;font-size:14px}.card-head>span{display:flex;align-items:center;gap:5px}.card-head small{color:#5c7e8b;font-size:14px}.chart{width:100%;height:420px;margin-top:6px}.playback{display:flex;margin-top:5px;align-items:center;gap:8px}.playback button{display:grid;width:27px;height:27px;place-items:center;color:#081923;border:0;border-radius:50%;background:#62dcf4;cursor:pointer}.playback button:disabled{opacity:.45;cursor:not-allowed}.playback input{min-width:80px;flex:1;accent-color:#62dcf4}.playback b{min-width:37px;color:#d9f7ff;font-size:14px}.playback small{color:#5b7c88;font-size:6.5px}.hour-focus{display:grid;margin-top:8px;grid-template-columns:repeat(5,1fr);gap:6px}.hour-focus article{display:flex;padding:7px;border-radius:7px;background:rgba(22,73,91,.13);flex-direction:column}.hour-focus small{color:#5a7c88;font-size:6.5px}.hour-focus b{margin-top:2px;font-size:14px}
.point-evidence{display:flex;margin-top:8px;padding:8px;align-items:flex-start;gap:8px;color:#5ad8ad;border:1px solid rgba(90,216,173,.19);border-radius:8px;background:rgba(29,91,72,.08)}.point-evidence.missing{color:#efbd63;border-color:rgba(239,189,99,.2);background:rgba(112,77,20,.08)}.point-evidence.outside-forecast-horizon{color:#7197a5;border-color:rgba(113,151,165,.2);background:rgba(65,93,105,.08)}.point-evidence div{min-width:0}.point-evidence b{font-size:14px}.point-evidence p{margin:2px 0;color:#7d9aa5;font-size:14px}.point-evidence small{display:block;overflow-wrap:anywhere;color:#587984;font-size:6.5px}
.truth-grid{display:grid;margin-top:8px;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.truth-grid article{display:flex;min-width:0;padding:8px;border:1px solid rgba(88,169,194,.12);border-radius:8px;background:rgba(5,24,37,.58);flex-direction:column}.truth-grid b{font-size:7.5px}.truth-grid small,.truth-grid em{margin-top:3px;overflow-wrap:anywhere;color:#5d7e8b;font-size:6.2px;font-style:normal;line-height:1.35}.truth-grid em{color:#7496a2}
.divergence-card{display:grid;margin-top:8px;padding:9px;border:1px solid rgba(96,197,221,.13);border-radius:9px;background:linear-gradient(120deg,rgba(14,51,67,.55),rgba(5,23,36,.62));grid-template-columns:auto 1fr;gap:3px 12px}.divergence-card>div{display:flex;min-width:170px;flex-direction:column;grid-row:1/3}.divergence-card span{display:flex;align-items:center;gap:5px;color:#55cbe6;font-size:14px;letter-spacing:.12em}.divergence-card b{margin-top:4px;font-size:14px}.divergence-card p,.divergence-card small{margin:0;color:#658793;font-size:14px;line-height:1.4}.divergence-card.available{border-color:rgba(92,224,181,.23)}.track-rail button:focus-visible,.playback button:focus-visible{outline:2px solid #69e2f7;outline-offset:2px}
@media(max-width:900px){.hour-focus,.truth-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){.track-rail{overflow-x:auto;grid-template-columns:repeat(4,minmax(140px,1fr));scroll-snap-type:x mandatory}.track-rail button{scroll-snap-align:start}.hour-focus,.truth-grid{grid-template-columns:1fr}.chart{height:380px}.divergence-card{grid-template-columns:1fr}.divergence-card>div{grid-row:auto}.card-head{align-items:flex-start;gap:6px;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.track-rail button{transition:none}}
</style>
