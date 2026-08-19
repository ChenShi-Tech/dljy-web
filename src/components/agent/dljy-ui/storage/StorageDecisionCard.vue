<script setup lang="ts">
import { computed } from 'vue'
import { Activity, BadgeCheck, TriangleAlert } from 'lucide-vue-next'
import { basisLabel, fmt, obj, str } from './helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const decision = computed(() => obj(props.data.decision ?? props.data))
const finance = computed(() => obj(props.data.finance ?? props.data))
const verdict = computed(() => str(decision.value.verdict, 'adjust'))
const tone = computed(() => str(decision.value.risk_level, 'yellow'))
const label = computed(() => {
  if (verdict.value === 'invest') return '建议进入下一步'
  if (verdict.value === 'no_go') return '暂缓投资决策'
  return '调整参数后复核'
})
const icon = computed(() => (verdict.value === 'invest' ? BadgeCheck : verdict.value === 'no_go' ? TriangleAlert : Activity))
</script>

<template>
  <section class="decision-card" :class="tone">
    <div class="decision-main">
      <div class="icon-wrap"><component :is="icon" :size="22" /></div>
      <div>
        <p class="eyebrow">{{ title || '储能投资决策' }} · {{ basisLabel(basis || str(data.basis)) }}</p>
        <h3>{{ label }}</h3>
        <p class="reason">{{ str(decision.reason, '等待测算结果。') }}</p>
      </div>
    </div>
    <div class="metric-row">
      <div>
        <span>资本金 IRR</span>
        <strong>{{ fmt(finance.irr_pct) }}%</strong>
      </div>
      <div>
        <span>NPV</span>
        <strong>{{ fmt(finance.npv_wan) }} 万元</strong>
      </div>
      <div>
        <span>静态回收期</span>
        <strong>{{ fmt(finance.payback_years, 1) }} 年</strong>
      </div>
      <div>
        <span>年收入</span>
        <strong>{{ fmt(finance.annual_revenue_wan) }} 万元</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.decision-card {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-left-width: 4px;
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
.decision-card.green { border-left-color: #16a34a; }
.decision-card.yellow { border-left-color: #f59e0b; }
.decision-card.red { border-left-color: #dc2626; }
.decision-main { display: flex; gap: 12px; align-items: flex-start; }
.icon-wrap {
  width: 38px; height: 38px; border-radius: 8px;
  display: grid; place-items: center;
  background: rgba(15, 118, 110, 0.1); color: var(--primary, #0f766e);
}
.eyebrow { margin: 0 0 3px; font-size: var(--font-sm); color: var(--muted, #667085); }
h3 { margin: 0; font-size: var(--font-20); color: var(--text, #111827); }
.reason { margin: 5px 0 0; font-size: var(--font-md); color: var(--text-body, #344054); line-height: 1.5; }
.metric-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 13px;
  background: var(--line-soft, #e5e7eb);
}
.metric-row > div { background: var(--panel, #fff); padding: 10px 12px; min-width: 0; }
.metric-row span { display: block; font-size: var(--font-sm); color: var(--muted, #667085); }
.metric-row strong { display: block; margin-top: 3px; font-size: var(--font-18); color: var(--text, #111827); word-break: break-word; }
@media (max-width: 900px) {
  .metric-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
