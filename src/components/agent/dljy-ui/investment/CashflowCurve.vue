<script setup lang="ts">
import { computed } from 'vue'
import { arr, fmt, num, obj } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const finance = computed(() => obj(props.data.finance ?? props.data))
const rows = computed(() => arr(finance.value.cash_flow_schedule).slice(0, 14).map((item) => {
  const row = obj(item)
  return {
    year: num(row.year),
    net: num(row.net_cash_flow),
    cumulative: num(row.cumulative_cash_flow),
  }
}))
const maxAbs = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(r.net)), ...rows.value.map((r) => Math.abs(r.cumulative))))
</script>

<template>
  <section class="cashflow-card">
    <header>
      <h3>{{ title || '现金流曲线' }}</h3>
      <span>前 {{ rows.length }} 年 · 万元</span>
    </header>
    <div class="cashflow-list">
      <div v-for="row in rows" :key="row.year" class="cash-row">
        <span class="year">Y{{ row.year }}</span>
        <div class="tracks">
          <i class="net" :class="{ neg: row.net < 0 }" :style="{ width: `${Math.max(3, Math.abs(row.net) / maxAbs * 100)}%` }" />
          <i class="cum" :class="{ neg: row.cumulative < 0 }" :style="{ width: `${Math.max(3, Math.abs(row.cumulative) / maxAbs * 100)}%` }" />
        </div>
        <strong>{{ fmt(row.net) }}</strong>
      </div>
    </div>
    <footer><span />净现金流 <span class="cum-dot" />累计现金流</footer>
  </section>
</template>

<style scoped>
.cashflow-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
header span, footer { color: var(--muted, #667085); font-size: var(--font-sm); }
.cashflow-list { display: grid; gap: 7px; }
.cash-row { display: grid; grid-template-columns: 42px minmax(0, 1fr) 80px; align-items: center; gap: 10px; }
.year { color: var(--muted, #667085); font-size: var(--font-sm); }
.tracks { position: relative; height: 18px; background: rgba(148, 163, 184, 0.14); border-radius: 999px; overflow: hidden; }
.tracks i { position: absolute; left: 0; height: 8px; border-radius: 999px; }
.tracks .net { top: 2px; background: #0f766e; }
.tracks .cum { bottom: 2px; background: #2563eb; opacity: 0.72; }
.tracks .neg { background: #dc2626; }
strong { text-align: right; font-size: var(--font-sm); color: var(--text, #111827); }
footer { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
footer span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #0f766e;
  display: inline-block;
}
footer .cum-dot { background: #2563eb; }
</style>
