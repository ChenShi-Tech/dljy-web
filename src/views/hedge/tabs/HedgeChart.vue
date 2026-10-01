<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import { useEChart } from '@/composables/useEChart'
const props = defineProps<{ option: EChartsOption; label: string }>()
const el = ref<HTMLElement | null>(null)
const chart = useEChart(el, { render: renderChart })
function renderChart() { chart.setOption(props.option, true) }
watch(() => props.option, renderChart, { deep: true })
onMounted(renderChart)
</script>
<template><div ref="el" class="hedge-chart" role="img" :aria-label="label" /></template>
<style scoped>.hedge-chart { width: 100%; height: 390px; min-width: 0; }</style>
