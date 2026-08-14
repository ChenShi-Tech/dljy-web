<script setup lang="ts">
import { computed } from 'vue'
import { fmt, num, obj } from './helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const finance = computed(() => obj(props.data.finance ?? props.data))
const breakdown = computed(() => obj(finance.value.revenue_breakdown ?? props.data.revenue_breakdown))
const rows = computed(() => [
  { label: '容量电费', value: num(breakdown.value.capacity_payment), type: 'gain' },
  { label: '峰谷套利', value: num(breakdown.value.peak_valley_arbitrage), type: 'gain' },
  { label: '辅助服务', value: num(breakdown.value.auxiliary_revenue), type: 'gain' },
  { label: '补贴', value: num(breakdown.value.subsidy_revenue), type: 'gain' },
  { label: '充电成本', value: -Math.abs(num(breakdown.value.energy_charge_cost)), type: 'cost' },
  { label: '年收入', value: num(breakdown.value.total_revenue), type: 'total' }
])
const maxAbs = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(r.value))))
</script>

<template>
  <section class="waterfall-card">
    <header>
      <h3>{{ title || '收益结构分解' }}</h3>
      <span>万元/年</span>
    </header>
    <div class="bars">
      <div v-for="r in rows" :key="r.label" class="bar-row">
        <span class="label">{{ r.label }}</span>
        <div class="track">
          <div
            class="bar"
            :class="r.type"
            :style="{ width: `${Math.max(6, Math.abs(r.value) / maxAbs * 100)}%` }"
          />
        </div>
        <strong>{{ fmt(r.value) }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.waterfall-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
h3 { margin: 0; font-size: 16px; color: var(--text, #111827); }
header span { font-size: 12px; color: var(--muted, #667085); }
.bars { display: grid; gap: 8px; }
.bar-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 86px;
  gap: 10px;
  align-items: center;
}
.label { font-size: 12px; color: var(--text-body, #344054); }
.track { height: 13px; background: rgba(148, 163, 184, 0.16); border-radius: 999px; overflow: hidden; }
.bar { height: 100%; border-radius: inherit; }
.bar.gain { background: #16a34a; }
.bar.cost { background: #dc2626; }
.bar.total { background: #2563eb; }
strong { text-align: right; font-size: 12.5px; color: var(--text, #111827); }
</style>
