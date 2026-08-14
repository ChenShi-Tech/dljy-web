<script setup lang="ts">
// Agent 产出图表（create_chart 工具的 ECharts option 渲染）
// 生命周期(init/容器resize/主题重建/dispose)统一交给 useEChart 托管
import { onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import { useEChart } from '../../composables/useEChart'

const props = defineProps<{ option: Record<string, unknown> }>()
const el = ref<HTMLElement | null>(null)
const renderError = ref(false)
const chart = useEChart(el, { render })

function render() {
  // 全量替换:外部传入 option 可能整体变化,merge 会残留旧系列。
  // option 来源是 agent 流式输出的 loose-parse JSON（```chart/```json 直接透传），
  // 可能是「能解析但非合法 ECharts option」的畸形结构，setOption 会抛异常并冒泡出
  // onMounted/watch（Vue 渲染告警、本图表渲染中断）。这里捕获，避免一个坏图表
  // 拖垮整条消息的流式渲染；置 renderError 给出可见兜底，后续 prop 变为合法 option 时自愈。
  try {
    chart.setOption(props.option as EChartsOption, { notMerge: true })
    renderError.value = false
  } catch (err) {
    renderError.value = true
    console.warn('[agent-chart] 图表渲染失败（option 格式有误，已降级提示）', err)
  }
}

onMounted(render)
watch(() => props.option, render, { deep: true })

// 供 ChartArtifact 导出 PNG（2x 像素比 + 白底，避免暗色主题导出发灰）
function exportPng(name = 'chart') {
  const inst = chart.instance()
  if (!inst) return
  const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.png`
  a.click()
}
defineExpose({ instance: () => chart.instance(), exportPng })
</script>

<template>
  <div class="agent-chart-wrap">
    <div v-show="!renderError" ref="el" class="agent-chart chart-host" />
    <div v-if="renderError" class="chart-error">
      ⚠ 图表数据格式有误，无法渲染（已保留对话其余内容）
    </div>
  </div>
</template>

<style scoped>
.agent-chart-wrap {
  width: 100%;
}
.agent-chart {
  width: 100%;
  height: 280px;
}
.chart-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  padding: 14px 16px;
  font-size: 12.5px;
  color: var(--muted, #909399);
  background: rgba(125, 125, 125, 0.05);
  border: 1px dashed rgba(125, 125, 125, 0.3);
  border-radius: 8px;
}
</style>
