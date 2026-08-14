<script setup lang="ts">
// 通用动态列表格：列由行对象的键集自动生成，无需为每个 family 写死列。
// 提炼自 MarketDataView 导出预览的 v-for 动态列范式，补齐：关键词筛选 + 分页 + CSV 导出。
// 用于通用数据浏览器与任意"先看到数据"的场景，使后续每月新形态数据零 bespoke 即可浏览。
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    rows: Array<Record<string, unknown>>
    // 可选：列键 → 中文表头映射（缺省用键名本身）
    labels?: Record<string, string>
    pageSize?: number
    exportable?: boolean
    // 可选：导出文件名前缀
    exportName?: string
    maxColumnWidth?: number
  }>(),
  { pageSize: 20, exportable: true, exportName: 'data', maxColumnWidth: 260 }
)

// B3 选中即问：点击行上抛该行数据，供调用方作为 AgentChatPanel contextPayload 注入（走 untrusted_external_content）
const emit = defineEmits<{ 'row-click': [row: Record<string, unknown>] }>()
function onRowClick(row: unknown) {
  emit('row-click', row as Record<string, unknown>)
}

const keyword = ref('')
const page = ref(1)
const innerPageSize = ref(props.pageSize)

// 列集合 = 所有行键的并集（不同行字段不一致也能完整呈现），保持首次出现顺序。
const columns = computed<string[]>(() => {
  const seen: string[] = []
  const set = new Set<string>()
  for (const row of props.rows ?? []) {
    for (const key of Object.keys(row ?? {})) {
      if (!set.has(key)) {
        set.add(key)
        seen.push(key)
      }
    }
  }
  return seen
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.rows ?? []
  return (props.rows ?? []).filter((row) =>
    Object.values(row ?? {}).some((v) => String(v ?? '').toLowerCase().includes(kw))
  )
})

const total = computed(() => filtered.value.length)

const paged = computed(() => {
  const start = (page.value - 1) * innerPageSize.value
  return filtered.value.slice(start, start + innerPageSize.value)
})

// 筛选/数据变化时回到第一页，避免空页。
watch([keyword, () => props.rows], () => {
  page.value = 1
})

function columnLabel(key: string): string {
  return props.labels?.[key] ?? key
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function exportCsv() {
  const cols = columns.value
  const escape = (v: unknown) => {
    const s = cellText(v).replaceAll('"', '""')
    return /[",\n]/.test(s) ? `"${s}"` : s
  }
  const header = cols.map((c) => escape(columnLabel(c))).join(',')
  const body = filtered.value.map((row) => cols.map((c) => escape(row?.[c])).join(',')).join('\n')
  const csv = `﻿${header}\n${body}` // BOM 保 Excel 中文不乱码
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.exportName}-${total.value}rows.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="dynamic-table">
    <div class="dynamic-table__toolbar">
      <el-input
        v-model="keyword"
        placeholder="关键词筛选（全列）"
        clearable
        size="small"
        style="max-width: 240px"
      />
      <span class="dynamic-table__count">{{ total }} 行 · {{ columns.length }} 列</span>
      <el-button v-if="exportable" size="small" :disabled="!total" @click="exportCsv">
        导出 CSV
      </el-button>
    </div>

    <el-table :data="paged" border stripe size="small" max-height="560" highlight-current-row @row-click="onRowClick">
      <el-table-column
        v-for="col in columns"
        :key="col"
        :prop="col"
        :label="columnLabel(col)"
        :min-width="120"
        :max-width="maxColumnWidth"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ cellText(row[col]) }}</template>
      </el-table-column>
      <template #empty>暂无数据</template>
    </el-table>

    <div class="dynamic-table__pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="innerPageSize"
        :total="total"
        :page-sizes="[20, 50, 100, 200]"
        layout="sizes, prev, pager, next, total"
        size="small"
        background
      />
    </div>
  </div>
</template>

<style scoped>
.dynamic-table__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.dynamic-table__count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.dynamic-table__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
