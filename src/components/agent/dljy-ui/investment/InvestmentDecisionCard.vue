<script setup lang="ts">
import { computed } from 'vue'
import { Activity, BadgeCheck, TriangleAlert } from 'lucide-vue-next'
import { basisLabel, fmt, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const decision = computed(() => obj(props.data.decision ?? props.data))
const finance = computed(() => obj(props.data.finance ?? props.data))
const assetType = computed(() => str(props.data.asset_type, 'storage'))
const verdict = computed(() => str(decision.value.verdict, 'adjust'))
const tone = computed(() => str(decision.value.risk_level, 'yellow'))
const label = computed(() => {
  if (verdict.value === 'invest') return '进入下一步'
  if (verdict.value === 'no_go') return '暂缓投资'
  return '调整后复核'
})
const icon = computed(() => (verdict.value === 'invest' ? BadgeCheck : verdict.value === 'no_go' ? TriangleAlert : Activity))
</script>

<template>
  <section class="investment-decision" :class="tone">
    <div class="decision-head">
      <div class="icon"><component :is="icon" :size="22" /></div>
      <div class="copy">
        <p>{{ title || '投资测算决策' }} · {{ assetType }} · {{ basisLabel(basis || str(data.basis)) }}</p>
        <h3>{{ label }}</h3>
        <span>{{ str(decision.reason, '等待确定性测算结果。') }}</span>
      </div>
    </div>
    <div class="metrics">
      <article>
        <span>资本金 IRR</span>
        <strong>{{ fmt(finance.irr_pct) }}%</strong>
      </article>
      <article>
        <span>NPV</span>
        <strong>{{ fmt(finance.npv_wan) }} 万元</strong>
      </article>
      <article>
        <span>回收期</span>
        <strong>{{ fmt(finance.payback_years, 1) }} 年</strong>
      </article>
      <article>
        <span>LCOE</span>
        <strong>{{ fmt(finance.lcoe_yuan_kwh, 4) }} 元/kWh</strong>
      </article>
    </div>
  </section>
</template>

<style scoped>
.investment-decision {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-left-width: 4px;
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
.investment-decision.green { border-left-color: #16a34a; }
.investment-decision.yellow { border-left-color: #f59e0b; }
.investment-decision.red { border-left-color: #dc2626; }
.decision-head { display: flex; gap: 12px; align-items: flex-start; }
.icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--primary, #0f766e);
  background: rgba(15, 118, 110, 0.1);
}
.copy { min-width: 0; }
.copy p { margin: 0 0 3px; font-size: 12px; color: var(--muted, #667085); }
.copy h3 { margin: 0; font-size: 20px; color: var(--text, #111827); line-height: 1.25; }
.copy span { display: block; margin-top: 5px; font-size: 13px; line-height: 1.5; color: var(--text-body, #344054); }
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 13px;
  background: var(--line-soft, #e5e7eb);
}
.metrics article { min-width: 0; padding: 10px 12px; background: var(--panel, #fff); }
.metrics span { display: block; font-size: 12px; color: var(--muted, #667085); }
.metrics strong { display: block; margin-top: 4px; font-size: 17px; color: var(--text, #111827); overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
