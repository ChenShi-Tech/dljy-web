<script setup lang="ts">
// 已保存的命名分析视图列表（dljy-meta#18 / P2 #60）。
// 列出经 /api/v1/analysis/views 保存的图表/仪表盘视图；点击展开并就地重现（渲染保存的快照 spec）。
// 「刷新」按钮把原问题回填到智能体重跑（数据按需重算），复用 ARTIFACT_CONTEXT.submit。
import { inject, onMounted, ref } from 'vue'
import { RefreshCw, Save } from 'lucide-vue-next'
import AnalysisChartArtifact from './artifacts/AnalysisChartArtifact.vue'
import AnalysisDashboardArtifact from './artifacts/AnalysisDashboardArtifact.vue'
import { ARTIFACT_CONTEXT } from './artifacts/context'
import { listAnalysisViews, type SavedAnalysisView } from '../../services/agent/analysisViewsClient'

const ctx = inject(ARTIFACT_CONTEXT, undefined)
const views = ref<SavedAnalysisView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const openId = ref<string | null>(null)

async function refreshList() {
  loading.value = true
  error.value = null
  try {
    views.value = await listAnalysisViews()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(refreshList)
defineExpose({ refreshList })

function toggle(id: string) {
  openId.value = openId.value === id ? null : id
}

function rerun(v: SavedAnalysisView) {
  const q = v.config?.question
  if (q && ctx?.submit) ctx.submit(q)
}

// 读取 config 判别式 kind（对齐 contracts 1.12.0 analysis-view）。本列表列的是 /ai-agent 图表/仪表盘
// 视图，但存储与 page-state 页面态视图共用 /analysis/views；若串 routePath 拿到 page-state config，
// 据此给明确提示而非静默空态。窄类型断言（非 any）以容纳判别联合外的 page-state 形状。
function configKind(cfg: SavedAnalysisView['config'] | undefined): string | undefined {
  return (cfg as { kind?: string } | undefined)?.kind
}
</script>

<template>
  <div class="saved-views">
    <div class="saved-head">
      <span class="saved-title"><Save :size="13" /> 已保存分析</span>
      <button class="saved-refresh" :disabled="loading" @click="refreshList" title="刷新列表">
        <RefreshCw :size="12" />
      </button>
    </div>

    <div v-if="loading" class="saved-hint">加载中…</div>
    <div v-else-if="error" class="saved-hint is-error">{{ error }}</div>
    <div v-else-if="!views.length" class="saved-hint">暂无保存的分析视图。在图表上点「保存视图」即可留存。</div>

    <ul v-else class="saved-list">
      <li v-for="v in views" :key="v.viewId" class="saved-item">
        <div class="saved-row">
          <button class="saved-name" @click="toggle(v.viewId)">{{ v.name }}</button>
          <button v-if="v.config?.question" class="saved-rerun" title="用原问题重跑刷新数据" @click="rerun(v)">
            <RefreshCw :size="11" /> 刷新
          </button>
        </div>
        <div v-if="openId === v.viewId" class="saved-render">
          <AnalysisDashboardArtifact
            v-if="v.config?.kind === 'dashboard' && v.config.dashboard"
            :block="{ kind: 'analysis-dashboard', dashboard: v.config.dashboard }"
          />
          <AnalysisChartArtifact
            v-else-if="v.config?.kind === 'chart' && v.config.spec"
            :block="{ kind: 'analysis-chart', spec: v.config.spec }"
          />
          <div v-else-if="configKind(v.config) === 'page-state'" class="saved-hint">
            该视图为分析页布局，请在对应分析页（{{ v.routePath }}）打开应用。
          </div>
          <div v-else class="saved-hint">该视图无可渲染内容。</div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.saved-views { padding: 8px 10px; }
.saved-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.saved-title { display: inline-flex; align-items: center; gap: 5px; font-size: var(--font-sm); font-weight: 600; color: var(--text-secondary, #555); }
.saved-refresh { border: none; background: transparent; cursor: pointer; color: var(--text-secondary, #888); }
.saved-hint { font-size: var(--font-sm); color: var(--text-secondary, #999); padding: 6px 2px; }
.saved-hint.is-error { color: #c0392b; }
.saved-list { list-style: none; margin: 0; padding: 0; }
.saved-item { border-bottom: 1px solid var(--border, #eee); padding: 4px 0; }
.saved-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.saved-name { flex: 1; text-align: left; border: none; background: transparent; cursor: pointer; font-size: var(--font-md); color: var(--text, #222); padding: 4px 0; }
.saved-rerun { display: inline-flex; align-items: center; gap: 3px; font-size: var(--font-xs); border: 1px solid var(--border, #ddd); border-radius: 4px; background: transparent; cursor: pointer; padding: 2px 6px; }
.saved-render { margin: 6px 0; }
</style>
