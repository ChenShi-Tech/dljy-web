<script setup lang="ts">
// 交易策略表（brief）：渲染今日申报/持仓建议（时段 × 动作 × 依据）。
// 由 LLM 基于 bundle 产出（建议性，非自动执行）。动态列，缺字段安全兜底。
import { computed } from 'vue'
import { arr, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const rows = computed(() => arr(props.data.rows ?? props.data.items ?? props.data).map((r) => obj(r)))
// 列：显式 columns（[{key,label}]）优先；否则从首行键推断，常用键给中文表头。
const HEAD: Record<string, string> = {
  period: '时段', time: '时段', hour: '时段',
  action: '建议动作', advice: '建议', strategy: '策略',
  basis: '依据', reason: '依据', note: '说明',
  price: '价格', volume: '电量', position: '持仓'
}
const columns = computed(() => {
  const explicit = arr(props.data.columns).map((c) => {
    const o = obj(c)
    return { key: str(o.key), label: str(o.label, str(o.key)) }
  })
  if (explicit.length) return explicit
  const first = rows.value[0] || {}
  return Object.keys(first).map((k) => ({ key: k, label: HEAD[k] || k }))
})
</script>

<template>
  <section class="strat-table">
    <header>
      <h3>{{ title || '今日交易策略' }}</h3>
      <span class="strat-tag">建议 · 非自动执行</span>
    </header>
    <div class="strat-scroll">
      <table v-if="rows.length">
        <thead>
          <tr><th v-for="c in columns" :key="c.key">{{ c.label }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td v-for="c in columns" :key="c.key">{{ str(r[c.key], '—') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="strat-empty">暂无策略建议</p>
    </div>
  </section>
</template>

<style scoped>
.strat-table { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
.strat-tag { font-size: var(--font-sm); color: var(--muted, #667085); background: var(--panel-sub, #f8fafc); border: 1px solid var(--line-soft, #e5e7eb); border-radius: 999px; padding: 2px 9px; }
.strat-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--font-md); }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line-soft, #e5e7eb); white-space: nowrap; }
th { color: var(--muted, #667085); font-weight: 600; font-size: var(--font-sm); background: var(--panel-sub, #f8fafc); }
td { color: var(--text-body, #344054); }
tr:last-child td { border-bottom: none; }
.strat-empty { color: var(--muted, #98a2b3); font-size: var(--font-md); margin: 0; }
</style>
