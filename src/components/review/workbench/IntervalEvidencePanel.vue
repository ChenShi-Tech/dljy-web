<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { exportCsv } from '@/utils/exportCsv'
import { formatValue, finite, validCurve, type IntervalEvidence } from '@/services/review/decisionWorkbench'

const props = defineProps<{ points: IntervalEvidence[]; basis: 'order' | 'platform'; date: string; simulated: boolean; forecastCurve?: number[]; forecastAt?: string }>()
const emit = defineEmits<{ investigate: [label: string]; analyze: [label: string] }>()
const selected = ref(0)
const mode = ref<'energy' | 'price' | 'forecast'>('energy')
const forecastAvailable = computed(() => validCurve(props.forecastCurve))
const shownPoints = computed(() => mode.value === 'forecast' && forecastAvailable.value ? props.points.map(p => ({ ...p, delta: finite(p.declared) ? p.declared - props.forecastCurve![p.slot] : null })) : props.points)
const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render, initOpts: { renderer: 'svg' } })
const point = computed(() => shownPoints.value.find(p => p.slot === selected.value))
const ranked = computed(() => shownPoints.value.filter(p => finite(p.delta)).sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 5))
const priceAvailable = computed(() => props.points.some(p => finite(p.daPrice) || finite(p.rtPrice)))
const deltaLabel = computed(() => mode.value === 'forecast' ? '申报与预测之差' : props.basis === 'order' ? '出清与申报之差' : '实际与申报之差')
const comparable = computed(() => shownPoints.value.filter(p => finite(p.delta)).length)
const maximum = computed(() => Math.max(...shownPoints.value.map(p => Math.abs(p.delta ?? 0)), 1))
function render() {
  if (!chartEl.value) return
  const series = mode.value === 'price'
    ? [{ name: '日前电价', values: shownPoints.value.map(p => p.daPrice) }, { name: '实时电价', values: shownPoints.value.map(p => p.rtPrice) }]
    : mode.value === 'forecast' ? [{ name: '留存预测电量', values: props.forecastCurve! }, { name: '申报电量', values: shownPoints.value.map(p => p.declared) }]
    : [{ name: '申报电量', values: shownPoints.value.map(p => p.declared) }, { name: props.basis === 'order' ? '出清电量' : '平台实时电量', values: shownPoints.value.map(p => props.basis === 'order' ? p.cleared : p.actual) }]
  chart.setOption({
    color: ['#5268aa', '#c25c38'], animation: false,
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${formatValue(value)} ${mode.value === 'price' ? '元/MWh' : 'MWh'}` },
    legend: { bottom: 0 }, grid: { left: 65, right: 20, top: 36, bottom: 62 },
    xAxis: { type: 'category', boundaryGap: false, data: shownPoints.value.map(p => p.label) },
    yAxis: { type: 'value', name: mode.value === 'price' ? '元/MWh' : 'MWh / 15分钟', scale: true },
    dataZoom: [{ type: 'inside', filterMode: 'none' }],
    series: series.map(s => ({ name: s.name, data: s.values, type: 'line', step: 'end', symbolSize: 5, showSymbol: false, connectNulls: false, smooth: false }))
  }, true)
  const instance = chart.instance()
  instance?.off('click')
  instance?.on('click', (event: unknown) => {
    const i = (event as { dataIndex?: number }).dataIndex
    if (typeof i === 'number' && props.points[i]) selected.value = props.points[i].slot
  })
}
watch(() => props.points, () => { selected.value = ranked.value[0]?.slot ?? 0; if (mode.value === 'price' && !priceAvailable.value || mode.value === 'forecast' && !forecastAvailable.value) mode.value = 'energy'; render() }, { immediate: true, flush: 'post' })
watch([chartEl, mode], render, { flush: 'post' })
function download() {
  exportCsv(`分时核验-${props.date}.csv`, ['时间', '留存预测电量（MWh）', '申报电量（MWh）', '出清电量（MWh）', '平台实时电量（MWh）', `${deltaLabel.value}（MWh）`, '日前电价（元/MWh）', '实时电价（元/MWh）', '资料性质'],
    shownPoints.value.map(p => [p.label, forecastAvailable.value ? props.forecastCurve![p.slot] : '', p.declared ?? '', p.cleared ?? '', p.actual ?? '', p.delta ?? '', p.daPrice ?? '', p.rtPrice ?? '', props.simulated ? '模拟数据' : props.basis === 'order' ? '申报单留存记录；未与结算电量匹配' : '平台回放；非正式结算依据']))
}
</script>

<template>
  <section class="evidence panel">
    <header><div><h2>分时核验</h2><p>{{ basis === 'order' ? '对照这笔申报的出清结果，定位需要解释的时段。' : '按平台实时电量口径核查当日偏差；不作为正式结算或考核结论。' }}</p></div><button type="button" @click="download">导出明细</button></header>
    <div v-if="simulated" class="notice">模拟数据 · 仅供流程演练</div>
    <div class="view-switch"><span>可比较 {{ comparable }} / 96 个时段</span><div><button v-if="forecastAvailable" type="button" :aria-pressed="mode === 'forecast'" @click="mode = 'forecast'">预测与申报</button><button type="button" :aria-pressed="mode === 'energy'" @click="mode = 'energy'">{{ basis === 'order' ? '申报与出清' : '申报与实际' }}</button><button v-if="priceAvailable" type="button" :aria-pressed="mode === 'price'" @click="mode = 'price'">电价</button></div></div>
    <div ref="chartEl" class="plot" role="img" :aria-label="mode === 'price' ? '日前与实时电价曲线，下方可打开明细表' : '申报与结果电量曲线，下方可选择时段或打开明细表'" />
    <div class="heat" aria-label="按时段定位偏差">
      <button v-for="p in shownPoints" :key="p.slot" type="button" :aria-label="`${p.label}，${deltaLabel} ${formatValue(p.delta)} MWh`" :aria-pressed="selected === p.slot" :title="`${p.label} · ${formatValue(p.delta)} MWh`" :class="{ positive: p.delta !== null && p.delta > 0, negative: p.delta !== null && p.delta < 0, missing: p.delta === null, selected: selected === p.slot }" :style="{ '--strength': p.delta === null ? 0 : Math.max(0.2, Math.abs(p.delta) / maximum) }" @click="selected = p.slot" />
    </div>
    <div class="heat-caption"><span>00:00</span><span>{{ mode === 'forecast' ? '暖色：上调申报 · 蓝色：下调申报 · 灰色：未能比较' : '暖色：结果较高 · 蓝色：结果较低 · 灰色：未能比较' }}</span><span>23:45</span></div>
    <div v-if="point" class="selection">
      <b>{{ point.label }}</b><span v-if="mode === 'forecast'">留存预测 {{ formatValue(forecastCurve?.[point.slot]) }} MWh</span><span>申报 {{ formatValue(point.declared) }} MWh</span><span>{{ basis === 'order' ? '出清' : '平台实时' }} {{ formatValue(basis === 'order' ? point.cleared : point.actual) }} MWh</span><strong>差额 {{ formatValue(point.delta) }} MWh</strong><button type="button" @click="emit('analyze', point.label)">分析此时段</button><button type="button" @click="emit('investigate', point.label)">带入改进记录</button>
    </div>
    <div v-if="ranked.length" class="ranked"><span>差额较大的时段</span><button v-for="p in ranked" :key="p.slot" type="button" @click="selected = p.slot">{{ p.label }} · {{ formatValue(p.delta) }} MWh</button></div>
    <p v-if="mode === 'forecast'" class="notice">预测采用本单留存曲线，留存时点：{{ forecastAt || '未核实' }}。差额不等于预测误差或人工贡献，尚未证明该版本在提交前可见。</p>
    <p v-if="basis === 'order'" class="notice">实际电量尚未与这笔申报逐时段关联，暂不计算执行偏差、考核费用或交易收益。</p>
    <details><summary>查看全部时段</summary><div class="table-wrap"><table><thead><tr><th>时间</th><th v-if="mode === 'forecast'">留存预测（MWh）</th><th>申报电量（MWh）</th><th>{{ basis === 'order' ? '出清电量' : '平台实时电量' }}（MWh）</th><th>差额（MWh）</th><th v-if="priceAvailable">日前电价</th><th v-if="priceAvailable">实时电价</th></tr></thead><tbody><tr v-for="p in shownPoints" :key="p.slot" :class="{ active: selected === p.slot }"><td><button type="button" @click="selected = p.slot">{{ p.label }}</button></td><td v-if="mode === 'forecast'">{{ formatValue(forecastCurve?.[p.slot]) }}</td><td>{{ formatValue(p.declared) }}</td><td>{{ formatValue(basis === 'order' ? p.cleared : p.actual) }}</td><td>{{ formatValue(p.delta) }}</td><td v-if="priceAvailable">{{ formatValue(p.daPrice) }}</td><td v-if="priceAvailable">{{ formatValue(p.rtPrice) }}</td></tr></tbody></table></div></details>
  </section>
</template>

<style scoped>
.evidence { padding: 18px; min-width: 0; } header, .view-switch, .selection, .ranked { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } header { justify-content: space-between; } h2 { margin: 0; font-size: var(--font-lg); } p { color: var(--muted); font-size: var(--font-sm); line-height: 1.65; } button { font: inherit; font-size: var(--font-sm); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 6px 10px; cursor: pointer; } button:hover, button[aria-pressed=true] { color: var(--primary); border-color: var(--primary); } button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; } .view-switch { justify-content: space-between; color: var(--muted); font-size: var(--font-sm); } .plot { height: 260px; width: 100%; } .heat { display: grid; grid-template-columns: repeat(96, minmax(0, 1fr)); gap: 2px; margin-top: 8px; } .heat button { height: 26px; padding: 0; border: 0; border-radius: 2px; background: var(--line); } .heat .positive { background: color-mix(in srgb, #c25c38 calc(var(--strength) * 100%), var(--panel)); } .heat .negative { background: color-mix(in srgb, #5268aa calc(var(--strength) * 100%), var(--panel)); } .heat .selected { outline: 2px solid var(--text); outline-offset: 2px; } .heat-caption { display: flex; justify-content: space-between; margin: 8px 0 16px; color: var(--muted); font-size: var(--font-xs); gap: 8px; } .selection { padding: 12px; border-radius: 8px; background: var(--panel-sub); font-size: var(--font-sm); } .selection button { margin-left: auto; } .ranked { margin-top: 12px; font-size: var(--font-sm); } .notice { padding: 10px 12px; background: var(--panel-sub); border-radius: 6px; color: var(--muted); font-size: var(--font-sm); } details { margin-top: 14px; } summary { cursor: pointer; font-size: var(--font-sm); } .table-wrap { overflow: auto; max-height: 320px; margin-top: 12px; } table { border-collapse: collapse; width: 100%; font-size: var(--font-sm); font-variant-numeric: tabular-nums; } th, td { text-align: right; padding: 8px; white-space: nowrap; border-bottom: 1px solid var(--line); } th:first-child, td:first-child { text-align: left; } tr.active { background: var(--primary-tint); } @media(max-width: 600px) { .heat { grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 4px; } .heat button { height: 30px; } .heat-caption span:nth-child(2) { max-width: 65%; } .selection button { margin-left: 0; } }
</style>
