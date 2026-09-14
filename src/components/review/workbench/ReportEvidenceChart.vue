<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import type { ReportEvidence } from '@/services/review/workpapers'
import { reportChartOption, reportEvidenceCaption } from '@/services/review/reportPresentation'
const props = defineProps<{ evidence: ReportEvidence }>()
const el = ref<HTMLElement | null>(null)
const chart = useEChart(el, { render, initOpts: { renderer: 'svg' } })
function render() { chart.setOption(reportChartOption(props.evidence), { replaceMerge: ['series'] }) }
watch(() => props.evidence, render, { immediate: true })
</script>
<template><figure><div ref="el" class="evidence-chart" role="img" :aria-label="evidence.content.labels.join('与') + '分析图'" /><figcaption>{{ reportEvidenceCaption(evidence) }}</figcaption></figure></template>
<style scoped>figure{margin:0}.evidence-chart{height:280px}figcaption{font-size:var(--font-sm);color:var(--muted);line-height:1.6}</style>
