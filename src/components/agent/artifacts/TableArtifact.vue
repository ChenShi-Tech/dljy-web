<script setup lang="ts">
// 数据表 artifact：点击列头排序(数值/中文感知) + 导出 CSV + 表头吸顶 + 横向滚动。
import { computed, ref } from 'vue'
import { Table2, Download, ChevronUp, ChevronDown } from 'lucide-vue-next'
import type { TableArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: TableArtifactBlock }>()
const sortCol = ref(-1)
const sortDir = ref<1 | -1>(1)

function toggleSort(i: number) {
  if (sortCol.value === i) sortDir.value = sortDir.value === 1 ? -1 : 1
  else {
    sortCol.value = i
    sortDir.value = 1
  }
}
function cmp(a: string, b: string): number {
  const na = parseFloat(a.replace(/[,，%¥$\s]/g, ''))
  const nb = parseFloat(b.replace(/[,，%¥$\s]/g, ''))
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  return a.localeCompare(b, 'zh')
}
const sortedRows = computed(() => {
  if (sortCol.value < 0) return props.block.rows
  const i = sortCol.value
  const dir = sortDir.value
  return [...props.block.rows].sort((a, b) => cmp(a[i] ?? '', b[i] ?? '') * dir)
})
function exportCsv() {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const head = props.block.columns.map((c) => esc(c.label)).join(',')
  const body = sortedRows.value.map((r) => r.map(esc).join(',')).join('\n')
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.block.title || 'table'}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
</script>

<template>
  <ArtifactFrame kind="table" :title="block.title" :badge="`${block.rows.length} 行`">
    <template #icon><Table2 :size="14" /></template>
    <template #actions>
      <button class="art-btn" @click="exportCsv"><Download :size="12" />CSV</button>
    </template>
    <div class="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="(c, i) in block.columns" :key="i" :class="c.align" @click="toggleSort(i)">
              {{ c.label }}
              <component :is="sortDir === 1 ? ChevronUp : ChevronDown" v-if="sortCol === i" :size="11" class="sort-ic" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, ri) in sortedRows" :key="ri">
            <td v-for="(cell, ci) in r" :key="ci" :class="block.columns[ci]?.align">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="block.footnote" class="tbl-foot">{{ block.footnote }}</div>
  </ArtifactFrame>
</template>

<style scoped>
.tbl-scroll { overflow-x: auto; max-height: 420px; }
table { border-collapse: collapse; width: 100%; font-size: var(--font-12-5); }
th, td { border: 1px solid rgba(125, 125, 125, 0.2); padding: 5px 10px; text-align: left; white-space: nowrap; }
th {
  background: rgba(125, 125, 125, 0.08); font-weight: 600; cursor: pointer; user-select: none;
  position: sticky; top: 0;
}
th:hover { background: rgba(125, 125, 125, 0.14); }
td.right, th.right { text-align: right; font-variant-numeric: tabular-nums; }
td.center, th.center { text-align: center; }
tbody tr:nth-child(even) { background: rgba(125, 125, 125, 0.03); }
.sort-ic { vertical-align: middle; margin-left: 2px; }
.tbl-foot { padding: 8px 12px; font-size: var(--font-sm); opacity: 0.7; border-top: 1px solid rgba(125, 125, 125, 0.14); }
</style>
