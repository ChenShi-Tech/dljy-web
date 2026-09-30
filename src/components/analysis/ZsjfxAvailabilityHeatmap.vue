<script setup lang="ts">
// ZsjfxAvailabilityHeatmap — 类型×日期数据可用性热力（Epic #3591 S2 / dljy#3594，ZW-06）。
// 网格值来自真实逐日 series 的非空判定；整月全空的类型行显示缺源原因（typeMeta 来源或
// 「来源未接入或未覆盖该区间」），绝不显示为零。列头为日期（天），行头为类型。
import { computed } from 'vue'

const props = defineProps<{
  month: string
  types: string[]
  dates: string[]
  /** type → date → true(有数)/false(无数据)；缺键按无数据处理 */
  grid: Record<string, Record<string, boolean>>
  typeMeta?: Record<string, { source?: string; granularity?: string }>
}>()

const REASON_FALLBACK = '来源未接入或未覆盖该区间'

const rows = computed(() => props.types.map((type) => {
  const byDate = props.grid[type] ?? {}
  const hasCount = props.dates.filter((d) => byDate[d]).length
  const emptyReason = hasCount
    ? ''
    : `无数据：${props.typeMeta?.[type]?.source ? `来源 ${props.typeMeta[type].source} 未覆盖` : REASON_FALLBACK}`
  return { type, hasCount, emptyReason, cells: props.dates.map((d) => byDate[d] === true) }
}))
</script>

<template>
  <div class="heat">
    <div class="row head">
      <span class="type-name">类型＼日</span>
      <span v-for="d in dates" :key="d" class="cell head-cell">{{ d.slice(8) }}</span>
      <span class="count">覆盖</span>
    </div>
    <div v-for="row in rows" :key="row.type" class="row" :title="row.emptyReason || row.type">
      <span class="type-name">{{ row.type }}</span>
      <span v-for="(has, i) in row.cells" :key="i" class="cell" :class="has ? 'has' : 'miss'"></span>
      <span class="count" :class="{ empty: !row.hasCount }">{{ row.hasCount ? `${row.hasCount}/${dates.length}` : row.emptyReason }}</span>
    </div>
  </div>
</template>

<style scoped>
.heat { overflow: auto; font-size: var(--font-sm); }
.row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
.type-name { width: 170px; flex: none; color: var(--el-text-color-regular); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell { width: 12px; height: 14px; flex: none; border-radius: 2px; background: var(--el-fill-color-light); }
.cell.has { background: var(--el-color-success); opacity: .85; }
.cell.miss { background: var(--el-fill-color-dark); opacity: .5; }
.head-cell { width: 12px; text-align: center; color: var(--el-text-color-secondary); font-size: var(--font-tb-10); line-height: 1; }
.count { margin-left: 8px; flex: none; width: 150px; color: var(--el-text-color-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count.empty { color: var(--el-color-warning); }
</style>
