<script setup lang="ts">
// 结算对账 artifact：通用矩阵(header + label 行 + values)，diffs 指定单元格染色 + 原因(title),
// summary 脚注，导出 CSV。旧 4 列对账已在解析层归一为矩阵(差异列自动染色 + 合计行)。
import { computed } from 'vue'
import { Scale, Download } from 'lucide-vue-next'
import type { SettlementArtifactBlock, SettlementCellDiff } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: SettlementArtifactBlock }>()

const diffMap = computed(() => {
  const m = new Map<string, SettlementCellDiff>()
  for (const d of props.block.diffs) m.set(`${d.row}:${d.col}`, d)
  return m
})
function cellDiff(r: number, c: number): SettlementCellDiff | undefined {
  return diffMap.value.get(`${r}:${c}`)
}
function cellStyle(r: number, c: number): Record<string, string> | undefined {
  const d = cellDiff(r, c)
  if (!d?.color) return undefined
  const hex = /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : '#dc2626'
  return { color: hex, background: hex + '18', fontWeight: '600' }
}
function isTotal(label: string): boolean {
  return label === '合计' || label === '总计' || label.toLowerCase() === 'total'
}
function exportCsv() {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [props.block.header.map(esc).join(',')]
  for (const row of props.block.rows) lines.push([row.label, ...row.values].map(esc).join(','))
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.block.title || 'settlement'}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
</script>

<template>
  <ArtifactFrame kind="settlement" :title="block.title">
    <template #icon><Scale :size="14" /></template>
    <template #actions>
      <button class="art-btn" @click="exportCsv"><Download :size="12" />CSV</button>
    </template>
    <div class="st-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="(h, i) in block.header" :key="i" :class="{ r: i > 0 }">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in block.rows" :key="r" :class="{ total: isTotal(row.label) }">
            <td class="label">{{ row.label }}</td>
            <td
              v-for="(v, c) in row.values"
              :key="c"
              class="r"
              :style="cellStyle(r, c)"
              :title="cellDiff(r, c)?.reason"
            >{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="block.summary" class="st-summary">{{ block.summary }}</div>
  </ArtifactFrame>
</template>

<style scoped>
.st-scroll { overflow-x: auto; max-height: 460px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { border: 1px solid rgba(125, 125, 125, 0.2); padding: 5px 10px; white-space: nowrap; }
th { background: rgba(125, 125, 125, 0.08); font-weight: 600; position: sticky; top: 0; text-align: left; }
th.r, td.r { text-align: right; font-variant-numeric: tabular-nums; }
.label { text-align: left; }
tbody tr:nth-child(even) { background: rgba(125, 125, 125, 0.03); }
.total td { font-weight: 700; background: rgba(125, 125, 125, 0.06); border-top: 2px solid rgba(125, 125, 125, 0.3); }
.st-summary {
  padding: 8px 14px; font-size: 12px; opacity: 0.7;
  border-top: 1px solid rgba(125, 125, 125, 0.14);
}
</style>
