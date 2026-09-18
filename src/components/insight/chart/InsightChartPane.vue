<script setup lang="ts">
// 市场洞察单图渲染单元（dljy#2996，任务 5.8 内部件，由 InsightSeriesChart 组合）
// ----------------------------------------------------------------------------
// 一张图（一组 ≤2 单位的序列，见 useInsightSeriesChart）的 ECharts 宿主：
//   - 实例生命周期交给 useEChart（主题重建 / resize / dispose）；
//   - 事件在 onInit 绑定（主题重建换实例也会重绑）：单点 click 与 brushSelected
//     都上抛「语义命中」——序列目录元数据 + 时段（起点毫秒 + 终点 ISO），
//     绝不把 dataIndex / seriesIndex / 像素抛出去（下标只在 Pane 内部临时用于取点）；
//   - 选区高亮用 markArea 画背景带（时间区间），不依赖 ECharts highlight action
//     （symbol:none 的阶梯线上 highlight 不可见）。

import { onMounted, ref, watchEffect } from 'vue'
import type { EChartsOption } from 'echarts'
import type { InsightSelection, TimeInterval } from 'shared/insight/handoff.mjs'
import { useEChart } from '@/composables/useEChart'
import type { InsightChartGroup } from './useInsightSeriesChart'
import { buildInsightChartOption } from './useInsightSeriesChart'

const props = defineProps<{
  group: InsightChartGroup
  height?: string | number
}>()

const emit = defineEmits<{
  /** 单点点击（语义命中：哪条序列的哪个时段）。 */
  'click': [hit: { seriesIndex: number; point: { ts: number; end: string } }]
  /** 框选（一次框选的全部语义命中；空数组 = 清除选区）。 */
  'brush': [hits: Array<{ seriesIndex: number; point: { ts: number; end: string } }>]
}>()

const host = ref<HTMLElement | null>(null)
/** 选区时段（markArea 高亮带）；applySelection 写入。 */
const selectedIntervals = ref<TimeInterval[]>([])

function paint(): void {
  const option = buildInsightChartOption(props.group) as Record<string, unknown>
  // 注入框选（语义选区）：notMerge 每次重绘会清掉，这里补回。
  option.brush = {
    toolbox: ['rect', 'clear'],
    xAxisIndex: 0,
    throttleType: 'debounce',
    throttleDelay: 200,
    brushStyle: { borderWidth: 1, color: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.5)' },
  }
  const toolbox = (option.toolbox ?? {}) as { feature?: Record<string, unknown> }
  toolbox.feature = {
    ...(toolbox.feature ?? {}),
    brush: { type: ['rect', 'clear'], title: { rect: '框选时段', clear: '清除选区' } },
  }
  option.toolbox = toolbox
  // 选区高亮带（画在第一条序列上；时间轴区间用毫秒定位）。
  if (selectedIntervals.value.length) {
    const first = (option.series as Array<Record<string, unknown>>)[0] ?? {}
    first.markArea = {
      silent: true,
      itemStyle: { color: 'rgba(245,158,11,0.12)' },
      data: selectedIntervals.value.map((interval) => [
        { xAxis: Date.parse(interval.start) },
        { xAxis: Date.parse(interval.end) },
      ]),
    }
  }
  chart.setOption(option as EChartsOption, { notMerge: true })
}

const chart = useEChart(host, {
  render: paint,
  onInit(instance) {
    instance.on('click', (raw: unknown) => {
      const params = raw as { seriesIndex?: number; data?: { value?: [number, unknown]; end?: string; edge?: true } }
      if (params.data?.edge) return
      const ts = params.data?.value?.[0]
      if (typeof ts !== 'number' || !params.data?.end) return
      if (typeof params.seriesIndex !== 'number') return
      emit('click', { seriesIndex: params.seriesIndex, point: { ts, end: params.data.end } })
    })
    instance.on('brushSelected', (raw: unknown) => {
      const params = raw as { batch?: Array<{ selected?: Array<{ dataIndex?: number[] }> }> }
      const selected = params.batch?.[0]?.selected ?? []
      const hits: Array<{ seriesIndex: number; point: { ts: number; end: string } }> = []
      // dataIndex / seriesIndex 只在这里临时用来取回数据点，随后即丢弃；
      // 上抛的是序列元数据 + 时段（语义身份）。
      selected.forEach((entry, seriesIndex) => {
        const series = props.group.series[seriesIndex]
        if (!series) return
        for (const dataIndex of entry.dataIndex ?? []) {
          const point = series.points[dataIndex]
          if (point && !point.edge) hits.push({ seriesIndex, point: { ts: point.ts, end: point.end } })
        }
      })
      emit('brush', hits)
    })
  },
})

onMounted(() => watchEffect(paint))

/** 外部（表格行点击 / 页面回放）应用语义选区：null 清除。 */
function applySelection(selection: InsightSelection | null): void {
  selectedIntervals.value = selection ? [...selection.timeIntervals] : []
  paint()
}

defineExpose({ applySelection })
</script>

<template>
  <div class="insight-chart-pane">
    <div ref="host" class="insight-chart-pane__host" :style="{ height: typeof height === 'number' ? `${height}px` : height }" />
  </div>
</template>

<style scoped>
.insight-chart-pane {
  width: 100%;
}

.insight-chart-pane__host {
  width: 100%;
  min-height: 200px;
}
</style>
