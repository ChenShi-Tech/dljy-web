<script setup lang="ts">
// 报表区块渲染器：按 blockType 分发渲染（METRIC/CHART/TABLE/SETTLEMENT/AI_TEXT）。
// 渲染数据约定见 src/features/reports/reportBlocks.ts 顶部注释。
import { ref, computed, onMounted, watch } from 'vue'
import type { ReportBlockInstance } from '@/services/reportEngine'
import type { DataBasis } from '@/services/dataBasis'
import { useEChart } from '../../composables/useEChart'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'
import DataBasisBadge from '../DataBasisBadge.vue'

const props = defineProps<{ block: ReportBlockInstance }>()

type Kpi = { label: string; value: string | number; unit?: string; tone?: 'stable' | 'warning' | 'danger' }
type Column = { key: string; label: string; width?: number; align?: 'left' | 'right' | 'center' }

const data = computed(() => (props.block.data ?? {}) as Record<string, unknown>)
const kpis = computed(() => (data.value.kpis as Kpi[]) ?? [])
const columns = computed(() => (data.value.columns as Column[]) ?? [])
const rows = computed(() => (data.value.rows as Record<string, unknown>[]) ?? [])
const sections = computed(() => (data.value.sections as { title: string; body: string }[]) ?? [])
const footnote = computed(() => (data.value.footnote as string) ?? '')
// SQL/数据溯源（#23）：契约图表块与 AI 结论块可携带 data.sql（字符串或字符串数组）。
const sqlTrace = computed<string[]>(() => {
  const s = data.value.sql
  if (typeof s === 'string' && s.trim()) return [s]
  if (Array.isArray(s)) return s.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return []
})
const showTrace = ref(false)

// provenance.sourceType → DataBasis 角标
const basis = computed<DataBasis>(() => {
  switch (props.block.provenance.sourceType) {
    case 'DB': return 'real'
    case 'CAPTURE': return 'captured'
    case 'DEMO': return 'illustrative'
    default: return 'synthetic'
  }
})

// 合计 / 综合收益行加粗（结算单、出清表、归因表通用）
function rowClass({ row }: { row: Record<string, unknown> }): string {
  return Object.values(row).some((v) => v === '合计' || v === '综合收益') ? 'total-row' : ''
}

const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render: renderChart })

function renderChart() {
  if (props.block.blockType !== 'CHART') return
  const option = (data.value.option as Record<string, unknown>) ?? null
  if (!option || !chartEl.value) return
  // 统一增强：带单位的轴 tooltip + 工具箱（保存图片/数据视图/还原）；区块 option 可覆盖。
  chart.setOption({ tooltip: axisTooltip({ digits: 2 }), toolbox: chartToolbox(props.block.title), ...option }, true)
}

onMounted(renderChart)
watch(() => props.block, renderChart, { deep: true })
</script>

<template>
  <el-card shadow="never" class="block-card">
    <template #header>
      <div class="block-head">
        <span class="block-title">{{ block.title }}</span>
        <DataBasisBadge :basis="basis" />
      </div>
    </template>

    <!-- 指标卡 -->
    <div v-if="block.blockType === 'METRIC'" class="kpi-grid">
      <div v-for="k in kpis" :key="k.label" class="kpi" :class="'tone-' + (k.tone || 'stable')">
        <div class="kpi-val">{{ k.value }}<span v-if="k.unit" class="kpi-unit">{{ k.unit }}</span></div>
        <div class="kpi-label">{{ k.label }}</div>
      </div>
    </div>

    <!-- 结算单：指标卡 + 明细表 -->
    <template v-else-if="block.blockType === 'SETTLEMENT'">
      <div class="kpi-grid">
        <div v-for="k in kpis" :key="k.label" class="kpi" :class="'tone-' + (k.tone || 'stable')">
          <div class="kpi-val">{{ k.value }}<span v-if="k.unit" class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-label">{{ k.label }}</div>
        </div>
      </div>
      <el-table :data="rows" border size="small" class="block-table" :row-class-name="rowClass">
        <el-table-column v-for="c in columns" :key="c.key" :prop="c.key" :label="c.label" :width="c.width" :align="c.align || 'left'" />
      </el-table>
    </template>

    <!-- 表格 -->
    <el-table v-else-if="block.blockType === 'TABLE'" :data="rows" border size="small" class="block-table" :row-class-name="rowClass">
      <el-table-column v-for="c in columns" :key="c.key" :prop="c.key" :label="c.label" :width="c.width" :align="c.align || 'left'" />
    </el-table>

    <!-- 图表 -->
    <div v-else-if="block.blockType === 'CHART'" ref="chartEl" class="chart-host"></div>

    <!-- AI 文本 -->
    <div v-else-if="block.blockType === 'AI_TEXT'" class="ai-text">
      <div v-for="s in sections" :key="s.title" class="ai-sec">
        <div class="ai-sec-title">{{ s.title }}</div>
        <div class="ai-sec-body">{{ s.body }}</div>
      </div>
    </div>

    <div v-if="sqlTrace.length" class="sql-trace">
      <button class="trace-toggle" @click="showTrace = !showTrace">{{ showTrace ? '收起' : '查看' }} SQL 溯源</button>
      <pre v-if="showTrace" class="trace-code">{{ sqlTrace.join('\n') }}</pre>
    </div>
    <div v-if="footnote" class="footnote">{{ footnote }}</div>
    <div v-if="block.note" class="block-note">{{ block.note }}</div>
  </el-card>
</template>

<style scoped>
.sql-trace { margin-top: 6px; }
.trace-toggle { font-size: 11px; padding: 2px 8px; border: 1px solid var(--line, #ddd); border-radius: 4px; background: transparent; cursor: pointer; }
.trace-code { margin: 6px 0 0; padding: 8px; border-radius: 6px; background: var(--panel-sub, #f5f6f8); font-size: 11px; white-space: pre-wrap; overflow-x: auto; }
.block-card { margin-bottom: 16px; }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.block-title { font-weight: 600; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.kpi { border: 1px solid var(--el-border-color-light, #ebeef5); border-left: 3px solid var(--el-color-primary, #409eff); border-radius: 8px; padding: 12px 14px; background: var(--el-fill-color-blank, #fff); }
.kpi-val { font-size: 22px; font-weight: 700; line-height: 1.2; }
.kpi-unit { font-size: 12px; font-weight: 400; margin-left: 4px; color: var(--el-text-color-secondary, #909399); }
.kpi-label { font-size: 12px; color: var(--el-text-color-secondary, #909399); margin-top: 6px; }
.tone-warning { border-left-color: #e6a23c; }
.tone-warning .kpi-val { color: #b8860b; }
.tone-danger { border-left-color: #f56c6c; }
.tone-danger .kpi-val { color: #c0392b; }
.block-table { margin-top: 12px; }
.block-table :deep(.total-row) { font-weight: 700; background: var(--el-fill-color-light, #f5f7fa); }
.chart-host { width: 100%; height: 320px; }
.ai-text { display: flex; flex-direction: column; gap: 10px; }
.ai-sec-title { font-weight: 600; margin-bottom: 2px; }
.ai-sec-body { color: var(--el-text-color-regular, #606266); line-height: 1.6; font-size: 13px; }
.footnote { margin-top: 8px; font-size: 12px; color: var(--el-text-color-secondary, #909399); }
.block-note { margin-top: 6px; font-size: 11px; color: #b8860b; }
</style>
