<script setup lang="ts">
// AnalysisChartSpec 渲染 artifact（dljy-meta#18 / P0 #59）。
// 消费 text2sql（#35）产出的图表规格：chartType→ECharts option 映射（复用 chartStyle），
// table/kpi 特殊视图，dataRef 按需异步拉取明细，sql 溯源折叠 + basis 真伪徽标，诚实空态。
import { computed, inject, onMounted, ref } from 'vue'
import { BarChart3, Download, Save } from 'lucide-vue-next'
import ArtifactFrame from './ArtifactFrame.vue'
import AgentChart from '../AgentChart.vue'
import DataBasisBadge from '../../DataBasisBadge.vue'
import { ARTIFACT_CONTEXT } from './context'
import { fetchAgentRef } from '../../../services/agent/agentClient'
import { saveAnalysisView } from '../../../services/agent/analysisViewsClient'
import type { AnalysisChartArtifactBlock } from '../../../utils/artifactBlocks'
import {
  chartSpecToOption,
  toDataBasis,
  type AnalysisRow,
} from '../../../services/chart/analysisChartSpec'

const props = defineProps<{ block: AnalysisChartArtifactBlock }>()
const ctx = inject(ARTIFACT_CONTEXT, undefined)
const chartRef = ref<InstanceType<typeof AgentChart> | null>(null)

const spec = computed(() => props.block.spec)
const rows = ref<AnalysisRow[]>(Array.isArray(spec.value.inlineData) ? spec.value.inlineData : [])
const loading = ref(false)
const loadError = ref<string | null>(null)

onMounted(async () => {
  // 无内联数据但有 data_ref → 按需拉取明细（大结果集不随消息内联）。
  if (rows.value.length === 0 && spec.value.dataRef && ctx?.sessionId) {
    const sid = ctx.sessionId()
    if (!sid) return
    loading.value = true
    try {
      const data = await fetchAgentRef<AnalysisRow[]>(sid, spec.value.dataRef)
      rows.value = Array.isArray(data) ? data : []
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : '明细拉取失败'
    } finally {
      loading.value = false
    }
  }
})

const option = computed(() => chartSpecToOption(spec.value, rows.value))
const isTable = computed(() => spec.value.chartType === 'table')
const isKpi = computed(() => spec.value.chartType === 'kpi')

// 表格列：取首行键
const tableColumns = computed<string[]>(() => (rows.value.length ? Object.keys(rows.value[0]) : []))
// KPI：首行的数值字段作为指标卡
const kpiMetrics = computed(() => {
  const r = rows.value[0]
  if (!r) return []
  return Object.entries(r)
    .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))))
    .slice(0, 6)
    .map(([k, v]) => ({ label: k, value: typeof v === 'number' ? v : Number(v) }))
})

const dataBasis = computed(() => toDataBasis(spec.value.basis))
const showSql = ref(false)
const hasData = computed(() => rows.value.length > 0)

function exportPng() {
  chartRef.value?.exportPng(spec.value.title || 'chart')
}

const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
async function saveView() {
  if (saveState.value === 'saving') return
  const name = window.prompt('命名视图名称：', spec.value.title || '数据分析')
  if (!name) return
  saveState.value = 'saving'
  try {
    await saveAnalysisView(name, {
      kind: 'chart',
      spec: { ...spec.value, inlineData: rows.value.slice(0, 500) },
      sql: spec.value.sql,
    })
    saveState.value = 'saved'
    setTimeout(() => { saveState.value = 'idle' }, 2500)
  } catch {
    saveState.value = 'error'
    setTimeout(() => { saveState.value = 'idle' }, 3000)
  }
}

function fmt(v: unknown): string {
  if (v == null) return '-'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  return String(v)
}
</script>

<template>
  <ArtifactFrame kind="analysis-chart" :title="spec.title || '数据分析'">
    <template #icon><BarChart3 :size="14" /></template>
    <template #actions>
      <DataBasisBadge :basis="dataBasis" />
      <button v-if="hasData" class="art-btn" :disabled="saveState === 'saving'" @click="saveView">
        <Save :size="12" />{{ saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : saveState === 'saving' ? '保存中…' : '保存视图' }}
      </button>
      <button v-if="option" class="art-btn" @click="exportPng"><Download :size="12" />导出 PNG</button>
    </template>

    <div class="analysis-body">
      <p v-if="spec.description" class="analysis-desc">{{ spec.description }}</p>

      <div v-if="loading" class="analysis-empty">加载明细中…</div>
      <div v-else-if="loadError" class="analysis-empty is-error">明细拉取失败：{{ loadError }}</div>
      <div v-else-if="!hasData" class="analysis-empty">暂无数据（查询无结果或未内联明细）</div>

      <!-- KPI 指标卡 -->
      <div v-else-if="isKpi" class="kpi-row">
        <div v-for="m in kpiMetrics" :key="m.label" class="kpi-card">
          <div class="kpi-value">{{ fmt(m.value) }}</div>
          <div class="kpi-label">{{ m.label }}</div>
        </div>
      </div>

      <!-- 表格 -->
      <div v-else-if="isTable" class="analysis-table-host">
        <table class="analysis-table">
          <thead><tr><th v-for="c in tableColumns" :key="c">{{ c }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in rows.slice(0, 200)" :key="i">
              <td v-for="c in tableColumns" :key="c">{{ fmt(r[c]) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="rows.length > 200" class="analysis-note">仅显示前 200 行，共 {{ rows.length }} 行</p>
      </div>

      <!-- 通用图表 -->
      <div v-else-if="option" class="chart-host"><AgentChart ref="chartRef" :option="option" /></div>

      <!-- 有数据但该类型暂无渲染器（如域图表未就绪）→ 诚实降级为表格提示 -->
      <div v-else class="analysis-empty">该图型（{{ spec.chartType }}）暂未支持渲染，可查看下方 SQL 与明细。</div>

      <!-- SQL 溯源 -->
      <div v-if="spec.sql" class="analysis-sql">
        <button class="sql-toggle" @click="showSql = !showSql">{{ showSql ? '收起' : '查看' }} SQL 溯源</button>
        <pre v-if="showSql" class="sql-code">{{ spec.sql }}</pre>
      </div>
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.analysis-body { padding: 8px 10px; }
.analysis-desc { margin: 0 0 8px; font-size: var(--font-sm); color: var(--text-secondary, #666); }
.chart-host { min-height: 220px; }
.analysis-empty { padding: 24px 8px; text-align: center; color: var(--text-secondary, #888); font-size: var(--font-md); }
.analysis-empty.is-error { color: #c0392b; }
.kpi-row { display: flex; flex-wrap: wrap; gap: 10px; }
.kpi-card { flex: 1 1 120px; padding: 12px; border-radius: 8px; background: var(--surface-2, #f5f6f8); text-align: center; }
.kpi-value { font-size: var(--font-20); font-weight: 700; }
.kpi-label { margin-top: 4px; font-size: var(--font-sm); color: var(--text-secondary, #777); }
.analysis-table-host { overflow-x: auto; }
.analysis-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
.analysis-table th, .analysis-table td { padding: 5px 8px; border-bottom: 1px solid var(--border, #eee); text-align: right; white-space: nowrap; }
.analysis-table th { text-align: right; font-weight: 600; color: var(--text-secondary, #555); }
.analysis-note { margin: 6px 0 0; font-size: var(--font-xs); color: var(--text-secondary, #999); }
.analysis-sql { margin-top: 8px; }
.sql-toggle { font-size: var(--font-xs); padding: 3px 8px; border: 1px solid var(--border, #ddd); border-radius: 4px; background: transparent; cursor: pointer; }
.sql-code { margin: 6px 0 0; padding: 8px; border-radius: 6px; background: var(--surface-2, #f5f6f8); font-size: var(--font-xs); overflow-x: auto; white-space: pre-wrap; }
</style>

