<script setup lang="ts">
import { computed } from 'vue'
import { Banknote, CircleDollarSign, Landmark, TimerReset } from 'lucide-vue-next'
import { fmt, obj } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const finance = computed(() => obj(props.data.finance ?? props.data))
const items = computed(() => [
  { label: '总投资', value: fmt(finance.value.total_investment_wan), unit: '万元', icon: Banknote },
  { label: '资本金', value: fmt(finance.value.equity_investment_wan), unit: '万元', icon: Landmark },
  { label: '年收入', value: fmt(finance.value.annual_revenue_wan), unit: '万元', icon: CircleDollarSign },
  { label: '动态回收期', value: fmt(finance.value.dynamic_payback_years, 1), unit: '年', icon: TimerReset },
])
</script>

<template>
  <section class="finance-summary">
    <header>
      <h3>{{ title || '项目财务摘要' }}</h3>
      <span>{{ data.formula_version || 'investment-assessment.storage.v1' }}</span>
    </header>
    <div class="summary-grid">
      <article v-for="item in items" :key="item.label">
        <component :is="item.icon" :size="18" />
        <span>{{ item.label }}</span>
        <strong>{{ item.value }} <small>{{ item.unit }}</small></strong>
      </article>
    </div>
  </section>
</template>

<style scoped>
.finance-summary {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
h3 { margin: 0; font-size: 16px; color: var(--text, #111827); }
header span { color: var(--muted, #667085); font-size: 12px; overflow-wrap: anywhere; text-align: right; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
article {
  min-width: 0;
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel-sub, #f8fafc);
  padding: 10px;
}
svg { color: var(--primary, #0f766e); }
article span { display: block; margin-top: 8px; color: var(--muted, #667085); font-size: 12px; }
article strong { display: block; margin-top: 4px; color: var(--text, #111827); font-size: 18px; overflow-wrap: anywhere; }
small { font-size: 12px; color: var(--muted, #667085); }
@media (max-width: 900px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
