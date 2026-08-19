<script setup lang="ts">
import { computed } from 'vue'
import { Zap } from 'lucide-vue-next'
import { arr, basisLabel, fmt, num, obj, str } from './helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const dispatch = computed(() => obj(props.data.dispatch ?? props.data))
const meta = computed(() => obj(dispatch.value.meta))
const rows = computed(() => arr(dispatch.value.rows ?? props.data.rows).map(obj))
const maxPrice = computed(() => Math.max(1, ...rows.value.map((r) => num(r.price))))
const maxPower = computed(() => Math.max(1, ...rows.value.map((r) => Math.max(num(r.charge_mw), num(r.discharge_mw)))))
const previewRows = computed(() => rows.value.slice(0, 24))
</script>

<template>
  <section class="dispatch-card">
    <header>
      <div>
        <p class="eyebrow">{{ basisLabel(basis || str(data.basis)) }}</p>
        <h3>{{ title || '储能充放调度' }}</h3>
      </div>
      <div class="solver"><Zap :size="14" /> {{ str(meta.solver, 'solver') }} · {{ fmt(meta.objective_value) }} 元</div>
    </header>
    <div class="tape">
      <div v-for="r in previewRows" :key="str(r.t)" class="slot">
        <div class="price" :style="{ height: `${Math.max(8, num(r.price) / maxPrice * 64)}px` }" />
        <div
          v-if="num(r.charge_mw) > 0"
          class="power charge"
          :style="{ height: `${Math.max(7, num(r.charge_mw) / maxPower * 42)}px` }"
        />
        <div
          v-if="num(r.discharge_mw) > 0"
          class="power discharge"
          :style="{ height: `${Math.max(7, num(r.discharge_mw) / maxPower * 42)}px` }"
        />
        <span class="soc">{{ fmt(r.soc_pct, 0) }}</span>
      </div>
    </div>
    <div class="axis">
      <span v-for="r in previewRows.filter((_, i) => i % 3 === 0)" :key="`x-${str(r.t)}`">{{ str(r.t) }}</span>
    </div>
    <footer>
      <span><i class="dot price-dot" />价格</span>
      <span><i class="dot charge-dot" />充电</span>
      <span><i class="dot discharge-dot" />放电</span>
      <span>SOC 数字为 %</span>
    </footer>
  </section>
</template>

<style scoped>
.dispatch-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.eyebrow { margin: 0 0 2px; font-size: var(--font-sm); color: var(--muted, #667085); }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
.solver { display: flex; align-items: center; gap: 5px; font-size: var(--font-sm); color: var(--muted, #667085); white-space: nowrap; }
.tape {
  display: grid;
  grid-template-columns: repeat(24, minmax(12px, 1fr));
  gap: 4px;
  height: 122px;
  align-items: end;
  padding: 8px 0 4px;
  border-bottom: 1px solid var(--line-soft, #e5e7eb);
}
.slot { position: relative; height: 108px; display: flex; align-items: end; justify-content: center; gap: 1px; }
.price {
  width: 42%;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.75), rgba(59, 130, 246, 0.14));
}
.power { position: absolute; bottom: 0; width: 25%; border-radius: 4px 4px 0 0; }
.charge { left: 4%; background: rgba(22, 163, 74, 0.75); }
.discharge { right: 4%; background: rgba(220, 38, 38, 0.75); }
.soc {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  font-size: var(--font-10); color: var(--muted, #667085);
}
.axis { display: flex; justify-content: space-between; margin-top: 5px; font-size: var(--font-10-5); color: var(--muted, #667085); }
footer { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; font-size: var(--font-sm); color: var(--muted, #667085); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.price-dot { background: #3b82f6; }
.charge-dot { background: #16a34a; }
.discharge-dot { background: #dc2626; }
</style>
