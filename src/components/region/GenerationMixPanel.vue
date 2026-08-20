<script setup lang="ts">
// 电源结构与驱动（结构性事实）：装机结构条形图 + 主导驱动。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { RegionSpotProfile } from '../../data/regionSpotProfiles'
import { useEChart } from '../../composables/useEChart'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'

const props = defineProps<{ profile: RegionSpotProfile }>()

const chartEl = ref<HTMLElement | null>(null)
// 生命周期(init/容器resize/主题重建/dispose)统一交给 useEChart 托管
const chart = useEChart(chartEl, { render: renderChart })

const mixRows = computed(() => {
  const mix = props.profile.generationMix
  return [
    { name: '煤电', value: mix.coal },
    { name: '水电', value: mix.hydro },
    { name: '风电', value: mix.wind },
    { name: '光伏', value: mix.solar },
    { name: '核电', value: mix.nuclear },
    { name: '其他', value: mix.other }
  ]
})
const hasMix = computed(() => mixRows.value.some((row) => row.value > 0))

function renderChart() {
  if (!chartEl.value || !hasMix.value) return
  chart.setOption({
    grid: { left: 56, right: 24, top: 30, bottom: 24 },
    tooltip: axisTooltip({ unit: '%', pointer: 'shadow' }),
    toolbox: chartToolbox('电源结构'),
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#e5edf4' } } },
    yAxis: { type: 'category', data: mixRows.value.map((row) => row.name), inverse: true },
    series: [
      {
        type: 'bar',
        data: mixRows.value.map((row) => row.value),
        barWidth: 14,
        itemStyle: { color: '#19988b', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: '{c}%' }
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
  <section class="generation-mix panel">
    <div class="panel-head">
      <div class="section-kicker">电源结构与驱动</div>
      <el-tag v-if="hasMix" type="success" size="small">主导：{{ profile.dominantDriver }}</el-tag>
    </div>
    <div v-if="hasMix" ref="chartEl" class="chart chart-host"></div>
    <p v-else class="empty">该地区现货市场尚未启动，暂无电源结构画像。</p>
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
.empty {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}
</style>
