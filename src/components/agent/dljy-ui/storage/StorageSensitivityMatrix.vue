<script setup lang="ts">
import { computed } from 'vue'
import { arr, fmt, obj } from './helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const sensitivity = computed(() => obj(props.data.sensitivity ?? props.data))
const results = computed(() => obj(sensitivity.value.results ?? props.data.results))
const changes = computed(() => {
  const first = Object.values(results.value)[0]
  return arr(obj(first).changes)
})
const rows = computed(() => Object.entries(results.value).map(([name, item]) => ({ name, item: obj(item) })))
</script>

<template>
  <section class="sensitivity-card">
    <header>
      <h3>{{ title || '敏感性矩阵' }}</h3>
      <span>单元格为 IRR %</span>
    </header>
    <div class="matrix">
      <div class="cell head">参数</div>
      <div v-for="c in changes" :key="String(c)" class="cell head">{{ c }}%</div>
      <template v-for="r in rows" :key="r.name">
        <div class="cell name">{{ r.name }}</div>
        <div v-for="(v, i) in arr(r.item.irr_values)" :key="`${r.name}-${i}`" class="cell value">
          {{ fmt(v) }}
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.sensitivity-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
  overflow: hidden;
}
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 12px; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
header span { font-size: var(--font-sm); color: var(--muted, #667085); white-space: nowrap; }
.matrix {
  display: grid;
  grid-template-columns: minmax(92px, 1.15fr) repeat(5, minmax(54px, 1fr));
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 6px;
  overflow-x: auto;
}
.cell {
  padding: 8px 9px;
  border-right: 1px solid var(--line-soft, #e5e7eb);
  border-bottom: 1px solid var(--line-soft, #e5e7eb);
  font-size: var(--font-sm);
  min-width: 0;
}
.head { background: rgba(148, 163, 184, 0.12); color: var(--muted, #667085); font-weight: 600; }
.name { color: var(--text-body, #344054); font-weight: 600; }
.value { text-align: right; color: var(--text, #111827); font-variant-numeric: tabular-nums; }
</style>
