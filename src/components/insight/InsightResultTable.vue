<script setup lang="ts">
// 市场洞察结果明细表（dljy#2996，OpenSpec 任务 5.8，design DE09—DE10、DE12）
// ----------------------------------------------------------------------------
// 与图表读同一份规范结果的表格视图：
//   - 列为语义身份（对象、字段、区间起、区间止、值、单位），值缺测显示「—」；
//   - 本页 x 行 / 全量 y 行如实标注（page.scope），分页结果不是全量；
//   - 导出本页导出当前行；导出全量经 fetchAll 重新查询（不带 page），拿到的是
//     全量口径再落 CSV——避免把「本页」当「全部」存档；
//   - CSV 保留单位、来源业务标题、原生粒度说明，缺测值写「缺测」；值为原始字符串
//     （原生精度），不在导出层做任何数值加工；
//   - 图表选区联动：selection 按语义（对象 + 时段相交 + 来源 / 阶段一致）高亮行，
//     不按数组下标；表格自身点击行只 emit，由页面决定是否转成选区（防回环在
//     useInsightSelection 内处理）。

import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import { getInsightSource } from 'shared/insight/sources.mjs'
import type { InsightBlockResult, InsightSeriesMeta } from '@/services/insight/insightClient'
import { formatBeijingDateTime, formatInsightValue, insightPrecision, fieldText } from './insightText'
import { buildInsightCsv, downloadInsightCsv } from './insightCsv'
import type { InsightSourceTitle } from './insightText'

type ResultRow = { seriesId: string; intervalStart: string; intervalEnd: string; value: string }

const props = defineProps<{
  result: InsightBlockResult | null
  /** 导出全量用：重新发起不带 page 的查询，返回全量结果；不提供则隐藏该按钮。 */
  fetchAll?: () => Promise<InsightBlockResult | null>
  /** 图表选区（语义）联动高亮；null 清除。 */
  selection?: InsightSelection | null
  sourceTitles?: Record<string, InsightSourceTitle>
}>()

const emit = defineEmits<{
  'row-click': [hit: { series: InsightSeriesMeta; row: ResultRow }]
}>()

const catalog = computed(() => new Map((props.result?.data?.series ?? []).map((series) => [series.seriesId, series])))

/** 展示行：目录里的业务身份 + 原始值（显示层格式化，统计不用浮点）。 */
const tableRows = computed(() => {
  const result = props.result
  if (!result?.data) return []
  return ((result.data.rows ?? []) as ResultRow[])
    .map((row) => {
      const meta = catalog.value.get(row.seriesId)
      if (!meta) return null
      const dimension = getInsightSource(meta.sourceId)?.objectDimension
      return {
        key: `${row.seriesId}@${row.intervalStart}`,
        series: meta,
        object: dimension ? String(meta.dimensions?.[dimension] ?? '') || '—' : '—',
        field: fieldText(meta.fieldId),
        start: formatBeijingDateTime(row.intervalStart),
        end: formatBeijingDateTime(row.intervalEnd),
        value: formatInsightValue(row.value, insightPrecision(meta.sourceId)),
        unit: meta.unit,
        raw: row,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
})

/** 本页 / 全量标注：page.scope 为 page 时本页只是全量的一页。 */
const rowCountText = computed(() => {
  const page = props.result?.page
  if (!page) return `共 ${tableRows.value.length} 行`
  if (page.scope === 'page') return `本页 ${page.returnedRows ?? tableRows.value.length} 行 / 全量 ${page.totalRows ?? '—'} 行`
  return `全量 ${page.totalRows ?? tableRows.value.length} 行`
})

/** 选区高亮：语义匹配（对象 ∈ 选区对象、时段相交、来源与阶段一致），不按下标。 */
function isHighlighted(row: (typeof tableRows.value)[number]): boolean {
  const selection = props.selection
  if (!selection) return false
  const meta = row.series
  if (selection.sourceIds.length && !selection.sourceIds.includes(meta.sourceId)) return false
  if (selection.marketPhase && meta.marketPhase && selection.marketPhase !== meta.marketPhase) return false
  if (selection.objectRefs.length) {
    const dimension = getInsightSource(meta.sourceId)?.objectDimension
    if (!dimension) return false
    const object = String(meta.dimensions?.[dimension] ?? '')
    if (!selection.objectRefs.some((ref) => ref.id === object)) return false
  }
  const startMs = Date.parse(row.raw.intervalStart)
  const endMs = Number.isFinite(Date.parse(row.raw.intervalEnd)) ? Date.parse(row.raw.intervalEnd) : startMs
  return selection.timeIntervals.some(
    (interval) => startMs < Date.parse(interval.end) && endMs > Date.parse(interval.start)
  )
}

function rowClassName({ row }: { row: (typeof tableRows.value)[number] }): string {
  return isHighlighted(row) ? 'insight-table__row--selected' : ''
}

// --- CSV 导出（口径见 insightCsv.ts） --------------------------------------------

function exportPage(): void {
  const result = props.result
  // 版本绑定（dljy#3078 任务 15.2）：没有 resultVersion/readSetRef 的结果不能作为可核验的存档导出。
  if (!result?.data || !result.resultVersion || !result.readSetRef) return
  downloadInsightCsv(buildInsightCsv(result, props.sourceTitles), `洞察结果-${result.analysisId}-${result.resultVersion.slice(0, 12)}.csv`)
  ElMessage.success(`已导出本页 ${tableRows.value.length} 行`)
}

const exportingAll = ref(false)

async function exportAll(): Promise<void> {
  if (!props.fetchAll || exportingAll.value) return
  exportingAll.value = true
  try {
    const full = await props.fetchAll()
    if (!full?.data || !full.resultVersion || !full.readSetRef) {
      ElMessage.warning('全量数据读取失败，未导出')
      return
    }
    const count = (full.data.rows ?? []).length
    downloadInsightCsv(buildInsightCsv(full, props.sourceTitles), `洞察结果-全量-${full.analysisId}-${full.resultVersion.slice(0, 12)}.csv`)
    ElMessage.success(`已导出全量 ${count} 行`)
  } finally {
    exportingAll.value = false
  }
}
</script>

<template>
  <div class="insight-table">
    <div class="insight-table__toolbar">
      <span class="insight-table__count">{{ rowCountText }}</span>
      <span class="insight-table__actions">
        <el-button size="small" :disabled="!result" @click="exportPage">导出本页</el-button>
        <el-button v-if="fetchAll" size="small" :loading="exportingAll" @click="exportAll">导出全量</el-button>
      </span>
    </div>
    <el-table
      v-if="tableRows.length"
      :data="tableRows"
      size="small"
      border
      max-height="420"
      :row-class-name="rowClassName"
      @row-click="(row: (typeof tableRows)[number]) => emit('row-click', { series: row.series, row: row.raw })"
    >
      <el-table-column prop="object" label="对象" min-width="140" show-overflow-tooltip />
      <el-table-column prop="field" label="字段" min-width="120" show-overflow-tooltip />
      <el-table-column prop="start" label="区间起" width="130" />
      <el-table-column prop="end" label="区间止" width="130" />
      <el-table-column prop="value" label="值" width="110" align="right" />
      <el-table-column prop="unit" label="单位" width="90" />
    </el-table>
    <el-empty v-else description="没有可展示的行" :image-size="64" />
  </div>
</template>

<style scoped>
.insight-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insight-table__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.insight-table__count {
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}

.insight-table__actions {
  display: inline-flex;
  gap: 8px;
}

:deep(.insight-table__row--selected) td {
  background-color: rgb(245 158 11 / 12%);
}
</style>
