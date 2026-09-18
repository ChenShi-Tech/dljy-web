<script setup lang="ts">
// 市场洞察序列图表组合容器（dljy#2996，OpenSpec 任务 5.8，design DE09—DE10）
// ----------------------------------------------------------------------------
// 一份规范结果的图表侧公共件：
//   - 按单位自动拆图（>2 种单位 → 多张图，见 useInsightSeriesChart），纵向排列；
//   - 单点点击 / 框选 → useInsightSelection 构建语义选区（校验 + 迟到守卫 + 防重复）
//     后 emit('select')；空框选 emit('select', null) 清除；
//   - 结果更换时清「同一选区」记忆与图上高亮；
//   - expose applySelection：外部（表格行点击 / 回放）把语义选区画成高亮带，
//     图表自身不重复上抛（防回环在 useInsightSelection 的重复守卫里）。
// 页面只需要传 result + 当前上下文（useInsightContext 的 regionId/companyId/contextVersion）。

import { computed, ref, watch } from 'vue'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import type { InsightBlockResult, InsightSeriesMeta } from '@/services/insight/insightClient'
import { buildInsightChartGroups, type InsightChartGroup } from './useInsightSeriesChart'
import { useInsightSelection } from './useInsightSelection'
import InsightChartPane from './InsightChartPane.vue'

const props = defineProps<{
  result: InsightBlockResult | null
  /** 页面当前上下文（useInsightContext）：事件守卫比对用；结果版本取当前显示的 result。 */
  current: { regionId: string; companyId: string | null; contextVersion: number }
  height?: string | number
}>()

const emit = defineEmits<{
  'select': [selection: InsightSelection | null]
}>()

const groups = computed<InsightChartGroup[]>(() => (props.result ? buildInsightChartGroups(props.result) : []))

const groupTitles = computed(() => groups.value.map((group) => group.units.join(' · ')))

const selectionBuilder = useInsightSelection(() => ({
  regionId: props.current.regionId,
  companyId: props.current.companyId,
  contextVersion: props.current.contextVersion,
  resultVersion: props.result?.resultVersion ?? '',
}))

const panes = ref<Array<InstanceType<typeof InsightChartPane> | null>>([])

/** 单点点击： Pane 的序列下标只在容器内换回目录元数据，随后丢弃。 */
function onPaneClick(groupIndex: number, hit: { seriesIndex: number; point: { ts: number; end: string } }): void {
  const series = groups.value[groupIndex]?.series[hit.seriesIndex]
  if (!series || !props.result) return
  const selection = selectionBuilder.build(props.result, [{ series: series.meta, point: hit.point }])
  if (selection) emit('select', selection)
}

/** 框选：空命中 = 用户清除选区。 */
function onPaneBrush(groupIndex: number, hits: Array<{ seriesIndex: number; point: { ts: number; end: string } }>): void {
  if (!hits.length) {
    selectionBuilder.reset()
    emit('select', null)
    return
  }
  if (!props.result) return
  const group = groups.value[groupIndex]
  if (!group) return
  type Hit = { series: InsightSeriesMeta; point: { ts: number; end: string } }
  const selection = selectionBuilder.build(
    props.result,
    hits
      .map((hit): Hit | null => {
        const series = group.series[hit.seriesIndex]
        return series ? { series: series.meta, point: hit.point } : null
      })
      .filter((hit): hit is Hit => hit !== null)
  )
  if (selection) emit('select', selection)
}

// 结果更换：清选区记忆与图上高亮带（旧结果的选区不属于新结果）。
watch(
  () => props.result,
  () => {
    selectionBuilder.reset()
    for (const pane of panes.value) pane?.applySelection(null)
  }
)

/** 外部应用语义选区（表格联动 / 回放）；null 清除。 */
function applySelection(selection: InsightSelection | null): void {
  for (const pane of panes.value) pane?.applySelection(selection)
}

defineExpose({ applySelection })
</script>

<template>
  <div class="insight-series-chart">
    <section v-for="(group, index) in groups" :key="groupTitles[index]" class="insight-series-chart__pane">
      <h4 class="insight-series-chart__title">单位：{{ groupTitles[index] }}</h4>
      <InsightChartPane
        :ref="(el) => (panes[index] = el as InstanceType<typeof InsightChartPane> | null)"
        :group="group"
        :height="height ?? 300"
        @click="(hit) => onPaneClick(index, hit)"
        @brush="(hits) => onPaneBrush(index, hits)"
      />
    </section>
    <el-empty v-if="!groups.length" description="暂无可绘制的序列" :image-size="72" />
  </div>
</template>

<style scoped>
.insight-series-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.insight-series-chart__pane {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px 6px;
}

.insight-series-chart__title {
  margin: 0 0 6px;
  font-size: var(--font-sm, 13px);
  font-weight: 600;
  color: var(--muted, #667085);
}
</style>
