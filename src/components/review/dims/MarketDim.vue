<script setup lang="ts">
// 市场维（#2038）：本日日前 vs 实时价格（96 点阶梯线 + 价差填充）与均价/峰谷/价差统计。
// 价格随 quant /review 的 detail 下发（后端按 datetime 对齐 da_price/rt_price）；缺价日诚实空态。
import { computed, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import type { ReviewResult } from '@/services/quant/quantClient'
import { priceStats } from '@/services/review/reviewDashboard'
import MetricTile from '../MetricTile.vue'
import MarketAttributionPanel from '../MarketAttributionPanel.vue'
import TemplateChips from '../TemplateChips.vue'
import type { TemplateCard } from '@/services/review/cockpitModel'

const props = defineProps<{ result: ReviewResult | null; templates: TemplateCard[] }>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()

const stats = computed(() => (props.result ? priceStats(props.result.detail) : null))
const spreadTone = computed(() => (stats.value ? (stats.value.spread >= 0 ? 'good' : 'bad') : 'muted'))
const fmt1 = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })

const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render })

function render() {
  const r = props.result
  if (!r || !chartEl.value) return
  const pts = r.detail
  const da = pts.map((p) => p.da_price ?? null)
  const rt = pts.map((p) => p.rt_price ?? null)
  const daColor = cssVar('--primary') || '#0f766e'
  const rtColor = cssVar('--accent') || '#2563eb'
  chart.setOption({
    ...emptyOverlay(!stats.value, '本日无日前/实时价格'),
    tooltip: axisTooltip({ unit: '元/MWh' }),
    legend: { data: ['日前价', '实时价'], top: 0, right: 100 },
    toolbox: chartToolbox('日前vs实时价格'),
    grid: { left: 56, right: 16, top: 30, bottom: 26 },
    dataZoom: insideZoom(),
    xAxis: { type: 'category', data: pts.map((p) => String(p.datetime).slice(-5)) },
    yAxis: { type: 'value', name: '元/MWh', scale: true },
    series: [
      // 出清价按时段恒定→阶梯线；两条都是实线（都是出清结果，不是预测）
      { name: '日前价', type: 'line', step: 'end', showSymbol: false, data: da, lineStyle: { width: 1.8, color: daColor }, itemStyle: { color: daColor } },
      { name: '实时价', type: 'line', step: 'end', showSymbol: false, data: rt, lineStyle: { width: 1.5, color: rtColor }, itemStyle: { color: rtColor } }
    ]
  }, { replaceMerge: ['graphic', 'series'] })
}
onMounted(render)
watch(() => props.result, () => render(), { flush: 'post' })
</script>

<template>
  <div class="dim">
    <div class="tiles">
      <MetricTile label="日前均价" :value="stats ? fmt1(stats.daAvg) : '—'" :unit="stats ? '元/MWh' : ''" :sub="stats ? `峰 ${fmt1(stats.daPeak)} · 谷 ${fmt1(stats.daValley)}` : ''" />
      <MetricTile label="实时均价" :value="stats ? fmt1(stats.rtAvg) : '—'" :unit="stats ? '元/MWh' : ''" :sub="stats ? `峰 ${fmt1(stats.rtPeak)} · 谷 ${fmt1(stats.rtValley)}` : ''" />
      <MetricTile label="日前 − 实时" :value="stats ? `${stats.spread > 0 ? '+' : ''}${fmt1(stats.spread)}` : '—'" :unit="stats ? '元/MWh' : ''" :tone="spreadTone" info="均价之差；为负表示实时价整体高于日前价，多用电量按实时价补差" />
      <MetricTile label="日前峰谷比" :value="stats && stats.daValley > 0 ? (stats.daPeak / stats.daValley).toFixed(2) : '—'" :sub="stats ? `${stats.points} 个时点` : ''" />
    </div>
    <section class="panel chart">
      <div class="top"><h3>日前 vs 实时价格 · 96 点</h3></div>
      <div ref="chartEl" class="host chart-host" />
    </section>
    <MarketAttributionPanel />
    <TemplateChips :templates="templates" label="市场复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
.chart { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 6px; }
.top h3 { margin: 0; font-size: var(--font-13-5); font-weight: 600; }
.host { width: 100%; height: 300px; }
</style>
