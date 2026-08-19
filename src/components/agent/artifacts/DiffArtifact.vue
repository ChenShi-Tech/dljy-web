<script setup lang="ts">
// 文本/方案对比 artifact：逐行 LCS diff，增删行着色（统一视图）。
// 契合售电方案版本对比、规则变更前后、参数调整对照。纯展示，不写回。
import { computed } from 'vue'
import { GitCompare } from 'lucide-vue-next'
import type { DiffArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: DiffArtifactBlock }>()
type RowType = 'eq' | 'add' | 'del'
type Row = { type: RowType; text: string }

// 经典 LCS 行级 diff：dp 求最长公共子序列，回溯产出 等/增/删 行。
function diffLines(a: string[], b: string[]): Row[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Row[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

const MAX_LINES = 800
const rows = computed<Row[]>(() => {
  const a = props.block.before.split('\n')
  const b = props.block.after.split('\n')
  // 超大文本跳过 O(n·m) 的 LCS，直接顺序展示删除块 + 新增块（避免卡顿）。
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((t): Row => ({ type: 'del', text: t })),
      ...b.map((t): Row => ({ type: 'add', text: t }))
    ]
  }
  return diffLines(a, b)
})
const stat = computed(() => {
  let add = 0
  let del = 0
  for (const r of rows.value) {
    if (r.type === 'add') add++
    else if (r.type === 'del') del++
  }
  return { add, del }
})
const SIGN: Record<RowType, string> = { eq: ' ', add: '+', del: '-' }
</script>

<template>
  <ArtifactFrame kind="diff" :title="block.title">
    <template #icon><GitCompare :size="14" /></template>
    <template #actions>
      <span class="diff-labels">
        <span class="lbl del">{{ block.beforeLabel }}</span>
        <span class="arrow">→</span>
        <span class="lbl add">{{ block.afterLabel }}</span>
      </span>
      <span class="diff-stat">
        <span v-if="stat.add" class="add">+{{ stat.add }}</span>
        <span v-if="stat.del" class="del">-{{ stat.del }}</span>
      </span>
    </template>
    <div class="diff-body">
      <div v-for="(r, i) in rows" :key="i" class="diff-line" :class="r.type">
        <span class="diff-gutter">{{ SIGN[r.type] }}</span><span class="diff-text">{{ r.text || ' ' }}</span>
      </div>
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.diff-labels { display: inline-flex; align-items: center; gap: 5px; font-size: var(--font-xs); }
.diff-labels .lbl { padding: 1px 6px; border-radius: 4px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-labels .arrow { opacity: 0.4; }
.diff-stat { display: inline-flex; gap: 6px; font-size: var(--font-11-5); font-weight: 600; font-variant-numeric: tabular-nums; }
.add { color: #16a34a; }
.del { color: #dc2626; }
.lbl.add { background: rgba(22, 163, 74, 0.12); }
.lbl.del { background: rgba(220, 38, 38, 0.12); }
.diff-body {
  margin: 0; padding: 6px 0; max-height: 420px; overflow: auto;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace; font-size: var(--font-12-5); line-height: 1.55;
}
.diff-line { display: flex; padding: 0 12px; white-space: pre; }
.diff-line.add { background: rgba(22, 163, 74, 0.1); }
.diff-line.del { background: rgba(220, 38, 38, 0.1); }
.diff-gutter { flex-shrink: 0; width: 14px; text-align: center; opacity: 0.65; user-select: none; }
.diff-line.add .diff-gutter { color: #16a34a; }
.diff-line.del .diff-gutter { color: #dc2626; }
.diff-text { flex: 1; white-space: pre-wrap; word-break: break-word; }
</style>
