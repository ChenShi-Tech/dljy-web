<script setup lang="ts">
// 图表 artifact：内联 ECharts option 渲染 + 标题 + 导出 PNG（复用 AgentChart 实例）。
import { ref } from 'vue'
import { BarChart3, Download } from 'lucide-vue-next'
import ArtifactFrame from './ArtifactFrame.vue'
import AgentChart from '../AgentChart.vue'

const props = defineProps<{ option: Record<string, unknown>; title: string }>()
const chartRef = ref<InstanceType<typeof AgentChart> | null>(null)

function exportPng() {
  chartRef.value?.exportPng(props.title || 'chart')
}
</script>

<template>
  <ArtifactFrame kind="chart" :title="title || '图表'">
    <template #icon><BarChart3 :size="14" /></template>
    <template #actions>
      <button class="art-btn" @click="exportPng"><Download :size="12" />导出 PNG</button>
    </template>
    <div class="chart-host"><AgentChart ref="chartRef" :option="option" /></div>
  </ArtifactFrame>
</template>

<style scoped>
.chart-host { padding: 8px 10px; }
</style>
