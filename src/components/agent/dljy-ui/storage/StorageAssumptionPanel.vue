<script setup lang="ts">
import { computed } from 'vue'
import { FileText } from 'lucide-vue-next'
import { basisLabel, fmt, obj, str } from './helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const assumptions = computed(() => obj(props.data.assumptions ?? props.data))
const region = computed(() => obj(props.data.region))
const rows = computed(() => [
  { label: '地区口径', value: str(region.value.name || props.data.region_name, '当前地区') },
  { label: '数据口径', value: basisLabel(props.basis || str(props.data.basis || assumptions.value.price_basis)) },
  { label: '往返效率', value: `${fmt(assumptions.value.roundtrip_efficiency ? Number(assumptions.value.roundtrip_efficiency) * 100 : undefined)}%` },
  { label: '年循环次数', value: `${fmt(assumptions.value.derived_annual_cycles, 0)} 次` },
  { label: '充电电价', value: `${fmt(assumptions.value.derived_charge_price_yuan_kwh, 4)} 元/kWh` },
  { label: '放电电价', value: `${fmt(assumptions.value.derived_discharge_price_yuan_kwh, 4)} 元/kWh` },
])
</script>

<template>
  <section class="assumption-card">
    <header>
      <FileText :size="16" />
      <h3>{{ title || '测算假设与口径' }}</h3>
    </header>
    <div class="rows">
      <div v-for="r in rows" :key="r.label">
        <span>{{ r.label }}</span>
        <strong>{{ r.value }}</strong>
      </div>
    </div>
    <p class="note">{{ str(assumptions.price_note || assumptions.policy_source, '关键指标由确定性储能评估服务计算。') }}</p>
  </section>
</template>

<style scoped>
.assumption-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; color: var(--text, #111827); }
h3 { margin: 0; font-size: var(--font-16); }
.rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.rows > div {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 6px;
  padding: 8px 9px;
}
span { display: block; font-size: var(--font-11-5); color: var(--muted, #667085); }
strong { display: block; margin-top: 3px; font-size: var(--font-md); color: var(--text, #111827); }
.note {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft, #e5e7eb);
  font-size: var(--font-sm);
  line-height: 1.55;
  color: var(--muted, #667085);
}
@media (max-width: 700px) {
  .rows { grid-template-columns: 1fr; }
}
</style>
