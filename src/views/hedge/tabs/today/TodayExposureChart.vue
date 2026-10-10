<script setup lang="ts">
// 今明两日页签·逐时段敞口图（openspec build-midlong-spot-hedging 任务 8.4，HW-02；ChenShi-Tech/dljy#3420）。
//
// 含机制/仅中长期两条阶梯线（分时恒定值，step:'end' 匹配起点标签）+ 发电柱（实际/预测两色）。
// 图表纪律（design D8）：不平滑、不插值——未知时段的数据点就是 null（ECharts 默认 connectNulls:false，
// 线在断点断开、柱不绘制），绝不用 0 冒充；未覆盖时段以灰色 markArea 标出，悬停显示未覆盖原因（契约中文标签）。
import HedgeHint from '../HedgeHint.vue'
import { onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { POWER, barSeries, catAxis, grid, legend, stepSeries, tooltipStyle, valueAxis, withAlpha } from '@/services/chart/chartStyle'
import type { ExposureSeries } from '@/services/hedge/hedgeTodayModel'
import { generationSourceLabel, uncoveredLabel } from '@/services/hedge/hedgeTodayModel'

const props = defineProps<{ series: ExposureSeries | null }>()

const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render: renderChart })

function buildOption(series: ExposureSeries) {
  // 发电柱逐项着色：实际青绿、预测中性灰；未覆盖为 null（不绘制柱，由 markArea 灰带示意）。
  const generationData = series.generation.map((bar) => (bar.value === null
    ? null
    : { value: bar.value, itemStyle: { color: bar.source === 'ACTUAL' ? POWER.newEnergy : POWER.forecast } }))
  return {
    legend: legend(),
    grid: grid({ legend: true }),
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      ...tooltipStyle(),
      formatter: (params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number | { value: number } | null }>) => {
        const first = params[0]
        if (!first) return ''
        const i = first.dataIndex
        const gen = series.generation[i]
        const lines = [String(series.labels[i] ?? '')]
        for (const p of params) {
          const v = typeof p.value === 'object' && p.value !== null ? p.value.value : p.value
          // 未知不显示（也不显示 0 冒充）。
          if (v === null || v === undefined) continue
          lines.push(`${p.marker}${p.seriesName}：${v} MWh`)
        }
        if (gen) {
          lines.push(gen.value === null
            ? `发电：未覆盖${gen.uncoveredReason ? `（${uncoveredLabel(gen.uncoveredReason) ?? gen.uncoveredReason}）` : ''}`
            : `发电：${gen.value} MWh（${generationSourceLabel(gen.source)}）`)
        }
        return lines.join('<br/>')
      },
    },
    xAxis: catAxis(series.labels),
    yAxis: valueAxis('MWh'),
    series: [
      {
        ...barSeries('发电', generationData),
        // 未覆盖区间灰带：悬停之外的常驻提示（原因在 tooltip 里给中文）。
        markArea: {
          silent: true,
          data: series.uncoveredRanges.map((range) => [
            { xAxis: range.fromLabel, itemStyle: { color: withAlpha(POWER.forecast, 0.12) } },
            { xAxis: range.toLabel },
          ]),
        },
      },
      stepSeries('含机制敞口', series.withMechanism, POWER.deviation, { step: 'end' }),
      stepSeries('中长期敞口', series.midlongOnly, POWER.load, { step: 'end' }),
    ],
  }
}

function renderChart() {
  if (!props.series) return
  chart.setOption(buildOption(props.series), true)
}

watch(() => props.series, renderChart)
onMounted(renderChart)
</script>

<template>
  <section v-if="series" class="chart-block" data-test="exposure-chart">
    <h3>逐时段敞口<HedgeHint text="发电量区分实际与预测。未知时段断开，悬停查看数据来源与缺失原因。" /></h3>
    <div ref="chartEl" class="chart" />
    <p class="chart-legend">
      发电：<span class="chip actual" />实际 <span class="chip forecast" />预测 <span class="chip uncovered" />未覆盖
      ｜ 敞口线：红=含机制、蓝=仅中长期
    </p>
  </section>
</template>

<style scoped>
.chart-block h3 { margin: 0 0 8px; }
.chart-block h3 small { font-size: var(--font-xs); color: var(--muted); font-weight: 400; margin-left: 6px; }
.chart { width: 100%; height: 320px; }
.chart-legend { margin: 4px 0 0; font-size: var(--font-xs); color: var(--muted); }
.chip { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 2px 0 6px; vertical-align: middle; }
.chip.actual { background: #0f9d8a; }
.chip.forecast { background: #94a3b8; }
.chip.uncovered { background: rgba(148, 163, 184, 0.25); outline: 1px dashed #94a3b8; }
</style>
