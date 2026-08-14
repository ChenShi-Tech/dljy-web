<script setup lang="ts">
// 一问多维仪表盘 artifact（dljy-meta#18 / P2 #60）：渲染 dashboard_composer（#38）产出的
// AnalysisDashboard —— 整屏网格布局，每个图表复用 AnalysisChartArtifact；如实标注失败/未成功维度。
import { computed, inject, ref } from 'vue'
import { LayoutDashboard, Save } from 'lucide-vue-next'
import ArtifactFrame from './ArtifactFrame.vue'
import AnalysisChartArtifact from './AnalysisChartArtifact.vue'
import { ARTIFACT_CONTEXT } from './context'
import { fetchAgentRef } from '../../../services/agent/agentClient'
import { saveAnalysisView } from '../../../services/agent/analysisViewsClient'
import type { AnalysisDashboardArtifactBlock } from '../../../utils/artifactBlocks'

const props = defineProps<{ block: AnalysisDashboardArtifactBlock }>()
const dash = computed(() => props.block.dashboard)
const ctx = inject(ARTIFACT_CONTEXT, undefined)

/**
 * 保存前物化各子图数据（codex P1 3635805739）：dataRef 是会话内句柄，跨会话/重登后按新
 * sessionId 拉旧句柄必 404。趁保存时原会话仍在，把每个 dataRef 解成内联数据快照再持久化；
 * 单图拉取失败则保留原 spec（预览行仍可渲染），不阻断整体保存。
 */
async function materializeCharts() {
  const sid = ctx?.sessionId?.()
  return Promise.all(
    (Array.isArray(dash.value.charts) ? dash.value.charts : []).map(async (spec) => {
      const s = spec as { dataRef?: string; inlineData?: Record<string, unknown>[] }
      if (!s.dataRef || !sid) return spec
      try {
        const data = await fetchAgentRef<Record<string, unknown>[]>(sid, s.dataRef)
        if (Array.isArray(data) && data.length) return { ...spec, inlineData: data, dataRef: undefined }
      } catch {
        /* 拉取失败保留原样：预览行可渲染，跨会话缺明细如实空态 */
      }
      return spec
    }),
  )
}

const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
async function saveView() {
  if (saveState.value === 'saving') return
  const name = window.prompt('命名仪表盘名称：', dash.value.title || '数据分析仪表盘')
  if (!name) return
  saveState.value = 'saving'
  try {
    const snapshot = { ...dash.value, charts: await materializeCharts() }
    await saveAnalysisView(name, { kind: 'dashboard', dashboard: snapshot, question: dash.value.question })
    saveState.value = 'saved'
    setTimeout(() => { saveState.value = 'idle' }, 2500)
  } catch {
    saveState.value = 'error'
    setTimeout(() => { saveState.value = 'idle' }, 3000)
  }
}
const charts = computed(() => (Array.isArray(dash.value.charts) ? dash.value.charts : []))
const layoutClass = computed(() => (dash.value.layout === 'stack' ? 'is-stack' : 'is-grid'))

// plan.dimensions 里 ok=false 的维度（如实标注未成功）
const failedDims = computed<string[]>(() => {
  const dims = (dash.value.plan as { dimensions?: { title?: string; ok?: boolean }[] } | null)?.dimensions
  if (!Array.isArray(dims)) return []
  return dims.filter((d) => d && d.ok === false).map((d) => String(d.title ?? '维度'))
})
</script>

<template>
  <ArtifactFrame kind="analysis-dashboard" :title="dash.title || '数据分析仪表盘'">
    <template #icon><LayoutDashboard :size="14" /></template>
    <template #actions>
      <button v-if="charts.length" class="art-btn" :disabled="saveState === 'saving'" @click="saveView">
        <Save :size="12" />{{ saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : saveState === 'saving' ? '保存中…' : '保存仪表盘' }}
      </button>
    </template>

    <div class="dash-body">
      <p v-if="dash.question" class="dash-q">问题：{{ dash.question }}</p>

      <div v-if="!charts.length" class="dash-empty">未产出任何维度图表。</div>
      <div v-else class="dash-grid" :class="layoutClass">
        <div v-for="(spec, i) in charts" :key="i" class="dash-cell">
          <AnalysisChartArtifact :block="{ kind: 'analysis-chart', spec }" />
        </div>
      </div>

      <p v-if="failedDims.length" class="dash-note">
        {{ failedDims.length }} 个维度未成功：{{ failedDims.join('、') }}（整屏其余维度不受影响）。
      </p>
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.dash-body { padding: 8px 10px; }
.dash-q { margin: 0 0 8px; font-size: 12px; color: var(--text-secondary, #666); }
.dash-empty { padding: 24px; text-align: center; color: var(--text-secondary, #888); font-size: 13px; }
.dash-grid.is-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px; }
.dash-grid.is-stack { display: flex; flex-direction: column; gap: 10px; }
.dash-cell { min-width: 0; }
.dash-note { margin: 8px 0 0; font-size: 11px; color: #b45309; }
</style>

