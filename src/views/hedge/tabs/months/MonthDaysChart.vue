<script setup lang="ts">
// 当月「按日已分解锁价 vs 发电」图（HW-03；openspec build-midlong-spot-hedging 任务 8.3，ChenShi-Tech/dljy#3421）。
//
// 发电按来源分段着色（实际 = 蓝、预测 = 绿、未覆盖 = 无柱），已分解锁价为折线：
// 未知日两侧均为 null——折线 connectNulls: false 断开不连线，柱缺失，不做平滑与插值（D8）。
// 值全部来自服务端，未知就是 null，不用 0 冒充。「月度未分解」不属于任何一天，不进本图（HW-03 单列展示）。
import { onMounted, ref, watch, nextTick } from 'vue'
import type { SeriesOption } from 'echarts'
import { useEChart } from '@/composables/useEChart'
import type { HedgeMonthView } from '@/services/hedge/hedgeMonthsApi'
import { daysChartSeries, mwhText, uncoveredReasonText } from './monthsModel'

const props = defineProps<{ days: HedgeMonthView['days'] }>()

const ACTUAL_COLOR = '#409eff'   // 实际发电：事实层用主色
const FORECAST_COLOR = '#67c23a' // 预测发电：绿色系，与事实层区分
const LOCKED_COLOR = '#e6a23c'   // 已分解锁价：橙色参照线，压在柱之上

const el = ref<HTMLDivElement | null>(null)

// tooltip 里发电一行按天给来源与未知原因：柱图上未覆盖日什么都没有，不点出来会被当成数据丢了。
function tooltipFormatter(params: unknown): string {
  const list = Array.isArray(params) ? params : [params]
  const dataIndex = (list[0] as { dataIndex?: number } | undefined)?.dataIndex
  const day = dataIndex === undefined ? null : props.days[dataIndex] ?? null
  if (!day) return ''
  const gen = day.generation.source === 'ACTUAL'
    ? `实际 ${mwhText(day.generation.value)}`
    : day.generation.source === 'FORECAST'
      ? `预测 ${mwhText(day.generation.value)}`
      : `未覆盖（${uncoveredReasonText(day.generation.uncoveredReason)}）`
  return [`${day.date}`, `发电：${gen} MWh`, `已分解锁价：${mwhText(day.lockedDecomposedMwh)} MWh`].join('<br/>')
}

function render() {
  const data = daysChartSeries(props.days)
  const series: SeriesOption[] = [
    // 两条 bar 共用 stack：每天两侧互斥（实际/预测只其一），未覆盖日两侧皆 null → 无柱
    { name: '实际发电', type: 'bar', stack: 'generation', data: data.actualGen, itemStyle: { color: ACTUAL_COLOR } },
    { name: '预测发电', type: 'bar', stack: 'generation', data: data.forecastGen, itemStyle: { color: FORECAST_COLOR } },
    {
      name: '已分解锁价', type: 'line', data: data.locked,
      smooth: false, connectNulls: false, showSymbol: false,
      lineStyle: { width: 2, color: LOCKED_COLOR }, itemStyle: { color: LOCKED_COLOR }, z: 3,
    },
  ]
  chart.setOption(
    {
      tooltip: { trigger: 'axis', confine: true, formatter: tooltipFormatter },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 56, right: 24, top: 32, bottom: 40 },
      xAxis: { type: 'category', data: data.dates },
      yAxis: { type: 'value', name: 'MWh' },
      series,
    },
    true,
  )
}

const chart = useEChart(el, { render })

onMounted(render)
// days 数组每次加载都是新引用（HedgeMonthsTab 整体替换 months），浅 watch 即可。
watch(() => props.days, () => nextTick(render))
</script>

<template>
  <div ref="el" class="month-days-chart" data-test="month-days-chart"></div>
</template>

<style scoped>
.month-days-chart { width: 100%; height: 280px; }
</style>
