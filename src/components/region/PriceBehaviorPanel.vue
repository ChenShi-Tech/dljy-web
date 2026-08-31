<script setup lang="ts">
// 价格行为画像（特征示意）：典型日内曲线 + 波动率/负价频率/价差指标。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { RegionSpotProfile, Volatility } from '../../data/regionSpotProfiles'
import IllustrativeBadge from './IllustrativeBadge.vue'
import { useEChart } from '../../composables/useEChart'
import { axisTooltip, bottomLayoutLegend, bottomToolbox } from '@/services/chart/chartOptions'

const props = defineProps<{ profile: RegionSpotProfile }>()

const chartEl = ref<HTMLElement | null>(null)
// 生命周期(init/容器resize/主题重建/dispose)统一交给 useEChart 托管
const chart = useEChart(chartEl, { render: renderChart })

const hasCurve = computed(() => props.profile.priceProfile.typicalDayCurve.length > 0)
const volatilityLabel = computed(() => {
  const map: Record<Volatility, string> = { low: '低', mid: '中', high: '高', extreme: '极高' }
  return map[props.profile.priceProfile.volatility]
})
const negativeFreqPct = computed(() => `${Math.round(props.profile.priceProfile.negativePriceFreq * 100)}%`)

function renderChart() {
  if (!chartEl.value || !hasCurve.value) return
  const curve = props.profile.priceProfile.typicalDayCurve
  chart.setOption({
    // 底部布局（对齐月度趋势）：top/bottom 56 各让一行——上行图例、下行 y 轴 name，底部刻度与工具栏
    grid: { left: 48, right: 18, top: 56, bottom: 56 },
    tooltip: axisTooltip({ unit: '元/MWh' }),
    legend: bottomLayoutLegend({ textStyle: { fontSize: 10 } }),
    toolbox: bottomToolbox('价格行为画像', 8),
    xAxis: {
      type: 'category',
      data: curve.map((_, hour) => `${hour}:00`)
    },
    yAxis: {
      type: 'value',
      name: '元/MWh',
      splitLine: { lineStyle: { color: '#e5edf4' } }
    },
    series: [
      {
        name: '典型日内价格',
        type: 'line',
        step: 'end',
        symbolSize: 5,
        data: curve,
        markLine: { silent: true, data: [{ yAxis: 0, name: '零价' }], lineStyle: { color: '#c0392b', type: 'dashed' } },
        areaStyle: { opacity: 0.1 },
        lineStyle: { color: '#0f766e', width: 2.5 },
        itemStyle: { color: '#0f766e' }
      }
    ]
  })
}

onMounted(renderChart)

watch(
  () => props.profile,
  () => nextTick(renderChart),
  { deep: true }
)
</script>

<template>
  <section class="price-behavior panel">
    <div class="panel-head">
      <div class="section-kicker">价格行为画像</div>
      <IllustrativeBadge />
    </div>
    <template v-if="hasCurve">
      <div ref="chartEl" class="chart chart-host"></div>
      <div class="metrics">
        <div><small>形态</small><strong>{{ profile.priceProfile.shape }}</strong></div>
        <div><small>波动率</small><strong>{{ volatilityLabel }}</strong></div>
        <div><small>负价时段占比</small><strong>{{ negativeFreqPct }}</strong></div>
        <div><small>峰谷价差(元/MWh)</small><strong>{{ profile.priceProfile.peakValleySpread }}</strong></div>
      </div>
    </template>
    <p v-else class="empty">该地区现货市场尚未启动，暂无价格画像。</p>
  </section>
</template>

<style scoped>
.panel {
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-kicker {
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}
.chart {
  width: 100%;
  height: 240px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.metrics div {
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}
.metrics small {
  display: block;
  color: var(--muted);
  font-size: var(--font-sm);
  margin-bottom: 4px;
}
.metrics strong {
  color: var(--text);
}
.empty {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}
@media (max-width: 1180px) {
  .metrics {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 768px) {
  .metrics {
    grid-template-columns: 1fr;
  }
}
</style>
