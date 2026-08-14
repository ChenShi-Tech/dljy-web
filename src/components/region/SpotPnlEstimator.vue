<script setup lang="ts">
// 现货收益/风险快测（特征示意）：随主体画像实时测算。
import { computed } from 'vue'
import type { RegionSpotProfile } from '../../data/regionSpotProfiles'
import { estimateSpotPnL, type SubjectProfile } from '@/services/region/regionStrategyAdvisor'
import IllustrativeBadge from './IllustrativeBadge.vue'

const props = defineProps<{ profile: RegionSpotProfile; subject: SubjectProfile }>()

const est = computed(() => estimateSpotPnL(props.profile, props.subject))
const fmt = (n: number) => `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(1)} 万元`
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div class="section-kicker">现货收益 / 风险快测</div>
      <IllustrativeBadge v-if="est.basis === 'curated'" label="基于地区特征示意模型的测算，非实盘" />
    </div>
    <div class="metrics">
      <div>
        <small>预期现货收益(区间)</small>
        <strong>{{ fmt(est.revenueLowWan) }} ~ {{ fmt(est.revenueHighWan) }}</strong>
      </div>
      <div>
        <small>日前-实时偏差成本</small>
        <strong class="cost">{{ fmt(est.deviationCostWan) }}</strong>
      </div>
      <div>
        <small>负价时段暴露</small>
        <strong :class="{ cost: est.negativeExposureWan < 0 }">{{ fmt(est.negativeExposureWan) }}</strong>
      </div>
      <div>
        <small>加储能套利边际收益{{ subject.hasStorage ? '' : '(潜在)' }}</small>
        <strong class="up">{{ fmt(est.storageUpsideWan) }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.section-kicker {
  color: var(--primary);
  font-size: 13px;
  font-weight: 650;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.metrics div {
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}
.metrics small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 6px;
}
.metrics strong {
  color: var(--text);
  font-size: 16px;
}
.metrics .cost {
  color: var(--danger);
}
.metrics .up {
  color: var(--primary);
}
@media (max-width: 1180px) {
  .metrics {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 768px) {
  .metrics {
    grid-template-columns: 1fr;
  }
}
</style>
