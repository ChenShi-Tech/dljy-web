<script setup lang="ts">
// 风险维（Epic #2033 · #2038 外壳）：风险事件库与压力测试面板（#2047 模板九/十）+ 本维模板清单。
import type { TemplateCard } from '@/services/review/cockpitModel'
import RiskReviewPanel from '../RiskReviewPanel.vue'
import TemplateChips from '../TemplateChips.vue'

defineProps<{ templates: TemplateCard[]; tolerancePct: number; penaltyPrice: number }>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()
</script>

<template>
  <div class="dim">
    <RiskReviewPanel :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" />
    <TemplateChips :templates="templates" label="风险复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
</style>
