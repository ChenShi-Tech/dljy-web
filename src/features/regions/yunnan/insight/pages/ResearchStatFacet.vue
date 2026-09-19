<script setup lang="ts">
// 研究统计分面单图（dljy#3114，任务 13.7）：一个量纲一张图、一根轴。
// 数据与分组来自 researchFacets（指标按云南登记目录），本组件只渲染 ECharts 条形图；
// 序列显隐由父层过滤后传入，本组件不做统计、不改值、不共轴（跨量纲由父层拆面）。
import { onMounted, ref, watchEffect } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { buildStatFacetOption, type ResearchStatFacet } from '../researchFacets'

const props = defineProps<{ facet: ResearchStatFacet }>()

const host = ref<HTMLElement | null>(null)

const chart = useEChart(host, { render: paint })

function paint(): void {
  chart.setOption(buildStatFacetOption(props.facet) as Parameters<typeof chart.setOption>[0], { notMerge: true })
}

onMounted(() => watchEffect(paint))
</script>

<template>
  <div class="yr-facet">
    <div ref="host" class="yr-facet__host" />
  </div>
</template>

<style scoped>
.yr-facet {
  width: 100%;
}

.yr-facet__host {
  width: 100%;
  height: 200px;
}
</style>
