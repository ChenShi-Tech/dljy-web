<script setup lang="ts">
// Artifact 分发渲染：把 parseArtifactBlocks 的有序块映射为对应组件 / markdown。
// markdown 与 chart 特殊处理；其余 kind 经 COMPONENTS 表动态分发（新增带视图的
// artifact 只需在此注册组件 + 在 artifactBlocks 注册 parser）。
// 在此一次性注入 highlight.js 暗色主题（只为代码/HTML 源码 token 着色）。
import 'highlight.js/styles/github-dark.css'
import type { Component } from 'vue'
import type { ArtifactBlock } from '../../../utils/artifactBlocks'
import CodeArtifact from './CodeArtifact.vue'
import ChartArtifact from './ChartArtifact.vue'
import AnalysisChartArtifact from './AnalysisChartArtifact.vue'
import AnalysisDashboardArtifact from './AnalysisDashboardArtifact.vue'
import HtmlArtifact from './HtmlArtifact.vue'
import MetricCardArtifact from './MetricCardArtifact.vue'
import CalloutArtifact from './CalloutArtifact.vue'
import TableArtifact from './TableArtifact.vue'
import CiteArtifact from './CiteArtifact.vue'
import JsonViewArtifact from './JsonViewArtifact.vue'
import TimelineArtifact from './TimelineArtifact.vue'
import SettlementArtifact from './SettlementArtifact.vue'
import MathArtifact from './MathArtifact.vue'
import MermaidArtifact from './MermaidArtifact.vue'
import DownloadArtifact from './DownloadArtifact.vue'
import FormArtifact from './FormArtifact.vue'
import StepsArtifact from './StepsArtifact.vue'
import DiffArtifact from './DiffArtifact.vue'
import DljyUiArtifact from '../dljy-ui/DljyUiArtifact.vue'

defineProps<{ blocks: ArtifactBlock[] }>()

const COMPONENTS: Record<string, Component> = {
  'analysis-chart': AnalysisChartArtifact,
  'analysis-dashboard': AnalysisDashboardArtifact,
  code: CodeArtifact,
  html: HtmlArtifact,
  card: MetricCardArtifact,
  callout: CalloutArtifact,
  table: TableArtifact,
  cite: CiteArtifact,
  jsonview: JsonViewArtifact,
  timeline: TimelineArtifact,
  settlement: SettlementArtifact,
  math: MathArtifact,
  mermaid: MermaidArtifact,
  download: DownloadArtifact,
  form: FormArtifact,
  steps: StepsArtifact,
  diff: DiffArtifact,
  'dljy-ui': DljyUiArtifact
}
</script>

<template>
  <template v-for="(b, i) in blocks" :key="i">
    <div v-if="b.kind === 'markdown'" class="md" v-html="b.html" />
    <ChartArtifact v-else-if="b.kind === 'chart'" :option="b.option" :title="b.title" />
    <component :is="COMPONENTS[b.kind]" v-else :block="b" />
  </template>
</template>

<style scoped>
.md { font-size: var(--font-lg); line-height: 1.7; }
.md :deep(p) { margin: 4px 0; }
.md :deep(p:first-child) { margin-top: 0; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(h3), .md :deep(h4), .md :deep(h5), .md :deep(h6) { margin: 10px 0 4px; font-weight: 600; line-height: 1.3; }
.md :deep(code) {
  background: rgba(125, 125, 125, 0.14); padding: 1px 5px; border-radius: 4px; font-size: var(--font-12-5);
}
.md :deep(table) { border-collapse: collapse; margin: 6px 0; font-size: var(--font-12-5); width: 100%; }
.md :deep(th), .md :deep(td) { border: 1px solid rgba(125, 125, 125, 0.3); padding: 4px 9px; text-align: left; }
.md :deep(th) { background: rgba(125, 125, 125, 0.08); font-weight: 600; }
.md :deep(ul), .md :deep(ol) { padding-left: 20px; margin: 4px 0; }
.md :deep(li) { margin: 2px 0; }
.md :deep(blockquote) {
  margin: 6px 0; padding: 2px 12px; border-left: 3px solid rgba(125, 125, 125, 0.3); opacity: 0.85;
}
.md :deep(a) { color: var(--el-color-primary, #2563eb); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }
.md :deep(.md-task) { margin-right: 5px; vertical-align: middle; }
.md :deep(hr) { border: none; border-top: 1px solid rgba(125, 125, 125, 0.2); margin: 10px 0; }
.md :deep(img) { max-width: 100%; border-radius: 6px; }
</style>
